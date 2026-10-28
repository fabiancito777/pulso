/**
 * Registro del service worker.
 *
 * Hay dos guardas explícitas:
 *  - **solo producción**: en dev el SW estorba al HMR (sirve respuestas de la
 *    caché y hay que ir a DevTools → Application para desregistrarlo);
 *  - **solo https o localhost**: el navegador no da service worker en `file://`
 *    (doble clic en el HTML) ni en http de un dominio real.
 *
 * El worker en sí vive en `public/sw.js` (se copia tal cual al build, sin
 * pasar por Vite, porque no puede llevar imports ni hashes).
 */

/** Mensajes que entiende `public/sw.js` (contrato heredado ). */
export type SWMessage =
  | { type: 'notify'; title?: string; body?: string; tag?: string; requireInteraction?: boolean }
  | { type: 'schedule-rest'; at: number; title?: string; body?: string; tag?: string }
  | { type: 'cancel-rest' };

function canRegisterSW(): boolean {
  if (!import.meta.env.PROD) return false;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  const { protocol, hostname } = location;
  return protocol === 'https:' || hostname === 'localhost' || hostname === '127.0.0.1';
}

/** Registra `./sw.js`. Silencioso a propósito: sin SW la app sigue funcionando. */
export function registerSW(): void {
  if (!canRegisterSW()) return;
  try {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* noop: sin permiso, sin conexión o alcance inválido no hay offline */
    });
  } catch {
    /* noop */
  }
}

/** Tiempo máximo esperando `serviceWorker.ready` para la entrega diferida. */
export const SW_READY_TIMEOUT_MS = 3000;

/**
 * Manda un mensaje al service worker (`swPost()` ). Es el canal de los
 * avisos de descanso (`notify` / `schedule-rest` / `cancel-rest`).
 *
 * Dos vías, igual que  (`e2c49b9`):
 *
 * 1. la página está controlada por el SW → `controller.postMessage` y `true`;
 * 2. **sin controlador** (p. ej. tras actualizar la PWA sin recargar) el mensaje
 *    se perdía en silencio: se intenta entregar en cuanto `serviceWorker.ready`
 *    resuelva, con timeout. Como esa entrega NO está confirmada, se devuelve
 *    `false` para que el respaldo de la página (`pageNotify`) actúe. Si el
 *    `ready` llega, el mensaje sale igualmente y el `tag` compartido evita
 *    duplicar el aviso visible.
 *
 * La vía 2 solo se intenta donde `canRegisterSW()`: en dev no registramos SW y
 * `ready` no se cumpliría nunca.
 *
 * @returns `true` solo si la entrega al controlador fue inmediata y confirmada
 */
export function postToSW(message: SWMessage): boolean {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
    const sw = navigator.serviceWorker;
    if (sw.controller) {
      sw.controller.postMessage(message);
      return true;
    }
    if (!canRegisterSW()) return false;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), SW_READY_TIMEOUT_MS);
    });
    void Promise.race([sw.ready.catch(() => null), timeout])
      .then((reg) => {
        if (!reg) return;
        try {
          reg.active?.postMessage(message);
        } catch {
          /* noop */
        }
      })
      .finally(() => {
        if (timer) clearTimeout(timer);
      });
    return false;
  } catch {
    return false;
  }
}
