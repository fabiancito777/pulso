/**
 * Capa state del coach IA: orquesta el cerebro puro de `features/coach` contra
 * las signals del store (arquitectura `domain ← state ← ui`: aquí cabe
 * `features/coach` y `store`, nunca `@/ui`).
 *
 * Es el port de `C.suggestWorkout` / `C.planWeek` / `C.analyzeProgress` /
 * `C.chat` / `C.applySuggestionAsRoutine` / `C.applyWeek`
 * (), sin red ni DOM: el texto se monta en `context` +
 * `prompts`, la llamada sale por `client.generate` (inyectable con
 * `CoachDeps.generateFn`) y lo único que se persiste es la memoria
 * (`patchSettings`) y las rutinas, días y `meta` del store.
 *
 * Reglas que no se pueden romper (las mismas que antes):
 *
 * - **Bucle de consulta**: solo `chat` y `analyze` pueden emitir un bloque
 *   ```consulta```; la app lo responde con `queryHistory` y repite la llamada
 *   con el MISMO `system` y el historial acumulado (`consultRounds`, 1 por
 *   defecto; 0 = ni una segunda llamada). Un bloque que no parsea se ignora:
 *   nunca rompe la tarea.
 * - **Memoria**: el bloque ```memoria``` se vuelca en `settings.ai.memory` con
 *   `applyMemoryEntries` (solo si aporta entradas nuevas) y el texto final que
 *   ve el usuario sale sin él, igual que el ```consulta```.
 * - **Sin API key → plan LOCAL**: `suggest` y `plan` se resuelven en el
 *   dispositivo con `features/coach/local` (sin llamar a `generateFn`, sin
 *   throw) y la respuesta lleva `payload` con el JSON; `chat` y `analyze` no
 *   tienen plan local, así que devuelven un aviso amable corto — tampoco sin
 *   throw, para que «probar el coach» sin key no acabe en un error rojo.
 * - **Con key pero la llamada falla**: se cae al plan local SOLO en
 *   `GeminiError` de kind `auth`/`network`/`quota` y SOLO en `suggest`/`plan`
 *   (misma idea que el `.catch`, que devolvía el local con «IA no
 *   disponible»); `blocked`/`parse`/`empty`/`http` se propagan porque son
 *   fallos que el usuario debe ver, no un plan que disfraza un error.
 *   Ese caída **se MARCA** en el outcome (`origin: 'local'` + `fallback` con el
 *   `kind` y el mensaje), para que la vista no lo pinte con el pie «Coach IA»
 *   ni tire el aviso «IA no disponible» al reescribir el texto con el rationale
 *   (era el bug P2 del diagnóstico `_specs/chat-coach-diagnostico.md`).
 * - **Historial de la conversación**: `opts.history` viaja en las CUATRO
 *   tareas como `contents` de Gemini (`buildRequest` lo acota a 12 turnos en
 *   `chat` y 6 en el resto, y `client.buildBody` lo normaliza). Antes solo lo
 *   recibía `chat`, así que «ten en cuenta los récords que te pasé antes» era
 *   imposible desde el chip (P1); después se metía como bloque de texto DENTRO
 *   del prompt, que era más caro y se leía como una instrucción más.
 * - El costo se mide con `deps.now` (inyectable), no con `Date.now()` suelto.
 */
import { weeklySeries } from '@/domain/analytics';
import type { AIExerciseProposal } from '@/domain/ai-exercise';
import {
  addDays,
  dowLong,
  iso,
  label as dateLabel,
  nowTs,
  startOfWeek,
  today,
} from '@/domain/dates';
import { fmtVol } from '@/domain/format';
import { matchExercise, unresolvedName } from '@/domain/match';
import type { UnresolvedName } from '@/domain/match';
import { int, num } from '@/domain/num';
import { sanitizePrescription } from '@/domain/prescription';
import { freshSupersetIds } from '@/domain/supersets';
import { norm, trunc } from '@/domain/text';
import type { Exercise, RoutineItem, Session, Settings } from '@/domain/types';
import { GeminiError, generate, thinkingTimeoutMs } from '@/features/coach/client';
import type { ChatMsg, GenOpts, GenResult } from '@/features/coach/client';
import { buildContext } from '@/features/coach/context';
import { queryHistory } from '@/features/coach/history';
import type { HistoryQuery } from '@/features/coach/history';
import { localSuggest, localWeek, summarizeLocal } from '@/features/coach/local';
import type { LocalParams, PlanJSON, SuggestJSON } from '@/features/coach/local';
import { applyMemoryEntries, extractMemoryBlock } from '@/features/coach/memory';
import {
  asProposal,
  extractBlocks,
  extractCreations,
  parseJSON,
  payloadItems,
} from '@/features/coach/parse';
import {
  boundedHistory,
  buildRequest,
  CHAT_HISTORY_LIMIT,
  HISTORY_MODEL_LIMIT,
  PROMPT_HISTORY_LIMIT,
} from '@/features/coach/prompts';
import type { BuildRequestOpts, CoachRequest, CoachTask } from '@/features/coach/types';
import {
  addRoutine,
  equipment,
  exercises,
  findExercise,
  patchSettings,
  routines,
  schedule,
  sessions,
  setDay,
  setMeta,
  settings,
} from './store';
import type { Routine, ScheduleDay } from './store';

/* ---------- entradas ---------- */

