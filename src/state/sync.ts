/**
 * Sincronización entre dispositivos: código de pareja + nube cifrada.
 *
 * El modelo, en una frase: **el dispositivo manda, la nube es un espejo**. Todo
 * se sigue guardando en `localStorage` como siempre; esto solo sube y baja una
 * copia cifrada para que el móvil y el PC vean lo mismo.
 *
 * Pasos de un `syncNow()`:
 *   1. se empaquetan todos los perfiles (sin sesión en curso, chat ni API key);
 *   2. se baja el blob del servidor y se descifra con la clave del código;
 *   3. se fusiona por perfil (`mergeStates`) y se escriben los estados;
 *   4. se vuelve a subir el resultado con `rev` para detectar carreras.
 *
 * Conflictos: si las dos copias cambiaron la misma área desde la última
 * sincronización, NO se decide solo. Se devuelve `{ kind: 'conflict' }` con el
 * informe para que la pantalla de revisión pregunte; la respuesta llega como
 * `prefer` en la siguiente llamada ('newest' = combinar, 'local' = este
 * dispositivo, 'remote' = el otro).
 *
 * Lo que nunca viaja: `active` (la sesión en curso), `chat` y la API key del
 * coach. Ver `stripForSync`.
 */
import { signal } from '@preact/signals';

import {
  activeOf,
  conflictAreas,
  mergeStates,
  stripForSync,
  syncMetaOf,
  type MergeReport,
  type SyncArea,
  type SyncPrefer,
} from '@/domain/sync';
import type { ActiveSession, AppState } from '@/domain/types';
import { toast } from '@/ui/toast';

import {
  MAX_PROFILES,
  activeProfileId,
  profiles,
  readSharedApiKey,
  replaceProfiles,
  writeSharedApiKey,
  type Profile,
} from './profiles';
import { active, onStateWritten, readProfileState, refresh, writeProfileState } from './store';
import { resumeSession } from './session';
import {
  deriveSyncKey,
  generateSyncCode,
  normalizeSyncCode,
  openJson,
  sealJson,
  syncBlobId,
  type Sealed,
} from '@/platform/sync-crypto';

export const SYNC_KEY = 'pulso.sync';
/** Endpoint de serie; se puede cambiar desde Ajustes (p. ej. uno propio). */
const ENV_SYNC_URL: unknown = import.meta.env.VITE_SYNC_URL;
export const DEFAULT_SYNC_URL: string = (
  typeof ENV_SYNC_URL === 'string' ? ENV_SYNC_URL : ''
).replace(/\/+$/, '');

export interface SyncConfig {
  url: string;
  code: string;
  /** ms de la última sincronización correcta EN ESTE dispositivo */
  lastSyncAt: number;
}

/** Cabecera del blob cifrado (lo único que el servidor puede leer). */
interface StoredBlob {
  rev: string;
  updatedAt: number;
  payload: string;
}

/** Lo que se cifra y se sube. */
export interface SyncProfile {
  id: string;
  name: string;
  color: string;
  state: AppState;
}

export interface SyncPayload {
  kind: 'pulso-sync';
  version: 1;
  exportedAt: string;
  profiles: SyncProfile[];
}

export type SyncKind = 'off' | 'idle' | 'syncing' | 'error' | 'conflict';

export interface SyncStatus {
  kind: SyncKind;
  message: string;
  at: number;
}

export interface SyncPreview {
  report: MergeReport;
  areas: SyncArea[];
  localSessions: number;
  remoteSessions: number;
  remoteUpdatedAt: number;
  profileCount: number;
}

export type SyncOutcome =
  | { kind: 'off' }
  | { kind: 'busy' }
  | { kind: 'ok'; pushed: boolean; profiles: number; report: MergeReport | null }
  | { kind: 'conflict'; preview: SyncPreview }
  | { kind: 'error'; message: string };

/* ---------- configuración ---------- */

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readConfig(): SyncConfig | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(SYNC_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isObj(parsed)) return null;
    const url = typeof parsed.url === 'string' ? parsed.url : '';
    const code = typeof parsed.code === 'string' ? parsed.code : '';
    if (!url || !code) return null;
    return {
      url,
      code,
      lastSyncAt: typeof parsed.lastSyncAt === 'number' ? parsed.lastSyncAt : 0,
    };
  } catch (err) {
    console.warn('[pulso] configuración de sync ilegible', err);
    return null;
  }
}

