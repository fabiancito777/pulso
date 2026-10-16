/**
 * Edge cases 25–50 de `_specs/edge-cases-300.md` · `domain/session`.
 *
 * Reglas delicadas: el arrastre va hacia ABAJO, `''` ≠ `0`, el descanso arranca
 * en la última serie de un ejercicio solo si queda otro pendiente, y `toggleSet`
 * devuelve la decisión en vez de ejecutarla.
 */
import { describe, expect, it } from 'vitest';

import type { Suggestion } from '@/domain/analytics';
import {
  addSet,
  autofillNext,
  blankSet,
  editSetField,
  elapsedSec,
  entriesFromRoutine,
  entryVolume,
  finishSession,
  moveEntry,
  newEntry,
  nextLabel,
  plateInitialWeight,
  plateTarget,
  progress,
  propagateSet,
  removeSet,
  setRestSec,
  setSet,
  startSession,
  toggleSet,
} from '@/domain/session';
import type { ActiveEntry, ActiveSession, ActiveSet, Exercise } from '@/domain/types';

function set(weight: number | '', reps: number | '', done = false): ActiveSet {
  return { weight, reps, done, ts: done ? '2026-01-01T00:00:00.000Z' : null, rpe: null };
}

function entry(id: string, name: string, sets: ActiveSet[], restSec = 90): ActiveEntry {
  return { exId: id, name, restSec, repMin: 8, repMax: 12, sets, notes: '' };
}

function session(entries: ActiveEntry[], over: Partial<ActiveSession> = {}): ActiveSession {
  return {
    id: 'live_1',
    routineId: null,
    name: 'Test',
    startedAt: '2026-01-01T10:00:00.000Z',
    unit: 'kg',
    entries,
    notes: '',
    dayIso: '2026-01-01',
    source: 'manual',
    ...over,
  };
}

function ejercicio(id: string, over: Partial<Exercise> = {}): Exercise {
  return {
    id,
    name: over.name ?? id,
    group: 'pecho',
    equip: '',
    type: 'compuesto',
    sets: 3,
    repMin: 8,
    repMax: 12,
    rest: 90,
    allowed: true,
    custom: false,
    bw: false,
    tags: [],
    tips: '',
    ...over,
  };
}

const sinHistorial: Suggestion = { weight: 0, reps: 8, kg: 0, basis: 'sin historial' };
const suggest = (): Suggestion => sinHistorial;

describe('25–28 · descanso al marcar/desmarcar', () => {
  it('25 · desmarcar una serie pide cancelar el descanso', () => {
    const s = session([entry('a', 'Press', [set(20, 8, true)])]);
    const res = toggleSet(s, 0, 0, {
      on: false,
      autoRest: true,
      restDefault: 90,
      restRunning: true,
    });
    expect(res?.rest.action).toBe('cancel');
    expect(res?.session.entries[0].sets[0].done).toBe(false);
  });

  it('26 · la última serie de un ejercicio arranca descanso si quedan más', () => {
    const s = session([
      entry('a', 'Press', [set(20, 8, true)]),
      entry('b', 'Remo', [set('', '', false)]),
    ]);
    const res = toggleSet(s, 0, 0, {
      on: true,
      autoRest: true,
      restDefault: 90,
      restRunning: false,
    });
    expect(res?.rest).toEqual({ action: 'start', sec: 90, label: 'Remo' });
  });

  it('27 · marcar la última serie de la sesión no arranca descanso', () => {
    const s = session([entry('a', 'Press', [set('', '', false)])]);
    const res = toggleSet(s, 0, 0, {
      on: true,
      autoRest: true,
      restDefault: 90,
      restRunning: false,
    });
    expect(res?.rest.action).toBe('none');
  });

  it('28 · marcar la última serie no corta un descanso en marcha', () => {
    const s = session([entry('a', 'Press', [set('', '', false)])]);
    const res = toggleSet(s, 0, 0, {
      on: true,
      autoRest: true,
      restDefault: 90,
      restRunning: true,
    });
    expect(res?.rest.action).toBe('none');
  });
});

