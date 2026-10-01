/**
 * `state/coach.ts`: la capa que orquesta el coach IA contra las signals del store.
 *
 * Se prueban con `localStorage` simulado (mismo patrón que `store.test.ts`: el
 * `storageAvailable` se decide AL CARGAR el módulo, así que el stub va antes del
 * import dinámico) y con `generateFn` mockeado, porque lo que hay que verificar
 * aquí es la orquestación: número de llamadas, qué prompt viaja en cada una,
 * que la memoria y las rutinas se PERSISTEN y que una API key vacía ni siquiera
 * llega a la red.
 *
 * Al final se agregan tres describes con aserciones SUELTAS del store
 * (`setSettingsPath` anidado, `rememberPlateMode` y `setEquipment`): son
 * comprobaciones del auto-test de la v1 que no podían entrar en `store.test.ts`
 * en esta tanda, y este es el fichero que ya manipula el estado fuera del coach.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { findExerciseByName, isAvailable } from '@/domain/data';
import { addDays } from '@/domain/dates';
import type { UnresolvedName } from '@/domain/match';
import type { Exercise, Session } from '@/domain/types';
import { GeminiError } from '@/features/coach/client';
import type { GenOpts, GenResult } from '@/features/coach/client';
import { queryHistory } from '@/features/coach/history';
import type { Routine } from './store';

const mem = new Map<string, string>();

vi.stubGlobal('localStorage', {
  getItem: (key: string): string | null => (mem.has(key) ? (mem.get(key) as string) : null),
  setItem: (key: string, value: string): void => {
    mem.set(key, String(value));
  },
  removeItem: (key: string): void => {
    mem.delete(key);
  },
  clear: (): void => {
    mem.clear();
  },
  key: (index: number): string | null => [...mem.keys()][index] ?? null,
  get length(): number {
    return mem.size;
  },
});

const store = await import('./store');
const coach = await import('./coach');
const create = await import('./exercise-create');

const NOMBRE = 'Press de banca con barra';
const FECHA_SESION = '2026-09-20';
const INICIO_SEMANA = '2026-09-28';

/** Id real del ejercicio del fixture (la biblioteca ya está fusionada al cargar). */
function pressId(): string {
  const found = findExerciseByName(store.exercises.value, NOMBRE);
  if (!found) throw new Error(`el fixture usa un ejercicio inexistente: ${NOMBRE}`);
  return found.id;
}

const persistedRoutines = (): Routine[] => {
  const raw = store.readState().routines;
  return Array.isArray(raw) ? (raw as Routine[]) : [];
};

function seedSessions(list: Session[]): void {
  const state = store.readState();
  state.sessions = list;
  store.writeState(state);
  store.refresh();
}

const SESION: Session = {
  id: 's-coach-1',
  name: 'Empuje A',
  date: FECHA_SESION,
  startedAt: `${FECHA_SESION}T10:00:00.000Z`,
  endedAt: `${FECHA_SESION}T11:00:00.000Z`,
  unit: 'kg',
  entries: [
    {
      exId: 'press-de-banca-con-barra',
      name: NOMBRE,
      group: 'pecho',
      sets: [
        { weight: 80, reps: 6, done: true },
        { weight: 80, reps: 6, done: true },
        { weight: 80, reps: 5, done: true },
      ],
    },
  ],
};

function res(text: string, extra: Partial<GenResult> = {}): GenResult {
  return { text, model: 'mock', ms: 7, ...extra };
}

/** `generate` mockeado: devuelve las respuestas en orden y guarda cada llamada. */
function makeGen(results: GenResult[]) {
  let call = 0;
  return vi.fn((_opts: GenOpts, _fetchFn?: typeof fetch): Promise<GenResult> => {
    const next = results[Math.min(call, results.length - 1)];
    call++;
    return Promise.resolve(next);
  });
}

/** `generate` mockeado que FALLA con el `GeminiError` dado (para el fallback). */
function makeFailing(err: GeminiError) {
  return vi.fn((_opts: GenOpts, _fetchFn?: typeof fetch): Promise<GenResult> =>
    Promise.reject(err),
  );
}

