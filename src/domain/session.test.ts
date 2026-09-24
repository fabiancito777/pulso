/**
 * Sesión en curso: las reglas que en la v1 solo se podían comprobar entrenando de
 * verdad (o con el auto-test del navegador) y que son justo las que se rompen sin
 * querer al portar: el arrastre del valor hacia abajo, cuándo hay descanso, el peso
 * vacío frente a 0 y qué se guarda al cerrar la sesión.
 *
 * Las decisiones del descanso se comprueban aquí porque `toggleSet` las DEVUELVE en
 * vez de ejecutarlas (ver la cabecera de `session.ts`).
 */
import { describe, expect, it } from 'vitest';

import type { Suggestion } from './analytics';
import {
  addEntry,
  addSet,
  autofillNext,
  blankSet,
  editSetField,
  elapsedSec,
  finishSession,
  moveEntry,
  newEntry,
  nextLabel,
  prefill,
  progress,
  propagateSet,
  removeEntry,
  removeSet,
  setRestSec,
  setSet,
  startSession,
  toggleSet,
} from './session';
import type { ActiveSession, Exercise, RoutineItem } from './types';

/* ---------- datos de prueba ---------- */

function ejercicio(id: string, extra: Partial<Exercise> = {}): Exercise {
  return {
    id,
    name: extra.name ?? id,
    group: 'pecho',
    equip: '',
    type: 'compuesto',
    sets: 3,
    repMin: 8,
    repMax: 12,
    rest: 120,
    allowed: true,
    custom: false,
    bw: false,
    tags: [],
    tips: '',
    ...extra,
  };
}

const BIBLIOTECA: Exercise[] = [
  ejercicio('press-banca', { name: 'Press de banca', sets: 4, rest: 150 }),
  ejercicio('sentadilla', { name: 'Sentadilla', sets: 3, repMin: 6, repMax: 10, rest: 240 }),
  ejercicio('remo-mancuerna', { name: 'Remo con mancuerna' }),
];

const sinHistorial = (): Suggestion => ({ weight: 0, reps: 8, kg: 0, basis: 'sin historial' });

const sugerencia = (weight = 60): Suggestion => ({
  weight,
  reps: 8,
  kg: weight,
  basis: 'última vez 60 kg × 8 · hace 3 días',
});

/** `startSession` recibe la sugerencia como función (una por ejercicio). */
const conHistorial =
  (weight = 60) =>
  () =>
    sugerencia(weight);

function nuevaSesion(opts: Partial<Parameters<typeof startSession>[0]> = {}): ActiveSession {
  return startSession({
    exercises: BIBLIOTECA,
    suggest: sinHistorial,
    exIds: ['press-banca', 'sentadilla'],
    now: '2026-09-24T10:00:00.000Z',
    dayIso: '2026-09-24',
    id: 'live_1',
    ...opts,
  });
}

const marcar = (session: ActiveSession, entryIndex: number, setIndex: number, on?: boolean) =>
  toggleSet(session, entryIndex, setIndex, {
    on,
    autoRest: true,
    restDefault: 90,
    restRunning: false,
  });

/* ---------- construcción ---------- */

describe('newEntry', () => {
  it('crea las series vacías (peso y reps en blanco, no en 0)', () => {
    const entry = newEntry({ exId: 'press-banca', library: BIBLIOTECA });
    expect(entry.sets).toHaveLength(4);
    expect(entry.sets[0]).toMatchObject({ weight: '', reps: '', done: false, ts: null, rpe: null });
    expect(entry.restSec).toBe(150);
    expect(blankSet()).toEqual({
      weight: '',
      reps: '',
      done: false,
      ts: null,
      rpe: null,
      target: undefined,
    });
  });

  it('la prescripción manda sobre la biblioteca y el número de series se acota 1-12', () => {
    const entry = newEntry({
      exId: 'press-banca',
      sets: 99,
      rest: 45,
      repMin: 5,
      repMax: 6,
      library: BIBLIOTECA,
    });
    expect(entry.sets).toHaveLength(12);
    expect(entry.restSec).toBe(45);
    expect(entry.repMin).toBe(5);
    expect(newEntry({ exId: 'press-banca', sets: 0, library: BIBLIOTECA }).sets).toHaveLength(1);
  });

  it('un ejercicio que no está en la biblioteca no rompe nada', () => {
    const entry = newEntry({ exId: 'inventado', library: BIBLIOTECA });
    expect(entry).toMatchObject({ name: 'inventado', restSec: 90, repMin: 8, repMax: 12 });
    expect(entry.sets).toHaveLength(3);
  });
});

