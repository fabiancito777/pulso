/**
 * Helpers puros de la vista Calendario: estado de un día, cuadrícula mensual,
 * resumen de la semana y normalización del plan del coach IA.
 *
 * Están aparte del componente para poder probarlos con Vitest sin DOM ni
 * `localStorage`: aquí solo entran datos por parámetro y salen datos (el único
 * import con efectos es `parseJSON`, que también es puro).
 */
import { parseJSON } from '@/features/coach/parse';
import type { ScheduleDay } from '@/state/store';

/** Tipos de día que entiende el calendario (los mismos que `DAY_KEYS` de `state/coach`). */
export const DAY_TYPES = ['entreno', 'cardio', 'movilidad', 'descanso'] as const;

export type DayType = (typeof DAY_TYPES)[number];

/** Etiqueta visible de cada tipo de día. */
export const DAY_TYPE_LABEL: Record<DayType, string> = {
  entreno: 'Entreno',
  cardio: 'Cardio',
  movilidad: 'Movilidad',
  descanso: 'Descanso',
};

/** Estados que se pueden marcar en un día (el mismo cuarteto del día de la v1). */
export const DAY_STATUSES = ['planned', 'done', 'rest', 'skipped'] as const;

export type DayStatus = (typeof DAY_STATUSES)[number];

export const DAY_STATUS_LABEL: Record<DayStatus, string> = {
  planned: 'Planificado',
  done: 'Hecho',
  rest: 'Descanso',
  skipped: 'Saltado',
};

/**
 * Estado visual resuelto de un día: los cuatro anteriores más `free` (día sin
 * nada planificado), que es el que dispara el estado vacío de la semana.
 */
export type DayState = DayStatus | 'free';

export const DAY_STATE_LABEL: Record<DayState, string> = {
  ...DAY_STATUS_LABEL,
  free: 'Libre',
};

/**
 * Estado de un día: una sesión real manda sobre lo que diga el plan (así un día
 * que entrenaste en `main` se ve hecho aunque aquí no estuviera planificado),
 * igual que `dayCard` de `legacy/js/views-calendar.js`.
 *
 * `sessionCount` entra por parámetro: el helper no lee el estado.
 */
export function dayState(day: ScheduleDay | null | undefined, sessionCount: number): DayState {
  if (sessionCount > 0) return 'done';
  const status = typeof day?.status === 'string' ? day.status : '';
  if (status === 'done') return 'done';
  if (status === 'rest' || day?.type === 'descanso') return 'rest';
  if (status === 'skipped') return 'skipped';
  if (status === 'planned' || day?.routineId || day?.type) return 'planned';
  return 'free';
}

/** Tipo del día si es uno de los válidos; `''` si no hay o es raro (JSON heredado). */
export function dayType(day: ScheduleDay | null | undefined): DayType | '' {
  const raw = typeof day?.type === 'string' ? day.type : '';
  return (DAY_TYPES as readonly string[]).includes(raw) ? (raw as DayType) : '';
}

/**
 * Qué se muestra como título del día. Mismo orden que la v1: el `title` escrito
 * en el plan (que un plan de la IA trae más legible), luego el nombre VIVO de la
 * rutina y por último el "Descanso" del día de descanso.
 */
export function dayTitle(day: ScheduleDay | null | undefined, routineName: string): string {
  const title = typeof day?.title === 'string' ? day.title.trim() : '';
  if (title) return title;
  if (routineName.trim()) return routineName.trim();
  return dayType(day) === 'descanso' ? 'Descanso' : '';
}

/** Etiqueta del tipo de día para la UI, resolviendo lo que el plan no escribió. */
export function dayTypeLabel(day: ScheduleDay | null | undefined, state: DayState): string {
  const type = dayType(day);
  if (type) return DAY_TYPE_LABEL[type];
  if (state === 'free') return 'Libre';
  if (state === 'rest') return 'Descanso';
  if (state === 'done') return 'Sesión';
  return typeof day?.routineId === 'string' && day.routineId ? 'Entreno' : 'Sin tipo';
}

/**
 * Contador de la semana: `planned` incluye los hechos (son días que sí había
 * planificados), `done` solo los completados. Es el "done/planned completados"
 * del subtítulo de la v1.
 */
export function weekCounts(states: readonly DayState[]): { done: number; planned: number } {
  let done = 0;
  let planned = 0;
  for (const state of states) {
    if (state === 'done') {
      done++;
      planned++;
    } else if (state === 'planned') {
      planned++;
    }
  }
  return { done, planned };
}

