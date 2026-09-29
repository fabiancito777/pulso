/**
 * Comprobaciones de los helpers del calendario: el estado de un día (lo que
 * decide si un día se ve hecho, descanso o libre), la cuadrícula mensual y la
 * normalización del plan del coach.
 *
 * Son las reglas que más se rompen sin querer: una sesión real tiene que mandar
 * sobre lo que diga el plan y las fechas del mes no pueden depender de la zona
 * horaria.
 */
import { describe, expect, it } from 'vitest';

import {
  clearDayPatch,
  dayState,
  dayTitle,
  dayType,
  dayTypeLabel,
  monthDays,
  normalizePlan,
  parsePlan,
  restDayPatch,
  weekCounts,
} from './calendar-helpers';

describe('estado de un día', () => {
  it('una sesión real manda sobre el plan', () => {
    expect(dayState({ status: 'rest', type: 'descanso' }, 1)).toBe('done');
    expect(dayState(undefined, 2)).toBe('done');
  });

  it('respeta el orden de la v1: hecho > descanso > saltado > planificado', () => {
    expect(dayState({ status: 'done' }, 0)).toBe('done');
    expect(dayState({ status: 'rest' }, 0)).toBe('rest');
    expect(dayState({ type: 'descanso' }, 0)).toBe('rest');
    expect(dayState({ status: 'skipped' }, 0)).toBe('skipped');
    expect(dayState({ status: 'planned' }, 0)).toBe('planned');
    expect(dayState({ routineId: 'rt_1' }, 0)).toBe('planned');
    expect(dayState({ type: 'cardio' }, 0)).toBe('planned');
    expect(dayState({}, 0)).toBe('free');
    expect(dayState(null, 0)).toBe('free');
    expect(dayState({ status: 'cualquiera' }, 0)).toBe('free');
  });
});

describe('tipo y título del día', () => {
  it('solo acepta los cuatro tipos válidos', () => {
    expect(dayType({ type: 'cardio' })).toBe('cardio');
    expect(dayType({ type: 'descanso' })).toBe('descanso');
    expect(dayType({ type: 'inventado' })).toBe('');
    expect(dayType(undefined)).toBe('');
  });

  it('el título sale del plan, si no de la rutina, si no es descanso', () => {
    expect(dayTitle({ title: 'Tren superior' }, 'Rutina X')).toBe('Tren superior');
    expect(dayTitle({ routineId: 'rt_1' }, 'Empuje A')).toBe('Empuje A');
    expect(dayTitle({ type: 'descanso' }, '')).toBe('Descanso');
    expect(dayTitle({}, '')).toBe('');
    expect(dayTitle({ title: '  ' }, '')).toBe('');
  });

  it('la etiqueta del tipo cubre los días que el plan dejó a medias', () => {
    expect(dayTypeLabel({ type: 'movilidad' }, 'planned')).toBe('Movilidad');
    expect(dayTypeLabel({}, 'free')).toBe('Libre');
    expect(dayTypeLabel({ type: 'descanso' }, 'rest')).toBe('Descanso');
    expect(dayTypeLabel(undefined, 'done')).toBe('Sesión');
    expect(dayTypeLabel({ routineId: 'rt_1' }, 'planned')).toBe('Entreno');
    expect(dayTypeLabel({ status: 'planned' }, 'planned')).toBe('Sin tipo');
  });
});

describe('resumen de la semana', () => {
  it('cuenta planificados (incluidos los hechos) y completados', () => {
    expect(weekCounts(['done', 'planned', 'rest', 'free', 'skipped', 'done', 'planned'])).toEqual({
      done: 2,
      planned: 4,
    });
    expect(weekCounts(['free', 'rest', 'skipped'])).toEqual({ done: 0, planned: 0 });
  });
});

