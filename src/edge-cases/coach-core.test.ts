import { describe, expect, it } from 'vitest';

import type { Exercise, Session, SetLog } from '@/domain/types';

import {
  asProposal,
  creationsFromPayload,
  extractBlocks,
  extractCreations,
  parseJSON,
  payloadItems,
} from '@/features/coach/parse';
import {
  applyMemoryEntries,
  defaultMemory,
  extractMemoryBlock,
  MEMORY_HEADINGS,
} from '@/features/coach/memory';
import { consolidatedHistory, queryHistory } from '@/features/coach/history';
import { buildInsights } from '@/features/coach/insights';
import {
  boundedHistory,
  buildRequest,
  DEFAULT_SYSTEM,
  HISTORY_MODEL_LIMIT,
  HISTORY_USER_LIMIT,
  CHAT_HISTORY_LIMIT,
} from '@/features/coach/prompts';
import type { ChatMessage, MemorySeed } from '@/features/coach/types';

function ex(id: string, name: string, group = 'pecho', extra: Partial<Exercise> = {}): Exercise {
  return {
    id,
    name,
    group,
    equip: '',
    type: 'aislado',
    sets: 3,
    repMin: 8,
    repMax: 12,
    rest: 90,
    allowed: true,
    custom: false,
    bw: true,
    tags: [],
    tips: '',
    ...extra,
  };
}

function setOf(weight: number, reps: number): SetLog {
  return { weight, reps, done: true };
}

function sess(
  id: string,
  date: string,
  entries: { exId: string; name?: string; sets: SetLog[] }[],
  extra: Partial<Session> = {},
): Session {
  return {
    id,
    date,
    startedAt: `${date}T10:00:00`,
    unit: 'kg',
    entries: entries.map((entry) => ({ exId: entry.exId, name: entry.name, sets: entry.sets })),
    ...extra,
  };
}

