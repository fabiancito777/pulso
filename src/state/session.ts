/**
 * Estado de la sesión activa y del descanso. Portado del resto de `legacy/js/trainer.js`
 * (lo que en la v1 era `S.setActive`, `T.rest` y el bucle de `T.loop`).
 *
 * Escribe en los **mismos sitios** que la v1, para que las dos ramas compartan datos:
 *
 * | qué | dónde |
 * |---|---|
 * | sesión en curso | `pulso.state` → `active` (la v1 la lee igual) |
 * | descanso | `pulso.rest` → `{endsAt,total,label}` o `null` |
 *
 * El descanso se guarda aparte (no dentro del estado) porque cambia cada 15 segundos
 * y no merece reescribir todo el estado; es la misma decisión que en la v1.
 *
 * Aquí viven los EFECTOS de lo que deciden las reglas puras de `domain/session.ts` y
 * `domain/rest.ts`: marcar una serie puede arrancar el descanso, el bucle avisa con
 * pitido y vibración, y cerrar la sesión la apila y marca el día en el calendario.
 *
 * El aviso de fin de descanso son **tres capas a propósito** (v1 `trainer.js:263`):
 * pitido largo + vibración (`platform/audio.ts`), keep-alive de audio y wake lock
 * (`platform/keepAlive.ts`) y la notificación programada en el service worker
 * (`platform/sw.ts` → `public/sw.js`). Cada una cubre un fallo de la anterior:
 * sin la tercera no hay aviso con el móvil bloqueado de verdad. Todas se respetan
 * con `settings.notify` / `settings.keepAwake`, y ninguna lanza excepciones.
 */
import { signal } from '@preact/signals';

import { type Suggestion, suggestWeight } from '@/domain/analytics';
import { today } from '@/domain/dates';
import { fmtVol } from '@/domain/format';
import { num, round } from '@/domain/num';
import {
  addRest,
  fromPersisted,
  remainingSec,
  REST_NOTICE_TAG,
  restNoticeBody,
  restNoticeTitle,
  startRest,
  stopRest,
  subRest,
  tickRest,
  toPersisted,
} from '@/domain/rest';
import {
  addEntry,
  addSet as addSetTo,
  editSetField,
  entriesFromRoutine,
  finishSession as finishActive,
  moveEntry,
  plateTarget,
  progress as sessionProgress,
  removeEntry,
  removeSet as removeSetFrom,
  setEntryNotes,
  setRestSec as setRestSecOn,
  setSet,
  startSession,
  toggleSet,
} from '@/domain/session';
import type { ActiveEntry, ActiveSession, PlanItem, RestState, Session } from '@/domain/types';
import { beep, ensureAudio, vibrate } from '@/platform/audio';
import { keepAliveOff, keepAliveOn, wakeLockOff, wakeLockOn } from '@/platform/keepAlive';
import { notifyEnd, pageNotify, requestNotifyPermission } from '@/platform/notify';
import { postToSW } from '@/platform/sw';
import {
  active,
  commitSession,
  exercises,
  findRoutine,
  readStored,
  sessions,
  settings,
  STORAGE_KEYS,
  writeActive,
  writeStored,
} from '@/state/store';

const NOW = (): number => Date.now();

/**
 * La sesión en curso se reexporta aquí (donde la busca la UI de la sesión) pero
 * **vive en `state/store.ts`**: es la misma signal que escriben `writeActive`,
 * `commitSession` y `refresh`. Antes cada módulo tenía la suya, así que cerrar una
 * sesión dejaba viva la copia del otro y una importación se veía y la otra no.
 */
export { active };

/** Segundos de sesión, para el cronómetro (el bucle los refresca una vez por segundo). */
export const sessionSeconds = signal(0);

function setActive(next: ActiveSession | null): void {
  writeActive(next); /* ya actualiza la signal `active` */
  sessionSeconds.value = next ? elapsed(next) : 0;
}

