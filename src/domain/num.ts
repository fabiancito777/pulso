/**
 * Helpers numéricos. Portado de la v1 (`legacy/js/core.js`, `U.num`, `U.int`,
 * `U.round`…) pero con nombres propios y tipos: en v2 no hay un cajón único.
 */

/** Convierte a número y cae a `def` si no es finito. */
export function num(v: unknown, def = 0): number {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : def;
}

export function int(v: unknown, def = 0): number {
  const n = typeof v === 'number' ? Math.trunc(v) : Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : def;
}

/** Redondeo con el epsilon de la v1: evita 2.4999999 → 2,4. */
export function round(v: unknown, dec = 1): number {
  const f = 10 ** dec;
  return Math.round((num(v) + Number.EPSILON) * f) / f;
}

export function clamp(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v));
}

export function sum<T>(arr: readonly T[] | undefined, fn?: (x: T) => number): number {
  return (arr ?? []).reduce((a, b) => a + (fn ? fn(b) : num(b)), 0);
}

export function avg<T>(arr: readonly T[] | undefined, fn?: (x: T) => number): number {
  return arr?.length ? sum(arr, fn) / arr.length : 0;
}

export function max<T>(arr: readonly T[] | undefined, fn?: (x: T) => number): number {
  return (arr ?? []).reduce((a, b) => Math.max(a, fn ? fn(b) : num(b)), Number.NEGATIVE_INFINITY);
}

/** id corto para entidades nuevas (`pulso` · `id_ab12cd34`). */
export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

/** Copia profunda vía JSON: solo para estructuras de datos simples (estado). */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
