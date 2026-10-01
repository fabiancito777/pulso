/**
 * Semilla POR DEFECTO de la biblioteca: los 24 ejercicios que ve un usuario
 * nuevo (los 19 del encargo + los 5 con historial real) y las 7 plantillas de
 * rutina que salen de ellos.
 *
 * `catalog.ts` sigue trayendo el catálogo COMPLETO (136 ejercicios y 9
 * plantillas, generado desde la v1): sirve para buscar nombres que ya están en
 * el historial y para `data.test.ts`, pero **no es la semilla**. La semilla es
 * esto de aquí, que es lo que `state/store.ts` fusiona con lo guardado y lo que
 * por tanto ve alguien que abre la app por primera vez.
 *
 * Tres reglas al tocar este fichero:
 *
 * 1. Los nombres son LITERALES del encargo: `id = slug(name)` (sin acentos ni
 *    signos), así que renombrar un ejercicio cambia su id y rompe las sesiones
 *    guardadas. Se cambia un nombre solo si se cambia también la app entera.
 * 2. El `equip` es el del catálogo QUITANDO lo que el usuario real no tiene
 *    (banco, rack, barra EZ, colchoneta): son ejercicios que hace en el suelo,
 *    de pie o con las mancuernas de casa, así que con el material por defecto
 *    están todos disponibles.
 * 3. Los grupos de las recetas son grupos que EXISTEN en esta semilla: una
 *    plantilla pide `[grupo, n]` y si el grupo no da más de `n` ejercicios,
 *    `pickForGroup` recorta y el día sale corto (nunca revienta).
 */
import { slug } from './text';
import type { Exercise, ExerciseOpts, ExerciseType, RoutineTemplate } from './types';

/**
 * Mismo patrón que el `E()` de `catalog.ts` (no exportado: ese fichero lo
 * genera `tools/port-catalog.mjs`). El id sale del nombre, igual que hace
 * `S.addExercise` de la v1, así que no hay que mantener dos listas de ids.
 */
function E(
  name: string,
  group: string,
  equip: string,
  type: ExerciseType,
  sets: number,
  repMin: number,
  repMax: number,
  rest: number,
  opts: ExerciseOpts = {},
): Exercise {
  return {
    id: slug(name),
    name,
    group,
    equip: equip || '',
    type,
    sets,
    repMin,
    repMax,
    rest,
    allowed: opts.allowed ?? true,
    custom: false,
    bw: opts.bw ?? false,
    tags: opts.tags ?? [],
    tips: opts.tips ?? '',
  };
}

const EJERCICIOS: readonly Exercise[] = [
  /* ------- 1-2: lo más pesado del historial ------- */
  E('Encogimientos (Shrugs con barra)', 'hombros', 'barra_olimpica', 'aislado', 4, 10, 15, 90),
  E('Remo con Barra', 'espalda', 'barra_olimpica', 'compuesto', 4, 6, 10, 180),

  /* ------- 3-12: bloque de suelo y mancuernas ------- */
  E(
    'Press de Piso con Mancuernas',
    'pecho',
    'mancuernas_fijas|mancuernas_ajustables',
    'compuesto',
    3,
    6,
    10,
    120,
    { tips: 'Espalda baja apoyada y codos rozando el suelo: baja controlado y sube sin rebote.' },
  ),
  E(
    'Sentadilla Copa (con mancuerna)',
    'cuadriceps',
    'kettlebell|mancuernas_fijas|mancuernas_ajustables',
    'compuesto',
    3,
    10,
    15,
    90,
  ),
  E('Pull Over', 'espalda', 'mancuernas_fijas|mancuernas_ajustables', 'aislado', 3, 10, 14, 90),
  E(
    'Elevación de Talones (unilateral)',
    'gemelos',
    'mancuernas_fijas|mancuernas_ajustables|kettlebell',
    'aislado',
    3,
    12,
    18,
    60,
  ),
  E('Curl con Barra', 'biceps', 'barra_olimpica', 'aislado', 3, 8, 12, 90),
  E(
    'Pullover con Mancuerna',
    'pecho',
    'mancuernas_fijas|mancuernas_ajustables',
    'aislado',
    3,
    10,
    14,
    90,
  ),
  E(
    'Remo Unilateral Kroc Row con Mancuerna',
    'espalda',
    'mancuernas_fijas|mancuernas_ajustables',
    'compuesto',
    3,
    8,
    12,
    105,
  ),
  E('Press Francés', 'triceps', 'mancuernas_fijas|mancuernas_ajustables', 'aislado', 3, 8, 12, 105),
  E(
    'Rompecráneos en Suelo',
    'triceps',
    'mancuernas_fijas|mancuernas_ajustables',
    'aislado',
    3,
    8,
    12,
    60,
    { tips: 'Tumbado en el suelo, extiende la mancuerna sin mover los codos.' },
  ),
  E(
    'Zancadas',
    'cuadriceps',
    'mancuernas_fijas|mancuernas_ajustables|kettlebell',
    'compuesto',
    3,
    10,
    14,
    105,
    { bw: true },
  ),

  /* ------- 13-19: hombros y brazos ------- */
  E('Press Militar', 'hombros', 'barra_olimpica', 'compuesto', 4, 6, 10, 180),
  E(
    'Press Militar Sentado con Mancuernas',
    'hombros',
    'mancuernas_fijas|mancuernas_ajustables',
    'compuesto',
    4,
    8,
    12,
    150,
  ),
  E(
    'Curl de Muñeca con Mancuerna Unilateral',
    'antebrazo',
    'mancuernas_fijas|mancuernas_ajustables',
    'aislado',
    3,
    15,
    25,
    45,
  ),
  E('Curl Martillo', 'biceps', 'mancuernas_fijas|mancuernas_ajustables', 'aislado', 3, 10, 14, 75, {
    tags: ['antebrazo'],
  }),
  E(
    'Curl de Muñeca Invertido Unilateral con Mancuerna',
    'antebrazo',
    'mancuernas_fijas|mancuernas_ajustables',
    'aislado',
    3,
    12,
    18,
    60,
  ),
  E(
    'Pájaros con Mancuernas',
    'hombros',
    'mancuernas_fijas|mancuernas_ajustables',
    'aislado',
    3,
    12,
    18,
    75,
  ),
  E(
    'Elevaciones Laterales',
    'hombros',
    'mancuernas_fijas|mancuernas_ajustables',
    'aislado',
    4,
    12,
    18,
    75,
  ),

  /* ------- 20-24: peso corporal y los extras con historial ------- */
  E('Dominadas', 'espalda', 'banco_dominadas|rack|multiestacion', 'compuesto', 4, 5, 12, 180, {
    bw: true,
  }),
  E('Plancha', 'core', '', 'aislado', 3, 30, 60, 60, { bw: true, tags: ['isometrico'] }),
  E('Flexiones Diamante', 'triceps', '', 'compuesto', 3, 8, 20, 90, { bw: true }),
  E('Curl de Bíceps', 'biceps', 'mancuernas_fijas|mancuernas_ajustables', 'aislado', 3, 10, 14, 75),
  E('Pájaros', 'hombros', 'mancuernas_fijas|mancuernas_ajustables', 'aislado', 3, 12, 18, 75),
];

