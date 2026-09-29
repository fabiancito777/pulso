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
    v2: 'src/state/store.ts + src/domain/demo.ts',
    state: 'portado',
    note: 'Ajustes, material, biblioteca, rutinas, calendario, sesiones, sesión activa y chat reactivos con signals, lectura tolerante y el mismo formato de la v1, más los datos de ejemplo (8 semanas ficticias) y su borrado desde Ajustes → Datos.',
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
    note: 'Se puede entrenar entero en la v2: series, arrastre del peso, descanso por timestamp con su recuadro pegajoso y aviso sonoro, y cerrar la sesión la guarda y marca el día. La notificación con el móvil bloqueado está ya en su bloque aparte (portado).',
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
    note: 'Bar/line/donut/hbars/heat/sparkline como componentes SVG con props puras y sin librerías; `ProgressView` monta la pestaña Progreso (rango, KPIs, reparto por grupo, progresión por ejercicio, récords y consistencia). Adiós al montaje en dos pasos (spec → Ch.mountAll).',
  },
  {
    area: 'Progreso · historial y acciones',
    v1: 'views-stats.js (lista + ver todo) + app.js (sessionDetail)',
    v2: 'src/ui/ProgressView.tsx + SessionHistory/SessionDetailModal/PrTableModal/LastStimulus + progress-helpers.ts',
    state: 'portado',
    note: 'Cabecera con el sub de la v1, último estímulo por grupo dentro del reparto, tabla completa de récords (la fila selecciona el ejercicio en Progresión), historial de 40 con «Ver todo», detalle con ver/borrar/repetir y estado vacío con «Ir a entrenar» y datos de ejemplo. Editar una sesión queda fuera de spec (la v1 no lo hacía).',
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
    v1: 'coach.js (localSuggest / localWeek / richItems)',
    v2: 'src/domain/plan.ts + src/features/coach/local.ts',
    state: 'portado',
    note: 'Plantillas, recetas, rotación semanal y pesos SIN IA ni API key, todo por parámetro y con tests. Sin key (o con auth/red/cuota caídas) `runCoachTask` resuelve suggest/plan aquí mismo y deja el JSON en `payload` para «Aplicar».',
  },
  {
    area: 'Vistas y navegación',
    v1: 'views-*.js + app.js',
    v2: 'src/app/router.ts + src/ui/*View.tsx',
    state: 'portado',
    note: 'Las 7 pestañas son componentes con rutas por hash y el mismo esquema de enlaces de la v1, y las 7 están montadas (`ported: true` en `router.ts`): Rutinas, Calendario, Coach, Progreso y Ajustes con sus estilos propios; Hoy vive en su bloque (HoyView) y Entrenar en los suyos (SessionCard global + PlatesCard).',
  },
  {
    area: 'Vista Hoy y extras de sesión',
    v1: 'views-train.js',
    v2: 'src/ui/HoyView.tsx + hoy-helpers.ts + SessionCard.tsx + {Plates,RoutinePicker,ExercisePicker}Modal.tsx',
    state: 'portado',
    note: 'La pestaña Hoy está completa: saludo y racha en la barra, plan del día con las tres caras del hero, franja semanal, KPIs de 7 días, sugerencia local/IA con aviso si no hay key, temporizador libre, Libre/Elegir rutina y últimas sesiones con repetición y detalle en línea. Los extras de sesión están cableados en `SessionCard`: discos por serie («discos» → `PlatesModal` → `plateTarget`/`applyPlateWeight`), «Añadir rutina» (`RoutinePickerModal` → `entriesFromRoutine`, y `RoutinesView` ya no se niega con sesión en curso), picker multi de ejercicios (`ExercisePickerModal`, excluye los ya presentes y cuenta los seleccionados), descanso editable por ejercicio (el hint se convierte en input → `setEntryRest`) y scroll con marca de «nuevo» al añadir (`justAdded`).',
  },
  {
    area: 'Editor de ejercicios en Ajustes',
    v1: 'views-settings.js + store.js (add/update/removeExercise)',
    v2: 'src/ui/SettingsView.tsx + src/domain/exercise-draft.ts',
    state: 'portado',
    note: 'Ajustes → Ejercicios crea, edita y borra los PROPIOS (modal con validación e id estable en el dominio, probado con Vitest); el catálogo solo se permite o se prohíbe, porque `mergeSeed` restauraría cualquier edición al recargar.',
  },
  {
    area: 'Avisos de descanso con el móvil bloqueado',
    v1: 'sw.js + app.js (swPost / schedule-rest)',
    v2: 'src/state/session.ts + src/platform/{notify,keepAlive}.ts',
    state: 'portado',
    note: 'Tres capas, como en la v1: pitido/vibración, keep-alive de audio + wake lock mientras hay sesión («Entrenamiento» o «Descanso · …») y `schedule-rest`/`cancel-rest`/`notify` al service worker, que es la única que sobrevive con la pantalla apagada. Si el SW no coge el mensaje (sin controlador), se notifica desde la página.',
  },
  {
    area: 'PWA',
    v1: 'sw.js + manifest.webmanifest',
    v2: 'public/ + src/platform/sw.ts',
    state: 'portado',
    note: 'Manifest instalable con iconos, service worker network-first (shell offline sin congelar versiones) y registro desde main.tsx en producción. El aviso de descanso con el móvil bloqueado va en su bloque (portado).',
  },
  {
    area: 'Onboarding, instalación y arranque',
    v1: 'app.js (onboarding / pwa:install / errores globales) + views-settings.js (Datos) + store.js (aviso de escritura)',
    v2: 'src/ui/Onboarding.tsx + src/state/onboarding.ts + src/platform/install.ts',
    state: 'portado',
    note: 'Modal de primera visita que marca meta.onboarded (los dos caminos), fila «Instalar» en Ajustes → Datos con el modal de instrucciones manuales, «Acerca de» con la versión, aviso único de fallo de escritura, reloj de sesión en la barra y errores globales con toast. Banner de instalación en Hoy: decidido no (paridad con la v1).',
  },
];
