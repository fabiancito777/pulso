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

import type { ChatLine, MdBlock } from './chat';

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

/* ---------- propuestas de ejercicios nuevos ---------- */

describe('creations', () => {
  it('lee las propuestas con tolerancia, como el payload', () => {
    const lines = chat.asChatLines([
      {
        role: 'model',
        text: 'mira este nuevo',
        creations: [
          { name: 'Remo Kroc a una mano', group: 'espalda', status: 'created' },
          { name: '' },
          { group: 'pecho' },
          'texto suelto',
          { name: 'Curl martillo', status: 'volando' },
        ],
      },
      { role: 'model', text: 'sin propuestas', creations: 'basura' },
    ]);

    expect(lines[0].creations).toEqual([
      { name: 'Remo Kroc a una mano', group: 'espalda', status: 'created' },
      { name: 'Curl martillo' },
    ]);
    expect(lines[1].creations).toBeUndefined();
  });

  it('markCreation cambia SOLO esa propuesta de SOLO esa línea y persiste', () => {
    chat.addChat({
      role: 'model',
      text: 'nuevo',
      creations: [{ name: 'A' }, { name: 'B' }],
    });
    chat.addChat({ role: 'model', text: 'otra', creations: [{ name: 'C' }] });

    chat.markCreation(0, 1, 'discarded');

    expect(chat.chat.value[0].creations?.[0]).toEqual({ name: 'A' });
    expect(chat.chat.value[0].creations?.[1]).toEqual({ name: 'B', status: 'discarded' });
    expect(chat.chat.value[1].creations).toEqual([{ name: 'C' }]);
    const stored = storedChat()[0] as { creations: { name: string; status?: string }[] };
    expect(stored.creations[1].status).toBe('discarded');
  });

  it('markCreation fuera de rango o sin propuestas no rompe nada', () => {
    chat.addChat({ role: 'model', text: 'sin' });
    chat.markCreation(0, 0, 'created');
    chat.markCreation(9, 0, 'created');
    expect(chat.chat.value[0].creations).toBeUndefined();
  });

  it('appendCreations añade las nuevas SIN repetir las que ya trae la línea', () => {
    chat.addChat({ role: 'model', text: 'plan', creations: [{ name: 'A', status: 'created' }] });

    chat.appendCreations(0, [{ name: 'B' }, { name: 'b' }, { name: 'C' }]);
    chat.appendCreations(0, [{ name: 'c' }]); /* ya está (misma forma): nada que añadir */
    chat.appendCreations(5, [{ name: 'Z' }]); /* línea inexistente */

    expect(chat.chat.value[0].creations).toEqual([
      { name: 'A', status: 'created' },
      { name: 'B' },
      { name: 'C' },
    ]);
    expect((storedChat()[0] as { creations: unknown[] }).creations).toHaveLength(3);
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

describe('mdInline · enlaces automáticos', () => {
  it('trocea la URL en un span `a` con su href, sin tocar lo que rodea', () => {
    expect(chat.mdInline('Ver https://pulso.app/ayuda y seguir')).toEqual([
      { kind: 'text', text: 'Ver ' },
      { kind: 'a', text: 'https://pulso.app/ayuda', href: 'https://pulso.app/ayuda' },
      { kind: 'text', text: ' y seguir' },
    ]);
  });

  it('una URL al principio de la línea también enlaza', () => {
    expect(chat.mdInline('https://x.es es la web')).toEqual([
      { kind: 'a', text: 'https://x.es', href: 'https://x.es' },
      { kind: 'text', text: ' es la web' },
    ]);
  });

  it('dentro de `código` se queda literal y dentro de negrita no enlaza', () => {
    expect(chat.mdInline('ver `https://x.es`')).toEqual([
      { kind: 'text', text: 'ver ' },
      { kind: 'code', text: 'https://x.es' },
    ]);
    expect(chat.mdInline('**https://x.es**')).toEqual([{ kind: 'b', text: 'https://x.es' }]);
  });

  it('sin URL no inventa enlaces', () => {
    expect(chat.mdInline('2+3 = 5 y http://es')).toEqual([
      { kind: 'text', text: '2+3 = 5 y ' },
      { kind: 'a', text: 'http://es', href: 'http://es' },
    ]);
    expect(chat.mdInline('nada de enlaces')).toEqual([{ kind: 'text', text: 'nada de enlaces' }]);
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

/* ---------- markdown · tablas ---------- */

/** La primera tabla del mensaje, o el test falla. */
function tableOf(blocks: MdBlock[]): Extract<MdBlock, { kind: 'table' }> {
  const found = blocks.find((b) => b.kind === 'table');
  if (!found || found.kind !== 'table') throw new Error('no hay tabla');
  return found;
}

describe('parseMd · tablas', () => {
  it('cabecera + separadora + filas, con el inline parseado EN las celdas', () => {
    const blocks = chat.parseMd(
      [
        '| Ejercicio | **Series** | Reps |',
        '| --- | ---: | :---: |',
        '| Press banca | 3 | 8 |',
        '| `sentadilla` | 4 | 6 |',
      ].join('\n'),
    );

    expect(blocks.map((b) => b.kind)).toEqual(['table']);
    const table = tableOf(blocks);
    expect(table.head).toEqual([
      [{ kind: 'text', text: 'Ejercicio' }],
      [{ kind: 'b', text: 'Series' }],
      [{ kind: 'text', text: 'Reps' }],
    ]);
    expect(table.rows).toEqual([
      [
        [{ kind: 'text', text: 'Press banca' }],
        [{ kind: 'text', text: '3' }],
        [{ kind: 'text', text: '8' }],
      ],
      [
        [{ kind: 'code', text: 'sentadilla' }],
        [{ kind: 'text', text: '4' }],
        [{ kind: 'text', text: '6' }],
      ],
    ]);
  });

  it('la cabecera NO se repite como primera fila (la v1 lo hacía)', () => {
    const table = tableOf(chat.parseMd('| a | b |\n| --- | --- |\n| 1 | 2 |'));
    expect(table.head).toHaveLength(2);
    expect(table.rows).toHaveLength(1);
    expect((table.rows[0][0] ?? [])[0]).toMatchObject({ text: '1' });
  });

  it('sin fila separadora se queda en párrafo, con las barras a la vista', () => {
    const blocks = chat.parseMd('| a | b |\n| 1 | 2 |');
    expect(blocks.map((b) => b.kind)).toEqual(['p']);
    const p = blocks[0];
    expect(p.kind === 'p' ? p.spans.map((s) => s.text).join('') : '').toBe('| a | b |\n| 1 | 2 |');
  });

  it('una separadora suelta se descarta (como en la v1) y no corta el párrafo', () => {
    expect(chat.parseMd('| --- | --- |').map((b) => b.kind)).toEqual([]);
    expect(chat.parseMd('una línea\n|---|---|\n').map((b) => b.kind)).toEqual(['p']);
  });

  it('la tabla se corta en la primera línea sin `|` y lo que viene va aparte', () => {
    const blocks = chat.parseMd('| a | b |\n| --- | --- |\n| 1 | 2 |\n\ndespués');

    expect(blocks.map((b) => b.kind)).toEqual(['table', 'p']);
    expect(tableOf(blocks).rows).toHaveLength(1);
  });

  it('una separadora de más dentro de la tabla la salta sin cortarla', () => {
    const table = tableOf(chat.parseMd('| a |\n| --- |\n| 1 |\n| --- |\n| 2 |'));
    expect(table.rows).toHaveLength(2);
  });

  it('la tabla cierra la lista que tenga encima y la de abajo empieza nueva', () => {
    const blocks = chat.parseMd('- uno\n| a |\n| --- |\n| 1 |\n- otra');

    expect(blocks.map((b) => b.kind)).toEqual(['ul', 'table', 'ul']);
    expect(blocks[2].kind === 'ul' ? blocks[2].items : []).toHaveLength(1);
  });

  it('una URL en una celda sale enlazada con su href', () => {
    const table = tableOf(chat.parseMd('| web |\n| --- |\n| https://pulso.app |'));
    const cell = table.rows[0]?.[0] ?? [];
    expect(cell).toEqual([{ kind: 'a', text: 'https://pulso.app', href: 'https://pulso.app' }]);
  });

  it('una línea con barras que NO empieza por `|` sigue siendo párrafo', () => {
    expect(chat.parseMd('serie A | serie B').map((b) => b.kind)).toEqual(['p']);
  });
});
