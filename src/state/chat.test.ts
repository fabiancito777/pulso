/**
 * `state/chat.ts`: historial persistente del chat del coach y su markdown.
 *
 * Se prueban con `localStorage` simulado (mismo patrón que `coach.test.ts` y
 * `store.test.ts`: `storageAvailable` se decide AL CARGAR el módulo, así que el
 * stub va antes del import dinámico) y con la señal limpia en cada test, porque
 * lo que hay que verificar aquí es la FORMA y la persistencia: tolerancia al
 * JSON guardado, tope de 80 mensajes, `state.chat` en `localStorage`, el
 * historial que se le pasa al modelo y el markdown que luego pinta la vista.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatLine } from './chat';

const mem = new Map<string, string>();

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

const chat = await import('./chat');
const store = await import('./store');

/** `state.chat` tal cual quedó escrito en localStorage. */
function storedChat(): unknown[] {
  const raw = localStorage.getItem('pulso.state');
  if (!raw) return [];
  const state = JSON.parse(raw) as { chat?: unknown };
  return Array.isArray(state.chat) ? state.chat : [];
}

beforeEach(() => {
  chat.clearChat();
  localStorage.clear();
});

/* ---------- forma del historial ---------- */

describe('asChatLines', () => {
  it('descarta lo que no tenga forma de mensaje y conserva los campos extra', () => {
    const lines = chat.asChatLines([
      { role: 'user', text: 'hola', ts: '2026-09-28T10:00:00.000Z' },
      { role: 'alien', text: 'no' },
      { role: 'model', text: '' },
      'texto suelto',
      null,
      {
        role: 'sys',
        text: 'aviso',
        thoughts: 'pienso',
        notes: '1,2 s',
        action: { label: 'Configurar', tab: 'ajustes', sub: 'coach' },
        consulted: ['Press de banca', 3],
      },
    ]);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ role: 'user', text: 'hola', ts: '2026-09-28T10:00:00.000Z' });
    expect(lines[1].thoughts).toBe('pienso');
    expect(lines[1].notes).toBe('1,2 s');
    expect(lines[1].action).toEqual({ label: 'Configurar', tab: 'ajustes', sub: 'coach' });
    expect(lines[1].consulted).toEqual(['Press de banca']);
  });

  it('es tolerante con un estado roto', () => {
    expect(chat.asChatLines('nada')).toEqual([]);
    expect(chat.asChatLines({})).toEqual([]);
    expect(chat.asChatLines([{ role: 'model' }, 42])).toEqual([]);
  });

  it('sin sub en la acción se queda en {label, tab}', () => {
    const lines = chat.asChatLines([
      { role: 'sys', text: 'x', action: { label: 'Ir', tab: 'ajustes' } },
    ]);
    expect(lines[0].action).toEqual({ label: 'Ir', tab: 'ajustes' });
  });
});

describe('appendLine', () => {
  it('recorta por el PRINCIPIO al pasar del tope de 80', () => {
    let list: ChatLine[] = [];
    for (let i = 0; i < 85; i++) list = chat.appendLine(list, { role: 'user', text: `m${i}` });

    expect(list).toHaveLength(chat.CHAT_LIMIT);
    expect(list[0].text).toBe('m5');
    expect(list[79].text).toBe('m84');
  });
});

/* ---------- persistencia ---------- */

