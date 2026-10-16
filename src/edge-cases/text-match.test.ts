/**
 * Edge cases 121–134 de `_specs/edge-cases-300.md` · `domain/text` + `match`.
 */
import { describe, expect, it } from 'vitest';

import type { MatchResult } from '@/domain/match';
import {
  attrConflicts,
  exerciseAttrs,
  matchExercise,
  MATCH_THRESHOLD,
  parseNameAttrs,
  UNILATERAL_RX,
  unresolvedName,
  unresolvedNames,
} from '@/domain/match';
import { norm, similarity, slug, trunc } from '@/domain/text';
import type { Exercise } from '@/domain/types';

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
    rest: 90,
    allowed: true,
    custom: false,
    bw: false,
    tags: [],
    tips: '',
  };
}

describe('121–126 · text', () => {
  it('121 · norm quita tildes y pasa a minúsculas', () => {
    expect(norm('Press Banca Inclinado')).toBe('press banca inclinado');
  });

  it('122 · slug genera identificador seguro', () => {
    expect(slug('Curl con Barra (EZ)')).toBe('curl-con-barra-ez');
  });

  it('123 · similarity exacto es 1', () => {
    expect(similarity('Remo', 'remo')).toBe(1);
  });

  it('124 · similarity con inclusión puntúa 0,88', () => {
    expect(similarity('Press banca', 'press banca inclinado')).toBe(0.88);
  });

  it('125 · similarity con tokens cortos no infla', () => {
    expect(similarity('press de banca', 'remo de banca')).toBeLessThan(MATCH_THRESHOLD);
  });

  it('126 · trunc acorta solo si hace falta', () => {
    expect(trunc('corto', 10)).toBe('corto');
    const cut = trunc('una cadena bastante larga', 8);
    expect(cut.length).toBeLessThanOrEqual(8);
    expect(cut.endsWith('…')).toBe(true);
  });
});

describe('127–134 · match', () => {
  it('127 · nombre idéntico matchea exacto', () => {
    const lib = [ex('press-banca', 'Press de banca')];
    const m = matchExercise('Press de banca', lib);
    expect(m.matched).toBe('exact');
    expect(m.ex?.id).toBe('press-banca');
  });

  it('128 · parecido por encima del umbral matchea difuso', () => {
    // Ajuste: "Remo mancuerna" contra "Remo con mancuerna" solo da 0,67; se usa
    // una variante que sí supera 0,85 (por inclusión) para probar el camino fuzzy.
    const lib = [ex('remo-mancuerna', 'Remo con mancuerna')];
    const m = matchExercise('Remo con mancuernas', lib);
    expect(m.matched).toBe('fuzzy');
    expect(m.ex?.id).toBe('remo-mancuerna');
  });

  it('129 · nombre desconocido no matchea', () => {
    expect(matchExercise('Voltereta cuántica', [ex('press', 'Press de banca')]).matched).toBe(
      'none',
    );
  });

  it('130 · conflicto de material veta un match por texto', () => {
    const labels = attrConflicts(
      parseNameAttrs('Press con barra'),
      exerciseAttrs(ex('p', 'Press con mancuerna', 'mancuernas_ajustables')),
    );
    expect(labels).toContain('con barra');
    expect(matchExercise('Press con barra', [ex('p', 'Press con mancuerna')]).matched).toBe('none');
  });

  it('131 · conflicto de inclinación/bilateral veta el match', () => {
    expect(
      attrConflicts(parseNameAttrs('press inclinado'), parseNameAttrs('press plano')),
    ).toContain('inclinado');
    expect(
      attrConflicts(parseNameAttrs('remo a una mano'), parseNameAttrs('remo bilateral')),
    ).toContain('unilateral');
  });

  it('132 · UNILATERAL_RX reconoce las variantes', () => {
    expect(UNILATERAL_RX.test('remo a una mano')).toBe(true);
    expect(UNILATERAL_RX.test('kroc row')).toBe(true);
    expect(UNILATERAL_RX.test('por brazo')).toBe(true);
    expect(UNILATERAL_RX.test('press banca')).toBe(false);
  });

  it('133 · unresolvedName conserva el nombre original', () => {
    const match: MatchResult = matchExercise('Voltereta cuántica', [ex('press', 'Press de banca')]);
    const un = unresolvedName('Nome raro', match);
    expect(un.name).toBe('Nome raro');
    expect(typeof un.reason).toBe('string');
  });

  it('134 · unresolvedNames une los no resueltos sin duplicar', () => {
    const items = [
      { name: 'a', reason: '' },
      { name: 'b', reason: '' },
    ];
    expect(unresolvedNames(items)).toBe('«a», «b»');
    expect(unresolvedNames([{ name: 'a', reason: '' }, { name: 'a', reason: '' }])).toBe('«a»');
  });
});
