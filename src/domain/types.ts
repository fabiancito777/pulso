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
  /** pares: 1 par = 2 discos */
  pairs: number;
  on: boolean;
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

/* ---------- catálogo (lo genera `tools/port-catalog.mjs` en `catalog.ts`) ---------- */

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

/**
 * Estado persistido en `localStorage['pulso.state']`. v2 lee y escribe el MISMO
 * formato que la v1, así que los datos existentes siguen valiendo durante la
 * migración (y volver a la rama main no rompe nada).
 */
export interface AppState {
  version: number;
  createdAt: string;
  settings: Settings;
  /* ★ pendientes de portar (store.js / data.js / trainer.js / coach.js) */
  equipment?: unknown;
  exercises?: unknown;
  routines?: unknown;
  sessions?: unknown;
  schedule?: unknown;
  active?: unknown;
  chat?: unknown;
  meta?: unknown;
  [key: string]: unknown;
}
