/**
 * Cliente de sincronización, con un servidor de mentira (`fetch` simulado) y dos
 * «dispositivos» que comparten el mismo `localStorage` de mentira.
 *
 * Cambiar de dispositivo es copiar/pegar el contenido del almacenamiento: el
 * store y el cliente leen de ahí en cada operación, así que el cambio se nota.
 * Es la única forma de probar el flujo completo (subir, bajar, fusionar y
 * conflicto) sin dos navegadores.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '@/domain/defaults';
import type { Session } from '@/domain/types';

vi.mock('@/ui/toast', () => ({ toast: vi.fn(() => ({ close: () => {} })) }));

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

/* Servidor de mentira: misma API que `tools/sync-dev.mjs` y el Worker. */
const blobs = new Map<string, { rev: string; updatedAt: number; payload: string }>();
let revSeq = 0;

function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(href);
  const match = /^\/v1\/blob\/([0-9a-f]{64})$/.exec(url.pathname);
  if (!match) return Promise.resolve(new Response('{}', { status: 404 }));
  const id = match[1];
  const method = init?.method ?? 'GET';

  if (method === 'GET') {
    const stored = blobs.get(id);
    return Promise.resolve(
      stored
        ? new Response(JSON.stringify(stored), { status: 200 })
        : new Response('{}', { status: 404 }),
    );
  }
  if (method === 'PUT') {
    const rawBody = typeof init?.body === 'string' ? init.body : '{}';
    const body = JSON.parse(rawBody) as { rev: string | null; payload: string };
    const existing = blobs.get(id);
    if ((existing?.rev ?? null) !== body.rev) {
      return Promise.resolve(new Response(JSON.stringify({ error: 'rev' }), { status: 409 }));
    }
    const rev = `r${++revSeq}`;
    blobs.set(id, { rev, updatedAt: Date.now(), payload: body.payload });
    return Promise.resolve(new Response(JSON.stringify({ rev }), { status: 200 }));
  }
  return Promise.resolve(new Response('{}', { status: 405 }));
}
vi.stubGlobal('fetch', fakeFetch);

const store = await import('./store');
const sync = await import('./sync');
const { replaceProfiles } = await import('./profiles');

const URL_FAKE = 'http://localhost:8787';

const sleep = (ms = 12): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function session(id: string, date: string): Session {
  return {
    id,
    date,
    startedAt: `${date}T10:00:00.000Z`,
    endedAt: `${date}T11:00:00.000Z`,
    unit: 'kg',
    entries: [],
  };
}

/** Cambia el «dispositivo»: el almacenamiento entero pasa a ser otro. */
function useDevice(content: Map<string, string>): void {
  mem.clear();
  for (const [key, value] of content) mem.set(key, value);
}

const snapshot = (): Map<string, string> => new Map(mem);

function deviceWith(sessions: Session[], settings = DEFAULT_SETTINGS): Map<string, string> {
  useDevice(new Map());
  store.writeState({ ...store.defaultState(), sessions, settings: structuredClone(settings) });
  return snapshot();
}

async function link(): Promise<string> {
  const out = await sync.createSyncLink(URL_FAKE);
  if (out.kind !== 'ok') throw new Error(`no se pudo crear el vínculo: ${out.kind}`);
  const config = sync.syncConfig.value;
  if (!config) throw new Error('sin configuración de sync');
  return config.code;
}

beforeEach(() => {
  blobs.clear();
  revSeq = 0;
  mem.clear();
  sync.unlinkSync();
  store.writeState(store.defaultState());
  store.refresh();
  replaceProfiles([{ id: 'default', name: 'Principal', color: '#c8ff2e', createdAt: '', lastUsedAt: '' }]);
});

describe('vincular dispositivos', () => {
  it('crea el código, sube el estado y otro dispositivo lo recibe al unirse', async () => {
    const a = deviceWith([session('s1', '2026-09-10')]);
    const code = await link();
    expect(code).toMatch(/^PULSO-/);
    expect(blobs.size).toBe(1);

    /* dispositivo B, recién instalado */
    deviceWith([]);
    sync.unlinkSync();
    await sleep();
    const out = await sync.joinSyncLink(URL_FAKE, code);
    expect(out.kind).toBe('ok');
    const merged = store.readState();
    expect(merged.sessions?.map((s) => s.id)).toEqual(['s1']);

    /* y lo de B se sube: volver a A y sincronizar no pierde nada */
    useDevice(a);
    store.refresh();
    await sleep();
    await sync.syncNow();
    expect(store.readState().sessions?.map((s) => s.id)).toEqual(['s1']);
  });

  it('un código mal escrito no vincula', async () => {
    const out = await sync.joinSyncLink(URL_FAKE, 'PULSO-0000');
    expect(out.kind).toBe('error');
    if (out.kind !== 'error') throw new Error('debería fallar');
    expect(out.message).toContain('formato');
    expect(sync.syncConfig.value).toBeNull();
  });

  it('una URL inválida se rechaza antes de tocar nada', async () => {
    const out = await sync.createSyncLink('no-es-una-url');
    expect(out.kind).toBe('error');
    expect(sync.syncConfig.value).toBeNull();
  });

  it('desvincular olvida el código pero no borra los datos', async () => {
    deviceWith([session('s1', '2026-09-10')]);
    await link();
    sync.unlinkSync();
    expect(sync.syncConfig.value).toBeNull();
    expect(store.readState().sessions).toHaveLength(1);
  });
});

