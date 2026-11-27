/**
 * Lectura y saneado compartido de propuestas de rutina del coach.
 *
 * La UI y state resuelven los ejercicios en contextos distintos (vista previa
 * conserva nombres desconocidos; state también admite `exId` y reporta fallos),
 * pero deben interpretar aliases, pesos y prescripciones de la misma forma.
 */
import { int, num } from './num';
import { sanitizePrescription } from './prescription';
import type { Prescription } from './prescription';

export type CoachRoutineEntry = Record<string, unknown>;

export interface CoachRoutineProposal {
  title: string;
  focus: string;
  notes: string;
  source: string;
  rationale: string[];
  entries: CoachRoutineEntry[];
}

export interface CoachRoutineItem {
  name: string;
  prescription: Prescription;
  notes: string;
  superset: string | null;
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Primer alias string no vacío, recortado. */
export function firstString(obj: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/** Vacío/ausente significa sin peso; cero sigue siendo peso corporal. */
export function toWeight(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = num(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

export function rationaleLines(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((line): line is string => typeof line === 'string' && line.trim() !== '')
      .map((line) => line.trim());
  }
  return typeof value === 'string' && value.trim() ? [value.trim()] : [];
}

/** Lee aliases y metadata sin perder objetos con `exId` aunque no tengan nombre. */
export function readCoachRoutineProposal(raw: unknown): CoachRoutineProposal | null {
  if (!isPlainRecord(raw)) return null;
  const list = Array.isArray(raw.exercises)
    ? raw.exercises
    : Array.isArray(raw.items)
      ? raw.items
      : null;
  if (!list) return null;
  return {
    title: firstString(raw, ['title', 'name']) || 'Rutina del coach',
    focus: firstString(raw, ['focus', 'grupos']),
    notes: firstString(raw, ['notes', 'note']),
    source: firstString(raw, ['source']),
    rationale: rationaleLines(raw.rationale),
    entries: list.filter(isPlainRecord),
  };
}

/**
 * Completa y sanea una entrada después de que el llamador haya elegido su
 * ejercicio y fallback (la biblioteca en preview, el ejercicio real al guardar).
 */
export function normalizeCoachRoutineItem(
  entry: CoachRoutineEntry,
  name: string,
  fallback: Prescription,
): CoachRoutineItem {
  const clean = sanitizePrescription(
    {
      sets: entry.sets === undefined ? undefined : int(entry.sets, fallback.sets),
      repMin: entry.repMin === undefined ? undefined : int(entry.repMin, fallback.repMin),
      repMax: entry.repMax === undefined ? undefined : int(entry.repMax, fallback.repMax),
      rest: entry.rest === undefined ? undefined : int(entry.rest, fallback.rest),
      weight: toWeight(entry.weight),
    },
    fallback,
  );
  return {
    name,
    prescription: clean,
    notes: firstString(entry, ['notes', 'note']),
    superset: firstString(entry, ['superset']).slice(0, 8) || null,
  };
}
