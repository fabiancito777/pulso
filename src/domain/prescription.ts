/**
 * Saneado de la prescripción de un ejercicio (series, reps, descanso y peso).
 *
 * Vive en el dominio porque lo usan DOS capas con la misma regla: el coach al
 * aplicar una propuesta (`state/coach.ts`) y la vista al pintarla
 * (`ui/routines-helpers.ts`). El modelo es libre de devolver `sets: 40` o
 * `rest: 50000`; sin este filtro, un JSON raro del coach acabaría guardado tal
 * cual en una rutina.
 *
 * Los rangos son los mismos que valida el editor manual
 * (`domain/exercise-draft.ts`): series 1-12, reps 1-100, descanso 0-600 s y
 * `repMax >= repMin`. El peso lleva un techo absoluto y no el máximo del
 * inventario a propósito: ese depende del modo de carga de cada ejercicio
 * (barra, mancuernas, máquina) y acotarlo aquí recortaría pesos legítimos de
 * máquina. Que el peso sea montable lo garantiza el prompt, que le manda el
 * inventario y el máximo cargable.
 */
import { clamp, int, num } from './num';

/** Prescripción numérica de un ejercicio, ya saneada. */
export interface Prescription {
  sets: number;
  repMin: number;
  repMax: number;
  rest: number;
  /** `null` = sin peso prescrito (no es lo mismo que 0 = peso corporal). */
  weight: number | null;
}

export const SETS_MIN = 1;
export const SETS_MAX = 12;
export const REPS_MIN = 1;
export const REPS_MAX = 100;
export const REST_MIN = 0;
export const REST_MAX = 600;
/**
 * Techo absoluto de peso, en la unidad del usuario. 500 kg (o 500 lb, que es
 * menos) cubre de sobra cualquier prescripción real y corta un `9999` del
 * modelo sin recortar un peso legítimo de máquina.
 */
export const WEIGHT_MAX = 500;

/**
 * Sanea los números de una prescripción.
 *
 * - `sets`/`repMin`/`repMax`/`rest` se acotan a los rangos del editor manual y
 *   `repMax` nunca queda por debajo de `repMin` (se sube, como en
 *   `validateDraft`).
 * - `weight` conserva `null` (sin peso) y `0` (peso corporal); un valor negativo
 *   o no finito pasa a `null` y uno disparatado se acota a `WEIGHT_MAX`.
 * - Los valores ausentes toman el respaldo (`fallback`), que es lo que traía la
 *   biblioteca o el valor por defecto del prompt.
 */
export function sanitizePrescription(
  raw: Partial<Prescription>,
  fallback: Prescription,
): Prescription {
  const sets = clamp(int(raw.sets, fallback.sets), SETS_MIN, SETS_MAX);
  const repMin = clamp(int(raw.repMin, fallback.repMin), REPS_MIN, REPS_MAX);
  const repMax = Math.max(clamp(int(raw.repMax, fallback.repMax), REPS_MIN, REPS_MAX), repMin);
  const rest = clamp(int(raw.rest, fallback.rest), REST_MIN, REST_MAX);

  let weight = raw.weight === undefined ? fallback.weight : raw.weight;
  if (weight !== null) {
    const parsed = num(weight, Number.NaN);
    weight = !Number.isFinite(parsed) || parsed < 0 ? null : Math.min(parsed, WEIGHT_MAX);
  }

  return { sets, repMin, repMax, rest, weight };
}
