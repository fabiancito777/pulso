/**
 * Sesión en curso. Portado de `T.*` de la v1 (`legacy/js/trainer.js`) sin el timer
 * de descanso, la UI ni el audio: aquí solo están las REGLAS.
 *
 * Dos cambios de forma respecto a la v1, a propósito:
 *
 * 1. **Nada se muta.** `T.update(mutator)` mutaba la sesión activa por dentro; aquí
 *    cada función devuelve una sesión nueva. Con Preact y signals eso es lo que
 *    hace que la pantalla se repinte sola (y en la v1 era justo lo contrario:
 *    había que refrescar los inputs a mano para no cerrar el teclado).
 * 2. **Las decisiones se devuelven, no se ejecutan.** Al marcar una serie la v1
 *    arrancaba el descanso por dentro (leyendo `settings.autoRest` y hablando con
 *    el service worker); aquí `toggleSet` devuelve una `RestDecision` y quien
 *    llama decide. Eso es lo que permite probar \"cuándo hay descanso\" sin navegador.
 *
 * Reglas delicadas que NO hay que \"arreglar\" sin querer (fijadas en `session.test.ts`):
 *
 * - El valor se arrastra hacia **ABAJO**: editar la serie N toca las siguientes sin
 *   marcar; nunca las de arriba ni las ya marcadas.
 * - `''` (vacío) ≠ `0`: sin historial el peso va vacío, para que un ejercicio a peso
 *   corporal no parezca pesar 0 kg.
 * - Al marcar la **última** serie de un ejercicio el descanso solo arranca si queda
 *   otro ejercicio pendiente, y el aviso nombra ESE ejercicio (es el momento de
 *   cambiar de máquina). En la última serie de la sesión no arranca nada.
 * - **Desmarcar** una serie cancela el descanso en curso.
 * - El RPE no se arrastra: es un dato de esa serie, no una prescripción.
 */
import { type Suggestion } from './analytics';
import { findExercise, findExerciseByName } from './data';
import { today } from './dates';
import { avg, clamp, int, num, round, uid } from './num';
import { toKg } from './units';
import type {
  ActiveEntry,
  ActiveSession,
  ActiveSet,
  Exercise,
  PlanItem,
  RoutineItem,
  SessionEntry,
  Session,
  SetLog,
  Unit,
} from './types';

/** Lo que hay que hacer con el descanso al marcar o desmarcar una serie. */
export type RestDecision =
  { action: 'start'; sec: number; label: string } | { action: 'cancel' } | { action: 'none' };

export interface ToggleOptions {
  /** `undefined` = invertir el estado actual. */
  on?: boolean;
  /** `settings.autoRest`: apagado, marcar series no arranca descansos. */
  autoRest: boolean;
  /** `settings.restDefault`, solo si el ejercicio no trae descanso propio. */
  restDefault: number;
  /** ¿Hay un descanso corriendo ahora mismo? (para saber si hay que cancelarlo) */
  restRunning: boolean;
  /** Marca temporal ISO de la serie; se inyecta para no depender del reloj. */
  now?: string;
}

export interface ToggleResult {
  session: ActiveSession;
  entry: ActiveEntry;
  set: ActiveSet;
  done: boolean;
  rest: RestDecision;
}

export interface SessionProgress {
  done: number;
  total: number;
  pct: number;
  /** kg movidos (en kg aunque la sesión esté apuntada en libras) */
  volume: number;
  sets: number;
}

export interface StartOptions {
  /** Biblioteca ya fusionada: de ahí salen nombre, reps y descanso por defecto. */
  exercises: readonly Exercise[];
  /** Sugerencia de progresión por ejercicio (`analytics.suggestWeight`). */
  suggest: (exId: string) => Suggestion;
  routine?: { id: string; name?: string; items: readonly RoutineItem[] } | null;
  exIds?: readonly string[];
  plan?: readonly PlanItem[];
  name?: string;
  dayIso?: string;
  source?: string;
  unit?: Unit;
  now?: string;
  /** Inyectable para que los tests sean deterministas. */
  id?: string;
}

/* ---------- construcción ---------- */

/** Una serie en blanco. El peso vacío se queda vacío: ver la cabecera. */
export function blankSet(
  weight?: number | '' | null,
  reps?: number | '' | null,
  targetReps?: number,
): ActiveSet {
  const empty = (v: unknown): boolean => v === '' || v === undefined || v === null;
  return {
    weight: empty(weight) ? '' : num(weight),
    reps: empty(reps) ? '' : num(reps),
    done: false,
    ts: null,
    rpe: null,
    target: targetReps,
  };
}

