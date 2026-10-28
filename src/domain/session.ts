/**
 * Sesión en curso, sin el timer de descanso, la UI ni el audio: aquí solo están
 * las REGLAS.
 *
 * Dos decisiones de forma:
 *
 * 1. **Nada se muta.** Cada función devuelve una sesión nueva. Con Preact y
 *    signals eso es lo que hace que la pantalla se repinte sola.
 * 2. **Las decisiones se devuelven, no se ejecutan.** `toggleSet` devuelve una
 *    `RestDecision` y quien llama decide. Eso permite probar «cuándo hay
 *    descanso» sin navegador.
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
import { findExercise } from './data';
import { today } from './dates';
import { matchExercise, unresolvedName } from './match';
import type { UnresolvedName } from './match';
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
   * ellas se pide el peso, igual que hacía `T.prefill`
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
  /**
   * Nombres del `plan` que NO se asociaron a ningún ejercicio de la biblioteca
   * (umbral 0,85 + veto de atributos, ver `domain/match`). No se descartan en
   * silencio: quien arranca la sesión los enseña (toast/aviso) y sigue.
   */
  onUnresolved?: (items: UnresolvedName[]) => void;
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
    ...(ex ? { group: ex.group } : {}),
    /* `int(0, …)` devuelve 0: un `rest: 0` explícito (cardio/movilidad) se
       respeta y significa «sin descanso»; solo el valor ausente cae a la biblioteca. */
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
 * de 24 sep») y las `reps` concretas que antes metía dentro de `day.plan` y de la
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
 * del coach a veces traen solo el `name`, y lo que no esté en la biblioteca NO pasa
 * a la sesión: mismo criterio que usaba antes al montar los ejercicios.
 *
 * **No se puede descartar el `basis`/`reps`**: son con lo que la tarjeta de cada
 * ejercicio explica de dónde sale el peso («repetición de …») y con lo que se
 * piden las reps al repetir. `resolvePlan` era el punto donde se perdían.
 *
 * Y desde el matcher único **tampoco se descarta un nombre en silencio**: lo que
 * no resuelva (umbral 0,85 + veto de atributos en `domain/match`) vuelve en
 * `unresolved` con la razón, para que quien arranque la sesión avise. Un nombre
 * sin resolver no se reescribe a otro ejercicio.
 */
function resolvePlan(
  plan: readonly PlanItem[],
  library: readonly Exercise[],
): { items: ResolvedPlanItem[]; unresolved: UnresolvedName[] } {
  const items: ResolvedPlanItem[] = [];
  const unresolved: UnresolvedName[] = [];
  for (const item of plan) {
    let ex: Exercise | null;
    if (item.exId) ex = findExercise(library, item.exId);
    else if (item.name) {
      const match = matchExercise(item.name, library);
      ex = match.ex ?? null;
      if (!ex) unresolved.push(unresolvedName(item.name, match));
    } else {
      /* sin exId ni nombre no hay nada ni siquiera que avisar */
      continue;
    }
    if (!ex) {
      if (item.exId) unresolved.push({ name: item.exId, reason: 'ya no está en tu biblioteca' });
      continue;
    }
    const extra = item as PlanItem & PlanExtras;
    items.push({
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
  return { items, unresolved };
}

/**
 * Lo que el plan manda sobre lo que sugiere el historial, en la entrada ya
 * construida (es el `startFromItems`, `views-train.js:299`):
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
     el plan, la media del rango (antes `T.prefill`, `trainer.js:30`). */
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
    const resolved = resolvePlan(opts.plan, opts.exercises);
    plan = resolved.items;
    if (resolved.unresolved.length) opts.onUnresolved?.(resolved.unresolved);
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
    /* sin plan no se añade la clave: el JSON  no la conoce y no aporta nada */
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
    /* `0` es «sin descanso» (cardio/movilidad); solo un valor ausente (null o
       undefined, p. ej. una sesión antigua) cae al descanso por defecto. */
    const sec = entry.restSec ?? opts.restDefault;
    if (label && opts.autoRest && sec > 0) rest = { action: 'start', sec, label };
  } else if (opts.restRunning) {
    /* desmarcar una serie cancela el descanso en curso: no está hecha */
    rest = { action: 'cancel' };
  }

  const nextEntry = next.entries[entryIndex] ?? entry;
  return { session: next, entry: nextEntry, set: nextSet, done, rest };
}

/**
 * Al marcar una serie, la SIGUIENTE se rellena con su peso y sus reps si están
 * vacías: así la serie que viene ya sale lista y no hay que repetir el dato cada
 * vez. antes lo hacía en el propio handler del click (no dentro de `T.toggleSet`),
 * y es el complemento del arrastre hacia abajo: uno copia al editar, el otro al
 * marcar.
 *
 * Cada campo se decide por separado: un peso propio (incluido un `0` real) no se
 * pisa aunque las reps estén vacías, y unas reps ya tecleadas sobreviven a que el
 * peso venga vacío. Solo `''`, `null` y `undefined` cuentan como vacío.
 */
export function autofillNext(
  session: ActiveSession,
  entryIndex: number,
  setIndex: number,
): ActiveSession {
  const entry = session.entries[entryIndex];
  const marked = entry?.sets[setIndex];
  const following = entry?.sets[setIndex + 1];
  if (!entry || !marked || !following || following.done) return session;
  const empty = (v: unknown): boolean => v === '' || v === null || v === undefined;
  const patch: Partial<ActiveSet> = {};
  if (empty(following.weight)) patch.weight = marked.weight;
  if (empty(following.reps)) patch.reps = marked.reps;
  if (!Object.keys(patch).length) return session;
  return setSet(session, entryIndex, setIndex + 1, patch);
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
 * Son dos pasos a propósito (antes los llamaba seguidos desde el mismo handler, y su
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

/**
 * Cambia el descanso de un ejercicio. `0` se conserva (sin descanso); `null` o
 * `undefined` dejan el valor «sin definir» para que `toggleSet` use el de los
 * ajustes. No se usa 90 como comodín: eso convertía un 0 intencional en descanso.
 */
export function setRestSec(
  session: ActiveSession,
  entryIndex: number,
  sec: number | null | undefined,
): ActiveSession {
  return {
    ...session,
    entries: session.entries.map((en, i) =>
      i === entryIndex
        ? { ...en, restSec: sec === null || sec === undefined ? null : int(sec, 0) }
        : en,
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
 *  con `T.active()`). Es el mismo relleno que `startFromItems`:
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
 * (antes `views-train.js:477`). `0` = la entrada todavía no tiene peso.
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
  const start = new Date(session.startedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.round((now - start) / 1000));
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
 * Una serie marcada **sin reps** no cuenta como hecha: se descarta en vez de
 * guardar `reps: 0` (la analítica la contaría como serie y ensuciaría volumen y
 * rachas). El peso vacío se guarda como `null` («sin peso»), no como `0`, que es
 * un peso real; el grupo del ejercicio viaja como respaldo si el ejercicio sale
 * de la biblioteca.
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
      const reps = num(set.reps);
      if (!reps) continue;
      if (set.rpe) rpes.push(num(set.rpe));
      const empty = set.weight === '' || set.weight === null || set.weight === undefined;
      sets.push({
        weight: empty ? null : num(set.weight),
        reps,
        done: true,
        ts: set.ts ?? undefined,
        rpe: set.rpe ? num(set.rpe) : null,
      });
    }
    if (!sets.length) continue;
    entries.push({
      exId: entry.exId,
      name: entry.name,
      ...(entry.group ? { group: entry.group } : {}),
      restSec: entry.restSec ?? undefined,
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