describe('29–33 · edición y arrastre', () => {
  it('29 · peso vacío "" no es 0', () => {
    const s = session([entry('a', 'Press', [set(20, 8), set('', '', false)])]);
    const next = editSetField(s, 0, 0, 'weight', '');
    expect(next.entries[0].sets[0].weight).toBe('');
    expect(typeof next.entries[0].sets[0].weight).toBe('string');
  });

  it('30 · el arrastre del peso solo va hacia abajo (no escribe la serie editada)', () => {
    const s = session([entry('a', 'Press', [set('', ''), set('', ''), set('', '')])]);
    const next = propagateSet(s, 0, 0, 'weight', 30);
    expect(next.entries[0].sets[0].weight).toBe('');
    expect(next.entries[0].sets[1].weight).toBe(30);
    expect(next.entries[0].sets[2].weight).toBe(30);
  });

  it('31 · el arrastre no toca series ya marcadas ni sube a las de arriba', () => {
    const s = session([
      entry('a', 'Press', [set(10, 8, true), set('', ''), set('', ''), set('', '')]),
    ]);
    const next = propagateSet(s, 0, 2, 'weight', 50);
    expect(next.entries[0].sets[0].weight).toBe(10);
    expect(next.entries[0].sets[1].weight).toBe('');
    expect(next.entries[0].sets[3].weight).toBe(50);
  });

  it('32 · el RPE no se arrastra nunca', () => {
    const s = session([entry('a', 'Press', [set(20, 8), set(20, 8), set(20, 8)])]);
    const next = setSet(s, 0, 0, { rpe: 9 });
    expect(next.entries[0].sets[0].rpe).toBe(9);
    expect(next.entries[0].sets[1].rpe).toBeNull();
  });

  it('33 · editSetField escribe la serie editada Y arrastra las de abajo', () => {
    const s = session([entry('a', 'Press', [set('', ''), set('', ''), set('', '')])]);
    const next = editSetField(s, 0, 0, 'weight', 40);
    expect(next.entries[0].sets.map((x) => x.weight)).toEqual([40, 40, 40]);
  });
});

describe('34–41 · autorrelleno, construcción y orden', () => {
  it('34 · marcar una serie autorrellena la siguiente vacía', () => {
    const s = session([entry('a', 'Press', [set(50, 8), set('', '')])]);
    const next = autofillNext(s, 0, 0);
    expect(next.entries[0].sets[1]).toMatchObject({ weight: 50, reps: 8 });
  });

  it('35 · newEntry parte de la biblioteca con series en blanco', () => {
    // Ajuste: la firma real recibe `exId` + `library` (no un `exercise` suelto).
    const e = newEntry({ exId: 'x', sets: 3, repMin: 8, repMax: 12, rest: 90, library: [] });
    expect(e.sets).toHaveLength(3);
    expect(e.sets[0]).toMatchObject({ done: false, weight: '', reps: '' });
    expect(e.restSec).toBe(90);
  });

  it('36 · startSession congela el snapshot del plan', () => {
    const routine = {
      id: 'rt-1',
      name: 'Rutina',
      items: [{ exId: 'x', sets: 3, repMin: 8, repMax: 10 }],
    };
    const s = startSession({
      exercises: [ejercicio('x')],
      suggest,
      routine,
      dayIso: '2026-01-05',
      unit: 'kg',
    });
    // HALLAZGO: el contrato esperaba source:'plan'; el código deja 'manual'
    // salvo que el caller pase `source`. La rutina igualmente congela el plan.
    expect(s.source).toBe('manual');
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0].exId).toBe('x');
    expect(s.plan).toEqual(routine.items);
  });

  it('37 · nextLabel nombra el siguiente ejercicio', () => {
    const s = session([
      entry('a', 'Press banca', [set(20, 8, true)]),
      entry('b', 'Remo', [set('', '')]),
    ]);
    expect(nextLabel(s, 0)).toContain('Remo');
  });

  it('38 · añadir y quitar series respeta el mínimo de una', () => {
    const s = session([entry('a', 'Press', [set('', '')])]);
    expect(removeSet(s, 0, 0).entries[0].sets).toHaveLength(1);
    expect(addSet(s, 0).entries[0].sets).toHaveLength(2);
  });

  it('39 · quitar una serie intermedia reindexa sin romper', () => {
    const s = session([
      entry('a', 'Press', [set(10, 1), set(20, 2), set(30, 3)]),
    ]);
    const next = removeSet(s, 0, 1);
    expect(next.entries[0].sets.map((x) => x.weight)).toEqual([10, 30]);
  });

  it('40 · mover un ejercicio fuera de rango se acota', () => {
    const s = session([entry('a', 'A', [set('', '')]), entry('b', 'B', [set('', '')])]);
    expect(moveEntry(s, 0, -5).entries.map((e) => e.exId)).toEqual(['a', 'b']);
    expect(moveEntry(s, 1, 5).entries.map((e) => e.exId)).toEqual(['a', 'b']);
  });

  it('41 · descanso personalizado por ejercicio', () => {
    const s = session([entry('a', 'Press', [set('', '')], 90), entry('b', 'B', [set('', '')])]);
    const next = setRestSec(s, 0, 45);
    expect(next.entries[0].restSec).toBe(45);
    expect(next.entries[1].restSec).toBe(90);
  });
});