function elapsed(session: ActiveSession): number {
  return Math.max(0, Math.round((NOW() - new Date(session.startedAt).getTime()) / 1000));
}

/** Aplica una transformación pura y persiste el resultado. */
function update(fn: (session: ActiveSession) => ActiveSession): void {
  const current = active.value;
  if (!current) return;
  setActive(fn(current));
}

/**
 * Al arrancar una sesión (v1 `T.start` + `app.js:1254`): se pide el permiso de
 * notificaciones y se encienden las capas de "móvil bloqueado" si el ajuste las
 * deja encendidas. Apagar el ajuste lo apaga TODO (keep-alive y wake lock).
 */
function startSessionEffects(): void {
  requestNotifyPermission();
  if (settings.value.keepAwake === false) {
    keepAliveOff();
    wakeLockOff();
    return;
  }
  void wakeLockOn();
  keepAliveOn('Entrenamiento');
}

/**
 * Sugerencia de progresión con la que arrancan TODAS las sesiones: la unidad sale
 * de los ajustes y `reps` (si la trae la prescripción) se pasa como objetivo, que
 * es como pedía el peso la v1 (`T.prefill`, `trainer.js:30`). Sin `reps` se
 * comporta como antes: `suggestWeight` elige él.
 */
const suggestForStart = (exId: string, reps?: number): Suggestion =>
  suggestWeight(sessions.value, exId, {
    unit: settings.value.units,
    ...(reps ? { targetReps: reps } : {}),
  });

/**
 * Empieza una sesión. Si ya hay una en curso devuelve esa: es lo que hacía la v1
 * (`T.start` con una sesión activa no la pisaba) y evita perder un entrenamiento a
 * medias por tocar "empezar" dos veces.
 */
export function startFreeSession(opts: { exIds?: string[]; name?: string } = {}): ActiveSession {
  const current = active.value;
  if (current) return current;
  ensureAudio();
  const created = startSession({
    exercises: exercises.value,
    suggest: suggestForStart,
    exIds: opts.exIds ?? [],
    name: opts.name,
    unit: settings.value.units,
  });
  setActive(created);
  startSessionEffects();
  return created;
}

/**
 * Arranca una sesión desde una rutina guardada. Devuelve `null` si la rutina no
 * existe (quien llama avisa); si ya hay una sesión en curso devuelve ESA, igual que
 * `startFreeSession`: tocar "empezar" dos veces no pisa un entrenamiento a medias.
 *
 * `startSession` deriva los ejercicios de `routine.items` (por eso no hacen falta
 * `exIds`), y el snapshot del plan que guarda ahí es lo que luego permite comparar
 * lo entrenado con lo que prescribía la rutina.
 */
export function startFromRoutine(routineId: string): ActiveSession | null {
  const current = active.value;
  if (current) return current;
  const routine = findRoutine(routineId);
  if (!routine) return null;
  ensureAudio();
  const created = startSession({
    exercises: exercises.value,
    suggest: suggestForStart,
    routine: { id: routine.id, name: routine.name, items: routine.items },
    name: routine.name,
    source: 'plan',
    unit: settings.value.units,
    dayIso: today(),
  });
  setActive(created);
  startSessionEffects();
  return created;
}

/**
 * Arranca una sesión desde un PLAN: el plan de hoy, una repetición («repetición de
 * 24 sep») o la sugerencia del coach. Es el `startFromItems` de la v1
 * (`views-train.js:299`), que era `T.start({name, dayIso})` + los items escritos a
 * mano; aquí hace falta menos porque `startSession` ya soporta `opts.plan`.
 *
 * Los items pueden traer `basis`, `reps` concretas y `notes` (los llevan
 * `repeatItems` y `todayPlan` de `hoy-helpers`): `resolvePlan` los copia al
 * snapshot y a la entrada, así la tarjeta de cada ejercicio dice de dónde sale el
 * peso propuesto. `dayIso` por defecto es hoy, igual que en la v1.
 *
 * Si ya hay una sesión en curso devuelve ESA, igual que `startFreeSession`: tocar
 * «Empezar» dos veces no pisa un entrenamiento a medias.
 */
