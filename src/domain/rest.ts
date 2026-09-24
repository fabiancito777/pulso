/**
 * Timer de descanso. Portado del bloque `R` de `legacy/js/trainer.js`.
 *
 * La clave del diseño de la v1 (y la razón de que haya un timestamp y no un
 * contador): el tiempo restante se calcula con `endsAt - now`, así que sigue siendo
 * correcto aunque la pestaña quede en segundo plano o el móvil se bloquee. Aquí eso
 * se mantiene tal cual, y el "ahora" entra SIEMPRE por parámetro para poder probarlo
 * sin esperar 90 segundos de verdad.
 *
 * Lo que hace el módulo: transiciones (`start`/`add`/`sub`/`stop`) y el tick del
 * bucle (que dice si toca tic, si acaba de terminar y si el aviso de "completado"
 * ya se puede cerrar). Lo que NO hace: sonar, vibrar, notificar o pintar. Eso lo
 * decide quien llama a partir de lo que devuelve.
 *
 * Dos rarezas de la v1 que se conservan a propósito (y que parecían bugs):
 *
 * - **`add` con el descanso ya terminado arranca una cuenta NUEVA desde ahora.** Si
 *   se sumara al `endsAt` ya pasado, el botón "+15 s" del aviso de "completado" no
 *   haría nada visible.
 * - **`sub` nunca baja de 1 s**: el descanso se puede recortar, pero no se puede
 *   dejar en negativo (o el ring se pintaría raro).
 */
import { int, num } from './num';
import { trunc } from './text';
import type { RestState } from './types';

/** Descanso parado. Estado inicial y al terminar/descartar la sesión. */
export const IDLE_REST: RestState = {
  endsAt: 0,
  total: 0,
  running: false,
  label: '',
  doneFired: false,
  doneAt: 0,
  lastTick: null,
};

/** Lo que se guarda en `pulso.rest` (mismo formato que la v1). */
export interface PersistedRest {
  endsAt: number;
  total: number;
  label: string;
}

export const REST_NOTICE_MS = 30_000;

/** Arranca un descanso de `sec` segundos. Mínimo 1 s: un descanso de 0 no es descanso. */
export function startRest(sec: unknown, label: string, now: number): RestState {
  const total = Math.max(1, int(sec, 90));
  return {
    endsAt: now + total * 1000,
    total,
    running: true,
    label: label || '',
    doneFired: false,
    doneAt: 0,
    lastTick: null,
  };
}

/**
 * Suma segundos. Con el descanso parado (o ya terminado) arranca una cuenta nueva
 * desde ahora; en marcha, alarga la que hay y deja el total en lo que falte.
 */
export function addRest(state: RestState, sec: unknown, now: number): RestState {
  const s = int(sec, 15);
  const restarting = !state.running || state.endsAt <= now;
  const endsAt = restarting ? now + s * 1000 : state.endsAt + s * 1000;
  const total = restarting ? s : Math.max(state.total, Math.round((endsAt - now) / 1000));
  return {
    ...state,
    endsAt,
    total,
    running: true,
    doneFired: false,
    doneAt: 0,
    lastTick: null,
  };
}

/** Recorta segundos sin bajar de 1 s. */
export function subRest(state: RestState, sec: unknown, now: number): RestState {
  const s = int(sec, 15);
  const endsAt = Math.max(now + 1000, state.endsAt - s * 1000);
  return {
    ...state,
    endsAt,
    total: Math.max(1, Math.round((endsAt - now) / 1000)),
    lastTick: null,
  };
}

export const stopRest = (): RestState => ({ ...IDLE_REST });

/** Segundos que quedan (0 si no hay descanso corriendo). */
export function remainingSec(state: RestState, now: number): number {
  return state.running ? Math.max(0, Math.round((state.endsAt - now) / 1000)) : 0;
}

export const isOver = (state: RestState, now: number): boolean =>
  state.running && remainingSec(state, now) === 0;

export interface RestView {
  /** segundos restantes */
  left: number;
  /** total del que partía (nunca 0, para no dividir por cero) */
  total: number;
  /** fracción que queda (1 → recién arrancado, 0 → terminado): el ring */
  frac: number;
  over: boolean;
  label: string;
}

/** Lo que pinta la UI: cuenta atrás, fracción para el anillo y si ya terminó. */
export function restView(state: RestState, now: number): RestView {
  const left = remainingSec(state, now);
  const total = state.total || left || 1;
  return {
    left,
    total,
    frac: Math.min(1, left / total),
    over: state.running && left === 0,
    label: state.label,
  };
}

export interface RestTick {
  state: RestState;
  /** toca tic de cuenta atrás (últimos 3 s) */
  tick: boolean;
  /** acaba de terminar: pitido largo, vibración y aviso */
  finished: boolean;
  /** se cierra el aviso de "descanso completado" (30 s después) */
  closed: boolean;
}

/**
 * Un paso del bucle (la v1 lo llama cada 500 ms).
 *
 * Deja el estado listo para pintar: marca `lastTick` para no repetir el mismo tic
 * (el bucle corre dos veces por segundo), dispara `finished` una sola vez por
 * descanso y cierra solo el aviso de "completado" pasados 30 s.
 */
export function tickRest(
  state: RestState,
  now: number,
  opts: { countdownTick?: boolean } = {},
): RestTick {
  if (!state.running) return { state, tick: false, finished: false, closed: false };
  const left = remainingSec(state, now);
  let next = state;
  let tick = false;
  let finished = false;
  let closed = false;

  if (left > 0 && left <= 3 && opts.countdownTick !== false && state.lastTick !== left) {
    next = { ...next, lastTick: left };
    tick = true;
  }
  if (left === 0 && !state.doneFired) {
    next = { ...next, doneFired: true, doneAt: now, lastTick: null };
    finished = true;
  }
  if (next.doneFired && now - (next.doneAt || now) > REST_NOTICE_MS) {
    next = { ...next, running: false, doneFired: false };
    closed = true;
  }
  return { state: next, tick, finished, closed };
}

/** Lo que se guarda en `pulso.rest` (null cuando no hay descanso). */
export function toPersisted(state: RestState): PersistedRest | null {
  return state.running ? { endsAt: state.endsAt, total: state.total, label: state.label } : null;
}

/**
 * Reconstruye el descanso guardado al arrancar. Si ya había terminado mientras la
 * app estaba cerrada, devuelve `IDLE_REST`: no tiene sentido pintar un descanso
 * caducado (la v1 borraba esa clave).
 */
export function fromPersisted(value: unknown, now: number): RestState {
  const raw = value as Partial<PersistedRest> | null | undefined;
  if (!raw || typeof raw !== 'object') return { ...IDLE_REST };
  const endsAt = num(raw.endsAt);
  if (!endsAt || endsAt <= now) return { ...IDLE_REST };
  return {
    endsAt,
    total: Math.max(1, int(raw.total, Math.round((endsAt - now) / 1000))),
    running: true,
    label: typeof raw.label === 'string' ? raw.label : '',
    doneFired: false,
    doneAt: 0,
    lastTick: null,
  };
}

/** Texto del aviso de fin: a qué vas, no a qué acabas de ir. */
export const restNoticeBody = (label: string): string =>
  label ? `Siguiente serie: ${trunc(label, 40)}` : 'Siguiente serie cuando estés listo';
