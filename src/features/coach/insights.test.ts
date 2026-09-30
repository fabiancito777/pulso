/**
 * Aprendizaje del coach: desviaciones, victorias, avisos, estancados y resumen.
 *
 * Los umbrales del JSDoc de `insights.ts` están fijados aquí con fixtures a
 * mano: 0,5 kg de margen para el peso, +2 reps para "mismo peso", 10 días de
 * estancamiento y repMin del objetivo (`hipertrofia` = 8).
 */
import { describe, expect, it } from 'vitest';

import { buildInsights } from './insights';
import type { BuildInsightsParams, CoachRoutine, Insights } from './types';
import type { Exercise, RoutineItem, Session, SessionEntry, SetLog, Unit } from '@/domain/types';

/* ---------- datos de prueba ---------- */

const HOY = '2026-09-24';

const serie = (weight: number | null, reps: number, done = true): SetLog => ({
  weight,
  reps,
  done,
});

let counter = 0;

function sesion(
  date: string,
  entries: SessionEntry[],
  opts: { unit?: Unit; routineId?: string | null; plan?: RoutineItem[] } = {},
): Session {
  counter++;
  return {
    id: `s${counter}`,
    date,
    startedAt: `${date}T10:00:00.000Z`,
    endedAt: `${date}T11:00:00.000Z`,
    unit: opts.unit ?? 'kg',
    routineId: opts.routineId ?? null,
    entries,
    ...(opts.plan ? { plan: opts.plan } : {}),
  };
}

const entrada = (exId: string, sets: SetLog[], name?: string): SessionEntry => ({
  exId,
  ...(name ? { name } : {}),
  sets,
});

const ejercicio = (
  id: string,
  name: string,
  group: string,
  extra: Partial<Exercise> = {},
): Exercise => ({
  id,
  name,
  group,
  equip: '',
  type: 'compuesto',
  sets: 4,
  repMin: 8,
  repMax: 12,
  rest: 180,
  allowed: true,
  custom: false,
  bw: false,
  tags: [],
  tips: '',
  ...extra,
});

const BIBLIOTECA: Exercise[] = [
  ejercicio('ex-press', 'Press de banca', 'pecho'),
  ejercicio('ex-sentadilla', 'Sentadilla', 'piernas'),
  ejercicio('ex-dominadas', 'Dominadas', 'espalda'),
  ejercicio('ex-jalon', 'Jalón al pecho', 'espalda'),
  ejercicio('ex-nunca', 'Curl de bíceps', 'biceps'),
  ejercicio('ex-veto', 'Extensiones de cuádriceps', 'cuadriceps', { allowed: false }),
];

const rutina = (items: CoachRoutine['items'], id = 'rt1'): CoachRoutine => ({
  id,
  name: 'Empuje A',
  source: 'manual',
  items,
});

const params = (over: Partial<BuildInsightsParams> = {}): BuildInsightsParams => ({
  sessions: [],
  routines: [],
  exercises: BIBLIOTECA,
  todayIso: HOY,
  ...over,
});

const press = (
  date: string,
  sets: SetLog[],
  opts: { unit?: Unit; routineId?: string } = {},
): Session => sesion(date, [entrada('ex-press', sets, 'Press de banca')], opts);

const insights = (over: Partial<BuildInsightsParams> = {}): Insights => buildInsights(params(over));

/* ---------- sin datos ---------- */

describe('sin datos', () => {
  it('todo sale vacío si no hay sesiones', () => {
    const result = insights();
    expect(result).toEqual({
      deviations: [],
      wins: [],
      misses: [],
      staleness: [],
      planChanges: { unplanned: [], missing: [], swapped: [], reordered: false },
      summary: [],
    });
  });
});

/* ---------- victorias ---------- */

