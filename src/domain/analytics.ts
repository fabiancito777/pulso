/**
 * Analítica del entrenamiento.
 *
 * Todo entra por parámetro (sesiones, ejercicios, unidad, `increment`) para que
 * las funciones sean puras y se puedan probar sin navegador.
 *
 * Convenio que se respeta y conviene no olvidar: los pesos guardados en
 * una serie están en la unidad de **su** sesión (`session.unit`), y ahí se pueden
 * mezclar kg y lb. Aquí todo se convierte a kg antes de sumar o comparar, y todo
 * lo que se devuelve está en kg.
 *
 * Una serie sin `done` no cuenta para nada (ni volumen, ni PR, ni series hechas),
 * y `e1rm(0, …)` es 0, no NaN.
 */
import {
  addDays,
  diffDays,
  dowIdx,
  iso,
  label as dateLabel,
  relative,
  startOfWeek,
  today,
} from './dates';
import { fmtN } from './format';
import { num, round, sum } from './num';
import { fromKg, toKg, unitLabel } from './units';
import type { Exercise, Session, SessionEntry, SetLog, Unit } from './types';

/** Punto de la serie histórica de un ejercicio (lo que se dibuja en Progreso). */
export interface ExercisePoint {
  iso: string;
  /** mejor 1RM estimado de esa sesión */
  e1rm: number;
  /** peso de la serie con mejor 1RM */
  top: number;
  reps: number;
  volume: number;
  sets: number;
}

export interface PersonalRecord {
  exId: string;
  e1rm: number;
  weight: number;
  reps: number;
  date: string;
}

export interface WeekBucket {
  /** lunes de la semana */
  iso: string;
  label: string;
  from: string;
  to: string;
  volume: number;
  sessions: number;
  sets: number;
  minutes: number;
}

export interface Totals {
  sessions: number;
  volume: number;
  sets: number;
  /** milisegundos */
  time: number;
  avgDuration: number;
  streak: number;
  bestStreak: number;
  firstDate: string | null;
}

export interface Suggestion {
  /** peso sugerido en la unidad pedida (0 si no hay historial) */
  weight: number;
  /** si existe una carga positiva registrada/sugerida; `weight`=0 puede ser centinela */
  weightAvailable?: boolean;
  reps: number;
  kg: number;
  basis: string;
  prev?: number;
  prevReps?: number;
}

/* ---------- primitivas por serie ---------- */

/**
 * Día del calendario de una sesión: el `date` explícito o, si falta, la fecha
 * LOCAL de `startedAt` (nunca `toISOString().slice(0, 10)`: eso es UTC y desplaza
 * el día según la zona). Una fecha inválida no inventa un día: devuelve `''`.
 */
export const sessionDate = (session: Session): string => {
  if (session.date) return session.date;
  if (!session.startedAt) return '';
  const started = new Date(session.startedAt);
  return Number.isFinite(started.getTime()) ? iso(started) : '';
};

/** Peso de una serie en kg. Tolerante: `''` y `null` valen 0. */
export const setKg = (set: SetLog | undefined, unit: Unit = 'kg'): number =>
  toKg(num(set?.weight), unit);

/** Volumen de una serie en kg: 0 si no está marcada. */
export function setVolumeKg(set: SetLog | undefined, unit: Unit = 'kg'): number {
  if (!set?.done) return 0;
  return setKg(set, unit) * num(set.reps);
}

/**
 * 1RM estimado con Epley. `reps === 1` devuelve el peso tal cual (la fórmula
 * daría 1,033× y en una serie de una repetición el peso levantado es el 1RM).
 */
export function e1rm(kg: unknown, reps: unknown): number {
  const w = num(kg);
  const r = num(reps);
  if (!w || !r || r < 1) return 0;
  return r === 1 ? w : w * (1 + r / 30);
}

/* ---------- por sesión ---------- */

export function setsOf(session: Session): number {
  return sum(session.entries, (en) => en.sets.filter((s) => s.done).length);
}

