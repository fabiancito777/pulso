/**
 * Edge cases 1–24 de `_specs/edge-cases-300.md` · `domain/plates`.
 *
 * Contrato: el inventario se cuenta en discos sueltos, el reparto es simétrico,
 * la migración `pairs`→`discs` es idempotente y el solver nunca propone discos
 * que no tienes. Donde el contrato no cuadra con el código se ajusta y se anota.
 */
import { describe, expect, it } from 'vitest';

import {
  capsFor,
  inventory,
  maxLoadable,
  normalizePlate,
  normalizePlates,
  plateLabel,
  plateSummary,
  plateTone,
  solvePlates,
  suggestPlateMode,
} from '@/domain/plates';
import type { PlateStock, Unit } from '@/domain/types';

/** Fila de inventario completa (evita repetir `on`/`unit` en cada caso). */
function stock(w: number, discs: number, unit: Unit = 'kg', on = true): PlateStock {
  return { w, unit, discs, on };
}

describe('1–6 · normalización y capacidad', () => {
  it('1 · inventory() ignora discos apagados y filas con discs:0', () => {
    const plates = [
      stock(20, 4, 'kg', false),
      stock(10, 0),
      stock(5, 2, 'kg', true),
    ];
    expect(inventory(plates)).toEqual([{ kg: 5, discs: 2, srcW: 5, srcUnit: 'kg' }]);
  });

  it('2 · migra pairs de la v1 a discs', () => {
    expect(normalizePlate({ w: 1.25, unit: 'kg', pairs: 3 })).toEqual({
      w: 1.25,
      unit: 'kg',
      discs: 6,
      pairs: 3,
      on: true,
    });
  });

  it('3 · discs manda sobre un pairs desincronizado', () => {
    const row = normalizePlate({ w: 5, unit: 'kg', discs: 3, pairs: 99 });
    expect(row?.discs).toBe(3);
    expect(row?.pairs).toBe(1);
  });

  it('4 · una fila ilegible se descarta entera', () => {
    expect(normalizePlate({ w: '20', unit: 'kg', pairs: 2 })).toBeNull();
    expect(normalizePlate({ w: 20, unit: 'kg' })).toBeNull();
  });

  it('5 · normalizar dos veces no cuadruplica (idempotencia)', () => {
    const once = normalizePlates([{ w: 2.5, unit: 'kg', pairs: 4 }]);
    const twice = normalizePlates(once);
    expect(twice[0].discs).toBe(8);
    expect(twice[0].pairs).toBe(4);
  });

  it('6 · cap = floor(discos / huecos): db2 → 4, bar → 8', () => {
    const items = inventory([stock(3, 16)]);
    expect(capsFor(items, 'db2')[0].cap).toBe(4);
    expect(capsFor(items, 'bar')[0].cap).toBe(8);
  });
});

