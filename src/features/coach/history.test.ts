/**
 * Historial del coach: la ficha consolidada por ejercicio y el motor de
 * consulta del bloque ```consulta```.
 *
 * Lo que no se puede romper: una ficha por ejercicio ordenada por recencia con
 * TODO el histórico (sin ventana), pesos convertidos a la unidad de salida,
 * líneas de 180 chars como mucho y consultas que resuelven el nombre con
 * mayúsculas o acentos, o con un parecido FUERTE (≥ 0,85). Un nombre flojo o
 * inventado NO devuelve datos de otro ejercicio: sale el mensaje de «no está
 * registrado» con los candidatos parecidos.
 */
import { describe, expect, it } from 'vitest';

import type { Exercise, RoutineItem, Session, SessionEntry, SetLog, Unit } from '@/domain/types';
import { HISTORY_LINE_MAX, consolidatedHistory, queryHistory } from './history';
import type { HistoryQuery } from './history';

/* ---------- datos de prueba ---------- */

const serie = (weight: number | null, reps: number, done = true): SetLog => ({
  weight,
  reps,
  done,
});

let counter = 0;

function sesion(
  date: string,
  entries: SessionEntry[],
  opts: { unit?: Unit; plan?: RoutineItem[] } = {},
): Session {
  counter++;
  return {
    id: `s${counter}`,
    date,
    startedAt: `${date}T10:00:00.000Z`,
    endedAt: `${date}T11:00:00.000Z`,
    unit: opts.unit ?? 'kg',
    entries,
    ...(opts.plan ? { plan: opts.plan } : {}),
  };
}

const entrada = (exId: string, sets: SetLog[], name?: string, notes?: string): SessionEntry => ({
  exId,
  ...(name ? { name } : {}),
  ...(notes ? { notes } : {}),
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
  ejercicio('ex-dominadas', 'Dominadas lastradas', 'espalda'),
  ejercicio('ex-jalon', 'Jalón al pecho', 'espalda'),
  ejercicio('ex-curl', 'Curl con barra', 'biceps'),
];

const HISTORICO: Session[] = [
  sesion('2026-06-02', [entrada('ex-press', [serie(40, 8), serie(40, 8)], 'Press de banca')]),
  sesion('2026-07-15', [entrada('ex-press', [serie(57.5, 8)], 'Press de banca')]),
  sesion('2026-09-20', [entrada('ex-sentadilla', [serie(60, 5)], 'Sentadilla')]),
  sesion('2026-09-25', [
    entrada('ex-press', [serie(60, 6), serie(60, 6), serie(60, 5)], 'Press de banca'),
  ]),
];

/* ---------- consolidatedHistory ---------- */

describe('consolidatedHistory', () => {
  it('una ficha compacta por ejercicio con sesiones, rango, progreso y últ3', () => {
    const lines = consolidatedHistory(HISTORICO);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      'Press de banca · 3 sesiones · 2026-06-02→2026-09-25 · 40×8 → 60×6 · ' +
        'mejor e1RM 72,8 kg · últ3: 60×6, 57,5×8, 40×8',
    );
    expect(lines[1]).toContain('Sentadilla · 1 sesión · 2026-09-20→2026-09-20');
    expect(lines[1]).toContain('60×5 → 60×5');
    expect(lines[1]).toContain('últ3: 60×5');
  });

  it('ordena por recencia y respeta maxLines', () => {
    expect(consolidatedHistory(HISTORICO, { maxLines: 1 })).toEqual([
      consolidatedHistory(HISTORICO)[0],
    ]);
    expect(consolidatedHistory(HISTORICO, { maxLines: 0 })).toEqual([]);
    expect(consolidatedHistory([])).toEqual([]);
  });

  it('ninguna ficha pasa de 180 caracteres', () => {
    const largo = 'Press de banca con mancuernas inclinado en banco de treinta grados '.repeat(4);
    const sessions = [
      sesion('2026-09-02', [entrada('ex-largo', [serie(30, 8)], largo)]),
      sesion('2026-09-01', [entrada('ex-press', [serie(60, 6)], 'Press de banca')]),
    ];
    for (const line of consolidatedHistory(sessions)) {
      expect(line.length).toBeLessThanOrEqual(HISTORY_LINE_MAX);
    }
    expect(consolidatedHistory(sessions)[0].endsWith('…')).toBe(true);
  });

  it('convierte a la unidad de salida (sesiones en lb incluidas)', () => {
    const sessions = [
      sesion('2026-09-01', [entrada('ex-press', [serie(132, 8)], 'Press de banca')], {
        unit: 'lb',
      }),
    ];
    expect(consolidatedHistory(sessions)[0]).toContain('59,9×8 → 59,9×8');
    expect(consolidatedHistory(sessions)[0]).toContain('mejor e1RM 75,8 kg');
    expect(consolidatedHistory(sessions, { unit: 'lb' })[0]).toContain('132×8 → 132×8');
    expect(consolidatedHistory(sessions, { unit: 'lb' })[0]).toContain('mejor e1RM 167,2 lb');
  });

  it('marca las sustituciones de plan al final de las dos fichas', () => {
    const plan: RoutineItem[] = [{ exId: 'ex-dominadas' }];
    const sessions = [
      sesion('2026-09-01', [entrada('ex-dominadas', [serie(0, 8)], 'Dominadas lastradas')]),
      sesion('2026-09-20', [entrada('ex-jalon', [serie(40, 8)], 'Jalón al pecho')], { plan }),
    ];
    const lines = consolidatedHistory(sessions, { changes: true, exercises: BIBLIOTECA });
    expect(lines[0]).toContain('Jalón al pecho · 1 sesión');
    expect(lines[1]).toContain('Dominadas lastradas · 1 sesión');
    const marcador = '[cambió: +Jalón al pecho, −Dominadas lastradas]';
    expect(lines[0].endsWith(marcador)).toBe(true);
    expect(lines[1].endsWith(marcador)).toBe(true);
    /* sin la opción changes no se pinta nada */
    expect(consolidatedHistory(sessions, { exercises: BIBLIOTECA })[0]).not.toContain('[cambió:');
  });

  it('distingue lo añadido de lo quitado cuando no hay sustitución', () => {
    const sessions = [
      sesion(
        '2026-09-05',
        [
          entrada('ex-press', [serie(70, 6)], 'Press de banca'),
          entrada('ex-sentadilla', [serie(60, 5)], 'Sentadilla'),
        ],
        { plan: [{ exId: 'ex-press' }] },
      ),
    ];
    const lines = consolidatedHistory(sessions, { changes: true, exercises: BIBLIOTECA });
    expect(lines[0]).toContain('Press de banca');
    expect(lines[0]).not.toContain('[cambió:');
    expect(lines[1]).toContain('Sentadilla');
    expect(lines[1].endsWith('[cambió: +Sentadilla]')).toBe(true);
  });
});

