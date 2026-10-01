/**
 * Borrador de ejercicio para el editor de Ajustes: validación en dominio puro,
 * sin DOM y sin estado. Port de la parte de `ui.exerciseEditor` de la v1
 * (`legacy/js/app.js` ~608-671) que decide SI el ejercicio se puede guardar y
 * con qué valores definitivos.
 *
 * Reglas de la v1 que NO se pueden cambiar sin querer:
 * - el nombre es obligatorio y viaja recortado;
 * - `repMin > repMax` se iguala SUBIENDO repMax (la v1 escuchaba el `change` de
 *   repMin y escribía su valor en repMax);
 * - `bw` (peso corporal) es simplemente `!equip`: el form solo expone material
 *   simple, así que un `a&b|c` de la biblioteca no se puede editar aquí;
 * - el id sale del slug del nombre y, si ya existe (¡incluso siendo de la
 *   semilla por defecto!), se sustituye por uno con `uid('ex')`. El id NUNCA se
 *   regenera al editar: rutinas y sesiones lo referencian.
 */
import { clamp, int, uid } from './num';
import { slug } from './text';
import type { Exercise, ExerciseType } from './types';

/** Lo que pinta el formulario (todavía sin id ni `bw`: eso lo resuelve `toExercise`). */
export interface ExerciseDraft {
  name: string;
  group: string;
  equip: string;
  type: ExerciseType;
  sets: number;
  rest: number;
  repMin: number;
  repMax: number;
  allowed: boolean;
}

export type DraftResult = { ok: true; value: ExerciseDraft } | { ok: false; error: string };

/** Borrador de un ejercicio nuevo: los mismos valores por defecto que la v1. */
export function emptyDraft(): ExerciseDraft {
  return {
    name: '',
    group: 'pecho',
    equip: '',
    type: 'aislado',
    sets: 3,
    rest: 90,
    repMin: 8,
    repMax: 12,
    allowed: true,
  };
}

/** Copia editable de un ejercicio (o borrador nuevo con `null`). */
export function draftFrom(ex: Exercise | null | undefined): ExerciseDraft {
  if (!ex) return emptyDraft();
  return {
    name: ex.name,
    group: ex.group,
    equip: ex.equip,
    type: ex.type,
    sets: ex.sets,
    rest: ex.rest,
    repMin: ex.repMin,
    repMax: ex.repMax,
    allowed: ex.allowed !== false,
  };
}

/**
 * Normaliza y valida el borrador: nombre recortado, números dentro de los
 * mismos rangos del form (series 1-12, descanso 0-600, reps 1-100) y
 * `repMax >= repMin`. El único error posible es el nombre vacío, que en la v1
 * también abortaba el guardado.
 */
export function validateDraft(draft: ExerciseDraft): DraftResult {
  const name = String(draft.name ?? '').trim();
  if (!name) return { ok: false, error: 'El nombre es obligatorio' };

  const repMin = clamp(int(draft.repMin, 8), 1, 100);
  const repMax = Math.max(clamp(int(draft.repMax, 12), 1, 100), repMin);

  return {
    ok: true,
    value: {
      name,
      group: String(draft.group ?? '') || 'pecho',
      equip: String(draft.equip ?? ''),
      type: draft.type,
      sets: clamp(int(draft.sets, 3), 1, 12),
      rest: clamp(int(draft.rest, 90), 0, 600),
      repMin,
      repMax,
      allowed: draft.allowed !== false,
    },
  };
}

/**
 * id definitivo de un ejercicio NUEVO: slug del nombre («Remo en polea alta» →
 * `remo-en-polea-alta`) y, si el slug ya está cogido por la semilla o por otro
 * propio, un `uid('ex')` — el id no se renombra después, porque es lo que
 * referencian rutinas y sesiones.
 */
export function idFor(name: string, taken: readonly string[]): string {
  const base = slug(name);
  if (base && !taken.includes(base)) return base;
  return uid('ex');
}

export interface BuildOptions {
  /** ids ya usados en la biblioteca (semilla incluida) */
  taken: readonly string[];
  /** id del ejercicio que se edita: se conserva sin mirar el nombre */
  currentId?: string;
}

export type BuildResult = { ok: true; value: Exercise } | { ok: false; error: string };

/**
 * Valida el borrador y lo convierte en el `Exercise` completo que persiste el
 * store (`bw = !equip`, `tags` y `tips` vacíos). El `custom` lo decide el
 * store: aquí solo sale el registro a guardar.
 */
export function toExercise(draft: ExerciseDraft, opts: BuildOptions): BuildResult {
  const checked = validateDraft(draft);
  if (!checked.ok) return checked;

  const value = checked.value;
  return {
    ok: true,
    value: {
      ...value,
      id: opts.currentId || idFor(value.name, opts.taken),
      custom: true,
      bw: !value.equip,
      tags: [],
      tips: '',
    },
  };
}
