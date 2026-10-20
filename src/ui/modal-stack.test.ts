import { afterEach, describe, expect, it } from 'vitest';

import {
  closeTopModal,
  isTopModal,
  pushModal,
  removeModal,
  resetModalStack,
  topModal,
} from './modal-stack';

afterEach(resetModalStack);

describe('pila de modales', () => {
  it('solo el último modal es el superior', () => {
    const first = pushModal({ dismissable: true, close: () => undefined });
    const second = pushModal({ dismissable: true, close: () => undefined });

    expect(isTopModal(first)).toBe(false);
    expect(isTopModal(second)).toBe(true);
    expect(topModal()?.id).toBe(second);
  });

  it('cerrar el superior no toca al que queda debajo', () => {
    const closed: string[] = [];
    const first = pushModal({ dismissable: true, close: () => closed.push('primero') });
    pushModal({ dismissable: true, close: () => closed.push('segundo') });

    expect(closeTopModal()).toBe(true);
    expect(closed).toEqual(['segundo']);
    expect(isTopModal(first)).toBe(true);
  });

  it('un modal no descartable bloquea el cierre de toda la pila', () => {
    const closed: string[] = [];
    pushModal({ dismissable: true, close: () => closed.push('abajo') });
    pushModal({ dismissable: false, close: () => closed.push('arriba') });

    expect(closeTopModal()).toBe(false);
    expect(closed).toEqual([]);
    expect(topModal()?.dismissable).toBe(false);
  });

  it('quitar un modal intermedio deja intacto el orden del resto', () => {
    const first = pushModal({ dismissable: true, close: () => undefined });
    const middle = pushModal({ dismissable: true, close: () => undefined });
    const last = pushModal({ dismissable: true, close: () => undefined });

    removeModal(middle);

    expect(isTopModal(last)).toBe(true);
    removeModal(last);
    expect(isTopModal(first)).toBe(true);
    expect(topModal()?.id).toBe(first);
  });

  it('sin modales no hay superior ni nada que cerrar', () => {
    expect(topModal()).toBeUndefined();
    expect(isTopModal(1)).toBe(false);
    expect(closeTopModal()).toBe(false);
  });
});
