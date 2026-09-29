/**
 * Planificador local del coach en dominio puro: plantillas, recetas, elección
 * de ejercicios y patrón de la semana.
 *
 * Port de `S.pickForGroup` / `S.itemsFromRecipe` / `S.routineFromTemplate`
 * (`legacy/js/store.js` ~655-709) y de `WEEK_LAYOUT` / `WEEK_ROTATION`
 * (`legacy/js/coach.js` ~360-365). La diferencia con la v1 es que aquí NO hay
 * estado: ajustes, biblioteca, material e historial entran en `PlanInput`, así
 * que lo mismo sirve para `features/coach/local.ts` que para un test con los
 * datos clavados a mano, sin navegador y sin reloj.
 *
 * ## Qué manda sobre la v1
 *
 * - **Plantillas**: `TEMPLATES` vive en `@/domain/catalog` (generado desde
 *   `legacy/js/data.js` con `tools/port-catalog.mjs`) y hoy es idéntico al de
 *   la v1: mismos 9 `id`, mismas recetas. Si algún día divergen, manda el
 *   catálogo, porque es lo que usa el resto de la app; `plan.test.ts` fija esa
 *   equivalencia para que un cambio accidental salga en la verificación.
 * - **Material**: la v1 filtraba con `S.usable()` (permitidos Y disponibles)
 *   dentro del propio `pickForGroup`; aquí el mismo filtro se hace con
 *   `isAvailable(ex, equipment)` y el mapa de material llega por parámetro, como
 *   en `plates.ts` y `data.ts`.
 * - **Rotación**: `rotate` = cuántas sesiones recientes pesan (por defecto 3,
 *   como la v1) y `rotate: 0` la desactiva. En la v1, `pickForGroup` suelto
 *   interpretaba `0` como `3`, pero en la práctica siempre recibía el mapa ya
 *   calcado de `itemsFromRecipe`, así que el comportamiento observable es el
 *   mismo: aquí se respeta el `0`.
 *
 * Todo es síncrono y sin `fetch`: este módulo no sabe qué es la red.
 */
import { suggestWeight } from './analytics';
import type { SuggestOptions, Suggestion } from './analytics';
import { TEMPLATES, findExercise, groupLabel, isAvailable } from './data';
import type { EquipmentMap } from './data';
import { clamp, int, num } from './num';
import type { Exercise, RoutineTemplate, Session, Settings, Unit } from './types';

/* ---------- entradas ---------- */

/**
 * Todo lo que el planificador necesita, por parámetro. Es el equivalente puro a
 * lo que la v1 leía de `window.App.store` (`S.settings()`, `S.exercises()`,
 * `S.isAvailable()` y `state.sessions`).
 */
export interface PlanInput {
  /** ajustes: unidad, incremento, objetivo y días/semana */
  settings: Settings;
  /** biblioteca ya fusionada (incluye los ejercicios propios del usuario) */
  exercises: readonly Exercise[];
  /** material activo: `{ clave: boolean }`, igual que en `plates.ts` */
  equipment: EquipmentMap;
  /** historial: de aquí salen familiaridad, rotación y peso sugerido */
  sessions: readonly Session[];
}

/** Cómo se elige un ejercicio dentro de un grupo (todo opcional). */
export interface PickOptions {
  /** ids ya elegidos en esta misma propuesta: no se repiten */
  used?: Record<string, boolean>;
  /** mapa `id → nº de sesiones recientes`; si falta, se calcula de `sessions` */
  recent?: Record<string, number>;
  /** cuántas sesiones recientes pesan para rotar (por defecto 3; 0 = nada) */
  rotate?: number;
  /** ids a descartar aparte de los ya usados */
  exclude?: Record<string, boolean>;
}

/** Un ejercicio prescrito salido de una receta (la forma de la v1, sin pesos). */
export interface RecipeItem {
  exId: string;
  sets: number;
  repMin: number;
  repMax: number;
  rest: number;
}

