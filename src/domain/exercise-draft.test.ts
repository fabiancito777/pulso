/**
 * Borrador de ejercicio del editor de Ajustes: validación e id en dominio puro.
 * Aquí quedan fijadas las reglas de la v1 (`ui.exerciseEditor`) que cambian el
 * resultado del form: nombre recortado y obligatorio, `repMax >= repMin`
 * subiendo repMax, rangos del formulario y un id que NUNCA se regenera.
 */
import { describe, expect, it } from 'vitest';

import { emptyDraft, draftFrom, idFor, toExercise, validateDraft } from './exercise-draft';
import { slug } from './text';
import type { Exercise } from './types';

const propio: Exercise = {
  id: 'ex_custom1',
  name: 'Remo en polea alta',
  group: 'espalda',
  equip: 'polea',
  type: 'compuesto',
  sets: 4,
  rest: 120,
  repMin: 6,
  repMax: 10,
  allowed: true,
  custom: true,
  bw: false,
  tags: ['tirón'],
  tips: 'Lleva el codo atrás',
};

describe('draftFrom', () => {
  it('con null devuelve el borrador por defecto de la v1', () => {
    expect(draftFrom(null)).toEqual(emptyDraft());
    expect(emptyDraft()).toMatchObject({
      name: '',
      group: 'pecho',
      equip: '',
      type: 'aislado',
      sets: 3,
      rest: 90,
      repMin: 8,
      repMax: 12,
      allowed: true,
    });
  });

  it('copia los campos del ejercicio y su material tal cual', () => {
    expect(draftFrom(propio)).toEqual({
      name: 'Remo en polea alta',
      group: 'espalda',
      equip: 'polea',
      type: 'compuesto',
      sets: 4,
      rest: 120,
      repMin: 6,
      repMax: 10,
      allowed: true,
    });
    /* `allowed` solo puede ser booleano: lo que no sea true es false */
    expect(draftFrom({ ...propio, allowed: false }).allowed).toBe(false);
  });
});

describe('validateDraft', () => {
  it('sin nombre (o con espacios) no se puede guardar, igual que la v1', () => {
    expect(validateDraft({ ...emptyDraft(), name: '' })).toEqual({
      ok: false,
      error: 'El nombre es obligatorio',
    });
    expect(validateDraft({ ...emptyDraft(), name: '   ' }).ok).toBe(false);
  });

  it('recorta el nombre', () => {
    const out = validateDraft({ ...emptyDraft(), name: '  Sentadilla  ' });
    expect(out).toMatchObject({ ok: true });
    if (out.ok) expect(out.value.name).toBe('Sentadilla');
  });

  it('repMin > repMax se iguala SUBIENDO repMax (regla de la v1)', () => {
    const out = validateDraft({ ...emptyDraft(), name: 'Prensa', repMin: 12, repMax: 8 });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value).toMatchObject({ repMin: 12, repMax: 12 });
  });

  it('mete los números dentro de los rangos del form', () => {
    const out = validateDraft({
      ...emptyDraft(),
      name: 'Prensa',
      sets: 99,
      rest: 9999,
      repMin: 0,
      repMax: 500,
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value).toMatchObject({ sets: 12, rest: 600, repMin: 1, repMax: 100 });
  });
});

describe('idFor', () => {
  it('usa el slug del nombre si está libre', () => {
    expect(idFor('Remo en polea alta', [])).toBe(slug('Remo en polea alta'));
    expect(idFor('Remo en polea alta', ['sentadilla'])).toBe('remo-en-polea-alta');
  });

  it('si el slug ya está cogido, genera uno con prefijo ex_', () => {
    const id = idFor('Remo en polea alta', ['remo-en-polea-alta']);
    expect(id).not.toBe('remo-en-polea-alta');
    expect(id.startsWith('ex_')).toBe(true);
  });

  it('sin nombre que produzca slug también genera un id', () => {
    expect(idFor('!!!', []).startsWith('ex_')).toBe(true);
  });
});

describe('toExercise', () => {
  const opts = { taken: ['sentadilla'] };

  it('monta el registro completo: bw = !equip, custom, tags y tips de serie', () => {
    const out = toExercise(
      { ...emptyDraft(), name: 'Fondos en paralelas', equip: 'paralelas' },
      opts,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value).toMatchObject({
      id: 'fondos-en-paralelas',
      name: 'Fondos en paralelas',
      equip: 'paralelas',
      bw: false,
      custom: true,
      tags: [],
      tips: '',
      allowed: true,
    });
  });

  it('sin material el ejercicio es de peso corporal', () => {
    const out = toExercise({ ...emptyDraft(), name: 'Plancha' }, opts);
    expect(out.ok && out.value.bw).toBe(true);
  });

  it('conserva el id del ejercicio editado aunque cambie el nombre', () => {
    const out = toExercise(
      { ...emptyDraft(), name: 'Otro nombre', equip: '' },
      {
        ...opts,
        currentId: propio.id,
      },
    );
    expect(out.ok && out.value.id).toBe('ex_custom1');
  });

  it('propaga el error si no hay nombre', () => {
    expect(toExercise(emptyDraft(), opts)).toEqual({
      ok: false,
      error: 'El nombre es obligatorio',
    });
  });
});
