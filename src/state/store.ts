/**
 * Estado y persistencia. Primer trozo portado de `legacy/js/store.js`.
 *
 * v2 lee y escribe el MISMO formato que la v1 (`localStorage['pulso.state']`), así
 * que los datos que ya tienes siguen valiendo mientras se termina la migración:
 * se hace lectura-modificación-escritura y nunca se pisan las claves que aún
 * gestiona la v1.
 */
import { signal } from '@preact/signals';

import { SEED_EXERCISES, TEMPLATES } from '@/domain/catalog';
import { defaultEquipment, type EquipmentMap } from '@/domain/data';
import { today } from '@/domain/dates';
import { DEFAULT_SETTINGS } from '@/domain/defaults';
import { demoSessions } from '@/domain/demo';
import { idFor } from '@/domain/exercise-draft';
import { mergeSeed } from '@/domain/library';
import { int, num, uid } from '@/domain/num';
import type {
  ActiveSession,
  AppState,
  Exercise,
  PlateModeKey,
  PlateStock,
  RoutineItem,
  Session,
  Settings,
} from '@/domain/types';
import { toast } from '@/ui/toast';

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

/**
 * Aviso de fallo de escritura YA DADO (spec `onboarding.md`, hueco 6). El
 * estado sigue viviendo en memoria, pero si `setItem` falla (cuota llena,
 * modo privado…) el usuario tiene que enterarse una vez, no una por serie
 * escrita. Es el `S._warned` de `store.js:171`.
 *
 * Ojo: `ui/toast` se importa aquí a sabiendas (la regla de dependencias es
 * domain ← state ← ui) porque el aviso es exactamente el del store y el módulo
 * se auto-monta en el DOM; sin DOM (tests en Node) el toast se descarta solo.
 */
let writeWarned = false;

