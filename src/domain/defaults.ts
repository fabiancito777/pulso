/** Valores por defecto de ajustes e inventario. */
import type { BarWeights, PlateStock, Settings } from './types';

/**
 * Inventario por defecto en DISCOS sueltos: 8 de 3 kg (4 por lado), 4 de 2,5 kg,
 * 4 de 1,25 kg y 4 de cada medida en libras.
 */
export const PLATES_DEFAULT: readonly PlateStock[] = [
  { w: 3, unit: 'kg', discs: 8, on: true },
  { w: 2.5, unit: 'kg', discs: 4, on: true },
  { w: 1.25, unit: 'kg', discs: 4, on: true },
  { w: 5, unit: 'lb', discs: 4, on: true },
  { w: 2.5, unit: 'lb', discs: 4, on: true },
];

/** Barra de plástico: pesa 0 kg, todo el peso lo ponen los discos. */
export const BARS_DEFAULT: BarWeights = { olimpica: 0, ez: 0, mancuerna: 0 };

export const REST_PRESETS: readonly number[] = [45, 60, 90, 120, 150, 180, 240];
export const INCREMENTS: readonly number[] = [1, 1.25, 2.5, 5, 10];

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  level: 'intermedio',
  goal: 'hipertrofia',
  daysPerWeek: 4,
  theme: 'amoled',
  accent: '#c8ff2e',
  units: 'kg',
  restDefault: 90,
  autoRest: true,
  sound: true,
  volume: 0.6,
  vibrate: true,
  notify: true,
  keepAwake: true,
  increment: 2.5,
  countWarmups: false,
  showRpe: false,
  countdownTick: true,
  quickFinish: false,
  plates: [...PLATES_DEFAULT],
  bars: { ...BARS_DEFAULT },
  plateModes: {},
  ai: {
    apiKey: '',
    model: 'gemini-3.8-flash',
    thinkingLevel: 'low',
    thinkingBudget: '',
      includeThoughts: true,
      temperature: 1,
    maxTokens: 4096,
    autoApply: false,
    systemPrompt: '',
    memory: '',
  },
};