describe('prefill', () => {
  it('sin historial deja el peso VACÍO (un 0 parecía peso obligatorio)', () => {
    const entry = prefill(newEntry({ exId: 'press-banca', library: BIBLIOTECA }), sinHistorial());
    expect(entry.sets[0]?.weight).toBe('');
    expect(entry.sets[0]?.suggested).toBe(false);
    expect(entry.sets[0]?.reps).toBe(8);
    expect(entry.basis).toBe('sin historial');
  });

  it('con historial propone el peso y lo marca como sugerido', () => {
    const entry = prefill(newEntry({ exId: 'press-banca', library: BIBLIOTECA }), sugerencia());
    expect(entry.sets.map((s) => s.weight)).toEqual([60, 60, 60, 60]);
    expect(entry.sets[0]?.suggested).toBe(true);
  });

  it('no pisa lo que ya trae la serie (peso de la rutina, reps escritas)', () => {
    const entry = newEntry({ exId: 'press-banca', library: BIBLIOTECA });
    const conDatos = setSet({ ...nuevaSesion(), entries: [entry] }, 0, 0, {
      weight: 40,
      reps: 5,
    });
    const rellenada = prefill(conDatos.entries[0], sugerencia());
    expect(rellenada.sets[0]).toMatchObject({ weight: 40, reps: 5 });
    expect(rellenada.sets[1]).toMatchObject({ weight: 60, reps: 8 });
  });
});

describe('startSession', () => {
  it('entrenamiento libre sin ejercicios', () => {
    const session = nuevaSesion({ exIds: [] });
    expect(session).toMatchObject({
      name: 'Entrenamiento libre',
      routineId: null,
      unit: 'kg',
      source: 'manual',
      dayIso: '2026-09-24',
      startedAt: '2026-09-24T10:00:00.000Z',
      notes: '',
    });
    expect(session.entries).toEqual([]);
  });

  it('con una lista de ejercicios, prellenados', () => {
    const session = nuevaSesion({ suggest: conHistorial(80) });
    expect(session.entries.map((e) => e.name)).toEqual(['Press de banca', 'Sentadilla']);
    expect(session.entries[0]?.sets[0]?.weight).toBe(80);
  });

  it('con rutina: nombre, id, peso del plan por encima del historial y notas', () => {
    const items: RoutineItem[] = [
      { exId: 'press-banca', sets: 2, weight: 50, notes: 'SUPERSERIE 1 (1/2)' },
      { exId: 'remo-mancuerna', sets: 3 },
    ];
    const session = nuevaSesion({
      exIds: undefined,
      suggest: conHistorial(80),
      routine: { id: 'rt-1', name: 'Empuje', items },
    });
    expect(session).toMatchObject({ routineId: 'rt-1', name: 'Empuje' });
    expect(session.entries[0]?.sets.map((s) => s.weight)).toEqual([50, 50]);
    expect(session.entries[0]?.sets[0]?.suggested).toBe(false);
    expect(session.entries[0]?.notes).toBe('SUPERSERIE 1 (1/2)');
    expect(session.entries[1]?.sets).toHaveLength(3);
  });

  it('con un plan del coach que solo trae el nombre, se resuelve el ejercicio', () => {
    const session = nuevaSesion({
      exIds: undefined,
      plan: [{ name: 'Press de banca', sets: 2 }, { name: 'Ejercicio inventado' }],
    });
    expect(session.entries.map((e) => e.exId)).toEqual(['press-banca']);
  });
});

/* ---------- series ---------- */