export function writeState(state: AppState): void {
  if (!storageAvailable) return;
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('[pulso] no se pudo guardar el estado', err);
    if (!writeWarned) {
      writeWarned = true;
      toast('No se pudo guardar en localStorage: los datos viven solo en esta pestaña', {
        kind: 'warn',
        ms: 6000,
      });
    }
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

/* ---------- semilla personal (solo la primera carga) ---------- */

/**
 * Registro de «ya están sembradas las rutinas personales» (array de ids).
 * MISMO nombre que en la v1 (`U.st` de `store.js` prefija `pulso.`), y vive
 * FUERA del estado: si borras todo desde Ajustes no vuelven a aparecer.
 */
export const SEED_KEY = 'pulso.seeded-routines';

/** Registro de «ya apliqué el inventario por defecto de la v1» (`store.js:210`). */
export const SETUP_KEY = 'pulso.applied-setup';

/** Id de esa migración (el `SETUP_ID` de `store.js:211`). */
const SETUP_ID = 'inventario-v2';

/** Claves que «Borrar todo» respeta (la v1 no borraba ninguna clave suelta). */
const KEEP_ON_RESET: readonly string[] = [SEED_KEY, SETUP_KEY];

/**
 * Rutinas personales puntuales. NO son defaults ni plantillas de la app: son
 * rutinas concretas que el usuario pidió dejar cargadas una sola vez. Es el
 * `PERSONAL_ROUTINES` de `store.js:36` con los MISMOS ids y el mismo
 * contenido, para que las dos ramas lean la misma rutina.
 */
const PERSONAL_ROUTINES: readonly Routine[] = [
  {
    id: 'rt-personal-kroc',
    name: 'Espalda + Pecho + Brazos (superseries)',
    focus: 'Espalda · Pecho · Hombros · Bíceps · Tríceps · Antebrazo',
    source: 'manual',
    notes:
      'Cargada a mano para una sesión. El peso de cada ejercicio va en el plan. En las superseries el primer ejercicio lleva 15 s de transición y el segundo el descanso real (45-60 s).',
    items: [
      {
        exId: 'remo-con-mancuerna-a-una-mano',
        sets: 3,
        repMin: 10,
        repMax: 10,
        rest: 60,
        weight: 17,
        notes:
          'KROC ROW a una mano · 17 kg · 3x10 por lado · descanso 60 s al terminar los dos lados',
      },
      {
        exId: 'press-de-banca-con-mancuernas',
        sets: 3,
        repMin: 10,
        repMax: 10,
        rest: 60,
        weight: 18,
        notes:
          'PRESS DE PISO · 18 kg por mancuerna · pausa de 1 s con los codos tocando el suelo y subida explosiva',
      },
      {
        exId: 'press-militar-con-mancuernas',
        sets: 3,
        repMin: 8,
        repMax: 8,
        rest: 15,
        weight: 11,
        notes:
          'SUPERSERIE 1 (1/2) · 11 kg por mano x 8 · pasa sin descanso a las elevaciones laterales',
      },
      {
        exId: 'elevaciones-laterales-con-mancuernas',
        sets: 3,
        repMin: 15,
        repMax: 15,
        rest: 45,
        weight: 4,
        notes: 'SUPERSERIE 1 (2/2) · 4 kg por mano x 15 · descanso 45 s al terminar la superserie',
      },
      {
        exId: 'extension-sobre-la-cabeza-con-mancuerna',
        sets: 3,
        repMin: 10,
        repMax: 12,
        rest: 15,
        weight: 14,
        notes:
          'SUPERSERIE 2 (1/2) · rompecráneos en suelo 14 kg · 10-12 reps con los codos cerrados',
      },
      {
        exId: 'curl-con-barra',
        sets: 3,
        repMin: 8,
        repMax: 10,
        rest: 60,
        weight: 18.5,
        notes: 'SUPERSERIE 2 (2/2) · 18,5 kg x 8-10 · descanso 60 s al terminar la superserie',
      },
      {
        exId: 'curl-martillo',
        sets: 3,
        repMin: 10,
        repMax: 10,
        rest: 15,
        weight: 9,
        notes: 'SUPERSERIE 3 (1/2) · 9 kg por mano x 10',
      },
      {
        exId: 'encogimientos-con-barra',
        sets: 3,
        repMin: 12,
        repMax: 12,
        rest: 45,
        weight: 36,
        notes:
          'SUPERSERIE 3 (2/2) · 36 kg x 12 · mantén 2 s arriba apretando el trapecio · descanso 45 s',
      },
      {
        exId: 'pajaros-con-mancuernas',
        sets: 3,
        repMin: 15,
        repMax: 15,
        rest: 45,
        weight: 4,
        notes: 'Deltoides posterior · 4 kg por mano x 15 · bajada controlada en 2 s',
      },
      {
        exId: 'curl-de-muneca',
        sets: 2,
        repMin: 10,
        repMax: 10,
        rest: 30,
        weight: 11,
        notes:
          'ANTEBRAZOS (1/2) · unilateral 11 kg x 10 por brazo · sin descanso pasa al otro brazo',
      },
      {
        exId: 'curl-inverso-con-barra',
        sets: 2,
        repMin: 15,
        repMax: 15,
        rest: 30,
        weight: 5,
        notes: 'ANTEBRAZOS (2/2) · unilateral 5 kg x 15 por brazo · descanso 30 s entre rondas',
      },
    ],
  },
];

/** Lo que ha tocado `seedPersonalRoutines` (estado en memoria y clave de guardia). */
interface SeedResult {
  /** `state` ha cambiado: hay que persistirlo */
  changed: boolean;
  /** ha crecido la lista de «ya sembradas»: hay que persistir `done` */
  marked: boolean;
  done: string[];
}

/**
 * Inserta las rutinas personales UNA vez por dispositivo y agenda la de hoy si
 * el día está libre (así las tienes a un toque en la pestaña Hoy). Port de
 * `seedPersonalRoutines` (`store.js:75`) con la MISMA clave y el MISMO formato:
 *
 * - el registro va en `pulso.seeded-routines`, fuera del estado;
 * - si el id YA está en `state.routines` solo se marca como sembrada: no se
 *   duplica y NO se toca el calendario (igual que la v1, que hacía `return`
 *   antes de agendar);
 * - `schedule[hoy]` solo se rellena si ese día está libre
 *   (`sin routineId, sin plan y sin title`);
 * - NO escribe en disco: eso lo decide `loadInitialState`, para no dejar la
 *   clave de «sembrado» apuntando a un estado que no se llegó a guardar.
 */
function seedPersonalRoutines(state: AppState): SeedResult {
  const stored = readStored<unknown>(SEED_KEY);
  const done: string[] = Array.isArray(stored)
    ? stored.filter((id): id is string => typeof id === 'string')
    : [];
  let marked = false;
  let changed = false;

  for (const routine of PERSONAL_ROUTINES) {
    if (done.includes(routine.id)) continue;
    done.push(routine.id);
    marked = true;

    const rawList: unknown = state.routines;
    const list: unknown[] = Array.isArray(rawList) ? (rawList as unknown[]) : [];
    if (asRoutines(list).some((r) => r.id === routine.id)) continue;

    const copy: Routine = { ...structuredClone(routine), createdAt: new Date().toISOString() };
    state.routines = [...list, copy];
    changed = true;

    const rawPlan: unknown = state.schedule;
    const plan: Record<string, ScheduleDay> = isPlainObject(rawPlan)
      ? { ...(rawPlan as Record<string, ScheduleDay>) }
      : {};
    const day = plan[today()];
    if (!day || (!day.routineId && !day.plan && !day.title)) {
      plan[today()] = {
        routineId: copy.id,
        type: 'entreno',
        title: copy.name,
        status: 'planned',
        source: 'manual',
      };
      state.schedule = plan;
    }
  }

  return { changed, marked, done };
}

/**
 * Registra la migración de inventario de la v1 (`applyPersonalSetup`,
 * `store.js:212`) con su MISMA clave y su MISMO id, para que no se vuelva a
 * aplicar desde ninguna de las dos ramas.
 *
 * La v1 REESCRIBÍA aquí `settings.plates`, `settings.bars` y `equipment` con
 * los valores nuevos por defecto. En v2 esos valores YA son los de
 * `inventario-v2` (`DEFAULT_SETTINGS` y `defaultEquipment()` están portados de
 * `data.js`), así que aplicarlos de nuevo solo pisaría el inventario que ya
 * tienes —el que escriba el onboarding, incluido—: aquí se marca como hecha y
 * no se toca ningún dato.
 *
 * Devuelve `true` si había que escribir la clave.
 */
function applyPersonalSetup(): boolean {
  const stored = readStored<unknown>(SETUP_KEY);
  const done: string[] = Array.isArray(stored)
    ? stored.filter((id): id is string => typeof id === 'string')
    : [];
  if (done.includes(SETUP_ID)) return false;
  writeStored(SETUP_KEY, [...done, SETUP_ID]);
  return true;
}

/**
 * Carga inicial del estado: lo que hacía `S.load()` de la v1 (`store.js:136`)
 * al arrancar — leer `pulso.state`, aplicar el setup personal y sembrar las
 * rutinas personales.
 *
 * Es el ÚNICO sitio donde se siembra y se ejecuta al importar el módulo (una
 * vez por arranque de la app y de cada test): `readState` se llama en cada
 * escritura (lectura-modificación-escritura) y sembrar ahí reescribiría el
 * estado desde cada setter. NO toca las signals: en el arranque se usan para
 * inicializarlas; en un test se lee con `readState()` o con el valor devuelto.
 */
export function loadInitialState(): AppState {
  const state = readState();
  applyPersonalSetup();
  const seeded = seedPersonalRoutines(state);
  /* primero el estado y después la clave de guardia: si la escritura falla,
     la próxima carga vuelve a sembrar en vez de perder la rutina */
  if (seeded.changed) writeState(state);
  if (seeded.marked) writeStored(SEED_KEY, seeded.done);
  return state;
}

/* El estado se lee una sola vez al arrancar; a partir de ahí manda el memory state
   y localStorage solo se toca al escribir (lectura-modificación-escritura). */
const initial = loadInitialState();

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

/* ---------- ajustes anidados ---------- */

/**
 * Ajusta una ruta de ajustes (`bars.olimpica`, `ai.temperature`). En la v1 esto
 * era `App.setSettingPath` y se usaba desde los `data-key` de la vista de Ajustes;
 * aquí se resuelve con una ruta explícita en vez de por DOM.
 */
export function setSettingsPath(path: string, value: unknown): void {
  const [head, ...rest] = path.split('.');
  if (!head) return;
  if (!rest.length) {
    patchSettings({ [head]: value });
    return;
  }
  /* copia por niveles hasta el penúltimo: así nunca se muta el objeto del signal */
  const headValue = (settings.value as unknown as Record<string, unknown>)[head];
  const next: Record<string, unknown> = isPlainObject(headValue) ? { ...headValue } : {};
  let cursor = next;
  for (let i = 0; i < rest.length - 1; i++) {
    const key = rest[i];
    cursor[key] = { ...(cursor[key] as Record<string, unknown>) };
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[rest[rest.length - 1]] = value;
  patchSettings({ [head]: next });
}

function asPlates(value: unknown): PlateStock[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (p): p is PlateStock =>
      isPlainObject(p) && typeof p.w === 'number' && typeof p.pairs === 'number',
  );
}

/** Cambia un campo del inventario de discos (`w`, `unit`, `pairs`). */
export function updatePlate(index: number, patch: Partial<PlateStock>): void {
  const plates = asPlates(settings.value.plates).map((p, i) =>
    i === index ? { ...p, ...patch } : p,
  );
  patchSettings({ plates });
}

export function addPlate(plate: PlateStock = { w: 1.25, unit: 'kg', pairs: 1, on: true }): void {
  patchSettings({ plates: [...asPlates(settings.value.plates), plate] });
}

export function removePlate(index: number): void {
  patchSettings({ plates: asPlates(settings.value.plates).filter((_, i) => i !== index) });
}

export function togglePlate(index: number): void {
  const plates = asPlates(settings.value.plates);
  const current = plates[index];
  if (!current) return;
  updatePlate(index, { on: current.on === false });
}

/* ---------- material (en bloque) ---------- */

/** Aplica un preset entero (`equipPreset`) de una sola escritura, no clave a clave. */
export function applyEquipment(map: EquipmentMap): void {
  const state = readState();
  state.equipment = { ...map };
  writeState(state);
  equipment.value = { ...map };
}

/* ---------- rutinas ---------- */

function asRoutines(value: unknown): Routine[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (r): r is Routine => isPlainObject(r) && typeof r.id === 'string' && Array.isArray(r.items),
  );
}

