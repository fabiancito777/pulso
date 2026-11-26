/**
 * Helpers puros de la pestaña Progreso (spec S1 §3.4): todo lo que antes
 * calculaba dentro de `views-stats.js` y de `app.js` con el estado global a mano.
 *
 * Nada de DOM, nada de signals: sesiones y ejercicios entran por parámetro, así
 * que los cinco bloques (resumen de sesión, récords nuevos, último estímulo por
 * grupo, tabla de PRs y chips de progresión) se prueban con Vitest.
 *
 * Convenciones heredadas que se respetan aquí:
 *
 * - una serie sin `done` no cuenta (ni para el resumen ni para un récord);
 * - los pesos salen en **kg** (`volumeOf`/`setKg` ya convierten desde la unidad
 *   de la sesión);
 * - «récord nuevo» compara contra las sesiones con fecha **estrictamente**
 *   anterior (`prsBefore`, antes `app.js:908`) con margen 0,01 kg: un empate no es
 *   un récord.
 */
import {
  daysSince,
  durationOf,
  e1rm,
  exerciseSeries,
  lastTrained,
  prs,
  sessionDate,
  setKg,
  setsOf,
  volumeOf,
  weeklySeries,
} from '@/domain/analytics';
import type { PersonalRecord } from '@/domain/analytics';
import { GROUPS, groupKeysInUse, groupLabel } from '@/domain/data';
import { today } from '@/domain/dates';
import { fmtTime } from '@/domain/format';
import { num } from '@/domain/num';
import type { Exercise, Session } from '@/domain/types';

/* ---------- resumen de una sesión (lista del historial) ---------- */

export interface SessionSummary {
  id: string;
  /** `YYYY-MM-DD` de la sesión */
  date: string;
  name: string;
  /** kg movidos (siempre kg, como los gráficos) */
  volume: number;
  sets: number;
  /** duración redondeada a minutos */
  minutes: number;
  /** etiquetas de grupo, sin repetir y en el orden de la sesión */
  groups: string[];
  demo: boolean;
  /** hora local de fin (`HH:MM`), vacía si la sesión no la trae */
  time: string;
  /** se guardó un ejercicio suelto, no la rutina entera */
  partial: boolean;
}

/**
 * Lo que pinta cada fila del historial (antes `views-stats.js:161-165`): fecha,
 * nombre, volumen, series, duración y grupos. El grupo sale del catálogo si el
 * ejercicio está en la biblioteca y, si no, del respaldo `entry.group` que antes
 * guardaba en cada entrada.
 */
export function sessionSummary(session: Session, exercises: readonly Exercise[]): SessionSummary {
  const byId = new Map(exercises.map((ex) => [ex.id, ex]));
  const groups: string[] = [];
  for (const entry of session.entries) {
    const key = byId.get(entry.exId)?.group ?? entry.group ?? '';
    const label = key ? groupLabel(key) : '';
    if (label && !groups.includes(label)) groups.push(label);
  }
  return {
    id: session.id,
    date: sessionDate(session),
    name: session.name || 'Entrenamiento',
    volume: volumeOf(session),
    sets: setsOf(session),
    minutes: Math.round(durationOf(session) / 60_000),
    groups,
    demo: session.demo === true,
    time: fmtTime(session.endedAt),
    partial: session.partial === true,
  };
}

/* ---------- récords nuevos de una sesión ---------- */

/**
 * Mejor 1RM estimado de cada ejercicio en las sesiones ANTERIORES a `iso`
 * (antes `prsBefore`, `app.js:908-930`). Las del propio día no cuentan: si haces
 * dos sesiones iguales seguidas, la segunda no «mejora» nada.
 */
export function prsBefore(sessions: readonly Session[], iso: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const session of sessions) {
    if (sessionDate(session) >= iso) continue;
    for (const entry of session.entries) {
      for (const set of entry.sets) {
        if (!set.done || !set.reps) continue;
        const e = e1rm(setKg(set, session.unit), set.reps);
        if (!out[entry.exId] || e > out[entry.exId]) out[entry.exId] = e;
      }
    }
  }
  return out;
}

export interface SessionPr {
  exId: string;
  e1rm: number;
  /** peso de la serie que marca el récord, en kg */
  weight: number;
  reps: number;
}

