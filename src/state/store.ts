/**
 * Estado y persistencia.
 *
 * Cada perfil guarda su estado en `pulso.state` (el principal) o
 * `pulso.state.<id>`, con lectura-modificación-escritura.
 *
 * `settings.plates` se guarda en unidades (`discs`) y se normaliza al leer y al
 * escribir (`normalizePlates`), así que ninguna ruta puede dejar el inventario a
 * medias.
 */
import { signal } from '@preact/signals';

import { TEMPLATES } from '@/domain/data';
import { defaultEquipment, seedExercises, type EquipmentMap } from '@/domain/data';
import { today } from '@/domain/dates';
import { DEFAULT_SETTINGS } from '@/domain/defaults';
import { demoSessions } from '@/domain/demo';
import { idFor } from '@/domain/exercise-draft';
import { mergeSeed } from '@/domain/library';
import { int, num, uid } from '@/domain/num';
import { normalizePlates } from '@/domain/plates';
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

import {
  MAX_PROFILES,
  activeProfile,
  activeProfileId,
  addProfileRecord,
  corruptPrefixFor,
  dataKeysFor,
  profiles,
  readSharedApiKey,
  removeProfileRecord,
  replaceProfiles,
  restKeyFor,
  seedKeyFor,
  setActiveProfileId,
  setupKeyFor,
  stateKeyFor,
  touchProfile,
  updateProfileRecord,
  writeSharedApiKey,
  type Profile,
} from './profiles';

export const STATE_KEY = 'pulso.state';
/**
 * Versión documental del formato. La migración de placas NO depende de aquí
 * (antes y v2 inicial exportan `1`): el marcador es por fila, un `discs` presente
 * significa «ya en unidades» (`normalizePlates`).
 *
 * v3: `ai.temperature` pasa de 0,7 (default viejo) a 1 (el default de Gemini).
 * Solo migra el 0,7 que era el default; un valor elegido a mano se respeta.
 */
export const STATE_VERSION = 3;

/**
 * Claves sueltas de `localStorage` (fuera del estado), con el mismo nombre que les
 * da antes (`U.st` prefija `pulso.`). El descanso va aparte porque cambia cada 15
 * segundos y no merece reescribir todo el estado.
 */
export const STORAGE_KEYS = { state: STATE_KEY, rest: 'pulso.rest' } as const;

/** Claves del perfil activo (el principal conserva las históricas). */
export const currentStateKey = (): string => stateKeyFor(activeProfileId.value);
export const currentRestKey = (): string => restKeyFor(activeProfileId.value);
export const currentProfileId = (): string => activeProfileId.value;

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

/** Guarda una copia del estado corrupto sin pisar las anteriores. */
function preserveCorrupt(profileId: string, raw: string): void {
  if (!storageAvailable) return;
  try {
    const stamp = Date.now();
    const prefix = corruptPrefixFor(profileId);
    let key = `${prefix}${stamp}`;
    for (let i = 1; localStorage.getItem(key) !== null; i++) {
      key = `${prefix}${stamp}.${i}`;
    }
    localStorage.setItem(key, raw);
  } catch (err) {
    console.warn('[pulso] no se pudo conservar el estado corrupto', err);
  }
}

/** Lee el estado de un perfil concreto (sin tocar signals). */
export function readProfileState(profileId: string): AppState {
  if (!storageAvailable) return defaultState();
  try {
    const raw = localStorage.getItem(stateKeyFor(profileId));
    if (!raw) return defaultState();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      preserveCorrupt(profileId, raw);
      console.warn('[pulso] estado ilegible, se usan los valores por defecto', err);
      return defaultState();
    }
    if (!isPlainObject(parsed)) {
      preserveCorrupt(profileId, raw);
      console.warn('[pulso] estado con forma inválida, se usan los valores por defecto');
      return defaultState();
    }
    const storedSettings = withDefaults(parsed.settings, DEFAULT_SETTINGS);
    const version = typeof parsed.version === 'number' ? parsed.version : 0;
    /* v3: el default viejo de temperatura era 0,7 y Gemini recomienda 1. Solo se
       reescribe ESE valor: si alguien eligió otra cosa a mano, se respeta. */
    const migratedSettings =
      version < 3 && storedSettings.ai.temperature === 0.7
        ? { ...storedSettings, ai: { ...storedSettings.ai, temperature: 1 } }
        : storedSettings;
    /* la key del coach es compartida: si existe, manda sobre la copia del perfil */
    const sharedKey = readSharedApiKey();
    const settings = sharedKey
      ? { ...migratedSettings, ai: { ...migratedSettings.ai, apiKey: sharedKey } }
      : migratedSettings;
    return {
      ...(parsed as AppState),
      version: Math.max(version, STATE_VERSION),
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
      /* migraciones EN MEMORIA (placas pares → unidades, temperatura): aquí NO se
         escribe, así que un arranque no reescribe localStorage; el formato nuevo
         persiste en la primera escritura (lectura-modificación-escritura) o en un
         export */
      settings: { ...settings, plates: normalizePlates(settings.plates) },
      equipment: isPlainObject(parsed.equipment) ? { ...parsed.equipment } : defaultEquipment(),
    };
  } catch (err) {
    console.warn('[pulso] estado ilegible, se usan los valores por defecto', err);
    return defaultState();
  }
}

