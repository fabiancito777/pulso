import { describe, expect, it } from 'vitest';

import { itemsFromRecipe } from '@/domain/plan';
import type { PlanInput } from '@/domain/plan';
import type { Exercise, Session, SessionEntry, Settings } from '@/domain/types';
import { localSuggest, localWeek, summarizeLocal } from '@/features/coach/local';

const settings = {
  units: 'kg',
  goal: 'hipertrofia',
  increment: 2.5,
  daysPerWeek: 4,
} as unknown as Settings;

const noSessions: Session[] = [];

function ex(id: string, name: string, group: string, extra: Partial<Exercise> = {}): Exercise {
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

function input(exercises: Exercise[], sessions: Session[] = noSessions): PlanInput {
  return { settings, exercises, equipment: {}, sessions };
}

function log(weight: number, reps: number) {
  return { weight, reps, done: true, rpe: null as number | null };
}

function entry(exId: string): SessionEntry {
  return { exId, name: exId, sets: [log(50, 8), log(50, 8)] };
}

function session(date: string, entries: SessionEntry[]): Session {
  return { id: `s-${date}`, date, startedAt: `${date}T10:00:00.000Z`, unit: 'kg', entries };
}

describe('local (211–220)', () => {
  it('211 · Sin historial cae a la receta de cuerpo completo', () => {
    const out = localSuggest({
      ...input([
        ex('sq', 'Sentadilla', 'cuadriceps'),
        ex('bp', 'Press banca', 'pecho'),
        ex('row', 'Remo', 'espalda'),
      ]),
      todayIso: '2026-03-04',
    });
    expect(out.source).toBe('local');
    expect(out.exercises.map((e) => e.exId)).toEqual(['sq', 'bp', 'row']);
    expect(out.rationale.some((r) => r.includes('cuerpo completo'))).toBe(true);
  });

  it('212 · Con historial prioriza el grupo sin estímulo reciente', () => {
    const out = localSuggest({
      ...input([ex('pechoEx', 'Press pecho', 'pecho'), ex('espaldaEx', 'Remo', 'espalda')], [
        session('2026-03-09', [entry('pechoEx')]),
      ]),
      todayIso: '2026-03-09',
    });
    expect(out.exercises[0]?.exId).toBe('espaldaEx');
  });

  it('213 · Plan de 4 días coloca las plantillas push/pull/legs/upper', () => {
    const plan = localWeek({
      ...input([]),
      todayIso: '2026-03-04',
      daysPerWeek: 4,
    });
    expect(plan.days).toHaveLength(7);
    expect(plan.daysPerWeek).toBe(4);
    expect(plan.days[0]?.template).toBe('push');
    expect(plan.days[1]?.template).toBe('pull');
    expect(plan.days[3]?.template).toBe('legs');
    expect(plan.days[4]?.template).toBe('upper');
    expect(plan.days.filter((d) => d.template).length).toBe(4);
  });

  it('214 · daysPerWeek se acota a 1..7', () => {
    const zero = localWeek({ ...input([]), todayIso: '2026-03-04', daysPerWeek: 0 });
    const many = localWeek({ ...input([]), todayIso: '2026-03-04', daysPerWeek: 20 });
    expect(zero.daysPerWeek).toBeGreaterThanOrEqual(1);
    expect(zero.daysPerWeek).toBeLessThanOrEqual(7);
    expect(many.daysPerWeek).toBe(7);
    expect(zero.days).toHaveLength(7);
  });

  it('215 · summarizeLocal devuelve texto no vacío con el título', () => {
    const suggest = summarizeLocal(
      localSuggest({
        ...input([ex('sq', 'Sentadilla', 'cuadriceps')]),
        todayIso: '2026-03-04',
      }),
    );
    // HALLAZGO: el resumen menciona los GRUPOS («Cuádriceps»…) en el título/focus,
    // no los nombres concretos de los ejercicios del payload.
    expect(suggest.length).toBeGreaterThan(0);
    expect(suggest).toContain('Sesión de');

    const week = summarizeLocal(localWeek({ ...input([]), todayIso: '2026-03-04' }));
    expect(week).toContain('Plan semanal');
  });

  it('216 · La salida local usa date/exercises canónicos (los alias items/iso son del consumidor)', () => {
    const plan = localWeek({ ...input([]), todayIso: '2026-03-04', daysPerWeek: 4 });
    // El planificador emite la forma canónica de `PlanJSON`…
    expect(plan.days.every((d) => typeof d.date === 'string')).toBe(true);
    expect(plan.days.every((d) => Array.isArray(d.exercises))).toBe(true);
    expect(summarizeLocal(plan)).toContain('2026-03-02');
    // …y son los alias `iso`/`items` los que resuelve el consumidor
    // (`state/coach.ts`: `payloadItems` = exercises ?? items ?? days, `dayIsoOf`).
    // HALLAZGO: `summarizeLocal` NO lee `iso`, solo `date`.
  });

  it('217 · Ambos planificadores salen con source:local', () => {
    expect(
      localSuggest({ ...input([ex('sq', 'Sentadilla', 'cuadriceps')]), todayIso: '2026-03-04' })
        .source,
    ).toBe('local');
    expect(localWeek({ ...input([]), todayIso: '2026-03-04' }).source).toBe('local');
  });

  it('218 · Un grupo vacío no gasta hueco y no se repiten ejercicios', () => {
    const items = itemsFromRecipe(input([ex('a1', 'Press A', 'pecho'), ex('a2', 'Press B', 'pecho')]), [
      ['pecho', 2],
    ]);
    const ids = items.map((i) => i.exId);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);

    const plan = localWeek({ ...input([]), todayIso: '2026-03-04', daysPerWeek: 4 });
    expect(plan.days.every((d) => Array.isArray(d.exercises))).toBe(true);
  });

  it('219 · En un plan de 3 días el domingo es recuperación y el resto descanso', () => {
    const plan = localWeek({ ...input([]), todayIso: '2026-03-04', daysPerWeek: 3 });
    expect(plan.days.filter((d) => d.type === 'descanso')).toHaveLength(3);
    expect(plan.days.filter((d) => d.type === 'movilidad')).toHaveLength(1);
  });

  it('220 · Sin material solo se proponen ejercicios a peso corporal', () => {
    const out = localSuggest({
      ...input([
        ex('bw', 'Flexiones', 'pecho', { equip: '' }),
        ex('bb', 'Press barra', 'pecho', { equip: 'barra_olimpica' }),
      ]),
      todayIso: '2026-03-04',
    });
    const ids = out.exercises.map((e) => e.exId);
    expect(ids).toContain('bw');
    expect(ids).not.toContain('bb');
  });
});
