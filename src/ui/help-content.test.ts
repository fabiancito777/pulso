/**
 * Integridad del contenido de ayuda (`help-content.ts`, spec `help-ux.md` §5).
 *
 * Sin render y sin DOM: el texto es un módulo `.ts` puro, así que aquí se
 * comprueba la ESTRUCTURA (ids únicos, párrafos cortos, «ver también» válidos,
 * cobertura de pestañas) y la BÚSQUEDA. El id correcto de cada fila lo
 * comprueba `npm run typecheck` (`HelpId` es un union literal).
 */
import { describe, expect, it } from 'vitest';

import { TABS } from '@/app/router';

import {
  HELP,
  HELP_IDS,
  HELP_SECTIONS,
  SECTION_LABELS,
  searchHelp,
  topic,
  topicsBySection,
  type HelpSection,
} from './help-content';

describe('HELP_IDS y HELP', () => {
  it('sin ids duplicados', () => {
    expect(new Set(HELP_IDS).size).toBe(HELP_IDS.length);
  });

  it('Object.keys(HELP) ≡ HELP_IDS: ni temas huérfanos ni ids sin texto', () => {
    expect(new Set(Object.keys(HELP))).toEqual(new Set(HELP_IDS));
    expect(Object.keys(HELP)).toHaveLength(HELP_IDS.length);
  });

  it('todos los ids usan un prefijo conocido (guía o sección)', () => {
    for (const id of HELP_IDS) {
      expect(id, id).toMatch(
        /^guide$|^(flow|tab|hoy|entreno|rutinas|cal|coach|prog|opt|glossary)\./u,
      );
    }
  });
});

describe('cada tema', () => {
  it('título limpio, ≥ 1 párrafo, párrafos no vacíos y ≤ 600 caracteres', () => {
    for (const id of HELP_IDS) {
      const t = topic(id);
      expect(t.id, id).toBe(id);
      expect(t.title.length, id).toBeGreaterThan(0);
      expect(t.title, id).toBe(t.title.trim());
      expect(t.paras.length, id).toBeGreaterThanOrEqual(1);
      for (const p of t.paras) {
        expect(p.trim(), `${id}: párrafo vacío`).not.toBe('');
        expect(p.length, `${id}: párrafo > 600`).toBeLessThanOrEqual(600);
      }
    }
  });

  it('sección válida y etiqueta de sección presente', () => {
    for (const id of HELP_IDS) {
      expect(HELP_SECTIONS, id).toContain(topic(id).section);
    }
    for (const s of HELP_SECTIONS) {
      expect(SECTION_LABELS[s].length).toBeGreaterThan(0);
    }
  });

  it('«ver también» apunta a ids existentes y nunca a sí mismo', () => {
    const ids = new Set<string>(HELP_IDS);
    for (const id of HELP_IDS) {
      for (const ref of topic(id).see ?? []) {
        expect(ids.has(ref), `${id} → ${ref}`).toBe(true);
        expect(ref, `${id} se señala a sí mismo`).not.toBe(id);
      }
    }
  });
});

describe('la guía cubre la app entera', () => {
  it('cada pestaña de TABS tiene su tema tab.<key> (añadir pestaña = romper el test)', () => {
    for (const t of TABS) {
      expect(HELP_IDS, t.key).toContain(`tab.${t.key}`);
    }
  });

  it('lista dorada de ids obligatorios (evita renombres silenciosos)', () => {
    for (const id of [
      'guide',
      'opt.units',
      'opt.thinkingBudget',
      'opt.countWarmups',
      'glossary.1rm',
      'glossary.rpe',
    ]) {
      expect(HELP_IDS, id).toContain(id);
    }
  });

  it('toda opción opt.* lleva al menos un «ver también»', () => {
    const opts = HELP_IDS.filter((id) => id.startsWith('opt.'));
    expect(opts.length).toBeGreaterThanOrEqual(20);
    for (const id of opts) {
      expect(topic(id).see?.length ?? 0, id).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('secciones de la guía', () => {
  it('las 10 secciones de la spec, con etiqueta y al menos un tema', () => {
    expect(HELP_SECTIONS).toHaveLength(10);
    expect(Object.keys(SECTION_LABELS)).toEqual([...HELP_SECTIONS]);
    const groups = topicsBySection();
    for (const s of HELP_SECTIONS) {
      expect(SECTION_LABELS[s], s).not.toBe('');
      expect(groups.find((g) => g.section === s)?.topics.length ?? 0, s).toBeGreaterThan(0);
    }
  });

  it('contados por prefijo: 7 pestañas, 26 ajustes y el glosario completo', () => {
    expect(HELP_IDS.filter((id) => id.startsWith('tab.'))).toHaveLength(7);
    expect(HELP_IDS.filter((id) => id.startsWith('opt.'))).toHaveLength(26);
    /* los 13 términos de la tabla de glosario de `help-content.md` §3 */
    expect(HELP_IDS.filter((id) => id.startsWith('glossary.'))).toHaveLength(13);
  });
});

describe('búsqueda', () => {
  it('encuentra términos sin acentos ni mayúsculas', () => {
    expect(searchHelp('1rm').map((t) => t.id)).toContain('glossary.1rm');
    expect(searchHelp('VOLUMEN').map((t) => t.id)).toContain('glossary.volume');
    expect(searchHelp('descanso').map((t) => t.id).length).toBeGreaterThan(0);
  });

  it('sin nada que buscar o sin coincidencias → []', () => {
    expect(searchHelp('')).toEqual([]);
    expect(searchHelp('   ')).toEqual([]);
    expect(searchHelp('zzz')).toEqual([]);
  });
});

describe('topicsBySection', () => {
  it('devuelve todas las secciones en orden y cada tema exactamente una vez', () => {
    const groups = topicsBySection();
    const seen: HelpSection[] = groups.map((g) => g.section);
    expect(seen).toEqual([...HELP_SECTIONS]);

    const ids = groups.flatMap((g) => g.topics.map((t) => t.id));
    expect(ids).toEqual([...HELP_IDS]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