/* ---------- queryHistory ---------- */

const CONSULTAS: Session[] = [
  sesion('2026-08-20', [entrada('ex-press', [serie(65, 8), serie(65, 8)], 'Press de banca')]),
  sesion('2026-09-10', [
    entrada('ex-press', [serie(70, 8), serie(70, 8), serie(70, 6)], 'Press de banca'),
  ]),
  sesion('2026-09-22', [entrada('ex-press', [serie(75, 6), serie(75, 6)], 'Press de banca')]),
  sesion('2026-09-23', [entrada('ex-sentadilla', [serie(60, 5)], 'Sentadilla')]),
];

function query(q: Partial<HistoryQuery> = {}): string {
  const built: HistoryQuery = { ...q, exercise: q.exercise ?? 'Press de banca' };
  return queryHistory(CONSULTAS, built, { exercises: BIBLIOTECA });
}

describe('queryHistory · full', () => {
  it('devuelve cabecera, detalle por sesión y resumen', () => {
    const text = query({ kind: 'full' });
    expect(text).toContain('Press de banca · 3 sesiones · 2026-08-20→2026-09-22');
    expect(text).toContain('- 2026-09-22: 75×6, 75×6 · e1RM 90 kg');
    expect(text).toContain('- 2026-09-10: 70×8, 70×8, 70×6 · e1RM 88,7 kg');
    expect(text).toContain('- 2026-08-20: 65×8, 65×8 · e1RM 82,3 kg');
    expect(text).toContain('Resumen: mejor e1RM 90 kg · primera 65×8 · última 75×6');
    expect(text).not.toContain('Sentadilla');
  });

  it('respeta el límite y avisa de lo que se queda fuera', () => {
    const text = query({ limit: 1 });
    expect(text).toContain('… y 2 sesiones anteriores no mostradas (límite 1).');
    expect(text).toContain('- 2026-09-22:');
    expect(text).not.toContain('- 2026-08-20:');
    expect(text).toContain('Resumen: mejor e1RM 90 kg');
  });

  it('filtra por rango de fechas (inclusive)', () => {
    expect(query({ since: '2026-09-01' })).toContain(
      'Press de banca · 2 sesiones · 2026-09-10→2026-09-22',
    );
    expect(query({ until: '2026-08-31' })).toContain(
      'Press de banca · 1 sesión · 2026-08-20→2026-08-20',
    );
    expect(query({ since: '2026-09-10', until: '2026-09-10' })).toContain('- 2026-09-10:');
  });
});

