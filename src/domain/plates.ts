/**
 * Calculadora de discos — **núcleo puro**.
 *
 * Portado de `legacy/js/trainer.js`. La diferencia con la v1 es que aquí no hay
 * estado global escondido: el inventario, el modo y el peso del mango entran
 * como parámetros y la solución sale como dato. Eso permite probarlo entero con
 * Vitest (antes las comprobaciones vivían dentro del auto-test del navegador).
 *
 * El mismo inventario NO rinde igual en todo, y por eso existen los "huecos":
 *
 *   barra         2 huecos (lados)       total = barra + 2·Σ(por lado)
 *   1 mancuerna   2 huecos (extremos)    total = mango + 2·Σ(por extremo)
 *   2 mancuernas  4 huecos (2 c/u)       total = mango + 2·Σ(por extremo en cada una)
 *   sin discos    0 huecos               máquina o mancuerna fija
 *
 * Un "par" son 2 discos, así que cada medida reparte `2·pares` discos entre los
 * huecos: `cap = floor(2·pares / huecos)`. Con los 8 pares de 3 kg (16 discos) la
 * barra admite 8 por lado, una mancuerna 8 por extremo y con dos mancuernas 4 por
 * extremo en cada una. El reparto es siempre SIMÉTRICO y se enumeran todas las
 * sumas alcanzables para quedarse con la más cercana al peso pedido: nunca
 * propone discos que no tengas ni un peso inalcanzable.
 */
import { int, num, round, sum } from './num';
import { toKg } from './units';
import type { BarWeights, PlateModeKey, PlateStock, Unit } from './types';

export interface PlateItem {
  /** peso real en kg (los discos en lb se convierten) */
  kg: number;
  /** pares de esa medida (1 par = 2 discos) */
  pairs: number;
  /** medida original, tal como la escribió el usuario */
  srcW: number;
  srcUnit: Unit;
}

export interface PlateCap {
  item: PlateItem;
  /** discos de esa medida que caben en UN hueco */
  cap: number;
}

/** Un grupo del reparto: "n discos de esta medida" en cada hueco. */
export interface PlateGroup {
  kg: number;
  n: number;
  srcW: number;
  srcUnit: Unit;
}

/** Cuántos discos de cada medida se usan de verdad (el mismo reparto va en varios huecos). */
export interface PlateUsage {
  kg: number;
  srcW: number;
  srcUnit: Unit;
  used: number;
  have: number;
}

export interface PlateModeSpec {
  key: PlateModeKey;
  label: string;
  hint: string;
  /** huecos donde entra un disco (0 = no lleva discos) */
  places: number;
  /** cómo se llama un hueco en la UI: lado / extremo */
  per: string;
  /** contra qué peso base se mide: barra o mango de mancuerna */
  handle: 'olimpica' | 'mancuerna' | null;
}

export const PLATE_MODES: Record<PlateModeKey, PlateModeSpec> = {
  bar: {
    key: 'bar',
    label: 'Barra',
    hint: 'un disco por lado',
    places: 2,
    per: 'lado',
    handle: 'olimpica',
  },
  db1: {
    key: 'db1',
    label: '1 mancuerna',
    hint: 'unilateral · un disco por extremo',
    places: 2,
    per: 'extremo',
    handle: 'mancuerna',
  },
  db2: {
    key: 'db2',
    label: '2 mancuernas',
    hint: 'los mismos discos en cada mancuerna',
    places: 4,
    per: 'extremo',
    handle: 'mancuerna',
  },
  none: {
    key: 'none',
    label: 'Sin discos',
    hint: 'máquina o mancuerna fija',
    places: 0,
    per: '',
    handle: null,
  },
};

export const PLATE_MODE_KEYS: readonly PlateModeKey[] = ['bar', 'db1', 'db2', 'none'];

export function isPlateMode(v: unknown): v is PlateModeKey {
  return typeof v === 'string' && Object.hasOwn(PLATE_MODES, v);
}

/** Nunca devuelve `undefined`: si el modo guardado no existe, cae a barra. */
export function modeSpec(mode?: string | null): PlateModeSpec {
  return isPlateMode(mode) ? PLATE_MODES[mode] : PLATE_MODES.bar;
}

export interface PlateSolution {
  mode: PlateModeKey;
  places: number;
  per: string;
  handleKg: number;
  targetKg: number;
  /** reparto por hueco, de más pesado a más ligero */
  perHole: PlateGroup[];
  discsPerHole: number;
  /** discos reales que hay que poner: por hueco × huecos */
  discsTotal: number;
  /** kg de discos en cada hueco */
  sideKg: number;
  achieveKg: number;
  diffKg: number;
  exact: boolean;
  maxKg: number;
  belowKg: number | null;
  aboveKg: number | null;
  usage: PlateUsage[];
  noPlates: boolean;
}

