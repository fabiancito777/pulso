/**
 * Analítica: lo que en la v1 solo se veía dentro del auto-test del navegador
 * (`legacy/js/app.js` → `selfTest()`) o dándole a "Progreso", ahora con datos
 * construidos a mano y sin depender de la fecha real del sistema.
 *
 * Los datos de prueba son sesiones de 1 hora (10:00 → 11:00) para que la duración
 * no dependa del reloj.
 */
import { describe, expect, it } from 'vitest';

import {
  bestStreak,
  byDow,
  daysSince,
  durationOf,
  e1rm,
  exerciseSeries,
  groupSets,
  groupVolume,
  lastEntry,
  lastTrained,
  prs,
  recentExercises,
  sessionDate,
  sessionsSince,
  setKg,
  setVolumeKg,
  setsOf,
  streak,
  suggestWeight,
  totals,
  volumeOf,
  weeklySeries,
} from './analytics';
import type { Exercise, Session, SessionEntry, SetLog, Unit } from './types';

/* ---------- datos de prueba ---------- */

const HOY = '2026-09-24'; // jueves
const LUNES = '2026-09-21'; // lunes de esa semana

const serie = (weight: number | null, reps: number, done = true): SetLog => ({
  weight,
  reps,
  done,
  ts: '2026-09-24T10:00:00.000Z',
  rpe: null,
});

const entrada = (
  exId: string,
  sets: SetLog[],
  extra: Partial<SessionEntry> = {},
): SessionEntry => ({ exId, sets, ...extra });

let counter = 0;

function sesion(
  date: string,
  entries: SessionEntry[],
  opts: { unit?: Unit; startedAt?: string; endedAt?: string | null } = {},
): Session {
  counter++;
  const startedAt = opts.startedAt ?? `${date}T10:00:00.000Z`;
  const endedAt = opts.endedAt === null ? undefined : (opts.endedAt ?? `${date}T11:00:00.000Z`);
  return {
    id: `s${counter}`,
    date,
    startedAt,
    ...(endedAt === undefined ? {} : { endedAt }),
    unit: opts.unit ?? 'kg',
    entries,
  };
}

const press = (sets: SetLog[]): SessionEntry =>
  entrada('ex-press', sets, { name: 'Press de banca', group: 'pecho' });

const sentadilla = (sets: SetLog[]): SessionEntry =>
  entrada('ex-sentadilla', sets, { name: 'Sentadilla', group: 'piernas' });

const BIBLIOTECA: Exercise[] = [
  {
    id: 'ex-press',
    name: 'Press de banca',
    group: 'pecho',
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
  },
  {
    id: 'ex-sentadilla',
    name: 'Sentadilla',
    group: 'piernas',
    equip: '',
    type: 'compuesto',
    sets: 4,
    repMin: 6,
    repMax: 10,
    rest: 240,
    allowed: true,
    custom: false,
    bw: false,
    tags: [],
    tips: '',
  },
];

/* ---------- primitivas ---------- */

describe('conversión de series', () => {
  it('un set sin peso vale 0, no NaN', () => {
    expect(setKg({ weight: null, reps: 5, done: true })).toBe(0);
    expect(setKg(undefined)).toBe(0);
    expect(setKg({ weight: 20, reps: 5, done: true })).toBe(20);
  });

  it('convierte lb a kg con la unidad de la sesión', () => {
    expect(setKg({ weight: 45, reps: 10, done: true }, 'lb')).toBeCloseTo(20.4117, 3);
  });

  it('el volumen solo cuenta series marcadas', () => {
    expect(setVolumeKg({ weight: 20, reps: 5, done: true })).toBe(100);
    expect(setVolumeKg({ weight: 20, reps: 5, done: false })).toBe(0);
    expect(setVolumeKg({ weight: null, reps: 5, done: true })).toBe(0);
  });

  it('la fecha de la sesión sale del campo `date` o del arranque', () => {
    expect(sessionDate(sesion(HOY, []))).toBe(HOY);
    expect(
      sessionDate({ ...sesion(HOY, []), date: '', startedAt: '2026-09-20T08:00:00.000Z' }),
    ).toBe('2026-09-20');
  });
});

