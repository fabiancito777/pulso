/**
 * Timer de descanso: aquí se fijan las decisiones que en la v1 vivían en el bucle
 * cada 500 ms y solo se podían comprobar entrenando (o con el auto-test del
 * navegador). El "ahora" entra por parámetro, así que no se espera de verdad.
 */
import { describe, expect, it } from 'vitest';

import {
  addRest,
  fromPersisted,
  IDLE_REST,
  isOver,
  remainingSec,
  REST_NOTICE_TAG,
  restNoticeBody,
  restNoticeTitle,
  restView,
  startRest,
  stopRest,
  subRest,
  tickRest,
  toPersisted,
} from './rest';

const T0 = 1_700_000_000_000;

describe('start / stop', () => {
  it('arranca con el total y la hora de fin', () => {
    const r = startRest(150, 'Press de banca', T0);
    expect(r).toMatchObject({
      total: 150,
      endsAt: T0 + 150_000,
      running: true,
      label: 'Press de banca',
    });
    expect(remainingSec(r, T0)).toBe(150);
  });

  it('un descanso de 0 s (o de menos) se queda en 1 s', () => {
    expect(startRest(0, '', T0).total).toBe(1);
    expect(startRest(-5, '', T0).total).toBe(1);
    expect(startRest(undefined, '', T0).total).toBe(90);
  });

  it('parar deja el descanso limpio', () => {
    expect(stopRest()).toEqual(IDLE_REST);
    expect(remainingSec(stopRest(), T0)).toBe(0);
  });
});

describe('remaining y lo que pinta la UI', () => {
  const r = startRest(60, 'Sentadilla', T0);

  it('el tiempo restante NO se acumula: sale de la hora de fin', () => {
    /* da igual cuándo se pregunte: si el móvil estuvo bloqueado 20 s, quedan 40 */
    expect(remainingSec(r, T0 + 20_000)).toBe(40);
    expect(remainingSec(r, T0 + 60_000)).toBe(0);
    expect(remainingSec(r, T0 + 90_000)).toBe(0);
  });

  it('el anillo va de 1 a 0 y avisa cuando ya está', () => {
    expect(restView(r, T0)).toMatchObject({ left: 60, total: 60, frac: 1, over: false });
    expect(restView(r, T0 + 30_000).frac).toBeCloseTo(0.5, 5);
    expect(restView(r, T0 + 60_000)).toMatchObject({ left: 0, frac: 0, over: true });
  });

  it('sin descanso no se divide por cero', () => {
    expect(restView(IDLE_REST, T0)).toMatchObject({ left: 0, total: 1, frac: 0, over: false });
  });

  it('isOver solo con el descanso corriendo y a cero', () => {
    expect(isOver(r, T0 + 60_000)).toBe(true);
    expect(isOver(r, T0 + 30_000)).toBe(false);
    expect(isOver(IDLE_REST, T0)).toBe(false);
  });
});

describe('+15 s y −15 s', () => {
  it('en marcha, alarga el que hay', () => {
    const r = addRest(startRest(60, 'x', T0), 15, T0 + 10_000);
    expect(remainingSec(r, T0 + 10_000)).toBe(65);
    expect(r.total).toBe(65);
  });

  it('con el descanso YA terminado arranca una cuenta nueva desde ahora', () => {
    /* era el bug del botón "+15s" del aviso de "completado": sumarle a un final
       pasado lo dejaba sin efecto visible */
    const terminado = tickRest(startRest(10, 'x', T0), T0 + 10_000).state;
    const r = addRest(terminado, 15, T0 + 10_500);
    expect(r.endsAt).toBe(T0 + 10_500 + 15_000);
    expect(r.total).toBe(15);
    expect(r.running).toBe(true);
    expect(r.doneFired).toBe(false);
    expect(remainingSec(r, T0 + 10_500)).toBe(15);
  });

  it('también arranca si no había descanso', () => {
    const r = addRest(IDLE_REST, 20, T0);
    expect(remainingSec(r, T0)).toBe(20);
  });

  it('recortar no baja de 1 s', () => {
    const r = startRest(10, 'x', T0);
    expect(remainingSec(subRest(r, 15, T0 + 5_000), T0 + 5_000)).toBe(1);
  });

  it('recortar en marcha quita justo los segundos pedidos', () => {
    const r = subRest(startRest(90, 'x', T0), 15, T0);
    expect(remainingSec(r, T0)).toBe(75);
    expect(r.total).toBe(75);
  });
});

