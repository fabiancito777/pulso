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
 */
import { signal } from '@preact/signals';

import { suggestWeight } from '@/domain/analytics';
import { num, round } from '@/domain/num';
import {
  addRest,
  fromPersisted,
  remainingSec,
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
  finishSession as finishActive,
  moveEntry,
  newEntry,
  removeEntry,
  removeSet as removeSetFrom,
  setEntryNotes,
  setRestSec as setRestSecOn,
  setSet,
  startSession,
  toggleSet,
} from '@/domain/session';
import type { ActiveSession, RestState, Session } from '@/domain/types';
import { beep, ensureAudio, vibrate } from '@/platform/audio';
import {
  commitSession,
  exercises,
  readState,
  readStored,
  sessions,
  settings,
  STORAGE_KEYS,
  writeActive,
  writeStored,
} from '@/state/store';

const NOW = (): number => Date.now();

/* ---------- sesión activa ---------- */

function readActive(): ActiveSession | null {
  const stored = readState().active;
  if (!stored || typeof stored !== 'object' || !Array.isArray(stored.entries)) return null;
  return stored;
}

/** La sesión en curso, reactiva. `null` = no hay nada empezado. */
export const active = signal<ActiveSession | null>(readActive());

/** Segundos de sesión, para el cronómetro (el bucle los refresca una vez por segundo). */
export const sessionSeconds = signal(0);

function setActive(next: ActiveSession | null): void {
  writeActive(next);
  active.value = next;
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
    suggest: (exId) => suggestWeight(sessions.value, exId, { unit: settings.value.units }),
    exIds: opts.exIds ?? [],
    name: opts.name,
    unit: settings.value.units,
  });
  setActive(created);
  return created;
}

export function addExercise(exId: string): void {
  update((session) => addEntry(session, newEntry({ exId, library: exercises.value })));
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
  /* apila la sesión y marca el día: dos cosas que en la v1 hacía el store */
  commitSession(done);
  active.value = null;
  sessionSeconds.value = 0;
  stopRestTimer();
  beep('done', settings.value);
  return done;
}

export function discardSession(): void {
  setActive(null);
  stopRestTimer();
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

export function startRestTimer(sec: number, label: string): void {
  ensureAudio();
  setRest(startRest(sec, label, NOW()));
}

export function stopRestTimer(): void {
  setRest(stopRest());
}

/** `+15 s`: con el descanso ya terminado arranca una cuenta nueva (ver `domain/rest.ts`). */
export function addRestSeconds(sec = 15): void {
  setRest(addRest(rest.value, sec, NOW()));
  beep('tick', settings.value);
}

export function subRestSeconds(sec = 15): void {
  setRest(subRest(rest.value, sec, NOW()));
  beep('tick', settings.value);
}

/**
 * Un paso del bucle (cada 500 ms, lo arranca `App`).
 *
 * Pinta la cuenta atrás, suelta los tics de los últimos 3 s y lanza el aviso de fin
 * una sola vez: pitido largo, vibración y (en la v1) notificación. Aquí se avisa
 * también cuando la pestaña está en segundo plano, siempre que el navegador no la
 * haya congelado del todo.
 */
export function loop(): void {
  const now = NOW();
  const { state, tick, finished } = tickRest(rest.value, now, {
    countdownTick: settings.value.countdownTick,
  });
  const changed = state !== rest.value;
  if (changed) setRest(state);
  restSeconds.value = remainingSec(state, now);
  if (tick) beep('tick', settings.value);
  if (finished) {
    beep('end', settings.value);
    vibrate([160, 80, 160, 80, 160], settings.value.vibrate);
  }
  if (active.value) sessionSeconds.value = elapsed(active.value);
}

/** Arranca el bucle. Devuelve la función para pararlo (se usa en el `useEffect` de App). */
export function startLoop(intervalMs = 500): () => void {
  const id = window.setInterval(loop, intervalMs);
  return () => window.clearInterval(id);
}
