/**
 * Perfiles: índice y claves de almacenamiento.
 *
 * Cada perfil es una «carpeta» independiente de datos. El perfil principal usa
 * las claves históricas (`pulso.state`, `pulso.rest`), así que los datos de la v1
 * y de v2 antes de los perfiles siguen abriendo sin migración; los demás usan el
 * sufijo `.<id>`.
 *
 * La API key del coach es la EXCEPCIÓN: vive aparte (`pulso.ai-key`) y se comparte
 * entre perfiles. `store.ts` la inyecta al leer y la actualiza al escribir.
 */
import { computed, signal } from '@preact/signals';

import { uid } from '@/domain/num';

export const DEFAULT_PROFILE_ID = 'default';
export const MAX_PROFILES = 6;

export const PROFILES_KEY = 'pulso.profiles';
export const ACTIVE_PROFILE_KEY = 'pulso.active-profile';
export const AI_KEY_KEY = 'pulso.ai-key';

/** Paleta de avatares: el color no se usa para nada más. */
export const PROFILE_COLORS = [
  '#c8ff2e',
  '#60a5fa',
  '#f472b6',
  '#fbbf24',
  '#a78bfa',
  '#34d399',
] as const;

export interface Profile {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  lastUsedAt: string;
}

function ls(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asColor(value: unknown, index: number): string {
  const raw = asString(value);
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw : PROFILE_COLORS[index % PROFILE_COLORS.length];
}

/** Un perfil solo vale si tiene id y nombre; lo demás se rellena con cuidado. */
function asProfile(value: unknown, index: number): Profile | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = asString(raw.id).trim();
  const name = asString(raw.name).trim();
  if (!id || !name) return null;
  const now = new Date().toISOString();
  return {
    id,
    name,
    color: asColor(raw.color, index),
    createdAt: asString(raw.createdAt) || now,
    lastUsedAt: asString(raw.lastUsedAt) || now,
  };
}

