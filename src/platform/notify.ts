/**
 * Permiso y notificaciones del sistema. Port de lo que la v1 hacía suelto en
 * `legacy/js/app.js:196` (al activar el ajuste) y `:1255` (al arrancar una
 * sesión): aquí es una sola función para que Ajustes (y quien arranque sesión)
 * la llamen SIN envolver en `setTimeout` — Safari iOS solo permite
 * `requestPermission` dentro de un gesto del usuario.
 *
 * Solo se pide si el permiso está en `default`; si ya está concedido o
 * denegado se devuelve tal cual y la UI avisa (la v1 se callaba).
 *
 * A eso se suman `pageNotify` y `notifyEnd` (`core.js:370`, `trainer.js:285-300`),
 * las dos formas de lanzar el aviso:
 *
 * - `pageNotify`: `new Notification(...)` en la propia página, con el click
 *   enfocando la app (la del service worker ya hace eso en `notificationclick`).
 * - `notifyEnd`: fin de descanso. Con la pestaña OCULTA el aviso lo manda el
 *   service worker (`notify`), que además ya tenía la hora programada; si el SW no
 *   controla la página (dev, `file://`, primera carga) se notifica en la página.
 *   Con la pestaña VISIBLE manda `pageNotify`, igual que la v1: el sistema no
 *   muestra la notificación si la app está delante y el pitido ya avisa.
 *
 * Todo envuelto en try/catch y con el permiso comprobado dentro: un aviso que no
 * se puede lanzar no debe romper el descanso. El ajuste `notify` NO se lee aquí
 * (un módulo de plataforma no mira el store): quien llama decide.
 */
import { REST_NOTICE_TAG } from '@/domain/rest';
import { postToSW } from '@/platform/sw';

/** Lo que se puede saber del permiso tras llamar (el resultado real llega después). */
export type NotifyPermissionState = 'unsupported' | 'default' | 'requested' | 'granted' | 'denied';

/**
 * Pide permiso para notificaciones si aún no se ha pedido. Nunca lanza y no
 * espera la respuesta (`requestPermission` es una promesa en los navegadores
 * modernos y un callback en los viejos): el que necesite el resultado final
 * vuelve a leer `Notification.permission`.
 */
export function requestNotifyPermission(): NotifyPermissionState {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    const current = Notification.permission;
    if (current === 'granted' || current === 'denied') return current;
    /* sin await: el diálogo tiene que salir del propio gesto del usuario */
    const asked = Notification.requestPermission() as unknown;
    if (asked && typeof (asked as Promise<NotificationPermission>).catch === 'function') {
      void (asked as Promise<NotificationPermission>).catch(() => undefined);
    }
    return 'requested';
  } catch {
    return 'unsupported';
  }
}

export interface NotifyOptions {
  /** Mismo `tag` que la v1: una sola notificación de descanso viva. */
  tag?: string;
}

/** Notificación en la propia página. `false` si no hay permiso o no se puede. */
export function pageNotify(title: string, body: string, opts: NotifyOptions = {}): boolean {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    if (Notification.permission !== 'granted') return false;
    const note = new Notification(title, {
      body,
      tag: opts.tag ?? REST_NOTICE_TAG,
      silent: false,
    });
    note.onclick = () => {
      try {
        window.focus();
        note.close();
      } catch {
        /* noop */
      }
    };
    return true;
  } catch {
    return false;
  }
}

/**
 * Aviso de FIN de descanso: SW si la pestaña está oculta, página si está visible
 * (o si el SW no controla esta página). `false` si no hay permiso.
 */
export function notifyEnd(title: string, body: string, opts: NotifyOptions = {}): boolean {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    if (Notification.permission !== 'granted') return false;
    if (typeof document !== 'undefined' && document.hidden) {
      const sent = postToSW({
        type: 'notify',
        title,
        body,
        tag: opts.tag ?? REST_NOTICE_TAG,
        requireInteraction: true,
      });
      if (sent) return true;
    }
    return pageNotify(title, body, opts);
  } catch {
    return false;
  }
}
