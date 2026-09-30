/**
 * Historial del coach por dos caras: memoria consolidada y motor de consulta.
 *
 * - `consolidatedHistory` exprime **todo** el histórico en UNA ficha compacta
 *   por ejercicio, sin ventana temporal (la memoria a largo plazo del modelo,
 *   que vive en el contexto): nº de sesiones, rango de fechas, primera y última
 *   serie, mejor 1RM y las tres últimas. Ordenado por recencia y con tope de
 *   caracteres por línea, para que el prompt no se dispare.
 * - `queryHistory` responde al bloque ```consulta``` que el modelo puede emitir
 *   cuando necesita detalle: resuelve el nombre exigiendo un match muy fuerte
 *   (nombre visto en las sesiones o del catálogo, exacto tras `norm`, o
 *   similitud ≥ 0,85 —ver `resolveExercise`), filtra por rango de fechas y
 *   devuelve una línea por sesión. Si el nombre no está registrado devuelve un
 *   mensaje con parecidos, NUNCA datos de otro ejercicio.
 *
 * Puro: ni DOM, ni fetch, ni estado; sesiones, biblioteca y unidad entran por
 * parámetro. Los pesos se muestran convertidos a `opts.unit` (kg por defecto)
 * porque el histórico mezcla sesiones en lb y kg, y el e1RM sale de
 * `analytics.e1rm` (Epley, calculado sobre kg).
 */
import { e1rm, sessionDate, setKg } from '@/domain/analytics';
import { findExerciseByName } from '@/domain/data';
import { fmtN } from '@/domain/format';
import { int, num, round } from '@/domain/num';
import { norm, similarity, trunc } from '@/domain/text';
import { fromKg, unitLabel } from '@/domain/units';
import type { Exercise, Session, SessionEntry, Unit } from '@/domain/types';
import { planChangesFor } from './insights';

/** Caracteres máximos de una ficha del historial consolidado. */
export const HISTORY_LINE_MAX = 180;

/** Fichas por defecto del consolidado (las más recientes primero). */
export const HISTORY_DEFAULT_LINES = 60;

/** Sesiones que devuelve `kind: 'reciente'`. */
const RECENT_SESSIONS = 10;

/** Sesiones por defecto de una consulta. */
export const QUERY_DEFAULT_LIMIT = 30;

/**
 * Similitud mínima para resolver una consulta por un nombre parecido.
 *
 * 0,85 y no 0,5 como en la v1: quien redacta la consulta es el MODELO y se
 * inventa nombres («Curl con oso polar»), y con 0,5 se parecían lo bastante a
 * «Curl con barra» como para devolver los datos de OTRO ejercicio. Ver
 * `resolveExercise`.
 */
export const QUERY_SIMILARITY_MIN = 0.85;

/** Opciones compartidas por `consolidatedHistory` y `queryHistory`. */
export interface HistoryOptions {
  /** tope de fichas del consolidado (por defecto 60, las más recientes primero) */
  maxLines?: number;
  /** biblioteca: nombres exactos, grupos de los items del plan y sugerencias */
  exercises?: readonly Exercise[];
  /** añadir `[cambió: +…, −…]` a las fichas tocadas por cambios de plan */
  changes?: boolean;
  /** unidad en la que se muestran los pesos (por defecto kg) */
  unit?: Unit;
}

/**
 * Lo que el modelo manda dentro del bloque ```consulta``` (el campo `tipo`
 * habla en castellano para no confundir al modelo, la app lo traduce con
 * `HistoryQuery.kind`).
 */
export interface HistoryQuery {
  /** nombre del ejercicio (acentos y mayúsculas sobran; el parecido se exige fuerte) */
  exercise: string;
  /** `full` = detalle · `reciente` = últimas · `evolucion` = kg×reps + delta */
  kind?: 'full' | 'reciente' | 'evolucion';
  /** ISO local `YYYY-MM-DD` inclusive */
  since?: string;
  /** ISO local `YYYY-MM-DD` inclusive */
  until?: string;
  /** sesiones como máximo (por defecto 30) */
  limit?: number;
}

