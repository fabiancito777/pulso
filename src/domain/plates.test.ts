/**
 * Calculadora de discos: las comprobaciones que en la v1 vivían dentro del
 * auto-test del navegador (`legacy/js/app.js` → `selfTest()`), ahora como tests
 * de verdad, que se ejecutan sin navegador y con el estado explícito.
 */
import { describe, expect, it } from 'vitest';

import { PLATES_DEFAULT } from './defaults';
import { KG_PER_LB, toKg } from './units';
import {
  capsFor,
  inventory,
  maxLoadable,
  PLATE_MODE_KEYS,
  plateSummary,
  solvePlates,
  suggestPlateMode,
} from './plates';

const plates = PLATES_DEFAULT;

describe('inventario', () => {
  it('cuenta pares y se queda con lo que está disponible', () => {
    const items = inventory([
      { w: 3, unit: 'kg', pairs: 8, on: true },
      { w: 10, unit: 'kg', pairs: 2, on: false },
      { w: 0, unit: 'kg', pairs: 4, on: true },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.pairs).toBe(8);
  });

  it('ordena de más pesado a más ligero y convierte lb a kg', () => {
    const items = inventory(plates);
    expect(items.map((p) => p.kg).map((k) => Math.round(k * 1000) / 1000)).toEqual([
      3, 2.5, 2.268, 1.25, 1.134,
    ]);
    expect(Math.abs(toKg(45, 'lb') - 20.4117)).toBeLessThan(0.001);
    expect(KG_PER_LB).toBeCloseTo(0.45359237, 8);
  });

  it('cada hueco admite 2·pares/huecos discos', () => {
    const caps = (mode: string) => capsFor(inventory(plates), mode)[0]?.cap;
    expect(caps('bar')).toBe(8);
    expect(caps('db1')).toBe(8);
    /* dos mancuernas necesitan el doble de discos para el mismo peso: es real */
    expect(caps('db2')).toBe(4);
  });
});

describe('solvePlates', () => {
  it('100 kg con barra de 20: lo más cercano sin inventar discos', () => {
    const res = solvePlates(100, { plates, handleKg: 20 });
    expect(Math.abs(res.diffKg)).toBeLessThanOrEqual(0.7);
    expect(res.perHole.every((p) => p.n > 0 && p.n <= 8)).toBe(true);
    expect(plateSummary(res)).toContain('kg');
  });

  it('afina hasta ~50 g cuando el inventario lo permite', () => {
    /* 103 kg se resuelve con 8×3 + 2×2,5 + 4×5 lb + 3×2,5 lb por lado */
    const res = solvePlates(103, { plates, handleKg: 20 });
    expect(Math.abs(res.diffKg)).toBeLessThanOrEqual(0.1);
    expect(res.exact).toBe(true);
  });

  it('avisa de la diferencia cuando el peso no es alcanzable', () => {
    /* por debajo del disco más ligero que hay */
    const res = solvePlates(1, { plates, handleKg: 0 });
    expect(res.exact).toBe(false);
    expect(res.diffKg).toBeGreaterThan(0.1);
    expect(res.aboveKg).not.toBeNull();
  });

  it('marca exacto cuando el peso es alcanzable', () => {
    expect(solvePlates(6, { plates, handleKg: 0 }).exact).toBe(true);
  });

  it('resuelve inventario mixto kg + lb', () => {
    const mixed = [
      { w: 45, unit: 'lb' as const, pairs: 2, on: true },
      { w: 10, unit: 'kg' as const, pairs: 1, on: true },
    ];
    const objetivo = 20 + 2 * (toKg(45, 'lb') + 10);
    const res = solvePlates(objetivo, { plates: mixed, handleKg: 20 });
    expect(res.exact).toBe(true);
    expect(res.perHole).toHaveLength(2);
  });

  it('18 kg en 2 mancuernas = 3 discos de 3 kg por extremo', () => {
    const res = solvePlates(18, { plates, mode: 'db2' });
    expect(res.exact).toBe(true);
    expect(res.perHole).toHaveLength(1);
    expect(res.perHole[0]?.n).toBe(3);
    /* el mismo reparto va en los 4 extremos: 12 discos de los 16 que hay */
    expect(res.discsPerHole).toBe(3);
    expect(res.discsTotal).toBe(12);
    expect(res.usage[0]).toMatchObject({ used: 12, have: 16 });
  });

  it('en 2 mancuernas el peso devuelto es el de CADA mancuerna', () => {
    expect(solvePlates(18, { plates, mode: 'db2' }).achieveKg).toBe(18);
  });

  it('barra de 60 kg: reparte en 3 medidas y lo dice en total', () => {
    const res = solvePlates(60, { plates, mode: 'bar' });
    expect(res.exact).toBe(true);
    expect(res.sideKg).toBe(30);
    expect(res.discsPerHole).toBe(13);
    expect(res.discsTotal).toBe(26);
    expect(res.perHole.map((p) => p.n)).toEqual([5, 4, 4]);
  });

  it('el reparto nunca pide más discos de los que tienes', () => {
    for (const mode of PLATE_MODE_KEYS) {
      for (const target of [7, 12.5, 18, 23, 31, 44, 57.5, 105]) {
        const res = solvePlates(target, { plates, mode });
        for (const u of res.usage) expect(u.used).toBeLessThanOrEqual(u.have);
      }
    }
  });

  it('nunca inventa un peso por encima del máximo montable', () => {
    for (const mode of ['bar', 'db1', 'db2']) {
      const max = maxLoadable({ plates, mode }).totalKg;
      const res = solvePlates(999, { plates, mode });
      expect(res.achieveKg).toBeLessThanOrEqual(max + 0.001);
    }
  });

  it('con dos mancuernas se alcanza menos peso que con una (a propósito)', () => {
    const one = solvePlates(20, { plates, mode: 'db1' });
    const two = solvePlates(20, { plates, mode: 'db2' });
    expect(one.maxKg).toBeGreaterThan(two.maxKg);
    expect(Math.abs(one.diffKg)).toBeLessThanOrEqual(0.7);
  });

  it('el máximo es barra + 2 lados del inventario', () => {
    const esperado = 2 * (8 * 3 + 4 * 2.5 + 4 * 1.25 + 4 * toKg(5, 'lb') + 4 * toKg(2.5, 'lb'));
    expect(Math.abs(maxLoadable({ plates }).totalKg - esperado)).toBeLessThan(0.01);
    /* en db2 el máximo también es por mancuerna */
    expect(maxLoadable({ plates, mode: 'db2' }).totalKg).toBeCloseTo(52.608, 3);
  });

  it('sin discos usa el peso pedido tal cual', () => {
    const res = solvePlates(37.5, { plates, mode: 'none' });
    expect(res.noPlates).toBe(true);
    expect(res.achieveKg).toBe(37.5);
    expect(res.perHole).toHaveLength(0);
  });

  it('el peso del mango sale de los ajustes de barras y se puede forzar', () => {
    const bars = { olimpica: 20, ez: 7.5, mancuerna: 1.5 };
    expect(solvePlates(100, { plates, bars, mode: 'bar' }).handleKg).toBe(20);
    expect(solvePlates(100, { plates, bars, mode: 'bar', barKey: 'ez' }).handleKg).toBe(7.5);
    expect(solvePlates(20, { plates, bars, mode: 'db2' }).handleKg).toBe(1.5);
    expect(solvePlates(100, { plates, bars, mode: 'bar', handleKg: 0 }).handleKg).toBe(0);
  });

  it('ofrece alternativas por encima y por debajo', () => {
    const res = solvePlates(103, { plates, handleKg: 20 });
    expect(res.belowKg).not.toBeNull();
    expect(res.aboveKg).not.toBeNull();
    expect(res.belowKg as number).toBeLessThan(res.achieveKg);
    expect(res.aboveKg as number).toBeGreaterThan(res.achieveKg);
  });

  it('un inventario vacío no rompe: solo queda la barra', () => {
    const res = solvePlates(60, { plates: [], mode: 'bar' });
    expect(res.perHole).toHaveLength(0);
    expect(res.achieveKg).toBe(0);
    expect(plateSummary(res)).toBe('solo la barra');
  });
});

describe('suggestPlateMode', () => {
  it('acierta según el nombre del ejercicio', () => {
    expect(suggestPlateMode({ name: 'Remo con mancuerna a una mano' })).toBe('db1');
    expect(suggestPlateMode({ name: 'Press de banca con barra', equip: 'barra_olimpica' })).toBe(
      'bar',
    );
    expect(suggestPlateMode({ name: 'Press de banca con mancuernas' })).toBe('db2');
    expect(suggestPlateMode({ name: 'Dominadas', bw: true })).toBe('none');
  });

  it('el modo elegido a mano tiene prioridad', () => {
    expect(suggestPlateMode({ name: 'Press de banca con barra' }, { saved: 'db2' })).toBe('db2');
  });

  it('sin pistas usa lo que haya en el equipo', () => {
    expect(suggestPlateMode({ name: 'Máquina rara' }, { hasAdjustableDumbbells: true })).toBe('db2');
    expect(suggestPlateMode({ name: 'Máquina rara' }, { hasBarbell: true })).toBe('bar');
    expect(suggestPlateMode({ name: 'Máquina rara' })).toBe('none');
  });
});
