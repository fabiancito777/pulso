/**
 * Mantener la sesión viva con el móvil bloqueado. Port de `U.keepAlive` y
 * `U.wakeLock` (`core.js:376-452`).
 *
 * Son las capas 2 y 3 del aviso de fin de descanso (la 1 es el pitido largo de
 * `platform/audio.ts`):
 *
 * - **keep-alive**: un `<audio>` en bucle con una pista de silencio mantiene la
 *   página como "reproductor", así el navegador no la congela al bloquear el
 *   móvil, el timer sigue corriendo y el pitido final suena. Es best-effort:
 *   donde el sistema no lo permita, el aviso fiable es el programado por el
 *   service worker (`schedule-rest`, en `state/session.ts`).
 *
 * Dos reglas que vienen de los fixes del ducking de Spotify (v1 `ff21864` y
 * `6361477`) y que DELEN juntas, porque las dos apuntan a lo mismo — el `<audio>`
 * pide el foco de audio y el sistema atenúa la música de fondo:
 *
 * 1. **solo se enciende mientras corre un descanso** (lo decide
 *    `state/session.ts`, no este módulo), nunca durante toda la sesión;
 * 2. **NO se publica `mediaSession.metadata`**: antes anunciaba «Pulso» como
 *    reproductor y le robaba los controles/AVRCP del bluetooth a Spotify. Al
 *    apagar se devuelve `playbackState = 'none'` para que el sistema sepa que
 *    ya no hay nada reproduciéndose.
 *
 * Y `keepAliveNeeded()` es la guarda de `6361477`: donde hay service worker que
 * programe el aviso (cualquier navegador moderno que no sea iOS) el `<audio>` no
 * hace falta, así que no se enciende ni ducking ni controles robados.
 * - **wake lock**: `navigator.wakeLock.request('screen')` evita que la pantalla
 *   se apague mientras entrenas. El sistema lo suelta al ocultar la página, así
 *   que al volver a primer plano se vuelve a pedir.
 *
 * Los reintentos (`retry`/`refresh`) se cablean SOLO aquí — al primer `on()` —,
 * así el shell de la app no tiene que saber de esto: el navegador bloquea el
 * `play()` hasta que haya un gesto del usuario, y la primera recarga con la
 * sesión en curso pasa justo por ahí.
 *
 * Nada de esto se ejecuta al importar el módulo: todos los accesos están dentro
 * de funciones con su guarda, para que los tests de dominio puedan importar la
 * cadena sin navegador.
 */

type WakeLockSentinelLike = {
  release: () => Promise<void>;
  addEventListener?: (type: string, listener: () => void) => void;
};

type WakeLockLike = {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>;
};

/** WAV de silencio (~1 s, 8 kHz, PCM unsigned): lo de siempre, sin assets. */
function silentWav(): string | null {
  try {
    const sr = 8000;
    const n = sr;
    const buf = new ArrayBuffer(44 + n);
    const dv = new DataView(buf);
    const str = (off: number, s: string): void => {
      for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
    };
    str(0, 'RIFF');
    dv.setUint32(4, 36 + n, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true);
    dv.setUint32(28, sr, true);
    dv.setUint16(32, 1, true);
    dv.setUint16(34, 8, true);
    str(36, 'data');
    dv.setUint32(40, n, true);
    for (let i = 0; i < n; i++) dv.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  } catch {
    return null;
  }
}

let el: HTMLAudioElement | null = null;
let url: string | null = null;
let wired = false;
let sentinel: WakeLockSentinelLike | null = null;
let wantWake = false;

/** ¿Es iOS o iPadOS (que se hace pasar por macOS con ratón táctil)? */
function isIOS(): boolean {
  try {
    const ua = navigator.userAgent || '';
    return (
      /iphone|ipad|ipod/i.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
  } catch {
    return false;
  }
}

/**
 * ¿Hace falta el `<audio>` de silencio? (v1 `6361477`, `trainer.js:keepAlive`).
 *
 * Solo donde NO hay un service worker que programe el aviso: en Android moderno
 * la notificación la lanza el SW **sin pedir foco de audio**, así que encender el
 * `<audio>` ahí solo daba ducking. Queda como último recurso en navegadores sin
 * SW y en iOS, que no ejecuta el SW en segundo plano.
 */
export function keepAliveNeeded(): boolean {
  try {
    if (typeof navigator === 'undefined') return true;
    if (!('serviceWorker' in navigator)) return true;
    return isIOS();
  } catch {
    return true;
  }
}

/** Tras recargar no hubo gesto y el navegador puede haber bloqueado el play(). */
export function keepAliveRetry(): void {
  try {
    if (!el || !el.paused) return;
    void el.play().catch(() => {
      /* noop: se reintenta en el próximo toque */
    });
  } catch {
    /* noop */
  }
}

function wakeLockRefresh(): void {
  if (wantWake && !sentinel) void wakeLockOn();
}

/**
 * Cablea los dos reintentos de la v1 (`app.js:135/270`): al primer toque y al
 * volver a primer plano. Una sola vez y para siempre, igual que en la v1.
 */
function wire(): void {
  if (wired || typeof document === 'undefined') return;
  wired = true;
  document.addEventListener('click', keepAliveRetry);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    wakeLockRefresh();
    keepAliveRetry();
  });
}

/**
 * Enciende el keep-alive. Sin etiqueta ni `mediaSession`: no hay nada que
 * anunciar (ver la cabecera del módulo) — la v1 dejó `label()` vacío por el
 * mismo motivo.
 */
export function keepAliveOn(): void {
  try {
    if (typeof document === 'undefined') return;
    wire();
    if (el) return;
    url ??= silentWav();
    if (!url) return;
    const audio = document.createElement('audio');
    audio.src = url;
    audio.loop = true;
    audio.setAttribute('playsinline', '');
    audio.style.display = 'none';
    document.body.appendChild(audio);
    el = audio;
    void audio.play().catch(() => {
      /* sin gesto previo: lo reintenta `keepAliveRetry` */
    });
  } catch {
    /* noop: sin keep-alive sigue el SW */
  }
}

export function keepAliveOff(): void {
  try {
    if (el) {
      el.pause();
      el.remove();
    }
    el = null;
    /* Devolvemos los controles multimedia a quien los tuviera (Spotify…): sin
       pista no hay nada que anunciar, y `playbackState = 'none'` le dice al
       sistema que esta página ya no reproduce nada (la v1 solo dejaba el
       metadata en null y el sistema seguía creyendo que éramos el reproductor). */
    if (typeof navigator !== 'undefined' && navigator.mediaSession) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
    }
  } catch {
    /* noop */
  }
}

/**
 * Pide el bloqueo de pantalla. `want` queda encendido aunque el sistema lo
 * suelte: así `wakeLockRefresh()` lo vuelve a pedir al volver a primer plano.
 */
export async function wakeLockOn(): Promise<void> {
  wantWake = true;
  try {
    if (typeof navigator === 'undefined' || sentinel) return;
    const wl = (navigator as unknown as { wakeLock?: WakeLockLike }).wakeLock;
    if (!wl?.request) return;
    sentinel = await wl.request('screen');
    sentinel.addEventListener?.('release', () => {
      sentinel = null;
    });
  } catch {
    /* noop: sin wake lock (permiso, pestaña oculta…) el aviso va por el SW */
  }
}

export function wakeLockOff(): void {
  wantWake = false;
  try {
    void sentinel?.release();
  } catch {
    /* noop */
  }
  sentinel = null;
}
