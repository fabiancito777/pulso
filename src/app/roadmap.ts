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
    note: 'Ajustes, material, biblioteca, rutinas, calendario, sesiones, sesión activa y chat reactivos con signals, lectura tolerante y el mismo formato de la v1. Faltan los helpers del planificador local (pickForGroup, itemsFromRecipe) y los datos de demostración.',
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
    v2: 'src/domain/session.ts + rest.ts + src/state/session.ts + src/ui/SessionCard.tsx',
    state: 'portado',
    note: 'Se puede entrenar entero en la v2: series, arrastre del peso, descanso por timestamp con su recuadro pegajoso y aviso sonoro, y cerrar la sesión la guarda y marca el día. La notificación con el móvil bloqueado está en su bloque aparte (pendiente).',
  },
  {
    area: 'Analítica',
    v1: 'store.js (S.a)',
    v2: 'src/domain/analytics.ts + src/ui/ProgressCard.tsx',
    state: 'portado',
    note: '1RM (Epley), volumen, PRs, rachas, series semanales y sugerencia de peso, con las sesiones y los ejercicios por parámetro. Se lee el mismo pulso.state de la v1, así que los números se pueden contrastar con la pestaña Progreso.',
  },
  {
    area: 'Gráficos',
    v1: 'charts.js + views-stats.js',
    v2: 'src/ui/charts.tsx + charts-helpers.ts',
    state: 'portado',
    note: 'Bar/line/donut/hbars/heat/sparkline como componentes SVG con props puras y sin librerías; `ProgressCharts` monta la pestaña Progreso (rango, reparto por grupo, progresión por ejercicio, récords y consistencia). Adiós al montaje en dos pasos (spec → Ch.mountAll).',
  },
  {
    area: 'Coach IA',
    v1: 'coach.js + views-coach.js',
    v2: 'src/features/coach + src/state/coach + src/ui/CoachView.tsx',
    state: 'portado',
    note: 'Cliente de Gemini con la red separada (mockeable en tests), contexto, memoria e historial, chat en su pestaña y propuestas aplicables como rutina o plan semanal.',
  },
  {
    area: 'Planificador local',
    v1: 'coach.js (localSuggest / richItems)',
    v2: 'pendiente',
    state: 'pendiente',
    note: 'Propone ejercicios, series y pesos SIN IA ni API key (plan de respaldo que pinta el Calendario cuando Gemini falla). Necesita pickForGroup/itemsFromRecipe en el store.',
  },
  {
    area: 'Vistas y navegación',
    v1: 'views-*.js + app.js',
    v2: 'src/app/router.ts + src/ui/*View.tsx',
    state: 'portado',
    note: 'Las 7 pestañas son componentes con rutas por hash y el mismo esquema de enlaces de la v1: Rutinas, Calendario, Coach, Progreso y Ajustes montadas y con sus estilos propios. El contenido de Hoy va en su bloque.',
  },
  {
    area: 'Vista Hoy y extras de sesión',
    v1: 'views-train.js',
    v2: 'src/ui/SessionCard.tsx (parcial)',
    state: 'en curso',
    note: 'La sesión funciona, pero Hoy sigue enseñando el tablón de migración: falta el plan del día (franja semanal, KPIs, sugerencia y últimas sesiones) y en la sesión los discos por serie y «añadir rutina».',
  },
  {
    area: 'Editor de ejercicios en Ajustes',
    v1: 'views-settings.js + store.js (add/update/removeExercise)',
    v2: 'src/ui/SettingsView.tsx (parcial)',
    state: 'pendiente',
    note: 'Ajustes → Ejercicios solo permite o prohíbe ejercicios del catálogo; crear, editar y borrar los propios llega con el bloque de modales.',
  },
  {
    area: 'Avisos de descanso con el móvil bloqueado',
    v1: 'sw.js + app.js (swPost / schedule-rest)',
    v2: 'src/platform/sw.ts (postToSW sin cablear)',
    state: 'pendiente',
    note: 'Pitido y vibración ya funcionan; falta mandar `schedule-rest` al service worker desde el timer para que la notificación salga con la pantalla apagada.',
  },
  {
    area: 'PWA',
    v1: 'sw.js + manifest.webmanifest',
    v2: 'public/ + src/platform/sw.ts',
    state: 'portado',
    note: 'Manifest instalable con iconos, service worker network-first (shell offline sin congelar versiones) y registro desde main.tsx en producción. El aviso de descanso con el móvil bloqueado va en su bloque (pendiente).',
  },
];
