/**
 * Geometría, escalas y ticks de los gráficos SVG de Progreso.
 *
 * Port puro de `legacy/js/charts.js`: aquí no hay DOM ni medida de ancho (la v1
 * repintaba midiendo `el.clientWidth` con `mountAll`), el ancho entra por
 * parámetro y el componente lo volca en el `viewBox`. Así escalas, ticks y
 * redondeos se comprueban con Vitest en vez de a ojo en el navegador.
 *
 * Los números se redondean AQUÍ (a un decimal, como los `toFixed(1)` de la v1)
 * para que el SVG sea determinista y las pruebas puedan fijarlos.
 */
import { addDays, startOfWeek, today } from '@/domain/dates';
import { fmtDur, fmtN, fmtVol } from '@/domain/format';
import { max as maxOf, num, sum } from '@/domain/num';

/** Formato de un valor del eje/etiqueta: los mismos casos que `fmtVal` de la v1. */
export type ChartFormat = 'vol' | 'time' | 'n' | 'w';

/** Punto de una barra vertical (y de las barras horizontales). */
export interface BarDatum {
  label: string;
  value: number;
  color?: string;
  /** barras atenuadas (opacidad 0.35), como `dim` de la v1 */
  dim?: boolean;
  /** tooltip propio; si falta se usa `label: valor` */
  tip?: string;
}

export interface LinePoint {
  label: string;
  value: number;
}

export interface LineSeries {
  name?: string;
  color?: string;
  points: readonly LinePoint[];
}

export interface DonutDatum {
  label: string;
  value: number;
  color: string;
}

export interface HeatCell {
  iso: string;
  value: number;
}

/** Redondeo a un decimal sin pasar por string (los `toFixed(1)` de la v1). */
export const r1 = (n: number): number => {
  const r = Math.round(n * 10) / 10;
  return r === 0 ? 0 : r; // `Math.round(-0.01)` devuelve -0 y `-0` no es `0` para Object.is
};

/** Etiqueta de eje según el tipo de dato, idéntica a la v1. */
export function fmtVal(v: number, kind: ChartFormat = 'w'): string {
  if (kind === 'vol') return fmtVol(v);
  if (kind === 'time') return fmtDur(v);
  if (kind === 'n') return fmtN(v, 0);
  return fmtN(v, 1);
}

/**
 * Techo "bonito" (1/2/2,5/5/10 × 10^n): el `niceMax` de la v1. `<= 0` devuelve
 * 1 para que el eje no se colapse con datos a cero.
 */
export function niceMax(v: number): number {
  const n = num(v);
  if (n <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(n)));
  const mant = n / exp;
  const step = mant <= 1 ? 1 : mant <= 2 ? 2 : mant <= 2.5 ? 2.5 : mant <= 5 ? 5 : 10;
  return step * exp;
}

/** Cada cuántas barras se pone etiqueta en X (máximo ~6 + la última). */
export const labelStep = (n: number): number => (n > 8 ? Math.ceil(n / 6) : 1);

/* ---------- barras verticales ---------- */

export interface BarLayoutOptions {
  width?: number;
  height?: number;
  /** `false` = barras casi pegadas (hueco mínimo), como `gap:false` de la v1 */
  gap?: boolean;
}

export interface BarRect {
  x: number;
  y: number;
  w: number;
  h: number;
  index: number;
  label: string;
  value: number;
  color?: string;
  dim?: boolean;
}

export interface BarLayout {
  width: number;
  height: number;
  padL: number;
  padT: number;
  iw: number;
  ih: number;
  max: number;
  slot: number;
  bw: number;
  /** tres líneas de rejilla: tope, mitad y cero */
  ticks: { v: number; y: number }[];
  rects: BarRect[];
  labelStep: number;
}

/** ¿No hay nada que dibujar? (todos a cero o sin datos, como el guard de la v1). */
export const barsEmpty = (data: readonly BarDatum[]): boolean =>
  !data.length || data.every((d) => num(d.value) === 0);

export function barLayout(data: readonly BarDatum[], opts: BarLayoutOptions = {}): BarLayout {
  const width = Math.max(240, num(opts.width, 320));
  const height = num(opts.height, 150);
  const padL = 34;
  const padR = 6;
  const padT = 14;
  const padB = 20;
  const max = niceMax(maxOf(data, (d) => num(d.value)));
  const iw = width - padL - padR;
  const ih = height - padT - padB;
  const slot = data.length ? iw / data.length : iw;
  const bw = Math.min(34, Math.max(6, slot * (opts.gap === false ? 0.95 : 0.62)));
  const ticks = [0, 1, 2].map((g) => {
    const y = padT + (ih / 2) * g;
    return { v: r1(max - (max / 2) * g), y: r1(y) };
  });
  const rects = data.map((d, i) => {
    const v = num(d.value);
    const bh = max ? (v / max) * ih : 0;
    return {
      x: r1(padL + slot * i + (slot - bw) / 2),
      y: r1(padT + ih - bh),
      w: r1(bw),
      h: r1(Math.max(1, bh)),
      index: i,
      label: d.label,
      value: v,
      color: d.color,
      dim: d.dim,
    };
  });
  return {
    width,
    height,
    padL,
    padT,
    iw,
    ih,
    max,
    slot,
    bw,
    ticks,
    rects,
    labelStep: labelStep(data.length),
  };
}

