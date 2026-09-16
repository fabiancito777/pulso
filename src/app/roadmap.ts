/**
 * Estado de la migración v1 → v2, en un solo sitio y visible desde la app.
 * Sirve para saber qué se puede tocar ya con el stack nuevo y qué sigue
 * viviendo en `legacy/` sin tocar.
 */
export type PortState = 'portado' | 'en curso' | 'pendiente';

export interface RoadmapItem {
  area: string;
  v1: string;
  v2: string;
  state: PortState;
  note: string;
}

export const ROADMAP: readonly RoadmapItem[] = [
  {
    area: 'Utilidades base',
    v1: 'core.js (U.*)',
    v2: 'src/domain/{num,format,units,dates}.ts',
    state: 'portado',
    note: 'Sin DOM y sin estado: puro y con tests. Lo de pintar vive en componentes y Preact escapa solo (adiós U.esc).',
  },
  {
    area: 'Calculadora de discos',
    v1: 'trainer.js + ui.plates',
    v2: 'src/domain/plates.ts + src/ui/Plates.tsx',
    state: 'portado',
    note: 'El solver entra como parámetro (inventario, modo, mango) y se prueba entero con Vitest. El dibujo es un componente.',
  },
  {
    area: 'Ajustes y persistencia',
    v1: 'store.js',
    v2: 'src/state/store.ts',
    state: 'en curso',
    note: 'Ajustes, material y biblioteca reactivos con signals y lectura tolerante. Faltan rutinas, sesiones y calendario.',
  },
  {
    area: 'Biblioteca y material',
    v1: 'data.js',
    v2: 'src/domain/catalog.ts + data.ts + library.ts',
    state: 'portado',
    note: '136 ejercicios, 49 piezas de material, plantillas y presets, generados desde la v1 y verificados con comprobaciones de integridad.',
  },
  {
    area: 'Sesión activa y descanso',
    v1: 'trainer.js (T.*)',
    v2: 'src/features/session (pendiente)',
    state: 'pendiente',
    note: 'Aquí están las reglas delicadas (arrastre del peso, cuándo arranca el descanso, keep-alive). Se portan con tests antes de tocar la UI.',
  },
  {
    area: 'Analítica',
    v1: 'store.js (S.a)',
    v2: 'src/domain/analytics.ts (pendiente)',
    state: 'pendiente',
    note: '1RM, volumen, PRs, racha y series semanales: puro, así que se prueba sin navegador.',
  },
  {
    area: 'Gráficos',
    v1: 'charts.js',
    v2: 'src/ui/charts (pendiente)',
    state: 'pendiente',
    note: 'Bar/line/donut/hbars/heat pasan a componentes SVG; desaparece el montaje en dos pasos (spec → Ch.mountAll).',
  },
  {
    area: 'Coach IA',
    v1: 'coach.js',
    v2: 'src/features/coach (pendiente)',
    state: 'pendiente',
    note: 'Cliente de Gemini, contexto y parser tolerante. La capa de red se separa para poder simularla en tests.',
  },
  {
    area: 'Vistas y navegación',
    v1: 'views-*.js + app.js',
    v2: 'src/ui/tabs (pendiente)',
    state: 'pendiente',
    note: 'Las 7 pestañas pasan a componentes con rutas por hash. Se migran de una en una, empezando por Ajustes y Hoy.',
  },
  {
    area: 'PWA',
    v1: 'sw.js + manifest.webmanifest',
    v2: 'public/ + service worker (pendiente)',
    state: 'pendiente',
    note: 'Manifest, offline y notificación programada del descanso. Se hace al final, cuando la app esté entera en v2.',
  },
];
