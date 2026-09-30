import { describe, expect, it } from 'vitest';

import {
  barsEmpty,
  barLayout,
  cleanSeries,
  donutLayout,
  fmtVal,
  heatLayout,
  labelStep,
  lineLayout,
  niceMax,
  r1,
  sparkPath,
  targetY,
} from './charts-helpers';
import type { BarDatum, LineSeries } from './charts-helpers';

const bar = (label: string, value: number): BarDatum => ({ label, value });

describe('formato de los ejes', () => {
  it('usa los mismos formatos que la v1 (vol, duración, entero, decimal)', () => {
    expect(fmtVal(1500, 'vol')).toBe('1,5k'); // fmtVol abrevia a partir de 1000
    expect(fmtVal(850, 'vol')).toBe('850');
    expect(fmtVal(90_000, 'time')).toBe('1m'); // fmtDur corta a minutos
    expect(fmtVal(1000.4, 'n')).toBe('1.000'); // useGrouping explícito
    expect(fmtVal(18.5, 'w')).toBe('18,5');
    expect(fmtVal(7)).toBe('7'); // por defecto, un decimal
  });

  it('redondea a un decimal sin quedarse en -0', () => {
    expect(r1(1.24)).toBe(1.2);
    expect(r1(1.25)).toBe(1.3);
    expect(Object.is(r1(-0.01), 0)).toBe(true);
  });
});

describe('niceMax', () => {
  it('redondea el tope a 1/2/2,5/5/10 × 10^n', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-5)).toBe(1);
    expect(niceMax(9)).toBe(10);
    expect(niceMax(12)).toBe(20);
    expect(niceMax(25)).toBe(25);
    expect(niceMax(251)).toBe(500);
    expect(niceMax(999)).toBe(1000);
    expect(niceMax(1000)).toBe(1000);
  });
});

describe('barras verticales', () => {
  const data = [bar('a', 0), bar('b', 10), bar('c', 5)];

  it('pone como mucho ~6 etiquetas en el eje X', () => {
    expect(labelStep(8)).toBe(1);
    expect(labelStep(9)).toBe(2);
    expect(labelStep(40)).toBe(7); // 6 tramos + la última
  });

  it('detecta el estado vacío (sin datos o todo a cero)', () => {
    expect(barsEmpty([])).toBe(true);
    expect(barsEmpty([bar('a', 0), bar('b', 0)])).toBe(true);
    expect(barsEmpty([bar('a', 0), bar('b', 1)])).toBe(false);
  });

  it('calcula tres ticks (tope, mitad, cero) y las cajas de las barras', () => {
    const l = barLayout(data, { width: 320, height: 150 });
    expect(l.max).toBe(10);
    expect(l.ticks).toEqual([
      { v: 10, y: 14 },
      { v: 5, y: 72 },
      { v: 0, y: 130 },
    ]);
    expect(l.slot).toBeCloseTo(280 / 3, 6);
    expect(l.bw).toBe(34); // tope de 34 px de la v1
    expect(l.rects[0]).toMatchObject({ x: 63.7, y: 130, w: 34, h: 1 }); // vacía: 1 px mínimo
    expect(l.rects[1]).toMatchObject({ x: 157, y: 14, h: 116 });
    expect(l.rects[2]).toMatchObject({ y: 72, h: 58 }); // mitad del tope
    expect(l.labelStep).toBe(1);
  });

  it('estrecha las barras con gap:false y respeta el mínimo de 6 px', () => {
    const wide = barLayout(data, { width: 320, gap: false });
    expect(wide.bw).toBe(34); // slot 93 px → el tope manda
    const many = barLayout(
      Array.from({ length: 40 }, (_, i) => bar(String(i), i + 1)),
      { width: 320 },
    );
    expect(many.bw).toBe(6); // slot 7 px → suelo de 6 px
    expect(many.labelStep).toBe(7); // 40 barras → 6 etiquetas + la última
  });

  it('la línea de objetivo se dibuja en su Y y solo si cabe', () => {
    const l = barLayout(data, { height: 150 });
    expect(targetY(l, 5)).toBe(72);
    expect(targetY(l, 10)).toBe(14);
    expect(targetY(l, 11)).toBeLessThan(14); // fuera de la v1, la v1 lo descarta
  });
});

