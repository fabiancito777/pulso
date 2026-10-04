/**
 * Cliente Gemini del coach IA: fetch directo contra la API de
 * `generativelanguage.googleapis.com`, sin SDK de Google.
 *
 * La v1 (`legacy/js/coach.js`) manda en lo que se refiere a comportamiento, con
 * dos diferencias: la API key viaja en la cabecera `x-goog-api-key` y nunca en
 * la URL, y los fallos salen tipados con `GeminiError.kind` para que la UI sepa
 * distinguir una clave mala de una cuota agotada, de un bloqueo de seguridad o
 * de una red caída.
 */

import { trunc } from '@/domain/text';
import type { ModelOption } from '@/domain/types';
import type { ResponseSchema } from './types';

/** Modelo por defecto de la app (el mismo que en la v1). */
export const DEFAULT_MODEL = 'gemini-3.8-flash';

/** Cuántos modelos se quedan como máximo al listar (`C.listModels` de la v1). */
export const MODELS_LIMIT = 120;

/** Mensaje ya mantenido con el modelo. El rol de Gemini es `model`, no `assistant`. */
export interface ChatMsg {
  role: 'user' | 'model';
  text: string;
}

/** Opciones de una llamada a `generateContent`. */
export interface GenOpts {
  /** API key de Google; se manda en la cabecera, jamás en la URL. */
  apiKey: string;
  /** Modelo concreto; si no viene se usa `DEFAULT_MODEL`. */
  model?: string;
  /** Instrucción de sistema (va en `systemInstruction`). */
  system: string;
  /** Prompt del turno actual; se añade SIEMPRE el último, con role `user`. */
  prompt: string;
  /** Si es cierto se pide respuesta JSON (`responseMimeType`). */
  json?: boolean;
  /**
   * Forma exigida a la respuesta JSON (`generationConfig.responseSchema`): solo
   * tiene sentido con `json: true`, que es quien rellena `responseMimeType`.
   */
  responseSchema?: ResponseSchema;
  /** Conversación anterior, en orden; el rol ya es el de Gemini (`user`/`model`). */
  history?: ChatMsg[];
  /** Nivel de razonamiento; `'auto'` deja que elija el modelo. */
  thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high' | 'auto';
  /** Presupuesto de tokens de razonamiento (alternativa a `thinkingLevel`). */
  thinkingBudget?: number;
  /** Pide los pensamientos como partes con `thought: true` en la respuesta. */
  includeThoughts?: boolean;
  /** Temperatura (0,7 por defecto, como en la v1). */
  temperature?: number;
  /** Tope de tokens de respuesta (4096 por defecto, como en la v1). */
  maxOutputTokens?: number;
  /** Para cancelar la llamada desde la UI. */
  signal?: AbortSignal;
}

/** Resultado de una llamada correcta. */
export interface GenResult {
  /** Texto final (sin pensamientos), recortado. */
  text: string;
  /** Partes con `thought: true`, solo si la respuesta las trae. */
  thoughts?: string;
  /** `finishReason` del primer candidato. `MAX_TOKENS` NO es un error: la UI avisa. */
  finish?: string;
  /** `usageMetadata` traducido a los nombres cortos de la app. */
  usage?: { prompt: number; candidates: number; thoughts?: number; total: number };
  /** Modelo usado (el pedido, no el `modelVersion` que devuelve la API). */
  model: string;
  /** Milisegundos transcurridos desde que se lanzó la petición. */
  ms: number;
}

/** Error tipado de la API: `kind` dice qué tiene que hacer la UI. */
export class GeminiError extends Error {
  readonly kind: 'auth' | 'quota' | 'blocked' | 'http' | 'network' | 'empty' | 'parse';
  readonly status?: number;
  /**
   * true = ese 429 es del límite DIARIO (Google lo deja en `error.details`), no
   * del por minuto: no se recupera esperando segundos, así que `retryReason`
   * ni lo reintenta y la UI puede mandarlo directo al plan local.
   */
  readonly daily?: boolean;

  constructor(kind: GeminiError['kind'], message: string, status?: number, daily?: boolean) {
    super(message);
    this.name = 'GeminiError';
    this.kind = kind;
    this.status = status;
    if (daily) this.daily = true;
  }
}

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

