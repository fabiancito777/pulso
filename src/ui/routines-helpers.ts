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
 * - **La generación local** («Generar auto», sin API key) monta la rutina desde una
 *   plantilla del catálogo y resuelve el peso con `suggestWeight`: es `S.routineFromTemplate`
 *   + `richItems` de la v1, con el ajuste por objetivo del modal `routines:generate`.
 * - **Agendar** propone el próximo día libre del calendario y valida el ISO del input.
 */
import { addDays } from '@/domain/dates';
import {
  findExercise,
  findExerciseByName,
  GOAL_REPS,
  GOAL_REST,
  GOAL_SETS,
  groupLabel,
  isAvailable,
} from '@/domain/data';
import type { EquipmentMap } from '@/domain/data';
import { clamp, int, num } from '@/domain/num';
import { richItems, routineFromTemplate } from '@/domain/plan';
import type { PlanInput } from '@/domain/plan';
import { norm, similarity } from '@/domain/text';
import type { Exercise, RoutineItem, RoutineTemplate, Session } from '@/domain/types';
import type { ScheduleDay } from '@/state/store';

import { dayState } from './calendar-helpers';

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

/* ---------- generación local (plantillas, sin API key) ---------- */

/** Rotación que ofrece el selector de «Generar auto» (la v1: 0/2/3/5). */
export const ROTATE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '0', label: 'No rotar' },
  { value: '2', label: '2 sesiones' },
  { value: '3', label: '3 sesiones' },
  { value: '5', label: '5 sesiones' },
];

/** Rotación por defecto: pesan las últimas 3 sesiones, como la v1. */
export const DEFAULT_ROTATE = 3;

/**
 * Datos que se pintan de una plantilla del catálogo: cuántos ejercicios trae y a
 * qué grupos toca (el «7 ejercicios · Pecho · Hombros · Tríceps» de la sección
 * Plantillas de la v1). El recuento es la suma de la receta, no lo que acabe
 * saliendo: con poco material pueden faltar ejercicios y eso se ve al generar.
 */
export function templateSummary(tpl: RoutineTemplate): { count: number; groups: string } {
  let count = 0;
  const groups: string[] = [];
  for (const pair of tpl.recipe) {
    count += int(pair[1], 0);
    const label = groupLabel(String(pair[0] ?? ''));
    if (label && !groups.includes(label)) groups.push(label);
  }
  return { count, groups: groups.join(' · ') };
}

/** Un ejercicio de la propuesta local, ya resuelto contra la biblioteca. */
export interface AutoItem {
  exId: string;
  name: string;
  /** grupo en castellano (`groupLabel`) */
  group: string;
  sets: number;
  repMin: number;
  repMax: number;
  rest: number;
  /** en `settings.units`; `null` = sin historial del que sugerir */
  weight: number | null;
  /** de dónde sale el peso («última vez 60 kg × 8», «sin historial») */
  basis: string;
  notes: string;
}

/** Rutina local propuesta, lista para pintar y para guardar con `addRoutine`. */
export interface AutoProposal {
  name: string;
  focus: string;
  notes: string;
  source: string;
  items: AutoItem[];
}

/**
 * Rutina generada a partir de una plantilla del catálogo, SIN red y SIN API key
 * (es la vía principal de generación de la pestaña Rutinas).
 *
 * Tres decisiones, todas de la v1 (`views-routines.js:115`, modal `routines:generate`):
 *
 * - **Material y prohibiciones**: los elige `routineFromTemplate` → `pickForGroup`,
 *   que solo contempla ejercicios permitidos y disponibles con `input.equipment`.
 * - **Series/reps/descanso por objetivo**: la receta trae los de la biblioteca y aquí
 *   se ajustan a `GOAL_*` (los aislados pierden una serie), que es lo que prometía
 *   el texto del modal.
 * - **Peso**: `richItems` lo resuelve con `suggestWeight` (histórico del usuario) en
 *   la unidad de los ajustes; sin historial queda `null` (la sesión sugerirá luego).
 *
 * Devuelve `null` si la plantilla no existe o si con ese material no sale NI UN
 * ejercicio, igual que el toast «No hay ejercicios disponibles con tu equipo».
 */
export function generateAuto(
  input: PlanInput,
  templateId: string,
  rotate: number | string = DEFAULT_ROTATE,
): AutoProposal | null {
  const draft = routineFromTemplate(input, templateId, {
    rotate: int(rotate, DEFAULT_ROTATE),
    source: 'generador',
  });
  if (!draft || !draft.items.length) return null;

  const goal = input.settings.goal;
  const goalSets = GOAL_SETS[goal] ?? 4;
  const reps = GOAL_REPS[goal] ?? [8, 12];
  const goalRest = GOAL_REST[goal] ?? 90;

  const prescribed = draft.items.map((item) => {
    const ex = findExercise(input.exercises, item.exId);
    const compound = ex ? ex.type === 'compuesto' : true;
    return {
      exId: item.exId,
      sets: compound ? goalSets : Math.max(3, goalSets - 1),
      repMin: int(reps[0], 8),
      repMax: int(reps[1], 12),
      rest: goalRest,
    };
  });

  const items: AutoItem[] = richItems(input, prescribed).map((row) => ({
    exId: row.exId,
    name: row.name,
    group: groupLabel(row.group),
    sets: row.sets,
    repMin: row.repMin,
    repMax: row.repMax,
    rest: row.rest,
    weight: row.weight > 0 ? row.weight : null,
    basis: row.basis,
    notes: row.notes,
  }));
  if (!items.length) return null;

  return {
    name: draft.name,
    focus: draft.focus,
    notes: draft.notes,
    source: draft.source,
    items,
  };
}