/**
 * Días (ISO locales) de un mes, a partir de cualquier fecha de ese mes o del
 * propio `YYYY-MM`. Se calcula por longitud de mes con string, como la v1:
 * aquí NO cabe `toISOString()` (desplazaría el día según la zona horaria).
 */
export function monthDays(month: string): string[] {
  const first = `${month.slice(0, 7)}-01`;
  const year = first.slice(0, 4);
  const monthNum = Number(first.slice(5, 7));
  const length = new Date(Number(year), monthNum, 0).getDate();
  return Array.from({ length }, (_, i) => `${first.slice(0, 8)}${String(i + 1).padStart(2, '0')}`);
}

/**
 * Patch que VACÍA el plan de un día (rutina, tipo, título y estado).
 *
 * `setDay` de v2 hace merge y no borra claves, así que el "limpiar" de la v1 se
 * consigue escribiendo `undefined`: `JSON.stringify` omite esas claves y al
 * releer el estado el día queda vacío. `sessionId` NO se toca: es el enlace a
 * una sesión registrada, no planificación.
 */
export function clearDayPatch(): Partial<ScheduleDay> {
  return {
    status: undefined,
    type: undefined,
    routineId: undefined,
    title: undefined,
    source: undefined,
  };
}

/**
 * Patch que MARCA el día como descanso (el `cal:mark` de la v1 con `rest`,
 * usado por el «Saltar» de Hoy y por `markRest` del Calendario).
 *
 * Como `setDay` hace merge y no borra claves, la rutina asignada se CONSERVA
 * (igual que en la v1): el día queda en descanso pero se puede retomar después.
 */
export function restDayPatch(): Partial<ScheduleDay> {
  return { status: 'rest', type: 'descanso', title: 'Descanso', source: 'manual' };
}

/* ---------- plan del coach IA ---------- */

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** `rationale` del plan: frase suelta o lista de frases (la v1 las unía con ` · `). */
function rationaleText(value: unknown): string {
  if (Array.isArray(value))
    return value
      .map((line) => str(line))
      .filter(Boolean)
      .join(' · ');
  return str(value);
}

/** Nombres de ejercicios propuestos, aceptando `name`/`exercise`/`ejercicio`. */
function exerciseNames(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw === 'string') {
      if (raw.trim()) out.push(raw.trim());
      continue;
    }
    if (!isPlain(raw)) continue;
    const name = str(raw.name) || str(raw.exercise) || str(raw.ejercicio);
    if (name) out.push(name);
  }
  return out;
}

/** Un día del plan ya normalizado para previsualizarlo (el crudo va aparte). */
export interface PlanDayPreview {
  iso: string;
  type: DayType | '';
  title: string;
  focus: string;
  exercises: string[];
}

export interface PlanPreview {
  source: string;
  rationale: string;
  days: PlanDayPreview[];
}

/** Lo que se guarda en la vista mientras hay una propuesta en pantalla. */
export interface PlanResult {
  /** JSON crudo, que es lo que entiende `applyWeek(plan)` */
  raw: unknown;
  preview: PlanPreview;
}

/**
 * Normaliza la respuesta del coach en algo previsualizable. Devuelve `null` si
 * no parece un plan (ni un objeto con `days` con fechas válidas), para que la
 * vista pueda avisar en vez de pintar una lista vacía.
 */
export function normalizePlan(raw: unknown): PlanPreview | null {
  if (!isPlain(raw)) return null;
  const list = Array.isArray(raw.days) ? raw.days : [];
  const days: PlanDayPreview[] = [];
  for (const item of list) {
    if (!isPlain(item)) continue;
    const isoDay = (str(item.date) || str(item.iso)).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDay)) continue;
    const type = str(item.type);
    days.push({
      iso: isoDay,
      type: (DAY_TYPES as readonly string[]).includes(type) ? (type as DayType) : '',
      title: str(item.title),
      focus: str(item.focus),
      exercises: exerciseNames(item.exercises ?? item.items),
    });
  }
  if (!days.length) return null;
  return {
    source: str(raw.source) || 'ia',
    rationale: rationaleText(raw.rationale),
    days,
  };
}

/**
 * Interpreta el texto que devuelve `runCoachTask('plan')` como plan: el modelo
 * a veces lo envía en una cercilla o con prosa alrededor, así que se reutiliza
 * el `parseJSON` tolerante del coach en vez de un `JSON.parse` a pelo.
 */
export function parsePlan(text: string): PlanResult | null {
  let raw: unknown;
  try {
    raw = parseJSON<unknown>(text);
  } catch {
    return null;
  }
  const preview = normalizePlan(raw);
  return preview ? { raw, preview } : null;
}
