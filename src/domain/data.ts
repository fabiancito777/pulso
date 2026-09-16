/**
 * Catálogo: API pública del dominio para grupos, material, ejercicios y
 * plantillas. Los datos en sí están en `catalog.ts` (generado desde la v1) y
 * aquí viven las funciones que los consultan.
 *
 * Igual que en `plates.ts`, todo entra por parámetro: el material disponible se
 * pasa como mapa (`{ clave: boolean }`) en vez de leerlo del estado global, que
 * es lo que hacía `S.isAvailable()` en la v1 y obligaba a probarlo en el navegador.
 */
import { DEFAULT_EQUIPMENT, EQUIPMENT, EQUIP_PRESETS, GOALS, GROUPS } from './catalog';
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

export type EquipPresetKind = 'todo' | 'gym' | 'basico' | 'ninguno';

/**
 * Material que activa cada preset (fuente única para onboarding y Ajustes).
 * `gym` = todo el catálogo menos las piezas excluidas; el resto son listas.
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
  const keys = EQUIP_PRESETS[kind] ?? EQUIP_PRESETS.basico ?? [];
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
