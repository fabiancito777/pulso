/**
 * `domain/match.ts`: el motor ÚNICO de matching de nombres propuestos (coach IA,
 * planes guardados, repeticiones) contra la biblioteca. Los casos que hay que
 * fijar son los del informe `_specs/matcher-nombres.md` (§3, §3.1 y §6): los que
 * antes se asociaban a OTRO ejercicio (perdiendo «unilateral», «inclinado» o el
 * material) y los que antes se descartaban sin decir nada.
 *
 * No se toca `similarity()`/`norm()` (tienen sus tests): el umbral y el veto
 * viven AQUÍ.
 */
import { describe, expect, it } from 'vitest';

import {
  MATCH_THRESHOLD,
  UNILATERAL_RX,
  attrConflicts,
  exerciseAttrs,
  matchExercise,
  parseNameAttrs,
  unresolvedName,
  unresolvedNames,
} from './match';
import type { Exercise } from './types';

function ex(id: string, name: string, equip = ''): Exercise {
  return {
    id,
    name,
    group: 'pecho',
    equip,
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
  };
}

/** Biblioteca de referencia: los nombres clave de la spec, con su `equip` real. */
const BIBLIOTECA: Exercise[] = [
  ex(
    'press-de-banca-con-barra',
    'Press de banca con barra',
    'barra_olimpica&banco_plano|banco_inclinable',
  ),
  ex(
    'press-de-banca-con-mancuernas',
    'Press de banca con mancuernas',
    'mancuernas_fijas|mancuernas_ajustables&banco_plano|banco_inclinable',
  ),
  ex('press-inclinado-con-barra', 'Press inclinado con barra', 'barra_olimpica&banco_inclinable'),
  ex(
    'press-inclinado-con-mancuernas',
    'Press inclinado con mancuernas',
    'mancuernas_fijas&banco_inclinable',
  ),
  ex('remo-con-barra', 'Remo con barra', 'barra_olimpica'),
  ex(
    'remo-una-mano',
    'Remo con mancuerna a una mano',
    'mancuernas_fijas|mancuernas_ajustables&banco_plano|banco_inclinable|cajon',
  ),
  ex('sentadilla', 'Sentadilla', ''),
  ex('ext-cuadriceps', 'Extensión de cuádriceps', 'ext_cuadriceps'),
];

describe('matchExercise: exacto', () => {
  it('nombre idéntico, en otro orden de mayúsculas, con tildes o por id/slug', () => {
    for (const query of [
      'Press de banca con barra',
      'press de banca con barra',
      'Press de banca con barrá',
      'press-de-banca-con-barra',
    ]) {
      const match = matchExercise(query, BIBLIOTECA);
      expect(match.matched).toBe('exact');
      expect(match.score).toBe(1);
      expect(match.ex?.id).toBe('press-de-banca-con-barra');
      expect(match.conflict).toBeUndefined();
    }
  });

  it('el exacto NO se veta por atributos: el nombre idéntico trae los mismos', () => {
    const biblioteca = [
      ex(
        'plano-inclinado',
        'Press de banca con barra inclinado',
        'barra_olimpica&banco_inclinable',
      ),
      ex('plano', 'Press de banca con barra', 'barra_olimpica&banco_plano'),
    ];
    const match = matchExercise('Press de banca con barra inclinado', biblioteca);
    expect(match.matched).toBe('exact');
    expect(match.ex?.id).toBe('plano-inclinado');
  });
});

