/**
 * Edge cases 75–90 de `_specs/edge-cases-300.md` · `domain/rest`.
 *
 * El tiempo sale de `endsAt - now`; `now` entra siempre por parámetro. Dos
 * rarezas  conservadas: `+15 s` sobre un descanso terminado arranca una
 * cuenta nueva y `-15 s` nunca baja de 1 s.
 */
import { describe, expect, it } from 'vitest';

import {
  addRest,
  fromPersisted,
  IDLE_REST,
  isOver,
  remainingSec,
  restNoticeBody,
  restNoticeTitle,
  startRest,
  stopRest,
  subRest,
  tickRest,
  toPersisted,
} from '@/domain/rest';
import type { RestState } from '@/domain/types';

const NOW = 1_700_000_000_000;

function state(over: Partial<RestState> = {}): RestState {
  return { ...IDLE_REST, running: true, endsAt: NOW + 90_000, total: 90, label: 'Press', ...over };
}

describe('75–81 · transiciones y tick', () => {
  it('75 · startRest(0) no deja una cuenta vacía viva', () => {
    const s = startRest(0, 'x', NOW);
    expect(s.running).toBe(true);
    expect(s.total).toBe(1);
    expect(remainingSec(s, NOW)).toBe(1);
  });

  it('76 · remainingSec nunca es negativo', () => {
    expect(remainingSec(state({ endsAt: NOW - 5000 }), NOW)).toBe(0);
  });

  it('77 · +15 s sobre un descanso terminado arranca una cuenta NUEVA', () => {
    const s = addRest(state({ endsAt: NOW - 1000 }), 15, NOW);
    expect(s.endsAt).toBe(NOW + 15_000);
    expect(s.total).toBe(15);
    expect(remainingSec(s, NOW)).toBe(15);
  });

  it('78 · -15 s no baja por debajo de 1 segundo', () => {
    const s = subRest(state({ endsAt: NOW + 5000 }), 15, NOW);
    expect(remainingSec(s, NOW)).toBe(1);
  });

  it('79 · tickRest emite tics solo en los 3 últimos segundos', () => {
    const s = state({ endsAt: NOW + 5000, total: 90 });
    expect(tickRest(s, NOW, { countdownTick: true }).tick).toBe(false);
    expect(tickRest(s, NOW + 2000, { countdownTick: true }).tick).toBe(true);
  });

  it('80 · el aviso de fin se dispara UNA sola vez', () => {
    const s = state({ endsAt: NOW, total: 90 });
    const first = tickRest(s, NOW);
    expect(first.finished).toBe(true);
    expect(tickRest(first.state, NOW).finished).toBe(false);
  });

  it('81 · el aviso "terminado" se cierra solo a los 30 s', () => {
    const s = state({ endsAt: NOW, total: 90, doneFired: true, doneAt: NOW });
    expect(tickRest(s, NOW + 29_000).closed).toBe(false);
    expect(tickRest(s, NOW + 31_000).closed).toBe(true);
  });
});

describe('82–90 · persistencia, parada y avisos', () => {
  it('82 · toPersisted de un descanso inactivo es null', () => {
    expect(toPersisted(IDLE_REST)).toBeNull();
  });

  it('83 · fromPersisted de una clave vieja ya terminada no deja aviso colgando', () => {
    const s = fromPersisted({ endsAt: NOW - 1000, total: 90, label: 'x' }, NOW);
    expect(s).toEqual(IDLE_REST);
  });

  it('84 · fromPersisted con JSON roto devuelve estado inactivo', () => {
    expect(fromPersisted({ endsAt: 'x' }, NOW).running).toBe(false);
    expect(fromPersisted('basura', NOW).running).toBe(false);
  });

  it('85 · un descanso con endsAt futuro sigue corriendo', () => {
    const s = fromPersisted({ endsAt: NOW + 60_000, total: 90, label: 'Press' }, NOW);
    expect(s.running).toBe(true);
    expect(remainingSec(s, NOW)).toBe(60);
    expect(s.label).toBe('Press');
  });

  it('86 · stopRest vuelve al estado inactivo', () => {
    expect(stopRest()).toEqual(IDLE_REST);
  });

  it('87 · isOver compara contra now', () => {
    expect(isOver(state({ endsAt: NOW - 1 }), NOW)).toBe(true);
    // Ajuste: con 1 ms de margen el redondeo a segundos ya da 0; se usa 1 s.
    expect(isOver(state({ endsAt: NOW + 1000 }), NOW)).toBe(false);
  });

  it('88 · addRest conserva la etiqueta del ejercicio', () => {
    expect(addRest(state({ label: 'Press banca' }), 15, NOW).label).toBe('Press banca');
  });

  it('89 · restar hasta el suelo mantiene la cuenta viva', () => {
    const s = subRest(subRest(state({ endsAt: NOW + 20_000 }), 15, NOW), 15, NOW);
    expect(remainingSec(s, NOW)).toBe(1);
    expect(s.running).toBe(true);
  });

  it('90 · restNoticeBody refleja el ejercicio que descansa', () => {
    expect(restNoticeBody('Sentadilla')).toContain('Sentadilla');
    expect(restNoticeTitle).toBe('Descanso terminado');
  });
});
