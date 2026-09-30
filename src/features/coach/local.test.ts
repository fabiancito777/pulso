/**
 * `features/coach/local.ts`: el planificador local del coach (sin red, sin key).
 *
 * Datos clavados a mano y fecha fija (`2026-09-28`, lunes), así que aquí se
 * fija lo que en la v1 solo se veía usando la app: el reparto de la semana, las
 * recetas de cada plantilla, qué pasa cuando falta material, el camino del
 * PRIMER DÍA (sin historial) y que los pesos salen en la unidad del usuario.
 *
 * La biblioteca cubre los grupos de las 9 plantillas del catálogo: si una
 * receta pide más ejercicios de los que hay, `pickForGroup` recorta y el día
 * sale incompleto — por eso los tests de recetas cuentan ejercicios.
 */
import { describe, expect, it } from 'vitest';

import type { EquipmentMap } from '@/domain/data';
import { DEFAULT_SETTINGS } from '@/domain/defaults';
import { addDays } from '@/domain/dates';
import type { Exercise, Session } from '@/domain/types';
import { localSuggest, localWeek, summarizeLocal } from './local';
import type { LocalWeekParams, PlanDayJSON } from './local';

/* ---------- datos de prueba ---------- */

/** Lunes de la semana de referencia (la semana siguiente empieza el 05-10). */
const HOY = '2026-09-28';

function ex(partial: Partial<Exercise> & Pick<Exercise, 'id' | 'name' | 'group'>): Exercise {
  return {
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
    ...partial,
  };
}

/** Biblioteca que cubre los grupos de las 9 plantillas (y sus recetas). */
function library(): Exercise[] {
  return [
    ex({
      id: 'press',
      name: 'Press banca',
      group: 'pecho',
      equip: 'barra_olimpica',
      sets: 4,
      rest: 180,
      repMin: 6,
      repMax: 10,
    }),
    ex({ id: 'flex', name: 'Flexiones', group: 'pecho', sets: 3, rest: 60 }),
    ex({
      id: 'apert',
      name: 'Aperturas',
      group: 'pecho',
      type: 'aislado',
      equip: 'mancuernas_ajustables',
      rest: 75,
    }),
    ex({
      id: 'dominadas',
      name: 'Dominadas',
      group: 'espalda',
      equip: 'barra_dominadas',
      rest: 150,
    }),
    ex({
      id: 'remo',
      name: 'Remo con mancuerna',
      group: 'espalda',
      equip: 'mancuernas_ajustables',
      rest: 120,
    }),
    ex({ id: 'jalones', name: 'Jalón al pecho', group: 'espalda', equip: 'polea_alta', rest: 120 }),
    ex({
      id: 'militar',
      name: 'Press militar',
      group: 'hombros',
      equip: 'barra_olimpica',
      rest: 150,
    }),
    ex({
      id: 'laterales',
      name: 'Elevaciones laterales',
      group: 'hombros',
      type: 'aislado',
      equip: 'mancuernas_ajustables',
      rest: 60,
    }),
    ex({
      id: 'curl',
      name: 'Curl bíceps',
      group: 'biceps',
      type: 'aislado',
      equip: 'mancuernas_ajustables',
      rest: 60,
    }),
    ex({
      id: 'curlBarra',
      name: 'Curl con barra',
      group: 'biceps',
      type: 'aislado',
      equip: 'barra_ez',
      rest: 60,
    }),
    ex({
      id: 'fondos',
      name: 'Fondos en paralelas',
      group: 'triceps',
      equip: 'paralelas',
      rest: 120,
    }),
    ex({
      id: 'extens',
      name: 'Extensión de tríceps',
      group: 'triceps',
      type: 'aislado',
      equip: 'mancuernas_ajustables',
      rest: 60,
    }),
    ex({
      id: 'sentadilla',
      name: 'Sentadilla',
      group: 'cuadriceps',
      equip: 'barra_olimpica',
      sets: 4,
      rest: 180,
    }),
    ex({ id: 'zancada', name: 'Zancadas', group: 'cuadriceps', sets: 3, rest: 120 }),
    ex({
      id: 'pesoMuerto',
      name: 'Peso muerto',
      group: 'femoral',
      equip: 'barra_olimpica',
      sets: 4,
      rest: 180,
    }),
    ex({
      id: 'curlFemoral',
      name: 'Curl femoral',
      group: 'femoral',
      type: 'aislado',
      equip: 'mancuernas_ajustables',
      rest: 75,
    }),
    ex({ id: 'puente', name: 'Puente de glúteo', group: 'gluteos', rest: 90 }),
    ex({
      id: 'elevGemelos',
      name: 'Elevaciones de gemelos',
      group: 'gemelos',
      equip: 'barra_olimpica',
      rest: 60,
    }),
    ex({ id: 'plancha', name: 'Plancha', group: 'core', rest: 45 }),
    ex({ id: 'crunch', name: 'Crunch', group: 'core', type: 'aislado', rest: 45 }),
    ex({
      id: 'elevPiernas',
      name: 'Elevación de piernas',
      group: 'core',
      type: 'aislado',
      rest: 45,
    }),
    ex({
      id: 'muñecas',
      name: 'Curl de muñecas',
      group: 'antebrazo',
      type: 'aislado',
      equip: 'barra_ez',
      rest: 45,
    }),
    ex({
      id: 'cinta',
      name: 'Cinta de correr',
      group: 'cardio',
      type: 'cardio',
      equip: 'cinta',
      rest: 0,
    }),
    ex({ id: 'jumping', name: 'Jumping jacks', group: 'cardio', type: 'cardio', rest: 0 }),
    ex({
      id: 'movCadera',
      name: 'Movilidad de cadera',
      group: 'movilidad',
      type: 'movilidad',
      rest: 0,
    }),
    ex({
      id: 'movIsquios',
      name: 'Estiramiento de isquios',
      group: 'movilidad',
      type: 'movilidad',
      rest: 0,
    }),
    ex({
      id: 'movHombros',
      name: 'Rotaciones de hombro',
      group: 'movilidad',
      type: 'movilidad',
      rest: 0,
    }),
    ex({ id: 'movGato', name: 'Gato camello', group: 'movilidad', type: 'movilidad', rest: 0 }),
    ex({ id: 'movToro', name: 'Torso sentado', group: 'movilidad', type: 'movilidad', rest: 0 }),
  ];
}

