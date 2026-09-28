/**
 * Cliente Gemini del coach: la API se prueba con `fetch` mockeado, así que aquí
 * queda fijado el contrato que necesita la UI (la key en la cabecera y nunca en
 * la URL, los `kind` de error, el thinkingConfig y el texto parcial de
 * MAX_TOKENS) sin tocar la red ni el SDK de Google.
 */
import { describe, expect, it, vi } from 'vitest';

import type { GenOpts } from './client';
import { buildBody, DEFAULT_MODEL, GeminiError, generate, testConnection } from './client';

/** Lo que `buildBody` manda a la API, tal y como se serializa. */
interface SentBody {
  contents: { role: string; parts: { text: string }[] }[];
  systemInstruction: { parts: { text: string }[] };
  generationConfig: {
    temperature?: number;
    maxOutputTokens?: number;
    responseMimeType?: string;
    thinkingConfig?: Record<string, unknown>;
  };
}

function opts(over: Partial<GenOpts> = {}): GenOpts {
  return {
    apiKey: 'clave-secreta-123',
    model: 'gemini-3.5-flash-lite',
    system: 'Eres Pulso Coach.',
    prompt: '¿Qué hago hoy?',
    ...over,
  };
}

function reply(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    candidates: [{ content: { parts: [{ text: 'respuesta ' }] }, finishReason: 'STOP' }],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 20,
      thoughtsTokenCount: 0,
      totalTokenCount: 30,
    },
    ...over,
  };
}

function makeFetch(data: unknown, status = 200) {
  const body = JSON.stringify(data);
  const respuesta = {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  } as Response;
  return vi.fn((_url: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(respuesta));
}

/**
 * `fetch` que va soltando CADA respuesta de la lista, en orden (cuando se acaba
 * repite la última) y guarda el body serializado de cada petición: es lo que
 * permite comprobar QUÉ se mandó en cada reintento.
 */
function makeFetchSeq(responses: { data: unknown; status?: number }[]) {
  const bodies: string[] = [];
  const f = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
    const index = Math.min(bodies.length, responses.length - 1);
    bodies.push(typeof init?.body === 'string' ? init.body : '');
    const { data, status = 200 } = responses[index];
    const body = JSON.stringify(data);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(body),
    } as Response);
  });
  return Object.assign(f, { bodies, parsed: () => bodies.map((b) => JSON.parse(b) as SentBody) });
}

/** Candidato con SOLO pensamiento y finish MALFORMED (el fallo real de edge.test.ts). */
const MALFORMED_ONLY_THOUGHTS = reply({
  candidates: [
    {
      content: { parts: [{ text: 'pensando en voz alta', thought: true }] },
      finishReason: 'MALFORMED_RESPONSE',
    },
  ],
  usageMetadata: {
    promptTokenCount: 10,
    candidatesTokenCount: 0,
    thoughtsTokenCount: 393,
    totalTokenCount: 403,
  },
});

/** URL a la que se llamó (el fetch solo recibe cadenas en esta app). */
function sentUrl(f: ReturnType<typeof makeFetch>): string {
  const url = f.mock.calls[0][0];
  return typeof url === 'string' ? url : '';
}

/** Body serializado de la petición, tal y como se mandó. */
function sentRaw(f: ReturnType<typeof makeFetch>): string {
  const body = f.mock.calls[0][1]?.body;
  return typeof body === 'string' ? body : '';
}

function sentBody(f: ReturnType<typeof makeFetch>): SentBody {
  const parsed: unknown = JSON.parse(sentRaw(f));
  return parsed as SentBody;
}

function thinkingOf(o: GenOpts): Record<string, unknown> | undefined {
  return (buildBody(o) as SentBody).generationConfig.thinkingConfig;
}

