/**
 * `platform/audio.ts`: el esqueleto de los avisos sonoros.
 *
 * Port de la única comprobación del auto-test de la v1 que no pinta nada
 * (`audio: el pitido de fin de descanso dura ~3,5 s`, `legacy/js/app.js`), aquí
 * contra un `AudioContext` de mentira que solo registra cuándo suena cada
 * oscilador: lo que hay que fijar es la CADENCIA (5 pitidos que acaban a los
 * ~3,5 s, con el volumen pedido y acotado), no el sonido — eso solo se oye en el
 * navegador y ya lo cubre la comprobación manual.
 *
 * El stub de `window` va antes del import dinámico por el mismo motivo que en
 * `state/*.test.ts`: el contexto se cachea al módulo y el primero que pita es el
 * que abre el AudioContext.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Tone {
  start: number;
  stop: number;
  freq: number;
  volume: number;
}

/** AudioContext mínimo: solo anota cuándo suena cada oscilador y a qué volumen. */
class FakeAudioContext {
  readonly tones: Tone[] = [];
  readonly state = 'running';
  readonly currentTime = 4;
  readonly destination = {};

  resume(): Promise<void> {
    return Promise.resolve();
  }

  createGain() {
    const gain = {
      /* pico del envolvente: es lo que manda `linearRampToValueAtTime` */
      volume: 0,
      gain: {
        setValueAtTime: () => undefined,
        linearRampToValueAtTime: (v: number) => {
          gain.volume = v;
        },
        /* el cierre del pitido no cambia el volumen pedido */
        exponentialRampToValueAtTime: () => undefined,
      },
      connect: (node: unknown) => node,
    };
    return gain;
  }

  createOscillator() {
    const frequency = { value: 0 };
    const linked: { volume: number }[] = [];
    const tone: Tone = { start: 0, stop: 0, freq: 0, volume: 0 };
    return {
      type: 'sine',
      frequency,
      connect: (node: unknown) => {
        const vol = (node as { volume?: number }).volume;
        if (typeof vol === 'number') linked.push(node as { volume: number });
        return node;
      },
      start: (at: number) => {
        tone.start = at;
        tone.freq = frequency.value;
        tone.volume = linked[0]?.volume ?? 0;
        this.tones.push(tone);
      },
      stop: (at: number) => {
        tone.stop = at;
      },
    };
  }
}

const ctx = new FakeAudioContext();

vi.stubGlobal('window', {
  AudioContext: function AudioContext() {
    return ctx;
  },
});

const { beep } = await import('./audio');

beforeEach(() => {
  ctx.tones.length = 0;
});

describe('beep', () => {
  it('el fin de descanso son 5 pitidos que acaban entre 3 y 4,2 s (v1: ~3,5 s)', () => {
    beep('end', { sound: true, volume: 0.6 });

    expect(ctx.tones).toHaveLength(5);
    const [primero, ...resto] = ctx.tones;
    expect(primero).toBeDefined();
    const total = ctx.tones[ctx.tones.length - 1].stop - primero.start;
    expect(total).toBeGreaterThanOrEqual(3);
    expect(total).toBeLessThanOrEqual(4.2);
    /* los 5 pitidos, a la misma frecuencia y con el volumen pedido */
    expect(ctx.tones.every((t) => t.freq === 988)).toBe(true);
    expect(ctx.tones.every((t) => t.volume === 0.6)).toBe(true);
    expect(resto.every((t) => t.start >= primero.start)).toBe(true);
  });

  it('el ritmo es regular: cada pitido empieza `gap` segundos después del anterior', () => {
    beep('end', { sound: true });

    const deltas = ctx.tones.slice(1).map((t, i) => t.start - ctx.tones[i].start);
    expect(deltas).toHaveLength(4);
    /* el hueco se acumula en coma flotante (now + i · gap), por eso `toBeCloseTo` */
    for (const delta of deltas) expect(delta).toBeCloseTo(0.7, 9);
    expect(ctx.tones.every((t) => t.stop - t.start > 0.4)).toBe(true);
  });

  it('`sound: false` no suena nada', () => {
    beep('end', { sound: false });
    expect(ctx.tones).toHaveLength(0);
  });

  it('el volumen se acota a [0, 1]', () => {
    beep('tick', { volume: 5 });
    expect(ctx.tones).toHaveLength(1);
    expect(ctx.tones[0].volume).toBe(1);

    ctx.tones.length = 0;
    beep('tick', { volume: -3 });
    expect(ctx.tones[0].volume).toBe(0);
  });

  it('cada aviso tiene su propia cadencia (el de fin es el largo)', () => {
    beep('done', { sound: true });
    expect(ctx.tones).toHaveLength(3);
    expect(ctx.tones.map((t) => t.freq)).toEqual([1319, 1319, 1319]);
    expect(ctx.tones[ctx.tones.length - 1].stop - ctx.tones[0].start).toBeLessThan(1);

    ctx.tones.length = 0;
    beep('tap');
    expect(ctx.tones).toHaveLength(1);
  });
});
