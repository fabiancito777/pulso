/**
 * `generateExercises`: la capa state del generador de ejercicios (spec
 * `_specs/generador-ejercicios.md` §2/§4).
 *
 * Lo que hay que defender aquí son las reglas de CUOTA, que solo se pueden ver
 * con la red mockeada:
 *
 * - **1 clic = 1 request** (`toHaveBeenCalledTimes(1)`) y sin reintento propio;
 * - **sin API key → `GeminiError('auth')` antes de tocar `generateFn`**, ni
 *   siquiera el mockeado (cero llamadas);
 * - **nada se escribe**: el `localStorage` sale idéntico de la llamada;
 * - la foto del estado (biblioteca, material, historial) se toma UNA vez al
 *   empezar: lo que cambie mientras la petición está en vuelo no entra ni en el
 *   prompt ni en el parseo.
 *
 * Mismo simulador de `localStorage` que `store.test.ts` (el estado se decide al
 * cargar el módulo), por eso los imports son dinámicos.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GeminiError } from '@/features/coach/client';
import type { GenOpts, GenResult } from '@/features/coach/client';
import { GENERATOR_SYSTEM } from '@/features/coach/generate-exercise';

const mem = new Map<string, string>();

vi.stubGlobal('localStorage', {
  getItem: (key: string): string | null => (mem.has(key) ? (mem.get(key) as string) : null),
  setItem: (key: string, value: string): void => {
    mem.set(key, String(value));
  },
  removeItem: (key: string): void => {
    mem.delete(key);
  },
  clear: (): void => {
    mem.clear();
  },
  key: (index: number): string | null => [...mem.keys()][index] ?? null,
  get length(): number {
    return mem.size;
  },
});

const store = await import('./store');
const exgen = await import('./exgen');

/** Respuesta feliz del modelo: dos propuestas utilizables. */
const PROPUESTAS = JSON.stringify({
  exercises: [
    {
      name: 'Remo a una mano con mancuerna en prono',
      group: 'espalda',
      equip: 'mancuernas_ajustables',
      type: 'compuesto',
      sets: 3,
      rest: 90,
      repMin: 8,
      repMax: 12,
      unilateral: true,
      desc: 'Tira del codo hacia la cadera.',
    },
    { name: 'Plancha lateral con elevación de cadera', group: 'core', equip: '' },
  ],
});

function res(text: string, extra: Partial<GenResult> = {}): GenResult {
  return { text, model: 'mock', ms: 7, ...extra };
}

/** `generate` mockeado: devuelve las respuestas en orden y guarda cada llamada. */
function makeGen(results: GenResult[]) {
  let call = 0;
  return vi.fn((_opts: GenOpts, _fetchFn?: typeof fetch): Promise<GenResult> => {
    const next = results[Math.min(call, results.length - 1)];
    call++;
    return Promise.resolve(next);
  });
}

/** El `GeminiError` que lanzó (o un fallo del propio test). */
async function rejection(p: Promise<unknown>): Promise<GeminiError> {
  try {
    await p;
  } catch (err) {
    return err as GeminiError;
  }
  throw new Error('esperaba que la generación fallara');
}

/** Línea de la petición que empieza por `prefix` (`''` si no está). */
function promptLine(gen: ReturnType<typeof makeGen>, prefix: string): string {
  const prompt = gen.mock.calls[0]?.[0].prompt ?? '';
  return prompt.split('\n').find((line) => line.startsWith(prefix)) ?? '';
}

beforeEach(() => {
  mem.clear();
  store.writeState(store.defaultState());
  store.refresh();
  store.patchSettings({ ai: { ...store.settings.value.ai, apiKey: 'test-key' } });
});