describe('victorias', () => {
  it('detecta un PR nuevo de 1RM y lo cuenta como progresión', () => {
    const result = insights({
      sessions: [
        press('2026-08-01', [serie(70, 8), serie(70, 8)]),
        press('2026-09-10', [serie(75, 8), serie(75, 8)]),
        press('2026-09-24', [serie(80, 10), serie(80, 9)]),
      ],
    });
    expect(result.wins).toHaveLength(1);
    const win = result.wins[0];
    expect(win.kind).toBe('win');
    expect(win.reason).toBe('pr');
    expect(win.name).toBe('Press de banca');
    expect(win.date).toBe('2026-09-24');
    expect(win.text).toContain('nuevo PR de 1RM');
    expect(win.text).toContain('peso 75 → 80 kg');
    expect(result.misses).toEqual([]);
  });

  it('cuenta las series de más como progresión aunque el 1RM no suba', () => {
    const result = insights({
      sessions: [
        press('2026-09-10', [serie(80, 8)]),
        press('2026-09-24', [serie(80, 8), serie(80, 8)]),
      ],
    });
    expect(result.wins).toHaveLength(1);
    expect(result.wins[0].reason).toBe('progress');
    expect(result.wins[0].text).toContain('+1 serie');
    expect(result.wins[0].text).not.toContain('nuevo PR');
  });

  it('no dice "progresión" si el peso es igual y las reps suben menos de 2', () => {
    const result = insights({
      sessions: [press('2026-09-10', [serie(80, 8)]), press('2026-09-24', [serie(80, 9)])],
    });
    /* 80×9 es mejor 1RM que 80×8, así que sí hay PR, pero no "mismo peso +2 reps" */
    expect(result.wins[0].reason).toBe('pr');
    expect(result.wins[0].text).not.toContain('+2');
  });
});

/* ---------- avisos ---------- */

describe('avisos', () => {
  it('marca por debajo del repMin del objetivo', () => {
    const result = insights({
      sessions: [
        sesion('2026-09-24', [
          entrada('ex-sentadilla', [serie(60, 5), serie(60, 5)], 'Sentadilla'),
        ]),
      ],
    });
    expect(result.misses).toHaveLength(1);
    expect(result.misses[0].reason).toBe('belowReps');
    expect(result.misses[0].text).toContain('5 reps');
    expect(result.misses[0].text).toContain('(8)');
    expect(result.wins).toEqual([]);
  });

  it('marca la regresión cuando baja del peso de sus 2 últimas veces', () => {
    const result = insights({
      sessions: [
        press('2026-09-01', [serie(80, 8)]),
        press('2026-09-10', [serie(82, 8)]),
        press('2026-09-24', [serie(75, 8)]),
      ],
    });
    expect(result.misses).toHaveLength(1);
    expect(result.misses[0].reason).toBe('regression');
    expect(result.misses[0].text).toContain('75');
    expect(result.wins).toEqual([]);
  });

  it('no pita si baja pero sigue por encima de una de las dos últimas', () => {
    const result = insights({
      sessions: [
        press('2026-09-01', [serie(70, 8)]),
        press('2026-09-10', [serie(82, 8)]),
        press('2026-09-24', [serie(78, 8)]),
      ],
    });
    expect(result.misses).toEqual([]);
  });
});

/**
 * El «por debajo del mínimo» se mide contra el rango que pedía ESA sesión (el
 * item del plan/rutina), no contra el `GOAL_REPS` del objetivo: con una rutina
 * 6-10, 6 reps CUMPLE y no puede salir «6 reps por debajo del mínimo (8)».
 */