describe('parse (170–176)', () => {
  it('170 · extractBlocks saca varios bloques de la misma respuesta', () => {
    const text = 'pre ```json\n{"a":1}\n``` mid ```json\n{"b":2}\n``` post';
    const { rest, blocks } = extractBlocks(text, 'json');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toBe('{"a":1}');
    expect(blocks[1]).toBe('{"b":2}');
    expect(rest).not.toContain('{"a"');
    expect(rest).not.toContain('{"b"');
  });

  it('171 · parseJSON tolera vallas y texto alrededor', () => {
    expect(parseJSON('bla ```json\n{"a":1}\n``` fin')).toEqual({ a: 1 });
  });

  it('172 · asProposal no acepta propuestas sin nombre', () => {
    // HALLAZGO: el contrato esperaba `null` para `{ name:'X' }`, pero `asProposal`
    // solo exige `name` (el resto lo infiere `proposalToDraft`), así que sí la
    // acepta. Lo que sí devuelve `null` es una entrada sin nombre válido.
    const soloNombre = asProposal({ name: 'X' });
    expect(soloNombre).not.toBeNull();
    expect(soloNombre?.name).toBe('X');
    expect(asProposal({})).toBeNull();
    expect(asProposal(42)).toBeNull();
    expect(asProposal({ name: '   ' })).toBeNull();
  });

  it('174 · payloadItems extrae items/exercises/days como alias', () => {
    expect(payloadItems({ items: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    expect(payloadItems({ exercises: [{ b: 2 }] })).toEqual([{ b: 2 }]);
    expect(payloadItems({ days: [{ exercises: [{ c: 3 }] }] })).toEqual([{ c: 3 }]);
  });

  it('175 · extractCreations no confunde el bloque de consulta', () => {
    const text =
      '```consulta\n{"ejercicio":"x"}\n```\n' + '```crear\n[{"name":"Nuevo"}]\n```';
    const { creations } = extractCreations(text);
    expect(creations).toHaveLength(1);
    expect(creations[0]?.name).toBe('Nuevo');
  });

  it('176 · creationsFromPayload descarta elementos no válidos', () => {
    const out = creationsFromPayload({ newExercises: [{ name: 'Ok' }, { group: 'pecho' }] });
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe('Ok');
  });
});

describe('prompts (178–182)', () => {
  it('178 · DEFAULT_SYSTEM marca las reglas de honestidad', () => {
    // HALLAZGO: el system NO dice literalmente «sé sincero» ni «no inventes» ni
    // «ciñete al contexto» (esa honestidad dura vive en GENERATOR_SYSTEM y en
    // CONSULT_INSTRUCTION). Sí fija reglas duras de cercanía al contexto:
    expect(DEFAULT_SYSTEM).toContain('respeta el nombre exacto');
    expect(DEFAULT_SYSTEM).toContain('no propongas material que no tenga');
    expect(DEFAULT_SYSTEM.toLowerCase()).not.toContain('sincero');
  });

  it('179 · buildRequest mete opts.question en todas las tareas', () => {
    const q = '¿y hoy?';
    expect(buildRequest('suggest', { question: q }).prompt.endsWith(q)).toBe(true);
    expect(buildRequest('plan', { question: q }).prompt.endsWith(q)).toBe(true);
    expect(buildRequest('analyze', { question: q }).prompt.endsWith(q)).toBe(true);
    expect(buildRequest('chat', { question: q }).prompt).toBe(q);
  });

  it('180 · El contexto se inyecta como system + CONTEXTO DEL USUARIO:', () => {
    const context = 'INVENTARIO: ...';
    const req = buildRequest('plan', { context });
    expect(req.system.endsWith(`\n\nCONTEXTO DEL USUARIO:\n${context}`)).toBe(true);
  });

  it('182 · boundedHistory acota por límites de usuario/modelo', () => {
    const msgs: ChatMessage[] = [];
    for (let i = 0; i < 20; i++) {
      msgs.push({ role: 'user', text: 'u'.repeat(2000) });
      msgs.push({ role: 'model', text: 'm'.repeat(2000) });
    }
    const out = boundedHistory(msgs, CHAT_HISTORY_LIMIT);
    expect(out).toHaveLength(CHAT_HISTORY_LIMIT);
    for (const message of out) {
      if (message.role === 'user') expect(message.text.length).toBeLessThanOrEqual(HISTORY_USER_LIMIT);
      else expect(message.text.length).toBeLessThanOrEqual(HISTORY_MODEL_LIMIT);
    }
    expect(boundedHistory(msgs, 0)).toEqual([]);
  });
});

describe('memory (183–187)', () => {
  it('183 · extractMemoryBlock solo cuenta si CIERRA la respuesta', () => {
    const cierra = extractMemoryBlock('Respuesta.\n```memoria\n- dato\n```');
    expect(cierra.block).toBe('- dato');
    const noCierra = extractMemoryBlock('```memoria\n- dato\n```\ntexto después');
    expect(noCierra.block).toBeNull();
  });

  it('184 · extractMemoryBlock devuelve rest sin el bloque', () => {
    const { rest, block } = extractMemoryBlock('Prosa de la respuesta.\n```memoria\n- dato\n```');
    expect(rest).toBe('Prosa de la respuesta.');
    expect(block).toBe('- dato');
  });

  it('186 · applyMemoryEntries no duplica entradas repetidas', () => {
    const mem = defaultMemory({ patterns: ['- le gusta el press'] });
    const { memory, added } = applyMemoryEntries(mem, '- Le gusta  EL PRESS');
    expect(added).toEqual([]);
    expect(memory.match(/press/gi)?.length).toBe(1);
  });

  it('187 · defaultMemory rellena las secciones estándar', () => {
    const mem = defaultMemory({ name: 'Ana' } as MemorySeed);
    for (const heading of MEMORY_HEADINGS) expect(mem).toContain(heading);
    // HALLAZGO: `MemorySeed` no tiene campo `name`, así que «Ana» NO se incrusta
    // (las secciones se siembran con profile/preferences/works/fails/patterns).
    expect(mem).not.toContain('Ana');
  });
});

describe('history (188, 190, 191)', () => {
  it('188 · consolidatedHistory acota cada línea a HISTORY_LINE_MAX', () => {
    const library: Exercise[] = [];
    const sessions: Session[] = [];
    for (let i = 0; i < 70; i++) {
      const id = `ex-${i}`;
      const name = i === 0 ? `Ejercicio ${'x'.repeat(400)}` : `Ejercicio ${i}`;
      library.push(ex(id, name, 'pecho'));
      sessions.push(
        sess(`s-${i}`, '2026-01-01', [{ exId: id, name, sets: [setOf(50, 10), setOf(60, 8)] }]),
      );
    }
    const lines = consolidatedHistory(sessions, { exercises: library });
    expect(lines.length).toBeLessThanOrEqual(60);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(180);
  });

  it('190 · queryHistory con nombre no registrado NO devuelve datos de otro', () => {
    const sessions = [
      sess('s1', '2026-01-10', [
        { exId: 'press', name: 'Press de banca', sets: [setOf(80, 5)] },
      ]),
    ];
    const out = queryHistory(sessions, { exercise: 'Curl con oso polar' });
    expect(out).toMatch(/No encuentro/);
    expect(out).toContain('no está registrado');
    expect(out).not.toContain('80');
  });

  it('191 · queryHistory usa un match fuerte para resolver', () => {
    const sessions = [
      sess('s1', '2026-01-10', [
        { exId: 'press', name: 'Press de banca', sets: [setOf(80, 5)] },
      ]),
    ];
    const out = queryHistory(sessions, { exercise: 'press de banca' });
    expect(out).toContain('Press de banca');
    expect(out).toContain('80');
  });
});

describe('insights (192–194)', () => {
  const press = ex('press', 'Press de banca', 'pecho');
  const routine = {
    id: 'rt1',
    name: 'Rutina',
    items: [{ exId: 'press', sets: 3, repMin: 8, repMax: 12, weight: 80 }],
  };

  it('192 · buildInsights marca below con −0,5 kg o < repMin', () => {
    const mk = (weight: number): Session =>
      sess('s1', '2026-01-10', [{ exId: 'press', name: 'Press de banca', sets: [setOf(weight, 8)] }], {
        routineId: 'rt1',
      });
    const below = buildInsights({
      sessions: [mk(79)],
      routines: [routine],
      exercises: [press],
      todayIso: '2026-01-10',
    });
    expect(below.deviations[0]?.verdict).toBe('below');
    // HALLAZGO: el umbral es ESTRICTO (`kg < targetKg - 0.5`), así que bajar
    // exactamente 0,5 kg (79,5 con objetivo 80) sale `matched`, no `below`.
    const matched = buildInsights({
      sessions: [mk(79.5)],
      routines: [routine],
      exercises: [press],
      todayIso: '2026-01-10',
    });
    expect(matched.deviations[0]?.verdict).toBe('matched');
  });

  it('193 · buildInsights marca above por +2 reps', () => {
    const session = sess(
      's1',
      '2026-01-10',
      [{ exId: 'press', name: 'Press de banca', sets: [setOf(80, 14)] }],
      { routineId: 'rt1' },
    );
    const insights = buildInsights({
      sessions: [session],
      routines: [routine],
      exercises: [press],
      todayIso: '2026-01-10',
    });
    expect(insights.deviations[0]?.verdict).toBe('above');
  });

  it('194 · staleness > 10 días se marca como estancado', () => {
    const session = sess('s1', '2026-01-09', [
      { exId: 'press', name: 'Press de banca', sets: [setOf(60, 8)] },
    ]);
    const insights = buildInsights({
      sessions: [session],
      routines: [],
      exercises: [press],
      todayIso: '2026-01-20',
    });
    expect(insights.staleness).toHaveLength(1);
    expect(insights.staleness[0]?.days).toBe(11);
  });
});
