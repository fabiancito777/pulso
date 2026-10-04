/**
 * `platform/files.ts`: el selector de ficheros de «Importar copia».
 *
 * El bug que fija este test (1.1): la promesa SOLO se resolvía dentro de
 * `change`, así que cancelar el diálogo (Esc o «Cancelar») la dejaba colgada
 * para siempre y el `<input>` se quedaba huérfano en el DOM, llamada tras
 * llamada. Aquí se cubren los tres caminos de salida —`cancel`, `change` sin
 * fichero y `change` con fichero (lectura incluida)— más el enchufe/desenchufe
 * del nodo entre llamadas.
 *
 * `vite.config.ts` corre con `environment: 'node'` (sin jsdom, y no se van a
 * instalar dependencias para esto), así que `document` y `FileReader` se
 * doblan con objetos planos: guardan listeners y los disparan a mano.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pickTextFile } from './files';

/** Nodos que el doble de `document.body` tiene montados en cada momento. */
const children: FakeInput[] = [];

/** `FileReader` de mentira: anota las lecturas y las dispara el test. */
const readers: FakeFileReader[] = [];

/** Fichero mínimo que el test cuela en `input.files`. */
const file = { name: 'pulso-copia.json' };

/** Dispara un evento a los listeners que queden enganchados. */
function fire(into: { listeners: Map<string, (() => void)[]> }, type: string): void {
  for (const listener of [...(into.listeners.get(type) ?? [])]) listener();
}

/** Contador de listeners enganchados (para ver que no se quedan colgados). */
function count(into: { listeners: Map<string, (() => void)[]> }): number {
  let total = 0;
  for (const list of into.listeners.values()) total += list.length;
  return total;
}

class FakeInput {
  type = '';
  accept = '';
  readonly style: Record<string, string> = {};
  files: { name: string }[] | null = null;
  clicks = 0;
  removed = false;
  readonly listeners = new Map<string, (() => void)[]>();

  addEventListener(type: string, listener: () => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: () => void): void {
    const list = this.listeners.get(type) ?? [];
    const at = list.indexOf(listener);
    if (at >= 0) list.splice(at, 1);
  }

  remove(): void {
    this.removed = true;
    const at = children.indexOf(this);
    if (at >= 0) children.splice(at, 1);
  }

  click(): void {
    this.clicks += 1;
  }

  fire(type: string): void {
    fire(this, type);
  }

  get listenerCount(): number {
    return count(this);
  }
}

class FakeFileReader {
  result: string | null = null;
  file: unknown = null;
  readonly listeners = new Map<string, (() => void)[]>();

  addEventListener(type: string, listener: () => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  readAsText(file: unknown): void {
    this.file = file;
    readers.push(this);
  }

  fire(type: string): void {
    fire(this, type);
  }

  get listenerCount(): number {
    return count(this);
  }
}

const fakeDocument = {
  body: {
    appendChild(input: FakeInput): void {
      children.push(input);
    },
  },
  createElement(): FakeInput {
    return new FakeInput();
  },
};

beforeEach(() => {
  children.length = 0;
  readers.length = 0;
  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('FileReader', FakeFileReader);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** El único `<input>` que el módulo acaba de montar. */
function onlyInput(): FakeInput {
  expect(children).toHaveLength(1);
  const input = children[0];
  if (!input) throw new Error('no hay input montado');
  return input;
}

describe('pickTextFile', () => {
  it('abre el input oculto, lo monta en el body y espera a un clic', () => {
    void pickTextFile('application/json,.json');

    const input = onlyInput();
    expect(input.type).toBe('file');
    expect(input.accept).toBe('application/json,.json');
    expect(input.style.display).toBe('none');
    expect(input.clicks).toBe(1);
  });

  it('cancelar el diálogo resuelve null y saca el input del DOM (bug 1.1)', async () => {
    const promise = pickTextFile();

    const input = onlyInput();
    input.fire('cancel');

    await expect(promise).resolves.toBeNull();
    expect(input.removed).toBe(true);
    expect(children).toHaveLength(0);
    expect(input.listenerCount).toBe(0); /* sin listeners colgados tras cerrar */
  });

  it('un `change` sin fichero también resuelve null y elimina el input', async () => {
    const promise = pickTextFile();

    const input = onlyInput();
    input.files = [];
    input.fire('change');

    await expect(promise).resolves.toBeNull();
    expect(input.removed).toBe(true);
    expect(children).toHaveLength(0);
    expect(input.listenerCount).toBe(0);
  });

  it('un `change` con fichero resuelve el texto leído y no deja nada montado', async () => {
    const promise = pickTextFile();

    const input = onlyInput();
    input.files = [file];
    input.fire('change');

    expect(children).toHaveLength(0); /* el nodo sale al empezar a leer */
    expect(input.listenerCount).toBe(0);
    expect(readers).toHaveLength(1);

    const reader = readers[0];
    if (!reader) throw new Error('no se creó el FileReader');
    expect(reader.file).toBe(file);
    reader.result = '{"sesiones":[]}';
    reader.fire('load');

    await expect(promise).resolves.toBe('{"sesiones":[]}');
  });

  it('un error de lectura resuelve null (igual que antes del arreglo)', async () => {
    const promise = pickTextFile();

    const input = onlyInput();
    input.files = [file];
    input.fire('change');

    const reader = readers[0];
    if (!reader) throw new Error('no se creó el FileReader');
    reader.fire('error');

    await expect(promise).resolves.toBeNull();
  });

  it('el input no se acumula en el DOM entre llamadas', async () => {
    for (let i = 0; i < 3; i++) {
      const promise = pickTextFile();
      expect(children).toHaveLength(1);

      onlyInput().fire('cancel');
      await expect(promise).resolves.toBeNull();

      expect(children).toHaveLength(0);
    }
  });

  it('tras cancelar, el `change` tardío de ese mismo input ya no hace nada', async () => {
    const promise = pickTextFile();

    const input = onlyInput();
    input.fire('cancel');
    await expect(promise).resolves.toBeNull();

    /* la promesa ya está resuelta: el listener desenganchado no vuelve a correr */
    input.files = [file];
    input.fire('change');

    expect(readers).toHaveLength(0);
    expect(children).toHaveLength(0);
    await expect(promise).resolves.toBeNull();
  });
});
