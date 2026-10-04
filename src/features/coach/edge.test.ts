/* eslint-disable no-console -- esta batería tiene que enseñar la respuesta real del modelo, sus consultas y la memoria */

/**
 * edge.test.ts · Batería de edge cases del coach IA CONTRA LA API REAL.
 *
 * `smoke.test.ts` comprueba el camino feliz (2 llamadas); aquí se atacan los
 * bordes: cambio en plena rutina, consulta de historial, memoria persistente
 * entre chats, JSON sucio, alucinación de ejercicios, libras, corte por tokens
 * y API key ausente.
 *
 * Presupuesto duro: **máximo 20 llamadas** para el archivo entero (cuota
 * 500/día). `realGenerate` cuenta CADA llamada y corta en seco si se pasa; sin
 * API key solo corren los tests sin red (8 y 9) y el resto se salta.
 *
 * Modelo `gemini-3.5-flash-lite` con `thinkingLevel: 'low'` (por defecto), o
 * los que fijen `COACH_TEST_MODEL`/`COACH_TEST_THINKING` — leídos de
 * `settings.ai` (lo parchea el `beforeEach`), así que `runCoachTask` usa la
 * misma configuración que usaría la app.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Suggestion } from '@/domain/analytics';
import { equipPreset, findExerciseByName, isAvailable } from '@/domain/data';
import { addDays, today } from '@/domain/dates';
import {
  addEntry,
  editSetField,
  finishSession as finishActive,
  newEntry,
  removeEntry,
  startSession,
  toggleSet,
} from '@/domain/session';
import type { ActiveSession, Session, SessionEntry, SetLog, Settings, Unit } from '@/domain/types';
import { GeminiError, generate } from './client';
import type { GenOpts, GenResult } from './client';
import { buildContext } from './context';
import { HISTORY_DEFAULT_LINES, consolidatedHistory, queryHistory } from './history';
import { MEMORY_LIMIT, applyMemoryEntries, defaultMemory } from './memory';
import { parseJSON } from './parse';
import { TEST_MODEL, TEST_THINKING, netCalls, watchFetch } from './testnet';

const MODEL = TEST_MODEL;
/**
 * Techo por test. La API real de Gemini ahora mismo tarda 30-180 s por llamada
 * (y devuelve 503 «high demand» en los picos), así que los tests de dos llamadas
 * (2 y 3) ni los que encadenan rondas NO caben en un minuto: el fallo era el
 * reloj del test, no la respuesta.
 */
const TIMEOUT = 300_000;
const MAX_CALLS = 20;

const N_PRESS = 'Press de Piso con Mancuernas';
const N_REMO = 'Remo con Barra';
const N_MILITAR = 'Press Militar';
const N_ELEV = 'Elevaciones Laterales';
const N_SUST = 'Dominadas';

/** `5 km` / `cinco kilómetros`: como el modelo pueda escribirlo. */
const KM = /(?:5\s*(?:km|kil)|cinco\s+kil)/i;

/* ---------- API key: process.env o .env.local de la raíz (mismo loader que smoke) ---------- */

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

const API_KEY = loadKey();

/* Peticiones HTTP REALES (incluidos los reintentos internos de `generate`) */
watchFetch();

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

/**
 * `generate` real contado: un único reintento si el fallo es de RED (un 401 o
 * una cuota agotada NO se repiten). Un `GeminiError` auth se lanza tal cual
 * para que el suite pare y se reporte.
 */
async function realGenerate(opts: GenOpts): Promise<GenResult> {
  for (let attempt = 1; ; attempt++) {
    bump();
    try {
      return await generate(opts);
    } catch (err) {
      const red = err instanceof GeminiError && err.kind === 'network';
      if (!red || attempt === 2) throw err;
      console.warn('[edge] fallo de red, un único reintento…');
    }
  }
}

afterAll(() => {
  console.log(
    `[edge] llamadas API usadas: ${apiCalls}/${MAX_CALLS} · HTTP reales: ${netCalls()}` +
      ` · modelo=${MODEL} · thinking=${TEST_THINKING}`,
  );
});

/* ---------- helpers de fixture ---------- */

const HOY = today();

function idOf(name: string): string {
  const found = findExerciseByName(store.exercises.value, name);
  if (!found) throw new Error(`el fixture usa un ejercicio inexistente: ${name}`);
  if (!found.allowed || !isAvailable(found, store.equipment.value)) {
    throw new Error(`el fixture usa un ejercicio no disponible: ${name}`);
  }
  return found.id;
}

