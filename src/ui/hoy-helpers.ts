/**
 * Helpers puros de la vista Hoy: el plan del día, la franja semanal, los KPIs
 * de 7 días, la repetición de una sesión, el saludo y las filas de la
 * sugerencia del coach.
 *
 * Están aparte del componente para poder probarlos con Vitest sin DOM, sin
 * `localStorage` y sin reloj: aquí solo entran datos por parámetro y salen
 * datos (el mismo trato que `calendar-helpers.ts` y `routines-helpers.ts`).
 *
 * Las decisiones que no se pueden romper sin querer:
 *
 * - **El día hecho manda**: una sesión con `date === hoy` deja el hero en
 *   `done` aunque el plan diga otra cosa (una sesión entrenada en `main` cuenta
 *   aquí también).
 * - **`routineId` colgado** (rutina borrada) no rompe nada: se cae al plan del
 *   día y, si no hay, a `empty`.
 * - **La semana se dibuja desde el lunes** con `weekDates` (ISO local), nunca
 *   con `toISOString()`.
 * - **`repeatItems` reparte el peso máximo** de cada ejercicio (el de la serie
 *   con más peso, como la v1) y deja el `basis` «repetición de …» para que la
 *   sesión cargada diga de dónde sale el peso.
 */
import { sessionDate, volumeOf, weeklySeries } from '@/domain/analytics';
import { dow, label as dateLabel, weekDates } from '@/domain/dates';
import { fmtN } from '@/domain/format';
import { int, num } from '@/domain/num';
import { trunc } from '@/domain/text';
import type { Exercise, PlanItem, Session } from '@/domain/types';
import type { Routine, ScheduleDay } from '@/state/store';

import { dayState, dayTitle, dayTypeLabel } from './calendar-helpers';
import type { DayState } from './calendar-helpers';
import type { RoutineSuggestion } from './routines-helpers';

/* ---------- plan de hoy ---------- */

/** Los tres estados del hero: día hecho, con plan o sin nada programado. */
export type TodayStatus = 'done' | 'plan' | 'empty';

/**
 * `PlanItem` con lo que la v1 metía dentro de `day.plan` y de la repetición:
 * `reps` concretas, el `basis` («repetición de 24 sep») y las `notes`.
 *
 * Es un PLANO del plan, no una sesión: `startFromPlan` lo recibe tal cual y
 * `resolvePlan` (`domain/session.ts`) los copia al snapshot y a la entrada, que es
 * con lo que la tarjeta de cada ejercicio explica de dónde sale el peso.
 */
export interface PlanLine extends PlanItem {
  /** reps concretas (la v1 las traía en `day.plan`; en repetición, la del top set) */
  reps?: number;
  /** de dónde sale el peso propuesto («repetición de 24 sep 2026») */
  basis?: string;
  notes?: string;
}

export interface TodayPlan {
  status: TodayStatus;
  /** Nombre de la rutina o `title` del día; vacío → la UI escribe «Entrenamiento». */
  title: string;
  /** Etiqueta del tipo de día ya resuelta («Entreno», «Descanso», «Libre»…). */
  type: string;
  /** Ejercicios a arrancar (rutina resuelta o `day.plan` de la v1). */
  items: PlanLine[];
  /** Rutina del día; `null` si no hay o colgaba de una rutina borrada. */
  routineId: string | null;
  /** Origen del plan (`ia`, `plan`…): para el badge del hero. */
  source: string;
}