/** Rutinas guardadas (el editor de rutinas nace con la pestaña). */
export const routines = signal<Routine[]>(asRoutines(initial.routines));

export function findRoutine(id: string | null | undefined): Routine | null {
  if (!id) return null;
  return routines.value.find((r) => r.id === id) ?? null;
}

/* ---------- rutinas: edición ---------- */

/**
 * Normaliza los items como hacía `S.addRoutine` de la v1: números con su valor por
 * defecto y `weight` en `null` cuando no hay peso prescrito (un `''` no es un peso).
 * Así una rutina escrita desde la v2 se lee exactamente igual en `main`.
 */
function normalizeRoutineItems(value: unknown): RoutineItem[] {
  if (!Array.isArray(value)) return [];
  const out: RoutineItem[] = [];
  for (const raw of value) {
    if (!isPlainObject(raw)) continue;
    const weight = raw.weight;
    out.push({
      exId: typeof raw.exId === 'string' ? raw.exId : '',
      sets: int(raw.sets, 3),
      repMin: int(raw.repMin, 8),
      repMax: int(raw.repMax, 12),
      rest: int(raw.rest, 90),
      weight: weight === undefined || weight === null || weight === '' ? null : num(weight),
      notes: typeof raw.notes === 'string' ? raw.notes : '',
    });
  }
  return out;
}

