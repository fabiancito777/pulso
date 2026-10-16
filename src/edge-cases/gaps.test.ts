/**
 * gaps.test.ts · cobertura COMPLEMENTARIA de las fichas OFFLINE del contrato
 * `_specs/edge-cases-300.md`.
 *
 * Auditoría previa: las 280 fichas OFFLINE ya están citadas (una por test) en los
 * 16 ficheros de `src/edge-cases/`, así que NINGUNA falta por completo. Lo que sí
 * pasaba es que unos pocos tests solo cubrían parte del `esperado`; aquí se
 * refuerzan esas fichas sin tocar ningún fichero existente ni el código de la app.
 *
 * Fichas reforzadas:
 *   1   · ordering del inventario de mayor a menor
 *   29  · `editSetField` con `''` no arrastra un número a las series de abajo
 *   65  · `prs` guarda `date` y `exId` del mejor 1RM
 *   73  · `totals` expone `time`/`avgDuration`/`streak`/`bestStreak`
 *   79  · `tickRest` emite tic en los 3 últimos segundos (2 s y 1 s incluidos)
 *   151 · `routineFromTemplate` hereda series/reps/rest del ejercicio resuelto
 *   218 · `pickForGroup` con un grupo sin ejercicios devuelve `[]` sin lanzar
 *
 * Todo OFFLINE: sin red y con el reloj inyectado por parámetro.
 */
import { describe, expect, it } from 'vitest';

import { prs, totals } from '@/domain/analytics';
import { equipPreset, findExercise, seedExercises, TEMPLATES } from '@/domain/data';
import { pickForGroup, routineFromTemplate } from '@/domain/plan';
import type { PlanInput } from '@/domain/plan';
import { inventory } from '@/domain/plates';
import { IDLE_REST, tickRest } from '@/domain/rest';
import { editSetField } from '@/domain/session';
import type {
  ActiveEntry,
  ActiveSession,
  ActiveSet,
  PlateStock,
  RestState,
  Session,
  SessionEntry,
  SetLog,
  Settings,
  Unit,
} from '@/domain/types';

const stock = (w: number, discs: number, unit: Unit = 'kg', on = true): PlateStock => ({
  w,
  unit,
  discs,
  on,
});

function log(weight: number, reps: number, done = true): SetLog {
  return { weight, reps, done, rpe: null };
}

function sEntry(exId: string, sets: SetLog[], over: Partial<SessionEntry> = {}): SessionEntry {
  return { exId, name: exId, sets, ...over };
}

function sess(date: string, entries: SessionEntry[], over: Partial<Session> = {}): Session {
  return { id: `s-${date}`, date, startedAt: `${date}T10:00:00`, unit: 'kg', entries, ...over };
}

function aSet(weight: number | '', reps: number | ''): ActiveSet {
  return { weight, reps, done: false, ts: null, rpe: null };
}

function aEntry(exId: string, name: string, sets: ActiveSet[]): ActiveEntry {
  return { exId, name, restSec: 90, repMin: 8, repMax: 12, sets, notes: '' };
}

function aSession(entries: ActiveEntry[]): ActiveSession {
  return {
    id: 'live_1',
    routineId: null,
    name: 'Test',
    startedAt: '2026-01-01T10:00:00.000Z',
    unit: 'kg',
    entries,
    notes: '',
    dayIso: '2026-01-01',
    source: 'manual',
  };
}

const NOW = 1_700_000_000_000;

function rest(over: Partial<RestState> = {}): RestState {
  return { ...IDLE_REST, running: true, endsAt: NOW + 90_000, total: 90, label: 'Press', ...over };
}

describe('gaps · plates (1)', () => {
  it('1 · inventory ordena de mayor a menor y descarta apagados y discs:0', () => {
    const plates = [stock(1.25, 2), stock(20, 4, 'kg', false), stock(5, 2), stock(10, 0)];
    expect(inventory(plates).map((item) => item.kg)).toEqual([5, 1.25]);
  });
});

describe('gaps · session (29)', () => {
  it('29 · editSetField con "" no arrastra un número a las series de abajo', () => {
    const s = aSession([aEntry('a', 'Press', [aSet(20, 8), aSet('', ''), aSet('', '')])]);
    const next = editSetField(s, 0, 0, 'weight', '');
    expect(next.entries[0].sets[0].weight).toBe('');
    expect(next.entries[0].sets[1].weight).toBe('');
    expect(typeof next.entries[0].sets[1].weight).toBe('string');
  });
});

describe('gaps · analytics (65, 73)', () => {
  it('65 · prs guarda date y exId del mejor 1RM', () => {
    const s = sess('2026-03-01', [sEntry('ex', [log(100, 5), log(110, 3)])]);
    const record = prs([s])['ex'];
    expect(record.exId).toBe('ex');
    expect(record.date).toBe('2026-03-01');
    expect(record.e1rm).toBeCloseTo(121, 1);
  });

  it('73 · totals expone time, avgDuration, streak y bestStreak', () => {
    const a = sess('2026-03-01', [sEntry('ex', [log(20, 10)])], {
      startedAt: '2026-03-01T10:00:00',
      endedAt: '2026-03-01T11:00:00',
    });
    const b = sess('2026-03-02', [sEntry('ex', [log(30, 10)])], {
      startedAt: '2026-03-02T10:00:00',
      endedAt: '2026-03-02T12:00:00',
    });
    const t = totals([a, b], '2026-03-02');
    expect(t.volume).toBe(500);
    expect(t.time).toBe(3 * 3_600_000);
    expect(t.avgDuration).toBe(1.5 * 3_600_000);
    expect(t.streak).toBe(2);
    expect(t.bestStreak).toBe(2);
  });
});

describe('gaps · rest (79)', () => {
  it('79 · tickRest emite tic en 2 s y 1 s (todos los últimos 3 s)', () => {
    expect(tickRest(rest({ endsAt: NOW + 2000 }), NOW, { countdownTick: true }).tick).toBe(true);
    expect(tickRest(rest({ endsAt: NOW + 1000 }), NOW, { countdownTick: true }).tick).toBe(true);
  });
});

describe('gaps · plan (151, 218)', () => {
  const planInput = (exercises: PlanInput['exercises']): PlanInput => ({
    settings: { units: 'kg', increment: 2.5 } as unknown as Settings,
    exercises,
    equipment: equipPreset('todo'),
    sessions: [],
  });

  it('151 · routineFromTemplate hereda series/reps/rest del ejercicio resuelto', () => {
    const library = seedExercises();
    const draft = routineFromTemplate(planInput(library), TEMPLATES[0].id);
    expect(draft).not.toBeNull();
    expect(draft?.items.length).toBeGreaterThan(0);
    for (const item of draft?.items ?? []) {
      const ex = findExercise(library, item.exId);
      expect(ex).not.toBeNull();
      expect(item.sets).toBe(ex?.sets);
      expect(item.repMin).toBe(ex?.repMin);
      expect(item.repMax).toBe(ex?.repMax);
      expect(item.rest).toBe(ex?.rest);
    }
  });

  it('218 · pickForGroup con un grupo sin ejercicios devuelve [] sin lanzar', () => {
    const input = planInput(seedExercises());
    expect(() => pickForGroup(input, 'grupo-inexistente', 1)).not.toThrow();
    expect(pickForGroup(input, 'grupo-inexistente', 1)).toEqual([]);
  });
});
