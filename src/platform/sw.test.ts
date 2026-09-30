/**
 * `platform/sw.ts`: `postToSW`, el canal de los avisos de descanso.
 *
 * El fix que hay que fijar (v1 `e2c49b9`, `swPost`) es la VÍA 2: sin un SW
 * controlando la página — p. ej. tras actualizar la PWA sin recargar — el
 * mensaje se perdía en silencio y el descanso quedaba sin programar. Ahora se
 * entrega en cuanto `serviceWorker.ready` resuelva.
 *
 * Y el matiz propio de la v2: como en dev no registramos SW (`canRegisterSW`),
 * esa vía 2 solo se intenta donde SÍ se registraría. Si no, `ready` no se
 * cumpliría nunca y devolver `true` se comería el respaldo de la propia página
 * (`pageNotify`) que usan `notifyEnd` y `finishSession`.
 *
 * Mismo patrón que `audio.test.ts`: stubs antes del import dinámico.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const { postToSW } = await import('./sw');

const MSG = { type: 'cancel-rest' } as const;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** `navigator.serviceWorker` mínimo, con el controlador y el `ready` pedidos. */
function stubSW(controller: unknown, ready?: Promise<unknown>): void {
  vi.stubGlobal('navigator', { serviceWorker: { controller, ready } });
}

/** Deja correr los `.then()` encadenados dentro de `postToSW`. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('postToSW', () => {
  it('con la página controlada por el SW manda directo por el controlador', async () => {
    const post = vi.fn();
    const readyPost = vi.fn();
    stubSW({ postMessage: post }, Promise.resolve({ active: { postMessage: readyPost } }));

    expect(postToSW(MSG)).toBe(true);
    await flush();

    expect(post).toHaveBeenCalledWith(MSG);
    expect(readyPost).not.toHaveBeenCalled(); /* sin duplicar el mensaje */
  });

  it('sin controlador, en un entorno con SW, lo entrega cuando el SW esté listo', async () => {
    vi.stubEnv('PROD', true);
    vi.stubGlobal('location', { protocol: 'https:', hostname: 'pulso.app' });
    const readyPost = vi.fn();
    const ready = deferred<{ active: { postMessage: (m: unknown) => void } }>();
    stubSW(null, ready.promise);

    /* devuelvo YA: nadie espera a la promesa dentro de la UI */
    expect(postToSW(MSG)).toBe(true);
    expect(readyPost).not.toHaveBeenCalled();

    ready.resolve({ active: { postMessage: readyPost } });
    await flush();

    expect(readyPost).toHaveBeenCalledWith(MSG);
  });

  it('si el SW aún no está activo (`active` null) no lanza al entregarlo', async () => {
    vi.stubEnv('PROD', true);
    vi.stubGlobal('location', { protocol: 'https:', hostname: 'pulso.app' });
    const ready = deferred<{ active: null }>();
    stubSW(null, ready.promise);

    expect(postToSW(MSG)).toBe(true);
    ready.resolve({ active: null });
    await expect(flush()).resolves.toBeUndefined();
  });

  it('en un entorno SIN service worker registrado (dev) devuelve false', async () => {
    vi.stubEnv('PROD', false);
    const readyPost = vi.fn();
    stubSW(null, Promise.resolve({ active: { postMessage: readyPost } }));

    expect(postToSW(MSG)).toBe(false);
    await flush();

    expect(readyPost).not.toHaveBeenCalled(); /* el respaldo lo hace la página */
  });

  it('sin `navigator.serviceWorker` devuelve false', () => {
    vi.stubGlobal('navigator', {});

    expect(postToSW(MSG)).toBe(false);
  });

  it('sin navigator (tests en Node) devuelve false sin lanzar', () => {
    vi.stubGlobal('navigator', undefined);

    expect(postToSW(MSG)).toBe(false);
  });
});