/** Cuerpo de la respuesta, leído campo a campo y de forma tolerante. */
interface ApiPart {
  text?: string;
  thought?: boolean;
}

interface ApiCandidate {
  content?: { parts?: ApiPart[] };
  finishReason?: string;
}

interface ApiError {
  code?: number | string;
  message?: string;
  status?: string;
  /** `QuotaFailure`/`RetryInfo` de Google: de ahí sale la cuota diaria */
  details?: unknown;
}

interface ApiReply {
  error?: ApiError;
  promptFeedback?: { blockReason?: string };
  candidates?: ApiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
  };
}

/** `Response` leída a mano: los tests mockean la respuesta y no siempre traen todo. */
interface LooseResponse {
  ok?: boolean;
  status?: number;
  text?: () => Promise<string>;
  json?: () => Promise<unknown>;
}

interface ThinkingConfig {
  thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high';
  thinkingBudget?: number;
  includeThoughts?: boolean;
}

interface GenerationConfig {
  temperature: number;
  maxOutputTokens: number;
  responseMimeType?: string;
  responseSchema?: ResponseSchema;
  thinkingConfig?: ThinkingConfig;
}

/**
 * `generationConfig.thinkingConfig`: level XOR budget (nunca los dos a la vez;
 * `'auto'` cuenta como "sin nivel", igual que en la v1) más `includeThoughts`.
 * Si no hay nada que configurar no se manda la clave.
 */
function thinkingConfig(o: GenOpts): ThinkingConfig | undefined {
  const tc: ThinkingConfig = {};
  if (o.thinkingLevel && o.thinkingLevel !== 'auto') tc.thinkingLevel = o.thinkingLevel;
  else if (typeof o.thinkingBudget === 'number') tc.thinkingBudget = o.thinkingBudget;
  if (o.includeThoughts) tc.includeThoughts = true;
  return Object.keys(tc).length ? tc : undefined;
}

/**
 * `contents` válido para `generateContent`: SIEMPRE empieza en `user`, alterna
 * `user`/`model`, termina en el turno actual (que es `user`) y nunca trae
 * turnos con `parts` vacíos.
 *
 * La API rechaza con 400 `INVALID_ARGUMENT` un historial que arranque en
 * `model`, con dos turnos seguidos del mismo rol o con textos vacíos: en la v1
 * eso no podía pasar porque el chat nacía con el usuario y el historial se
 * metía como texto dentro del prompt. Ahora que la conversación viaja como
 * `contents`, un turno cortado, un mensaje en blanco o una conversación de la
 * copia de la v1 pueden romper la llamada entera. Aquí se descartan los
 * `model` iniciales, se ignoran los vacíos y se fusionan los consecutivos del
 * mismo rol (son dos turnos del mismo emisor seguidos, algo que el modelo ve
 * igual mejor en un solo mensaje).
 */
function normalizeContents(
  o: Pick<GenOpts, 'history' | 'prompt'>,
): { role: ChatMsg['role']; parts: { text: string }[] }[] {
  const turns: ChatMsg[] = [];
  const push = (m: ChatMsg): void => {
    const text = String(m.text ?? '').trim();
    if (!text) return;
    const last = turns[turns.length - 1];
    if (last && last.role === m.role) last.text += `\n\n${text}`;
    else turns.push({ role: m.role, text });
  };
  for (const m of o.history ?? []) push(m);
  /* Un inicio de conversación del modelo no es válido: se corta por la base */
  while (turns.length && turns[0].role !== 'user') turns.shift();
  /* El turno actual SIEMPRE cierra la petición como `user`: aunque el prompt
     venga en blanco (bug del caller, no de la conversación) no se puede acabar
     en `model`, y ese caso ya fallaba igual en la v1 */
  push({ role: 'user', text: o.prompt });
  if (turns[turns.length - 1]?.role !== 'user') turns.push({ role: 'user', text: '' });
  return turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] }));
}

/**
 * Cuerpo de la petición. Puro: ni red ni estado, así que el contrato de la API
 * (historial + prompt al final, systemInstruction y generationConfig) se puede
 * verificar con tests sin salir del sitio.
 *
 * `dropThinking` borra `generationConfig.thinkingConfig` ENTERO (level, budget
 * e `includeThoughts`): es el último recurso del reintento por respuestas sin
 * texto (ver `generate`), para modelos que con thinking devuelven solo thoughts.
 */
