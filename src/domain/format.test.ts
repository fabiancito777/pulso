import { describe, expect, it } from 'vitest';

import { addDays, diffDays, dowIdx, iso, parse, startOfWeek, timeAgo, weekDates } from './dates';
import { fmtClock, fmtDur, fmtMmss, fmtN, fmtVol, inputNum } from './format';
import { num, round, sum } from './num';
import { fromKg, roundToStep, toKg, unitIncrement } from './units';

describe('números', () => {
  it('convierte y cae al valor por defecto', () => {
    expect(num('2,5')).toBe(2); // la coma de es-ES no es un número para parseFloat…
    expect(num('2.5')).toBe(2.5);
    expect(num('', 7)).toBe(7);
  });

  it('redondea con epsilon (2.4999999 no se va a 2,4)', () => {
    expect(round(2.4999999)).toBe(2.5);
    expect(round(1.005, 2)).toBe(1.01);
    expect(sum([{ v: 1 }, { v: 2 }], (x) => x.v)).toBe(3);
  });
});

describe('formato es-ES', () => {
  it('usa la coma decimal', () => {
    expect(fmtN(18.5)).toBe('18,5');
    expect(fmtN(18.5, 2)).toBe('18,5');
    expect(fmtN(1000.4, 0)).toBe('1.000');
  });

  it('abrevia volumen y duraciones', () => {
    expect(fmtVol(1200)).toBe('1,2k');
    expect(fmtDur(90_000)).toBe('1m');
    expect(fmtDur(3_600_000)).toBe('1h 00m');
  });

  it('reloj en mm:ss y h:mm:ss', () => {
    expect(fmtClock(75)).toBe('1:15');
    expect(fmtClock(3675)).toBe('1:01:15');
    expect(fmtMmss(5)).toBe('0:05');
  });

  it('inputNum devuelve punto decimal (los <input type=number> descartan la coma)', () => {
    expect(inputNum(2.5)).toBe('2.5');
    expect(inputNum('')).toBe('');
    expect(inputNum(undefined)).toBe('');
  });
});

describe('unidades', () => {
  it('convierte kg ↔ lb en los dos sentidos', () => {
    expect(toKg(45, 'lb')).toBeCloseTo(20.4117, 3);
    expect(fromKg(20.4117, 'lb')).toBeCloseTo(45, 3);
    expect(toKg(20, 'kg')).toBe(20);
  });

  it('100 lb pesa 45,359237 kg (comprobación del auto-test de la v1)', () => {
    expect(toKg(100, 'lb')).toBeCloseTo(45.359237, 5);
  });

  it('el salto de los botones depende de la unidad', () => {
    expect(unitIncrement('kg')).toBe(2.5);
    expect(unitIncrement('lb')).toBe(5);
    expect(roundToStep(41.1, 'kg')).toBe(41.25);
    expect(roundToStep(41, 'lb')).toBe(40);
  });
});

describe('fechas ISO locales', () => {
  it('no se desplaza de día por la zona horaria', () => {
    const d = new Date(2026, 8, 16, 0, 30); // 16-sep-2026 00:30 local
    expect(iso(d)).toBe('2026-09-16');
    expect(parse('2026-09-16').getDate()).toBe(16);
  });

  it('suma días y calcula diferencias', () => {
    expect(addDays('2026-09-16', 3)).toBe('2026-09-19');
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31');
    expect(diffDays('2026-09-19', '2026-09-16')).toBe(3);
  });

  it('la semana empieza en lunes', () => {
    expect(dowIdx('2026-09-20')).toBe(6); // domingo
    expect(startOfWeek('2026-09-20')).toBe('2026-09-14');
    expect(weekDates('2026-09-16')).toHaveLength(7);
    expect(weekDates('2026-09-16')[0]).toBe('2026-09-14');
  });
});

describe('timeAgo', () => {
  /* El reloj se inyecta: `Math.round` sube «ahora» a «hace 1 min» justo en 30 s
     y «hace 1 h» a «hace 1 d» en 23 h 30 min, así que fijando `now` esos
     umbrales quedan probados sin depender del reloj real. */
  const NOW = new Date(2026, 9, 3, 12, 0, 0).getTime();
  const ago = (s: number): string => timeAgo(new Date(NOW - s * 1000).toISOString(), NOW);

  it('menos de 30 s es «ahora» (y lo mismo un timestamp futuro)', () => {
    expect(ago(0)).toBe('ahora');
    expect(ago(29)).toBe('ahora');
    expect(timeAgo(new Date(NOW + 60_000).toISOString(), NOW)).toBe('ahora');
    expect(ago(30)).toBe('hace 1 min');
    expect(ago(60)).toBe('hace 1 min');
  });

  it('minutos hasta 59 y de ahí en adelante en horas redondeadas', () => {
    expect(ago(59 * 60)).toBe('hace 59 min');
    expect(ago(60 * 60)).toBe('hace 1 h');
    expect(ago(89 * 60)).toBe('hace 1 h');
    expect(ago(90 * 60)).toBe('hace 2 h');
    expect(ago(23 * 3600)).toBe('hace 23 h');
  });

  it('a partir de 23 h 30 min el redondeo ya habla en días', () => {
    expect(ago(23 * 3600 + 30 * 60)).toBe('hace 1 d');
    expect(ago(24 * 3600)).toBe('hace 1 d');
    expect(ago(36 * 3600)).toBe('hace 2 d');
    expect(ago(48 * 3600)).toBe('hace 2 d');
  });
});
