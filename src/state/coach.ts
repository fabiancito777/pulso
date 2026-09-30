/**
 * Capa state del coach IA: orquesta el cerebro puro de `features/coach` contra
 * las signals del store (arquitectura `domain ← state ← ui`: aquí cabe
 * `features/coach` y `store`, nunca `@/ui`).
 *
 * Es el port de `C.suggestWorkout` / `C.planWeek` / `C.analyzeProgress` /
 * `C.chat` / `C.applySuggestionAsRoutine` / `C.applyWeek` de la v1
 * (`legacy/js/coach.js`), sin red ni DOM: el texto se monta en `context` +
 * `prompts`, la llamada sale por `client.generate` (inyectable con
 * `CoachDeps.generateFn`) y lo único que se persiste es la memoria
 * (`patchSettings`) y las rutinas, días y `meta` del store.
 *
 * Reglas que no se pueden romper (las mismas que la v1):
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
 *   (misma idea que el `.catch` de la v1, que devolvía el local con «IA no
 *   disponible»); `blocked`/`parse`/`empty`/`http` se propagan porque son
 *   fallos que el usuario debe ver, no un plan que disfraza un error.
 * - El costo se mide con `deps.now` (inyectable), no con `Date.now()` suelto.
 */
import { weeklySeries } from '@/domain/analytics';
import { findExerciseByName } from '@/domain/data';
import { addDays, dowLong, iso, label as dateLabel, nowTs, startOfWeek } from '@/domain/dates';
import { fmtVol } from '@/domain/format';
import { int, num } from '@/domain/num';
import type { RoutineItem, Session, Settings } from '@/domain/types';
import { GeminiError, generate } from '@/features/coach/client';
import type { ChatMsg, GenOpts, GenResult } from '@/features/coach/client';
import { buildContext } from '@/features/coach/context';
import { queryHistory } from '@/features/coach/history';
import type { HistoryQuery } from '@/features/coach/history';
import { localSuggest, localWeek, summarizeLocal } from '@/features/coach/local';
import type { LocalParams, PlanJSON, SuggestJSON } from '@/features/coach/local';
import { applyMemoryEntries } from '@/features/coach/memory';
import { extractBlocks, parseJSON } from '@/features/coach/parse';
import { buildRequest } from '@/features/coach/prompts';
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
}

/** Opciones de una tarea del coach. */
export interface CoachTaskOpts {
  /** pregunta del usuario (chat y analyze) */
  userText?: string;
  /** historial previo del chat (en chat se recorta a los últimos 12 mensajes) */
  history?: ChatMsg[];
  /** sesiones del HISTORIAL; si falta manda el tope de la tarea (8/10/12/16) */
  maxSessions?: number;
  /** rondas de ```consulta``` permitidas (por defecto 1; 0 = sin 2ª llamada) */
  consultRounds?: number;
}

/** Lo que devuelve `runCoachTask`, listo para pintar en la vista del coach. */
export interface CoachOutcome {
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
  /** milisegundos de la tarea entera (según `deps.now`) */
  ms: number;
}

/* ---------- constantes ---------- */

/** Sesiones de contexto por tarea (el mismo reparto que la v1). */
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

/** Semanas del análisis (el mismo tope que la v1). */
const ANALYZE_WEEKS = 6;

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
 * `name`/`exercise`/`ejercicio` (los del coach IA) y `exId` (los de la v1), y
 * los que no resuelvan se OMITEN (mismo criterio que `mapItems` de la v1).
 */
function resolveItems(list: unknown): RoutineItem[] {
  if (!Array.isArray(list)) return [];
  const items: RoutineItem[] = [];
  for (const raw of list) {
    if (!isPlain(raw)) continue;
    const exId = firstString(raw, ['exId']);
    const name = firstString(raw, ['name', 'exercise', 'ejercicio']);
    const found = exId ? findExercise(exId) : null;
    const ex = found ?? (name ? findExerciseByName(exercises.value, name) : null);
    if (!ex) continue;
    items.push({
      exId: ex.id,
      sets: int(raw.sets, ex.sets),
      repMin: int(raw.repMin, ex.repMin),
      repMax: int(raw.repMax, ex.repMax),
      rest: int(raw.rest, ex.rest),
      weight: toWeight(raw.weight),
      notes: typeof raw.notes === 'string' ? raw.notes : '',
    });
  }
  return items;
}