export function startFromPlan(
  items: readonly PlanItem[],
  opts: { name?: string; dayIso?: string } = {},
): ActiveSession {
  const current = active.value;
  if (current) return current;
  ensureAudio();
  const created = startSession({
    exercises: exercises.value,
    suggest: suggestForStart,
    plan: items,
    name: opts.name,
    dayIso: opts.dayIso,
    source: 'plan',
    unit: settings.value.units,
  });
  setActive(created);
  startSessionEffects();
  return created;
}

/**
 * Índice del ejercicio recién añadido: `SessionCard` lo usa para hacer scroll y
 * marcar la tarjeta con `.new` (1,5 s), igual que `focusEntry` de la v1
 * (`views-train.js:274`). Vive aquí y no dentro del componente para que "Añadir
 * rutina" desde la vista de Rutinas también lleve la vista al sitio.
 */
export const justAdded = signal<number | null>(null);

/** La UI limpia la marca al terminar el scroll (si no, repetir el mismo índice no repite el efecto). */
export function clearJustAdded(): void {
  justAdded.value = null;
}

/** Sugerencia de progresión con las reps que prescribe la rutina o el catálogo. */
const suggestFor = (exId: string, reps: number): Suggestion =>
  suggestWeight(sessions.value, exId, { unit: settings.value.units, targetReps: reps });

/**
 * Añade ejercicios al FINAL de la sesión (nunca toca los que ya están) y devuelve
 * el índice del PRIMERO de los nuevos — es con lo que la UI hace el scroll.
 */
export function addEntries(entries: readonly ActiveEntry[]): number | null {
  const current = active.value;
  if (!current || !entries.length) return null;
  const first = current.entries.length;
  update((session) => {
    let next = session;
    for (const entry of entries) next = addEntry(next, entry);
    return next;
  });
  justAdded.value = first;
  return first;
}

/** El picker multi: N ejercicios de una vez, rellenos como los de `startFromItems`. */
export function addExercises(exIds: readonly string[]): number | null {
  if (!active.value || !exIds.length) return null;
  return addEntries(
    entriesFromRoutine({ items: exIds.map((exId) => ({ exId })) }, suggestFor, exercises.value),
  );
}

/**
 * Añade una rutina a la sesión EN CURSO (`train:start-routine` con `T.active()`).
 * Devuelve el índice del primer ejercicio añadido, o `null` si no hay sesión, la
 * rutina no existe o ningún ejercicio está en la biblioteca.
 */
export function addRoutineToSession(routineId: string): number | null {
  const routine = findRoutine(routineId);
  if (!routine || !active.value) return null;
  return addEntries(entriesFromRoutine(routine, suggestFor, exercises.value));
}

/**
 * "Usar X kg" del modal de discos: escribe la serie que eligió `plateTarget`
 * (la primera pendiente sin peso, si no la última). Sin arrastre — igual que la
 * v1 (`views-train.js:485`) — porque el valor ya viene calculado para esa serie.
 */
export function applyPlateWeight(entryIndex: number, weight: number): void {
  update((session) => {
    const entry = session.entries[entryIndex];
    if (!entry) return session;
    const setIndex = plateTarget(entry);
    if (setIndex < 0) return session;
    return setSet(session, entryIndex, setIndex, { weight, suggested: false });
  });
}

export const removeExercise = (index: number): void => update((s) => removeEntry(s, index));
export const moveExercise = (index: number, delta: number): void =>
  update((s) => moveEntry(s, index, delta));
export const addSet = (index: number): void => update((s) => addSetTo(s, index));
export const removeSet = (index: number, setIndex: number): void =>
  update((s) => removeSetFrom(s, index, setIndex));
export const setEntryRest = (index: number, sec: number): void =>
  update((s) => setRestSecOn(s, index, sec));
