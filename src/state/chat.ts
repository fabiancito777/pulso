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
 *   Cubre lo que el coach usa de verdad (negritas, listas, código, títulos,
 *   tablas y enlaces automáticos), sin librerías.
 */
import { signal } from '@preact/signals';

import type { AIExerciseProposal } from '@/domain/ai-exercise';
import { norm } from '@/domain/text';
import type { ChatMsg } from '@/features/coach/client';
import { asProposal } from '@/features/coach/parse';

import { readState, setChat } from './store';

/** Botón que un aviso del sistema puede llevar (p. ej. ir a Ajustes → Coach AI). */
export interface ChatAction {
  label: string;
  tab: string;
  sub?: string;
}

/**
 * Ejercicio nuevo propuesto por el modelo con su estado de confirmación:
 * `undefined` = pendiente (la tarjeta con sus botones), `created`/`discarded` =
 * resuelta. Se persiste con la línea, así que «Descartar» sobrevive a F5.
 */
export interface CreationState extends AIExerciseProposal {
  status?: 'created' | 'discarded';
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
  /** ejercicios NUEVOS propuestos: tarjeta de confirmación en el chat */
  creations?: CreationState[];
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

/** Una propuesta guardada con tolerancia: sin `name` no es propuesta. */
function asCreation(value: unknown): CreationState | null {
  const proposal = asProposal(value);
  if (!proposal) return null;
  const status = isPlain(value) ? value.status : undefined;
  const out: CreationState = proposal;
  if (status === 'created' || status === 'discarded') out.status = status;
  return out;
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
    if (Array.isArray(raw.creations)) {
      const list = raw.creations
        .map(asCreation)
        .filter((item): item is CreationState => item !== null);
      if (list.length) line.creations = list;
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
 * Marca la propuesta `creation` de la línea `index` como creada o descartada
 * (el `status` se persiste, así que la tarjeta no vuelve a ofrecerse tras un
 * F5). Fuera de rango no hace nada.
 */
export function markCreation(
  index: number,
  creation: number,
  status: 'created' | 'discarded',
): void {
  const list = chat.value[index]?.creations;
  if (!list || !list[creation]) return;
  commit(
    chat.value.map((line, i) =>
      i === index
        ? {
            ...line,
            creations: list.map((item, j) => (j === creation ? { ...item, status } : item)),
          }
        : line,
    ),
  );
}

/**
 * Añade propuestas de ejercicio nuevo a la línea `index` SIN repetir las que ya
 * trae: es lo que hace «Aplicar» cuando unresolved trae nombres creables (el
 * usuario aplicó el plan ANTES de crear los ejercicios nuevos).
 */
export function appendCreations(index: number, proposals: readonly AIExerciseProposal[]): void {
  const line = chat.value[index];
  if (!line || !proposals.length) return;
  const current = line.creations ?? [];
  const taken = new Set(current.map((kept) => norm(kept.name)));
  const extra: AIExerciseProposal[] = [];
  for (const proposal of proposals) {
    const key = norm(proposal.name);
    if (taken.has(key)) continue; /* ya está en la línea (o repetido aquí mismo) */
    taken.add(key);
    extra.push(proposal);
  }
  if (!extra.length) return;
  commit(
    chat.value.map((item, i) =>
      i === index ? { ...item, creations: [...current, ...extra] } : item,
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

/** Trozo de línea: texto plano, un inline con formato o un enlace automático. */
export type MdSpan =
  | { kind: 'text'; text: string }
  | { kind: 'b' | 'i' | 'code'; text: string }
  /** URL detectada a pelo (el `<a target="_blank" rel="noopener">` de la v1) */
  | { kind: 'a'; text: string; href: string };

/** Fila de tabla: una celda por columna, ya con su inline parseado. */
export type MdRow = MdSpan[][];

/** Bloque de mensaje: párrafo, título, lista, tabla o código cercillado. */
export type MdBlock =
  | { kind: 'p' | 'h'; spans: MdSpan[] }
  | { kind: 'ul' | 'ol'; items: MdSpan[][] }
  | { kind: 'table'; head: MdRow; rows: MdRow[] }
  | { kind: 'code'; text: string };

/** `**negrita**`, `*cursiva*` y `` `código` `` (nada de HTML, nada de librerías). */
const INLINE_RE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g;

/** URL a secas, el mismo patrón que enlazaba `U.md` de la v1 (`core.js:551`). */
const URL_RE = /https?:\/\/[^\s<]+/g;

/**
 * Trocea texto plano en (texto · enlace · texto…): lo que hacía la v1 con un
 * `replace` sobre el HTML escrito, aquí como spans para que la vista pinte
 * `<a href target="_blank" rel="noopener">` sin innerHTML por medio.
 *
 * Solo se aplica a texto PLANO: una URL entre `` ` `` se queda literal (mejor
 * que en la v1, que enlazaba hasta dentro del código) y una entre `**` o `*`
 * se queda en negrita/cursiva sin enlazar, que es el precio de no rehacer el
 * formato inline por dentro.
 */
function linkify(text: string): MdSpan[] {
  const out: MdSpan[] = [];
  let from = 0;
  for (const hit of text.matchAll(URL_RE)) {
    const at = hit.index;
    if (at > from) out.push({ kind: 'text', text: text.slice(from, at) });
    out.push({ kind: 'a', text: hit[0], href: hit[0] });
    from = at + hit[0].length;
  }
  if (from < text.length) out.push({ kind: 'text', text: text.slice(from) });
  return out;
}

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
      out.push(...linkify(part));
    }
  }
  return out;
}

/**
 * Celdas de una línea de tabla (`| a | b |`), ya recortadas; `null` si la línea
 * no pinta nada de tabla. Misma condición que `U.md` de la v1 (`core.js:574`):
 * empieza por `|` y lleva otro `|` por detrás.
 */
function tableCells(line: string): string[] | null {
  if (!line.startsWith('|') || line.indexOf('|', 1) < 0) return null;
  return line
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** Fila separadora GFM (`| --- | :--: |`): misma regla tolerante de la v1. */
function isSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

/**
 * Convierte el texto del modelo en bloques. Solo lo que el coach usa de verdad:
 * títulos `#`, viñetas `-`/`*`, listas numeradas `1.`, código ``` cercillado,
 * tablas `| a | b |` con su fila separadora y párrafos (las líneas seguidas se
 * unen con `\n` y el CSS las respeta).
 *
 * Una tabla SOLO empieza si la línea de cabecera viene seguida de su fila
 * separadora (GFM): sin separadora la línea se queda como párrafo, y una
 * separadora suelta se descarta igual que en la v1 (`core.js:576`), así que
 * nunca se ve un `|---|` crudo. La tabla se cierra sola en cuanto aparece una
 * línea que no lleva `|`, y dentro de ella una separadora de más se salta sin
 * cortarla (también como la v1).
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

    /* tabla: cabecera + separadora en la misma línea de «qué es»; el resto de
       líneas con `|` son filas hasta que una no lo sea */
    const cells = tableCells(t);
    if (cells && isSeparator(cells)) {
      /* separadora suelta: la v1 la tiraba a la basura y aquí también */
      continue;
    }
    if (cells && isSeparator(tableCells((lines[i + 1] ?? '').trim()) ?? [])) {
      closeAll();
      const head: MdRow = cells.map((cell) => mdInline(cell));
      const rows: MdRow[] = [];
      i++; /* salta la fila separadora */
      for (i++; i < lines.length; i++) {
        const row = tableCells(lines[i].trim());
        if (!row) break;
        if (isSeparator(row)) continue; /* separadora de más: no corta la tabla */
        rows.push(row.map((cell) => mdInline(cell)));
      }
      out.push({ kind: 'table', head, rows });
      i--; /* el `i++` del bucle exterior vuelve a mirar ESTA línea */
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