/** Dependencias inyectables (para tests y para la UI: nada de red en los tests). */
export interface CoachDeps {
  /** inyectable para tests; por defecto el client real */
  generateFn?: typeof generate;
  now?: () => number;
  /** cancelación opcional para toda la tarea (se reenvía a `generate`) */
  signal?: AbortSignal;
}

/** Opciones de una tarea del coach. */
export interface CoachTaskOpts {
  /**
   * pregunta del usuario, SIEMPRE: en `chat` es el prompt entero, en el resto
   * es la cola del prompt (en crudo, sin etiqueta). De ahí los chips con la
   * caja rellena.
   */
  userText?: string;
  /**
   * historial previo del chat, en las CUATRO tareas: viaja como `contents` de
   * Gemini (12 turnos en `chat`, 6 en el resto), acotado en `buildRequest`, y
   * se calcula ANTES de apilar este turno para que no salga duplicado. Así
   * «los récords que te pasé antes» se cumple también al pedir un entreno con
   * el chip.
   */
  history?: ChatMsg[];
  /** sesiones del HISTORIAL; si falta manda el tope de la tarea (8/10/12/16) */
  maxSessions?: number;
  /** rondas de ```consulta``` permitidas (por defecto 1; 0 = sin 2ª llamada) */
  consultRounds?: number;
  /** cancelación opcional de la tarea (se reenvía a `generate`) */
  signal?: AbortSignal;
  /**
   * Aviso de «va lento» (`generate.onSlow`): la vista lo usa para decir
   * «tardando más de lo normal» con un botón de cancelar SIN cortar la
   * llamada. Se reenvía a cada llamada de la tarea.
   */
  onSlow?: () => void;
}

/** Lo que devuelve `runCoachTask`, listo para pintar en la vista del coach. */
export interface CoachOutcome {
  /**
   * quién redactó la respuesta: `model` = la IA; `local` = el planificador del
   * dispositivo (sin key o tras un fallo) o el aviso de «todavía no hay key».
   * La vista lo usa para NO vender un plan local como respuesta del coach
   * (antes el pie decía «Coach IA» y el aviso del fallback se perdía).
   */
  origin: 'model' | 'local';
  /**
   * motivo real por el que la tarea se resolvió en el dispositivo pese a tener
   * key: `kind` y mensaje del `GeminiError` que se tragó el fallback
   * (`auth`/`network`/`quota`). Sin key no hay `fallback` (no falló nada).
   */
  fallback?: { kind: GeminiError['kind']; message: string };
  /** respuesta final SIN bloques ```consulta/```memoria */
  text: string;
  /**
   * JSON de `suggest`/`plan` ya parseado: el que trae el modelo (extraído de
   * `text`, que es lo que hoy lee `CoachView`) o el que generó el planificador
   * local. Es el camino directo para «Aplicar»: no hay que volver a parsear.
   */
  payload?: unknown;
  thoughts?: string;
  finish?: string;
  usage?: GenResult['usage'];
  /** entradas nuevas persistidas en `settings.ai.memory` */
  memoryAdded: string[];
  /** consultas que el modelo pidió y se respondieron */
  consulted: string[];
  /**
   * ejercicios NUEVOS propuestos por el modelo: los del bloque ```crear``` del
   * chat (el bloque ya NO está en `text`). En `suggest`/`plan` no se rellena
   * aquí: van inline con `isNew: true` dentro del `payload` y de ahí los saca
   * la vista (`creationsFromPayload`).
   */
  creations: AIExerciseProposal[];
  /** milisegundos de la tarea entera (según `deps.now`) */
  ms: number;
}

/**
 * Razón de `unresolvedName` que marca un nombre como **creable**: el matcher no
 * lo ha vetado por atributos, simplemente no existe en la biblioteca. Es el
 * criterio de `partitionUnresolved` (tarjeta de confirmación en vez de aviso).
 */
export const CREABLE_REASON = 'no está en tu biblioteca';

/* ---------- constantes ---------- */

/** Sesiones de contexto por tarea (el mismo reparto que antes). */
const SESSIONS_BY_TASK: Record<CoachTask, number> = {
  chat: 8,
  suggest: 10,
  plan: 12,
  analyze: 16,
};

/** Niveles que entiende `GenOpts.thinkingLevel` (`AiSettings.thinkingLevel` es un string libre). */
const THINKING_LEVELS: readonly string[] = ['minimal', 'low', 'medium', 'high', 'auto'];

/** Tipos de día válidos del calendario (los mismos que `DAY_TYPES` del catálogo). */
const DAY_KEYS: readonly string[] = ['entreno', 'cardio', 'movilidad', 'descanso'];

/** Claves del bloque ```consulta``` → campo de `HistoryQuery` (el modelo escribe en castellano). */
const QUERY_ALIAS: Record<string, keyof HistoryQuery> = {
  ejercicio: 'exercise',
  exercise: 'exercise',
  tipo: 'kind',
  kind: 'kind',
  desde: 'since',
  since: 'since',
  hasta: 'until',
  until: 'until',
  limite: 'limit',
  limit: 'limit',
};

/** Semanas del análisis (el mismo tope que antes). */
const ANALYZE_WEEKS = 6;

/**
 * Tope de rondas de ```consulta```: el bucle acumula turnos y llamadas caras,
 * así que un `consultRounds` disparatado del caller no puede encadenar decenas.
 */
export const MAX_CONSULT_ROUNDS = 5;

