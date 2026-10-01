/**
 * `ui/routines-helpers.ts`: lo que hace falta comprobar de la vista Rutinas sin
 * abrir un navegador.
 *
 * Aquí se cubren los sitios donde la vista podía fallar en silencio: la búsqueda
 * de ejercicios (entiende tildes y búsquedas por grupo), la propuesta del coach
 * (llega como texto con alias que se inventa el modelo), los números que van a
 * inputs (un vacío no puede acabar en 0), la generación LOCAL a partir de las
 * plantillas (sin API key) y el «Agendar» (día por defecto y validación).
 */
import { describe, expect, it } from 'vitest';

import { TEMPLATES, equipPreset, findExercise, isAvailable, seedExercises } from '@/domain/data';
import { DEFAULT_SETTINGS } from '@/domain/defaults';
import { addDays } from '@/domain/dates';
import type { PlanInput } from '@/domain/plan';
import type { Exercise, RoutineItem, Session } from '@/domain/types';
import type { ScheduleDay } from '@/state/store';

import {
  autoRoutineItems,
  bounded,
  detailRows,
  generateAuto,
  lastUsed,
  matchExercises,
  nextFreeDay,
  routineSets,
  scheduleRoutinePatch,
  sourceBadge,
  templateSummary,
  toSuggestion,
  validScheduleIso,
  weightOrNull,
} from './routines-helpers';

/* La semilla real (24 ejercicios), que es lo que la app le pasa a la vista */
const LIBRARY = seedExercises();

const session = (patch: Partial<Session>): Session => ({
  id: 's',
  date: '2026-09-01',
  startedAt: '2026-09-01T10:00:00.000Z',
  unit: 'kg',
  entries: [],
  ...patch,
});

/** Entrada con una serie hecha, para que `suggestWeight` tenga algo que sugerir. */
function trainedSession(entries: readonly string[]): Session {
  return session({
    id: 'hist',
    date: '2026-09-20',
    entries: entries.map((exId) => ({
      exId,
      sets: [{ weight: 50, reps: 8, done: true }],
    })),
  });
}

describe('matchExercises', () => {
  it('con la consulta vacía devuelve los primeros de la biblioteca', () => {
    const found = matchExercises('', LIBRARY);
    expect(found).toHaveLength(8);
    expect(found[0]?.id).toBe(LIBRARY[0]?.id);
  });

  it('encuentra por nombre aunque venga sin tildes ni mayúsculas', () => {
    const found = matchExercises('CURL DE MUNECA INVERTIDO UNILATERAL CON MANCUERNA', LIBRARY);
    expect(found.map((ex) => ex.name)).toContain(
      'Curl de Muñeca Invertido Unilateral con Mancuerna',
    );
  });

  it('encuentra por grupo muscular', () => {
    const found = matchExercises('pecho', LIBRARY, [], 50);
    /* la semilla solo tiene 2 de pecho y ninguno otro lleva la palabra */
    expect(found.map((ex) => ex.name)).toEqual([
      'Press de Piso con Mancuernas',
      'Pullover con Mancuerna',
    ]);
    expect(found.every((ex) => ex.group === 'pecho')).toBe(true);
  });

  it('excluye los ejercicios que ya están en la rutina', () => {
    const press = LIBRARY.find((ex) => ex.name === 'Press de Piso con Mancuernas');
    expect(press).toBeTruthy();
    const found = matchExercises('press', LIBRARY, [press?.id ?? '']);
    expect(found.map((ex) => ex.id)).not.toContain(press?.id);
  });

  it('respeta el límite y no devuelve nada si no se parece a nada', () => {
    expect(matchExercises('press', LIBRARY, [], 2)).toHaveLength(2);
    expect(matchExercises('zzzqqq sin sentido', LIBRARY)).toEqual([]);
  });

  it('con la consulta vacía los ★ salen primero sin mover el resto', () => {
    const tercero = LIBRARY[3];
    const conFav = LIBRARY.map((ex, i) => (i === 3 ? { ...ex, fav: true } : ex));
    const found = matchExercises('', conFav, [], 6);
    expect(found[0]?.id).toBe(tercero.id);
    expect(found[0]?.fav).toBe(true);
    /* sin ★ el orden de la semilla se conserva tal cual (sort estable) */
    expect(matchExercises('', LIBRARY, [], 6).map((ex) => ex.id)).toEqual(
      LIBRARY.slice(0, 6).map((ex) => ex.id),
    );
  });

  it('con la puntuación igual desempata el ★ y después el nombre', () => {
    const base: Exercise[] = [
      { ...LIBRARY[0], id: 'a', name: 'Curl con barra' },
      { ...LIBRARY[1], id: 'b', name: 'Curl con barra' },
    ];
    /* sin ★ y con el mismo nombre: mantiene el orden de entrada */
    expect(matchExercises('curl con barra', base).map((ex) => ex.id)).toEqual(['a', 'b']);
    const favEnB: Exercise[] = [base[0], { ...base[1], fav: true }];
    expect(matchExercises('curl con barra', favEnB).map((ex) => ex.id)).toEqual(['b', 'a']);
    const favEnA: Exercise[] = [{ ...base[0], fav: true }, base[1]];
    expect(matchExercises('curl con barra', favEnA).map((ex) => ex.id)).toEqual(['a', 'b']);
  });

  it('la puntuación manda sobre el ★ (un ★ flojo no se cuela arriba)', () => {
    const conFav = LIBRARY.map((ex) =>
      ex.name === 'Press Militar Sentado con Mancuernas' ? { ...ex, fav: true } : ex,
    );
    const found = matchExercises('press de piso con mancuernas', conFav, [], 5);
    expect(found[0]?.name).toBe('Press de Piso con Mancuernas');
    expect(found.findIndex((ex) => ex.fav === true)).toBeGreaterThan(0);
  });
});

