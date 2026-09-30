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

import { today } from '@/domain/dates';
import { emptyDraft, toExercise } from '@/domain/exercise-draft';
import type { Exercise, Session } from '@/domain/types';
import type { Routine, ScheduleDay } from './store';

const mem = new Map<string, string>();

/* El aviso de fallo de escritura llama a `toast`: se sustituye por un espión
   para poder contar los avisos (se aplica también al import dinámico de store,
   que es posterior). */
vi.mock('@/ui/toast', () => ({
  toast: vi.fn(() => ({ close: () => {} })),
}));

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

  it('duplicateRoutine cambia id y nombre y COPIA los items (sin referencias compartidas)', () => {
    const creada = store.addRoutine({
      name: 'Empuje A',
      items: [{ exId: 'press-banca', sets: 4, weight: 40 }],
    });

    const copia = store.duplicateRoutine(creada.id);

    expect(copia).not.toBeNull();
    if (!copia) return;
    expect(copia.id).not.toBe(creada.id);
    expect(copia.id).toMatch(/^rt_/);
    expect(copia.name).toBe('Empuje A (copia)');
    expect(copia.items).toEqual(creada.items);
    expect(copia.items[0]).not.toBe(creada.items[0]);
    expect(persistedRoutines().map((r) => r.id)).toContain(copia.id);

    /* la copia vive su vida: tocarla no debe mover la original */
    copia.items[0].sets = 9;
    expect(creada.items[0].sets).toBe(4);
    expect(store.routines.value.find((r) => r.id === creada.id)?.items[0].sets).toBe(4);

    expect(store.routines.value).toHaveLength(2);
    expect(store.duplicateRoutine('rt_no-existe')).toBeNull();
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

/* ---------- fallo de escritura (spec onboarding.md, hueco 6) ---------- */

describe('writeState con setItem roto', () => {
  it('avisa UNA sola vez y el estado sigue vivo en memoria (la signal no se pierde)', async () => {
    const { toast } = await import('@/ui/toast');
    const aviso = vi.mocked(toast);
    aviso.mockClear();

    const roto = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    try {
      store.writeState(store.defaultState());
      store.patchSettings({ name: 'En memoria' });

      expect(aviso).toHaveBeenCalledTimes(1);
      expect(aviso).toHaveBeenCalledWith(
        expect.stringContaining('los datos viven solo en esta pestaña'),
        expect.objectContaining({ kind: 'warn', ms: 6000 }),
      );
      /* la signal es la fuente de verdad aunque el disco falle */
      expect(store.settings.value.name).toBe('En memoria');
      expect(store.storageAvailable).toBe(true);

      /* un fallo más (una serie escrita) no repite el aviso */
      store.writeState(store.defaultState());
      expect(aviso).toHaveBeenCalledTimes(1);
    } finally {
      roto.mockRestore();
    }
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

/* ---------- sesiones: edición y borrado ---------- */

describe('sesiones: updateSession / removeSession', () => {
  it('updateSession parchea, conserva el id y devuelve null si no existe', () => {
    store.appendSessions([realSession('s_1')]);

    expect(store.updateSession('s_no-existe', { name: 'Nada' })).toBeNull();

    const editada = store.updateSession('s_1', {
      name: 'Tren inferior',
      notes: 'sin prisa',
      date: '2026-09-03',
      id: 'otro-id',
    });

    /* el id del parche se ignora: lo referencian schedule.sessionId */
    expect(editada).toMatchObject({ id: 's_1', name: 'Tren inferior', notes: 'sin prisa' });
    expect(store.sessions.value).toHaveLength(1);
    expect(store.sessions.value[0]).toMatchObject({ id: 's_1', name: 'Tren inferior' });
    expect(persistedSessions()[0]).toMatchObject({ notes: 'sin prisa', date: '2026-09-03' });

    /* la señal y lo persistido se releen igual tras un refresh */
    store.refresh();
    expect(store.sessions.value[0]?.name).toBe('Tren inferior');
  });

  it('updateSession no reordena por startedAt (la v1 solo ordenaba al apilar)', () => {
    const vieja = { ...realSession('s_vieja'), startedAt: '2026-09-01T18:00:00.000Z' };
    const reciente = { ...realSession('s_reciente'), startedAt: '2026-09-08T18:00:00.000Z' };
    store.appendSessions([vieja, reciente]);
    expect(store.sessions.value.map((s) => s.id)).toEqual(['s_reciente', 's_vieja']);

    store.updateSession('s_vieja', { startedAt: '2026-09-20T18:00:00.000Z' });

    expect(store.sessions.value.map((s) => s.id)).toEqual(['s_reciente', 's_vieja']);
  });

  it('removeSession quita la sesión y NO desmarca el día (así lo hacía la v1)', () => {
    store.commitSession({ ...realSession('s_borra'), date: '2026-09-05' });
    expect(store.schedule.value['2026-09-05']).toMatchObject({
      status: 'done',
      sessionId: 's_borra',
    });

    store.removeSession('s_borra');

    expect(store.sessions.value).toHaveLength(0);
    expect(persistedSessions()).toHaveLength(0);
    /* la v1 no tocaba el calendario: el día se queda hecho (views-calendar
       pintaba `p.status === 'done'` aunque la sesión ya no existiera) */
    expect(store.schedule.value['2026-09-05']).toMatchObject({
      status: 'done',
      sessionId: 's_borra',
    });

    /* id desconocido o lista vacía: no revienta y deja el estado como está */
    store.removeSession('s_no-existe');
    expect(store.sessions.value).toHaveLength(0);
    expect(store.schedule.value['2026-09-05']).toMatchObject({ status: 'done' });
  });

  it('lo editado y lo borrado sobreviven a refresh() y al export/import', () => {
    store.appendSessions([realSession('s_queda')]);
    store.updateSession('s_queda', { name: 'Editada' });
    store.commitSession({ ...realSession('s_fuera'), date: '2026-09-10' });
    store.removeSession('s_fuera');

    const copia = store.exportState();
    store.resetAll();
    expect(store.sessions.value).toHaveLength(0);

    store.importState(copia);

    expect(store.sessions.value.map((s) => [s.id, s.name])).toEqual([['s_queda', 'Editada']]);
    expect(store.schedule.value['2026-09-10']).toMatchObject({ status: 'done' });
    store.refresh();
    expect(store.sessions.value).toHaveLength(1);
    expect(store.sessions.value[0]?.name).toBe('Editada');
  });
});

/* ---------- calendario: clearDay ---------- */

describe('calendario: clearDay', () => {
  it('setDay con undefined NO borra la clave; clearDay sí (como la v1)', () => {
    store.setDay('2026-09-30', { status: 'planned', title: 'Ciclo', routineId: 'rt_1' });
    store.setDay('2026-09-29', { status: 'rest', type: 'descanso' });

    store.setDay('2026-09-30', {
      status: undefined,
      title: undefined,
      routineId: undefined,
      type: undefined,
      source: undefined,
    });

    /* el merge deja la clave en el mapa (un `{}` que además se persiste), así
       que "limpiar con undefined" no llega a lo que hacía S.clearDay */
    expect('2026-09-30' in store.schedule.value).toBe(true);
    expect('2026-09-30' in (store.readState().schedule as Record<string, unknown>)).toBe(true);

    store.clearDay('2026-09-30');

    expect('2026-09-30' in store.schedule.value).toBe(false);
    expect('2026-09-30' in (store.readState().schedule as Record<string, unknown>)).toBe(false);
    /* los demás días quedan intactos */
    expect(store.schedule.value['2026-09-29']).toMatchObject({ status: 'rest' });
    store.refresh();
    expect('2026-09-30' in store.schedule.value).toBe(false);
  });

  it('clearDay de un día que no existe no toca nada', () => {
    store.setDay('2026-09-28', { status: 'planned' });
    store.clearDay('2030-01-01');
    expect(Object.keys(store.schedule.value)).toEqual(['2026-09-28']);
    expect('2026-09-28' in (store.readState().schedule as Record<string, unknown>)).toBe(true);
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

/* ---------- semilla personal (v1: seedPersonalRoutines / applyPersonalSetup) ---------- */

/** El día de hoy, ya como plan del calendario. */
function planDeHoy(state: ReturnType<typeof store.readState>): ScheduleDay | undefined {
  const plan = state.schedule;
  return plan && typeof plan === 'object'
    ? (plan as Record<string, ScheduleDay>)[today()]
    : undefined;
}

describe('semilla personal (pulso.seeded-routines / pulso.applied-setup)', () => {
  it('instalación limpia: siembra la rutina, agenda hoy y deja las claves de la v1', () => {
    mem.clear();

    store.loadInitialState();

    expect(store.readStored<string[]>(store.SEED_KEY)).toEqual(['rt-personal-kroc']);
    expect(store.readStored<string[]>(store.SETUP_KEY)).toEqual(['inventario-v2']);

    const guardadas = persistedRoutines();
    expect(guardadas).toHaveLength(1);
    expect(guardadas[0]).toMatchObject({
      id: 'rt-personal-kroc',
      name: 'Espalda + Pecho + Brazos (superseries)',
      source: 'manual',
    });
    expect(typeof guardadas[0]?.createdAt).toBe('string');
    /* los 11 ejercicios apuntan a la biblioteca REAL (si el catálogo cambia,
       la semilla tendría que cambiar con él) */
    expect(guardadas[0]?.items).toHaveLength(11);
    const ids = store.exercises.value.map((e) => e.id);
    expect(guardadas[0]?.items.every((item) => ids.includes(item.exId))).toBe(true);

    expect(planDeHoy(store.readState())).toEqual({
      routineId: 'rt-personal-kroc',
      type: 'entreno',
      title: 'Espalda + Pecho + Brazos (superseries)',
      status: 'planned',
      source: 'manual',
    });
  });

  it('la segunda carga no duplica ni la rutina ni el día', () => {
    mem.clear();
    store.loadInitialState();
    store.loadInitialState();

    expect(persistedRoutines()).toHaveLength(1);
    const plan = store.readState().schedule as Record<string, ScheduleDay>;
    expect(Object.keys(plan)).toHaveLength(1);
    expect(store.readStored<string[]>(store.SEED_KEY)).toEqual(['rt-personal-kroc']);
  });

  it('con la clave puesta la rutina NO vuelve (así lo deja un «Borrar todo»)', () => {
    mem.clear();
    store.loadInitialState();
    store.resetAll();

    expect(store.readStored<string[]>(store.SEED_KEY)).toEqual(['rt-personal-kroc']);
    expect(store.readStored<string[]>(store.SETUP_KEY)).toEqual(['inventario-v2']);
    expect(persistedRoutines()).toHaveLength(0);

    store.loadInitialState();
    expect(persistedRoutines()).toHaveLength(0);
    expect(planDeHoy(store.readState())).toBeUndefined();
  });

  it('con datos existentes no pisa ni las rutinas ni el día ya planificado', () => {
    mem.clear();
    const state = store.defaultState();
    state.routines = [{ id: 'rt-mia', name: 'Empuje A', items: [] }];
    state.schedule = { [today()]: { status: 'rest', type: 'descanso', title: 'Viaje' } };
    store.writeState(state);

    store.loadInitialState();

    const tras = store.readState();
    const guardadas = persistedRoutines();
    expect(guardadas.map((r) => r.id)).toEqual(['rt-mia', 'rt-personal-kroc']);
    expect(guardadas[0]).toMatchObject({ name: 'Empuje A' });
    /* la v1 solo rellenaba el día si estaba libre */
    expect(planDeHoy(tras)).toEqual({ status: 'rest', type: 'descanso', title: 'Viaje' });
  });

  it('si la rutina ya está guardada solo se marca: no duplica ni agenda', () => {
    mem.clear();
    const state = store.defaultState();
    state.routines = [{ id: 'rt-personal-kroc', name: 'Mía, copiada a mano', items: [] }];
    store.writeState(state);

    store.loadInitialState();

    const tras = store.readState();
    expect(persistedRoutines()).toHaveLength(1);
    expect(persistedRoutines()[0]).toMatchObject({ name: 'Mía, copiada a mano' });
    /* la v1 hacía `return` antes de agendar el día */
    expect(planDeHoy(tras)).toBeUndefined();
    expect(store.readStored<string[]>(store.SEED_KEY)).toEqual(['rt-personal-kroc']);
  });

  it('el setup solo deja la clave: no reescribe inventario ni material', () => {
    mem.clear();
    const state = store.defaultState();
    state.settings = {
      ...state.settings,
      plates: [{ w: 20, unit: 'kg', pairs: 1, on: true }],
      bars: { olimpica: 15, ez: 0, mancuerna: 0 },
    };
    state.equipment = { mancuernas_ajustables: false };
    store.writeState(state);

    store.loadInitialState();

    const tras = store.readState();
    expect(tras.settings.plates).toEqual([{ w: 20, unit: 'kg', pairs: 1, on: true }]);
    expect(tras.settings.bars).toEqual({ olimpica: 15, ez: 0, mancuerna: 0 });
    expect(tras.equipment).toEqual({ mancuernas_ajustables: false });
    expect(store.readStored<string[]>(store.SETUP_KEY)).toEqual(['inventario-v2']);
  });
});
