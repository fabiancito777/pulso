/**
 * `state/coach.ts`: la capa que orquesta el coach IA contra las signals del store.
 *
 * Se prueban con `localStorage` simulado (mismo patrón que `store.test.ts`: el
 * `storageAvailable` se decide AL CARGAR el módulo, así que el stub va antes del
 * import dinámico) y con `generateFn` mockeado, porque lo que hay que verificar
 * aquí es la orquestación: número de llamadas, qué prompt viaja en cada una,
 * que la memoria y las rutinas se PERSISTEN y que una API key vacía ni siquiera
 * llega a la red.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { findExerciseByName } from '@/domain/data';
import { addDays } from '@/domain/dates';
import type { Session } from '@/domain/types';
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

  it('sin apiKey → rechaza con GeminiError auth sin llamar a nadie', async () => {
    store.patchSettings({ ai: { ...store.settings.value.ai, apiKey: '   ' } });
    expect(coach.hasApiKey()).toBe(false);
    const gen = makeGen([res('nunca debería llegar')]);

    const err = await coach
      .runCoachTask('chat', { userText: 'hola' }, { generateFn: gen })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GeminiError);
    expect((err as GeminiError).kind).toBe('auth');
    expect((err as GeminiError).message).toContain('Falta la API key');
    expect(gen).not.toHaveBeenCalled();
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
});

describe('applySuggestionAsRoutine', () => {
  it('crea la rutina con source ia, omite lo que no resuelve y persiste', () => {
    const creada = coach.applySuggestionAsRoutine({
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

  it('inválido → null', () => {
    expect(coach.applySuggestionAsRoutine(null)).toBeNull();
    expect(coach.applySuggestionAsRoutine('un texto')).toBeNull();
    expect(coach.applySuggestionAsRoutine({ title: 'Sin ejercicios' })).toBeNull();
    expect(coach.applySuggestionAsRoutine({ title: 'Vacía', exercises: [] })).toBeNull();
    expect(
      coach.applySuggestionAsRoutine({
        title: 'Nada resuelto',
        exercises: [{ name: 'Ejercicio inventado por el modelo' }],
      }),
    ).toBeNull();
    expect(store.routines.value).toHaveLength(0);
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

    expect(aplicado).toEqual({ days: 7, routines: 6 });
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

  it('un plan sin days no toca ni el calendario ni meta', () => {
    expect(coach.applyWeek(null)).toEqual({ days: 0, routines: 0 });
    expect(coach.applyWeek({ rationale: 'nada' })).toEqual({ days: 0, routines: 0 });
    expect(store.schedule.value).toEqual({});
    expect(store.meta.value.lastPlanAt).toBeNull();
  });
});

describe('hasApiKey', () => {
  it('lee settings.ai.apiKey y recorta los espacios', () => {
    expect(coach.hasApiKey()).toBe(true);
    store.patchSettings({ ai: { ...store.settings.value.ai, apiKey: '  ' } });
    expect(coach.hasApiKey()).toBe(false);
  });
});