export function buildBody(o: GenOpts, opts: { dropThinking?: boolean } = {}): unknown {
  const contents = normalizeContents(o);

  const generationConfig: GenerationConfig = {
    temperature: o.temperature ?? DEFAULT_TEMPERATURE,
    maxOutputTokens: o.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  };
  if (o.json) generationConfig.responseMimeType = 'application/json';
  /* Solo con `json: true`: la API exige `responseMimeType: application/json`
     junto al schema y rechaza la llamada si mandamos un schema sin pedir JSON */
  if (o.json && o.responseSchema) generationConfig.responseSchema = o.responseSchema;
  const tc = opts.dropThinking ? undefined : thinkingConfig(o);
  if (tc) generationConfig.thinkingConfig = tc;

  return {
    contents,
    systemInstruction: { parts: [{ text: o.system }] },
    generationConfig,
  };
}

/** Fallback de mensaje cuando la API no devuelve `error.message` (p. ej. una página HTML). */
function fallbackMessage(status: number | undefined, raw: string): string {
  if (!raw) return `HTTP ${status ?? '?'}`;
  return `Respuesta no-JSON (HTTP ${status ?? '?'}): ${raw.slice(0, 160)}`;
}

/** HTTP con error: 401/403 → clave, 429 → cuota, el resto → http (siempre con `status`). */
function httpError(status: number | undefined, data: unknown, raw: string): GeminiError {
  const reply = data && typeof data === 'object' ? (data as ApiReply) : null;
  const apiErr = reply?.error;
  const httpish = status !== undefined && status >= 400 ? status : undefined;
  const apiCode = typeof apiErr?.code === 'number' ? apiErr.code : undefined;
  const code = httpish ?? apiCode;
  const apiStatus =
    typeof apiErr?.status === 'string'
      ? apiErr.status
      : typeof apiErr?.code === 'string'
        ? apiErr.code
        : '';
  const message = apiErr?.message || fallbackMessage(status, raw);
  let kind: GeminiError['kind'] = 'http';
  if (
    code === 401 ||
    code === 403 ||
    apiStatus === 'UNAUTHENTICATED' ||
    apiStatus === 'PERMISSION_DENIED'
  )
    kind = 'auth';
  else if (code === 429 || apiStatus === 'RESOURCE_EXHAUSTED') kind = 'quota';
  /* Solo el 429 puede ser el límite diario; el mensaje lleva la marca para que
     la UI diga «cuota diaria» en vez de repetir el texto en inglés de Google */
  const daily = kind === 'quota' && isDailyQuota(apiErr, message);
  return new GeminiError(
    kind,
    daily ? `Cuota diaria de Gemini agotada: ${message}` : message,
    code ?? status,
    daily,
  );
}

/**
 * ¿Un `retryDelay` de Google («41s», «5m», «1.5h») son segundos? Devuelve
 * `NaN` si la cadena no la entendemos, para no convertir un detalle nuevo en
 * una decisión equivocada.
 */
function retryDelaySeconds(value: unknown): number {
  if (typeof value !== 'string') return Number.NaN;
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/.exec(value.trim());
  if (!match) return Number.NaN;
  const n = Number(match[1]);
  const unit = match[2] ?? 's';
  if (unit === 'h') return n * 3600;
  if (unit === 'm') return n * 60;
  if (unit === 'ms') return n / 1000;
  return n;
}

/** `quotaId`/`metricName`/`description` que nombran un límite POR DÍA. */
const DAY_QUOTA_RE = /perday|daily/i;

/**
 * ¿Un 429 es del límite DIARIO y no del por minuto? La distinción vive en
 * `error.details`:
 *
 * - `QuotaFailure.violations[].quotaId` (p. ej. `…PerDayPerProject…`);
 * - un `RetryInfo` con `retryDelay` de minutos u horas (el límite por minuto
 *   se resuelve en segundos: reintentar tiene sentido, esperar un día no).
 *
 * Si no hay detalles, se mira el mensaje («…per day…»). Falso negativo → el
 * error sigue siendo un reintento normal, que es el comportamiento de siempre.
 */
