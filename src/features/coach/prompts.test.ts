/**
 * System prompt y peticiones: la semántica de la v1 (JSON en suggest/plan,
 * markdown corto en analyze, 12 mensajes en chat) y la inyección del contexto.
 */
import { describe, expect, it } from 'vitest';

import { AI_EXERCISE_SCHEMA } from '@/domain/ai-exercise';
import {
  boundedHistory,
  CHAT_HISTORY_LIMIT,
  CONSULT_INSTRUCTION,
  CREATION_INSTRUCTION,
  DEFAULT_SYSTEM,
  HISTORY_MODEL_LIMIT,
  HISTORY_USER_LIMIT,
  MEMORY_INSTRUCTION,
  PROMPT_HISTORY_LIMIT,
  buildRequest,
} from './prompts';
import { PLAN_RESPONSE_SCHEMA, SUGGEST_RESPONSE_SCHEMA } from './schema';
import type { ChatMessage } from './types';

describe('DEFAULT_SYSTEM', () => {
  it('recoge las reglas de la v1', () => {
    expect(DEFAULT_SYSTEM).toContain('español');
    expect(DEFAULT_SYSTEM).toContain('nombre exacto');
    expect(DEFAULT_SYSTEM).toContain('equipamiento e inventario');
    expect(DEFAULT_SYSTEM).toContain('sobrecarga progresiva');
    expect(DEFAULT_SYSTEM).toContain('180-240 s');
    expect(DEFAULT_SYSTEM).toContain('90-120 s');
    expect(DEFAULT_SYSTEM).toContain('60-75 s');
    expect(DEFAULT_SYSTEM).toContain('justifica brevemente');
    expect(DEFAULT_SYSTEM).toContain('ÚNICAMENTE el JSON');
    expect(DEFAULT_SYSTEM).toContain('no eres un médico');
  });

  it('ya no exige la lista EN EXCLUSIVA: prefiere la lista y permite proponer nuevos', () => {
    expect(DEFAULT_SYSTEM).not.toContain('EXCLUSIVAMENTE ejercicios');
    expect(DEFAULT_SYSTEM).toContain('Usa preferentemente ejercicios de la lista');
    expect(DEFAULT_SYSTEM).toContain('nombre exacto');
    expect(DEFAULT_SYSTEM).toContain('ejercicios NUEVOS');
    /* el material y los PROHIBIDOS siguen siendo línea a parte */
    expect(DEFAULT_SYSTEM).toContain('PROHIBIDOS');
    expect(DEFAULT_SYSTEM).toContain('grupos musculares del catálogo');
  });
});

describe('MEMORY_INSTRUCTION', () => {
  it('pide el bloque ```memoria al final', () => {
    expect(MEMORY_INSTRUCTION).toContain('```memoria');
    expect(MEMORY_INSTRUCTION).toContain('MEMORIA DEL COACH');
    expect(MEMORY_INSTRUCTION).toContain('no pongas el bloque');
  });
});

describe('CONSULT_INSTRUCTION', () => {
  it('explica el bloque ```consulta con sus campos', () => {
    expect(CONSULT_INSTRUCTION).toContain('```consulta');
    expect(CONSULT_INSTRUCTION).toContain('"ejercicio":"Press banca"');
    expect(CONSULT_INSTRUCTION).toContain('full');
    expect(CONSULT_INSTRUCTION).toContain('reciente');
    expect(CONSULT_INSTRUCTION).toContain('evolucion');
    expect(CONSULT_INSTRUCTION).toContain('YYYY-MM-DD');
    expect(CONSULT_INSTRUCTION).toContain('30');
  });

  it('prohíbe inventar datos y recuerda el HISTORIAL CONSOLIDADO', () => {
    expect(CONSULT_INSTRUCTION).toContain('NUNCA inventes');
    expect(CONSULT_INSTRUCTION).toContain('HISTORIAL CONSOLIDADO');
    expect(CONSULT_INSTRUCTION).toContain('UN bloque');
  });
});

describe('CREATION_INSTRUCTION', () => {
  it('pide el bloque ```crear``` con el esquema compartido y sus campos', () => {
    expect(CREATION_INSTRUCTION).toContain('```crear');
    expect(CREATION_INSTRUCTION).toContain(AI_EXERCISE_SCHEMA);
    expect(CREATION_INSTRUCTION).toContain('"name"');
    expect(CREATION_INSTRUCTION).toContain('"group"');
    expect(CREATION_INSTRUCTION).toContain('"equip"');
    expect(CREATION_INSTRUCTION).toContain('"type"');
    expect(CREATION_INSTRUCTION).toContain('espalda'); /* grupos interpolados del catálogo */
    expect(CREATION_INSTRUCTION).toContain('unilateral');
  });

  it('acota el material, los PROHIBIDOS y recuerda que NADA se crea solo', () => {
    expect(CREATION_INSTRUCTION).toContain('PROHIBIDOS');
    expect(CREATION_INSTRUCTION).toContain('EQUIPAMIENTO');
    expect(CREATION_INSTRUCTION).toContain('nombre exacto');
    expect(CREATION_INSTRUCTION).toContain('NO la crea hasta que el usuario lo confirme');
    expect(CREATION_INSTRUCTION).toContain('no pongas el bloque');
  });
});