export interface NewEntryOptions {
  exId: string;
  sets?: number;
  repMin?: number;
  repMax?: number;
  rest?: number;
  library: readonly Exercise[];
}

/** Un ejercicio de la sesión, con sus series vacías y los valores de la biblioteca. */
export function newEntry(opts: NewEntryOptions): ActiveEntry {
  const ex = findExercise(opts.library, opts.exId);
  const count = clamp(int(opts.sets, ex ? ex.sets : 3), 1, 12);
  return {
    exId: opts.exId,
    name: ex ? ex.name : opts.exId,
    restSec: int(opts.rest, ex ? ex.rest : 90),
    repMin: int(opts.repMin, ex ? ex.repMin : 8),
    repMax: int(opts.repMax, ex ? ex.repMax : 12),
    sets: Array.from({ length: count }, () => blankSet()),
    notes: '',
  };
}

/**
 * Rellena las series vacías con la sugerencia de progresión. El peso del plan, si
 * lo trae, se aplica después (`startSession`): manda sobre el historial.
 */
export function prefill(entry: ActiveEntry, suggestion: Suggestion): ActiveEntry {
  const sets = entry.sets.map((set) => {
    const next = { ...set };
    if (next.weight === '' || next.weight === null || next.weight === undefined) {
      next.weight = suggestion.weight ? suggestion.weight : '';
      next.suggested = suggestion.weight > 0;
    }
    if (next.reps === '' || next.reps === null || next.reps === undefined) {
      next.reps = suggestion.reps || entry.repMin;
    }
    next.done = !!next.done;
    return next;
  });
  return { ...entry, sets, basis: suggestion.basis };
}

/** `now`, `dayIso` y `id` son inyectables: los tests no deben depender del reloj. */
export function startSession(opts: StartOptions): ActiveSession {
  const make = (o: NewEntryOptions): ActiveEntry => prefill(newEntry(o), opts.suggest(o.exId));
  const withWeight = (entry: ActiveEntry, weight?: number | null): ActiveEntry =>
    weight
      ? {
          ...entry,
          sets: entry.sets.map((s) => ({ ...s, weight: num(weight), suggested: false })),
        }
      : entry;
  let entries: ActiveEntry[] = [];

  if (opts.routine) {
    const routine = opts.routine;
    entries = routine.items.map((item) => ({
      ...withWeight(
        make({
          exId: item.exId,
          sets: item.sets,
          repMin: item.repMin,
          repMax: item.repMax,
          rest: item.rest,
          library: opts.exercises,
        }),
        item.weight,
      ),
      /* las indicaciones del item (superseries, pausas…) llegan a la sesión */
      notes: item.notes ?? '',
    }));
  } else if (opts.exIds?.length) {
    entries = opts.exIds.map((exId) => make({ exId, library: opts.exercises }));
  } else if (opts.plan?.length) {
    entries = opts.plan
      .map((item) => {
        const found = item.exId
          ? findExercise(opts.exercises, item.exId)
          : findExerciseByName(opts.exercises, item.name);
        if (!found) return null;
        return withWeight(
          make({
            exId: found.id,
            sets: item.sets,
            repMin: item.repMin,
            repMax: item.repMax,
            rest: item.rest,
            library: opts.exercises,
          }),
          item.weight,
        );
      })
      .filter((entry): entry is ActiveEntry => entry !== null);
  }

  return {
    id: opts.id ?? uid('live'),
    routineId: opts.routine?.id ?? null,
    name: opts.name ?? opts.routine?.name ?? 'Entrenamiento libre',
    startedAt: opts.now ?? new Date().toISOString(),
    unit: opts.unit ?? 'kg',
    entries,
    notes: '',
    dayIso: opts.dayIso ?? today(),
    source: opts.source ?? 'manual',
  };
}

/* ---------- series ---------- */

/**
 * Marca o desmarca una serie y decide qué toca con el descanso.
 *
 * `label` de la decisión es a qué vas: el propio ejercicio si le quedan series, o
 * **el siguiente con series pendientes** si ya cerraste este (`''` = no queda nada
 * en toda la sesión, así que no hay descanso que hacer).
 */