describe('1RM estimado (Epley)', () => {
  it('100 kg × 5 = 116,67 kg', () => {
    expect(e1rm(100, 5)).toBeCloseTo(116.6667, 3);
  });

  it('una sola repetición devuelve el peso levantado', () => {
    expect(e1rm(100, 1)).toBe(100);
  });

  it('sin peso o sin reps es 0 (nunca NaN)', () => {
    expect(e1rm(0, 5)).toBe(0);
    expect(e1rm(100, 0)).toBe(0);
    expect(e1rm(100, -3)).toBe(0);
    expect(e1rm('', '')).toBe(0);
  });
});

describe('por sesión', () => {
  const s = sesion(HOY, [
    press([serie(20, 5), serie(20, 5), serie(20, 5, false)]),
    sentadilla([serie(40, 5)]),
  ]);

  it('suma el volumen de todas las series marcadas, en kg', () => {
    expect(volumeOf(s)).toBe(100 + 100 + 200);
  });

  it('cuenta las series hechas', () => {
    expect(setsOf(s)).toBe(3);
  });

  it('una sesión en libras se suma en kg', () => {
    const enLibras = sesion(HOY, [press([serie(45, 10)])], { unit: 'lb' });
    expect(volumeOf(enLibras)).toBeCloseTo(204.117, 2);
  });

  it('la duración sale de arranque y final', () => {
    expect(durationOf(s)).toBe(3_600_000);
  });

  it('una sesión sin cerrar dura hasta `now` (inyectado)', () => {
    const abierta = sesion(HOY, [], { startedAt: `${HOY}T10:00:00.000Z`, endedAt: null });
    expect(durationOf(abierta, Date.parse(`${HOY}T10:30:00.000Z`))).toBe(1_800_000);
  });

  it('sin arranque no hay duración', () => {
    expect(durationOf({ ...s, startedAt: '' })).toBe(0);
  });
});

describe('ventanas y rachas', () => {
  it('trae las sesiones de los últimos N días, incluido hoy', () => {
    const todas = [
      sesion(HOY, []),
      sesion('2026-09-20', []),
      sesion('2026-09-18', []),
      sesion('2026-08-01', []),
    ];
    const semana = sessionsSince(todas, 7, HOY);
    expect(semana.map(sessionDate)).toEqual([HOY, '2026-09-20', '2026-09-18']);
  });

  it('la racha cuenta días seguidos hasta hoy', () => {
    const encadenadas = [sesion(HOY, []), sesion('2026-09-23', []), sesion('2026-09-22', [])];
    expect(streak(encadenadas, HOY)).toBe(3);
  });

  it('si hoy aún no has entrenado, la racha sigue viva desde ayer', () => {
    const ayerYAntes = [sesion('2026-09-23', []), sesion('2026-09-22', [])];
    expect(streak(ayerYAntes, HOY)).toBe(2);
  });

  it('un día sin entrenar la corta', () => {
    const hueco = [sesion(HOY, []), sesion('2026-09-22', [])];
    expect(streak(hueco, HOY)).toBe(1);
  });

  it('sin sesiones la racha es 0', () => {
    expect(streak([], HOY)).toBe(0);
  });

  it('la mejor racha es la más larga del historial, no la actual', () => {
    const historial = [
      sesion('2026-09-10', []),
      sesion('2026-09-11', []),
      sesion('2026-09-12', []),
      sesion('2026-09-20', []),
      sesion(HOY, []),
    ];
    expect(bestStreak(historial)).toBe(3);
    expect(streak(historial, HOY)).toBe(1);
    expect(bestStreak([])).toBe(0);
  });

  it('cuenta las sesiones por día de la semana (0 = lunes)', () => {
    const out = byDow([sesion(LUNES, []), sesion(HOY, []), sesion(HOY, [])]);
    expect(out[0]).toBe(1); // lunes
    expect(out[3]).toBe(2); // jueves
    expect(out).toHaveLength(7);
  });
});