/**
 * Récords que marca una sesión: su mejor 1RM por ejercicio supera en más de
 * 0,01 kg a lo mejor de todo lo anterior (`app.js:932-943`).
 */
export function newPrs(session: Session, prior: Record<string, number>): SessionPr[] {
  const out: SessionPr[] = [];
  for (const entry of session.entries) {
    let best = 0;
    let weight = 0;
    let reps = 0;
    for (const set of entry.sets) {
      if (!set.done || !set.reps) continue;
      const kg = setKg(set, session.unit);
      const e = e1rm(kg, set.reps);
      if (e > best) {
        best = e;
        weight = kg;
        reps = num(set.reps);
      }
    }
    const before = prior[entry.exId] ?? 0;
    if (best && best > before + 0.01) out.push({ exId: entry.exId, e1rm: best, weight, reps });
  }
  return out;
}

/* ---------- último estímulo por grupo ---------- */

/** Tono de una fila: fresco (`ok`), en peligro (`warn`), frío (`danger`) o sin datos. */
export type StimulusTone = 'ok' | 'warn' | 'danger' | 'muted';

export interface StimulusRow {
  key: string;
  label: string;
  color: string;
  /** último día en que se entrenó el grupo, o `null` si nunca */
  iso: string | null;
  /** días desde ese día, o `null` si no hay datos */
  days: number | null;
  tone: StimulusTone;
}

/**
 * «Último estímulo» de cada grupo (antes `lastTrainedList`, `views-stats.js:76-89`):
 * sin cardio ni movilidad (se miden en minutos, no en días) y ordenado por
 * días SIN entrenar: lo más descuidado arriba y los que nunca se tocaron
 * primeros (antes les daba 999, así que encabezan la lista).
 */
export function lastStimulusRows(
  sessions: readonly Session[],
  exercises: readonly Exercise[],
  todayIso: string = today(),
): StimulusRow[] {
  const last = lastTrained(sessions, exercises);
  /* Solo los grupos que tienes: un grupo sin ejercicios saldría siempre «nunca» */
  const inUse = groupKeysInUse(exercises);
  return GROUPS.filter((g) => g.key !== 'cardio' && g.key !== 'movilidad' && inUse.has(g.key))
    .map((g) => {
      const iso = last[g.key] ?? null;
      const days = daysSince(iso, todayIso);
      const tone: StimulusTone =
        days === null ? 'muted' : days <= 3 ? 'ok' : days <= 7 ? 'warn' : 'danger';
      return { key: g.key, label: g.label, color: g.color, iso, days, tone };
    })
    .sort((a, b) => (b.days ?? 999) - (a.days ?? 999));
}

/* ---------- récords y chips de progresión ---------- */

/** La tabla completa de récords, del mayor 1RM estimado al menor. */
export function prRows(sessions: readonly Session[]): PersonalRecord[] {
  return Object.values(prs(sessions)).sort((a, b) => b.e1rm - a.e1rm);
}

export interface TopExercise {
  id: string;
  /** cuántas sesiones del historial lo traen */
  n: number;
}

/**
 * Los ejercicios más repetidos (chips de «Progresión», antes `exercisePickerRow`).
 * El orden es frecuencia → ★ → id: los favoritos solo DESATAMPAN un empate (la
 * frecuencia manda, que es lo que mide el chip) y el id sigue ahí para que dos
 * ejercicios con el mismo número de sesiones no cambien de orden entre repintados.
 *
 * `exercises` es opcional y solo se leen sus ★, así que el orden sin favoritos
 * es idéntico al de siempre.
 */