function writeConfig(config: SyncConfig | null): void {
  const store = storage();
  syncConfig.value = config;
  if (!store) return;
  try {
    if (config) store.setItem(SYNC_KEY, JSON.stringify(config));
    else store.removeItem(SYNC_KEY);
  } catch (err) {
    console.warn('[pulso] no se pudo guardar la configuración de sync', err);
  }
}

/**
 * Sesión en curso que espera en el OTRO dispositivo.
 *
 * Viaja en el blob (es parte del estado) pero no se aplica sola: dos
 * dispositivos entrenando lo mismo a la vez se pisarían. La tarjeta de
 * sincronización ofrece «continuar aquí» y solo entonces se adopta.
 */
export interface Handoff {
  profileId: string;
  session: ActiveSession;
  /** cuándo se subió (ms) */
  at: number;
}

export const pendingHandoff = signal<Handoff | null>(null);

export const syncConfig = signal<SyncConfig | null>(readConfig());
export const syncStatus = signal<SyncStatus>({
  kind: syncConfig.value ? 'idle' : 'off',
  message: '',
  at: 0,
});

function setStatus(kind: SyncKind, message = ''): void {
  syncStatus.value = { kind, message, at: Date.now() };
}

/**
 * Normaliza la URL del servidor: sin barra final y sin https obligatorio en
 * local (el servidor de pruebas de `tools/sync-dev.mjs` va por http).
 */
