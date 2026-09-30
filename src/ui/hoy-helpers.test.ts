/**
 * `ui/hoy-helpers.ts`: lo que hay que comprobar de la pestaña Hoy sin abrir un
 * navegador.
 *
 * Las reglas que se fijan aquí son las que la v1 solo se podía comprobar
 * entrenando:
 *
 * - el día hecho manda sobre el plan (y una sesión de HOY cuenta, aunque el
 *   plan diga otra cosa);
 * - `day.plan` sucio (JSON a mano, items sin ejercicio) no arruina el hero;
 * - los KPIs de 7 días no inventan una comparativa cuando la semana previa está
 *   vacía;
 * - "Repetir" carga el peso de la MEJOR serie, no del último set;
 * - la racha del chip es la MISMA que pinta Progreso (`totals()`).
 */
import { describe, expect, it } from 'vitest';

import { streak, totals } from '@/domain/analytics';
import type { Exercise, Session, SessionEntry, SetLog } from '@/domain/types';
import type { Routine, ScheduleDay } from '@/state/store';

import { restDayPatch } from './calendar-helpers';
import {
  greeting,
  lastSessions,
  planRows,
  repeatItems,
  suggestionPlan,
  suggestionRows,
  suggestionSource,
  todayPlan,
  weekCells,
  weekKpis,
} from './hoy-helpers';
import type { RoutineSuggestion } from './routines-helpers';

/* ---------- datos de prueba ---------- */

const HOY = '2026-09-24'; // jueves
const LUNES = '2026-09-21'; // lunes de esa semana
const PREV_WEEK = '2026-09-16'; // miércoles de la semana anterior

const serie = (weight: number | null, reps: number, done = true): SetLog => ({
  weight,
  reps,
  done,
  rpe: null,
});

const entrada = (exId: string, sets: SetLog[], extra: Partial<SessionEntry> = {}) => ({
  exId,
  sets,
  ...extra,
});

function sesion(
  date: string,
  entries: SessionEntry[] = [],
  opts: { startedAt?: string; endedAt?: string } = {},
): Session {
  const startedAt = opts.startedAt ?? `${date}T10:00:00.000Z`;
  return {
    id: `s-${date}-${startedAt}`,
    date,
    startedAt,
    endedAt: opts.endedAt ?? `${date}T11:00:00.000Z`,
    unit: 'kg',
    entries,
  };
}

const rutina: Routine = {
  id: 'rt_1',
  name: 'Empuje A',
  items: [{ exId: 'press', sets: 4, repMin: 6, repMax: 8, rest: 120, weight: 60 }],
};

const biblio: Exercise[] = [
  {
    id: 'press',
    name: 'Press banca',
    group: 'pecho',
    equip: 'barra',
    type: 'compuesto',
    sets: 4,
    repMin: 6,
    repMax: 8,
    rest: 120,
    allowed: true,
    custom: false,
    bw: false,
    tags: [],
    tips: '',
  },
  {
    id: 'remo',
    name: 'Remo con mancuerna',
    group: 'espalda',
    equip: '',
    type: 'compuesto',
    sets: 3,
    repMin: 8,
    repMax: 10,
    rest: 90,
    allowed: true,
    custom: false,
    bw: true,
    tags: [],
    tips: '',
  },
];

/* ---------- todayPlan: los 3 estados del hero ---------- */