/**
 * `notes` de una rutina propuesta: lo que traiga el objeto + el `rationale`
 * concatenado, separados con ` | ` y sin trozos vacíos (la v1 dejaba un `|`
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
 * como la v1 etiquetaba lo nacido en el planificador del dispositivo
 * (`sug.source === 'ia' ? 'ia' : 'generador'`). El resto de orígenes pasa tal
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

/** Bloque extra del contexto, igual que la v1 (`DÍA DE HOY` / `SEMANA OBJETIVO`). */
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

/** Copia de `settings.ai` con los ajustes que `GenOpts` entiende. */
function genOptions(ai: Settings['ai'], req: CoachRequest): GenOpts {
  const opts: GenOpts = {
    apiKey: String(ai.apiKey ?? ''),
    model: String(ai.model ?? ''),
    system: req.system,
    prompt: req.prompt,
    json: req.json,
    temperature: num(ai.temperature, 0.7),
    maxOutputTokens: int(ai.maxTokens, 4096),
  };
  if (THINKING_LEVELS.includes(ai.thinkingLevel)) {
    opts.thinkingLevel = ai.thinkingLevel as GenOpts['thinkingLevel'];
  }
  const budget = String(ai.thinkingBudget ?? '').trim();
  if (budget) opts.thinkingBudget = int(budget, -1);
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
 */
function localOutcome(payload: SuggestJSON | PlanJSON, ms: number, cause?: unknown): CoachOutcome {
  const note = cause instanceof Error ? `IA no disponible: ${cause.message}` : '';
  const text = [summarizeLocal(payload), note].filter((line) => line.trim() !== '').join('\n\n');
  return {
    text: `${text}\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``,
    payload,
    memoryAdded: [],
    consulted: [],
    ms,
  };
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

  /* foto del estado para la tarea entera (la misma para el modelo y para el
     planificador local, que se usa sin key o si la llamada falla) */
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
    return { text: NO_KEY_TEXT, memoryAdded: [], consulted: [], ms: clock() - t0 };
  }
  const ctx = buildContext({
    settings: st,
    sessions: sessions.value,
    routines: routines.value,
    schedule: schedule.value,
    equipment: equipment.value,
    exercises: exercises.value,
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
  };
  if (task === 'chat' || task === 'analyze') reqOpts.question = opts.userText ?? '';
  if (task === 'chat') reqOpts.history = opts.history ?? [];
  if (task === 'plan') {
    reqOpts.from = from;
    reqOpts.to = to;
  }
  if (task === 'analyze') {
    reqOpts.weeks = ANALYZE_WEEKS;
    reqOpts.weeklyBrief = weeklyBrief(sessions.value, ANALYZE_WEEKS, todayIso);
  }
  const req = buildRequest(task, reqOpts);
  const base = genOptions(ai, req);

  /* 3 · llamada (sin key no se llega aquí; el fallo de la PRIMERA llamada en
     suggest/plan se resuelve con el plan local, ver cabecera del módulo) */
  const genFn: typeof generate = deps.generateFn ?? generate;
  const consultable = task === 'chat' || task === 'analyze';
  const rounds = consultable ? Math.max(0, int(opts.consultRounds ?? 1, 1)) : 0;
  const consulted: string[] = [];

  let prompt = req.prompt;
  let history: ChatMsg[] | undefined = req.history;
  let res: GenResult;
  try {
    res = await genFn({ ...base, ...(history?.length ? { history } : {}) });
  } catch (err) {
    if (isLocalTask(task) && isFallbackError(err)) {
      return localOutcome(buildLocal(task, snap, todayIso, from), clock() - t0, err);
    }
    throw err;
  }
  let text: string;

  /* 4 · bucle de consulta: el MISMO system, historial acumulado */
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
        queryHistory(sessions.value, query, { unit: st.units, exercises: exercises.value }),
      );
    }
    if (!answers.length) {
      text = rest;
      break;
    }
    const message = `DATOS DE LA CONSULTA:\n${answers.join('\n\n')}\n\nContinúa con tu respuesta.`;
    history = [
      ...(history ?? []),
      { role: 'user', text: prompt },
      { role: 'model', text: res.text },
    ];
    prompt = message;
    res = await genFn({ ...base, prompt, history });
  }

  /* 5 · memoria: se vuelca y se quita del texto final */
  const { rest: clean, blocks: memoryBlocks } = extractBlocks(text, 'memoria');
  const memoryAdded: string[] = [];
  if (memoryBlocks.length) {
    let memory = String(settings.value.ai.memory ?? '');
    for (const block of memoryBlocks) {
      if (!block.trim()) continue;
      const update = applyMemoryEntries(memory, block);
      memory = update.memory;
      memoryAdded.push(...update.added);
    }
    if (memoryAdded.length) {
      patchSettings({ ai: { ...settings.value.ai, memory } });
    }
  }

  return {
    text: clean.trim(),
    payload: extractPayload(task, clean),
    thoughts: res.thoughts,
    finish: res.finish,
    usage: res.usage,
    memoryAdded,
    consulted,
    ms: clock() - t0,
  };
}

/* ---------- aplicar resultados ---------- */

/**
 * Convierte una sugerencia del coach en una rutina guardada (`source: 'ia'`, o
 * `'generador'` cuando la propuesta vino del planificador local).
 *
 * Valida `{title, focus?, rationale?, source?, notes?, exercises|items:[…]}`,
 * resuelve cada `name` contra la biblioteca (los que no resuelvan se omiten) y
 * devuelve `null` si no queda NI UN ejercicio reconocible — o si la entrada ni
 * siquiera parece una sugerencia.
 */
export function applySuggestionAsRoutine(sug: unknown): Routine | null {
  if (!isPlain(sug)) return null;
  const list = Array.isArray(sug.exercises)
    ? sug.exercises
    : Array.isArray(sug.items)
      ? sug.items
      : null;
  if (!list) return null;
  const items = resolveItems(list);
  if (!items.length) return null;

  const source = routineSource(firstString(sug, ['source']));
  const focus = firstString(sug, ['focus']);
  const rationale = rationaleText(sug.rationale);
  const notes = joinNotes(firstString(sug, ['notes']), rationale);
  return addRoutine({
    name: firstString(sug, ['title']) || 'Rutina del coach',
    focus,
    source,
    notes,
    items,
  });
}

/**
 * Aplica un plan semanal del coach: cada día apunta el calendario
 * (`status: 'rest'` para `descanso`, `'planned'` para el resto, como la v1) y,
 * si el día trae ejercicios reconocibles, se crea su rutina (`source: 'ia'` o
 * `'generador'` para el plan local, nombre `título · fecha`) y se enlaza con
 * `routineId`.
 *
 * Devuelve cuántos días se escribieron y cuántas rutinas se crearon; un plan
 * sin `days` no toca nada ni siquiera `meta`.
 */
export function applyWeek(plan: unknown): { days: number; routines: number } {
  const out = { days: 0, routines: 0 };
  if (!isPlain(plan) || !Array.isArray(plan.days)) return out;

  const source = firstString(plan, ['source']) || 'ia';
  for (const raw of plan.days) {
    if (!isPlain(raw)) continue;
    const dayIso = dayIsoOf(raw.date) || dayIsoOf(raw.iso);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayIso)) continue;

    const list = Array.isArray(raw.exercises) ? raw.exercises : raw.items;
    const items = resolveItems(list);
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

/** ¿Hay API key configurada? (la mira en `settings.ai.apiKey`, como `C.hasKey`). */
export function hasApiKey(): boolean {
  return String(settings.value.ai.apiKey ?? '').trim() !== '';
}