const ALL_EQUIPMENT: EquipmentMap = {
  barra_olimpica: true,
  mancuernas_ajustables: true,
  barra_dominadas: true,
  polea_alta: true,
  barra_ez: true,
  paralelas: true,
  cinta: true,
};

/** Sesión con una sola serie hecha por ejercicio. */
function session(
  date: string,
  entries: { exId: string; weight?: number; reps?: number }[],
): Session {
  return {
    id: `s-${date}`,
    date,
    startedAt: `${date}T10:00:00.000Z`,
    endedAt: `${date}T11:00:00.000Z`,
    unit: 'kg',
    entries: entries.map((entry) => ({
      exId: entry.exId,
      sets: [{ weight: entry.weight ?? 40, reps: entry.reps ?? 8, done: true }],
    })),
  };
}

function params(over: Partial<LocalWeekParams> = {}): LocalWeekParams {
  return {
    settings: DEFAULT_SETTINGS,
    exercises: library(),
    equipment: ALL_EQUIPMENT,
    sessions: [],
    todayIso: HOY,
    ...over,
  };
}

/** Grupo de la biblioteca de un id propuesto (los ejercicios salen sin grupo). */
function groupOf(exId: string): string {
  return library().find((e) => e.id === exId)?.group ?? '';
}

function idsOf(day: PlanDayJSON, group?: string): string[] {
  return day.exercises
    .map((item) => item.exId)
    .filter((id) => group === undefined || groupOf(id) === group);
}

/* ---------- entreno de hoy ---------- */

