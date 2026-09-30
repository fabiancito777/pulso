/**
 * Sonido y vibración. Portado de `U.beep`/`U.vibrate` de la v1 (`legacy/js/core.js`).
 *
 * Vive en `src/platform/` y no en `src/domain/` porque toca la Web Audio API y el
 * navegador: el dominio tiene que poder probarse sin nada de esto.
 *
 * El aviso de fin de descanso (`'end'`) son **5 pitidos de ~3,5 s** a propósito: con
 * el móvil en el bolsillo un beep corto se pierde. Es la primera de las tres capas
 * del aviso (las otras dos —keep-alive de audio y notificación programada en el
 * service worker— llegan con el bloque de PWA).
 *
 * Los ajustes se leen por parámetro (`sound`, `volume`) en vez de tirar del store:
 * un módulo de plataforma no debería saber cómo se guardan las cosas, y así se puede
 * probar en el navegador subiendo el volumen a mano.
 *
 * El `AudioContext` **no se queda abierto** (v1 `e2c49b9`): un contexto en idle
 * retiene la salida de audio y varios Android dejaban la música de fondo
 * (Spotify…) atenuada de forma permanente. `ensureAudio()` lo desbloquea con el
 * gesto y lo suspende solo a los 1,5 s; `beep()` programa el suyo propio para no
 * cortar la secuencia de pitidos. `vibrate` no toca el contexto (va por la
 * vibroalerta del dispositivo), así que no necesita nada de esto.
 */
import { clamp, num } from '@/domain/num';

export interface SoundSettings {
  sound?: boolean;
  volume?: number;
}

export type BeepKind = 'end' | 'tick' | 'done' | 'tap';

/** Frecuencias de cada aviso (Hz) y cuántos pita. `end` es el largo. */
const TONES: Record<
  BeepKind,
  { freq: number; count: number; gap: number; dur: number; releaseMs: number }
> = {
  /* `releaseMs` es cuánto hay pitidos sonando o programados (v1 `U.audio.release`):
     pasado ese tiempo el AudioContext se suspende solo. Cubre la secuencia entera
     con margen, para no cortarla. */
  end: { freq: 988, count: 5, gap: 0.7, dur: 0.5, releaseMs: 4200 },
  done: { freq: 1319, count: 3, gap: 0.22, dur: 0.16, releaseMs: 800 },
  tick: { freq: 660, count: 1, gap: 0, dur: 0.06, releaseMs: 600 },
  tap: { freq: 880, count: 1, gap: 0, dur: 0.04, releaseMs: 500 },
};

/** Un `AudioContext` en idle también retiene la salida: a los 1,5 s se suspende. */
const IDLE_SUSPEND_MS = 1500;

let ctx: AudioContext | null = null;

/** Hasta cuándo hay pitidos sonando o programados (marca de tiempo). */
let busyUntil = 0;
let suspendTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Programa el auto-suspend (v1 `_armSuspend`): al dispararse comprueba que ya no
 * haya pitidos pendientes (`now >= busyUntil`) y que el contexto siga `running`.
 * Cada llamada cancela la anterior, así que el último gesto/pitido manda.
 */
function armSuspend(c: AudioContext, ms: number): void {
  try {
    if (suspendTimer !== null) clearTimeout(suspendTimer);
    suspendTimer = setTimeout(
      () => {
        suspendTimer = null;
        try {
          if (Date.now() >= busyUntil && c.state === 'running') void c.suspend();
        } catch {
          /* noop */
        }
      },
      Math.max(0, ms),
    );
  } catch {
    /* noop */
  }
}

/**
 * Suelta el foco de audio cuando los pitidos ya sonaron: un AudioContext abierto
 * retiene la salida y, con Spotify u otro reproductor de fondo, el sistema
 * mantiene la música atenuada (ducking) hasta que se suspende.
 */
function release(c: AudioContext, ms: number): void {
  const wait = Math.max(0, ms);
  busyUntil = Date.now() + wait;
  armSuspend(c, wait);
}

/**
 * El AudioContext solo se puede abrir con un gesto del usuario: se llama en los
 * clicks. NO deja el contexto abierto: si no hay pitidos pendientes se suspende
 * solo al poco (`IDLE_SUSPEND_MS`), que es lo que evita el ducking tras cada
 * gesto (v1 `e2c49b9`).
 */
export function ensureAudio(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    armSuspend(ctx, IDLE_SUSPEND_MS);
    return ctx;
  } catch {
    return null;
  }
}

export function beep(kind: BeepKind = 'tap', opts: SoundSettings = {}): void {
  if (opts.sound === false) return;
  const c = ensureAudio();
  if (!c) return;
  const tone = TONES[kind] ?? TONES.tap;
  const volume = clamp(num(opts.volume, 0.6), 0, 1);
  const now = c.currentTime;
  for (let i = 0; i < tone.count; i++) {
    const at = now + i * tone.gap;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = tone.freq;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(volume, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + tone.dur);
    osc.connect(gain).connect(c.destination);
    osc.start(at);
    osc.stop(at + tone.dur + 0.02);
  }
  /* la secuencia ya está programada: se suelta la salida al terminar de sonar */
  release(c, tone.releaseMs);
}

export function vibrate(pattern: number | number[], enabled = true): void {
  if (!enabled) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* sin vibración (o sin permiso): el aviso sonoro sigue haciendo el trabajo */
  }
}
