/**
 * `applyOnboarding` / `markOnboarded`: lo que la v1 hacía en el `.then()` del
 * modal (`legacy/js/app.js:252-261`).
 *
 * Igual que `store.test.ts`, el `localStorage` simulado se monta ANTES del
 * import (si no, `storageAvailable` sale a `false` y no se persiste nada).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { equipPreset } from '@/domain/data';

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
const onboarding = await import('./onboarding');

beforeEach(() => {
  mem.clear();
  store.writeState(store.defaultState());
  store.refresh();
});

describe('onboarding', () => {
  it('aplica las 4 claves de ajustes, el preset de material y marca meta.onboarded', () => {
    onboarding.applyOnboarding({
      name: 'Nuria',
      goal: 'fuerza',
      days: 5,
      units: 'lb',
      equip: 'gym',
    });

    expect(store.settings.value).toMatchObject({
      name: 'Nuria',
      goal: 'fuerza',
      daysPerWeek: 5,
      units: 'lb',
    });
    expect(store.equipment.value).toEqual(equipPreset('gym'));
    expect(store.meta.value.onboarded).toBe(true);

    /* y persiste: una recarga no vuelve a mostrar el modal */
    const guardado = store.readState();
    expect((guardado.meta as Record<string, unknown> | undefined)?.onboarded).toBe(true);
    expect(guardado.settings).toMatchObject({ name: 'Nuria', daysPerWeek: 5 });
  });

  it('«Configurar después» solo marca como visto (no pisa ajustes)', () => {
    store.patchSettings({ name: 'Antes', goal: 'fuerza' });

    onboarding.applyOnboarding(null);

    expect(store.settings.value.name).toBe('Antes');
    expect(store.meta.value.onboarded).toBe(true);
  });

  it('nombre vacío se guarda tal cual (el saludo de Hoy lo tolera)', () => {
    onboarding.applyOnboarding({
      name: '',
      goal: 'hipertrofia',
      days: 4,
      units: 'kg',
      equip: 'basico',
    });
    expect(store.settings.value.name).toBe('');
    expect(store.meta.value.onboarded).toBe(true);
  });

  it('un preset desconocido cae en `basico` (mismo fallback que equipPreset)', () => {
    onboarding.applyOnboarding({
      name: 'A',
      goal: 'hipertrofia',
      days: 4,
      units: 'kg',
      equip: 'otra',
    });
    expect(store.equipment.value).toEqual(equipPreset('basico'));
  });

  it('markOnboarded es idempotente y no toca el resto de meta', () => {
    store.setMeta({ lastPlanAt: '2026-09-20' });
    onboarding.markOnboarded();
    onboarding.markOnboarded();
    expect(store.meta.value).toMatchObject({ onboarded: true, lastPlanAt: '2026-09-20' });
  });
});