function readProfilesRaw(): Profile[] {
  const store = ls();
  if (!store) return [];
  try {
    const raw = store.getItem(PROFILES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: Profile[] = [];
    const seen = new Set<string>();
    for (const value of parsed) {
      const profile = asProfile(value, out.length);
      if (!profile || seen.has(profile.id)) continue;
      seen.add(profile.id);
      out.push(profile);
      if (out.length >= MAX_PROFILES) break;
    }
    return out;
  } catch {
    return [];
  }
}

function writeProfiles(list: readonly Profile[]): void {
  const store = ls();
  if (!store) return;
  try {
    store.setItem(PROFILES_KEY, JSON.stringify(list));
  } catch {
    /* sin storage la app sigue en memoria */
  }
}

function readLegacyDefaultName(): { name: string; createdAt: string } {
  const store = ls();
  const now = new Date().toISOString();
  if (!store) return { name: 'Principal', createdAt: now };
  try {
    const raw = store.getItem('pulso.state');
    if (!raw) return { name: 'Principal', createdAt: now };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { name: 'Principal', createdAt: now };
    const state = parsed as Record<string, unknown>;
    const settings = state.settings;
    const name =
      typeof settings === 'object' && settings !== null
        ? asString((settings as Record<string, unknown>).name).trim()
        : '';
    return { name: name || 'Principal', createdAt: asString(state.createdAt) || now };
  } catch {
    return { name: 'Principal', createdAt: now };
  }
}

function readActiveId(): string {
  const store = ls();
  if (!store) return DEFAULT_PROFILE_ID;
  try {
    return asString(store.getItem(ACTIVE_PROFILE_KEY)).trim();
  } catch {
    return '';
  }
}

function writeActiveId(id: string): void {
  const store = ls();
  if (!store) return;
  try {
    store.setItem(ACTIVE_PROFILE_KEY, id);
  } catch {
    /* noop */
  }
}

/**
 * Primer arranque: sin índice, el estado existente pasa a ser el perfil
 * «Principal» conservando su nombre. No se copia ni se mueve ningún dato.
 */
function bootstrapProfiles(): Profile[] {
  const stored = readProfilesRaw();
  if (stored.length) {
    const active = readActiveId();
    if (!stored.some((p) => p.id === active)) writeActiveId(stored[0]?.id ?? DEFAULT_PROFILE_ID);
    return stored;
  }
  const legacy = readLegacyDefaultName();
  const profile: Profile = {
    id: DEFAULT_PROFILE_ID,
    name: legacy.name,
    color: PROFILE_COLORS[0],
    createdAt: legacy.createdAt,
    lastUsedAt: new Date().toISOString(),
  };
  writeProfiles([profile]);
  writeActiveId(profile.id);
  return [profile];
}

const initialProfiles = bootstrapProfiles();
const initialActive = (() => {
  const stored = readActiveId();
  return initialProfiles.some((p) => p.id === stored)
    ? stored
    : (initialProfiles[0]?.id ?? DEFAULT_PROFILE_ID);
})();

/** Perfiles conocidos, reactivo. */
export const profiles = signal<Profile[]>(initialProfiles);

/** Id del perfil activo. Cambiarlo no recarga: eso lo decide la UI. */
export const activeProfileId = signal<string>(initialActive);

/** Perfil activo (nunca `undefined` si hay al menos uno). */
export const activeProfile = computed<Profile | undefined>(() =>
  profiles.value.find((p) => p.id === activeProfileId.value),
);

function persist(next: readonly Profile[]): void {
  writeProfiles(next);
  profiles.value = [...next];
}

/** Reemplaza el índice entero (importación de un backup con todos los perfiles). */
export function replaceProfiles(list: readonly Profile[]): void {
  const clean: Profile[] = [];
  const seen = new Set<string>();
  for (const value of list) {
    const profile = asProfile(value, clean.length);
    if (!profile || seen.has(profile.id)) continue;
    seen.add(profile.id);
    clean.push(profile);
    if (clean.length >= MAX_PROFILES) break;
  }
  if (!clean.length) return;
  persist(clean);
}

/** Crea el registro del perfil (sin estado): los datos los escribe `store.ts`. */
export function addProfileRecord(name: string): Profile | null {
  const clean = name.trim();
  if (!clean || profiles.value.length >= MAX_PROFILES) return null;
  const profile: Profile = {
    id: uid('p'),
    name: clean,
    color: PROFILE_COLORS[profiles.value.length % PROFILE_COLORS.length],
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
  };
  persist([...profiles.value, profile]);
  return profile;
}

/** Renombra un perfil del índice (no toca su estado; eso lo hace el store). */
export function updateProfileRecord(
  id: string,
  patch: Partial<Omit<Profile, 'id'>>,
): Profile | null {
  const current = profiles.value.find((p) => p.id === id);
  if (!current) return null;
  const name = patch.name === undefined ? current.name : patch.name.trim();
  if (!name) return null;
  const updated: Profile = {
    ...current,
    ...patch,
    name,
    color: patch.color === undefined ? current.color : asColor(patch.color, 0),
  };
  persist(profiles.value.map((p) => (p.id === id ? updated : p)));
  return updated;
}

/** Quita un perfil del índice. Los datos los borra `store.ts`. */
export function removeProfileRecord(id: string): boolean {
  if (profiles.value.length <= 1) return false;
  const next = profiles.value.filter((p) => p.id !== id);
  if (next.length === profiles.value.length) return false;
  persist(next);
  if (activeProfileId.value === id) setActiveProfileId(next[0]?.id ?? DEFAULT_PROFILE_ID);
  return true;
}

/** Marca el perfil como usado ahora (para ordenar/«última vez»). */
export function touchProfile(id: string): void {
  updateProfileRecord(id, { lastUsedAt: new Date().toISOString() });
}

/** Cambia el perfil activo. La UI recarga para reinicializar los signals. */
export function setActiveProfileId(id: string): boolean {
  if (!profiles.value.some((p) => p.id === id)) return false;
  writeActiveId(id);
  activeProfileId.value = id;
  touchProfile(id);
  return true;
}

/** Primera letra para el avatar (funciona con tildes y emojis). */
export function profileInitial(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toLocaleUpperCase('es') : '?';
}

/* ---------- claves por perfil ---------- */

export const stateKeyFor = (id: string): string =>
  id === DEFAULT_PROFILE_ID ? 'pulso.state' : `pulso.state.${id}`;

export const restKeyFor = (id: string): string =>
  id === DEFAULT_PROFILE_ID ? 'pulso.rest' : `pulso.rest.${id}`;

export const seedKeyFor = (id: string): string =>
  id === DEFAULT_PROFILE_ID ? 'pulso.seeded-routines' : `pulso.seeded-routines.${id}`;

export const setupKeyFor = (id: string): string =>
  id === DEFAULT_PROFILE_ID ? 'pulso.applied-setup' : `pulso.applied-setup.${id}`;

export const corruptPrefixFor = (id: string): string => `${stateKeyFor(id)}.corrupt.`;

/** Claves de datos de un perfil (sin la key compartida ni el índice). */
export function dataKeysFor(id: string): string[] {
  return [stateKeyFor(id), restKeyFor(id), seedKeyFor(id), setupKeyFor(id)];
}

/* ---------- API key compartida ---------- */

/** Key del coach común a todos los perfiles (vacía si no hay). */
export function readSharedApiKey(): string {
  const store = ls();
  if (!store) return '';
  try {
    return asString(store.getItem(AI_KEY_KEY));
  } catch {
    return '';
  }
}

export function writeSharedApiKey(key: string): void {
  const store = ls();
  if (!store) return;
  try {
    if (key) store.setItem(AI_KEY_KEY, key);
    else store.removeItem(AI_KEY_KEY);
  } catch {
    /* noop */
  }
}