describe('matchExercise: fuzzy con umbral 0,85', () => {
  it('subcadena benigna y material equivalente → fuzzy', () => {
    const match = matchExercise('Press de banca con mancuerna', BIBLIOTECA);
    expect(match.matched).toBe('fuzzy');
    expect(match.score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    expect(match.ex?.name).toBe('Press de banca con mancuernas');
  });

  it('sufijo benigno («… a 30 grados») no es conflicto', () => {
    const match = matchExercise('Press inclinado con mancuernas a 30 grados', BIBLIOTECA);
    expect(match.matched).toBe('fuzzy');
    expect(match.ex?.name).toBe('Press inclinado con mancuernas');
    expect(match.conflict).toBeUndefined();
  });

  it('por debajo del umbral NO se reescribe (y se ofrece el candidato)', () => {
    const match = matchExercise('Press de banca plano', BIBLIOTECA);
    expect(match.matched).toBe('none');
    expect(match.score).toBeLessThan(MATCH_THRESHOLD);
    expect(match.conflict).toBeUndefined();
    expect(match.candidate?.name).toBe('Press de banca con barra');
  });

  it('si el MEJOR choca pero otro ≥ 0,85 no choca, gana el segundo', () => {
    const biblioteca = [
      ex('press-de-banca', 'Press de banca', 'barra_olimpica&banco_plano'),
      ex(
        'press-de-banca-con-mancuernas',
        'Press de banca con mancuernas',
        'mancuernas&banco_plano',
      ),
    ];
    const match = matchExercise('Press de banca con mancuerna', biblioteca);
    expect(match.matched).toBe('fuzzy');
    expect(match.ex?.id).toBe('press-de-banca-con-mancuernas');
  });

  it('material resuelto por el `equip`, no solo por el nombre (Floor Press)', () => {
    const biblioteca = [ex('floor-press', 'Floor Press', 'mancuernas_ajustables')];
    const match = matchExercise('Floor Press con mancuerna', biblioteca);
    expect(match.matched).toBe('fuzzy');
    expect(match.ex?.id).toBe('floor-press');
  });
});

describe('matchExercise: veto de atributos (los casos de la spec)', () => {
  it('«Press de banca con barra inclinado» NO cae en el plano', () => {
    const match = matchExercise('Press de banca con barra inclinado', BIBLIOTECA);
    expect(match.matched).toBe('none');
    expect(match.conflict).toContain('inclinado');
    expect(match.conflict).toContain('Press de banca con barra');
    expect(match.candidate?.id).toBe('press-de-banca-con-barra');
    expect(match.ex).toBeUndefined();
  });

  it('«Remo con mancuerna bilateral» NO cae en el de «a una mano»', () => {
    const biblioteca = [BIBLIOTECA[5]];
    /* lejos del umbral → simplemente no existe */
    const lejos = matchExercise('Remo con mancuerna bilateral', biblioteca);
    expect(lejos.matched).toBe('none');
    expect(lejos.conflict).toBeUndefined();
    expect(lejos.ex).toBeUndefined();

    /* y cuando el candidato está CERCA, el veto es el motivo explícito */
    const cerca = matchExercise('Remo con mancuerna a una mano bilateral', biblioteca);
    expect(cerca.matched).toBe('none');
    expect(cerca.conflict).toContain('bilateral');
    expect(cerca.score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    expect(cerca.candidate?.id).toBe('remo-una-mano');
    expect(cerca.ex).toBeUndefined();
  });

  it('«Kroc Row unilateral con mancuerna» NO cae en «Kroc Row» ni en «Remo con barra»', () => {
    const biblioteca = [
      ex('kroc-row', 'Kroc Row', 'barra_olimpica'),
      ex('remo-con-barra', 'Remo con barra', 'barra_olimpica'),
    ];
    const match = matchExercise('Kroc Row unilateral con mancuerna', biblioteca);
    expect(match.matched).toBe('none');
    expect(match.ex).toBeUndefined();
    expect(match.conflict).toContain('con mancuerna');
    expect(match.candidate?.id).toBe('kroc-row');
    expect(match.candidate?.id).not.toBe('remo-con-barra');
  });

  it('material que el `equip` no declara → conflicto', () => {
    const biblioteca = [ex('curl-barra', 'Curl de bíceps', 'barra_ez')];
    const match = matchExercise('Curl de bíceps con mancuerna', biblioteca);
    expect(match.matched).toBe('none');
    expect(match.conflict).toContain('con mancuerna');
  });

  it('un nombre sin parecido no inventa conflicto ni candidato', () => {
    const match = matchExercise('zzzqqq sin sentido', BIBLIOTECA);
    expect(match.matched).toBe('none');
    expect(match.score).toBe(0);
    expect(match.conflict).toBeUndefined();
    expect(match.candidate).toBeUndefined();
    expect(matchExercise('', BIBLIOTECA)).toEqual({ matched: 'none', score: 0 });
  });
});

describe('parseNameAttrs / attrConflicts / exerciseAttrs', () => {
  it('lee unilateral, material, inclinación, banco y suelo del nombre', () => {
    expect(parseNameAttrs('Remo unilateral con mancuerna')).toMatchObject({
      unilateral: true,
      bilateral: false,
      material: ['mancuerna'],
      inclinado: false,
      banco: false,
      suelo: false,
    });
    expect(parseNameAttrs('Press con mancuernas y banda').material).toEqual(['mancuerna', 'banda']);
    expect(parseNameAttrs('Remo de polea').material).toEqual(['polea']);
    expect(parseNameAttrs('Remo en máquina Smith').material).toEqual(['maquina']);
    expect(parseNameAttrs('Curl a dos manos')).toMatchObject({ bilateral: true });
    expect(parseNameAttrs('Extensión de cuádriceps en el suelo')).toMatchObject({
      suelo: true,
    });
    expect(parseNameAttrs('Press inclinado sobre banco')).toMatchObject({
      inclinado: true,
      banco: true,
    });
    /* «banca» es el EJERCICIO, no un banco: no cuenta como atributo */
    expect(parseNameAttrs('Press de banca').banco).toBe(false);
    expect(UNILATERAL_RX.test('kroc row')).toBe(true);
    expect(UNILATERAL_RX.test('press de banca')).toBe(false);
  });

  it('el `equip` aporta material y banco (claves del catálogo)', () => {
    const conMaterial = exerciseAttrs(
      ex('x', 'Cualquier cosa', 'barra_olimpica&banco_inclinable|polea_alta'),
    );
    expect(conMaterial.material).toContain('barra');
    expect(conMaterial.material).toContain('polea');
    expect(conMaterial.banco).toBe(true);
    expect(exerciseAttrs(ex('x', 'Cualquier cosa', 'ext_cuadriceps')).material).toEqual([
      'maquina',
    ]);
    expect(exerciseAttrs(ex('x', 'Cualquier cosa', '')).material).toEqual([]);
  });

  it('solo se veta lo que el propuesto PIDE', () => {
    const propuesto = parseNameAttrs('Press de banca');
    const conExtras = parseNameAttrs('Press de banca unilateral con mancuerna inclinado');
    expect(attrConflicts(propuesto, conExtras)).toEqual([]);
    expect(
      attrConflicts(parseNameAttrs('Press con mancuerna'), parseNameAttrs('Press con barra')),
    ).toEqual(['con mancuerna']);
    expect(
      attrConflicts(parseNameAttrs('Press bilateral'), parseNameAttrs('Press a una mano')),
    ).toEqual(['bilateral']);
    expect(attrConflicts(parseNameAttrs('Press inclinado'), parseNameAttrs('Press plano'))).toEqual(
      ['inclinado'],
    );
  });
});

describe('unresolvedName / unresolvedNames', () => {
  it('conserva el nombre ORIGINAL y traduce la razón', () => {
    const match = matchExercise('Press de banca con barra inclinado', BIBLIOTECA);
    const item = unresolvedName('Press de banca con barra inclinado', match);
    expect(item.name).toBe('Press de banca con barra inclinado');
    expect(item.reason).toContain('inclinado');
    expect(item.candidate).toEqual({
      id: 'press-de-banca-con-barra',
      name: 'Press de banca con barra',
    });

    const sinCandidato = unresolvedName(
      'Kroc Row unilateral con mancuerna',
      matchExercise('zzzqqq sin sentido', BIBLIOTECA),
    );
    expect(sinCandidato.reason).toBe('no está en tu biblioteca');
    expect(sinCandidato.candidate).toBeUndefined();
  });

  it('lista los nombres para un aviso', () => {
    expect(
      unresolvedNames([
        { name: 'Kroc Row', reason: 'x' },
        { name: 'Press con oso polar', reason: 'y' },
      ]),
    ).toBe('«Kroc Row», «Press con oso polar»');
    expect(unresolvedNames([])).toBe('');
  });
});
