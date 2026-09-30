/**
 * Formato de números y duraciones en es-ES. Portado de la v1 (`U.fmt`).
 *
 * Nota de v2: en la v1 todo texto que venía del usuario pasaba por `U.esc()`
 * porque las vistas montaban HTML a mano. Con componentes ya no hace falta:
 * Preact escapa solo. `esc()` se queda en la v1 y aquí no se porta.
 */
import { num } from './num';

const formatters = new Map<number, Intl.NumberFormat>();

function decimalFormatter(dec: number): Intl.NumberFormat | null {
  const cached = formatters.get(dec);
  if (cached) return cached;
  try {
    /* ⚠️ `useGrouping` se pide EXPLÍCITO: en V8/Intl actuales el valor por
       defecto ('auto') ya no separa los millares de 4 dígitos y 1000 kg se
       leían como "1000" en vez de "1.000". */
    const f = new Intl.NumberFormat('es-ES', { maximumFractionDigits: dec, useGrouping: true });
    formatters.set(dec, f);
    return f;
  } catch {
    return null;
  }
}

/** `dec = 0` redondea; cualquier otro valor fija los decimales MÁXIMOS. */
export function fmtN(v: unknown, dec?: number): string {
  const n = num(v);
  if (dec === 0) return decimalFormatter(0)?.format(n) ?? String(Math.round(n));
  if (dec !== undefined && dec !== null) {
    const f = decimalFormatter(dec);
    if (f) return f.format(n);
  }
  return Number.isInteger(n) ? (decimalFormatter(0)?.format(n) ?? String(n)) : (decimalFormatter(2)?.format(n) ?? String(n));
}

/** Un decimal: pesos y 1RM en gráficos. */
export const fmtW = (v: unknown): string => fmtN(v, 1);

/** Volumen: `1,2k` a partir de 1000. */
export function fmtVol(kg: unknown): string {
  const v = num(kg);
  return v >= 1000 ? `${fmtN(Math.round(v / 100) / 10)}k` : fmtN(Math.round(v));
}

export function fmtDur(ms: unknown): string {
  const s = Math.max(0, Math.round(num(ms) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m < 10 ? '0' : ''}${m}m` : `${m}m`;
}

/** mm:ss (o h:mm:ss si pasa de una hora): para el reloj de la sesión. */
export function fmtClock(sec: unknown): string {
  const s = Math.max(0, Math.round(num(sec)));
  const mm = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  if (s >= 3600) {
    return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${ss}`;
  }
  return `${mm}:${ss}`;
}

/** mm:ss sin la hora: para el timer de descanso. */
export function fmtMmss(sec: unknown): string {
  const s = Math.max(0, Math.round(num(sec)));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const fmtRpe = (v: unknown): string => (num(v) ? fmtN(v, 1) : '—');

/**
 * Valor para un `<input type="number">`: punto decimal y sin separadores.
 * ⚠️ `fmtN()` usa la coma de es-ES y el navegador DESCARTA ese `value` (el campo
 * sale vacío). Fue un bug real de la v1; aquí vive en un solo sitio.
 */
export function inputNum(v: unknown): string {
  if (v === undefined || v === null || v === '') return '';
  const n = num(v, Number.NaN);
  return Number.isFinite(n) ? String(n) : '';
}
