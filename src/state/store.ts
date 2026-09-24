/**
 * Estado y persistencia. Primer trozo portado de `legacy/js/store.js`.
 *
 * v2 lee y escribe el MISMO formato que la v1 (`localStorage['pulso.state']`), así
 * que los datos que ya tienes siguen valiendo mientras se termina la migración:
 * se hace lectura-modificación-escritura y nunca se pisan las claves que aún
 * gestiona la v1.
 */
import { signal } from '@preact/signals';

import { SEED_EXERCISES } from '@/domain/catalog';
import { defaultEquipment, type EquipmentMap } from '@/domain/data';
import { DEFAULT_SETTINGS } from '@/domain/defaults';
import { mergeSeed } from '@/domain/library';
import type {
  ActiveSession,
  AppState,
  Exercise,
  PlateModeKey,
  Session,
  Settings,
} from '@/domain/types';

export const STATE_KEY = 'pulso.state';
export const STATE_VERSION = 1;

/**
 * Claves sueltas de `localStorage` (fuera del estado), con el mismo nombre que les
 * da la v1 (`U.st` prefija `pulso.`). El descanso va aparte porque cambia cada 15
 * segundos y no merece reescribir todo el estado.
 */
export const STORAGE_KEYS = { state: STATE_KEY, rest: 'pulso.rest' } as const;

/** ¿Se puede usar localStorage? Si no, se avisa en la UI (los datos no persisten). */
export const storageAvailable = ((): boolean => {
  try {
    const k = 'pulso._t';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
})();

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Rellena las claves que falten con los valores por defecto (recursivo en
 * objetos planos) sin tocar lo que el usuario ya tenía guardado. Es lo que
 * permite añadir ajustes nuevos sin migraciones.
 */
export function withDefaults<T extends object>(stored: unknown, defaults: T): T {
  const out: Record<string, unknown> = isPlainObject(stored) ? { ...stored } : {};
  for (const [key, def] of Object.entries(defaults)) {
    const current = out[key];
    if (current === undefined || current === null) {
      out[key] = isPlainObject(def) ? structuredClone(def) : def;
    } else if (isPlainObject(def) && isPlainObject(current)) {
      out[key] = withDefaults(current, def);
    }
  }
  return out as T;
}

export function defaultState(): AppState {
  return {
    version: STATE_VERSION,
    createdAt: new Date().toISOString(),
    settings: structuredClone(DEFAULT_SETTINGS),
  };
}

export function readState(): AppState {
  if (!storageAvailable) return defaultState();
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return defaultState();
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) return defaultState();
    return {
      ...(parsed as AppState),
      version: typeof parsed.version === 'number' ? parsed.version : STATE_VERSION,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
      settings: withDefaults(parsed.settings, DEFAULT_SETTINGS),
      equipment: isPlainObject(parsed.equipment) ? { ...parsed.equipment } : defaultEquipment(),
    };
  } catch (err) {
    console.warn('[pulso] estado ilegible, se usan los valores por defecto', err);
    return defaultState();
  }
}

export function writeState(state: AppState): void {
  if (!storageAvailable) return;
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('[pulso] no se pudo guardar el estado', err);
  }
}

/** Lee una clave suelta de `localStorage` (JSON). Devuelve `null` si no está o si está rota. */
export function readStored<T = unknown>(key: string): T | null {
  if (!storageAvailable) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch (err) {
    console.warn('[pulso] no se pudo leer', key, err);
    return null;
  }
}

/** Escribe (o borra, con `null`) una clave suelta. Mismo formato que la v1. */
export function writeStored(key: string, value: unknown): void {
  if (!storageAvailable) return;
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn('[pulso] no se pudo guardar', key, err);
  }
}

/* El estado se lee una sola vez al arrancar; a partir de ahí manda el memory state
   y localStorage solo se toca al escribir (lectura-modificación-escritura). */
const initial = readState();

/** Ajustes en memoria, reactivos: cualquier componente que lea `.value` se repinta solo. */
export const settings = signal<Settings>(initial.settings);

export function patchSettings(patch: Partial<Settings>): Settings {
  const state = readState();
  const next = withDefaults({ ...state.settings, ...patch }, DEFAULT_SETTINGS);
  state.settings = next;
  writeState(state);
  settings.value = next;
  return next;
}

/** El modo de carga se recuerda por ejercicio (`__tool__` = calculadora suelta). */
export function rememberPlateMode(key: string, mode: PlateModeKey): void {
  patchSettings({ plateModes: { ...settings.value.plateModes, [key]: mode } });
}

export const TOOL_MODE_KEY = '__tool__';

/* ---------- material ---------- */

/** Material activo (`{ clave: boolean }`), reactivo. */
export const equipment = signal<EquipmentMap>(
  (initial.equipment as EquipmentMap | undefined) ?? defaultEquipment(),
);

export function setEquipment(key: string, on: boolean): void {
  const next = { ...equipment.value, [key]: on };
  const state = readState();
  state.equipment = next;
  writeState(state);
  equipment.value = next;
}

/* ---------- biblioteca de ejercicios ---------- */

/**
 * Biblioteca ya fusionada con lo guardado (se lee al arrancar, igual que la v1).
 * Los ejercicios de biblioteca son la semilla; los del usuario (`custom`) y los
 * flags permitido/prohibido vienen del estado y se conservan.
 */
export const exercises = signal<Exercise[]>(mergeSeed(SEED_EXERCISES, initial.exercises));

export function findExercise(id: string): Exercise | null {
  return exercises.value.find((e) => e.id === id) ?? null;
}

export function setExerciseAllowed(id: string, allowed: boolean): void {
  const next = exercises.value.map((e) => (e.id === id ? { ...e, allowed } : e));
  const state = readState();
  /* solo se guarda el flag: el resto de la biblioteca se deriva de la semilla */
  state.exercises = next.filter((e) => e.custom || e.allowed === false);
  writeState(state);
  exercises.value = next;
}

/* ---------- sesiones ---------- */

/**
 * Sesiones guardadas. Se filtran las que no tienen forma de sesión para que un
 * `pulso.state` tocado a mano (o a medias entre versiones) no rompa la analítica:
 * la v1 ya era tolerante al leer el JSON, pero no validaba cada sesión.
 * Es de solo lectura: apilar y editar sesiones llega con el bloque de la sesión activa.
 */
function asSessions(value: unknown): Session[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (s): s is Session => isPlainObject(s) && typeof s.date === 'string' && Array.isArray(s.entries),
  );
}

export const sessions = signal<Session[]>(asSessions(initial.sessions));

/** Guarda la sesión en curso (`pulso.state.active`), tal cual la lee la v1. */
export function writeActive(next: ActiveSession | null): void {
  const state = readState();
  state.active = next;
  writeState(state);
}

/**
 * Apila una sesión terminada y marca el día como hecho: es lo que hacían juntos
 * `S.addSession` + `S.setDay(iso, {status:'done'})` en la v1, así que el calendario
 * de la rama `main` ve el día igual que si lo hubieras entrenado allí.
 */
export function commitSession(session: Session): void {
  const state = readState();
  const all = [session, ...asSessions(state.sessions)].sort((a, b) =>
    (a.startedAt ?? '') < (b.startedAt ?? '') ? 1 : -1,
  );
  state.sessions = all;
  const schedule = isPlainObject(state.schedule) ? { ...state.schedule } : {};
  const day = schedule[session.date];
  schedule[session.date] = {
    ...(isPlainObject(day) ? day : {}),
    status: 'done',
    sessionId: session.id,
  };
  state.schedule = schedule;
  state.active = null;
  writeState(state);
  sessions.value = all;
}
