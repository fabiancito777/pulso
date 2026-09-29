/**
 * El envoltorio de la sesión en curso: `startFromPlan` (lo que la vista Hoy lanza
 * al pulsar «Empezar sesión» —plan de hoy—, «Repetir» o «Empezar ahora»
 * —sugerencia—) y `finishSession` (lo que hace «Terminar»).
 *
 * Lo que hay que verificar aquí, y no en `domain/session.test.ts`, es el ENVOLVENTE:
 * que la sesión llega a la signal `active` y a `pulso.state.active` (el mismo sitio
 * que la v1) con `source: 'plan'`, que el `basis` del plan («repetición de …»)
 * sobrevive hasta la entrada, que tocar «Empezar» dos veces no pisa un
 * entrenamiento a medias, y que cerrar apila la sesión en el historial y marca el
 * día como hecho (las dos comprobaciones del auto-test de la v1).
 *
 * Mismo patrón que `store.test.ts`: `localStorage` simulado ANTES del import
 * dinámico, porque `storageAvailable` y el estado inicial se deciden al cargar.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { today } from '@/domain/dates';
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
    /* lo mismo que escribe la v1: `pulso.state.active` */
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

  it('el día por defecto es hoy (v1 `startFromItems`)', () => {
    const creada = session.startFromPlan([{ exId: firstId() }]);
    expect(creada.dayIso).toBe(today());
  });
});

/* ---------- cerrar la sesión: las dos comprobaciones del auto-test de la v1
   («sesión: se guarda en el historial» y «sesión: día marcado como hecho») ---------- */

describe('finishSession', () => {
  it('apila la sesión, marca el día como hecho y apaga sesión y descanso', () => {
    const creada = session.startFromPlan([{ exId: firstId(), sets: 2 }], {
      dayIso: '2026-09-28',
    });
    session.toggleSetAt(0, 0);
    /* marcar una serie arranca el descanso automático (lo comprueba el dominio) */
    expect(session.rest.value.running).toBe(true);

    const guardada = session.finishSession();

    expect(guardada).not.toBeNull();
    expect(guardada?.date).toBe('2026-09-28');
    /* la v1 también estrena id al cerrar (`T.finish` → `U.uid('s')`) */
    expect(guardada?.id).not.toBe(creada.id);
    expect(store.sessions.value.map((s) => s.id)).toEqual([guardada?.id]);
    expect((store.readState().sessions as { id: string }[]).map((s) => s.id)).toEqual([
      guardada?.id,
    ]);
    expect(store.schedule.value['2026-09-28']).toMatchObject({
      status: 'done',
      sessionId: guardada?.id,
    });
    expect(session.active.value).toBeNull();
    expect(store.readState().active).toBeNull();
    expect(session.rest.value.running).toBe(false);
    expect(session.sessionSeconds.value).toBe(0);
  });

  it('sin ninguna serie marcada no se guarda nada y el día no se toca', () => {
    session.startFromPlan([{ exId: firstId(), sets: 2 }], { dayIso: '2026-09-28' });

    expect(session.finishSession()).toBeNull();

    expect(store.sessions.value).toHaveLength(0);
    expect(store.schedule.value['2026-09-28']).toBeUndefined();
    expect(session.active.value).not.toBeNull();
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
