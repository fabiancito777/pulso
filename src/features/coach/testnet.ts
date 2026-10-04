/**
 * Configuración y medición de las pruebas de RED del coach (`smoke.test.ts`,
 * `edge.test.ts` y `quality.test.ts`): modelo y nivel de thinking salen de
 * variables de entorno para poder correr la misma batería contra
 * `gemini-3.5-flash-lite` con `thinkingLevel: 'high'` SIN cambiar el
 * comportamiento por defecto (sin nada definido mandan los de siempre:
 * flash-lite + `low`, que es lo que usa la app).
 *
 * Variables:
 *
 * - `COACH_TEST_MODEL` → modelo concreto (por defecto `gemini-3.5-flash-lite`);
 * - `COACH_TEST_THINKING` → `minimal|low|medium|high|auto` (por defecto `low`);
 *   un valor que no esté en la lista se ignora y manda el por defecto, así un
 *   typo no convierte una batería entera en un 400 INVALID_ARGUMENT.
 *
 * Además instala un contador de peticiones HTTP reales sobre `fetch`: los
 * reintentos INTERNOS de `client.generate` (503 «high demand», respuestas sin
 * texto) no se ven en los contadores de cada test, y el presupuesto de cuota
 * se paga por petición real, no por intento de alto nivel.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Niveles que acepta `GenOpts.thinkingLevel`. */
const LEVELS = ['minimal', 'low', 'medium', 'high', 'auto'] as const;

/** Uno de los niveles anteriores. */
export type TestThinking = (typeof LEVELS)[number];

/** Valor de una variable de entorno, sin comillas y sin espacios de sobra. */
function env(name: string): string {
  const raw = process.env[name];
  if (typeof raw !== 'string') return '';
  const value = raw.trim();
  const quoted = /^(['"])([\s\S]*)\1$/.exec(value);
  return (quoted?.[2] ?? value).trim();
}

/** Modelo de las pruebas de red: `COACH_TEST_MODEL` o el de siempre. */
export const TEST_MODEL: string = env('COACH_TEST_MODEL') || 'gemini-3.5-flash-lite';

/** Nivel de thinking: `COACH_TEST_THINKING` o `low` (el que usa la app). */
export const TEST_THINKING: TestThinking =
  LEVELS.find((level) => level === env('COACH_TEST_THINKING').toLowerCase()) ?? 'low';

/* ---------- contador de peticiones HTTP reales ---------- */

let watching = false;
let count = 0;

/**
 * Cuenta y traza (por `console.warn`) cada `fetch` real: así un reintento
 * interno de `generate` se ve en el log y en el presupuesto. Idempotente,
 * pensado para llamarse una vez por archivo de test.
 */
export function watchFetch(): void {
  if (watching) return;
  const original = globalThis.fetch;
  if (typeof original !== 'function') return;
  watching = true;
  const bound = original.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    count++;
    const id = count;
    const label =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const t0 = Date.now();
    console.warn(`[net] #${id} ${init?.method ?? 'GET'} ${label}`);
    return bound(input, init).then(
      (res) => {
        console.warn(`[net] #${id} → HTTP ${res.status} en ${Date.now() - t0} ms`);
        return res;
      },
      (err: unknown) => {
        console.warn(`[net] #${id} → RED caída en ${Date.now() - t0} ms`);
        throw err;
      },
    );
  });
}

/** Peticiones HTTP reales hechas desde que se instaló el contador. */
export function netCalls(): number {
  return count;
}

/**
 * API key de las pruebas de red: `GEMINI_API_KEY` del proceso o, si no,
 * la de `.env.local` (gitignored). Mismo loader en los tres archivos de test.
 */
export function loadTestKey(): string {
  const inline = env('GEMINI_API_KEY');
  if (inline) return inline;
  let raw: string;
  try {
    raw = readFileSync(fileURLToPath(new URL('../../../.env.local', import.meta.url)), 'utf8');
  } catch {
    return '';
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*GEMINI_API_KEY\s*=(.*)$/.exec(line);
    if (match?.[1] !== undefined) {
      const value = match[1].trim();
      const quoted = /^(['"])([\s\S]*)\1$/.exec(value);
      return (quoted?.[2] ?? value).trim();
    }
  }
  return '';
}
