/**
 * Fusión entre dispositivos: lo importante de estos tests es que **nunca se
 * pierde un entreno** y que borrar de verdad borra.
 */
import { describe, expect, it } from 'vitest';

import {
  areaOf,
  EMPTY_SYNC,
  hasSyncContent,
  isoMs,
  mergeStates,
  pruneTombstones,
  activeOf,
  sessionStamp,
  stampChanges,
  stripForSync,
  syncMetaOf,
  withTombstone,
  type SyncArea,
} from './sync';
import type { AppState, Session } from './types';
import { DEFAULT_SETTINGS } from './defaults';

/* ---------- utilidades de los tests ---------- */

function session(id: string, date: string, endedAt?: string, extra: Partial<Session> = {}): Session {
  return {
    id,
    date,
    startedAt: `${date}T10:00:00.000Z`,
    endedAt: endedAt ?? `${date}T11:00:00.000Z`,
    unit: 'kg',
    entries: [],
    ...extra,
  };
}

function baseState(patch: Partial<AppState> = {}): AppState {
  return {
    version: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    settings: structuredClone(DEFAULT_SETTINGS),
    ...patch,
  };
}

/** Estado con marcas de tiempo ya puestas a mano (evita depender del reloj). */
function stamped(patch: Partial<AppState>, areas: Partial<Record<SyncArea, number>>): AppState {
  const state = baseState(patch);
  return {
    ...state,
    meta: { ...(state.meta as object), sync: { ...EMPTY_SYNC, at: Math.max(0, ...Object.values(areas)), areas } },
  };
}

/* ---------- marcas de tiempo ---------- */

describe('stampChanges', () => {
  it('sella el área que cambió y deja en paz las demás', () => {
    const prev = baseState({ sessions: [session('s1', '2026-09-01')] });
    const next = baseState({ settings: { ...DEFAULT_SETTINGS, units: 'lb' } });
    const out = stampChanges(prev, next, 1000);
    expect(syncMetaOf(out).areas.settings).toBe(1000);
    expect(syncMetaOf(out).areas.equipment).toBeUndefined();
    expect(syncMetaOf(out).at).toBe(1000);
  });

  it('no sella nada cuando el contenido es el mismo (aunque el objeto sea nuevo)', () => {
    const prev = baseState();
    const next = stampChanges(prev, baseState(), 1000);
    expect(syncMetaOf(next).at).toBe(0);
    expect(next).toBeDefined();
  });

  it('la key del coach y los modos de carga NO cuentan como cambio de ajustes', () => {
    const prev = baseState();
    const next = baseState({
      settings: {
        ...DEFAULT_SETTINGS,
        ai: { ...DEFAULT_SETTINGS.ai, apiKey: 'secreta' },
        plateModes: { 'ex-1': 'db2' },
      },
    });
    expect(syncMetaOf(stampChanges(prev, next, 1000)).areas.settings).toBeUndefined();
  });

  it('sin estado previo no sella nada: un estado nuevo no pisa al del otro lado', () => {
    const fresh = baseState({ sessions: [session('s1', '2026-09-01')] });
    expect(syncMetaOf(stampChanges(null, fresh, 1000)).at).toBe(0);
  });

  it('el inventario de discos SÍ es contenido sincronizable', () => {
    const prev = baseState();
    const first = DEFAULT_SETTINGS.plates[0] ?? { w: 3, unit: "kg" as const, discs: 2, on: true };
    const plates = [{ ...first, discs: 4 }];
    const next = baseState({ settings: { ...DEFAULT_SETTINGS, plates } });
    expect(areaOf(prev, 'settings')).not.toEqual(areaOf(next, 'settings'));
  });
});

describe('tombstones', () => {
  it('`withTombstone` guarda el id con su fecha', () => {
    const out = withTombstone(baseState(), 'sessions', 's1', 5000);
    expect(syncMetaOf(out).deleted.sessions.s1).toBe(5000);
  });

  it('se guardan los más recientes y se descartan los valores que no son fecha', () => {
    const raw = { a: 100, b: 300, c: 'x', '': 50 };
    expect(Object.keys(pruneTombstones(raw))).toEqual(['b', 'a']);
  });
});

/* ---------- sesiones ---------- */