describe('localSuggest', () => {
  it('primer día (0 sesiones) → receta genérica de cuerpo completo, nunca vacío', () => {
    const out = localSuggest(params());

    /* la receta de la v1: cuádriceps 1 + pecho 1 + espalda 1, y el bloque de core */
    expect(out.exercises.map((item) => item.exId)).toEqual([
      'sentadilla',
      'flex',
      'dominadas',
      'plancha',
    ]);
    expect(out.rationale).toHaveLength(1);
    expect(out.rationale[0]).toContain('genérica');
    expect(out.rationale[0]).toContain('historial');
    expect(out.source).toBe('local');
    expect(out.title).toBe('Sesión de Cuádriceps + Pecho');
    expect(out.focus).toBe('Cuádriceps · Pecho · Espalda · Core');
    expect(out.notes).toContain('8-12');
    for (const item of out.exercises) {
      expect(item.weight).toBe(0); /* sin historial: la app lo pinta vacío */
      expect(item.sets).toBeGreaterThan(0);
      expect(item.repMin).toBeLessThanOrEqual(item.repMax);
    }
  });

  it('con historial: puntúa por grupo y aparta lo entrenado hace poco', () => {
    const sessions = [
      session('2026-09-23', [{ exId: 'press' }]) /* pecho hace 5 días → fuera */,
      session('2026-09-12', [{ exId: 'dominadas' }]) /* espalda hace 16 días → dentro */,
    ];
    const out = localSuggest(params({ sessions }));

    expect(out.rationale).toHaveLength(4);
    expect(out.rationale[0]).toBe('Espalda: hace 16 días · 0 series en los últimos 7 días');
    for (const line of out.rationale.slice(1)) {
      expect(line).toContain('sin estímulo registrado');
    }
    expect(out.rationale.join(' ')).not.toContain('genérica');

    const propuestos = out.exercises.map((item) => item.exId);
    expect(propuestos).toHaveLength(7);
    expect(propuestos).not.toContain('press'); /* lo recién entrenado se aparta */
    expect(propuestos).not.toContain('dominadas'); /* y el de las últimas sesiones */
    expect(out.focus).toBe('Espalda · Hombros · Bíceps · Tríceps · Core');

    /* series por tipo: compuesto = 4 (GOAL_SETS), aislado = 3 */
    expect(out.exercises.find((item) => item.exId === 'jalones')?.sets).toBe(4);
    expect(out.exercises.find((item) => item.exId === 'laterales')?.sets).toBe(3);
  });

  it('sin material: propone la alternativa de peso corporal y OMITE los grupos vacíos', () => {
    const sessions = [session('2026-09-23', [{ exId: 'plancha' }])];
    const out = localSuggest(params({ sessions, equipment: {} }));

    /* flexiones en vez de press banca: es lo único de pecho que se puede cargar */
    expect(out.exercises.map((item) => item.name)).toEqual(['Flexiones', 'Plancha']);
    for (const item of out.exercises) {
      expect(library().find((e) => e.id === item.exId)?.equip).toBe('');
    }

    /* espalda/hombros/bíceps no tienen alternativa sin material → ni salen */
    expect(out.rationale).toHaveLength(1);
    expect(out.rationale[0]).toContain('Pecho');
    expect(out.focus).toBe('Pecho · Core');
    for (const ausente of ['Espalda', 'Hombros', 'Bíceps']) {
      expect(out.focus).not.toContain(ausente);
      expect(out.rationale.join(' ')).not.toContain(ausente);
    }
  });

  it('el peso sale de `suggest` (analytics) en la unidad del usuario', () => {
    const sessions = [session('2026-09-23', [{ exId: 'sentadilla', weight: 100, reps: 8 }])];
    const kg = localWeek(params({ sessions, daysPerWeek: 1 }));
    const lb = localWeek(
      params({ sessions, daysPerWeek: 1, settings: { ...DEFAULT_SETTINGS, units: 'lb' } }),
    );

    const pesoDe = (plan: typeof kg): number =>
      plan.days.flatMap((day) => day.exercises).find((item) => item.exId === 'sentadilla')
        ?.weight ?? 0;

    /* 100 kg × 8 → 95 kg estimados para 10 reps; en libras, lo mismo */
    expect(pesoDe(kg)).toBeCloseTo(95, 1);
    expect(pesoDe(lb)).toBeCloseTo(pesoDe(kg) * 2.20462, 1);
    expect(pesoDe(lb)).toBeGreaterThan(200);
  });

  it('una `suggest` inyectada manda sobre analytics', () => {
    const out = localSuggest(params({ suggest: () => ({ weight: 42, basis: 'test' }) }));
    expect(out.exercises.length).toBeGreaterThan(0);
    for (const item of out.exercises) expect(item.weight).toBe(42);
  });
});

/* ---------- plan semanal ---------- */

