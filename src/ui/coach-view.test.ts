/**
 * `src/ui/CoachView.tsx`: paridad de la tarjeta de estado y de los chips
 * rápidos con.
 *
 * Los tests corren en node (sin DOM), así que aquí NO se monta el componente:
 * lo que hay que vigilar es el DATO, que es lo que se rompe sin darse cuenta —
 * la tarea y destino de las acciones, sus iconos en el catálogo generado
 * (`ui/icons.ts`), el badge de ms/ok del «Probar», las opciones de un turno
 * (`turnOpts`) y el texto de contexto que viaja con un chip (`chipText`).
 */
import { describe, expect, it } from 'vitest';

import { proposalToDraft } from '@/domain/ai-exercise';
import type { AIExerciseProposal } from '@/domain/ai-exercise';
import type { CoachOutcome } from '@/state/coach';
import { ICONS } from '@/ui/icons';
import {
  QUICK_ACTIONS,
  chipText,
  creationButtons,
  creationSummary,
  payloadInCurrentUnit,
  resultLine,
  testBadge,
  turnOpts,
} from './CoachView';

describe('turno de la vista (`turnOpts` → runCoachTask)', () => {
  it('la pregunta viaja en userText y el historial detrás, en las 4 tareas', () => {
    const history = [
      { role: 'model' as const, text: 'hola' },
      { role: 'user' as const, text: '¿y hoy?' },
    ];
    expect(turnOpts('¿qué hice esta semana?', history)).toEqual({
      userText: '¿qué hice esta semana?',
      history,
    });

    /* ANTES el historial solo se pasaba en chat: los récords que el usuario
       pegaba en turnos anteriores no llegaban al modelo al pedir un entreno
       con el chip (P1 del diagnóstico) */
    for (const text of ['sugiere entreno', 'planifica la semana', 'revisa mi volumen']) {
      expect(turnOpts(text, history), text).toEqual({ userText: text, history });
    }
  });

  it('con la caja vacía y sin conversación el turno queda mínimo', () => {
    expect(turnOpts('', [])).toEqual({ userText: '', history: [] });
  });
});

describe('chips rápidos', () => {
  it('cada acción tiene destino válido y las acciones principales conservan su tarea', () => {
    expect(QUICK_ACTIONS.length).toBeGreaterThan(0);
    expect(new Set(QUICK_ACTIONS.map((action) => action.label)).size).toBe(QUICK_ACTIONS.length);
    for (const action of QUICK_ACTIONS) {
      expect(action.label.trim()).not.toBe('');
      expect(action.ask.trim()).not.toBe('');
      expect(ICONS[action.icon], `icono de «${action.label}»`).toBeDefined();
    }

    const suggest = QUICK_ACTIONS.find((action) => action.label === 'Sugerir entreno');
    expect(suggest?.jump).toBeUndefined();

    const plan = QUICK_ACTIONS.find((action) => action.label === 'Plan semanal');
    expect(plan?.task).toBe('plan');
    expect(plan?.jump).toBeUndefined();
    expect(QUICK_ACTIONS.filter((action) => action !== suggest).every((action) => !action.jump)).toBe(
      true,
    );
  });
});

describe('peso de una tarjeta al iniciar o guardar', () => {
  it('convierte desde la unidad capturada al perfil actual y conserva el peso físico', () => {
    const payload = {
      exercises: [
        { name: 'Press', sets: 3, weight: 20 },
        { name: 'Accesorio', sets: 2, weight: '2,5' },
      ],
      title: 'Empuje',
    };
    const converted = payloadInCurrentUnit(payload, 'lb', 'kg') as typeof payload;
    expect(converted.exercises[0]?.weight).toBe(9.07);
    expect(converted.exercises[1]?.weight).toBe(1.13);
    expect(payload.exercises[0]?.weight).toBe(20);
  });

  it('las tarjetas antiguas sin unidad se conservan sin inventar una equivalencia', () => {
    const payload = { exercises: [{ name: 'Press', weight: 20 }] };
    expect(payloadInCurrentUnit(payload, undefined, 'kg')).toBe(payload);
  });
});

describe('chip con contexto de la caja (`chipText`)', () => {
  it('conserva el ask si la caja está vacía y añade solo el contexto recortado', () => {
    expect(chipText('ask de Sugerir', '')).toBe('ask de Sugerir');
    expect(chipText('ask de Plan', '   \n\t ')).toBe('ask de Plan');
    const ask = 'Genera el entreno de hoy para mí.';
    expect(chipText(ask, 'solo empuje, y nada de press banca')).toBe(
      `${ask}\n\nContexto adicional: solo empuje, y nada de press banca`,
    );
    expect(chipText('ask literal', '  hola  \n')).toBe('ask literal\n\nContexto adicional: hola');
  });
});

