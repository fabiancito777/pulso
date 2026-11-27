/**
 * Arranque con `?demo=1` (el modo demo, `app.js:1261-1277`).
 *
 * Antes, al abrir con ese query param, apilaba ocho semanas ficticias dentro del
 * historial. Ahora crea una muestra temporal y abre Progreso sin tocar el perfil:
 *
 * - los datos se generan en memoria y se muestran en Progreso, sin modificar
 *   el historial real;
 * - el aviso va DESPUÉS del `render` de `main.tsx`, porque el host de los
 *   toasts vive en el DOM y en tests (Node) se descarta en silencio.
 *
 * La **planificación**  (`C.planWeek({ useAI: false })`) no se replica
 * aquí: en la v2 eso vive en Calendario («Auto-planificar», `localWeek`), que
 * es quien sabe previsualizar antes de escribir. Meterla en el arranque obligaría
 * a llamar a la lógica de `CalendarView` fuera de la vista.
 */
import { demoData, demoMode } from '@/state/store';

/** Semanas de ejemplo que cargaba antes (`S.demoData(8)`). */
const DEMO_WEEKS = 8;

/** ¿La query pide demo de verdad? Más estricto que el `/demo=1/`. */
export function isDemoQuery(search: string): boolean {
  return /(?:^|[?&])demo=1(?:&|$)/.test(String(search ?? ''));
}

let ran = false;

/**
 * Crea la demo si toca. Devuelve cuántas sesiones temporales ha creado (0 = nada
 * que hacer). Se llama una vez al arrancar (`main.tsx`); los guardas la hacen
 * idempotente aunque alguien la vuelva a llamar.
 */
export function runDemoBoot(search: string): number {
  if (ran || !isDemoQuery(search) || demoMode.value) return 0;
  ran = true;
  return demoData(DEMO_WEEKS);
}
