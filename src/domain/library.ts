/**
 * Biblioteca de ejercicios: fusión de la semilla con lo que el usuario tiene
 * guardado. Devuelve una lista nueva y no muta el estado.
 *
 * Reglas que NO se pueden cambiar sin querer:
 * - los ejercicios que el usuario creó (`custom: true`) se conservan enteros;
 * - en los de biblioteca se refresca nombre/grupo/material/tipo/rango, y de
 *   `sets/rest/tags/tips` **solo** si NO son custom, para no pisar ajustes;
 * - `allowed` (permitido/prohibido) siempre se respeta: es decisión del usuario.
 *
 * Y la regla nueva de los flags de usuario: `fav` y `hidden` **tampoco se pisan**
 * aquí (se caen solos si el ejercicio no está guardado, porque no vienen de la
 * semilla), así que una estrella se conserva al recargar.
 */
import { int } from './num';
import { LEGACY_EXERCISES } from './legacy-exercises';
import { slug } from './text';
import type { Exercise } from './types';

const LEGACY_BY_ID = new Map(LEGACY_EXERCISES.map((entry) => [entry.id, entry]));

const LEGACY_STOCK_KEYS = new Set([
  'id',
  'name',
  'group',
  'equip',
  'type',
  'sets',
  'repMin',
  'repMax',
  'rest',
  'allowed',
  'custom',
  'bw',
  'tags',
  'tips',
]);

/** Hash corto y determinista de la fila original; no es para seguridad. */
function legacyFingerprint(ex: Exercise): string {
  const row = JSON.stringify([
    ex.id,
    ex.name,
    ex.group,
    ex.equip,
    ex.type,
    ex.sets,
    ex.repMin,
    ex.repMax,
    ex.rest,
    ex.allowed,
    ex.custom,
    ex.bw,
    ex.tags,
    ex.tips,
  ]);
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < row.length; i++) {
    const code = row.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

function isUntouchedLegacyStock(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const ex = value as Exercise & Record<string, unknown>;
  const legacy = LEGACY_BY_ID.get(ex.id);
  if (
    !legacy?.fingerprint ||
    ex.allowed !== true ||
    ex.custom !== false ||
    Object.keys(ex).some((key) => !LEGACY_STOCK_KEYS.has(key))
  ) {
    return false;
  }
  return legacyFingerprint(ex) === legacy.fingerprint;
}

function addItemReferences(
  value: unknown,
  ids: Set<string>,
  candidates: ReadonlySet<string>,
): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id =
      typeof row.exId === 'string' ? row.exId : typeof row.name === 'string' ? slug(row.name) : '';
    if (candidates.has(id)) ids.add(id);
  }
}

/**
 * Recolecta ids guardados en rutinas, calendario, sesiones, sesión activa y
 * ajustes por ejercicio (placas). La búsqueda tolera formas antiguas/importadas.
 */
function referencedExerciseIds(
  state: unknown,
  candidates: ReadonlySet<string>,
): ReadonlySet<string> {
  const ids = new Set<string>();
  if (state && typeof state === 'object' && !Array.isArray(state)) {
    const record = state as Record<string, unknown>;
    for (const routine of Array.isArray(record.routines) ? record.routines : []) {
      if (routine && typeof routine === 'object' && !Array.isArray(routine)) {
        addItemReferences((routine as Record<string, unknown>).items, ids, candidates);
      }
    }
    for (const session of Array.isArray(record.sessions) ? record.sessions : []) {
      if (!session || typeof session !== 'object' || Array.isArray(session)) continue;
      const row = session as Record<string, unknown>;
      addItemReferences(row.entries, ids, candidates);
      addItemReferences(row.plan, ids, candidates);
    }
    const active = record.active;
    if (active && typeof active === 'object' && !Array.isArray(active)) {
      const row = active as Record<string, unknown>;
      addItemReferences(row.entries, ids, candidates);
      addItemReferences(row.plan, ids, candidates);
      if (Array.isArray(row.finished)) {
        for (const id of row.finished)
          if (typeof id === 'string' && candidates.has(id)) ids.add(id);
      }
    }
    const schedule = record.schedule;
    if (schedule && typeof schedule === 'object' && !Array.isArray(schedule)) {
      for (const day of Object.values(schedule as Record<string, unknown>)) {
        if (!day || typeof day !== 'object' || Array.isArray(day)) continue;
        const row = day as Record<string, unknown>;
        addItemReferences(row.plan, ids, candidates);
        addItemReferences(row.items, ids, candidates);
        addItemReferences(row.exercises, ids, candidates);
      }
    }
    const settings = record.settings;
    if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
      const modes = (settings as Record<string, unknown>).plateModes;
      if (modes && typeof modes === 'object' && !Array.isArray(modes)) {
        for (const id of Object.keys(modes)) if (candidates.has(id)) ids.add(id);
      }
    }
  }
  return ids;
}

/**
 * Retira copias exactas y sin uso del antiguo catálogo expandido. Filas editadas,
 * marcadas por el usuario o referenciadas se conservan para no perder decisiones.
 */
export function pruneLegacyStock<T extends Record<string, unknown>>(state: T): T {
  if (!Array.isArray(state.exercises)) return state;
  const possible = state.exercises.filter(isUntouchedLegacyStock);
  if (!possible.length) return state;
  const candidatesByObject = new Set(possible);
  const candidates = new Set(
    possible.map((entry) => (entry as Record<string, unknown>).id as string),
  );
  const refs = referencedExerciseIds(state, candidates);
  const exercises = state.exercises.filter((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return true;
    const ex = entry as Record<string, unknown>;
    if (!candidatesByObject.has(entry) || typeof ex.id !== 'string' || refs.has(ex.id)) return true;
    return false;
  });
  return exercises.length === state.exercises.length ? state : { ...state, exercises };
}

function normalize(ex: Exercise): Exercise {
  return {
    ...ex,
    allowed: ex.allowed !== false,
    /* flags de usuario materializados como boolean: la UI lee `e.fav` sin `?.` y
       al persistir solo se guarda lo que sea `=== true` (opcionales en el tipo
       porque antes y `E()` no los traen) */
    fav: ex.fav === true,
    hidden: ex.hidden === true,
    /* mismos topes que antes (`max(1, int(v, 3))` y `max(0, int(v, 90))`): de un estado
       corrupto sale un valor usable en vez de NaN */
    sets: Math.max(1, int(ex.sets, 3)),
    rest: Math.max(0, int(ex.rest, 90)),
    /* antes dejaba pasar repMin 0; aquí se fuerza al menos 1 rep */
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