export function volumeOf(session: Session, unit?: Unit): number {
  const u = unit ?? session.unit ?? 'kg';
  return sum(session.entries, (en) => sum(en.sets, (set) => setVolumeKg(set, u)));
}

/**
 * Duración en ms. `now` se inyecta para poder probar una sesión sin cerrar (la
 * app la calcula en vivo mientras entrenas) sin depender del reloj.
 */
export function durationOf(session: Session, now: number = Date.now()): number {
  if (!session.startedAt) return 0;
  const start = new Date(session.startedAt).getTime();
  if (!Number.isFinite(start)) return 0;
  const end = session.endedAt ? new Date(session.endedAt).getTime() : now;
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, end - start);
}

/** Sesiones de los últimos `days` días (incluye hoy). */
export function sessionsSince(
  sessions: readonly Session[],
  days: number,
  todayIso: string = today(),
): Session[] {
  const from = addDays(todayIso, -num(days) + 1);
  return sessions.filter((s) => sessionDate(s) >= from);
}

/* ---------- por grupo muscular ---------- */

function groupOf(entry: SessionEntry, byId: Map<string, Exercise>): string {
  return byId.get(entry.exId)?.group || entry.group || 'otros';
}

function byIdMap(exercises: readonly Exercise[]): Map<string, Exercise> {
  return new Map(exercises.map((e) => [e.id, e]));
}

export function groupVolume(
  sessions: readonly Session[],
  exercises: readonly Exercise[] = [],
): Record<string, number> {
  const byId = byIdMap(exercises);
  const out: Record<string, number> = {};
  for (const session of sessions) {
    for (const entry of session.entries) {
      const key = groupOf(entry, byId);
      out[key] = (out[key] ?? 0) + sum(entry.sets, (set) => setVolumeKg(set, session.unit));
    }
  }
  return out;
}

export function groupSets(
  sessions: readonly Session[],
  exercises: readonly Exercise[] = [],
): Record<string, number> {
  const byId = byIdMap(exercises);
  const out: Record<string, number> = {};
  for (const session of sessions) {
    for (const entry of session.entries) {
      const key = groupOf(entry, byId);
      out[key] = (out[key] ?? 0) + entry.sets.filter((s) => s.done).length;
    }
  }
  return out;
}

/** Último día (`YYYY-MM-DD`) en que se tocó cada grupo. */
export function lastTrained(
  sessions: readonly Session[],
  exercises: readonly Exercise[] = [],
): Record<string, string> {
  const byId = byIdMap(exercises);
  const out: Record<string, string> = {};
  for (const session of sessions) {
    const iso = sessionDate(session);
    for (const entry of session.entries) {
      const key = groupOf(entry, byId);
      if (!out[key] || out[key] < iso) out[key] = iso;
    }
  }
  return out;
}

/** Días desde una fecha (null si no la hay). Negativo = en el futuro. */
export function daysSince(
  iso: string | null | undefined,
  todayIso: string = today(),
): number | null {
  return iso ? diffDays(todayIso, iso) : null;
}

/* ---------- semanas ---------- */

export function weeklySeries(
  sessions: readonly Session[],
  weeks = 8,
  todayIso: string = today(),
): WeekBucket[] {
  const n = Math.max(1, Math.trunc(num(weeks, 8)));
  const startThisWeek = startOfWeek(todayIso);
  const out: WeekBucket[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const from = addDays(startThisWeek, -7 * i);
    const to = addDays(from, 6);
    const inWeek = sessions.filter((s) => {
      const d = sessionDate(s);
      return d >= from && d <= to;
    });
    out.push({
      iso: from,
      label: dateLabel(from, 'short'),
      from,
      to,
      volume: sum(inWeek, (s) => volumeOf(s)),
      sessions: inWeek.length,
      sets: sum(inWeek, setsOf),
      minutes: Math.round(sum(inWeek, (s) => durationOf(s)) / 60_000),
    });
  }
  return out;
}

/* ---------- rachas ---------- */