/**
 * Añade una rutina (generando el id si no trae) y la persiste.
 *
 * Mismo read-modify-write que el resto de setters: se parte SIEMPRE de lo que hay
 * en `localStorage`, nunca del signal, porque la v1 puede estar escribiendo el mismo
 * estado en otra pestaña.
 */
export function addRoutine(r: Omit<Routine, 'id'> & { id?: string }): Routine {
  const obj = {
    ...r,
    id: typeof r.id === 'string' && r.id ? r.id : uid('rt'),
    name: typeof r.name === 'string' && r.name ? r.name : 'Nueva rutina',
    focus: typeof r.focus === 'string' ? r.focus : '',
    source: typeof r.source === 'string' && r.source ? r.source : 'manual',
    createdAt:
      typeof r.createdAt === 'string' && r.createdAt ? r.createdAt : new Date().toISOString(),
    items: normalizeRoutineItems(r.items),
  } as Routine;
  const state = readState();
  const next = [...asRoutines(state.routines), obj];
  state.routines = next;
  writeState(state);
  routines.value = next;
  return obj;
}

/**
 * Parchea una rutina existente. El `id` NO se puede cambiar: el calendario lo
 * referencia (`schedule[día].routineId`). Devuelve `null` si no existe, como la v1.
 */
export function updateRoutine(id: string, patch: Partial<Routine>): Routine | null {
  const state = readState();
  const current = asRoutines(state.routines).find((r) => r.id === id);
  if (!current) return null;
  const updated: Routine = { ...current, ...patch, id };
  const next = asRoutines(state.routines).map((r) => (r.id === id ? updated : r));
  state.routines = next;
  writeState(state);
  routines.value = next;
  return updated;
}

