/**
 * Capa state del generador IA de ejercicios (Ajustes → Ejercicios): arma la
 * petición con un FOTO de las signals, la manda por `client.generate` con los
 * MISMOS ajustes que el coach y devuelve las propuestas ya parseadas.
 *
 * Reglas de la spec (`_specs/generador-ejercicios.md`) que no se pueden romper:
 *
 * - **1 clic = 1 request**: aquí no hay reintento (el cliente ya reintenta por
 *   su cuenta) ni llamada de ningún tipo al montar el modal ni al activar el
 *   chip de huecos. Todo lo caro pasa dentro de `generateExercises`.
 * - **Sin API key → `GeminiError('auth')` ANTES de tocar `generateFn`** (cero
 *   llamadas, ni siquiera mockeadas) y sin plan local: «inventar» no es algo
 *   que haga el dispositivo. El aviso y el atajo a Ajustes → Coach viven en la
 *   UI, igual que en `CoachView`.
 * - **Sin fallback**: un `parse`/`empty` se propaga y que decida el usuario;
 *   traducir el `GeminiError.kind` a frase amable lo hace `exgenErrorText`.
 *
 * Nada se escribe hasta que el usuario confirma: las propuestas salen de aquí y
 * las crea `state/exercise-create.ts`.
 */
import { enabledEquipment, equipmentKeys, equipLabel } from '@/domain/data';
import type { EquipmentMap } from '@/domain/data';
import { iso } from '@/domain/dates';
import type { Exercise, Session, Settings } from '@/domain/types';
import { GeminiError, generate } from '@/features/coach/client';
import type { GenOpts, GenResult } from '@/features/coach/client';
import type { CoachRequest } from '@/features/coach/types';
import {
  EXISTING_MAX,
  FORBIDDEN_MAX,
  buildGeneratorRequest,
  gapsBrief,
  parseProposals,
} from '@/features/coach/generate-exercise';
import type { ExerciseProposal, GeneratorCtx } from '@/features/coach/generate-exercise';

import { aiGenOptions, hasApiKey } from './coach';
import { equipment, exercises, sessions, settings } from './store';

/** Cuántos ejercicios pide el generador si la UI no especifica otro número. */
const DEFAULT_COUNT = 4;

/** Entrada de una generación (la monta el modal, spec §2). */
export interface GenExercisesInput {
  /** campo libre del usuario, ya montado */
  prompt: string;
  /** cuántos ejercicios se piden (3-6 recomendado; el tope lo pone el prompt) */
  count?: number;
}

/** Dependencias inyectables: los tests no tocan la red. */
export interface ExgenDeps {
  generateFn?: typeof generate;
  now?: () => number;
}

export interface ExgenOutcome {
  /** propuestas normalizadas y validadas, listas para `createExerciseFromAI` */
  proposals: ExerciseProposal[];
  /**
   * Lo que el modelo dice sin proponer nada (franqueza): «esto ya lo cubres»,
   * «no tienes historial para justificarlo»… Puede venir con o sin propuestas.
   */
  advice?: string;
  /** avisos (material que no tienes, filas ilegibles, duplicados en la tanda…) */
  issues: string[];
  usage?: GenResult['usage'];
  thoughts?: string;
  finish?: string;
  /** milisegundos de la generación entera (según `deps.now`) */
  ms: number;
}

/** La foto de la que vive la generación: las signals se leen UNA vez, al empezar. */
interface GenSnapshot {
  library: readonly Exercise[];
  equipmentMap: EquipmentMap;
  history: readonly Session[];
}

/** Contexto de la petición a partir de la foto y de la entrada del usuario. */
function makeCtx(input: GenExercisesInput, snap: GenSnapshot, todayIso: string): GeneratorCtx {
  const active = enabledEquipment(snap.equipmentMap).filter((key) => equipmentKeys.includes(key));
  const ctx: GeneratorCtx = {
    material: active.map(equipLabel),
    equipKeys: active,
    forbidden: snap.library
      .filter((ex) => !ex.allowed)
      .map((ex) => ex.name)
      .slice(0, FORBIDDEN_MAX),
    favorites: snap.library.filter((ex) => ex.fav === true).map((ex) => ex.name),
    existing: snap.library.map((ex) => ex.name).slice(0, EXISTING_MAX),
    count: input.count ?? DEFAULT_COUNT,
    /* Va SIEMPRE: es la misma petición (no gasta una llamada de más) y es lo que
       permite decir «esto ya lo cubres» con fundamento. `gapsBrief` contempla el
       caso de usuario sin sesiones. */
    gaps: gapsBrief(snap.history, snap.library, todayIso),
  };
  return ctx;
}

