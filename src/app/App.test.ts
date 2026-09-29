/**
 * `app/App.tsx`: los **subtítulos de pestaña** (el `V.sub` de la v1, que
 * `updateAppbar` pintaba en `#appbar-sub`, `legacy/js/app.js:60-63`).
 *
 * En la v2 ese texto se reparte entre el shell y la propia vista, así que lo que
 * hay que vigilar es el REPARTO: el shell pinta Rutinas y Ajustes, las demás
 * pestañas lo traen de dentro (Hoy el saludo, Progreso el resumen, Coach la
 * tarjeta de conexión y Calendario `weekSubtitle`) y no deben aparecer dos veces.
 * Aquí solo se prueba el shell (sin DOM, como el resto de tests de la raíz).
 *
 * `routines` es una signal en memoria: el test la guarda y la restaura para no
 * dejar el módulo sucio para los demás archivos.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { TEMPLATES } from '@/domain/catalog';
import { routines, type Routine } from '@/state/store';

import { tabSub } from './App';

const original = routines.value;

function routine(id: string): Routine {
  return { id, name: id, items: [] };
}

afterEach(() => {
  routines.value = original;
});

describe('tabSub (el V.sub de la v1)', () => {
  it('rutinas vacías: el llamado a la acción literal de la v1', () => {
    routines.value = [];
    expect(tabSub('rutinas')).toBe('Crea tu primera rutina o usa una plantilla');
  });

  it('rutinas guardadas: cuenta en singular/plural + nº de plantillas', () => {
    routines.value = [routine('rt-1')];
    expect(tabSub('rutinas')).toBe(`1 rutina guardada · ${TEMPLATES.length} plantillas`);

    routines.value = [routine('rt-1'), routine('rt-2')];
    expect(tabSub('rutinas')).toBe(`2 rutinas guardadas · ${TEMPLATES.length} plantillas`);
  });

  it('ajustes: subtítulo fijo de la v1', () => {
    expect(tabSub('ajustes')).toBe('Personaliza Pulso a tu medida');
  });

  it('las demás pestañas lo pinta SU vista, así que el shell no dice nada', () => {
    for (const tab of ['hoy', 'entrenar', 'calendario', 'coach', 'progreso']) {
      expect(tabSub(tab)).toBe('');
    }
  });
});
