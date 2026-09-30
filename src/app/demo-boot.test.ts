/**
 * `app/demo-boot.ts`: el arranque en modo demo `?demo=1` de la v1
 * (`legacy/js/app.js:1261-1277`).
 *
 * Lo que hay que vigilar aquí es que NO se cuela en el arranque normal y que no
 * se carga dos veces: la query es opcional, con datos ya existentes no toca nada
 * y, cuando sí carga, marca el onboarding como visto (si no, el modal de primera
 * visita taparía la demo, como evitaba la v1 con `S.setMeta({onboarded: true})`).
 *
 * `localStorage` va simulado ANTES del import dinámico (`storageAvailable` se
 * decide al cargar `state/store`, patrón de `store.test.ts`), y los tests van en
 * ese orden a propósito: primero el guard de «ya hay sesiones» (con `ran` aún en
 * false) y después la carga, para que cada guard tenga su propio caso.
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

  it('con sesiones ya cargadas no hace nada (aunque pida la query)', () => {
    const previas = store.demoData(1);
    expect(previas).toBeGreaterThan(0);

    expect(boot.runDemoBoot('?demo=1')).toBe(0);
    expect(store.sessions.value).toHaveLength(previas);
    expect(store.meta.value.onboarded).toBe(false);
  });

  it('con `?demo=1` y sin sesiones: carga la demo y marca el onboarding', () => {
    store.writeState(store.defaultState());
    store.refresh();

    const added = boot.runDemoBoot('?demo=1');
    expect(added).toBeGreaterThan(0);
    expect(store.sessions.value).toHaveLength(added);
    expect(store.sessions.value.every((s) => s.demo === true)).toBe(true);
    expect(store.meta.value.onboarded).toBe(true);
  });

  it('una segunda llamada no duplica sesiones', () => {
    const antes = store.sessions.value.length;
    expect(boot.runDemoBoot('?demo=1')).toBe(0);
    expect(store.sessions.value).toHaveLength(antes);
  });
});
