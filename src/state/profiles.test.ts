/**
 * Perfiles: aislamiento de datos, API key compartida, CRUD y backup conjunto.
 *
 * Mismo patrón que `store.test.ts`: `localStorage` simulado ANTES del import
 * dinámico, porque el índice se lee al cargar el módulo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Session } from '@/domain/types';

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

const store = await import('./store');
const profiles = await import('./profiles');

const DEFAULT = {
  id: profiles.DEFAULT_PROFILE_ID,
  name: 'Principal',
  color: '#c8ff2e',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastUsedAt: '2026-01-01T00:00:00.000Z',
};

function resetWorld(): void {
  mem.clear();
  profiles.replaceProfiles([DEFAULT]);
  profiles.setActiveProfileId(profiles.DEFAULT_PROFILE_ID);
  store.writeState(store.defaultState());
}

beforeEach(resetWorld);

describe('migración y claves', () => {
  it('el estado existente pasa a ser el perfil principal sin mover datos', () => {
    expect(profiles.profiles.value).toHaveLength(1);
    expect(profiles.profiles.value[0]?.id).toBe(profiles.DEFAULT_PROFILE_ID);
    expect(mem.has(profiles.PROFILES_KEY)).toBe(true);
    expect(mem.get(profiles.ACTIVE_PROFILE_KEY)).toBe(profiles.DEFAULT_PROFILE_ID);
    expect(profiles.stateKeyFor(profiles.DEFAULT_PROFILE_ID)).toBe('pulso.state');
    expect(profiles.stateKeyFor('p-ana')).toBe('pulso.state.p-ana');
    expect(profiles.restKeyFor('p-ana')).toBe('pulso.rest.p-ana');
  });

  it('cada perfil escribe en su propia clave (aislamiento)', () => {
    const ana = store.createProfile('Ana');
    expect(ana).not.toBeNull();
    if (!ana) return;
    expect(store.switchProfile(ana.id)).toBe(true);
    store.patchSettings({ name: 'Ana' });
    const anaState = store.readState();
    expect(anaState.settings.name).toBe('Ana');

    expect(store.switchProfile(profiles.DEFAULT_PROFILE_ID)).toBe(true);
    store.patchSettings({ name: 'Fabián' });
    expect(store.readState().settings.name).toBe('Fabián');
    expect(store.readProfileState(ana.id).settings.name).toBe('Ana');
    expect(store.readProfileState(ana.id).settings.name).not.toBe(
      store.readProfileState(profiles.DEFAULT_PROFILE_ID).settings.name,
    );
  });

  it('la API key del coach se comparte entre perfiles', () => {
    store.patchSettings({ ai: { ...store.settings.value.ai, apiKey: 'secreta' } });
    const ana = store.createProfile('Ana');
    expect(ana).not.toBeNull();
    if (!ana) return;
    store.switchProfile(ana.id);
    expect(store.readState().settings.ai.apiKey).toBe('secreta');

    store.patchSettings({ ai: { ...store.settings.value.ai, apiKey: 'otra' } });
    store.switchProfile(profiles.DEFAULT_PROFILE_ID);
    expect(store.readState().settings.ai.apiKey).toBe('otra');
  });
});

describe('CRUD de perfiles', () => {
  it('crea con estado limpio y sin heredar sesiones ni rutinas', () => {
    const ana = store.createProfile('Ana');
    expect(ana).not.toBeNull();
    if (!ana) return;
    const state = store.readProfileState(ana.id);
    expect(state.settings.name).toBe('Ana');
    expect(state.sessions ?? []).toEqual([]);
    expect(state.routines ?? []).toEqual([]);
    expect((state.meta as { onboarded?: boolean }).onboarded).toBe(true);
  });

  it('renombra el perfil y su saludo', () => {
    const ana = store.createProfile('Ana');
    expect(ana).not.toBeNull();
    if (!ana) return;
    expect(store.renameProfile(ana.id, 'Ana María')).toBe(true);
    expect(profiles.profiles.value.find((p) => p.id === ana.id)?.name).toBe('Ana María');
    expect(store.readProfileState(ana.id).settings.name).toBe('Ana María');
  });

  it('borra un perfil y sus claves, pero nunca el último', () => {
    const ana = store.createProfile('Ana');
    expect(ana).not.toBeNull();
    if (!ana) return;
    expect(store.deleteProfile(ana.id)).toMatchObject({ ok: true, wasActive: false });
    expect(mem.has(profiles.stateKeyFor(ana.id))).toBe(false);
    expect(profiles.profiles.value).toHaveLength(1);
    expect(store.deleteProfile(profiles.DEFAULT_PROFILE_ID).ok).toBe(false);
  });

  it('borrar el perfil activo cambia al siguiente', () => {
    const ana = store.createProfile('Ana');
    expect(ana).not.toBeNull();
    if (!ana) return;
    store.switchProfile(ana.id);
    const result = store.deleteProfile(ana.id);
    expect(result).toMatchObject({ ok: true, wasActive: true });
    expect(profiles.activeProfileId.value).toBe(profiles.DEFAULT_PROFILE_ID);
  });

  it('resetAll solo borra el perfil activo', () => {
    const ana = store.createProfile('Ana');
    expect(ana).not.toBeNull();
    if (!ana) return;
    store.switchProfile(ana.id);
    const session: Session = {
      id: 's1',
      date: '2026-01-02',
      startedAt: '2026-01-02T18:00:00.000Z',
      unit: 'kg',
      name: 'Pierna',
      entries: [],
    };
    store.writeState({ ...store.readState(), sessions: [session] });
    store.resetAll();
    expect(store.sessions.value).toHaveLength(0);
    expect(profiles.profiles.value).toHaveLength(2);
    expect(profiles.stateKeyFor(profiles.DEFAULT_PROFILE_ID)).toBe('pulso.state');
  });
});

describe('backup conjunto', () => {
  it('exporta e importa todos los perfiles', () => {
    store.patchSettings({ ai: { ...store.settings.value.ai, apiKey: 'secreta' } });
    store.createProfile('Ana');
    store.createProfile('Marta');
    const backup = store.exportAllProfiles({ includeApiKey: true });
    expect(backup.profiles).toHaveLength(3);
    expect(backup.profiles.every((entry) => entry.state.settings.ai.apiKey === 'secreta')).toBe(
      true,
    );
    expect(
      store.exportAllProfiles().profiles.every((entry) => entry.state.settings.ai.apiKey === ''),
    ).toBe(true);

    resetWorld();
    const imported = store.importProfilesBackup(backup);
    expect(imported).toBe(3);
    expect(profiles.profiles.value.map((p) => p.name)).toEqual(['Principal', 'Ana', 'Marta']);
    expect(store.readState().settings.ai.apiKey).toBe('secreta');
  });

  it('rechaza un archivo que no es de perfiles', () => {
    expect(() => store.importProfilesBackup({ hola: 1 })).toThrow();
    expect(store.isProfilesBackup({ kind: 'pulso-profiles', profiles: [] })).toBe(false);
  });

  it('al reemplazar la lista borra los datos de perfiles que ya no están', () => {
    const ana = store.createProfile('Ana');
    expect(ana).not.toBeNull();
    if (!ana) return;
    const bundle = {
      kind: 'pulso-profiles',
      version: 1,
      exportedAt: '',
      active: profiles.DEFAULT_PROFILE_ID,
      profiles: [{ profile: DEFAULT, state: store.defaultState() }],
    };
    expect(store.importProfilesBackup(bundle)).toBe(1);
    expect(profiles.profiles.value.map((p) => p.id)).toEqual([profiles.DEFAULT_PROFILE_ID]);
    expect(mem.has(profiles.stateKeyFor(ana.id))).toBe(false);
  });
});
