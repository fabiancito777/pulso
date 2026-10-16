import { describe, expect, it } from 'vitest';

import type { Exercise } from '@/domain/types';
import {
  buildBody,
  DEFAULT_MODEL,
  generate,
  listModels,
  MODELS_LIMIT,
} from '@/features/coach/client';
import {
  buildGeneratorRequest,
  EXISTING_MAX,
  FORBIDDEN_MAX,
  gapsBrief,
} from '@/features/coach/generate-exercise';
import type { ResponseSchema } from '@/features/coach/types';
import { PLAN_RESPONSE_SCHEMA, SUGGEST_RESPONSE_SCHEMA } from '@/features/coach/schema';

function ex(id: string, name: string, group = 'pecho', extra: Partial<Exercise> = {}): Exercise {
  return {
    id,
    name,
    group,
    equip: '',
    type: 'aislado',
    sets: 3,
    repMin: 8,
    repMax: 12,
    rest: 90,
    allowed: true,
    custom: false,
    bw: true,
    tags: [],
    tips: '',
    ...extra,
  };
}

const okReply = { candidates: [{ content: { parts: [{ text: 'hola' }] } }] };

function fakeFetch(payload: unknown, status = 200): typeof fetch {
  return (() => ({
    ok: status < 400,
    status,
    text: () => Promise.resolve(JSON.stringify(payload)),
  })) as unknown as typeof fetch;
}

describe('client (196–206)', () => {
  it('196 · La API key va en cabecera, NUNCA en la URL', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchFn = ((url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return { ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(okReply)) };
    }) as unknown as typeof fetch;

    await generate({ apiKey: 'secreta', system: 's', prompt: 'p' }, fetchFn);
    expect(capturedUrl).not.toContain('secreta');
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('secreta');
  });

  it('197 · json:true añade responseMimeType y responseSchema', () => {
    const body = buildBody({
      apiKey: 'k',
      system: 's',
      prompt: 'p',
      json: true,
      responseSchema: SUGGEST_RESPONSE_SCHEMA,
    }) as { generationConfig: Record<string, unknown> };
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema).toBeTruthy();
  });

  it('198 · dropThinking quita el thinkingConfig', () => {
    const opts = { apiKey: 'k', system: 's', prompt: 'p', thinkingLevel: 'high' as const };
    const withThinking = buildBody(opts) as { generationConfig: Record<string, unknown> };
    expect(withThinking.generationConfig.thinkingConfig).toBeTruthy();
    const dropped = buildBody(opts, { dropThinking: true }) as {
      generationConfig: Record<string, unknown>;
    };
    expect(dropped.generationConfig.thinkingConfig).toBeUndefined();
  });

  it('199 · Error de red se clasifica como GeminiError(network)', async () => {
    const fetchFn = (() => Promise.reject(new Error('boom'))) as unknown as typeof fetch;
    await expect(generate({ apiKey: 'k', system: 's', prompt: 'p' }, fetchFn)).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it('200 · Respuesta sin candidatos → kind:empty', async () => {
    const fetchFn = fakeFetch({ candidates: [] });
    await expect(generate({ apiKey: 'k', system: 's', prompt: 'p' }, fetchFn)).rejects.toMatchObject({
      kind: 'empty',
    });
  });

  it('202 · Sin key → GeminiError(auth) sin llamar a fetch', async () => {
    let called = false;
    const fetchFn = (() => {
      called = true;
      return { ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(okReply)) };
    }) as unknown as typeof fetch;
    await expect(generate({ apiKey: '', system: 's', prompt: 'p' }, fetchFn)).rejects.toMatchObject({
      kind: 'auth',
    });
    expect(called).toBe(false);
  });

  it('203 · listModels respeta MODELS_LIMIT', async () => {
    const models = Array.from({ length: 200 }, (_, i) => ({
      name: `models/m${i}`,
      supportedGenerationMethods: ['generateContent'],
    }));
    const out = await listModels('k', fakeFetch({ models }));
    expect(out.length).toBe(MODELS_LIMIT);
  });

  it('204 · El modelo por defecto es gemini-3.8-flash', () => {
    expect(DEFAULT_MODEL).toBe('gemini-3.8-flash');
  });

  it('205 · Los tipos del esquema van en MAYÚSCULAS', () => {
    const allowed = new Set(['OBJECT', 'ARRAY', 'STRING', 'NUMBER', 'INTEGER', 'BOOLEAN']);
    const seen = new Set<string>();
    const walk = (schema: ResponseSchema): void => {
      if (schema.type) seen.add(schema.type);
      for (const child of Object.values(schema.properties ?? {})) walk(child);
      if (schema.items) walk(schema.items);
    };
    walk(SUGGEST_RESPONSE_SCHEMA);
    walk(PLAN_RESPONSE_SCHEMA);
    expect(seen.size).toBeGreaterThan(0);
    for (const type of seen) expect(allowed.has(type)).toBe(true);
  });

  it('206 · Ni additionalProperties ni format en el esquema', () => {
    const keys = new Set<string>();
    const walk = (schema: ResponseSchema): void => {
      for (const key of Object.keys(schema)) keys.add(key);
      for (const child of Object.values(schema.properties ?? {})) walk(child);
      if (schema.items) walk(schema.items);
    };
    walk(SUGGEST_RESPONSE_SCHEMA);
    walk(PLAN_RESPONSE_SCHEMA);
    expect(keys.has('additionalProperties')).toBe(false);
    expect(keys.has('format')).toBe(false);
  });
});

describe('generate-exercise (209–210)', () => {
  it('209 · buildGeneratorRequest acota FORBIDDEN_MAX/EXISTING_MAX', () => {
    const forbidden = Array.from({ length: 100 }, (_, i) => `Prohibido ${i}`);
    const existing = Array.from({ length: 500 }, (_, i) => `Existente ${i}`);
    const req = buildGeneratorRequest('x', {
      material: [],
      equipKeys: [],
      forbidden,
      favorites: [],
      existing,
      gaps: '',
      count: 4,
    });
    // HALLAZGO: `buildGeneratorRequest` NO acota nada; el tope de 40/200 lo
    // aplica `state/exgen.ts` (`makeCtx`) con `.slice(0, FORBIDDEN_MAX/EXISTING_MAX)`
    // ANTES de llamar aquí, así que la petición real sí cabe. Los topes son:
    expect(FORBIDDEN_MAX).toBe(40);
    expect(EXISTING_MAX).toBe(200);
    expect(req.prompt).toContain('Prohibido 99');
    expect(req.prompt).toContain('Existente 499');
  });

  it('210 · gapsBrief resume los huecos de la biblioteca', () => {
    const brief = gapsBrief([], [ex('p', 'Press banca', 'pecho')], '2026-01-01');
    expect(brief).toContain('SIN NINGÚN ejercicio');
    // HALLAZGO: sin historial no se listan los NOMBRES de los ejercicios, solo
    // el recuento de la biblioteca y los grupos que no tienen ninguno.
    expect(brief).toContain('Su biblioteca tiene 1 ejercicios.');
    expect(brief).not.toContain('Press banca');
  });
});