describe('buildBody', () => {
  it('monta historial, prompt al final como user e instruction de sistema', () => {
    const body = buildBody(
      opts({
        history: [
          { role: 'user', text: 'una' },
          { role: 'model', text: 'dos' },
        ],
      }),
    ) as SentBody;
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'una' }] },
      { role: 'model', parts: [{ text: 'dos' }] },
      { role: 'user', parts: [{ text: '¿Qué hago hoy?' }] },
    ]);
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'Eres Pulso Coach.' }] });
  });

  it('solo mete responseMimeType cuando se pide JSON', () => {
    expect('responseMimeType' in (buildBody(opts()) as SentBody).generationConfig).toBe(false);
    expect((buildBody(opts({ json: true })) as SentBody).generationConfig.responseMimeType).toBe(
      'application/json',
    );
  });

  it('thinkingConfig: manda el level, o el budget si no hay level (nunca los dos)', () => {
    expect(thinkingOf(opts({ thinkingLevel: 'medium' }))).toEqual({ thinkingLevel: 'medium' });
    expect(thinkingOf(opts({ thinkingBudget: 512 }))).toEqual({ thinkingBudget: 512 });
    expect(thinkingOf(opts({ thinkingLevel: 'high', thinkingBudget: 256 }))).toEqual({
      thinkingLevel: 'high',
    });
    /* 'auto' cuenta como "sin level": ahí sí se respeta el budget */
    expect(thinkingOf(opts({ thinkingLevel: 'auto', thinkingBudget: 128 }))).toEqual({
      thinkingBudget: 128,
    });
  });

  it('thinkingConfig: includeThoughts solo, y la clave no aparece si no se pide nada', () => {
    expect(thinkingOf(opts({ includeThoughts: true }))).toEqual({ includeThoughts: true });
    expect(thinkingOf(opts())).toBeUndefined();
    expect('thinkingConfig' in (buildBody(opts()) as SentBody).generationConfig).toBe(false);
  });

  it('temperature y maxOutputTokens: los pedidos, o los de la v1', () => {
    expect((buildBody(opts()) as SentBody).generationConfig).toMatchObject({
      temperature: 0.7,
      maxOutputTokens: 4096,
    });
    expect(
      (buildBody(opts({ temperature: 0.2, maxOutputTokens: 128 })) as SentBody).generationConfig,
    ).toMatchObject({ temperature: 0.2, maxOutputTokens: 128 });
  });

  it('la API key no viaja dentro del body', () => {
    expect(JSON.stringify(buildBody(opts()))).not.toContain('clave-secreta-123');
  });
});