/** Un item «enriquecido» de entrada: lo que manda la receta sobre la biblioteca. */
export interface RichItemInput {
  exId: string;
  sets?: number;
  repMin?: number;
  repMax?: number;
  /** reps concretas; si faltan, la media del rango */
  reps?: number;
  rest?: number;
  /** peso fijo; si falta o es `null`, se pide a `suggest` */
  weight?: number | null;
  notes?: string;
}

/** Lo que devuelve `richItems`: el ejercicio ya resuelto con peso y descanso. */
export interface PlanExercise {
  exId: string;
  name: string;
  group: string;
  type: Exercise['type'];
  sets: number;
  reps: number;
  repMin: number;
  repMax: number;
  /** en `settings.units` (0 sin historial, que la app pinta vacío) */
  weight: number;
  unit: Unit;
  rest: number;
  /** de dónde sale el peso: «última vez 60 kg × 8 · hace 3 días» */
  basis: string;
  notes: string;
}

/**
 * Sugerencia de peso, inyectable igual que `StartOptions.suggest` de
 * `domain/session.ts`: por defecto es `analytics.suggestWeight` con la unidad y
 * el incremento de los ajustes, pero los tests la clavan a mano.
 */
export type SuggestFn = (exId: string, reps: number) => Pick<Suggestion, 'weight' | 'basis'>;

export interface RichOptions {
  /** motivo que se da cuando el peso NO viene de la sugerencia */
  basis?: string;
  /** sugerencia de peso propia (por defecto `analytics.suggestWeight`) */
  suggest?: SuggestFn;
}

/** Borrador de rutina: lo que la v1 guardaba con `S.addRoutine`, sin guardarlo. */
export interface RoutineDraft {
  name: string;
  focus: string;
  items: RecipeItem[];
  source: string;
  notes: string;
}

export interface TemplateOptions extends PickOptions {
  source?: string;
  notes?: string;
}

/* ---------- familiaridad y rotación ---------- */

/** Cuántas veces aparece un ejercicio en el historial (entries, hechas o no). */
function familiarity(sessions: readonly Session[], exId: string): number {
  let n = 0;
  for (const session of sessions) {
    for (const entry of session.entries) if (entry.exId === exId) n++;
  }
  return n;
}

/**
 * Mapa `id → nº de sesiones` de las últimas `n` sesiones del historial: es lo
 * que la v1 llamaba `recentlyUsedSessions` y con lo que se evita repetir los
 * mismos movimientos semana tras semana.
 */
export function recentlyUsedSessions(sessions: readonly Session[], n = 3): Record<string, number> {
  const out: Record<string, number> = {};
  for (const session of sessions.slice(0, int(n, 3))) {
    for (const entry of session.entries) out[entry.exId] = (out[entry.exId] ?? 0) + 1;
  }
  return out;
}

/* ---------- elección ---------- */

/**
 * Elige `count` ejercicios de un grupo respetando material, prohibiciones y lo
 * ya elegido. Orden (el de la v1, que es el que hace que la propuesta salga
 * «compuesto primero»): compuestos antes que aislados → los NO usados en las
 * últimas `rotate` sesiones → los MENOS familiares (novedad) → alfabético.
 */
export function pickForGroup(
  input: PlanInput,
  group: string,
  count = 1,
  opts: PickOptions = {},
): Exercise[] {
  const used = opts.used ?? {};
  const exclude = opts.exclude;
  const recent =
    opts.recent ??
    recentlyUsedSessions(input.sessions, opts.rotate === undefined ? 3 : opts.rotate);

  const cands = input.exercises.filter((ex) => {
    if (ex.group !== group || used[ex.id]) return false;
    if (exclude && exclude[ex.id]) return false;
    return ex.allowed && isAvailable(ex, input.equipment);
  });

  cands.sort((a, b) => {
    const typeA = a.type === 'compuesto' ? 0 : 1;
    const typeB = b.type === 'compuesto' ? 0 : 1;
    if (typeA !== typeB) return typeA - typeB;
    const recentA = recent[a.id] ? 1 : 0;
    const recentB = recent[b.id] ? 1 : 0;
    if (recentA !== recentB) return recentA - recentB;
    const fam = familiarity(input.sessions, b.id) - familiarity(input.sessions, a.id);
    if (fam !== 0) return fam;
    return a.name < b.name ? -1 : 1;
  });

  return cands.slice(0, int(count, 1));
}

