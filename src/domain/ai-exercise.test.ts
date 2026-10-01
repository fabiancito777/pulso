/**
 * Propuesta de ejercicio por IA → borrador validado (contrato de Fase 0,
 * spec `_specs/creacion-ejercicios-plan.md` §3.1).
 *
 * Aquí quedan fijadas las decisiones que NO se pueden cambiar sin querer:
 * - `group` desconocido se INFERE (candidato del matcher → keywords → `pecho`)
 *   y nunca se guarda un grupo que no exista en el catálogo;
 * - `equip` desconocido se corrige a `''`, lo compuesto se queda con la primera
 *   clave ACTIVA y un material que el usuario no tiene es ERROR;
 * - el matcher decide `duplicateOf` (match ≥ 0,85) y `conflict` (veto): el
 *   duplicado sale en `info` (no en `notes`) para que el que cree lo rechace.
 */
import { describe, expect, it } from 'vitest';

import { AI_EXERCISE_KEYS, AI_EXERCISE_SCHEMA, proposalToDraft } from './ai-exercise';
import type { AIExerciseProposal, ProposalDraftResult } from './ai-exercise';
import { EXERCISE_TYPES, GROUPS, equipmentKeys } from './data';
import type { EquipmentMap } from './data';
import { slug } from './text';
import type { Exercise } from './types';

function ex(name: string, group: string, equip = ''): Exercise {
  return {
    id: slug(name),
    name,
    group,
    equip,
    type: 'compuesto',
    sets: 3,
    repMin: 8,
    repMax: 12,
    rest: 90,
    allowed: true,
    custom: false,
    bw: !equip,
    tags: [],
    tips: '',
  };
}

/** Mapa de material con SOLO las claves activas (el resto queda en `false`). */
function material(...active: string[]): EquipmentMap {
  const map: EquipmentMap = {};
  for (const key of equipmentKeys) map[key] = active.includes(key);
  return map;
}

/** Desempaqueta un resultado `ok` para los tests felices (falla si no lo es). */
function draftOf(result: ProposalDraftResult): Extract<ProposalDraftResult, { ok: true }> {
  if (!result.ok) throw new Error(`esperaba un borrador y vino: ${result.error}`);
  return result;
}

describe('propuesta válida', () => {
  const proposal: AIExerciseProposal = {
    name: '  Remo unilateral con mancuerna en prono  ',
    group: 'espalda',
    equip: 'mancuernas_fijas',
    type: 'compuesto',
    sets: 4,
    rest: 100,
    repMin: 6,
    repMax: 10,
    unilateral: true,
    desc: 'Tumba el pecho en el banco y tira del codo hacia la cadera.',
  };

  it('devuelve el borrador recortado, con allowed a true y sin avisos', () => {
    const result = draftOf(proposalToDraft(proposal, [], material('mancuernas_fijas')));

    expect(result.draft).toEqual({
      name: 'Remo unilateral con mancuerna en prono',
      group: 'espalda',
      equip: 'mancuernas_fijas',
      type: 'compuesto',
      sets: 4,
      rest: 100,
      repMin: 6,
      repMax: 10,
      allowed: true,
    });
    expect(result.info).toEqual({
      groupSource: 'proposal',
      unilateral: true,
      desc: 'Tumba el pecho en el banco y tira del codo hacia la cadera.',
      notes: [],
    });
    expect(result.info.duplicateOf).toBeUndefined();
    expect(result.info.conflict).toBeUndefined();
  });

  it('los rangos los clampa validateDraft y repMax sube hasta repMin', () => {
    const result = draftOf(
      proposalToDraft(
        {
          name: 'Ejercicio con cifras disparadas',
          group: 'pecho',
          equip: '',
          type: 'compuesto',
          sets: 40,
          rest: 9000,
          repMin: 30,
          repMax: 12,
        },
        [],
        material(),
      ),
    );

    expect(result.draft).toMatchObject({ sets: 12, rest: 600, repMin: 30, repMax: 30 });
  });

  it('type desconocido cae en aislado y lo cuenta', () => {
    const result = draftOf(
      proposalToDraft(
        { name: 'Ejercicio raro', group: 'pecho', equip: '', type: 'fuerza' },
        [],
        material(),
      ),
    );

    expect(result.draft.type).toBe('aislado');
    expect(result.info.notes.join(' ')).toContain('fuerza');
  });

  it('unilateral se deduce del nombre aunque el flag venga a false', () => {
    const result = draftOf(
      proposalToDraft(
        { name: 'Kroc Row con mancuerna', group: 'espalda', equip: '', unilateral: false },
        [],
        material('mancuernas_fijas'),
      ),
    );

    expect(result.info.unilateral).toBe(true);
  });
});

describe('grupo', () => {
  it('una etiqueta se convierte en clave (y se anota)', () => {
    const result = draftOf(
      proposalToDraft(
        { name: 'Ejercicio con etiqueta', group: 'Espalda', equip: '' },
        [],
        material(),
      ),
    );

    expect(result.draft.group).toBe('espalda');
    expect(result.info.groupSource).toBe('label');
    expect(result.info.notes.join(' ')).toContain('Espalda');
  });

  it('grupo inválido → lo infiere del candidato del matcher', () => {
    const library = [ex('Remo en polea alta', 'espalda', 'polea_alta')];
    const result = draftOf(
      proposalToDraft(
        { name: 'Remo alto con polea', group: 'fuerza', equip: 'polea_alta' },
        library,
        material('polea_alta'),
      ),
    );

    expect(result.draft.group).toBe('espalda');
    expect(result.info.groupSource).toBe('candidate');
    expect(result.info.duplicateOf).toBeUndefined();
    expect(result.info.notes.join(' ')).toContain('Remo en polea alta');
  });

  it('grupo inválido y sin candidato → lo infiere por keywords del nombre', () => {
    const result = draftOf(
      proposalToDraft(
        { name: 'Curl de bíceps con bandas', group: 'loquesea', equip: 'bandas' },
        [],
        material('bandas'),
      ),
    );

    expect(result.draft.group).toBe('biceps');
    expect(result.info.groupSource).toBe('keywords');
  });

  it('grupo inválido y sin candidato ni keyword → fallback a pecho', () => {
    const result = draftOf(
      proposalToDraft(
        { name: 'Ejercicio xyz inventado', group: 'nada', equip: '' },
        [],
        material(),
      ),
    );

    expect(result.draft.group).toBe('pecho');
    expect(result.info.groupSource).toBe('fallback');
  });
});

