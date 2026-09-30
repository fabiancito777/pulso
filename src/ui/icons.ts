/* ==========================================================================
   Pulso v2 · icons.ts — catálogo de iconos (trazos SVG)

   ARCHIVO GENERADO: no lo edites a mano. Se produce desde la v1 con

       node tools/port-icons.mjs && npx prettier --write src/ui/icons.ts

   a partir de los `ico(...)` de `legacy/js/core.js`. El componente que los pinta
   (y que decide el tamaño y el color) es `src/ui/Icon.tsx`.
   ========================================================================== */

/** Un icono: sus trazos y, si la v1 los engordó, el grosor. */
export interface IconSpec {
  paths: string;
  /** grosor del trazo (por defecto 1.9, como en la v1) */
  sw?: number;
}

export const ICONS: Record<string, IconSpec> = {
  home: {
    paths:
      '<path d="M3 10.5 12 3l9 7.5V20a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 20Z"/><path d="M9.5 21.5V14h5v7.5"/>',
  },
  dumbbell: {
    paths:
      '<path d="M2.5 12h3M18.5 12h3M6 8.5v7M18 8.5v7M8.5 6.5v11M15.5 6.5v11M8.5 12h7"/><path d="M6 9.5h2.5M15.5 9.5H18M6 14.5h2.5M15.5 14.5H18"/>',
  },
  list: { paths: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>' },
  calendar: {
    paths: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  },
  chart: { paths: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>' },
  sparkles: {
    paths:
      '<path d="M12 3.5 13.6 8 18 9.6 13.6 11.2 12 15.7 10.4 11.2 6 9.6 10.4 8Z"/><path d="M18.5 15.5l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7Z"/>',
  },
  gear: {
    paths:
      '<circle cx="12" cy="12" r="3.4"/><circle cx="12" cy="12" r="7.6" stroke-dasharray="2.4 4.6"/><path d="M12 2.6v2.2M12 19.2v2.2M4.4 7.3l1.9 1.1M17.7 15.6l1.9 1.1M4.4 16.7l1.9-1.1M17.7 8.4l1.9-1.1"/>',
  },
  plus: { paths: '<path d="M12 5v14M5 12h14"/>', sw: 2.2 },
  minus: { paths: '<path d="M5 12h14"/>', sw: 2.2 },
  check: { paths: '<path d="M20 6 9 17l-5-5"/>', sw: 2.6 },
  x: { paths: '<path d="M18 6 6 18M6 6l12 12"/>', sw: 2.1 },
  trash: { paths: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>' },
  pencil: { paths: '<path d="M4 20h4L20 8l-4-4L4 16Z"/><path d="M14.5 5.5 18.5 9.5"/>' },
  play: { paths: '<path d="M7 4.5 19 12 7 19.5Z" fill="currentColor" stroke="none"/>' },
  pause: { paths: '<path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor" stroke="none"/>' },
  stop: {
    paths: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  },
  timer: { paths: '<circle cx="12" cy="13" r="8"/><path d="M12 9.5V13l2.5 2M9 2h6"/>' },
  plate: {
    paths:
      '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
  },
  search: { paths: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4.3-4.3"/>' },
  'chev-l': { paths: '<path d="M15 5 8 12l7 7"/>' },
  'chev-r': { paths: '<path d="m9 5 7 7-7 7"/>' },
  'chev-d': { paths: '<path d="m6 9 6 6 6-6"/>' },
  'chev-u': { paths: '<path d="m6 15 6-6 6 6"/>' },
  refresh: {
    paths:
      '<path d="M20 11A8 8 0 0 0 5.6 6.6L3 9M3 4v5h5M4 13a8 8 0 0 0 14.4 4.4L21 15M21 20v-5h-5"/>',
  },
  wand: { paths: '<path d="M15 4V2M15 10V8M12.5 6h-2M19.5 6h-2M4 20 14 10l1.5 1.5L5.5 21.5Z"/>' },
  download: {
    paths: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  },
  upload: {
    paths: '<path d="M12 15V3m0 0 4 4m-4-4L8 7M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  },
  alert: {
    paths:
      '<path d="M10.3 3.9 2.4 17.3A2 2 0 0 0 4.1 20h15.8a2 2 0 0 0 1.7-2.7L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4.5M12 17h.01"/>',
  },
  info: { paths: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>' },
  'check-circle': { paths: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>' },
  user: {
    paths: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5"/>',
  },
  key: {
    paths:
      '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8 2 2-1.5 1.5L21 9l-2 2-1.5-1.5L15 12"/>',
  },
  database: {
    paths:
      '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  },
  sliders: {
    paths:
      '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  },
  copy: {
    paths:
      '<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H5.5A2.5 2.5 0 0 0 3 5.5v7A2.5 2.5 0 0 0 5.5 15"/>',
  },
  filter: { paths: '<path d="M3 5h18l-7 8v6l-4-2v-4Z"/>' },
  clock: { paths: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>' },
  fire: {
    paths:
      '<path d="M12 2.5s4.5 4 4.5 8a4.5 4.5 0 0 1-9 0c0-1.1.4-2.1 1.1-3.2 0 1.7.9 2.7 1.8 2.7.9 0 1.6-.9 1.6-2.2 0-1.9-1-3.2 0-5.3Z"/><path d="M7 14c0 3.9 2.2 7.5 5 7.5s5-3.6 5-7.5c1.2 1.4 1.6 3 1.6 4.4 0 2.6-2.9 5.6-6.6 5.6S5.4 21.9 5.4 18.4c0-1.4.4-3 1.6-4.4Z" opacity=".5"/>',
  },
  target: {
    paths:
      '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  },
  zap: { paths: '<path d="M13 2 4 14h6l-1 8 9-12h-6Z"/>' },
  moon: { paths: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>' },
  eye: {
    paths:
      '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12S18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  },
  'eye-off': {
    paths:
      '<path d="M4 4l16 16M9.9 5.9A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.8M6.2 7.7A17 17 0 0 0 2.5 12S6 18.5 12 18.5c1 0 1.9-.2 2.7-.5"/><path d="M10 10.2a3 3 0 0 0 4.1 4.2"/>',
  },
  robot: {
    paths:
      '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4.5V8M9 3h6M8.5 13.5h.01M15.5 13.5h.01M9.5 17h5"/>',
  },
  cpu: {
    paths:
      '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M4 10h3M4 14h3M17 10h3M17 14h3M10 4v3M14 4v3M10 17v3M14 17v3"/>',
  },
  skip: { paths: '<path d="M5 5v14M19 5 8 12l11 7Z"/>' },
  tag: { paths: '<path d="M20.5 12.5 12 21l-8.5-8.5V4h8.5Z"/><path d="M7.5 7.5h.01"/>' },
  scale: { paths: '<path d="M12 4v16M7 20h10M5 8h14M5 8l-2.5 5h5ZM19 8l-2.5 5h5ZM8.5 4h7"/>' },
  infinity: {
    paths:
      '<path d="M6.5 9a3 3 0 0 0 0 6c2.5 0 3.5-3 5.5-3s3 3 5.5 3a3 3 0 0 0 0-6c-2.5 0-3.5 3-5.5 3s-3-3-5.5-3Z"/>',
  },
  power: { paths: '<path d="M12 3v8"/><path d="M6.5 6.5a8 8 0 1 0 11 0"/>' },
  bars: { paths: '<path d="M4 7h16M4 12h16M4 17h10"/>' },
  'bolt-circle': {
    paths: '<circle cx="12" cy="12" r="9"/><path d="m13 7-4.5 6.5H12L11 17l4.5-6.5H13Z"/>',
  },
  rest: {
    paths: '<path d="M4 17V8a4 4 0 0 1 8 0v9M4 13h8M12 17V8a4 4 0 0 1 8 0v9"/><path d="M4 21h16"/>',
  },
  lock: {
    paths:
      '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  },
};
