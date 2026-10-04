/* eslint-disable no-console -- esta batería tiene que enseñar latencia, tokens y calidad real */

/**
 * quality.test.ts · Calidad de los modos nuevos CONTRA LA API REAL:
 *
 * 1. `suggest` con `responseSchema` → ¿el payload parsea con `parse.ts` sin
 *    rescate del plan local?
 * 2. `plan` con `responseSchema` y `maxOutputTokens` 8192 → ¿sale entero o se
 *    corta en `MAX_TOKENS` (con thinking, los tokens de razonamiento descuentan
 *    del mismo tope)?
 * 3. `chat` con HISTORIAL PREVIO (3 turnos con récords pegados) → ¿el modelo
 *    usa la conversación de `contents` o la ignora?
 * 4. la MISMA petición de `suggest` con `thinkingLevel: 'low'` y `'high'` →
 *    comparativa de latencia, tokens (salida y de razonamiento) y calidad.
 *
 * Presupuesto duro: **5 llamadas** (1 + 1 + 1 + 2). Por eso el bloque de red
 * solo se activa con `COACH_TEST_QUALITY=1` además de la API key: sin esa
 * variable el archivo se salta entero y `npm run test` sigue costando lo de
 * siempre (smoke 2 + edge ≤ 20).
 *
 * Modelo y nivel de thinking salen de `COACH_TEST_MODEL`/`COACH_TEST_THINKING`
 * (por defecto flash-lite + `low`, el comportamiento de siempre).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { equipPreset, findExerciseByName, isAvailable } from '@/domain/data';
import { addDays, today } from '@/domain/dates';
import type { Session, SessionEntry, SetLog } from '@/domain/types';
import { GeminiError, generate } from './client';
import type { GenOpts, GenResult } from './client';
import { buildContext } from './context';
import { parseJSON } from './parse';
import { buildRequest } from './prompts';
import { TEST_MODEL, TEST_THINKING, loadTestKey, netCalls, watchFetch } from './testnet';
import type { TestThinking } from './testnet';

const MODEL = TEST_MODEL;
/** Techo por test: la API real tarda 30-180 s por llamada (o más con thinking). */
const TIMEOUT = 300_000;
const MAX_CALLS = 5;
const API_KEY = loadTestKey();

/** El bloque de red solo con `COACH_TEST_QUALITY=1` (o true/yes/sí). */
const ENABLED = /^(1|true|yes|s[ií])$/i.test(String(process.env.COACH_TEST_QUALITY ?? '').trim());

/* Peticiones HTTP REALES (incluidos los reintentos internos de `generate`) */
watchFetch();

const N_PRESS = 'Press de Piso con Mancuernas';
const N_REMO = 'Remo con Barra';
const N_SENT = 'Sentadilla Copa (con mancuerna)';

/* ---------- localStorage simulado: ANTES del import (storageAvailable se decide al cargar) ---------- */

const mem = new Map<string, string>();

vi.stubGlobal('localStorage', {
  getItem: (key: string): string | null => (mem.has(key) ? (mem.get(key) as string) : null),
  setItem: (key: string, value: string): void => {
    mem.set(key, String(value));
  },
  removeItem: (key: string): void => {
    mem.delete(key);
  },
  clear: (): void => {
    mem.clear();
  },
  key: (index: number): string | null => [...mem.keys()][index] ?? null,
  get length(): number {
    return mem.size;
  },
});

const store = await import('@/state/store');
const coach = await import('@/state/coach');

/* ---------- presupuesto de llamadas ---------- */

let apiCalls = 0;

function bump(): void {
  apiCalls++;
  if (apiCalls > MAX_CALLS) {
    throw new Error(`presupuesto de llamadas agotado (${apiCalls}/${MAX_CALLS})`);
  }
}

/** `generate` real contado: un único reintento si el fallo es de RED. */
async function realGenerate(opts: GenOpts): Promise<GenResult> {
  for (let attempt = 1; ; attempt++) {
    bump();
    try {
      return await generate(opts);
    } catch (err) {
      const red = err instanceof GeminiError && err.kind === 'network';
      if (!red || attempt === 2) throw err;
      console.warn('[quality] fallo de red, un único reintento…');
    }
  }
}