describe('avisos · el rango de la plantilla manda sobre el del objetivo', () => {
  const rutina610 = rutina([
    { exId: 'ex-press', sets: 4, repMin: 6, repMax: 10, rest: 120, weight: 80 },
  ]);

  it('rutina 6-10 con 6 reps → cumple: no hay aviso de mínimo', () => {
    const result = insights({
      sessions: [press('2026-09-24', [serie(80, 6)], { routineId: 'rt1' })],
      routines: [rutina610],
    });
    expect(result.misses).toEqual([]);
    expect(result.deviations[0].verdict).toBe('matched');
    expect(result.deviations[0].text).toContain('objetivo 80 kg × 6-10 (cumple)');
  });

  it('rutina 6-10 con 5 reps → por debajo del mínimo de la plantilla (6), no (8)', () => {
    const result = insights({
      sessions: [press('2026-09-24', [serie(80, 5)], { routineId: 'rt1' })],
      routines: [rutina610],
    });
    expect(result.misses).toHaveLength(1);
    expect(result.misses[0].reason).toBe('belowReps');
    expect(result.misses[0].text).toContain('5 reps');
    expect(result.misses[0].text).toContain('de la plantilla (6)');
    expect(result.misses[0].text).not.toContain('(8)');
    expect(result.deviations[0].repMin).toBe(6);
    expect(result.deviations[0].verdict).toBe('below');
  });

  it('item sin repMin/repMax → fallback al rango del objetivo (hipertrofia 8-12)', () => {
    const result = insights({
      sessions: [press('2026-09-24', [serie(80, 7)], { routineId: 'rt1' })],
      routines: [rutina([{ exId: 'ex-press', sets: 4, rest: 90, weight: 80 }])],
    });
    expect(result.misses).toHaveLength(1);
    expect(result.misses[0].text).toContain('del objetivo (8)');
    expect(result.deviations[0].repMin).toBe(8);
    expect(result.deviations[0].verdict).toBe('below');
  });

  it('con objetivo `fuerza` el respaldo es 4-6: 5 reps cumple y no avisa', () => {
    const result = insights({
      sessions: [press('2026-09-24', [serie(80, 5)], { routineId: 'rt1' })],
      routines: [rutina([{ exId: 'ex-press', sets: 4, rest: 90, weight: 80 }])],
      goal: 'fuerza',
    });
    expect(result.misses).toEqual([]);
    expect(result.deviations[0].repMin).toBe(4);
    expect(result.deviations[0].repMax).toBe(6);
    expect(result.deviations[0].verdict).toBe('matched');
  });
});

/* ---------- desviaciones frente a la rutina ---------- */

describe('desviaciones', () => {
  const objetivo = rutina([
    { exId: 'ex-press', sets: 4, repMin: 8, repMax: 12, rest: 90, weight: 85 },
  ]);

  it('sin routineId no hay desviación que comparar', () => {
    const result = insights({ sessions: [press('2026-09-24', [serie(75, 6)])] });
    expect(result.deviations).toEqual([]);
  });

  it('kg por debajo del objetivo (margen de 0,5 kg) → below', () => {
    const result = insights({
      sessions: [press('2026-09-24', [serie(84.4, 10)], { routineId: 'rt1' })],
      routines: [objetivo],
    });
    expect(result.deviations).toHaveLength(1);
    expect(result.deviations[0].verdict).toBe('below');
    expect(result.deviations[0].targetKg).toBe(85);
    expect(result.deviations[0].text).toContain('por debajo');
  });

  it('kg justo en el objetivo y reps dentro del rango → matched', () => {
    const result = insights({
      sessions: [press('2026-09-24', [serie(85, 10)], { routineId: 'rt1' })],
      routines: [objetivo],
    });
    expect(result.deviations[0].verdict).toBe('matched');
    expect(result.deviations[0].text).toContain('cumple');
  });

  it('por encima del peso o de repMax → above', () => {
    const result = insights({
      sessions: [press('2026-09-24', [serie(86, 13)], { routineId: 'rt1' })],
      routines: [objetivo],
    });
    expect(result.deviations[0].verdict).toBe('above');
    expect(result.deviations[0].text).toContain('por encima');
  });

  it('el repMin de la rutina manda aunque el peso sea el correcto', () => {
    const result = insights({
      sessions: [press('2026-09-24', [serie(85, 6)], { routineId: 'rt1' })],
      routines: [objetivo],
    });
    expect(result.deviations[0].verdict).toBe('below');
  });

  it('convierte la sesión en lb y la rutina en kg antes de comparar', () => {
    const result = insights({
      sessions: [press('2026-09-24', [serie(176.37, 10)], { unit: 'lb', routineId: 'rt1' })],
      routines: [objetivo],
    });
    expect(result.deviations[0].kg).toBeCloseTo(80, 1);
    expect(result.deviations[0].verdict).toBe('below');
  });
});

