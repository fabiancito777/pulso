/**
 * Setters del store que la v1 maneja en `legacy/js/store.js`: rutinas y `state.meta`.
 *
 * Se prueban con `localStorage` simulado porque lo que hay que verificar es que la
 * escritura es de verdad lectura-modificación-escritura (si no, una pestaña con la
 * v1 abierta perdería lo que escribas aquí).
 *
 * Ojo: `storageAvailable` se decide AL CARGAR el módulo, así que el localStorage
 * simulado tiene que estar montado antes del import — por eso el import es dinámico.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { emptyDraft, toExercise } from '@/domain/exercise-draft';
import type { Exercise, Session } from '@/domain/types';
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

const persistedRoutines = (): Routine[] => {
  const raw = store.readState().routines;
  return Array.isArray(raw) ? (raw as Routine[]) : [];
};

beforeEach(() => {
  mem.clear();
  store.writeState(store.defaultState());
  store.refresh();
});

describe('rutinas', () => {
  it('addRoutine genera el id, normaliza los items y persiste', () => {
    const creada = store.addRoutine({
      name: 'Empuje A',
      items: [{ exId: 'press-banca' }, { exId: 'sentadilla', sets: 5, weight: 60 }],
    });
    expect(creada.id).toMatch(/^rt_/);
    expect(creada).toMatchObject({ name: 'Empuje A', focus: '', source: 'manual' });
    expect(creada.items).toEqual([
      { exId: 'press-banca', sets: 3, repMin: 8, repMax: 12, rest: 90, weight: null, notes: '' },
      { exId: 'sentadilla', sets: 5, repMin: 8, repMax: 12, rest: 90, weight: 60, notes: '' },
    ]);
    expect(store.routines.value.map((r) => r.id)).toContain(creada.id);
    expect(persistedRoutines().map((r) => r.id)).toContain(creada.id);
  });

  it('addRoutine respeta el id que traiga (así el coach puede nombrar su plan)', () => {
    const propia = store.addRoutine({ id: 'rt-coach-1', name: 'Piernas', items: [] });
    expect(propia.id).toBe('rt-coach-1');
    expect(store.findRoutine('rt-coach-1')?.name).toBe('Piernas');
  });

  it('updateRoutine parchea, conserva el id y devuelve null si no existe', () => {
    const creada = store.addRoutine({ name: 'A', items: [{ exId: 'press-banca' }] });
    expect(store.updateRoutine('rt_inexistente', { name: 'Nada' })).toBeNull();
    const parcheada = store.updateRoutine(creada.id, { name: 'B', focus: 'fuerza' });
    expect(parcheada).toMatchObject({ id: creada.id, name: 'B', focus: 'fuerza' });
    expect(store.findRoutine(creada.id)?.name).toBe('B');
    expect(persistedRoutines().find((r) => r.id === creada.id)?.name).toBe('B');
  });

  it('removeRoutine borra y desatasca el calendario (conserva el día)', () => {
    const creada = store.addRoutine({ name: 'A', items: [] });
    const otra = store.addRoutine({ name: 'B', items: [] });
    store.setDay('2026-09-27', { status: 'planned', routineId: creada.id });
    store.setDay('2026-09-28', { status: 'planned', routineId: otra.id });

    store.removeRoutine(creada.id);

    expect(store.findRoutine(creada.id)).toBeNull();
    expect(store.findRoutine(otra.id)).not.toBeNull();
    expect(store.schedule.value['2026-09-27']).toMatchObject({ status: 'planned' });
    expect(store.schedule.value['2026-09-27']?.routineId).toBeUndefined();
    expect(store.schedule.value['2026-09-28']?.routineId).toBe(otra.id);
    expect(persistedRoutines().map((r) => r.id)).toEqual([otra.id]);
  });
});

describe('meta', () => {
  it('arranca con las claves de la v1', () => {
    expect(store.meta.value).toEqual({ onboarded: false, lastPlanAt: null, lastAiAt: null });
  });

  it('setMeta mezcla claves en state.meta y sobrevive a refresh()', () => {
    store.setMeta({ onboarded: true, lastPlanAt: '2026-09-27T10:00:00.000Z' });
    expect(store.meta.value.onboarded).toBe(true);
    const persisted = store.readState().meta as Record<string, unknown>;
    expect(persisted.onboarded).toBe(true);

    store.refresh();
    expect(store.meta.value.onboarded).toBe(true);
    expect(store.meta.value.lastPlanAt).toBe('2026-09-27T10:00:00.000Z');
    expect(store.meta.value.lastAiAt).toBeNull();
  });

  it('no pisa las claves que no vienen en el patch', () => {
    store.setMeta({ lastAiAt: '2026-09-27T11:00:00.000Z' });
    store.setMeta({ onboarded: true });
    expect(store.meta.value.lastAiAt).toBe('2026-09-27T11:00:00.000Z');
    expect(store.meta.value.onboarded).toBe(true);
  });
});

/* ---------- ejercicios propios (Ajustes → Ejercicios) ---------- */

