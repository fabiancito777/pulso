/**
 * Helpers de la vista Calendario: estado de un día, cuadrícula mensual,
 * resumen de la semana, normalización del plan del coach y la distinción
 * **local vs IA** (el `data-ai="0"|"1"` de la v1).
 *
 * Están aparte del componente para poder probarlos con Vitest sin DOM ni
 * `localStorage`: aquí solo entran datos por parámetro y salen datos (los
 * imports con efectos son `parseJSON`, que es puro, y la signal
 * `autoPlanRequest`, el ÚNICO estado del módulo y el único aparte que no es
 * una función pura — está justificado en su sección).
 */
import { signal } from '@preact/signals';

import { label } from '@/domain/dates';
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
 * Subtítulo de la pestaña: el `V.sub` de la v1 (`views-calendar.js:13-19`),
 * «Semana del <inicio> · N/M completados» con el MISMO formato de fecha
 * (`label(..., 'medium')`, «28 sep 2026»).
 */
export function weekSubtitle(from: string, states: readonly DayState[]): string {
  const { done, planned } = weekCounts(states);
  return `Semana del ${label(from, 'medium')} · ${done}/${Math.max(planned, 0)} completados`;
}

/**
 * Intensidad de una celda del mes: el `lv1`-`lv3` de la v1
 * (`views-calendar.js:217`), que pintaba el `month-cell` por número de
 * sesiones. Solo se porta `lv3` (2 o más sesiones): `lv1` (día planificado) y
 * `lv2` (1 sesión) los pinta ya la v2 con `cal-planned` y `cal-done`, con su
 * propia leyenda, así que aplicarlos encima solo duplicaría color.
 */
export function monthLevel(sessionCount: number): 'lv3' | '' {
  return sessionCount >= 2 ? 'lv3' : '';
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
  return planFromJson(raw);
}

/**
 * Envuelve un plan YA parseado (el `payload` de `runCoachTask`, que sin API key
 * es el JSON del planificador local, o el objeto que devuelve `localWeek`) en la
 * propuesta que pinta la vista. Devuelve `null` si no parece un plan, con el
 * mismo criterio que `parsePlan`.
 *
 * Es el camino que usa «Auto-planificar»: el plan local NUNCA pasa por la red
 * ni por un JSON en texto, así que aquí no hay nada que parsear de verdad.
 */
export function planFromJson(raw: unknown): PlanResult | null {
  const preview = normalizePlan(raw);
  return preview ? { raw, preview } : null;
}

/* ---------- local vs IA (el `data-ai` de la v1) ---------- */

/** Quién ha generado una propuesta: el planificador del dispositivo o el coach IA. */
export type PlanEngine = 'ia' | 'local';

/**
 * Motor de una propuesta a partir del `source` que normaliza `normalizePlan`.
 *
 * Solo `'ia'` manda: el plan local escribe `source: 'local'` (`localWeek`) y un
 * plan del modelo sin `source` (el prompt de `prompts.ts` no lo pide) cuenta
 * como IA, que es como lo normaliza la v1. Cualquier otra cadena — la
 * `'local (IA no disponible)'` con la que la v1 etiquetaba el fallback — es
 * plan del dispositivo, y así «Regenerar» y el pie de la tarjeta cuentan la
 * verdad aunque la llamada a la IA se haya caído.
 */
export function planEngine(source: string): PlanEngine {
  return source === 'ia' ? 'ia' : 'local';
}

/**
 * Motor con el que se pide un auto-plan cuando solo se sabe si hay key: IA si
 * la hay, dispositivo si no. Es lo que hacía la v1 con `data-ai` +
 * `C.planWeek({useAI:true})`, que sin key devolvía el plan local en vez de
 * fallar (`legacy/js/coach.js:470`).
 */
export function autoPlanEngine(hasKey: boolean): PlanEngine {
  return hasKey ? 'ia' : 'local';
}

/** Qué ofrece la barra de planificación del Calendario. */
export interface PlanControls {
  /** mostrar el botón «Con IA» (la mejora opcional); el local va SIEMPRE */
  ai: boolean;
  /** pie discreto bajo los botones; `''` cuando no hace falta */
  foot: string;
}

/**
 * La v1 tenía dos botones (`cal:autoplan` con `data-ai="0"` y `"1"`); aquí el
 * local no se puede esconder nunca porque es el único que funciona sin
 * configurar nada. Sin key la opción IA se oculta y deja un pie discreto: no se
 * bloquea NADA, solo se explica por qué no hay dos botones.
 */
export function planControls(hasKey: boolean): PlanControls {
  const ai = autoPlanEngine(hasKey) === 'ia';
  return { ai, foot: ai ? '' : 'sin API key: plan local' };
}

/** Cómo se etiqueta una propuesta en su tarjeta (texto y badge). */
export interface PlanOrigin {
  engine: PlanEngine;
  /** subtítulo: la v1 escribía «generada por IA» / «generada en el dispositivo» */
  subtitle: string;
  /** clase del badge: la IA lleva acento, la local no */
  badge: string;
}

export function planOrigin(source: string): PlanOrigin {
  const engine = planEngine(source);
  return {
    engine,
    subtitle: engine === 'ia' ? 'generada por el coach IA' : 'generada en el dispositivo',
    badge: engine === 'ia' ? 'badge a' : 'badge',
  };
}

/**
 * Petición de auto-plan lanzada desde OTRA pestaña.
 *
 * Es el `App.views.calendario.autoPlan(...)` que la v1 ejecutaba a través de
 * `coach:quick` (`views-train.js:566`: navega a Calendario y le pide el plan).
 * Aquí hace falta un trozo de estado módulo (el único del fichero): un motor o
 * `null`, no un booleano, para que dos peticiones seguidas no se confundan y
 * para que la vista sepa si tocaba IA o dispositivo.
 */
export const autoPlanRequest = signal<PlanEngine | null>(null);

/** Pide un plan a la pestaña Calendario (la llama Hoy: «Plan automático»). */
export function requestAutoPlan(engine: PlanEngine): void {
  autoPlanRequest.value = engine;
}

/**
 * La vista de Calendario consume la petición al montar (o al cambiar la
 * signal): devuelve el motor pendiente y la deja vacía, así que una petición
 * solo dispara UN plan.
 */
export function takeAutoPlanRequest(): PlanEngine | null {
  const engine = autoPlanRequest.value;
  if (engine) autoPlanRequest.value = null;
  return engine;
}
