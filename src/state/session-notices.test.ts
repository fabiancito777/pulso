/**
 * Las capas de aviso con el móvil bloqueado en `state/session.ts`, portadas de
 * los tres fixes de la v1 (`ff21864`, `e2c49b9`, `6361477`):
 *
 * 1. el keep-alive de audio (**no** se enciende al empezar la sesión, que es lo
 *    que dejaba el `<audio>` sonando toda la sesión atenuando Spotify) se
 *    enciende con `startRestTimer` y se apaga al terminar, saltarlo o cerrar;
 * 2. la guarda de "Android con SW no necesita keep-alive" (`keepAliveNeeded`);
 * 3. `testRestNotice`, el botón «Probar aviso» de Ajustes.
 *
 * Se mockean `platform/keepAlive` (para CONTAR encendidos/apagados: en Node no
 * hay DOM que reproducir) y `platform/sw` (para ver los mensajes que se mandan),
 * pero `keepAliveNeeded` sigue siendo el de verdad — esa es la guarda que hay
 * que probar. Mismo patrón que `store.test.ts`: `localStorage` simulado ANTES
 * del import dinámico.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as KeepAliveModule from '@/platform/keepAlive';

const calls = vi.hoisted(() => ({
  on: [] as string[],
  off: 0,
  sw: [] as Record<string, unknown>[],
}));

vi.mock('@/platform/keepAlive', async (importOriginal) => {
  const actual = await importOriginal<typeof KeepAliveModule>();
  return {
    ...actual /* `keepAliveNeeded` y wake lock se quedan los de verdad */,
    keepAliveOn: (): void => {
      calls.on.push('on');
    },
    keepAliveOff: (): void => {
      calls.off += 1;
    },
  };
});

vi.mock('@/platform/sw', () => ({
  postToSW: (message: Record<string, unknown>): boolean => {
    calls.sw.push(message);
    return true;
  },
  registerSW: (): void => undefined,
}));

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

/* El descanso sale de `endsAt - Date.now()`, así que los tests de "terminar"
   mueven el reloj en vez de esperar 90 s de verdad. */
vi.useFakeTimers({ toFake: ['Date'] });
const T0 = Date.now();

const firstId = (): string => store.exercises.value[0]?.id ?? '';

/** Arranca una sesión con un ejercicio y su primera serie pendiente. */
function startSession(): void {
  session.startFromPlan([{ exId: firstId(), sets: 2 }], { name: 'Empuje A' });
}

beforeEach(() => {
  mem.clear();
  store.writeState(store.defaultState());
  store.refresh();
  vi.setSystemTime(T0);
  /* navegador por defecto SIN service worker (el de Node no lo tiene); los tests
     de la guarda stubbean el suyo. OJO: no `unstubAllGlobals`, que borraría el
     `localStorage` simulado de arriba. */
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' });
  calls.on.length = 0;
  calls.off = 0;
  calls.sw.length = 0;
});

afterEach(() => {
  if (session.rest.value.running) session.stopRestTimer();
  if (session.active.value) session.discardSession();
});