export function topExercises(
  sessions: readonly Session[],
  limit = 8,
  exercises: readonly Exercise[] = [],
): TopExercise[] {
  const fav = new Set(exercises.filter((e) => e.fav === true).map((e) => e.id));
  const counts = new Map<string, number>();
  for (const session of sessions) {
    for (const entry of session.entries) {
      counts.set(entry.exId, (counts.get(entry.exId) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([id, n]) => ({ id, n }))
    .sort(
      (a, b) =>
        b.n - a.n ||
        (fav.has(b.id) ? 1 : 0) - (fav.has(a.id) ? 1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .slice(0, Math.max(0, limit));
}

/**
 * Los ids con al menos una entrada en el historial: los que deja elegir el
 * picker de «Progresión» (antes `onlyDone` → `S.familiarity`, que contaba
 * entradas, no series marcadas).
 */
export function historyExerciseIds(sessions: readonly Session[]): string[] {
  const ids = new Set<string>();
  for (const session of sessions) {
    for (const entry of session.entries) ids.add(entry.exId);
  }
  return [...ids];
}

/** Snapshot para el encabezado de esta semana (semana local de lunes a domingo). */
export function currentWeekSummary(
  sessions: readonly Session[],
  todayIso: string,
): {
  sessions: number;
  sets: number;
  volume: number;
} {
  const week = weeklySeries(sessions, 1, todayIso)[0];
  return { sessions: week?.sessions ?? 0, sets: week?.sets ?? 0, volume: week?.volume ?? 0 };
}

/** Récords personales más recientemente mejorados, por fecha del último PR vigente. */
export function latestRecords(sessions: readonly Session[], limit = 3): PersonalRecord[] {
  return Object.values(prs(sessions))
    .filter((record) => record.e1rm > 0)
    .sort((a, b) => b.date.localeCompare(a.date) || b.e1rm - a.e1rm || a.exId.localeCompare(b.exId))
    .slice(0, Math.max(0, limit));
}

export interface ExerciseProgressSummary {
  date: string;
  /** Mejor serie registrada en la sesión más reciente: kg (null para peso corporal) y reps. */
  latest: { weight: number | null; reps: number };
  /** Mejor serie histórica por 1RM estimado, con peso corporal como reps si no hay carga. */
  best: { weight: number | null; reps: number; e1rm: number; date: string };
  /** 1RM estimado por sesión (kg), usado por el gráfico de tendencia. */
  trend: { date: string; e1rm: number }[];
}

/** Última sesión y mejor serie de un ejercicio. Un empate conserva la serie más antigua. */
export function exerciseProgressSummary(
  sessions: readonly Session[],
  exId: string,
): ExerciseProgressSummary | null {
  const points = exerciseSeries(sessions, exId);
  if (!points.length) return null;
  const matching = sessions
    .filter((session) =>
      session.entries.some(
        (entry) => entry.exId === exId && entry.sets.some((set) => set.done && set.reps > 0),
      ),
    )
    .sort((a, b) => {
      const ta = Date.parse(a.endedAt ?? a.startedAt);
      const tb = Date.parse(b.endedAt ?? b.startedAt);
      return (
        (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0) ||
        sessionDate(b).localeCompare(sessionDate(a)) ||
        b.id.localeCompare(a.id)
      );
    });
  const lastSession = matching[0];
  if (!lastSession) return null;
  const latestEntries = lastSession.entries.filter((entry) => entry.exId === exId);
  const latestDone = latestEntries.flatMap((entry) =>
    entry.sets.filter((set) => set.done && set.reps > 0),
  );
  if (!latestDone.length) return null;
  const bestSet = (sets: typeof latestDone, unit: Session['unit']) =>
    sets.reduce((best, set) => {
      const e = e1rm(setKg(set, unit), set.reps);
      const bestE = e1rm(setKg(best, unit), best.reps);
      return e > bestE || (e === bestE && e === 0 && set.reps > best.reps) ? set : best;
    });
  const lastBest = bestSet(latestDone, lastSession.unit);
  const allDone = sessions.flatMap((session) =>
    session.entries
      .filter((entry) => entry.exId === exId)
      .flatMap((entry) =>
        entry.sets.filter((set) => set.done && set.reps > 0).map((set) => ({ session, set })),
      ),
  );
  const best = allDone.reduce(
    (bestSoFar, current) => {
      const e = e1rm(setKg(current.set, current.session.unit), current.set.reps);
      return e > bestSoFar.e1rm ||
        (e === bestSoFar.e1rm && e === 0 && current.set.reps > bestSoFar.reps)
        ? {
            weight: current.set.weight == null ? null : setKg(current.set, current.session.unit),
            reps: current.set.reps,
            e1rm: e,
            date: sessionDate(current.session),
          }
        : bestSoFar;
    },
    { weight: null as number | null, reps: 0, e1rm: 0, date: '' },
  );
  return {
    date: sessionDate(lastSession),
    latest: {
      weight: lastBest.weight == null ? null : setKg(lastBest, lastSession.unit),
      reps: lastBest.reps,
    },
    best,
    trend: points.map((point) => ({ date: point.iso, e1rm: point.e1rm })),
  };
}
