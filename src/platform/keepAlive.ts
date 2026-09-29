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

/** Lo que enseja el control de medios (nombre de la app en el lockscreen). */
function meta(title: string): void {
  try {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
    if (typeof MediaMetadata === 'undefined') return;
    navigator.mediaSession.metadata = new MediaMetadata({ title, artist: 'Pulso' });
  } catch {
    /* noop */
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

/** Enciende el keep-alive (y actualiza la etiqueta si ya estaba encendido). */
export function keepAliveOn(label?: string): void {
  try {
    if (typeof document === 'undefined') return;
    const title = label || 'Entrenamiento';
    wire();
    if (el) {
      meta(title);
      return;
    }
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
    meta(title);
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
    if (typeof navigator !== 'undefined' && navigator.mediaSession) {
      navigator.mediaSession.metadata = null;
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