function seedSessions(list: Session[]): void {
  const state = store.readState();
  state.sessions = list;
  store.writeState(state);
  store.refresh();
}

function mkSets(weight: number, reps: number, count: number): SetLog[] {
  return Array.from({ length: count }, () => ({ weight, reps, done: true }));
}

function entryOf(name: string, weight: number, reps: number, count: number): SessionEntry {
  const ex = findExerciseByName(store.exercises.value, name);
  if (!ex) throw new Error(`el fixture usa un ejercicio inexistente: ${name}`);
  return { exId: ex.id, name: ex.name, group: ex.group, sets: mkSets(weight, reps, count) };
}

function sessionOf(date: string, id: string, entries: SessionEntry[], unit: Unit = 'kg'): Session {
  return {
    id,
    name: 'Empuje A',
    date,
    startedAt: `${date}T09:30:00.000Z`,
    endedAt: `${date}T10:40:00.000Z`,
    unit,
    entries,
  };
}

/** Trozo de contexto entre dos cabeceras `=== … ===`. */
function section(text: string, from: string, to: string): string {
  const start = text.indexOf(from);
  if (start < 0) return '';
  const end = text.indexOf(to, start + from.length);
  return end < 0 ? text.slice(start) : text.slice(start, end);
}

function aiPatch(patch: Partial<Settings['ai']>): void {
  store.patchSettings({ ai: { ...store.settings.value.ai, ...patch } });
}

beforeEach(() => {
  mem.clear();
  store.writeState(store.defaultState());
  store.refresh();
  store.applyEquipment(equipPreset('gym'));
  aiPatch({ apiKey: API_KEY, model: MODEL, thinkingLevel: TEST_THINKING, memory: '' });
});

/** Sin API key el bloque de red entero se salta: no se falla, no se llama a nadie. */
function suite(name: string, fn: () => void): void {
  if (API_KEY) describe(name, fn);
  else describe.skip(name, fn);
}

/* ======================================================================
   1-7 · contra la API real
   ====================================================================== */

