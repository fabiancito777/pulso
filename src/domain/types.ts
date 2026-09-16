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