describe('7–18 · solver de reparto', () => {
  it('7 · un número impar de discos sobra uno en el reparto simétrico', () => {
    const res = solvePlates(30, { mode: 'bar', plates: [stock(5, 3)], handleKg: 0 });
    expect(res.perHole).toEqual([{ kg: 5, n: 1, srcW: 5, srcUnit: 'kg' }]);
    expect(res.discsPerHole).toBe(1);
    expect(res.usage[0].used).toBe(2);
  });

  it('8 · inventario vacío: solo queda el peso del mango', () => {
    const res = solvePlates(60, {
      mode: 'bar',
      plates: [],
      bars: { olimpica: 20, ez: 0, mancuerna: 0 },
    });
    expect(res.achieveKg).toBe(20);
    expect(res.perHole).toEqual([]);
    expect(res.maxKg).toBe(20);
    expect(res.sideKg).toBe(0);
    expect(res.noPlates).toBe(false);
  });

  it('9 · peso por debajo de la barra devuelve el mínimo real', () => {
    const res = solvePlates(15, {
      mode: 'bar',
      bars: { olimpica: 20, ez: 0, mancuerna: 0 },
      plates: [stock(5, 4)],
    });
    expect(res.sideKg).toBe(0);
    expect(res.achieveKg).toBe(20);
    expect(res.diffKg).toBe(-5);
    expect(res.belowKg).toBeNull();
    expect(res.aboveKg).toBe(30);
  });

  it('10 · margen de 0,1 kg marca el ajuste como exacto', () => {
    const res = solvePlates(2.55, { mode: 'bar', plates: [stock(1.25, 2)], handleKg: 0 });
    expect(res.diffKg).toBe(0.05);
    expect(res.exact).toBe(true);
  });

  it('11 · en empate de distancia gana la suma más ligera', () => {
    const res = solvePlates(5, { mode: 'bar', plates: [stock(5, 2)], handleKg: 0 });
    expect(res.sideKg).toBe(0);
    expect(res.achieveKg).toBe(0);
  });

  it('12 · db2 devuelve el peso de CADA mancuerna', () => {
    const res = solvePlates(14, { mode: 'db2', plates: [stock(5, 4)], handleKg: 2 });
    expect(res.discsPerHole).toBe(1);
    expect(res.discsTotal).toBe(4);
    expect(res.achieveKg).toBe(12);
  });

  it('13 · modo none acepta el peso tal cual', () => {
    const res = solvePlates(37.5, { mode: 'none' });
    expect(res.noPlates).toBe(true);
    expect(res.achieveKg).toBe(37.5);
    expect(res.diffKg).toBe(0);
    expect(res.exact).toBe(true);
    expect(res.perHole).toEqual([]);
  });

  it('14 · peso objetivo en libras se convierte a kg (modo none)', () => {
    const res = solvePlates(100, { mode: 'none', unit: 'lb' });
    expect(res.targetKg).toBeCloseTo(45.359, 3);
    expect(res.achieveKg).toBeCloseTo(45.359, 3);
  });

  it('15 · mezcla de discos kg y lb por enumeración exacta', () => {
    const res = solvePlates(10, {
      mode: 'bar',
      plates: [stock(2.5, 2, 'kg'), stock(5, 2, 'lb')],
      handleKg: 0,
    });
    // 2·(2,5 + 2,26796) = 9,5359 → por debajo del objetivo, con discos reales.
    expect(res.achieveKg).toBeLessThanOrEqual(10);
    expect(res.perHole).toHaveLength(2);
    const lb = res.usage.find((u) => u.srcUnit === 'lb');
    expect(lb?.kg).toBeCloseTo(2.268, 3);
  });

  it('16 · maxLoadable = mango + 2·Σ(cap·kg)', () => {
    const load = maxLoadable({ mode: 'bar', plates: [stock(10, 8)], handleKg: 20 });
    expect(load.sideKg).toBe(40);
    expect(load.totalKg).toBe(100);
    expect(load.per).toBe('lado');
    expect(load.mode).toBe('bar');
  });

  it('17 · belowKg/aboveKg son los vecinos inmediatos de la suma elegida', () => {
    // HALLAZGO: el contrato pedía discs:8 para un objetivo de 12,5 kg por lado,
    // pero con 8 discos la barra solo admite 4 por lado (techo 10 kg totales).
    // El solver devuelve el máximo alcanzable y sus vecinos reales.
    const res = solvePlates(12.5, { mode: 'bar', plates: [stock(1.25, 8)], handleKg: 0 });
    expect(res.sideKg).toBe(5);
    expect(res.achieveKg).toBe(10);
    expect(res.belowKg).toBe(7.5);
    expect(res.aboveKg).toBeNull();
  });

  it('18 · usage cuenta discos usados vs disponibles', () => {
    const res = solvePlates(40, { mode: 'bar', plates: [stock(5, 8)], handleKg: 0 });
    expect(res.usage).toEqual([{ kg: 5, srcW: 5, srcUnit: 'kg', used: 8, have: 8 }]);
    expect(res.discsPerHole).toBe(4);
  });
});

describe('19–24 · modo sugerido y etiquetas', () => {
  it('19 · el modo guardado por el usuario manda sobre la heurística', () => {
    expect(suggestPlateMode({ name: 'Press banca con barra' }, { saved: 'db2' })).toBe('db2');
  });

  it('20 · peso corporal fuerza modo none', () => {
    expect(suggestPlateMode({ name: 'Flexiones con mancuerna', bw: true })).toBe('none');
  });

  it('21 · nombre unilateral de mancuerna sugiere db1', () => {
    expect(suggestPlateMode({ name: 'Remo a una mano con mancuerna' })).toBe('db1');
  });

  it('22 · peso sin color conocido no pinta clase', () => {
    expect(plateTone(7.3)).toBe('');
    expect(plateTone(20)).toBe('p20');
  });

  it('23 · plateSummary agrupa la repetición con ×N', () => {
    const res = {
      perHole: [{ kg: 3, n: 3, srcW: 3, srcUnit: 'kg' }],
    } as Parameters<typeof plateSummary>[0];
    expect(plateSummary(res)).toBe('3 kg ×3');
    expect(
      plateSummary({ perHole: [] } as unknown as Parameters<typeof plateSummary>[0]),
    ).toBe('solo la barra');
  });

  it('24 · etiqueta de disco en libras muestra equivalencia', () => {
    expect(plateLabel(2.268, 5, 'lb', 1)).toBe('2,27 kg (5 lb)');
    expect(plateLabel(2.268, 5, 'lb', 4)).toBe('2,27 kg (5 lb) ×4');
  });
});