describe('inputs numéricos', () => {
  it('bounded acota y usa el respaldo con el campo vacío o basura', () => {
    expect(bounded('5', 1, 12, 3)).toBe(5);
    expect(bounded('99', 1, 12, 3)).toBe(12);
    expect(bounded('', 1, 12, 3)).toBe(3);
    expect(bounded('abc', 1, 12, 3)).toBe(3);
    expect(bounded('0', 1, 12, 3)).toBe(1);
  });

  it('weightOrNull: vacío es sin peso (null), y el 0 es un peso real', () => {
    expect(weightOrNull('')).toBeNull();
    expect(weightOrNull('  ')).toBeNull();
    expect(weightOrNull('42.5')).toBe(42.5);
    expect(weightOrNull('0')).toBe(0);
    expect(weightOrNull('kg?')).toBeNull();
  });
});

describe('datos de la tarjeta', () => {
  it('routineSets suma las series y cuenta 3 cuando el item no trae sets', () => {
    expect(routineSets([{ exId: 'a', sets: 4 }, { exId: 'b', sets: 2 }, { exId: 'c' }])).toBe(9);
    expect(routineSets(undefined)).toBe(0);
  });

  it('sourceBadge etiqueta ia / generador / manual', () => {
    expect(sourceBadge('ia')).toEqual({ cls: 'badge a', label: 'IA' });
    expect(sourceBadge('generador')).toEqual({ cls: 'badge', label: 'auto' });
    expect(sourceBadge('manual').label).toBe('manual');
    expect(sourceBadge(undefined).label).toBe('manual');
  });

  it('lastUsed devuelve la sesión más reciente de ESA rutina', () => {
    const sessions = [
      session({
        id: 'vieja',
        date: '2026-08-01',
        startedAt: '2026-08-01T09:00:00.000Z',
        routineId: 'rt1',
      }),
      session({
        id: 'ajena',
        date: '2026-09-25',
        startedAt: '2026-09-25T09:00:00.000Z',
        routineId: 'otra',
      }),
      session({
        id: 'nueva',
        date: '2026-09-20',
        startedAt: '2026-09-20T09:00:00.000Z',
        routineId: 'rt1',
      }),
      session({ id: 'sin-rutina', date: '2026-09-27' }),
    ];
    expect(lastUsed(sessions, 'rt1')?.id).toBe('nueva');
    expect(lastUsed(sessions, 'nunca')).toBeNull();
  });
});

