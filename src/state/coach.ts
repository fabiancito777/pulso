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
 * - **API key vacía**: se lanza `GeminiError('auth')` ANTES de llamar a nadie,
 *   aunque `generateFn` esté mockeado.
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

/* ---------- la tarea ---------- */

/**
 * Ejecuta una tarea del coach y devuelve la respuesta ya limpia.
 *
 * Flujo: contexto → `buildRequest` → `generate` → (bucle de consultas) →
 * memoria → `CoachOutcome`. Las señales se leen al empezar, así que la tarea
 * entera trabaja contra una foto del estado.
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
  if (!String(ai.apiKey ?? '').trim()) {
    throw new GeminiError('auth', 'Falta la API key de Gemini (Ajustes → Coach AI)');
  }

  /* 1 · contexto */
  const todayIso = iso(new Date(clock()));
  const from = startOfWeek(todayIso);
  const to = addDays(from, 6);
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

  /* 3 · llamada (sin apiKey no se llega aquí) */
  const genFn: typeof generate = deps.generateFn ?? generate;
  const consultable = task === 'chat' || task === 'analyze';
  const rounds = consultable ? Math.max(0, int(opts.consultRounds ?? 1, 1)) : 0;
  const consulted: string[] = [];

  let prompt = req.prompt;
  let history: ChatMsg[] | undefined = req.history;
  let res = await genFn({ ...base, ...(history?.length ? { history } : {}) });
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
 * Convierte una sugerencia del coach en una rutina guardada (`source: 'ia'`).
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

  const source = firstString(sug, ['source']) || 'ia';
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
 * si el día trae ejercicios reconocibles, se crea su rutina (`source: 'ia'`,
 * nombre `título · fecha`) y se enlaza con `routineId`.
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
        source,
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
