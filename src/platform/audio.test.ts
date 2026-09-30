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
 * Y el auto-suspend del fix `e2c49b9`: el contexto NO se queda abierto (un
 * AudioContext en idle retiene la salida y dejaba la música de fondo atenuada),
 * así que aquí se fija con relojes falsos cuándo se suelta.
 *
 * El stub de `window` va antes del import dinámico por el mismo motivo que en
 * `state/*.test.ts`: el contexto se cachea al módulo y el primero que pita es el
 * que abre el AudioContext.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AudioModule from './audio';

interface Tone {
  start: number;
  stop: number;
  freq: number;
  volume: number;
}

/** AudioContext mínimo: anota cuándo suena cada oscilador y cuándo se suspende. */
class FakeAudioContext {
  readonly tones: Tone[] = [];
  state = 'running';
  suspends = 0;
  resumes = 0;
  readonly currentTime = 4;
  readonly destination = {};

  resume(): Promise<void> {
    this.resumes += 1;
    this.state = 'running';
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.suspends += 1;
    this.state = 'suspended';
    return Promise.resolve();
  }

  /** Entre tests: contexto en marcha y sin pitidos ni suspensiones contados. */
  reset(): void {
    this.tones.length = 0;
    this.state = 'running';
    this.suspends = 0;
    this.resumes = 0;
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

/* Relojes falsos (timers + Date) en TODOS los tests: así `beep()` no deja
   temporizadores reales sueltos y los de auto-suspend se pueden adelantar. */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  ctx.reset();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
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

/* ---------- auto-suspend: el contexto no se queda reteniendo la salida (e2c49b9) ---------- */

describe('auto-suspend del AudioContext', () => {
  /* El módulo cachea el AudioContext y `busyUntil` (la ventana hasta la que hay
     pitidos sonando), medida sobre el reloj DEL test que la fijó. Cada test
     importa una copia NUEVA: si no, la ventana de un test anterior —que ya no
     coincide con este reloj— impediría suspender. */
  let audio: typeof AudioModule;

  beforeEach(async () => {
    vi.resetModules();
    audio = await import('./audio');
    ctx.reset();
  });

  it('un pitido suelta el foco: el contexto se suspende a los 600 ms', () => {
    audio.beep('tick');

    vi.advanceTimersByTime(599);
    expect(ctx.suspends).toBe(0);
    expect(ctx.state).toBe('running');

    vi.advanceTimersByTime(1);
    expect(ctx.suspends).toBe(1);
    expect(ctx.state).toBe('suspended');
  });

  it('el fin de descanso deja sonar los 5 pitidos y SOLO DESPUÉS se suspende (4,2 s)', () => {
    audio.beep('end');

    vi.advanceTimersByTime(4199);
    expect(ctx.suspends).toBe(0);

    vi.advanceTimersByTime(1);
    expect(ctx.suspends).toBe(1);
  });

  it('un gesto sin pitidos lo deja suspendido a los 1,5 s', () => {
    audio.ensureAudio();

    vi.advanceTimersByTime(1499);
    expect(ctx.suspends).toBe(0);

    vi.advanceTimersByTime(1);
    expect(ctx.suspends).toBe(1);
  });

  it('cada gesto reinicia el temporizador: no se suspende a mitad de un descanso', () => {
    audio.ensureAudio();
    vi.advanceTimersByTime(1000);
    audio.ensureAudio();

    /* 2 s desde el primer gesto, 1 s desde el segundo */
    vi.advanceTimersByTime(1000);
    expect(ctx.suspends).toBe(0);

    vi.advanceTimersByTime(500);
    expect(ctx.suspends).toBe(1);
  });

  it('un pitido nuevo manda él: la ventana del anterior queda cancelada', () => {
    audio.beep('tick');
    vi.advanceTimersByTime(500);
    audio.beep('tick');

    vi.advanceTimersByTime(200); /* ya habrían pasado los 600 del primero */
    expect(ctx.suspends).toBe(0);

    vi.advanceTimersByTime(400);
    expect(ctx.suspends).toBe(1);
  });

  it('un contexto suspendido se desbloquea con el siguiente gesto', () => {
    audio.ensureAudio();
    vi.advanceTimersByTime(1500);
    expect(ctx.state).toBe('suspended');

    audio.ensureAudio();

    expect(ctx.resumes).toBe(1);
    expect(ctx.state).toBe('running');
  });

  it('con el sonido apagado no se programa ningún auto-suspend', () => {
    audio.beep('end', { sound: false });

    vi.advanceTimersByTime(10_000);
    expect(ctx.suspends).toBe(0);
  });
});
