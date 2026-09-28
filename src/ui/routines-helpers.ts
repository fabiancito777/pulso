/**
 * Helpers puros de la vista Rutinas: todo lo que se puede verificar sin DOM.
 *
 * Van aparte del componente porque aquí vive la parte con casos borde:
 *
 * - **La propuesta del coach llega como texto** (`runCoachTask` devuelve prosa/JSON
 *   que el modelo se inventa un poco), así que hay que normalizarla y resolver cada
 *   nombre contra la biblioteca: lo que resuelva, al aplicarlo (`applySuggestionAsRoutine`)
 *   no se cae; lo que no, se pinta marcado para que se vea antes de aplicar.
 * - **La búsqueda de ejercicios** tolera tildes, faltas de ortografía y búsquedas
 *   por grupo muscular, igual que la de la v1 (`U.similarity`).
 */
import { findExerciseByName, groupLabel } from '@/domain/data';
import { clamp, int, num } from '@/domain/num';
import { norm, similarity } from '@/domain/text';
import type { Exercise, RoutineItem, Session } from '@/domain/types';

/** Cuántos ejercicios devuelve la búsqueda por defecto. */
export const SEARCH_LIMIT = 8;

/** A partir de esta similitud (0-1) un nombre se considera "el mismo ejercicio". */
const MATCH_THRESHOLD = 0.6;

/* ---------- búsqueda de ejercicios ---------- */

/** Puntuación 0-1 de un ejercicio frente a lo escrito (nombre o grupo muscular). */
function score(query: string, ex: Exercise): number {
  return Math.max(
    similarity(query, ex.name),
    similarity(query, `${groupLabel(ex.group)} ${ex.name}`),
  );
}

/**
 * Ejercicios que encajan con lo escrito, ordenados de mejor a peor.
 *
 * `query` vacío devuelve los primeros de la biblioteca (para que el selector no
 * aparezca en blanco); `exclude` evita los que ya están en la rutina.
 */
export function matchExercises(
  query: string,
  library: readonly Exercise[],
  exclude: readonly string[] = [],
  limit = SEARCH_LIMIT,
): Exercise[] {
  const q = norm(query);
  const skip = new Set(exclude);
  const pool = library.filter((ex) => !skip.has(ex.id));
  if (!q) return pool.slice(0, limit);
  return pool
    .map((ex) => ({ ex, s: score(q, ex) }))
    .filter((hit) => hit.s >= 0.4)
    .sort((a, b) => b.s - a.s || a.ex.name.localeCompare(b.ex.name))
    .slice(0, limit)
    .map((hit) => hit.ex);
}

/* ---------- números en inputs ---------- */

/**
 * Lee un `<input type="number">`: vacío o basura → `fallback`, y siempre acotado
 * a `[min, max]`. El vacío no puede dar `0` (el 0 es un peso real, no "sin poner").
 */
export function bounded(raw: string, min: number, max: number, fallback: number): number {
  const text = String(raw ?? '').trim();
  const value = text === '' ? fallback : int(text, fallback);
  return clamp(value, min, max);
}

/** Peso base de un item: vacío → `null` (sin peso), nunca `0`. */
export function weightOrNull(raw: string): number | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const value = num(text, Number.NaN);
  return Number.isFinite(value) ? value : null;
}

/* ---------- rutinas: datos para pintar ---------- */

/** Total de series que prescribe una rutina (cada item sin `sets` vale 3, como la v1). */
export function routineSets(items: readonly RoutineItem[] | undefined): number {
  return (items ?? []).reduce((total, item) => total + int(item.sets, 3), 0);
}

/** Badge del origen de la rutina: `ia` → IA, `generador` → auto, lo demás → manual. */
export function sourceBadge(source: unknown): { cls: string; label: string } {
  const value = typeof source === 'string' ? source : '';
  if (value === 'ia') return { cls: 'badge a', label: 'IA' };
  if (value === 'generador') return { cls: 'badge', label: 'auto' };
  return { cls: 'badge', label: 'manual' };
}