describe('generateExercises', () => {
  it('1 clic = 1 request: dos propuestas, avisos y NADA escrito en localStorage', async () => {
    const gen = makeGen([res(PROPUESTAS)]);
    const estadoAntes = mem.get('pulso.state');
    const bibliotecaAntes = store.exercises.value.length;

    const out = await exgen.generateExercises({ prompt: 'algo para dorsal' }, { generateFn: gen });

    expect(gen).toHaveBeenCalledTimes(1);
    expect(out.proposals.map((p) => p.name)).toEqual([
      'Remo a una mano con mancuerna en prono',
      'Plancha lateral con elevación de cadera',
    ]);
    expect(out.issues).toEqual([]);
    expect(mem.get('pulso.state')).toBe(estadoAntes);
    expect(store.exercises.value.length).toBe(bibliotecaAntes);
  });

  it('arma la petición con la foto del estado: material activo, biblioteca y ajustes', async () => {
    const [prohibido, favorito] = store.exercises.value;
    store.saveExercise({ ...prohibido, allowed: false });
    store.saveExercise({ ...favorito, fav: true });

    const gen = makeGen([res(PROPUESTAS)]);
    await exgen.generateExercises({ prompt: 'algo para dorsal' }, { generateFn: gen });

    const opts = gen.mock.calls[0]?.[0];
    expect(opts.apiKey).toBe('test-key');
    expect(opts.json).toBe(true);
    expect(opts.system).toBe(GENERATOR_SYSTEM);
    expect(opts.prompt).toContain('SOLICITUD DEL USUARIO: algo para dorsal');
    expect(opts.prompt).toContain('Genera 4 ejercicios nuevos');
    expect(promptLine(gen, 'PROHIBIDOS')).toBe(
      `PROHIBIDOS (no los propongas ni pareados): ${prohibido.name}`,
    );
    expect(promptLine(gen, 'FAVORITOS')).toBe(
      `FAVORITOS (estilo a imitar, no a copiar): ${favorito.name}`,
    );
    expect(promptLine(gen, 'YA EXISTEN')).toContain(store.exercises.value[0].name);
    expect(promptLine(gen, 'MATERIAL DISPONIBLE')).toContain('Mancuernas ajustables');
  });

  it('solo manda claves de material activas (las inactivas no viajan ni por clave)', async () => {
    const gen = makeGen([res(PROPUESTAS)]);
    await exgen.generateExercises({ prompt: 'x' }, { generateFn: gen });

    const claves = promptLine(gen, 'CLAVES VÁLIDAS').split(': ')[1]?.split(', ') ?? [];
    expect(claves).toEqual(
      expect.arrayContaining([
        'mancuernas_ajustables',
        'discos',
        'barra_olimpica',
        'banco_dominadas',
        'paralelas',
      ]),
    );
    expect(claves).toHaveLength(5);
    expect(claves).not.toContain('banco_plano');
  });

  it('el atajo de huecos añade el brief HUECOS (sin él no aparece)', async () => {
    const conAtajo = makeGen([res(PROPUESTAS)]);
    await exgen.generateExercises({ prompt: 'x', gaps: true }, { generateFn: conAtajo });
    expect(promptLine(conAtajo, 'HUECOS DEL HISTORIAL')).toBe(
      'HUECOS DEL HISTORIAL (grupos subestimados y variedad):',
    );
    expect(conAtajo.mock.calls[0]?.[0].prompt).toContain('sin datos');

    const sinAtajo = makeGen([res(PROPUESTAS)]);
    await exgen.generateExercises({ prompt: 'x' }, { generateFn: sinAtajo });
    expect(sinAtajo.mock.calls[0]?.[0].prompt).not.toContain('HUECOS DEL HISTORIAL');
  });

  it('respeta el recuento pedido', async () => {
    const gen = makeGen([res(PROPUESTAS)]);
    await exgen.generateExercises({ prompt: 'x', count: 6 }, { generateFn: gen });
    expect(promptLine(gen, 'SOLICITUD DEL USUARIO')).toBe('SOLICITUD DEL USUARIO: x');
    expect(gen.mock.calls[0]?.[0].prompt).toContain('Genera 6 ejercicios nuevos');
  });

  it('sin API key → auth y CERO llamadas (ni al generateFn mockeado)', async () => {
    store.patchSettings({ ai: { ...store.settings.value.ai, apiKey: '' } });
    const gen = makeGen([]);

    const err = await rejection(exgen.generateExercises({ prompt: 'x' }, { generateFn: gen }));

    expect(err).toBeInstanceOf(GeminiError);
    expect(err.kind).toBe('auth');
    expect(err.message).toContain('Ajustes');
    expect(gen).not.toHaveBeenCalled();
  });

  it('respuesta ilegible → parse, y se le puede dar un mensaje amable', async () => {
    const gen = makeGen([res('esto no es json')]);

    const err = await rejection(exgen.generateExercises({ prompt: 'x' }, { generateFn: gen }));

    expect(err.kind).toBe('parse');
    expect(gen).toHaveBeenCalledTimes(1);
    expect(exgen.exgenErrorText(err)).toBe(
      'No entendí la respuesta del modelo, prueba a reformular la petición',
    );
  });

  it('JSON válido sin propuestas utilizables → empty con el motivo', async () => {
    const sinNada = makeGen([res(JSON.stringify({ exercises: [] }))]);
    const vacio = await rejection(
      exgen.generateExercises({ prompt: 'x' }, { generateFn: sinNada }),
    );
    expect(vacio.kind).toBe('empty');
    expect(vacio.message).toBe('El modelo no devolvió ejercicios nuevos');

    const invalidas = makeGen([res(JSON.stringify({ exercises: [{ name: '' }] }))]);
    const conAvisos = await rejection(
      exgen.generateExercises({ prompt: 'x' }, { generateFn: invalidas }),
    );
    expect(conAvisos.kind).toBe('empty');
    expect(conAvisos.message).toContain('El nombre es obligatorio');
  });

  it('la foto se toma al empezar: lo que cambia en vuelo no entra en el parseo', async () => {
    const vuelo = 'Ejercicio escrito durante la llamada';
    /* El modelo contesta, pero ENTRE que sale la petición y se parsea la
       respuesta aparece en la biblioteca un ejercicio con el mismo nombre: si el
       parseo leyera la signal en vivo lo marcaría como `duplicateOf`. */
    const gen = vi.fn((_opts: GenOpts, _fetchFn?: typeof fetch): Promise<GenResult> => {
      store.saveExercise({
        id: 'escrito-en-vuelo',
        name: vuelo,
        group: 'pecho',
        equip: '',
        type: 'aislado',
        sets: 3,
        repMin: 8,
        repMax: 12,
        rest: 90,
        allowed: true,
        custom: true,
        bw: false,
        tags: [],
        tips: '',
      });
      return Promise.resolve(
        res(JSON.stringify({ exercises: [{ name: vuelo, group: 'pecho', equip: '' }] })),
      );
    });

    const out = await exgen.generateExercises({ prompt: 'x' }, { generateFn: gen });

    expect(store.exercises.value.some((e) => e.name === vuelo)).toBe(true);
    expect(out.proposals[0].name).toBe(vuelo);
    expect(out.proposals[0].duplicateOf).toBeUndefined();
  });

  it('devuelve usage/thoughts/finish solo cuando la respuesta los trae', async () => {
    const conTodo = makeGen([
      res(PROPUESTAS, {
        usage: { prompt: 120, candidates: 30, total: 150 },
        thoughts: 'estoy pensando',
        finish: 'STOP',
      }),
    ]);
    const out = await exgen.generateExercises({ prompt: 'x' }, { generateFn: conTodo });
    expect(out.usage).toEqual({ prompt: 120, candidates: 30, total: 150 });
    expect(out.thoughts).toBe('estoy pensando');
    expect(out.finish).toBe('STOP');
    expect(out.ms).toBeGreaterThanOrEqual(0);

    const minimal = makeGen([res(PROPUESTAS)]);
    const sin = await exgen.generateExercises({ prompt: 'x' }, { generateFn: minimal });
    expect(sin).not.toHaveProperty('usage');
    expect(sin).not.toHaveProperty('thoughts');
  });

  it('los milisegundos salen del reloj inyectado (sin esperar de verdad)', async () => {
    const marks = [400, 1000, 1400];
    let i = 0;
    const gen = makeGen([res(PROPUESTAS)]);

    const out = await exgen.generateExercises(
      { prompt: 'x' },
      { generateFn: gen, now: () => marks[Math.min(i++, marks.length - 1)] },
    );

    expect(out.ms).toBe(1000);
  });
});

describe('exgenErrorText', () => {
  it('traduce cada kind a lo que el usuario tiene que hacer', () => {
    const text = exgen.exgenErrorText;
    expect(text(new GeminiError('auth', 'Falta la API key'))).toContain('Necesito la API key');
    expect(text(new GeminiError('quota', 'sin cuota'))).toContain('Cuota agotada');
    expect(text(new GeminiError('blocked', 'filtro'))).toContain('La API bloqueó');
    expect(text(new GeminiError('network', 'offline'))).toContain('No hay conexión');
    expect(text(new GeminiError('empty', 'nada nuevo'))).toContain('No salió ningún ejercicio');
    expect(text(new GeminiError('http', 'boom', 500))).toBe('Error de Gemini (HTTP 500): boom');
    expect(text(new Error('boom'))).toBe('Error: boom');
    expect(text('raro')).toBe('Error: raro');
  });
});