export function normalizeSyncUrl(input: string): string {
  const raw = input.trim().replace(/\/+$/, '');
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

/* ---------- transporte ---------- */

const TIMEOUT_MS = 15_000;

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function pullBlob(config: SyncConfig, id: string): Promise<StoredBlob | null> {
  const res = await request(`${config.url}/v1/blob/${id}`, { method: 'GET' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`el servidor respondió ${res.status}`);
  const body: unknown = await res.json();
  if (!isObj(body) || typeof body.payload !== 'string' || typeof body.rev !== 'string') {
    throw new Error('el servidor devolvió algo que no es un blob');
  }
  return {
    rev: body.rev,
    payload: body.payload,
    updatedAt: typeof body.updatedAt === 'number' ? body.updatedAt : 0,
  };
}

async function putBlob(
  config: SyncConfig,
  id: string,
  rev: string | null,
  payload: string,
): Promise<'ok' | 'conflict'> {
  const res = await request(`${config.url}/v1/blob/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rev, payload }),
  });
  if (res.status === 409) return 'conflict';
  if (!res.ok) throw new Error(`el servidor respondió ${res.status}`);
  return 'ok';
}

/* ---------- empaquetado ---------- */

function isPayload(value: unknown): value is SyncPayload {
  return (
    isObj(value) &&
    value.kind === 'pulso-sync' &&
    Array.isArray(value.profiles) &&
    value.profiles.length > 0
  );
}

function collectProfiles(): SyncProfile[] {
  return profiles.value.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    state: readProfileState(p.id),
  }));
}
export function buildPayload(list: readonly SyncProfile[]): SyncPayload {
  return {
    kind: 'pulso-sync',
    version: 1,
    exportedAt: new Date().toISOString(),
    profiles: list.map((entry) => ({ ...entry, state: stripForSync(entry.state) })),
  };
}

/* ---------- aplicar ---------- */

interface ApplyInput {
  /** perfiles que quedarán en el índice (unión de los dos lados) */
  union: Profile[];
  /** estados a escribir (solo los que cambian) */
  writes: { id: string; state: AppState }[];
}

/**
 * Escribe el resultado de la fusión.
 *
 * `stamp: false` en cada escritura: el estado trae las marcas de los dos
 * dispositivos y re-sellarlas aquí lo haría ganar todos los conflictos futuros.
 * La API key compartida se restaura al final porque los estados que vienen del
 * otro lado llegan redactados y `writeProfileState` la sincroniza desde ellos.
 */
function applyMerge({ union, writes }: ApplyInput): void {
  const sharedKey = readSharedApiKey();
  replaceProfiles(union);
  for (const entry of writes) writeProfileState(entry.id, entry.state, { stamp: false });
  /* los estados que vienen del otro lado llegan sin la key (es un secreto local),
     y escribirlos la borra del almacén compartido. Se restaura ANTES de `refresh`
     porque `refresh` es quien inyecta la key en los ajustes en memoria: al revés,
     la UI se quedaría un rato sin key. */
  writeSharedApiKey(sharedKey);
  refresh();
  /* la pestaña no se recarga (perdería la sesión en curso): `refresh` ya ha
     recargado los signals del perfil activo */
}

/* ---------- sincronizar ---------- */

let running = false;
let autoTimer: ReturnType<typeof setTimeout> | null = null;
/** `true` mientras se escriben estados fusionados: esos avisos no programan subida. */
let applying = false;

/**
 * JSON con las claves ordenadas. Se usa para comparar contenido, nunca para guardar.
 *
 * Comparar `JSON.stringify` a pelo es frágil: dos estados idénticos pueden tener
 * las claves en otro orden (basta con que un merge reconstruya `settings`) y el
 * resultado sería «son distintos» para siempre → una subida por sincronización y
 * dos dispositivos rebotando. Con esto, «igual» significa igual de verdad.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(obj[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Huella del contenido que se fusiona (sin `exportedAt`, que cambia en cada llamada). */
function contentOf(payload: SyncPayload): string {
  return canonical(payload.profiles);
}

/**
 * Sincroniza ahora. Con `prefer` se resuelve el conflicto pendiente:
 * `'newest'` combina (cada área con su último cambio), `'local'` deja este
 * dispositivo por delante y `'remote'` acepta el del otro.
 */
export async function syncNow(prefer?: SyncPrefer, depth = 0): Promise<SyncOutcome> {
  /* se lee de disco, no del signal: otra pestaña (o un test que cambia de
     «dispositivo») puede haber escrito la configuración, y el `lastSyncAt`
     equivocado hace que un conflicto real pase por «no hay nada que preguntar» */
  const config = readConfig();
  if (!config) return { kind: 'off' };
  syncConfig.value = config;
  if (running) return { kind: 'busy' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setStatus('error', 'Sin conexión: se sincronizará al volver la red.');
    return { kind: 'error', message: 'sin conexión' };
  }

  running = true;
  setStatus('syncing');
  try {
    const id = await syncBlobId(config.code);
    const key = await deriveSyncKey(config.code);
    const remote = await pullBlob(config, id);

    /* primera subida: no hay nada que fusionar */
    if (!remote) {
      const payload = buildPayload(collectProfiles());
      const sealed = await sealJson(key, payload);
      const result = await putBlob(config, id, null, JSON.stringify(sealed));
      if (result === 'conflict') {
        /* alguien subió entre el GET y el PUT: se reintenta UNA vez */
        running = false;
        return depth > 0
          ? { kind: 'error', message: 'otra sincronización se cruzó; prueba en un momento' }
          : syncNow(prefer, depth + 1);
      }
      writeConfig({ ...config, lastSyncAt: Date.now() });
      setStatus('idle', '');
      return { kind: 'ok', pushed: true, profiles: payload.profiles.length, report: null };
    }

    const decrypted = await openJson<unknown>(key, JSON.parse(remote.payload) as Sealed);
    if (!isPayload(decrypted)) throw new Error('el blob no es un paquete de Pulso');

    const since = config.lastSyncAt;
    const remoteById = new Map(decrypted.profiles.map((entry) => [entry.id, entry]));
    const local = collectProfiles();
    const localIds = new Set(local.map((entry) => entry.id));

    /* traspaso: si aquí no hay sesión en curso y allí sí, se OFRECE (no se
       aplica). Si aquí ya hay una, la local manda y la oferta desaparece. */
    const mine = local.find((entry) => entry.id === activeProfileId.value);
    const theirs = remoteById.get(activeProfileId.value);
    const localActive = mine ? activeOf(mine.state) : null;
    const remoteActive = theirs ? activeOf(theirs.state) : null;
    pendingHandoff.value =
      !localActive && theirs && remoteActive
        ? { profileId: theirs.id, session: remoteActive, at: remote.updatedAt }
        : null;

    const writes: { id: string; state: AppState }[] = [];
    const union: Profile[] = [...profiles.value];
    const conflicts = new Set<SyncArea>();
    const reports: MergeReport[] = [];
    let localSessions = 0;
    let remoteSessions = 0;

    for (const entry of local) {
      const other = remoteById.get(entry.id);
      const mine = entry.state;
      localSessions += Array.isArray(mine.sessions) ? mine.sessions.length : 0;
      if (!other) continue;
      remoteSessions += Array.isArray(other.state.sessions) ? other.state.sessions.length : 0;
      if (!prefer) {
        for (const area of conflictAreas(mine, other.state, since)) conflicts.add(area);
      }
      const { state, report } = mergeStates(mine, other.state, { prefer: prefer ?? 'newest' });
      reports.push(report);
      if (canonical(state) !== canonical(mine)) writes.push({ id: entry.id, state });
    }

    /* perfiles que solo están en el otro lado (hasta el tope de la app: uno que no
       entre en el índice dejaría su estado escrito y huérfano en disco) */
    for (const other of decrypted.profiles) {
      if (localIds.has(other.id)) continue;
      if (union.length >= MAX_PROFILES) break;
      const now = new Date().toISOString();
      const profile: Profile = {
        id: other.id,
        name: other.name || other.state.settings?.name || 'Perfil',
        color: other.color || '#c8ff2e',
        createdAt: now,
        lastUsedAt: now,
      };
      union.push(profile);
      writes.push({ id: other.id, state: other.state });
      remoteSessions += Array.isArray(other.state.sessions) ? other.state.sessions.length : 0;
    }

    const preview: SyncPreview = {
      report: mergeReports(reports),
      areas: [...conflicts],
      localSessions,
      remoteSessions,
      remoteUpdatedAt: remote.updatedAt,
      profileCount: decrypted.profiles.length,
    };

    /* conflicto real: no se toca nada hasta que el usuario elija */
    if (conflicts.size && !prefer) {
      setStatus('conflict', 'Hay cambios en los dos dispositivos.');
      return { kind: 'conflict', preview };
    }

    if (writes.length) {
      applying = true;
      try {
        applyMerge({ union, writes });
      } finally {
        applying = false;
      }
    }

    const payload = buildPayload(collectProfiles());

    /* Si los dos lados ya dicen LO MISMO, no se sube nada. Sin esta salida, dos
       dispositivos vinculados se quedan rebotando PUT → 409 → PUT para siempre:
       cada subida cambia la `rev` y la del otro ya no vale. */
    if (!writes.length && contentOf(payload) === contentOf(decrypted)) {
      writeConfig({ ...config, lastSyncAt: Date.now() });
      setStatus('idle', '');
      return {
        kind: 'ok',
        pushed: false,
        profiles: payload.profiles.length,
        report: preview.report,
      };
    }

    const sealed = await sealJson(key, payload);
    const result = await putBlob(config, id, remote.rev, JSON.stringify(sealed));
    if (result === 'conflict') {
      /* carrera con otro dispositivo: se reintenta UNA vez desde cero */
      running = false;
      return depth > 0
        ? { kind: 'error', message: 'otra sincronización se cruzó; prueba en un momento' }
        : syncNow(prefer, depth + 1);
    }

    writeConfig({ ...config, lastSyncAt: Date.now() });
    setStatus('idle', '');
    return {
      kind: 'ok',
      pushed: true,
      profiles: payload.profiles.length,
      report: preview.report,
    };
  } catch (err) {
    const message =
      err instanceof DOMException && err.name === 'OperationError'
        ? 'El código no abre esta copia (¿es el mismo?)'
        : err instanceof Error
          ? err.message
          : 'no se pudo sincronizar';
    console.warn('[pulso] fallo de sincronización', err);
    setStatus('error', message);
    return { kind: 'error', message };
  } finally {
    running = false;
  }
}

function mergeReports(list: readonly MergeReport[]): MergeReport {
  const out: MergeReport = {
    sessions: { local: 0, remote: 0, added: 0, updated: 0, removed: 0 },
    routines: { local: 0, remote: 0, added: 0, updated: 0, removed: 0 },
    areas: [],
    settingsPreview: [],
    nothing: true,
    bothSides: false,
  };
  for (const report of list) {
    for (const key of ['sessions', 'routines'] as const) {
      const target = out[key];
      const source = report[key];
      target.local += source.local;
      target.remote += source.remote;
      target.added += source.added;
      target.updated += source.updated;
      target.removed += source.removed;
    }
    out.settingsPreview.push(...report.settingsPreview);
    out.nothing &&= report.nothing;
    out.bothSides ||= report.bothSides;
    /* de las áreas solo interesa «la ganó el otro» y «ganó la mía» */
    for (const area of report.areas) {
      if (area.action === 'same') continue;
      out.areas.push(area);
    }
  }
  return out;
}

/* ---------- vincular / desvincular ---------- */

/** Crea un código nuevo y sube el estado de este dispositivo. */
export async function createSyncLink(urlInput: string): Promise<SyncOutcome> {
  const url = normalizeSyncUrl(urlInput);
  if (!url) return { kind: 'error', message: 'La dirección del servidor no es válida' };
  const code = generateSyncCode();
  writeConfig({ url, code, lastSyncAt: 0 });
  setStatus('syncing');
  return syncNow();
}

/** Se une a un código existente y trae lo que haya en la nube. */
export async function joinSyncLink(urlInput: string, codeInput: string): Promise<SyncOutcome> {
  const url = normalizeSyncUrl(urlInput);
  if (!url) return { kind: 'error', message: 'La dirección del servidor no es válida' };
  const code = normalizeSyncCode(codeInput);
  if (!code) return { kind: 'error', message: 'El código no tiene el formato PULSO-XXXX-…' };
  writeConfig({ url, code, lastSyncAt: 0 });
  setStatus('syncing');
  return syncNow();
}

/**
 * Acepta el traspaso: la sesión en curso del otro dispositivo pasa a ser la de
 * aquí (con sus series marcadas y su cronómetro). Es explícito a propósito; ver
 * `Handoff`.
 */
export function adoptHandoff(): boolean {
  const pending = pendingHandoff.value;
  if (!pending || active.value) return false;
  if (pending.profileId !== activeProfileId.value) return false;
  resumeSession(pending.session);
  pendingHandoff.value = null;
  return true;
}

/** Desvincula este dispositivo. La copia en la nube NO se borra. */
export function unlinkSync(): void {
  writeConfig(null);
  setStatus('off');
}

/* ---------- automático ---------- */

const PUSH_DEBOUNCE_MS = 8_000;

/** Programa una subida (con rebote) tras un cambio local. */
export function schedulePush(): void {
  if (!readConfig() || running || applying) return;
  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    autoTimer = null;
    void syncNow();
  }, PUSH_DEBOUNCE_MS);
}

/**
 * Engancha la sincronización automática: al guardar, al volver a la pestaña y al
 * recuperar la red. Devuelve la función para desengancharla (tests y HMR).
 */
export function startSyncAuto(): () => void {
  const onWritten = (): void => schedulePush();
  onStateWritten(onWritten);

  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') {
      void syncNow();
      return;
    }
    /* al salir de la app se manda YA lo que estaba en el rebote de 8 s: si no,
       cerrar justo después de guardar dejaba el cambio esperando a la próxima apertura */
    if (autoTimer) {
      clearTimeout(autoTimer);
      autoTimer = null;
      void syncNow();
    }
  };
  const onOnline = (): void => {
    void syncNow();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline);

  const boot = setTimeout(() => {
    if (syncConfig.value) void syncNow();
  }, 1200);

  return () => {
    clearTimeout(boot);
    if (autoTimer) clearTimeout(autoTimer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
    /* no hay forma pública de desuscribir `onStateWritten`; el guardia `running`
       y `syncConfig` bastan para que un aviso tardío no haga nada */
  };
}

/* ---------- utilidades para la UI ---------- */

/** ¿Está este dispositivo vinculado? */
export const isLinked = (): boolean => syncConfig.value !== null;

/** Sesiones locales de todos los perfiles (para el resumen de la tarjeta). */
export function localSessionCount(): number {
  return collectProfiles().reduce(
    (total, entry) => total + (Array.isArray(entry.state.sessions) ? entry.state.sessions.length : 0),
    0,
  );
}

/** Última marca de cambio local, para enseñar «pendiente de subir». */
export function lastLocalChange(): number {
  return Math.max(0, ...collectProfiles().map((entry) => syncMetaOf(entry.state).at));
}

/** Aviso de resultado, con el tono que toca. */
export function announce(outcome: SyncOutcome): void {
  if (outcome.kind === 'ok') {
    toast(
      outcome.report?.sessions.added
        ? `Sincronizado · ${outcome.report.sessions.added} sesiones nuevas del otro dispositivo`
        : 'Sincronizado',
      { kind: 'ok' },
    );
  } else if (outcome.kind === 'error') {
    toast(`Sin sincronizar: ${outcome.message}`, { kind: 'warn', ms: 6000 });
  }
}
