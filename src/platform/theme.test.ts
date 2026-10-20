/**
 * `platform/theme.ts`: utilidades de color y aplicación del tema al `<html>`.
 * `rgba`/`inkFor` son puras; `applyTheme` se comprueba con un `document` doble.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyTheme, inkFor, rgba } from './theme';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('rgba', () => {
  it('expande hex de 3 y 6 dígitos con el alfa pedido', () => {
    expect(rgba('#c8ff2e', 0.5)).toBe('rgba(200, 255, 46, 0.5)');
    expect(rgba('#fff', 1)).toBe('rgba(255, 255, 255, 1)');
  });
});

describe('inkFor', () => {
  it('usa tinta oscura sobre acentos claros y clara sobre oscuros', () => {
    expect(inkFor('#ffffff')).toBe('#0b0d10');
    expect(inkFor('#000000')).toBe('#f7f8fa');
    expect(inkFor('#c8ff2e')).toBe('#0b0d10');
  });
});

describe('applyTheme', () => {
  it('escribe tema, acento y color de barra en el documento', () => {
    const setAttribute = vi.fn();
    const setProperty = vi.fn();
    const meta = { setAttribute: vi.fn() };
    vi.stubGlobal('document', {
      documentElement: { setAttribute, style: { setProperty } },
      querySelector: vi.fn(() => meta),
    });

    applyTheme('light', '#ffffff');

    expect(setAttribute).toHaveBeenCalledWith('data-theme', 'light');
    expect(setProperty).toHaveBeenCalledWith('--accent', '#ffffff');
    expect(setProperty).toHaveBeenCalledWith('--accent-soft', 'rgba(255, 255, 255, 0.15)');
    expect(setProperty).toHaveBeenCalledWith('--accent-ink', '#0b0d10');
    expect(meta.setAttribute).toHaveBeenCalledWith('content', '#f4f5f7');
  });

  it('sin tema ni acento aplica los valores por defecto (amoled y lima)', () => {
    const setAttribute = vi.fn();
    const setProperty = vi.fn();
    vi.stubGlobal('document', {
      documentElement: { setAttribute, style: { setProperty } },
      querySelector: vi.fn(() => null),
    });

    applyTheme(undefined, undefined);

    expect(setAttribute).toHaveBeenCalledWith('data-theme', 'amoled');
    expect(setProperty).toHaveBeenCalledWith('--accent', '#c8ff2e');
  });

  it('sin document no lanza', () => {
    vi.stubGlobal('document', undefined);
    expect(() => applyTheme('dark', '#c8ff2e')).not.toThrow();
  });
});
