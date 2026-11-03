/**
 * Superseries: el agrupado (ids consecutivos), el compañero al que se cambia sin
 * descansar, emparejar/separar en una rutina y que el vínculo sobreviva al guardar
 * la sesión.
 */
import { describe, expect, it } from 'vitest';

import { finishSession, moveEntry, removeEntry, toggleSet } from './session';
import {
  freshSupersetIds,
  linkAt,
  partnerAfter,
  pruneSupersets,
  supersetGroups,
  supersetPosition,
  unlinkAt,
} from './supersets';
import type { ActiveEntry, ActiveSession, RoutineItem } from './types';

const TS = '2026-01-01T10:00:00.000Z';

function entry(id: string, superset: string | null, doneSets = 0): ActiveEntry {
  return {
    exId: id,
    name: id,
    repMin: 8,
    repMax: 12,
    restSec: 120,
    notes: '',
    ...(superset ? { superset } : {}),
    sets: [0, 1].map((j) => ({
      weight: 20,
      reps: 10,
      done: j < doneSets,
      ts: j < doneSets ? TS : null,
      rpe: null,
    })),
  };
}

function session(entries: ActiveEntry[]): ActiveSession {
  return {
    id: 's',
    routineId: null,
    name: 't',
    startedAt: TS,
    unit: 'kg',
    entries,
    notes: '',
    dayIso: '2026-01-01',
    source: 'manual',
  };
}

const OPTS = { autoRest: true, restDefault: 90, restRunning: false, now: TS };

