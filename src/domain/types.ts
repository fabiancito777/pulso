/**
 * Tipos del dominio. Lo que todavía no se ha portado se marca con ★ y llega con
 * su módulo (store, data, trainer…). El objetivo es que `AppState` sea el
 * contrato único del estado y que cualquier campo sin portar se vea a simple
 * vista en lugar de esconderse detrás de un `any`.
 */

export type Unit = 'kg' | 'lb';

/** Una medida del inventario tal y como se guarda en ajustes. */
export interface PlateStock {
  w: number;
  unit: Unit;
  /** discos individuales de esa medida (entero ≥ 0); es lo que cuenta la UI */
  discs: number;
  on: boolean;
  /**
   * Espejo de compatibilidad con la v1: `floor(discs / 2)`. El dominio NO lo lee
   * (la migración a unidades vive en `normalizePlates`); solo se rellena al
   * persistir para que una copia siga abriéndose en `v1-final`, que este campo
   * lo interpreta como pares.
   */
  pairs?: number;
}

/** Peso de cada mango/barra sin discos. */
export interface BarWeights {
  olimpica: number;
  ez: number;
  mancuerna: number;
}

export type PlateModeKey = 'bar' | 'db1' | 'db2' | 'none';

export type Theme = 'amoled' | 'dark' | 'light';
export type Level = 'principiante' | 'intermedio' | 'avanzado';
export type ExerciseType = 'compuesto' | 'aislado' | 'cardio' | 'movilidad';

/* ---------- catálogo (generado en `catalog.ts`) ---------- */

/** Una pieza del catálogo de material. */
export interface EquipmentItem {
  key: string;
  label: string;
  hint: string;
  cat: string;
}

export interface MuscleGroup {
  key: string;
  label: string;
  color: string;
}

/** Opción con clave (nivel, tema, objetivo, nivel de razonamiento…). */
export interface OptionItem {
  key: string;
  label: string;
  hint?: string;
}

export interface ModelOption {
  id: string;
  label: string;
  hint: string;
}

export interface RoutineTemplate {
  id: string;
  name: string;
  hint: string;
  /** [grupo muscular, cuántos ejercicios] */
  recipe: [string, number][];
}

export interface DayType {
  key: string;
  label: string;
}

/**
 * Un ejercicio de la biblioteca. El estado guarda esta misma forma (los que crea
 * el usuario llevan `custom: true`).
 */
export interface Exercise {
  id: string;
  name: string;
  group: string;
  /** `''` = peso corporal · `'a&b|c'` = requiere a Y (b o c) */
  equip: string;
  type: ExerciseType;
  sets: number;
  repMin: number;
  repMax: number;
  rest: number;
  /** permitido / prohibido por el usuario */
  allowed: boolean;
  /**
   * ★ preferido: manda en el orden de listas y pickers y desempata en el
   * generador local. **Opcional** a propósito: `E()` del catálogo generado y las
   * literales de los tests no lo traen, así que no hay que regenerar `catalog.ts`
   * ni tocar la v1 (que lo ignora). En memoria `library.normalize()` lo
   * materializa como boolean, y al escribir solo se persiste `=== true`.
   */
  fav?: boolean;
  /**
   * Ocultación suave: solo presentación — fuera de los pickers y de la lista de
   * Ajustes por defecto (queda tras el segmento «Ocultos»). **No** lo leen ni el
   * coach ni el generador: para no proponer un ejercicio sigue estando
   * `allowed: false`. Mismo porqué que `fav` respecto a la v1.
   */
  hidden?: boolean;
  custom: boolean;
  bw: boolean;
  tags: string[];
  tips: string;
}

/** Opcionales de `E()` en la v1 (el generador los conserva tal cual). */
export interface ExerciseOpts {
  allowed?: boolean;
  bw?: boolean;
  tags?: string[];
  tips?: string;
}

export interface AiSettings {
  apiKey: string;
  model: string;
  thinkingLevel: string;
  thinkingBudget: string | number;
  includeThoughts: boolean;
  temperature: number;
  maxTokens: number;
  autoApply: boolean;
  systemPrompt: string;
  /** Memoria editable del coach IA (markdown). La lógica vive en `features/coach`. */
  memory?: string;
}

export interface Settings {
  name: string;
  level: Level;
  /** ★ llega con `data.js` (GOALS) */
  goal: string;
  daysPerWeek: number;
  theme: Theme;
  accent: string;
  units: Unit;
  restDefault: number;
  autoRest: boolean;
  sound: boolean;
  volume: number;
  vibrate: boolean;
  notify: boolean;
  keepAwake: boolean;
  increment: number;
  countWarmups: boolean;
  showRpe: boolean;
  countdownTick: boolean;
  quickFinish: boolean;
  plates: PlateStock[];
  bars: BarWeights;
  /** modo de carga recordado por ejercicio (clave `__tool__` para la calculadora suelta) */
  plateModes: Record<string, PlateModeKey>;
  ai: AiSettings;
}

/* ---------- sesiones ---------- */

/**
 * Una serie registrada. `weight: null` = sin peso (peso corporal o máquina que no
 * se anota); es distinto de `0`, que es un peso real. En las sesiones guardadas
 * el peso está en la unidad de SU sesión (`Session.unit`), no siempre en kg.
 */
export interface SetLog {
  weight: number | null;
  reps: number;
  done: boolean;
  ts?: string;
  /** 1-10, solo si el usuario lo apunta (`settings.showRpe`). */
  rpe?: number | null;
}