describe('cuadrícula mensual', () => {
  it('devuelve todos los días del mes en ISO local', () => {
    expect(monthDays('2026-09-24')).toHaveLength(30);
    expect(monthDays('2026-09-01')[0]).toBe('2026-09-01');
    expect(monthDays('2026-09-01').at(-1)).toBe('2026-09-30');
    expect(monthDays('2026-02-10')).toHaveLength(28);
    expect(monthDays('2028-02-10')).toHaveLength(29);
    expect(monthDays('2026-04-01')).toHaveLength(30);
    expect(monthDays('2026-01')).toHaveLength(31);
  });
});

describe('limpiar un día', () => {
  it('vacía la planificación sin tocar la sesión enlazada', () => {
    const patch = clearDayPatch();
    expect(Object.keys(patch).sort()).toEqual(['routineId', 'source', 'status', 'title', 'type']);
    expect(Object.values(patch)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect('sessionId' in patch).toBe(false);
  });
});

describe('marcar un día como descanso', () => {
  it('pone estado y tipo sin borrar campos (el merge conserva la rutina)', () => {
    const patch = restDayPatch();
    expect(patch.status).toBe('rest');
    expect(patch.type).toBe('descanso');
    expect(patch.title).toBe('Descanso');
    /* el «Saltar» de Hoy y el del Calendario escriben exactamente este patch */
    expect(patch).toEqual({
      status: 'rest',
      type: 'descanso',
      title: 'Descanso',
      source: 'manual',
    });
    /* nada de claves en undefined: como clearDayPatch borraría la rutina */
    expect(Object.values(patch)).not.toContain(undefined);
    expect('routineId' in patch).toBe(false);
  });
});

describe('plan del coach', () => {
  it('normaliza un plan con prosa y cercilla alrededor', () => {
    const text = [
      'Aquí tienes tu semana:',
      '```json',
      JSON.stringify({
        source: 'ia',
        rationale: ['Dos empujes y dos tirones', 'Pierna una vez'],
        days: [
          {
            date: '2026-09-28',
            type: 'entreno',
            title: 'Tren superior',
            focus: 'pecho y espalda',
            exercises: [
              { name: 'Press banca', sets: 4 },
              { exercise: 'Remo mancuerna' },
              { ejercicio: 'Dominadas' },
            ],
          },
          { date: '2026-09-29', type: 'descanso', title: 'Descanso', exercises: [] },
        ],
      }),
      '```',
      '¡A por ello!',
    ].join('\n');

    const parsed = parsePlan(text);
    expect(parsed).not.toBeNull();
    expect(parsed?.preview.source).toBe('ia');
    expect(parsed?.preview.rationale).toBe('Dos empujes y dos tirones · Pierna una vez');
    expect(parsed?.preview.days).toHaveLength(2);
    expect(parsed?.preview.days[0]).toEqual({
      iso: '2026-09-28',
      type: 'entreno',
      title: 'Tren superior',
      focus: 'pecho y espalda',
      exercises: ['Press banca', 'Remo mancuerna', 'Dominadas'],
    });
    expect(parsed?.preview.days[1]?.type).toBe('descanso');
    /* el crudo es lo que le pasa `applyWeek`, sin tocar */
    expect(parsed?.raw).toBeTypeOf('object');
  });

  it('descarta los días sin fecha válida y devuelve null si no queda ninguno', () => {
    expect(normalizePlan({ days: [{ date: 'mañana', type: 'entreno' }] })).toBeNull();
    expect(normalizePlan({ days: [] })).toBeNull();
    expect(normalizePlan('eso no es un plan')).toBeNull();
    expect(normalizePlan({ days: [{ iso: '2026-10-01', type: 'cardio' }] })).toMatchObject({
      days: [{ iso: '2026-10-01', type: 'cardio' }],
    });
    expect(
      normalizePlan({ days: [{ date: '2026-10-01', type: 'inventado' }] })?.days[0]?.type,
    ).toBe('');
  });

  it('devuelve null cuando el texto no se puede interpretar', () => {
    expect(parsePlan('no hay JSON aquí')).toBeNull();
    expect(parsePlan('{"days":[]}')).toBeNull();
  });
});
