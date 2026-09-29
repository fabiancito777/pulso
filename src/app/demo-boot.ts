/**
 * Arranque con `?demo=1` (el modo demo de la v1, `app.js:1261-1277`).
 *
 * La v1, al abrir con ese query param, marcaba el onboarding como visto,
 * planificaba la semana con el planificador local y apilaba `S.demoData(8)`,
 * avisando con un toast. Aquí se hacen las DOS primeras cosas que aportan —
 * sesiones de ejemplo y no molestar al onboarding — y solo **una vez**:
 *
 * - si ya hay sesiones (la demo ya se cargó, o son datos reales), no se toca
 *   nada: recargar `?demo=1` no duplica;
 * - el aviso va DESPUÉS del `render` de `main.tsx`, porque el host de los
 *   toasts vive en el DOM y en tests (Node) se descarta en silencio.
 *
 * La **planificación** de la v1 (`C.planWeek({ useAI: false })`) no se replica
 * aquí: en la v2 eso vive en Calendario («Auto-planificar», `localWeek`), que
 * es quien sabe previsualizar antes de escribir. Meterla en el arranque obligaría
 * a llamar a la lógica de `CalendarView` fuera de la vista.
 */
import { demoData, sessions, setMeta } from '@/state/store';

/** Semanas de ejemplo que cargaba la v1 (`S.demoData(8)`). */
const DEMO_WEEKS = 8;

/** ¿La query pide demo de verdad? Más estricto que el `/demo=1/` de la v1. */
export function isDemoQuery(search: string): boolean {
  return /(?:^|[?&])demo=1(?:&|$)/.test(String(search ?? ''));
}

let ran = false;

/**
 * Carga la demo si toca. Devuelve cuántas sesiones ha añadido (0 = nada que
 * hacer). Se llama una vez al arrancar (`main.tsx`); el guard de módulo y el de
 * «ya hay sesiones» la hacen idempotente aunque alguien la vuelva a llamar.
 */
export function runDemoBoot(search: string): number {
  if (ran || !isDemoQuery(search) || sessions.value.length > 0) return 0;
  ran = true;
  /* El onboarding no tiene que saltar sobre los datos de ejemplo (la v1 hacía
     `S.setMeta({ onboarded: true })` antes de cargarlas). */
  setMeta({ onboarded: true });
  return demoData(DEMO_WEEKS);
}