/**
 * Borra una rutina y desatasca el calendario: los días que la apuntaban pierden su
 * `routineId` (la v1 borraba ese campo, no el día entero).
 */
export function removeRoutine(id: string): void {
  const state = readState();
  const next = asRoutines(state.routines).filter((r) => r.id !== id);
  const plan: Record<string, ScheduleDay> = isPlainObject(state.schedule)
    ? { ...(state.schedule as Record<string, ScheduleDay>) }
    : {};
  for (const day of Object.keys(plan)) {
    const entry = plan[day];
    if (!entry || entry.routineId !== id) continue;
    const copy: ScheduleDay = { ...entry };
    delete copy.routineId;
    plan[day] = copy;
  }
  state.routines = next;
  state.schedule = plan;
  writeState(state);
  routines.value = next;
  schedule.value = plan;
}

/**
 * Duplica una rutina: id nuevo, nombre «… (copia)» y `createdAt` de ahora —
 * tal cual `S.duplicateRoutine` de la v1 (`store.js:357`).
 *
 * Los items pasan por `normalizeRoutineItems` (lo mismo que `addRoutine`) y el
 * resto se clona en profundidad: la copia NO puede compartir objetos con el
 * original, o editar una rutina modificaría también la otra. Devuelve `null`
 * si no existe, como la v1.
 */
export function duplicateRoutine(id: string): Routine | null {
  const state = readState();
  const current = asRoutines(state.routines).find((r) => r.id === id);
  if (!current) return null;
  const copy: Routine = {
    ...structuredClone(current),
    id: uid('rt'),
    name: `${current.name} (copia)`,
    createdAt: new Date().toISOString(),
    items: normalizeRoutineItems(current.items),
  };
  const next = [...asRoutines(state.routines), copy];
  state.routines = next;
  writeState(state);
  routines.value = next;
  return copy;
}

/* ---------- meta ---------- */

/**
 * Lo que la v1 guarda en `state.meta` (¿quién vio el onboarding?, cuándo pidió el
 * coach un plan por última vez…). Mismas claves que `store.js` de `main`.
 */
export const DEFAULT_META = { onboarded: false, lastPlanAt: null, lastAiAt: null };

/** `state.meta`, reactivo. Las claves desconocidas se conservan (mismo merge que la v1). */
export const meta = signal<Record<string, unknown>>(withDefaults(initial.meta, DEFAULT_META));

/** Mezcla claves en `state.meta` (lo que hacía `S.setMeta` de la v1). */
export function setMeta(patch: Record<string, unknown>): void {
  const next: Record<string, unknown> = { ...meta.value, ...patch };
  const state = readState();
  state.meta = next;
  writeState(state);
  meta.value = next;
}

/* ---------- calendario ---------- */

/** Plan del calendario: `{ '2026-09-24': { status, type, routineId, title } }`. */
export const schedule = signal<Record<string, ScheduleDay>>(
  isPlainObject(initial.schedule) ? { ...(initial.schedule as Record<string, ScheduleDay>) } : {},
);

/** Apunta un día (es lo que hacía `S.setDay` de la v1). */
export function setDay(iso: string, patch: Partial<ScheduleDay>): void {
  const next = { ...schedule.value, [iso]: { ...(schedule.value[iso] ?? {}), ...patch } };
  const state = readState();
  state.schedule = next;
  writeState(state);
  schedule.value = next;
}

/**
 * Borra un día del calendario entero: es `S.clearDay` de la v1 (`store.js:402`).
 *
 * NO se cubre con `setDay(iso, { …: undefined })`: el merge de `setDay` deja la
 * clave en el mapa (un `{}` que además se persiste), mientras que la v1 hacía
 * `delete state.schedule[iso]` y `S.getDay(iso)` devolvía `null`.
 *
 * Ojo, es distinto del `clearDayPatch` del Calendario, que vacía la
 * planificación PERO conserva `sessionId` (el enlace a la sesión registrada);
 * este setter borra el día completo, como la v1.
 */
