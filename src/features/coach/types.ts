/**
 * Tipos del dominio del coach IA (`features/coach`).
 *
 * Aquí solo viven las formas que el coach inventa (desviaciones, victorias,
 * memoria, peticiones al modelo). Todo lo demás —sesiones, rutinas, ajustes,
 * material— entra por parámetro con los tipos de `@/domain/types`, igual que en
 * el resto del dominio: ni DOM, ni estado global, ni `fetch`.
 */
import type { EquipmentMap } from '@/domain/data';
import type { Exercise, RoutineItem, Session, Settings, Unit } from '@/domain/types';

/* ---------- aprendizaje: qué te fue bien y qué te fue mal ---------- */

/** Veredicto de una serie frente a lo que prescribía la rutina. */
export type Verdict = 'below' | 'above' | 'matched';

/** Lo que el coach cuenta sobre un ejercicio concreto (victoria o aviso). */
export interface CoachInsight {
  kind: 'win' | 'miss';
  exId: string;
  name: string;
  /** ISO local del día en el que pasó */
  date: string;
  /** frase en castellano con cifras, lista para meter en el prompt */
  text: string;
}

export interface Win extends CoachInsight {
  kind: 'win';
  /** `pr` = nuevo récord de 1RM · `progress` = subió peso, reps o series */
  reason: 'pr' | 'progress';
}

export interface Miss extends CoachInsight {
  kind: 'miss';
  /** `belowReps` = por debajo del repMin del objetivo · `regression` = bajó */
  reason: 'belowReps' | 'regression';
}

/** Hecho real frente a lo recomendado por la plantilla de la rutina. */
export interface Deviation {
  exId: string;
  name: string;
  /** ISO local de la sesión */
  date: string;
  verdict: Verdict;
  /** mejor serie real, SIEMPRE en kg */
  kg: number;
  reps: number;
  /** peso que pedía la rutina, en kg (null = la plantilla no fija peso) */
  targetKg: number | null;
  repMin: number;
  repMax: number;
  /** línea con cifras, p. ej. `Press de banca: 75 kg × 6 · objetivo 80 kg × 8-12 (por debajo)` */
  text: string;
}

/** Ejercicio permitido que lleva días sin tocarse. */
export interface StaleExercise {
  exId: string;
  name: string;
  group: string;
  /** último día en el que se registraron series hechas */
  date: string;
  days: number;
}

/** Todo lo que `buildInsights` sabe decirle al modelo. */
export interface Insights {
  deviations: Deviation[];
  wins: Win[];
  misses: Miss[];
  staleness: StaleExercise[];
  /** cambios detectados entre el snapshot de la rutina y lo hecho (vacío sin `plan`) */
  planChanges: PlanChanges;
  /** 3-6 viñetas en castellano con cifras; vacías si no hay datos */
  summary: string[];
}

/* ---------- cambios en plena rutina (snapshot `Session.plan` vs lo hecho) ---------- */

/**
 * Qué cambió una sesión entre la rutina que tenía al arrancar (`Session.plan`)
 * y las entradas que se acabó haciendo.
 *
 * Los nombres van ya resueltos (entrada → biblioteca → id) y en castellano
 * plano, porque lo que consume esto es el prompt: `unplanned` y `missing`
 * conservan TODOS los ejercicios afectados (también los de `swapped`), así que
 * a la hora de pintar hay que restar los emparejados para no repetir.
 */
export interface PlanChanges {
  /** entradas hechas que no estaban en el plan (añadidas en plena sesión) */
  unplanned: string[];
  /** items del plan sin entrada (quitados o no llegados) */
  missing: string[];
  /** sustituciones emparejadas por grupo muscular: `from` (plan) → `to` (hecho) */
  swapped: { from: string; to: string }[];
  /** mismo conjunto de ejercicios que el plan pero en otro orden */
  reordered: boolean;
}

/* ---------- memoria editable ---------- */

/** Lo que devuelve `applyMemoryEntries`: la memoria nueva y lo que se añadió. */
export interface MemoryUpdate {
  memory: string;
  added: string[];
}

/** Lo que devuelve `extractMemoryBlock`: el texto sin el bloque y su contenido. */
export interface MemoryExtraction {
  rest: string;
  block: string | null;
}

