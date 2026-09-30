/**
 * `domain/plan.ts`: el planificador local del coach en dominio puro.
 *
 * Datos clavados a mano (biblioteca, sesiones, material) y sin reloj: aquí se
 * fija lo que en la v1 solo se podía ver entrenando —el orden de
 * `pickForGroup`, la rotación de `itemsFromRecipe`, el reparto de la semana— y
 * la equivalencia con las plantillas y constantes de la v1.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from './defaults';
import { TEMPLATES } from './catalog';
import {
  WEEK_LAYOUT,
  WEEK_ROTATION,
  findTemplate,
  itemsFromRecipe,
  pickForGroup,
  recentlyUsedSessions,
  richItems,
  routineFromTemplate,
  weekSlots,
} from './plan';
import type { PlanInput } from './plan';
import type { Exercise, Session } from './types';

/* ---------- datos de prueba ---------- */

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

/** Biblioteca chica pero completa: cubre los grupos de todas las plantillas. */
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
    ex({
      id: 'curl',
      name: 'Curl bíceps',
      group: 'biceps',
      type: 'aislado',
      equip: 'mancuernas_ajustables',
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
    ex({ id: 'zancada', name: 'Zancadas', group: 'cuadriceps', equip: '', rest: 120 }),
    ex({
      id: 'peso-muerto',
      name: 'Peso muerto',
      group: 'femoral',
      equip: 'barra_olimpica',
      sets: 4,
      rest: 180,
    }),
    ex({
      id: 'femoral-maq',
      name: 'Curl femoral',
      group: 'femoral',
      type: 'aislado',
      equip: 'mancuernas_ajustables',
      rest: 75,
    }),
    ex({ id: 'plancha', name: 'Plancha', group: 'core', equip: '', rest: 45 }),
    ex({ id: 'crunch', name: 'Crunch', group: 'core', type: 'aislado', equip: '', rest: 45 }),
    ex({
      id: 'cinta',
      name: 'Cinta de correr',
      group: 'cardio',
      type: 'cardio',
      equip: 'cinta',
      rest: 0,
    }),
    ex({
      id: 'movil',
      name: 'Movilidad de cadera',
      group: 'movilidad',
      type: 'movilidad',
      equip: '',
      rest: 0,
    }),
  ];
}

const ALL_EQUIPMENT = {
  barra_olimpica: true,
  mancuernas_ajustables: true,
  barra_dominadas: true,
  paralelas: true,
  cinta: true,
};

/** Sesión de 1 hora con `sets` series hechas en cada ejercicio. */
function session(date: string, exIds: string[], sets = 3): Session {
  return {
    id: `s-${date}`,
    date,
    startedAt: `${date}T10:00:00.000Z`,
    endedAt: `${date}T11:00:00.000Z`,
    unit: 'kg',
    entries: exIds.map((exId) => ({
      exId,
      sets: Array.from({ length: sets }, () => ({ weight: 40, reps: 8, done: true })),
    })),
  };
}

function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    settings: DEFAULT_SETTINGS,
    exercises: library(),
    equipment: ALL_EQUIPMENT,
    sessions: [],
    ...over,
  };
}

/* ---------- pickForGroup ---------- */

