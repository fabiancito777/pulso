/**
 * `ui/routines-helpers.ts`: lo que hace falta comprobar de la vista Rutinas sin
 * abrir un navegador.
 *
 * Aquí se cubren los tres sitios donde la vista podía fallar en silencio: la
 * búsqueda de ejercicios (tiene que entender tildes y búsquedas por grupo), la
 * propuesta del coach (llega como texto con alias que se inventa el modelo) y los
 * números que van a inputs (un vacío no puede acabar en 0).
 */
import { describe, expect, it } from 'vitest';

import { SEED_EXERCISES } from '@/domain/catalog';
import type { Session } from '@/domain/types';

import {
  bounded,
  lastUsed,
  matchExercises,
  routineSets,
  sourceBadge,
  toSuggestion,
  weightOrNull,
} from './routines-helpers';

const LIBRARY = SEED_EXERCISES;

const session = (patch: Partial<Session>): Session => ({
  id: 's',
  date: '2026-09-01',
  startedAt: '2026-09-01T10:00:00.000Z',
  unit: 'kg',
  entries: [],
  ...patch,
});

describe('matchExercises', () => {
  it('con la consulta vacía devuelve los primeros de la biblioteca', () => {
    const found = matchExercises('', LIBRARY);
    expect(found).toHaveLength(8);
    expect(found[0]?.id).toBe(LIBRARY[0]?.id);
  });

  it('encuentra por nombre aunque venga sin tildes ni mayúsculas', () => {
    const found = matchExercises('EXTENSION DE TRICEPS EN POLEA ALTA', LIBRARY);
    expect(found.map((ex) => ex.name)).toContain('Extensión de tríceps en polea alta');
  });

  it('encuentra por grupo muscular', () => {
    const found = matchExercises('pecho', LIBRARY, [], 50);
    expect(found.length).toBeGreaterThan(3);
    /* El grupo manda; lo único que se cuela es «Jalón al pecho» (espalda),
       que también lleva la palabra y tampoco está mal mostrarla. */
    expect(found.filter((ex) => ex.group !== 'pecho').map((ex) => ex.name)).toEqual([
      'Jalón al pecho',
    ]);
  });

  it('excluye los ejercicios que ya están en la rutina', () => {
    const press = LIBRARY.find((ex) => ex.name === 'Press de banca con barra');
    expect(press).toBeTruthy();
    const found = matchExercises('press', LIBRARY, [press?.id ?? '']);
    expect(found.map((ex) => ex.id)).not.toContain(press?.id);
  });

  it('respeta el límite y no devuelve nada si no se parece a nada', () => {
    expect(matchExercises('press', LIBRARY, [], 2)).toHaveLength(2);
    expect(matchExercises('zzzqqq sin sentido', LIBRARY)).toEqual([]);
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
      { name: 'Press de banca con barra', sets: 4, repMin: 6, repMax: 10, rest: 180, weight: 60 },
      { name: 'Press de banca con barra EXTRA', sets: 3, weight: '' },
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
    expect(difuso?.name).toBe('Press de banca con barra');
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
        items: [{ ejercicio: 'Press de banca con barra' }],
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