/** Inventario utilizable, ya en kg y ordenado de más pesado a más ligero. */
export function inventory(plates?: readonly PlateStock[] | null): PlateItem[] {
  return (plates ?? [])
    .filter((p) => p && p.on !== false && int(p.pairs) > 0)
    .map((p) => ({
      kg: toKg(p.w, p.unit ?? 'kg'),
      pairs: int(p.pairs, 1),
      srcW: num(p.w),
      srcUnit: p.unit ?? 'kg',
    }))
    .filter((p) => p.kg > 0)
    .sort((a, b) => b.kg - a.kg);
}

/** Discos de cada medida que caben en UN hueco: `floor(2·pares / huecos)`. */
export function capsFor(items: readonly PlateItem[], mode?: string | null): PlateCap[] {
  const places = Math.max(1, modeSpec(mode).places);
  return items.map((item) => ({ item, cap: Math.max(0, Math.floor((item.pairs * 2) / places)) }));
}

export interface SolveOpts {
  plates?: readonly PlateStock[] | null;
  bars?: BarWeights | null;
  mode?: string | null;
  /** unidad en la que viene el peso pedido */
  unit?: Unit;
  /** peso del mango/barra a mano (manda sobre `bars`) */
  handleKg?: number;
  /** barra elegida en el desplegable */
  barKey?: 'olimpica' | 'ez';
}

export function handleKgFor(spec: PlateModeSpec, opts: SolveOpts = {}): number {
  if (!spec.handle) return 0;
  if (opts.handleKg !== undefined) return num(opts.handleKg, 0);
  const bars = opts.bars ?? undefined;
  if (spec.key === 'bar') {
    return num(bars?.[opts.barKey === 'ez' ? 'ez' : 'olimpica'], 0);
  }
  return num(bars?.mancuerna, 0);
}

/**
 * Todas las sumas alcanzables en un hueco y con qué discos se consiguen.
 * Las claves van en gramos (enteros) para no arrastrar errores de coma flotante
 * al mezclar discos de kg y lb. Si una suma se logra con menos discos, se queda
 * con ese reparto.
 */
function enumerateSums(caps: readonly PlateCap[], limitKg: number): Map<number, number[]> {
  let maps = new Map<number, number[]>([[0, caps.map(() => 0)]]);
  caps.forEach((cap, idx) => {
    const next = new Map<number, number[]>();
    for (const [grams, counts] of maps) {
      const base = grams / 1000;
      const used = counts.reduce((a, b) => a + b, 0);
      for (let c = 0; c <= cap.cap; c++) {
        const total = base + c * cap.item.kg;
        if (total > limitKg + 1e-9) break;
        const key = Math.round(total * 1000);
        const prev = next.get(key);
        const prevDiscs = prev ? prev.reduce((a, b) => a + b, 0) : 0;
        if (prev && prevDiscs <= used + c) continue;
        const arr = counts.slice();
        arr[idx] = c;
        next.set(key, arr);
      }
    }
    maps = next;
  });
  return maps;
}

export function solvePlates(target: unknown, opts: SolveOpts = {}): PlateSolution {
  const spec = modeSpec(opts.mode);
  const unit = opts.unit ?? 'kg';
  const targetKg = toKg(target, unit);
  const handleKg = handleKgFor(spec, opts);
  const caps = capsFor(inventory(opts.plates), spec.key);

  const out: PlateSolution = {
    mode: spec.key,
    places: spec.places,
    per: spec.per,
    handleKg,
    targetKg,
    perHole: [],
    discsPerHole: 0,
    discsTotal: 0,
    sideKg: 0,
    achieveKg: handleKg,
    diffKg: 0,
    exact: false,
    maxKg: handleKg,
    belowKg: null,
    aboveKg: null,
    usage: [],
    noPlates: spec.places === 0,
  };
  if (out.noPlates) {
    /* no hay discos que poner: el peso pedido se usa tal cual */
    out.achieveKg = targetKg;
    out.diffKg = 0;
    out.exact = true;
    return out;
  }

  const maxSide = sum(caps, (c) => c.cap * c.item.kg);
  out.maxKg = round(handleKg + 2 * maxSide, 3);

  const maps = enumerateSums(caps, maxSide);
  const sums = [...maps.keys()].map((grams) => grams / 1000).sort((a, b) => a - b);

  /* El reparto es simétrico, así que cada hueco lleva la mitad de la carga. */
  const want = (targetKg - handleKg) / 2;
  let pick = 0;
  let bestD = Number.POSITIVE_INFINITY;
  sums.forEach((s, i) => {
    const d = Math.abs(s - want);
    /* ascendente + estricto ⇒ en empate se queda la suma más ligera
       (mejor quedarse corto que pasarse) */
    if (d < bestD - 1e-9) {
      bestD = d;
      pick = i;
    }
  });

  const counts = maps.get(Math.round(sums[pick] * 1000)) ?? [];
  caps.forEach((cap, i) => {
    const c = counts[i] ?? 0;
    if (c > 0) {
      out.perHole.push({ kg: cap.item.kg, n: c, srcW: cap.item.srcW, srcUnit: cap.item.srcUnit });
    }
  });

  /* Con dos mancuernas el mismo reparto se repite en los 4 extremos: "3 discos de
     3 kg" por extremo son 12 discos reales y hay que decirlo. */
  out.discsPerHole = sum(out.perHole, (p) => p.n);
  out.discsTotal = out.discsPerHole * spec.places;
  out.usage = caps
    .map((cap, i) => ({
      kg: cap.item.kg,
      srcW: cap.item.srcW,
      srcUnit: cap.item.srcUnit,
      used: (counts[i] ?? 0) * spec.places,
      have: cap.item.pairs * 2,
    }))
    .filter((u) => u.used > 0);

  out.sideKg = round(sums[pick], 3);
  out.achieveKg = round(handleKg + 2 * out.sideKg, 3);
  out.diffKg = round(targetKg - out.achieveKg, 3);
  /* 0,1 kg de margen: con discos mezclados en kg y lb el ajuste fino no da para
     más y marcar 0,04 kg como "te pasas" sería ruido. */
  out.exact = Math.abs(out.diffKg) <= 0.1;
  out.belowKg = pick > 0 ? round(handleKg + 2 * sums[pick - 1], 3) : null;
  out.aboveKg = pick < sums.length - 1 ? round(handleKg + 2 * sums[pick + 1], 3) : null;
  return out;
}