export function toggleSet(
  session: ActiveSession,
  entryIndex: number,
  setIndex: number,
  opts: ToggleOptions,
): ToggleResult | null {
  const entry = session.entries[entryIndex];
  const set = entry?.sets[setIndex];
  if (!entry || !set) return null;

  const done = opts.on === undefined ? !set.done : !!opts.on;
  const nextSet: ActiveSet = {
    ...set,
    done,
    ts: done ? (opts.now ?? new Date().toISOString()) : null,
  };
  const next: ActiveSession = {
    ...session,
    entries: session.entries.map((en, i) =>
      i === entryIndex
        ? { ...en, sets: en.sets.map((s, j) => (j === setIndex ? nextSet : s)) }
        : en,
    ),
  };

  let rest: RestDecision = { action: 'none' };
  if (done) {
    /* `nextLabel` da '' cuando no queda ninguna serie pendiente en la sesión */
    const label = nextLabel(next, entryIndex);
    if (label && opts.autoRest)
      rest = { action: 'start', sec: entry.restSec || opts.restDefault, label };
  } else if (opts.restRunning) {
    /* desmarcar una serie cancela el descanso en curso: no está hecha */
    rest = { action: 'cancel' };
  }

  const nextEntry = next.entries[entryIndex] ?? entry;
  return { session: next, entry: nextEntry, set: nextSet, done, rest };
}

/**
 * Qué queda por hacer desde `entryIndex` en adelante: el nombre de este ejercicio
 * si le quedan series, o el del siguiente con series pendientes. `''` = no queda
 * ninguna serie en toda la sesión.
 */
export function nextLabel(session: ActiveSession, entryIndex: number): string {
  const current = session.entries[entryIndex];
  if (current?.sets.some((s) => !s.done)) return current.name;
  for (let i = entryIndex + 1; i < session.entries.length; i++) {
    const entry = session.entries[i];
    if (entry?.sets.some((s) => !s.done)) return entry.name;
  }
  return '';
}

/**
 * Arrastra un cambio hacia ABAJO: editar la serie N lo aplica a las siguientes de
 * ese ejercicio que no estén marcadas. Nunca a las de arriba ni a las ya hechas
 * (esas ya se hicieron). El RPE no se arrastra.
 */
export function propagateSet(
  session: ActiveSession,
  entryIndex: number,
  setIndex: number,
  field: 'weight' | 'reps',
  value: number | '',
): ActiveSession {
  const entry = session.entries[entryIndex];
  if (!entry) return session;
  return {
    ...session,
    entries: session.entries.map((en, i) => {
      if (i !== entryIndex) return en;
      return {
        ...en,
        sets: en.sets.map((set, j) => {
          if (j <= setIndex || set.done) return set;
          return field === 'weight' ? { ...set, weight: value } : { ...set, reps: value };
        }),
      };
    }),
  };
}

/**
 * Lo que pasa al editar el peso o las reps de una serie: se escribe el valor en esa
 * serie **y** se arrastra hacia abajo.
 *
 * Son dos pasos a propósito (la v1 los llamaba seguidos desde el mismo handler, y su
 * auto-test lo comprueba con `75/75/60/75`), pero aquí van juntos para que nadie se
 * deje el arrastre: ⚠️ `propagateSet` por sí solo NO escribe la serie editada.
 */
export function editSetField(
  session: ActiveSession,
  entryIndex: number,
  setIndex: number,
  field: 'weight' | 'reps',
  value: number | '',
): ActiveSession {
  const patch = field === 'weight' ? { weight: value } : { reps: value };
  const written = setSet(session, entryIndex, setIndex, patch);
  return propagateSet(written, entryIndex, setIndex, field, value);
}

export function setSet(
  session: ActiveSession,
  entryIndex: number,
  setIndex: number,
  patch: Partial<ActiveSet>,
): ActiveSession {
  return {
    ...session,
    entries: session.entries.map((en, i) =>
      i === entryIndex
        ? { ...en, sets: en.sets.map((set, j) => (j === setIndex ? { ...set, ...patch } : set)) }
        : en,
    ),
  };
}

/** Añade una serie copiando peso y reps de la última (si hay). */
export function addSet(session: ActiveSession, entryIndex: number): ActiveSession {
  const entry = session.entries[entryIndex];
  if (!entry) return session;
  const last = entry.sets[entry.sets.length - 1];
  const created = blankSet(last?.weight, last?.reps, last?.target);
  return {
    ...session,
    entries: session.entries.map((en, i) =>
      i === entryIndex ? { ...en, sets: [...en.sets, created] } : en,
    ),
  };
}