afterAll(() => {
  console.log(
    `[quality] llamadas API usadas: ${apiCalls}/${MAX_CALLS} · HTTP reales: ${netCalls()}` +
      ` · modelo=${MODEL} · thinking=${TEST_THINKING}`,
  );
});

/* ---------- fixture: material, biblioteca y sesiones con historial ---------- */

const HOY = today();

function idOf(name: string): string {
  const found = findExerciseByName(store.exercises.value, name);
  if (!found) throw new Error(`el fixture usa un ejercicio inexistente: ${name}`);
  if (!found.allowed || !isAvailable(found, store.equipment.value)) {
    throw new Error(`el fixture usa un ejercicio no disponible: ${name}`);
  }
  return found.id;
}

function mkSets(weight: number, reps: number, count: number): SetLog[] {
  return Array.from({ length: count }, () => ({ weight, reps, done: true }));
}

function entryOf(name: string, weight: number, reps: number, count: number): SessionEntry {
  const ex = findExerciseByName(store.exercises.value, name);
  return { exId: idOf(name), name, group: ex?.group ?? '', sets: mkSets(weight, reps, count) };
}

function sessionOf(date: string, id: string, entries: SessionEntry[]): Session {
  return {
    id,
    name: 'Empuje A',
    routineId: 'rt1',
    date,
    startedAt: `${date}T09:30:00`,
    endedAt: `${date}T10:40:00`,
    unit: 'kg',
    entries,
  };
}

/** Cuatro sesiones ascendentes: lo justo para que el plan tenga qué mirar. */
function seedFixture(): void {
  const list: Session[] = [
    sessionOf(addDays(HOY, -14), 'q-0', [entryOf(N_PRESS, 32.5, 7, 4), entryOf(N_REMO, 60, 8, 4)]),
    sessionOf(addDays(HOY, -9), 'q-1', [entryOf(N_PRESS, 35, 7, 4), entryOf(N_REMO, 62.5, 8, 4)]),
    sessionOf(addDays(HOY, -7), 'q-2', [entryOf(N_SENT, 22.5, 6, 4)]),
    sessionOf(addDays(HOY, -4), 'q-3', [entryOf(N_PRESS, 37.5, 6, 4), entryOf(N_REMO, 65, 8, 4)]),
  ];
  const state = store.readState();
  state.sessions = list;
  store.writeState(state);
  store.refresh();
}

function contextNow(): string {
  return buildContext({
    settings: store.settings.value,
    sessions: store.sessions.value,
    routines: store.routines.value,
    schedule: store.schedule.value,
    equipment: store.equipment.value,
    exercises: store.exercises.value,
    opts: { todayIso: HOY },
  });
}

/** Señales de CALIDAD de un payload de `suggest`: nº de ejercicios, cuántos
 *  salen de la biblioteca permitida, título y rationale presentes. */
function quality(payload: unknown): {
  count: number;
  known: number;
  title: string;
  rationale: boolean;
} {
  const raw = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const list = Array.isArray(raw.exercises)
    ? (raw.exercises as Record<string, unknown>[])
    : [];
  const lib = store.exercises.value.filter((ex) => ex.allowed);
  const known = list.filter(
    (item) =>
      typeof item.name === 'string' && lib.some((ex) => ex.name === item.name),
  ).length;
  const rationale =
    typeof raw.rationale === 'string'
      ? raw.rationale.trim().length > 0
      : Array.isArray(raw.rationale) && raw.rationale.length > 0;
  return { count: list.length, known, title: typeof raw.title === 'string' ? raw.title : '', rationale };
}

/** Sin API key o sin `COACH_TEST_QUALITY=1` el bloque de red entero se salta. */
function suite(name: string, fn: () => void): void {
  if (API_KEY && ENABLED) describe(name, fn);
  else describe.skip(name, fn);
}

