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
  /**
   * Sugerencia de progresión por ejercicio (`analytics.suggestWeight`). Las `reps`
   * son las de la prescripción (media del rango, o las concretas del plan): con
   * ellas se pide el peso, igual que hacía `T.prefill` de la v1
   * (`trainer.js:30`), que nunca preguntaba por un peso «a secas».
   */
  suggest: (exId: string, reps?: number) => Suggestion;
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

/**
 * Lo que un item del plan puede traer ADEMÁS de `PlanItem`: el `basis` («repetición
 * de 24 sep») y las `reps` concretas que la v1 metía dentro de `day.plan` y de la
 * repetición (`views-train.js:299`), más las `notes`. `PlanItem` todavía no los
 * nombra, así que se leen con este tipo local en vez de ampliar el contrato
 * compartido: el snapshot y la entrada los conservan tal cual.
 */
interface PlanExtras {
  basis?: string;
  reps?: number;
  notes?: string;
}

/** Item del plan ya resuelto contra la biblioteca: `RoutineItem` + sus extras. */
type ResolvedPlanItem = RoutineItem & PlanExtras;

/**
 * Resuelve un item del plan del coach contra la biblioteca y lo deja como
 * `RoutineItem` (con `exId`, que es con lo que se compara en la sesión). Los planes
 * del coach a veces traen solo el `name`, y lo que no esté en la biblioteca no pasa
 * a la sesión: mismo criterio que usaba la v1 al montar los ejercicios.
 *
 * **No se puede descartar el `basis`/`reps`**: son con lo que la tarjeta de cada
 * ejercicio explica de dónde sale el peso («repetición de …») y con lo que se
 * piden las reps al repetir. `resolvePlan` era el punto donde se perdían.
 */
function resolvePlan(plan: readonly PlanItem[], library: readonly Exercise[]): ResolvedPlanItem[] {
  const out: ResolvedPlanItem[] = [];
  for (const item of plan) {
    const ex = item.exId
      ? findExercise(library, item.exId)
      : findExerciseByName(library, item.name ?? null);
    if (!ex) continue;
    const extra = item as PlanItem & PlanExtras;
    out.push({
      exId: ex.id,
      sets: item.sets,
      repMin: item.repMin,
      repMax: item.repMax,
      rest: item.rest,
      weight: item.weight,
      ...(extra.notes ? { notes: extra.notes } : {}),
      ...(extra.basis ? { basis: extra.basis } : {}),
      ...(extra.reps ? { reps: extra.reps } : {}),
    });
  }
  return out;
}

/**
 * Lo que el plan manda sobre lo que sugiere el historial, en la entrada ya
 * construida (es el `startFromItems` de la v1, `views-train.js:299`):
 *
 * - **reps concretas**: las del plan si las trae, si no la media del rango;
 * - **`basis`**: «repetición de …» si el plan lo trae (si no, se queda el de la
 *   sugerencia, que es el que ya puso `prefill`);
 * - **`notes`** del item, si las hay.
 */
function fromPlanItem(entry: ActiveEntry, item: ResolvedPlanItem): ActiveEntry {
  const reps = int(item.reps, Math.round((entry.repMin + entry.repMax) / 2));
  return {
    ...entry,
    sets: entry.sets.map((set) => ({ ...set, reps })),
    ...(item.basis ? { basis: item.basis } : {}),
    ...(item.notes ? { notes: item.notes } : {}),
  };
}

/**
 * `now`, `dayIso` y `id` son inyectables: los tests no deben depender del reloj.
 *
 * La sesión guarda además un **snapshot del plan** con el que arrancó (`session.plan`):
 * la rutina original es editable después, así que sin esta copia sería imposible
 * saber qué cambió el usuario en plena rutina (quitar, añadir o sustituir un
 * ejercicio). Prioriza la rutina sobre el plan del coach, igual que los ejercicios.
 */
