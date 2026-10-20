/**
 * `platform/install.ts`: captura de `beforeinstallprompt`, instalación y
 * detección de app instalada/SW. `window`, `navigator` y `location` se doblan
 * con objetos planos porque el entorno de tests es Node (sin jsdom).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { canInstall, hasSW, initInstall, install, installable, installed } from './install';

type Handler = (event: unknown) => void;

const listeners = new Map<string, Handler[]>();

function fakeWindow(matches: Record<string, boolean> = {}): Record<string, unknown> {
  return {
    addEventListener(type: string, handler: Handler): void {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    matchMedia(query: string): { matches: boolean } {
      return { matches: matches[query] === true };
    },
  };
}

function emit(type: string, event: unknown): void {
  for (const handler of listeners.get(type) ?? []) handler(event);
}

function promptEvent(outcome: string): {
  event: Record<string, unknown>;
  prompt: () => Promise<void>;
} {
  const prompt = vi.fn(() => Promise.resolve());
  return {
    prompt,
    event: {
      preventDefault: vi.fn(),
      prompt,
      userChoice: Promise.resolve({ outcome }),
    },
  };
}

beforeEach(async () => {
  listeners.clear();
  vi.stubGlobal('window', fakeWindow());
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('location', { protocol: 'https:' });
  await install(); /* consume un `deferred` que haya quedado de otro test */
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('initInstall / install', () => {
  it('captura beforeinstallprompt, cancela el banner y marca instalable', () => {
    initInstall();
    const { event } = promptEvent('accepted');

    emit('beforeinstallprompt', event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(canInstall()).toBe(true);
    expect(installable.value).toBe(true);
  });

  it('install() lanza prompt() y devuelve true si el usuario acepta', async () => {
    initInstall();
    const { event, prompt } = promptEvent('accepted');
    emit('beforeinstallprompt', event);

    await expect(install()).resolves.toBe(true);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(canInstall()).toBe(false);
    expect(installable.value).toBe(false);
  });

  it('devuelve false si el usuario rechaza o si no hay prompt pendiente', async () => {
    initInstall();
    const { event } = promptEvent('dismissed');
    emit('beforeinstallprompt', event);

    await expect(install()).resolves.toBe(false);
    await expect(install()).resolves.toBe(false); /* ya no queda evento */
  });

  it('appinstalled limpia el estado pendiente', () => {
    initInstall();
    emit('beforeinstallprompt', promptEvent('accepted').event);
    expect(canInstall()).toBe(true);

    emit('appinstalled', new Event('appinstalled'));

    expect(canInstall()).toBe(false);
    expect(installable.value).toBe(false);
  });
});

describe('installed', () => {
  it('detecta standalone y minimal-ui por matchMedia', () => {
    vi.stubGlobal('window', fakeWindow({ '(display-mode: standalone)': true }));
    expect(installed()).toBe(true);

    vi.stubGlobal('window', fakeWindow({ '(display-mode: minimal-ui)': true }));
    expect(installed()).toBe(true);
  });

  it('detecta la marca standalone de iOS y devuelve false si no hay ninguna', () => {
    vi.stubGlobal('window', fakeWindow());
    vi.stubGlobal('navigator', { standalone: true });
    expect(installed()).toBe(true);

    vi.stubGlobal('navigator', {});
    expect(installed()).toBe(false);
  });
});

describe('hasSW', () => {
  it('exige serviceWorker y protocolo http(s)', () => {
    vi.stubGlobal('navigator', { serviceWorker: {} });
    vi.stubGlobal('location', { protocol: 'https:' });
    expect(hasSW()).toBe(true);

    vi.stubGlobal('location', { protocol: 'file:' });
    expect(hasSW()).toBe(false);

    vi.stubGlobal('navigator', {});
    vi.stubGlobal('location', { protocol: 'https:' });
    expect(hasSW()).toBe(false);
  });
});