/* ---------- estancados ---------- */

describe('staleness', () => {
  it('solo los permitidos con más de 10 días sin tocar', () => {
    const result = insights({
      sessions: [
        sesion('2026-09-23', [entrada('ex-press', [serie(80, 8)], 'Press de banca')]),
        sesion('2026-09-01', [entrada('ex-sentadilla', [serie(60, 8)], 'Sentadilla')]),
        sesion('2026-08-01', [entrada('ex-veto', [serie(20, 10)], 'Extensiones de cuádriceps')]),
      ],
    });
    expect(result.staleness).toHaveLength(1);
    expect(result.staleness[0].name).toBe('Sentadilla');
    expect(result.staleness[0].days).toBe(23);
    /* los nunca entrenados no son "estancados", son "sin datos" */
    expect(result.staleness.map((s) => s.exId)).not.toContain('ex-nunca');
  });

  it('respeta staleDays y el tope', () => {
    const sessions = [
      sesion('2026-09-01', [
        entrada('ex-press', [serie(80, 8)], 'Press de banca'),
        entrada('ex-sentadilla', [serie(60, 8)], 'Sentadilla'),
        entrada('ex-dominadas', [serie(0, 8)], 'Dominadas'),
      ]),
    ];
    const result = insights({ sessions, staleDays: 30 });
    expect(result.staleness).toEqual([]);
    expect(insights({ sessions, staleLimit: 1 }).staleness).toHaveLength(1);
  });
});

/* ---------- resumen ---------- */

describe('summary', () => {
  const sessions = [
    press('2026-08-01', [serie(70, 8)]),
    press('2026-09-10', [serie(75, 8)]),
    press('2026-09-24', [serie(80, 10)], { routineId: 'rt1' }),
    sesion('2026-09-24', [entrada('ex-sentadilla', [serie(60, 5)], 'Sentadilla')]),
  ];
  const routines = [
    rutina([{ exId: 'ex-press', sets: 4, repMin: 8, repMax: 12, rest: 90, weight: 85 }]),
  ];

  it('tiene entre 3 y 6 viñetas con cifras', () => {
    const result = insights({ sessions, routines });
    expect(result.summary.length).toBeGreaterThanOrEqual(3);
    expect(result.summary.length).toBeLessThanOrEqual(6);
    for (const bullet of result.summary) {
      expect(bullet.length).toBeGreaterThan(10);
      expect(bullet).toMatch(/\d/);
    }
    expect(result.summary.join(' ')).toContain('Press de banca');
  });

  it('con una sola sesión sigue habiendo 3 viñetas', () => {
    const result = insights({ sessions: [press('2026-09-24', [serie(80, 8)])] });
    expect(result.summary).toHaveLength(3);
    expect(result.summary.join(' ')).toContain('kg');
  });

  it('sin datos no inventa nada', () => {
    expect(insights().summary).toEqual([]);
  });
});

/* ---------- cambios en plena rutina (snapshot `Session.plan`) ---------- */