describe('persistencia', () => {
  it('apila mensajes en la señal y en state.chat', () => {
    chat.addChat({ role: 'user', text: 'hola' });
    chat.addChat({ role: 'model', text: '¿Qué tal?' });

    expect(chat.chat.value.map((m) => m.role)).toEqual(['user', 'model']);
    expect(storedChat()).toHaveLength(2);
    expect((storedChat()[1] as { text: string }).text).toBe('¿Qué tal?');
  });

  it('clearChat vacía la señal y el estado', () => {
    chat.addChat({ role: 'user', text: 'hola' });
    chat.clearChat();

    expect(chat.chat.value).toEqual([]);
    expect(storedChat()).toEqual([]);
  });

  it('reloadChat vuelve a leer state.chat (import / «Borrar todo»)', () => {
    chat.addChat({ role: 'user', text: 'hola' });
    store.setChat([]); /* cambio externo: la señal no se entera sola */
    expect(chat.chat.value).toHaveLength(1);

    chat.reloadChat();
    expect(chat.chat.value).toEqual([]);
  });

  it('markApplied marca SOLO el mensaje indicado', () => {
    chat.addChat({ role: 'model', text: 'plan', payload: { title: 'X', days: [] } });
    chat.addChat({ role: 'model', text: 'otra', payload: { title: 'Y' } });

    chat.markApplied(0);
    expect(chat.chat.value[0].payload).toMatchObject({ title: 'X', done: true });
    expect(chat.chat.value[1].payload).toEqual({ title: 'Y' });
    expect((storedChat()[0] as { payload: { done?: boolean } }).payload.done).toBe(true);
  });

  it('markApplied ignora un payload que no es objeto', () => {
    chat.addChat({ role: 'model', text: 'x', payload: 'no' });
    chat.markApplied(0);
    expect(chat.chat.value[0].payload).toBe('no');
  });
});

/* ---------- lo que ve el modelo ---------- */

describe('promptHistory', () => {
  it('filtra los avisos sys y conserva orden y rol', () => {
    chat.addChat({ role: 'user', text: 'a' });
    chat.addChat({ role: 'sys', text: 'aviso' });
    chat.addChat({ role: 'model', text: 'b' });

    expect(chat.promptHistory()).toEqual([
      { role: 'user', text: 'a' },
      { role: 'model', text: 'b' },
    ]);
  });
});

/* ---------- markdown ---------- */

describe('mdInline', () => {
  it('separa negrita, cursiva y código sin tocar el resto', () => {
    expect(chat.mdInline('Haz **3 series** de `press` y *nada más*')).toEqual([
      { kind: 'text', text: 'Haz ' },
      { kind: 'b', text: '3 series' },
      { kind: 'text', text: ' de ' },
      { kind: 'code', text: 'press' },
      { kind: 'text', text: ' y ' },
      { kind: 'i', text: 'nada más' },
    ]);
  });

  it('un asterisco sin pareja o un `**` suelto es texto normal', () => {
    expect(chat.mdInline('2*3 = 6')).toEqual([{ kind: 'text', text: '2*3 = 6' }]);
    expect(chat.mdInline('y ** luego')).toEqual([{ kind: 'text', text: 'y ** luego' }]);
    expect(chat.mdInline('**')).toEqual([{ kind: 'text', text: '**' }]);
  });
});

describe('parseMd', () => {
  it('título, párrafo (líneas seguidas unidas) y lista', () => {
    const blocks = chat.parseMd(
      ['## Plan', '', 'Primera línea', 'segunda línea', '', '- uno', '- dos'].join('\n'),
    );

    expect(blocks).toEqual([
      { kind: 'h', spans: [{ kind: 'text', text: 'Plan' }] },
      { kind: 'p', spans: [{ kind: 'text', text: 'Primera línea\nsegunda línea' }] },
      {
        kind: 'ul',
        items: [[{ kind: 'text', text: 'uno' }], [{ kind: 'text', text: 'dos' }]],
      },
    ]);
  });

  it('cambia de lista cuando cambia el tipo', () => {
    const blocks = chat.parseMd('1. uno\n2. dos\n- viñeta');
    expect(blocks.map((b) => b.kind)).toEqual(['ol', 'ul']);
  });

  it('el código cercillado va literal, sin formato de lista ni de negrita', () => {
    const blocks = chat.parseMd('Antes\n```json\n{"a": 1}\n- no es lista\n```\nDespués');

    expect(blocks.map((b) => b.kind)).toEqual(['p', 'code', 'p']);
    const code = blocks[1];
    expect(code.kind === 'code' ? code.text : '').toBe('{"a": 1}\n- no es lista');
  });

  it('una lista numerada y una viñeta sin espacio no se cuelan', () => {
    expect(chat.parseMd('3.1 es un número').map((b) => b.kind)).toEqual(['p']);
    expect(chat.parseMd('*cursiva en mitad de una frase*').map((b) => b.kind)).toEqual(['p']);
  });
});