describe('series semanales', () => {
  const semanas = weeklySeries(
    [
      sesion(HOY, [press([serie(20, 5)])]),
      sesion('2026-09-15', [press([serie(30, 5)])]),
      sesion('2026-09-16', [press([serie(30, 5)])]),
    ],
    8,
    HOY,
  );

  it('devuelve 8 semanas de la más antigua a la actual', () => {
    expect(semanas).toHaveLength(8);
    expect(semanas[0]?.iso).toBe('2026-08-03');
    expect(semanas[7]?.iso).toBe(LUNES);
    expect(semanas[7]?.to).toBe('2026-09-27');
  });

  it('agrupa volumen, sesiones, series y minutos', () => {
    expect(semanas[7]).toMatchObject({ sessions: 1, sets: 1, volume: 100, minutes: 60 });
    expect(semanas[6]).toMatchObject({ sessions: 2, sets: 2, volume: 300, minutes: 120 });
    expect(semanas[0]).toMatchObject({ sessions: 0, sets: 0, volume: 0, minutes: 0 });
  });

  it('cada semana trae su etiqueta y su rango de fechas', () => {
    expect(semanas[7]?.label).toContain('21');
    expect(semanas[7]?.from).toBe(LUNES);
  });
});

describe('récords', () => {
  it('se queda con el mejor 1RM estimado por ejercicio', () => {
    const out = prs([
      sesion('2026-09-10', [press([serie(50, 5), serie(20, 5, false)])]),
      sesion(HOY, [press([serie(60, 3)])]),
    ]);
    expect(out['ex-press']).toMatchObject({ weight: 60, reps: 3, date: HOY });
    expect(out['ex-press']?.e1rm).toBeCloseTo(66, 5);
  });

  it('ignora las series sin marcar y las que no tienen reps', () => {
    const out = prs([sesion(HOY, [press([serie(120, 1, false), serie(100, 0)])])]);
    expect(out).toEqual({});
  });

  it('sin sesiones no hay récords', () => {
    expect(prs([])).toEqual({});
  });
});

describe('histórico de un ejercicio', () => {
  const historial = [
    sesion(HOY, [press([serie(60, 3)]), sentadilla([serie(100, 5)])]),
    sesion('2026-09-10', [press([serie(50, 5)])]),
    sesion('2026-09-05', [sentadilla([serie(90, 5)])]),
  ];

  it('va de la sesión más antigua a la más reciente y solo con ese ejercicio', () => {
    const puntos = exerciseSeries(historial, 'ex-press');
    expect(puntos.map((p) => p.iso)).toEqual(['2026-09-10', HOY]);
    expect(puntos[1]).toMatchObject({ top: 60, reps: 3, sets: 1, volume: 180 });
    expect(puntos[1]?.e1rm).toBeCloseTo(66, 5);
  });

  it('los últimos datos del ejercicio son los de su última sesión', () => {
    const last = lastEntry(historial, 'ex-press');
    expect(sessionDate(last!.session)).toBe(HOY);
    expect(last!.entry.exId).toBe('ex-press');
    expect(lastEntry(historial, 'no-existe')).toBeNull();
  });
});

