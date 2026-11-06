/**
 * El envoltorio de la sesión en curso: `startFromPlan` (lo que la vista Hoy lanza
 * al pulsar «Empezar sesión» —plan de hoy—, «Repetir» o «Empezar ahora»
 * —sugerencia—) y `finishSession` (lo que hace «Terminar»).
 *
 * Lo que hay que verificar aquí, y no en `domain/session.test.ts`, es el ENVOLVENTE:
 * que la sesión llega a la signal `active` y a `pulso.state.active` (el mismo sitio
 * que antes) con `source: 'plan'`, que el `basis` del plan («repetición de …»)
 * sobrevive hasta la entrada, que tocar «Empezar» dos veces no pisa un
 * entrenamiento a medias, y que cerrar apila la sesión en el historial y marca el
 * día como hecho (las dos comprobaciones del auto-test ).
 *
 * Mismo patrón que `store.test.ts`: `localStorage` simulado ANTES del import
 * dinámico, porque `storageAvailable` y el estado inicial se deciden al cargar.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { today } from '@/domain/dates';
import type { UnresolvedName } from '@/domain/match';
import type { PlanItem } from '@/domain/types';

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

const session = await import('./session');
const store = await import('./store');

/** Un ejercicio real de la biblioteca semilla (el orden puede cambiar). */
const firstId = (): string => store.exercises.value[0]?.id ?? '';

beforeEach(() => {
  mem.clear();
  store.writeState(store.defaultState());
  store.refresh();
});

/** Lo que manda `hoy-helpers` (`PlanLine`): reps concretas, `basis` y `notes`. */
type PlanLine = PlanItem & { reps?: number; basis?: string; notes?: string };

describe('startFromPlan', () => {
  it('arranca la sesión con source plan, nombre y día, y la escribe en `active`', () => {
    const creada = session.startFromPlan([{ exId: firstId(), sets: 2 }], {
      name: 'Empuje A',
      dayIso: '2026-09-28',
    });
    expect(creada).toMatchObject({
      name: 'Empuje A',
      dayIso: '2026-09-28',
      source: 'plan',
      routineId: null,
    });
    expect(creada.entries.map((entry) => entry.exId)).toEqual([firstId()]);
    expect(session.active.value?.id).toBe(creada.id);
    /* lo mismo que escribe antes: `pulso.state.active` */
    expect(store.readState().active?.id).toBe(creada.id);
  });

  it('el `basis` y las reps del plan llegan a la entrada (repetir una sesión)', () => {
    const line: PlanLine = {
      exId: firstId(),
      sets: 3,
      reps: 6,
      weight: 40,
      basis: 'repetición de 21 sep 2026',
    };
    const creada = session.startFromPlan([line], { name: 'Repetir', dayIso: '2026-09-28' });
    expect(creada.entries[0]).toMatchObject({ basis: 'repetición de 21 sep 2026' });
    expect(creada.entries[0]?.sets.map((set) => set.reps)).toEqual([6, 6, 6]);
    expect(creada.entries[0]?.sets.map((set) => set.weight)).toEqual([40, 40, 40]);
    /* el snapshot (`session.plan`) lo hereda igual: es lo que viaja al historial */
    expect(creada.plan?.[0]).toMatchObject({ exId: firstId(), basis: 'repetición de 21 sep 2026' });
  });

  it('si ya hay una sesión en curso no la pisa (igual que `startFreeSession`)', () => {
    const primera = session.startFromPlan([{ exId: firstId() }], { name: 'Empuje A' });
    const segunda = session.startFromPlan([{ exId: firstId() }], { name: 'Otra' });
    expect(segunda.id).toBe(primera.id);
    expect(segunda.name).toBe('Empuje A');
    expect(session.active.value?.entries).toHaveLength(primera.entries.length);
  });

  it('un plan vacío o sin ejercicios de la biblioteca deja la sesión sin entradas', () => {
    expect(session.startFromPlan([]).entries).toEqual([]);
    const inventado = session.startFromPlan([{ name: 'Ejercicio que no existe' }]);
    expect(inventado.entries).toEqual([]);
    expect(inventado.source).toBe('plan');
  });

  it('los nombres del plan que no resuelven salen por onUnresolved (sin silencio)', () => {
    const avisos: UnresolvedName[] = [];
    const creada = session.startFromPlan(
      [{ exId: firstId(), sets: 2 }, { name: 'Ejercicio que no existe' }],
      {
        name: 'Empuje A',
        dayIso: '2026-09-28',
        onUnresolved: (items) => avisos.push(...items),
      },
    );
    expect(creada.entries).toHaveLength(1);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({
      name: 'Ejercicio que no existe',
      reason: 'no está en tu biblioteca',
    });
  });

  it('el día por defecto es hoy ', () => {
    const creada = session.startFromPlan([{ exId: firstId() }]);
    expect(creada.dayIso).toBe(today());
  });
});

