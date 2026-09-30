/** Texto y normalización. Portado de `U.norm`, `U.slug`, `U.similarity` y `U.trunc` de la v1. */

/** Solo los tipos que se pueden convertir a texto con sentido (evita "[object Object]"). */
function asText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

/** Minúsculas, sin acentos y sin signos: la base de las búsquedas y de los ids. */
export function norm(s: unknown): string {
  return asText(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** id legible a partir del nombre: "Extensión de cuádriceps" → "extension-de-cuadriceps". */
export function slug(s: unknown): string {
  return norm(s).replace(/\s+/g, '-');
}

/** Parecido entre dos textos (0-1). Lo usa la búsqueda de ejercicios y el coach. */
export function similarity(a: unknown, b: unknown): number {
  const A = norm(a);
  const B = norm(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  if (A.includes(B) || B.includes(A)) return 0.88;
  const ta = A.split(' ');
  const tb = B.split(' ');
  let hit = 0;
  for (const t of ta) if (t.length > 2 && tb.includes(t)) hit++;
  return hit / Math.max(ta.length, tb.length);
}

export function trunc(s: unknown, n: number): string {
  const str = asText(s);
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}