describe('localWeek', () => {
  it('4 días (los de settings): reparto, fechas y domingo de recuperación', () => {
    const out = localWeek(params());

    expect(out.source).toBe('local');
    expect(out.from).toBe(HOY);
    expect(out.daysPerWeek).toBe(4);
    expect(out.days.map((day) => day.date)).toEqual(
      Array.from({ length: 7 }, (_, i) => addDays(HOY, i)),
    );
    expect(out.days.map((day) => day.type)).toEqual([
      'entreno',
      'entreno',
      'descanso',
      'entreno',
      'entreno',
      'descanso',
      'movilidad',
    ]);
    expect(out.days.map((day) => day.template)).toEqual([
      'push',
      'pull',
      undefined,
      'legs',
      'upper',
      undefined,
      undefined,
    ]);

    expect(out.days[2]).toMatchObject({ title: 'Descanso', focus: '', exercises: [] });
    expect(out.days[6]).toMatchObject({
      title: 'Movilidad ligera',
      focus: 'Recuperación activa',
      exercises: [],
    });
    expect(out.rationale[0]).toContain('4 días');
    for (const day of out.days.filter((d) => d.type === 'entreno')) {
      expect(day.exercises.length).toBeGreaterThan(0);
    }
  });

  it('rotación semanal: 1, 3 y 7 días usan las plantillas de la v1', () => {
    const de = (daysPerWeek: number): PlanDayJSON[] => localWeek(params({ daysPerWeek })).days;

    expect(
      de(1)
        .filter((d) => d.template)
        .map((d) => d.template),
    ).toEqual(['full_a']);
    expect(de(1)[6]).toMatchObject({ type: 'movilidad', title: 'Movilidad ligera' });

    expect(
      de(3)
        .filter((d) => d.template)
        .map((d) => d.template),
    ).toEqual(['full_a', 'full_b', 'full_a']);
    expect(
      de(3)
        .filter((d) => d.template)
        .map((d) => d.date),
    ).toEqual([HOY, addDays(HOY, 2), addDays(HOY, 4)]);

    const siete = de(7);
    expect(siete.map((d) => d.template)).toEqual([
      'push',
      'pull',
      'legs',
      'upper',
      'lower',
      'full_a',
      'mobility',
    ]);
    expect(siete.some((d) => d.type === 'descanso')).toBe(false);
    expect(siete[6]).toMatchObject({ type: 'movilidad', title: 'Movilidad y recuperación' });
  });

  it('cada receta sale completa, sin repetir y dentro de sus grupos', () => {
    const push = localWeek(params({ daysPerWeek: 4 })).days[0];
    expect(push.template).toBe('push');
    expect(push.exercises).toHaveLength(7); /* pecho 3 + hombros 2 + tríceps 2 */
    expect(new Set(push.exercises.map((item) => item.exId)).size).toBe(7);
    for (const item of push.exercises) {
      expect(['pecho', 'hombros', 'triceps']).toContain(groupOf(item.exId));
      expect(library().some((e) => e.id === item.exId)).toBe(true);
    }
    expect(push.focus).toBe('Pecho · Hombros · Tríceps');
  });

  it('la rotación de la receta aparta lo de las últimas sesiones (rotate: 3)', () => {
    const de = (sessions: Session[]): PlanDayJSON => {
      const plan = localWeek(params({ daysPerWeek: 1, sessions }));
      /* con 1 día la plantilla cae en el miércoles (WEEK_LAYOUT[1]) */
      return plan.days.find((day) => day.template === 'full_a') ?? plan.days[0];
    };
    const sinHistorial = de([]);
    const conHistorial = de([session('2026-09-23', [{ exId: 'flex' }])]);

    expect(idsOf(sinHistorial, 'pecho')).toEqual(['flex', 'press']);
    expect(idsOf(conHistorial, 'pecho')).toEqual(['press', 'flex']);
    expect(conHistorial.template).toBe('full_a');
    expect(conHistorial.exercises).toHaveLength(7);
  });

  it('sin material: solo peso corporal y los grupos sin alternativa no salen', () => {
    const plan = localWeek(params({ daysPerWeek: 4, equipment: {} }));
    const push = plan.days[0];

    expect(push.template).toBe('push');
    expect(idsOf(push)).toEqual(['flex']); /* pecho: solo flexiones; hombros y tríceps, nada */
    expect(push.focus).toBe('Pecho');

    const legs = plan.days[3];
    expect(idsOf(legs, 'cuadriceps')).toEqual(['zancada']);
    expect(idsOf(legs, 'gluteos')).toEqual(['puente']);
    expect(idsOf(legs, 'femoral')).toEqual([]); /* sin material no hay femoral */
    for (const day of plan.days) {
      for (const item of day.exercises) {
        expect(library().find((e) => e.id === item.exId)?.equip).toBe('');
      }
    }
  });
});

/* ---------- resumen legible ---------- */

describe('summarizeLocal', () => {
  it('la sugerencia se resume en título + viñetas y sin el JSON', () => {
    const out = localSuggest(params());
    const text = summarizeLocal(out);

    expect(text.split('\n')[0]).toBe(out.title);
    expect(text).toContain('- ');
    expect(text).toContain('genérica');
    expect(text).not.toContain('```');
    expect(text).not.toContain('{');
  });

  it('el plan anuncia los días REALES de entreno (el domingo de recuperación no cuenta)', () => {
    const out = localWeek(params());
    const head = summarizeLocal(out).split('\n')[0];

    expect(head).toBe(`Plan semanal: del ${HOY} al 2026-10-04 · 4 días de entreno`);
    expect(head).not.toContain('5 días');
    expect(summarizeLocal(out)).toContain('- Distribución de 4 días');
  });

  it('sin `daysPerWeek` declarado se cuentan los días que no son descanso', () => {
    const plan = localWeek(params());
    const head = summarizeLocal({ ...plan, daysPerWeek: 0 }).split('\n')[0];
    /* 4 de entreno + el domingo de recuperación, que NO es descanso */
    expect(head).toContain('5 días de entreno');
  });
});