describe('series: valores y tope', () => {
  it('las reps se acotan al escribir y no se arrastra un valor imposible', () => {
    session.startFromPlan([{ exId: firstId(), sets: 2 }]);

    session.editSet(0, 0, 'reps', -3);
    expect(session.active.value?.entries[0]?.sets.map((set) => set.reps)).toEqual([0, 0]);

    session.editSet(0, 0, 'reps', 500);
    expect(session.active.value?.entries[0]?.sets.map((set) => set.reps)).toEqual([99, 99]);
  });

  it('el peso negativo se acota a 0 y el vacío se respeta', () => {
    session.startFromPlan([{ exId: firstId(), sets: 2 }]);

    session.editSet(0, 0, 'weight', -20);
    expect(session.active.value?.entries[0]?.sets[0]?.weight).toBe(0);

    session.editSet(0, 0, 'weight', '');
    expect(session.active.value?.entries[0]?.sets[0]?.weight).toBe('');
  });

  it('«+ serie» se para en el tope de la rutina (12)', () => {
    session.startFromPlan([{ exId: firstId(), sets: 1 }]);
    for (let i = 0; i < 20; i += 1) session.addSet(0);
    expect(session.active.value?.entries[0]?.sets).toHaveLength(12);
  });
});

describe('addRoutineToSession', () => {
  it('añadir la misma rutina dos veces no fusiona sus pares', () => {
    const [a, b] = store.exercises.value;
    const rutina = store.addRoutine({
      name: 'Par',
      source: 'manual',
      items: [
        { exId: a?.id ?? '', sets: 2, superset: 'ss1' },
        { exId: b?.id ?? '', sets: 2, superset: 'ss1' },
      ],
    });
    session.startFromPlan([{ exId: a?.id ?? '', sets: 1 }]);

    session.addRoutineToSession(rutina.id);
    session.addRoutineToSession(rutina.id);

    const ids = session.active.value?.entries.map((entry) => entry.superset) ?? [];
    expect(ids).toHaveLength(5);
    expect(ids[0]).toBeUndefined();
    expect(ids[1]).toBe(ids[2]);
    expect(ids[3]).toBe(ids[4]);
    expect(ids[1]).not.toBe(ids[3]);
  });
});

/* ---------- cerrar la sesión: las dos comprobaciones del auto-test
   («sesión: se guarda en el historial» y «sesión: día marcado como hecho») ---------- */

describe('finishSession', () => {
  it('apila la sesión, marca el día como hecho y apaga sesión y descanso', () => {
    const creada = session.startFromPlan([{ exId: firstId(), sets: 2 }], {
      dayIso: '2026-09-28',
    });
    session.toggleSetAt(0, 0);
    /* marcar una serie arranca el descanso automático (lo comprueba el dominio) */
    expect(session.rest.value.running).toBe(true);

    const resultado = session.finishSession();

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    const guardada = resultado.session;
    expect(guardada.date).toBe('2026-09-28');
    /* antes también estrena id al cerrar (`T.finish` → `U.uid('s')`) */
    expect(guardada.id).not.toBe(creada.id);
    expect(store.sessions.value.map((s) => s.id)).toEqual([guardada.id]);
    expect((store.readState().sessions as { id: string }[]).map((s) => s.id)).toEqual([guardada.id]);
    expect(store.schedule.value['2026-09-28']).toMatchObject({
      status: 'done',
      sessionId: guardada.id,
    });
    expect(session.active.value).toBeNull();
    expect(store.readState().active).toBeNull();
    expect(session.rest.value.running).toBe(false);
    expect(session.sessionSeconds.value).toBe(0);
  });

  it('sin ninguna serie marcada devuelve `empty` y el día no se toca', () => {
    session.startFromPlan([{ exId: firstId(), sets: 2 }], { dayIso: '2026-09-28' });

    expect(session.finishSession()).toEqual({ ok: false, reason: 'empty' });

    expect(store.sessions.value).toHaveLength(0);
    expect(store.schedule.value['2026-09-28']).toBeUndefined();
    expect(session.active.value).not.toBeNull();
  });

  it('sin sesión activa devuelve `empty`', () => {
    expect(session.finishSession()).toEqual({ ok: false, reason: 'empty' });
  });

  it('si falla la persistencia devuelve `save` y mantiene sesión y descanso', () => {
    session.startFromPlan([{ exId: firstId(), sets: 2 }], { dayIso: '2026-09-28' });
    session.toggleSetAt(0, 0);
    expect(session.rest.value.running).toBe(true);

    const setItem = localStorage.setItem.bind(localStorage);
    const roto = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === store.STATE_KEY) throw new Error('QuotaExceededError');
      setItem(key, value);
    });

    try {
      expect(session.finishSession()).toEqual({ ok: false, reason: 'save' });

      expect(session.active.value).not.toBeNull();
      expect(store.readState().active).not.toBeNull();
      expect(store.sessions.value).toHaveLength(0);
      expect(store.schedule.value['2026-09-28']).toBeUndefined();
      expect(session.rest.value.running).toBe(true);
    } finally {
      roto.mockRestore();
      session.stopRestTimer();
    }
  });

  it('resetAll (importar/borrar) limpia también descanso y temporizadores', () => {
    session.startFromPlan([{ exId: firstId(), sets: 2 }]);
    session.toggleSetAt(0, 0);
    expect(session.rest.value.running).toBe(true);

    store.resetAll();

    expect(session.active.value).toBeNull();
    expect(session.rest.value.running).toBe(false);
    expect(session.sessionSeconds.value).toBe(0);
  });

  it('descartar la sesión no deja ni rastro en el historial', () => {
    session.startFromPlan([{ exId: firstId(), sets: 2 }], { dayIso: '2026-09-28' });
    session.toggleSetAt(0, 0);

    session.discardSession();

    expect(session.active.value).toBeNull();
    expect(store.readState().active).toBeNull();
    expect(store.sessions.value).toHaveLength(0);
    expect(store.schedule.value['2026-09-28']).toBeUndefined();
    expect(session.rest.value.running).toBe(false);
  });
});