describe('buildRequest', () => {
  const context = '=== PERFIL ===\nNombre: Ana';

  it('inyecta el contexto detrás de CONTEXTO DEL USUARIO', () => {
    const req = buildRequest('chat', { context, question: 'hola' });
    expect(req.system).toContain(DEFAULT_SYSTEM);
    expect(req.system).toContain(MEMORY_INSTRUCTION);
    expect(req.system.endsWith(`\n\nCONTEXTO DEL USUARIO:\n${context}`)).toBe(true);
  });

  it('sin contexto no se añade la cabecera', () => {
    const req = buildRequest('chat', { question: 'hola' });
    expect(req.system).not.toContain('CONTEXTO DEL USUARIO');
  });

  it('permite system propio y desactivar la memoria', () => {
    const req = buildRequest('chat', { system: 'System custom', memory: false, question: 'x' });
    expect(req.system.startsWith('System custom')).toBe(true);
    expect(req.system).not.toContain('```memoria');
  });

  it('inyecta CONSULT_INSTRUCTION en chat y analyze, no en suggest/plan', () => {
    expect(buildRequest('chat', { question: 'hola' }).system).toContain(CONSULT_INSTRUCTION);
    expect(buildRequest('analyze', { question: 'hola' }).system).toContain(CONSULT_INSTRUCTION);
    expect(buildRequest('suggest').system).not.toContain(CONSULT_INSTRUCTION);
    expect(buildRequest('plan').system).not.toContain(CONSULT_INSTRUCTION);

    const sinConsulta = buildRequest('chat', { question: 'hola', consult: false }).system;
    expect(sinConsulta).not.toContain(CONSULT_INSTRUCTION);
    expect(sinConsulta).toContain(MEMORY_INSTRUCTION);
  });

  it('inyecta CREATION_INSTRUCTION SOLO en chat (espejo de CONSULT_INSTRUCTION)', () => {
    expect(buildRequest('chat', { question: 'hola' }).system).toContain(CREATION_INSTRUCTION);
    expect(buildRequest('analyze', { question: 'hola' }).system).not.toContain(
      CREATION_INSTRUCTION,
    );
    expect(buildRequest('suggest').system).not.toContain(CREATION_INSTRUCTION);
    expect(buildRequest('plan').system).not.toContain(CREATION_INSTRUCTION);

    const sinCrear = buildRequest('chat', { question: 'hola', create: false }).system;
    expect(sinCrear).not.toContain(CREATION_INSTRUCTION);
    expect(sinCrear).toContain(MEMORY_INSTRUCTION);
    expect(sinCrear).toContain(CONSULT_INSTRUCTION);
  });

  it('suggest pide JSON con el esquema de la respuesta, sin ejemplo en el prompt', () => {
    const req = buildRequest('suggest', {
      context,
      unit: 'lb',
      local: { title: 'Empuje', exercises: [{ name: 'Press de banca' }] },
    });
    expect(req.json).toBe(true);
    expect(req.responseSchema).toBe(SUGGEST_RESPONSE_SCHEMA);
    expect(req.prompt).toContain('la forma exacta la fija el esquema de la respuesta');
    /* el ejemplo JSON de la v1 ya no viaja: la forma vive en `schema.ts` */
    expect(req.prompt).not.toContain('{"title":"titulo corto"');
    expect(req.prompt).toContain('weight en lb');
    expect(req.prompt).toContain('1 bloque de core');
    expect(req.prompt).toContain('Propuesta generada en el dispositivo');
    expect(req.prompt).toContain('Press de banca');
  });

  it('suggest permite inventar SOLO marcando "isNew" con sus atributos', () => {
    const prompt = buildRequest('suggest').prompt;
    expect(prompt).toContain('"isNew":true');
    expect(prompt).toContain('"group", "equip", "type"');
    expect(prompt).toContain('el resto de nombres siguen teniendo que ser de la lista');
  });

  it('plan pide JSON con fechas y reglas de 48 h', () => {
    const req = buildRequest('plan', {
      from: '2026-09-21',
      to: '2026-09-27',
      goal: 'fuerza',
      daysPerWeek: 3,
      local: { days: [] },
    });
    expect(req.json).toBe(true);
    expect(req.responseSchema).toBe(PLAN_RESPONSE_SCHEMA);
    expect(req.prompt).toContain('la forma exacta la fija el esquema de la respuesta');
    expect(req.prompt).not.toContain('{"rationale":"explicación breve');
    expect(req.prompt).toContain('del 2026-09-21 al 2026-09-27');
    expect(req.prompt).toContain('Fuerza');
    expect(req.prompt).toContain('días de entreno deseados: 3');
    expect(req.prompt).toContain('48 h');
    expect(req.prompt).toContain('Base generada en el dispositivo');
  });

  it('plan permite inventar SOLO marcando "isNew" con sus atributos', () => {
    const prompt = buildRequest('plan', { from: '2026-09-21', to: '2026-09-27' }).prompt;
    expect(prompt).toContain('"isNew":true');
    expect(prompt).toContain('"group"/"equip"/"type"');
    expect(prompt).toContain('48 h');
  });

  it('la petición del usuario cierra el prompt EN CRUDO, sin etiqueta', () => {
    const req = buildRequest('suggest', { question: 'solo empuje, nada de press banca' });
    expect(req.json).toBe(true);
    expect(req.prompt.trimEnd().endsWith('solo empuje, nada de press banca')).toBe(true);
    expect(req.prompt).not.toContain('Petición del usuario');
    expect(req.responseSchema).toBe(SUGGEST_RESPONSE_SCHEMA);
    expect(req.prompt).toContain('1 bloque de core');

    const plan = buildRequest('plan', {
      from: '2026-09-21',
      to: '2026-09-27',
      question: '4 días y descanso el viernes',
    });
    expect(plan.json).toBe(true);
    expect(plan.prompt.trimEnd().endsWith('4 días y descanso el viernes')).toBe(true);
    expect(plan.prompt).toContain('del 2026-09-21 al 2026-09-27');
    expect(plan.prompt).toContain('48 h');
  });

  it('la petición es OPCIONAL: sin question (o en blanco) el prompt cierra con las reglas', () => {
    expect(buildRequest('suggest').prompt.endsWith('60-75 s).')).toBe(true);
    const plan = buildRequest('plan', { from: '2026-09-21', to: '2026-09-27' }).prompt;
    expect(plan.endsWith('inventario disponible.')).toBe(true);
    expect(plan).not.toContain('Petición del usuario');
    expect(buildRequest('suggest', { question: '   ' }).prompt.endsWith('60-75 s).')).toBe(true);
  });

  it('analyze pide markdown corto y no JSON', () => {
    const req = buildRequest('analyze', {
      weeks: 6,
      weeklyBrief: '21 sep: 4,2k kg, 3 ses, 36 series',
      question: '¿qué tal la semana?',
    });
    expect(req.json).toBe(false);
    expect(req.responseSchema).toBeUndefined();
    expect(req.prompt).toContain('últimas 6 semanas');
    expect(req.prompt).toContain('400 palabras');
    expect(req.prompt).toContain('21 sep: 4,2k kg');
    expect(req.prompt).toContain('¿qué tal la semana?');
  });

  it('chat manda el mensaje y los últimos 12 del historial', () => {
    const history: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 ? 'model' : 'user',
      text: `mensaje ${i}`,
    }));
    /* mensajes de otros roles (p. ej. system) no viajan: se filtran como en la v1 */
    (history as { role: string; text: string }[]).push({ role: 'system', text: 'esto no cuenta' });

    const req = buildRequest('chat', { question: '¿cómo voy?', history });
    expect(req.json).toBe(false);
    expect(req.responseSchema).toBeUndefined();
    expect(req.prompt).toBe('¿cómo voy?');
    const messages = req.history ?? [];
    expect(messages).toHaveLength(CHAT_HISTORY_LIMIT);
    expect(messages[messages.length - 1].text).toBe('mensaje 19');
    expect(messages.some((message) => message.text === 'esto no cuenta')).toBe(false);
  });

  it('chat sin historial devuelve el campo vacío', () => {
    expect(buildRequest('chat', { question: 'hola' }).history).toEqual([]);
  });
});