describe('tarjeta de estado', () => {
  it('badge: `listo` antes del primer test, y ok/error con los ms después', () => {
    expect(testBadge(null)).toBe('listo');
    expect(testBadge({ ok: true, ms: 812 })).toBe('ok · 0.8 s');
    expect(testBadge({ ok: false, ms: 2100 })).toBe('error · 2.1 s');
  });
});

/* ---------- ejercicios nuevos ---------- */

/** Outcome mínimo para `resultLine`: todo lo que no se prueba se queda vacío. */
function out(over: Partial<CoachOutcome> = {}): CoachOutcome {
  return {
    origin: 'model',
    text: '',
    memoryAdded: [],
    consulted: [],
    creations: [],
    ms: 120,
    ...over,
  };
}

const NUEVA: AIExerciseProposal = {
  name: 'Remo Kroc a una mano',
  group: 'espalda',
  equip: 'mancuernas_fijas',
  type: 'compuesto',
  sets: 3,
  rest: 120,
  repMin: 8,
  repMax: 12,
  unilateral: true,
};

describe('resultLine (propuestas de ejercicio nuevo)', () => {
  it('en chat adjunta out.creations y deja el texto tal cual (sin bloque)', () => {
    const line = resultLine(
      'chat',
      out({ text: 'Te propongo uno nuevo.', creations: [NUEVA] }),
      'g',
    );
    expect(line.creations).toEqual([NUEVA]);
    expect(line.text).toBe('Te propongo uno nuevo.');
    expect(line.payload).toBeUndefined();
  });

  it('sin propuestas la línea NO lleva creations (no se pinta tarjeta vacía)', () => {
    expect(resultLine('chat', out({ text: 'hola' }), 'g').creations).toBeUndefined();
  });

  it('en chat con sessionsPayload deja el payload y las creaciones listas para importar', () => {
    const sessionsPayload = {
      sessions: [
        {
          date: '2026-09-01',
          name: 'Empuje',
          exercises: [
            { name: 'Press Inventado', isNew: true, group: 'pecho', equip: 'barra', type: 'compuesto' },
          ],
        },
      ],
    };

    const line = resultLine('chat', out({ text: 'Aquí están.', sessionsPayload }), 'g');

    expect(line.payload).toBe(sessionsPayload);
    expect(line.text).toBe('Aquí están.');
    expect(line.creations?.map((item) => item.name)).toEqual(['Press Inventado']);
  });

  it('en suggest saca del payload SOLO lo marcado con isNew: true', () => {
    const text = JSON.stringify({
      title: 'Tracción',
      rationale: 'Día de tracción.',
      exercises: [
        { name: 'Dominadas' },
        { name: 'Remo Kroc a una mano', isNew: true, group: 'espalda', equip: 'mancuernas_fijas' },
      ],
    });

    const line = resultLine('suggest', out({ text }), 'g');

    expect(line.payload).toBeTruthy();
    expect(line.creations).toEqual([
      { name: 'Remo Kroc a una mano', group: 'espalda', equip: 'mancuernas_fijas' },
    ]);
    expect(line.text).toBe('Día de tracción.');
  });

  it('conserva unidad y tarea de generación en la tarjeta guardada', () => {
    const line = resultLine(
      'suggest',
      out({ text: JSON.stringify({ title: 'Empuje', exercises: [{ name: 'Press', weight: 80 }] }) }),
      'g',
      'lb',
      '2026-11-27T10:00:00.000Z',
    );
    expect(line).toMatchObject({ task: 'suggest', unit: 'lb', ts: '2026-11-27T10:00:00.000Z' });
  });

  it('un nombre que no está en la lista pero SIN isNew no abre tarjeta (es veto)', () => {
    const text = JSON.stringify({
      title: 'Tracción',
      exercises: [{ name: 'Remo Kroc a una mano', sets: 3 }],
    });

    const line = resultLine('suggest', out({ text }), 'g');

    expect(line.payload).toBeTruthy();
    expect(line.creations).toBeUndefined();
    expect(line.text).toBe('Propuesta de entreno lista.');
  });

  it('en plan sin rationale usa el texto por defecto', () => {
    const text = JSON.stringify({ days: [] });
    const line = resultLine('plan', out({ text }), 'g');
    expect(line.text).toBe('Plan semanal listo.');
    expect(line.creations).toBeUndefined();
  });

  it('un payload ilegible se nota en el pie en vez de romper el mensaje', () => {
    const line = resultLine('suggest', out({ text: 'no es json' }), 'g');
    expect(line.payload).toBeUndefined();
    expect(line.notes).toContain('no pude interpretar el JSON');
  });
});

/* ---------- P2: el plan local no se firma como respuesta de la IA ---------- */

