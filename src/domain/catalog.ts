/* ==========================================================================
   Pulso v2 · catalog.ts — taxonomía y opciones de material

   ARCHIVO GENERADO (histórico): se produjo una vez desde
   (tag `la versión anterior`) con el generador `tools/port-catalog.mjs`, ya retirado. Ahora es un
   fichero base congelado: si hay que tocar datos, se edita aquí a mano con cuidado y lo
   vigila `src/domain/data.test.ts`.
   ========================================================================== */
import type { DayType, EquipmentItem, Level, ModelOption, MuscleGroup, OptionItem } from './types';

/* ---------- grupos musculares ---------- */
/* Los 13  (generados) + los AÑADIDOS A MANO al final: antes no tenía
   estos músculos y el generador IA sí puede proponer ejercicios para ellos. Se
   añaden aquí (y no en `seed.ts`) porque son taxonomía del catálogo: el
   generador enumera estas claves, los gráficos y el planner las recorren, y
   `data.test.ts` vigila que todo grupo guardado exista. */
export const GROUPS: readonly MuscleGroup[] = [
  { key: 'pecho', label: 'Pecho', color: '#60a5fa' },
  { key: 'espalda', label: 'Espalda', color: '#34d399' },
  { key: 'hombros', label: 'Hombros', color: '#fbbf24' },
  { key: 'biceps', label: 'Bíceps', color: '#a78bfa' },
  { key: 'triceps', label: 'Tríceps', color: '#f472b6' },
  { key: 'cuadriceps', label: 'Cuádriceps', color: '#f87171' },
  { key: 'femoral', label: 'Femoral', color: '#fb923c' },
  { key: 'gluteos', label: 'Glúteos', color: '#e879f9' },
  { key: 'gemelos', label: 'Gemelos', color: '#22d3ee' },
  { key: 'core', label: 'Core', color: '#94a3b8' },
  { key: 'antebrazo', label: 'Antebrazo', color: '#c084fc' },
  { key: 'cardio', label: 'Cardio', color: '#4ade80' },
  { key: 'movilidad', label: 'Movilidad', color: '#8b9dc3' },
  /* --- añadidos a mano (no venían ) --- */
  { key: 'trapecio', label: 'Trapecio', color: '#fdba74' },
  { key: 'lumbares', label: 'Lumbares', color: '#a3a3a3' },
  { key: 'oblicuos', label: 'Oblicuos', color: '#5eead4' },
  { key: 'aductores', label: 'Aductores', color: '#f9a8d4' },
  { key: 'cuello', label: 'Cuello', color: '#d8b4fe' },
  { key: 'serrato', label: 'Serrato', color: '#bef264' },
];


