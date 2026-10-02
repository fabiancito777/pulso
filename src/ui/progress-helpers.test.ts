/**
 * `ui/progress-helpers.ts`: lo que hay que comprobar de la pestaña Progreso sin
 * abrir un navegador.
 *
 * Las reglas que se fijan aquí son las que la v1 solo se podía comprobar
 * entrenando o con `?selftest=1`:
 *
 * - el resumen de cada fila del historial (volumen en kg aunque la sesión esté
 *   en lb, series hechas, duración y grupos sin repetir);
 * - «récord nuevo» = mejor 1RM que en cualquier sesión con fecha ANTERIOR, con
 *   margen 0,01: un empate no es récord;
 * - los tonos de «último estímulo» (≤3 ok, ≤7 warn, más frío danger, sin datos
 *   muted) y que cardio/movilidad no salen;
 * - la tabla de PRs ordenada por 1RM estimado desc;
 * - los chips de progresión por número de sesiones, con tope y desempate.
 */
import { describe, expect, it } from 'vitest';

import { e1rm } from '@/domain/analytics';
import { groupKeysInUse } from '@/domain/data';
import type { Exercise, Session, SessionEntry, SetLog, Unit } from '@/domain/types';

import {
  historyExerciseIds,
  lastStimulusRows,
  newPrs,
  prRows,
  prsBefore,
  sessionSummary,
  topExercises,
} from './progress-helpers';

/* ---------- datos de prueba ---------- */

const HOY = '2026-09-24';

const serie = (weight: number | null, reps: number, done = true): SetLog => ({
  weight,
  reps,
  done,
  rpe: null,
});

const entrada = (
  exId: string,
  sets: SetLog[],
  extra: Partial<SessionEntry> = {},
): SessionEntry => ({
  exId,
  sets,
  ...extra,
});

function sesion(
  date: string,
  entries: SessionEntry[] = [],
  opts: { unit?: Unit; startedAt?: string; endedAt?: string; demo?: boolean } = {},
): Session {
  const startedAt = opts.startedAt ?? `${date}T10:00:00.000Z`;
  const session: Session = {
    id: `s-${date}`,
    date,
    startedAt,
    endedAt: opts.endedAt ?? `${date}T11:00:00.000Z`,
    unit: opts.unit ?? 'kg',
    entries,
  };
  if (opts.demo) session.demo = true;
  return session;
}

function ejercicio(id: string, group: string, name = id): Exercise {
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
    bw: false,
    tags: [],
    tips: '',
  };
}

const BIBLIO: Exercise[] = [
  ejercicio('press', 'pecho', 'Press banca'),
  ejercicio('remo', 'espalda', 'Remo con barra'),
  ejercicio('sentadilla', 'cuadriceps', 'Sentadilla'),
  ejercicio('curl', 'biceps', 'Curl de bíceps'),
  ejercicio('cycling', 'cardio', 'Bicicleta'),
  ejercicio('estirar', 'movilidad', 'Estiramiento'),
  ejercicio('militar', 'hombros', 'Press militar'),
];

const exIds = (list: readonly Exercise[]): string[] => list.map((e) => e.id);

/* ---------- sessionSummary ---------- */

describe('sessionSummary', () => {
  it('resume fecha, nombre, volumen, series, duración y grupos', () => {
    const s = sesion('2026-09-20', [entrada('press', [serie(60, 5), serie(60, 5, false)])], {
      startedAt: '2026-09-20T10:00:00.000Z',
      endedAt: '2026-09-20T10:45:00.000Z',
    });
    const out = sessionSummary(s, BIBLIO);
    expect(out).toEqual({
      id: 's-2026-09-20',
      date: '2026-09-20',
      name: 'Entrenamiento',
      volume: 300,
      sets: 1,
      minutes: 45,
      groups: ['Pecho'],
      demo: false,
    });
  });

  it('convierte a kg el volumen de una sesión en lb y marca el badge demo', () => {
    const s = sesion('2026-09-20', [entrada('press', [serie(100, 5)])], { unit: 'lb', demo: true });
    const out = sessionSummary(s, BIBLIO);
    expect(out.volume).toBeCloseTo(100 * 5 * 0.45359237, 6);
    expect(out.demo).toBe(true);
  });

  it('sin biblioteca usa el grupo de respaldo de la entrada y no repite etiquetas', () => {
    const s = sesion('2026-09-20', [
      entrada('desconocido-a', [serie(20, 10)], { group: 'espalda' }),
      entrada('desconocido-b', [serie(20, 10)], { group: 'espalda' }),
      entrada('desconocido-c', [serie(20, 10)]),
    ]);
    expect(sessionSummary(s, []).groups).toEqual(['Espalda']);
  });
});

