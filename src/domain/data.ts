/**
 * Catálogo: API pública del dominio para grupos, material, ejercicios y
 * plantillas. Los datos en sí viven en dos sitios: `catalog.ts` (el catálogo
 * COMPLETO, generado desde la v1) y `seed.ts` (la semilla por defecto de 24
 * ejercicios y 7 plantillas, que es lo que de verdad se le pone a un usuario
 * nuevo). Aquí viven las funciones que los consultan.
 *
 * `TEMPLATES` y `seedExercises` se vuelven a exportar DESPUÉS del
 * `export * from './catalog'`: son los que manda la app, y si se importaran de
 * `@/domain/catalog` se quedarían con las 9 plantillas y los 136 ejercicios de
 * la v1.
 *
 * Igual que en `plates.ts`, todo entra por parámetro: el material disponible se
 * pasa como mapa (`{ clave: boolean }`) en vez de leerlo del estado global, que
 * es lo que hacía `S.isAvailable()` en la v1 y obligaba a probarlo en el navegador.
 */
import { DEFAULT_EQUIPMENT, EQUIPMENT, EQUIP_PRESETS, GOALS, GROUPS } from './catalog';
import { norm, slug } from './text';
import type { Exercise, ExerciseType } from './types';

export * from './catalog';
export { TEMPLATES, seedExercises } from './seed';

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
