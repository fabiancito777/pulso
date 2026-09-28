/**
 * Registro del service worker de la v2 (port del `init()` de `legacy/js/app.js`).
 *
 * La v1 registraba `sw.js` a pelo si el protocolo era http/https. Aquí además
 * hay dos guardas explícitas:
 *  - **solo producción**: en dev el SW estorba al HMR (sirve respuestas de la
 *    caché y hay que ir a DevTools → Application para desregistrarlo);
 *  - **solo https o localhost**: el navegador no da service worker en `file://`
 *    (doble clic en el HTML) ni en http de un dominio real.
 *
 * El worker en sí vive en `public/sw.js` (se copia tal cual al build, sin
 * pasar por Vite, porque no puede llevar imports ni hashes).
 */

/** Mensajes que entiende `public/sw.js` (contrato heredado de la v1). */
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

/**
 * Manda un mensaje al service worker controlando la página (`swPost()` de la
 * v1). Es el canal de los avisos de descanso (`notify` / `schedule-rest` /
 * `cancel-rest`); de momento queda disponible para cuando `state/session.ts`
 * conecte el timer con las notificaciones del sistema.
 *
 * @returns `false` si aún no hay un worker controlando la página
 */
export function postToSW(message: SWMessage): boolean {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
    const controller = navigator.serviceWorker.controller;
    if (!controller) return false;
    controller.postMessage(message);
    return true;
  } catch {
    return false;
  }
}
