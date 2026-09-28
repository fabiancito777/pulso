/**
 * Parseo tolerante de la respuesta del modelo. Portado de `C.parseJSON` de la
 * v1 (`legacy/js/coach.js`), con un añadido que arregla el fallo real del
 * smoke test: el modelo NO devuelve JSON pelado, devuelve el JSON y DESPUÉS un
 * bloque ```memoria``` (u otra prosa con llaves). La v1 "quitaba la cercilla"
 * con un regex de CUALQUIER fence, así que se quedaba con el interior de la
 * ```memoria``` (viñetas sin llaves) y terminaba en `no pude interpretar el
 * JSON` aunque el JSON del principio estuviera perfecto.
 *
 * El modelo se salta instrucciones con frecuencia: envuelve el JSON en una
 * cercilla ```json, le pone prosa por delante o por detrás o deja una coma
 * final. En vez de reintentar la petición (caro y lento), se recorta el trozo
 * que parece JSON — balanceando desde el PRIMER carácter que abre — y se
 * reintenta una vez.
 */

/**
 * Extrae TODOS los bloques cercillados ```` ```tag … ``` ```` del texto y
 * devuelve lo que queda fuera (`rest`, sin ellos) junto con sus contenidos.
 *
 * Es la base de `extractMemoryBlock` (memoria) y del bloque ```consulta``` que
 * el modelo puede emitir para pedir historial: a veces vienen varios y a veces
 * rodeados de prosa, así que se barre el texto entero de una pasada.
 * `tag` se escapa, sirve para cualquier etiqueta, y el fence de apertura admite
 * lo que el modelo pega tras la etiqueta (```memoria otra vez```).
 */
export function extractBlocks(text: string, tag: string): { rest: string; blocks: string[] } {
  const raw = String(text ?? '');
  const safe = String(tag ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!safe) return { rest: raw, blocks: [] };

  const fence = new RegExp('```' + safe + '(?=\\s|$)[^\\n]*\\n?([\\s\\S]*?)```', 'gi');
  const blocks: string[] = [];
  let rest = '';
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(raw)) !== null) {
    blocks.push(String(match[1] ?? '').trim());
    rest += raw.slice(cursor, match.index);
    cursor = match.index + match[0].length;
  }
  rest += raw.slice(cursor);
  return { rest, blocks };
}

/**
 * Quita la PRIMERA cercilla ```` ```tag … ``` ```` del texto y devuelve lo de
 * dentro (si no hay cercilla, devuelve el texto tal cual).
 *
 * Cuidado: con `{"a":1}\n```memoria\n- duerme 8 h\n``` ` devuelve las VIÑETAS,
 * así que `parseJSON` solo lo usa como segunda oportunidad, después de mirar
 * el texto tal cual.
 */
function unfence(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? String(fenced[1] ?? '').trim() : raw;
}

/** Máximo de posiciones de llave/corchete que se intentan (texto de modelo, no un parser de archivos). */
const MAX_CANDIDATES = 64;

/**
 * Subcadena balanceada que empieza EXACTAMENTE en `start`, respetando cadenas
 * y escapes: `{"a":"x}y"}` no se corta en la `}` de dentro de la comilla.
 *
 * Devuelve `null` si la estructura queda abierta o si un cierre sobra (JSON
 * truncado). Es el corazón del rescate: no se usa el ÚLTIMO `}` del texto,
 * porque la prosa de después puede traer sus propias llaves.
 */
function balancedSlice(text: string, start: number): string | null {
  const first = text[start];
  if (first !== '{' && first !== '[') return null;
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') {
      const open = stack.pop();
      if (!open) return null; /* cierra de más: basura de fuera */
      const expected = open === '{' ? '}' : ']';
      if (ch !== expected) return null; /* desbalanceado */
      if (!stack.length) return text.slice(start, i + 1);
    }
  }
  return null; /* queda abierto: JSON truncado */
}

/**
 * Primer trozo del texto que es JSON válido: barre las posiciones de `{`/`[`
 * que están a PROFUNDIDAD CERO (así un JSON truncado no devuelve un trozo de
 * su interior) y balancea desde cada una. El primero que parsea se queda.
 *
 * Así el JSON válido seguido de prosa — con un `}` suelto, con otra llave o
 * con una cercilla ```memoria``` posterior, que es como FALLABA de verdad el
 * smoke test — se recorta desde el principio, no desde el último `}` del texto.
 * La coma final de la v1 se limpia igual.
 */
function scanJSON(text: string): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let tried = 0;
  for (let i = 0; i < text.length && tried < MAX_CANDIDATES; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') {
      if (depth === 0) {
        tried++;
        const slice = balancedSlice(text, i);
        if (slice) {
          const cleaned = slice.replace(/,\s*([}\]])/g, '$1');
          try {
            JSON.parse(cleaned);
            return cleaned;
          } catch {
            /* quizá la siguiente llave sí sea el JSON bueno */
          }
        }
      }
      depth++;
    } else if (ch === '}' || ch === ']') {
      if (depth > 0) depth--;
    }
  }
  return null;
}

/**
 * Interpreta la respuesta de un modelo como JSON.
 *
 * Orden: trim → quita la cercilla → `JSON.parse` directo → si falla, recorte
 * por BALANCEO desde el primer carácter que abre (o desde la siguiente llave
 * si hay prosa por delante), probando también el texto SIN cercillar (una
 * prosa posterior que traiga ``` no debe hacer perder el JSON del principio) →
 * si aún así falla, el recorte clásico de la v1 (primer `{` → último `}`) →
 * `Error('no pude interpretar el JSON')`.
 */
export function parseJSON<T>(raw: string): T {
  const trimmed = String(raw ?? '').trim();
  /* El texto tal cual va PRIMERO (si empieza por JSON manda el de fuera, no el
     de una cercilla posterior); la cercilla entra como segunda oportunidad
     cuando `unfence` devuelve algo distinto del original. */
  const unfenced = unfence(trimmed);
  const candidates = unfenced === trimmed ? [trimmed] : [trimmed, unfenced];

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      /* sigue: probamos balanceando */
    }
    const scanned = scanJSON(candidate);
    if (!scanned) continue;
    try {
      return JSON.parse(scanned) as T;
    } catch {
      /* sigue: el otro candidato */
    }
  }

  /* último recurso (la v1): del primer { al último } del texto */
  for (const candidate of candidates) {
    for (const [open, close] of [
      ['{', '}'],
      ['[', ']'],
    ] as const) {
      const start = candidate.indexOf(open);
      const end = candidate.lastIndexOf(close);
      if (start < 0 || end <= start) continue;
      const slice = candidate.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1');
      try {
        return JSON.parse(slice) as T;
      } catch {
        /* sigue: quizá sea el otro delimitador */
      }
    }
  }

  throw new Error('no pude interpretar el JSON');
}