/* ---------- material disponible ---------- */
const equipment: EquipmentItem[] = [
  {
    key: 'barra_olimpica',
    label: 'Barra cargable',
    hint: 'larga/olímpica o de plástico · peso configurable',
    cat: 'Barras',
  },
  { key: 'barra_ez', label: 'Barra EZ', hint: 'para bíceps/tríceps', cat: 'Barras' },
  { key: 'barra_t', label: 'Barra T / landmine', hint: 'remo en T, press landmine', cat: 'Barras' },
  { key: 'trap_bar', label: 'Trap bar (hexagonal)', hint: 'peso muerto y cargadas', cat: 'Barras' },
  { key: 'mancuernas_ajustables', label: 'Mancuernas ajustables', hint: '', cat: 'Mancuernas' },
  {
    key: 'mancuernas_fijas',
    label: 'Mancuernas fijas',
    hint: 'juego completo por pares',
    cat: 'Mancuernas',
  },
  { key: 'kettlebell', label: 'Kettlebell', hint: '', cat: 'Mancuernas' },
  {
    key: 'discos',
    label: 'Discos / inventario de peso',
    hint: 'configúralo abajo',
    cat: 'Mancuernas',
  },
  {
    key: 'banco_dominadas',
    label: 'Barra de dominadas',
    hint: 'puerta, pared o rack',
    cat: 'Estructuras',
  },
  { key: 'anillas', label: 'Anillas / TRX', hint: 'suspensión', cat: 'Estructuras' },
  { key: 'rack', label: 'Rack o jaula', hint: 'sentadillas y press seguros', cat: 'Estructuras' },
  { key: 'plataforma', label: 'Plataforma de peso muerto', hint: '', cat: 'Estructuras' },
  { key: 'polea_alta', label: 'Polea alta', hint: 'jalón, tríceps', cat: 'Máquinas' },
  { key: 'polea_baja', label: 'Polea baja', hint: 'remo, curl', cat: 'Máquinas' },
  { key: 'polea_crossover', label: 'Crossover / doble polea', hint: '', cat: 'Máquinas' },
  { key: 'smith', label: 'Máquina Smith', hint: '', cat: 'Máquinas' },
  { key: 'prensa', label: 'Prensa de piernas', hint: '', cat: 'Máquinas' },
  { key: 'hack_squat', label: 'Hack squat', hint: '', cat: 'Máquinas' },
  { key: 'ext_cuadriceps', label: 'Extensión de cuádriceps', hint: '', cat: 'Máquinas' },
  { key: 'curl_femoral_maq', label: 'Curl femoral', hint: 'tumbado o sentado', cat: 'Máquinas' },
  { key: 'gemelo_maq', label: 'Máquina de gemelos', hint: '', cat: 'Máquinas' },
  { key: 'jalon_maq', label: 'Jalón al pecho (máquina)', hint: '', cat: 'Máquinas' },
  { key: 'remo_maq', label: 'Remo en máquina', hint: '', cat: 'Máquinas' },
  { key: 'peck_deck', label: 'Peck deck / aperturas', hint: '', cat: 'Máquinas' },
  { key: 'press_hombro_maq', label: 'Press de hombro (máquina)', hint: '', cat: 'Máquinas' },
  { key: 'abductora_maq', label: 'Máquina abductora / aductora', hint: '', cat: 'Máquinas' },
  { key: 'multiestacion', label: 'Multiestación', hint: 'poleas integradas', cat: 'Máquinas' },
  { key: 'banco_plano', label: 'Banco plano', hint: '', cat: 'Bancos' },
  {
    key: 'banco_inclinable',
    label: 'Banco inclinable',
    hint: 'cubre plano e inclinado',
    cat: 'Bancos',
  },
  { key: 'banco_predicador', label: 'Banco predicador / scott', hint: '', cat: 'Bancos' },
  { key: 'cajon', label: 'Cajón / step', hint: 'subidas, fondos, hip thrust', cat: 'Bancos' },
  { key: 'bandas', label: 'Bandas elásticas', hint: '', cat: 'Accesorios' },
  { key: 'rueda_abdominal', label: 'Rueda abdominal', hint: '', cat: 'Accesorios' },
  { key: 'colchoneta', label: 'Colchoneta / mat', hint: '', cat: 'Accesorios' },
  { key: 'balon_suizo', label: 'Balón suizo', hint: '', cat: 'Accesorios' },
  { key: 'bosu', label: 'Bosu', hint: '', cat: 'Accesorios' },
  { key: 'cuerda_saltar', label: 'Cuerda de saltar', hint: '', cat: 'Accesorios' },
  {
    key: 'cinturon_lastre',
    label: 'Cinturón de lastre',
    hint: 'para dominadas/fondos',
    cat: 'Accesorios',
  },
  { key: 'chaleco_lastre', label: 'Chaleco con peso', hint: '', cat: 'Accesorios' },
  { key: 'correas', label: 'Correas / straps', hint: 'agarre en tirones', cat: 'Accesorios' },
  { key: 'foam_roller', label: 'Foam roller', hint: '', cat: 'Accesorios' },
  { key: 'cinta', label: 'Cinta de correr', hint: '', cat: 'Cardio' },
  { key: 'bici', label: 'Bici estática / spinning', hint: '', cat: 'Cardio' },
  { key: 'remo_erg', label: 'Remo ergómetro', hint: '', cat: 'Cardio' },
  { key: 'eliptica', label: 'Elíptica', hint: '', cat: 'Cardio' },
  { key: 'escaladora', label: 'Escaladora / stair', hint: '', cat: 'Cardio' },
  { key: 'trineo', label: 'Trineo / sled', hint: '', cat: 'Cardio' },
  { key: 'exterior', label: 'Espacio exterior', hint: 'correr, saltos, calles', cat: 'Cardio' },
];
/* antes inserta esta pieza con splice (no está en la lista de arriba); se conserva
   tal cual para que el orden del catálogo siga siendo el mismo */
equipment.splice(12, 0, {
  key: 'paralelas',
  label: 'Paralelas / soporte de fondos',
  hint: 'dips y elevaciones',
  cat: 'Estructuras',
});

