import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GenResult, generate } from '@/features/coach/client';
import { GeminiError } from '@/features/coach/client';
import type { UnresolvedName } from '@/domain/match';

const mem = new Map<string, string>();

vi.mock('@/ui/toast', () => ({
  toast: vi.fn(() => ({ close: () => {} })),
}));

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
const exgen = await import('@/state/exgen');
const chat = await import('@/state/chat');
const onboarding = await import('@/state/onboarding');

const setKey = (key: string): void => {
  store.patchSettings({ ai: { ...store.settings.value.ai, apiKey: key } });
};

beforeEach(() => {
  mem.clear();
  store.writeState(store.defaultState());
  store.refresh();
  chat.clearChat();
});

describe('state:coach (246–256)', () => {
  it('246 · Sin key, suggest/plan caen al plan LOCAL', async () => {
    setKey('');
    const out = await coach.runCoachTask('suggest', {});
    expect(out.origin).toBe('local');
    expect((out.payload as { source?: string } | undefined)?.source).toBe('local');
    const plan = await coach.runCoachTask('plan', {});
    expect(plan.origin).toBe('local');
  });

  it('247 · El fallback local solo aplica a auth/network/quota y solo en suggest/plan', async () => {
    setKey('k');
    const genFn = (() =>
      Promise.reject(new GeminiError('parse', 'roto'))) as unknown as typeof generate;
    await expect(coach.runCoachTask('analyze', {}, { generateFn: genFn })).rejects.toMatchObject({
      kind: 'parse',
    });
  });

  it('249 · Error de parseo en suggest NO se tapa con local', async () => {
    setKey('k');
    const genFn = (() =>
      Promise.reject(new GeminiError('parse', 'roto'))) as unknown as typeof generate;
    await expect(coach.runCoachTask('suggest', {}, { generateFn: genFn })).rejects.toMatchObject({
      kind: 'parse',
    });
  });

  it('250 · El bucle consulta respeta consultRounds', async () => {
    setKey('k');
    const consulta = '```consulta\n{"ejercicio":"Press banca"}\n```';
    let callsOne = 0;
    const genOne = (() => {
      callsOne++;
      return Promise.resolve({ text: consulta } as GenResult);
    }) as unknown as typeof generate;
    await coach.runCoachTask('analyze', { consultRounds: 1 }, { generateFn: genOne });
    expect(callsOne).toBe(2);

    let callsZero = 0;
    const genZero = (() => {
      callsZero++;
      return Promise.resolve({ text: consulta } as GenResult);
    }) as unknown as typeof generate;
    await coach.runCoachTask('analyze', { consultRounds: 0 }, { generateFn: genZero });
    expect(callsZero).toBe(1);
  });

  it('252 · applySuggestionAsRoutine añade una rutina desde la sugerencia', () => {
    const name = store.exercises.value[0]?.name;
    const before = store.routines.value.length;
    const out = coach.applySuggestionAsRoutine({ title: 'Empuje', exercises: [{ name }] });
    expect(out.routine).not.toBeNull();
    expect(store.routines.value.length).toBe(before + 1);
    expect(out.routine?.source).toBe('ia');
  });

  it('253 · applySuggestionAsRoutine con sugerencia inválida no crea nada', () => {
    const before = store.routines.value.length;
    expect(coach.applySuggestionAsRoutine(null).routine).toBeNull();
    const out = coach.applySuggestionAsRoutine({ exercises: [{ name: 'zzzz qqq xyz' }] });
    expect(out.routine).toBeNull();
    expect(store.routines.value.length).toBe(before);
  });

  it('255 · partitionUnresolved separa resueltos y no resueltos', () => {
    const unresolved: UnresolvedName[] = [
      { name: 'Nuevo', reason: coach.CREABLE_REASON },
      { name: 'Frío', reason: 'conflicto de atributos' },
      { name: 'Nuevo', reason: coach.CREABLE_REASON },
    ];
    const payload = { exercises: [{ name: 'Nuevo', group: 'pecho', type: 'aislado' }] };
    const { creatable, warnings } = coach.partitionUnresolved(unresolved, payload);
    expect(creatable).toHaveLength(1);
    expect(creatable[0]).toMatchObject({ name: 'Nuevo', group: 'pecho' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.name).toBe('Frío');
  });

  it('256 · hasApiKey refleja el ajuste real', () => {
    setKey('');
    expect(coach.hasApiKey()).toBe(false);
    setKey('abc');
    expect(coach.hasApiKey()).toBe(true);
  });
});

describe('state:exgen (258, 259, 261)', () => {
  it('258 · Sin key → GeminiError(auth) antes de tocar generateFn', async () => {
    setKey('');
    let called = false;
    const genFn = (() => {
      called = true;
      return Promise.resolve({ text: '{}' } as GenResult);
    }) as unknown as typeof generate;
    await expect(exgen.generateExercises({ prompt: 'x' }, { generateFn: genFn })).rejects.toMatchObject(
      { kind: 'auth' },
    );
    expect(called).toBe(false);
  });

  it('259 · Un error de parseo del generador se propaga', async () => {
    setKey('k');
    const genFn = (() =>
      Promise.resolve({ text: 'esto no es json' } as GenResult)) as unknown as typeof generate;
    await expect(
      exgen.generateExercises({ prompt: 'x' }, { generateFn: genFn }),
    ).rejects.toMatchObject({ kind: 'parse' });
  });

  it('261 · exgenErrorText traduce cada kind', () => {
    const kinds = ['auth', 'network', 'quota', 'parse'] as const;
    const texts = kinds.map((kind) => exgen.exgenErrorText(new GeminiError(kind, 'msg')));
    for (const text of texts) expect(text.length).toBeGreaterThan(0);
    expect(new Set(texts).size).toBe(kinds.length);
  });
});

describe('state:chat y onboarding (262, 264, 267)', () => {
  it('262 · asChatLines filtra líneas con forma inválida', () => {
    const lines = chat.asChatLines([
      { role: 'user', text: 'hi' },
      42,
      {},
      { role: 'bogus', text: 'x' },
      { role: 'model' },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe('hi');
  });

  it('264 · markApplied/markCreation marcan la línea correcta', () => {
    chat.addChat({ role: 'model', text: 'a', payload: { source: 'local' } });
    chat.addChat({ role: 'model', text: 'b', creations: [{ name: 'A' }] });

    chat.markApplied(0);
    const payload = chat.chat.value[0]?.payload as { done?: boolean } | undefined;
    expect(payload?.done).toBe(true);
    expect(chat.chat.value[1]?.payload).toBeUndefined();

    chat.markCreation(1, 0, 'created');
    expect(chat.chat.value[1]?.creations?.[0]?.status).toBe('created');
    chat.appendCreations(1, [{ name: 'B' }]);
    expect(chat.chat.value[1]?.creations).toHaveLength(2);
  });

  it('267 · applyOnboarding(null) solo marca "visto"', () => {
    const before = { name: store.settings.value.name, goal: store.settings.value.goal };
    onboarding.applyOnboarding(null);
    expect(store.meta.value.onboarded).toBe(true);
    expect(store.settings.value.name).toBe(before.name);
    expect(store.settings.value.goal).toBe(before.goal);
  });
});
