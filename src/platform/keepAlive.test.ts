/**
 * `platform/keepAlive.ts`: el `<audio>` de silencio que mantiene viva la página
 * con el móvil bloqueado.
 *
 * Lo que hay que fijar aquí es lo que rompía Spotify en la v1 (fixes `ff21864`
 * y `6361477`):
 *
 * - `keepAliveNeeded()`: la guarda de "en Android con SW no hace falta" — ahí el
 *   aviso lo programa el service worker SIN pedir foco de audio, y el `<audio>`
 *   solo daba ducking. Queda como último recurso sin SW y en iOS;
 * - que encender el keep-alive NO publique `mediaSession.metadata` (le robaba
 *   los controles/AVRCP del bluetooth a Spotify) y que apagarlo devuelva
 *   `playbackState = 'none'`.
 *
 * Mismo patrón que `audio.test.ts`: stubs de `navigator`/`document`/`URL` ANTES
 * del import dinámico no hacen falta aquí (todo se lee en el momento de la
 * llamada), pero sí `vi.unstubAllGlobals()` entre tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { keepAliveNeeded, keepAliveOff, keepAliveOn } = await import('./keepAlive');

/** Lo mínimo de `navigator.mediaSession` que usa el módulo. */
interface MediaStub {
  metadata: unknown;
  playbackState: string;
}

const media: MediaStub = { metadata: { title: 'otra app' }, playbackState: 'playing' };
let appended = 0;

beforeEach(() => {
  media.metadata = { title: 'otra app' };
  media.playbackState = 'playing';
  appended = 0;
});

afterEach(() => {
  keepAliveOff(); /* el `el` del módulo vive entre tests */
  vi.unstubAllGlobals();
});

/** `navigator` mínimo para probar la guarda de soporte de SW. */
function stubNavigator(extra: Record<string, unknown> = {}): void {
  vi.stubGlobal('navigator', extra);
}

describe('keepAliveNeeded', () => {
  it('sin navigator hace falta (no hay nada que programe el aviso)', () => {
    vi.stubGlobal('navigator', undefined);
    expect(keepAliveNeeded()).toBe(true);
  });

  it('navegador sin service worker hace falta (es el último recurso)', () => {
    stubNavigator({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' });
    expect(keepAliveNeeded()).toBe(true);
  });

  it('Android CON service worker NO hace falta (el aviso lo da el SW)', () => {
    stubNavigator({
      serviceWorker: {},
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/120',
    });
    expect(keepAliveNeeded()).toBe(false);
  });

  it('iOS CON service worker hace falta (no ejecuta el SW en segundo plano)', () => {
    stubNavigator({
      serviceWorker: {},
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    });
    expect(keepAliveNeeded()).toBe(true);
  });

  it('iPadOS que se hace pasar por macOS hace falta (maxTouchPoints > 1)', () => {
    stubNavigator({
      serviceWorker: {},
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    });
    expect(keepAliveNeeded()).toBe(true);
  });

  it('escritorio con service worker NO hace falta', () => {
    stubNavigator({
      serviceWorker: {},
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      platform: 'Win32',
      maxTouchPoints: 0,
    });
    expect(keepAliveNeeded()).toBe(false);
  });
});

describe('mediaSession: no robar los controles a Spotify', () => {
  beforeEach(() => {
    stubNavigator({ serviceWorker: {}, userAgent: 'Android', mediaSession: media });
    /* `URL.createObjectURL` existe en Node, así que el WAV de silencio se genera
       de verdad y solo hay que stubbir el DOM que lo reproduce */
    vi.stubGlobal('document', {
      createElement: () => ({
        src: '',
        loop: false,
        style: {} as Record<string, string>,
        setAttribute: (): void => undefined,
        play: (): Promise<void> => {
          appended += 1;
          return Promise.resolve();
        },
        pause: (): void => undefined,
        remove: (): void => undefined,
      }),
      body: {
        appendChild: (): void => {
          appended += 1;
        },
      },
      addEventListener: (): void => undefined,
    });
  });

  it('keepAliveOn no publica metadata ni toca el playbackState', () => {
    keepAliveOn();

    expect(media.metadata).toEqual({ title: 'otra app' });
    expect(media.playbackState).toBe('playing');
    expect(appended).toBeGreaterThan(0); /* sí monta el <audio> (no estaba roto) */
  });

  it('keepAliveOff devuelve los controles: metadata null y playbackState none', () => {
    keepAliveOn();
    media.metadata = { title: 'Pulso', artist: 'Pulso' };
    media.playbackState = 'playing';

    keepAliveOff();

    expect(media.metadata).toBeNull();
    expect(media.playbackState).toBe('none');
  });

  it('keepAliveOff sin keep-alive encendido también limpia los controles', () => {
    keepAliveOff();

    expect(media.metadata).toBeNull();
    expect(media.playbackState).toBe('none');
  });
});