export function clearDay(iso: string): void {
  const state = readState();
  const plan: Record<string, ScheduleDay> = isPlainObject(state.schedule)
    ? { ...(state.schedule as Record<string, ScheduleDay>) }
    : {};
  delete plan[iso];
  state.schedule = plan;
  writeState(state);
  schedule.value = plan;
}

/* ---------- biblioteca: edición ---------- */

export function bulkSetAllowed(ids: readonly string[], allowed: boolean): void {
  const wanted = new Set(ids);
  const next = exercises.value.map((e) => (wanted.has(e.id) ? { ...e, allowed } : e));
  const state = readState();
  state.exercises = next.filter((e) => e.custom || e.allowed === false);
  writeState(state);
  exercises.value = next;
}

/**
 * Crea (o edita) un ejercicio de la biblioteca y devuelve el registro guardado.
 *
 * La primera versión pedía el `id` ya montado y forzaba `custom: true` aunque
 * el ejercicio viniera del catálogo; ahora:
 * - el id lo GENERA aquí (`idFor`: slug del nombre y, si choca con el de la
 *   semilla o de otro propio, `uid('ex')`) salvo que YA exista un registro con
 *   ese id, que se conserva tal cual — rutinas y sesiones lo referencian;
 * - el flag `custom` es el del registro existente (el de los nuevos es `true`),
 *   así editar un ejercicio del catálogo no lo convierte en «propio»;
 * - `tags` y `tips` se rellenan si no traen nada.
 *
 * Ojo: `mergeSeed` restaura nombre/grupo/material/tipo/rango de los que no son
 * `custom`, así que un catálogo editado se revertiría al recargar — por eso el
 * editor de Ajustes solo se abre para los propios.
 */
export function saveExercise(patch: Exercise): Exercise {
  const current = exercises.value.find((e) => e.id === patch.id) ?? null;
  const id =
    current?.id ??
    idFor(
      patch.name,
      exercises.value.map((e) => e.id),
    );
  const saved: Exercise = {
    ...patch,
    id,
    custom: current ? current.custom : true,
    tags: patch.tags ?? [],
    tips: patch.tips ?? '',
  };
  const next = current
    ? exercises.value.map((e) => (e.id === id ? saved : e))
    : [...exercises.value, saved];
  const state = readState();
  state.exercises = next.filter((e) => e.custom || e.allowed === false);
  writeState(state);
  exercises.value = next;
  return saved;
}

/**
 * Borra un ejercicio. Los de la biblioteca NO se borran (la semilla los
 * reharía en `refresh`): se devuelven `false`, como en la v1, y el aviso lo
 * pinta la UI.
 */
export function removeExercise(id: string): boolean {
  const current = exercises.value.find((e) => e.id === id);
  if (!current || !current.custom) return false;
  const next = exercises.value.filter((e) => e.id !== id);
  const state = readState();
  state.exercises = next.filter((e) => e.custom || e.allowed === false);
  writeState(state);
  exercises.value = next;
  return true;
}

/* ---------- datos (copia, importar, borrar) ---------- */

/** Tamaño ocupado por las claves de Pulso, en bytes (para la tarjeta de Datos). */
export function storageBytes(): number {
  if (!storageAvailable) return 0;
  let total = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith('pulso.')) continue;
    total += key.length + (localStorage.getItem(key)?.length ?? 0);
  }
  return total * 2; /* aproximación: 2 bytes por carácter (UTF-16) */
}

/** ¿El objeto leído parece un estado de Pulso? (importación tolerante) */
export function looksLikeState(value: unknown): boolean {
  return isPlainObject(value) && isPlainObject((value as AppState).settings);
}

/**
 * Reemplaza el estado entero (importación). Se conserva tal cual lo que traiga el
 * archivo, porque el formato es el mismo de la v1: importar una copia hecha en
 * `main` tiene que dejar los datos igual que allí. Única excepción:
 * `meta.onboarded = true` (lo que hacía la v1, `store.js:197`).
 */
export function importState(raw: unknown): AppState {
  if (!looksLikeState(raw)) throw new Error('El archivo no parece una copia de Pulso');
  const incoming = raw as AppState;
  const next: AppState = {
    ...incoming,
    version: STATE_VERSION,
    createdAt:
      typeof incoming.createdAt === 'string' ? incoming.createdAt : new Date().toISOString(),
    /* igual que `S.importJSON` (store.js:197): importar una copia cuenta como
       onboarding visto; las claves desconocidas de `meta` se conservan */
    meta: { ...(isPlainObject(incoming.meta) ? incoming.meta : {}), onboarded: true },
  };
  writeState(next);
  refresh();
  return next;
}

