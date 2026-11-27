/**
 * `app/demo-boot.ts`: el arranque en modo demo `?demo=1`
 * ().
 *
 * Lo que hay que vigilar aquí es que NO se cuela en el arranque normal y que no
 * se carga dos veces: la query es opcional, con datos ya existentes no toca nada
 * y, cuando sí carga, marca el onboarding como visto (si no, el modal de primera
 * visita taparía la demo, como evitaba antes con `S.setMeta({onboarded: true})`).
 *
 * `localStorage` va simulado ANTES del import dinámico (`storageAvailable` se
 * decide al cargar `state/store`, patrón de `store.test.ts`). Los ejemplos viven
 * en memoria y nunca forman parte de `sessions`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = new Map<string, string>();

/* El store avisa con `toast` si la escritura falla: fuera del camino. */
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
const boot = await import('./demo-boot');

beforeEach(() => {
  mem.clear();
  store.writeState(store.defaultState());
  store.refresh();
});

describe('isDemoQuery', () => {
  it('acepta `demo=1` con otros parámetros alrededor y no claves parecidas', () => {
    expect(boot.isDemoQuery('?demo=1')).toBe(true);
    expect(boot.isDemoQuery('?foo=1&demo=1')).toBe(true);
    expect(boot.isDemoQuery('?demo=1&foo=2')).toBe(true);

    expect(boot.isDemoQuery('')).toBe(false);
    expect(boot.isDemoQuery('?nada=1')).toBe(false);
    expect(boot.isDemoQuery('?demodeux=1')).toBe(false);
    expect(boot.isDemoQuery('?demo=10')).toBe(false);
  });
});

describe('runDemoBoot', () => {
  it('sin la query no carga nada ni toca el onboarding', () => {
    expect(boot.runDemoBoot('')).toBe(0);
    expect(store.sessions.value).toHaveLength(0);
    expect(store.meta.value.onboarded).toBe(false);
  });

  it('si la demo ya está abierta no la vuelve a generar', () => {
    const previas = store.demoData(1);
    expect(previas).toBeGreaterThan(0);

    expect(boot.runDemoBoot('?demo=1')).toBe(0);
    expect(store.demoSessions.value).toHaveLength(previas);
    expect(store.meta.value.onboarded).toBe(false);
  });

  it('con `?demo=1`: carga una demo aislada sin tocar el historial real', () => {
    store.writeState(store.defaultState());
    store.refresh();
    store.appendSessions([
      { id: 'real', date: '2026-09-01', startedAt: '2026-09-01T10:00:00.000Z', unit: 'kg', entries: [] },
    ]);

    const added = boot.runDemoBoot('?demo=1');
    expect(added).toBeGreaterThan(0);
    expect(store.demoSessions.value).toHaveLength(added);
    expect(store.sessions.value.map((session) => session.id)).toEqual(['real']);
    expect(store.meta.value.onboarded).toBe(false);
  });

  it('una segunda llamada no duplica sesiones', () => {
    const antes = store.sessions.value.length;
    expect(boot.runDemoBoot('?demo=1')).toBe(0);
    expect(store.sessions.value).toHaveLength(antes);
  });

});
