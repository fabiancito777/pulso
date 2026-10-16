/**
 * Edge cases 51–74 de `_specs/edge-cases-300.md` · `domain/analytics`.
 *
 * Todo puro y por parámetro. Trampas heredadas que se fijan: una serie sin `done`
 * no cuenta, `e1rm(0, …)` es 0 y la sugerencia de peso sube un incremento cuando
 * el cálculo no mejora.
 */
import { describe, expect, it } from 'vitest';

import {
  bestStreak,
  byDow,
  daysSince,
  durationOf,
  e1rm,
  exerciseSeries,
  exerciseSummary,
  groupSets,
  groupVolume,
  lastEntry,
  lastTrained,
  prs,
  recentExercises,
  sessionsSince,
  setVolumeKg,
  streak,
  suggestWeight,
  totals,
  volumeOf,
  weeklySeries,
} from '@/domain/analytics';
import type { Exercise, Session, SessionEntry, SetLog } from '@/domain/types';

function log(weight: number, reps: number, done = true, rpe?: number): SetLog {
  return { weight, reps, done, rpe: rpe ?? null };
}

function sEntry(
  exId: string,
  sets: SetLog[],
  over: Partial<SessionEntry> = {},
): SessionEntry {
  return { exId, name: exId, sets, ...over };
}

function sess(date: string, entries: SessionEntry[], over: Partial<Session> = {}): Session {
  return {
    id: `s-${date}`,
    date,
    startedAt: `${date}T10:00:00.000Z`,
    unit: 'kg',
    entries,
    ...over,
  };
}

function ex(id: string, group = 'pecho'): Exercise {
  return {
    id,
    name: id,
    group,
    equip: '',
    type: 'compuesto',
    sets: 3,
    repMin: 8,
    repMax: 12,
    rest: 90,
    allowed: true,
    custom: false,
    bw: false,
    tags: [],
    tips: '',
  };
}

describe('51–55 · primitivas', () => {
  it('51 · Epley con 1 repetición devuelve el peso tal cual', () => {
    expect(e1rm(100, 1)).toBe(100);
  });

  it('52 · e1rm sin peso/reps es 0, no NaN', () => {
    expect(e1rm(0, 5)).toBe(0);
    expect(e1rm(50, 0)).toBe(0);
    expect(e1rm('', '')).toBe(0);
  });

  it('53 · una serie sin done no suma volumen', () => {
    expect(setVolumeKg(log(20, 10, false), 'kg')).toBe(0);
  });

  it('54 · volumeOf convierte la unidad de cada sesión', () => {
    const s = sess('2026-03-01', [sEntry('ex', [log(100, 5)])], { unit: 'lb' });
    expect(volumeOf(s)).toBeCloseTo(226.796, 2);
  });

  it('55 · durationOf de una sesión abierta usa now', () => {
    const s = sess('2026-03-01', [], { startedAt: '2026-01-01T10:00:00.000Z' });
    const now = new Date('2026-01-01T10:10:00.000Z').getTime();
    expect(durationOf(s, now)).toBe(600000);
  });
});

describe('56–60 · ventanas, grupos y staleness', () => {
  it('56 · sessionsSince(days=1) incluye solo hoy', () => {
    const sessions = [
      sess('2026-03-09', []),
      sess('2026-03-10', []),
    ];
    const out = sessionsSince(sessions, 1, '2026-03-10');
    expect(out.map((s) => s.date)).toEqual(['2026-03-10']);
  });

  it('57 · groupVolume usa entry.group si el ejercicio no está en la biblioteca', () => {
    const s = sess('2026-03-01', [
      sEntry('borrado', [log(20, 10)], { group: 'espalda' }),
    ]);
    expect(groupVolume([s], [])).toEqual({ espalda: 200 });
  });

  it('58 · groupSets cuenta solo series hechas', () => {
    const s = sess('2026-03-01', [
      sEntry('ex', [log(20, 10), log(20, 10), log(20, 10, false)], { group: 'pecho' }),
    ]);
    expect(groupSets([s], [])).toEqual({ pecho: 2 });
  });

  it('59 · lastTrained guarda la fecha más reciente', () => {
    const sessions = [
      sess('2026-01-01', [sEntry('ex', [log(20, 10)], { group: 'pecho' })]),
      sess('2026-02-01', [sEntry('ex', [log(20, 10)], { group: 'pecho' })]),
    ];
    expect(lastTrained(sessions, [])).toEqual({ pecho: '2026-02-01' });
  });

  it('60 · daysSince con fecha futura es negativo; null → null', () => {
    expect(daysSince('2026-03-13', '2026-03-10')).toBe(-3);
    expect(daysSince(null, '2026-03-10')).toBeNull();
  });
});