function isDailyQuota(err: ApiError | undefined, message: string): boolean {
  const details = err && Array.isArray(err.details) ? err.details : [];
  for (const raw of details) {
    if (!raw || typeof raw !== 'object') continue;
    const detail = raw as Record<string, unknown>;
    const type = typeof detail['@type'] === 'string' ? detail['@type'] : '';
    if (type.includes('QuotaFailure')) {
      const violations = Array.isArray(detail.violations) ? detail.violations : [];
      for (const violation of violations) {
        if (!violation || typeof violation !== 'object') continue;
        for (const key of ['quotaId', 'metricName', 'description']) {
          const text = (violation as Record<string, unknown>)[key];
          if (typeof text === 'string' && DAY_QUOTA_RE.test(text.replace(/[\s_-]+/g, ''))) {
            return true;
          }
        }
      }
    }
    if (type.includes('RetryInfo') && retryDelaySeconds(detail.retryDelay) >= 300) return true;
  }
  return DAY_QUOTA_RE.test(message.replace(/[\s_-]+/g, ''));
}

/** Red caída (o respuesta ilegible a mitad de camino): siempre `network`. */
function networkError(err: unknown): GeminiError {
  const detail = err instanceof Error ? err.message : String(err);
  return new GeminiError('network', `No se pudo conectar con Gemini (${detail})`);
}

/* ---------- política de reintentos ---------- */

/** Reintentos máximos: la llamada original + como mucho 2 más (3 en total). */
const MAX_RETRIES = 2;
/** Backoff entre intentos: 300-600 ms, nunca más (la app no puede quedarse parada). */
const BACKOFF_MIN_MS = 300;
const BACKOFF_SPAN_MS = 300;

/**
 * Reintentos de un fallo TRANSITORIO cuando la red es de verdad (sin `fetchFn`
 * mockeado).
 *
 * La API devuelve 503 `UNAVAILABLE` («high demand») en picos que se resuelven
 * solos en cuestión de segundos, y con 2 reintentos de 300 ms la llamada se
 * daba por perdida ANTES de que el pico pasara: el error llegaba a la UI (y a
 * los tests de red) con la ventana todavía abierta. Aquí se espera con backoff
 * exponencial y jitter, pero NUNCA más de `TRANSIENT_BUDGET_MS` desde el primer
 * intento: un pico de verdad se resuelve en segundos y el usuario prefiere
 * esperar un rato a un error, pero la app no puede quedarse parada para siempre
 * (quien quiere cortar tiene `GenOpts.signal`).
 */
const TRANSIENT_RETRIES = 10;
const TRANSIENT_BUDGET_MS = 120_000;
const TRANSIENT_BACKOFF_MIN_MS = 500;
const TRANSIENT_BACKOFF_MAX_MS = 4_000;

/**
 * ¿Un `GeminiError` permite reintentar y por qué?
 *
 * - `unusable` (caso i): la respuesta llegó pero no sirve — `empty` cubre
 *   candidatos ausentes, texto vacío y `finishReason` `MALFORMED_RESPONSE`.
 * - `transient` (caso ii): fallo de red, 429 o un 5xx del servidor.
 * - `null`: nunca se reintenta (auth 400/403, `blocked`, `parse`, resto de 4xx
 *   y la cuota DIARIA: reintentarla solo añade latencia a un error que no se
 *   resuelve esperando segundos).
 */
function retryReason(err: GeminiError): 'unusable' | 'transient' | null {
  if (err.daily) return null;
  if (err.kind === 'empty') return 'unusable';
  if (err.kind === 'network') return 'transient';
  if (err.kind === 'quota' && err.status === 429) return 'transient';
  if (err.kind === 'http' && typeof err.status === 'number' && err.status >= 500) {
    return 'transient';
  }
  return null;
}

/**
 * Pausa antes del siguiente intento. Con `fetchFn` mockeado es 0 siempre
 * (los tests no esperan de verdad); en red real un fallo transitorio espera con
 * backoff exponencial + jitter y el resto (respuesta sin texto) con los 300-600
 * ms de siempre, que es repetir la petición lo antes posible.
 */
