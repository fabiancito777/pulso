/**
 * Esquemas de respuesta de `suggest`/`plan`: no es solo "que existan", es que
 * sean VÁLIDOS para la API. Un `required` sin `properties`, un type en
 * minúsculas o un `additionalProperties` fuera del subconjunto que documenta
 * Google harían fallar la llamada entera con 400 INVALID_ARGUMENT, que no cae
 * en el fallback local (`GeminiError.kind: 'http'`): el usuario vería un
 * error en vez de una propuesta del planificador del dispositivo.
 */
import { describe, expect, it } from 'vitest';

import { PLAN_RESPONSE_SCHEMA, SUGGEST_RESPONSE_SCHEMA } from './schema';
import type { ResponseSchema } from './types';

const TYPES = ['OBJECT', 'ARRAY', 'STRING', 'NUMBER', 'INTEGER', 'BOOLEAN'];

/** Recorre el árbol del schema: los tipos y las claves que Google acepta. */
function walk(
  node: ResponseSchema,
  path: string,
  seen: { path: string; type?: string; keys: string[] }[] = [],
): typeof seen {
  seen.push({ path, type: node.type, keys: Object.keys(node) });
  for (const [key, child] of Object.entries(node.properties ?? {}))
    walk(child, `${path}.${key}`, seen);
  if (node.items) walk(node.items, `${path}[]`, seen);
  return seen;
}

/** Todo `required` tiene que apuntar a una propiedad declarada. */
function checkRequired(node: ResponseSchema, path: string): void {
  for (const key of node.required ?? []) {
    expect(Object.keys(node.properties ?? {}), `${path}.required: ${key}`).toContain(key);
  }
  for (const [key, child] of Object.entries(node.properties ?? {}))
    checkRequired(child, `${path}.${key}`);
  if (node.items) checkRequired(node.items, `${path}[]`);
}

describe('SUGGEST_RESPONSE_SCHEMA', () => {
  it('cubre los campos que leen las vistas (title/focus/rationale[]/exercises[])', () => {
    expect(SUGGEST_RESPONSE_SCHEMA.type).toBe('OBJECT');
    expect(SUGGEST_RESPONSE_SCHEMA.required).toEqual(['title', 'focus', 'rationale', 'exercises']);
    expect(SUGGEST_RESPONSE_SCHEMA.properties?.rationale?.type).toBe('ARRAY');
    expect(SUGGEST_RESPONSE_SCHEMA.properties?.rationale?.items?.type).toBe('STRING');
    expect(SUGGEST_RESPONSE_SCHEMA.properties?.exercises?.type).toBe('ARRAY');
  });

  it('el «entre 4 y 7» va en el schema, no solo en el prompt', () => {
    /* verificado contra la API real (04-oct-2026): minItems/maxItems se
       cumplen como regla dura; sin esto, flash-lite con thinking low llegó a
       devolver 3 ejercicios y el smoke se caía */
    const arr = SUGGEST_RESPONSE_SCHEMA.properties?.exercises;
    expect(arr?.minItems).toBe(4);
    expect(arr?.maxItems).toBe(7);
  });

  it('cada ejercicio trae los números que aplican la rutina, y los opcionales del prompt', () => {
    const ex = SUGGEST_RESPONSE_SCHEMA.properties?.exercises?.items;
    expect(ex?.type).toBe('OBJECT');
    expect(ex?.required).toEqual(['name', 'sets', 'repMin', 'repMax', 'weight', 'rest']);
    /* el prompt pide "isNew":true + "group"/"equip"/"type": si no estuvieran
       declarados, el constrained decoding se los comería y la propuesta de
       ejercicio nuevo se perdería */
    const props = ex?.properties ?? {};
    for (const optional of ['isNew', 'group', 'equip', 'type', 'unilateral', 'desc', 'notes']) {
      expect(Object.keys(props), `falta ${optional}`).toContain(optional);
    }
    expect(props.weight?.type).toBe('NUMBER'); /* 82.5 kg no cabe en INTEGER */
  });
});

describe('PLAN_RESPONSE_SCHEMA', () => {
  it('cubre rationale + days[] con la fecha exacta y el tipo del día', () => {
    expect(PLAN_RESPONSE_SCHEMA.type).toBe('OBJECT');
    expect(PLAN_RESPONSE_SCHEMA.required).toEqual(['rationale', 'days']);
    expect(PLAN_RESPONSE_SCHEMA.properties?.rationale?.type).toBe('STRING');
    const day = PLAN_RESPONSE_SCHEMA.properties?.days?.items;
    expect(day?.type).toBe('OBJECT');
    expect(day?.required).toEqual(['date', 'type', 'title', 'focus', 'exercises']);
    /* el tipo sale del prompt en texto ("entreno|cardio|…") sin `enum`: los
       consumidores (`applyWeek`, `normalizePlan`) ya normalizan y un enum mal
       soportado por el modelo rompería la llamada entera */
    expect(day?.properties?.type?.type).toBe('STRING');
    expect(day?.properties?.exercises?.items).toEqual(
      SUGGEST_RESPONSE_SCHEMA.properties?.exercises?.items,
    );
  });
});

describe('lo que la API rechazaría', () => {
  it('solo types en MAYÚSCULAS del subconjunto soportado', () => {
    for (const schema of [SUGGEST_RESPONSE_SCHEMA, PLAN_RESPONSE_SCHEMA]) {
      for (const node of walk(schema, '$')) {
        if (node.type) expect(TYPES, node.path).toContain(node.type);
        expect(node.path).not.toMatch(/\.(additionalProperties|format|\$ref|nullable|default)$/);
      }
    }
  });

  it('todo required apunta a una propiedad declarada', () => {
    checkRequired(SUGGEST_RESPONSE_SCHEMA, '$');
    checkRequired(PLAN_RESPONSE_SCHEMA, '$');
  });
});
