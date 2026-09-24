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
 */
import { clamp, num } from '@/domain/num';

export interface SoundSettings {
  sound?: boolean;
  volume?: number;
}

export type BeepKind = 'end' | 'tick' | 'done' | 'tap';

/** Frecuencias de cada aviso (Hz) y cuántos pita. `end` es el largo. */
const TONES: Record<BeepKind, { freq: number; count: number; gap: number; dur: number }> = {
  end: { freq: 988, count: 5, gap: 0.7, dur: 0.5 },
  done: { freq: 1319, count: 3, gap: 0.22, dur: 0.16 },
  tick: { freq: 660, count: 1, gap: 0, dur: 0.06 },
  tap: { freq: 880, count: 1, gap: 0, dur: 0.04 },
};

let ctx: AudioContext | null = null;

/** El AudioContext solo se puede abrir con un gesto del usuario: se llama en los clicks. */
export function ensureAudio(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
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
}

export function vibrate(pattern: number | number[], enabled = true): void {
  if (!enabled) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* sin vibración (o sin permiso): el aviso sonoro sigue haciendo el trabajo */
  }
}
