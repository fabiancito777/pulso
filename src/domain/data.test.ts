/**
 * Integridad del catálogo. Estas comprobaciones son las que justifican tener el
 * catálogo en TypeScript: si alguien toca `data.js` en la v1 (o se regenera
 * `catalog.ts`) y queda un grupo o una pieza de material inexistente, aquí salta.
 */
import { describe, expect, it } from 'vitest';

import { TEMPLATES as CATALOG_TEMPLATES } from './catalog';
import {
  DAY_TYPES,
  EQUIPMENT,
  GROUPS,
  SEED_EXERCISES,
  TEMPLATES,
  defaultEquipment,
  equipCats,
  equipLabel,
  equipPreset,
  equipPresetList,
  equipTags,
  equipmentKeys,
  findExerciseByName,
  groupLabel,
  goalLabel,
  isAvailable,
  missingEquipment,
  seedExercises,
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
    /* 13 de la v1 + 6 añadidos a mano (trapecio, lumbares, oblicuos, aductores,
       cuello, serrato): la v1 no los tenía y el generador IA sí los propone */
    expect(GROUPS).toHaveLength(19);
    /* 48 de la lista + 'paralelas', que la v1 inserta con splice */
    expect(EQUIPMENT).toHaveLength(49);
    expect(equipmentKeys).toContain('paralelas');
    expect(SEED_EXERCISES).toHaveLength(136);
    /* el catálogo generado sigue trayendo las 9 de la v1; la que usa la app es
       la de `seed.ts` (comprobada más abajo) */
    expect(CATALOG_TEMPLATES).toHaveLength(9);
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

  it('«Mi kit» es el material de quien entrena en casa, SIN banco', () => {
    const kit = equipPreset('kit');
    const activos = Object.keys(kit).filter((key) => kit[key]);
    expect(activos.sort()).toEqual([
      'banco_dominadas',
      'barra_olimpica',
      'colchoneta',
      'discos',
      'mancuernas_ajustables',
      'mancuernas_fijas',
    ]);
    /* se resuelve ANTES del fallback: si no, caería en `basico` y no valdría */
    expect(kit).not.toEqual(equipPreset('basico'));
    expect(kit.banco_plano).toBe(false);
    expect(kit.banco_inclinable).toBe(false);
  });

  it('los presets ofrecidos son 5 y todos resuelven', () => {
    const list = equipPresetList();
    expect(list).toHaveLength(5);
    expect(list.map((p) => p.key)).toEqual(['basico', 'kit', 'gym', 'todo', 'ninguno']);
    for (const preset of list) {
      expect(preset.label.length, preset.key).toBeGreaterThan(0);
      expect(preset.fullLabel.length, preset.key).toBeGreaterThan(0);
      expect(Object.values(equipPreset(preset.key)).some(Boolean), preset.key).toBe(true);
    }
  });
});

describe('semilla por defecto (lo que ve un usuario nuevo)', () => {
  /* Los 24 nombres LITERALES del encargo, en su orden. Renombrar uno cambia su
     id (`slug(name)`) y deja de cuadrar con las sesiones guardadas, así que aquí
     está el contrato: si este test salta, se cambió la app entera a propósito. */
  const NOMBRES = [
    'Encogimientos (Shrugs con barra)',
    'Remo con Barra',
    'Press de Piso con Mancuernas',
    'Sentadilla Copa (con mancuerna)',
    'Pull Over',
    'Elevación de Talones (unilateral)',
    'Curl con Barra',
    'Pullover con Mancuerna',
    'Remo Unilateral Kroc Row con Mancuerna',
    'Press Francés',
    'Rompecráneos en Suelo',
    'Zancadas',
    'Press Militar',
    'Press Militar Sentado con Mancuernas',
    'Curl de Muñeca con Mancuerna Unilateral',
    'Curl Martillo',
    'Curl de Muñeca Invertido Unilateral con Mancuerna',
    'Pájaros con Mancuernas',
    'Elevaciones Laterales',
    'Dominadas',
    'Plancha',
    'Flexiones Diamante',
    'Curl de Bíceps',
    'Pájaros',
  ];

  it('son exactamente esos 24 ejercicios (y 7 plantillas)', () => {
    expect(seedExercises().map((e) => e.name)).toEqual(NOMBRES);
    expect(TEMPLATES).toHaveLength(7);
    /* `Floor Press` era un alias de Press de Piso con Mancuernas: ya no existe
       como ejercicio aparte */
    expect(TEMPLATES.map((t) => t.id)).not.toContain('hiit');
    expect(TEMPLATES.map((t) => t.id)).not.toContain('mobility');
  });

  it('sin ids repetidos, con datos imposibles y apuntando a grupo/material real', () => {
    const semilla = seedExercises();
    const ids = semilla.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);

    const groups = new Set(GROUPS.map((g) => g.key));
    const equip = new Set(equipmentKeys);
    for (const ex of semilla) {
      expect(ex.id, ex.name).toBe(slug(ex.name));
      expect(ex.custom, ex.name).toBe(false);
      expect(ex.allowed, ex.name).toBe(true);
      expect(ex.sets, ex.name).toBeGreaterThan(0);
      expect(ex.repMin, ex.name).toBeLessThanOrEqual(ex.repMax);
      if (ex.rest === 0) expect(ex.tags, ex.name).toContain('minutos');
      else expect(ex.rest, ex.name).toBeGreaterThan(0);
      expect(groups.has(ex.group), `${ex.name} → grupo ${ex.group}`).toBe(true);
      for (const key of ex.equip.split('&').flatMap((g) => g.split('|'))) {
        if (!key) continue;
        expect(equip.has(key), `${ex.name} → material ${key}`).toBe(true);
      }
    }
  });

  it('está TODO disponible con el material de fábrica', () => {
    const stock = defaultEquipment();
    for (const ex of seedExercises()) {
      expect(isAvailable(ex, stock), ex.name).toBe(true);
      expect(missingEquipment(ex, stock), ex.name).toEqual([]);
    }
    /* y sin material de golpe solo quedan los de peso corporal */
    const sinNada = seedExercises().filter((ex) => isAvailable(ex, {}));
    expect(sinNada.every((ex) => ex.bw)).toBe(true);
    expect(sinNada.length).toBeGreaterThanOrEqual(2);
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

describe('búsqueda por nombre', () => {
  const custom: Exercise = {
    ...byId('press-de-banca-con-barra'),
    id: 'mi-ejercicio',
    name: 'Mi ejercicio raro',
    custom: true,
  };
  const library = [...SEED_EXERCISES, custom];

  it('da igual cómo lo escriba el modelo: acentos, mayúsculas y espacios', () => {
    expect(findExerciseByName(library, 'press de banca con barra')?.id).toBe(
      'press-de-banca-con-barra',
    );
    expect(findExerciseByName(library, '  Extensión   de cuádriceps ')?.id).toBe(
      'extension-de-cuadriceps',
    );
  });

  it('encuentra también lo que no se llama igual que su id (slug ocupado)', () => {
    expect(findExerciseByName(library, 'Mi ejercicio raro')?.id).toBe('mi-ejercicio');
  });

  it('sin nombre o sin coincidencia devuelve null', () => {
    expect(findExerciseByName(library, '')).toBeNull();
    expect(findExerciseByName(library, undefined)).toBeNull();
    expect(findExerciseByName(library, 'ejercicio que no existe')).toBeNull();
  });
});
