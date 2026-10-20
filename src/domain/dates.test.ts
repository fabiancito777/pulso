import { describe, expect, it } from 'vitest';

import { addDays, addMonths, iso, parse, relative, today } from './dates';

describe('iso / parse', () => {
  it('una fecha YYYY-MM-DD se interpreta como local (no se desplaza de día)', () => {
    expect(iso('2026-09-24')).toBe('2026-09-24');
    expect(iso('2026-01-01')).toBe('2026-01-01');
  });

  it('parse("") devuelve la medianoche local de hoy, no la hora actual', () => {
    const d = parse('');
    expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([
      0, 0, 0, 0,
    ]);
    expect(iso(d)).toBe(today());
  });
});

describe('addMonths', () => {
  it('acota el día al último del mes destino (no desborda al siguiente)', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-15', 1)).toBe('2026-02-15');
    expect(addMonths('2026-01-31', 0)).toBe('2026-01-31');
  });
});

describe('relative', () => {
  it('las fechas pasadas van «hace» y las futuras «en»', () => {
    expect(relative(today())).toBe('hoy');
    expect(relative(addDays(today(), -1))).toBe('ayer');
    expect(relative(addDays(today(), -3))).toBe('hace 3 días');
    expect(relative(addDays(today(), 1))).toBe('mañana');
    expect(relative(addDays(today(), 3))).toBe('en 3 días');
  });
});