/** Máximo montable con el inventario actual (el `totalKg` es por mancuerna en `db2`). */
export function maxLoadable(opts: SolveOpts = {}): {
  mode: PlateModeKey;
  per: string;
  sideKg: number;
  handleKg: number;
  totalKg: number;
} {
  const spec = modeSpec(opts.mode);
  const handleKg = handleKgFor(spec, opts);
  const sideKg = sum(capsFor(inventory(opts.plates), spec.key), (c) => c.cap * c.item.kg);
  return {
    mode: spec.key,
    per: spec.per,
    sideKg: round(sideKg, 3),
    handleKg,
    totalKg: round(handleKg + 2 * sideKg, 3),
  };
}

/* ---------- modo sugerido por ejercicio ---------- */

const UNILATERAL_RX = /unilateral|a una mano|una mano|kroc|por brazo|por lado|por pierna/;

export interface ExerciseHint {
  name?: string;
  equip?: string;
  /** a peso corporal: no lleva discos */
  bw?: boolean;
}

export interface SuggestOpts {
  /** modo que el usuario forzó a mano y se recuerda por ejercicio */
  saved?: PlateModeKey | null;
  hasAdjustableDumbbells?: boolean;
  hasBarbell?: boolean;
}

export function suggestPlateMode(ex: ExerciseHint, opts: SuggestOpts = {}): PlateModeKey {
  if (opts.saved) return opts.saved;
  if (ex.bw) return 'none';
  const name = String(ex.name ?? '').toLowerCase();
  const equip = String(ex.equip ?? '').toLowerCase();
  const dumbbell = /mancuern/.test(name) || /mancuernas_ajustables/.test(equip);
  const barbell = /barra/.test(name) || /barra_olimpica|barra_ez/.test(equip);
  if (dumbbell && !barbell) return UNILATERAL_RX.test(name) ? 'db1' : 'db2';
  if (barbell) return 'bar';
  if (opts.hasAdjustableDumbbells) return 'db2';
  return opts.hasBarbell ? 'bar' : 'none';
}

/* ---------- etiquetas ---------- */

export function plateLabel(kg: number, srcW: number, srcUnit: Unit, n?: number): string {
  let txt = `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(kg)} kg`;
  if (srcUnit === 'lb' && srcW) {
    txt += ` (${new Intl.NumberFormat('es-ES').format(srcW)} lb)`;
  }
  if (int(n, 1) > 1) txt += ` ×${int(n, 1)}`;
  return txt;
}

/** Color del disco por kg (las clases `.pXX` viven en la hoja de estilos). */
export function plateTone(kg: unknown): string {
  const map: Record<string, string> = {
    '25': 'p25',
    '20': 'p20',
    '15': 'p15',
    '10': 'p10',
    '5': 'p5',
    '2.5': 'p2',
    '2': 'p2',
    '1.25': 'p1',
    '1': 'p1',
  };
  return map[String(round(num(kg), 2))] ?? '';
}

export function plateSummary(res: PlateSolution): string {
  if (!res.perHole.length) return 'solo la barra';
  return res.perHole.map((p) => plateLabel(p.kg, p.srcW, p.srcUnit, p.n)).join(' + ');
}