/* ---------- prsBefore / newPrs ---------- */

describe('prsBefore', () => {
  it('se queda con el mejor 1RM de las sesiones estrictamente anteriores', () => {
    const previa = sesion('2026-09-18', [
      entrada('press', [serie(60, 5), serie(50, 8), serie(60, 5, false)]),
    ]);
    const mismaFecha = sesion('2026-09-20', [entrada('press', [serie(100, 5)])]);
    const posterior = sesion('2026-09-22', [entrada('press', [serie(90, 5)])]);
    const prior = prsBefore([previa, mismaFecha, posterior], '2026-09-20');
    /* 60×5 = 70 kg de e1RM; 50×8 = 63,33; la serie sin marcar no cuenta */
    expect(prior.press).toBeCloseTo(e1rm(60, 5), 6);
    expect(Object.keys(prior)).toEqual(['press']);
  });

  it('devuelve un mapa vacío si no hay historial anterior', () => {
    expect(prsBefore([], '2026-09-20')).toEqual({});
    expect(
      prsBefore([sesion('2026-09-21', [entrada('press', [serie(60, 5)])])], '2026-09-20'),
    ).toEqual({});
  });
});

describe('newPrs', () => {
  const soloPress = sesion('2026-09-24', [entrada('press', [serie(60, 5), serie(60, 5, false)])]);
  const sesionConPress = sesion('2026-09-24', [
    entrada('press', [serie(60, 5), serie(60, 5, false)]),
    entrada('remo', [serie(40, 8)]),
  ]);

  it('sin marca previa todo cuenta como récord', () => {
    const out = newPrs(sesionConPress, {});
    expect(out.map((r) => r.exId)).toEqual(['press', 'remo']);
    expect(out[0]).toEqual({ exId: 'press', e1rm: e1rm(60, 5), weight: 60, reps: 5 });
  });

  it('con margen 0,01: el empate y las mejoras de miligramos NO son récord', () => {
    const press = e1rm(60, 5);
    expect(newPrs(soloPress, { press })).toEqual([]);
    expect(newPrs(soloPress, { press: press - 0.005 })).toEqual([]);
    expect(newPrs(soloPress, { press: press - 0.1 })).toHaveLength(1);
  });

  it('una serie sin marcar no puede firmar un récord', () => {
    const s = sesion('2026-09-24', [entrada('press', [serie(100, 5, false)])]);
    expect(newPrs(s, {})).toEqual([]);
  });
});

/* ---------- lastStimulusRows ---------- */

describe('lastStimulusRows', () => {
  const hoy = HOY;
  const lista: Session[] = [
    sesion('2026-09-21', [entrada('press', [serie(60, 5)])]), // pecho: 3 d
    sesion('2026-09-18', [entrada('remo', [serie(60, 5)])]), // espalda: 6 d
    sesion('2026-09-17', [entrada('sentadilla', [serie(60, 5)])]), // cuádriceps: 7 d
    sesion('2026-09-10', [entrada('curl', [serie(20, 10)])]), // bíceps: 14 d
    sesion('2026-09-23', [entrada('cycling', [serie(0, 30)]), entrada('estirar', [serie(0, 1)])]),
  ];

  const rows = lastStimulusRows(lista, BIBLIO, hoy);

  it('solo saca los grupos que tienes, y sin cardio ni movilidad (van en minutos)', () => {
    const esperados = [...groupKeysInUse(BIBLIO)].filter(
      (k) => k !== 'cardio' && k !== 'movilidad',
    );
    expect(rows.map((r) => r.key).sort()).toEqual(esperados.sort());
    expect(rows.some((r) => r.key === 'cardio' || r.key === 'movilidad')).toBe(false);
  });

  it('pinta los tonos de la v1: ≤3 ok, ≤7 warn, más frío danger y sin datos muted', () => {
    const byKey = new Map(rows.map((r) => [r.key, r]));
    expect(byKey.get('pecho')).toMatchObject({ days: 3, tone: 'ok', iso: '2026-09-21' });
    expect(byKey.get('espalda')).toMatchObject({ days: 6, tone: 'warn' });
    expect(byKey.get('cuadriceps')).toMatchObject({ days: 7, tone: 'warn' });
    expect(byKey.get('biceps')).toMatchObject({ days: 14, tone: 'danger' });
    expect(byKey.get('hombros')).toMatchObject({ days: null, tone: 'muted', iso: null });
  });

  it('ordena por días SIN entrenar (lo más descuidado primero, nulls = 999 en la v1)', () => {
    const conDatos = rows.filter((r) => r.days !== null).map((r) => r.days);
    expect(conDatos).toEqual([14, 7, 6, 3]);
    const sinDatos = rows.filter((r) => r.days === null).length;
    expect(rows.findIndex((r) => r.days !== null)).toBe(sinDatos);
  });
});

