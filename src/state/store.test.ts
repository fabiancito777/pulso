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
