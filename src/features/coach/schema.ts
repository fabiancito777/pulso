/**
 * Esquemas de respuesta para las tareas puramente JSON (`suggest` y `plan`).
 *
 * Se mandan en `generationConfig.responseSchema` (con `responseMimeType:
 * application/json`) y la API garantiza que la respuesta cumple la forma, así
 * el payload sale parseable sin depender de la prosa del modelo ni del
 * tolerante de `parse.ts`. Solo afecta a estas dos tareas: en `chat` y
 * `analyze` manda la conversación libre (bloques ```consulta```/```crear``` y
 * la memoria del usuario no caben en un schema cerrado).
 *
 * Reglas del subconjunto que acepta Google (ver `ResponseSchema` en
 * `types.ts`): types en MAYÚSCULAS y solo `type`/`properties`/`items`/
 * `required`/`description`. Un `additionalProperties` o un `format` que no
 * esté en esa lista haría fallar la llamada entera con 400 INVALID_ARGUMENT,
 * que además NO cae en el fallback local (`kind: 'http'`), así que aquí no se
 * arriesga nada: lo que quede fuera del schema simplemente no se pide.
 *
 * Los `required` son el contrato mínimo que leen los consumidores
 * (`toSuggestion`, `normalizePlan`, `applyWeek`): todo lo demás lo rellenan
 * ellos con su propio valor por defecto. Campos opcionales como `isNew`,
 * `group`, `equip` o `notes` van declarados aunque no sean obligatorios porque
 * el prompt de `prompts.ts` sí los usa («invéntalo con "isNew":true»).
 */
import type { ResponseSchema } from './types';

/** Un ejercicio dentro de una propuesta o de un día del plan (`SuggestExercise`). */
const EXERCISE: ResponseSchema = {
  type: 'OBJECT',
  properties: {
    name: {
      type: 'STRING',
      description: 'Nombre EXACTO de la lista permitida, o uno nuevo marcado con isNew',
    },
    sets: { type: 'INTEGER', description: 'Series del ejercicio' },
    repMin: { type: 'INTEGER', description: 'Repeticiones mínimas' },
    repMax: { type: 'INTEGER', description: 'Repeticiones máximas' },
    weight: {
      type: 'NUMBER',
      description: 'Peso en la unidad del usuario (0 si es peso corporal)',
    },
    rest: { type: 'INTEGER', description: 'Descanso en segundos' },
    notes: { type: 'STRING', description: 'Tip breve; vacío si no hay' },
    isNew: { type: 'BOOLEAN', description: 'true solo si el ejercicio no estaba en la lista' },
    group: { type: 'STRING', description: 'Grupo muscular; solo para ejercicios nuevos' },
    equip: { type: 'STRING', description: 'Clave de material, o "" si es peso corporal' },
    type: { type: 'STRING', description: 'fuerza|cardio|movilidad…; solo para ejercicios nuevos' },
    unilateral: { type: 'BOOLEAN', description: 'true si es a una mano o por lado' },
    desc: { type: 'STRING', description: 'Una frase corta del ejercicio nuevo' },
  },
  required: ['name', 'sets', 'repMin', 'repMax', 'weight', 'rest'],
};

/** Salida de `suggest`: la misma forma que pide el prompt de `prompts.ts`. */
export const SUGGEST_RESPONSE_SCHEMA: ResponseSchema = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING', description: 'Título corto de la rutina' },
    focus: { type: 'STRING', description: 'Grupos principales' },
    rationale: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Motivos del reparto' },
    exercises: { type: 'ARRAY', items: EXERCISE, description: 'Entre 4 y 7 ejercicios' },
  },
  required: ['title', 'focus', 'rationale', 'exercises'],
};

/** Salida de `plan`: 7 días con fecha exacta, tipo y sus ejercicios. */
export const PLAN_RESPONSE_SCHEMA: ResponseSchema = {
  type: 'OBJECT',
  properties: {
    rationale: { type: 'STRING', description: 'Explicación breve del reparto' },
    days: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          date: { type: 'STRING', description: 'Fecha exacta YYYY-MM-DD' },
          type: { type: 'STRING', description: 'entreno|cardio|movilidad|descanso' },
          title: { type: 'STRING', description: 'Nombre corto del día; vacío si es descanso' },
          focus: { type: 'STRING', description: 'Grupos del día; vacío si es descanso' },
          exercises: { type: 'ARRAY', items: EXERCISE, description: 'Vacío en días de descanso' },
        },
        required: ['date', 'type', 'title', 'focus', 'exercises'],
      },
    },
  },
  required: ['rationale', 'days'],
};