describe('tickRest (el bucle de 500 ms)', () => {
  it('no hace nada si el descanso está parado', () => {
    expect(tickRest(IDLE_REST, T0)).toEqual({
      state: IDLE_REST,
      tick: false,
      finished: false,
      closed: false,
    });
  });

  it('da un tic por segundo en los últimos 3 s, sin repetirlo', () => {
    const r = startRest(3, 'x', T0);
    /* el resto se mide en segundos REDONDEADOS (igual que la v1): 2,5 s → 3 */
    const a = tickRest(r, T0 + 200); // quedan 3
    const b = tickRest(a.state, T0 + 400); // sigue quedando 3: no repite
    const c = tickRest(b.state, T0 + 1_200); // quedan 2
    const d = tickRest(c.state, T0 + 2_200); // queda 1
    expect([a.tick, b.tick, c.tick, d.tick]).toEqual([true, false, true, true]);
    /* 3 → 2 → 1 */
    expect([a.state.lastTick, c.state.lastTick, d.state.lastTick]).toEqual([3, 2, 1]);
  });

  it('con los tics apagados no suena nada', () => {
    const r = startRest(3, 'x', T0);
    expect(tickRest(r, T0 + 500, { countdownTick: false }).tick).toBe(false);
  });

  it('el fin se dispara UNA sola vez y deja el aviso abierto', () => {
    const r = startRest(10, 'x', T0);
    const fin = tickRest(r, T0 + 10_000);
    expect(fin).toMatchObject({ finished: true, closed: false });
    expect(fin.state).toMatchObject({ running: true, doneFired: true, doneAt: T0 + 10_000 });
    const despues = tickRest(fin.state, T0 + 11_000);
    expect(despues.finished).toBe(false);
    expect(despues.state.running).toBe(true);
  });

  it('el aviso de "completado" se cierra solo a los 30 s', () => {
    const fin = tickRest(startRest(5, 'x', T0), T0 + 5_000).state;
    const pronto = tickRest(fin, T0 + 5_000 + 29_000);
    const tarde = tickRest(pronto.state, T0 + 5_000 + 31_000);
    expect(pronto.closed).toBe(false);
    expect(tarde.closed).toBe(true);
    expect(tarde.state).toMatchObject({ running: false, doneFired: false });
  });

  it('mientras el móvil está bloqueado no se pierde: al volver ya terminó', () => {
    /* el bucle no corrió en 10 minutos, pero el timestamp manda */
    const r = startRest(90, 'x', T0);
    const tarde = tickRest(r, T0 + 600_000);
    expect(tarde.finished).toBe(true);
    expect(remainingSec(tarde.state, T0 + 600_000)).toBe(0);
  });
});

describe('persistencia (mismo formato que la v1)', () => {
  it('guarda solo lo imprescindible y nada cuando está parado', () => {
    expect(toPersisted(startRest(90, 'Remo', T0))).toEqual({
      endsAt: T0 + 90_000,
      total: 90,
      label: 'Remo',
    });
    expect(toPersisted(IDLE_REST)).toBeNull();
  });

  it('al arrancar, un descanso que aún corre se recupera entero', () => {
    const r = fromPersisted({ endsAt: T0 + 90_000, total: 90, label: 'Remo' }, T0 + 30_000);
    expect(r).toMatchObject({ running: true, total: 90, label: 'Remo', doneFired: false });
    expect(remainingSec(r, T0 + 30_000)).toBe(60);
  });

  it('un descanso caducado no se resucita (la v1 borraba la clave)', () => {
    expect(fromPersisted({ endsAt: T0 + 1_000, total: 90, label: 'x' }, T0 + 60_000)).toEqual(
      IDLE_REST,
    );
    expect(fromPersisted(null, T0)).toEqual(IDLE_REST);
    expect(fromPersisted({}, T0)).toEqual(IDLE_REST);
    expect(fromPersisted('basura', T0)).toEqual(IDLE_REST);
  });
});

describe('texto del aviso', () => {
  it('nombra a dónde vas, no a dónde ibas', () => {
    expect(restNoticeBody('Press de banca')).toBe('Siguiente serie: Press de banca');
    expect(restNoticeBody('')).toBe('Siguiente serie cuando estés listo');
  });

  it('recorta los nombres larguísimos', () => {
    expect(restNoticeBody('x'.repeat(80))).toHaveLength('Siguiente serie: '.length + 40);
  });

  it('el título y la etiqueta son los de la v1 (una sola notificación viva)', () => {
    expect(restNoticeTitle).toBe('Descanso terminado');
    expect(REST_NOTICE_TAG).toBe('pulso-rest');
  });
});
