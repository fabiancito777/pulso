/**
 * La memoria editable del coach.
 *
 * Es markdown persistido en `settings.ai.memory` con cinco encabezados. El
 * modelo la recibe tal cual dentro del contexto y puede DEVOLVER aprendizajes
 * nuevos en un bloque ```` ```memoria ```` al final de su respuesta; la app los
 * vuelca aquí con `extractMemoryBlock` + `applyMemoryEntries`.
 *
 * Reglas que no se pueden romper:
 *
 * - solo se añaden líneas nuevas bajo `## Patrones aprendidos`, sin duplicar
 *   (la comparación normaliza mayúsculas y espacios);
 * - lo que el usuario haya escrito a mano en cualquier otro encabezado no se
 *   toca jamás;
 * - por encima de `MEMORY_LIMIT` caracteres se recortan las entradas de
 *   patrones MÁS ANTIGUAS (se van apilando en orden), conservando los
 *   encabezados. Si aun así no cabe, se queda como está: mejor memoria larga
 *   que perder texto del usuario.
 */

/** Caracteres máximos de la memoria. */
export const MEMORY_LIMIT = 4000;

/** Encabezado donde van los aprendizajes del modelo. */
export const MEMORY_PATTERNS = '## Patrones aprendidos';

/** Los cinco encabezados de la plantilla, en orden. */
export const MEMORY_HEADINGS: readonly string[] = [
  '## Perfil',
  '## Preferencias',
  '## Qué le funciona',
  '## Qué falla',
  MEMORY_PATTERNS,
];

import { extractBlocks } from './parse';
import type { MemorySeed, MemoryUpdate } from './types';

/**
 * El cierre ```` ```memoria … ``` ```` con SOLO espacio en blanco detrás: el
 * bloque cuenta únicamente si cierra la respuesta (regla de la v1 que sigue
 * vigente para no confundir un ejemplo con un aprendizaje).
 */
const MEMORY_CLOSE = /```memoria[^\n]*\n?[\s\S]*?```([\s\S]*)$/i;

const bullet = (line: string): string => (/^[-*]\s/.test(line) ? line : `- ${line}`);

/**
 * Línea de viñeta a clave de deduplicación: se quita el guion y se normalizan
 * mayúsculas y espacios, así `- Prefiere  PRESS` y `- prefiere press` son lo mismo.
 */
const normalize = (line: string): string =>
  line
    .replace(/^[-*]\s+/, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Plantilla vacía (o sembrada) de la memoria. `seed` recibe las líneas SIN el
 * `- ` inicial: se lo pone la función.
 */
export function defaultMemory(seed: MemorySeed = {}): string {
  const section = (title: string, items?: string[]): string =>
    [title, ...(items ?? []).map(bullet)].join('\n');
  return [
    section('## Perfil', seed.profile),
    section('## Preferencias', seed.preferences),
    section('## Qué le funciona', seed.works),
    section('## Qué falla', seed.fails),
    section(MEMORY_PATTERNS, seed.patterns),
  ].join('\n\n');
}

/**
 * Separa el bloque ```` ```memoria … ``` ```` si cierra el texto del modelo.
 * Devuelve el texto SIN ese bloque (`rest`) y su contenido (`block`, o `null`
 * si no hay bloque o viene vacío).
 *
 * Va sobre `extractBlocks` cuando la extracción sale LIMPIA: exactamente un
 * bloque y nada más allá de su cierre. Si el bloque viene en mitad del texto,
 * acompañado de otro o no cierra la respuesta, no se arranca (misma regla que
 * la v1, fijada en `memory.test.ts`).
 */
export function extractMemoryBlock(text: string): { rest: string; block: string | null } {
  const raw = String(text ?? '');
  const { rest, blocks } = extractBlocks(raw, 'memoria');
  if (blocks.length !== 1) return { rest: raw, block: null };

  const close = MEMORY_CLOSE.exec(raw);
  if (!close || close[1].trim()) return { rest: raw, block: null };

  const block = blocks[0].trim();
  return { rest: rest.replace(/\s+$/, ''), block: block || null };
}

/** Las líneas `- …` de un bloque de memoria, tal cual (con su viñeta). */
function entriesOf(block: string): string[] {
  return String(block ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+\S/.test(line));
}

interface Patterns {
  /** líneas antes del encabezado (otros encabezados, intactos) */
  head: string[];
  items: string[];
  /** líneas a partir del siguiente encabezado (o el final) */
  tail: string[];
}

/** Localiza `## Patrones aprendidos`; null si la memoria no lo tiene. */
function splitPatterns(lines: string[]): Patterns | null {
  const idx = lines.findIndex(
    (line) => line.trim().toLowerCase() === MEMORY_PATTERNS.toLowerCase(),
  );
  if (idx < 0) return null;
  let end = lines.length;
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^##\s+\S/.test(lines[i].trim())) {
      end = i;
      break;
    }
  }
  return {
    head: lines.slice(0, idx),
    items: lines
      .slice(idx + 1, end)
      .map((line) => line.trim())
      .filter((line) => /^[-*]\s+\S/.test(line)),
    tail: lines.slice(end),
  };
}

/** Vuelve a montar la memoria con los encabezados normalizados a un salto de línea. */
function joinPatterns(parts: Patterns): string {
  const blocks = [parts.head.join('\n').trim(), [MEMORY_PATTERNS, ...parts.items].join('\n')];
  const tail = parts.tail.join('\n').trim();
  if (tail) blocks.push(tail);
  return blocks.filter(Boolean).join('\n\n');
}

/** Quita las entradas de patrones más antiguas hasta entrar en el límite. */
function trimToLimit(memory: string): string {
  let current = memory;
  while (current.length > MEMORY_LIMIT) {
    const parts = splitPatterns(current.split('\n'));
    if (!parts || !parts.items.length) break;
    parts.items.shift();
    current = joinPatterns(parts);
  }
  return current;
}

/**
 * Vuelca en la memoria las entradas nuevas de `block` (líneas `- …`).
 *
 * Devuelve la memoria resultante y las entradas que se añadieron de verdad
 * (las que ya estaban, por mucho que cambien mayúsculas o espacios, no vuelven
 * a entrar). `current` vacío arranca desde `defaultMemory()`.
 */
export function applyMemoryEntries(current: string, block: string): MemoryUpdate {
  const entries = entriesOf(block);
  const base = String(current ?? '').trim() ? String(current) : defaultMemory();
  if (!entries.length) return { memory: base, added: [] };

  const parts = splitPatterns(base.split('\n')) ?? { head: base.split('\n'), items: [], tail: [] };
  const seen = new Set(parts.items.map(normalize));
  const added: string[] = [];
  for (const entry of entries) {
    const key = normalize(entry);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    parts.items.push(entry);
    added.push(entry);
  }

  return { memory: trimToLimit(joinPatterns(parts)), added };
}