describe('pickForGroup', () => {
  it('ordena compuestos antes que aislados y recorta a `count`', () => {
    const picked = pickForGroup(input(), 'pecho', 2);
    expect(picked.map((e) => e.id)).toEqual(['flex', 'press']);
    expect(pickForGroup(input(), 'pecho', 1).map((e) => e.id)).toEqual(['flex']);
    expect(pickForGroup(input(), 'pecho', 9).map((e) => e.id)).toEqual(['flex', 'press', 'apert']);
  });

  it('excluye los ya elegidos y los que el usuario ha prohibido', () => {
    const used = { flex: true };
    expect(pickForGroup(input(), 'pecho', 1, { used }).map((e) => e.id)).toEqual(['press']);

    const lib = library().map((e) => (e.id === 'press' ? { ...e, allowed: false } : e));
    const prohibido = input({ exercises: lib });
    expect(pickForGroup(prohibido, 'pecho', 9).map((e) => e.id)).toEqual(['flex', 'apert']);
  });

  it('sin material no propone nada imposible de cargar', () => {
    const sinNada = input({ equipment: {} });
    expect(pickForGroup(sinNada, 'pecho', 5).map((e) => e.id)).toEqual(['flex']);
    expect(pickForGroup(sinNada, 'hombros', 1)).toEqual([]);
    for (const e of pickForGroup(sinNada, 'pecho', 5)) expect(e.equip).toBe('');
  });

  it('la rotación manda sobre el orden alfabético', () => {
    const conHistorial = input({ sessions: [session('2026-09-26', ['flex'])] });
    expect(pickForGroup(conHistorial, 'pecho', 2, { rotate: 3 }).map((e) => e.id)).toEqual([
      'press',
      'flex',
    ]);
    expect(pickForGroup(conHistorial, 'pecho', 2, { rotate: 0 }).map((e) => e.id)).toEqual([
      'flex',
      'press',
    ]);
  });

  it('la familiaridad desempata: el más trabajado sale primero', () => {
    const muchas = input({
      sessions: [session('2026-09-25', ['press']), session('2026-09-20', ['press'])],
    });
    expect(pickForGroup(muchas, 'pecho', 1, { rotate: 0 }).map((e) => e.id)).toEqual(['press']);
  });
});

/* ---------- recetas ---------- */

describe('itemsFromRecipe', () => {
  it('expande la receta en orden, sin repetir y con los datos de la biblioteca', () => {
    const items = itemsFromRecipe(input(), [
      ['pecho', 2],
      ['espalda', 1],
    ]);
    expect(items).toHaveLength(3);
    expect(new Set(items.map((i) => i.exId)).size).toBe(3);
    expect(items.map((i) => i.exId)).toEqual(['flex', 'press', 'dominadas']);
    expect(items[1]).toEqual({
      exId: 'press',
      sets: 4,
      repMin: 6,
      repMax: 10,
      rest: 180,
    });
  });

  it('comparte el mapa `used` entre pares: un grupo nunca se repite', () => {
    const items = itemsFromRecipe(input(), [
      ['pecho', 3],
      ['pecho', 3],
    ]);
    expect(items).toHaveLength(3);
  });

  it('con `rotate` deja para el final lo de las últimas sesiones', () => {
    const conHistorial = input({ sessions: [session('2026-09-26', ['flex'])] });
    const rotando = itemsFromRecipe(conHistorial, [['pecho', 2]], { rotate: 3 });
    const sinRotar = itemsFromRecipe(conHistorial, [['pecho', 2]], { rotate: 0 });
    expect(rotando.map((i) => i.exId)).toEqual(['press', 'flex']);
    expect(sinRotar.map((i) => i.exId)).toEqual(['flex', 'press']);
  });

  it('un grupo sin material disponible se queda vacío y no rompe el resto', () => {
    const items = itemsFromRecipe(input({ equipment: {} }), [
      ['hombros', 2],
      ['core', 1],
    ]);
    expect(items.map((i) => i.exId)).toEqual(['plancha']);
  });
});

/* ---------- plantillas ---------- */

describe('routineFromTemplate', () => {
  it('construye el borrador de `push` con nombre, focus y sus 7 ejercicios', () => {
    const draft = routineFromTemplate(input(), 'push');
    expect(draft).not.toBeNull();
    expect(draft?.name).toBe('Empuje · Push');
    expect(draft?.focus).toBe('Pecho · Hombros · Tríceps');
    expect(draft?.source).toBe('generador');
    expect(draft?.items).toHaveLength(7);
    expect(new Set(draft?.items.map((i) => i.exId)).size).toBe(7);
  });

  it('respeta el material dentro de la plantilla', () => {
    const draft = routineFromTemplate(input({ equipment: {} }), 'legs');
    expect(draft).not.toBeNull();
    for (const item of draft?.items ?? []) {
      const exFound = library().find((e) => e.id === item.exId);
      expect(exFound?.equip).toBe('');
    }
  });

  it('id desconocido → null (como la v1)', () => {
    expect(routineFromTemplate(input(), 'no-existe')).toBeNull();
    expect(findTemplate('no-existe')).toBeNull();
    expect(findTemplate('full_a')?.id).toBe('full_a');
  });
});

