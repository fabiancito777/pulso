/**
 * Sincronización: fusión de dos estados de Pulso.
 *
 * El principio es que **sincronizar no es reemplazar**. Si subes el archivo
 * entero, el último dispositivo que guarda borra el entreno del otro. Aquí cada
 * dato tiene su regla:
 *
 * | dato | regla |
 * |---|---|
 * | sesiones | unión por `id`; si el mismo `id` cambió en los dos, gana la que terminó más tarde |
 * | rutinas | unión por `id`; gana la edición más reciente (`updatedAt`) |
 * | ajustes, material, biblioteca, calendario | «el último cambio gana», por área |
 * | borrados | tombstone con fecha: un borrado reciente gana sobre el dato viejo del otro lado |
 *
 * Para saber «quién cambió qué» cada estado lleva `meta.sync.areas` con la marca
 * de tiempo del último cambio de cada área (`stampChanges`). Sin eso no hay
 * forma de fusionar sin adivinar, y por eso el módulo se portó antes que la red.
 *
 * Todo es puro: recibe estados, devuelve un estado nuevo y un informe. Nada de
 * `localStorage`, `fetch` ni relojes implícitos (el `now` se inyecta).
 *
 * Lo que NO viaja (`stripForSync`): el chat del coach y la API key de Gemini.
 * La **sesión en curso SÍ viaja** (con sus series marcadas) para que el progreso
 * se vea en el otro dispositivo; al fusionar se emparejan las series por su
 * último cambio (ver `mergeActiveSessions`), así que marcar en el móvil y en el PC
 * no se pisa. La API key es un secreto que no debe salir del navegador.
 */
import type { ActiveEntry, ActiveSession, ActiveSet, AppState, Session } from './types';

/** Áreas que se fusionan por «último cambio gana». Las sesiones y las rutinas van por id. */
export const SYNC_AREAS = ['settings', 'equipment', 'exercises', 'routines', 'schedule'] as const;
export type SyncArea = (typeof SYNC_AREAS)[number];

export type SyncPrefer = 'newest' | 'local' | 'remote';

export interface SyncTombstones {
  sessions: Record<string, number>;
  routines: Record<string, number>;
}

export interface SyncMeta {
  /** última vez que cambió algo fusionable en este dispositivo (ms) */
  at: number;
  /** marca de tiempo del último cambio de cada área (ms) */
  areas: Partial<Record<SyncArea, number>>;
  /** borrados recientes, para que no resuciten al fusionar */
  deleted: SyncTombstones;
  /**
   * ids de sesiones EN CURSO que se descartaron a propósito. Ahora la sesión en
   * curso se sincroniza sola, así que sin esto el otro dispositivo la devolvería
   * en la siguiente sincronización (y reaparecería un entreno que tiraste).
   */
  discarded: string[];
}

export const EMPTY_SYNC: SyncMeta = {
  at: 0,
  areas: {},
  deleted: { sessions: {}, routines: {} },
  discarded: [],
};

/** Cuántos borrados se recuerdan por tipo (los más recientes). */
export const TOMBSTONE_MAX = 500;

/* ---------- utilidades tolerantes ---------- */

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asObj(v: unknown): Record<string, unknown> {
  return isObj(v) ? v : {};
}