if (!ENABLED && API_KEY) {
  console.warn(
    '[quality] bloque de calidad de red DESCARTADO: exporta COACH_TEST_QUALITY=1 para ejecutarlo (5 llamadas)',
  );
}

suite('calidad de los modos nuevos contra Gemini (API real)', () => {
  beforeEach(() => {
    mem.clear();
    store.writeState(store.defaultState());
    store.refresh();
    store.applyEquipment(equipPreset('gym'));
    store.patchSettings({
      ai: {
        ...store.settings.value.ai,
        apiKey: API_KEY,
        model: MODEL,
        thinkingLevel: TEST_THINKING,
        memory: '',
      },
    });
  });

  it(
    '1 · suggest con responseSchema → payload parseado, sin rescate del plan local',
    async () => {
      seedFixture();
      const out = await coach.runCoachTask('suggest', {}, { generateFn: realGenerate });
      const q = quality(out.payload);
      console.log(
        `[quality] 1 · suggest · origin=${out.origin} · finish=${out.finish ?? '?'}` +
          ` · usage=${JSON.stringify(out.usage)} · ${out.ms} ms` +
          ` · ejercicios=${q.count} (en biblioteca: ${q.known}) · title="${q.title}"` +
          ` · thoughts=${JSON.stringify((out.thoughts ?? '').slice(0, 160))}`,
      );
      expect(out.origin, 'la tarea se resolvió en el dispositivo').toBe('model');
      expect(out.fallback, `fallback al plan local: ${JSON.stringify(out.fallback)}`).toBeUndefined();
      expect(out.payload, `payload sin parsear (finish=${out.finish}): ${out.text.slice(0, 300)}`).toBeTruthy();
      expect(Array.isArray((out.payload as { exercises?: unknown }).exercises)).toBe(true);
      expect(q.count, `nº de ejercicios = ${q.count}`).toBeGreaterThanOrEqual(4);
      expect(q.count).toBeLessThanOrEqual(7);
      expect(q.rationale, 'rationale ausente o vacío').toBe(true);
      expect(q.title.trim(), 'title ausente o vacío').not.toBe('');
      expect(out.finish, 'la respuesta vino cortada por tokens').not.toBe('MAX_TOKENS');
    },
    TIMEOUT,
  );

  it(
    '2 · plan con responseSchema + maxOutputTokens 8192 → 7 días y sin MAX_TOKENS',
    async () => {
      seedFixture();
      const out = await coach.runCoachTask('plan', {}, { generateFn: realGenerate });
      const days = Array.isArray((out.payload as { days?: unknown })?.days)
        ? ((out.payload as { days: unknown[] }).days as Record<string, unknown>[])
        : [];
      console.log(
        `[quality] 2 · plan · origin=${out.origin} · finish=${out.finish ?? '?'}` +
          ` · usage=${JSON.stringify(out.usage)} · ${out.ms} ms · días=${days.length}` +
          ` · thoughts=${JSON.stringify((out.thoughts ?? '').slice(0, 160))}`,
      );
      expect(out.origin, 'la tarea se resolvió en el dispositivo').toBe('model');
      expect(out.payload, `payload sin parsear (finish=${out.finish}): ${out.text.slice(0, 300)}`).toBeTruthy();
      expect(days.length, `days.length = ${days.length}`).toBe(7);
      for (const day of days) {
        expect(String(day.date), `fecha rara: ${String(day.date)}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(['entreno', 'cardio', 'movilidad', 'descanso'], `tipo: ${String(day.type)}`).toContain(
          String(day.type),
        );
      }
      expect(
        out.finish,
        'el plan se cortó en MAX_TOKENS: con thinking high los tokens de razonamiento ' +
          `descuentan del tope de 8192 · usage=${JSON.stringify(out.usage)}`,
      ).not.toBe('MAX_TOKENS');
    },
    TIMEOUT,
  );

  it(
    '3 · chat con historial previo en contents → respeta los records pegados',
    async () => {
      seedFixture();
      const history = [
        {
          role: 'user' as const,
          text: 'Te paso mis records: press de piso 90 kg × 5 y sentadilla 120 kg × 3.',
        },
        {
          role: 'model' as const,
          text: 'Anotados: press de piso 90 kg × 5 y sentadilla 120 kg × 3. Los tendré en cuenta para proponerte pesos.',
        },
        { role: 'user' as const, text: 'Perfecto, gracias.' },
      ];
      const out = await coach.runCoachTask(
        'chat',
        {
          userText: '¿Qué récord tengo en press de piso y qué peso me recomiendas para la próxima serie?',
          history,
          /* una sola llamada: el presupuesto es de 5 y aquí mide la memoria del
             turno, no el bucle de consulta (eso ya está cubierto en edge 2) */
          consultRounds: 0,
        },
        { generateFn: realGenerate },
      );
      const lower = out.text.toLowerCase();
      console.log(
        `[quality] 3 · chat-history · origin=${out.origin} · finish=${out.finish ?? '?'}` +
          ` · usage=${JSON.stringify(out.usage)} · ${out.ms} ms` +
          ` · cita 90=${out.text.includes('90')} · cita 120=${out.text.includes('120')}` +
          ` · texto=${JSON.stringify(out.text.slice(0, 600))}`,
      );
      expect(out.origin).toBe('model');
      expect(out.text, `no cita el record de 90 kg del historial previo: ${out.text.slice(0, 400)}`).toContain('90');
      expect(lower, 'la respuesta ni nombra el press de piso').toContain('press');
    },
    TIMEOUT,
  );

  it(
    '4 · la MISMA petición de suggest con thinking low y high (comparativa)',
    async () => {
      seedFixture();
      const req = buildRequest('suggest', {
        context: contextNow(),
        unit: store.settings.value.units,
        goal: store.settings.value.goal,
        daysPerWeek: store.settings.value.daysPerWeek,
      });

      /* El MISMO techo que aplica `runCoachTask` a `suggest`/`plan` (8192):
         con thinking los tokens de razonamiento descuentan del tope, y a 4096
         (default de `aiGenOptions`) el JSON sale cortado — comprobado en el
         smoke con thinking high. La comparativa mide calidad/latencia, no un
         límite que la app no usa en estas dos tareas. */
      const run = async (level: TestThinking): Promise<GenResult> =>
        realGenerate({
          apiKey: API_KEY,
          model: MODEL,
          system: req.system,
          prompt: req.prompt,
          json: req.json,
          maxOutputTokens: 8192,
          ...(req.responseSchema ? { responseSchema: req.responseSchema } : {}),
          thinkingLevel: level,
        });

      const low = await run('low');
      const high = await run('high');

      for (const [level, res] of [
        ['low', low],
        ['high', high],
      ] as const) {
        let payload: unknown = null;
        let error = '';
        try {
          payload = parseJSON<unknown>(res.text);
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }
        const q = quality(payload);
        console.log(
          `[quality] 4 · ${level} · ms=${res.ms} · finish=${res.finish ?? '?'}` +
            ` · usage=${JSON.stringify(res.usage)} · parse=${error || 'ok'}` +
            ` · ejercicios=${q.count} (en biblioteca: ${q.known}) · rationale=${q.rationale}` +
            ` · title="${q.title}" · thoughts=${JSON.stringify((res.thoughts ?? '').slice(0, 200))}`,
        );
        expect(error, `thinking ${level} no parsea: ${error}`).toBe('');
        expect(q.count, `thinking ${level}: ${q.count} ejercicios`).toBeGreaterThanOrEqual(4);
        expect(q.count).toBeLessThanOrEqual(7);
        expect(q.rationale, `thinking ${level}: rationale ausente`).toBe(true);
        expect(res.finish, `thinking ${level}: cortado por tokens`).not.toBe('MAX_TOKENS');
      }

      console.log(
        `[quality] 4 · COMPARATIVA → low: ${low.ms} ms / ${JSON.stringify(low.usage)}` +
          ` · high: ${high.ms} ms / ${JSON.stringify(high.usage)}` +
          ` · ratio latencia=${(high.ms / Math.max(1, low.ms)).toFixed(2)}x`,
      );
    },
    TIMEOUT,
  );
});