/** Quita una serie. Con una sola serie no hace nada: sin series no hay ejercicio. */
export function removeSet(
  session: ActiveSession,
  entryIndex: number,
  setIndex: number,
): ActiveSession {
  const entry = session.entries[entryIndex];
  if (!entry || entry.sets.length <= 1) return session;
  return {
    ...session,
    entries: session.entries.map((en, i) =>
      i === entryIndex ? { ...en, sets: en.sets.filter((_, j) => j !== setIndex) } : en,
    ),
  };
}

export function setRestSec(session: ActiveSession, entryIndex: number, sec: number): ActiveSession {
  return {
    ...session,
    entries: session.entries.map((en, i) =>
      i === entryIndex ? { ...en, restSec: int(sec, 90) } : en,
    ),
  };
}

export function addEntry(session: ActiveSession, entry: ActiveEntry): ActiveSession {
  return { ...session, entries: [...session.entries, entry] };
}

export function removeEntry(session: ActiveSession, entryIndex: number): ActiveSession {
  return { ...session, entries: session.entries.filter((_, i) => i !== entryIndex) };
}

/** Intercambia un ejercicio con el de al lado; fuera de la lista no hace nada. */
export function moveEntry(
  session: ActiveSession,
  entryIndex: number,
  delta: number,
): ActiveSession {
  const target = entryIndex + int(delta);
  const a = session.entries[entryIndex];
  const b = session.entries[target];
  if (!a || !b) return session;
  const entries = [...session.entries];
  entries[entryIndex] = b;
  entries[target] = a;
  return { ...session, entries };
}

export function setEntryNotes(
  session: ActiveSession,
  entryIndex: number,
  notes: string,
): ActiveSession {
  return {
    ...session,
    entries: session.entries.map((en, i) => (i === entryIndex ? { ...en, notes } : en)),
  };
}

/* ---------- progreso y cierre ---------- */

export function progress(session: ActiveSession): SessionProgress {
  let done = 0;
  let total = 0;
  let volume = 0;
  for (const entry of session.entries) {
    total += entry.sets.length;
    for (const set of entry.sets) {
      if (!set.done) continue;
      done++;
      volume += toKg(num(set.weight), session.unit) * num(set.reps);
    }
  }
  return { done, total, pct: total ? done / total : 0, volume, sets: total };
}

/** Segundos desde que arrancó la sesión (lo que pinta el cronómetro). */
export function elapsedSec(session: ActiveSession, now: number = Date.now()): number {
  if (!session.startedAt) return 0;
  return Math.max(0, Math.round((now - new Date(session.startedAt).getTime()) / 1000));
}

export interface FinishOptions {
  notes?: string;
  now?: string;
  /** Inyectable para los tests. */
  id?: string;
}

/**
 * Cierra la sesión: se guardan SOLO las series marcadas (las que quedaron a medias
 * se descartan) y los ejercicios sin ninguna serie hecha desaparecen. Devuelve
 * `null` si no hay nada que guardar, y entonces quien llama avisa de eso.
 */
export function finishSession(session: ActiveSession, opts: FinishOptions = {}): Session | null {
  const rpes: number[] = [];
  const entries: SessionEntry[] = [];
  for (const entry of session.entries) {
    const sets: SetLog[] = [];
    for (const set of entry.sets) {
      if (!set.done) continue;
      if (set.rpe) rpes.push(num(set.rpe));
      sets.push({
        weight: set.weight === '' ? 0 : num(set.weight),
        reps: num(set.reps),
        done: true,
        ts: set.ts ?? undefined,
        rpe: set.rpe ? num(set.rpe) : null,
      });
    }
    if (!sets.length) continue;
    entries.push({
      exId: entry.exId,
      name: entry.name,
      restSec: entry.restSec,
      notes: entry.notes || '',
      sets,
    });
  }
  if (!entries.length) return null;

  return {
    id: opts.id ?? uid('s'),
    name: session.name,
    routineId: session.routineId,
    date: session.dayIso || today(),
    startedAt: session.startedAt,
    endedAt: opts.now ?? new Date().toISOString(),
    unit: session.unit,
    source: session.source,
    entries,
    notes: opts.notes ?? session.notes ?? '',
    rpe: rpes.length ? round(avg(rpes), 1) : null,
  };
}
