/* eslint-disable no-console -- este test tiene que enseñar la respuesta real del modelo y su usage */

/**
 * Smoke test de INTEGRACIÓN: el cerebro entero del coach contra la API REAL de
 * Gemini (contexto → prompt → `generate` → parseo → memoria).
 *
 * Presupuesto duro: el archivo entero hace como mucho 2 llamadas (una por
 * test) y solo reintenta si el fallo es de red, porque la cuota son 500
 * requests/día. Sin API key el suite se salta entero en vez de fallar.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  SEED_EXERCISES,
  allowedExercises,
  equipPreset,
  findExerciseByName,
  isAvailable,
} from '@/domain/data';
import { addDays, today, weekDates } from '@/domain/dates';
import { DEFAULT_SETTINGS } from '@/domain/defaults';
import { mergeSeed } from '@/domain/library';
import type { Exercise, Session, SessionEntry, SetLog, Settings } from '@/domain/types';
import { GeminiError, generate } from './client';
import type { GenOpts, GenResult } from './client';
import { buildContext } from './context';
import { MEMORY_LIMIT, applyMemoryEntries, defaultMemory, extractMemoryBlock } from './memory';
import { parseJSON } from './parse';
import { MEMORY_INSTRUCTION, buildRequest } from './prompts';
import type { CoachRequest, CoachRoutine, CoachScheduleDay } from './types';

const MODEL = 'gemini-3.5-flash-lite';
/**
 * Techo por test. La API real de Gemini ahora mismo tarda 30-180 s por llamada
 * (y devuelve 503 «high demand» en los picos), así que un test que hace dos
 * llamadas NO cabe en un minuto: el fallo era el reloj del test, no la respuesta.
 */
const TIMEOUT = 300_000;
const MAX_CALLS = 2;
const QUESTION = '¿cómo me fue en press banca últimamente y qué debería cambiar?';

/* ---------- API key: process.env o .env.local de la raíz ---------- */

