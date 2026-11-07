/**
 * `ui/session-done-helpers.ts`: el resumen que se enseña al terminar una sesión.
 *
 * Lo que se fija aquí es lo que el usuario comprueba de un vistazo («¿se guardó?
 * ¿mejoré?»), así que las trampas tienen que quedar claras:
 *
 * - la comparación es con la sesión ANTERIOR por fecha, no con la media, y no
 *   existe cuando no hay anterior (no se compara contra cero);
 * - el récord compara contra lo ESTRICTAMENTE anterior: repetir el mismo peso no
 *   es récord, y dos sesiones del mismo día no se comparan entre sí;
 * - la racha incluye la sesión recién guardada.
 */
import { describe, expect, it } from 'vitest';

import type { Session, SessionEntry, SetLog, Unit } from '@/domain/types';

import { ICONS } from './icons';
import { sessionDoneSummary } from './session-done-helpers';

/** Iconos que pinta `SessionDoneSheet`; si uno no existe, sale un hueco mudo. */
const SHEET_ICONS = ['check', 'fire'];

const HOY = '2026-09-24';

const serie = (weight: number | null, reps: number, done = true): SetLog => ({
  weight,
  reps,
  done,
  rpe: null,
});

const entrada = (exId: string, sets: SetLog[]): SessionEntry => ({ exId, sets });

function sesion(
  id: string,
  date: string,
  entries: SessionEntry[],
  opts: { unit?: Unit; name?: string; endedAt?: string } = {},
): Session {
  return {
    id,
    name: opts.name ?? `Sesión ${id}`,
    date,
    startedAt: `${date}T10:00:00.000Z`,
    endedAt: opts.endedAt ?? `${date}T11:00:00.000Z`,
    unit: opts.unit ?? 'kg',
    entries,
  };
}

describe('iconos de la hoja', () => {
  it('todos los iconos que usa SessionDoneSheet existen en el catálogo', () => {
    for (const name of SHEET_ICONS) expect(ICONS[name], name).toBeDefined();
  });
});

describe('sessionDoneSummary', () => {
  it('cuenta volumen, series, ejercicios y duración de la sesión guardada', () => {
    const current = sesion('s2', HOY, [
      entrada('press', [serie(80, 6), serie(80, 5)]),
      entrada('remo', [serie(60, 8)]),
    ]);

    const out = sessionDoneSummary(current, [current], HOY);

    expect(out.volume).toBe(80 * 6 + 80 * 5 + 60 * 8);
    expect(out.sets).toBe(3);
    expect(out.exercises).toBe(2);
    expect(out.duration).toBe(3_600_000);
  });

  it('compara el volumen con la sesión ANTERIOR por fecha', () => {
    const previa = sesion('s1', '2026-09-22', [entrada('press', [serie(80, 5)])]);
    const current = sesion('s2', HOY, [entrada('press', [serie(80, 6)])]);

    const out = sessionDoneSummary(current, [previa, current], HOY);

    expect(out.delta).toBe(80 * 6 - 80 * 5);
    expect(out.previousName).toBe('Sesión s1');
    expect(out.previousDate).toBe('2026-09-22');
  });

  it('sin sesión anterior no inventa comparación', () => {
    const current = sesion('s1', HOY, [entrada('press', [serie(80, 6)])]);

    const out = sessionDoneSummary(current, [current], HOY);

    expect(out.delta).toBeNull();
    expect(out.previousName).toBeNull();
    expect(out.previousDate).toBeNull();
  });

  it('no se compara consigo misma ni con sesiones posteriores', () => {
    const current = sesion('s2', HOY, [entrada('press', [serie(80, 6)])]);
    const futura = sesion('s3', '2026-09-30', [entrada('press', [serie(90, 6)])]);

    const out = sessionDoneSummary(current, [current, futura], HOY);

    expect(out.previousName).toBeNull();
    expect(out.delta).toBeNull();
  });

  it('a igual fecha, la anterior es la que terminó más tarde', () => {
    const pronto = sesion('a', HOY, [entrada('press', [serie(60, 5)])], {
      name: 'Mañana',
      endedAt: `${HOY}T11:00:00.000Z`,
    });
    const tarde = sesion('b', HOY, [entrada('press', [serie(70, 5)])], {
      name: 'Tarde',
      endedAt: `${HOY}T20:00:00.000Z`,
    });
    const current = sesion('c', HOY, [entrada('press', [serie(80, 5)])], {
      name: 'Noche',
      endedAt: `${HOY}T23:00:00.000Z`,
    });

    const out = sessionDoneSummary(current, [pronto, tarde, current], HOY);

    expect(out.previousName).toBe('Tarde');
    expect(out.delta).toBe(80 * 5 - 70 * 5);
  });

  it('detecta el récord nuevo y no cuenta repetir el mismo peso', () => {
    const previa = sesion('s1', '2026-09-22', [entrada('press', [serie(80, 6)])]);
    const mejor = sesion('s2', HOY, [entrada('press', [serie(85, 6)])]);
    const igual = sesion('s3', '2026-09-26', [entrada('press', [serie(85, 6)])]);

    expect(sessionDoneSummary(mejor, [previa, mejor], HOY).records).toHaveLength(1);
    expect(sessionDoneSummary(igual, [previa, mejor, igual], '2026-09-26').records).toEqual([]);
  });

  it('dos sesiones del mismo día no se comparan entre sí para el récord', () => {
    const manana = sesion('a', HOY, [entrada('press', [serie(70, 5)])], {
      endedAt: `${HOY}T11:00:00.000Z`,
    });
    const tarde = sesion('b', HOY, [entrada('press', [serie(90, 5)])], {
      endedAt: `${HOY}T20:00:00.000Z`,
    });

    /* la de la tarde también es "récord" porque la de la mañana es del MISMO día */
    expect(sessionDoneSummary(tarde, [manana, tarde], HOY).records).toHaveLength(1);
  });

  it('la racha incluye la sesión recién guardada', () => {
    const ayer = sesion('s1', '2026-09-23', [entrada('press', [serie(80, 5)])]);
    const current = sesion('s2', HOY, [entrada('press', [serie(80, 6)])]);

    expect(sessionDoneSummary(current, [ayer, current], HOY).streak).toBe(2);
  });

  it('una sesión en lb compara en kg, no en libras', () => {
    const previa = sesion('s1', '2026-09-22', [entrada('press', [serie(175, 5)])], {
      unit: 'lb',
    });
    const current = sesion('s2', HOY, [entrada('press', [serie(185, 5)])], { unit: 'lb' });

    const out = sessionDoneSummary(current, [previa, current], HOY);

    /* 185 lb ≈ 83,9 kg y 175 lb ≈ 79,4 kg: la diferencia se mide en kg */
    expect(out.volume).toBeCloseTo(185 * 5 * 0.45359237, 5);
    expect(out.delta).toBeCloseTo((185 - 175) * 5 * 0.45359237, 5);
  });
});