beforeEach(() => {
  mem.clear();
  store.writeState(store.defaultState());
  store.refresh();
  store.patchSettings({ ai: { ...store.settings.value.ai, apiKey: 'test-key' } });
});

describe('runCoachTask', () => {
  it('chat feliz: una sola llamada, texto limpio y ajustes de settings.ai', async () => {
    const gen = makeGen([
      res('Aquí tienes mi respuesta.', {
        finish: 'STOP',
        usage: { prompt: 120, candidates: 30, total: 150 },
        thoughts: 'estoy pensando',
      }),
    ]);

    const out = await coach.runCoachTask('chat', { userText: '¿cómo voy?' }, { generateFn: gen });

    expect(out.text).toBe('Aquí tienes mi respuesta.');
    expect(out.memoryAdded).toEqual([]);
    expect(out.consulted).toEqual([]);
    expect(out.finish).toBe('STOP');
    expect(out.thoughts).toBe('estoy pensando');
    expect(out.usage).toEqual({ prompt: 120, candidates: 30, total: 150 });
    expect(out.ms).toBeGreaterThanOrEqual(0);

    expect(gen).toHaveBeenCalledTimes(1);
    const arg = gen.mock.calls[0]?.[0];
    expect(arg?.apiKey).toBe('test-key');
    expect(arg?.model).toBe('gemini-3.8-flash');
    expect(arg?.json).toBe(false);
    expect(arg?.prompt).toBe('¿cómo voy?');
    expect(arg?.system).toContain('Eres Pulso Coach');
    expect(arg?.system).toContain('CONTEXTO DEL USUARIO');
    expect(arg?.system).toContain('MEMORIA DEL COACH');
    expect(arg?.temperature).toBe(0.7);
    expect(arg?.maxOutputTokens).toBe(4096);
    expect(arg?.thinkingLevel).toBe('low');
    expect(arg?.includeThoughts).toBe(true);
  });

  it('suggest pide JSON y lleva el extra DÍA DE HOY en el contexto', async () => {
    const gen = makeGen([res('{"title":"x","exercises":[]}')]);

    await coach.runCoachTask('suggest', {}, { generateFn: gen });

    const arg = gen.mock.calls[0]?.[0];
    expect(arg?.json).toBe(true);
    expect(arg?.system).toContain('DÍA DE HOY');
    expect(arg?.system).not.toContain('CONSULTA');
  });

  it('bloque ```consulta``` → queryHistory y 2ª llamada con el MISMO system', async () => {
    seedSessions([SESION]);
    const gen = makeGen([
      res(
        'Déjame mirar tu historial.\n' +
          '```consulta\n{"ejercicio":"Press de banca con barra","tipo":"full"}\n```',
      ),
      res('Con esos datos: mantén 80 kg y sube a 82,5 kg la próxima semana.'),
    ]);

    const out = await coach.runCoachTask(
      'chat',
      { userText: '¿cómo voy en press banca?' },
      { generateFn: gen },
    );

    expect(gen).toHaveBeenCalledTimes(2);
    const esperado = queryHistory(
      store.sessions.value,
      { exercise: NOMBRE, kind: 'full' },
      { unit: 'kg', exercises: store.exercises.value },
    );
    const segunda = gen.mock.calls[1]?.[0];
    expect(segunda?.prompt).toContain('DATOS DE LA CONSULTA');
    expect(segunda?.prompt).toContain(esperado);
    expect(segunda?.prompt).toContain('Continúa con tu respuesta.');
    expect(segunda?.prompt).not.toContain('```consulta');
    expect(segunda?.system).toBe(gen.mock.calls[0]?.[0].system);

    const historial = segunda?.history ?? [];
    expect(historial.map((m) => m.role)).toEqual(['user', 'model']);
    expect(historial[0]?.text).toBe('¿cómo voy en press banca?');
    expect(historial[1]?.text).toContain('```consulta');

    expect(out.consulted).toEqual([NOMBRE]);
    expect(out.text).toContain('Con esos datos');
    expect(out.text).not.toContain('```consulta');
  });

  it('bloque ```memoria``` → se persiste en settings.ai.memory y sale del texto', async () => {
    const gen = makeGen([
      res('Te lo digo claro.\n\n```memoria\n- Prefiere entrenar por la mañana\n```'),
    ]);

    const out = await coach.runCoachTask('chat', { userText: 'hola' }, { generateFn: gen });

    expect(out.text).toBe('Te lo digo claro.');
    expect(out.text).not.toContain('```memoria');
    expect(out.memoryAdded).toHaveLength(1);
    expect(out.memoryAdded[0]).toContain('Prefiere entrenar por la mañana');

    expect(store.settings.value.ai.memory).toContain('Prefiere entrenar por la mañana');
    expect(store.readState().settings.ai.memory).toContain('Prefiere entrenar por la mañana');
    expect(out.consulted).toEqual([]);
  });

  it('sin apiKey → chat y analyze: aviso amable, SIN lanzar y sin llamar a nadie', async () => {
    store.patchSettings({ ai: { ...store.settings.value.ai, apiKey: '   ' } });
    expect(coach.hasApiKey()).toBe(false);
    const gen = makeGen([res('nunca debería llegar')]);

    const chat = await coach.runCoachTask('chat', { userText: 'hola' }, { generateFn: gen });
    const analyze = await coach.runCoachTask(
      'analyze',
      { userText: '¿cómo voy?' },
      { generateFn: gen },
    );

    for (const out of [chat, analyze]) {
      expect(out.text).toContain('API key');
      expect(out.text).toContain('Ajustes');
      expect(out.payload).toBeUndefined();
      expect(out.memoryAdded).toEqual([]);
      expect(out.consulted).toEqual([]);
      expect(out.ms).toBeGreaterThanOrEqual(0);
    }
    expect(gen).not.toHaveBeenCalled();
  });

  it('sin apiKey → suggest y plan se resuelven en el dispositivo con payload aplicable', async () => {
    store.patchSettings({ ai: { ...store.settings.value.ai, apiKey: '' } });
    const gen = makeGen([res('{"title":"nunca","exercises":[]}')]);

    const sug = await coach.runCoachTask('suggest', {}, { generateFn: gen });
    expect(gen).not.toHaveBeenCalled();
    expect(sug.payload).toBeTruthy();
    const payloadSug = sug.payload as Record<string, unknown>;
    expect(payloadSug.source).toBe('local');
    expect(Array.isArray(payloadSug.exercises)).toBe(true);
    expect((payloadSug.exercises as unknown[]).length).toBeGreaterThan(0);
    expect(sug.text).toContain('```json');
    expect(sug.text).toContain(payloadSug.title as string);

    /* el mismo payload que ve la vista es el que se aplica */
    const { routine: creada, unresolved } = coach.applySuggestionAsRoutine(sug.payload);
    expect(unresolved).toEqual([]);
    expect(creada).not.toBeNull();
    expect(creada?.source).toBe('generador'); /* 'local' se guarda como 'generador' (v1) */
    expect(creada?.items.length).toBeGreaterThan(0);

    const plan = await coach.runCoachTask('plan', {}, { generateFn: gen });
    expect(gen).not.toHaveBeenCalled();
    const payloadPlan = plan.payload as { source: string; days: unknown[]; from: string };
    expect(payloadPlan.source).toBe('local');
    expect(payloadPlan.days).toHaveLength(7);
    expect(payloadPlan.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const aplicado = coach.applyWeek(plan.payload);
    expect(aplicado.days).toBe(7);
    expect(aplicado.routines).toBeGreaterThan(0);
    expect(aplicado.unresolved).toEqual([]);
    expect(store.meta.value.lastPlanAt).toEqual(expect.any(String));
  });

  it('con apiKey → suggest sigue yendo a la IA y el payload sale de su respuesta', async () => {
    const gen = makeGen([
      res(
        '{"title":"Propuesta IA","focus":"Pecho","rationale":["por cierto"],' +
          '"exercises":[{"name":"Press de banca con barra","sets":4,"repMin":6,"repMax":8,' +
          '"weight":80,"rest":180,"notes":""}]}',
      ),
    ]);

    const out = await coach.runCoachTask('suggest', {}, { generateFn: gen });

    expect(gen).toHaveBeenCalledTimes(1);
    expect((out.payload as { title: string }).title).toBe('Propuesta IA');
    expect(out.text).toBe(
      '{"title":"Propuesta IA","focus":"Pecho","rationale":["por cierto"],' +
        '"exercises":[{"name":"Press de banca con barra","sets":4,"repMin":6,"repMax":8,' +
        '"weight":80,"rest":180,"notes":""}]}',
    );
  });

  it('con apiKey pero fallo de auth/red/cuota en suggest → plan local, sin lanzar', async () => {
    for (const kind of ['auth', 'network', 'quota'] as const) {
      const gen = makeFailing(new GeminiError(kind, `se cayó ${kind}`));
      const out = await coach.runCoachTask('suggest', {}, { generateFn: gen });

      expect(gen).toHaveBeenCalledTimes(1);
      expect((out.payload as { source: string }).source).toBe('local');
      expect(out.text).toContain('IA no disponible');
      expect(out.text).toContain('```json');
    }
  });

  it('con apiKey y un fallo que no compensa disfrazar → se propaga como antes', async () => {
    const blocked = makeFailing(new GeminiError('blocked', 'respuesta bloqueada'));
    await expect(coach.runCoachTask('suggest', {}, { generateFn: blocked })).rejects.toBeInstanceOf(
      GeminiError,
    );

    const sinRed = makeFailing(new GeminiError('network', 'sin conexión'));
    await expect(
      coach.runCoachTask('chat', { userText: 'hola' }, { generateFn: sinRed }),
    ).rejects.toBeInstanceOf(GeminiError);
  });

  it('consultRounds: 0 → ni una segunda llamada y el bloque sale del texto', async () => {
    seedSessions([SESION]);
    const gen = makeGen([
      res('Miro tu historial.\n```consulta\n{"ejercicio":"Press de banca con barra"}\n```'),
    ]);

    const out = await coach.runCoachTask(
      'chat',
      { userText: '¿tal?', consultRounds: 0 },
      { generateFn: gen },
    );

    expect(gen).toHaveBeenCalledTimes(1);
    expect(out.consulted).toEqual([]);
    expect(out.text).toBe('Miro tu historial.');
    expect(out.text).not.toContain('```consulta');
  });

  it('una consulta ilegible se ignora y no rompe la tarea', async () => {
    const gen = makeGen([res('```consulta\nesto no es json\n```\nRespuesta final.')]);

    const out = await coach.runCoachTask('chat', { userText: 'hola' }, { generateFn: gen });

    expect(gen).toHaveBeenCalledTimes(1);
    expect(out.consulted).toEqual([]);
    expect(out.text).toContain('Respuesta final.');
    expect(out.text).not.toContain('```consulta');
  });

  it('bloque ```crear``` → out.creations con la propuesta y el bloque sale del texto', async () => {
    const gen = makeGen([
      res(
        'Te propongo uno nuevo.\n\n```crear\n[{"name":"Remo Kroc a una mano",' +
          '"group":"espalda","equip":"mancuernas_fijas","type":"compuesto","sets":3,' +
          '"rest":120,"repMin":8,"repMax":12,"unilateral":true,"desc":"Con apoyo en banco."}]\n```',
      ),
    ]);

    const out = await coach.runCoachTask('chat', { userText: 'inventa' }, { generateFn: gen });

    expect(out.creations).toEqual([
      {
        name: 'Remo Kroc a una mano',
        group: 'espalda',
        equip: 'mancuernas_fijas',
        type: 'compuesto',
        sets: 3,
        rest: 120,
        repMin: 8,
        repMax: 12,
        unilateral: true,
        desc: 'Con apoyo en banco.',
      },
    ]);
    expect(out.text).toContain('Te propongo uno nuevo.');
    expect(out.text).not.toContain('```crear');
    expect(out.payload).toBeUndefined();
  });

  it('sin bloque ```crear``` → creations vacías (y también sin key ni en el local)', async () => {
    const gen = makeGen([res('Aquí no propongo nada nuevo.')]);
    const out = await coach.runCoachTask('chat', { userText: 'hola' }, { generateFn: gen });
    expect(out.creations).toEqual([]);

    store.patchSettings({ ai: { ...store.settings.value.ai, apiKey: '' } });
    const local = await coach.runCoachTask('suggest', {}, { generateFn: gen });
    expect(local.creations).toEqual([]);
    expect(gen).toHaveBeenCalledTimes(1);
  });
});

describe('applySuggestionAsRoutine', () => {
  it('crea la rutina con source ia, reporta lo que no resuelve y persiste', () => {
    const { routine: creada, unresolved } = coach.applySuggestionAsRoutine({
      title: 'Empuje del coach',
      focus: 'Pecho y tríceps',
      source: 'ia',
      notes: 'Sesión de hoy',
      rationale: ['Basado en tu historial', 'Días suficientes de descanso'],
      exercises: [
        {
          name: NOMBRE,
          sets: 4,
          repMin: 6,
          repMax: 8,
          weight: 80,
          rest: 180,
          notes: 'Baja controlado',
        },
        { name: 'Ejercicio inventado por el modelo', sets: 3 },
      ],
    });

    /* LO QUE ANTES DESAPARECÍA SIN DECIR NADA: ahora vuelve con nombre y razón */
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.name).toBe('Ejercicio inventado por el modelo');
    expect(unresolved[0]?.reason).toBe('no está en tu biblioteca');

    expect(creada).not.toBeNull();
    expect(creada?.name).toBe('Empuje del coach');
    expect(creada?.focus).toBe('Pecho y tríceps');
    expect(creada?.source).toBe('ia');
    expect(creada?.notes).toBe(
      'Sesión de hoy | Basado en tu historial Días suficientes de descanso',
    );
    expect(creada?.items).toHaveLength(1);
    expect(creada?.items[0]).toEqual({
      exId: pressId(),
      sets: 4,
      repMin: 6,
      repMax: 8,
      rest: 180,
      weight: 80,
      notes: 'Baja controlado',
    });

    const ids = store.routines.value.map((r) => r.id);
    expect(ids).toContain(creada?.id);
    expect(persistedRoutines().map((r) => r.id)).toContain(creada?.id);
  });

  it('inválido → sin rutina', () => {
    expect(coach.applySuggestionAsRoutine(null).routine).toBeNull();
    expect(coach.applySuggestionAsRoutine('un texto').routine).toBeNull();
    expect(coach.applySuggestionAsRoutine({ title: 'Sin ejercicios' }).routine).toBeNull();
    expect(coach.applySuggestionAsRoutine({ title: 'Vacía', exercises: [] }).routine).toBeNull();
    expect(
      coach.applySuggestionAsRoutine({
        title: 'Nada resuelto',
        exercises: [{ name: 'Ejercicio inventado por el modelo' }],
      }).routine,
    ).toBeNull();
    expect(store.routines.value).toHaveLength(0);
  });

  it('un conflicto de atributos NO matchea: el motivo viaja en unresolved', () => {
    /* «… con barra inclinado» existe en la biblioteca SIN la inclinación: con el
       umbral viejo (0,6) se reescribía y se perdía «inclinado» (spec §3.1). */
    const { routine, unresolved } = coach.applySuggestionAsRoutine({
      title: 'Inclinado',
      exercises: [{ name: 'Press de banca con barra inclinado', sets: 3 }],
    });

    expect(routine).toBeNull();
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.name).toBe('Press de banca con barra inclinado');
    expect(unresolved[0]?.reason).toContain('no cumple');
    expect(unresolved[0]?.reason).toContain('inclinado');
    expect(unresolved[0]?.candidate?.name).toBe(NOMBRE);
    expect(store.routines.value).toHaveLength(0);
  });

  it('un nombre exacto sí se asocia y no queda nada sin resolver', () => {
    const { routine, unresolved } = coach.applySuggestionAsRoutine({
      title: 'Casi exacto',
      exercises: [{ name: 'Press de banca con barra', sets: 3 }],
    });
    expect(unresolved).toEqual([]);
    expect(routine?.items).toHaveLength(1);
    expect(routine?.items[0]?.exId).toBe(pressId());
  });
});