describe('42–50 · progreso, cierre y volumen', () => {
  it('42 · progress cuenta series hechas y volumen', () => {
    const s = session([entry('a', 'Press', [set(20, 10, true), set('', '')])]);
    const p = progress(s);
    expect(p.done).toBe(1);
    expect(p.total).toBe(2);
    expect(p.sets).toBe(2);
    expect(p.volume).toBe(200);
  });

  it('43 · plateTarget elige la primera serie sin peso', () => {
    const e = entry('a', 'Press', [set(20, 8, true), set('', ''), set(30, 8)]);
    expect(plateTarget(e)).toBe(1);
  });

  it('44 · plateInitialWeight cae a la última serie si todas tienen peso', () => {
    const e = entry('a', 'Press', [set(20, 8), set(25, 8)]);
    expect(plateInitialWeight(e)).toBe(25);
  });

  it('45 · finishSession no guarda sesión sin ninguna serie marcada', () => {
    const s = session([entry('a', 'Press', [set('', '', false), set('', '', false)])]);
    expect(finishSession(s)).toBeNull();
  });

  it('46 · finishSession cierra y guarda notas', () => {
    const s = session([entry('a', 'Press', [set(20, 8, true)])]);
    const done = finishSession(s, { notes: 'ok', now: '2026-01-01T11:00:00.000Z' });
    expect(done?.endedAt).toBe('2026-01-01T11:00:00.000Z');
    expect(done?.notes).toBe('ok');
  });

  it('47 · entryVolume convierte lb→kg', () => {
    const e = entry('a', 'Press', [set(100, 5, true)]);
    expect(entryVolume(e, 'lb')).toBeCloseTo(226.796, 2);
  });

  it('48 · blankSet no marca done', () => {
    expect(blankSet()).toMatchObject({ done: false, weight: '', reps: '' });
  });

  it('49 · entriesFromRoutine salta ejercicios no resueltos', () => {
    const routine = {
      items: [
        { exId: 'ok', sets: 2 },
        { exId: 'fantasma', sets: 3 },
      ],
    };
    const made = entriesFromRoutine(routine, suggest, [ejercicio('ok')]);
    expect(made).toHaveLength(1);
    expect(made[0].exId).toBe('ok');
  });

  it('50 · elapsedSec acepta now inyectado y no da negativo', () => {
    const s = session([], { startedAt: '2026-01-02T00:00:00.000Z' });
    const before = new Date('2026-01-01T00:00:00.000Z').getTime();
    expect(elapsedSec(s, before)).toBe(0);
  });
});