export function startSession(opts: StartOptions): ActiveSession {
  /* `reps` = reps de la prescripción con las que se pide el peso: si no las trae
     el plan, la media del rango (v1 `T.prefill`, `trainer.js:30`). */
  const make = (o: NewEntryOptions, reps?: number): ActiveEntry => {
    const entry = newEntry(o);
    const target = int(reps, Math.round((entry.repMin + entry.repMax) / 2));
    return prefill(entry, opts.suggest(o.exId, target));
  };
  const withWeight = (entry: ActiveEntry, weight?: number | null): ActiveEntry =>
    weight
      ? {
          ...entry,
          sets: entry.sets.map((s) => ({ ...s, weight: num(weight), suggested: false })),
        }
      : entry;
  let entries: ActiveEntry[] = [];
  let plan: ResolvedPlanItem[] | undefined;

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
    /* copia de los items: la rutina sigue siendo editable y NO debe verse aquí dentro */
    plan = routine.items.map((item) => ({ ...item }));
  } else if (opts.exIds?.length) {
    entries = opts.exIds.map((exId) => make({ exId, library: opts.exercises }));
  } else if (opts.plan?.length) {
    plan = resolvePlan(opts.plan, opts.exercises);
    entries = plan.map((item) =>
      fromPlanItem(
        withWeight(
          make(
            {
              exId: item.exId,
              sets: item.sets,
              repMin: item.repMin,
              repMax: item.repMax,
              rest: item.rest,
              library: opts.exercises,
            },
            item.reps,
          ),
          item.weight,
        ),
        item,
      ),
    );
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
    /* sin plan no se añade la clave: el JSON de la v1 no la conoce y no aporta nada */
    ...(plan ? { plan } : {}),
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
  let next: ActiveSession = {
    ...session,
    entries: session.entries.map((en, i) =>
      i === entryIndex
        ? { ...en, sets: en.sets.map((s, j) => (j === setIndex ? nextSet : s)) }
        : en,
    ),
  };
  if (done) next = autofillNext(next, entryIndex, setIndex);

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
 * Al marcar una serie, la SIGUIENTE se rellena con su peso y sus reps si está vacía:
 * así la serie que viene ya sale lista y no hay que repetir el dato cada vez.
 * La v1 lo hacía en el propio handler del click (no dentro de `T.toggleSet`), y es el
 * complemento del arrastre hacia abajo: uno copia al editar, el otro al marcar.
 */
export function autofillNext(
  session: ActiveSession,
  entryIndex: number,
  setIndex: number,
): ActiveSession {
  const entry = session.entries[entryIndex];
  const marked = entry?.sets[setIndex];
  const following = entry?.sets[setIndex + 1];
  /* `num('')` es 0, así que el test de "vacía" cubre también el peso a 0 */
  if (!entry || !marked || !following || following.done || num(following.weight)) return session;
  return setSet(session, entryIndex, setIndex + 1, {
    weight: marked.weight,
    reps: marked.reps,
  });
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

/* ---------- añadir a una sesión en curso ---------- */

/**
 * Los ejercicios que mete una rutina en una sesión YA ARRANCADA (`train:start-routine`
 * de la v1 con `T.active()`). Es el mismo relleno que `startFromItems`:
 *
 * - `restSec` del item, y si no, el del ejercicio (`newEntry`);
 * - reps = media de `repMin`/`repMax` (la sugerencia se llama con esas reps, pero
 *   las series se quedan con la media: es lo que prescribe la rutina);
 * - peso del item si lo trae (manda sobre el historial, como en `startSession`),
 *   si no, el que devuelva `suggest`;
 * - los items cuyo ejercicio no está en la biblioteca se SALTAN (criterio de
 *   `resolvePlan`): no se inventa un ejercicio que no puedes hacer.
 *
 * Devuelve SOLO los ejercicios nuevos, en el orden de la rutina; quien llama los
 * añade al final de la sesión (el orden de lo que ya estaba no se toca).
 */
export function entriesFromRoutine(
  routine: { items: readonly RoutineItem[] },
  suggest: (exId: string, reps: number) => Suggestion,
  library: readonly Exercise[],
): ActiveEntry[] {
  const out: ActiveEntry[] = [];
  for (const item of routine.items) {
    const ex = findExercise(library, item.exId);
    if (!ex) continue;
    const repMin = int(item.repMin, ex.repMin);
    const repMax = int(item.repMax, ex.repMax);
    const reps = Math.round((repMin + repMax) / 2);
    const weight = item.weight ? num(item.weight) : 0;
    const suggestion: Suggestion = weight
      ? { weight, reps, kg: weight, basis: '' }
      : suggest(ex.id, reps);
    const entry = prefill(
      newEntry({ exId: ex.id, sets: item.sets, repMin, repMax, rest: item.rest, library }),
      suggestion,
    );
    out.push({
      ...entry,
      sets: entry.sets.map((set) => ({
        ...set,
        reps,
        ...(weight ? { weight, suggested: false } : {}),
      })),
      notes: item.notes ?? '',
    });
  }
  return out;
}

/* ---------- discos ---------- */

/**
 * Peso con el que se abre el modal de discos de un ejercicio: el ÚLTIMO peso
 * distinto de cero de la entrada y, si no hay ninguno, el de la primera serie
 * (v1 `views-train.js:477`). `0` = la entrada todavía no tiene peso.
 */
export function plateInitialWeight(entry: ActiveEntry): number {
  let last = 0;
  for (const set of entry.sets) {
    const w = num(set.weight);
    if (w) last = w;
  }
  return last || num(entry.sets[0]?.weight);
}

/**
 * Qué serie escribe "Usar X kg" del modal de discos (`views-train.js:485`): la
 * primera serie SIN MARCAR y con el peso vacío — la que de verdad falta por
 * cargar — y si no queda ninguna, la ÚLTIMA (así el botón siempre hace algo).
 * Devuelve `-1` solo con una entrada sin series, que no llega a darse.
 */
export function plateTarget(entry: ActiveEntry): number {
  const pending = entry.sets.findIndex((set) => !set.done && !num(set.weight));
  if (pending >= 0) return pending;
  return entry.sets.length ? entry.sets.length - 1 : -1;
}

/* ---------- progreso y cierre ---------- */

/** Volumen de un ejercicio de la sesión, en kg (solo las series marcadas). */
export function entryVolume(entry: ActiveEntry, unit: Unit = 'kg'): number {
  let volume = 0;
  for (const set of entry.sets) {
    if (!set.done) continue;
    volume += toKg(num(set.weight), unit) * num(set.reps);
  }
  return volume;
}

export function progress(session: ActiveSession): SessionProgress {
  let done = 0;
  let total = 0;
  let volume = 0;
  for (const entry of session.entries) {
    total += entry.sets.length;
    done += entry.sets.filter((s) => s.done).length;
    volume += entryVolume(entry, session.unit);
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
 *
 * El snapshot del plan (`session.plan`) viaja al registro: es lo que permite
 * comparar después lo que se entrenó con lo que prescribía la rutina original.
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
    /* el snapshot viajó en `ActiveSession.plan` hasta aquí: ahora queda en el historial */
    ...(session.plan ? { plan: session.plan } : {}),
  };
}