/** La sesión más reciente que arrancó desde esa rutina (o `null`: nunca usada). */
export function lastUsed(sessions: readonly Session[], routineId: string): Session | null {
  let best: Session | null = null;
  for (const session of sessions) {
    if (session.routineId !== routineId) continue;
    if (!best || sessionKey(session) > sessionKey(best)) best = session;
  }
  return best;
}

/** Clave de ordenación de una sesión: fecha (YYYY-MM-DD) y luego inicio. */
function sessionKey(session: Session): string {
  return `${session.date}|${session.startedAt ?? ''}`;
}

/* ---------- propuesta del coach ---------- */

/** Un ejercicio propuesto, ya en números y con el nombre resuelto. */
export interface SuggestionExercise {
  /** Nombre tal y como se va a guardar (el de la biblioteca si se pudo resolver) */
  name: string;
  /** ¿Está en la biblioteca? Si no, `applySuggestionAsRoutine` lo omitirá */
  matched: boolean;
  sets: number;
  repMin: number;
  repMax: number;
  rest: number;
  weight: number | null;
  notes: string;
}

/** Propuesta de rutina del coach, lista para pintar y para aplicar. */
export interface RoutineSuggestion {
  title: string;
  focus: string;
  rationale: string[];
  exercises: SuggestionExercise[];
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Primer campo de `keys` que sea string no vacío (alias que el modelo puede usar). */
function firstString(obj: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/** `weight` propuesto: `''`/ausente = sin peso (`null`), no `0`. */
function toWeight(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = num(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

/** El `rationale` del modelo: array de frases o una frase suelta. */
function toRationale(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((line): line is string => typeof line === 'string' && line.trim() !== '')
      .map((line) => line.trim());
  }
  return typeof value === 'string' && value.trim() ? [value.trim()] : [];
}

/**
 * Nombre exacto de la biblioteca para el que ha escrito el modelo: primero a
 * pelo (`findExerciseByName`, tolerante a tildes y al slug) y después por
 * similitud. Por debajo del umbral se conserva el nombre tal cual y `matched`
 * queda en `false` (eso se pinta con su badge, no se inventa un ejercicio).
 */
function resolveName(
  name: string,
  library: readonly Exercise[],
): { name: string; matched: boolean } {
  const exact = findExerciseByName(library, name);
  if (exact) return { name: exact.name, matched: true };

  const query = norm(name);
  let best: Exercise | null = null;
  let bestScore = 0;
  for (const ex of library) {
    const s = similarity(query, ex.name);
    if (s > bestScore) {
      bestScore = s;
      best = ex;
    }
  }
  return best && bestScore >= MATCH_THRESHOLD
    ? { name: best.name, matched: true }
    : { name, matched: false };
}

/**
 * Normaliza la propuesta del coach (`{title, focus?, rationale?, exercises|items}`).
 * Devuelve `null` si la entrada no se parece a una sugerencia o si no queda NI UN
 * ejercicio con nombre (el mismo criterio que `applySuggestionAsRoutine`).
 */
export function toSuggestion(raw: unknown, library: readonly Exercise[]): RoutineSuggestion | null {
  if (!isPlain(raw)) return null;
  const list = Array.isArray(raw.exercises)
    ? raw.exercises
    : Array.isArray(raw.items)
      ? raw.items
      : null;
  if (!list) return null;

  const exercises: SuggestionExercise[] = [];
  for (const entry of list) {
    if (!isPlain(entry)) continue;
    const name = firstString(entry, ['name', 'exercise', 'ejercicio']);
    if (!name) continue;
    const resolved = resolveName(name, library);
    exercises.push({
      name: resolved.name,
      matched: resolved.matched,
      sets: int(entry.sets, 3),
      repMin: int(entry.repMin, 8),
      repMax: int(entry.repMax, 12),
      rest: int(entry.rest, 90),
      weight: toWeight(entry.weight),
      notes: firstString(entry, ['notes', 'note']),
    });
  }
  if (!exercises.length) return null;

  return {
    title: firstString(raw, ['title', 'name']) || 'Rutina del coach',
    focus: firstString(raw, ['focus', 'grupos']),
    rationale: toRationale(raw.rationale),
    exercises,
  };
}