describe('editar una serie (el valor se arrastra hacia ABAJO)', () => {
  const base = nuevaSesion({ suggest: conHistorial(60) });

  it('desde la primera serie se aplica a todas las de abajo', () => {
    const next = editSetField(base, 0, 0, 'weight', 62.5);
    expect(next.entries[0]?.sets.map((s) => s.weight)).toEqual([62.5, 62.5, 62.5, 62.5]);
  });

  it('desde la tercera solo se aplica de la tercera en adelante', () => {
    const next = editSetField(base, 0, 2, 'weight', 70);
    expect(next.entries[0]?.sets.map((s) => s.weight)).toEqual([60, 60, 70, 70]);
  });

  it('las series ya marcadas no se tocan: esas ya se hicieron', () => {
    const marcada = marcar(base, 0, 1, true)!.session;
    const next = editSetField(marcada, 0, 0, 'weight', 65);
    expect(next.entries[0]?.sets.map((s) => s.weight)).toEqual([65, 60, 65, 65]);
  });

  it('el caso que fijaba el auto-test de la v1: 75/75/60/75 y después 75/80/60/80', () => {
    const marcada = marcar(base, 0, 2, true)!.session;
    const primera = editSetField(marcada, 0, 0, 'weight', 75);
    expect(primera.entries[0]?.sets.map((s) => s.weight)).toEqual([75, 75, 60, 75]);
    const segunda = editSetField(primera, 0, 1, 'weight', 80);
    expect(segunda.entries[0]?.sets.map((s) => s.weight)).toEqual([75, 80, 60, 80]);
  });

  it('nunca toca las series de arriba ni las de otros ejercicios', () => {
    const next = editSetField(base, 1, 1, 'reps', 6);
    /* se escribe la serie editada y las de abajo; la de arriba se queda como estaba */
    expect(next.entries[1]?.sets.map((s) => s.reps)).toEqual([8, 6, 6]);
    expect(next.entries[0]?.sets.map((s) => s.reps)).toEqual([8, 8, 8, 8]);
  });

  it('propagateSet solo no escribe la serie editada (por eso existe editSetField)', () => {
    const soloPropagado = propagateSet(base, 0, 0, 'weight', 62.5);
    expect(soloPropagado.entries[0]?.sets.map((s) => s.weight)).toEqual([60, 62.5, 62.5, 62.5]);
  });

  it('no arrastra el RPE', () => {
    const conRpe = setSet(base, 0, 0, { rpe: 9 });
    const next = editSetField(conRpe, 0, 0, 'weight', 50);
    expect(next.entries[0]?.sets.map((s) => s.rpe)).toEqual([9, null, null, null]);
  });

  it('no muta la sesión original', () => {
    const antes = JSON.stringify(base);
    editSetField(base, 0, 0, 'weight', 100);
    addSet(base, 0);
    expect(JSON.stringify(base)).toBe(antes);
  });
});

describe('autofillNext (marcar rellena la siguiente)', () => {
  const base = nuevaSesion({ suggest: sinHistorial });

  it('al marcar, la serie siguiente se lleva el peso y las reps', () => {
    /* solo la serie 1 tiene peso: la 2 lo hereda, la 3 y la 4 siguen vacías */
    const soloPrimera = setSet(base, 0, 0, { weight: 40 });
    const marcada = marcar(soloPrimera, 0, 0)!.session;
    expect(marcada.entries[0]?.sets.map((s) => s.weight)).toEqual([40, 40, '', '']);
    expect(marcada.entries[0]?.sets[1]).toMatchObject({ reps: 8, done: false });
  });

  it('no toca la siguiente si ya tiene peso propio o ya está marcada', () => {
    const escritas = setSet(setSet(base, 0, 0, { weight: 40 }), 0, 1, { weight: 50 });
    expect(marcar(escritas, 0, 0)!.session.entries[0]?.sets[1]?.weight).toBe(50);
    const yaHecha = marcar(setSet(base, 0, 1, { weight: 50 }), 0, 1, true)!.session;
    const conPeso = setSet(yaHecha, 0, 0, { weight: 40 });
    expect(marcar(conPeso, 0, 0)!.session.entries[0]?.sets[1]?.weight).toBe(50);
  });

  it('en la última serie no hay siguiente que rellenar', () => {
    expect(autofillNext(base, 0, 3)).toBe(base);
    const marcada = marcar(base, 0, 3)!.session;
    expect(marcada.entries[0]?.sets).toHaveLength(4);
  });

  it('desmarcar no rellena nada (ni borra lo ya heredado)', () => {
    const soloPrimera = setSet(setSet(base, 0, 0, { weight: 40 }), 0, 1, { weight: 40 });
    const marcada = marcar(soloPrimera, 0, 0)!.session;
    const limpio = marcar(marcada, 0, 0, false)!.session;
    expect(limpio.entries[0]?.sets.map((s) => s.weight)).toEqual([40, 40, '', '']);
  });
});

