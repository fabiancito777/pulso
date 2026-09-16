/** kg ↔ lb y redondeos de peso. Portado de `U.units` de la v1. */
import { num } from './num';
import type { Unit } from './types';

export const KG_PER_LB = 0.45359237;

export const toKg = (v: unknown, unit: Unit): number =>
  unit === 'lb' ? num(v) * KG_PER_LB : num(v);

export const fromKg = (kg: unknown, unit: Unit): number =>
  unit === 'lb' ? num(kg) / KG_PER_LB : num(kg);

export const unitLabel = (unit: Unit): string => (unit === 'lb' ? 'lb' : 'kg');

/** Salto de los botones ± del peso objetivo. */
export const unitIncrement = (unit: Unit): number => (unit === 'lb' ? 5 : 2.5);

/** Redondeo al disco/plato más cercano de esa unidad. */
export function roundToStep(v: unknown, unit: Unit): number {
  const step = unit === 'lb' ? 2.5 : 1.25;
  return Math.round(num(v) / step) * step;
}

export function prettyWeight(v: unknown, unit: Unit): string {
  const value = Math.round((num(v) + Number.EPSILON) * 100) / 100;
  return `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(value)} ${unitLabel(unit)}`;
}