function stripQuotes(raw: string): string {
  const value = raw.trim();
  const quoted = /^(['"])([\s\S]*)\1$/.exec(value);
  return (quoted?.[2] ?? value).trim();
}

function loadKey(): string {
  const inline = process.env.GEMINI_API_KEY;
  if (inline?.trim()) return stripQuotes(inline);
  let raw: string;
  try {
    raw = readFileSync(fileURLToPath(new URL('../../../.env.local', import.meta.url)), 'utf8');
  } catch {
    return '';
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*GEMINI_API_KEY\s*=(.*)$/.exec(line);
    if (match?.[1] !== undefined) return stripQuotes(match[1]);
  }
  return '';
}

/** Texto de un campo JSON desconocido: `null`/objetos no se stringifican a `[object Object]`. */
function str(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** Número de un campo JSON desconocido: lo que no sea número sale `NaN` y TODO rango falla. */
function numOf(value: unknown): number {
  return typeof value === 'number' ? value : Number.NaN;
}

const API_KEY = loadKey();

/* ---------- presupuesto de llamadas ---------- */

let apiCalls = 0;

/**
 * Una llamada por test, con como mucho UN reintento y solo si el fallo es de
 * red (`GeminiError.kind === 'network'`): un 401 o una cuota agotada no se
 * repiten, se tiran tal cual para que el fallo se vea.
 */
async function callBrain(req: CoachRequest): Promise<GenResult> {
  const opts: GenOpts = {
    apiKey: API_KEY,
    model: MODEL,
    system: req.system,
    prompt: req.prompt,
    json: req.json,
    thinkingLevel: 'low',
  };
  if (req.history?.length) opts.history = req.history;

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (apiCalls >= MAX_CALLS) {
      throw new Error(`presupuesto de llamadas agotado (${apiCalls}/${MAX_CALLS})`);
    }
    apiCalls++;
    try {
      return await generate(opts);
    } catch (err) {
      const red = err instanceof GeminiError && err.kind === 'network';
      if (!red || attempt === 2 || apiCalls >= MAX_CALLS) throw err;
      console.warn('[smoke] fallo de red, un único reintento…');
    }
  }
  throw new Error('sin respuesta de Gemini');
}

/* ---------- fixture realista: material, biblioteca, sesiones y rutinas ---------- */

const HOY = today();
const EXERCISES: Exercise[] = mergeSeed(SEED_EXERCISES, []);
const EQUIPMENT = equipPreset('gym');
const PERMITIDOS: Exercise[] = allowedExercises(EXERCISES).filter((ex) =>
  isAvailable(ex, EQUIPMENT),
);

function exId(name: string): string {
  const found = findExerciseByName(EXERCISES, name);
  if (!found) throw new Error(`el fixture usa un ejercicio inexistente: ${name}`);
  if (!found.allowed || !isAvailable(found, EQUIPMENT)) {
    throw new Error(`el fixture usa un ejercicio no disponible: ${name}`);
  }
  return found.id;
}

function mkSets(weight: number, reps: number, count: number): SetLog[] {
  return Array.from({ length: count }, () => ({ weight, reps, done: true }));
}

function entry(name: string, weight: number, reps: number, count: number): SessionEntry {
  const ex = findExerciseByName(EXERCISES, name);
  return { exId: exId(name), name, group: ex?.group ?? '', sets: mkSets(weight, reps, count) };
}

function sessionAt(
  offset: number,
  routineId: string,
  name: string,
  entries: SessionEntry[],
): Session {
  const date = addDays(HOY, -offset);
  return {
    id: `smoke-${offset}`,
    name,
    routineId,
    date,
    startedAt: `${date}T09:30:00`,
    endedAt: `${date}T10:40:00`,
    unit: 'kg',
    entries,
  };
}

const ROUTINES: CoachRoutine[] = [
  {
    id: 'rt1',
    name: 'Empuje A',
    source: 'manual',
    focus: 'Pecho, espalda y hombros',
    items: [
      {
        exId: exId('Press de banca con barra'),
        sets: 4,
        repMin: 6,
        repMax: 10,
        rest: 180,
        weight: 85,
      },
      { exId: exId('Remo con barra'), sets: 4, repMin: 6, repMax: 10, rest: 180, weight: 70 },
      {
        exId: exId('Press militar con barra'),
        sets: 3,
        repMin: 6,
        repMax: 10,
        rest: 180,
        weight: 50,
      },
      {
        exId: exId('Elevaciones laterales con mancuernas'),
        sets: 3,
        repMin: 12,
        repMax: 18,
        rest: 75,
        weight: 12,
      },
    ],
  },
  {
    id: 'rt2',
    name: 'Tren inferior A',
    source: 'ai',
    focus: 'Piernas',
    items: [
      { exId: exId('Sentadilla con barra'), sets: 4, repMin: 6, repMax: 10, rest: 180, weight: 95 },
      { exId: exId('Peso muerto rumano'), sets: 3, repMin: 8, repMax: 12, rest: 150, weight: 85 },
      { exId: exId('Zancadas caminando'), sets: 3, repMin: 10, repMax: 12, rest: 90, weight: 20 },
      {
        exId: exId('Hip thrust con barra'),
        sets: 3,
        repMin: 10,
        repMax: 12,
        rest: 120,
        weight: 90,
      },
    ],
  },
];

const SESSIONS: Session[] = [
  sessionAt(2, 'rt1', 'Empuje A', [
    entry('Press de banca con barra', 80, 6, 4),
    entry('Remo con barra', 65, 8, 4),
    entry('Press militar con barra', 47.5, 7, 3),
    entry('Elevaciones laterales con mancuernas', 10, 12, 3),
  ]),
  sessionAt(4, 'rt2', 'Tren inferior A', [
    entry('Sentadilla con barra', 90, 6, 4),
    entry('Peso muerto rumano', 80, 8, 3),
    entry('Zancadas caminando', 20, 10, 3),
    entry('Hip thrust con barra', 85, 10, 3),
  ]),
  sessionAt(7, 'rt1', 'Empuje A', [
    entry('Press de banca con barra', 77.5, 7, 4),
    entry('Remo con barra', 62.5, 8, 4),
    entry('Press militar con barra', 45, 8, 3),
    entry('Elevaciones laterales con mancuernas', 10, 12, 3),
  ]),
  sessionAt(9, 'rt2', 'Tren inferior A', [
    entry('Sentadilla con barra', 87.5, 6, 4),
    entry('Peso muerto rumano', 77.5, 8, 3),
    entry('Zancadas caminando', 20, 10, 3),
    entry('Hip thrust con barra', 80, 10, 3),
  ]),
];

const SCHEDULE: Record<string, CoachScheduleDay> = {};
weekDates(HOY).forEach((iso, idx) => {
  if (idx === 6) SCHEDULE[iso] = { status: 'rest' };
  else SCHEDULE[iso] = { status: 'planned', routineId: idx % 2 === 0 ? 'rt1' : 'rt2' };
});

const MEMORIA = defaultMemory({
  profile: ['Entrena por la mañana, 4 días por semana', 'Objetivo: hipertrofia'],
  preferences: ['Prefiere barra libre a las máquinas'],
  works: ['Las series de 6-8 reps en compuestos le dan buen rendimiento'],
  fails: ['Se queda corto en las últimas reps cuando duerme mal'],
  patterns: ['Nunca ha fallado una sesión programada en lunes'],
});

const SETTINGS: Settings = {
  ...DEFAULT_SETTINGS,
  name: 'Ana',
  level: 'intermedio',
  goal: 'hipertrofia',
  daysPerWeek: 4,
  increment: 2.5,
  plates: [
    { w: 10, unit: 'kg', discs: 8, on: true },
    { w: 5, unit: 'kg', discs: 8, on: true },
    { w: 2.5, unit: 'kg', discs: 4, on: true },
    { w: 1.25, unit: 'kg', discs: 4, on: true },
    { w: 0.5, unit: 'kg', discs: 4, on: true },
  ],
  bars: { olimpica: 20, ez: 10, mancuerna: 0 },
  ai: { ...DEFAULT_SETTINGS.ai, memory: MEMORIA },
};

const CONTEXT = buildContext({
  settings: SETTINGS,
  sessions: SESSIONS,
  routines: ROUTINES,
  schedule: SCHEDULE,
  equipment: EQUIPMENT,
  exercises: EXERCISES,
  opts: { todayIso: HOY },
});

/* ---------- los dos tests (dos llamadas, ni una más) ---------- */

/** Sin API key el suite entero se salta: no se falla, no se llama a nadie. */
function suite(name: string, fn: () => void): void {
  if (API_KEY) describe(name, fn);
  else describe.skip(name, fn);
}

suite('coach IA contra Gemini (smoke)', () => {
  it(
    'suggest → JSON con ejercicios del catálogo permitido',
    async () => {
      const req = buildRequest('suggest', {
        context: CONTEXT,
        unit: SETTINGS.units,
        goal: SETTINGS.goal,
        daysPerWeek: SETTINGS.daysPerWeek,
      });
      expect(req.json, 'suggest debe pedir JSON').toBe(true);

      const res = await callBrain(req);
      console.log(
        `[smoke] suggest: finish=${res.finish ?? '?'} · usage=${JSON.stringify(res.usage)}` +
          ` · resp=${JSON.stringify(res.text.slice(0, 300))}`,
      );
      const reply = parseJSON<unknown>(res.text);
      expect(
        reply !== null && typeof reply === 'object' && !Array.isArray(reply),
        `la respuesta no es un objeto JSON: ${res.text.slice(0, 200)}`,
      ).toBe(true);
      const data = reply as Record<string, unknown>;

      const title = str(data.title).trim();
      expect(title, 'title ausente o vacío').not.toBe('');

      expect(Array.isArray(data.exercises), 'exercises no es un array').toBe(true);
      const list = Array.isArray(data.exercises)
        ? (data.exercises as Record<string, unknown>[])
        : [];
      expect(list.length, `nº de ejercicios = ${list.length}`).toBeGreaterThanOrEqual(4);
      expect(list.length).toBeLessThanOrEqual(7);

      for (const item of list) {
        const name = str(item.name).trim();
        expect(name, 'ejercicio sin name').not.toBe('');
        expect(
          findExerciseByName(PERMITIDOS, name),
          `«${name}» no está en la biblioteca permitida`,
        ).not.toBeNull();
        expect(numOf(item.sets), `sets de «${name}»`).toBeGreaterThanOrEqual(1);
        expect(numOf(item.sets), `sets de «${name}»`).toBeLessThanOrEqual(10);
        expect(numOf(item.weight), `weight de «${name}»`).toBeGreaterThanOrEqual(0);
        expect(numOf(item.rest), `rest de «${name}»`).toBeGreaterThanOrEqual(0);
        expect(numOf(item.rest), `rest de «${name}»`).toBeLessThanOrEqual(300);
      }

      const rationale: unknown = data.rationale;
      const texto =
        typeof rationale === 'string'
          ? rationale
          : Array.isArray(rationale)
            ? rationale.map(str).join(' ')
            : '';
      expect(texto.trim(), 'rationale ausente o vacío').not.toBe('');

      console.log(
        `[smoke] suggest → "${title}" · ${list.length} ejercicios · finish=${res.finish ?? '?'} · usage=${JSON.stringify(res.usage)}`,
      );
    },
    TIMEOUT,
  );

  it(
    'chat → cierra con el bloque ```memoria``` y la memoria crece',
    async () => {
      const req = buildRequest('chat', {
        context: CONTEXT,
        question: QUESTION,
        unit: SETTINGS.units,
        goal: SETTINGS.goal,
      });
      expect(req.json, 'chat no debe pedir JSON').toBe(false);
      expect(req.system, 'el system no lleva MEMORY_INSTRUCTION').toContain(MEMORY_INSTRUCTION);

      const res = await callBrain(req);
      const { rest, block } = extractMemoryBlock(res.text);
      console.log(
        `[smoke] chat → finish=${res.finish ?? '?'} · usage=${JSON.stringify(res.usage)}` +
          ` · resp=${JSON.stringify(res.text.slice(0, 500))}`,
      );
      if (!block) {
        const suelto = res.text.includes('```memoria');
        console.warn(
          `[smoke] sin bloque final${suelto ? ' AUNQUE el fence aparece (no cierra la respuesta)' : ' (el modelo no emitió ```memoria)'}` +
            ` · final=${JSON.stringify(res.text.slice(-300))}`,
        );
      }
      expect(
        block,
        'La respuesta NO termina en un bloque ```memoria```, pese a que MEMORY_INSTRUCTION ' +
          `está en el system. Fin de la respuesta: …${res.text.slice(-200)}`,
      ).not.toBeNull();

      const update = applyMemoryEntries(MEMORIA, block as string);
      expect(
        update.added.length,
        `entradas nuevas: ${JSON.stringify(update.added)} · bloque: ${JSON.stringify(block)}`,
      ).toBeGreaterThanOrEqual(1);
      expect(update.memory.length).toBeLessThanOrEqual(MEMORY_LIMIT);

      console.log(
        `[smoke] chat → ${JSON.stringify(rest.slice(0, 300))} · +${update.added.length} entradas · finish=${res.finish ?? '?'} · usage=${JSON.stringify(res.usage)}`,
      );
    },
    TIMEOUT,
  );
});