/** Y de la línea discontinua de objetivo (solo si cae dentro del área). */
export const targetY = (l: BarLayout, target: number): number =>
  r1(l.padT + l.ih - (num(target) / l.max) * l.ih);

/* ---------- línea / área ---------- */

export interface LineLayoutOptions {
  width?: number;
  height?: number;
  /** suelo forzado (la v1 lo solo usa para `spec.min`) */
  min?: number;
  /** eje arrancando en 0 */
  zero?: boolean;
  /** dibujar relleno bajo la línea (solo con una serie, como la v1) */
  area?: boolean;
}

export interface LineDot {
  x: number;
  y: number;
  r: number;
  last: boolean;
  value: number;
  label: string;
  /** con varias series y más de 10 puntos solo se dibuja el último (regla v1) */
  hidden: boolean;
}

export interface LineLayoutSeries {
  color: string;
  path: string;
  area: string | null;
  dots: LineDot[];
}

export interface LineLayout {
  width: number;
  height: number;
  padL: number;
  padT: number;
  iw: number;
  ih: number;
  lo: number;
  span: number;
  maxN: number;
  x(i: number): number;
  y(v: number): number;
  ticks: { v: number; y: number }[];
  series: LineLayoutSeries[];
  /** etiquetas de X: primera, central y última de la primera serie */
  xLabels: { i: number; x: number; anchor: string; text: string }[];
}

/**
 * Las series sin puntos dibujables se descartan (el filtro de `renderLine`).
 *
 * Matiz heredado de la v1: `isFinite(U.num(p.value))` ahí solo cazaba el `null`,
 * porque `num(NaN)` devuelve 0 y 0 es finito. Aquí se descarta además el punto
 * cuyo valor ES `NaN`/`Infinity`: pintar un 0 inventado peor que saltárselo.
 */
export function cleanSeries(series: readonly LineSeries[]): LineSeries[] {
  const usable = (p: LinePoint): boolean =>
    p !== null && p !== undefined && !(typeof p.value === 'number' && !Number.isFinite(p.value));
  return series
    .map((s) => ({ ...s, points: s.points.filter(usable) }))
    .filter((s) => s.points.length > 0);
}

