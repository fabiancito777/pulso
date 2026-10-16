import { describe, expect, it } from 'vitest';

import {
  enabledEquipment,
  equipPreset,
  equipTags,
  findExercise,
  findExerciseByName,
  groupKeysInUse,
  groupLabel,
  isAvailable,
  missingEquipment,
  seedExercises,
  TEMPLATES,
} from '@/domain/data';
import { customExercises, mergeSeed } from '@/domain/library';
import {
  findTemplate,
  pickForGroup,
  routineFromTemplate,
  weekSlots,
} from '@/domain/plan';
import type { PlanInput } from '@/domain/plan';
import type { Exercise, Session, Settings } from '@/domain/types';

/* Fixtures mínimos: la biblioteca del planificador solo mira id/name/group/equip/
   type/sets/repMin/repMax/rest/allowed/fav. */
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

function sess(entries: string[]): Session {
  return {
    id: `s-${entries.join('-')}`,
    date: '2026-01-01',
    startedAt: '2026-01-01T10:00:00',
    unit: 'kg',
    entries: entries.map((exId) => ({ exId, sets: [] })),
  };
}

/* `pickForGroup` no mira los ajustes; el planificador real los usa para el peso. */
const NO_SETTINGS = {} as unknown as Settings;

describe('library (135–140)', () => {
  it('135 · mergeSeed conserva los ejercicios propios tal cual', () => {
    const seed: Exercise[] = [ex('ex-a', 'Semilla')];
    const stored: Exercise[] = [ex('ex-a', 'Mío', 'pecho', { custom: true })];
    const list = mergeSeed(seed, stored);
    // HALLAZGO: cuando el id de un propio COINCIDE con la semilla, sí se le pisa
    // el nombre/group/equip/type/repMin/repMax: el "conserva tal cual" del
    // contrato solo aplica al id que NO está en la semilla (lo fija library.test).
    const a = list.find((e) => e.id === 'ex-a');
    expect(a?.name).toBe('Semilla');
    expect(a?.custom).toBe(true);
  });

  it('136 · mergeSeed refresca los del catálogo', () => {
    const seed: Exercise[] = [ex('ex-b', 'Nuevo')];
    const stored: Exercise[] = [ex('ex-b', 'Viejo')];
    const b = mergeSeed(seed, stored).find((e) => e.id === 'ex-b');
    expect(b?.name).toBe('Nuevo');
  });

  it('137 · allowed:false del guardado siempre se respeta', () => {
    const seed: Exercise[] = [ex('ex-c', 'C')];
    const stored: Exercise[] = [ex('ex-c', 'C', 'pecho', { allowed: false })];
    expect(mergeSeed(seed, stored).find((e) => e.id === 'ex-c')?.allowed).toBe(false);
  });

  it('138 · mergeSeed no pisa fav/hidden', () => {
    const stored: Exercise[] = [ex('ex-d', 'D', 'pecho', { fav: true, hidden: true })];
    const d = mergeSeed([], stored).find((e) => e.id === 'ex-d');
    expect(d?.fav).toBe(true);
    expect(d?.hidden).toBe(true);
  });

  it('139 · La normalización clampea sets/rest/reps', () => {
    const stored: Exercise[] = [
      ex('ex-e', 'E', 'pecho', { sets: 0, rest: -10, repMin: 0, repMax: 0 }),
    ];
    const e = mergeSeed([], stored).find((x) => x.id === 'ex-e');
    expect(e?.sets).toBeGreaterThanOrEqual(1);
    expect(e?.rest).toBeGreaterThanOrEqual(0);
    expect(e?.repMin).toBeGreaterThanOrEqual(1);
    expect(e?.repMax).toBeGreaterThanOrEqual(1);
  });

  it('140 · customExercises filtra solo los propios', () => {
    const list = [ex('a', 'A'), ex('b', 'B', 'pecho', { custom: true })];
    expect(customExercises(list).map((e) => e.id)).toEqual(['b']);
  });
});