/* ---------- P1: el transcript viaja como `contents` en las cuatro tareas ---------- */

describe('historial como contents en suggest/plan/analyze (P1)', () => {
  const RECORDS = 'Encogimientos 43.5kg · Remo con Barra 38.5kg';
  const history: ChatMessage[] = [
    {
      role: 'user',
      text: `Genera el entreno de hoy para mí.\n\nContexto adicional: mis records:\n${RECORDS}`,
    },
    { role: 'model', text: 'Reactivación muscular tras 2 semanas de inactividad.' },
    { role: 'user', text: 'ok, ten en cuenta mis records que te envie anteriormente' },
  ];

  it('suggest y plan lo mandan por `history`, nunca dentro del prompt', () => {
    const sug = buildRequest('suggest', { history, question: 'dame una corta, son las 10' });
    expect(sug.prompt).not.toContain('CONVERSACIÓN PREVIA');
    expect(sug.prompt).not.toContain(RECORDS);
    expect(sug.prompt.trimEnd().endsWith('dame una corta, son las 10')).toBe(true);
    expect(sug.history).toHaveLength(3);
    expect(sug.history?.[0]?.text).toContain(RECORDS);

    const plan = buildRequest('plan', { from: '2026-09-28', to: '2026-10-04', history });
    expect(plan.prompt).not.toContain('CONVERSACIÓN PREVIA');
    expect(plan.prompt).not.toContain(RECORDS);
    expect(plan.history).toHaveLength(3);
  });

  it('analyze igual, y la petición sigue cerrando su prompt sin etiqueta', () => {
    const req = buildRequest('analyze', { weeks: 6, history, question: '¿y los brazos?' });
    expect(req.prompt).not.toContain('CONVERSACIÓN PREVIA');
    expect(req.prompt).not.toContain(RECORDS);
    expect(req.prompt).not.toContain('Petición del usuario');
    expect(req.prompt.trimEnd().endsWith('¿y los brazos?')).toBe(true);
    expect(req.history).toHaveLength(3);
  });

  it('la petición del turno actual NO se duplica en el historial', () => {
    const pregunta = 'dame una corta, son las 10';
    const req = buildRequest('suggest', { history, question: pregunta });
    expect(req.prompt.split(pregunta)).toHaveLength(2); /* solo al final del prompt */
    expect((req.history ?? []).some((m) => m.text.includes(pregunta))).toBe(false);
  });

  it('los roles que no son usuario/coach no viajan', () => {
    const mixto = [...history] as { role: string; text: string }[];
    mixto.push({ role: 'system', text: 'esto no cuenta' });
    const req = buildRequest('suggest', { history: mixto as ChatMessage[], question: 'x' });
    expect(req.history ?? []).toHaveLength(3);
    expect((req.history ?? []).some((m) => m.text === 'esto no cuenta')).toBe(false);
    expect(req.history?.[2]?.text).toContain('ok, ten en cuenta mis records');
  });

  it('acota a PROMPT_HISTORY_LIMIT turnos (el chat, a CHAT_HISTORY_LIMIT)', () => {
    const veinte: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 ? 'model' : 'user',
      text: `mensaje ${i}`,
    }));
    const sug = buildRequest('suggest', { history: veinte });
    expect(sug.history ?? []).toHaveLength(PROMPT_HISTORY_LIMIT);
    expect(sug.history?.[0]?.text).toBe('mensaje 14'); /* los 6 más recientes */
    expect(sug.history?.[PROMPT_HISTORY_LIMIT - 1]?.text).toBe('mensaje 19');
    expect((sug.history ?? []).some((m) => m.text === 'mensaje 0')).toBe(false);

    const chat = buildRequest('chat', { question: 'x', history: veinte });
    expect(chat.history ?? []).toHaveLength(CHAT_HISTORY_LIMIT);
  });

  it('en chat el MISMO historial sigue yendo por `history`, con el prompt intacto', () => {
    const req = buildRequest('chat', { question: '¿cómo voy?', history });
    expect(req.prompt).toBe('¿cómo voy?');
    expect(req.history ?? []).toHaveLength(3);
    expect(req.history?.[0]?.text).toContain('mis records');
  });
});