describe('catálogo de plantillas', () => {
  /* La v1 las define en `legacy/js/data.js` ~343: si este test salta, cambió el
     catálogo generado y hay que mirar `tools/port-catalog.mjs` (manda el catálogo). */
  const V1: [string, [string, number][]][] = [
    [
      'full_a',
      [
        ['cuadriceps', 2],
        ['pecho', 2],
        ['espalda', 2],
        ['core', 1],
      ],
    ],
    [
      'full_b',
      [
        ['femoral', 2],
        ['espalda', 2],
        ['hombros', 2],
        ['core', 1],
      ],
    ],
    [
      'push',
      [
        ['pecho', 3],
        ['hombros', 2],
        ['triceps', 2],
      ],
    ],
    [
      'pull',
      [
        ['espalda', 3],
        ['biceps', 2],
        ['antebrazo', 1],
      ],
    ],
    [
      'legs',
      [
        ['cuadriceps', 2],
        ['femoral', 2],
        ['gluteos', 1],
        ['gemelos', 1],
      ],
    ],
    [
      'upper',
      [
        ['espalda', 3],
        ['pecho', 2],
        ['hombros', 2],
        ['biceps', 1],
      ],
    ],
    [
      'lower',
      [
        ['cuadriceps', 2],
        ['femoral', 2],
        ['gluteos', 1],
        ['core', 2],
      ],
    ],
    [
      'hiit',
      [
        ['cardio', 2],
        ['core', 3],
      ],
    ],
    ['mobility', [['movilidad', 5]]],
  ];

  it('las 9 plantillas de v2 son idénticas a las TEMPLATES de la v1', () => {
    expect(TEMPLATES.map((tpl) => [tpl.id, tpl.recipe] as [string, [string, number][]])).toEqual(
      V1,
    );
  });
});

/* ---------- semana ---------- */

describe('WEEK_LAYOUT y WEEK_ROTATION', () => {
  /* `legacy/js/coach.js` ~360-365, literal. */
  const LAYOUT: Record<number, number[]> = {
    1: [2],
    2: [0, 3],
    3: [0, 2, 4],
    4: [0, 1, 3, 4],
    5: [0, 1, 2, 4, 5],
    6: [0, 1, 2, 3, 4, 5],
    7: [0, 1, 2, 3, 4, 5, 6],
  };
  const ROTATION: Record<number, string[]> = {
    1: ['full_a'],
    2: ['full_a', 'full_b'],
    3: ['full_a', 'full_b', 'full_a'],
    4: ['push', 'pull', 'legs', 'upper'],
    5: ['push', 'pull', 'legs', 'upper', 'lower'],
    6: ['push', 'pull', 'legs', 'push', 'pull', 'legs'],
    7: ['push', 'pull', 'legs', 'upper', 'lower', 'full_a', 'mobility'],
  };

  it('coinciden con la v1 y cada rotación cubre su reparto', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      expect([...(WEEK_LAYOUT[n] ?? [])]).toEqual(LAYOUT[n]);
      expect([...(WEEK_ROTATION[n] ?? [])]).toEqual(ROTATION[n]);
      expect((WEEK_LAYOUT[n] ?? []).length).toBe(n);
      expect((WEEK_ROTATION[n] ?? []).length).toBe(n);
    }
  });

  it('todas las plantillas referenciadas existen en el catálogo', () => {
    const ids = new Set(TEMPLATES.map((tpl) => tpl.id));
    for (const rotation of Object.values(WEEK_ROTATION)) {
      for (const id of rotation) expect(ids.has(id)).toBe(true);
    }
  });
});

