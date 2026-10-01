/**
 * Único punto por el que la app CREA ejercicios propuestos por IA (spec
 * `_specs/creacion-ejercicios-plan.md` §3.2): el coach (A) y el generador de
 * Ajustes (B) solo IMPORTAN este fichero — `state/store.ts` no se toca, su
 * `saveExercise` sigue siendo el setter de siempre.
 *
 * Reglas del contrato:
 * - la propuesta pasa por `proposalToDraft` (dominio puro): borrador validado,
 *   `allowed: true`, `bw = !equip` y `custom: true` los pone `toExercise`/el store;
 * - un duplicado (match ≥ 0,85) NO se crea: se devuelve `error` para que la UI
 *   lo cuente (mejor un aviso que dos ejercicios parecidos en el historial);
 * - `desc` se persiste en `tips` (hoy `toExercise` lo deja vacío);
 * - «Crear y editar» no reutiliza el form: pide con `requestEdit(id)` que
 *   `SecEjercicios` abra el `ExerciseEditor` existente, que es quien sabe
 *   editar sin regenerar el id.
 */
import { signal } from '@preact/signals';

import { proposalToDraft } from '@/domain/ai-exercise';
import type { AIExerciseProposal } from '@/domain/ai-exercise';
import type { EquipmentMap } from '@/domain/data';
import { toExercise } from '@/domain/exercise-draft';
import type { Exercise } from '@/domain/types';

import { equipment, exercises, saveExercise } from './store';

/** Opcionales para no acoplar este módulo al store (los tests y la UI pasan snapshot). */
export interface CreateExerciseOptions {
  /** biblioteca con la que se detectan duplicados (por defecto, la del store) */
  library?: readonly Exercise[];
  /** material activo del usuario (por defecto, el del store) */
  equipment?: EquipmentMap;
}

export type CreateResult = { ok: true; exercise: Exercise } | { ok: false; error: string };

/**
 * Crea el ejercicio de una propuesta y lo persiste vía `saveExercise`.
 *
 * Devuelve `{ok:false}` (sin escribir NADA) cuando el borrador no es válido o
 * cuando el matcher ya enlaza la propuesta con un ejercicio existente: en ese
 * caso el nombre no es nuevo y crearlo duplicaría la biblioteca.
 */
export function createExerciseFromAI(
  proposal: AIExerciseProposal,
  opts: CreateExerciseOptions = {},
): CreateResult {
  const library = opts.library ?? exercises.value;
  const active = opts.equipment ?? equipment.value;

  const result = proposalToDraft(proposal, library, active);
  if (!result.ok) return { ok: false, error: result.error };

  const duplicate = result.info.duplicateOf;
  if (duplicate) {
    const existing = library.find((e) => e.name === duplicate) ?? null;
    return existing && existing.allowed === false
      ? { ok: false, error: `«${duplicate}» ya está en tu biblioteca y está prohibido` }
      : { ok: false, error: `Ya existe un ejercicio parecido: «${duplicate}»` };
  }

  const built = toExercise(result.draft, { taken: library.map((e) => e.id) });
  if (!built.ok) return { ok: false, error: built.error };

  const saved = saveExercise({ ...built.value, tips: result.info.desc || built.value.tips });
  return { ok: true, exercise: saved };
}

/* ---------- «Crear y editar» ---------- */

/**
 * id que Ajustes → Ejercicios debe abrir en su editor. `null` = nada pendiente.
 * Signal (y no estado de componente) a propósito: quien la pone es otra pestaña
 * del shell (el chat del coach) y el editor vive dentro de `SecEjercicios`.
 */
export const pendingEditId = signal<string | null>(null);

/** Pide abrir el `ExerciseEditor` con ese ejercicio (una sola petición, no una cola). */
export function requestEdit(id: string): void {
  pendingEditId.value = id.trim() || null;
}

/** Lectura ÚNICA de la petición: devuelve el id y la limpia (el editor no se reabre solo). */
export function takePendingEdit(): string | null {
  const id = pendingEditId.value;
  if (id) pendingEditId.value = null;
  return id;
}