describe('generate · éxito', () => {
  it('devuelve texto, finish, modelo y usage, y el body pide JSON', async () => {
    const f = makeFetch(reply());
    const out = await generate(opts({ json: true, temperature: 0.4, maxOutputTokens: 512 }), f);
    expect(out).toMatchObject({
      text: 'respuesta',
      finish: 'STOP',
      model: 'gemini-3.5-flash-lite',
      usage: { prompt: 10, candidates: 20, thoughts: 0, total: 30 },
    });
    expect(out.ms).toBeGreaterThanOrEqual(0);
    expect(sentBody(f).generationConfig).toMatchObject({
      responseMimeType: 'application/json',
      temperature: 0.4,
      maxOutputTokens: 512,
    });
  });

  it('en texto plano separa los pensamientos del texto', async () => {
    const f = makeFetch(
      reply({
        candidates: [
          {
            content: {
              parts: [{ text: 'Hola' }, { text: 'pensando', thought: true }, { text: ' mundo' }],
            },
            finishReason: 'STOP',
          },
        ],
      }),
    );
    const out = await generate(opts(), f);
    expect(out).toMatchObject({ text: 'Hola mundo', thoughts: 'pensando', finish: 'STOP' });
  });

  it('el historial llega con role "model" (Gemini no entiende "assistant")', async () => {
    const f = makeFetch(reply());
    await generate(opts({ history: [{ role: 'model', text: 'antes' }] }), f);
    expect(sentBody(f).contents.map((c) => c.role)).toEqual(['model', 'user']);
  });

  it('sin modelo usa el por defecto de la app', async () => {
    const f = makeFetch(reply());
    await generate(opts({ model: undefined }), f);
    expect(sentUrl(f)).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent`,
    );
  });

  it('la key va en la cabecera x-goog-api-key y jamás en la URL', async () => {
    const f = makeFetch(reply());
    await generate(opts(), f);
    const init = f.mock.calls[0][1];
    expect(sentUrl(f)).toContain(':generateContent');
    expect(sentUrl(f)).not.toContain('key=');
    expect(init?.headers as Record<string, string>).toMatchObject({
      'x-goog-api-key': 'clave-secreta-123',
      'Content-Type': 'application/json',
    });
    expect(sentRaw(f)).not.toContain('clave-secreta-123');
  });

  it('MAX_TOKENS no lanza: devuelve el texto parcial para que la UI avise', async () => {
    const f = makeFetch(
      reply({
        candidates: [{ content: { parts: [{ text: '{"dias":[' }] }, finishReason: 'MAX_TOKENS' }],
      }),
    );
    const out = await generate(opts({ json: true }), f);
    expect(out).toMatchObject({ text: '{"dias":[', finish: 'MAX_TOKENS' });
  });
});

describe('generate · política de reintentos', () => {
  it('MALFORMED → sin candidatos → éxito: 3 llamadas y a partir de la 2ª SIN thinkingConfig', async () => {
    const f = makeFetchSeq([
      { data: MALFORMED_ONLY_THOUGHTS },
      { data: reply({ candidates: [] }) },
      {
        data: reply({
          candidates: [{ content: { parts: [{ text: '¡listo!' }] }, finishReason: 'STOP' }],
        }),
      },
    ]);
    const out = await generate(opts({ json: true, thinkingLevel: 'low' }), f);

    expect(out).toMatchObject({ text: '¡listo!', finish: 'STOP' });
    expect(f).toHaveBeenCalledTimes(3);

    const bodies = f.parsed();
    /* la 1ª petición SÍ llevaba thinking; a partir del primer reintento por (i) se quita */
    expect(bodies[0].generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
    expect('thinkingConfig' in bodies[1].generationConfig).toBe(false);
    expect('thinkingConfig' in bodies[2].generationConfig).toBe(false);
    /* el resto de la petición no se toca: sigue pidiendo JSON */
    expect(bodies[1].generationConfig.responseMimeType).toBe('application/json');
    expect(bodies[1].contents).toEqual(bodies[0].contents);
  });

  it('éxito a la primera: UNA sola llamada, sin reintento', async () => {
    const f = makeFetch(reply());
    const out = await generate(opts({ thinkingLevel: 'low' }), f);
    expect(out.text).toBe('respuesta');
    expect(f).toHaveBeenCalledTimes(1);
    expect(sentBody(f).generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
  });

  it('500 → reintento con el MISMO body (un fallo del servidor no cambia la petición)', async () => {
    const f = makeFetchSeq([
      { data: { error: { code: 500, message: 'boom' } }, status: 500 },
      { data: reply() },
    ]);
    const out = await generate(opts({ thinkingLevel: 'low' }), f);
    expect(out.text).toBe('respuesta');
    expect(f).toHaveBeenCalledTimes(2);
    const bodies = f.parsed();
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[1].generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
  });

  it('429 → reintento; si sigue fallando acaba en quota', async () => {
    const ok = makeFetchSeq([
      { data: { error: { code: 429, message: 'Cuota' } }, status: 429 },
      { data: reply() },
    ]);
    expect((await generate(opts(), ok)).text).toBe('respuesta');
    expect(ok).toHaveBeenCalledTimes(2);

    const siempre429 = makeFetch({ error: { code: 429, message: 'Cuota agotada' } }, 429);
    await expect(generate(opts(), siempre429)).rejects.toMatchObject({
      kind: 'quota',
      status: 429,
    });
    expect(siempre429).toHaveBeenCalledTimes(3); /* inicial + 2 reintentos */
  });

  it('403 → auth: NUNCA se reintenta', async () => {
    const f = makeFetch(
      { error: { code: 403, message: 'API key no válida', status: 'PERMISSION_DENIED' } },
      403,
    );
    await expect(generate(opts({ thinkingLevel: 'low' }), f)).rejects.toMatchObject({
      kind: 'auth',
      status: 403,
    });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('red caída → reintenta y, agotados los 2, lanza network', async () => {
    const f = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.reject(new TypeError('fetch failed')),
    );
    await expect(generate(opts(), f)).rejects.toMatchObject({ kind: 'network' });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('sin candidatos se agota en 2 reintentos y lanza empty (3 llamadas)', async () => {
    const f = makeFetchSeq([{ data: reply({ candidates: [] }) }]);
    await expect(generate(opts({ thinkingLevel: 'low' }), f)).rejects.toMatchObject({
      kind: 'empty',
      message: 'La API no devolvió candidatos',
    });
    expect(f).toHaveBeenCalledTimes(3);
    const bodies = f.parsed();
    expect(bodies[0].generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
    expect(bodies.slice(1).every((b) => !('thinkingConfig' in b.generationConfig))).toBe(true);
  });

  it('MAX_TOKENS con texto vacío NO reintenta: hay que enseñar el corte a la UI', async () => {
    const f = makeFetch(
      reply({ candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] }),
    );
    const out = await generate(opts({ maxOutputTokens: 15 }), f);
    expect(out).toMatchObject({ text: '', finish: 'MAX_TOKENS' });
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('generate · errores', () => {
  it('sin API key → kind auth y ni se llama a la red', async () => {
    const f = makeFetch(reply());
    await expect(generate(opts({ apiKey: '   ' }), f)).rejects.toMatchObject({ kind: 'auth' });
    expect(f).not.toHaveBeenCalled();
  });

  it('403 → kind auth, con status y el mensaje de la API', async () => {
    const f = makeFetch(
      { error: { code: 403, message: 'API key no válida', status: 'PERMISSION_DENIED' } },
      403,
    );
    await expect(generate(opts(), f)).rejects.toMatchObject({
      kind: 'auth',
      status: 403,
      message: 'API key no válida',
    });
  });

  it('429 → kind quota', async () => {
    const f = makeFetch({ error: { code: 429, message: 'Cuota agotada' } }, 429);
    await expect(generate(opts(), f)).rejects.toMatchObject({
      kind: 'quota',
      status: 429,
      message: 'Cuota agotada',
    });
  });

  it('promptFeedback.blockReason → kind blocked, nombrando el motivo', async () => {
    const f = makeFetch(reply({ candidates: [], promptFeedback: { blockReason: 'SAFETY' } }));
    await expect(generate(opts(), f)).rejects.toBeInstanceOf(GeminiError);
    await expect(generate(opts(), f)).rejects.toMatchObject({ kind: 'blocked' });
    await expect(generate(opts(), f)).rejects.toThrowError('SAFETY');
  });

  it('sin candidates y sin blockReason → kind empty', async () => {
    const f = makeFetch(reply({ candidates: [] }));
    await expect(generate(opts(), f)).rejects.toMatchObject({ kind: 'empty' });
  });

  it('red caída → kind network', async () => {
    const f = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.reject(new TypeError('fetch failed')),
    );
    await expect(generate(opts(), f)).rejects.toMatchObject({ kind: 'network' });
    await expect(generate(opts(), f)).rejects.toThrowError('No se pudo conectar con Gemini');
    await expect(generate(opts(), f)).rejects.toThrowError('fetch failed');
  });
});

describe('testConnection', () => {
  it('pregunta por el "OK" sin thinking y lo da por bueno si aparece', async () => {
    const f = makeFetch(
      reply({ candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] }),
    );
    const out = await testConnection('clave-secreta-123', 'gemini-3.5-flash-lite', f);
    expect(out.ok).toBe(true);
    expect(out.detail).toContain('OK');
    expect(out.ms).toBeGreaterThanOrEqual(0);
    const body = sentBody(f);
    expect(body.contents[body.contents.length - 1].parts[0].text).toBe(
      'Responde exactamente con: OK',
    );
    expect('thinkingConfig' in body.generationConfig).toBe(false);
  });

  it('en error no lanza: devuelve ok:false con el mensaje', async () => {
    const f = makeFetch({ error: { code: 401, message: 'API key no válida' } }, 401);
    const out = await testConnection('mala', 'gemini-3.5-flash-lite', f);
    expect(out.ok).toBe(false);
    expect(out.detail).toContain('API key no válida');
    expect(out.ms).toBeGreaterThanOrEqual(0);
  });
});