/** Texto exacto que arma `localOutcome` (resumen + motivo + JSON en cercilla). */
const LOCAL_TEXT = [
  'Sesión de Cuádriceps + Pecho',
  '- Sugerencia genérica de cuerpo completo: aún no hay historial suficiente.',
  'Generado en tu dispositivo con tus datos de los últimos 7 días.',
  '',
  'IA no disponible: RESOURCE_EXHAUSTED: la cuota se agotó',
  '',
  '```json',
  JSON.stringify({
    title: 'Sesión de Cuádriceps + Pecho',
    source: 'local',
    rationale: ['Sugerencia genérica de cuerpo completo: aún no hay historial suficiente.'],
    exercises: [{ name: 'Sentadilla Copa (con mancuerna)' }],
  }),
  '```',
].join('\n');

describe('resultLine con respuesta LOCAL (fallback tras un fallo de la API)', () => {
  it('el pie indica que se generó en el dispositivo, con el motivo, nunca «Coach IA»', () => {
    const line = resultLine(
      'suggest',
      out({
        origin: 'local',
        fallback: { kind: 'quota', message: 'RESOURCE_EXHAUSTED: la cuota se agotó' },
        text: LOCAL_TEXT,
        ms: 92_100,
      }),
      'gemini-3.8-flash',
    );

    expect(line.notes).toContain('Generado en tu dispositivo');
    expect(line.notes).toContain('IA no disponible: RESOURCE_EXHAUSTED: la cuota se agotó');
    expect(line.notes).toContain('92.1 s');
    expect(line.notes).not.toContain('Coach IA');
    expect(line.notes).not.toContain('tokens');
  });

  it('el aviso va ARRIBA del texto y el rationale sigue debajo (con payload aplicable)', () => {
    const line = resultLine(
      'suggest',
      out({
        origin: 'local',
        fallback: { kind: 'quota', message: 'RESOURCE_EXHAUSTED: la cuota se agotó' },
        text: LOCAL_TEXT,
      }),
      'gemini-3.8-flash',
    );

    expect(line.text.startsWith('**Generado en tu dispositivo:**')).toBe(true);
    expect(line.text).toContain('no pude usar la IA (RESOURCE_EXHAUSTED: la cuota se agotó)');
    expect(line.text).toContain('planificador local, no de la IA');
    expect(line.text).toContain('Sugerencia genérica de cuerpo completo: aún no hay historial');
    /* «Aplicar» no cambia: el JSON se sigue sacando del texto */
    expect((line.payload as { source: string }).source).toBe('local');
  });

  it('sin key (fallback sin error) el motivo es «sin API key»', () => {
    const line = resultLine('plan', out({ origin: 'local', text: LOCAL_TEXT }), 'g');
    expect(line.notes).toContain('Generado en tu dispositivo');
    expect(line.notes).toContain('sin API key');
    expect(line.text).toContain('no hay API key configurada');
  });

  it('una respuesta de la IA no lleva aviso y se firma igual que siempre', () => {
    const line = resultLine(
      'suggest',
      out({
        text: JSON.stringify({ title: 'Propuesta IA', rationale: ['por cierto'], exercises: [] }),
      }),
      'gemini-3.8-flash',
    );
    expect(line.notes).toBe('Coach IA · gemini-3.8-flash · 0.1 s');
    expect(line.text).toBe('por cierto');
    expect(line.text).not.toContain('Aviso');
  });
});

describe('botones de la tarjeta (`creationButtons`)', () => {
  it('pendiente: Crear / Crear y editar / Descartar, los tres activos', () => {
    expect(creationButtons(undefined)).toEqual([
      { key: 'create', label: 'Crear', enabled: true },
      { key: 'edit', label: 'Crear y editar', enabled: true },
      { key: 'discard', label: 'Descartar', enabled: true },
    ]);
  });

  it('ya creada o descartada: los tres desactivados (nada se crea dos veces)', () => {
    for (const status of ['created', 'discarded'] as const) {
      expect(
        creationButtons(status).every((button) => button.enabled),
        status,
      ).toBe(false);
    }
  });

  it('los iconos de los botones existen en el catálogo generado', () => {
    for (const button of creationButtons()) {
      const icon = button.key === 'discard' ? 'x' : 'plus';
      expect(ICONS[icon], `icono «${icon}» de «${button.label}»`).toBeDefined();
    }
  });
});

describe('línea de atributos (`creationSummary`)', () => {
  it('con el borrador válido pinta grupo · material · lado · tipo · prescripción', () => {
    const draft = proposalToDraft(NUEVA, [], { mancuernas_fijas: true });
    expect(draft.ok).toBe(true);
    expect(creationSummary(NUEVA, draft)).toBe(
      'Espalda · Mancuernas fijas · unilateral · compuesto · 3×8-12 · 120 s',
    );
  });

  it('si el borrador NO valida solo queda lo que la propuesta ya declara', () => {
    const draft = proposalToDraft(NUEVA, [], {}); /* sin material: no se puede crear */
    expect(draft.ok).toBe(false);
    expect(creationSummary(NUEVA, draft)).toBe('unilateral');
  });
});
