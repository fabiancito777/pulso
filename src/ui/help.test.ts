/**
 * `HelpModal.tsx` sin DOM (spec `help-ux.md` §5, tests 10-12): la señal de
 * estado y las defensas runtime de `openHelp`. El render del modal vive en el
 * navegador (no hay `.test.tsx` ni jsdom en el proyecto), igual que el resto de
 * tests de la raíz.
 */
import { afterEach, describe, expect, it } from 'vitest';

import type { HelpId } from './help-content';
import { closeHelp, helpId, openHelp } from './HelpModal';

afterEach(() => {
  closeHelp();
});

describe('openHelp / closeHelp', () => {
  it('sin document: no lanza y la señal queda abierta', () => {
    expect(typeof document).toBe('undefined');
    expect(() => openHelp('guide')).not.toThrow();
    expect(helpId.value).toBe('guide');
  });

  it('closeHelp deja la señal en null', () => {
    openHelp('opt.units');
    expect(helpId.value).toBe('opt.units');
    closeHelp();
    expect(helpId.value).toBe(null);
  });

  it('un id desconocido (cast manual) se ignora y no cambia la señal', () => {
    openHelp('guide');
    const unknown = 'no-existe' as string;
    expect(() => openHelp(unknown as HelpId)).not.toThrow();
    expect(helpId.value).toBe('guide');

    closeHelp();
    expect(() => openHelp(unknown as HelpId)).not.toThrow();
    expect(helpId.value).toBe(null);
  });

  it('se puede cambiar de tema sin cerrar (chips «ver también»)', () => {
    openHelp('guide');
    openHelp('glossary.1rm');
    expect(helpId.value).toBe('glossary.1rm');
  });
});
