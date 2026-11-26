/** Guías para los 24 ejercicios de la biblioteca predeterminada y aliases exactos. */
export type ExerciseGuideSource = 'cc0' | 'photo' | 'original';
export type ExerciseGuideFrame = 'start' | 'end' | 'hold';

export interface ExerciseGuidePhase {
  label: string;
  /** Ruta pública final, que la UI prefija con BASE_URL. */
  src: string;
  source: ExerciseGuideSource;
  sourceId: string;
  /** Mitad de un bitmap original tipo diptych, para conservar el arte fuente. */
  crop?: 'left' | 'right';
  /** Ruta dentro del clon CC0, para importar el binario. */
  sourcePath?: string;
}

export interface ExerciseGuide {
  source: ExerciseGuideSource;
  sourceId: string;
  phases: readonly ExerciseGuidePhase[];
}

function cc0(sourceId: string): ExerciseGuide {
  const frames: readonly ExerciseGuideFrame[] = ['start', 'end'];
  return {
    source: 'cc0',
    sourceId,
    phases: frames.map((frame, index) => ({
      label: index === 0 ? 'Inicio' : 'Final',
      src: `/exercise-guides/cc0/${sourceId}/${frame}.webp`,
      source: 'cc0',
      sourceId,
      sourcePath: `images/${sourceId}/${frame}.webp`,
    })),
  };
}

function cc0Hold(sourceId: string): ExerciseGuide {
  return {
    source: 'cc0',
    sourceId,
    phases: [
      {
        label: 'Postura',
        src: `/exercise-guides/cc0/${sourceId}/hold.webp`,
        source: 'cc0',
        sourceId,
        sourcePath: `images/${sourceId}/hold.webp`,
      },
    ],
  };
}

function diptych(sourceId: string, src: string): ExerciseGuide {
  return {
    source: 'original',
    sourceId,
    phases: [
      { label: 'Inicio', src, source: 'original', sourceId, crop: 'left' },
      { label: 'Final', src, source: 'original', sourceId, crop: 'right' },
    ],
  };
}

function photo(sourceId: string): ExerciseGuide {
  return {
    source: 'photo',
    sourceId,
    phases: [0, 1].map((index, position) => ({
      label: position === 0 ? 'Inicio' : 'Final',
      src: `/exercise-guides/photo/${sourceId}/${index}.webp`,
      source: 'photo',
      sourceId,
      sourcePath: `exercises/${sourceId}/${index}.jpg`,
    })),
  };
}

/**
 * Cubre los 24 IDs de `seedExercises()` y conserva dos IDs guardados con
 * movimientos idénticos: `floor-press` y `curl-con-mancuernas`.
 */
export const EXERCISE_GUIDES: Readonly<Record<string, ExerciseGuide>> = {
  'remo-unilateral-kroc-row-con-mancuerna': diptych(
    'pulso-original:kroc-row',
    '/exercise-demos/kroc-row.webp',
  ),
  'remo-con-barra': cc0('bent-over-row'),
  'press-de-piso-con-mancuernas': cc0('dumbbell-floor-press'),
  'floor-press': cc0('dumbbell-floor-press'),
  'sentadilla-copa-con-mancuerna': cc0('goblet-squat'),
  'pull-over': diptych(
    'pulso-original:dumbbell-floor-pullover',
    '/exercise-demos/dumbbell-floor-pullover.webp',
  ),
  'pullover-con-mancuerna': diptych(
    'pulso-original:dumbbell-floor-pullover',
    '/exercise-demos/dumbbell-floor-pullover.webp',
  ),
  'press-frances': diptych(
    'pulso-original:floor-skull-crusher',
    '/exercise-demos/floor-skull-crusher.webp',
  ),
  zancadas: cc0('dumbbell-lunge'),
  'press-militar': cc0('overhead-press'),
  'press-militar-sentado-con-mancuernas': cc0('dumbbell-shoulder-press'),
  'elevaciones-laterales': cc0('lateral-raises'),
  'rompecraneos-en-suelo': diptych(
    'pulso-original:floor-skull-crusher',
    '/exercise-demos/floor-skull-crusher.webp',
  ),
  'curl-con-barra': cc0('barbell-curl'),
  'curl-martillo': cc0('hammer-curls'),
  'encogimientos-shrugs-con-barra': cc0('shrugs'),
  'pajaros-con-mancuernas': cc0('rear-delt-fly'),
  pajaros: cc0('rear-delt-fly'),
  'curl-de-muneca-con-mancuerna-unilateral': photo(
    'Seated_One-Arm_Dumbbell_Palms-Up_Wrist_Curl',
  ),
  'curl-de-muneca-invertido-unilateral-con-mancuerna': photo(
    'Seated_One-Arm_Dumbbell_Palms-Down_Wrist_Curl',
  ),
  'curl-de-biceps': diptych('pulso-original:dumbbell-curl', '/exercise-demos/dumbbell-curl.webp'),
  'curl-con-mancuernas': diptych(
    'pulso-original:dumbbell-curl',
    '/exercise-demos/dumbbell-curl.webp',
  ),
  dominadas: cc0('pull-up'),
  plancha: cc0Hold('plank'),
  'flexiones-diamante': cc0('diamond-push-up'),
  'elevacion-de-talones-unilateral': diptych(
    'pulso-original:single-leg-dumbbell-calf-raise',
    '/exercise-demos/single-leg-dumbbell-calf-raise.webp',
  ),
};
