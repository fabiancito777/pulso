import { describe, expect, it } from 'vitest';

import type { Exercise, Session, SessionEntry, SetLog } from '@/domain/types';
import type { Routine, ScheduleDay } from '@/state/store';
import {
  autoPlanEngine,
  dayState,
  dayTypeLabel,
  monthDays,
  normalizePlan,
  parsePlan,
  planEngine,
  planOrigin,
  weekSubtitle,
} from '@/ui/calendar-helpers';
import {
  greeting,
  repeatItems,
  suggestionRows,
  suggestionSource,
  todayPlan,
  weekCells,
} from '@/ui/hoy-helpers';
import { orderPickerItems, visiblePickerItems } from '@/ui/picker-helpers';
import {
  bounded,
  matchExercises,
  nextFreeDay,
  scheduleRoutinePatch,
  sourceBadge,
  weightOrNull,
} from '@/ui/routines-helpers';
import type { RoutineSuggestion } from '@/ui/routines-helpers';

function ex(id: string, name: string, group = 'pecho', extra: Partial<Exercise> = {}): Exercise {
  return {
    id,
    name,
    group,
    equip: '',
    type: 'compuesto',
    sets: 3,
    repMin: 8,
    repMax: 12,
    rest: 90,
    allowed: true,
    custom: false,
    bw: true,
    tags: [],
    tips: '',
    ...extra,
  };
}

function log(weight: number, reps: number): SetLog {
  return { weight, reps, done: true, rpe: null };
}

function entry(exId: string, sets: SetLog[]): SessionEntry {
  return { exId, name: exId, sets };
}

function sess(date: string, entries: SessionEntry[]): Session {
  return { id: `s-${date}`, date, startedAt: `${date}T10:00:00.000Z`, unit: 'kg', entries };
}

function routine(id: string, name: string): Routine {
  return { id, name, items: [], source: 'manual' };
}

const day = (over: Partial<ScheduleDay>): ScheduleDay => ({ ...over });
const schedule = (over: Record<string, ScheduleDay>): Record<string, ScheduleDay> => over;

describe('ui:calendar (269–276)', () => {
  it('269 · dayState prioriza done sobre planificado', () => {
    expect(dayState(day({ status: 'done' }), 0)).toBe('done');
    expect(dayState(day({ status: 'done' }), 1)).toBe('done');
  });

  it('270 · dayState de un día libre es free', () => {
    expect(dayState(null, 0)).toBe('free');
    expect(dayState(day({}), 0)).toBe('free');
  });

  it('271 · dayTypeLabel cae al estado si no hay tipo', () => {
    const label = dayTypeLabel(day({}), 'done');
    expect(label).toBeTruthy();
    expect(label).toBe('Sesión');
  });

  it('272 · weekSubtitle cuenta hechos y planificados', () => {
    const text = weekSubtitle('2026-03-02', ['done', 'planned', 'free', 'done']);
    expect(text).toContain('2/3 completados');
  });

  it('273 · monthDays cubre el mes con bisiesto', () => {
    expect(monthDays('2026-02')).toHaveLength(28);
    const bisiesto = monthDays('2028-02');
    expect(bisiesto).toHaveLength(29);
    expect(bisiesto[0]).toBe('2028-02-01');
    expect(bisiesto[28]).toBe('2028-02-29');
  });

  it('274 · normalizePlan/parsePlan aceptan el JSON del coach', () => {
    const text = JSON.stringify({
      source: 'ia',
      rationale: ['mejorar'],
      days: [
        {
          date: '2026-03-02',
          type: 'entreno',
          title: 'Empuje',
          focus: 'Pecho',
          exercises: [{ name: 'Press banca' }],
        },
      ],
    });
    const parsed = parsePlan(text);
    expect(parsed).not.toBeNull();
    expect(parsed?.preview.days).toHaveLength(1);
    expect(parsed?.preview.days[0]?.exercises).toEqual(['Press banca']);
    expect(normalizePlan({ nope: true })).toBeNull();
    expect(parsePlan('sin json por aquí')).toBeNull();
  });

  it('275 · planEngine distingue ia de local', () => {
    expect(planEngine('local')).toBe('local');
    expect(planEngine('ia')).toBe('ia');
    expect(autoPlanEngine(true)).toBe('ia');
    expect(autoPlanEngine(false)).toBe('local');
  });

  it('276 · planOrigin describe el origen del plan', () => {
    const local = planOrigin('local');
    expect(local.engine).toBe('local');
    expect(local.subtitle).toContain('dispositivo');
    const ia = planOrigin('ia');
    expect(ia.engine).toBe('ia');
    expect(ia.badge).toContain('a');
  });
});

