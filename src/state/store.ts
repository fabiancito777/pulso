/**
 * Estado y persistencia. Primer trozo portado de `legacy/js/store.js`.
 *
 * v2 lee y escribe el MISMO formato que la v1 (`localStorage['pulso.state']`), así
 * que los datos que ya tienes siguen valiendo mientras se termina la migración:
 * se hace lectura-modificación-escritura y nunca se pisan las claves que aún
 * gestiona la v1.
 */
import { signal } from '@preact/signals';

import { DEFAULT_SETTINGS } from '@/domain/defaults';
import type { AppState, PlateModeKey, Settings } from '@/domain/types';

export const STATE_KEY = 'pulso.state';
export const STATE_VERSION = 1;

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

/** Ajustes en memoria, reactivos: cualquier componente que lea `.value` se repinta solo. */
export const settings = signal<Settings>(readState().settings);

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