/**
 * Expande una receta `[[grupo, cuántos], …]` en ejercicios concretos, sin
 * repetir entre pares (el mapa `used` viaja entero por la receta entera).
 * Los pesos NO se resuelven aquí: eso es `richItems`.
 */
export function itemsFromRecipe(
  input: PlanInput,
  recipe: readonly (readonly [string, number])[],
  opts: PickOptions = {},
): RecipeItem[] {
  const used: Record<string, boolean> = { ...(opts.used ?? {}) };
  const recent =
    opts.recent ??
    recentlyUsedSessions(input.sessions, opts.rotate === undefined ? 3 : opts.rotate);

  const items: RecipeItem[] = [];
  for (const pair of recipe) {
    const group = String(pair[0] ?? '');
    const count = int(pair[1], 1);
    for (const ex of pickForGroup(input, group, count, { used, recent, exclude: opts.exclude })) {
      used[ex.id] = true;
      items.push({
        exId: ex.id,
        sets: int(ex.sets, 3),
        repMin: ex.repMin,
        repMax: ex.repMax,
        rest: ex.rest,
      });
    }
  }
  return items;
}

/** Plantilla por id (null si no existe: la v1 devolvía `null` igual). */
export function findTemplate(templateId: string): RoutineTemplate | null {
  return TEMPLATES.find((tpl) => tpl.id === templateId) ?? null;
}

/**
 * Rutina lista para guardarse a partir de una plantilla del catálogo. Devuelve
 * un BORRADOR (`RoutineDraft`) en vez de la rutina guardada: guardar es cosa de
 * `state/store.ts`, aquí no hay estado.
 */
export function routineFromTemplate(
  input: PlanInput,
  templateId: string,
  opts: TemplateOptions = {},
): RoutineDraft | null {
  const tpl = findTemplate(templateId);
  if (!tpl) return null;

  const items = itemsFromRecipe(input, tpl.recipe, opts);
  const labels: string[] = [];
  for (const item of items) {
    const ex = findExercise(input.exercises, item.exId);
    const label = ex ? groupLabel(ex.group) : '';
    if (label && !labels.includes(label)) labels.push(label);
  }

  return {
    name: tpl.name,
    focus: labels.slice(0, 3).join(' · '),
    items,
    source: opts.source ?? 'generador',
    notes: opts.notes ?? '',
  };
}

/* ---------- pesos ---------- */

/** `suggestWeight` de fábrica, amarrado a la unidad y el incremento del usuario. */
function defaultSuggest(input: PlanInput): SuggestFn {
  const unit = input.settings.units;
  const inc = num(input.settings.increment, 0);
  return (exId, reps) => {
    const opts: SuggestOptions = {
      targetReps: reps,
      unit,
      exercise: findExercise(input.exercises, exId),
    };
    if (inc > 0) opts.increment = inc;
    const out = suggestWeight(input.sessions, exId, opts);
    return { weight: out.weight, basis: out.basis };
  };
}

/**
 * Completa items de receta con los valores de la biblioteca y el peso: es el
 * `richItems` de la v1 (`legacy/js/coach.js` ~290). Las reps por defecto son la
 * media del rango y el peso sale de `suggest` salvo que el item lo traiga fijo.
 * Los ids que ya no están en la biblioteca se OMITEN (igual que la v1, que
 * filtraba el `null`).
 */