describe('todayPlan', () => {
  it('plan: arranca desde la rutina del día', () => {
    const plan = todayPlan(
      { routineId: 'rt_1', status: 'planned', type: 'entreno', source: 'plan' },
      [rutina],
      [],
      HOY,
    );
    expect(plan.status).toBe('plan');
    expect(plan.title).toBe('Empuje A');
    expect(plan.routineId).toBe('rt_1');
    expect(plan.source).toBe('plan');
    expect(plan.type).toBe('Entreno');
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({ exId: 'press', sets: 4, weight: 60, rest: 120 });
  });

  it('done: el plan marcado como hecho manda aunque haya rutina', () => {
    const plan = todayPlan({ routineId: 'rt_1', status: 'done' }, [rutina], [], HOY);
    expect(plan.status).toBe('done');
    expect(plan.items).toHaveLength(1);
  });

  it('done: una sesión registrada HOY deja el hero en hecho (sin plan que valga)', () => {
    const plan = todayPlan(undefined, [], [sesion(HOY, [entrada('press', [serie(60, 8)])])], HOY);
    expect(plan.status).toBe('done');

    const planConRutina = todayPlan(
      { routineId: 'rt_1', status: 'planned' },
      [rutina],
      [sesion(HOY)],
      HOY,
    );
    expect(planConRutina.status).toBe('done');
  });

  it('empty: primer día, sin nada programado', () => {
    const plan = todayPlan(undefined, [], [], HOY);
    expect(plan).toMatchObject({ status: 'empty', title: '', items: [], routineId: null });
    expect(plan.type).toBe('Libre');
  });

  it('empty: la rutina del día ya no existe (borrada), sin plan suelto', () => {
    const plan = todayPlan({ routineId: 'rt_borrada', status: 'planned' }, [rutina], [], HOY);
    expect(plan.status).toBe('empty');
    expect(plan.items).toEqual([]);
    expect(plan.routineId).toBe('rt_borrada');
  });

  it('plan: day.plan de la v1 se valida (y lo sin ejercicio se descarta)', () => {
    const plan = todayPlan(
      {
        plan: [
          { name: 'Press banca', sets: 3, reps: 8 },
          { sets: 5 },
          { exId: 'remo' },
          'esto no es un item',
          { exId: '', name: '' },
        ],
      },
      [],
      [],
      HOY,
    );
    expect(plan.status).toBe('plan');
    expect(plan.items).toHaveLength(2);
    expect(plan.items[0]).toMatchObject({ name: 'Press banca', sets: 3, reps: 8, weight: null });
    /* el item sin `exId` ni `name` (el del medio) no puede arrancarse: se descarta */
    expect(plan.items[1]).toMatchObject({ exId: 'remo', sets: 3 });
    /* los defaults de la v1 cuando el item viene a medias */
    expect(plan.items[1]?.repMin).toBe(8);
    expect(plan.items[1]?.repMax).toBe(12);
    expect(plan.items[1]?.rest).toBe(90);
  });

  it('plan: 0 es un peso real y el vacío no', () => {
    const plan = todayPlan({ plan: [{ exId: 'remo', weight: 0 }, { exId: 'press' }] }, [], [], HOY);
    expect(plan.items[0]?.weight).toBe(0);
    expect(plan.items[1]?.weight).toBeNull();
  });

  it('el tipo resuelto cubre los días que el plan dejó a medias', () => {
    expect(todayPlan({ type: 'descanso' }, [], [], HOY).type).toBe('Descanso');
    expect(todayPlan({ status: 'rest' }, [], [], HOY).type).toBe('Descanso');
    /* un día con plan suelto es «Entreno»: la v1 lo rellenaba en el hero */
    expect(todayPlan({ plan: [{ exId: 'remo' }] }, [], [], HOY).type).toBe('Entreno');
    expect(todayPlan(undefined, [], [], HOY).type).toBe('Libre');
  });

  it('saltar NO borra el plan: la v1 seguía ofreciendo el hero', () => {
    /* `Saltar` solo escribe `restDayPatch()` (status + type + título): el hero
       sigue en 'plan' y la celda de la semana pasa a descanso. Paridad con la v1. */
    const plan = todayPlan({ routineId: 'rt_1', ...restDayPatch() }, [rutina], [], HOY);
    expect(plan.status).toBe('plan');
    expect(plan.type).toBe('Descanso');
    expect(plan.items).toHaveLength(1);
  });
});

/* ---------- filas del hero ---------- */

describe('planRows', () => {
  it('resuelve el nombre contra la biblioteca y formatea «sets×reps @ peso»', () => {
    const rows = planRows(
      [
        { exId: 'press', sets: 4, repMin: 6, repMax: 8, weight: 60 },
        { exId: 'remo', repMin: 8, repMax: 10 },
      ],
      biblio,
    );
    expect(rows[0]).toEqual({ name: 'Press banca', spec: '4×7 @ 60' });
    /* sin peso no se escribe «@ 0»: el peso vacío no es cero */
    expect(rows[1]).toEqual({ name: 'Remo con mancuerna', spec: '3×9' });
  });

  it('las reps concretas de day.plan manda sobre la media del rango', () => {
    expect(
      planRows([{ exId: 'press', sets: 4, reps: 10, repMin: 6, repMax: 8 }], biblio)[0]?.spec,
    ).toBe('4×10');
  });

  it('sin límite no pinta la lista entera (la v1 cortaba en 8)', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ exId: 'press', name: `Ej ${i}` }));
    expect(planRows(items, biblio)).toHaveLength(8);
    expect(planRows(items, biblio, 3)).toHaveLength(3);
  });
});

/* ---------- weekCells ---------- */

