/**
 * Catálogo: API pública del dominio para grupos, material, ejercicios y
 * plantillas. Los datos en sí están en `catalog.ts` (generado desde la v1) y
 * aquí viven las funciones que los consultan.
 *
 * Igual que en `plates.ts`, todo entra por parámetro: el material disponible se
 * pasa como mapa (`{ clave: boolean }`) en vez de leerlo del estado global, que
 * es lo que hacía `S.isAvailable()` en la v1 y obligaba a probarlo en el navegador.
 */
import {
  DEFAULT_EQUIPMENT,
  EQUIPMENT,
  EQUIP_PRESETS,
  GOALS,
  GROUPS,
  SEED_EXERCISES,
} from './catalog';
import { norm, slug } from './text';
import type { Exercise, ExerciseType } from './types';

export * from './catalog';

export type EquipmentMap = Record<string, boolean>;

/* ---------- grupos musculares ---------- */

export function groupLabel(key: string): string {
  return GROUPS.find((g) => g.key === key)?.label ?? key;
}

export function groupColor(key: string): string {
  return GROUPS.find((g) => g.key === key)?.color ?? '#8e8e8e';
}

/* ---------- material ---------- */

export const equipmentKeys: readonly string[] = EQUIPMENT.map((e) => e.key);

export function equipLabel(key: string): string {
  return EQUIPMENT.find((e) => e.key === key)?.label ?? key;
}

export function equipCats(): string[] {
  const out: string[] = [];
  for (const item of EQUIPMENT) if (!out.includes(item.cat)) out.push(item.cat);
  return out;
}

export function enabledEquipment(equipment: EquipmentMap): string[] {
  return Object.keys(equipment).filter((k) => equipment[k]);
}

/** Mapa de material que viene activo de fábrica (mancuernas ajustables, discos, barra…). */
export function defaultEquipment(): EquipmentMap {
  const out: EquipmentMap = {};
  for (const key of equipmentKeys) out[key] = DEFAULT_EQUIPMENT[key] === true;
  return out;
}

export type EquipPresetKind = 'todo' | 'gym' | 'kit' | 'basico' | 'ninguno';

/**
 * Presets que NO salen del catálogo de la v1. Viven aquí y no en `catalog.ts`
 * porque ese fichero es generado (`node tools/port-catalog.mjs`) y regenerarlo
 * los borraría (AGENTS.md §4).
 *
 * `kit` es el «material real» de quien entrena en casa sin banco: mancuernas
 * ajustables (montadas como barra larga) y fijas, barra cargable, barra de
 * dominadas, discos y esterilla — sin banco y sin máquina.
 */
export const EQUIP_USER_PRESETS: Record<string, readonly string[]> = {
  kit: [
    'banco_dominadas',
    'mancuernas_ajustables',
    'mancuernas_fijas',
    'discos',
    'barra_olimpica',
    'colchoneta',
  ],
};

/** Una opción de material para los chips de Ajustes y los pills del onboarding. */
export interface EquipPresetOption {
  key: string;
  /** etiqueta corta (chips de Ajustes → Equipo) */
  label: string;
  /** etiqueta explicativa (pills de la primera visita) */
  fullLabel: string;
}

/**
 * Los presets que se ofrecen, en el orden en que se muestran. Ajustes y
 * Onboarding iteran ESTA lista, así que añadir un preset es tocar un solo sitio.
 */
export const EQUIP_PRESET_LIST: readonly EquipPresetOption[] = [
  { key: 'basico', label: 'Casa básica', fullLabel: 'Mancuernas + banco' },
  { key: 'kit', label: 'Mi kit', fullLabel: 'Mancuernas + barra (sin banco)' },
  { key: 'gym', label: 'Gym completo', fullLabel: 'Gimnasio completo' },
  { key: 'todo', label: 'Todo', fullLabel: 'Todo el catálogo' },
  { key: 'ninguno', label: 'Solo peso corporal', fullLabel: 'Solo peso corporal' },
];

/** Los mismos presets, listos para pintar (chips de Ajustes y pills del onboarding). */
export function equipPresetList(): readonly EquipPresetOption[] {
  return EQUIP_PRESET_LIST;
}

/**
 * Material que activa cada preset (fuente única para onboarding y Ajustes).
 * `gym` = todo el catálogo menos las piezas excluidas; `kit` = los manuales de
 * arriba; el resto son listas. Un preset desconocido cae en `basico`, igual que
 * en la v1 (lo fija `data.test.ts`).
 */
export function equipPreset(kind: string): EquipmentMap {
  const all: EquipmentMap = {};
  for (const key of equipmentKeys) all[key] = false;

  if (kind === 'todo') {
    for (const key of equipmentKeys) all[key] = true;
    return all;
  }
  if (kind === 'gym') {
    const excluded = new Set(EQUIP_PRESETS.gymExclude ?? []);
    for (const key of equipmentKeys) all[key] = !excluded.has(key);
    return all;
  }
  const keys = EQUIP_USER_PRESETS[kind] ?? EQUIP_PRESETS[kind] ?? EQUIP_PRESETS.basico ?? [];
  for (const key of keys) if (key in all) all[key] = true;
  return all;
}

/* ---------- disponibilidad de un ejercicio ---------- */

export type EquipSource = Pick<Exercise, 'equip'>;