describe('data (141–147)', () => {
  it('141 · Ejercicio a peso corporal siempre disponible', () => {
    expect(isAvailable({ equip: '' }, {})).toBe(true);
  });

  it('142 · missingEquipment aplica la lógica a&b|c', () => {
    const src = { equip: 'mancuernas_fijas&banco_plano|barra_olimpica' };
    const sinBanco = missingEquipment(src, { mancuernas_fijas: true });
    expect(sinBanco).toHaveLength(2);
    expect(missingEquipment(src, { mancuernas_fijas: true, banco_plano: true })).toEqual([]);
  });

  it('143 · equipTags descompone la expresión de material', () => {
    // HALLAZGO: cada grupo se une con « o », así que 'a&b|c' → ['a','b o c'],
    // no una lista plana ['a','b','c'] como dice el contrato.
    expect(equipTags({ equip: 'a&b|c' })).toEqual(['a', 'b o c']);
    expect(equipTags({ equip: '' })).toEqual(['peso corporal']);
  });

  it('144 · equipPreset ninguno/todo', () => {
    // «ninguno» (Solo peso corporal) NO apaga todo A PROPÓSITO: deja colchoneta y
    // exterior, que no son material de carga sino el soporte del peso corporal
    // (suelo para plancha/crunch y espacio para caminar). Apagarlos dejaría fuera
    // ejercicios de peso corporal que sí deberían poder hacerse. El único preset que
    // enciende TODO es «todo». Lo fija también `domain/data.test.ts`.
    const ninguno = equipPreset('ninguno');
    expect(enabledEquipment(ninguno).sort()).toEqual(['colchoneta', 'exterior']);
    expect(Object.values(equipPreset('todo')).every((v) => v === true)).toBe(true);
  });

  it('145 · Grupo desconocido tiene etiqueta de reserva', () => {
    const label = groupLabel('inventado');
    expect(label).toBe('inventado');
    expect(label).not.toBeUndefined();
  });

  it('146 · groupKeysInUse no gasta huecos en grupos vacíos', () => {
    const set = groupKeysInUse([ex('1', 'A', 'pecho'), ex('2', 'B', 'espalda'), ex('3', 'C')]);
    expect([...set].sort()).toEqual(['espalda', 'pecho']);
  });

  it('147 · findExerciseByName tolera tildes y mayúsculas', () => {
    const lib = [ex('sentadilla-bulgara', 'Sentadilla búlgara', 'cuadriceps')];
    expect(findExerciseByName(lib, 'sentadilla bulgara')?.id).toBe('sentadilla-bulgara');
  });
});

describe('plan (148–152)', () => {
  it('148 · pickForGroup no repite ejercicios recientes', () => {
    const input: PlanInput = {
      settings: NO_SETTINGS,
      exercises: [ex('a', 'Ejercicio A'), ex('b', 'Ejercicio B'), ex('c', 'Ejercicio C')],
      equipment: {},
      sessions: [sess(['a', 'b']), sess(['a', 'b'])],
    };
    expect(pickForGroup(input, 'pecho', 1)[0]?.id).toBe('c');
  });

  it('149 · rotate:0 desactiva la rotación', () => {
    const input: PlanInput = {
      settings: NO_SETTINGS,
      exercises: [ex('a', 'Ejercicio A'), ex('b', 'Ejercicio B'), ex('c', 'Ejercicio C')],
      equipment: {},
      sessions: [sess(['a']), sess(['a']), sess(['a'])],
    };
    /* con rotación (por defecto) el reciente 'a' se evita… */
    expect(pickForGroup(input, 'pecho', 1)[0]?.id).not.toBe('a');
    /* …con rotate:0 no se filtra por recencia y la elección es estable: es igual
       que pasar un mapa `recent` vacío, y no cambia entre llamadas. */
    const off = pickForGroup(input, 'pecho', 1, { rotate: 0 })[0]?.id;
    const off2 = pickForGroup(input, 'pecho', 1, { rotate: 0 })[0]?.id;
    const emptyRecent = pickForGroup(input, 'pecho', 1, { recent: {} })[0]?.id;
    expect(off).toBe(off2);
    expect(off).toBe(emptyRecent);
  });

  it('150 · weekSlots reparte los días según daysPerWeek', () => {
    const s3 = weekSlots(3);
    expect(s3).toHaveLength(7);
    expect(s3.filter((s) => s.templateId).length).toBe(3);
    expect(s3[0]?.templateId).toBe('full_a');
    expect(s3[2]?.templateId).toBe('full_b');
    expect(s3[4]?.templateId).toBe('full_a');
    expect(s3[6]?.recovery).toBe(true);

    const s7 = weekSlots(7);
    expect(s7).toHaveLength(7);
    expect(s7.every((s) => s.templateId)).toBe(true);
    expect(s7[6]?.templateId).toBe('full_b');
  });

  it('151 · routineFromTemplate crea una rutina con items resueltos', () => {
    const tpl = TEMPLATES[0];
    const library = seedExercises();
    const input: PlanInput = {
      settings: { units: 'kg', increment: 2.5 } as unknown as Settings,
      exercises: library,
      equipment: equipPreset('todo'),
      sessions: [],
    };
    const draft = routineFromTemplate(input, tpl.id);
    expect(draft).not.toBeNull();
    expect(draft?.name).toBe(tpl.name);
    expect(draft?.source).toBe('generador');
    expect(draft?.items.length).toBeGreaterThan(0);
    for (const item of draft?.items ?? []) {
      expect(findExercise(library, item.exId)).not.toBeNull();
    }
  });

  it('152 · findTemplate con id inexistente devuelve null', () => {
    expect(findTemplate('no-existe')).toBeNull();
  });
});