describe('queryHistory · resolución del nombre', () => {
  it('tolera mayúsculas y acentos', () => {
    expect(query({ exercise: 'PRESS DE BANCA' })).toContain('Press de banca · 3 sesiones');
    expect(query({ exercise: 'press de banca' })).toContain('Press de banca · 3 sesiones');
  });

  it('acepta un nombre parecido FUERTE (similitud ≥ 0,85)', () => {
    /* «Press de banca con barra» contiene al del catálogo → similitud 0,88 */
    expect(query({ exercise: 'Press de banca con barra' })).toContain(
      'Press de banca · 3 sesiones',
    );
    expect(query({ exercise: 'sentadilla' })).toContain('Sentadilla · 1 sesión');
  });

  it('si no se encuentra, mensaje claro con los ejercicios parecidos', () => {
    const text = query({ exercise: 'Press militar' });
    expect(text).toContain('No encuentro «Press militar» en el historial.');
    expect(text).toContain('Press militar no está registrado en tu historial');
    expect(text).toContain('Ejercicios parecidos: Press de banca');
    expect(query({ exercise: 'press' })).not.toContain('No encuentro');
  });

  it('ejercicio sin historial en el rango lo dice con las fechas', () => {
    expect(query({ since: '2027-01-01' })).toBe(
      'No hay sesiones registradas de «Press de banca» desde 2027-01-01.',
    );
    expect(query({ since: '2026-01-01', until: '2026-05-01' })).toBe(
      'No hay sesiones registradas de «Press de banca» entre 2026-01-01 y 2026-05-01.',
    );
    expect(queryHistory(CONSULTAS, { exercise: '' })).toBe(
      'La consulta no trae el nombre del ejercicio.',
    );
  });
});

/**
 * El modelo se inventa nombres («Curl con oso polar»): la consulta no puede
 * responder con los datos de OTRO ejercicio solo porque se le parezca.
 */
describe('queryHistory · nunca sustituye el ejercicio consultado', () => {
  const CON_CURL: Session[] = [
    ...CONSULTAS,
    sesion('2026-09-18', [entrada('ex-curl', [serie(30, 10), serie(30, 8)], 'Curl con barra')]),
    sesion('2026-09-19', [entrada('ex-propio', [serie(12, 12)], 'Curl martillo con mancuernas')]),
  ];
  const consulta = (exercise: string): string =>
    queryHistory(CON_CURL, { exercise }, { exercises: BIBLIOTECA });

  it('rechaza un nombre parecido flojo y no devuelve los datos de otro', () => {
    /* similitud 0,5 con «Curl con barra»: el umbral es 0,85 */
    const text = consulta('Curl con oso polar');
    expect(text).toContain('Curl con oso polar no está registrado en tu historial');
    expect(text).toContain('Ejercicios parecidos:');
    expect(text).toContain('Curl con barra');
    expect(text).not.toContain('- 2026-09-18:');
    expect(text).not.toContain('30×10');
    expect(text).not.toContain('Curl con barra · 1 sesión');
  });

  it('no registrado → mensaje con candidatos y ninguna cifra', () => {
    const text = consulta('Press banca');
    expect(text).toContain('Press banca no está registrado en tu historial');
    expect(text).toContain('Ejercicios parecidos: Press de banca');
    expect(text).not.toContain('- 2026-09-22:');
    expect(text).not.toContain('75×6');
  });

  it('acepta similitud alta: sigue resolviendo el nombre del modelo', () => {
    expect(consulta('Press de banca con barra')).toContain('Press de banca · 3 sesiones');
  });

  it('acepta el nombre exacto con acentos y mayúsculas, aunque solo esté en las sesiones', () => {
    expect(consulta('CURL MARTILLO CON MANCUERNAS')).toContain(
      'Curl martillo con mancuernas · 1 sesión',
    );
    expect(consulta('curl martillo con mancuernas')).toContain(
      'Curl martillo con mancuernas · 1 sesión',
    );
    expect(consulta('CURL CON BARRA')).toContain('Curl con barra · 1 sesión');
  });
});

describe('queryHistory · reciente y evolucion', () => {
  it('reciente: solo las últimas sesiones, una por línea', () => {
    const text = query({ kind: 'reciente' });
    expect(text).toContain('Press de banca · últimas 3 sesiones:');
    expect(text).toContain('- 2026-09-22: 75×6 · 2 series');
    expect(text).toContain('- 2026-08-20: 65×8 · 2 series');
    expect(text).not.toContain('Resumen:');
    expect(query({ kind: 'reciente', limit: 1 })).toContain('última 1 sesión:');
  });

  it('evolucion: kg×reps por sesión en orden cronológico y delta global', () => {
    const text = query({ kind: 'evolucion' });
    const lineas = text.split('\n');
    expect(lineas[0]).toBe('Press de banca');
    expect(lineas[1]).toBe('2026-08-20: 65×8');
    expect(lineas[2]).toBe('2026-09-10: 70×8');
    expect(lineas[3]).toBe('2026-09-22: 75×6');
    expect(lineas[4]).toBe(
      'Delta global (2026-08-20→2026-09-22): 65×8 → 75×6 · ' +
        'peso +10 kg · reps −2 · e1RM +7,7 kg',
    );
    expect(text).not.toContain('Sentadilla');
  });
});