describe('ui:hoy (277–282, 295)', () => {
  it('277 · todayPlan con el día hecho manda done', () => {
    const out = todayPlan(
      day({ status: 'done', plan: [{ name: 'Press banca' }] }),
      [routine('r1', 'Empuje')],
      [],
      '2026-03-04',
    );
    expect(out.status).toBe('done');
  });

  it('278 · todayPlan con routineId colgado cae a plan o vacío', () => {
    const withPlan = todayPlan(
      day({ routineId: 'fantasma', plan: [{ name: 'Press banca' }] }),
      [],
      [],
      '2026-03-04',
    );
    expect(withPlan.status).toBe('plan');
    expect(withPlan.routineId).toBe('fantasma');
    const empty = todayPlan(day({ routineId: 'fantasma' }), [], [], '2026-03-04');
    expect(empty.status).toBe('empty');
  });

  it('279 · weekCells arranca el lunes', () => {
    const cells = weekCells({}, [], '2026-03-04');
    expect(cells).toHaveLength(7);
    expect(cells[0]?.iso).toBe('2026-03-02');
    expect(cells[6]?.iso).toBe('2026-03-08');
  });

  it('280 · repeatItems reparte el peso máximo de la sesión', () => {
    const items = repeatItems(
      sess('2026-03-04', [entry('ex', [log(40, 8), log(60, 5), log(50, 6)])]),
    );
    expect(items[0]?.weight).toBe(60);
    expect(items[0]?.sets).toBe(3);
    expect(items[0]?.reps).toBe(5);
  });

  it('281 · greeting saluda según la hora', () => {
    expect(greeting(8, 'Ana')).toContain('Buenos días');
    expect(greeting(8, 'Ana')).toContain('Ana');
    expect(greeting(22, 'Ana')).toContain('Buenas noches');
  });

  it('282 · suggestionRows convierte la sugerencia en filas', () => {
    const suggestion: RoutineSuggestion = {
      title: 'x',
      focus: '',
      rationale: [],
      exercises: [
        {
          name: 'Press',
          matched: true,
          sets: 3,
          repMin: 8,
          repMax: 12,
          rest: 90,
          weight: 60,
          notes: '',
        },
      ],
    };
    const rows = suggestionRows(suggestion, [ex('p', 'Press', 'pecho')]);
    expect(rows[0]?.group).toBe('pecho');
    expect(rows[0]?.reps).toBe(10);
    expect(suggestionSource({ source: 'ia' }, 'local')).toBe('ia');
    expect(suggestionSource({}, 'local')).toBe('local');
  });

  it('295 · Fecha inválida en todayPlan no rompe la portada', () => {
    expect(() =>
      todayPlan(day({ status: 'planned', plan: [{ name: 'X' }] }), [], [], 'no-es-fecha'),
    ).not.toThrow();
    expect(todayPlan(undefined, [], [], '2026-03-04').status).toBe('empty');
  });
});

describe('ui:picker (283–284)', () => {
  it('283 · orderPickerItems pone las estrellas primero', () => {
    const items = [ex('a', 'Beta', 'pecho', { fav: false }), ex('b', 'Alfa', 'pecho', { fav: true })];
    const ordered = orderPickerItems(items);
    expect(ordered[0]?.id).toBe('b');
  });

  it('284 · visiblePickerItems oculta los hidden y filtra por disponibilidad', () => {
    const items = [
      ex('h', 'Oculto', 'pecho', { hidden: true }),
      ex('ok', 'Disponible', 'pecho'),
      ex('need', 'Con barra', 'pecho', { equip: 'barra_olimpica' }),
    ];
    const visible = visiblePickerItems(items, { equip: {} });
    const ids = visible.map((e) => e.id);
    expect(ids).toContain('ok');
    expect(ids).not.toContain('h');
    expect(ids).not.toContain('need');
  });
});

describe('ui:routines (285–288)', () => {
  it('285 · matchExercises tolera tildes/faltas', () => {
    const library = [
      ex('bul', 'Sentadilla búlgara', 'cuadriceps'),
      ex('pre', 'Press banca', 'pecho'),
    ];
    const hits = matchExercises('sentadilla bulgara', library);
    expect(hits.map((e) => e.id)).toContain('bul');
  });

  it('286 · bounded y weightOrNull acotan entradas', () => {
    expect(bounded('0', 1, 10, 3)).toBe(1);
    expect(weightOrNull('')).toBeNull();
    expect(weightOrNull('60')).toBe(60);
  });

  it('287 · sourceBadge etiqueta cada origen', () => {
    expect(sourceBadge('ia').label).toBe('IA');
    expect(sourceBadge('generador').label).toBe('auto');
    expect(sourceBadge('manual').label).toBe('manual');
    expect(sourceBadge(undefined).label).toBe('manual');
  });

  it('288 · nextFreeDay/scheduleRoutinePatch proponen el próximo hueco', () => {
    const sched = schedule({
      '2026-03-04': day({ status: 'planned', routineId: 'r1' }),
      '2026-03-05': day({ status: 'planned' }),
    });
    expect(nextFreeDay(sched, [], '2026-03-04')).toBe('2026-03-06');

    const patch = scheduleRoutinePatch({ id: 'r9', name: 'Empuje' });
    expect(patch).toMatchObject({ routineId: 'r9', title: 'Empuje', type: 'entreno' });
  });
});