const persistedExercises = (): Exercise[] => {
  const raw = store.readState().exercises;
  return Array.isArray(raw) ? (raw as Exercise[]) : [];
};

const persistedSessions = (): Session[] => {
  const raw = store.readState().sessions;
  return Array.isArray(raw) ? raw : [];
};

/** Registro listo para `saveExercise`, igual que lo devuelve el editor. */
function nuevo(name: string, over: Partial<Exercise> = {}): Exercise {
  const taken = store.exercises.value.map((e) => e.id);
  const built = toExercise({ ...emptyDraft(), name, equip: 'polea' }, { taken });
  if (!built.ok) throw new Error(built.error);
  return { ...built.value, ...over };
}

describe('ejercicios propios', () => {
  it('saveExercise crea el propio con id de slug y lo persiste', () => {
    const guardado = store.saveExercise(nuevo('Remo en polea alta'));

    expect(guardado.id).toBe('remo-en-polea-alta');
    expect(guardado).toMatchObject({ custom: true, bw: false, tags: [], tips: '' });
    expect(store.exercises.value.filter((e) => e.id === guardado.id)).toHaveLength(1);
    expect(persistedExercises().find((e) => e.id === guardado.id)).toMatchObject({
      name: 'Remo en polea alta',
      custom: true,
    });
  });

  it('si el slug ya está cogido genera otro id en vez de pisar el primero', () => {
    const primera = store.saveExercise(nuevo('Remo en polea alta'));
    const otra = store.saveExercise(nuevo('Remo en polea alta'));

    expect(primera.id).toBe('remo-en-polea-alta');
    expect(otra.id).not.toBe(primera.id);
    expect(otra.id.startsWith('ex_')).toBe(true);
    expect(store.exercises.value.filter((e) => e.id === primera.id)).toHaveLength(1);
    expect(store.exercises.value.filter((e) => e.id === otra.id)).toHaveLength(1);
  });

  it('editar conserva id y custom aunque cambie el nombre (lo referencian rutinas y sesiones)', () => {
    const creada = store.saveExercise(nuevo('Curl de bíceps'));
    const editada = store.saveExercise({
      ...creada,
      name: 'Curl de bíceps con barra',
      sets: 5,
      rest: 60,
    });

    expect(editada.id).toBe(creada.id);
    expect(editada.custom).toBe(true);
    expect(store.exercises.value.filter((e) => e.id === creada.id)).toHaveLength(1);
    expect(store.exercises.value.find((e) => e.id === creada.id)).toMatchObject({
      name: 'Curl de bíceps con barra',
      sets: 5,
      rest: 60,
    });
    expect(persistedExercises().find((e) => e.id === creada.id)?.name).toBe(
      'Curl de bíceps con barra',
    );
  });

  it('el catálogo no se edita en disco: la semilla lo restaura en refresh()', () => {
    const semilla = store.exercises.value.find((e) => !e.custom && e.allowed);
    expect(semilla).toBeDefined();
    if (!semilla) return;

    store.saveExercise({ ...semilla, name: 'Nombre inventado' });
    expect(store.exercises.value.find((e) => e.id === semilla.id)?.name).toBe('Nombre inventado');
    /* `state.exercises` solo guarda propios y prohibidos: los de la semilla
       permitidos no persisten, así que al recargar vuelve el de fábrica */
    expect(persistedExercises().some((e) => e.id === semilla.id)).toBe(false);
    store.refresh();
    expect(store.exercises.value.find((e) => e.id === semilla.id)?.name).toBe(semilla.name);
  });

  it('removeExercise: false con el catálogo o un id desconocido, true con un propio', () => {
    const semilla = store.exercises.value.find((e) => !e.custom);
    expect(semilla).toBeDefined();
    if (!semilla) return;
    expect(store.removeExercise(semilla.id)).toBe(false);
    expect(store.removeExercise('no-existe')).toBe(false);
    expect(store.exercises.value.some((e) => e.id === semilla.id)).toBe(true);

    const creada = store.saveExercise(nuevo('Prensa a un pie'));
    expect(store.removeExercise(creada.id)).toBe(true);
    expect(store.exercises.value.some((e) => e.id === creada.id)).toBe(false);
    expect(persistedExercises().some((e) => e.id === creada.id)).toBe(false);
  });
});