/** Un punto del histórico: una sesión de un ejercicio, con la mejor serie. */
interface Point {
  iso: string;
  /** kg de la mejor serie (siempre en kg) */
  kg: number;
  reps: number;
  /** e1RM de esa serie (kg) */
  best: number;
}

/** El rastro de un ejercicio en todo el histórico, en orden cronológico. */
interface Track {
  exId: string;
  name: string;
  points: Point[];
}

/** Una sesión filtrada, fila del motor de consulta (siempre en kg). */
interface Row {
  iso: string;
  sets: { kg: number; reps: number }[];
  top: Point;
  notes: string;
}

/** Mejor serie hecha de una entrada (mayor 1RM); null si no hay registro. */
function topOf(
  session: Session,
  entry: SessionEntry,
): { kg: number; reps: number; best: number } | null {
  const done = entry.sets.filter((set) => set.done && num(set.reps));
  if (!done.length) return null;
  const top = done.reduce((a, b) =>
    e1rm(setKg(b, session.unit), b.reps) > e1rm(setKg(a, session.unit), a.reps) ? b : a,
  );
  const kg = round(setKg(top, session.unit), 2);
  return { kg, reps: num(top.reps), best: round(e1rm(kg, top.reps), 2) };
}

/** Todo el histórico agrupado por ejercicio, con las fichas ya ordenadas por recencia. */
function buildTracks(sessions: readonly Session[]): Track[] {
  const ordered = [...sessions].sort((a, b) => (sessionDate(a) < sessionDate(b) ? -1 : 1));
  const byId = new Map<string, Track>();
  for (const session of ordered) {
    const iso = sessionDate(session);
    for (const entry of session.entries) {
      const top = topOf(session, entry);
      if (!top) continue;
      let track = byId.get(entry.exId);
      if (!track) {
        track = { exId: entry.exId, name: String(entry.name ?? entry.exId), points: [] };
        byId.set(entry.exId, track);
      }
      /* el nombre más reciente manda: si el ejercicio se renombró, la ficha
         sale con el nombre que el modelo ve hoy en la biblioteca */
      track.name = String(entry.name ?? track.name);
      track.points.push({ iso, kg: top.kg, reps: top.reps, best: top.best });
    }
  }
  return [...byId.values()].sort((a, b) => {
    const lastA = a.points[a.points.length - 1].iso;
    const lastB = b.points[b.points.length - 1].iso;
    if (lastA !== lastB) return lastA < lastB ? 1 : -1;
    return a.name < b.name ? -1 : 1;
  });
}

/** Peso en la unidad de salida, con la coma es-ES (`fmtN`). */
const weight = (kg: number, unit: Unit): string => fmtN(fromKg(kg, unit), 1);

/** `60×6` / `57,5×8` en la unidad de salida. */
const pair = (kg: number, reps: number, unit: Unit): string => `${weight(kg, unit)}×${reps}`;

/** Diferencia con signo visible: `+20` / `−2,5` (nunca el guion de `fmtN`). */
const signed = (value: number, dec = 1): string =>
  `${value >= 0 ? '+' : '−'}${fmtN(Math.abs(value), dec)}`;

/** Una ficha compacta de un ejercicio; se recorta a `HISTORY_LINE_MAX`. */
function ficha(track: Track, unit: Unit, marker?: string): string {
  const points = track.points;
  const first = points[0];
  const last = points[points.length - 1];
  const best = Math.max(...points.map((point) => point.best));
  const ult3 = points
    .slice(-3)
    .reverse()
    .map((point) => pair(point.kg, point.reps, unit))
    .join(', ');
  let line =
    `${track.name} · ${countSessions(points.length)} · ` +
    `${first.iso}→${last.iso} · ${pair(first.kg, first.reps, unit)} → ` +
    `${pair(last.kg, last.reps, unit)} · mejor e1RM ${weight(best, unit)} ${unitLabel(unit)}` +
    ` · últ3: ${ult3}`;
  if (marker) line += ` ${marker}`;
  return trunc(line, HISTORY_LINE_MAX);
}