/**
 * Racha actual. Detalle heredado: si hoy todavía no has entrenado, la
 * cuenta empieza ayer, así que la racha no se "rompe" hasta que pasa un día
 * entero sin sesión.
 */
export function streak(sessions: readonly Session[], todayIso: string = today()): number {
  const dates = new Set(sessions.map(sessionDate));
  let cursor = todayIso;
  if (!dates.has(cursor)) cursor = addDays(cursor, -1);
  let n = 0;
  while (dates.has(cursor)) {
    n++;
    cursor = addDays(cursor, -1);
  }
  return n;
}

export function bestStreak(sessions: readonly Session[]): number {
  const dates = [...new Set(sessions.map(sessionDate))].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of dates) {
    run = prev && diffDays(d, prev) === 1 ? run + 1 : 1;
    prev = d;
    if (run > best) best = run;
  }
  return best;
}

/* ---------- récords ---------- */

/** El mejor 1RM estimado por ejercicio (en kg, con el peso y la fecha de esa serie). */
export function prs(sessions: readonly Session[]): Record<string, PersonalRecord> {
  const out: Record<string, PersonalRecord> = {};
  for (const session of sessions) {
    for (const entry of session.entries) {
      for (const set of entry.sets) {
        if (!set?.done || !set.reps) continue;
        const kg = setKg(set, session.unit);
        const e = e1rm(kg, set.reps);
        const current = out[entry.exId];
        if (!current || e > current.e1rm) {
          out[entry.exId] = {
            exId: entry.exId,
            e1rm: e,
            weight: kg,
            reps: num(set.reps),
            date: sessionDate(session),
          };
        }
      }
    }
  }
  return out;
}

/* ---------- histórico de un ejercicio ---------- */

/** Serie cronológica (de la más antigua a la más reciente) de un ejercicio. */
export function exerciseSeries(sessions: readonly Session[], exId: string): ExercisePoint[] {
  const ordered = [...sessions].sort((a, b) => (sessionDate(a) < sessionDate(b) ? -1 : 1));
  const points: ExercisePoint[] = [];
  for (const session of ordered) {
    let best = 0;
    let top = 0;
    let reps = 0;
    let volume = 0;
    let n = 0;
    for (const entry of session.entries) {
      if (entry.exId !== exId) continue;
      for (const set of entry.sets) {
        if (!set.done) continue;
        const kg = setKg(set, session.unit);
        volume += kg * num(set.reps);
        const e = e1rm(kg, set.reps);
        if (e > best) {
          best = e;
          top = kg;
          reps = num(set.reps);
        }
        n++;
      }
    }
    if (n) points.push({ iso: sessionDate(session), e1rm: best, top, reps, volume, sets: n });
  }
  return points;
}

/** La última sesión en la que aparece el ejercicio, con su entrada. */
export function lastEntry(
  sessions: readonly Session[],
  exId: string,
): { session: Session; entry: SessionEntry } | null {
  const ordered = [...sessions].sort((a, b) => (sessionDate(a) < sessionDate(b) ? 1 : -1));
  for (const session of ordered) {
    const entry = session.entries.find((e) => e.exId === exId);
    if (entry) return { session, entry };
  }
  return null;
}

/* ---------- resumen por ejercicio (Ajustes → Ejercicios) ---------- */

/** Lo que la lista de Ajustes pinta bajo el nombre de cada ejercicio. */
export interface ExerciseSummary {
  /** último día (`YYYY-MM-DD`) con al menos una serie hecha; `null` si no la hay */
  lastIso: string | null;
  /** series HECHAS que acumula (las no marcadas no cuentan) */
  n: number;
  /** mejor 1RM estimado (Epley), en kg */
  e1rm: number;
}