describe('planChanges', () => {
  const planDe = (...exIds: string[]): RoutineItem[] => exIds.map((exId) => ({ exId }));
  const VACIO = { unplanned: [], missing: [], swapped: [], reordered: false };

  it('sin plan (sesión manual) no hay nada que comparar', () => {
    const result = insights({ sessions: [press('2026-09-24', [serie(75, 6)])] });
    expect(result.planChanges).toEqual(VACIO);
    expect(result.summary.join(' ')).not.toContain('planificado');
  });

  it('sustitución: unplanned y missing del mismo grupo se emparejan', () => {
    const result = insights({
      sessions: [
        sesion('2026-09-24', [entrada('ex-jalon', [serie(40, 8)], 'Jalón al pecho')], {
          plan: planDe('ex-dominadas'),
        }),
      ],
    });
    expect(result.planChanges.unplanned).toEqual(['Jalón al pecho']);
    expect(result.planChanges.missing).toEqual(['Dominadas']);
    expect(result.planChanges.swapped).toEqual([{ from: 'Dominadas', to: 'Jalón al pecho' }]);
    expect(result.summary.join(' ')).toContain(
      'Sustituiste Dominadas por Jalón al pecho en plena rutina',
    );
    /* lo sustituido NO se vuelve a contar como añadido ni como quitado */
    expect(result.summary.join(' ')).not.toContain('Añadiste');
    expect(result.summary.join(' ')).not.toContain('No llegaste a');
  });

  it('añadido en plena sesión (sin nada que sustituir)', () => {
    const result = insights({
      sessions: [
        sesion(
          '2026-09-24',
          [
            entrada('ex-press', [serie(75, 6)], 'Press de banca'),
            entrada('ex-sentadilla', [serie(60, 5)], 'Sentadilla'),
          ],
          { plan: planDe('ex-press') },
        ),
      ],
    });
    expect(result.planChanges.unplanned).toEqual(['Sentadilla']);
    expect(result.planChanges.missing).toEqual([]);
    expect(result.planChanges.swapped).toEqual([]);
    expect(result.summary.join(' ')).toContain('Añadiste un ejercicio no planificado: Sentadilla');
  });

  it('quitado del plan: solo se reporta el hecho', () => {
    const result = insights({
      sessions: [
        sesion('2026-09-24', [entrada('ex-press', [serie(75, 6)], 'Press de banca')], {
          plan: planDe('ex-press', 'ex-sentadilla'),
        }),
      ],
    });
    expect(result.planChanges.missing).toEqual(['Sentadilla']);
    expect(result.planChanges.swapped).toEqual([]);
    expect(result.summary.join(' ')).toContain('No llegaste a: Sentadilla');
  });

  it('no empareja ejercicios de grupos distintos', () => {
    const result = insights({
      sessions: [
        sesion('2026-09-24', [entrada('ex-sentadilla', [serie(60, 5)], 'Sentadilla')], {
          plan: planDe('ex-press'),
        }),
      ],
    });
    expect(result.planChanges.swapped).toEqual([]);
    expect(result.planChanges.unplanned).toEqual(['Sentadilla']);
    expect(result.planChanges.missing).toEqual(['Press de banca']);
    expect(result.summary.join(' ')).toContain('Añadiste un ejercicio no planificado: Sentadilla');
    expect(result.summary.join(' ')).toContain('No llegaste a: Press de banca');
  });

  it('mismo conjunto pero en otro orden → reordered', () => {
    const result = insights({
      sessions: [
        sesion(
          '2026-09-24',
          [
            entrada('ex-sentadilla', [serie(60, 5)], 'Sentadilla'),
            entrada('ex-press', [serie(75, 6)], 'Press de banca'),
          ],
          { plan: planDe('ex-press', 'ex-sentadilla') },
        ),
      ],
    });
    expect(result.planChanges.reordered).toBe(true);
    expect(result.planChanges.unplanned).toEqual([]);
    expect(result.planChanges.missing).toEqual([]);
    expect(result.summary.join(' ')).toContain(
      'Cambiaste el orden de los ejercicios respecto a la rutina',
    );
  });

  it('el mismo orden no es reordenación', () => {
    const result = insights({
      sessions: [
        sesion(
          '2026-09-24',
          [
            entrada('ex-press', [serie(75, 6)], 'Press de banca'),
            entrada('ex-sentadilla', [serie(60, 5)], 'Sentadilla'),
          ],
          { plan: planDe('ex-press', 'ex-sentadilla') },
        ),
      ],
    });
    expect(result.planChanges.reordered).toBe(false);
    expect(result.planChanges.unplanned).toEqual([]);
  });
});