export function exportState(): AppState {
  return readState();
}

/**
 * Borra las claves de Pulso y vuelve al estado inicial.
 * ⚠️ No toca las claves de "ya sembrado" (`pulso.applied-setup`, `pulso.seeded-routines`),
 * igual que la v1: si se borrara todo, el inventario personalizado y las rutinas
 * personales volverían a aparecer después de un "Borrar todo".
 */
export function resetAll(): void {
  if (storageAvailable) {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('pulso.') && !KEEP_ON_RESET.includes(key) && key !== STATE_KEY) {
        keys.push(key);
      }
    }
    keys.push(STATE_KEY);
    for (const key of keys) localStorage.removeItem(key);
  }
  refresh();
}

/** Relee el estado de `localStorage` y refresca todos los signals. */
export function refresh(): void {
  const next = readState();
  settings.value = next.settings;
  equipment.value = (next.equipment as EquipmentMap | undefined) ?? defaultEquipment();
  exercises.value = mergeSeed(SEED_EXERCISES, next.exercises);
  sessions.value = asSessions(next.sessions);
  routines.value = asRoutines(next.routines);
  meta.value = withDefaults(next.meta, DEFAULT_META);
  schedule.value = isPlainObject(next.schedule)
    ? { ...(next.schedule as Record<string, ScheduleDay>) }
    : {};
  active.value = asActive(next.active);
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

/**
 * La sesión en curso (`pulso.state.active`), reactiva: **una sola fuente de verdad**
 * para todo lo que la lee o la escribe (la pantalla de Entrenar, el cierre de sesión
 * y los refrescos por importación). `state/session.ts` la reexporta, no duplica.
 */
export const active = signal<ActiveSession | null>(asActive(initial.active));

/**
 * Una sesión en curso solo es válida si trae sus entradas: un `pulso.state` escrito a
 * mano o a medias no debe colarse en la UI (misma tolerancia que la v1 al leerlo).
 */
function asActive(value: unknown): ActiveSession | null {
  return isPlainObject(value) && Array.isArray(value.entries)
    ? (value as unknown as ActiveSession)
    : null;
}

/** Guarda la sesión en curso (`pulso.state.active`), tal cual la lee la v1. */
export function writeActive(next: ActiveSession | null): void {
  const state = readState();
  state.active = next;
  writeState(state);
  active.value = next;
}

/**
 * Apila una sesión terminada y marca el día como hecho: es lo que hacían juntos
 * `S.addSession` + `S.setDay(iso, {status:'done'})` en la v1, así que el calendario
 * de la rama `main` ve el día igual que si lo hubieras entrenado allí.
 */
/** Misma ordenación que la v1: `startedAt` descendente (lo más reciente arriba). */
function byStartedAtDesc(a: Session, b: Session): number {
  return (a.startedAt ?? '') < (b.startedAt ?? '') ? 1 : -1;
}

export function commitSession(session: Session): void {
  const state = readState();
  const all = [session, ...asSessions(state.sessions)].sort(byStartedAtDesc);
  state.sessions = all;
  /* ojo: el nombre local no puede ser `schedule` (sombrería al signal homónimo) */
  const plan: Record<string, ScheduleDay> = isPlainObject(state.schedule)
    ? { ...(state.schedule as Record<string, ScheduleDay>) }
    : {};
  const day = plan[session.date];
  plan[session.date] = {
    ...(isPlainObject(day) ? day : {}),
    status: 'done',
    sessionId: session.id,
  };
  state.schedule = plan;
  state.active = null;
  writeState(state);
  sessions.value = all;
  schedule.value = plan;
  active.value = null;
}

/**
 * Edita una sesión guardada (nombre, notas, fecha, RPE…): es `S.updateSession`
 * de la v1 (`store.js:376`), que aplicaba el parche tal cual sobre la sesión
 * encontrada. Devuelve `null` si no existe, como allí.
 *
 * - El `id` NO se puede cambiar (igual que en `updateRoutine`): el calendario
 *   lo referencia con `schedule[día].sessionId`.
 * - Como la v1, NO reordena por `startedAt`: el orden solo lo fija `addSession`
 *   al apilar, así que editar una fecha no reorganiza la lista.
 */
export function updateSession(id: string, patch: Partial<Session>): Session | null {
  const state = readState();
  const current = asSessions(state.sessions).find((s) => s.id === id);
  if (!current) return null;
  const updated: Session = { ...current, ...patch, id };
  const next = asSessions(state.sessions).map((s) => (s.id === id ? updated : s));
  state.sessions = next;
  writeState(state);
  sessions.value = next;
  return updated;
}

/**
 * Borra una sesión guardada (`S.removeSession` de la v1, `store.js:383`).
 *
 * La v1 NO tocaba el calendario, y aquí se hereda tal cual: el día se queda con
 * su `status: 'done'` y su `sessionId`, así que sigue pintándose hecho (en
 * `views-calendar.js` el día sale hecho si `p.status === 'done'`, no solo si
 * hay sesiones). Quien quiera desmarcarlo lo hace a mano con `clearDay`.
 */
export function removeSession(id: string): void {
  const state = readState();
  const next = asSessions(state.sessions).filter((s) => s.id !== id);
  state.sessions = next;
  writeState(state);
  sessions.value = next;
}

/* ---------- datos de ejemplo ---------- */

/**
 * Apila sesiones ya terminadas SIN tocar el calendario (a diferencia de
 * `commitSession`, que marca el día como hecho): es la base de `demoData`.
 * Devuelve el array completo, ya ordenado por `startedAt` descendente.
 */
export function appendSessions(list: readonly Session[]): Session[] {
  const state = readState();
  const current = asSessions(state.sessions);
  if (!list.length) return current;
  const all = [...list, ...current].sort(byStartedAtDesc);
  state.sessions = all;
  writeState(state);
  sessions.value = all;
  return all;
}

/**
 * Crea `weeks` semanas de sesiones de ejemplo (8, como la v1) para ver las
 * gráficas con contenido. Van al MISMO array que las reales —la analítica no
 * las filtra, igual que en la v1— y no se deduplican: dos clics = doble sesión.
 * Devuelve cuántas se han añadido.
 */
export function demoData(weeks = 8): number {
  const state = readState();
  const list = demoSessions({
    weeks,
    unit: state.settings.units,
    exercises: exercises.value,
    equipment: isPlainObject(state.equipment)
      ? { ...(state.equipment as EquipmentMap) }
      : defaultEquipment(),
    sessions: asSessions(state.sessions),
    todayIso: today(),
    templates: TEMPLATES,
  });
  if (!list.length) return 0;
  appendSessions(list);
  return list.length;
}

/**
 * Quita SOLO las sesiones de ejemplo (`demo: true`) y deja intactas las
 * reales. Devuelve cuántas se han quitado.
 */
export function clearDemo(): number {
  const state = readState();
  const list = asSessions(state.sessions);
  const kept = list.filter((s) => !s.demo);
  const removed = list.length - kept.length;
  if (!removed) return 0;
  state.sessions = kept;
  writeState(state);
  sessions.value = kept;
  return removed;
}

/* ---------- chat del coach ---------- */

/**
 * Persiste el historial del chat del coach (`state.chat`): los últimos 80
 * mensajes con la MISMA forma que la v1 (`{role, text, ts, thoughts?, notes?}`),
 * así que exportar los datos o volver a la rama `main` conserva la
 * conversación — una clave suelta tipo `pulso.chat` se quedaría fuera de
 * `pulso.state` y no sobreviviría a un import.
 *
 * Solo guarda: la signal que repinta la vista vive en `state/chat.ts` (nada de
 * UI aquí), y la escritura usa el mismo read-modify-write que el resto de
 * setters (se parte SIEMPRE de lo que hay en `localStorage`, por si la v1 está
 * escribiendo el mismo estado en otra pestaña).
 */
export function setChat(value: unknown): void {
  const state = readState();
  state.chat = value;
  writeState(state);
}

/* ---------- tipos locales del estado ---------- */

/** Un día del calendario. Se declara aquí porque solo lo toca el store. */
export interface ScheduleDay {
  status?: string;
  type?: string;
  routineId?: string;
  title?: string;
  sessionId?: string;
  source?: string;
  [key: string]: unknown;
}

/** Una rutina guardada (los items son la prescripción de cada ejercicio). */
export interface Routine {
  id: string;
  name: string;
  focus?: string;
  source?: string;
  items: RoutineItem[];
  [key: string]: unknown;
}