describe('applyWeek', () => {
  it('escribe los 7 días, crea rutina por día de entreno y marca lastPlanAt', () => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(INICIO_SEMANA, i);
      const descanso = i === 6;
      return {
        date,
        type: descanso ? 'descanso' : 'entreno',
        title: descanso ? 'Descanso' : `Empuje ${i + 1}`,
        focus: descanso ? '' : 'Pecho',
        exercises: descanso
          ? []
          : [{ name: NOMBRE, sets: 4, repMin: 6, repMax: 8, weight: 80, rest: 180, notes: '' }],
      };
    });

    const aplicado = coach.applyWeek({
      source: 'ia',
      rationale: 'Reparto con 48 h entre grupos',
      days,
    });

    expect(aplicado).toEqual({ days: 7, routines: 6, unresolved: [] });
    expect(Object.keys(store.schedule.value).sort()).toEqual(
      Array.from({ length: 7 }, (_, i) => addDays(INICIO_SEMANA, i)),
    );

    expect(store.schedule.value[INICIO_SEMANA]).toMatchObject({
      status: 'planned',
      type: 'entreno',
      title: 'Empuje 1',
      focus: 'Pecho',
      source: 'ia',
    });
    const descanso = addDays(INICIO_SEMANA, 6);
    expect(store.schedule.value[descanso]).toMatchObject({
      status: 'rest',
      type: 'descanso',
      title: 'Descanso',
    });
    expect(store.schedule.value[descanso]?.routineId).toBeUndefined();

    expect(store.routines.value).toHaveLength(6);
    expect(store.routines.value[0]?.source).toBe('ia');
    expect(store.routines.value[0]?.name).toContain('Empuje 1 ·');
    expect(store.routines.value[0]?.items[0]).toMatchObject({ exId: pressId(), sets: 4 });
    expect(store.schedule.value[INICIO_SEMANA]?.routineId).toBe(store.routines.value[0]?.id);
    expect(persistedRoutines()).toHaveLength(6);

    expect(store.meta.value.lastPlanAt).toEqual(expect.any(String));
    expect((store.readState().meta as Record<string, unknown>).lastPlanAt).toEqual(
      expect.any(String),
    );
  });

  it('lo que no resuelve se acumula en unresolved y no crea rutina vacía', () => {
    const aplicado = coach.applyWeek({
      source: 'ia',
      days: [
        {
          date: INICIO_SEMANA,
          type: 'entreno',
          title: 'Empuje',
          focus: 'Pecho',
          exercises: [
            { name: NOMBRE, sets: 4, repMin: 6, repMax: 8, weight: 80, rest: 180, notes: '' },
            { name: 'Press de banca con barra inclinado', sets: 3 },
          ],
        },
        {
          date: addDays(INICIO_SEMANA, 1),
          type: 'entreno',
          title: 'Tirón',
          focus: 'Espalda',
          exercises: [{ name: 'Kroc Row unilateral con mancuerna', sets: 3 }],
        },
      ],
    });

    expect(aplicado.days).toBe(2);
    /* solo el día 1 queda con rutina: el día 2 NO tenía ni un ejercicio reconocible */
    expect(aplicado.routines).toBe(1);
    expect(aplicado.unresolved.map((u) => u.name)).toEqual([
      'Press de banca con barra inclinado',
      'Kroc Row unilateral con mancuerna',
    ]);
    expect(aplicado.unresolved[0]?.reason).toContain('inclinado');
    expect(aplicado.unresolved[1]?.reason).toBe('no está en tu biblioteca');
    expect(store.schedule.value[addDays(INICIO_SEMANA, 1)]?.routineId).toBeUndefined();
  });

  it('un plan sin days no toca ni el calendario ni meta', () => {
    expect(coach.applyWeek(null)).toEqual({ days: 0, routines: 0, unresolved: [] });
    expect(coach.applyWeek({ rationale: 'nada' })).toEqual({
      days: 0,
      routines: 0,
      unresolved: [],
    });
    expect(store.schedule.value).toEqual({});
    expect(store.meta.value.lastPlanAt).toBeNull();
  });
});