describe('conflictos', () => {
  it('pregunta cuando los dos lados cambiaron los ajustes; «combinar» deja el bloque más reciente', async () => {
    /* A crea el vínculo con sus ajustes */
    deviceWith([session('s1', '2026-09-10')]);
    const code = await link();
    const deviceA = snapshot();

    /* B se une y, después, cambia las unidades */
    deviceWith([]);
    sync.unlinkSync();
    await sleep();
    await sync.joinSyncLink(URL_FAKE, code);
    await sleep();
    store.patchSettings({ units: 'lb' });
    const deviceB = snapshot();

    /* A cambia el incremento y sube */
    useDevice(deviceA);
    store.refresh();
    await sleep();
    store.patchSettings({ increment: 5 });
    await sleep();
    await sync.syncNow();

    /* B sincroniza: los dos tocaron ajustes desde la última vez → conflicto */
    useDevice(deviceB);
    store.refresh();
    await sleep();
    const out = await sync.syncNow();
    expect(out.kind).toBe('conflict');
    if (out.kind !== 'conflict') throw new Error('sin información del conflicto');
    expect(out.preview.areas).toContain('settings');

    /* «combinar»: cada bloque se queda con su cambio más reciente. A cambió
       DESPUÉS de B, así que el bloque de ajustes es el de A (y el aviso de la
       revisión ya decía qué iba a cambiar: `settingsPreview`) */
    expect(out.preview.report.settingsPreview.length).toBeGreaterThan(0);
    const resolved = await sync.syncNow('newest');
    expect(resolved.kind).toBe('ok');
    const settings = store.readState().settings;
    expect(settings.increment).toBe(5);
    expect(settings.units).toBe('kg');
    /* las sesiones nunca se pierden al combinar */
    expect(store.readState().sessions?.map((s) => s.id)).toEqual(['s1']);
  });

  it('«este dispositivo» deja mis ajustes y no borra las sesiones del otro', async () => {
    deviceWith([session('s1', '2026-09-10')]);
    const code = await link();
    const deviceA = snapshot();

    deviceWith([]);
    sync.unlinkSync();
    await sleep();
    await sync.joinSyncLink(URL_FAKE, code);
    await sleep();
    store.patchSettings({ units: 'lb' });
    const deviceB = snapshot();

    useDevice(deviceA);
    store.refresh();
    await sleep();
    store.patchSettings({ increment: 10 });
    await sleep();
    await sync.syncNow();

    useDevice(deviceB);
    store.refresh();
    await sleep();
    expect((await sync.syncNow()).kind).toBe('conflict');
    expect((await sync.syncNow('local')).kind).toBe('ok');
    expect(store.readState().settings.units).toBe('lb');
    expect(store.readState().settings.increment).not.toBe(10);
    expect(store.readState().sessions?.map((s) => s.id)).toEqual(['s1']);
  });
});

describe('lo que viaja', () => {
  it('la API key del coach no sale del dispositivo', () => {
    const state = store.defaultState();
    state.settings = { ...state.settings, ai: { ...state.settings.ai, apiKey: 'secreta' } };
    const payload = sync.buildPayload([{ id: 'default', name: 'P', color: '#fff', state }]);
    expect(JSON.stringify(payload)).not.toContain('secreta');
  });

  it('la sesión en curso viaja y el otro dispositivo la retoma sola con su progreso', async () => {
    const live = {
      id: 'live-1',
      routineId: null,
      name: 'Empuje A',
      startedAt: '2026-09-10T10:00:00.000Z',
      unit: 'kg' as const,
      entries: [],
      notes: '',
      dayIso: '2026-09-10',
      source: 'manual',
    };
    const a = deviceWith([]);
    store.writeState({ ...store.defaultState(), active: live });
    const code = await link();
    expect(blobs.size).toBe(1);

    /* B se une: recibe los datos Y la sesión en curso (sin traspaso manual) */
    deviceWith([]);
    sync.unlinkSync();
    await sleep();
    await sync.joinSyncLink(URL_FAKE, code);
    expect(store.active.value?.id).toBe('live-1');
    expect(store.readState().active?.id).toBe('live-1');
    void a;
  });
});