export function readState(): AppState {
  return readProfileState(activeProfileId.value);
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

/**
 * Copia del estado lista para persistir, con el inventario normalizado: así
 * `discs` nunca queda con valores inválidos, por mucho que se escriba el estado
 * fuera de los setters.
 */
function forStorage(state: AppState): AppState {
  const settings = state.settings as Settings | undefined;
  if (!settings) return state;
  return { ...state, settings: { ...settings, plates: normalizePlates(settings.plates) } };
}

/** Persiste el estado de un perfil concreto y sincroniza la key compartida. */
export function writeProfileState(profileId: string, state: AppState): boolean {
  if (!storageAvailable) return false;
  try {
    localStorage.setItem(stateKeyFor(profileId), JSON.stringify(forStorage(state)));
    writeSharedApiKey(state.settings?.ai?.apiKey ?? '');
    return true;
  } catch (err) {
    console.warn('[pulso] no se pudo guardar el estado', err);
    if (!writeWarned) {
      writeWarned = true;
      toast('No se pudo guardar en localStorage: los datos viven solo en esta pestaña', {
        kind: 'warn',
        ms: 6000,
      });
    }
    return false;
  }
}

export function writeState(state: AppState): boolean {
  return writeProfileState(activeProfileId.value, state);
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

/** Escribe (o borra, con `null`) una clave suelta. Mismo formato que antes. */
export function writeStored(key: string, value: unknown): boolean {
  if (!storageAvailable) return false;
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn('[pulso] no se pudo guardar', key, err);
    return false;
  }
}

/* ---------- semilla personal (solo la primera carga) ---------- */

/**
 * Registro de «ya están sembradas las rutinas personales» (array de ids).
 * MISMO nombre que  (`U.st` de `store.js` prefija `pulso.`), y vive
 * FUERA del estado: si borras todo desde Ajustes no vuelven a aparecer.
 */
export const SEED_KEY = 'pulso.seeded-routines';

/** Registro de «ya apliqué el inventario por defecto » (`store.js:210`). */
export const SETUP_KEY = 'pulso.applied-setup';

/** Id de esa migración (el `SETUP_ID` de `store.js:211`). */
const SETUP_ID = 'inventario-v2';

/**
 * Rutinas personales puntuales. NO son defaults ni plantillas de la app: son
 * rutinas concretas que el usuario pidió dejar cargadas una sola vez. Es el
 * `PERSONAL_ROUTINES` de `store.js:36`, con el MISMO orden y el mismo contenido
 * (series, reps, descansos y notas), pero los `exId` apuntan a la semilla de 24:
 * los ids  (`remo-con-mancuerna-a-una-mano`…) dejaron de existir y un
 * id huerfano se pintaría como «ejercicio desconocido» en la tarjeta.
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
        exId: 'remo-unilateral-kroc-row-con-mancuerna',
        sets: 3,
        repMin: 10,
        repMax: 10,
        rest: 60,
        weight: 17,
        notes:
          'KROC ROW a una mano · 17 kg · 3x10 por lado · descanso 60 s al terminar los dos lados',
      },
      {
        exId: 'press-de-piso-con-mancuernas',
        sets: 3,
        repMin: 10,
        repMax: 10,
        rest: 60,
        weight: 18,
        notes:
          'PRESS DE PISO · 18 kg por mancuerna · pausa de 1 s con los codos tocando el suelo y subida explosiva',
      },
      {
        exId: 'press-militar-sentado-con-mancuernas',
        sets: 3,
        repMin: 8,
        repMax: 8,
        rest: 15,
        weight: 11,
        notes:
          'SUPERSERIE 1 (1/2) · 11 kg por mano x 8 · pasa sin descanso a las elevaciones laterales',
      },
      {
        exId: 'elevaciones-laterales',
        sets: 3,
        repMin: 15,
        repMax: 15,
        rest: 45,
        weight: 4,
        notes: 'SUPERSERIE 1 (2/2) · 4 kg por mano x 15 · descanso 45 s al terminar la superserie',
      },
      {
        exId: 'rompecraneos-en-suelo',
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
        exId: 'encogimientos-shrugs-con-barra',
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
        exId: 'curl-de-muneca-con-mancuerna-unilateral',
        sets: 2,
        repMin: 10,
        repMax: 10,
        rest: 30,
        weight: 11,
        notes:
          'ANTEBRAZOS (1/2) · unilateral 11 kg x 10 por brazo · sin descanso pasa al otro brazo',
      },
      {
        exId: 'curl-de-muneca-invertido-unilateral-con-mancuerna',
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
 *   duplica y NO se toca el calendario (igual que antes, que hacía `return`
 *   antes de agendar);
 * - `schedule[hoy]` solo se rellena si ese día está libre
 *   (`sin routineId, sin plan y sin title`);
 * - NO escribe en disco: eso lo decide `loadInitialState`, para no dejar la
 *   clave de «sembrado» apuntando a un estado que no se llegó a guardar.
 */
function seedPersonalRoutines(state: AppState, profileId: string): SeedResult {
  const stored = readStored<unknown>(seedKeyFor(profileId));
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
 * Registra la migración de inventario  (`applyPersonalSetup`,
 * `store.js:212`) con su MISMA clave y su MISMO id, para que no se vuelva a
 * aplicar desde ninguna de las dos ramas.
 *
 * antes REESCRIBÍA aquí `settings.plates`, `settings.bars` y `equipment` con
 * los valores nuevos por defecto. En v2 esos valores YA son los de
 * `inventario-v2` (`DEFAULT_SETTINGS` y `defaultEquipment()` están portados de
 * `data.js`), así que aplicarlos de nuevo solo pisaría el inventario que ya
 * tienes —el que escriba el onboarding, incluido—: aquí se marca como hecha y
 * no se toca ningún dato.
 *
 * Devuelve `true` si había que escribir la clave.
 */
function applyPersonalSetup(profileId: string): boolean {
  const stored = readStored<unknown>(setupKeyFor(profileId));
  const done: string[] = Array.isArray(stored)
    ? stored.filter((id): id is string => typeof id === 'string')
    : [];
  if (done.includes(SETUP_ID)) return false;
  writeStored(setupKeyFor(profileId), [...done, SETUP_ID]);
  return true;
}

/** Marca un perfil nuevo como ya sembrado: no hereda las rutinas personales. */
function markProfileSeeded(profileId: string): void {
  writeStored(
    seedKeyFor(profileId),
    PERSONAL_ROUTINES.map((routine) => routine.id),
  );
  writeStored(setupKeyFor(profileId), [SETUP_ID]);
}

/**
 * Carga inicial del estado: lo que hacía `S.load()`  (`store.js:136`)
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
  const profileId = activeProfileId.value;
  const state = readState();
  /* migración de la key al almacén compartido (antes vivía dentro del estado) */
  if (!readSharedApiKey() && state.settings.ai.apiKey) {
    writeSharedApiKey(state.settings.ai.apiKey);
  }
  applyPersonalSetup(profileId);
  const seeded = seedPersonalRoutines(state, profileId);
  /* primero el estado y después la clave de guardia: si la escritura falla,
     la próxima carga vuelve a sembrar en vez de perder la rutina */
  const saved = seeded.changed ? writeState(state) : true;
  if (saved && seeded.marked) writeStored(seedKeyFor(profileId), seeded.done);
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
  /* el inventario se normaliza AQUÍ también (no solo al persistir) para que el
     signal y localStorage vean siempre el mismo formato */
  next.plates = normalizePlates(next.plates);
  state.settings = next;
  writeState(state);
  settings.value = next;
  /* el nombre visible del perfil y el saludo son el mismo dato: renombrar uno
     renombra el otro (y viceversa, ver `renameProfile`) */
  if (patch.name !== undefined && next.name.trim()) {
    updateProfileRecord(activeProfileId.value, { name: next.name });
  }
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
 * Semilla de la biblioteca por defecto: los 24 ejercicios curados de
 * `domain/seed.ts`. El catálogo completo de `catalog.ts` (136) ya no se le pone
 * al usuario: sigue ahí para las copias  y para los tests de integridad.
 * `mergeSeed` se aplica SIEMPRE sobre esta lista, no sobre `SEED_EXERCISES`.
 */
const SEED: readonly Exercise[] = seedExercises();

/**
 * Qué se persiste de la biblioteca: los propios, los prohibidos y los que
 * llevan un flag de usuario (★ u oculto). El resto se rederiva de la semilla al
 * arrancar, así que guardarlo solo hincharía el `pulso.state` que comparten
 * v2 y `la versión anterior`.
 *
 * Ojo con los dos flags: sin este filtro una estrella puesta en un ejercicio del
 * catálogo «funcionaría» en pantalla y **desaparecería al recargar**. Los que no
 * están activos se omiten de la fila persistida, así que el formato que lee la
 * antes no cambia (solo se le añaden dos claves opcionales cuando valen `true`).
 */
function persistExercises(next: readonly Exercise[]): void {
  const state = readState();
  state.exercises = next
    .filter((e) => e.custom || e.allowed === false || e.fav === true || e.hidden === true)
    .map((e) => {
      const copy: Exercise = { ...e };
      if (copy.fav !== true) delete copy.fav;
      if (copy.hidden !== true) delete copy.hidden;
      return copy;
    });
  writeState(state);
}

/**
 * Biblioteca ya fusionada con lo guardado (se lee al arrancar, igual que antes).
 * Los ejercicios de biblioteca son la semilla; los del usuario (`custom`), los
 * flags permitido/prohibido y los flags de usuario (★ / oculto) vienen del
 * estado y se conservan.
 */
export const exercises = signal<Exercise[]>(mergeSeed(SEED, initial.exercises));

export function findExercise(id: string): Exercise | null {
  return exercises.value.find((e) => e.id === id) ?? null;
}

export function setExerciseAllowed(id: string, allowed: boolean): void {
  const next = exercises.value.map((e) => (e.id === id ? { ...e, allowed } : e));
  persistExercises(next);
  exercises.value = next;
}

/* ---------- ajustes anidados ---------- */

/**
 * Ajusta una ruta de ajustes (`bars.olimpica`, `ai.temperature`).  esto
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

/** Cambia un campo del inventario de discos (`w`, `unit`, `discs`). */
export function updatePlate(index: number, patch: Partial<PlateStock>): void {
  const plates = normalizePlates(settings.value.plates).map((p, i) =>
    i === index ? { ...p, ...patch } : p,
  );
  patchSettings({ plates });
}

export function addPlate(
  plate: PlateStock = { w: 1.25, unit: 'kg', discs: 2, on: true },
): void {
  patchSettings({ plates: normalizePlates([...normalizePlates(settings.value.plates), plate]) });
}

export function removePlate(index: number): void {
  patchSettings({ plates: normalizePlates(settings.value.plates).filter((_, i) => i !== index) });
}

export function togglePlate(index: number): void {
  const plates = normalizePlates(settings.value.plates);
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
 * Normaliza los items como hacía `S.addRoutine`: números con su valor por
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
      sets: Math.max(1, int(raw.sets, 3)),
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
 * en `localStorage`, nunca del signal, porque antes puede estar escribiendo el mismo
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
 * referencia (`schedule[día].routineId`). Devuelve `null` si no existe, como antes.
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
 * `routineId` (antes borraba ese campo, no el día entero).
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
 * tal cual `S.duplicateRoutine`  (`store.js:357`).
 *
 * Los items pasan por `normalizeRoutineItems` (lo mismo que `addRoutine`) y el
 * resto se clona en profundidad: la copia NO puede compartir objetos con el
 * original, o editar una rutina modificaría también la otra. Devuelve `null`
 * si no existe, como antes.
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
 * Lo que antes guarda en `state.meta` (¿quién vio el onboarding?, cuándo pidió el
 * coach un plan por última vez…). Mismas claves que `store.js` de `main`.
 */
export const DEFAULT_META = { onboarded: false, lastPlanAt: null, lastAiAt: null };

/** `state.meta`, reactivo. Las claves desconocidas se conservan (mismo merge que antes). */
export const meta = signal<Record<string, unknown>>(withDefaults(initial.meta, DEFAULT_META));

/** Mezcla claves en `state.meta` (lo que hacía `S.setMeta` ). */
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

/** Apunta un día (es lo que hacía `S.setDay` ). */
export function setDay(iso: string, patch: Partial<ScheduleDay>): void {
  const next = { ...schedule.value, [iso]: { ...(schedule.value[iso] ?? {}), ...patch } };
  const state = readState();
  state.schedule = next;
  writeState(state);
  schedule.value = next;
}

/**
 * Borra un día del calendario entero: es `S.clearDay`  (`store.js:402`).
 *
 * NO se cubre con `setDay(iso, { …: undefined })`: el merge de `setDay` deja la
 * clave en el mapa (un `{}` que además se persiste), mientras que antes hacía
 * `delete state.schedule[iso]` y `S.getDay(iso)` devolvía `null`.
 *
 * Ojo, es distinto del `clearDayPatch` del Calendario, que vacía la
 * planificación PERO conserva `sessionId` (el enlace a la sesión registrada);
 * este setter borra el día completo, como antes.
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
  persistExercises(next);
  exercises.value = next;
}

/**
 * Marca o desmarca flags de usuario (★ / oculto) en varios ejercicios de una
 * escritura: es lo que usan las acciones en bloque y el atajo «★ Los de mis
 * récords» de Ajustes → Ejercicios.
 *
 * `patch` solo puede tocar `fav` y `hidden`: las claves que no vienen NO se
 * tocan (un «Quitar ★» no debe bajar el oculto de nadie), y las que vienen se
 * normalizan a `=== true`, que es lo único que se persiste.
 */
export function bulkSetExerciseFlag(
  ids: readonly string[],
  patch: Partial<Pick<Exercise, 'fav' | 'hidden'>>,
): void {
  if (!('fav' in patch) && !('hidden' in patch)) return;
  const wanted = new Set(ids);
  const next = exercises.value.map((e) => {
    if (!wanted.has(e.id)) return e;
    const copy: Exercise = { ...e };
    if ('fav' in patch) copy.fav = patch.fav === true;
    if ('hidden' in patch) copy.hidden = patch.hidden === true;
    return copy;
  });
  persistExercises(next);
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
  persistExercises(next);
  exercises.value = next;
  return saved;
}

/**
 * Borra un ejercicio. Los de la biblioteca NO se borran (la semilla los
 * reharía en `refresh`): se devuelven `false`, como, y el aviso lo
 * pinta la UI.
 */
export function removeExercise(id: string): boolean {
  const current = exercises.value.find((e) => e.id === id);
  if (!current || !current.custom) return false;
  const next = exercises.value.filter((e) => e.id !== id);
  persistExercises(next);
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
 * Callbacks que se ejecutan cuando `resetAll` o `importState` reemplazan el estado.
 * Sirven para limpiar lo que vive fuera de `pulso.state` (descanso, chat…).
 */
const stateReplacedHooks: (() => void)[] = [];

/** Registra un callback para cuando se reemplaza el estado entero. */
export function onStateReplaced(fn: () => void): void {
  stateReplacedHooks.push(fn);
}

function runStateReplacedHooks(): void {
  for (const fn of stateReplacedHooks) {
    try {
      fn();
    } catch (err) {
      console.warn('[pulso] fallo al limpiar tras reemplazar el estado', err);
    }
  }
}

/** Deja el inventario solo con las claves conocidas (las demás se descartan). */
function normalizeEquipment(value: unknown): EquipmentMap {
  const base = defaultEquipment();
  if (!isPlainObject(value)) return base;
  const out: EquipmentMap = { ...base };
  for (const key of Object.keys(out)) {
    if (typeof value[key] === 'boolean') out[key] = value[key];
  }
  return out;
}

/**
 * Reemplaza el estado entero (importación). Se conserva tal cual lo que traiga el
 * archivo, porque el formato es el mismo: importar una copia hecha en
 * `main` tiene que dejar los datos igual que allí. Única excepción:
 * `meta.onboarded = true` (lo que hacía antes, `store.js:197`) y el inventario
 * de discos, que se migra a unidades (`discs`) antes de persistirlo.
 *
 * Los ajustes se completan con `withDefaults` y el material se filtra contra las
 * claves conocidas. Si la copia trae la key del coach vacía se conserva la actual:
 * los backups la exportan redactada (A2) y no deben borrar la del usuario.
 */
export function importState(raw: unknown): AppState {
  if (!looksLikeState(raw)) throw new Error('El archivo no parece una copia de Pulso');
  const incoming = raw as AppState;
  const currentKey = readState().settings.ai.apiKey;
  const merged = withDefaults(incoming.settings, DEFAULT_SETTINGS);
  const incomingKey = typeof merged.ai.apiKey === 'string' ? merged.ai.apiKey.trim() : '';
  /* el inventario de la copia se normaliza ANTES de persistir: las filas
     ilegibles se descartan y `discs` queda entero y sin negativos */
  const settings: Settings = {
    ...merged,
    ai: { ...merged.ai, apiKey: incomingKey || currentKey },
    plates: normalizePlates(merged.plates),
  };
  const next: AppState = {
    ...incoming,
    settings,
    equipment: normalizeEquipment(incoming.equipment),
    version: STATE_VERSION,
    createdAt:
      typeof incoming.createdAt === 'string' ? incoming.createdAt : new Date().toISOString(),
    /* igual que `S.importJSON` (store.js:197): importar una copia cuenta como
       onboarding visto; las claves desconocidas de `meta` se conservan */
    meta: { ...(isPlainObject(incoming.meta) ? incoming.meta : {}), onboarded: true },
  };
  writeState(next);
  refresh();
  if (next.settings.name.trim()) {
    updateProfileRecord(activeProfileId.value, { name: next.settings.name });
  }
  runStateReplacedHooks();
  return readState();
}

/** Opciones de `exportState`: por defecto la key del coach NO viaja en la copia. */
export interface ExportOptions {
  /** Incluye `settings.ai.apiKey` tal cual (solo si el usuario lo pide). */
  includeApiKey?: boolean;
}

/**
 * Copia para backup: igual que el estado guardado, pero sin la key del coach
 * salvo que se pida explícitamente (`includeApiKey`). La key es un secreto y un
 * backup se comparte/exporta con facilidad; el import conserva la actual si la
 * copia viene redactada.
 */
export function exportState(opts: ExportOptions = {}): AppState {
  return exportStateFor(activeProfileId.value, opts);
}

function exportStateFor(profileId: string, opts: ExportOptions): AppState {
  const state = readProfileState(profileId);
  if (opts.includeApiKey) return state;
  return {
    ...state,
    settings: {
      ...state.settings,
      ai: { ...state.settings.ai, apiKey: '' },
    },
  };
}

/* ---------- perfiles ---------- */

/** Perfil nuevo: datos por defecto, sin sesiones ni rutinas heredadas. */
export function createProfile(name: string): Profile | null {
  const profile = addProfileRecord(name);
  if (!profile) return null;
  const state = defaultState();
  state.settings.name = profile.name;
  state.settings.ai.apiKey = readSharedApiKey();
  state.meta = { onboarded: true };
  writeProfileState(profile.id, state);
  markProfileSeeded(profile.id);
  return profile;
}

/** Cambia el perfil activo. La UI recarga para reinicializar los signals. */
export function switchProfile(id: string): boolean {
  return setActiveProfileId(id);
}

/** Renombra un perfil; si es el activo, actualiza también sus ajustes. */
export function renameProfile(id: string, name: string): boolean {
  const updated = updateProfileRecord(id, { name });
  if (!updated) return false;
  if (id === activeProfileId.value) {
    const state = readState();
    state.settings.name = updated.name;
    writeState(state);
    settings.value = { ...settings.value, name: updated.name };
  } else {
    const state = readProfileState(id);
    state.settings.name = updated.name;
    writeProfileState(id, state);
  }
  return true;
}

export interface DeleteProfileResult {
  ok: boolean;
  wasActive: boolean;
  nextId: string;
}

/** Borra del almacenamiento todo lo que pertenece a un perfil (no toca el índice). */
function removeStoredProfile(id: string): void {
  if (!storageAvailable) return;
  for (const key of dataKeysFor(id)) localStorage.removeItem(key);
  const prefix = corruptPrefixFor(id);
  const corrupt: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) corrupt.push(key);
  }
  for (const key of corrupt) localStorage.removeItem(key);
}

/**
 * Borra un perfil y sus datos. Nunca deja la lista vacía. Si era el activo,
 * `store` cambia al primero que quede y la UI recarga.
 */
export function deleteProfile(id: string): DeleteProfileResult {
  const wasActive = id === activeProfileId.value;
  if (!removeProfileRecord(id)) {
    return { ok: false, wasActive, nextId: activeProfileId.value };
  }
  removeStoredProfile(id);
  return { ok: true, wasActive, nextId: activeProfileId.value };
}

/** Número de sesiones guardadas de un perfil (para la gestión de Ajustes). */
export function profileSessionCount(id: string): number {
  return asSessions(readProfileState(id).sessions).length;
}

/** Marca como usado el perfil indicado (la hoja lo hace al cambiar). */
export function touchProfileNow(id: string): void {
  touchProfile(id);
}

/* ---------- backup de todos los perfiles ---------- */

export interface ProfilesBackup {
  kind: 'pulso-profiles';
  version: 1;
  exportedAt: string;
  active: string;
  profiles: { profile: Profile; state: AppState }[];
}

export function isProfilesBackup(value: unknown): value is ProfilesBackup {
  return (
    isPlainObject(value) &&
    value.kind === 'pulso-profiles' &&
    Array.isArray(value.profiles) &&
    value.profiles.length > 0
  );
}

export function exportAllProfiles(opts: ExportOptions = {}): ProfilesBackup {
  return {
    kind: 'pulso-profiles',
    version: 1,
    exportedAt: new Date().toISOString(),
    active: activeProfileId.value,
    profiles: profiles.value.map((profile) => ({
      profile,
      state: exportStateFor(profile.id, opts),
    })),
  };
}

/**
 * Restaura un backup con todos los perfiles. Reemplaza el índice y los estados
 * de los perfiles incluidos; la UI recarga después para reinicializar signals.
 */
export function importProfilesBackup(raw: unknown): number {
  if (!isProfilesBackup(raw)) throw new Error('El archivo no es un backup de perfiles');
  const entries: { profile: Profile; state: AppState }[] = [];
  for (const entry of raw.profiles.slice(0, MAX_PROFILES)) {
    if (!isPlainObject(entry)) continue;
    const profile = entry.profile;
    const state = entry.state;
    if (
      !isPlainObject(profile) ||
      typeof profile.id !== 'string' ||
      typeof profile.name !== 'string'
    ) {
      continue;
    }
    if (!looksLikeState(state)) continue;
    entries.push({
      profile: {
        id: profile.id,
        name: profile.name.trim() || 'Perfil',
        color: typeof profile.color === 'string' ? profile.color : '#c8ff2e',
        createdAt:
          typeof profile.createdAt === 'string' ? profile.createdAt : new Date().toISOString(),
        lastUsedAt:
          typeof profile.lastUsedAt === 'string' ? profile.lastUsedAt : new Date().toISOString(),
      },
      state,
    });
  }
  if (!entries.length) throw new Error('El backup no trae perfiles válidos');
  const shared =
    entries
      .map((entry) => entry.state.settings?.ai?.apiKey ?? '')
      .find((key) => key.trim().length > 0) ?? readSharedApiKey();
  const previousIds = profiles.value.map((profile) => profile.id);
  for (const { profile, state } of entries) {
    const next: AppState = {
      ...state,
      settings: {
        ...withDefaults(state.settings, DEFAULT_SETTINGS),
        ai: { ...withDefaults(state.settings?.ai, DEFAULT_SETTINGS.ai), apiKey: shared },
        plates: normalizePlates(state.settings?.plates),
      },
      equipment: normalizeEquipment(state.equipment),
      version: STATE_VERSION,
      meta: { ...(isPlainObject(state.meta) ? state.meta : {}), onboarded: true },
    };
    writeProfileState(profile.id, next);
    markProfileSeeded(profile.id);
  }
  replaceProfiles(entries.map((entry) => entry.profile));
  /* el backup «de todos» reemplaza la lista: los perfiles que ya no están se
     borran también del almacenamiento para no dejar datos huérfanos ocupando cuota */
  const importedIds = new Set(entries.map((entry) => entry.profile.id));
  for (const id of previousIds) {
    if (!importedIds.has(id)) removeStoredProfile(id);
  }
  const active = entries.some((entry) => entry.profile.id === raw.active)
    ? raw.active
    : (entries[0]?.profile.id ?? activeProfileId.value);
  setActiveProfileId(active);
  return entries.length;
}

/**
 * Borra SOLO los datos del perfil activo y vuelve a su estado inicial.
 * No toca el índice de perfiles, la API key compartida ni los demás perfiles.
 * Tampoco borra las claves de «ya sembrado» de este perfil, igual que antes: si
 * se borrara todo, el inventario personalizado y las rutinas personales
 * volverían a aparecer después de un «Borrar todo».
 */
export function resetAll(): void {
  if (storageAvailable) {
    const profileId = activeProfileId.value;
    const keys = new Set<string>([stateKeyFor(profileId), restKeyFor(profileId)]);
    const prefix = corruptPrefixFor(profileId);
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) keys.add(key);
    }
    for (const key of keys) localStorage.removeItem(key);
    /* el perfil conserva su nombre; el estado vuelve a los valores por defecto */
    const fresh = defaultState();
    const name = activeProfile.value?.name;
    if (name) fresh.settings.name = name;
    writeState(fresh);
  }
  refresh();
  runStateReplacedHooks();
}