/**
 * Tope de salida en las tareas de JSON (`suggest`/`plan`), sea cual sea el
 * `settings.ai.maxTokens` del usuario: un plan de 7 días × 6 ejercicios es un
 * JSON de kB y con los 4096 por defecto se llega al borde (finish `MAX_TOKENS`
 * = payload corto = `parse` devuelve null y se cae al plan local). No es más
 * gasto, solo es el TECHO: lo que no se usa no se factura.
 */
const JSON_TASK_MAX_TOKENS = 8192;

/**
 * Aviso cuando no hay API key y la tarea no tiene plan local. Corto y amable,
 * sin throw: la app sigue siendo utilizable a medias sin configurar nada.
 */
const NO_KEY_TEXT = [
  'Todavía no tengo API key: añade la de Google AI Studio en Ajustes → Coach AI y podré chatear y analizar tu progreso.',
  'Mientras tanto, «Sugerir entreno» y «Plan semanal» sí funcionan sin conexión: se generan aquí mismo con tus datos.',
].join(' ');

/** Fallos del modelo ante los que `suggest`/`plan` caen al plan local. */
const FALLBACK_KINDS: readonly GeminiError['kind'][] = ['auth', 'network', 'quota'];

/* ---------- helpers ---------- */

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Primer campo de `keys` que sea string no vacío (alias que el modelo puede usar). */
function firstString(obj: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/** Peso de un item propuesto: `''`/ausente = sin peso (`null`), no `0`. */
function toWeight(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = num(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Fecha de un día del plan: solo string (nada de `[object Object]` en el calendario). */
function dayIsoOf(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 10) : '';
}

/**
 * Resuelve una lista de ejercicios propuestos contra la biblioteca: acepta
 * `name`/`exercise`/`ejercicio` (los del coach IA) y `exId` (los ), con
 * el MISMO matcher que `resolveName` y `resolvePlan` (`domain/match`, umbral
 * 0,85 + veto de atributos).
 *
 * Lo que no resuelve YA NO se descarta en silencio: vuelve en `unresolved` con
 * el nombre original, la razón («no está en tu biblioteca» o el `conflict` del
 * matcher) y el candidato más parecido, para que quien aplique la propuesta
 * avise. Un solo fallo no debe borrar un ejercicio sin decir nada.
 */
function resolveItems(list: unknown): {
  items: RoutineItem[];
  unresolved: UnresolvedName[];
} {
  if (!Array.isArray(list)) return { items: [], unresolved: [] };
  const items: RoutineItem[] = [];
  const unresolved: UnresolvedName[] = [];
  for (const raw of list) {
    if (!isPlain(raw)) continue;
    const exId = firstString(raw, ['exId']);
    const name = firstString(raw, ['name', 'exercise', 'ejercicio']);
    const found = exId ? findExercise(exId) : null;
    let ex: Exercise | null = found;
    let failure: UnresolvedName | null = null;
    if (!ex) {
      if (name) {
        const match = matchExercise(name, exercises.value);
        ex = match.ex ?? null;
        if (!ex) failure = unresolvedName(name, match);
      } else if (exId) {
        /* sin nombre solo queda el id, que es como lo pinta la UI */
        failure = { name: exId, reason: 'ya no está en tu biblioteca' };
      }
    }
    if (!ex) {
      /* un objeto sin nombre ni id no es un ejercicio perdido: no hay nada que avisar */
      if (failure) unresolved.push(failure);
      continue;
    }
    /* El modelo es libre de devolver `sets: 40` o `rest: 50000`: sin este
       saneado, un JSON raro acababa guardado tal cual en una rutina. Los rangos
       son los del editor manual (`domain/exercise-draft.ts`). */
    const clean = sanitizePrescription(
      {
        sets: raw.sets === undefined ? undefined : int(raw.sets, ex.sets),
        repMin: raw.repMin === undefined ? undefined : int(raw.repMin, ex.repMin),
        repMax: raw.repMax === undefined ? undefined : int(raw.repMax, ex.repMax),
        rest: raw.rest === undefined ? undefined : int(raw.rest, ex.rest),
        weight: toWeight(raw.weight),
      },
      { sets: ex.sets, repMin: ex.repMin, repMax: ex.repMax, rest: ex.rest, weight: null },
    );
    items.push({
      exId: ex.id,
      sets: clean.sets,
      repMin: clean.repMin,
      repMax: clean.repMax,
      rest: clean.rest,
      weight: clean.weight,
      notes: typeof raw.notes === 'string' ? raw.notes : '',
      /* el coach marca el par con una letra compartida en dos ejercicios seguidos */
      ...(typeof raw.superset === 'string' && raw.superset.trim()
        ? { superset: raw.superset.trim().slice(0, 8) }
        : {}),
    });
  }
  return { items: uniqueSupersetIds(items), unresolved };
}

/**
 * Las letras del modelo (`A`, `B`…) no pueden ser el id del par: dos rutinas suyas
 * con la misma letra se fusionaban al juntarse en una sesión, y `unlinkAt` borra por
 * id, así que separar un par limpiaba también los otros runs con esa letra. Se
 * reescriben a ids propios (`ss-…`), uno por run consecutivo. La letra que se pinta
 * («SS A») sale del orden del grupo, no del id, así que no se pierde nada.
 */
function uniqueSupersetIds(items: RoutineItem[]): RoutineItem[] {
  const used = items.map((item) => item.superset ?? '').filter(Boolean);
  return freshSupersetIds(items, used);
}

/**
 * `notes` de una rutina propuesta: lo que traiga el objeto + el `rationale`
 * concatenado, separados con ` | ` y sin trozos vacíos (antes dejaba un `|`
 * suelto cuando no había `notes`).
 */
function joinNotes(notes: string, rationale: string): string {
  return [notes.trim(), rationale.trim()].filter(Boolean).join(' | ');
}

/** El `rationale` del modelo: array de frases o una frase suelta. */
function rationaleText(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .filter((line): line is string => typeof line === 'string' && line.trim() !== '')
      .join(' ')
      .trim();
  }
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Origen que se guarda en la RUTINA: `'ia'` manda y lo que traía
 * `localSuggest`/`localWeek` (`'local'`) se guarda como `'generador'`, que es
 * como antes etiquetaba lo nacido en el planificador del dispositivo
 * (`sug.source === 'ia' ? 'ia': 'generador'`). El resto de orígenes pasa tal
 * cual, para no pisar rutinas importadas o manuales.
 */
function routineSource(raw: string): string {
  if (raw === 'local') return 'generador';
  return raw || 'ia';
}

/**
 * Tolerante al formato del bloque ```consulta```: el modelo escribe en
 * castellano (`ejercicio`, `tipo`, `desde`, `hasta`, `limite`), pero también
 * se aceptan las claves en inglés de `HistoryQuery`. Devuelve `null` si no hay
 * nombre de ejercicio (eso no debe romper la tarea).
 */
function parseQuery(block: string): HistoryQuery | null {
  let raw: unknown;
  try {
    raw = parseJSON<unknown>(block);
  } catch {
    return null;
  }
  if (!isPlain(raw)) return null;

  const mapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const target = QUERY_ALIAS[key];
    if (target) mapped[target] = value;
  }
  const exercise = firstString(mapped, ['exercise']);
  if (!exercise) return null;

  const query: HistoryQuery = { exercise };
  const kind = mapped.kind;
  if (kind === 'full' || kind === 'reciente' || kind === 'evolucion') query.kind = kind;
  if (typeof mapped.since === 'string' && mapped.since) query.since = mapped.since.slice(0, 10);
  if (typeof mapped.until === 'string' && mapped.until) query.until = mapped.until.slice(0, 10);
  const limit = num(mapped.limit, 0);
  if (limit > 0) query.limit = Math.trunc(limit);
  return query;
}

/** Bloque extra del contexto, igual que antes (`DÍA DE HOY` / `SEMANA OBJETIVO`). */
function contextExtra(
  task: CoachTask,
  todayIso: string,
  from: string,
  to: string,
): string | undefined {
  if (task === 'suggest') return `DÍA DE HOY: ${dateLabel(todayIso)} (${dowLong(todayIso)})`;
  if (task === 'plan') return `SEMANA OBJETIVO: ${from} → ${to}`;
  return undefined;
}

/** Brief de volumen semanal del análisis (el mismo formato de `C.analyzeProgress`). */
function weeklyBrief(list: readonly Session[], weeks: number, todayIso: string): string {
  return weeklySeries(list, weeks, todayIso)
    .map(
      (week) =>
        `${week.label}: ${fmtVol(week.volume)} kg, ${week.sessions} sesiones, ${week.sets} series`,
    )
    .join('\n');
}

/**
 * Copia de `settings.ai` con los ajustes que `GenOpts` entiende.
 *
 * Exportado como `aiGenOptions` (contrato de Fase 0, spec
 * `_specs/creacion-ejercicios-plan.md` §3.3): el generador de ejercicios arma
 * sus `GenOpts` con la MISMA key, modelo y thinking que el coach sin duplicar
 * estas líneas ni tocar `features/coach/client.ts`.
 *
 * No manda `temperature`: desde Gemini 3.6 la API la ignora (y la rechazará en
 * generaciones futuras), así que el ajuste se retiró de la app entera.
 */
/**
 * Tope de espera por intento: `ai.timeoutSec` manda (0 o vacío = automático)
 * y, si no lo ha fijado el usuario, el del nivel de pensamiento. Se acota a
 * 600 s para que un valor absurdo no deje la app esperando para siempre.
 */
function timeoutFor(ai: Settings['ai']): number {
  const manual = num(ai.timeoutSec, 0);
  if (manual > 0) return Math.round(Math.min(600, Math.max(1, manual)) * 1000);
  return thinkingTimeoutMs(ai.thinkingLevel);
}

export function aiGenOptions(ai: Settings['ai'], req: CoachRequest): GenOpts {
  const opts: GenOpts = {
    apiKey: String(ai.apiKey ?? ''),
    model: String(ai.model ?? ''),
    system: req.system,
    prompt: req.prompt,
    json: req.json,
    maxOutputTokens: int(ai.maxTokens, 4096),
    timeoutMs: timeoutFor(ai),
  };
  if (THINKING_LEVELS.includes(ai.thinkingLevel)) {
    opts.thinkingLevel = ai.thinkingLevel as GenOpts['thinkingLevel'];
  }
  /* El esquema viaja con las tareas JSON (`suggest`/`plan`): `client.buildBody`
     solo lo manda si además se pide `responseMimeType: application/json` */
  if (req.json && req.responseSchema) opts.responseSchema = req.responseSchema;
  if (ai.includeThoughts) opts.includeThoughts = true;
  return opts;
}

/* ---------- plan local (sin IA) ---------- */

/** ¿Es una de las dos tareas que el planificador local sabe resolver solo? */
function isLocalTask(task: CoachTask): task is 'suggest' | 'plan' {
  return task === 'suggest' || task === 'plan';
}

/** ¿Es un fallo del modelo del tipo que compensa caer al plan local? */
function isFallbackError(err: unknown): err is GeminiError {
  return err instanceof GeminiError && FALLBACK_KINDS.includes(err.kind);
}

/**
 * Genera la propuesta en el dispositivo con el MISMO snapshot de estado que
 * usaría el modelo: la foto (`base`) que `runCoachTask` tomó al empezar, no una
 * lectura de las signals llegado el momento (si el usuario cambia el material
 * a mitad de una llamada cara, la propuesta sigue siendo coherente con lo que
 * se le contó al modelo).
 */
function buildLocal(
  task: CoachTask,
  base: Omit<LocalParams, 'todayIso'>,
  todayIso: string,
  from: string,
): SuggestJSON | PlanJSON {
  const params: LocalParams = { ...base, todayIso };
  return task === 'suggest' ? localSuggest(params) : localWeek({ ...params, from });
}

/**
 * `CoachOutcome` de una propuesta local.
 *
 * `text` es el resumen legible (título + rationale) y DEBAJO lleva el JSON en
 * una cercilla ```json: las vistas de hoy leen `outcome.text` con `parseJSON`
 * (`RoutinesView`, `CalendarView` y `CoachView`), que es tolerante y se queda
 * con el trozo JSON, así que «Aplicar» sigue funcionando sin tocar la UI. El
 * JSON ya parseado va además en `payload`, que es el camino directo.
 *
 * `origin` sale SIEMPRE `'local'` y, si la caída fue por un fallo de la API
 * (`cause`), `fallback` conserva `kind` y mensaje: es lo que la vista traduce
 * en «Plan local (sin IA) · IA no disponible: …» en vez del pie «Coach IA».
 */
function localOutcome(payload: SuggestJSON | PlanJSON, ms: number, cause?: unknown): CoachOutcome {
  const note = cause instanceof Error ? `IA no disponible: ${cause.message}` : '';
  const text = [summarizeLocal(payload), note].filter((line) => line.trim() !== '').join('\n\n');
  const outcome: CoachOutcome = {
    origin: 'local',
    text: `${text}\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``,
    payload,
    memoryAdded: [],
    consulted: [],
    creations: [],
    ms,
  };
  /* el motivo NO se pierde: la vista lo enseña en el pie y en el aviso, que es
     lo que antes desaparecía al reescribirse el texto con el rationale */
  if (cause instanceof GeminiError) outcome.fallback = { kind: cause.kind, message: cause.message };
  return outcome;
}

/**
 * JSON de `suggest`/`plan` ya parseado de la respuesta del modelo, con el mismo
 * criterio que `payloadOf` de CoachView: si no parece una propuesta (o no es
 * JSON), no hay payload y manda lo que la vista saque del texto.
 */
function extractPayload(task: CoachTask, text: string): unknown {
  if (!isLocalTask(task)) return undefined;
  let raw: unknown;
  try {
    raw = parseJSON<unknown>(text);
  } catch {
    return undefined;
  }
  if (!isPlain(raw)) return undefined;
  const list = raw.exercises ?? raw.items ?? raw.days;
  return Array.isArray(list) ? raw : undefined;
}

/* ---------- la tarea ---------- */

/**
 * Ejecuta una tarea del coach y devuelve la respuesta ya limpia.
 *
 * Flujo: contexto → `buildRequest` → `generate` → (bucle de consultas) →
 * memoria → `CoachOutcome`. Las señales se leen al empezar, así que la tarea
 * entera trabaja contra una foto del estado.
 *
 * Sin API key no se llega a `buildRequest` en `suggest`/`plan`: el plan sale
 * del dispositivo (`buildLocal`) y `generateFn` no se invoca ni siquiera
 * mockeado. Con key, un fallo `auth`/`network`/`quota` en esas dos tareas cae
 * en el mismo sitio (ver la cabecera del módulo).
 */
export async function runCoachTask(
  task: CoachTask,
  opts: CoachTaskOpts = {},
  deps: CoachDeps = {},
): Promise<CoachOutcome> {
  const clock = deps.now ?? Date.now;
  const t0 = clock();
  const st = settings.value;
  const ai = st.ai;
  const hasKey = String(ai.apiKey ?? '').trim() !== '';

  /* foto del estado para la tarea entera (la misma para el modelo, para la
     propuesta que se le pasa como base y para el planificador local, que se usa
     sin key o si la llamada falla) */
  const snap: Omit<LocalParams, 'todayIso'> = {
    settings: st,
    exercises: exercises.value,
    equipment: equipment.value,
    sessions: sessions.value,
  };

  /* 1 · contexto (también lo necesita el plan local: la fecha de hoy) */
  const todayIso = iso(new Date(clock()));
  const from = startOfWeek(todayIso);
  const to = addDays(from, 6);

  /* 0 · sin API key: NADA de red */
  if (!hasKey) {
    if (isLocalTask(task)) {
      return localOutcome(buildLocal(task, snap, todayIso, from), clock() - t0);
    }
    return {
      origin: 'local',
      text: NO_KEY_TEXT,
      memoryAdded: [],
      consulted: [],
      creations: [],
      ms: clock() - t0,
    };
  }
  const ctx = buildContext({
    settings: st,
    sessions: snap.sessions,
    routines: routines.value,
    schedule: schedule.value,
    equipment: snap.equipment,
    exercises: snap.exercises,
    opts: {
      todayIso,
      maxSessions: opts.maxSessions ?? SESSIONS_BY_TASK[task],
      extra: contextExtra(task, todayIso, from, to),
    },
  });

  /* 2 · petición */
  const reqOpts: BuildRequestOpts = {
    context: ctx,
    system: String(ai.systemPrompt ?? ''),
    unit: st.units,
    goal: st.goal,
    daysPerWeek: st.daysPerWeek,
    /* solo se le pide al modelo emparejar si el usuario quiere superseries */
    supersets: st.supersets,
  };
  /* La pregunta viaja en TODAS las tareas (antes solo en chat/analyze, y así el
     `ask` de los chips de acción rápida se perdía en suggest/plan): en chat es
     el prompt entero y en el resto cierra el prompt, en crudo y sin etiqueta.
     NO se mete además en `history`: `buildRequest` la pone en el prompt, que es
     el turno final — duplicarla daría el mismo mensaje dos veces.
     El historial previo viaja TAMBIÉN en las cuatro tareas, ya acotado por
     `buildRequest` (12 turnos en chat, 6 en el resto) y como `contents` de
     Gemini en todas. */
  reqOpts.question = opts.userText ?? '';
  reqOpts.history = opts.history ?? [];
  if (task === 'plan') {
    reqOpts.from = from;
    reqOpts.to = to;
  }
  if (task === 'analyze') {
    reqOpts.weeks = ANALYZE_WEEKS;
    reqOpts.weeklyBrief = weeklyBrief(snap.sessions, ANALYZE_WEEKS, todayIso);
  }
  /* La propuesta del dispositivo viaja como DATO de apertura del prompt (ver
     `localHead` en `prompts.ts`): el modelo la recibe primero y la mejora o
     corrige, en vez de partir de cero. Se calcula con la MISMA foto de estado
     (`snap`) que el resto de la tarea, así que si el usuario cambia el material
     a mitad de la llamada la base sigue siendo coherente con lo que se le
     contó al modelo. Es cálculo puro y barato: no toca la red. */
  if (isLocalTask(task)) reqOpts.local = buildLocal(task, snap, todayIso, from);
  const req = buildRequest(task, reqOpts);
  const base = aiGenOptions(ai, req);
  /* El tope de Ajustes manda en chat/analyze; en suggest/plan (JSON largo) no
     puede bajar del mínimo — el `?? 4096` es el default de `aiGenOptions`.
     `maxOutputTokens` incluye los tokens de pensamiento, así que con thinking
     alto el JSON podía quedarse sin sitio: el techo alto no cuesta más (solo se
     factura lo generado) y evita que un plan de 7 días se corte a medias. */
  if (task === 'suggest' || task === 'plan') {
    base.maxOutputTokens = Math.max(base.maxOutputTokens ?? 4096, JSON_TASK_MAX_TOKENS);
  }

  /* 3 · llamada (sin key no se llega aquí; el fallo de la PRIMERA llamada en
     suggest/plan se resuelve con el plan local, ver cabecera del módulo) */
  const genFn: typeof generate = deps.generateFn ?? generate;
  const signal = opts.signal ?? deps.signal;
  const consultable = task === 'chat' || task === 'analyze';
  const rounds = consultable
    ? Math.min(MAX_CONSULT_ROUNDS, Math.max(0, int(opts.consultRounds ?? 1, 1)))
    : 0;
  const consulted: string[] = [];
  /* tope de turnos de ESTA tarea (el mismo que ya aplicó `buildRequest`) y
     turnos que AÑADE el bucle de consulta, aparte, para poder reservarles sitio
     en cada vuelta (ver más abajo) */
  const limit = task === 'chat' ? CHAT_HISTORY_LIMIT : PROMPT_HISTORY_LIMIT;
  let kept: ChatMsg[] = req.history ?? [];
  const extra: ChatMsg[] = [];

  let prompt = req.prompt;
  let history: ChatMsg[] = kept;
  let res: GenResult;
  try {
    res = await genFn({
      ...base,
      ...(history.length ? { history } : {}),
      ...(signal ? { signal } : {}),
      ...(opts.onSlow ? { onSlow: opts.onSlow } : {}),
    });
  } catch (err) {
    /* Cancelado por el usuario: NO se rescata con el plan local. El usuario ya
       dijo que no quiere seguir esperando, así que la vista avisa del corte en
       vez de enseñarle un plan que no pidió. */
    if (signal?.aborted) throw err;
    if (isLocalTask(task) && isFallbackError(err)) {
      return localOutcome(buildLocal(task, snap, todayIso, from), clock() - t0, err);
    }
    throw err;
  }
  let text: string;

  /* 4 · bucle de consulta: el MISMO system y el historial ACOTADO al tope de la
     tarea. Cada vuelta reserva 2 huecos para sus turnos nuevos: sin ese ajuste
     la 2ª llamada salía con 14 mensajes cuando el chat admite 12, y la API la
     habría rechazado (o, peor, el modelo habría leído el doble de conversación
     de la que le habíamos dicho que recordara). */
  for (let round = 0; ; round++) {
    const { rest, blocks } = extractBlocks(res.text, 'consulta');
    if (!blocks.length || round >= rounds) {
      text = rest;
      break;
    }
    const answers: string[] = [];
    for (const block of blocks) {
      const query = parseQuery(block);
      if (!query) continue; /* un bloque ilegible no rompe la tarea */
      consulted.push(query.exercise);
      answers.push(
        queryHistory(snap.sessions, query, { unit: st.units, exercises: snap.exercises }),
      );
    }
    if (!answers.length) {
      text = rest;
      break;
    }
    const message = `DATOS DE LA CONSULTA:\n${answers.join('\n\n')}\n\nContinúa con tu respuesta.`;
    /* El turno del usuario entra SIN recortar: es la petición completa (en
       `analyze` trae además las instrucciones de formato), y recortarla dejaría
       la 2ª llamada sin las reglas. La respuesta del modelo sí se acota: solo
       aporta lo que pidió, no su prosa entera. */
    extra.push(
      { role: 'user', text: prompt },
      { role: 'model', text: trunc(res.text, HISTORY_MODEL_LIMIT) },
    );
    /* `extra` crece una pareja por ronda: se recortan las más antiguas para que
       el historial final NUNCA supere el tope de la tarea. Después `kept` solo
       ocupa el hueco que deja `extra`, así que la suma cabe en `limit`. */
    if (extra.length > limit) extra.splice(0, extra.length - limit);
    kept = boundedHistory(kept, Math.max(0, limit - extra.length));
    history = [...kept, ...extra];
    prompt = message;
    res = await genFn({
      ...base,
      prompt,
      history,
      ...(signal ? { signal } : {}),
      ...(opts.onSlow ? { onSlow: opts.onSlow } : {}),
    });
  }

  /* 5 · memoria: se vuelca y se quita del texto final. `extractMemoryBlock`
     exige que el bloque CIERRE la respuesta: citar el formato a mitad de una
     explicación no es un aprendizaje. */
  const { rest: clean, block: memoryBlock } = extractMemoryBlock(text);
  const memoryAdded: string[] = [];
  if (memoryBlock) {
    const update = applyMemoryEntries(String(st.ai.memory ?? ''), memoryBlock);
    memoryAdded.push(...update.added);
    if (memoryAdded.length) {
      patchSettings({ ai: { ...settings.value.ai, memory: update.memory } });
    }
  }

  /* 6 · ejercicios nuevos: el bloque ```crear``` sale del texto (mismo truco que
     la memoria) y viaja aparte, para que la vista pinte su tarjeta de
     confirmación — aquí NUNCA se crea nada, eso es un clic del usuario */
  const { rest: finalText, creations } = extractCreations(clean);

  /* 7 · una tarea JSON sin JSON utilizable cae al plan local en vez de dejar al
     usuario con «no devolvió una sugerencia legible». Pasa sobre todo cuando el
     thinking alto consume el presupuesto y el `finishReason` es `MAX_TOKENS`:
     el cliente devuelve el texto parcial a propósito (para que el chat pueda
     enseñarlo), pero en `suggest`/`plan` un JSON a medias no sirve de nada. */
  const payload = extractPayload(task, clean);
  if (isLocalTask(task) && payload === undefined) {
    const cortado = res.finish === 'MAX_TOKENS';
    const cause = new GeminiError(
      'parse',
      cortado
        ? 'La propuesta se cortó por el límite de tokens y no se pudo interpretar'
        : 'La propuesta no traía un JSON interpretable',
    );
    return localOutcome(buildLocal(task, snap, todayIso, from), clock() - t0, cause);
  }

  return {
    origin: 'model',
    text: finalText.trim(),
    payload,
    thoughts: res.thoughts,
    finish: res.finish,
    usage: res.usage,
    memoryAdded,
    consulted,
    creations,
    ms: clock() - t0,
  };
}

/* ---------- aplicar resultados ---------- */

/** Resultado de aplicar una propuesta del coach: la rutina + lo que no resolvió. */
export interface SuggestionOutcome {
  /** `null` si la entrada ni siquiera parece una sugerencia o no quedó NI UN ejercicio */
  routine: Routine | null;
  /** nombres propuestos que NO se asociaron a ningún ejercicio: avisar, no callar */
  unresolved: UnresolvedName[];
}

/**
 * Convierte una sugerencia del coach en una rutina guardada (`source: 'ia'`, o
 * `'generador'` cuando la propuesta vino del planificador local).
 *
 * Valida `{title, focus?, rationale?, source?, notes?, exercises|items:[…]}`,
 * resuelve cada `name` contra la biblioteca con `resolveItems` y devuelve la
 * rutina junto con los `unresolved` — antes lo que no resolvía desaparecía sin
 * más, y ahora la vista puede decir exactamente qué se cayó y por qué.
 */
export function applySuggestionAsRoutine(sug: unknown): SuggestionOutcome {
  if (!isPlain(sug)) return { routine: null, unresolved: [] };
  const list = Array.isArray(sug.exercises)
    ? sug.exercises
    : Array.isArray(sug.items)
      ? sug.items
      : null;
  if (!list) return { routine: null, unresolved: [] };
  const { items, unresolved } = resolveItems(list);
  if (!items.length) return { routine: null, unresolved };

  const source = routineSource(firstString(sug, ['source']));
  const focus = firstString(sug, ['focus']);
  const rationale = rationaleText(sug.rationale);
  const notes = joinNotes(firstString(sug, ['notes']), rationale);
  const routine = addRoutine({
    name: firstString(sug, ['title']) || 'Rutina del coach',
    focus,
    source,
    notes,
    items,
  });
  return { routine, unresolved };
}

/**
 * Aplica un plan semanal del coach: cada día apunta el calendario
 * (`status: 'rest'` para `descanso`, `'planned'` para el resto, como antes) y,
 * si el día trae ejercicios reconocibles, se crea su rutina (`source: 'ia'` o
 * `'generador'` para el plan local, nombre `título · fecha`) y se enlaza con
 * `routineId`.
 *
 * Devuelve cuántos días se escribieron, cuántas rutinas se crearon y —acumulado
 * de TODOS los días— los nombres que no se asociaron a ningún ejercicio: un plan
 * no puede perder ejercicios sin que la vista lo cuente. Un plan sin `days` no
 * toca nada ni siquiera `meta`.
 *
 * Los días ANTERIORES a hoy se descartan (`skipped`): un plan de la semana en
 * curso llega con el lunes ya pasado, y aplicarlo sobrescribía el calendario de
 * días que ya ocurrieron. Las fechas se comparan como ISO local, así que el
 * orden lexicográfico es el cronológico. `todayIso` se expone para poder probar
 * el corte sin depender del reloj.
 */
export function applyWeek(
  plan: unknown,
  todayIso: string = today(),
): {
  days: number;
  routines: number;
  unresolved: UnresolvedName[];
  /** días del plan que se ignoraron por ser anteriores a hoy */
  skipped: number;
} {
  const out: {
    days: number;
    routines: number;
    unresolved: UnresolvedName[];
    skipped: number;
  } = {
    days: 0,
    routines: 0,
    unresolved: [],
    skipped: 0,
  };
  if (!isPlain(plan) || !Array.isArray(plan.days)) return out;

  const source = firstString(plan, ['source']) || 'ia';
  for (const raw of plan.days) {
    if (!isPlain(raw)) continue;
    const dayIso = dayIsoOf(raw.date) || dayIsoOf(raw.iso);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayIso)) continue;
    if (dayIso < todayIso) {
      out.skipped++;
      continue;
    }

    const list = Array.isArray(raw.exercises) ? raw.exercises : raw.items;
    const { items, unresolved } = resolveItems(list);
    out.unresolved.push(...unresolved);
    const type =
      typeof raw.type === 'string' && DAY_KEYS.includes(raw.type)
        ? raw.type
        : items.length
          ? 'entreno'
          : 'descanso';
    const title = firstString(raw, ['title']) || (type === 'descanso' ? 'Descanso' : 'Entreno');
    const focus = firstString(raw, ['focus']);
    const patch: ScheduleDay = {
      type,
      title,
      status: type === 'descanso' ? 'rest' : 'planned',
      focus,
      source,
    };
    if (items.length) {
      const routine = addRoutine({
        name: `${title} · ${dateLabel(dayIso, 'medium')}`,
        focus,
        source: routineSource(source),
        notes: `Plan semanal (${source})`,
        items,
      });
      patch.routineId = routine.id;
      out.routines++;
    }
    setDay(dayIso, patch);
    out.days++;
  }

  setMeta({ lastPlanAt: nowTs() });
  return out;
}

/* ---------- propuestas de ejercicios nuevos al aplicar ---------- */

/**
 * Parte lo que no se resolvió al aplicar una propuesta:
 *
 * - **creable**: `reason === 'no está en tu biblioteca'` → la vista pinta la
 *   tarjeta de confirmación con los atributos que traía el payload (o los que
 *   se infieran del nombre);
 * - **warnings**: el veto por conflicto de atributos («… inclinado») sigue
 *   siendo SOLO un aviso, como hasta ahora: es un nombre mal dicho, no un
 *   ejercicio nuevo.
 *
 * Pura y aparte a propósito: `resolveItems`/`applySuggestionAsRoutine`/
 * `applyWeek` conservan SU forma (`{items, unresolved}`, `{routine, unresolved}`
 * y `{days, routines, unresolved}`), que es la que fijan sus tests.
 *
 * Los atributos del ejercicio se leen con `asProposal` (el mismo normalizador
 * del bloque ```crear```) en vez de con una copia local: eran dos funciones
 * idénticas y solo una estaba probada.
 */
export function partitionUnresolved(
  unresolved: readonly UnresolvedName[],
  payload: unknown,
): { creatable: AIExerciseProposal[]; warnings: UnresolvedName[] } {
  const items = payloadItems(payload);
  const creatable: AIExerciseProposal[] = [];
  const warnings: UnresolvedName[] = [];
  const seen = new Set<string>();

  for (const item of unresolved) {
    if (item.reason !== CREABLE_REASON) {
      warnings.push(item);
      continue;
    }
    const key = norm(item.name);
    if (seen.has(key)) continue; /* el mismo nombre dos veces = UNA tarjeta */
    seen.add(key);
    const raw = items.find(
      (candidate) =>
        typeof candidate.name === 'string' && norm(candidate.name.trim()) === norm(item.name),
    );
    creatable.push(asProposal(raw ?? { name: item.name }) ?? { name: item.name });
  }
  return { creatable, warnings };
}

/** ¿Hay API key configurada? (la mira en `settings.ai.apiKey`, como `C.hasKey`). */
export function hasApiKey(): boolean {
  return String(settings.value.ai.apiKey ?? '').trim() !== '';
}