/* ---------- datos de ejemplo ---------- */

function realSession(id: string): Session {
  return {
    id,
    date: '2026-09-01',
    startedAt: '2026-09-01T18:00:00.000Z',
    unit: 'kg',
    entries: [],
  };
}

describe('datos de ejemplo', () => {
  it('demoData apila sesiones marcadas y la segunda llamada NO deduplica', () => {
    const primera = store.demoData(2);
    expect(primera).toBeGreaterThan(0);
    expect(store.sessions.value).toHaveLength(primera);
    expect(store.sessions.value.every((s) => s.demo === true)).toBe(true);

    const segunda = store.demoData(2);
    expect(segunda).toBe(primera);
    expect(store.sessions.value).toHaveLength(primera + segunda);
    expect(persistedSessions()).toHaveLength(primera + segunda);
  });

  it('las sesiones de ejemplo se guardan con la unidad de los ajustes', () => {
    store.setSettingsPath('units', 'lb');
    expect(store.demoData(1)).toBeGreaterThan(0);
    expect(store.sessions.value.every((s) => s.unit === 'lb')).toBe(true);
    expect(store.readState().settings.units).toBe('lb');
  });

  it('clearDemo se queda solo con las reales y devuelve lo quitado', () => {
    store.appendSessions([realSession('s_real')]);
    const n = store.demoData(2);
    expect(n).toBeGreaterThan(0);
    expect(store.sessions.value).toHaveLength(n + 1);

    expect(store.clearDemo()).toBe(n);
    expect(store.sessions.value.map((s) => s.id)).toEqual(['s_real']);
    expect(persistedSessions().map((s) => s.id)).toEqual(['s_real']);
    /* sin ejemplo que quitar → 0 */
    expect(store.clearDemo()).toBe(0);
  });

  it('appendSessions no toca el calendario (a diferencia de commitSession)', () => {
    const antes = store.schedule.value;
    store.appendSessions([realSession('s_real')]);
    expect(store.sessions.value.map((s) => s.id)).toEqual(['s_real']);
    expect(store.schedule.value).toEqual(antes);
    expect(store.appendSessions([])).toHaveLength(1);
  });
});

/* ---------- copia de seguridad (export / import) ---------- */

describe('export / import', () => {
  it('exportState → importState deja el mismo estado y repinta todos los signals', () => {
    store.addRoutine({ name: 'Piernas', items: [{ exId: 'sentadilla' }] });
    store.appendSessions([realSession('s_copia')]);
    store.setSettingsPath('units', 'lb');
    store.setDay('2026-09-28', { status: 'planned', title: 'Ciclo' });

    const copia = store.exportState();
    store.resetAll();
    expect(store.sessions.value).toHaveLength(0);
    expect(store.routines.value).toHaveLength(0);

    const importado = store.importState(copia);

    /* mismo contenido que la copia (la única diferencia permitida es `meta`,
       que `importState` completa con `onboarded: true` como la v1) */
    expect(importado.settings).toEqual(copia.settings);
    expect(importado.equipment).toEqual(copia.equipment);
    expect(importado.sessions).toEqual(copia.sessions);
    expect(importado.routines).toEqual(copia.routines);
    expect(importado.schedule).toEqual(copia.schedule);
    expect(importado.createdAt).toBe(copia.createdAt);

    expect(store.settings.value.units).toBe('lb');
    expect(store.sessions.value.map((s) => s.id)).toEqual(['s_copia']);
    expect(store.routines.value.map((r) => r.name)).toEqual(['Piernas']);
    expect(store.schedule.value['2026-09-28']).toMatchObject({ status: 'planned', title: 'Ciclo' });
  });

  it('importState fija meta.onboarded y conserva las claves que traiga', () => {
    const copia = {
      ...store.exportState(),
      meta: { lastPlanAt: '2026-09-20T09:00:00.000Z' },
    };

    const importado = store.importState(copia);

    expect((importado.meta as Record<string, unknown>).onboarded).toBe(true);
    expect(store.meta.value.onboarded).toBe(true);
    expect(store.meta.value.lastPlanAt).toBe('2026-09-20T09:00:00.000Z');
    /* se PERSISTIÓ: no es un valor solo pintado en el signal */
    store.refresh();
    expect(store.meta.value.onboarded).toBe(true);
  });

  it('con algo que no parece copia lanza y no toca lo guardado', () => {
    store.appendSessions([realSession('s_mia')]);
    expect(() => store.importState({ version: 1 })).toThrow();
    expect(() => store.importState('texto')).toThrow();
    expect(store.sessions.value.map((s) => s.id)).toEqual(['s_mia']);
  });
});