describe('toSuggestion', () => {
  const raw = {
    title: 'Empuje A',
    focus: 'Pecho · tríceps',
    rationale: ['Toca pecho tras 48 h', ''],
    exercises: [
      { name: 'Press de Piso con Mancuernas', sets: 4, repMin: 6, repMax: 10, rest: 180, weight: 60 },
      { name: 'Press de Piso con Mancuernas EXTRA', sets: 3, weight: '' },
      { name: 'Remo con polea para gemelos', sets: 3 },
    ],
  };

  it('normaliza la propuesta y resuelve los nombres contra la biblioteca', () => {
    const sug = toSuggestion(raw, LIBRARY);
    expect(sug).not.toBeNull();
    expect(sug?.title).toBe('Empuje A');
    expect(sug?.focus).toBe('Pecho · tríceps');
    expect(sug?.rationale).toEqual(['Toca pecho tras 48 h']);
    expect(sug?.exercises).toHaveLength(3);

    const [exacto, difuso, desconocido] = sug?.exercises ?? [];
    expect(exacto?.matched).toBe(true);
    expect(exacto?.sets).toBe(4);
    expect(exacto?.weight).toBe(60);

    /* el modelo se inventó un sufijo: se rescata por similitud */
    expect(difuso?.matched).toBe(true);
    expect(difuso?.name).toBe('Press de Piso con Mancuernas');
    expect(difuso?.weight).toBeNull();
    expect(difuso?.repMin).toBe(8);
    expect(difuso?.rest).toBe(90);

    expect(desconocido?.matched).toBe(false);
    expect(desconocido?.name).toBe('Remo con polea para gemelos');
  });

  it('acepta el alias `items` y el rationale como frase suelta', () => {
    const sug = toSuggestion(
      {
        title: 'Pierna',
        items: [{ ejercicio: 'Press de Piso con Mancuernas' }],
        rationale: 'Un día corto.',
      },
      LIBRARY,
    );
    expect(sug?.exercises).toHaveLength(1);
    expect(sug?.exercises[0]?.matched).toBe(true);
    expect(sug?.rationale).toEqual(['Un día corto.']);
  });

  it('devuelve null si no se parece a una sugerencia o no queda ningún ejercicio', () => {
    expect(toSuggestion(null, LIBRARY)).toBeNull();
    expect(toSuggestion('texto suelto', LIBRARY)).toBeNull();
    expect(toSuggestion({ title: 'Sin lista' }, LIBRARY)).toBeNull();
    expect(toSuggestion({ exercises: [] }, LIBRARY)).toBeNull();
    expect(toSuggestion({ exercises: [{ notes: 'sin nombre' }] }, LIBRARY)).toBeNull();
  });
});

/* ---------- generación local (plantillas, sin API key) ---------- */

/** Entrada del planificador: material completo, sin historial, objetivo por defecto. */
function planInput(patch: Partial<PlanInput> = {}): PlanInput {
  return {
    settings: { ...DEFAULT_SETTINGS },
    exercises: LIBRARY,
    equipment: equipPreset('todo'),
    sessions: [],
    ...patch,
  };
}