/** Un ejercicio dentro de una sesión. */
export interface SessionEntry {
  exId: string;
  name?: string;
  /** El grupo se guarda como respaldo por si el ejercicio sale de la biblioteca. */
  group?: string;
  restSec?: number;
  notes?: string;
  sets: SetLog[];
  [key: string]: unknown;
}

/** Una sesión terminada (lo que `T.finish()` de la v1 apila en `state.sessions`). */
export interface Session {
  id: string;
  name?: string;
  routineId?: string | null;
  /** ISO local `YYYY-MM-DD` del día del calendario al que pertenece. */
  date: string;
  startedAt: string;
  endedAt?: string;
  /** Unidad en la que se apuntaron los pesos de esta sesión. */
  unit: Unit;
  source?: string;
  entries: SessionEntry[];
  notes?: string;
  /** RPE medio de la sesión. */
  rpe?: number | null;
  /**
   * Copia de la rutina al ARRANCAR la sesión (si arrancó desde rutina). La rutina
   * original es editable después, así que este snapshot es lo único que permite
   * saber qué cambió el usuario en plena sesión (quitar, añadir o sustituir).
   */
  plan?: RoutineItem[];
  [key: string]: unknown;
}

/* ---------- sesión en curso ---------- */

/**
 * Una serie MIENTRAS entrenas. Ojo a las diferencias con `SetLog`: el peso y las
 * reps pueden estar VACÍOS (`''`) porque el usuario los está escribiendo, y el
 * vacío es distinto de `0` (`0` es "este ejercicio pesa 0 kg", que es información
 * real en un ejercicio a peso corporal).
 */
export interface ActiveSet {
  weight: number | '';
  reps: number | '';
  done: boolean;
  ts: string | null;
  rpe: number | null;
  /** reps objetivo de la prescripción (solo para pintarlas de referencia) */
  target?: number;
  /** el peso lo puso la sugerencia de progresión, no el usuario */
  suggested?: boolean;
}

/** Un ejercicio de la sesión en curso. */
export interface ActiveEntry {
  exId: string;
  name: string;
  /** descanso sugerido por la prescripción o la biblioteca, en segundos */
  restSec: number;
  repMin: number;
  repMax: number;
  sets: ActiveSet[];
  notes: string;
  /** de dónde sale el peso propuesto: "última vez 60 kg × 8 · hace 3 días" */
  basis?: string;
}

/**
 * La sesión en curso (`state.active`).
 */
export interface ActiveSession {
  id: string;
  routineId: string | null;
  name: string;
  startedAt: string;
  unit: Unit;
  entries: ActiveEntry[];
  notes: string;
  /** día del calendario al que se apuntará al terminar */
  dayIso: string;
  source: string;
  /**
   * Snapshot de la rutina con la que se arrancó: viaja aquí hasta `finishSession`,
   * que lo persiste en `Session.plan`. Ver el JSDoc de `Session.plan`.
   */
  plan?: RoutineItem[];
}

/**
 * Estado del timer de descanso. `endsAt` es la clave: el tiempo que queda se calcula
 * con `endsAt - Date.now()`, así que sobrevive a que la pestaña se congele o el móvil
 * se bloquee (un contador acumulado se quedaría parado).
 */
export interface RestState {
  /** marca de tiempo (ms) en la que termina el descanso */
  endsAt: number;
  /** segundos del descanso original (para el anillo y el "total") */
  total: number;
  running: boolean;
  /** a qué vas: el propio ejercicio o el siguiente (es el texto del aviso) */
  label: string;
  /** el aviso de fin ya se lanzó (pitido, vibración, notificación) */
  doneFired: boolean;
  doneAt: number;
  /** último segundo para el que ya sonó un tic (el bucle corre cada 500 ms) */
  lastTick: number | null;
}

/* ---------- prescripción (rutinas y planes) ---------- */

/**
 * Un ejercicio prescrito dentro de una rutina. `weight` es opcional (puede venir
 * de un plan del coach); si existe, manda sobre la sugerencia por historial, y
 * las `notes` (p. ej. "SUPERSERIE 1 (1/2)") viajan a la sesión.
 */
export interface RoutineItem {
  exId: string;
  sets?: number;
  repMin?: number;
  repMax?: number;
  rest?: number;
  weight?: number | null;
  notes?: string;
}

/**
 * Un ejercicio de un plan del día. Puede venir con `name` en vez de `exId` (los
 * planes del coach IA a veces solo traen el nombre), así que hay que resolverlo
 * contra la biblioteca antes de usarlo.
 */
export interface PlanItem {
  exId?: string;
  name?: string;
  sets?: number;
  repMin?: number;
  repMax?: number;
  rest?: number;
  weight?: number | null;
}

/**
 * Estado persistido en `localStorage['pulso.state']`. v2 lee y escribe el MISMO
 * formato que la v1, así que los datos existentes siguen valiendo durante la
 * migración (y volver a la rama main no rompe nada).
 *
 * Única excepción: `settings.plates` se guarda en **unidades** (`discs`) con el
 * espejo `pairs` (compatibilidad con la v1). Las filas antiguas, que solo traían
 * `pairs`, se migran al leer (`normalizePlates`) sin reescribir localStorage.
 */
export interface AppState {
  version: number;
  createdAt: string;
  settings: Settings;
  /* ★ pendientes de portar (store.js / data.js / trainer.js / coach.js) */
  equipment?: unknown;
  exercises?: unknown;
  routines?: unknown;
  sessions?: Session[];
  schedule?: unknown;
  active?: ActiveSession | null;
  chat?: unknown;
  meta?: unknown;
  [key: string]: unknown;
}
