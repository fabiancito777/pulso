/**
 * Fechas en ISO local `YYYY-MM-DD`. Portado de `U.d` de la v1.
 * ⚠️ Nunca uses `toISOString().slice(0, 10)` para fechas de calendario: eso
 * convierte a UTC y desplaza el día según la zona horaria.
 */
import { int } from './num';

export const DOW = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'] as const;
export const DOW_LONG = [
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
  'domingo',
] as const;
export const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

export type DateStyle = 'short' | 'medium' | 'month' | 'long';

export function iso(date?: Date | string | number): string {
  const x = date === undefined ? new Date() : new Date(date);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

/** ISO local → Date a medianoche local (sin sustos de zona horaria). */
export function parse(isoDate?: string): Date {
  if (!isoDate) return new Date();
  const p = String(isoDate).slice(0, 10).split('-');
  return new Date(int(p[0]), int(p[1], 1) - 1, int(p[2], 1));
}

export const today = (): string => iso(new Date());
export const nowTs = (): string => new Date().toISOString();

export function addDays(isoDate: string, n: number): string {
  const x = parse(isoDate);
  x.setDate(x.getDate() + int(n));
  return iso(x);
}

export function addMonths(isoDate: string, n: number): string {
  const x = parse(isoDate);
  x.setMonth(x.getMonth() + int(n));
  return iso(x);
}

/** Días de `a` menos `b`. */
export function diffDays(a: string, b: string): number {
  return Math.round((parse(a).getTime() - parse(b).getTime()) / 86_400_000);
}

/** 0 = lunes (en JS `getDay()` el domingo es 0). */
export const dowIdx = (isoDate: string): number => (parse(isoDate).getDay() + 6) % 7;

export const startOfWeek = (isoDate?: string): string => {
  const base = isoDate ?? today();
  return addDays(base, -dowIdx(base));
};

export function weekDates(isoDate?: string): string[] {
  const start = startOfWeek(isoDate);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export const dow = (isoDate: string): string => DOW[dowIdx(isoDate)];
export const dowLong = (isoDate: string): string => DOW_LONG[dowIdx(isoDate)];

export function label(isoDate: string, style?: DateStyle): string {
  const x = parse(isoDate);
  if (style === 'short') return `${DOW[dowIdx(isoDate)]} ${x.getDate()}`;
  if (style === 'month') return `${MONTHS[x.getMonth()]} de ${x.getFullYear()}`;
  if (style === 'medium') {
    return `${x.getDate()} ${MONTHS[x.getMonth()].slice(0, 3)} ${x.getFullYear()}`;
  }
  return `${DOW[dowIdx(isoDate)]}, ${x.getDate()} de ${MONTHS[x.getMonth()]}`;
}

export function relative(isoDate: string): string {
  const n = diffDays(isoDate, today());
  if (n === 0) return 'hoy';
  if (n === 1) return 'ayer';
  if (n === -1) return 'mañana';
  return n > 1 ? `hace ${n} días` : `en ${Math.abs(n)} días`;
}

export function timeAgo(ts: string): string {
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 60_000);
  if (m < 1) return 'ahora';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`;
}
