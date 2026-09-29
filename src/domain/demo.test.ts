/**
 * Datos de ejemplo (port puro de `S.demoData` de la v1): aquí solo se verifica
 * lo que decide SI las gráficas de ejemplo salen iguales en las dos ramas —
 * patrón de días, plantillas, ausencia de fechas futuras, progresión de peso y
 * marca `demo` — sin tocar el estado.
 */
import { describe, expect, it } from 'vitest';

import { SEED_EXERCISES, TEMPLATES } from './catalog';
import { defaultEquipment, equipPreset, findExercise } from './data';
import { addDays, startOfWeek, today } from './dates';
import { demoSessions } from './demo';
import type { DemoOptions } from './demo';

const HOY = '2026-09-28'; /* lunes: la semana en curso empieza ese mismo día */

function options(over: Partial<DemoOptions> = {}): DemoOptions {
  return {
    weeks: 8,
    unit: 'kg',
    exercises: SEED_EXERCISES,
    equipment: defaultEquipment(),
    sessions: [],
    todayIso: HOY,
    templates: TEMPLATES,
    ...over,
  };
}

describe('demoSessions', () => {
  it('genera sesiones con la forma de la v1: demo, source, rpe y sin futuro', () => {
    const list = demoSessions(options());
    expect(list.length).toBeGreaterThan(0);

    const ids = new Set(list.map((s) => s.id));
    expect(ids.size).toBe(list.length);

    for (const s of list) {
      expect(s).toMatchObject({ demo: true, source: 'demo', rpe: 7, unit: 'kg', notes: '' });
      expect(s.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      /* nunca hacia delante */
      expect(s.date <= HOY).toBe(true);
      expect(s.entries.length).toBeGreaterThan(0);
      expect(s.startedAt.startsWith(s.date)).toBe(true);
      expect(new Date(s.endedAt ?? '').getTime()).toBeGreaterThan(new Date(s.startedAt).getTime());

      for (const entry of s.entries) {
        expect(entry.sets.length).toBeGreaterThanOrEqual(3);
        expect(entry.exId).toBeTruthy();
        expect(findExercise(SEED_EXERCISES, entry.exId)?.name).toBe(entry.name);
        for (const set of entry.sets) {
          expect(set.done).toBe(true);
          expect(set.reps).toBeGreaterThanOrEqual(1);
          expect(set.weight).toBeGreaterThanOrEqual(0);
          /* peso corporal → 0 kg, que es información real y no un vacío */
          if (findExercise(SEED_EXERCISES, entry.exId)?.bw) expect(set.weight).toBe(0);
        }
      }
    }
  });

  it('las fechas cubren las últimas `weeks` semanas desde el lunes en curso', () => {
    const list = demoSessions(options({ weeks: 2 }));
    const desde = addDays(startOfWeek(HOY), -7);
    expect(list.length).toBeGreaterThan(0);
    for (const s of list) {
      expect(s.date >= desde).toBe(true);
      expect(s.date <= HOY).toBe(true);
    }
    /* una semana solo: nada anterior al lunes de esta misma */
    const una = demoSessions(options({ weeks: 1 }));
    const lunes = startOfWeek(HOY);
    expect(una.every((s) => s.date >= lunes)).toBe(true);
    expect(una.length).toBeGreaterThan(0);
  });

  it('es determinista: mismas opciones → mismos días y plantillas (ids distintos)', () => {
    const a = demoSessions(options());
    const b = demoSessions(options());
    expect(a.map((s) => `${s.date}|${s.name}`)).toEqual(b.map((s) => `${s.date}|${s.name}`));
    expect(a.map((s) => s.id)).not.toEqual(b.map((s) => s.id));
  });

  it('con la unidad en libras los pesos salen en lb y redondeados a 0,5', () => {
    const kg = demoSessions(options({ unit: 'kg' }));
    const lb = demoSessions(options({ unit: 'lb' }));
    expect(lb.every((s) => s.unit === 'lb')).toBe(true);

    const pesoKg = kg
      .flatMap((s) => s.entries)
      .flatMap((e) => e.sets)
      .find((x) => (x.weight ?? 0) > 0);
    const pesoLb = lb
      .flatMap((s) => s.entries)
      .flatMap((e) => e.sets)
      .find((x) => (x.weight ?? 0) > 0);
    expect(pesoKg).toBeDefined();
    expect(pesoLb).toBeDefined();
    const kgW = pesoKg?.weight ?? 0;
    const lbW = pesoLb?.weight ?? 0;
    expect(lbW).toBeGreaterThan(kgW);
    expect(lbW % 0.5).toBe(0);
  });

  it('sin material activo solo salen ejercicios de peso corporal (y sigue saliendo)', () => {
    const list = demoSessions(options({ equipment: equipPreset('ninguno') }));
    expect(list.length).toBeGreaterThan(0);
    for (const entry of list.flatMap((s) => s.entries)) {
      const ex = findExercise(SEED_EXERCISES, entry.exId);
      expect(ex?.bw).toBe(true);
      expect(entry.sets.every((x) => x.weight === 0)).toBe(true);
    }
  });

  it('el historial crece y se le pasa al planificador (rotación y familiaridad)', () => {
    const primera = demoSessions(options({ weeks: 2 }));
    const segunda = demoSessions(options({ weeks: 2, sessions: primera }));
    expect(segunda.length).toBeGreaterThan(0);
    /* no reutiliza los ids del historial que le llega */
    const usados = new Set(primera.map((s) => s.id));
    expect(segunda.every((s) => !usados.has(s.id))).toBe(true);
  });

  it('con semanas < 1 sigue generando (mínimo 1)', () => {
    expect(demoSessions(options({ weeks: 0 })).length).toBeGreaterThan(0);
  });

  it('hoy se puede calcular con el sistema: nunca hay sesiones de mañana', () => {
    const list = demoSessions(options({ weeks: 8, todayIso: today() }));
    const mañana = addDays(today(), 1);
    expect(list.every((s) => s.date < mañana)).toBe(true);
  });
});
