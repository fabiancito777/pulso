import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlateStock, RoutineItem } from '@/domain/types';
import type { ScheduleDay } from '@/state/store';

const mem = new Map<string, string>();

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

const store = await import('@/state/store');
const { toast } = await import('@/ui/toast');

const plate = (w: number, discs: number, unit: 'kg' | 'lb' = 'kg'): PlateStock => ({
  w,
  unit,
  discs,
  on: true,
});

const stateJson = (value: unknown): string => JSON.stringify(value);

beforeEach(() => {
  mem.clear();
  store.writeState(store.defaultState());
  store.refresh();
});

describe('store: estado y defaults (221–230)', () => {
  it('221 · withDefaults rellena las claves que falten', () => {
    expect(store.withDefaults({ a: 1 }, { a: 0, b: { c: 2 } })).toEqual({ a: 1, b: { c: 2 } });
  });

  it('222 · withDefaults no pisa lo que el usuario ya tenía', () => {
    const out = store.withDefaults({ b: { c: 9 } }, { b: { c: 2, d: 3 } });
    expect(out.b.c).toBe(9);
    expect(out.b.d).toBe(3);
  });

  it('223 · withDefaults con entrada no-objeto devuelve defaults', () => {
    expect(store.withDefaults(null, { a: 1 })).toEqual({ a: 1 });
    expect(store.withDefaults('x', { a: 1 })).toEqual({ a: 1 });
  });

  it('224 · readState con JSON roto vuelve a por defecto', () => {
    mem.set(store.STATE_KEY, '{roto');
    expect(store.readState().settings).toEqual(store.defaultState().settings);
  });

  it('225 · readState con JSON válido pero no-objeto vuelve a por defecto', () => {
    mem.set(store.STATE_KEY, '42');
    expect(store.readState().settings).toEqual(store.defaultState().settings);
    mem.set(store.STATE_KEY, '[]');
    expect(store.readState().settings).toEqual(store.defaultState().settings);
  });

  it('226 · readState normaliza el inventario en memoria sin reescribir', () => {
    mem.set(store.STATE_KEY, stateJson({ settings: { plates: [{ w: 5, discs: 8.9 }] } }));
    expect(store.readState().settings.plates[0]?.discs).toBe(8);
    const onDisk = JSON.parse(mem.get(store.STATE_KEY) as string) as {
      settings: { plates: { discs?: number }[] };
    };
    expect(onDisk.settings.plates[0]?.discs).toBe(8.9);
  });

  it('227 · writeState normaliza el inventario', () => {
    const st = store.readState();
    st.settings.plates = [{ w: 5, unit: 'kg', discs: 5.9, on: true }];
    store.writeState(st);
    const onDisk = JSON.parse(mem.get(store.STATE_KEY) as string) as {
      settings: { plates: PlateStock[] };
    };
    expect(onDisk.settings.plates[0]?.discs).toBe(5);
  });

  it('228 · readStored devuelve null con clave rota', () => {
    mem.set('pulso.rest', 'no-json');
    expect(store.readStored('pulso.rest')).toBeNull();
  });

  it('229 · writeStored(key, null) borra la clave', () => {
    mem.set('pulso.rest', '{}');
    store.writeStored('pulso.rest', null);
    expect(mem.get('pulso.rest')).toBeUndefined();
  });

  it('230 · patchSettings normaliza el inventario en memoria', () => {
    store.patchSettings({ plates: [{ w: 1.25, unit: 'kg', discs: 6.7, on: true }] });
    expect(store.settings.value.plates[0]?.discs).toBe(6);
  });
});

