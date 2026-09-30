/**
 * La memoria editable del coach: deduplicación, recorte por límite y extracción
 * del bloque ```memoria que cierra la respuesta del modelo.
 *
 * Lo que no se puede romper: la memoria del usuario en otros encabezados se
 * conserva siempre, y por encima de `MEMORY_LIMIT` se pierden las entradas de
 * patrones MÁS ANTIGUAS, nunca el resto.
 */
import { describe, expect, it } from 'vitest';

import {
  MEMORY_HEADINGS,
  MEMORY_LIMIT,
  applyMemoryEntries,
  defaultMemory,
  extractMemoryBlock,
} from './memory';

const FENCE = (body: string): string => '```memoria\n' + body + '\n```';

describe('defaultMemory', () => {
  it('trae los cinco encabezados', () => {
    const memory = defaultMemory();
    for (const heading of MEMORY_HEADINGS) expect(memory).toContain(heading);
    expect(memory).toContain('## Qué le funciona');
  });

  it('siembra las líneas con viñeta', () => {
    const memory = defaultMemory({ profile: ['Nombre: Ana'], patterns: ['le duele la rodilla'] });
    expect(memory).toContain('- Nombre: Ana');
    expect(memory).toContain('- le duele la rodilla');
  });
});

describe('extractMemoryBlock', () => {
  it('separa el bloque del resto del texto', () => {
    const text = `Aquí va tu plan.\n\n${FENCE('- duerme 6 h los días de pierna')}`;
    const { rest, block } = extractMemoryBlock(text);
    expect(rest).toBe('Aquí va tu plan.');
    expect(block).toBe('- duerme 6 h los días de pierna');
  });

  it('con varias líneas se queda con el bloque entero', () => {
    const { rest, block } = extractMemoryBlock(`Listo.\n${FENCE('- a\n- b')}`);
    expect(rest).toBe('Listo.');
    expect(block).toBe('- a\n- b');
  });

  it('si no hay bloque devuelve el texto intacto y block null', () => {
    const text = 'Aquí va tu plan, sin bloque de memoria.';
    expect(extractMemoryBlock(text)).toEqual({ rest: text, block: null });
  });

  it('un bloque vacío cuenta como bloque ausente', () => {
    const text = 'Listo.\n```memoria\n```';
    expect(extractMemoryBlock(text).block).toBeNull();
    expect(extractMemoryBlock(text).rest).toBe('Listo.');
  });

  it('no recorta un bloque que no cierra el texto', () => {
    const text = `${FENCE('- dato')}\ny después sigue hablando`;
    expect(extractMemoryBlock(text).block).toBeNull();
  });
});

describe('applyMemoryEntries', () => {
  const memory = (): string =>
    [
      '## Perfil',
      '- Entrena por las mañanas',
      '',
      '## Preferencias',
      '- Odiaba las dominadas',
      '',
      '## Qué le funciona',
      '',
      '## Qué falla',
      '',
      '## Patrones aprendidos',
      '- prefiere press con mancuernas',
    ].join('\n');

  it('añade la entrada nueva bajo "## Patrones aprendidos"', () => {
    const { memory: next, added } = applyMemoryEntries(memory(), FENCE('- duerme poco'));
    expect(added).toEqual(['- duerme poco']);
    const patterns = next.slice(next.indexOf('## Patrones aprendidos'));
    expect(patterns).toContain('- prefiere press con mancuernas');
    expect(patterns).toContain('- duerme poco');
  });

  it('no duplica entradas ya aprendidas (normalizando mayúsculas y espacios)', () => {
    const { memory: next, added } = applyMemoryEntries(
      memory(),
      FENCE('-   Prefiere   PRESS con mancuernas \n- duerme poco'),
    );
    expect(added).toEqual(['- duerme poco']);
    expect(next.match(/press con mancuernas/gi)).toHaveLength(1);
  });

  it('nunca toca lo que el usuario escribió a mano en otros encabezados', () => {
    const { memory: next } = applyMemoryEntries(memory(), FENCE('- duerme poco'));
    expect(next).toContain('- Entrena por las mañanas');
    expect(next).toContain('- Odiaba las dominadas');
    expect(next.indexOf('## Perfil')).toBeLessThan(next.indexOf('## Patrones aprendidos'));
  });

  it('con la memoria vacía arranca de la plantilla', () => {
    const { memory: next, added } = applyMemoryEntries('', FENCE('- duerme poco'));
    for (const heading of MEMORY_HEADINGS) expect(next).toContain(heading);
    expect(added).toEqual(['- duerme poco']);
  });

  it('sin líneas de viñeta no cambia nada', () => {
    const before = memory();
    const { memory: next, added } = applyMemoryEntries(before, 'esto no son entradas');
    expect(added).toEqual([]);
    expect(next).toBe(before);
  });

  it('al pasar de MEMORY_LIMIT recorta las entradas más antiguas y conserva los encabezados', () => {
    const long = 'lo que de verdad funciona con este usuario. '.repeat(6);
    const seeded = defaultMemory({
      profile: ['Entrena por las mañanas'],
      patterns: Array.from({ length: 30 }, (_, i) => `patron ${i}: ${long}`),
    });
    expect(seeded.length).toBeGreaterThan(MEMORY_LIMIT);

    const { memory: next, added } = applyMemoryEntries(seeded, FENCE('- duerme 8 h'));
    expect(added).toEqual(['- duerme 8 h']);
    expect(next.length).toBeLessThanOrEqual(MEMORY_LIMIT);
    for (const heading of MEMORY_HEADINGS) expect(next).toContain(heading);
    expect(next).toContain('- Entrena por las mañanas');
    expect(next).toContain('- duerme 8 h');
    expect(next).toContain('patron 29');
    expect(next).not.toContain('patron 0:');
  });
});