function asNum(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function asList(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Fecha de un ISO cualquiera en ms (0 si no se puede leer). */
export function isoMs(value: unknown): number {
  if (typeof value !== 'string' || !value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * JSON con las claves ordenadas: para desempatar de forma ESTABLE. Con
 * `JSON.stringify` a pelo el orden de las claves depende de cómo se construyó el
 * objeto, y los dos dispositivos podrían no coincidir nunca (subida → rebote
 * infinito). Ver la misma idea en `canonical` de `state/sync.ts`.
 */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(obj[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/* ---------- marcas de tiempo ---------- */

/**
 * Contenido de un área tal y como se compara para detectar cambios. Los ajustes
 * se comparan SIN la key del coach ni los modos de carga: son preferencias del
 * dispositivo y, si contaran, cambiar el modo de la calculadora marcaría «tus
 * ajustes son los nuevos» y arrasaría con los del otro lado.
 */
export function areaOf(state: AppState, area: SyncArea): unknown {
  switch (area) {
    case 'settings': {
      const settings = asObj(state.settings);
      return { ...settings, ai: { ...asObj(settings.ai), apiKey: '' }, plateModes: {} };
    }
    case 'equipment':
      return state.equipment;
    case 'exercises':
      return state.exercises;
    case 'routines':
      return state.routines;
    case 'schedule':
      return state.schedule;
  }
}

/** `meta.sync` del estado, completado y saneado (nunca `undefined`). */
export function syncMetaOf(state: unknown): SyncMeta {
  const meta = asObj(asObj(state).meta);
  const raw = asObj(meta.sync);
  const rawAreas = asObj(raw.areas);
  const areas: Partial<Record<SyncArea, number>> = {};
  for (const area of SYNC_AREAS) {
    const ts = asNum(rawAreas[area]);
    if (ts > 0) areas[area] = ts;
  }
  const deleted = asObj(raw.deleted);
  return {
    at: asNum(raw.at),
    areas,
    deleted: {
      sessions: pruneTombstones(asObj(deleted.sessions)),
      routines: pruneTombstones(asObj(deleted.routines)),
    },
    discarded: asList(raw.discarded).filter((id): id is string => typeof id === 'string' && id !== ''),
  };
}

/**
 * Devuelve una copia del estado con `meta.sync` actualizado: las áreas cuyo
 * contenido cambió respecto a `prev` reciben `now`.
 *
 * Se hace en el único punto de escritura (`writeProfileState`), no en cada
 * setter: así ningún camino nuevo puede olvidarse de sellar el cambio.
 */
export function stampChanges(
  prev: AppState | null,
  next: AppState,
  now: number = Date.now(),
): AppState {
  const current = syncMetaOf(next);
  const areas: Partial<Record<SyncArea, number>> = { ...current.areas };
  let changed = false;
  for (const area of SYNC_AREAS) {
    if (prev && same(areaOf(prev, area), areaOf(next, area))) continue;
    /* el primer arranque (sin `prev`) no sella nada: no hay cambio que anunciar
       y un estado recién creado no debe pisar el del otro dispositivo */
    if (!prev) continue;
    areas[area] = now;
    changed = true;
  }
  if (!changed) return next;
  return {
    ...next,
    meta: {
      ...asObj(next.meta),
      sync: { ...current, at: now, areas } satisfies SyncMeta,
    },
  };
}

/**
 * Tombstones saneados: solo ids con fecha válida y los más recientes.
 *
 * No se caducan por tiempo —bastante tiene el usuario con que un borrado no
 * resucite—, solo por número: el estado es lo que se sube y no puede crecer sin
 * freno. 500 borrados por tipo son años de sesiones borradas.
 */
export function pruneTombstones(raw: Record<string, unknown>): Record<string, number> {
  const valid = Object.entries(raw).filter(
    ([id, ts]) => id !== '' && typeof ts === 'number' && Number.isFinite(ts),
  ) as [string, number][];
  const entries = valid.sort((a, b) => b[1] - a[1]).slice(0, TOMBSTONE_MAX);
  const out: Record<string, number> = {};
  for (const [id, ts] of entries) out[id] = ts;
  return out;
}

function mergeTombstones(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, unknown> = { ...a };
  for (const [id, ts] of Object.entries(b)) {
    out[id] = Math.max(asNum(out[id]), ts);
  }
  return pruneTombstones(out);
}

/** Añade un borrado a `meta.sync.deleted` (lo llaman los setters de borrado). */
export function withTombstone(
  state: AppState,
  kind: keyof SyncTombstones,
  id: string,
  now: number = Date.now(),
): AppState {
  const sync = syncMetaOf(state);
  const deleted: SyncTombstones = {
    ...sync.deleted,
    [kind]: pruneTombstones({ ...sync.deleted[kind], [id]: now }),
  };
  return { ...state, meta: { ...asObj(state.meta), sync: { ...sync, at: now, deleted } } };
}

/** Cuántos descartes de sesión en curso se recuerdan (los más recientes). */
export const DISCARDED_MAX = 50;

/**
 * Recuerda que una sesión en curso se DESCARTÓ a propósito: sin esto, como la
 * sesión en curso se sincroniza sola, el otro dispositivo la devolvería en la
 * siguiente sincronización.
 */
export function withDiscarded(state: AppState, liveId: string): AppState {
  if (!liveId) return state;
  const sync = syncMetaOf(state);
  const discarded = [liveId, ...sync.discarded.filter((id) => id !== liveId)].slice(0, DISCARDED_MAX);
  return { ...state, meta: { ...asObj(state.meta), sync: { ...sync, at: Date.now(), discarded } } };
}

/* ---------- piezas que se fusionan ---------- */

export function sessionStamp(session: Session): number {
  return (
    isoMs(session.endedAt) ||
    isoMs(session.startedAt) ||
    isoMs(session.date ? `${session.date}T00:00:00` : '')
  );
}

export function routineStamp(routine: unknown): number {
  const raw = asObj(routine);
  return isoMs(raw.updatedAt) || isoMs(raw.createdAt);
}

function sessionId(value: unknown): string | null {
  const id = asObj(value).id;
  return typeof id === 'string' && id ? id : null;
}

function routineId(value: unknown): string | null {
  const id = asObj(value).id;
  return typeof id === 'string' && id ? id : null;
}

function byId(list: unknown[], readId: (v: unknown) => string | null): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const item of list) {
    const id = readId(item);
    if (id) map.set(id, item);
  }
  return map;
}

/* ---------- informe para la pantalla de revisión ---------- */

export type AreaAction = 'local' | 'remote' | 'merged' | 'same';

export interface AreaReport {
  area: SyncArea;
  action: AreaAction;
}

export interface SettingsChange {
  key: string;
  from: string;
  to: string;
}

export interface MergeReport {
  sessions: { local: number; remote: number; added: number; updated: number; removed: number };
  routines: { local: number; remote: number; added: number; updated: number; removed: number };
  areas: AreaReport[];
  /** ajustes donde gana el remoto, para poder enseñarlos antes de aplicar */
  settingsPreview: SettingsChange[];
  /** el remoto no aporta nada nuevo: no hay que preguntar ni escribir */
  nothing: boolean;
  /** las dos versiones tienen algo que la otra no */
  bothSides: boolean;
}

function readable(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} elemento${value.length === 1 ? '' : 's'}`;
  if (isObj(value))
    return `${Object.keys(value).length} clave${Object.keys(value).length === 1 ? '' : 's'}`;
  if (value === '' || value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '—';
}

function settingsDiff(local: unknown, remote: unknown): SettingsChange[] {
  const out: SettingsChange[] = [];
  const l = asObj(local);
  const r = asObj(remote);
  for (const key of Object.keys(r)) {
    if (key === 'ai' || key === 'plateModes' || key === 'plates' || key === 'bars') continue;
    if (same(l[key], r[key])) continue;
    out.push({ key, from: readable(l[key]), to: readable(r[key]) });
  }
  return out;
}

/* ---------- sesión en curso ---------- */

/** Marca temporal de una serie: la del último cambio, si la hay. */
function setStamp(set: ActiveSet): number {
  return isoMs(set.at) || isoMs(set.ts) || 0;
}

/**
 * Fusiona dos copias de la MISMA serie (mismo ejercicio, misma posición). Gana la
 * que se tocó más tarde; sin marcas (sesiones creadas antes de `at`) gana la hecha,
 * porque el caso normal es «lo marqué en el otro dispositivo».
 */
function mergeSet(a: ActiveSet, b: ActiveSet): ActiveSet {
  const mine = setStamp(a);
  const theirs = setStamp(b);
  if (theirs > mine) return { ...b };
  if (mine > theirs) return { ...a };
  /* empate (incluidas las sesiones antiguas sin marcas): decisión SIMÉTRICA.
     Los dos dispositivos tienen que llegar al mismo resultado o se subirían la
     copia el uno al otro para siempre. */
  if (a.done !== b.done) return { ...(b.done ? b : a) };
  /* misma marca: se parte de la copia canónicamente menor y, si le falta el
     peso, se toma el del otro (un peso real nunca se pierde) */
  const base = stable(a) <= stable(b) ? a : b;
  const other = base === a ? b : a;
  return base.weight === '' && other.weight !== '' ? { ...base, weight: other.weight } : { ...base };
}

function mergeEntry(a: ActiveEntry, b: ActiveEntry): ActiveEntry {
  const count = Math.max(a.sets.length, b.sets.length);
  const sets: ActiveSet[] = [];
  for (let i = 0; i < count; i += 1) {
    const mine = a.sets[i];
    const theirs = b.sets[i];
    if (mine && theirs) sets.push(mergeSet(mine, theirs));
    else if (mine) sets.push({ ...mine });
    else if (theirs) sets.push({ ...theirs });
  }
  /* el resto de campos de la entrada (notas, descanso, `basis`…) y su orden: la
     copia canónicamente menor, para que el resultado no dependa de quién fusiona */
  const base = stable(a) <= stable(b) ? a : b;
  return { ...base, sets };
}

/**
 * Fusiona las series de dos copias de la misma sesión en curso: **el progreso de
 * un dispositivo no se pierde al llegar el del otro**. Se emparejan las entradas
 * por `exId` (el orden puede haber cambiado al añadir o reordenar) y las series
 * por posición, y cada serie se queda con su último cambio (`at`, ver
 * `ActiveSet`).
 *
 * Es **simétrica**: `mergeActiveSessions(a, b)` y `mergeActiveSessions(b, a)`
 * dan exactamente el mismo resultado (salvo el orden de ejercicios, que sale de
 * `updatedAt`). Sin eso, los dos dispositivos se subirían la copia el uno al otro
 * para siempre.
 *
 * Devuelve `a` si son otra sesión (ids distintos): dos dispositivos entrenando
 * cosas distintas no se pisan.
 */
export function mergeActiveSessions(a: ActiveSession, b: ActiveSession): ActiveSession {
  if (a.id !== b.id) return a;
  /* un ejercicio cerrado como sesión suelta en CUALQUIERA de los dos lados ya no
     vuelve a la sesión en curso: sin esto, fusionar se lo comería y reaparecería */
  const finished = new Set([...(a.finished ?? []), ...(b.finished ?? [])]);
  const mineById = new Map(a.entries.map((entry) => [entry.exId, entry]));
  const theirsById = new Map(b.entries.map((entry) => [entry.exId, entry]));

  /* el orden de los ejercicios, las notas y el snapshot son «de la sesión», no de
     las series: los manda la escritura más reciente (`updatedAt`). Si empatan,
     decide el JSON canónico para que los dos lados converjan. */
  const mineTs = isoMs(a.updatedAt);
  const theirsTs = isoMs(b.updatedAt);
  const takeTheirs = theirsTs > mineTs || (theirsTs === mineTs && stable(b) < stable(a));
  const lead = takeTheirs ? b : a;
  const trail = takeTheirs ? a : b;

  const entryIds: string[] = [];
  for (const entry of lead.entries) {
    if (!finished.has(entry.exId) && !entryIds.includes(entry.exId)) entryIds.push(entry.exId);
  }
  for (const entry of trail.entries) {
    if (!finished.has(entry.exId) && !entryIds.includes(entry.exId)) entryIds.push(entry.exId);
  }

  const entries = entryIds.map((exId) => {
    const mine = mineById.get(exId);
    const theirs = theirsById.get(exId);
    if (mine && theirs) return mergeEntry(mine, theirs);
    /* solo en uno de los dos lados: se queda esa copia tal cual (nunca se pierde
       un ejercicio que el otro añadió) */
    const only = (mine ?? theirs) as ActiveEntry;
    return { ...only, sets: only.sets.map((set) => ({ ...set })) };
  });

  return {
    ...lead,
    /* ordenado: si no, la lista llegaría en distinto orden según quién fusiona y
       los dos dispositivos se pasarían la copia el uno al otro para siempre */
    ...(finished.size ? { finished: [...finished].sort() } : {}),
    entries,
  };
}

/* ---------- fusión ---------- */

export interface MergeOptions {
  /** qué hacer con las áreas que cambiaron en los dos lados */
  prefer?: SyncPrefer;
}

export interface MergeResult {
  state: AppState;
  report: MergeReport;
}

/**
 * Fusiona `remote` dentro de `local` y devuelve el estado combinado.
 *
 * `prefer` solo decide las áreas en las que los DOS lados cambiaron algo (y las
 * rutinas con el mismo id editadas en los dos). Las sesiones nuevas y las
 * rutinas nuevas se suman siempre: perder un entreno no es una opción.
 */
export function mergeStates(
  local: AppState,
  remote: AppState,
  options: MergeOptions = {},
): MergeResult {
  const prefer = options.prefer ?? 'newest';
  const localSync = syncMetaOf(local);
  const remoteSync = syncMetaOf(remote);

  /* ---- sesiones: unión por id ---- */
  const localSessions = asList(local.sessions).map((s) => asObj(s));
  const remoteSessions = asList(remote.sessions).map((s) => asObj(s));
  const localTomb = localSync.deleted.sessions;
  const remoteTomb = remoteSync.deleted.sessions;

  const removedLocal = localSessions.filter((s) => {
    const id = sessionId(s);
    const ts = id ? remoteTomb[id] : undefined;
    return Boolean(id && ts && sessionStamp(s as unknown as Session) <= ts);
  }).length;

  const removedRemote = remoteSessions.filter((s) => {
    const id = sessionId(s);
    const ts = id ? localTomb[id] : undefined;
    return Boolean(id && ts && sessionStamp(s as unknown as Session) <= ts);
  }).length;

  const survivors = localSessions.filter((s) => {
    const id = sessionId(s);
    const ts = id ? remoteTomb[id] : undefined;
    return !(id && ts && sessionStamp(s as unknown as Session) <= ts);
  });

  const merged = new Map<string, Record<string, unknown>>();
  for (const s of survivors) {
    const id = sessionId(s);
    if (id) merged.set(id, s);
  }

  let added = 0;
  let updated = 0;
  for (const s of remoteSessions) {
    const id = sessionId(s);
    if (!id) continue;
    const tomb = localTomb[id];
    if (tomb && sessionStamp(s as unknown as Session) <= tomb) continue;
    const mine = merged.get(id);
    if (!mine) {
      merged.set(id, s);
      added++;
      continue;
    }
    if (same(mine, s)) continue;
    const mineTs = sessionStamp(mine as unknown as Session);
    const theirsTs = sessionStamp(s as unknown as Session);
    /* en un empate gana la copia local: da igual cuál sea, y así dos dispositivos
       convergen al mismo resultado sin pelearse */
    const takeTheirs = prefer === 'remote' || (prefer === 'newest' && theirsTs > mineTs);
    if (takeTheirs) {
      merged.set(id, s);
      updated++;
    }
  }

  const sessions = [...merged.values()]
    .sort((a, b) => sessionStamp(b as unknown as Session) - sessionStamp(a as unknown as Session))
    .map((s) => s as unknown as Session);

  /* ---- rutinas: unión por id, gana la edición más reciente ---- */
  const localRoutines = asList(local.routines).map((r) => asObj(r));
  const remoteRoutines = asList(remote.routines).map((r) => asObj(r));
  const localRt = localSync.deleted.routines;
  const remoteRt = remoteSync.deleted.routines;

  const routines = new Map<string, Record<string, unknown>>();
  let routinesRemovedLocal = 0;
  let routinesRemovedRemote = 0;

  for (const r of localRoutines) {
    const id = routineId(r);
    if (!id) continue;
    const tomb = remoteRt[id];
    if (tomb && routineStamp(r) <= tomb) {
      routinesRemovedLocal++;
      continue;
    }
    routines.set(id, r);
  }
  let routinesAdded = 0;
  let routinesUpdated = 0;
  for (const r of remoteRoutines) {
    const id = routineId(r);
    if (!id) continue;
    const tomb = localRt[id];
    if (tomb && routineStamp(r) <= tomb) {
      routinesRemovedRemote++;
      continue;
    }
    const mine = routines.get(id);
    if (!mine) {
      routines.set(id, r);
      routinesAdded++;
      continue;
    }
    if (same(mine, r)) continue;
    const takeTheirs =
      prefer === 'remote' || (prefer === 'newest' ? routineStamp(r) > routineStamp(mine) : false);
    if (takeTheirs) {
      routines.set(id, r);
      routinesUpdated++;
    }
  }

  /* ---- áreas: último cambio gana ---- */
  const areaStamps: Partial<Record<SyncArea, number>> = { ...localSync.areas };
  const areaReports: AreaReport[] = [];
  let remoteWinsSomething = false;
  let localWinsSomething = false;

  const pickRemote = (area: SyncArea): boolean => {
    const ls = localSync.areas[area] ?? 0;
    const rs = remoteSync.areas[area] ?? 0;
    if (prefer === 'local') return false;
    if (prefer === 'remote') return true;
    if (rs === ls) return false;
    return rs > ls;
  };

  const next: AppState = { ...local };

  const areaContent = (area: SyncArea): void => {
    const lv = areaOf(local, area);
    const rv = areaOf(remote, area);
    if (same(lv, rv)) {
      areaReports.push({ area, action: 'same' });
      areaStamps[area] = Math.max(localSync.areas[area] ?? 0, remoteSync.areas[area] ?? 0);
      return;
    }
    const takeRemote = pickRemote(area);
    if (takeRemote) {
      remoteWinsSomething = true;
      areaStamps[area] = Math.max(localSync.areas[area] ?? 0, remoteSync.areas[area] ?? 0);
      areaReports.push({ area, action: 'remote' });
    } else {
      localWinsSomething = true;
      areaReports.push({ area, action: 'local' });
    }
  };

  for (const area of SYNC_AREAS) areaContent(area);

  /* ajustes: del ganador, pero la key del coach y los modos de carga son del
     dispositivo y nunca se pisan */
  const settingsAction = areaReports.find((r) => r.area === 'settings')?.action ?? 'same';
  const localSettings = asObj(local.settings);
  const remoteSettings = asObj(remote.settings);
  next.settings = {
    ...(settingsAction === 'remote' ? remoteSettings : localSettings),
    ai: {
      ...asObj(settingsAction === 'remote' ? remoteSettings.ai : localSettings.ai),
      apiKey: localSettings.ai ? asObj(localSettings.ai).apiKey : '',
    },
    plateModes: localSettings.plateModes,
  } as AppState['settings'];

  /* material: bloque entero, del que ganó */
  if (areaReports.some((r) => r.area === 'equipment' && r.action === 'remote')) {
    next.equipment = clone(remote.equipment);
  }

  /* biblioteca: unión por id. El estado guardado es disperso (propios + flags),
     así que una unión por id conserva lo de los dos lados; si el mismo ejercicio
     está en los dos, gana el del lado que ganó el área. */
  const exerciseRemoteWins = areaReports.some(
    (r) => r.area === 'exercises' && r.action === 'remote',
  );
  const localEx = byId(asList(local.exercises), (v) => {
    const id = asObj(v).id;
    return typeof id === 'string' ? id : null;
  });
  const remoteEx = byId(asList(remote.exercises), (v) => {
    const id = asObj(v).id;
    return typeof id === 'string' ? id : null;
  });
  const exIds = new Set([...localEx.keys(), ...remoteEx.keys()]);
  if (exIds.size) {
    const first = exerciseRemoteWins ? remoteEx : localEx;
    const second = exerciseRemoteWins ? localEx : remoteEx;
    next.exercises = [...first.keys(), ...[...second.keys()].filter((id) => !first.has(id))].map(
      (id) => clone(first.get(id) ?? second.get(id)),
    );
  }

  /* calendario: unión por día; un día que cambió en los dos, para el que ganó */
  const localPlan = asObj(local.schedule);
  const remotePlan = asObj(remote.schedule);
  const scheduleRemoteWins = areaReports.some(
    (r) => r.area === 'schedule' && r.action === 'remote',
  );
  const plan: Record<string, unknown> = { ...localPlan };
  for (const [day, value] of Object.entries(remotePlan)) {
    if (day in plan && !same(plan[day], value) && !scheduleRemoteWins) continue;
    plan[day] = clone(value);
  }
  next.schedule = plan;

  next.sessions = sessions;
  next.routines = [...routines.values()].map((r) => r as unknown as RoutineShape);

  /* sesión en curso: el progreso (series marcadas) sigue al otro dispositivo
     automáticamente. Tres casos:
     - la misma sesión en los dos lados → se fusionan las series (`mergeActiveSessions`);
     - solo la tiene el otro → se adopta aquí;
     - ya hay una sesión CERRADA en el historial con su `liveId` → no se resucita
       (la terminaste en el otro dispositivo). */
  const localActive = activeOf(local);
  const remoteActive = activeOf(remote);
  /* `finishedIds` = sesiones que cerraron la sesión en curso ENTERA. Las
     «parciales» (`partial`) conservan el `liveId` para enlazar el historial, pero
     la rutina sigue abierta: si contaran, sincronizar mataría el resto. */
  const finishedIds = new Set(
    sessions
      .filter((session) => session.partial !== true)
      .map((session) => session.liveId)
      .filter((id): id is string => typeof id === 'string' && id !== ''),
  );
  /* las sesiones que se descartaron a propósito en este dispositivo: si no se
     recordaran, el otro lado las devolvería en la siguiente sincronización */
  const discarded = new Set([...localSync.discarded, ...remoteSync.discarded]);
  const blocked = (id: string): boolean => finishedIds.has(id) || discarded.has(id);
  if (localActive && blocked(localActive.id)) {
    /* la sesión que tenía aquí ya se cerró o la descartaste: no se resucita, pero
       si el otro tiene OTRA en curso, esa sí se adopta */
    next.active = remoteActive && !blocked(remoteActive.id) ? clone(remoteActive) : null;
  } else if (localActive && remoteActive) {
    const merged = mergeActiveSessions(localActive, remoteActive);
    /* todos sus ejercicios se completaron por separado: ya no queda sesión */
    next.active = merged.entries.length ? merged : null;
  } else if (!localActive && remoteActive && !blocked(remoteActive.id)) {
    next.active = clone(remoteActive);
  }

  /* meta: lo local manda, pero `onboarded` se hereda y los tombstones se suman */
  const localMeta = asObj(local.meta);
  const remoteMeta = asObj(remote.meta);
  const sync: SyncMeta = {
    at: Math.max(localSync.at, remoteSync.at),
    areas: areaStamps,
    deleted: {
      sessions: mergeTombstones(localTomb, remoteTomb),
      routines: mergeTombstones(localRt, remoteRt),
    },
    discarded: [...discarded].slice(0, DISCARDED_MAX),
  };
  next.meta = {
    ...remoteMeta,
    ...localMeta,
    onboarded: Boolean(localMeta.onboarded) || Boolean(remoteMeta.onboarded),
    sync,
  };

  const settingsPreview =
    settingsAction === 'remote' ? settingsDiff(localSettings, remoteSettings) : [];

  const report: MergeReport = {
    sessions: {
      local: localSessions.length,
      remote: remoteSessions.length,
      added,
      updated,
      removed: removedLocal + removedRemote,
    },
    routines: {
      local: localRoutines.length,
      remote: remoteRoutines.length,
      added: routinesAdded,
      updated: routinesUpdated,
      removed: routinesRemovedLocal + routinesRemovedRemote,
    },
    areas: areaReports,
    settingsPreview,
    /* «nada» = aplicar la fusión no cambiaría nada aquí y no hay nada nuevo que
       subir; que gane lo local solo significa que este lado va por delante */
    nothing: added === 0 && updated === 0 && !remoteWinsSomething,
    bothSides: remoteWinsSomething && localWinsSomething,
  };

  return { state: next, report };
}

/**
 * Tipo mínimo de rutina que usa la fusión. El tipo real vive en `state/store.ts`
 * (una rutina es `{ id, name, items, createdAt?, updatedAt? }`), pero el dominio
 * no puede importar de `state` — y no necesita más que esto.
 */
export interface RoutineShape {
  id: string;
  [key: string]: unknown;
}

/* ---------- lo que viaja ---------- */

/**
 * Áreas que cambiaron en los DOS lados desde la última sincronización (`since`,
 * en ms) y por tanto se pueden pisar. Es lo que dispara la pantalla de revisión:
 * si solo cambió uno, fusionar es seguro y no hay nada que preguntar.
 */
export function conflictAreas(
  local: AppState,
  remote: AppState,
  since: number,
): SyncArea[] {
  const localSync = syncMetaOf(local);
  const remoteSync = syncMetaOf(remote);
  const out: SyncArea[] = [];
  for (const area of SYNC_AREAS) {
    if (same(areaOf(local, area), areaOf(remote, area))) continue;
    const mine = localSync.areas[area] ?? 0;
    const theirs = remoteSync.areas[area] ?? 0;
    if (mine > since && theirs > since) out.push(area);
  }
  return out;
}

/**
 * Copia del estado lista para subir: sin el chat y sin la API key. Lo demás
 * entero, porque el formato es el mismo que el de un backup.
 *
 * La sesión en curso SÍ viaja: es lo que hace que una serie marcada en el móvil se
 * vea en el PC (`mergeActiveSessions`). No hace falta traspaso manual.
 */
export function stripForSync(state: AppState): AppState {
  const settings = asObj(state.settings);
  const copy: AppState = {
    ...state,
    settings: {
      ...settings,
      ai: { ...asObj(settings.ai), apiKey: '' },
    } as AppState['settings'],
  };
  delete copy.chat;
  return copy;
}

/** Sesión en curso de un estado, si la hay (y con forma de sesión). */
export function activeOf(state: AppState): NonNullable<AppState['active']> | null {
  const active = state.active;
  if (!active || typeof active !== 'object') return null;
  const entries = (active as { entries?: unknown }).entries;
  return Array.isArray(entries) ? active : null;
}

/**
 * ¿Tiene contenido sincronizable? Un estado recién creado (sin sesiones, sin
 * rutinas y sin cambios sellados) no debe ocupar un hueco en la nube ni pisar
 * al otro dispositivo.
 */
export function hasSyncContent(state: AppState): boolean {
  return (
    asList(state.sessions).length > 0 ||
    asList(state.routines).length > 0 ||
    syncMetaOf(state).at > 0
  );
}