describe('weekSlots', () => {
  it('4 días: lunes a jueves con hueco el miércoles y domingo de recuperación', () => {
    const slots = weekSlots(4);
    expect(slots).toHaveLength(7);
    expect(slots.filter((s) => s.templateId).map((s) => s.index)).toEqual([0, 1, 3, 4]);
    expect(slots.filter((s) => s.templateId).map((s) => s.templateId)).toEqual([
      'push',
      'pull',
      'legs',
      'upper',
    ]);
    expect(slots[2]).toMatchObject({ templateId: null, recovery: false });
    expect(slots[5]).toMatchObject({ templateId: null, recovery: false });
    expect(slots[6]).toMatchObject({ templateId: null, recovery: true, index: 6 });
  });

  it('1 día va al miércoles y 7 días entrena también el domingo (sin recovery)', () => {
    expect(
      weekSlots(1)
        .filter((s) => s.templateId)
        .map((s) => s.index),
    ).toEqual([2]);
    const siete = weekSlots(7);
    expect(siete.every((s) => s.templateId !== null)).toBe(true);
    expect(siete[6]).toMatchObject({ templateId: 'mobility', recovery: false });
    /* 6 días: el domingo sobra pero n < 6 es falso → descanso normal */
    expect(weekSlots(6)[6]).toMatchObject({ templateId: null, recovery: false });
  });

  it('recorta a 1-7 (y lo que no esté en la tabla usa el reparto de 4)', () => {
    expect(weekSlots(10).filter((s) => s.templateId)).toHaveLength(7);
    expect(weekSlots(0).filter((s) => s.templateId)).toHaveLength(4);
    expect(weekSlots(-3).filter((s) => s.templateId)).toHaveLength(1);
  });
});

/* ---------- richItems ---------- */

describe('richItems', () => {
  it('rellena de la biblioteca y pide el peso a `suggest` con las reps medias', () => {
    const seen: [string, number][] = [];
    const items = richItems(input(), [{ exId: 'press', sets: 4 }], {
      suggest: (exId, reps) => {
        seen.push([exId, reps]);
        return { weight: 62.5, basis: 'última vez 60 kg × 8' };
      },
    });
    expect(seen).toEqual([['press', 8]]); /* media de 6-10 */
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      exId: 'press',
      name: 'Press banca',
      group: 'pecho',
      type: 'compuesto',
      sets: 4,
      reps: 8,
      repMin: 6,
      repMax: 10,
      rest: 180,
      weight: 62.5,
      unit: 'kg',
      basis: 'última vez 60 kg × 8',
      notes: '',
    });
  });

  it('un peso fijo manda sobre la sugerencia y los ids desconocidos se omiten', () => {
    const items = richItems(
      input({ settings: { ...DEFAULT_SETTINGS, units: 'lb' } }),
      [{ exId: 'flex', weight: 20, notes: 'sin prisa' }, { exId: 'que-no-existe' }],
      { basis: 'peso objetivo indicado', suggest: () => ({ weight: 99, basis: 'nunca' }) },
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      exId: 'flex',
      weight: 20,
      unit: 'lb',
      basis: 'peso objetivo indicado',
      notes: 'sin prisa',
    });
  });

  it('sin `suggest` usa `analytics.suggestWeight` (0 sin historial)', () => {
    const items = richItems(input(), [{ exId: 'flex' }]);
    expect(items[0]?.weight).toBe(0);
    expect(items[0]?.basis).toBe('sin historial');
  });
});

describe('recentlyUsedSessions', () => {
  it('cuenta por id solo en las n primeras sesiones', () => {
    const sessions = [
      session('2026-09-27', ['flex', 'press']),
      session('2026-09-25', ['flex']),
      session('2026-09-20', ['flex']),
    ];
    expect(recentlyUsedSessions(sessions, 2)).toEqual({ flex: 2, press: 1 });
    expect(recentlyUsedSessions(sessions, 0)).toEqual({});
    expect(recentlyUsedSessions([], 3)).toEqual({});
  });
});