/**
 * Resumen de todos los ejercicios en UNA sola pasada por sesiones → entradas →
 * series: es lo que da las métricas de la fila (`hace Nd · PR · ×n`) sin volver
 * a recorrer el historial una vez por cada uno de los 139 ejercicios.
 *
 * Un ejercicio que aparece en el historial pero sin ninguna serie hecha entra
 * con `{ lastIso: null, n: 0, e1rm: 0 }` (la fila queda sin métricas); uno que
 * nunca apareció no entra en el mapa. Los pesos se leen en la unidad de SU
 * sesión, como todo lo demás de este módulo.
 */
export function exerciseSummary(sessions: readonly Session[]): Map<string, ExerciseSummary> {
  const out = new Map<string, ExerciseSummary>();
  for (const session of sessions) {
    const iso = sessionDate(session);
    for (const entry of session.entries) {
      const current = out.get(entry.exId) ?? { lastIso: null, n: 0, e1rm: 0 };
      out.set(entry.exId, current);
      for (const set of entry.sets) {
        if (!set?.done) continue;
        if (!current.lastIso || current.lastIso < iso) current.lastIso = iso;
        current.n += 1;
        const estimated = e1rm(setKg(set, session.unit), set.reps);
        if (estimated > current.e1rm) current.e1rm = estimated;
      }
    }
  }
  return out;
}

export interface SuggestOptions {
  /** Repeticiones objetivo (si no, el `repMax` del ejercicio o 10). */
  targetReps?: number;
  /** Series prescritas. Si falta, se evalúan las series hechas en la última sesión. */
  targetSets?: number;
  /** Unidad en la que se devuelve el peso sugerido. */
  unit?: Unit;
  /** Salto mínimo respecto a la última vez (por defecto, el de la unidad). */
  increment?: number;
  /** Ejercicio de la biblioteca: solo aporta `repMin`/`repMax`. */
  exercise?: Pick<Exercise, 'repMin' | 'repMax'> | null;
}

/**
 * Peso para la próxima vez: toma en cuenta todas las series de la última sesión,
 * las reps pedidas y el RPE registrado. Solo propone subir cuando se completan
 * las series prescritas con las reps objetivo y esfuerzo razonable. La progresión
 * se limita a un incremento por vez; sin historial devuelve 0 (se pinta vacío).
 */