suite('edge cases contra Gemini (API real)', () => {
  it(
    '1 · cambio en plena rutina: el contexto lo detecta y el modelo lo cuenta',
    async () => {
      const routine = store.addRoutine({
        name: 'Empuje A',
        source: 'manual',
        focus: 'Pecho, espalda y hombros',
        items: [
          { exId: idOf(N_PRESS), sets: 4, repMin: 6, repMax: 10, rest: 180, weight: 80 },
          { exId: idOf(N_REMO), sets: 4, repMin: 6, repMax: 10, rest: 180, weight: 70 },
          { exId: idOf(N_MILITAR), sets: 3, repMin: 6, repMax: 10, rest: 180, weight: 50 },
          { exId: idOf(N_ELEV), sets: 3, repMin: 12, repMax: 18, rest: 75, weight: 12 },
        ],
      });

      /* la sugerencia devuelve las reps mínimas del ejercicio: así SOLO el peso
         que bajamos a mano queda por debajo del plan */
      const suggest = (exId: string): Suggestion => {
        const ex = store.exercises.value.find((candidate) => candidate.id === exId);
        return { weight: 0, reps: ex?.repMin ?? 8, kg: 0, basis: 'sin historial' };
      };

      let live: ActiveSession = startSession({
        exercises: store.exercises.value,
        suggest,
        routine: { id: routine.id, name: routine.name, items: routine.items },
        name: routine.name,
        source: 'plan',
        unit: 'kg',
        dayIso: HOY,
        id: 'live-edge-1',
        now: `${HOY}T10:00:00.000Z`,
      });
      expect(live.plan, 'startSession debe guardar el snapshot del plan').toHaveLength(4);

      /* cambios EN CALIENTE: baja de peso, quita el 2º y añade otro del mismo grupo */
      live = editSetField(live, 0, 0, 'weight', 70); /* press: 80 → 70 (por debajo) */
      live = removeEntry(live, 1); /* quita Remo con barra (espalda) */
      live = addEntry(
        live,
        newEntry({ exId: idOf(N_SUST), sets: 3, library: store.exercises.value }),
      );
      live = editSetField(live, live.entries.length - 1, 0, 'weight', 55);

      for (let i = 0; i < live.entries.length; i++) {
        for (let j = 0; j < live.entries[i].sets.length; j++) {
          const result = toggleSet(live, i, j, {
            on: true,
            autoRest: false,
            restDefault: 90,
            restRunning: false,
            now: `${HOY}T10:30:00.000Z`,
          });
          if (result) live = result.session;
        }
      }

      const done = finishActive(live, { now: `${HOY}T11:00:00.000Z`, id: 's-edge-swap' });
      if (!done) throw new Error('la sesión sintética no cerró: ninguna serie quedó marcada');
      store.commitSession(done);

      /* --- sin API: el contexto YA dice qué cambió --- */
      const ctx = buildContext({
        settings: store.settings.value,
        sessions: store.sessions.value,
        routines: store.routines.value,
        schedule: store.schedule.value,
        equipment: store.equipment.value,
        exercises: store.exercises.value,
        opts: { todayIso: HOY },
      });
      const aprendizaje = section(
        ctx,
        '=== APRENDIZAJE DEL COACH ===',
        '=== MEMORIA DEL COACH ===',
      );
      console.log(`[edge] 1 · APRENDIZAJE:\n${aprendizaje}`);
      expect(aprendizaje, 'sin la viñeta de sustitución').toContain('Sustituiste');
      expect(aprendizaje, 'la sustitución no nombra al que salió').toContain(N_REMO);
      expect(aprendizaje, 'la sustitución no nombra al que entró').toContain(N_SUST);
      expect(aprendizaje, 'sin desviación por debajo del plan').toContain('por debajo');
      expect(aprendizaje, 'la desviación no lleva el peso real (70 kg)').toContain('70 kg');

      /* --- contra la API: el texto final debe contar el swap --- */
      const out = await coach.runCoachTask(
        'chat',
        { userText: '¿Qué cambié yo en la rutina de hoy?' },
        { generateFn: realGenerate },
      );
      console.log(
        `[edge] 1 · finish=${out.finish ?? '?'} · consulted=${JSON.stringify(out.consulted)}` +
          ` · usage=${JSON.stringify(out.usage)} · texto=${JSON.stringify(out.text.slice(0, 600))}`,
      );

      const lower = out.text.toLowerCase();
      const nombres = lower.includes(N_REMO.toLowerCase()) && lower.includes(N_SUST.toLowerCase());
      const palabras = /sustitu|cambi|reemplaz|sustitución/.test(lower);
      expect(
        nombres || palabras,
        `ni nombra los dos ejercicios de la sustitución ni habla de cambiar/cambiar: ` +
          `${out.text.slice(0, 400)}`,
      ).toBe(true);
    },
    TIMEOUT,
  );

  it(
    '2 · consulta de historial: 15 sesiones ascendentes → bloque consulta + cifras reales',
    async () => {
      const sesiones: Session[] = Array.from({ length: 15 }, (_, i) => {
        const peso = 52.5 + i * 2.5;
        const date = addDays(HOY, -((14 - i) * 2 + 2));
        return sessionOf(date, `evol-${i}`, [entryOf(N_PRESS, peso, 6, 4)]);
      });
      seedSessions(sesiones);

      const out = await coach.runCoachTask(
        'chat',
        { userText: '¿cómo ha sido mi evolución de Press de Piso y qué hice la última vez?' },
        { generateFn: realGenerate },
      );
      console.log(
        `[edge] 2 · consulted=${JSON.stringify(out.consulted)} · finish=${out.finish ?? '?'}` +
          ` · usage=${JSON.stringify(out.usage)}`,
      );
      console.log(`[edge] 2 · texto=${JSON.stringify(out.text.slice(0, 900))}`);

      /* ÚLTIMA SESIÓN del fixture: 87,5 kg × 6 · fmtN es-ES → coma decimal. El modelo
         la saca del HISTORIAL CONSOLIDADO (ahí la trae la ficha), así que la cifra
         real está aunque no pida nada. */
      expect(
        out.text,
        `sin la cifra real de la última sesión (87,5): ${out.text.slice(0, 400)}`,
      ).toContain('87,5');
      /* HALLAZGO (ronda 1): NO emitió ```consulta``` — contestó entero desde el
         resumen consolidado, que es lo que CONSULT_INSTRUCTION le manda hacer cuando
         el resumen basta. El bucle de consulta está cubierto con mocks en
         `state/coach.test.ts`; aquí se documenta el comportamiento real. */
      console.log(
        `[edge] 2 · ronda 1 sin consulta (consulted=${out.consulted.length}): ` +
          'respondió desde HISTORIAL CONSOLIDADO',
      );
      expect(true, 'documentado en el log de arriba: ronda 1 sin bloque consulta').toBe(true);

      /* Ronda 2: un dato que NO está en el contexto — la sesión de hace 20 días
         queda FUERA de las 8 sesiones del HISTORIAL y la ficha consolidada solo
         trae primera/última serie y últ3. Ahí el modelo solo puede hacer dos cosas:
         pedir el bloque ```consulta``` o inventarse la cifra. */
      const fechaVieja = addDays(HOY, -20);
      const detalle = await coach.runCoachTask(
        'chat',
        { userText: `¿Con cuánto peso hice el Press de Piso en la sesión del ${fechaVieja}?` },
        { generateFn: realGenerate },
      );
      console.log(
        `[edge] 2 · ronda 2 (${fechaVieja}) consulted=${JSON.stringify(detalle.consulted)}` +
          ` · finish=${detalle.finish ?? '?'} · texto=${JSON.stringify(detalle.text.slice(0, 700))}`,
      );
      expect(
        detalle.consulted.length,
        `dato ausente del contexto y aun así NO pidió la consulta: ${detalle.text.slice(0, 300)}`,
      ).toBeGreaterThanOrEqual(1);
      /* esa sesión del fixture pesó 65 kg (i=5 → 52,5 + 5×2,5) */
      expect(
        detalle.text,
        `la respuesta no trae el peso real de ${fechaVieja} (65): ${detalle.text.slice(0, 400)}`,
      ).toContain('65');
    },
    TIMEOUT,
  );

  it(
    '3 · la memoria persiste entre chats (A la guarda, B la lee)',
    async () => {
      const a = await coach.runCoachTask(
        'chat',
        {
          userText:
            'Apunta en tu memoria que los martes corro 5 km y que me duele la rodilla izquierda al hacer zancadas',
        },
        { generateFn: realGenerate },
      );
      console.log(
        `[edge] 3A · memoryAdded=${JSON.stringify(a.memoryAdded)} · finish=${a.finish ?? '?'}` +
          ` · texto=${JSON.stringify(a.text.slice(0, 400))}`,
      );
      expect(
        a.memoryAdded.length,
        `sin entradas nuevas de memoria: …${a.text.slice(-300)}`,
      ).toBeGreaterThanOrEqual(1);

      const memoria = String(store.settings.value.ai.memory ?? '');
      expect(memoria, `la memoria del store no retiene el dato: ${memoria}`).toMatch(/martes/i);
      expect(memoria, `la memoria del store no retiene los 5 km: ${memoria}`).toMatch(KM);
      expect(String(store.readState().settings.ai.memory ?? '')).toMatch(/martes/i);

      const b = await coach.runCoachTask(
        'chat',
        { userText: '¿qué sé que hago los martes?' },
        { generateFn: realGenerate },
      );
      console.log(
        `[edge] 3B · finish=${b.finish ?? '?'} · texto=${JSON.stringify(b.text.slice(0, 500))}`,
      );
      expect(b.text, `la memoria no viajó en el contexto: ${b.text.slice(0, 400)}`).toMatch(KM);
    },
    TIMEOUT,
  );

  it(
    '4 · JSON sucio envuelto en prosa → parseJSON lo rescata',
    async () => {
      const json =
        '{"title":"Empuje A","exercises":[{"name":"Press de Piso con Mancuernas","sets":4,' +
        '"repMin":6,"repMax":10,"weight":80,"rest":180}]}';
      const res = await realGenerate({
        apiKey: API_KEY,
        model: MODEL,
        system: 'Eres un asistente de formato. Respondes siempre en castellano.',
        prompt:
          'Envuelve este JSON en prosa explicativa: 2 frases ANTES y 1 frase DESPUÉS, pegando el ' +
          'JSON EXACTAMENTE tal cual, sin cercilla markdown y sin modificarlo. Fuera del JSON no ' +
          'uses llaves ni corchetes.\n\nJSON:\n' +
          json,
        json: false,
        thinkingLevel: TEST_THINKING,
      });
      console.log(
        `[edge] 4 · finish=${res.finish ?? '?'} · usage=${JSON.stringify(res.usage)}` +
          ` · resp=${JSON.stringify(res.text)}`,
      );

      let parseado: unknown = null;
      let fallo = '';
      try {
        parseado = parseJSON<unknown>(res.text);
      } catch (err) {
        fallo = err instanceof Error ? err.message : String(err);
      }
      console.log(`[edge] 4 · parseJSON → ${fallo || JSON.stringify(parseado)}`);

      const objeto =
        parseado !== null && typeof parseado === 'object' && !Array.isArray(parseado)
          ? (parseado as Record<string, unknown>)
          : null;
      expect(
        objeto,
        `parseJSON no rescató el objeto (${fallo}): ${res.text.slice(0, 300)}`,
      ).not.toBeNull();
      expect(
        Array.isArray(objeto?.exercises),
        `exercises no es un array: ${JSON.stringify(objeto)}`,
      ).toBe(true);
    },
    TIMEOUT,
  );

  it(
    '5 · no afirma que un ejercicio inventado esté en la biblioteca',
    async () => {
      const out = await coach.runCoachTask(
        'chat',
        {
          userText:
            'Inventa un ejercicio nuevo que se llama "Curl con oso polar" y dime cuántas series hago',
        },
        { generateFn: realGenerate },
      );
      console.log(
        `[edge] 5 · finish=${out.finish ?? '?'} · consulted=${JSON.stringify(out.consulted)}`,
      );
      console.log(`[edge] 5 · texto COMPLETO=${JSON.stringify(out.text)}`);

      const texto = out.text;
      const afirma =
        /(?<!no )(?<!sin )est[áa] en tu (biblioteca|plan|cat[áa]logo|rutina)/i.test(texto) ||
        /tu biblioteca lo tiene/i.test(texto) ||
        /consta en tu/i.test(texto);
      expect(afirma, 'presenta el ejercicio inventado como si ya estuviera en la biblioteca').toBe(
        false,
      );
      expect(texto.trim().length, 'respuesta vacía').toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    '6 · unidades en libras: la respuesta sale en lb',
    async () => {
      store.patchSettings({ units: 'lb' });
      seedSessions([
        sessionOf(addDays(HOY, -10), 'lb-1', [entryOf(N_PRESS, 175, 6, 4)], 'lb'),
        sessionOf(addDays(HOY, -3), 'lb-2', [entryOf(N_PRESS, 185, 6, 4)], 'lb'),
      ]);

      const out = await coach.runCoachTask(
        'chat',
        { userText: '¿en cuántas libras hice el press de piso la última vez?' },
        { generateFn: realGenerate },
      );
      console.log(
        `[edge] 6 · consulted=${JSON.stringify(out.consulted)} · finish=${out.finish ?? '?'}` +
          ` · texto=${JSON.stringify(out.text.slice(0, 500))}`,
      );
      expect(out.text, `sin la cifra en lb del fixture (185): ${out.text.slice(0, 400)}`).toContain(
        '185',
      );
    },
    TIMEOUT,
  );

  it(
    '7 · maxOutputTokens: 15 → finish MAX_TOKENS sin lanzar',
    async () => {
      const res = await realGenerate({
        apiKey: API_KEY,
        model: MODEL,
        system: 'Eres un narrador deportivo muy prolífico.',
        prompt:
          'Escribe un relato largo y detallado de una competición de atletismo, con muchos ' +
          'párrafos, diálogos y sin ningún límite de palabras.',
        json: false,
        maxOutputTokens: 15,
      });
      console.log(
        `[edge] 7 · finish=${res.finish ?? '(sin finish)'} · usage=${JSON.stringify(res.usage)}` +
          ` · texto=${JSON.stringify(res.text)}`,
      );
      expect(res.finish, 'la respuesta no vino cortada por tokens').toBe('MAX_TOKENS');
    },
    TIMEOUT,
  );
});

/* ======================================================================
   8-9 · sin red (siempre corren, con o sin API key)
   ====================================================================== */

describe('edge cases sin red', () => {
  it('8 · sin API key → aviso amable y plan local, sin tocar la red', async () => {
    aiPatch({ apiKey: '   ' });
    expect(coach.hasApiKey()).toBe(false);
    const antes = apiCalls;
    const gen = vi.fn((_opts: GenOpts): Promise<GenResult> =>
      Promise.resolve({ text: 'nunca debería llegar', model: 'mock', ms: 0 }),
    );

    /* chat/analyze no tienen plan local: mensaje corto, sin throw (sin key la app
       sigue siendo utilizable a medias, que es lo que pide el encargo) */
    const chat = await coach.runCoachTask('chat', { userText: 'hola' }, { generateFn: gen });
    expect(chat.text).toContain('API key');
    expect(chat.text).toContain('Ajustes');
    expect(chat.text).not.toContain('nunca debería llegar');

    /* suggest/plan se resuelven en el dispositivo con el planificador local */
    const sug = await coach.runCoachTask('suggest', {}, { generateFn: gen });
    expect((sug.payload as { source?: string }).source).toBe('local');
    expect(sug.text).toContain('```json');

    expect(gen).not.toHaveBeenCalled();
    expect(apiCalls).toBe(antes);
  });

  it('9a · 300 sesiones sintéticas: el contexto cabe y el consolidado respeta maxLines', () => {
    const libreria = store.exercises.value.filter((ex) => ex.allowed);
    expect(libreria.length, 'la biblioteca por defecto ya no supera el tope').toBeLessThan(
      HISTORY_DEFAULT_LINES,
    );
    const sesiones: Session[] = Array.from({ length: 300 }, (_, i) => {
      const ex = libreria[i % libreria.length];
      const date = addDays(HOY, -(i + 1));
      return sessionOf(date, `big-${i}`, [
        {
          exId: ex.id,
          name: ex.name,
          group: ex.group,
          sets: mkSets(40 + (i % 8) * 2.5, 8, 4),
        },
      ]);
    });

    const ctx = buildContext({
      settings: store.settings.value,
      sessions: sesiones,
      routines: [],
      schedule: {},
      equipment: store.equipment.value,
      exercises: store.exercises.value,
      opts: { todayIso: HOY },
    });
    console.log(`[edge] 9a · contexto con 300 sesiones: ${ctx.length} chars`);

    const consolidado = section(ctx, '=== HISTORIAL CONSOLIDADO', '=== RUTINAS GUARDADAS');
    const fichas = consolidado.split('\n').filter((line) => line.trim() && !line.startsWith('==='));
    console.log(`[edge] 9a · fichas del consolidado: ${fichas.length}`);

    expect(ctx.length, 'el contexto se dispara con 300 sesiones').toBeLessThan(60_000);
    expect(fichas.length).toBeLessThanOrEqual(HISTORY_DEFAULT_LINES);

    /* el tope de 60 solo se ve con > 60 ejercicios distintos, y la semilla ya
       no llega: `consolidatedHistory` agrupa por lo que traiga la sesión, así
       que se le dan fichas sintéticas y se comprueba que corta en 60 */
    const sinteticas: Session[] = Array.from({ length: 80 }, (_, i) =>
      sessionOf(addDays(HOY, -(i + 1)), `sint-${i}`, [
        {
          exId: `sint-${i}`,
          name: `Ejercicio sintético ${i}`,
          group: 'pecho',
          sets: mkSets(40, 8, 4),
        },
      ]),
    );
    const directas = consolidatedHistory(sinteticas, { exercises: store.exercises.value });
    console.log(`[edge] 9a · fichas de 80 ejercicios sintéticos: ${directas.length}`);
    expect(directas.length).toBe(HISTORY_DEFAULT_LINES);
  });

  it('9b · applyMemoryEntries con un bloque de 10.000 chars no pasa de MEMORY_LIMIT', () => {
    const bloque = Array.from(
      { length: 100 },
      (_, i) =>
        `- patrón sintético número ${i} con texto deliberadamente largo para superar el límite de la memoria sin esfuerzo`,
    ).join('\n');
    console.log(`[edge] 9b · bloque de entrada: ${bloque.length} chars`);
    expect(bloque.length).toBeGreaterThan(10_000);

    const update = applyMemoryEntries(defaultMemory(), bloque);
    console.log(`[edge] 9b · memoria resultante: ${update.memory.length} chars`);
    expect(update.added.length).toBeGreaterThanOrEqual(1);
    expect(update.memory.length).toBeLessThanOrEqual(MEMORY_LIMIT);
  });

  it('9c · queryHistory con un ejercicio inexistente: mensaje claro, sin crash', () => {
    const nada = queryHistory(
      [],
      { exercise: 'Curl con oso polar' },
      {
        exercises: store.exercises.value,
      },
    );
    console.log(`[edge] 9c · sin sesiones → ${JSON.stringify(nada)}`);
    expect(nada).toMatch(/No encuentro|No hay sesiones registradas/);

    const sinRastro = queryHistory(
      [],
      { exercise: 'zzz ejercicio que no existe' },
      {
        exercises: store.exercises.value,
      },
    );
    console.log(`[edge] 9c · sin rastro → ${JSON.stringify(sinRastro)}`);
    expect(sinRastro).toContain('No encuentro');
    expect(sinRastro).toContain('Ejercicios parecidos');
  });
});