/* ---------- completar un ejercicio sin cerrar la rutina ---------- */

describe('finishEntryAt', () => {
  /** Marca todas las series de un ejercicio. */
  function markAll(index: number): void {
    const count = session.active.value?.entries[index]?.sets.length ?? 0;
    for (let j = 0; j < count; j += 1) session.toggleSetAt(index, j);
  }

  it('guarda el ejercicio aparte, lo quita de la sesión y marca el día', () => {
    const [a, b] = store.exercises.value;
    session.startFromPlan([{ exId: a?.id ?? '', sets: 2 }, { exId: b?.id ?? '', sets: 2 }], {
      dayIso: '2026-09-28',
    });
    markAll(0);

    const out = session.finishEntryAt(0);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.session.entries).toHaveLength(1);
    expect(out.remaining).toBe(1);
    /* la rutina sigue en curso con el otro ejercicio */
    expect(session.active.value?.entries.map((entry) => entry.exId)).toEqual([b?.id]);
    expect(session.active.value?.finished).toEqual([a?.id]);
    expect(store.sessions.value.map((s) => s.id)).toEqual([out.session.id]);
    /* el registro va al día en que se completó (hoy), no al que tenía la sesión */
    expect(out.session.date).toBe(today());
    expect(store.schedule.value[today()]).toMatchObject({
      status: 'done',
      sessionId: out.session.id,
    });
    /* el cierre del ejercicio cancela el descanso que arrancó al marcar */
    expect(session.rest.value.running).toBe(false);
  });

  it('al completar el último pendiente la sesión se cierra entera', () => {
    session.startFromPlan([{ exId: firstId(), sets: 1 }], { dayIso: '2026-09-28' });
    markAll(0);

    const out = session.finishEntryAt(0);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.remaining).toBe(0);
    expect(session.active.value).toBeNull();
    expect(store.readState().active).toBeNull();
    expect(store.sessions.value).toHaveLength(1);
  });

  it('sin series marcadas no guarda nada y deja la sesión intacta', () => {
    session.startFromPlan([{ exId: firstId(), sets: 2 }], { dayIso: '2026-09-28' });

    expect(session.finishEntryAt(0)).toEqual({ ok: false, reason: 'empty' });
    expect(session.active.value).not.toBeNull();
    expect(store.sessions.value).toHaveLength(0);
  });

  it('volver a añadir un ejercicio completado lo reabre (no lo quita al sincronizar)', () => {
    const [a, b] = store.exercises.value;
    session.startFromPlan([{ exId: a?.id ?? '', sets: 1 }, { exId: b?.id ?? '', sets: 1 }], {
      dayIso: '2026-09-28',
    });
    markAll(0);
    session.finishEntryAt(0);
    expect(session.active.value?.finished).toEqual([a?.id]);

    session.addExercises([a?.id ?? '']);
    expect(session.active.value?.entries.map((entry) => entry.exId)).toEqual([b?.id, a?.id]);
    expect(session.active.value?.finished).toBeUndefined();
  });
});