/** Items de una rutina en la forma que entiende `startFromPlan`/`resolvePlan`. */
function routineItems(routine: Routine): PlanLine[] {
  return routine.items.map((item) => ({
    exId: item.exId,
    sets: item.sets,
    repMin: item.repMin,
    repMax: item.repMax,
    rest: item.rest,
    weight: item.weight,
    notes: item.notes,
  }));
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `day.plan` (los días con plan suelto de la v1, sin rutina asociada). Lo que no
 * traiga ni `exId` ni `name` se descarta: un item sin ejercicio no se puede
 * arrancar ni resolver (`resolvePlan` lo saltaría igual).
 */
function dayItems(day: ScheduleDay | null | undefined): PlanLine[] {
  const raw: unknown = day?.plan;
  if (!Array.isArray(raw)) return [];
  const out: PlanLine[] = [];
  for (const entry of raw) {
    if (!isPlain(entry)) continue;
    const exId = typeof entry.exId === 'string' ? entry.exId : '';
    const name = typeof entry.name === 'string' ? entry.name : '';
    if (!exId && !name) continue;
    const weight = entry.weight;
    const parsedWeight =
      weight === undefined || weight === null || weight === '' ? Number.NaN : num(weight, NaN);
    const reps = Number.isFinite(num(entry.reps, Number.NaN)) ? num(entry.reps) : undefined;
    const notes = typeof entry.notes === 'string' ? entry.notes : undefined;
    out.push({
      exId: exId || undefined,
      name: name || undefined,
      sets: int(entry.sets, 3),
      repMin: int(entry.repMin, 8),
      repMax: int(entry.repMax, 12),
      rest: int(entry.rest, 90),
      /* 0 es un peso REAL (peso corporal); vacío/nulo es «sin poner» */
      weight: Number.isFinite(parsedWeight) ? parsedWeight : null,
      ...(reps === undefined ? {} : { reps }),
      ...(notes === undefined ? {} : { notes }),
    });
  }
  return out;
}

/**
 * Plan de hoy resuelto: qué estado tiene el hero, con qué título y con qué
 * ejercicios se puede arrancar. Es el `todayPlan` de `legacy/js/views-train.js`
 * con el estado ya normalizado a los tres casos que pinta la vista.
 */
export function todayPlan(
  day: ScheduleDay | null | undefined,
  routines: readonly Routine[],
  sessions: readonly Session[],
  todayIso: string,
): TodayPlan {
  const rawRoutineId = typeof day?.routineId === 'string' ? day.routineId : '';
  const routineId = rawRoutineId || null;
  const routine = routineId ? (routines.find((r) => r.id === routineId) ?? null) : null;
  const items = routine ? routineItems(routine) : dayItems(day);
  const planTitle = typeof day?.title === 'string' ? day.title.trim() : '';
  const title = routine ? routine.name : planTitle;

  const doneToday = sessions.filter((s) => sessionDate(s) === todayIso).length;
  const status: TodayStatus =
    day?.status === 'done' || doneToday > 0 ? 'done' : items.length ? 'plan' : 'empty';

  /* El tipo sin escribir: una rutina o un `day.plan` es «Entreno» (la v1 lo
     resolvía en el hero con `plan.type || 'entreno'`), lo demás lo decide el
     estado del día («Libre», «Descanso», «Sesión»…). */
  const state = dayState(day, doneToday);
  const typeDay: ScheduleDay | null | undefined =
    day?.type || !(routine || items.length) ? day : { ...day, type: 'entreno' };

  return {
    status,
    title,
    type: dayTypeLabel(typeDay, state),
    items,
    routineId,
    source: typeof day?.source === 'string' ? day.source : routine ? 'plan' : '',
  };
}

/* ---------- filas del hero ---------- */

/** Una fila del listado del hero: nombre resuelto y «3×8 @ 60» ya formateado. */
export interface PlanRow {
  name: string;
  spec: string;
}

/**
 * Filas del hero (los primeros 8 ejercicios del plan). El nombre se resuelve
 * contra la biblioteca y el texto es el de la v1: `sets × reps` con las reps
 * concretas si las hay, si no la media del rango, y `@ peso` solo si hay peso
 * (un peso vacío no es 0: es «sin peso»).
 */
export function planRows(
  items: readonly PlanLine[],
  library: readonly Exercise[],
  limit = 8,
): PlanRow[] {
  const byId = new Map(library.map((ex) => [ex.id, ex]));
  return items.slice(0, Math.max(0, limit)).map((item) => {
    const ex = item.exId ? (byId.get(item.exId) ?? null) : null;
    const reps =
      item.reps || (item.repMin ? Math.round((num(item.repMin) + num(item.repMax)) / 2) : 0);
    const sets = int(item.sets, 3);
    const weight = item.weight ? ` @ ${fmtN(num(item.weight))}` : '';
    return { name: item.name || (ex ? ex.name : ''), spec: `${sets}×${reps || ''}${weight}` };
  });
}

/* ---------- franja de la semana ---------- */

export interface WeekCell {
  iso: string;
  /** Día de la semana corto: `lun`…`dom`. */
  dow: string;
  /** Lo que se escribe dentro de la celda: título, «hoy» o «libre». */
  tag: string;
  state: DayState;
  /** Volumen en kg de ese día (0 si no entrenaste). */
  volume: number;
  isToday: boolean;
}

/**
 * Las 7 celdas de la semana (de lunes a domingo) ya con su estado y su título.
 * `routines` es opcional para que quien solo quiera estados no tenga que
 * arrastrar el catálogo de rutinas.
 */
export function weekCells(
  schedule: Readonly<Record<string, ScheduleDay>>,
  sessions: readonly Session[],
  todayIso: string,
  routines: readonly Routine[] = [],
): WeekCell[] {
  const byDay = new Map<string, Session[]>();
  for (const session of sessions) {
    const isoDay = sessionDate(session);
    const list = byDay.get(isoDay);
    if (list) list.push(session);
    else byDay.set(isoDay, [session]);
  }

  return weekDates(todayIso).map((isoDay) => {
    const day = schedule[isoDay];
    const list = byDay.get(isoDay) ?? [];
    const routineId = typeof day?.routineId === 'string' ? day.routineId : '';
    const routine = routineId ? (routines.find((r) => r.id === routineId) ?? null) : null;
    const isToday = isoDay === todayIso;
    const title = dayTitle(day, routine?.name ?? '');
    return {
      iso: isoDay,
      dow: dow(isoDay),
      tag: trunc(title || (isToday ? 'hoy' : 'libre'), 26),
      state: dayState(day, list.length),
      volume: list.reduce((total, session) => total + volumeOf(session), 0),
      isToday,
    };
  });
}

/* ---------- KPIs de 7 días ---------- */

export interface WeekKpis {
  sessions: number;
  /** kg */
  volume: number;
  sets: number;
  minutes: number;
  /** % frente a la semana previa; `null` = sin comparativa (como la v1). */
  deltaPct: number | null;
  /** `settings.daysPerWeek` */
  objective: number;
}

/**
 * KPIs de los últimos 7 días con su comparativa contra la semana anterior.
 *
 * El `0` de la v1 no se pinta como «+0 %»: si la semana previa está vacía (o el
 * resultado redondea a 0) devuelve `null` y la UI escribe «sin comparativa»,
 * exactamente como el `kpis()` de `views-train.js`.
 */
export function weekKpis(
  sessions: readonly Session[],
  todayIso: string,
  daysPerWeek: number,
): WeekKpis {
  const week = weeklySeries(sessions, 1, todayIso)[0];
  const prev = weeklySeries(sessions, 2, todayIso)[0];
  const volume = week?.volume ?? 0;
  let deltaPct: number | null = null;
  if (prev && prev.volume) {
    const delta = Math.round(((volume - prev.volume) / prev.volume) * 100);
    deltaPct = delta === 0 ? null : delta;
  }
  return {
    sessions: week?.sessions ?? 0,
    volume,
    sets: week?.sets ?? 0,
    minutes: week?.minutes ?? 0,
    deltaPct,
    objective: int(daysPerWeek, 0),
  };
}

/* ---------- repetir una sesión ---------- */

/**
 * Items para repetir una sesión: nº de series de la v1, el peso y las reps de la
 * serie MEJOR cargada (mayor peso) y el `basis` que dirá de dónde sale el peso.
 *
 * Una entrada sin series (JSON a mano) sigue devolviendo 1 serie: no se puede
 * repetir un ejercicio con 0 series.
 */
export function repeatItems(session: Session): PlanLine[] {
  const basis = `repetición de ${dateLabel(sessionDate(session), 'medium')}`;
  return session.entries.map((entry) => {
    const sets = Array.isArray(entry.sets) ? entry.sets : [];
    const top = sets.reduce((best, set) => (num(set.weight) > num(best.weight) ? set : best), {
      weight: 0,
      reps: 10,
      done: true,
    });
    const reps = int(top.reps, 0) || 10;
    return {
      exId: entry.exId,
      sets: Math.max(1, sets.length),
      repMin: reps,
      repMax: reps,
      rest: int(entry.restSec, 90),
      weight: num(top.weight),
      reps,
      basis,
      notes: typeof entry.notes === 'string' ? entry.notes : '',
    };
  });
}

/**
 * Las últimas sesiones (las 4 de la v1) ya ordenadas de más reciente a más
 * antigua. El orden lo manda `startedAt` (no `date`, que puede repetirse al
 * importar datos), y como `readState` acepta cualquier JSON, el sort es
 * DEFENSIVO: no muta la lista original ni asume que hay `startedAt`.
 */
export function lastSessions(sessions: readonly Session[], limit = 4): Session[] {
  const startedAt = (session: Session): string =>
    typeof session.startedAt === 'string' ? session.startedAt : sessionDate(session);
  return [...sessions]
    .sort((a, b) => (startedAt(a) < startedAt(b) ? 1 : startedAt(a) > startedAt(b) ? -1 : 0))
    .slice(0, Math.max(0, limit));
}

/* ---------- saludo ---------- */

/**
 * Saludo del día: mañana (< 13 h), tarde (< 20 h) o noche, con el PRIMER
 * nombre si hay nombre guardado (era lo que ponía `V.sub` en la barra de la v1).
 */
export function greeting(hour: number, name: string): string {
  const greet = hour < 13 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';
  const first = String(name ?? '')
    .trim()
    .split(' ')[0];
  return first ? `${greet}, ${first}` : greet;
}

/* ---------- sugerencia del coach ---------- */

/** Una fila de «Recomendado ahora», con el grupo para el badge de color. */
export interface SuggestRow {
  name: string;
  /** clave de grupo muscular («» si el ejercicio no está en la biblioteca) */
  group: string;
  sets: number;
  /** reps concretas: la media del rango, como la v1 */
  reps: number;
  weight: number | null;
  matched: boolean;
}

/**
 * Filas de la sugerencia: el grupo sale de la biblioteca (la propuesta solo
 * trae el nombre), y las reps son la media del rango como en la v1
 * (`i.sets + '×' + i.reps`).
 */
export function suggestionRows(
  suggestion: RoutineSuggestion,
  library: readonly Exercise[],
): SuggestRow[] {
  return suggestion.exercises.map((item) => {
    const found = library.find((ex) => ex.name === item.name) ?? null;
    return {
      name: item.name,
      group: found?.group ?? '',
      sets: item.sets,
      reps: Math.round((item.repMin + item.repMax) / 2),
      weight: item.weight,
      matched: item.matched,
    };
  });
}

/**
 * Items de la sugerencia para `startFromPlan`. Solo los que resolvieron contra
 * la biblioteca: arrancar un ejercicio que no existe dejaría la sesión a medias
 * (el mismo criterio que `applySuggestionAsRoutine`).
 */
export function suggestionPlan(suggestion: RoutineSuggestion): PlanLine[] {
  return suggestion.exercises
    .filter((item) => item.matched)
    .map((item) => ({
      name: item.name,
      sets: item.sets,
      repMin: item.repMin,
      repMax: item.repMax,
      rest: item.rest,
      weight: item.weight,
      notes: item.notes,
    }));
}

/**
 * Origen visible de la sugerencia: el mismo badge de la v1
 * (`source === 'ia' ? 'IA' : 'local'`, `views-train.js:68`).
 *
 * `fallback` cubre el caso del payload SIN `source`: calculado aquí es `local`,
 * pero cuando el payload viene del coach ya sabemos que fue IA (aunque el modelo
 * se olvidara de escribirlo). Un `source` presente pero distinto de `ia`
 * (`local` cuando el planificador local cubrió una caída de red) manda sobre el
 * fallback: el badge no puede mentir sobre de dónde salió la sugerencia.
 */
export function suggestionSource(raw: unknown, fallback: 'ia' | 'local' = 'local'): 'ia' | 'local' {
  const source = isPlain(raw) && typeof raw.source === 'string' ? raw.source : '';
  if (source === 'ia') return 'ia';
  if (source) return 'local';
  return fallback;
}