function backoff(fetchFn: unknown, reason: 'unusable' | 'transient', attempt: number): number {
  if (fetchFn) return 0;
  if (reason !== 'transient') return BACKOFF_MIN_MS + Math.floor(Math.random() * BACKOFF_SPAN_MS);
  const exp = Math.min(TRANSIENT_BACKOFF_MIN_MS * 2 ** attempt, TRANSIENT_BACKOFF_MAX_MS);
  return exp + Math.floor(Math.random() * (exp / 2));
}

/** Mensaje de fallo de un candidato sin texto utilizable (para el log del reintento). */
function unusableMessage(finish: string | undefined): string {
  if (finish === 'MALFORMED_RESPONSE') {
    return 'finishReason MALFORMED_RESPONSE: la API no devolvió una respuesta utilizable';
  }
  return 'La API devolvió una respuesta sin texto';
}

/**
 * UN intento contra la API (sin reintentos): petición, lectura de la respuesta
 * y traducción a `GenResult`. Rechaza con `GeminiError` igual que `generate`.
 *
 * `dropThinking` quita `thinkingConfig` del body: se usa en el reintento por
 * respuestas sin texto (hipótesis: thinking + ciertos modelos → solo thoughts).
 */
async function requestOnce(
  o: GenOpts,
  url: string,
  key: string,
  model: string,
  call: (url: string, init: RequestInit) => Promise<unknown>,
  dropThinking: boolean,
  t0: number,
): Promise<GenResult> {
  let fetched: unknown;
  try {
    fetched = await call(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(buildBody(o, { dropThinking })),
      signal: o.signal,
    });
  } catch (err) {
    throw networkError(err);
  }
  const res = fetched as LooseResponse;

  const status = typeof res.status === 'number' ? res.status : undefined;
  let data: unknown = null;
  let raw = '';
  let unparsable = false;
  try {
    if (typeof res.text === 'function') raw = await res.text();
    else if (typeof res.json === 'function') data = await res.json();
  } catch (err) {
    throw networkError(err);
  }
  if (raw.trim()) {
    try {
      data = JSON.parse(raw);
    } catch {
      unparsable = true;
      data = null;
    }
  }

  const failed =
    res.ok === false || (res.ok === undefined && status !== undefined && status >= 400);
  if (failed) throw httpError(status, data, raw);
  if (unparsable) throw new GeminiError('parse', fallbackMessage(status, raw));
  if (!data || typeof data !== 'object')
    throw new GeminiError('empty', 'Respuesta vacía de la API');

  const reply = data as ApiReply;
  if (reply.error) throw httpError(status, reply, '');
  const blockReason = reply.promptFeedback?.blockReason;
  if (blockReason)
    throw new GeminiError('blocked', `Respuesta bloqueada por la API (${blockReason})`);
  const candidate = reply.candidates?.[0];
  if (!candidate) throw new GeminiError('empty', 'La API no devolvió candidatos');

  let text = '';
  let thoughts = '';
  for (const part of candidate.content?.parts ?? []) {
    if (!part.text) continue;
    if (part.thought) thoughts += part.text;
    else text += part.text;
  }

  const finish = candidate.finishReason;
  const out: GenResult = { text: text.trim(), model, ms: Date.now() - t0 };
  const thinking = thoughts.trim();
  if (thinking) out.thoughts = thinking;
  if (finish) out.finish = finish;
  /* Sin texto utilizable → `empty` (reintentable). MAX_TOKENS NO: hay que
     enseñar el trozo parcial a la UI, y repetir con el mismo tope no arregla nada. */
  if (finish === 'MALFORMED_RESPONSE' || (!out.text && finish !== 'MAX_TOKENS')) {
    throw new GeminiError('empty', unusableMessage(finish));
  }

  const usageMeta = reply.usageMetadata;
  if (usageMeta) {
    const usage: NonNullable<GenResult['usage']> = {
      prompt: usageMeta.promptTokenCount ?? 0,
      candidates: usageMeta.candidatesTokenCount ?? 0,
      total: usageMeta.totalTokenCount ?? 0,
    };
    if (typeof usageMeta.thoughtsTokenCount === 'number')
      usage.thoughts = usageMeta.thoughtsTokenCount;
    out.usage = usage;
  }
  return out;
}