/**
 * `equip` se escribe `'a&b|c'`: exige `a` **y** (`b` **o** `c`). El material se
 * mira grupo a grupo, así que "barra O trap bar" se cumple con cualquiera de las dos.
 */
function equipGroups(equip: string | undefined): string[][] {
  const raw = String(equip ?? '');
  if (!raw) return [];
  return raw.split('&').map((group) => group.split('|'));
}

export function isAvailable(ex: EquipSource, equipment: EquipmentMap): boolean {
  const groups = equipGroups(ex?.equip);
  if (!groups.length) return true;
  return groups.every((group) => group.some((key) => !key || equipment[key] === true));
}

/** Etiquetas de lo que falta por grupo (vacío = se puede hacer). */
export function missingEquipment(ex: EquipSource, equipment: EquipmentMap): string[] {
  const missing: string[] = [];
  for (const group of equipGroups(ex?.equip)) {
    if (group.some((key) => !key || equipment[key] === true)) continue;
    for (const key of group) if (key) missing.push(equipLabel(key));
  }
  return missing;
}

/** El material en palabras: `['Barra cargable', 'Banco plano o banco inclinable']`. */
export function equipTags(ex: EquipSource): string[] {
  const groups = equipGroups(ex?.equip);
  if (!groups.length) return ['peso corporal'];
  return groups.map((group) => group.map(equipLabel).join(' o '));
}

/* ---------- búsquedas ---------- */

export function findExercise(exercises: readonly Exercise[], id: string): Exercise | null {
  return exercises.find((e) => e.id === id) ?? null;
}

export function allowedExercises(exercises: readonly Exercise[]): Exercise[] {
  return exercises.filter((e) => e.allowed);
}

/**
 * Busca por nombre, sin acentos y sin mayúsculas. Lo necesitan los planes del
 * coach IA, que a veces traen el nombre en vez del id.
 * El id de la biblioteca es el slug del nombre (y los ejercicios propios también,
 * ver `S.addExercise` de la v1), así que primero se prueba el atajo; el recorrido
 * por nombre se queda por si el slug chocó con otro ejercicio y llevó un `uid`.
 */
export function findExerciseByName(
  exercises: readonly Exercise[],
  name?: string | null,
): Exercise | null {
  if (!name) return null;
  const bySlug = findExercise(exercises, slug(name));
  if (bySlug) return bySlug;
  const target = norm(name);
  return exercises.find((e) => norm(e.name) === target) ?? null;
}

/** Objetivos y niveles: etiqueta legible con caída a la clave. */
export function goalLabel(key: string): string {
  return GOALS.find((g) => g.key === key)?.label ?? key;
}

export const EXERCISE_TYPES: readonly ExerciseType[] = [
  'compuesto',
  'aislado',
  'cardio',
  'movilidad',
];

/* ---------- semilla manual: lo que la v1 no tenía ---------- */

/**
 * Mismo patrón que el `E()` de `catalog.ts` (que no está exportado, porque ese
 * fichero lo genera `tools/port-catalog.mjs`): un ejercicio de semilla con id
 * derivado del nombre.
 */
function E(
  name: string,
  group: string,
  equip: string,
  type: ExerciseType,
  sets: number,
  repMin: number,
  repMax: number,
  rest: number,
  tips = '',
): Exercise {
  return {
    id: slug(name),
    name,
    group,
    equip: equip || '',
    type,
    sets,
    repMin,
    repMax,
    rest,
    allowed: true,
    custom: false,
    bw: false,
    tags: [],
    tips,
  };
}

/**
 * Ejercicios que faltan en la biblioteca de la v1 y se declaran AQUÍ, a mano
 * (lo generado vive en `catalog.ts` y regenerarlo los borraría).
 *
 * Son tres variantes «en suelo» de los típicos de quien entrena sin banco: el
 * material es solo mancuerna (sin `banco_*`, que es lo que les bloqueaba) y los
 * rangos son los mismos que sus primos de banco en el catálogo.
 */
export const USER_SEED_EXERCISES: readonly Exercise[] = [
  E(
    'Press de Piso con Mancuernas',
    'pecho',
    'mancuernas_fijas|mancuernas_ajustables',
    'compuesto',
    3,
    6,
    10,
    120,
    'Espalda baja apoyada y codos rozando el suelo: baja controlado y sube sin rebote.',
  ),
  E(
    'Floor Press',
    'pecho',
    'mancuernas_fijas|mancuernas_ajustables',
    'compuesto',
    3,
    6,
    10,
    120,
    'Press de pecho desde el suelo: el recorrido corta en los codos apoyados.',
  ),
  E(
    'Rompecráneos en Suelo',
    'triceps',
    'mancuernas_fijas|mancuernas_ajustables',
    'aislado',
    3,
    8,
    12,
    60,
    'Tumbado en el suelo, extiende la mancuerna sin mover los codos.',
  ),
];

/**
 * Semilla COMPLETA de la biblioteca: el catálogo generado + los declarados a
 * mano arriba. Es lo que fusiona `state/store.ts` con lo guardado, así que un
 * ejercicio nuevo se puede añadir aquí sin regenerar nada.
 */
export function seedExercises(): Exercise[] {
  return [...SEED_EXERCISES, ...USER_SEED_EXERCISES];
}