/** Mini biblioteca determinista (lo justo para fijar la regla por objetivo). */
function seedExercise(
  partial: Partial<Exercise> & Pick<Exercise, 'id' | 'name' | 'group'>,
): Exercise {
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

describe('templateSummary', () => {
  it('resume las 7 plantillas de la semilla con ejercicios y grupos', () => {
    expect(TEMPLATES).toHaveLength(7);
    for (const tpl of TEMPLATES) {
      const summary = templateSummary(tpl);
      expect(summary.count).toBeGreaterThan(0);
      expect(summary.groups).not.toBe('');
    }
  });

  it('suma la receta y lista los grupos sin repetir', () => {
    const push = TEMPLATES.find((tpl) => tpl.id === 'push');
    expect(push).toBeTruthy();
    const summary = templateSummary(push ?? { id: '', name: '', hint: '', recipe: [] });
    expect(summary).toEqual({ count: 6, groups: 'Pecho · Hombros · Tríceps' });
  });
});

describe('generateAuto', () => {
  it('genera la plantilla completa con material y números del objetivo', () => {
    const out = generateAuto(planInput(), 'push');
    expect(out).not.toBeNull();
    expect(out?.name).toBe('Empuje · Push');
    expect(out?.source).toBe('generador');
    expect(out?.focus).toContain('Pecho');
    expect(out?.items).toHaveLength(6);

    /* hipertrofia por defecto: 8-12 reps, 90 s y 3-4 series */
    for (const item of out?.items ?? []) {
      expect(item.repMin).toBe(8);
      expect(item.repMax).toBe(12);
      expect(item.rest).toBe(90);
      expect(item.sets === 3 || item.sets === 4).toBe(true);
      expect(item.name).not.toBe('');
      expect(findExercise(LIBRARY, item.exId)).not.toBeNull();
    }
  });

  it('sin historial no inventa peso: queda null y el motivo lo dice', () => {
    const out = generateAuto(planInput(), 'push');
    for (const item of out?.items ?? []) {
      expect(item.weight).toBeNull();
      expect(item.basis).toBe('sin historial');
    }
  });

  it('con historial el peso sale de suggestWeight en la unidad de los ajustes', () => {
    const trained = trainedSession(LIBRARY.map((ex) => ex.id));
    const out = generateAuto(planInput({ sessions: [trained] }), 'push');
    const items = out?.items ?? [];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.weight).not.toBeNull();
      expect(item.weight).toBeGreaterThan(0);
      expect(item.basis.startsWith('última vez')).toBe(true);
    }
  });

  it('solo propone ejercicios que puedes hacer con tu material', () => {
    const none: Record<string, boolean> = {};
    const out = generateAuto(planInput({ equipment: none }), 'push');
    expect(out).not.toBeNull();
    const items = out?.items ?? [];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      const ex = findExercise(LIBRARY, item.exId);
      expect(ex && isAvailable(ex, none)).toBe(true);
    }
  });

  it('ajusta series, reps y descanso al objetivo (los aislados pierden una serie)', () => {
    const input = planInput({
      settings: { ...DEFAULT_SETTINGS, goal: 'fuerza' },
      exercises: [
        seedExercise({ id: 'press', name: 'Press banca', group: 'pecho' }),
        seedExercise({ id: 'apert', name: 'Aperturas', group: 'pecho', type: 'aislado' }),
      ],
    });
    const out = generateAuto(input, 'push');
    const items = out?.items ?? [];
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.sets).sort()).toEqual([4, 5]);
    for (const item of items) {
      expect(item.repMin).toBe(4);
      expect(item.repMax).toBe(6);
      expect(item.rest).toBe(180);
    }
  });

  it('devuelve null si la plantilla no existe o no queda ningún ejercicio', () => {
    expect(generateAuto(planInput(), 'no-existe')).toBeNull();
    expect(generateAuto(planInput({ exercises: [] }), 'push')).toBeNull();
  });

  it('autoRoutineItems se queda solo con los campos que se guardan', () => {
    const out = generateAuto(planInput(), 'push');
    const items = autoRoutineItems(out?.items ?? []);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual([
        'exId',
        'notes',
        'repMax',
        'repMin',
        'rest',
        'sets',
        'weight',
      ]);
    }
  });
});

/* ---------- agendar en el calendario ---------- */

const HOY = '2026-09-29';

