/**
 * `platform/notify.ts`: permiso, aviso de la página y aviso de fin de descanso.
 *
 * Sin DOM real: `window`, `document`, `navigator` y `Notification` se doblan
 * con objetos planos. Lo que se fija es la elección de capa (SW si la pestaña
 * está oculta y hay controlador; página si está visible o si el SW no entrega).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { notifyEnd, pageNotify, requestNotifyPermission } from './notify';

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn(() => Promise.resolve('granted' as NotificationPermission));
  static instances: FakeNotification[] = [];

  onclick: (() => void) | null = null;
  readonly close = vi.fn();

  constructor(
    readonly title: string,
    readonly options: NotificationOptions = {},
  ) {
    FakeNotification.instances.push(this);
  }
}

const focus = vi.fn();

beforeEach(() => {
  FakeNotification.permission = 'granted';
  FakeNotification.instances = [];
  FakeNotification.requestPermission.mockClear();
  focus.mockClear();
  vi.stubGlobal('Notification', FakeNotification);
  vi.stubGlobal('window', { Notification: FakeNotification, focus });
  vi.stubGlobal('document', { hidden: false });
  vi.stubGlobal('navigator', { serviceWorker: { controller: { postMessage: vi.fn() } } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestNotifyPermission', () => {
  it('pide permiso solo cuando está en default', () => {
    FakeNotification.permission = 'default';
    expect(requestNotifyPermission()).toBe('requested');
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('si ya está concedido o denegado no vuelve a preguntar', () => {
    FakeNotification.permission = 'granted';
    expect(requestNotifyPermission()).toBe('granted');
    FakeNotification.permission = 'denied';
    expect(requestNotifyPermission()).toBe('denied');
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
  });

  it('sin window devuelve unsupported', () => {
    vi.stubGlobal('window', undefined);
    expect(requestNotifyPermission()).toBe('unsupported');
  });
});

describe('pageNotify', () => {
  it('con permiso crea la notificación en la página', () => {
    expect(pageNotify('Fin', 'Descanso terminado')).toBe(true);
    expect(FakeNotification.instances).toHaveLength(1);
    expect(FakeNotification.instances[0]?.title).toBe('Fin');
    expect(FakeNotification.instances[0]?.options.body).toBe('Descanso terminado');
  });

  it('sin permiso devuelve false y no crea nada', () => {
    FakeNotification.permission = 'denied';
    expect(pageNotify('Fin', 'x')).toBe(false);
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it('el clic enfoca la app y cierra el aviso', () => {
    pageNotify('Fin', 'x');
    FakeNotification.instances[0]?.onclick?.();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(FakeNotification.instances[0]?.close).toHaveBeenCalledTimes(1);
  });
});

describe('notifyEnd', () => {
  it('con la pestaña visible avisa en la página y no manda nada al SW', () => {
    const post = vi.fn();
    vi.stubGlobal('navigator', { serviceWorker: { controller: { postMessage: post } } });

    expect(notifyEnd('Fin', 'Descanso terminado')).toBe(true);

    expect(FakeNotification.instances).toHaveLength(1);
    expect(post).not.toHaveBeenCalled();
  });

  it('con la pestaña oculta y controlador delega en el SW', () => {
    const post = vi.fn();
    vi.stubGlobal('navigator', { serviceWorker: { controller: { postMessage: post } } });
    vi.stubGlobal('document', { hidden: true });

    expect(notifyEnd('Fin', 'Descanso terminado')).toBe(true);

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'notify', title: 'Fin', body: 'Descanso terminado' }),
    );
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it('sin controlador (dev) cae al aviso de la página', () => {
    vi.stubGlobal('navigator', { serviceWorker: { controller: null } });
    vi.stubGlobal('document', { hidden: true });

    expect(notifyEnd('Fin', 'Descanso terminado')).toBe(true);

    expect(FakeNotification.instances).toHaveLength(1);
  });

  it('sin permiso devuelve false', () => {
    FakeNotification.permission = 'denied';
    expect(notifyEnd('Fin', 'x')).toBe(false);
  });
});