/**
 * Marcador `[cambió: +…, −…]` por ejercicio: una sustitución deja el mismo
 * marcador en las dos fichas (la que entró y la que salió), y lo que solo se
 * añadió o solo se quitó lleva su propio signo. Gana la sesión más reciente.
 */
function changeMarkers(
  sessions: readonly Session[],
  exercises: readonly Exercise[],
): Map<string, string> {
  const markers = new Map<string, string>();
  const add = (name: string, marker: string): void => {
    if (!markers.has(name)) markers.set(name, marker);
  };
  const ordered = [...sessions].sort((a, b) => (sessionDate(a) < sessionDate(b) ? 1 : -1));
  for (const session of ordered) {
    if (!session.plan || !session.plan.length) continue;
    const changes = planChangesFor(session, exercises);
    for (const pairSwap of changes.swapped) {
      const marker = `[cambió: +${pairSwap.to}, −${pairSwap.from}]`;
      add(pairSwap.to, marker);
      add(pairSwap.from, marker);
    }
    const swappedTo = new Set(changes.swapped.map((swap) => swap.to));
    const swappedFrom = new Set(changes.swapped.map((swap) => swap.from));
    for (const name of changes.unplanned) {
      if (!swappedTo.has(name)) add(name, `[cambió: +${name}]`);
    }
    for (const name of changes.missing) {
      if (!swappedFrom.has(name)) add(name, `[cambió: −${name}]`);
    }
  }
  return markers;
}

/**
 * Una ficha compacta por ejercicio con TODO el histórico (sin ventana temporal),
 * ordenado por recencia y sin pasar de `maxLines` (60 por defecto).
 *
 * Ejemplo de ficha:
 * `Press banca · 14 sesiones · 2026-06-02→2026-09-25 · 40×8 → 60×6 ·
 * mejor e1RM 70,2 kg · últ3: 60×6, 60×5, 57,5×8`.
 */
export function consolidatedHistory(
  sessions: readonly Session[],
  opts: HistoryOptions = {},
): string[] {
  const limit = Math.max(0, int(opts.maxLines, HISTORY_DEFAULT_LINES));
  if (!limit) return [];
  const tracks = buildTracks(sessions);
  if (!tracks.length) return [];

  const unit = opts.unit ?? 'kg';
  const markers = opts.changes ? changeMarkers(sessions, opts.exercises ?? []) : null;
  return tracks.slice(0, limit).map((track) => ficha(track, unit, markers?.get(track.name)));
}

/**
 * Resuelve el nombre de la consulta a un `exId` exigiendo un match **muy**
 * fuerte, en este orden:
 *
 * 1. nombre visto previamente en las sesiones, exacto tras `norm` (acentos y
 *    mayúsculas sobran, la igualdad no);
 * 2. `findExerciseByName` del catálogo (mismo criterio exacto);
 * 3. `similarity ≥ QUERY_SIMILARITY_MIN` (0,85).
 *
 * Por qué tan estricto: la consulta la redacta el modelo y **se inventa
 * nombres** («Curl con oso polar»). Con el umbral viejo de 0,5 eso matcheaba
 * «Curl con barra» y `queryHistory` respondía con los datos de OTRO ejercicio
 * como si fueran del consultado: peor que no contestar, porque el modelo se lo
 * cree y lo repite. Si no hay match se devuelve el mensaje de
 * `notFoundMessage` con candidatos, para que el modelo pueda corregir la
 * consulta. El historial consolidado (`consolidatedHistory`) sigue siendo
 * flexible: ahí no se responde una pregunta concreta, solo se resume lo hecho.
 */
