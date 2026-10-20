/**
 * `platform/clipboard.ts`: portapapeles moderno y respaldo de `execCommand`.
 * Los dos caminos se prueban con stubs, sin DOM real (el entorno es Node).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyText } from './clipboard';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('copyText', () => {
  it('usa navigator.clipboard cuando existe', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await expect(copyText('hola')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hola');
  });

  it('si el portapapeles moderno falla, usa el textarea + execCommand', async () => {
    const writeText = vi.fn(() => Promise.reject(new Error('permiso')));
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    const area = {
      value: '',
      style: {},
      setAttribute: vi.fn(),
      select: vi.fn(),
      remove: vi.fn(),
    };
    const appendChild = vi.fn();
    const execCommand = vi.fn(() => true);
    vi.stubGlobal('document', {
      createElement: vi.fn(() => area),
      body: { appendChild },
      execCommand,
    });

    await expect(copyText('respaldo')).resolves.toBe(true);
    expect(area.value).toBe('respaldo');
    expect(appendChild).toHaveBeenCalledWith(area);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(area.remove).toHaveBeenCalledTimes(1);
  });

  it('si execCommand devuelve false, el resultado es false', async () => {
    vi.stubGlobal('navigator', {});
    const area = {
      value: '',
      style: {},
      setAttribute: vi.fn(),
      select: vi.fn(),
      remove: vi.fn(),
    };
    vi.stubGlobal('document', {
      createElement: vi.fn(() => area),
      body: { appendChild: vi.fn() },
      execCommand: vi.fn(() => false),
    });

    await expect(copyText('x')).resolves.toBe(false);
    expect(area.remove).toHaveBeenCalledTimes(1);
  });

  it('sin navigator.clipboard ni document devuelve false', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', undefined);
    await expect(copyText('x')).resolves.toBe(false);
  });

  it('si el DOM falla devuelve false sin lanzar', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', {
      createElement: () => {
        throw new Error('sin DOM');
      },
    });
    await expect(copyText('x')).resolves.toBe(false);
  });
});