/**
 * La biblioteca por defecto, con una copia de array nueva en cada llamada (la
 * fusión con lo guardado no puede dejar colgadas referencias de un sitio a otro).
 */
export function seedExercises(): Exercise[] {
  return [...EJERCICIOS];
}

/**
 * Plantillas de rutina de la semilla: las 7 de la v1 que siguen teniendo
 * ejercicios detrás. Se quedan fuera `hiit` (cardio) y `mobility` (movilidad),
 * porque esta biblioteca no trae ni un ejercicio de esos grupos: la receta pedía
 * `[cardio, 2]`/`[movilidad, 5]` y el día saldría SIEMPRE vacío.
 *
 * El resto de recetas se ajustan a lo que hay: `pecho` pasa de 3 a 2 en
 * `push`, `femoral`/`gluteos` (que ya no existen) se cubren con `cuadriceps` y
 * `full_b` deja de pedir femoral. El reparto semanal (`WEEK_ROTATION`) apunta a
 * estas mismas 7, que es lo que hace `demo.ts` con `RECIPES`.
 */
export const TEMPLATES: readonly RoutineTemplate[] = [
  {
    id: 'full_a',
    name: 'Full body A',
    hint: '3 días/semana · principiantes',
    recipe: [
      ['cuadriceps', 2],
      ['pecho', 2],
      ['espalda', 2],
      ['core', 1],
    ],
  },
  {
    id: 'full_b',
    name: 'Full body B',
    hint: 'complementa al A',
    recipe: [
      ['cuadriceps', 2],
      ['espalda', 2],
      ['hombros', 2],
      ['core', 1],
    ],
  },
  {
    id: 'push',
    name: 'Empuje · Push',
    hint: 'pecho, hombro, tríceps',
    recipe: [
      ['pecho', 2],
      ['hombros', 2],
      ['triceps', 2],
    ],
  },
  {
    id: 'pull',
    name: 'Tirón · Pull',
    hint: 'espalda, bíceps',
    recipe: [
      ['espalda', 3],
      ['biceps', 2],
      ['antebrazo', 1],
    ],
  },
  {
    id: 'legs',
    name: 'Pierna · Legs',
    hint: 'cuádriceps y gemelos',
    recipe: [
      ['cuadriceps', 2],
      ['gemelos', 1],
    ],
  },
  {
    id: 'upper',
    name: 'Torso completo',
    hint: 'día único de tren superior',
    recipe: [
      ['espalda', 3],
      ['pecho', 2],
      ['hombros', 2],
      ['biceps', 1],
    ],
  },
  {
    id: 'lower',
    name: 'Pierna + core',
    hint: 'tren inferior con abdomen',
    recipe: [
      ['cuadriceps', 2],
      ['core', 1],
    ],
  },
];
