/**
 * Historial del chat del coach: persistencia + su markdown mínimo.
 *
 * Es el port de `S.chat()` / `S.addChat` / `S.clearChat` de la v1
 * (`legacy/js/store.js`): mismo tope de **80 mensajes** y misma forma
 * (`{role, text, ts}` más `thoughts`/`notes`), guardados en `state.chat` dentro
 * de `localStorage['pulso.state']` a través del setter `setChat` de `store.ts`
 * (read-modify-write, como todos). La signal que repinta la vista vive aquí.
 *
 * Decisiones que conviene no olvidar:
 *
 * - **Dónde se guarda**: dentro de `pulso.state`, no en una clave propia: así
 *   «Borrar todo» y el export/import de Ajustes se llevan la conversación igual
 *   que en la v1. `reloadChat()` vuelve a leerla (montaje de la vista, import).
 * - **Markdown**: aquí en AST plano (`parseMd`/`mdInline`), no en HTML: la vista
 *   lo convierte en nodos de Preact y el texto del modelo queda escapado solo.
 *   Cubre lo que el coach usa de verdad (negritas, listas, código, títulos),
 *   sin librerías.
 */
import { signal } from '@preact/signals';

import type { ChatMsg } from '@/features/coach/client';

import { readState, setChat } from './store';

/** Botón que un aviso del sistema puede llevar (p. ej. ir a Ajustes → Coach AI). */
export interface ChatAction {
  label: string;
  tab: string;
  sub?: string;
}

/** Un mensaje del historial. `role` amplía el de la v1 con los avisos `sys`. */
export interface ChatLine {
  role: 'user' | 'model' | 'sys';
  text: string;
  /** ISO local (el mismo `ts` que ponía `U.d.nowTs()` en la v1) */
  ts?: string;
  /** razonamiento del modelo, si `includeThoughts` está activo */
  thoughts?: string;
  /** pie del mensaje: modelo · ms · tokens · memoria */
  notes?: string;
  /** JSON de `suggest`/`plan` ya parseado, para la tarjeta con «Aplicar» */
  payload?: unknown;
  /** ejercicios que el modelo pidió consultar (transparencia) */
  consulted?: string[];
  /** aviso de sistema con acción enlazable */
  action?: ChatAction;
}

/** Mensajes que se conservan (mismo tope que la v1). */
export const CHAT_LIMIT = 80;

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asAction(value: unknown): ChatAction | undefined {
  if (!isPlain(value)) return undefined;
  const label = asString(value.label);
  const tab = asString(value.tab);
  if (!label || !tab) return undefined;
  const sub = asString(value.sub);
  return sub ? { label, tab, sub } : { label, tab };
}

/**
 * Lee `state.chat` con tolerancia: lo que no tenga forma de mensaje (rol
 * desconocido, texto que no es string) se descarta en vez de romper la vista,
 * igual que la v1 hacía con el resto del estado al cargarlo.
 */
export function asChatLines(value: unknown): ChatLine[] {
  if (!Array.isArray(value)) return [];
  const out: ChatLine[] = [];
  for (const raw of value) {
    if (!isPlain(raw)) continue;
    const role = raw.role;
    if (role !== 'user' && role !== 'model' && role !== 'sys') continue;
    const text = asString(raw.text);
    if (!text) continue;
    const line: ChatLine = { role, text };
    if (typeof raw.ts === 'string' && raw.ts) line.ts = raw.ts;
    if (asString(raw.thoughts)) line.thoughts = asString(raw.thoughts);
    if (asString(raw.notes)) line.notes = asString(raw.notes);
    if (raw.payload !== undefined && raw.payload !== null) line.payload = raw.payload;
    if (Array.isArray(raw.consulted)) {
      const list = raw.consulted.filter((item): item is string => typeof item === 'string');
      if (list.length) line.consulted = list;
    }
    const action = asAction(raw.action);
    if (action) line.action = action;
    out.push(line);
  }
  return out;
}

/** Añade un mensaje recortando por el PRINCIPIO cuando se pasa del tope. */
export function appendLine(list: readonly ChatLine[], line: ChatLine): ChatLine[] {
  const next = [...list, line];
  return next.length > CHAT_LIMIT ? next.slice(-CHAT_LIMIT) : next;
}

function commit(list: ChatLine[]): void {
  chat.value = list;
  setChat(list);
}

/** Historial en memoria, reactivo: quien lea `.value` se repinta solo. */
export const chat = signal<ChatLine[]>(asChatLines(readState().chat));

/** Apila un mensaje y lo persiste (recortando a los últimos 80). */
export function addChat(line: ChatLine): void {
  commit(appendLine(chat.value, line));
}

