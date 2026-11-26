import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { seedExercises } from './seed';
import { EXERCISE_GUIDES } from './exercise-guides';

describe('guías visuales de la biblioteca inicial', () => {
  it('asigna una guía a cada ejercicio sembrado', () => {
    const missing = seedExercises()
      .map(({ id }) => id)
      .filter((id) => !Object.prototype.hasOwnProperty.call(EXERCISE_GUIDES, id));

    expect(missing).toEqual([]);
  });

  it('incluye todos los assets públicos referenciados por las guías', () => {
    const missing = Object.entries(EXERCISE_GUIDES).flatMap(([id, guide]) => {
      return guide.phases
        .filter(({ src }) => !existsSync(join(process.cwd(), 'public', src.slice(1))))
        .map(({ src }) => `${id}: ${src}`);
    });

    expect(missing).toEqual([]);
  });

  it('mantiene distintos los presses y los aliases de movimientos idénticos', () => {
    expect(EXERCISE_GUIDES['press-militar'].sourceId).toBe('overhead-press');
    expect(EXERCISE_GUIDES['press-militar-sentado-con-mancuernas'].sourceId).toBe(
      'dumbbell-shoulder-press',
    );
    expect(EXERCISE_GUIDES['floor-press']).toEqual(EXERCISE_GUIDES['press-de-piso-con-mancuernas']);
    expect(EXERCISE_GUIDES.pajaros).toEqual(EXERCISE_GUIDES['pajaros-con-mancuernas']);
  });
});