describe('línea / área', () => {
  const series: LineSeries[] = [
    {
      name: '1RM',
      points: [
        { label: 'ene', value: 10 },
        { label: 'feb', value: 20 },
      ],
    },
  ];

  it('fija el dominio a los valores y pone 3 ticks', () => {
    const l = lineLayout(series, { width: 320, height: 170 });
    expect(l.lo).toBe(10);
    expect(l.span).toBe(10);
    expect(l.maxN).toBe(2);
    expect(l.ticks).toEqual([
      { v: 20, y: 16 },
      { v: 15, y: 82 },
      { v: 10, y: 148 },
    ]);
    expect(l.x(0)).toBe(36);
    expect(l.x(1)).toBe(310); // 36 + iw(274)
    expect(l.y(20)).toBe(16);
    expect(l.y(10)).toBe(148);
    expect(l.series[0].path).toBe('M36.0 148.0 L310.0 16.0');
  });

  it('una sola serie lleva relleno; varias, no (regla de la v1)', () => {
    expect(lineLayout(series).series[0].area).toContain('Z');
    const two: LineSeries[] = [
      ...series,
      {
        name: 'b',
        points: [
          { label: 'ene', value: 1 },
          { label: 'feb', value: 2 },
        ],
      },
    ];
    expect(lineLayout(two).series[0].area).toBeNull();
  });

  it('respeta min y zero, y centra una serie de un solo punto', () => {
    expect(lineLayout(series, { zero: true }).lo).toBe(0);
    expect(lineLayout(series, { min: 5 }).lo).toBe(5);
    const one = lineLayout([{ points: [{ label: 'hoy', value: 42 }] }], { width: 320 });
    expect(one.maxN).toBe(1);
    expect(one.x(0)).toBe(173); // padL 36 + iw/2
    expect(one.xLabels).toEqual([{ i: 0, x: 173, anchor: 'start', text: 'hoy' }]);
  });

  it('etiqueta primera, central y última sin repetir', () => {
    const three = lineLayout([
      {
        points: [
          { label: 'a', value: 1 },
          { label: 'b', value: 2 },
          { label: 'c', value: 3 },
        ],
      },
    ]);
    expect(three.xLabels.map((t) => t.text)).toEqual(['a', 'b', 'c']);
    expect(three.xLabels.map((t) => t.anchor)).toEqual(['start', 'middle', 'end']);
  });

  it('descarta puntos no finitos y series vacías', () => {
    const clean = cleanSeries([
      {
        points: [
          { label: 'a', value: Number.NaN },
          { label: 'b', value: 5 },
        ],
      },
      { points: [] },
    ]);
    expect(clean).toHaveLength(1);
    expect(clean[0].points.map((p) => p.value)).toEqual([5]);
    expect(lineLayout([{ points: [] }]).series).toHaveLength(0);
  });

  it('con varias series y más de 10 puntos solo dibuja el último', () => {
    const many: LineSeries[] = [
      { points: Array.from({ length: 12 }, (_, i) => ({ label: String(i), value: i })) },
      { points: Array.from({ length: 12 }, (_, i) => ({ label: String(i), value: i * 2 })) },
    ];
    const l = lineLayout(many);
    expect(l.series[0].dots.filter((d) => !d.hidden)).toHaveLength(1);
    expect(l.series[1].dots.at(-1)?.last).toBe(true);
  });
});

describe('donut', () => {
  it('suma el total, reparte porcentajes y encadena los dashoffset', () => {
    const l = donutLayout([
      { label: 'Pecho', value: 3, color: '#60a5fa' },
      { label: 'Espalda', value: 1, color: '#34d399' },
      { label: 'Vacío', value: 0, color: '#000' },
    ]);
    expect(l.total).toBe(4); // el valor 0 no se dibuja
    expect(l.segments).toHaveLength(2);
    expect(l.segments[0].pct).toBe(75);
    expect(l.segments[1].pct).toBe(25);
    expect(l.segments[0].dashoffset).toBeCloseTo(0, 1);
    expect(l.segments[1].dashoffset).toBeCloseTo(-l.circ * 0.75, 0);
    // cada arco deja hueco de 2 px, como en la v1 (evita que se toquen)
    for (const s of l.segments) {
      const [on, off] = s.dash.split(' ').map(Number);
      expect(on + off).toBeCloseTo(l.circ, 0);
      expect(on).toBeGreaterThan(0);
    }
  });

  it('sin valores positivos devuelve total 0 (el componente pinta el vacío)', () => {
    expect(donutLayout([{ label: 'a', value: 0, color: '#fff' }]).total).toBe(0);
    expect(donutLayout([]).total).toBe(0);
  });
});

describe('heatmap de consistencia', () => {
  const todayIso = '2026-09-28'; // lunes

  it('mide semanas × 7 celdas y descarta los días futuros', () => {
    const l = heatLayout([{ iso: todayIso, value: 1 }], { weeks: 2, todayIso });
    expect(l.width).toBe(2 * 16 + 22);
    expect(l.height).toBe(7 * 16 + 6);
    expect(l.cells).toHaveLength(8); // semana anterior completa + hoy
    expect(l.cells.at(-1)).toMatchObject({ iso: todayIso, today: true, value: 1 });
    expect(l.cells.some((c) => c.iso > todayIso)).toBe(false);
  });

  it('la opacidad crece con el valor y los huecos van en surface-2', () => {
    const l = heatLayout(
      [
        { iso: '2026-09-21', value: 1 },
        { iso: '2026-09-23', value: 2 },
      ],
      { weeks: 2, todayIso },
    );
    const empty = l.cells.find((c) => c.iso === '2026-09-22');
    const one = l.cells.find((c) => c.iso === '2026-09-21');
    const two = l.cells.find((c) => c.iso === '2026-09-23');
    expect(empty).toMatchObject({ value: 0, color: 'var(--surface-2)', opacity: 1 });
    expect(one?.color).toBe('var(--accent)');
    expect(one?.opacity).toBeCloseTo(0.625, 3); // 0.25 + 0.75 × (1/2)
    expect(two?.opacity).toBe(1);
    expect(l.max).toBe(2);
  });

  it('pinta la última celda con la marca de hoy', () => {
    const l = heatLayout([], { weeks: 1, todayIso });
    expect(l.cells.filter((c) => c.today).map((c) => c.iso)).toEqual([todayIso]);
    expect(l.dayLabels.map((d) => d.text)).toEqual(['L', 'M', 'X', 'J', 'V', 'S', 'D']);
    expect(l.dayLabels[0].y).toBe(7.5);
  });
});

describe('sparkline', () => {
  it('devuelve el trazo de 92×26 con el mínimo arriba y el máximo abajo', () => {
    expect(sparkPath([1, 2, 3])).toBe('M0.0 24.0 L46.0 13.0 L92.0 2.0');
    expect(sparkPath([5, 5])).toBe('M0.0 24.0 L92.0 24.0'); // sin rango → línea recta
  });

  it('sin dos puntos no hay nada que dibujar', () => {
    expect(sparkPath([])).toBeNull();
    expect(sparkPath([7])).toBeNull();
  });
});