/** Vacía la conversación (lo que hacía `S.clearChat`). */
export function clearChat(): void {
  commit([]);
}

/**
 * Vuelve a leer `state.chat` desde `localStorage`: hace falta después de un
 * import o de un «Borrar todo», que cambian el estado SIN pasar por aquí.
 */
export function reloadChat(): void {
  chat.value = asChatLines(readState().chat);
}

/**
 * Marca el mensaje `index` como ya aplicado (la tarjeta de `suggest`/`plan`
 * deja su botón en «Aplicada»). Si el payload no es un objeto, no hace nada.
 */
export function markApplied(index: number): void {
  const payload = isPlain(chat.value[index]?.payload) ? chat.value[index]?.payload : null;
  if (!payload) return;
  commit(
    chat.value.map((line, i) =>
      i === index ? { ...line, payload: { ...payload, done: true } } : line,
    ),
  );
}

/**
 * Historial que se pasa a `runCoachTask`: solo `user`/`model` (los avisos `sys`
 * no le conciernen al modelo) en el formato que espera `client.ChatMsg`.
 *
 * Se calcula ANTES de apilar el turno del usuario: `buildRequest` añade ese
 * turno por su cuenta y con él dentro saldría duplicado.
 */
export function promptHistory(list: readonly ChatLine[] = chat.value): ChatMsg[] {
  return list
    .filter(
      (line): line is ChatLine & { role: 'user' | 'model' } =>
        line.role === 'user' || line.role === 'model',
    )
    .map((line) => ({ role: line.role, text: line.text }));
}

/* ---------- markdown mínimo ---------- */

/** Trozo de línea: texto plano o un inline con formato. */
export type MdSpan = { kind: 'text'; text: string } | { kind: 'b' | 'i' | 'code'; text: string };

/** Bloque de mensaje: párrafo, título, lista o código cercillado. */
export type MdBlock =
  | { kind: 'p' | 'h'; spans: MdSpan[] }
  | { kind: 'ul' | 'ol'; items: MdSpan[][] }
  | { kind: 'code'; text: string };

/** `**negrita**`, `*cursiva*` y `` `código` `` (nada de HTML, nada de librerías). */
const INLINE_RE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g;

/** Divide una línea en spans con formato. El resto queda como texto normal. */
export function mdInline(text: string): MdSpan[] {
  const out: MdSpan[] = [];
  for (const part of String(text ?? '').split(INLINE_RE)) {
    if (!part) continue;
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
      out.push({ kind: 'b', text: part.slice(2, -2) });
    } else if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      out.push({ kind: 'code', text: part.slice(1, -1) });
    } else if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) {
      out.push({ kind: 'i', text: part.slice(1, -1) });
    } else {
      out.push({ kind: 'text', text: part });
    }
  }
  return out;
}

/**
 * Convierte el texto del modelo en bloques. Solo lo que el coach usa de verdad:
 * títulos `#`, viñetas `-`/`*`, listas numeradas `1.`, código ``` cercillado y
 * párrafos (las líneas seguidas se unen con `\n` y el CSS las respeta).
 */
export function parseMd(text: string): MdBlock[] {
  const lines = String(text ?? '').split(/\r?\n/);
  const out: MdBlock[] = [];
  let para: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let items: MdSpan[][] = [];

  const closePara = (): void => {
    if (!para.length) return;
    out.push({ kind: 'p', spans: mdInline(para.join('\n')) });
    para = [];
  };
  const closeList = (): void => {
    if (!list) return;
    out.push({ kind: list, items });
    list = null;
    items = [];
  };
  const closeAll = (): void => {
    closePara();
    closeList();
  };

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();

    /* bloque de código: lo que haya dentro va literal, sin más formato */
    if (/^```/.test(t)) {
      closeAll();
      const body: string[] = [];
      for (i++; i < lines.length && !/^```/.test(lines[i].trim()); i++) body.push(lines[i]);
      out.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    if (!t) {
      closeAll();
      continue;
    }

    const heading = /^#{1,4}\s+(.*)$/.exec(t);
    if (heading) {
      closeAll();
      out.push({ kind: 'h', spans: mdInline(heading[1]) });
      continue;
    }

    const ul = /^(?:[-*•]|\u2022)\s+(.*)$/.exec(t);
    if (ul) {
      closePara();
      if (list && list !== 'ul') closeList();
      list = 'ul';
      items.push(mdInline(ul[1]));
      continue;
    }

    const ol = /^\d+[.)]\s+(.*)$/.exec(t);
    if (ol) {
      closePara();
      if (list && list !== 'ol') closeList();
      list = 'ol';
      items.push(mdInline(ol[1]));
      continue;
    }

    closeList();
    para.push(t);
  }
  closeAll();
  return out;
}