export function suggestWeight(
  sessions: readonly Session[],
  exId: string,
  opts: SuggestOptions = {},
): Suggestion {
  const ex = opts.exercise ?? null;
  const displayUnit = opts.unit ?? 'kg';
  const inc = num(opts.increment, displayUnit === 'lb' ? 5 : 2.5);
  const last = lastEntry(sessions, exId);
  /** Reps objetivo: las que pida quien pregunte, si no el rango de la biblioteca. */
  const repsFor = (fallback: number): number => {
    const n = Math.trunc(num(opts.targetReps, fallback));
    return n > 0 ? n : fallback;
  };
  if (!last) {
    return {
      weight: 0,
      weightAvailable: false,
      reps: repsFor(ex ? ex.repMin : 8),
      kg: 0,
      basis: 'sin historial',
    };
  }
  const reps = repsFor(ex ? ex.repMax : 10);
  const done = last.entry.sets.filter((s) => s.done && s.reps);
  if (!done.length) {
    return { weight: 0, weightAvailable: false, reps, kg: 0, basis: 'sin series registradas' };
  }
  const weighed = done
    .filter((set) => set.weight !== null)
    .map((set) => setKg(set, last.session.unit));
  const sorted = [...weighed].sort((a, b) => a - b);
  /* Ancla observada: no interpolar una mediana que nunca se levantó. */
  const kg = weighed.at(-1) ?? 0;
  const previous = round(fromKg(kg, displayUnit), 2);
  const targetSets = Math.max(1, Math.trunc(num(opts.targetSets, done.length)));
  const evaluated = done.slice(0, targetSets);
  const qualifying = evaluated.filter((set) => num(set.reps) >= reps);
  const rpes = evaluated
    .map((set) => set.rpe)
    .filter((rpe): rpe is number => rpe != null && Number.isFinite(rpe));
  const highRpeSet = evaluated.find((set) => set.rpe != null && set.rpe >= 9);
  const averageRpe = rpes.length
    ? round(rpes.reduce((total, value) => total + value, 0) / rpes.length, 1)
    : null;
  const highEffort = highRpeSet !== undefined || (averageRpe !== null && averageRpe >= 8.5);
  const variableLoad =
    sorted.length > 1 && (sorted.at(-1) ?? 0) - (sorted[0] ?? 0) > toKg(inc, displayUnit) * 0.75;
  const completedTarget = evaluated.length >= targetSets && qualifying.length >= targetSets;
  const canIncrease = previous > 0 && completedTarget && !highEffort && !variableLoad;
  const suggested = canIncrease ? round(previous + inc, 2) : previous;
  const targetLabel = `${qualifying.length} de ${targetSets} series previstas`;
  const effortLabel = highRpeSet
    ? ` · RPE ${fmtN(highRpeSet.rpe, 1)} en una serie`
    : averageRpe !== null
      ? ` · RPE medio ${fmtN(averageRpe, 1)}`
      : '';
  const reason = canIncrease
    ? `Sube a ${fmtN(suggested)} ${unitLabel(displayUnit)}: alcanzaste al menos ${reps} reps en ${targetLabel}${effortLabel}.`
    : previous > 0
      ? `Repite ${fmtN(previous)} ${unitLabel(displayUnit)}. Alcanzaste al menos ${reps} reps en ${targetLabel}${highEffort ? `${effortLabel} (esfuerzo alto)` : ''}${variableLoad ? ` · peso variable; última carga registrada: ${fmtN(fromKg(kg, displayUnit))} ${unitLabel(displayUnit)}` : ''}.`
      : `No hay carga registrada. La última vez hiciste ${fmtN(Math.max(...done.map((set) => num(set.reps))))} reps; no se puede inferir un peso para la próxima vez.`;
  return {
    weight: Math.max(0, suggested),
    weightAvailable: weighed.length > 0 && kg > 0,
    reps,
    kg: toKg(suggested, displayUnit),
    basis: `${reason} (${relative(sessionDate(last.session))})`,
    prev: previous,
    prevReps: Math.max(...done.map((set) => num(set.reps))),
  };
}

/* ---------- totales y repartos ---------- */

export function totals(sessions: readonly Session[], todayIso: string = today()): Totals {
  const durations = sessions.map((s) => durationOf(s));
  const firstDate = sessions.length ? [...sessions.map(sessionDate)].sort()[0] : null;
  return {
    sessions: sessions.length,
    volume: sum(sessions, (s) => volumeOf(s)),
    sets: sum(sessions, setsOf),
    time: sum(durations),
    avgDuration: durations.length ? sum(durations) / durations.length : 0,
    streak: streak(sessions, todayIso),
    bestStreak: bestStreak(sessions),
    firstDate: firstDate ?? null,
  };
}

/** Sesiones por día de la semana, empezando en lunes (0) como `dowIdx`. */
export function byDow(sessions: readonly Session[]): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0];
  for (const session of sessions) {
    const i = dowIdx(sessionDate(session));
    out[i] = (out[i] ?? 0) + 1;
  }
  return out;
}

/** Los últimos ejercicios entrenados, del más reciente al más antiguo. */
export function recentExercises(
  sessions: readonly Session[],
  exercises: readonly Exercise[],
  limit = 12,
): { ex: Exercise; date: string }[] {
  const byId = byIdMap(exercises);
  const seen = new Set<string>();
  const out: { ex: Exercise; date: string }[] = [];
  const ordered = [...sessions].sort((a, b) => {
    const da = sessionDate(a);
    const db = sessionDate(b);
    if (da !== db) return da < db ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  for (const session of ordered) {
    for (const entry of session.entries) {
      if (seen.has(entry.exId)) continue;
      seen.add(entry.exId);
      const ex = byId.get(entry.exId);
      if (ex) out.push({ ex, date: sessionDate(session) });
    }
  }
  return out.slice(0, Math.max(0, limit));
}