/**
 * Llamada a `POST /v1beta/models/{model}:generateContent`.
 *
 * **Política de reintentos**:
 *
 * 1. Se reintenta SOLO si (i) la respuesta no tiene texto utilizable (sin
 *    candidatos, `finishReason` `MALFORMED_RESPONSE` o vacío, o texto vacío) o
 *    (ii) fallo de red / HTTP 429 / 5xx.
 * 2. En el ÚLTIMO reintento de (i) —y desde el primero de ellos— se quita
 *    `thinkingConfig` ENTERO del body: hipótesis comprobada en los tests de red:
 *    con thinking este modelo a veces devuelve solo thoughts y ningún candidato
 *    con texto. Los reintentos de (ii) repiten el mismo body.
 * 3. NUNCA se reintenta con texto utilizable ni en errores 400/403 (`auth`),
 *    `blocked`, `parse` ni el resto de 4xx.
 * 4. (i) siempre son 2 reintentos con backoff de 300-600 ms. (ii) en red real
 *    sube a `TRANSIENT_RETRIES` con backoff exponencial y pared de tiempo
 *    `TRANSIENT_BUDGET_MS`, para surfear los 503 «high demand» de la API sin
 *    dejar la app parada.
 * 5. Con `fetchFn` inyectado (tests con fetch mock) la espera es 0 y la política
 *    es la clásica de 3 intentos, así que los tests no esperan de verdad.
 *
 * Rechaza con `GeminiError`: `auth` sin key o con 401/403, `quota` con 429,
 * `blocked` si la API bloquea el prompt, `http` para el resto de errores HTTP,
 * `network` si no hay conexión, `empty` sin candidatos/texto utilizable (tras
 * agotar reintentos) y `parse` si la respuesta no era JSON. Un `finishReason`
 * `MAX_TOKENS` NO lanza: devuelve el texto parcial para que la UI pueda avisar
 * de que se cortó.
 */