describe('fusión de sesiones', () => {
  it('suma las del otro lado sin tocar las mías (nadie pierde un entreno)', () => {
    const local = stamped({ sessions: [session('a', '2026-09-10')] }, {});
    const remote = stamped({ sessions: [session('b', '2026-09-11')] }, {});
    const { state } = mergeStates(local, remote);
    expect(state.sessions?.map((s) => s.id).sort()).toEqual(['a', 'b']);
  });

  it('con el mismo id gana la que terminó más tarde', () => {
    const local = stamped({ sessions: [session('a', '2026-09-10', '2026-09-10T11:00:00.000Z')] }, {});
    const remote = stamped(
      { sessions: [session('a', '2026-09-10', '2026-09-10T12:30:00.000Z', { notes: 'editada' })] },
      {},
    );
    const { state, report } = mergeStates(local, remote);
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions?.[0]?.notes).toBe('editada');
    expect(report.sessions.updated).toBe(1);
    expect(report.sessions.added).toBe(0);
  });

  it('en empate gana la local (los dos dispositivos convergen)', () => {
    const local = stamped({ sessions: [session('a', '2026-09-10', '2026-09-10T11:00:00.000Z')] }, {});
    const remote = stamped(
      { sessions: [session('a', '2026-09-10', '2026-09-10T11:00:00.000Z', { notes: 'otra' })] },
      {},
    );
    const { state, report } = mergeStates(local, remote);
    expect(state.sessions?.[0]?.notes).toBeUndefined();
    expect(report.sessions.updated).toBe(0);
  });

  it('una sesión borrada aquí no resucita desde el otro lado', () => {
    const tomb = isoMs('2026-09-15T00:00:00.000Z');
    const local = withTombstone(stamped({ sessions: [] }, {}), 'sessions', 'a', tomb);
    const remote = stamped({ sessions: [session('a', '2026-09-10')] }, {});
    const { state, report } = mergeStates(local, remote);
    expect(state.sessions).toHaveLength(0);
    expect(report.sessions.removed).toBe(1);
  });

  it('un borrado ANTERIOR a la sesión no la mata', () => {
    const tomb = isoMs('2026-09-10T09:00:00.000Z');
    const local = withTombstone(stamped({ sessions: [] }, {}), 'sessions', 'a', tomb);
    const remote = stamped({ sessions: [session('a', '2026-09-10', '2026-09-10T12:00:00.000Z')] }, {});
    const { state } = mergeStates(local, remote);
    expect(state.sessions).toHaveLength(1);
  });

  it('las fusionadas salen ordenadas por fecha de fin, como el resto de la app', () => {
    const local = stamped({ sessions: [session('a', '2026-09-10')] }, {});
    const remote = stamped({ sessions: [session('b', '2026-09-20')] }, {});
    const { state } = mergeStates(local, remote);
    expect(state.sessions?.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('`sessionStamp` es la hora de fin y, si no la hay, la de inicio', () => {
    expect(sessionStamp(session('a', '2026-09-10', '2026-09-10T11:00:00.000Z'))).toBe(
      isoMs('2026-09-10T11:00:00.000Z'),
    );
    const open = { ...session('a', '2026-09-10'), endedAt: undefined };
    expect(sessionStamp(open)).toBe(isoMs('2026-09-10T10:00:00.000Z'));
  });
});

/* ---------- rutinas ---------- */

describe('fusión de rutinas', () => {
  const routine = (id: string, name: string, updatedAt?: string) => ({
    id,
    name,
    items: [],
    createdAt: `2026-09-01T00:00:00.000Z`,
    updatedAt,
  });

  it('suma las del otro lado y con el mismo id gana la edición más reciente', () => {
    const local = stamped(
      { routines: [routine('r1', 'mía', '2026-09-10T00:00:00.000Z'), routine('r2', 'solo aquí')] },
      { routines: 1000 },
    );
    const remote = stamped(
      { routines: [routine('r1', 'editada', '2026-09-12T00:00:00.000Z'), routine('r3', 'nueva')] },
      { routines: 2000 },
    );
    const { state, report } = mergeStates(local, remote);
    const names = (state.routines as { id: string; name: string }[])
      .map((r) => `${r.id}:${r.name}`)
      .sort();
    expect(names).toEqual(['r1:editada', 'r2:solo aquí', 'r3:nueva']);
    expect(report.routines.added).toBe(1);
    expect(report.routines.updated).toBe(1);
  });

  it('una rutina borrada no vuelve', () => {
    const tomb = isoMs('2026-09-15T00:00:00.000Z');
    const local = withTombstone(stamped({ routines: [] }, { routines: 100 }), 'routines', 'r1', tomb);
    const remote = stamped({ routines: [routine('r1', 'borrada', '2026-09-01T00:00:00.000Z')] }, {});
    const { state, report } = mergeStates(local, remote);
    expect(state.routines).toHaveLength(0);
    expect(report.routines.removed).toBe(1);
  });
});

/* ---------- áreas ---------- */

describe('áreas: gana el último cambio', () => {
  it('los ajustes del lado más reciente, pero la key y los modos de carga son míos', () => {
    const local = stamped(
      {
        settings: {
          ...DEFAULT_SETTINGS,
          units: 'kg',
          ai: { ...DEFAULT_SETTINGS.ai, apiKey: 'mi-key' },
          plateModes: { 'ex-1': 'bar' },
        },
      },
      { settings: 1000 },
    );
    const remote = stamped(
      {
        settings: {
          ...DEFAULT_SETTINGS,
          units: 'lb',
          ai: { ...DEFAULT_SETTINGS.ai, apiKey: '' },
          plateModes: { 'ex-1': 'db2' },
        },
      },
      { settings: 5000 },
    );
    const { state, report } = mergeStates(local, remote);
    const settings = state.settings;
    expect(settings.units).toBe('lb');
    expect(settings.ai.apiKey).toBe('mi-key');
    expect(settings.plateModes['ex-1']).toBe('bar');
    expect(report.settingsPreview).toEqual([{ key: 'units', from: 'kg', to: 'lb' }]);
    expect(report.bothSides).toBe(false);
  });

  it('con `prefer: "local"` no me pisa nada, aunque el otro sea más reciente', () => {
    const local = stamped({ settings: { ...DEFAULT_SETTINGS, units: 'kg' } }, { settings: 1000 });
    const remote = stamped({ settings: { ...DEFAULT_SETTINGS, units: 'lb' } }, { settings: 5000 });
    const { state } = mergeStates(local, remote, { prefer: 'local' });
    expect((state.settings).units).toBe('kg');
  });

  it('con `prefer: "remote"` manda el otro', () => {
    const local = stamped({ settings: { ...DEFAULT_SETTINGS, units: 'kg' } }, { settings: 9000 });
    const remote = stamped({ settings: { ...DEFAULT_SETTINGS, units: 'lb' } }, { settings: 1000 });
    const { state } = mergeStates(local, remote, { prefer: 'remote' });
    expect((state.settings).units).toBe('lb');
  });

  it('marca `bothSides` cuando cada uno va por delante en algo', () => {
    const local = stamped(
      { settings: { ...DEFAULT_SETTINGS, units: 'lb' }, equipment: { a: true } },
      { settings: 5000, equipment: 100 },
    );
    const remote = stamped(
      { settings: { ...DEFAULT_SETTINGS, units: 'kg' }, equipment: { a: false } },
      { settings: 100, equipment: 5000 },
    );
    const { report } = mergeStates(local, remote);
    expect(report.bothSides).toBe(true);
  });

  it('el material se copia entero del que gana', () => {
    const local = stamped({ equipment: { a: true, b: true } }, { equipment: 100 });
    const remote = stamped({ equipment: { a: false, b: false } }, { equipment: 200 });
    const { state } = mergeStates(local, remote);
    expect(state.equipment).toEqual({ a: false, b: false });
  });

  it('la biblioteca se une por id: los propios de cada lado sobreviven', () => {
    const local = stamped({ exercises: [{ id: 'x', allowed: false }, { id: 'comun', tips: 'mío' }] }, {
      exercises: 100,
    });
    const remote = stamped({ exercises: [{ id: 'y', custom: true }, { id: 'comun', tips: 'suyo' }] }, {
      exercises: 200,
    });
    const { state } = mergeStates(local, remote);
    const list = state.exercises as { id: string; tips?: string }[];
    expect(list.map((e) => e.id).sort()).toEqual(['comun', 'x', 'y']);
    expect(list.find((e) => e.id === 'comun')?.tips).toBe('suyo');
  });

  it('el calendario se une por día y los días en conflicto van con el que gana', () => {
    const local = stamped(
      { schedule: { '2026-09-10': { status: 'done' }, '2026-09-12': { title: 'mío' } } },
      { schedule: 100 },
    );
    const remote = stamped(
      { schedule: { '2026-09-10': { status: 'planned' }, '2026-09-11': { title: 'suyo' } } },
      { schedule: 500 },
    );
    const { state } = mergeStates(local, remote);
    const plan = state.schedule as Record<string, { status?: string; title?: string }>;
    expect(plan['2026-09-10']?.status).toBe('planned');
    expect(plan['2026-09-11']?.title).toBe('suyo');
    expect(plan['2026-09-12']?.title).toBe('mío');
  });

  it('`onboarded` se hereda de cualquiera de los dos', () => {
    const local = stamped({ meta: { onboarded: false } }, {});
    const remote = stamped({ meta: { onboarded: true } }, {});
    const { state } = mergeStates(local, remote);
    expect(syncMetaOf(state).at).toBeGreaterThanOrEqual(0);
    expect((state.meta as { onboarded: boolean }).onboarded).toBe(true);
  });

  it('el informe dice `nothing` cuando el otro no aporta nada', () => {
    const local = stamped({ sessions: [session('a', '2026-09-10')] }, {});
    const { report } = mergeStates(local, structuredClone(local));
    expect(report.nothing).toBe(true);
  });
});

/* ---------- lo que viaja ---------- */

describe('stripForSync', () => {
  it('quita el chat y la key del coach, pero la sesión en curso VIAJA', () => {
    const state = baseState({
      settings: { ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai, apiKey: 'secreta' } },
      active: { id: 'a', entries: [] } as unknown as AppState['active'],
      chat: [{ role: 'user' }],
    });
    const out = stripForSync(state);
    expect(out.settings?.ai.apiKey).toBe('');
    expect('chat' in out).toBe(false);
    /* viaja para poder retomarla en el otro dispositivo (traspaso explícito) */
    expect(activeOf(out)?.id).toBe('a');
  });

  it('un estado vacío no tiene nada que sincronizar', () => {
    expect(hasSyncContent(baseState())).toBe(false);
    expect(hasSyncContent(baseState({ sessions: [session('a', '2026-09-10')] }))).toBe(true);
    expect(hasSyncContent(stampChanges(baseState(), baseState({ equipment: {} }), 10))).toBe(true);
  });
});
