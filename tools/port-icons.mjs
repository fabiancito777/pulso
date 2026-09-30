/**
 * Genera `src/ui/icons.ts` a partir de los `ico(...)` de `legacy/js/core.js` (la v1).
 *
 * Mismo motivo que en `port-catalog.mjs`: son ~60 iconos con sus trazos SVG y
 * copiarlos a mano acaba en un path cortado o un nombre cambiado justo donde no se
 * nota (el icono se pinta igual de bien, pero distinto). Generado, si la v1 añade un
 * icono basta con volver a lanzar
 *
 *     node tools/port-icons.mjs && npx prettier --write src/ui/icons.ts
 *
 * El SVG se arma en `src/ui/Icon.tsx`, con la misma envoltura que `ico()` en la v1
 * (`viewBox` 24, `stroke: currentColor`, esquinas redondeadas).
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'legacy/js/core.js';
const OUT = 'src/ui/icons.ts';

const text = readFileSync(SRC, 'utf8');

/* ico('nombre', '<path …/>', { sw: 2.2 })  ·  el tercer argumento es opcional */
const CALL = /^\s{2}ico\('([a-z0-9-]+)',\s*'([^']*)'(?:,\s*(\{[^}]*\}))?\);/gm;

const icons = [];
for (const match of text.matchAll(CALL)) {
  const [, name, paths, opts] = match;
  icons.push({ name, paths, opts: opts ?? '' });
}

if (icons.length < 40) {
  throw new Error(`solo he encontrado ${icons.length} iconos: ¿ha cambiado core.js de formato?`);
}

const rows = icons.map(({ name, paths, opts }) => {
  const spec = [`paths: '${paths}'`];
  if (/sw:\s*[\d.]+/.test(opts)) spec.push(`sw: ${/sw:\s*([\d.]+)/.exec(opts)[1]}`);
  return `  '${name}': { ${spec.join(', ')} },`;
});

const out = [
  '/* ==========================================================================',
  '   Pulso v2 · icons.ts — catálogo de iconos (trazos SVG)',
  '',
  '   ARCHIVO GENERADO: no lo edites a mano. Se produce desde la v1 con',
  '',
  '       node tools/port-icons.mjs && npx prettier --write src/ui/icons.ts',
  '',
  '   a partir de los `ico(...)` de `legacy/js/core.js`. El componente que los pinta',
  '   (y que decide el tamaño y el color) es `src/ui/Icon.tsx`.',
  '   ========================================================================== */',
  '',
  '/** Un icono: sus trazos y, si la v1 los engordó, el grosor. */',
  'export interface IconSpec {',
  '  paths: string;',
  '  /** grosor del trazo (por defecto 1.9, como en la v1) */',
  '  sw?: number;',
  '}',
  '',
  'export const ICONS: Record<string, IconSpec> = {',
  ...rows,
  '};',
  '',
];

writeFileSync(OUT, out.join('\n'), 'utf8');
console.log(`✓ ${OUT} generado desde ${SRC} (${icons.length} iconos)`);