describe('partitionUnresolved', () => {
  const PAYLOAD = {
    title: 'Empuje con uno nuevo',
    exercises: [
      { name: NOMBRE, sets: 4 },
      {
        name: 'Kroc Row unilateral con mancuerna',
        isNew: true,
        group: 'espalda',
        equip: 'mancuernas_ajustables',
        type: 'compuesto',
        sets: 3,
        rest: 150,
      },
      { name: 'Press de banca con barra inclinado', sets: 3 },
    ],
  };

  it('separa lo creable («no está en tu biblioteca») de lo vetado (conflicto)', () => {
    const unresolved: UnresolvedName[] = [
      { name: 'Kroc Row unilateral con mancuerna', reason: coach.CREABLE_REASON },
      {
        name: 'Press de banca con barra inclinado',
        reason: '«Press de banca con barra» no cumple: inclinado',
        candidate: { id: 'press-de-banca-con-barra', name: NOMBRE },
      },
      { name: 'Remo que nadie conoce', reason: coach.CREABLE_REASON },
    ];

    const { creatable, warnings } = coach.partitionUnresolved(unresolved, PAYLOAD);

    expect(creatable.map((item) => item.name)).toEqual([
      'Kroc Row unilateral con mancuerna',
      'Remo que nadie conoce',
    ]);
    expect(warnings).toEqual([
      {
        name: 'Press de banca con barra inclinado',
        reason: '«Press de banca con barra» no cumple: inclinado',
        candidate: { id: 'press-de-banca-con-barra', name: NOMBRE },
      },
    ]);

    /* los atributos salen del MISMO payload, no se inventan */
    expect(creatable[0]).toEqual({
      name: 'Kroc Row unilateral con mancuerna',
      group: 'espalda',
      equip: 'mancuernas_ajustables',
      type: 'compuesto',
      sets: 3,
      rest: 150,
    });
    /* y un nombre sin atributos en el payload sigue siendo creable (solo el
       nombre: `proposalToDraft` infiere el resto) */
    expect(creatable[1]).toEqual({ name: 'Remo que nadie conoce' });
  });

  it('sin payload o sin unresolved devuelve lo mínimo', () => {
    expect(coach.partitionUnresolved([], PAYLOAD)).toEqual({ creatable: [], warnings: [] });
    expect(coach.partitionUnresolved([{ name: 'X', reason: coach.CREABLE_REASON }], null)).toEqual({
      creatable: [{ name: 'X' }],
      warnings: [],
    });
  });

  it('un mismo nombre repetido (dos días) es UNA sola tarjeta', () => {
    const { creatable, warnings } = coach.partitionUnresolved(
      [
        { name: 'Remo que nadie conoce', reason: coach.CREABLE_REASON },
        { name: 'remo que nadie conoce', reason: coach.CREABLE_REASON },
      ],
      null,
    );
    expect(creatable).toEqual([{ name: 'Remo que nadie conoce' }]);
    expect(warnings).toEqual([]);
  });

  it('e2e: aplicar → crear → volver a aplicar ya resuelve el exId nuevo', () => {
    const payload = { title: 'Nuevo', exercises: [{ name: 'Kroc Row unilateral con mancuerna' }] };

    /* 1 · aplicar ANTES de crear: el nombre no resuelve (es lo que hoy era
       solo un aviso «sin usar») */
    const primero = coach.applySuggestionAsRoutine(payload);
    expect(primero.routine).toBeNull();
    expect(primero.unresolved).toHaveLength(1);
    expect(primero.unresolved[0]?.reason).toBe('no está en tu biblioteca');

    /* 2 · la partición lo ofrece como creable, nunca como veto */
    const { creatable, warnings } = coach.partitionUnresolved(primero.unresolved, payload);
    expect(warnings).toEqual([]);
    expect(creatable).toHaveLength(1);

    /* 3 · crearlo (el clic de la tarjeta) y volver a aplicar */
    const result = create.createExerciseFromAI({
      ...creatable[0],
      group: 'espalda',
      equip: 'mancuernas_ajustables',
      type: 'compuesto',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const segundo = coach.applySuggestionAsRoutine(payload);
    expect(segundo.unresolved).toEqual([]);
    expect(segundo.routine?.items).toHaveLength(1);
    expect(segundo.routine?.items[0]?.exId).toBe(result.exercise.id);
  });
});

describe('hasApiKey', () => {
  it('lee settings.ai.apiKey y recorta los espacios', () => {
    expect(coach.hasApiKey()).toBe(true);
    store.patchSettings({ ai: { ...store.settings.value.ai, apiKey: '  ' } });
    expect(coach.hasApiKey()).toBe(false);
  });
});

/* ---------- ajustes: lo que el auto-test de la v1 hacía con `A.setSettingPath` ----------
   Están aquí (y no en `store.test.ts`, que lleva otro agente) porque son aserciones
   sueltas sobre exports ya existentes del store y este fichero ya manipula
   `settings` fuera de su ámbito de coach. */

describe('ajustes anidados (v1: `setSettingsPath`)', () => {
  it('escribe rutas anidadas sin pisar el resto del objeto y lo persiste', () => {
    const model = store.settings.value.ai.model;

    store.setSettingsPath('bars.olimpica', 20);
    store.setSettingsPath('ai.temperature', 0.7);

    expect(store.settings.value.bars.olimpica).toBe(20);
    expect(store.settings.value.bars.ez).toBe(0);
    expect(store.settings.value.ai.temperature).toBe(0.7);
    expect(store.settings.value.ai.model).toBe(model);
    expect(store.settings.value.ai.apiKey).toBe('test-key');

    /* escrito de verdad en `pulso.state` (lectura-modificación-escritura) */
    store.refresh();
    expect(store.settings.value.bars.olimpica).toBe(20);
    expect(store.settings.value.ai.temperature).toBe(0.7);
    expect(store.settings.value.ai.model).toBe(model);
  });

  it('una ruta vacía no rompe ni borra nada', () => {
    store.setSettingsPath('', 1);
    store.setSettingsPath('.temperature', 1);
    expect(store.settings.value.ai.temperature).toBe(0.7);
  });
});

describe('discos: el modo se recuerda por ejercicio (v1 `T.setPlateMode`)', () => {
  it('guarda el modo elegido para ESE ejercicio y lo deja tras refresh()', () => {
    store.rememberPlateMode('press-de-banca-con-barra', 'db2');

    expect(store.settings.value.plateModes['press-de-banca-con-barra']).toBe('db2');
    expect(store.settings.value.plateModes['remo-con-mancuerna-a-una-mano']).toBeUndefined();

    store.refresh();
    expect(store.settings.value.plateModes['press-de-banca-con-barra']).toBe('db2');
  });
});

describe('material (v1: «equipo: detecta material faltante» / «disponible al activarlo»)', () => {
  it('apagar y encender el material cambia la disponibilidad y se persiste', () => {
    const press = store.exercises.value.find(
      (e) => e.id === 'press-de-banca-con-barra',
    ) as Exercise;
    expect(press).toBeDefined();

    store.setEquipment('barra_olimpica', false);
    store.setEquipment('banco_plano', false);
    store.setEquipment('banco_inclinable', false);
    expect(isAvailable(press, store.equipment.value)).toBe(false);

    store.setEquipment('barra_olimpica', true);
    store.setEquipment('banco_plano', true);
    expect(isAvailable(press, store.equipment.value)).toBe(true);

    store.refresh();
    expect(store.equipment.value.barra_olimpica).toBe(true);
    expect(store.equipment.value.banco_plano).toBe(true);
    expect(store.equipment.value.banco_inclinable).toBe(false);
  });
});