describe('store: ajustes, material y rutinas (231–241)', () => {
  it('231 · setSettingsPath con ruta anidada no muta el signal', () => {
    const before = store.settings.value.bars;
    store.setSettingsPath('bars.olimpica', 20);
    const after = store.settings.value.bars;
    expect(after.olimpica).toBe(20);
    expect(after).not.toBe(before);
  });

  it('232 · updatePlate parchea una fila por índice', () => {
    store.patchSettings({ plates: [plate(5, 2), plate(10, 6)] });
    store.updatePlate(1, { discs: 4 });
    const plates = store.settings.value.plates;
    expect(plates[0]?.discs).toBe(2);
    expect(plates[1]?.discs).toBe(4);
  });

  it('233 · addPlate/removePlate/togglePlate mantienen el formato', () => {
    store.patchSettings({ plates: [plate(10, 4)] });
    const coherent = (): void => {
      for (const p of store.settings.value.plates) {
        expect(typeof p.discs).toBe('number');
      }
    };
    store.addPlate();
    expect(store.settings.value.plates).toHaveLength(2);
    coherent();
    const beforeToggle = store.settings.value.plates.length;
    store.togglePlate(0);
    expect(store.settings.value.plates).toHaveLength(beforeToggle);
    expect(store.settings.value.plates[0]?.on).toBe(false);
    coherent();
    store.removePlate(1);
    expect(store.settings.value.plates).toHaveLength(1);
    coherent();
  });

  it('234 · applyEquipment escribe el preset de una sola vez', () => {
    store.applyEquipment({ mancuernas: true });
    expect(store.equipment.value).toEqual({ mancuernas: true });
    expect(store.readState().equipment).toEqual({ mancuernas: true });
  });

  it('235 · addRoutine genera id y rellena campos vacíos', () => {
    const r = store.addRoutine({ name: '', items: [] });
    expect(r.id).toMatch(/^rt_/);
    expect(r.name).toBe('Nueva rutina');
    expect(r.source).toBe('manual');
    expect(Number.isNaN(Date.parse(r.createdAt as string))).toBe(false);
  });

  it('236 · addRoutine convierte weight:"" en null', () => {
    const r = store.addRoutine({
      name: 'x',
      items: [{ exId: 'x', weight: '' } as unknown as RoutineItem],
    });
    expect(r.items[0]?.weight).toBeNull();
  });

  it('237 · updateRoutine no cambia el id', () => {
    const creada = store.addRoutine({ name: 'A', items: [] });
    const upd = store.updateRoutine(creada.id, { id: 'otro', name: 'X' });
    expect(upd?.id).toBe(creada.id);
    expect(store.findRoutine(creada.id)?.name).toBe('X');
  });

  it('238 · updateRoutine con id inexistente devuelve null', () => {
    expect(store.updateRoutine('no-existe', { name: 'X' })).toBeNull();
  });

  it('239 · removeRoutine desatasca el calendario', () => {
    const r = store.addRoutine({ name: 'A', items: [] });
    store.setDay('2026-09-27', { status: 'planned', routineId: r.id });
    store.removeRoutine(r.id);
    expect(store.schedule.value['2026-09-27']?.routineId).toBeUndefined();
    expect(store.schedule.value['2026-09-27']).toMatchObject({ status: 'planned' });
  });

  it('240 · duplicateRoutine clona en profundidad', () => {
    const r = store.addRoutine({ name: 'A', items: [{ exId: 'x', sets: 4 }] });
    const copy = store.duplicateRoutine(r.id);
    expect(copy).not.toBeNull();
    if (!copy) return;
    expect(copy.id).not.toBe(r.id);
    expect(copy.name).toBe('A (copia)');
    copy.items[0].sets = 9;
    expect(store.findRoutine(r.id)?.items[0]?.sets).toBe(4);
  });

  it('241 · setDay fusiona y clearDay borra la clave', () => {
    store.setDay('2026-09-27', { title: 'A' });
    store.setDay('2026-09-27', { status: 'done' });
    expect(store.schedule.value['2026-09-27']).toMatchObject({ title: 'A', status: 'done' });

    store.clearDay('2026-09-27');
    expect(store.schedule.value['2026-09-27']).toBeUndefined();
    const onDisk = JSON.parse(mem.get(store.STATE_KEY) as string) as {
      schedule?: Record<string, ScheduleDay>;
    };
    expect(onDisk.schedule?.['2026-09-27']).toBeUndefined();
  });
});

describe('store: importación y reset (242–244)', () => {
  it('242 · importState marca onboarding y normaliza placas', () => {
    const next = store.importState({
      settings: { plates: [{ w: 5, unit: 'kg', discs: 8 }] },
      meta: {},
    });
    expect((next.meta as { onboarded?: boolean }).onboarded).toBe(true);
    expect(next.version).toBe(store.STATE_VERSION);
    expect(next.settings.plates[0]?.discs).toBe(8);
  });

  it('243 · importState con archivo que no es de Pulso lanza', () => {
    expect(() => store.importState({ foo: 1 })).toThrow('El archivo no parece una copia de Pulso');
    expect(() => store.importState(42)).toThrow();
    expect(store.looksLikeState({ foo: 1 })).toBe(false);
  });

  it('244 · resetAll respeta las claves de "ya sembrado"', () => {
    mem.set(store.SEED_KEY, '[]');
    mem.set(store.SETUP_KEY, '{}');
    store.resetAll();
    /* el perfil se conserva (con su nombre), pero sin datos de entrenamiento */
    const fresh = JSON.parse(mem.get(store.STATE_KEY) ?? '{}') as {
      sessions?: unknown;
      routines?: unknown;
    };
    expect(fresh.sessions ?? []).toEqual([]);
    expect(fresh.routines ?? []).toEqual([]);
    expect(mem.has(store.SEED_KEY)).toBe(true);
    expect(mem.has(store.SETUP_KEY)).toBe(true);
  });
});

describe('store: robustez (293, 297, 299, 300)', () => {
  it('293 · Sets negativos se normalizan al guardar', () => {
    const r = store.addRoutine({ name: 'x', items: [{ exId: 'x', sets: -3 }] });
    expect(r.items[0]?.sets).toBe(1);
    const cero = store.addRoutine({ name: 'y', items: [{ exId: 'y', sets: 0 }] });
    expect(cero.items[0]?.sets).toBe(1);
  });

  it('297 · withDefaults no se contamina con __proto__', () => {
    const out = store.withDefaults(JSON.parse('{"__proto__":{"x":1}}') as object, { a: 1 });
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });

  it('299 · Fallo de escritura avisa UNA sola vez', () => {
    const mocked = vi.mocked(toast);
    mocked.mockClear();
    const original = mem.set.bind(mem);
    const setItem = localStorage.setItem.bind(localStorage);
    let mustThrow = true;
    localStorage.setItem = (k: string, v: string): void => {
      if (mustThrow) throw new DOMException('lleno', 'QuotaExceededError');
      original(k, v);
    };
    try {
      store.writeState(store.defaultState());
      store.writeState(store.defaultState());
    } finally {
      localStorage.setItem = setItem;
      mustThrow = false;
    }
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it('300 · Un estado con settings:null no rompe el arranque', () => {
    mem.set(store.STATE_KEY, '{"settings":null}');
    const st = store.readState();
    expect(st.settings).not.toBeNull();
    expect(st.settings).toEqual(store.defaultState().settings);
  });
});
