/**
 * Humo: la pestaña Progreso entera se puede importar SIN navegador.
 *
 * No pinta nada (Vitest corre en `node` y aquí solo hay `*.test.ts`), pero sí
 * comprueba lo que sí se rompe sin aviso: ciclos de imports entre `charts`,
 * los modales y el store, y que ningún módulo del grafo toca `window`/`document`
 * al cargar.
 */
import { describe, expect, it } from 'vitest';

import { pickExercise, pickedExercise } from '@/state/progress';

import { LastStimulus } from './LastStimulus';
import { PrTableButton } from './PrTableModal';
import { ProgressCard } from './ProgressCard';
import { ProgressView } from './ProgressView';
import { SessionDetailModal } from './SessionDetailModal';
import { SessionHistory } from './SessionHistory';

describe('ProgressView', () => {
  it('monta (como función) todos los bloques de la pestaña', () => {
    expect(typeof ProgressView).toBe('function');
    expect(typeof ProgressCard).toBe('function');
    expect(typeof SessionHistory).toBe('function');
    expect(typeof SessionDetailModal).toBe('function');
    expect(typeof PrTableButton).toBe('function');
    expect(typeof LastStimulus).toBe('function');
  });

  it('la elección de ejercicio vive en la signal compartida', () => {
    pickExercise('press-de-banca-con-barra');
    expect(pickedExercise.value).toBe('press-de-banca-con-barra');
    pickExercise(null);
    expect(pickedExercise.value).toBe(null);
  });
});
