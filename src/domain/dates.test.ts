import { describe, expect, it } from 'vitest';

import { addDays, addMonths, relative, today } from './dates';

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