/**
 * Genera ejercicios nuevos con UNA llamada al modelo.
 *
 * @throws `GeminiError` de kind `auth` (sin key, sin llamar a nadie), `parse`
 *   (respuesta ilegible) o `empty` (ni propuestas ni consejo que enseñar),
 *   además de los que pueda devolver el cliente (`quota`/`network`/`blocked`/`http`).
 */
export async function generateExercises(
  input: GenExercisesInput,
  deps: ExgenDeps = {},
): Promise<ExgenOutcome> {
  const clock = deps.now ?? Date.now;
  const t0 = clock();
  const st: Settings = settings.value;

  /* 0 · sin API key: NADA de red (ni siquiera el `generateFn` mockeado) */
  if (!hasApiKey()) {
    throw new GeminiError('auth', 'Falta la API key de Gemini (Ajustes → Coach AI)');
  }

  /* 1 · foto del estado: el modelo y el parseo ven lo mismo aunque algo cambie
     mientras la llamada está en vuelo */
  const snap: GenSnapshot = {
    library: exercises.value,
    equipmentMap: equipment.value,
    history: sessions.value,
  };
  const prompt = input.prompt;
  const ctx = makeCtx(input, snap, iso(new Date(clock())));
  const req: CoachRequest = buildGeneratorRequest(prompt, ctx);
  const opts: GenOpts = aiGenOptions(st.ai, req);
  const genFn: typeof generate = deps.generateFn ?? generate;

  /* 2 · UNA llamada, sin reintento propio: el cliente ya reintenta por su cuenta */
  const res = await genFn(opts);
  const parsed = parseProposals(res.text, {
    library: snap.library,
    equipment: snap.equipmentMap,
  });
  if (parsed.parseError) {
    throw new GeminiError('parse', 'No entendí la respuesta del modelo');
  }
  /* Sin propuestas: si el modelo explicó por qué (franqueza), NO es un error,
     es una respuesta válida que la UI pinta como consejo. */
  if (!parsed.proposals.length && !parsed.advice) {
    throw new GeminiError(
      'empty',
      parsed.issues.length ? parsed.issues.join(' · ') : 'El modelo no devolvió ejercicios nuevos',
    );
  }

  return {
    proposals: parsed.proposals,
    issues: parsed.issues,
    ...(parsed.advice ? { advice: parsed.advice } : {}),
    ...(res.usage ? { usage: res.usage } : {}),
    ...(res.thoughts ? { thoughts: res.thoughts } : {}),
    ...(res.finish ? { finish: res.finish } : {}),
    ms: clock() - t0,
  };
}

/**
 * Mensaje amable para el modal, con el mismo criterio que `errorText` de
 * `CoachView`: el `kind` del `GeminiError` dice qué tiene que hacer el usuario,
 * y aquí NO hay reintento (el botón se reactiva y que decida él).
 */
export function exgenErrorText(err: unknown): string {
  if (!(err instanceof GeminiError)) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
  switch (err.kind) {
    case 'auth':
      return `Necesito la API key para generar ejercicios: ${err.message}`;
    case 'quota':
      return `Cuota agotada o límite de peticiones alcanzado: ${err.message}`;
    case 'blocked':
      return `La API bloqueó la respuesta: ${err.message}`;
    case 'network':
      return `No hay conexión con Gemini: ${err.message}`;
    case 'parse':
      return 'No entendí la respuesta del modelo, prueba a reformular la petición';
    case 'empty':
      return `No salió ningún ejercicio nuevo (${err.message})`;
    default:
      return `Error de Gemini${err.status ? ` (HTTP ${err.status})` : ''}: ${err.message}`;
  }
}
