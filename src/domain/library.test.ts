import { describe, expect, it } from 'vitest';

import { seedExercises } from './data';
import { customExercises, mergeSeed } from './library';
import type { Exercise } from './types';

/* La semilla real (la misma que fusiona `state/store.ts` con lo guardado) */
const SEED = seedExercises();
const seedPress = SEED.find((e) => e.id === 'press-de-piso-con-mancuernas') as Exercise;

describe('mergeSeed', () => {
  it('siembra la biblioteca cuando no hay nada guardado', () => {
    const list = mergeSeed(SEED, undefined);
    expect(list).toHaveLength(SEED.length);
    expect(list[0]?.name).toBe(SEED[0]?.name);
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
    const list = mergeSeed(SEED, saved);
    const press = list.find((e) => e.id === seedPress.id);
    expect(press?.allowed).toBe(false);
    expect(customExercises(list).map((e) => e.name)).toEqual(['Mi curl raro']);
    /* el ejercicio propio no se pisa con la semilla */
    const custom = list.find((e) => e.id === 'mi-curl-raro');
    expect(custom?.sets).toBe(5);
    expect(custom?.rest).toBe(30);
  });

  it('refresca los datos de biblioteca pero no los ajustes del usuario', () => {
    const saved: Exercise[] = [{ ...seedPress, sets: 9, rest: 5, custom: false }];
    const list = mergeSeed(SEED, saved);
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
    mergeSeed(SEED, saved);
    expect(JSON.stringify(saved)).toBe(before);
  });

  it('ignora entradas rotas', () => {
    expect(mergeSeed([], [null, {}, { id: 'ok', id2: 1 } as unknown as Exercise])).toHaveLength(1);
  });
});

describe('flags de usuario (fav / hidden)', () => {
  it('conserva los ★ y los ocultos que traiga lo guardado', () => {
    const saved: Exercise[] = [{ ...seedPress, fav: true, hidden: true }];
    const list = mergeSeed(SEED, saved);
    const press = list.find((e) => e.id === seedPress.id);
    expect(press?.fav).toBe(true);
    expect(press?.hidden).toBe(true);
  });

  it('materializa los flags como boolean en TODA la lista (la semilla no los trae)', () => {
    const list = mergeSeed(SEED, [{ ...seedPress, fav: true }]);
    expect(list).toHaveLength(SEED.length);
    for (const ex of list) {
      expect(typeof ex.fav, ex.id).toBe('boolean');
      expect(typeof ex.hidden, ex.id).toBe('boolean');
    }
    /* sin marcar todo es false, no undefined: la UI lee `e.fav` sin `?.` */
    expect(list.find((e) => e.id !== seedPress.id)?.fav).toBe(false);
    expect(list.find((e) => e.id === seedPress.id)?.hidden).toBe(false);
  });

  it('un false guardado se queda en false (no se convierte en true)', () => {
    const list = mergeSeed(SEED, [{ ...seedPress, fav: false, hidden: false }]);
    const press = list.find((e) => e.id === seedPress.id);
    expect(press?.fav).toBe(false);
    expect(press?.hidden).toBe(false);
  });

  it('un ★ de catálogo sobrevive a re-fusionar (lo que hace `refresh()`)', () => {
    const primera = mergeSeed(SEED, [{ ...seedPress, fav: true }]);
    /* mismo filtro que `persistExercises`: solo propios, prohibidos y con flag */
    const persistido = primera.filter(
      (e) => e.custom || e.allowed === false || e.fav === true || e.hidden === true,
    );
    expect(persistido).toHaveLength(1);
    const recargada = mergeSeed(SEED, persistido);
    expect(recargada.find((e) => e.id === seedPress.id)?.fav).toBe(true);
    expect(recargada).toHaveLength(SEED.length);
  });
});