describe('weekCells', () => {
  const schedule: Record<string, ScheduleDay> = {
    [LUNES]: {},
    '2026-09-22': { status: 'rest' },
    '2026-09-23': { status: 'skipped' },
    '2026-09-25': { routineId: 'rt_1' },
    '2026-09-26': { type: 'descanso' },
  };

  it('devuelve la semana del lunes al domingo en ISO local', () => {
    const cells = weekCells({}, [], HOY);
    expect(cells).toHaveLength(7);
    expect(cells[0]?.iso).toBe(LUNES);
    expect(cells.at(-1)?.iso).toBe('2026-09-27');
    expect(cells.map((c) => c.dow)).toEqual(['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']);
    expect(cells.find((c) => c.isToday)?.iso).toBe(HOY);
  });

  it('pinta los estados: hecho, descanso, saltado, libre y planificado', () => {
    const cells = weekCells(
      schedule,
      [sesion(LUNES, [entrada('press', [serie(60, 8, true)])])],
      HOY,
      [rutina],
    );
    const byIso = new Map(cells.map((c) => [c.iso, c]));

    expect(byIso.get(LUNES)?.state).toBe('done');
    expect(byIso.get(LUNES)?.volume).toBe(480);
    /* el día entrenado sin título se queda con el «libre» de la v1 */
    expect(byIso.get(LUNES)?.tag).toBe('libre');
    expect(byIso.get('2026-09-22')?.state).toBe('rest');
    expect(byIso.get('2026-09-23')?.state).toBe('skipped');
    expect(byIso.get(HOY)?.state).toBe('free');
    expect(byIso.get(HOY)?.tag).toBe('hoy');
    expect(byIso.get('2026-09-25')?.state).toBe('planned');
    expect(byIso.get('2026-09-25')?.tag).toBe('Empuje A');
    expect(byIso.get('2026-09-26')?.tag).toBe('Descanso');
    expect(byIso.get('2026-09-27')?.state).toBe('free');
  });

  it('el volumen de un día suma TODAS sus sesiones', () => {
    const cells = weekCells(
      {},
      [
        sesion(LUNES, [entrada('press', [serie(60, 8, true)])]),
        sesion(LUNES, [entrada('remo', [serie(40, 10, true)])]),
      ],
      HOY,
    );
    expect(cells[0]?.volume).toBe(880);
  });
});

/* ---------- weekKpis ---------- */

describe('weekKpis', () => {
  it('primer día: todo a cero y sin comparativa', () => {
    expect(weekKpis([], HOY, 4)).toEqual({
      sessions: 0,
      volume: 0,
      sets: 0,
      minutes: 0,
      deltaPct: null,
      objective: 4,
    });
  });

  it('con semana previa calcula el % de volumen', () => {
    const sessions = [
      sesion(HOY, [entrada('press', [serie(60, 8), serie(60, 8)])]),
      sesion(PREV_WEEK, [entrada('press', [serie(60, 8), serie(60, 8)])]),
      sesion(PREV_WEEK, [entrada('press', [serie(60, 8), serie(60, 8)])]),
    ];
    const k = weekKpis(sessions, HOY, 3);
    expect(k.sessions).toBe(1);
    expect(k.volume).toBe(960);
    expect(k.sets).toBe(2);
    expect(k.minutes).toBe(60);
    /* 960 vs 1920 → −50 % */
    expect(k.deltaPct).toBe(-50);
    expect(k.objective).toBe(3);
  });

  it('sin semana previa (o sin cambio) no hay comparativa, como en la v1', () => {
    const soloHoy = [sesion(HOY, [entrada('press', [serie(60, 8)])])];
    expect(weekKpis(soloHoy, HOY, 4).deltaPct).toBeNull();

    const igual = [
      sesion(HOY, [entrada('press', [serie(60, 8)])]),
      sesion(PREV_WEEK, [entrada('press', [serie(60, 8)])]),
    ];
    expect(weekKpis(igual, HOY, 4).deltaPct).toBeNull();
  });

  it('si esta semana está en cero y la previa no, el delta es −100 %', () => {
    const previa = [sesion(PREV_WEEK, [entrada('press', [serie(60, 8)])])];
    expect(weekKpis(previa, HOY, 4).deltaPct).toBe(-100);
  });
});

/* ---------- repetir una sesión ---------- */

describe('repeatItems', () => {
  it('carga el peso y las reps de la MEJOR serie, con su basis', () => {
    const item = repeatItems(
      sesion(HOY, [
        entrada('press', [serie(60, 8), serie(65, 5), serie(null, 10)], {
          restSec: 120,
          notes: 'sin pausa',
        }),
      ]),
    )[0];
    expect(item).toMatchObject({
      exId: 'press',
      sets: 3,
      weight: 65,
      reps: 5,
      rest: 120,
      basis: 'repetición de 24 sep 2026',
      notes: 'sin pausa',
    });
    /* las reps concretas también valen como rango para la sesión */
    expect(item.repMin).toBe(5);
    expect(item.repMax).toBe(5);
  });

  it('una entrada sin series sigue siendo 1 serie con reps por defecto', () => {
    const item = repeatItems(sesion(HOY, [entrada('remo', [])]))[0];
    expect(item).toMatchObject({ sets: 1, weight: 0, reps: 10, rest: 90 });
  });
});