export const setNotes = (index: number, notes: string): void =>
  update((s) => setEntryNotes(s, index, notes));

/** Edita peso o reps: escribe la serie y arrastra el valor hacia abajo. */
export function editSet(
  index: number,
  setIndex: number,
  field: 'weight' | 'reps',
  value: number | '',
): void {
  update((s) => editSetField(s, index, setIndex, field, value));
}

/** RPE de una serie: se acota a 1-10 y no se arrastra a las de abajo. */
export function setRpe(index: number, setIndex: number, value: number | ''): void {
  const rpe = value === '' ? null : round(Math.min(10, Math.max(1, num(value))), 1);
  update((s) => setSet(s, index, setIndex, { rpe }));
}

export function setSessionNotes(notes: string): void {
  const current = active.value;
  if (!current) return;
  setActive({ ...current, notes });
}

/** Renombrar la sesión en curso (`Entrenamiento libre` → `Empuje A`). */
export function renameSession(name: string): void {
  const current = active.value;
  if (!current) return;
  setActive({ ...current, name: name.trim() || current.name });
}

/**
 * Marca o desmarca una serie y hace lo que toque con el descanso. Las reglas están
 * en `domain/session.ts` (y probadas allí); aquí solo se ejecuta la decisión.
 */
export function toggleSetAt(index: number, setIndex: number, on?: boolean): void {
  const current = active.value;
  if (!current) return;
  const result = toggleSet(current, index, setIndex, {
    on,
    autoRest: settings.value.autoRest,
    restDefault: settings.value.restDefault,
    restRunning: rest.value.running,
    now: new Date(NOW()).toISOString(),
  });
  if (!result) return;
  ensureAudio();
  setActive(result.session);
  if (result.rest.action === 'start') {
    startRestTimer(result.rest.sec, result.rest.label);
  } else if (result.rest.action === 'cancel') {
    stopRestTimer();
  }
}

/**
 * Cierra la sesión: la apila en el historial, marca el día como hecho y limpia el
 * estado. Devuelve `null` si no había ninguna serie marcada (entonces no se guarda
 * nada y quien llama lo dice).
 */
export function finishSession(notes?: string): Session | null {
  const current = active.value;
  if (!current) return null;
  const done = finishActive(current, { notes });
  if (!done) return null;
  const volume = sessionProgress(current).volume;
  /* apila la sesión y marca el día: dos cosas que en la v1 hacía el store
     (`commitSession` también limpia `active`, la signal única) */
  commitSession(done);
  sessionSeconds.value = 0;
  stopRestTimer();
  beep('done', settings.value);
  /* la sesión ya no avisa de nada: se apagan las capas de "móvil bloqueado" */
  keepAliveOff();
  wakeLockOff();
  if (settings.value.notify !== false) {
    const title = 'Sesión guardada';
    const body = [done.name, `${fmtVol(volume)} kg de volumen`].filter(Boolean).join(' · ');
    const sent = postToSW({ type: 'notify', title, body, tag: REST_NOTICE_TAG });
    if (!sent) pageNotify(title, body);
  }
  return done;
}

export function discardSession(): void {
  setActive(null);
  stopRestTimer();
  keepAliveOff();
  wakeLockOff();
}

/* ---------- descanso ---------- */

const readRest = (): RestState => fromPersisted(readStored(STORAGE_KEYS.rest), NOW());

/** Descanso en curso, reactivo. */
export const rest = signal<RestState>(readRest());

/** Segundos que quedan, refrescados por el bucle: es lo que pinta la cuenta atrás. */
export const restSeconds = signal(remainingSec(rest.value, NOW()));

function setRest(next: RestState): void {
  writeStored(STORAGE_KEYS.rest, toPersisted(next));
  rest.value = next;
  restSeconds.value = remainingSec(next, NOW());
}

