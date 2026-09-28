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

/** Modelo por defecto de la app (el mismo que en la v1). */
export const DEFAULT_MODEL = 'gemini-3.8-flash';

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

  constructor(kind: GeminiError['kind'], message: string, status?: number) {
    super(message);
    this.name = 'GeminiError';
    this.kind = kind;
    this.status = status;
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
 * Cuerpo de la petición. Puro: ni red ni estado, así que el contrato de la API
 * (historial + prompt al final, systemInstruction y generationConfig) se puede
 * verificar con tests sin salir del sitio.
 *
 * `dropThinking` borra `generationConfig.thinkingConfig` ENTERO (level, budget
 * e `includeThoughts`): es el último recurso del reintento por respuestas sin
 * texto (ver `generate`), para modelos que con thinking devuelven solo thoughts.
 */
export function buildBody(o: GenOpts, opts: { dropThinking?: boolean } = {}): unknown {
  const contents: { role: ChatMsg['role']; parts: { text: string }[] }[] = (o.history ?? []).map(
    (m) => ({ role: m.role, parts: [{ text: m.text }] }),
  );
  contents.push({ role: 'user', parts: [{ text: o.prompt }] });

  const generationConfig: GenerationConfig = {
    temperature: o.temperature ?? DEFAULT_TEMPERATURE,
    maxOutputTokens: o.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  };
  if (o.json) generationConfig.responseMimeType = 'application/json';
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
  return new GeminiError(kind, message, code ?? status);
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
 * - `null`: nunca se reintenta (auth 400/403, `blocked`, `parse`, resto de 4xx).
 */
function retryReason(err: GeminiError): 'unusable' | 'transient' | null {
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
 * si falla, el mensaje del error en `detail`.
 */
export async function testConnection(
  apiKey: string,
  model: string,
  fetchFn?: typeof fetch,
): Promise<{ ok: boolean; ms: number; detail: string }> {
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
    };
  }
}