describe('61–64 · semanas y rachas', () => {
  it('61 · weeklySeries rellena semanas vacías con ceros y empieza en lunes', () => {
    const sessions = [sess('2026-03-09', [sEntry('ex', [log(20, 10)])])];
    const out = weeklySeries(sessions, 3, '2026-03-11');
    expect(out).toHaveLength(3);
    expect(out.map((w) => w.iso)).toEqual(['2026-02-23', '2026-03-02', '2026-03-09']);
    expect(out.map((w) => w.sessions)).toEqual([0, 0, 1]);
  });

  it('62 · weeklySeries acota weeks a ≥ 1', () => {
    expect(weeklySeries([], 0, '2026-03-11')).toHaveLength(1);
    expect(weeklySeries([], -5, '2026-03-11')).toHaveLength(1);
  });

  it('63 · la racha empieza ayer si hoy aún no has entrenado', () => {
    const sessions = [sess('2026-03-09', []), sess('2026-03-08', [])];
    expect(streak(sessions, '2026-03-10')).toBe(2);
  });

  it('64 · bestStreak encuentra el tramo más largo del historial', () => {
    const sessions = [
      sess('2026-01-01', []),
      sess('2026-01-02', []),
      sess('2026-01-03', []),
      ...['10', '11', '12', '13', '14'].map((d) => sess(`2026-03-${d}`, [])),
    ];
    expect(bestStreak(sessions)).toBe(5);
  });
});

describe('65–69 · récords e historial', () => {
  it('65 · prs se queda con el mejor 1RM por ejercicio', () => {
    const s = sess('2026-03-01', [sEntry('ex', [log(100, 5), log(110, 3)])]);
    const record = prs([s])['ex'];
    expect(record.e1rm).toBeCloseTo(121, 1);
    expect(record.weight).toBe(110);
    expect(record.reps).toBe(3);
  });

  it('66 · prs ignora series sin done o sin reps', () => {
    const s = sess('2026-03-01', [sEntry('ex', [log(200, 1, false), log(50, 0, true)])]);
    expect(prs([s])['ex']).toBeUndefined();
  });

  it('67 · exerciseSeries va de la más antigua a la más reciente', () => {
    const sessions = [sess('2026-03-01', [sEntry('ex', [log(60, 5)])]), sess('2026-01-01', [sEntry('ex', [log(50, 5)])])];
    expect(exerciseSeries(sessions, 'ex').map((p) => p.iso)).toEqual(['2026-01-01', '2026-03-01']);
  });

  it('68 · lastEntry devuelve la sesión más reciente; null si no aparece', () => {
    const sessions = [sess('2026-01-01', [sEntry('ex', [log(50, 5)])]), sess('2026-03-01', [sEntry('ex', [log(60, 5)])])];
    expect(lastEntry(sessions, 'ex')?.session.date).toBe('2026-03-01');
    expect(lastEntry(sessions, 'otro')).toBeNull();
  });

  it('69 · exerciseSummary marca lastIso:null si nunca se marcó serie', () => {
    const s = sess('2026-03-01', [sEntry('ex', [log(20, 10, false)])]);
    expect(exerciseSummary([s]).get('ex')).toEqual({ lastIso: null, n: 0, e1rm: 0 });
  });
});

describe('70–74 · sugerencia, totales y repartos', () => {
  it('70 · suggestWeight sin historial devuelve 0', () => {
    expect(suggestWeight([], 'x', { unit: 'kg' })).toMatchObject({
      weight: 0,
      kg: 0,
      basis: 'sin historial',
    });
  });

  it('71 · cálculo igual o por encima → sube un incremento', () => {
    const s = sess('2026-03-01', [sEntry('ex', [log(100, 8)])]);
    expect(suggestWeight([s], 'ex', { unit: 'kg', targetReps: 8 }).weight).toBe(102.5);
  });

  it('72 · pedir más repeticiones baja el peso de verdad', () => {
    const s = sess('2026-03-01', [sEntry('ex', [log(100, 5)])]);
    expect(suggestWeight([s], 'ex', { unit: 'kg', targetReps: 12 }).weight).toBeLessThan(100);
  });

  it('73 · totals agrega y expone firstDate', () => {
    const sessions = [
      sess('2026-02-01', [sEntry('ex', [log(20, 10)])]),
      sess('2026-03-01', [sEntry('ex', [log(30, 10)])]),
    ];
    const t = totals(sessions, '2026-03-02');
    expect(t.sessions).toBe(2);
    expect(t.volume).toBe(500);
    expect(t.sets).toBe(2);
    expect(t.firstDate).toBe('2026-02-01');
  });

  it('74 · byDow empieza en lunes y recentExercises no repite', () => {
    const sessions = [
      sess('2026-03-09', [sEntry('ex', [log(20, 10)])]),
      sess('2026-03-10', [sEntry('ex', [log(20, 10)])]),
    ];
    expect(byDow(sessions)).toEqual([1, 1, 0, 0, 0, 0, 0]);
    const recent = recentExercises(sessions, [ex('ex')]);
    expect(recent).toHaveLength(1);
    expect(recent[0].date).toBe('2026-03-10');
  });
});