/* ---------- últimas sesiones ---------- */

describe('lastSessions', () => {
  it('ordena por startedAt descendente, corta en 4 y no muta la lista', () => {
    const lista = [
      sesion('2026-09-20', [], { startedAt: '2026-09-20T10:00:00.000Z' }),
      sesion('2026-09-22', [], { startedAt: '2026-09-22T18:00:00.000Z' }),
      sesion('2026-09-22', [], { startedAt: '2026-09-22T09:00:00.000Z' }),
      sesion('2026-09-23'),
      sesion('2026-09-24'),
      sesion('2026-09-21'),
    ];
    const original = [...lista];
    const out = lastSessions(lista);

    expect(out).toHaveLength(4);
    expect(out.map((s) => s.startedAt)).toEqual([
      '2026-09-24T10:00:00.000Z',
      '2026-09-23T10:00:00.000Z',
      '2026-09-22T18:00:00.000Z',
      '2026-09-22T09:00:00.000Z',
    ]);
    expect(lista).toEqual(original);
    expect(lastSessions(lista, 0)).toEqual([]);
  });
});

/* ---------- saludo ---------- */

describe('greeting', () => {
  it('saluda por la hora y usa solo el primer nombre', () => {
    expect(greeting(9, 'Ana García')).toBe('Buenos días, Ana');
    expect(greeting(13, 'Ana García')).toBe('Buenas tardes, Ana');
    expect(greeting(20, 'Ana')).toBe('Buenas noches, Ana');
    expect(greeting(12, '')).toBe('Buenos días');
    expect(greeting(21, '   ')).toBe('Buenas noches');
  });
});

/* ---------- sugerencia del coach ---------- */

describe('sugerencia', () => {
  const sugerencia: RoutineSuggestion = {
    title: 'Sesión de pecho + espalda',
    focus: 'pecho · espalda',
    rationale: ['Hace 3 días que no tocas pecho'],
    exercises: [
      {
        name: 'Press banca',
        matched: true,
        sets: 4,
        repMin: 6,
        repMax: 8,
        rest: 120,
        weight: 60,
        notes: '',
      },
      {
        name: 'Ejercicio que no existe',
        matched: false,
        sets: 3,
        repMin: 10,
        repMax: 12,
        rest: 60,
        weight: null,
        notes: '',
      },
    ],
  };

  it('las filas llevan grupo (desde la biblioteca), reps medias y peso', () => {
    const rows = suggestionRows(sugerencia, biblio);
    expect(rows[0]).toEqual({
      name: 'Press banca',
      group: 'pecho',
      sets: 4,
      reps: 7,
      weight: 60,
      matched: true,
    });
    expect(rows[1]?.group).toBe('');
    expect(rows[1]?.reps).toBe(11);
  });

  it('para arrancar solo se lleva lo que resolvió contra la biblioteca', () => {
    expect(suggestionPlan(sugerencia)).toEqual([
      { name: 'Press banca', sets: 4, repMin: 6, repMax: 8, rest: 120, weight: 60, notes: '' },
    ]);
  });
});

/* ---------- el chip de racha de la barra ---------- */

describe('racha del chip', () => {
  it('es la misma que pinta Progreso (totals)', () => {
    const sessions = [
      sesion(HOY, [entrada('press', [serie(60, 8)])]),
      sesion('2026-09-23', [entrada('press', [serie(60, 8)])]),
    ];
    expect(totals(sessions, HOY).streak).toBe(2);
    expect(totals(sessions, HOY).streak).toBe(streak(sessions, HOY));
    expect(totals([], HOY).streak).toBe(0);
  });
});

/* ---------- badge IA / local de la sugerencia ---------- */

describe('suggestionSource', () => {
  it('el badge de la v1: solo source:ia es IA, lo demás es local', () => {
    expect(suggestionSource({ source: 'ia' })).toBe('ia');
    expect(suggestionSource({ source: 'local' })).toBe('local');
    expect(suggestionSource({ source: 'generador' })).toBe('local');
    expect(suggestionSource({ title: 'x' })).toBe('local');
    expect(suggestionSource(null)).toBe('local');
    expect(suggestionSource('texto suelto')).toBe('local');
  });

  it('sin source manda el fallback (IA cuando venimos del coach)', () => {
    expect(suggestionSource({ title: 'x' }, 'ia')).toBe('ia');
    expect(suggestionSource(undefined, 'ia')).toBe('ia');
    /* pero un source explícito no lo tapa: si el planificador local cubrió una
       caída de red, el payload dice local y el badge no puede mentir */
    expect(suggestionSource({ source: 'local' }, 'ia')).toBe('local');
  });
});