/**
 * Programa el aviso en el service worker. Es la ÚNICA capa que sobrevive a la
 * pestaña congelada (pitido y vibración necesitan la página viva), así que se
 * vuelve a mandar en cada cambio de `endsAt` (+15/−15) y al restaurar `pulso.rest`.
 * `postToSW` es síncrono y nunca lanza: no bloquea la UI ni en dev (devuelve
 * `false` y ya está).
 */
function scheduleRestNotice(): void {
  const state = rest.value;
  if (!state.running || settings.value.notify === false) return;
  postToSW({
    type: 'schedule-rest',
    at: state.endsAt,
    title: restNoticeTitle,
    body: restNoticeBody(state.label),
    tag: REST_NOTICE_TAG,
  });
}

/** No debe quedar ningún `schedule-rest` colgado: saltar/desmarcar o cerrar el aviso. */
function cancelRestNotice(): void {
  postToSW({ type: 'cancel-rest' });
}

/** Etiqueta del keep-alive (v1 `trainer.js:303`): apagado si el ajuste lo dice. */
function keepAliveWith(label: string): void {
  if (settings.value.keepAwake === false) {
    keepAliveOff();
    return;
  }
  keepAliveOn(label);
}

/* Al abrir la app con un descanso en marcha se vuelve a programar en el SW: si no,
   el aviso se habría perdido con la pestaña cerrada (v1 `T.rest.restore()`). */
scheduleRestNotice();

/**
 * Arranca el descanso: lo manda al SW (`schedule-rest`) y cambia la etiqueta del
 * keep-alive a «Descanso · …». El tiempo sigue saliendo de `endsAt - Date.now()`,
 * como siempre: esto solo son avisos.
 */
export function startRestTimer(sec: number, label: string): void {
  ensureAudio();
  setRest(startRest(sec, label, NOW()));
  scheduleRestNotice();
  keepAliveWith(label ? `Descanso · ${label}` : 'Descanso');
}

export function stopRestTimer(): void {
  setRest(stopRest());
  cancelRestNotice();
}

/** `+15 s`: con el descanso ya terminado arranca una cuenta nueva (ver `domain/rest.ts`). */
export function addRestSeconds(sec = 15): void {
  setRest(addRest(rest.value, sec, NOW()));
  scheduleRestNotice();
  keepAliveWith(rest.value.label ? `Descanso · ${rest.value.label}` : 'Descanso');
  beep('tick', settings.value);
}

export function subRestSeconds(sec = 15): void {
  setRest(subRest(rest.value, sec, NOW()));
  scheduleRestNotice();
  beep('tick', settings.value);
}

/**
 * Un paso del bucle (cada 500 ms, lo arranca `App`).
 *
 * Pinta la cuenta atrás, suelta los tics de los últimos 3 s y lanza el aviso de fin
 * una sola vez: pitido largo y vibración (capa 1) y notificación (capa 3: el SW si
 * la pestaña está oculta, la propia página si está visible — igual que la v1).
 * El descanso programado en el SW se cancela al terminar y al cerrarse solo a los 30 s.
 */
export function loop(): void {
  const now = NOW();
  const { state, tick, finished, closed } = tickRest(rest.value, now, {
    countdownTick: settings.value.countdownTick,
  });
  const changed = state !== rest.value;
  if (changed) setRest(state);
  restSeconds.value = remainingSec(state, now);
  if (tick) beep('tick', settings.value);
  if (finished) {
    beep('end', settings.value);
    vibrate([160, 80, 160, 80, 160], settings.value.vibrate);
    if (settings.value.notify !== false) {
      notifyEnd(restNoticeTitle, restNoticeBody(state.label), { tag: REST_NOTICE_TAG });
    }
    cancelRestNotice();
  }
  if (closed) cancelRestNotice();
  if (active.value) sessionSeconds.value = elapsed(active.value);
}

/** Arranca el bucle. Devuelve la función para pararlo (se usa en el `useEffect` de App). */
export function startLoop(intervalMs = 500): () => void {
  const id = window.setInterval(loop, intervalMs);
  return () => window.clearInterval(id);
}