describe('supersetGroups', () => {
  it('agrupa dos consecutivos con el mismo id y les da letra', () => {
    const groups = supersetGroups([entry('a', 'ss1'), entry('b', 'ss1')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.indices).toEqual([0, 1]);
    expect(groups[0]?.letter).toBe('A');
  });

  it('un id suelto no es par (ni insignia ni descanso distinto)', () => {
    expect(supersetGroups([entry('a', 'ss1')])).toEqual([]);
    expect(supersetGroups([entry('a', null), entry('b', null)])).toEqual([]);
  });

  it('tres seguidos con el mismo id son un bloque, no dos pares', () => {
    const groups = supersetGroups([entry('a', 'ss1'), entry('b', 'ss1'), entry('c', 'ss1')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.indices).toEqual([0, 1, 2]);
    expect(supersetPosition([entry('a', 'ss1'), entry('b', 'ss1'), entry('c', 'ss1')], 2)).toMatchObject(
      { letter: 'A', position: 3, size: 3 },
    );
  });

  it('si se rompe la vecindad deja de ser par', () => {
    const groups = supersetGroups([entry('a', 'ss1'), entry('x', null), entry('b', 'ss1')]);
    expect(groups).toEqual([]);
  });

  it('dos pares distintos llevan letras distintas', () => {
    const groups = supersetGroups([
      entry('a', 'ss1'),
      entry('b', 'ss1'),
      entry('c', 'ss2'),
      entry('d', 'ss2'),
    ]);
    expect(groups.map((g) => g.letter)).toEqual(['A', 'B']);
  });
});

describe('partnerAfter', () => {
  it('devuelve el compañero mientras tenga series pendientes', () => {
    const entries = [entry('a', 'ss1'), entry('b', 'ss1')];
    expect(partnerAfter(entries, 0)).toBe(1);
  });

  it('null cuando el par está cerrado', () => {
    const entries = [entry('a', 'ss1', 0), entry('b', 'ss1', 2)];
    expect(partnerAfter(entries, 0)).toBeNull();
  });

  it('null si el ejercicio va suelto', () => {
    expect(partnerAfter([entry('a', null), entry('b', null)], 0)).toBeNull();
  });
});

describe('toggleSet en una superserie', () => {
  it('marcar una serie del primer ejercicio no arranca descanso', () => {
    const result = toggleSet(session([entry('a', 'ss1'), entry('b', 'ss1')]), 0, 0, OPTS);
    expect(result?.rest.action).toBe('none');
  });

  it('al cerrar el par sí descansa y avisa del siguiente ejercicio', () => {
    const result = toggleSet(
      session([entry('a', 'ss1', 2), entry('b', 'ss1')]),
      1,
      0,
      OPTS,
    );
    expect(result?.rest).toMatchObject({ action: 'start', label: 'b' });
  });

  it('un ejercicio suelto conserva su descanso de siempre', () => {
    const result = toggleSet(session([entry('a', null)]), 0, 0, OPTS);
    expect(result?.rest.action).toBe('start');
  });

  it('el vínculo se guarda en la sesión terminada', () => {
    const done = finishSession(session([entry('a', 'ss1', 1), entry('b', 'ss1', 1)]));
    expect(done?.entries.map((e) => e.superset)).toEqual(['ss1', 'ss1']);
  });
});

describe('linkAt / unlinkAt (editor de rutinas)', () => {
  const items: RoutineItem[] = [
    { exId: 'a', sets: 3 },
    { exId: 'b', sets: 3 },
    { exId: 'c', sets: 3 },
  ];

  it('empareja con el siguiente', () => {
    const linked = linkAt(items, 0, 'ss1');
    expect(linked?.map((i) => i.superset)).toEqual(['ss1', 'ss1', undefined]);
  });

  it('no empareja si alguno ya está en un par', () => {
    expect(linkAt(linkAt(items, 0, 'ss1') ?? items, 1, 'ss2')).toBeNull();
  });

  it('no hay siguiente: no empareja', () => {
    expect(linkAt(items, 2, 'ss1')).toBeNull();
  });

  it('separar limpia los dos miembros', () => {
    const linked = linkAt(items, 0, 'ss1') ?? items;
    expect(unlinkAt(linked, 1).map((i) => i.superset)).toEqual([null, null, undefined]);
  });

  it('separar un item sin par no toca nada', () => {
    expect(unlinkAt(items, 1)).toEqual(items);
  });
});

describe('freshSupersetIds (pegar dos listas)', () => {
  it('renombra el run entero cuando su id ya está en la sesión', () => {
    const next = freshSupersetIds([entry('c', 'ss1'), entry('d', 'ss1')], ['ss1']);
    const [a, b] = next.map((item) => item.superset);
    expect(a).toBe(b);
    expect(a).not.toBe('ss1');
  });

  it('no toca un run libre y respeta el id suelto', () => {
    const list = [entry('a', 'ss1'), entry('b', 'ss1'), entry('c', null)];
    expect(freshSupersetIds(list)).toEqual(list);
  });

  it('duplicar una rutina deja de ser un bloque de cuatro', () => {
    const una = [entry('a', 'ss1'), entry('b', 'ss1')];
    const copia = freshSupersetIds([entry('c', 'ss1'), entry('d', 'ss1')], ['ss1']);
    expect(supersetGroups([...una, ...copia]).map((group) => group.indices)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('dos runs con la misma letra reciben ids distintos', () => {
    const list = [entry('a', 'A'), entry('b', 'A'), entry('x', null), entry('c', 'A'), entry('d', 'A')];
    const ids = freshSupersetIds(list).map((item) => item.superset);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[3]).toBe(ids[4]);
    expect(ids[0]).not.toBe(ids[3]);
  });
});

describe('pruneSupersets (ids huérfanos)', () => {
  it('limpia el id que se quedó solo y respeta el par', () => {
    expect(pruneSupersets([entry('a', 'ss1'), entry('b', null)]).map((e) => e.superset)).toEqual([
      null,
      undefined,
    ]);
    expect(pruneSupersets([entry('a', 'ss1'), entry('b', 'ss1')]).map((e) => e.superset)).toEqual([
      'ss1',
      'ss1',
    ]);
  });

  it('quitar un miembro del par deja al otro suelto y sin id', () => {
    const out = removeEntry(session([entry('a', 'ss1'), entry('b', 'ss1')]), 1);
    expect(out.entries[0]?.superset).toBeNull();
  });

  it('mover un ejercicio entre los dos miembros deshace el par', () => {
    const out = moveEntry(session([entry('a', 'ss1'), entry('b', 'ss1'), entry('x', null)]), 2, -1);
    expect(out.entries.map((item) => `${item.exId}:${item.superset ?? '-'}`)).toEqual([
      'a:-',
      'x:-',
      'b:-',
    ]);
  });
});
