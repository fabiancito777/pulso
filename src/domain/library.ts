/**
 * Biblioteca de ejercicios: fusión de la semilla con lo que el usuario tiene
 * guardado. Portado de `mergeSeed()` de `legacy/js/store.js`, pero sin tocar el
 * estado (antes mutaba el array guardado a propósito, aquí devuelve una lista).
 *
 * Reglas que NO se pueden cambiar sin querer:
 * - los ejercicios que el usuario creó (`custom: true`) se conservan enteros;
 * - en los de biblioteca se refresca nombre/grupo/material/tipo/rango, y de
 *   `sets/rest/tags/tips` **solo** si NO son custom, para no pisar ajustes;
 * - `allowed` (permitido/prohibido) siempre se respeta: es decisión del usuario.
 */
import { int } from './num';
import type { Exercise } from './types';

function normalize(ex: Exercise): Exercise {
  return {
    ...ex,
    allowed: ex.allowed !== false,
    /* mismos topes que la v1 (`max(1, int(v, 3))` y `max(0, int(v, 90))`): de un estado
       corrupto sale un valor usable en vez de NaN */
    sets: Math.max(1, int(ex.sets, 3)),
    rest: Math.max(0, int(ex.rest, 90)),
    /* la v1 dejaba pasar repMin 0; aquí se fuerza al menos 1 rep */
    repMin: Math.max(1, int(ex.repMin, 8)),
    repMax: Math.max(1, int(ex.repMax, 12)),
  };
}

export function mergeSeed(seed: readonly Exercise[], stored: unknown): Exercise[] {
  const list: Exercise[] = Array.isArray(stored)
    ? (stored as Exercise[]).filter((e) => e && e.id).map((e) => ({ ...e }))
    : [];
  const byId = new Map(list.map((e) => [e.id, e]));

  for (const s of seed) {
    const current = byId.get(s.id);
    if (!current) {
      list.push(structuredClone(s));
      continue;
    }
    current.name = s.name;
    current.group = s.group;
    current.equip = s.equip;
    current.type = s.type;
    current.repMin = s.repMin;
    current.repMax = s.repMax;
    current.bw = s.bw;
    if (!current.custom) {
      current.sets = s.sets;
      current.rest = s.rest;
      current.tags = s.tags;
      current.tips = s.tips;
    }
  }

  return list.map(normalize);
}

export function customExercises(exercises: readonly Exercise[]): Exercise[] {
  return exercises.filter((e) => e.custom);
}
