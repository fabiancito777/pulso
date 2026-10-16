import { describe, expect, it } from 'vitest';

import { proposalToDraft } from '@/domain/ai-exercise';
import {
  draftFrom,
  emptyDraft,
  idFor,
  toExercise,
  validateDraft,
} from '@/domain/exercise-draft';
import type { EquipmentMap } from '@/domain/data';
import type { Exercise } from '@/domain/types';

function ex(id: string, name: string, group = 'pecho', extra: Partial<Exercise> = {}): Exercise {
  return {
    id,
    name,
    group,
    equip: '',
    type: 'aislado',
    sets: 3,
    repMin: 8,
    repMax: 12,
    rest: 90,
    allowed: true,
    custom: false,
    bw: true,
    tags: [],
    tips: '',
    ...extra,
  };
}

/* El contrato escribe `{ library, equipment, taken }`, pero la firma real es
   posicional: `proposalToDraft(proposal, library, equipment)` (el `taken` lo
   resuelve `state/exercise-create.ts`, no este módulo). */
describe('ai-exercise (153–161)', () => {
  it('153 · El grupo sale del candidato del catálogo', () => {
    const library = [
      ex('press-banca', 'Press de banca con barra', 'pecho', {
        equip: 'barra_olimpica',
        type: 'compuesto',
      }),
    ];
    const equipment: EquipmentMap = { barra_olimpica: true, mancuernas_fijas: true };
    const res = proposalToDraft({ name: 'Press de banca con mancuerna' }, library, equipment);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.info.groupSource).toBe('candidate');
      expect(res.draft.group).toBe('pecho');
    }
  });

  it('154 · Sin candidato, infiere el grupo por palabras del nombre', () => {
    const res = proposalToDraft({ name: 'Remo con mancuerna' }, [], { mancuernas_fijas: true });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.info.groupSource).toBe('keywords');
      expect(res.draft.group).toBe('espalda');
    }
  });

  it('155 · Grupo de reserva cuando nada encaja', () => {
    const res = proposalToDraft({ name: 'Zzz blorp wuzzle' }, [], {});
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.info.groupSource).toBe('fallback');
      expect(res.draft.group).not.toBe('');
      expect(res.draft.group).toBe('pecho');
    }
  });

  it('156 · Material desconocido cae a peso corporal, sin error', () => {
    const res = proposalToDraft({ name: 'Tracción rara', equip: 'material_inventado' }, [], {});
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.draft.equip).toBe('');
  });

  it('157 · Material compuesto a&b|c → primera clave activa', () => {
    const equipment: EquipmentMap = { barra_olimpica: true, banco_plano: true };
    const res = proposalToDraft(
      { name: 'Remo compuesto', equip: 'mancuernas_fijas&barra_olimpica|banco_plano' },
      [],
      equipment,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(equipment[res.draft.equip]).toBe(true);
  });

  it('158 · Material no disponible bloquea la propuesta con error', () => {
    const res = proposalToDraft(
      { name: 'Press con mancuerna', equip: 'mancuernas_fijas' },
      [],
      { mancuernas_fijas: false },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/No tienes/);
  });

  it('159 · Tipo desconocido → aislado', () => {
    const res = proposalToDraft({ name: 'Algo raro', type: 'raro' }, [], {});
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.draft.type).toBe('aislado');
      expect(res.info.notes.some((n) => n.includes('raro'))).toBe(true);
    }
  });

  it('160 · Duplicado por encima del umbral se detecta', () => {
    const library = [
      ex('press-banca', 'Press de banca con barra', 'pecho', { equip: 'barra_olimpica' }),
    ];
    const res = proposalToDraft({ name: 'Press de banca con barra' }, library, {
      barra_olimpica: true,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.info.duplicateOf).toBe('Press de banca con barra');
  });

  it('161 · groupSource refleja de dónde salió el grupo', () => {
    const proposal = proposalToDraft({ name: 'Algo', group: 'espalda' }, [], {});
    const label = proposalToDraft({ name: 'Algo', group: 'Espalda' }, [], {});
    const keywords = proposalToDraft({ name: 'Remo con barra' }, [], { barra_olimpica: true });
    const fallback = proposalToDraft({ name: 'Zzz blorp' }, [], {});
    expect(proposal.ok && proposal.info.groupSource).toBe('proposal');
    expect(label.ok && label.info.groupSource).toBe('label');
    expect(keywords.ok && keywords.info.groupSource).toBe('keywords');
    expect(fallback.ok && fallback.info.groupSource).toBe('fallback');
  });
});

describe('exercise-draft (162–168)', () => {
  it('162 · emptyDraft trae valores por defecto válidos', () => {
    const draft = emptyDraft();
    expect(draft).toMatchObject({
      name: '',
      group: 'pecho',
      equip: '',
      type: 'aislado',
      sets: 3,
      rest: 90,
      repMin: 8,
      repMax: 12,
      allowed: true,
    });
    expect(validateDraft(draft).ok).toBe(false);
    expect(validateDraft({ ...draft, name: 'Ejercicio' }).ok).toBe(true);
  });

  it('163 · validateDraft rechaza nombre vacío', () => {
    const res = validateDraft({ ...emptyDraft(), name: '   ' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.toLowerCase()).toContain('nombre');
  });

  it('164 · repMin > repMax iguala SUBIENDO repMax', () => {
    const res = validateDraft({ ...emptyDraft(), name: 'X', repMin: 12, repMax: 8 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.repMin).toBe(12);
      expect(res.value.repMax).toBe(12);
    }
  });

  it('165 · toExercise marca bw cuando no hay material', () => {
    const res = toExercise({ ...emptyDraft(), name: 'Flexiones', equip: '' }, { taken: [] });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.bw).toBe(true);
      expect(res.value.equip).toBe('');
    }
  });

  it('166 · idFor desambigua colisiones con uid', () => {
    const id = idFor('Press banca', ['press-banca']);
    expect(id).not.toBe('press-banca');
    expect(id.startsWith('ex_')).toBe(true);
    expect(idFor('Remo', [])).toBe('remo');
  });

  it('167 · draftFrom clona un ejercicio existente', () => {
    const original = ex('press-banca', 'Press de banca', 'pecho', { equip: 'barra_olimpica' });
    const draft = draftFrom(original);
    expect(draft).toMatchObject({
      name: 'Press de banca',
      group: 'pecho',
      equip: 'barra_olimpica',
      sets: 3,
      rest: 90,
      repMin: 8,
      repMax: 12,
      allowed: true,
    });
    expect(draftFrom(null)).toEqual(emptyDraft());
    expect(draftFrom(undefined)).toEqual(emptyDraft());
  });

  it('168 · validateDraft clampa sets/rest negativos', () => {
    const res = validateDraft({ ...emptyDraft(), name: 'X', sets: 0, rest: -30 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.sets).toBeGreaterThanOrEqual(1);
      expect(res.value.rest).toBeGreaterThanOrEqual(0);
    }
  });
});
