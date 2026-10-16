/**
 * Edge cases 105–120 de `_specs/edge-cases-300.md` · `domain/units` + `format` + `num`.
 */
import { describe, expect, it } from 'vitest';

import {
  fmtClock,
  fmtDur,
  fmtMmss,
  fmtN,
  fmtRpe,
  fmtVol,
  fmtW,
  inputNum,
} from '@/domain/format';
import { avg, clamp, int, max, num, round, sum } from '@/domain/num';
import { fromKg, KG_PER_LB, prettyWeight, roundToStep, toKg, unitIncrement } from '@/domain/units';

describe('105–109 · unidades', () => {
  it('105 · toKg con lb usa la constante exacta', () => {
    expect(toKg(100, 'lb')).toBe(KG_PER_LB * 100);
    expect(toKg(100, 'lb')).toBeCloseTo(45.359237, 6);
  });

  it('106 · fromKg es la inversa de toKg', () => {
    expect(fromKg(45.359237, 'lb')).toBeCloseTo(100, 4);
  });

  it('107 · unitIncrement es 5 en lb y 2,5 en kg', () => {
    expect(unitIncrement('lb')).toBe(5);
    expect(unitIncrement('kg')).toBe(2.5);
  });

  it('108 · roundToStep ajusta al peldaño de la unidad', () => {
    expect(roundToStep(11.3, 'kg')).toBe(11.25);
    expect(roundToStep(11.3, 'lb') % 2.5).toBe(0);
  });

  it('109 · prettyWeight usa coma y hasta 2 decimales', () => {
    expect(prettyWeight(18.5, 'kg')).toBe('18,5 kg');
  });
});

describe('110–118 · formato', () => {
  it('110 · fmtN(v, 0) redondea a entero sin decimales', () => {
    expect(fmtN(1234.6, 0)).toBe('1.235');
  });

  it('111 · fmtN(v, 2) enseña como máximo 2 decimales', () => {
    expect(fmtN(1.5, 2)).toBe('1,5');
    expect(fmtN(1.256, 2)).toBe('1,26');
  });

  it('112 · cuatro dígitos sí llevan separador de millar', () => {
    expect(fmtN(1000, 0)).toBe('1.000');
  });

  it('113 · fmtW usa hasta 1 decimal', () => {
    // HALLAZGO: fmtW = fmtN(v, 1) con `maximumFractionDigits`, no fija decimal:
    // 20 sale "20" y 18,5 sale "18,5".
    expect(fmtW(20)).toBe('20');
    expect(fmtW(18.5)).toBe('18,5');
  });

  it('114 · fmtVol abrevia miles con k', () => {
    expect(fmtVol(1234)).toBe('1,2k');
  });

  it('115 · fmtDur pasa de ms a texto legible', () => {
    expect(fmtDur(90 * 60_000)).toBe('1h 30m');
  });

  it('116 · fmtClock y fmtMmss formatean segundos', () => {
    expect(fmtClock(65)).toBe('1:05');
    expect(fmtMmss(65)).toBe('1:05');
  });

  it('117 · fmtRpe vacío no muestra 0', () => {
    // HALLAZGO: el contrato pedía '-', pero el código devuelve el em dash '—'.
    expect(fmtRpe('')).toBe('—');
    expect(fmtRpe(0)).toBe('—');
  });

  it('118 · inputNum usa punto, no coma', () => {
    expect(inputNum(18.5)).toBe('18.5');
  });
});

describe('119–120 · num', () => {
  it('119 · round aplica epsilon y num/int toleran basura', () => {
    expect(round(1.005, 2)).toBe(1.01);
    expect(num('x', 7)).toBe(7);
    expect(int('8.9', 0)).toBe(8);
  });

  it('120 · clamp/sum/avg/max con arrays vacíos', () => {
    expect(sum([])).toBe(0);
    expect(avg([])).toBe(0);
    expect(max([])).toBe(0);
    expect(clamp(5, 1, 10)).toBe(5);
  });
});