describe('nextFreeDay', () => {
  it('propone hoy si el día está libre', () => {
    expect(nextFreeDay({}, [], HOY)).toBe(HOY);
  });

  it('salta los días planificados y los de descanso', () => {
    const plan: Record<string, ScheduleDay> = {
      [HOY]: { status: 'planned', type: 'entreno', routineId: 'rt1' },
      [addDays(HOY, 1)]: { status: 'rest', type: 'descanso' },
    };
    expect(nextFreeDay(plan, [], HOY)).toBe(addDays(HOY, 2));
  });

  it('salta un día con sesión registrada aunque no tenga plan', () => {
    expect(nextFreeDay({}, [session({ date: HOY })], HOY)).toBe(addDays(HOY, 1));
  });

  it('si no hay hueco en 14 días devuelve mañana (nunca un ISO vacío)', () => {
    const plan: Record<string, ScheduleDay> = {};
    for (let i = 0; i < 14; i++) plan[addDays(HOY, i)] = { status: 'planned' };
    expect(nextFreeDay(plan, [], HOY)).toBe(addDays(HOY, 1));
  });
});

describe('scheduleRoutinePatch', () => {
  it('escribe rutina, tipo entreno, estado planificado, título y origen', () => {
    expect(scheduleRoutinePatch({ id: 'rt1', name: 'Torso A' })).toEqual({
      routineId: 'rt1',
      type: 'entreno',
      status: 'planned',
      title: 'Torso A',
      source: 'manual',
    });
  });

  it('sin nombre usa el «Entrenamiento» de la v1', () => {
    expect(scheduleRoutinePatch({ id: 'rt1' }).title).toBe('Entrenamiento');
  });
});

describe('validScheduleIso', () => {
  it('acepta hoy y lo que venga después; rechaza el pasado y la basura', () => {
    expect(validScheduleIso(HOY, HOY)).toBe(true);
    expect(validScheduleIso('2026-10-05', HOY)).toBe(true);
    expect(validScheduleIso('2026-09-28', HOY)).toBe(false);
    expect(validScheduleIso('', HOY)).toBe(false);
    expect(validScheduleIso('mañana', HOY)).toBe(false);
    expect(validScheduleIso('2026-9-5', HOY)).toBe(false);
  });
});

/* ---------- detalle de solo lectura ---------- */

describe('detailRows', () => {
  it('resuelve nombres, aplica defaults y marca lo que falta material', () => {
    const press = LIBRARY.find((ex) => ex.name === 'Press de Piso con Mancuernas');
    expect(press).toBeTruthy();
    const pressId = press?.id ?? '';
    const items: RoutineItem[] = [
      { exId: pressId, sets: 4, weight: 60, notes: 'agarrar ancho' },
      { exId: 'que-no-existe' },
      { exId: pressId, repMin: 5, repMax: 6, rest: 120 },
    ];

    const rows = detailRows(items, LIBRARY, {});
    expect(rows).toHaveLength(3);

    expect(rows[0]?.name).toBe('Press de Piso con Mancuernas');
    expect(rows[0]?.group).toBe('Pecho');
    expect(rows[0]?.sets).toBe(4);
    expect(rows[0]?.weight).toBe(60);
    expect(rows[0]?.notes).toBe('agarrar ancho');
    expect(rows[0]?.missing).toBe(true);

    /* item a medias: reps y descanso del ejercicio, `sets` 3 y peso null (no 0) */
    expect(rows[2]?.sets).toBe(3);
    expect(rows[2]?.repMin).toBe(5);
    expect(rows[2]?.repMax).toBe(6);
    expect(rows[2]?.rest).toBe(120);
    expect(rows[2]?.weight).toBeNull();

    /* fuera de la biblioteca: se pinta el id sin reventar */
    expect(rows[1]?.name).toBe('que-no-existe');
    expect(rows[1]?.group).toBe('');
    expect(rows[1]?.sets).toBe(3);
    expect(rows[1]?.missing).toBe(false);

    /* con material disponible ya no falta nada */
    const withKit = detailRows([items[0]], LIBRARY, equipPreset('todo'));
    expect(withKit[0]?.missing).toBe(false);
  });
});