/**
 * Los items de la propuesta como `RoutineItem` para `addRoutine`: se quedan solo
 * con los campos que guarda el estado (los de pantalla —nombre, grupo, `basis`—
 * viven en la propuesta, no en el `localStorage` compartido con la v1).
 */
export function autoRoutineItems(items: readonly AutoItem[]): RoutineItem[] {
  return items.map((item) => ({
    exId: item.exId,
    sets: item.sets,
    repMin: item.repMin,
    repMax: item.repMax,
    rest: item.rest,
    weight: item.weight,
    notes: item.notes,
  }));
}

/* ---------- agendar en el calendario ---------- */

/**
 * Primer día (desde `fromIso`, incluido) sin nada planificado ni sesión
 * registrada: es con lo que se abre el picker de «Agendar» (`App.ui.dayPicker`
 * de la v1 empezaba en hoy y listaba 14 jornadas).
 *
 * El criterio de "libre" es el del calendario (`dayState(...) === 'free'`), así
 * que un día con sesión encima de un plan vacío NO se propone. Si las `horizon`
 * jornadas siguientes están todas ocupadas se devuelve mañana: el input tiene
 * que nacer con un valor editable.
 */
export function nextFreeDay(
  schedule: Readonly<Record<string, ScheduleDay>>,
  sessions: readonly Session[],
  fromIso: string,
  horizon = 14,
): string {
  const busy = new Map<string, number>();
  for (const session of sessions) {
    const day = session.date || (session.startedAt ?? '').slice(0, 10);
    if (day) busy.set(day, (busy.get(day) ?? 0) + 1);
  }
  const days = clamp(int(horizon, 14), 1, 120);
  for (let i = 0; i < days; i++) {
    const isoDate = addDays(fromIso, i);
    if (dayState(schedule[isoDate], busy.get(isoDate) ?? 0) === 'free') return isoDate;
  }
  return addDays(fromIso, 1);
}

/**
 * Patch que escribe `setDay` al agendar una rutina: la misma semántica de
 * `routines:schedule` + `App.ui.dayPicker` de la v1 (`app.js:454`) — rutina,
 * tipo `entreno`, estado `planificado`, el nombre como título y origen manual.
 *
 * Va en helper (y no en línea en el componente) porque `setDay` hace merge: lo
 * que NO se escriba aquí se hereda del día que hubiera.
 */
export function scheduleRoutinePatch(routine: { id: string; name?: string }): Partial<ScheduleDay> {
  return {
    routineId: routine.id,
    type: 'entreno',
    status: 'planned',
    title: typeof routine.name === 'string' && routine.name.trim() ? routine.name : 'Entrenamiento',
    source: 'manual',
  };
}

/** ¿Es un `YYYY-MM-DD` válido que no sea anterior a `fromIso` (hoy)? */
export function validScheduleIso(raw: string, fromIso: string): boolean {
  const value = String(raw ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return value >= fromIso;
}

/* ---------- detalle de solo lectura ---------- */

/** Fila del modal «Ver»: el ejercicio ya resuelto con sus números. */
export interface DetailRow {
  name: string;
  /** grupo en castellano (`''` si el ejercicio ya no está en la biblioteca) */
  group: string;
  sets: number;
  repMin: number;
  repMax: number;
  rest: number;
  /** `null` = sin peso prescrito (no «0 kg») */
  weight: number | null;
  notes: string;
  /** te falta material ahora mismo para hacerlo */
  missing: boolean;
}

/**
 * Items de una rutina para el modal de solo lectura: resuelve cada `exId` contra
 * la biblioteca y aplica los mismos defaults que el editor (`sets` 3, y
 * reps/descanso del ejercicio si el item no los trae).
 */
export function detailRows(
  items: readonly RoutineItem[],
  library: readonly Exercise[],
  equipment: EquipmentMap,
): DetailRow[] {
  return items.map((item) => {
    const ex = findExercise(library, item.exId);
    return {
      name: ex ? ex.name : item.exId,
      group: ex ? groupLabel(ex.group) : '',
      sets: int(item.sets, 3),
      repMin: int(item.repMin, ex ? ex.repMin : 8),
      repMax: int(item.repMax, ex ? ex.repMax : 12),
      rest: int(item.rest, ex ? ex.rest : 90),
      weight: typeof item.weight === 'number' ? item.weight : null,
      notes: typeof item.notes === 'string' ? item.notes : '',
      missing: ex ? !isAvailable(ex, equipment) : false,
    };
  });
}
