import { describe, expect, it } from 'vitest';

import { idFor } from './exercise-draft';
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

  it('un nombre con HTML no inyecta etiquetas en el id', () => {
    const name = '<img src=x onerror=alert(1)>';
    const s = slug(name);
    expect(s).not.toContain('<');
    expect(s).not.toContain('>');
    expect(s).toMatch(/^[a-z0-9-]+$/);
    expect(idFor(name, [])).toBe(s);
  });

  it('los emojis no rompen el id (y uno solo cae a un id genérico)', () => {
    expect(slug('Curl 💪 de bíceps')).toBe('curl-de-biceps');
    expect(idFor('Curl 💪 de bíceps', [])).toBe('curl-de-biceps');
    expect(idFor('💪', [])).toMatch(/^ex_/);
  });

  it('mide el parecido entre dos nombres', () => {
    expect(similarity('press de banca', 'Press de banca con barra')).toBeGreaterThan(0.8);
    /* dos de tres palabras coinciden: sirve para ordenar resultados de búsqueda */
    expect(similarity('press banca', 'Press de banca')).toBeCloseTo(0.667, 2);
    expect(similarity('sentadilla', 'curl de biceps')).toBeLessThan(0.5);
    expect(similarity('', 'algo')).toBe(0);
  });

  it('una subcadena diminuta no dispara el atajo de contención', () => {
    expect(similarity('a', 'press de banca')).toBe(0);
    expect(similarity('ab', 'abdominales')).toBe(0);
    /* las palabras de verdad sí siguen contando como contención */
    expect(similarity('press de banca', 'Press de banca con barra')).toBe(0.88);
  });

  it('recorta textos largos', () => {
    expect(trunc('abcdef', 4)).toBe('abc…');
    expect(trunc('abc', 4)).toBe('abc');
  });
});
