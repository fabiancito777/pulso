/**
 * Visibilidad y orden del picker de ejercicios, en dominio puro.
 *
 * Estaban dentro de `ExercisePickerModal`, que repinta a cada tecla: sacarlos
 * aquí permite fijar dos decisiones con tests y sin montar el modal (spec
 * `ejercicios-revamp.md` §3.2 y §5):
 *
 * - **ocultos fuera**: `hidden` es solo presentación, el picker no los lista;
 * - **solo disponibles por defecto**: el picker de la v1 listaba los 136 del
 *   catálogo con su «falta …»; ahora la lista por defecto es la que puedes hacer
 *   (el toggle del modal la puede abrir);
 * - **orden**: ★ → permitido y disponible → familiaridad → nombre. Los ★ van
 *   ANTES que el material a propósito: es lo que pedía el usuario («sus
 *   ejercicios los principales») y el material ya no pinta si el filtro de
 *   disponibles está activo.
 */
import { isAvailable } from '@/domain/data';
import type { EquipmentMap } from '@/domain/data';
import type { Exercise } from '@/domain/types';

/** Lo que hace falta para decidir qué se muestra en el picker. */
export interface PickerFilterOptions {
  /** material activo: sin él no se calcula «solo disponibles» */
  equip?: EquipmentMap;
  /** solo los permitidos y con material (por defecto `true`, como en la UI) */
  availableOnly?: boolean;
  /** `exId` que no se pueden elegir (los que ya están en la sesión) */
  exclude?: readonly string[];
  /** si se pasa, SOLO se pueden elegir estos (picker de «Otro» de Progresión) */
  onlyIds?: readonly string[];
}

/** Cómo se ordena lo que queda visible. */
export interface PickerOrderOptions {
  /** cuántas sesiones del historial traen cada ejercicio (familiaridad) */
  fam?: ReadonlyMap<string, number>;
  /** material activo: si falta, no se desempata por disponibilidad */
  equip?: EquipmentMap;
  /** ids marcados como ★; si falta, se leen de `ex.fav` */
  fav?: ReadonlySet<string>;
}

/**
 * Qué se muestra: ocultos fuera, después los filtros que ya tenía el modal
 * (`exclude`/`onlyIds`) y por último «solo disponibles», que es el nuevo
 * comportamiento por defecto.
 */
export function visiblePickerItems(
  items: readonly Exercise[],
  opts: PickerFilterOptions = {},
): Exercise[] {
  const skip = new Set(opts.exclude ?? []);
  const only = opts.onlyIds ? new Set(opts.onlyIds) : null;
  const wantAvailable = opts.availableOnly !== false;
  const equip = opts.equip ?? {};
  return items.filter((ex) => {
    if (ex.hidden === true) return false;
    if (skip.has(ex.id)) return false;
    if (only && !only.has(ex.id)) return false;
    if (wantAvailable && !(ex.allowed && isAvailable(ex, equip))) return false;
    return true;
  });
}

/**
 * ★ primero → permitido y disponible → familiaridad (de más a menos) → nombre.
 * Devuelve una lista NUEVA (el array de entrada no se toca); el desempate final
 * es el nombre, así que dos listas con los mismos datos siempre salen en el
 * mismo orden entre repintados.
 */
export function orderPickerItems(
  items: readonly Exercise[],
  opts: PickerOrderOptions = {},
): Exercise[] {
  const equip = opts.equip;
  const fam = opts.fam;
  const fav = opts.fav;
  const isFav = (ex: Exercise): boolean => (fav ? fav.has(ex.id) : ex.fav === true);
  const rank = (ex: Exercise): number => (equip && !(ex.allowed && isAvailable(ex, equip)) ? 1 : 0);

  return [...items].sort((a, b) => {
    const favA = isFav(a) ? 0 : 1;
    const favB = isFav(b) ? 0 : 1;
    if (favA !== favB) return favA - favB;
    const rankA = rank(a);
    const rankB = rank(b);
    if (rankA !== rankB) return rankA - rankB;
    const famA = fam?.get(a.id) ?? 0;
    const famB = fam?.get(b.id) ?? 0;
    if (famA !== famB) return famB - famA;
    if (a.name === b.name) return 0;
    return a.name < b.name ? -1 : 1;
  });
}