/* ---------- prRows ---------- */

describe('prRows', () => {
  it('ordena por 1RM estimado descendente y usa la mejor serie de cada ejercicio', () => {
    const lista = [
      sesion('2026-09-20', [entrada('press', [serie(60, 5)]), entrada('remo', [serie(50, 5)])]),
      sesion('2026-09-22', [entrada('press', [serie(70, 5)])]),
    ];
    const rows = prRows(lista);
    expect(rows.map((r) => r.exId)).toEqual(['press', 'remo']);
    expect(rows[0]).toMatchObject({ e1rm: e1rm(70, 5), weight: 70, reps: 5, date: '2026-09-22' });
    expect(rows[1]).toMatchObject({ e1rm: e1rm(50, 5), date: '2026-09-20' });
  });

  it('sin sesiones no hay récords', () => {
    expect(prRows([])).toEqual([]);
  });
});

/* ---------- topExercises / historyExerciseIds ---------- */

describe('topExercises', () => {
  const lista = [
    sesion('2026-09-20', [entrada('press', []), entrada('remo', [])]),
    sesion('2026-09-22', [entrada('press', []), entrada('remo', [])]),
    sesion('2026-09-24', [entrada('press', []), entrada('sentadilla', [])]),
  ];

  it('ordena por número de sesiones y respeta el tope', () => {
    expect(topExercises(lista)).toEqual([
      { id: 'press', n: 3 },
      { id: 'remo', n: 2 },
      { id: 'sentadilla', n: 1 },
    ]);
    expect(topExercises(lista, 2)).toHaveLength(2);
    expect(topExercises(lista, 0)).toEqual([]);
  });

  it('desempata por id para que los chips no bailen entre repintados', () => {
    const empatadas = [
      sesion('2026-09-20', [entrada('zzz', []), entrada('aaa', [])]),
      sesion('2026-09-22', [entrada('zzz', []), entrada('aaa', [])]),
    ];
    expect(topExercises(empatadas)).toEqual([
      { id: 'aaa', n: 2 },
      { id: 'zzz', n: 2 },
    ]);
  });

  it('los ★ desempatan antes que el id, pero la frecuencia sigue mandando', () => {
    const empatadas = [
      sesion('2026-09-20', [entrada('zzz', []), entrada('aaa', [])]),
      sesion('2026-09-22', [entrada('zzz', []), entrada('aaa', [])]),
    ];
    /* mismo número de sesiones: gana el ★, no el id alfabético */
    expect(topExercises(empatadas, 8, [{ ...ejercicio('zzz', 'pecho'), fav: true }])).toEqual([
      { id: 'zzz', n: 2 },
      { id: 'aaa', n: 2 },
    ]);
    /* sin ★ el orden vuelve a ser el de siempre (regresión) */
    expect(topExercises(empatadas, 8, [ejercicio('zzz', 'pecho')])).toEqual([
      { id: 'aaa', n: 2 },
      { id: 'zzz', n: 2 },
    ]);
    /* la frecuencia manda sobre el ★ */
    const asimetrica = [
      sesion('2026-09-20', [entrada('aaa', [])]),
      sesion('2026-09-22', [entrada('aaa', []), entrada('zzz', [])]),
    ];
    expect(topExercises(asimetrica, 8, [{ ...ejercicio('zzz', 'pecho'), fav: true }])).toEqual([
      { id: 'aaa', n: 2 },
      { id: 'zzz', n: 1 },
    ]);
  });

  it('historyExerciseIds deja solo los que aparecen en el historial (picker «Otro»)', () => {
    expect(exIds(BIBLIO).filter((id) => historyExerciseIds(lista).includes(id))).toEqual([
      'press',
      'remo',
      'sentadilla',
    ]);
    expect(historyExerciseIds([])).toEqual([]);
  });
});