/** Relee el estado de `localStorage` y refresca todos los signals. */
export function refresh(): void {
  const next = readState();
  settings.value = next.settings;
  equipment.value = (next.equipment as EquipmentMap | undefined) ?? defaultEquipment();
  exercises.value = mergeSeed(SEED, next.exercises);
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
 * antes ya era tolerante al leer el JSON, pero no validaba cada sesión.
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
 * mano o a medias no debe colarse en la UI (misma tolerancia que antes al leerlo).
 */
function asActive(value: unknown): ActiveSession | null {
  return isPlainObject(value) && Array.isArray(value.entries)
    ? (value as unknown as ActiveSession)
    : null;
}

/** Guarda la sesión en curso (`pulso.state.active`), tal cual la lee antes. */
export function writeActive(next: ActiveSession | null): boolean {
  const state = readState();
  state.active = next;
  const saved = writeState(state);
  active.value = next;
  return saved;
}

/**
 * Apila una sesión terminada y marca el día como hecho: es lo que hacían juntos
 * `S.addSession` + `S.setDay(iso, {status:'done'})`, así que el calendario
 * de la rama `main` ve el día igual que si lo hubieras entrenado allí.
 */
/** Misma ordenación que antes: `startedAt` descendente y empate resuelto por `id`. */
function byStartedAtDesc(a: Session, b: Session): number {
  const sa = a.startedAt ?? '';
  const sb = b.startedAt ?? '';
  if (sa < sb) return 1;
  if (sa > sb) return -1;
  const ia = a.id ?? '';
  const ib = b.id ?? '';
  if (ia < ib) return -1;
  if (ia > ib) return 1;
  return 0;
}

export function commitSession(session: Session): boolean {
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
  if (!writeState(state)) return false;
  sessions.value = all;
  schedule.value = plan;
  active.value = null;
  return true;
}

/**
 * Edita una sesión guardada (nombre, notas, fecha, RPE…): es `S.updateSession`
 *  (`store.js:376`), que aplicaba el parche tal cual sobre la sesión
 * encontrada. Devuelve `null` si no existe, como allí.
 *
 * - El `id` NO se puede cambiar (igual que en `updateRoutine`): el calendario
 *   lo referencia con `schedule[día].sessionId`.
 * - Como antes, NO reordena por `startedAt`: el orden solo lo fija `addSession`
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
 * Borra una sesión guardada (`S.removeSession`, `store.js:383`).
 *
 * antes NO tocaba el calendario, y aquí se hereda tal cual: el día se queda con
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
 * Crea `weeks` semanas de sesiones de ejemplo (8, como antes) para ver las
 * gráficas con contenido. Van al MISMO array que las reales —la analítica no
 * las filtra, igual que — y no se deduplican: dos clics = doble sesión.
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
 * mensajes con la MISMA forma que antes (`{role, text, ts, thoughts?, notes?}`),
 * así que exportar los datos o volver a la rama `main` conserva la
 * conversación — una clave suelta tipo `pulso.chat` se quedaría fuera de
 * `pulso.state` y no sobreviviría a un import.
 *
 * Solo guarda: la signal que repinta la vista vive en `state/chat.ts` (nada de
 * UI aquí), y la escritura usa el mismo read-modify-write que el resto de
 * setters (se parte SIEMPRE de lo que hay en `localStorage`, por si antes está
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
