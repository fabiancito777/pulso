/**
 * `ui/picker-helpers.ts`: visibilidad y orden del picker de ejercicios, que en
 * la v1 vivían dentro del modal (repintado a cada tecla) y por eso no se podían
 * comprobar sin navegador.
 *
 * Aquí se fijan las decisiones de la spec `ejercicios-revamp.md` §3.2:
 *
 * - los `hidden` NO salen, ni siquiera con el filtro de disponibles abierto;
 * - el filtro «solo disponibles» está ACTIVADO por defecto y se puede abrir;
 * - el orden es ★ → permitido y disponible → familiaridad → nombre, es decir
 *   el ★ manda sobre el material (es lo que pedía el usuario);
 * - `exclude`/`onlyIds` (los que ya están en la sesión y el picker de «Otro»)
 *   siguen intactos.
 */
import { describe, expect, it } from 'vitest';

import type { Exercise } from '@/domain/types';

import { orderPickerItems, visiblePickerItems } from './picker-helpers';

function ex(partial: Partial<Exercise> & Pick<Exercise, 'id' | 'name'>): Exercise {
  return {
    group: 'pecho',
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

const ids = (list: readonly Exercise[]): string[] => list.map((e) => e.id);

describe('visiblePickerItems', () => {
  const items = [
    ex({ id: 'ok', name: 'Peso corporal' }),
    ex({ id: 'eq', name: 'Con barra', equip: 'barra_olimpica' }),
    ex({ id: 'no', name: 'Prohibido', allowed: false }),
    ex({ id: 'hid', name: 'Oculto', hidden: true }),
  ];

  it('los ocultos no salen nunca (ni con el filtro de disponibles abierto)', () => {
    expect(ids(visiblePickerItems(items, { equip: {} }))).toEqual(['ok']);
    expect(ids(visiblePickerItems(items, { equip: {}, availableOnly: false }))).toEqual([
      'ok',
      'eq',
      'no',
    ]);
  });

  it('«solo disponibles» es el comportamiento por defecto y se puede abrir', () => {
    expect(ids(visiblePickerItems(items, { equip: {} }))).toEqual(['ok']);
    expect(ids(visiblePickerItems(items, { equip: {}, availableOnly: false }))).not.toContain(
      'hid',
    );
    expect(ids(visiblePickerItems(items, { equip: { barra_olimpica: true } }))).toEqual([
      'ok',
      'eq',
    ]);
    /* sin material calculado todo es «no disponible» */
    expect(ids(visiblePickerItems(items))).toEqual(['ok']);
  });

  it('respeta `exclude` (ya están en la sesión) y `onlyIds` (picker de «Otro»)', () => {
    expect(ids(visiblePickerItems(items, { equip: {}, exclude: ['ok'] }))).toEqual([]);
    expect(
      ids(visiblePickerItems(items, { equip: {}, availableOnly: false, exclude: ['ok'] })),
    ).toEqual(['eq', 'no']);
    expect(
      ids(visiblePickerItems(items, { equip: {}, availableOnly: false, onlyIds: ['eq', 'hid'] })),
    ).toEqual(['eq']);
  });
});

describe('orderPickerItems', () => {
  it('los ★ salen primero, aunque les falte material', () => {
    const items = [
      ex({ id: 'dispo', name: 'Disponible' }),
      ex({ id: 'fav', name: 'Favorito', equip: 'barra_olimpica', fav: true }),
    ];
    expect(ids(orderPickerItems(items, { equip: {} }))).toEqual(['fav', 'dispo']);
    /* y sin ★ el material vuelve a mandar */
    expect(ids(orderPickerItems(items, { equip: {}, fav: new Set() }))).toEqual(['dispo', 'fav']);
  });

  it('sin ★ el orden es disponible → familiaridad → nombre', () => {
    const items = [
      ex({ id: 'b', name: 'Beto' }),
      ex({ id: 'a', name: 'Alfa' }),
      ex({ id: 'c', name: 'Caro', equip: 'barra_olimpica' }),
      ex({ id: 'd', name: 'Dora' }),
    ];
    const fam = new Map([['d', 3]]);
    expect(ids(orderPickerItems(items, { equip: {}, fam }))).toEqual(['d', 'a', 'b', 'c']);
  });

  it('la familiaridad no se salta un ★', () => {
    const items = [
      ex({ id: 'fam', name: 'Familiar', fav: true }),
      ex({ id: 'otro', name: 'Otro' }),
    ];
    const fam = new Map([['otro', 9]]);
    expect(ids(orderPickerItems(items, { equip: {}, fam }))).toEqual(['fam', 'otro']);
  });

  it('el `set` de ★ que se pase de fuera manda sobre `ex.fav`', () => {
    const items = [ex({ id: 'a', name: 'Alfa' }), ex({ id: 'b', name: 'Beto', fav: true })];
    expect(ids(orderPickerItems(items))).toEqual(['b', 'a']);
    expect(ids(orderPickerItems(items, { fav: new Set(['a']) }))).toEqual(['a', 'b']);
    /* un set vacío significa «nadie es ★»: la fuente es el set, no el objeto */
    expect(ids(orderPickerItems(items, { fav: new Set() }))).toEqual(['a', 'b']);
  });

  it('no muta la lista de entrada y el desempate final es el nombre', () => {
    const items = [ex({ id: 'b', name: 'Beto' }), ex({ id: 'a', name: 'Alfa' })];
    const copia = [...items];
    expect(ids(orderPickerItems(items))).toEqual(['a', 'b']);
    expect(items).toEqual(copia);
  });
});
