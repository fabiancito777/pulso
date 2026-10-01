/**
 * `createExerciseFromAI`: el ÚNICO punto de escritura de ejercicios propuestos
 * por IA (spec `_specs/creacion-ejercicios-plan.md` §3.2).
 *
 * Se prueban con `localStorage` simulado, igual que `store.test.ts`: lo que hay
 * que verificar es que la creación es una escritura NORMAL del store (y que un
 * duplicado o un borrador inválido no mueven ni un byte). El simulado se monta
 * antes del import, por eso los imports son dinámicos.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AIExerciseProposal } from '@/domain/ai-exercise';
import { slug } from '@/domain/text';
import type { Exercise } from '@/domain/types';

const mem = new Map<string, string>();

vi.mock('@/ui/toast', () => ({
  toast: vi.fn(() => ({ close: () => {} })),
}));

vi.stubGlobal('localStorage', {
  getItem: (key: string): string | null => (mem.has(key) ? (mem.get(key) as string) : null),
  setItem: (key: string, value: string): void => {
    mem.set(key, String(value));
  },
  removeItem: (key: string): void => {
    mem.delete(key);
  },
  clear: (): void => {
    mem.clear();
  },
  key: (index: number): string | null => [...mem.keys()][index] ?? null,
  get length(): number {
    return mem.size;
  },
});

const store = await import('./store');
const create = await import('./exercise-create');

const PROPUESTA: AIExerciseProposal = {
  name: 'Remo con mancuerna en prono a un brazo',
  group: 'espalda',
  equip: 'mancuernas_ajustables',
  type: 'compuesto',
  sets: 3,
  rest: 120,
  repMin: 8,
  repMax: 12,
  unilateral: true,
  desc: 'Pecho apoyado en el banco, tira del codo hacia la cadera.',
};

beforeEach(() => {
  mem.clear();
  store.writeState(store.defaultState());
  store.refresh();
  create.pendingEditId.value = null;
});

describe('createExerciseFromAI', () => {
  it('crea un propio con allowed/custom/bw correctos y lo persiste', () => {
    const antes = store.exercises.value.length;
    const estadoAntes = mem.get('pulso.state');

    const result = create.createExerciseFromAI(PROPUESTA);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const creado = result.exercise;
    expect(creado).toMatchObject({
      id: slug(PROPUESTA.name),
      name: PROPUESTA.name,
      group: 'espalda',
      equip: 'mancuernas_ajustables',
      type: 'compuesto',
      sets: 3,
      rest: 120,
      repMin: 8,
      repMax: 12,
      allowed: true,
      custom: true,
      bw: false,
      tips: PROPUESTA.desc,
    });
    expect(store.exercises.value).toHaveLength(antes + 1);
    expect(store.exercises.value.map((e) => e.id)).toContain(creado.id);

    expect(mem.get('pulso.state')).not.toBe(estadoAntes);
    const persistidos: unknown = store.readState().exercises;
    expect(
      Array.isArray(persistidos) && (persistidos as Exercise[]).some((e) => e.id === creado.id),
    ).toBe(true);
  });

  it('equip vacío → bw true (peso corporal)', () => {
    const result = create.createExerciseFromAI({
      name: 'Semisentadilla con salto en el suelo',
      group: 'cuadriceps',
      equip: '',
      type: 'compuesto',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.exercise.bw).toBe(true);
    expect(result.exercise.allowed).toBe(true);
    expect(result.exercise.custom).toBe(true);
    expect(result.exercise.tips).toBe('');
  });

  it('un duplicado NO crea nada y se cuenta como error', () => {
    const antes = store.exercises.value.length;
    const estadoAntes = mem.get('pulso.state');

    const result = create.createExerciseFromAI({
      name: 'Dominadas',
      group: 'espalda',
      equip: '',
      type: 'compuesto',
    });

    expect(result).toEqual({ ok: false, error: 'Ya existe un ejercicio parecido: «Dominadas»' });
    expect(store.exercises.value).toHaveLength(antes);
    expect(mem.get('pulso.state')).toBe(estadoAntes);
  });

  it('un borrador inválido no escribe nada', () => {
    const antes = store.exercises.value.length;
    const estadoAntes = mem.get('pulso.state');

    const result = create.createExerciseFromAI({ name: '   ', group: 'pecho', equip: '' });

    expect(result).toEqual({ ok: false, error: 'El nombre es obligatorio' });
    expect(store.exercises.value).toHaveLength(antes);
    expect(mem.get('pulso.state')).toBe(estadoAntes);
  });

  it('material que el usuario no tiene → error sin escritura', () => {
    const antes = store.exercises.value.length;

    const result = create.createExerciseFromAI(
      { name: 'Remo con mancuerna en prono a un brazo', group: 'espalda', equip: '' },
      { equipment: {} },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('material');
    expect(store.exercises.value).toHaveLength(antes);
  });

  it('opts.library y opts.equipment mandan sobre las signals del store', () => {
    const biblioteca: Exercise[] = [
      {
        id: 'ejercicio-de-prueba',
        name: 'Ejercicio de prueba',
        group: 'pecho',
        equip: '',
        type: 'aislado',
        sets: 3,
        repMin: 8,
        repMax: 12,
        rest: 90,
        allowed: true,
        custom: true,
        bw: true,
        tags: [],
        tips: '',
      },
    ];

    /* en el store NO existe, pero en la biblioteca que pasa el caller SÍ */
    const dup = create.createExerciseFromAI(
      { name: 'Ejercicio de prueba', group: 'pecho', equip: '' },
      { library: biblioteca },
    );
    expect(dup).toEqual({
      ok: false,
      error: 'Ya existe un ejercicio parecido: «Ejercicio de prueba»',
    });

    const sinMaterial = create.createExerciseFromAI(
      { name: 'Remo con mancuerna en prono a un brazo', group: 'espalda', equip: '' },
      { equipment: {} },
    );
    expect(sinMaterial.ok).toBe(false);
  });
});

describe('requestEdit / takePendingEdit', () => {
  it('la petición se lee UNA sola vez y se limpia', () => {
    expect(create.takePendingEdit()).toBeNull();

    create.requestEdit('ex_demo');
    expect(create.pendingEditId.value).toBe('ex_demo');
    expect(create.takePendingEdit()).toBe('ex_demo');
    expect(create.pendingEditId.value).toBeNull();
    expect(create.takePendingEdit()).toBeNull();
  });

  it('requestEdit vacío no deja petición colgada', () => {
    create.requestEdit('ex_demo');
    create.requestEdit('   ');
    expect(create.pendingEditId.value).toBeNull();
    expect(create.takePendingEdit()).toBeNull();
  });
});
