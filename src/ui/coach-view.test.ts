/**
 * `src/ui/CoachView.tsx`: paridad de la tarjeta de estado y de los chips
 * rápidos con `legacy/js/views-coach.js`.
 *
 * Los tests corren en node (sin DOM), así que aquí NO se monta el componente:
 * lo que hay que vigilar es el DATO, que es lo que se rompe sin darse cuenta —
 * los 6 chips de la v1 con sus prompts literales, iconos que existan de verdad
 * en el catálogo generado (`ui/icons.ts` es un archivo generado), el badge de
 * ms/ok del «Probar», las opciones de un turno (`turnOpts`), que es lo único
 * que manda la pregunta del usuario al modelo, y la unión chip + caja
 * (`chipText`): con la caja vacía el ask literal de siempre y con texto
 * escrito el ask + el contexto rotulado.
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

describe('chips rápidos (v1 `coach:quick`)', () => {
  it('son 6 y las etiquetas no se repiten (son la key de React)', () => {
    expect(QUICK_ACTIONS).toHaveLength(6);
    expect(new Set(QUICK_ACTIONS.map((a) => a.label)).size).toBe(6);
  });

  it('los tres que faltaban llevan el prompt LITERAL de la v1', () => {
    expect(QUICK_ACTIONS.slice(3).map((a) => [a.label, a.ask])).toEqual([
      [
        'Revisar volumen',
        'Revisa mi volumen semanal por grupo muscular y dime qué grupos están descompensados y cómo corregirlo.',
      ],
      [
        'Romper un récord',
        'Elige el ejercicio donde tengo más margen de mejora y dame un plan concreto de 4 semanas para subir mi récord.',
      ],
      [
        'Consejo de recuperación',
        '¿Qué ajustes de recuperación, sueño y alimentación me recomiendas según mi volumen actual de entrenamiento?',
      ],
    ]);
  });

  it('los tres nuevos van a un `chat` (la v1 los mandaba con send())', () => {
    expect(QUICK_ACTIONS.map((a) => a.task)).toEqual([
      'suggest',
      'plan',
      'analyze',
      'chat',
      'chat',
      'chat',
    ]);
  });

  it('todos los iconos existen en el catálogo generado', () => {
    for (const action of QUICK_ACTIONS) {
      expect(ICONS[action.icon], `icono de «${action.label}»`).toBeDefined();
    }
  });

  it('solo el chip de sesión de hoy salta de pestaña (v1: App.router.go)', () => {
    const jumps = QUICK_ACTIONS.filter((a) => a.jump);
    expect(jumps.map((a) => a.label)).toEqual(['Sugerir entreno']);
    expect(jumps[0]?.jump).toEqual({ tab: 'hoy', toast: 'Sesión lista en la pestaña Hoy' });
  });
});

describe('chip con contexto de la caja (`chipText`)', () => {
  it('caja vacía → el chip manda su `ask` EXACTO (paridad con la v1)', () => {
    for (const action of QUICK_ACTIONS) {
      expect(chipText(action.ask, ''), action.label).toBe(action.ask);
      expect(chipText(action.ask, '   \n\t '), action.label).toBe(action.ask);
    }
  });

  it('caja con texto → el `ask` arriba y el contexto debajo, rotulado', () => {
    const ask = 'Genera el entreno de hoy para mí.';
    expect(chipText(ask, 'solo empuje, y nada de press banca')).toBe(
      `${ask}\n\nContexto adicional: solo empuje, y nada de press banca`,
    );
  });

  it('el contexto se recorta (sin espacios ni saltos de sobra) y no se pisa el `ask`', () => {
    expect(chipText('ask literal', '  hola  \n')).toBe('ask literal\n\nContexto adicional: hola');
    /* el ask nunca se toca: los tests de QUICK_ACTIONS siguen viendo el literal */
    expect(chipText('ask literal', 'hola').startsWith('ask literal')).toBe(true);
  });
});

describe('tarjeta de estado (v1 `coach:test`)', () => {
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
  it('el pie dice «Plan local (sin IA)» con el motivo, nunca «Coach IA»', () => {
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

    expect(line.notes).toContain('Plan local (sin IA)');
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

    expect(line.text.startsWith('**Aviso:**')).toBe(true);
    expect(line.text).toContain('no pude usar la IA (RESOURCE_EXHAUSTED: la cuota se agotó)');
    expect(line.text).toContain('planificador de tu dispositivo, no la IA');
    expect(line.text).toContain('Sugerencia genérica de cuerpo completo: aún no hay historial');
    /* «Aplicar» no cambia: el JSON se sigue sacando del texto */
    expect((line.payload as { source: string }).source).toBe('local');
  });

  it('sin key (fallback sin error) el motivo es «sin API key»', () => {
    const line = resultLine('plan', out({ origin: 'local', text: LOCAL_TEXT }), 'g');
    expect(line.notes).toContain('Plan local (sin IA)');
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