describe('sugerencia de peso', () => {
  const conHistorial = [sesion('2026-09-20', [press([serie(100, 5)])])];
  const ejercicio = BIBLIOTECA[0];

  it('sin historial devuelve 0 (la app lo pinta vacío) y las reps del ejercicio', () => {
    const s = suggestWeight([], 'ex-press', { exercise: ejercicio, unit: 'kg' });
    expect(s).toMatchObject({ weight: 0, kg: 0, basis: 'sin historial', reps: 8 });
  });

  it('sin series marcadas no inventa un peso', () => {
    const sinSeries = [sesion(HOY, [press([serie(100, 5, false)])])];
    expect(suggestWeight(sinSeries, 'ex-press').basis).toBe('sin series registradas');
  });

  it('con las mismas repeticiones propone un incremento más', () => {
    /* 100×5 con 5 reps objetivo da justo 100: la progresión es subir 2,5 kg */
    const s = suggestWeight(conHistorial, 'ex-press', { targetReps: 5, unit: 'kg' });
    expect(s.weight).toBe(102.5);
    expect(s.prev).toBe(100);
    expect(s.prevReps).toBe(5);
    expect(s.basis).toContain('última vez 100 kg × 5');
  });

  it('no salta más de un incremento aunque Epley dé mucho más', () => {
    const s = suggestWeight(conHistorial, 'ex-press', { targetReps: 3, unit: 'kg' });
    expect(s.weight).toBe(102.5);
  });

  it('si pides más repeticiones, el peso baja de verdad', () => {
    const s = suggestWeight(conHistorial, 'ex-press', { targetReps: 8, unit: 'kg' });
    expect(s.weight).toBeCloseTo(92.11, 2);
    expect(s.weight).toBeLessThan(100);
  });

  it('usa las reps del rango del ejercicio cuando no se pide ninguna', () => {
    expect(suggestWeight(conHistorial, 'ex-press', { exercise: ejercicio }).reps).toBe(12);
  });

  it('en libras el incremento por defecto es 5', () => {
    const s = suggestWeight(conHistorial, 'ex-press', {
      targetReps: 5,
      unit: 'lb',
      exercise: ejercicio,
    });
    expect(s.prev).toBeCloseTo(220.46, 2);
    expect(s.weight).toBeCloseTo(225.46, 2);
    expect(s.kg).toBeCloseTo(102.27, 1);
  });

  it('el incremento se puede forzar', () => {
    const s = suggestWeight(conHistorial, 'ex-press', { targetReps: 5, increment: 5 });
    expect(s.weight).toBe(105);
  });
});

describe('agrupación por grupo muscular', () => {
  const historial = [
    sesion(HOY, [
      press([serie(20, 5), serie(20, 5, false)]),
      entrada('ex-antiguo', [serie(10, 10)], { group: 'biceps' }),
      entrada('ex-fantasma', [serie(5, 10)]),
    ]),
  ];

  it('usa el grupo de la biblioteca y cae al de la entrada y a "otros"', () => {
    expect(groupVolume(historial, BIBLIOTECA)).toEqual({ pecho: 100, biceps: 100, otros: 50 });
    expect(groupSets(historial, BIBLIOTECA)).toEqual({ pecho: 1, biceps: 1, otros: 1 });
  });

  it('el último día de cada grupo y los días que han pasado', () => {
    const out = lastTrained(
      [...historial, sesion('2026-09-20', [press([serie(30, 5)])])],
      BIBLIOTECA,
    );
    expect(out['pecho']).toBe(HOY);
    expect(daysSince(out['pecho'], HOY)).toBe(0);
    expect(daysSince(out['biceps'], HOY)).toBe(0);
    expect(daysSince(null)).toBeNull();
  });
});

describe('totales', () => {
  const historial = [
    sesion(HOY, [press([serie(20, 5), serie(20, 5)])]),
    sesion('2026-09-23', [sentadilla([serie(40, 5)])]),
  ];

  it('resume sesiones, volumen, series, tiempo y rachas', () => {
    const t = totals(historial, HOY);
    expect(t.sessions).toBe(2);
    expect(t.volume).toBe(400);
    expect(t.sets).toBe(3);
    expect(t.time).toBe(7_200_000);
    expect(t.avgDuration).toBe(3_600_000);
    expect(t.streak).toBe(2);
    expect(t.bestStreak).toBe(2);
    expect(t.firstDate).toBe('2026-09-23');
  });

  it('sin sesiones no divide por cero', () => {
    expect(totals([])).toMatchObject({ sessions: 0, volume: 0, avgDuration: 0, firstDate: null });
  });
});

describe('ejercicios recientes', () => {
  const historial = [
    sesion(HOY, [press([serie(20, 5)]), sentadilla([serie(40, 5)])]),
    sesion('2026-09-20', [press([serie(20, 5)]), entrada('ex-fantasma', [serie(1, 1)])]),
  ];

  it('devuelve del más reciente al más antiguo, sin repetir y sin inventar ejercicios', () => {
    const out = recentExercises(historial, BIBLIOTECA, 10);
    expect(out.map((o) => o.ex.id)).toEqual(['ex-press', 'ex-sentadilla']);
    expect(out[0]?.date).toBe(HOY);
    expect(out[1]?.date).toBe(HOY);
  });

  it('respeta el límite', () => {
    expect(recentExercises(historial, BIBLIOTECA, 1)).toHaveLength(1);
  });
});