function resolveExercise(
  wanted: string,
  visible: ReadonlyMap<string, string>,
  exercises?: readonly Exercise[],
): { exId: string; name: string } | null {
  const target = norm(wanted);
  if (!target) return null;

  for (const [exId, name] of visible) {
    if (norm(name) === target || norm(exId) === target) return { exId, name };
  }

  const fromLibrary = exercises?.length ? findExerciseByName(exercises, wanted) : null;
  if (fromLibrary) return { exId: fromLibrary.id, name: fromLibrary.name };

  const candidates = [...visible.entries()].map(([exId, name]) => ({
    exId,
    name,
    score: similarity(target, name),
  }));
  for (const exercise of exercises ?? []) {
    if (visible.has(exercise.id)) continue;
    candidates.push({
      exId: exercise.id,
      name: exercise.name,
      score: similarity(target, exercise.name),
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best || best.score < QUERY_SIMILARITY_MIN) return null;
  return { exId: best.exId, name: best.name };
}

/**
 * Mensaje cuando el ejercicio no aparece por ningún sitio: dice CLARAMENTE que
 * el nombre no está registrado (y no los datos de nadie) y suelta una lista
 * corta de parecidos para que el modelo pueda reescribir la consulta.
 */
function notFoundMessage(
  wanted: string,
  visible: ReadonlyMap<string, string>,
  exercises?: readonly Exercise[],
): string {
  const pool = new Map(visible);
  for (const exercise of exercises ?? []) {
    if (!pool.has(exercise.id)) pool.set(exercise.id, exercise.name);
  }
  const near = [...pool.values()]
    .map((name) => ({ name, score: similarity(wanted, name) }))
    .filter((candidate) => candidate.score > 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((candidate) => candidate.name);
  return (
    `No encuentro «${wanted}» en el historial. ${wanted} no está registrado en tu historial.` +
    ` Ejercicios parecidos: ${near.length ? near.join(', ') : 'ninguno'}.`
  );
}

/** Mensaje cuando el ejercicio existe pero no hay sesiones en el rango pedido. */
function emptyRangeMessage(label: string, query: HistoryQuery): string {
  const { since, until } = query;
  const scope =
    since && until
      ? ` entre ${since} y ${until}`
      : since
        ? ` desde ${since}`
        : until
          ? ` hasta ${until}`
          : '';
  return `No hay sesiones registradas de «${label}»${scope}.`;
}

/** Filtra las sesiones de un ejercicio en el rango pedido (más reciente primero). */
function rowsOf(sessions: readonly Session[], exId: string, query: HistoryQuery): Row[] {
  const ordered = [...sessions].sort((a, b) => (sessionDate(a) < sessionDate(b) ? 1 : -1));
  const rows: Row[] = [];
  for (const session of ordered) {
    const iso = sessionDate(session);
    if (query.since && iso < query.since) continue;
    if (query.until && iso > query.until) continue;
    const entry = session.entries.find((candidate) => candidate.exId === exId);
    if (!entry) continue;
    const top = topOf(session, entry);
    if (!top) continue;
    rows.push({
      iso,
      sets: entry.sets
        .filter((set) => set.done && num(set.reps))
        .map((set) => ({ kg: round(setKg(set, session.unit), 2), reps: num(set.reps) })),
      top: { iso, kg: top.kg, reps: top.reps, best: top.best },
      notes: String(entry.notes ?? '').trim(),
    });
  }
  return rows;
}

/** `3 sesiones` / `1 sesión` (el conteo se reutiliza en ficha y cabeceras). */
const countSessions = (n: number): string => `${n} ${n === 1 ? 'sesión' : 'sesiones'}`;

/** `full`: cabecera, detalle serie a serie de cada sesión y resumen final. */
function fullLines(label: string, rows: readonly Row[], limit: number, unit: Unit): string {
  const shown = rows.slice(0, limit);
  const first = rows[rows.length - 1].top;
  const last = rows[0].top;
  const best = Math.max(...rows.map((row) => row.top.best));
  const out: string[] = [`${label} · ${countSessions(rows.length)} · ${first.iso}→${last.iso}`];
  for (const row of shown) {
    const detail = row.sets.map((set) => pair(set.kg, set.reps, unit)).join(', ');
    let line = `- ${row.iso}: ${detail} · e1RM ${weight(row.top.best, unit)} ${unitLabel(unit)}`;
    if (row.notes) line += ` · notas: ${row.notes}`;
    out.push(line);
  }
  if (rows.length > shown.length) {
    out.push(
      `… y ${rows.length - shown.length} sesiones anteriores no mostradas (límite ${limit}).`,
    );
  }
  out.push(
    `Resumen: mejor e1RM ${weight(best, unit)} ${unitLabel(unit)} · ` +
      `primera ${pair(first.kg, first.reps, unit)} · última ${pair(last.kg, last.reps, unit)}`,
  );
  return out.join('\n');
}

/** `reciente`: lo esencial de las últimas sesiones, una por línea. */
function recentLines(label: string, rows: readonly Row[], limit: number, unit: Unit): string {
  const recent = rows.slice(0, Math.min(limit, RECENT_SESSIONS));
  const out = [
    recent.length === 1
      ? `${label} · última 1 sesión:`
      : `${label} · últimas ${recent.length} sesiones:`,
  ];
  for (const row of recent) {
    out.push(`- ${row.iso}: ${pair(row.top.kg, row.top.reps, unit)} · ${row.sets.length} series`);
  }
  return out.join('\n');
}

/** `evolucion`: kg×reps por sesión en orden cronológico + delta global. */
function evolutionLines(label: string, rows: readonly Row[], limit: number, unit: Unit): string {
  const chrono = [...rows].reverse();
  const shown = chrono.slice(Math.max(0, chrono.length - limit));
  const out = shown.map((row) => `${row.iso}: ${pair(row.top.kg, row.top.reps, unit)}`);

  const first = rows[rows.length - 1].top;
  const last = rows[0].top;
  const deltaWeight = round(fromKg(last.kg, unit) - fromKg(first.kg, unit), 1);
  const deltaReps = last.reps - first.reps;
  const deltaBest = round(fromKg(last.best, unit) - fromKg(first.best, unit), 1);
  out.push(
    `Delta global (${first.iso}→${last.iso}): ` +
      `${pair(first.kg, first.reps, unit)} → ${pair(last.kg, last.reps, unit)} · ` +
      `peso ${signed(deltaWeight)} ${unitLabel(unit)} · reps ${signed(deltaReps, 0)} · ` +
      `e1RM ${signed(deltaBest)} ${unitLabel(unit)}`,
  );
  return `${label}\n${out.join('\n')}`;
}

/**
 * Motor de consulta del historial: líneas por sesión de UN ejercicio en el
 * rango pedido, listas para devolverle al modelo dentro de su propia respuesta.
 *
 * El nombre se resuelve con un match MUY fuerte (ver `resolveExercise`): si no,
 * en vez de devolver los datos de un ejercicio parecido, sale un mensaje claro
 * diciendo que ese nombre no está registrado más una lista corta de candidatos
 * para que el modelo corrija la consulta. Los pesos salen en la unidad de
 * `opts.unit` y el e1RM siempre con su etiqueta.
 */
export function queryHistory(
  sessions: readonly Session[],
  query: HistoryQuery,
  opts: HistoryOptions = {},
): string {
  const unit = opts.unit ?? 'kg';
  const limit = Math.max(1, int(query.limit, QUERY_DEFAULT_LIMIT));
  const wanted = String(query.exercise ?? '').trim();
  if (!wanted) return 'La consulta no trae el nombre del ejercicio.';

  const visible = new Map<string, string>();
  const ordered = [...sessions].sort((a, b) => (sessionDate(a) < sessionDate(b) ? 1 : -1));
  for (const session of ordered) {
    for (const entry of session.entries) {
      if (!visible.has(entry.exId)) visible.set(entry.exId, String(entry.name ?? entry.exId));
    }
  }

  const found = resolveExercise(wanted, visible, opts.exercises);
  if (!found) return notFoundMessage(wanted, visible, opts.exercises);

  const rows = rowsOf(sessions, found.exId, query);
  if (!rows.length) return emptyRangeMessage(found.name, query);

  switch (query.kind ?? 'full') {
    case 'reciente':
      return recentLines(found.name, rows, limit, unit);
    case 'evolucion':
      return evolutionLines(found.name, rows, limit, unit);
    default:
      return fullLines(found.name, rows, limit, unit);
  }
}