describe('keep-alive: SOLO durante el descanso', () => {
  it('empezar una sesión NO enciende el keep-alive (evita el ducking permanente)', () => {
    startSession();

    expect(calls.on).toHaveLength(0);
  });

  it('arrancar el descanso lo enciende', () => {
    startSession();

    session.toggleSetAt(0, 0);

    expect(session.rest.value.running).toBe(true);
    expect(calls.on.length).toBeGreaterThan(0);
  });

  it('terminar el descanso lo apaga (el pitido ya está programado)', () => {
    startSession();
    session.toggleSetAt(0, 0);
    const endsAt = session.rest.value.endsAt;
    expect(calls.off).toBe(0);

    vi.setSystemTime(endsAt + 1000);
    session.loop();

    expect(session.rest.value.doneFired).toBe(true);
    expect(calls.off).toBeGreaterThan(0);
  });

  it('saltar el descanso (desmarcar) lo apaga', () => {
    startSession();
    session.toggleSetAt(0, 0);
    expect(calls.on.length).toBeGreaterThan(0);

    session.toggleSetAt(0, 0); /* desmarca: cancela el descanso */

    expect(session.rest.value.running).toBe(false);
    expect(calls.off).toBeGreaterThan(0);
  });

  it('cerrar o descartar la sesión lo apaga', () => {
    startSession();
    session.toggleSetAt(0, 0);
    calls.off = 0;

    session.discardSession();

    expect(calls.off).toBeGreaterThan(0);
    expect(calls.on).toHaveLength(1); /* solo el del descanso, nunca el de sesión */
  });

  it('cuando el aviso se cierra solo a los 30 s también se apaga', () => {
    startSession();
    session.toggleSetAt(0, 0);
    const endsAt = session.rest.value.endsAt;

    vi.setSystemTime(endsAt + 1000);
    session.loop(); /* fin: apaga */
    const trasFin = calls.off;

    vi.setSystemTime(endsAt + 31_500);
    session.loop(); /* el aviso se cierra solo: vuelve a apagar */

    expect(session.rest.value.running).toBe(false);
    expect(calls.off).toBeGreaterThan(trasFin);
  });

  it('«+15 s» tras el fin arranca cuenta nueva y lo vuelve a encender', () => {
    startSession();
    session.toggleSetAt(0, 0);
    vi.setSystemTime(session.rest.value.endsAt + 1000);
    session.loop();
    const trasFin = calls.on.length;

    session.addRestSeconds(15);

    expect(session.rest.value.running).toBe(true);
    expect(calls.on.length).toBeGreaterThan(trasFin);
  });

  it('el aviso del descanso se manda al SW en cada arranque y se cancela al pararlo', () => {
    startSession();
    session.toggleSetAt(0, 0);

    expect(calls.sw.at(-1)).toMatchObject({ type: 'schedule-rest', tag: 'pulso-rest' });

    session.stopRestTimer();

    expect(calls.sw.at(-1)).toMatchObject({ type: 'cancel-rest' });
  });
});

describe('keep-alive: guarda de Android con service worker', () => {
  it('con service worker y NO iOS no se enciende (el aviso lo da el SW)', () => {
    vi.stubGlobal('navigator', {
      serviceWorker: {},
      userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120',
    });
    startSession();

    session.toggleSetAt(0, 0);

    expect(session.rest.value.running).toBe(true);
    expect(calls.on).toHaveLength(0);
    expect(calls.off).toBeGreaterThan(0); /* se asegura de apagarlo */
  });

  it('sin service worker se enciende (es el único aviso posible)', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120',
    });
    startSession();

    session.toggleSetAt(0, 0);

    expect(calls.on.length).toBeGreaterThan(0);
  });

  it('con service worker en iOS se enciende (iOS no ejecuta el SW en segundo plano)', () => {
    vi.stubGlobal('navigator', {
      serviceWorker: {},
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    });
    startSession();

    session.toggleSetAt(0, 0);

    expect(calls.on.length).toBeGreaterThan(0);
  });

  it('`keepAwake: false` lo apaga del todo', () => {
    store.patchSettings({ keepAwake: false });
    startSession();

    session.toggleSetAt(0, 0);

    expect(calls.on).toHaveLength(0);
  });
});

describe('testRestNotice (botón «Probar aviso» de Ajustes)', () => {
  it('programa un aviso de prueba en el SW a los 5 s con tag propio', () => {
    const antes = calls.sw.length;

    expect(session.testRestNotice()).toBe('ok');

    const msg = calls.sw[antes];
    expect(msg).toMatchObject({
      type: 'schedule-rest',
      at: T0 + session.TEST_NOTICE_SEC * 1000,
      title: 'Aviso de prueba',
      tag: 'pulso-test',
    });
    expect(msg?.tag).not.toBe('pulso-rest'); /* no puede pisar el aviso real */
  });

  it('no pisa un descanso en curso (el SW solo guarda uno)', () => {
    startSession();
    session.toggleSetAt(0, 0);
    const mandados = calls.sw.length;

    expect(session.testRestNotice()).toBe('rest-running');
    expect(calls.sw).toHaveLength(mandados);
  });

  it('sin «Notificaciones del sistema» no programa nada', () => {
    store.patchSettings({ notify: false });
    const mandados = calls.sw.length;

    expect(session.testRestNotice()).toBe('notify-off');
    expect(calls.sw).toHaveLength(mandados);
  });

  it('mínimo 3 segundos (igual que la v1: `Math.max(3, …)`)', () => {
    expect(session.testRestNotice(1)).toBe('ok');
    expect(calls.sw.at(-1)).toMatchObject({ at: T0 + 3000 });
  });
});
