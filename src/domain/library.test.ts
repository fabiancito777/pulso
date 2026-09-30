import { describe, expect, it } from 'vitest';

import { SEED_EXERCISES } from './catalog';
import { customExercises, mergeSeed } from './library';
import type { Exercise } from './types';

const seedPress = SEED_EXERCISES.find((e) => e.id === 'press-de-banca-con-barra') as Exercise;

describe('mergeSeed', () => {
  it('siembra la biblioteca cuando no hay nada guardado', () => {
    const list = mergeSeed(SEED_EXERCISES, undefined);
    expect(list).toHaveLength(SEED_EXERCISES.length);
    expect(list[0]?.name).toBe(SEED_EXERCISES[0]?.name);
  });

  it('conserva lo permitido/prohibido y los ejercicios propios', () => {
    const saved: Exercise[] = [
      { ...seedPress, allowed: false, custom: false },
      {
        ...seedPress,
        id: 'mi-curl-raro',
        name: 'Mi curl raro',
        custom: true,
        allowed: true,
        sets: 5,
        rest: 30,
      },
    ];
    const list = mergeSeed(SEED_EXERCISES, saved);
    const press = list.find((e) => e.id === 'press-de-banca-con-barra');
    expect(press?.allowed).toBe(false);
    expect(customExercises(list).map((e) => e.name)).toEqual(['Mi curl raro']);
    /* el ejercicio propio no se pisa con la semilla */
    const custom = list.find((e) => e.id === 'mi-curl-raro');
    expect(custom?.sets).toBe(5);
    expect(custom?.rest).toBe(30);
  });

  it('refresca los datos de biblioteca pero no los ajustes del usuario', () => {
    const saved: Exercise[] = [{ ...seedPress, sets: 9, rest: 5, custom: false }];
    const list = mergeSeed(SEED_EXERCISES, saved);
    const press = list.find((e) => e.id === seedPress.id);
    /* la semilla manda en sets/rest de los ejercicios de biblioteca… */
    expect(press?.sets).toBe(seedPress.sets);
    expect(press?.rest).toBe(seedPress.rest);
    /* …pero allowed sigue siendo del usuario (comprobado arriba) */
  });

  it('sanea valores imposibles guardados', () => {
    /* sets 0 y rest -10 se acotan igual que en la v1 (1 y 0) */
    const saved: Exercise[] = [
      { ...seedPress, custom: true, sets: 0, rest: -10, repMin: 0, repMax: NaN },
    ];
    const list = mergeSeed([], saved);
    expect(list[0]?.sets).toBe(1);
    expect(list[0]?.rest).toBe(0);
    expect(list[0]?.repMin).toBe(1);
    expect(list[0]?.repMax).toBe(12);
  });

  it('rellena lo que falta con los valores por defecto', () => {
    const list = mergeSeed([], [{ id: 'roto', name: 'Roto' } as unknown as Exercise]);
    expect(list[0]).toMatchObject({ sets: 3, rest: 90, repMin: 8, repMax: 12, allowed: true });
  });

  it('no muta la lista guardada (a diferencia de la v1)', () => {
    const saved: Exercise[] = [{ ...seedPress, allowed: false }];
    const before = JSON.stringify(saved);
    mergeSeed(SEED_EXERCISES, saved);
    expect(JSON.stringify(saved)).toBe(before);
  });

  it('ignora entradas rotas', () => {
    expect(mergeSeed([], [null, {}, { id: 'ok', id2: 1 } as unknown as Exercise])).toHaveLength(1);
  });
});