export const EQUIPMENT: readonly EquipmentItem[] = equipment;

/* ---------- tipos de día del calendario ---------- */
export const DAY_TYPES: readonly DayType[] = [
  { key: 'entreno', label: 'Entrenamiento' },
  { key: 'cardio', label: 'Cardio' },
  { key: 'movilidad', label: 'Movilidad / descanso activo' },
  { key: 'descanso', label: 'Descanso' },
];

/* ---------- material que viene activo de fábrica ---------- */
export const DEFAULT_EQUIPMENT: Record<string, boolean> = {
  mancuernas_ajustables: true,
  discos: true,
  barra_olimpica: true,
  banco_dominadas: true,
  paralelas: true,
};

/* ---------- presets de equipamiento ---------- */
export const EQUIP_PRESETS: Record<string, readonly string[]> = {
  basico: [
    'mancuernas_ajustables',
    'banco_inclinable',
    'banco_plano',
    'colchoneta',
    'bandas',
    'discos',
    'exterior',
    'cuerda_saltar',
    'banco_dominadas',
    'barra_olimpica',
    'bici',
  ],
  ninguno: ['colchoneta', 'exterior'],
  /* 'gym' = todo el catálogo menos estas piezas */
  gymExclude: ['trap_bar', 'barra_t', 'hack_squat', 'bosu', 'trineo'],
};

/* ---------- niveles ---------- */
export const LEVELS: readonly Level[] = ['principiante', 'intermedio', 'avanzado'];

/* ---------- objetivos ---------- */
export const GOALS: readonly OptionItem[] = [
  { key: 'hipertrofia', label: 'Hipertrofia (músculo)' },
  { key: 'fuerza', label: 'Fuerza' },
  { key: 'perder_grasa', label: 'Perder grasa' },
  { key: 'salud', label: 'Salud y movilidad' },
];

/* ---------- rango de reps por objetivo ---------- */
export const GOAL_REPS: Record<string, readonly [number, number]> = {
  hipertrofia: [8, 12],
  fuerza: [4, 6],
  perder_grasa: [10, 15],
  salud: [8, 15],
};

/* ---------- series por objetivo ---------- */
export const GOAL_SETS: Record<string, number> = {
  hipertrofia: 4,
  fuerza: 5,
  perder_grasa: 3,
  salud: 3,
};

/* ---------- descanso por objetivo ---------- */
export const GOAL_REST: Record<string, number> = {
  hipertrofia: 90,
  fuerza: 180,
  perder_grasa: 60,
  salud: 75,
};

/* ---------- acentos de la UI ---------- */
export const ACCENTS: readonly string[] = [
  '#c8ff2e',
  '#4ade80',
  '#22d3ee',
  '#60a5fa',
  '#a78bfa',
  '#f472b6',
  '#fb923c',
  '#f87171',
  '#fbbf24',
  '#e5e7eb',
];

/* ---------- temas ---------- */
export const THEMES: readonly OptionItem[] = [
  { key: 'amoled', label: 'AMOLED', hint: 'negro puro #000' },
  { key: 'dark', label: 'Oscuro', hint: 'gris azulado' },
  { key: 'light', label: 'Claro', hint: 'para exteriores' },
];

/* ---------- modelos del coach ---------- */
/**
 * Modelos que soporta la app: `gemini-4-hydrogen` es el recomendado y los dos
 * Gemini 3 se conservan como respaldo. Los 2.5 quedan fuera porque usaban
 * `thinkingBudget` en vez de `thinkingLevel`.
 */
export const AI_MODELS: readonly ModelOption[] = [
  { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen', hint: 'más capaz y rápido · recomendado' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', hint: 'respaldo estable' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', hint: 'rápido y económico' },
];

/* ---------- niveles de razonamiento del coach ---------- */
export const THINKING_LEVELS: readonly OptionItem[] = [
  { key: 'auto', label: 'Auto', hint: 'deja el valor por defecto del modelo' },
  { key: 'minimal', label: 'Mínimo', hint: 'respuestas rápidas (en Hydrogen usa bajo)' },
  { key: 'low', label: 'Bajo', hint: 'tareas simples' },
  { key: 'medium', label: 'Medio', hint: 'equilibrado' },
  { key: 'high', label: 'Alto', hint: 'planificación compleja' },
  { key: 'xhigh', label: 'Máximo', hint: 'razonamiento profundo' },
];