export async function generate(o: GenOpts, fetchFn?: typeof fetch): Promise<GenResult> {
  const key = String(o.apiKey ?? '').trim();
  if (!key) throw new GeminiError('auth', 'Falta la API key de Gemini (Ajustes → Coach AI)');

  const model = String(o.model ?? '').trim() || DEFAULT_MODEL;
  const url = `${BASE}/models/${encodeURIComponent(model)}:generateContent`;
  const t0 = Date.now();
  const call: (url: string, init: RequestInit) => Promise<unknown> = fetchFn ?? fetch;

  let dropThinking = false;
  for (let attempt = 0; ; attempt++) {
    try {
      return await requestOnce(o, url, key, model, call, dropThinking, t0);
    } catch (err) {
      if (!(err instanceof GeminiError)) throw err;
      const reason = retryReason(err);
      if (!reason) throw err;
      /* En red real un transitorio tiene más margen (backoff exponencial dentro
         de `TRANSIENT_BUDGET_MS`); con `fetchFn` mockeado, la política clásica
         de 2 reintentos, que es la que fijan los tests. */
      const patient = !fetchFn && reason === 'transient';
      if (attempt >= (patient ? TRANSIENT_RETRIES : MAX_RETRIES)) throw err;
      if (patient && Date.now() - t0 >= TRANSIENT_BUDGET_MS) throw err;
      /* (i): a partir de AHORA el body se manda sin thinkingConfig */
      if (reason === 'unusable') dropThinking = true;
      const wait = backoff(fetchFn, reason, attempt);
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

/**
 * Comprobación rápida de conexión: manda un prompt que solo se puede contestar
 * con "OK" y sin thinking para que sea barata. No lanza nunca: devuelve `ok` y,
 * si falla, el mensaje del error en `detail` y su `kind` (`auth` = la key no
 * vale o el modelo no está disponible para tu proyecto), para que la UI pueda
 * abrir el aviso concreto en vez de un toast genérico.
 */
export async function testConnection(
  apiKey: string,
  model: string,
  fetchFn?: typeof fetch,
): Promise<{ ok: boolean; ms: number; detail: string; kind?: GeminiError['kind'] }> {
  const t0 = Date.now();
  try {
    const res = await generate(
      {
        apiKey,
        model,
        system: 'Eres un comprobador de conexión. Responde solo "OK".',
        prompt: 'Responde exactamente con: OK',
      },
      fetchFn,
    );
    const ok = res.text.includes('OK');
    return {
      ok,
      ms: Date.now() - t0,
      detail: ok ? res.text : `No respondió "OK": ${res.text.slice(0, 80)}`,
    };
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - t0,
      detail: err instanceof Error ? err.message : String(err),
      kind: err instanceof GeminiError ? err.kind : undefined,
    };
  }
}

/** Respuesta de `GET /models`, leída campo a campo y de forma tolerante. */
interface ModelsPage {
  error?: ApiError;
  models?: {
    name?: string;
    displayName?: string;
    description?: string;
    supportedGenerationMethods?: string[];
  }[];
  nextPageToken?: string;
}

/** Modelos que la v1 excluía del selector: no sirven para generar contenido. */
const MODEL_EXCLUDE = /embedding|aqa|imagen|veo|tts|live/i;

/**
 * Modelos disponibles PARA TU proyecto: `GET /models` con la key en la
 * cabecera `x-goog-api-key` (nunca en la URL, política de este módulo),
 * paginando `nextPageToken` hasta `MODELS_LIMIT`, como `C.listModels` de la v1.
 *
 * Solo se quedan los que soportan `generateContent` y que no son de imagen,
 * audio, vídeo ni embeddings. El listado NO consume cuota de `generateContent`
 * (es una request HTTP más), pero sí necesita key y red: por eso, si esto
 * falla o viene vacío, la UI sigue con el catálogo `AI_MODELS`.
 *
 * Lanza `GeminiError`: `auth` sin key o con 401/403, `quota` con 429, `http`
 * para el resto de errores HTTP, `network` si no hay conexión y `empty` si la
 * cuenta no devuelve ningún modelo utilizable. Con `fetchFn` mockeado (tests)
 * no se espera entre páginas y no se toca la red.
 */
export async function listModels(apiKey: string, fetchFn?: typeof fetch): Promise<ModelOption[]> {
  const key = String(apiKey ?? '').trim();
  if (!key) throw new GeminiError('auth', 'Falta la API key de Gemini (Ajustes → Coach AI)');
  const call: (url: string, init: RequestInit) => Promise<unknown> = fetchFn ?? fetch;

  const out: ModelOption[] = [];
  let token = '';
  for (;;) {
    const url = `${BASE}/models?pageSize=200${
      token ? `&pageToken=${encodeURIComponent(token)}` : ''
    }`;
    let fetched: unknown;
    try {
      fetched = await call(url, { headers: { 'x-goog-api-key': key } });
    } catch (err) {
      throw networkError(err);
    }

    const res = fetched as LooseResponse;
    const status = typeof res.status === 'number' ? res.status : undefined;
    let data: unknown = null;
    let raw = '';
    try {
      if (typeof res.text === 'function') raw = await res.text();
      else if (typeof res.json === 'function') data = await res.json();
    } catch (err) {
      throw networkError(err);
    }
    if (raw.trim()) {
      try {
        data = JSON.parse(raw);
      } catch {
        throw new GeminiError('parse', fallbackMessage(status, raw));
      }
    }

    const failed =
      res.ok === false || (res.ok === undefined && status !== undefined && status >= 400);
    if (failed) throw httpError(status, data, raw);
    if (!data || typeof data !== 'object')
      throw new GeminiError('empty', 'Respuesta vacía de la API');
    const page = data as ModelsPage;
    if (page.error) throw httpError(status, page, '');

    for (const model of page.models ?? []) {
      const id = String(model.name ?? '').replace(/^models\//, '');
      if (!id || MODEL_EXCLUDE.test(id)) continue;
      if (!(model.supportedGenerationMethods ?? []).includes('generateContent')) continue;
      out.push({
        id,
        label: model.displayName || id,
        hint: model.description ? trunc(model.description, 90) : '',
      });
      if (out.length >= MODELS_LIMIT) break;
    }

    token = String(page.nextPageToken ?? '');
    if (!token || out.length >= MODELS_LIMIT) break;
  }

  if (!out.length)
    throw new GeminiError('empty', 'La cuenta no devolvió modelos con generateContent');
  return out;
}
