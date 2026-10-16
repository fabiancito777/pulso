/**
 * Edge cases 91–104 de `_specs/edge-cases-300.md` · `domain/dates`.
 *
 * Fechas de calendario en ISO LOCAL: nunca `toISOString().slice(0,10)`.
 */
import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMonths,
  diffDays,
  dow,
  dowIdx,
  dowLong,
  iso,
  label,
  parse,
  relative,
  startOfWeek,
  timeAgo,
  today,
  weekDates,
} from '@/domain/dates';

describe('91–99 · formato y aritmética', () => {
  it('91 · iso() usa la fecha LOCAL, no UTC', () => {
    expect(iso(new Date(2026, 2, 10, 23, 30))).toBe('2026-03-10');
  });

  it('92 · parse("") no devuelve Invalid Date', () => {
    expect(Number.isNaN(parse('').getTime())).toBe(false);
    expect(Number.isNaN(parse(undefined).getTime())).toBe(false);
  });

  it('93 · addDays cruza el cambio de mes', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('94 · addMonths acota el día al último del mes', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-15', 1)).toBe('2026-02-15');
  });

  it('95 · diffDays es la resta en días de calendario', () => {
    expect(diffDays('2026-03-10', '2026-03-01')).toBe(9);
  });

  it('96 · dowIdx lunes = 0 y domingo = 6', () => {
    expect(dowIdx('2026-03-09')).toBe(0);
    expect(dowIdx('2026-03-15')).toBe(6);
  });

  it('97 · startOfWeek devuelve el lunes', () => {
    expect(startOfWeek('2026-03-15')).toBe('2026-03-09');
  });

  it('98 · weekDates devuelve 7 días desde el lunes', () => {
    const days = weekDates('2026-03-11');
    expect(days).toHaveLength(7);
    expect(days[0]).toBe('2026-03-09');
    expect(days[6]).toBe('2026-03-15');
  });

  it('99 · label respeta los estilos', () => {
    expect(label('2026-03-10', 'short')).toBe('mar 10');
    expect(label('2026-03-10', 'medium')).toBe('10 mar 2026');
    expect(label('2026-03-10', 'month')).toBe('marzo de 2026');
    expect(label('2026-03-10', 'long')).toContain('marzo');
  });
});

describe('100–104 · relativos, timestamps y DST', () => {
  it('100 · relative distingue hoy / ayer / fecha', () => {
    expect(relative(today())).toBe('hoy');
    expect(relative(addDays(today(), -1))).toBe('ayer');
    expect(relative(addDays(today(), -3))).toBe('hace 3 días');
    expect(relative(addDays(today(), 1))).toBe('mañana');
  });

  it('101 · timeAgo mide desde un timestamp', () => {
    const now = new Date('2026-03-10T12:00:00.000Z').getTime();
    const ts = new Date(now - 90_000).toISOString();
    // HALLAZGO: 90 s son 1,5 min y `Math.round` los lleva a "hace 2 min".
    expect(timeAgo(ts, now)).toBe('hace 2 min');
  });

  it('102 · iso() acepta string y number', () => {
    expect(iso('2026-03-10T12:00:00')).toBe('2026-03-10');
    expect(iso(Date.now())).toBe(today());
  });

  it('103 · addDays sobre el cambio de hora no salta de día', () => {
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
  });

  it('104 · dow/dowLong hacen wrap-around correcto', () => {
    expect(dow('2026-03-15')).toBe('dom');
    expect(dow('2026-03-09')).toBe('lun');
    expect(dowLong('2026-03-15')).toBe('domingo');
    expect(dowLong('2026-03-09')).toBe('lunes');
  });
});