/** Semilla opcional de `defaultMemory` (líneas sin el `- ` inicial). */
export interface MemorySeed {
  profile?: string[];
  preferences?: string[];
  works?: string[];
  fails?: string[];
  patterns?: string[];
}

/* ---------- entradas del coach (todo por parámetro) ---------- */

/**
 * Rutina guardada. Es la misma forma que `Routine` del store, declarada aquí
 * para que `features/coach` no tenga que importar nada de `@/state/*`.
 */
export interface CoachRoutine {
  id: string;
  name: string;
  focus?: string;
  source?: string;
  items: RoutineItem[];
  [key: string]: unknown;
}

/** Un día del calendario (`schedule['2026-09-24']`). */
export interface CoachScheduleDay {
  status?: string;
  type?: string;
  routineId?: string;
  title?: string;
  [key: string]: unknown;
}

export interface BuildInsightsParams {
  sessions: readonly Session[];
  routines: readonly CoachRoutine[];
  /** biblioteca: aporta nombres y grupos (sin ella se usa el id) */
  exercises?: readonly Exercise[];
  /** ISO local de hoy: lo inyecta el caller para poder probarlo sin reloj */
  todayIso: string;
  /** unidad en la que la rutina fija `weight` (por defecto kg) */
  unit?: Unit;
  /** objetivo del usuario: de ahí sale el repMin de los misses */
  goal?: string;
  /** cuántas sesiones recientes se analizan (por defecto 12) */
  maxSessions?: number;
  /** días sin tocar para considerar un ejercicio estancado (por defecto 10) */
  staleDays?: number;
  /** tope de ejercicios en `staleness` (por defecto 12) */
  staleLimit?: number;
  /** tope de desviaciones devueltas (por defecto 20) */
  maxDeviations?: number;
}

export interface ContextOptions {
  /** ISO local de hoy; si falta se usa el reloj del sistema */
  todayIso?: string;
  /** cuántas sesiones entran en HISTORIAL (por defecto 10) */
  maxSessions?: number;
  /** bloque extra al final (p. ej. `DÍA DE HOY: …`) */
  extra?: string;
}

export interface BuildContextParams {
  settings: Settings;
  sessions: readonly Session[];
  routines: readonly CoachRoutine[];
  schedule: Record<string, CoachScheduleDay>;
  equipment: EquipmentMap;
  exercises: readonly Exercise[];
  opts?: ContextOptions;
}

/* ---------- peticiones al modelo ---------- */

/** Un mensaje del chat, con el mismo rol que usaba la v1 (`user` / `model`). */
export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export type CoachTask = 'suggest' | 'plan' | 'analyze' | 'chat';

export interface BuildRequestOpts {
  /** texto ya montado con `buildContext` (se inyecta detrás de `CONTEXTO DEL USUARIO:`) */
  context?: string;
  /** system prompt propio (Ajustes → Coach AI); si falta, `DEFAULT_SYSTEM` */
  system?: string;
  /** añadir `MEMORY_INSTRUCTION` al system (por defecto true) */
  memory?: boolean;
  /**
   * añadir `CONSULT_INSTRUCTION` al system (por defecto true, y solo tiene
   * efecto en `chat` y `analyze`, que son los que no piden JSON)
   */
  consult?: boolean;
  /**
   * añadir `CREATION_INSTRUCTION` al system (por defecto true, y solo tiene
   * efecto en `chat`: ahí los ejercicios nuevos viajan en un bloque ```crear```)
   */
  create?: boolean;
  /** mensaje del usuario (analyze y chat) */
  question?: string;
  /** unidad del usuario, para los prompts de JSON */
  unit?: Unit;
  /** objetivo, para los prompts de JSON */
  goal?: string;
  daysPerWeek?: number;
  /** semanas del análisis (analyze) */
  weeks?: number;
  /** breve de volumen semanal ya montado (analyze) */
  weeklyBrief?: string;
  /** propuesta local que el modelo puede mejorar (suggest y plan) */
  local?: unknown;
  /** semana del plan (`plan`) */
  from?: string;
  to?: string;
  /** historial del chat: se recorta a los últimos 12 mensajes */
  history?: readonly ChatMessage[];
}

export interface CoachRequest {
  system: string;
  prompt: string;
  /** true = la respuesta viene en JSON (`responseMimeType: application/json`) */
  json: boolean;
  history?: ChatMessage[];
}