describe('toggleSet y la decisión de descanso', () => {
  const base = nuevaSesion();

  it('marcar una serie que no es la última descansa lo del propio ejercicio', () => {
    const res = marcar(base, 0, 0);
    expect(res?.done).toBe(true);
    expect(res?.set.ts).toBeTruthy();
    expect(res?.rest).toEqual({ action: 'start', sec: 150, label: 'Press de banca' });
  });

  it('la última serie del ejercicio descansa igual si queda otro pendiente, y anuncia el siguiente', () => {
    const primera = marcar(base, 0, 0)?.session;
    const segunda = primera ? marcar(primera, 0, 1)?.session : undefined;
    const tercera = segunda ? marcar(segunda, 0, 2)?.session : undefined;
    const ultima = tercera ? marcar(tercera, 0, 3) : undefined;
    expect(ultima?.rest).toEqual({ action: 'start', sec: 150, label: 'Sentadilla' });
    expect(nextLabel(ultima!.session, 0)).toBe('Sentadilla');
  });

  it('la última serie de la sesión NO descansa', () => {
    let session = base;
    for (const [e, s] of [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 0],
      [1, 1],
      [1, 2],
    ] as const) {
      const res = marcar(session, e, s);
      session = res!.session;
      if (e === 1 && s === 2) expect(res?.rest).toEqual({ action: 'none' });
      else expect(res?.rest.action).toBe('start');
    }
    expect(nextLabel(session, 1)).toBe('');
  });

  it('con el descanso automático apagado, marcar no arranca nada', () => {
    const res = toggleSet(base, 0, 0, {
      autoRest: false,
      restDefault: 90,
      restRunning: false,
    });
    expect(res?.rest).toEqual({ action: 'none' });
  });

  it('desmarcar cancela el descanso en curso y limpia la marca de tiempo', () => {
    const marcada = marcar(base, 0, 0)!.session;
    const res = toggleSet(marcada, 0, 0, {
      on: false,
      autoRest: true,
      restDefault: 90,
      restRunning: true,
    });
    expect(res?.rest).toEqual({ action: 'cancel' });
    expect(res?.set.ts).toBeNull();
    const sinDescanso = toggleSet(marcada, 0, 0, {
      on: false,
      autoRest: true,
      restDefault: 90,
      restRunning: false,
    });
    expect(sinDescanso?.rest).toEqual({ action: 'none' });
  });

  it('sin descanso propio en el ejercicio se usa el descanso por defecto', () => {
    const session = nuevaSesion({ exIds: ['sin-descanso'] });
    const sinDescanso = setRestSec(session, 0, 0);
    const res = toggleSet(sinDescanso, 0, 0, {
      autoRest: true,
      restDefault: 90,
      restRunning: false,
    });
    expect(res?.rest).toEqual({ action: 'start', sec: 90, label: 'sin-descanso' });
  });

  it('sin series pendientes en ninguno, el aviso no nombra nada', () => {
    const vacia = nuevaSesion({ exIds: [] });
    expect(nextLabel(vacia, 0)).toBe('');
  });

  it('un índice que no existe no rompe', () => {
    expect(marcar(base, 9, 0)).toBeNull();
    expect(marcar(base, 0, 9)).toBeNull();
  });
});

describe('series y ejercicios', () => {
  it('añadir una serie copia peso y reps de la última', () => {
    const base = nuevaSesion();
    const conPeso = propagateSet(base, 0, 0, 'weight', 55);
    const conUnaMas = addSet(conPeso, 0);
    expect(conUnaMas.entries[0]?.sets).toHaveLength(5);
    expect(conUnaMas.entries[0]?.sets[4]).toMatchObject({ weight: 55, reps: 8, done: false });
  });

  it('quitar serie no deja un ejercicio sin ninguna', () => {
    const base = nuevaSesion();
    expect(removeSet(base, 0, 0).entries[0]?.sets).toHaveLength(3);
    const entry = { ...base.entries[1], sets: [blankSet(20, 5)] };
    const unaSola = addEntry({ ...base, entries: [] }, entry);
    expect(removeSet(unaSola, 0, 0).entries[0]?.sets).toHaveLength(1);
  });

  it('reordenar solo funciona dentro de la lista', () => {
    const base = nuevaSesion();
    expect(moveEntry(base, 0, 1).entries.map((e) => e.exId)).toEqual(['sentadilla', 'press-banca']);
    expect(moveEntry(base, 0, -1).entries.map((e) => e.exId)).toEqual([
      'press-banca',
      'sentadilla',
    ]);
    expect(moveEntry(base, 9, 1)).toBe(base);
  });

  it('quitar un ejercicio deja el resto igual', () => {
    const base = nuevaSesion();
    expect(removeEntry(base, 0).entries.map((e) => e.exId)).toEqual(['sentadilla']);
  });
});