export function richItems(
  input: PlanInput,
  list: readonly RichItemInput[],
  opts: RichOptions = {},
): PlanExercise[] {
  const suggest = opts.suggest ?? defaultSuggest(input);
  const out: PlanExercise[] = [];

  for (const item of list) {
    const ex = findExercise(input.exercises, item.exId);
    if (!ex) continue;

    const repMin = int(item.repMin, ex.repMin);
    const repMax = int(item.repMax, ex.repMax);
    const reps = int(item.reps, Math.round((repMin + repMax) / 2));
    const fixed = typeof item.weight === 'number' ? item.weight : null;
    const sug =
      fixed !== null
        ? { weight: fixed, basis: opts.basis ?? 'peso objetivo indicado' }
        : suggest(ex.id, reps);

    out.push({
      exId: ex.id,
      name: ex.name,
      group: ex.group,
      type: ex.type,
      sets: int(item.sets, ex.sets),
      reps,
      repMin,
      repMax,
      weight: sug.weight,
      unit: input.settings.units,
      rest: int(item.rest, ex.rest),
      basis: sug.basis,
      notes: item.notes ?? '',
    });
  }
  return out;
}

/* ---------- patrón de la semana ---------- */

/**
 * Días de la semana (índice 0 = lunes) en los que se entrena, por nº de días
 * semanales. Es la v1 literal: los huecos son días de descanso y, si sobra el
 * domingo (`i === 6 && n < 6`), ese hueco es recuperación activa en vez de
 * descanso.
 */
export const WEEK_LAYOUT: Record<number, readonly number[]> = {
  1: [2],
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 4, 5],
  6: [0, 1, 2, 3, 4, 5],
  7: [0, 1, 2, 3, 4, 5, 6],
};

/**
 * Plantillas que tocan en cada posición de `WEEK_LAYOUT`, también de la v1.
 * `full_a`/`full_b` para 1-3 días (fuerza completa), splits de 4-7 (push/pull/
 * legs + torso/pierna) y movilidad al final de la semana de 7.
 */
export const WEEK_ROTATION: Record<number, readonly string[]> = {
  1: ['full_a'],
  2: ['full_a', 'full_b'],
  3: ['full_a', 'full_b', 'full_a'],
  4: ['push', 'pull', 'legs', 'upper'],
  5: ['push', 'pull', 'legs', 'upper', 'lower'],
  6: ['push', 'pull', 'legs', 'push', 'pull', 'legs'],
  7: ['push', 'pull', 'legs', 'upper', 'lower', 'full_a', 'mobility'],
};

/** Qué toca en cada uno de los 7 días de la semana. */
export interface WeekSlot {
  /** 0 = lunes … 6 = domingo */
  index: number;
  /** plantilla del catálogo; `null` = descanso */
  templateId: string | null;
  /** domingo de recuperación activa (movilidad ligera) en vez de descanso */
  recovery: boolean;
}

/**
 * Patrón de 7 días para `daysPerWeek` (se recorta a 1-7 y lo que no esté en la
 * tabla cae en el reparto de 4, como la v1). Devuelve solo el PATRÓN: las
 * fechas y los pesos los pone `features/coach/local.ts`.
 */
export function weekSlots(daysPerWeek: number): WeekSlot[] {
  const n = clamp(int(daysPerWeek, 4) || 4, 1, 7);
  const layout = WEEK_LAYOUT[n] || WEEK_LAYOUT[4];
  const rotation = WEEK_ROTATION[n] || WEEK_ROTATION[4];

  const slots: WeekSlot[] = [];
  for (let i = 0; i < 7; i++) {
    const idx = layout.indexOf(i);
    if (idx < 0) {
      slots.push({ index: i, templateId: null, recovery: i === 6 && n < 6 });
      continue;
    }
    slots.push({
      index: i,
      templateId: rotation[idx % rotation.length] ?? null,
      recovery: false,
    });
  }
  return slots;
}