describe('boundedHistory (presupuesto por turno)', () => {
  it('recorta el turno del usuario a HISTORY_USER_LIMIT y el del modelo a HISTORY_MODEL_LIMIT', () => {
    const [user] = boundedHistory([{ role: 'user', text: 'x'.repeat(5000) }], 4);
    expect(user?.text).toHaveLength(HISTORY_USER_LIMIT);
    expect(user?.text.endsWith('…')).toBe(true);

    const [model] = boundedHistory([{ role: 'model', text: 'y'.repeat(5000) }], 4);
    expect(model?.text).toHaveLength(HISTORY_MODEL_LIMIT);
    expect(model?.text.endsWith('…')).toBe(true);
  });

  it('colapsa los espacios y descarta los turnos vacíos', () => {
    const out = boundedHistory(
      [
        { role: 'user', text: '  hola\n\n  qué tal  ' },
        { role: 'model', text: '   ' },
        { role: 'user', text: '' },
      ],
      4,
    );
    expect(out).toEqual([{ role: 'user', text: 'hola qué tal' }]);
  });

  it('con 0 turnos devuelve vacío (nunca TODO, que sería el famoso slice(-0))', () => {
    expect(boundedHistory([{ role: 'user', text: 'x' }], 0)).toEqual([]);
    expect(boundedHistory(undefined, 6)).toEqual([]);
  });
});
