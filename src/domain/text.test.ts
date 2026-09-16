import { describe, expect, it } from 'vitest';

import { norm, similarity, slug, trunc } from './text';

describe('texto', () => {
  it('normaliza acentos, mayúsculas y signos', () => {
    expect(norm('Extensión de Cuádriceps')).toBe('extension de cuadriceps');
    expect(norm('  Press   banca  ')).toBe('press banca');
  });

  it('genera ids legibles y estables', () => {
    expect(slug('Press de banca con barra')).toBe('press-de-banca-con-barra');
    expect(slug('Extensión sobre la cabeza con mancuerna')).toBe(
      'extension-sobre-la-cabeza-con-mancuerna',
    );
    expect(slug('Fondos en paralelas (pecho)')).toBe('fondos-en-paralelas-pecho');
  });

  it('mide el parecido entre dos nombres', () => {
    expect(similarity('press de banca', 'Press de banca con barra')).toBeGreaterThan(0.8);
    /* dos de tres palabras coinciden: sirve para ordenar resultados de búsqueda */
    expect(similarity('press banca', 'Press de banca')).toBeCloseTo(0.667, 2);
    expect(similarity('sentadilla', 'curl de biceps')).toBeLessThan(0.5);
    expect(similarity('', 'algo')).toBe(0);
  });

  it('recorta textos largos', () => {
    expect(trunc('abcdef', 4)).toBe('abc…');
    expect(trunc('abc', 4)).toBe('abc');
  });
});