/* ---------- progreso y cierre ---------- */

describe('progress y el reloj', () => {
  it('cuenta series hechas, totales y volumen en kg', () => {
    const base = nuevaSesion({ unit: 'lb' });
    const session = marcar(editSetField(base, 0, 0, 'weight', 100), 0, 0)!.session;
    const p = progress(session);
    expect(p.done).toBe(1);
    expect(p.total).toBe(7);
    /* la sesión está en libras: el volumen se calcula igualmente en kg */
    expect(p.volume).toBeCloseTo(100 * 0.45359237 * 8, 3);
    expect(p.pct).toBeCloseTo(1 / 7, 5);
  });

  it('sin series no divide por cero', () => {
    const vacia = nuevaSesion({ exIds: [] });
    expect(progress(vacia)).toEqual({ done: 0, total: 0, pct: 0, volume: 0, sets: 0 });
  });

  it('el cronómetro sale del arranque de la sesión', () => {
    const base = nuevaSesion();
    expect(elapsedSec(base, Date.parse('2026-09-24T10:42:00.000Z'))).toBe(2520);
    expect(elapsedSec(base, Date.parse('2026-09-24T09:00:00.000Z'))).toBe(0);
  });
});

describe('finishSession', () => {
  it('guarda solo las series marcadas y tira los ejercicios sin ninguna', () => {
    const base = nuevaSesion({ suggest: conHistorial(60) });
    const marcada = marcar(base, 0, 0)!.session;
    const sesion = finishSession(marcada, { id: 's1', now: '2026-09-24T11:00:00.000Z' });
    expect(sesion?.entries).toHaveLength(1);
    expect(sesion?.entries[0]?.exId).toBe('press-banca');
    expect(sesion?.entries[0]?.sets[0]).toMatchObject({
      weight: 60,
      reps: 8,
      done: true,
      rpe: null,
    });
    expect(typeof sesion?.entries[0]?.sets[0]?.ts).toBe('string');
    expect(sesion).toMatchObject({
      id: 's1',
      name: 'Entrenamiento libre',
      date: '2026-09-24',
      unit: 'kg',
      endedAt: '2026-09-24T11:00:00.000Z',
    });
  });

  it('al guardar, un peso vacío pasa a 0 (nunca queda "sin apuntar")', () => {
    const base = nuevaSesion();
    expect(
      finishSession(marcar(base, 0, 0)!.session, { id: 's1' })?.entries[0]?.sets[0]?.weight,
    ).toBe(0);
    const conPeso = setSet(base, 0, 0, { weight: 42.5 });
    expect(
      finishSession(marcar(conPeso, 0, 0)!.session, { id: 's2' })?.entries[0]?.sets[0]?.weight,
    ).toBe(42.5);
  });

  it('el RPE medio se redondea a un decimal y es null si nadie lo apuntó', () => {
    const base = nuevaSesion();
    const conRpe = setSet(setSet(base, 0, 0, { rpe: 8 }), 0, 1, { rpe: 9 });
    const a = marcar(conRpe, 0, 0)!.session;
    const b = marcar(a, 0, 1)!.session;
    expect(finishSession(b, { id: 's1' })?.rpe).toBe(8.5);
    expect(finishSession(marcar(base, 0, 0)!.session, { id: 's2' })?.rpe).toBeNull();
  });

  it('las notas de la sesión pasan al registro (y las de la llamada mandan)', () => {
    const base = { ...nuevaSesion(), notes: 'buen día' };
    const sesion = finishSession(marcar(base, 0, 0)!.session);
    expect(sesion?.notes).toBe('buen día');
    expect(finishSession(marcar(base, 0, 0)!.session, { notes: 'otra' })?.notes).toBe('otra');
  });

  it('sin ninguna serie marcada no se guarda nada', () => {
    expect(finishSession(nuevaSesion())).toBeNull();
    expect(finishSession(nuevaSesion({ exIds: [] }))).toBeNull();
  });

  it('las notas y el descanso de cada ejercicio viajan con la sesión', () => {
    const base = nuevaSesion({ exIds: [] });
    const conNotas = addEntry(base, {
      ...newEntry({ exId: 'press-banca', library: BIBLIOTECA }),
      notes: 'al fallo',
    });
    const sesion = finishSession(marcar(conNotas, 0, 0)!.session, { id: 's1' });
    expect(sesion?.entries[0]).toMatchObject({
      notes: 'al fallo',
      restSec: 150,
      name: 'Press de banca',
    });
  });
});