describe('material', () => {
  it('una clave desconocida se corrige a peso corporal y se anota', () => {
    const result = draftOf(
      proposalToDraft(
        { name: 'Zancada fantasma', group: 'cuadriceps', equip: 'trapecio_magico' },
        [],
        material(),
      ),
    );

    expect(result.draft.equip).toBe('');
    expect(result.info.notes.join(' ')).toContain('desconocido');
  });

  it('una etiqueta de material se convierte en clave', () => {
    const result = draftOf(
      proposalToDraft(
        { name: 'Dominadas lastradas', group: 'espalda', equip: 'Barra de dominadas' },
        [],
        material('banco_dominadas'),
      ),
    );

    expect(result.draft.equip).toBe('banco_dominadas');
  });

  it('lo compuesto se queda con la primera clave ACTIVA', () => {
    const ambas = draftOf(
      proposalToDraft(
        {
          name: 'Press de pecho con mancuernas',
          group: 'pecho',
          equip: 'mancuernas_fijas|mancuernas_ajustables',
        },
        [],
        material('mancuernas_fijas', 'mancuernas_ajustables'),
      ),
    );
    expect(ambas.draft.equip).toBe('mancuernas_fijas');
    expect(ambas.info.notes.join(' ')).toContain('resuelto');

    const soloAjustables = draftOf(
      proposalToDraft(
        {
          name: 'Press de pecho con mancuernas',
          group: 'pecho',
          equip: 'mancuernas_fijas|mancuernas_ajustables',
        },
        [],
        material('mancuernas_ajustables'),
      ),
    );
    expect(soloAjustables.draft.equip).toBe('mancuernas_ajustables');
  });

  it('material conocido pero DESACTIVADO → la propuesta no es creable', () => {
    const result = proposalToDraft(
      { name: 'Press con barra', group: 'pecho', equip: 'barra_olimpica' },
      [],
      material('mancuernas_fijas'),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Barra cargable');
  });

  it('sin equip declarado, el material del nombre se deduce de lo ACTIVO', () => {
    const result = draftOf(
      proposalToDraft(
        { name: 'Remo con mancuerna a una mano en prono', group: 'espalda' },
        [],
        material('mancuernas_ajustables'),
      ),
    );

    expect(result.draft.equip).toBe('mancuernas_ajustables');
    expect(result.info.notes.join(' ')).toContain('deducido');
    expect(result.info.unilateral).toBe(true);
  });

  it('sin equip y sin material activo para lo que pide el nombre → error', () => {
    const result = proposalToDraft(
      { name: 'Remo con mancuerna a una mano', group: 'espalda' },
      [],
      material('bandas'),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('material');
  });
});

describe('duplicados y veto del matcher', () => {
  it('match ≥ 0,85 → duplicateOf con el nombre existente', () => {
    const library = [ex('Remo con mancuerna', 'espalda', 'mancuernas_fijas')];
    const result = draftOf(
      proposalToDraft(
        { name: 'Remo con mancuerna en prono', group: 'espalda', equip: 'mancuernas_fijas' },
        library,
        material('mancuernas_fijas'),
      ),
    );

    expect(result.info.duplicateOf).toBe('Remo con mancuerna');
    expect(result.info.notes).toEqual([]);
  });

  it('veto (conflict) NO es duplicado: solo deja el aviso en info', () => {
    const library = [ex('Press de banca con barra', 'pecho', 'barra_olimpica')];
    const result = draftOf(
      proposalToDraft(
        { name: 'Press de banca con barra inclinado', group: 'pecho', equip: 'barra_olimpica' },
        library,
        material('barra_olimpica'),
      ),
    );

    expect(result.info.duplicateOf).toBeUndefined();
    expect(result.info.conflict).toContain('inclinado');
  });

  it('nombre vacío → borrador inválido (único error de validateDraft)', () => {
    const result = proposalToDraft({ name: '   ' }, [], material());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('El nombre es obligatorio');
  });
});

describe('esquema compartido', () => {
  it('AI_EXERCISE_SCHEMA es JSON con todas las claves y con valores del catálogo', () => {
    const parsed = JSON.parse(AI_EXERCISE_SCHEMA) as Record<string, unknown>;
    for (const key of AI_EXERCISE_KEYS) expect(parsed).toHaveProperty(key);
    expect(GROUPS.map((g) => g.key)).toContain(parsed.group);
    expect(equipmentKeys).toContain(parsed.equip);
    expect(EXERCISE_TYPES).toContain(parsed.type);
  });

  it('el ejemplo del esquema se puede convertir en borrador tal cual', () => {
    const raw = JSON.parse(AI_EXERCISE_SCHEMA) as AIExerciseProposal;
    const result = draftOf(proposalToDraft(raw, [], material('mancuernas_fijas')));

    expect(result.draft).toMatchObject({
      group: 'espalda',
      equip: 'mancuernas_fijas',
      allowed: true,
    });
    expect(result.info.unilateral).toBe(true);
    expect(result.info.desc).toContain('Remo unilateral');
  });
});
