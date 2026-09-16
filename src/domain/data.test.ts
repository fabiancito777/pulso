/**
 * Integridad del catálogo. Estas comprobaciones son las que justifican tener el
 * catálogo en TypeScript: si alguien toca `data.js` en la v1 (o se regenera
 * `catalog.ts`) y queda un grupo o una pieza de material inexistente, aquí salta.
 */
import { describe, expect, it } from 'vitest';

import {
  DAY_TYPES,
  EQUIPMENT,
  GROUPS,
  SEED_EXERCISES,
  TEMPLATES,
  equipCats,
  equipLabel,
  equipPreset,
  equipTags,
  equipmentKeys,
  groupLabel,
  goalLabel,
  isAvailable,
  missingEquipment,
} from './data';
import { slug } from './text';
import type { Exercise } from './types';

const byId = (id: string): Exercise => {
  const ex = SEED_EXERCISES.find((e) => e.id === id);
  if (!ex) throw new Error(`no existe el ejercicio ${id}`);
  return ex;
};

describe('catálogo', () => {
  it('trae los grupos, el material y las plantillas de la v1', () => {
    expect(GROUPS).toHaveLength(13);
    /* 48 de la lista + 'paralelas', que la v1 inserta con splice */
    expect(EQUIPMENT).toHaveLength(49);
    expect(equipmentKeys).toContain('paralelas');
    expect(SEED_EXERCISES).toHaveLength(136);
    expect(TEMPLATES).toHaveLength(9);
    expect(DAY_TYPES).toHaveLength(4);
  });

  it('cada ejercicio apunta a un grupo y a un material que existen', () => {
    const groups = new Set(GROUPS.map((g) => g.key));
    const equip = new Set(equipmentKeys);
    for (const ex of SEED_EXERCISES) {
      expect(groups.has(ex.group), `${ex.name} → grupo ${ex.group}`).toBe(true);
      for (const key of ex.equip.split('&').flatMap((g) => g.split('|'))) {
        if (!key) continue;
        expect(equip.has(key), `${ex.name} → material ${key}`).toBe(true);
      }
    }
  });

  it('no hay ids repetidos ni rangos imposibles', () => {
    const ids = SEED_EXERCISES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const ex of SEED_EXERCISES) {
      expect(ex.id).toBe(slug(ex.name));
      expect(ex.sets, ex.name).toBeGreaterThan(0);
      expect(ex.repMin, ex.name).toBeLessThanOrEqual(ex.repMax);
      expect(ex.custom).toBe(false);
      expect(ex.allowed).toBe(true);
      /* el descanso solo es 0 en lo que se mide en minutos (cardio/movilidad) */
      if (ex.rest === 0) expect(ex.tags, ex.name).toContain('minutos');
      else expect(ex.rest, ex.name).toBeGreaterThan(0);
    }
  });

  it('las claves del catálogo son únicas', () => {
    expect(new Set(equipmentKeys).size).toBe(EQUIPMENT.length);
    expect(new Set(GROUPS.map((g) => g.key)).size).toBe(GROUPS.length);
  });

  it('las categorías de material salen una sola vez y en orden', () => {
    const cats = equipCats();
    expect(new Set(cats).size).toBe(cats.length);
    expect(cats).toContain('Barras');
    expect(cats).toContain('Cardio');
  });
});

describe('presets de equipamiento', () => {
  it('gym es todo menos las piezas excluidas', () => {
    const gym = equipPreset('gym');
    for (const key of ['trap_bar', 'barra_t', 'hack_squat', 'bosu', 'trineo']) {
      expect(gym[key], key).toBe(false);
    }
    for (const key of ['barra_olimpica', 'mancuernas_ajustables', 'polea_alta', 'paralelas']) {
      expect(gym[key], key).toBe(true);
    }
  });

  it('todo enciende el catálogo entero y ninguno lo deja casi vacío', () => {
    expect(Object.values(equipPreset('todo')).every(Boolean)).toBe(true);
    const none = equipPreset('ninguno');
    expect(Object.values(none).filter(Boolean)).toHaveLength(2);
    expect(none.colchoneta).toBe(true);
  });

  it('un preset desconocido cae a básico y solo toca claves que existen', () => {
    const raro = equipPreset('inventado');
    expect(raro).toEqual(equipPreset('basico'));
    expect(raro.mancuernas_ajustables).toBe(true);
    expect(raro.trap_bar).toBe(false);
  });
});

describe('disponibilidad', () => {
  const bench = byId('press-de-banca-con-barra');

  it('sin material, dice qué falta y de qué grupo', () => {
    expect(isAvailable(bench, {})).toBe(false);
    const missing = missingEquipment(bench, {});
    /* 'barra_olimpica & (banco_plano | banco_inclinable)' */
    expect(missing).toContain('Barra cargable');
    expect(missing).toContain('Banco plano');
    expect(missing).toContain('Banco inclinable');
  });

  it('con una de las alternativas ya se puede hacer', () => {
    const equipment = { barra_olimpica: true, banco_inclinable: true };
    expect(isAvailable(bench, equipment)).toBe(true);
    expect(missingEquipment(bench, equipment)).toEqual([]);
  });

  it('el material se lee en palabras', () => {
    expect(equipTags(bench)).toEqual(['Barra cargable', 'Banco plano o Banco inclinable']);
    expect(equipTags({ equip: '' })).toEqual(['peso corporal']);
  });

  it('los ejercicios a peso corporal están siempre disponibles', () => {
    for (const ex of SEED_EXERCISES) {
      if (ex.equip) continue;
      expect(isAvailable(ex, {}), ex.name).toBe(true);
    }
  });

  it('las etiquetas caen a la clave cuando no existe', () => {
    expect(groupLabel('pecho')).toBe('Pecho');
    expect(groupLabel('inventado')).toBe('inventado');
    expect(goalLabel('fuerza')).toBe('Fuerza');
    expect(equipLabel('barra_olimpica')).toBe('Barra cargable');
    expect(equipLabel('inventado')).toBe('inventado');
  });
});