export function lineLayout(
  series: readonly LineSeries[],
  opts: LineLayoutOptions = {},
): LineLayout {
  const width = Math.max(240, num(opts.width, 320));
  const height = num(opts.height, 170);
  const padL = 36;
  const padR = 10;
  const padT = 16;
  const padB = 22;
  const clean = cleanSeries(series);
  const iw = width - padL - padR;
  const ih = height - padT - padB;
  const vals = clean.flatMap((s) => s.points.map((p) => num(p.value)));
  let lo = vals.length ? Math.min(...vals) : 0;
  const hi = vals.length ? Math.max(...vals) : 1;
  if (opts.min !== undefined) lo = Math.min(lo, num(opts.min));
  if (opts.zero) lo = 0;
  const span = hi - lo || Math.max(1, hi * 0.1);
  const maxN = Math.max(1, ...clean.map((s) => s.points.length));
  const x = (i: number): number => r1(padL + (maxN === 1 ? iw / 2 : (i / (maxN - 1)) * iw));
  const y = (v: number): number => r1(padT + ih - ((num(v) - lo) / span) * ih);

  const ticks = [0, 1, 2].map((g) => {
    const yy = padT + (ih / 2) * g;
    return { v: lo + (span / 2) * (2 - g), y: r1(yy) };
  });

  const out: LineLayoutSeries[] = clean.map((s) => {
    const color = s.color || 'var(--accent)';
    const path = s.points
      .map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(num(p.value)).toFixed(1)}`)
      .join(' ');
    const single = clean.length === 1 && opts.area !== false;
    const area = single
      ? `${path} L${x(s.points.length - 1).toFixed(1)} ${(padT + ih).toFixed(1)} L${x(0).toFixed(1)} ${(
          padT + ih
        ).toFixed(1)} Z`
      : null;
    const many = clean.length > 1;
    const dots = s.points.map((p, i) => {
      const last = i === s.points.length - 1;
      return {
        x: x(i),
        y: y(num(p.value)),
        r: last ? 3.4 : 2.4,
        last,
        value: num(p.value),
        label: p.label,
        /* con varias series y más de 10 puntos la v1 solo dibuja el último */
        hidden: many && !last && s.points.length > 10,
      };
    });
    return { color, path, area, dots };
  });

  const base = clean[0]?.points ?? [];
  const mid = Math.floor((base.length - 1) / 2);
  const idx = [...new Set([0, mid, base.length - 1])];
  const xLabels = idx
    .filter((i) => i >= 0 && base[i])
    .map((i) => ({
      i,
      x: x(i),
      anchor: i === 0 ? 'start' : i === base.length - 1 ? 'end' : 'middle',
      text: base[i].label,
    }));

  return { width, height, padL, padT, iw, ih, lo, span, maxN, x, y, ticks, series: out, xLabels };
}

/* ---------- donut ---------- */

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
  frac: number;
  pct: number;
  dash: string;
  dashoffset: number;
}

export interface DonutLayout {
  size: number;
  sw: number;
  r: number;
  circ: number;
  total: number;
  segments: DonutSegment[];
}

export function donutLayout(
  data: readonly DonutDatum[],
  opts: { size?: number; thickness?: number } = {},
): DonutLayout {
  const size = Math.max(80, num(opts.size, 190));
  const sw = num(opts.thickness, 17);
  const rows = data.filter((d) => num(d.value) > 0);
  const total = sum(rows, (d) => num(d.value));
  const r = size / 2 - sw / 2;
  const circ = 2 * Math.PI * r;
  let off = 0;
  const segments = rows.map((d) => {
    const value = num(d.value);
    const frac = total ? value / total : 0;
    const len = circ * frac;
    const seg: DonutSegment = {
      label: d.label,
      value,
      color: d.color,
      frac,
      pct: Math.round(frac * 100),
      dash: `${r1(len - 2)} ${r1(circ - len + 2)}`,
      dashoffset: r1(-off),
    };
    off += len;
    return seg;
  });
  return { size, sw, r: r1(r), circ: r1(circ), total, segments };
}

/* ---------- heatmap de consistencia ---------- */

export interface HeatLayoutCell {
  iso: string;
  x: number;
  y: number;
  w: number;
  h: number;
  value: number;
  opacity: number;
  color: string;
  today: boolean;
}

export interface HeatLayout {
  width: number;
  height: number;
  weeks: number;
  cell: number;
  gap: number;
  cells: HeatLayoutCell[];
  dayLabels: { text: string; x: number; y: number }[];
  max: number;
}

export interface HeatLayoutOptions {
  weeks?: number;
  todayIso?: string;
  color?: string;
}

/** Las claves `YYYY-MM-DD` se comparan como texto (el truco de fechas de la v1). */
export function heatLayout(cells: readonly HeatCell[], opts: HeatLayoutOptions = {}): HeatLayout {
  const weeks = Math.max(1, Math.trunc(num(opts.weeks, 16)));
  const now = opts.todayIso ?? today();
  const color = opts.color || 'var(--accent)';
  const byDate = new Map<string, number>();
  for (const c of cells) byDate.set(c.iso, num(c.value));
  const start = startOfWeek(addDays(now, -7 * (weeks - 1)));
  const maxV = Math.max(1, ...cells.map((c) => num(c.value)));
  const cell = 13;
  const gap = 3;
  const width = weeks * (cell + gap) + 22;
  const height = 7 * (cell + gap) + 6;
  const out: HeatLayoutCell[] = [];
  for (let wk = 0; wk < weeks; wk++) {
    for (let dy = 0; dy < 7; dy++) {
      const iso = addDays(start, wk * 7 + dy);
      if (iso > now) continue;
      const v = byDate.get(iso) ?? 0;
      out.push({
        iso,
        x: 22 + wk * (cell + gap),
        y: dy * (cell + gap),
        w: cell,
        h: cell,
        value: v,
        opacity: v === 0 ? 1 : Math.min(1, 0.25 + 0.75 * (v / maxV)),
        color: v === 0 ? 'var(--surface-2)' : color,
        today: iso === now,
      });
    }
  }
  const dayLabels = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((text, i) => ({
    text,
    x: 12,
    y: r1(i * (cell + gap) + cell / 2 + 1),
  }));
  return { width, height, weeks, cell, gap, cells: out, dayLabels, max: maxV };
}

/* ---------- sparkline ---------- */

/**
 * Trazo de la mini-línea de récords (92×26 como la v1). Devuelve `null` con
 * menos de dos puntos: la v1 no pintaba nada en ese caso.
 */
export function sparkPath(points: readonly number[], w = 92, h = 26): string | null {
  const vals = points.map((p) => num(p)).filter((v) => Number.isFinite(v));
  if (vals.length < 2) return null;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  return vals
    .map(
      (v, i) =>
        `${i ? 'L' : 'M'}${((i / (vals.length - 1)) * w).toFixed(1)} ${(
          h -
          ((v - lo) / span) * (h - 4) -
          2
        ).toFixed(1)}`,
    )
    .join(' ');
}
