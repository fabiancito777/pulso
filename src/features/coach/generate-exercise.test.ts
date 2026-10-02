/**
 * Tests del cerebro PURO del generador de ejercicios (spec
 * `_specs/generador-ejercicios.md` §3): system prompt, montaje de la petición,
 * brief de huecos y parseo de propuestas. La red y el estado viven en
 * `state/exgen.ts` y aquí no aparecen.
 */
import { describe, expect, it } from 'vitest';

import { AI_EXERCISE_SCHEMA } from '@/domain/ai-exercise';
import { GROUPS, equipmentKeys } from '@/domain/data';
import type { Exercise, Session } from '@/domain/types';

import {
  GENERATOR_SYSTEM,
  buildGeneratorRequest,
  gapsBrief,
  parseProposals,
} from './generate-exercise';
import type { GeneratorCtx, ParseContext } from './generate-exercise';

/** Material activo de las pruebas: solo estas claves pueden llevarse en `equip`. */
const EQUIP = { mancuernas_ajustables: true, discos: true } as Record<string, boolean>;

/** Foto de la biblioteca/entrada de la petición. */
function ctx(over: Partial<GeneratorCtx> = {}): GeneratorCtx {
  return {
    material: ['Mancuernas ajustables', 'Discos / inventario de peso'],
    equipKeys: ['mancuernas_ajustables', 'discos'],
    forbidden: ['Sentadilla con barra'],
    favorites: ['Dominadas'],
    existing: ['Press de banca con barra', 'Dominadas'],
    count: 4,
    gaps: '',
    ...over,
  };
}

/** Contexto de parseo (biblioteca + material) con material activo. */
function parseCtx(
  library: readonly Exercise[] = [],
  equipment: Record<string, boolean> = EQUIP,
): ParseContext {
  return { library, equipment };
}

/** Ejercicio de biblioteca con todos los campos obligatorios. */
function ex(id: string, name: string, group: string): Exercise {
  return {
    id,
    name,
    group,
    equip: '',
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

/** Sesión mínima del historial: una fecha, unidad kg y sus entradas. */
function session(date: string, entries: Session['entries']): Session {
  return {
    id: `s-${date}`,
    date,
    startedAt: `${date}T10:00:00`,
    unit: 'kg',
    entries,
  };
}

/** JSON del modelo, envuelto como lo devuelve `json: true`. */
const wrap = (payload: unknown): string =>
  `Claro, aquí tienes:\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`\n`;

describe('GENERATOR_SYSTEM', () => {
  it('incluye el esqueleto literal de cada propuesta', () => {
    expect(GENERATOR_SYSTEM).toContain(AI_EXERCISE_SCHEMA);
  });

  it('enumera TODAS las claves de grupo (13 de la v1 + 6 añadidas a mano)', () => {
    expect(GROUPS).toHaveLength(19);
    for (const g of GROUPS) expect(GENERATOR_SYSTEM).toContain(g.key);
  });

  it('no arrastra la regla de lista cerrada del coach (aquí se INVENTA)', () => {
    expect(GENERATOR_SYSTEM).not.toContain('EXCLUSIVAMENTE');
    expect(GENERATOR_SYSTEM).toContain('ejercicios NUEVOS');
  });

  it('pide franqueza: poder no proponer nada y explicarlo en «advice»', () => {
    expect(GENERATOR_SYSTEM).toContain('SÉ SINCERO');
    expect(GENERATOR_SYSTEM).toContain('"advice"');
    expect(GENERATOR_SYSTEM).toContain('"exercises": []');
  });
});

describe('buildGeneratorRequest', () => {
  it('monta system + prompt con json:true y el cierre {"exercises":[…]}', () => {
    const req = buildGeneratorRequest('remo para dorsal', ctx());
    expect(req.json).toBe(true);
    expect(req.system).toBe(GENERATOR_SYSTEM);
    expect(req.prompt).toContain('SOLICITUD DEL USUARIO: remo para dorsal');
    expect(req.prompt).toContain('Propón hasta 4 ejercicios nuevos');
    expect(req.prompt).toContain(
      `{"exercises":[${AI_EXERCISE_SCHEMA}],"advice":"una frase corta o cadena vacía"}`,
    );
  });

  it('imprime tal cual el material que recibe (nada se le añade por su cuenta)', () => {
    const req = buildGeneratorRequest('x', ctx({ material: ['Mancuernas ajustables'] }));
    expect(req.prompt).toContain('MATERIAL DISPONIBLE: Mancuernas ajustables\n');
    expect(req.prompt).toContain('CLAVES VÁLIDAS DE "equip": mancuernas_ajustables, discos');
    expect(req.prompt).not.toContain('Banco plano');
    expect(req.prompt).not.toContain('banco_plano');
  });

  it('arrastra prohibidos, favoritos y existentes sin perder el texto del usuario', () => {
    const req = buildGeneratorRequest('algo para tríceps', ctx({ gaps: '- Hombros: sin datos' }));
    expect(req.prompt).toContain('PROHIBIDOS (no los propongas ni pareados): Sentadilla con barra');
    expect(req.prompt).toContain('FAVORITOS (estilo a imitar, no a copiar): Dominadas');
    expect(req.prompt).toContain(
      'YA EXISTEN (no copies ni variaciones cercanas): Press de banca con barra, Dominadas',
    );
    expect(req.prompt).toContain('SOLICITUD DEL USUARIO: algo para tríceps');
  });

  it('el historial viaja SIEMPRE (es la misma petición, no cuesta una llamada más)', () => {
    const con = buildGeneratorRequest('x', ctx({ gaps: '- Pecho: 0 d' })).prompt;
    expect(con).toContain('HISTORIAL Y HUECOS DEL USUARIO');
    expect(con).toContain('- Pecho: 0 d');
    /* sin brief no se cuela una sección vacía */
    expect(buildGeneratorRequest('x', ctx({ gaps: '   ' })).prompt).not.toContain(
      'HISTORIAL Y HUECOS DEL USUARIO',
    );
  });

  it('clampa el recuento (1..8, default 4 con valores rotos)', () => {
    const n = (count: number): string => {
      const req = buildGeneratorRequest('x', ctx({ count }));
      return req.prompt.match(/Propón hasta \d+ ejercicios/)?.[0] ?? '';
    };
    expect(n(4)).toBe('Propón hasta 4 ejercicios');
    expect(n(99)).toBe('Propón hasta 8 ejercicios');
    expect(n(0)).toBe('Propón hasta 4 ejercicios');
    expect(n(-3)).toBe('Propón hasta 1 ejercicios');
    expect(n(7.6)).toBe('Propón hasta 7 ejercicios');
  });

  it('una biblioteca vacía o un material sin activar no rompe la petición', () => {
    const req = buildGeneratorRequest(
      '',
      ctx({ material: [], equipKeys: [], existing: [], favorites: [], forbidden: [] }),
    );
    expect(req.prompt).toContain('MATERIAL DISPONIBLE: peso corporal (sin material activo)');
    expect(req.prompt).toContain('CLAVES VÁLIDAS DE "equip": ninguna');
    expect(req.prompt).toContain('SOLICITUD DEL USUARIO: sorpréndeme con ejercicios nuevos');
    expect(req.prompt).not.toContain('PROHIBIDOS');
    expect(req.prompt).not.toContain('FAVORITOS');
    expect(req.prompt).not.toContain('YA EXISTEN');
  });
});

describe('gapsBrief', () => {
  const label = (key: string): string => GROUPS.find((g) => g.key === key)?.label ?? key;
  const library = [
    ex('ex-press', 'Press banca', 'pecho'),
    ex('ex-remo', 'Remo con mancuerna', 'espalda'),
  ];
  const hoy = '2026-09-30';

  it('usuario nuevo (sin sesiones): lo dice claro y no inventa historial', () => {
    const brief = gapsBrief([], library, hoy);
    expect(brief).toContain('SIN HISTORIAL');
    expect(brief).toContain('no hay ninguna sesión registrada');
    expect(brief).toContain(`Su biblioteca tiene ${library.length} ejercicios`);
    expect(brief).not.toContain('Repetición');
  });

  it('con sesiones pero con una biblioteca sin ejercicios: «sin datos» en todos', () => {
    const brief = gapsBrief([session(hoy, [])], [], hoy);
    const sinDatos = brief.split('\n').filter((l) => l.endsWith(': sin datos'));
    expect(sinDatos).toHaveLength(GROUPS.length);
  });

  it('señala los grupos SIN ningún ejercicio (el hueco más claro que hay)', () => {
    const sessions = [
      session(hoy, [
        { exId: 'ex-press', group: 'pecho', sets: [{ weight: 60, reps: 5, done: true }] },
      ]),
    ];
    const brief = gapsBrief(sessions, library, hoy);
    expect(brief).toContain('SIN NINGÚN ejercicio en su biblioteca');
    expect(brief).toContain(label('cuello'));
  });

  it('suma volumen y series de 7 días, días desde el último estímulo y repetidos', () => {
    const sessions = [
      session(hoy, [
        {
          exId: 'ex-press',
          name: 'Press banca',
          group: 'pecho',
          sets: [
            { weight: 60, reps: 5, done: true },
            { weight: 60, reps: 5, done: true },
          ],
        },
      ]),
      session('2026-09-16', [
        {
          exId: 'ex-remo',
          name: 'Remo con mancuerna',
          group: 'espalda',
          sets: [{ weight: 40, reps: 8, done: true }],
        },
      ]),
    ];
    const brief = gapsBrief(sessions, library, hoy);
    expect(brief).toContain(
      `- ${label('pecho')}: 0 d desde el último estímulo · 2 series / 600 kg`,
    );
    expect(brief).toContain(
      `- ${label('espalda')}: 14 d desde el último estímulo · 0 series / 0 kg en 7 días`,
    );
    expect(brief).toContain(`- ${label('hombros')}: sin datos`);
    expect(brief).toContain('Repetición: los últimos entrenos se centran en «Press banca');
    expect(brief).toContain('«Remo con mancuerna»');
  });

  it('es determinista con la misma fecha (sin reloj)', () => {
    const sessions = [session(hoy, [{ exId: 'ex-press', group: 'pecho', sets: [] }])];
    expect(gapsBrief(sessions, library, hoy)).toBe(gapsBrief(sessions, library, hoy));
  });
});

describe('parseProposals', () => {
  it('devuelve propuestas normalizadas sin escribir nada', () => {
    const out = parseProposals(
      wrap({
        exercises: [
          {
            name: '  Remo a una mano con mancuerna en prono  ',
            group: 'espalda',
            equip: 'mancuernas_ajustables',
            type: 'compuesto',
            sets: 3,
            rest: 90,
            repMin: 8,
            repMax: 12,
            unilateral: true,
            desc: 'Tira del codo hacia la cadera.',
          },
        ],
      }),
      parseCtx(),
    );
    expect(out.parseError).toBeUndefined();
    expect(out.issues).toEqual([]);
    expect(out.proposals).toHaveLength(1);
    const p = out.proposals[0];
    expect(p.name).toBe('Remo a una mano con mancuerna en prono');
    expect(p.group).toBe('espalda');
    expect(p.equip).toBe('mancuernas_ajustables');
    expect(p.type).toBe('compuesto');
    expect(p.unilateral).toBe(true);
    expect(p.desc).toBe('Tira del codo hacia la cadera.');
    expect(p.notes).toEqual([]);
    expect(p.duplicateOf).toBeUndefined();
  });

  it('acepta también una lista suelta (sin envoltorio {"exercises"})', () => {
    const out = parseProposals(JSON.stringify([{ name: 'Plancha lateral' }]), parseCtx());
    expect(out.parseError).toBeUndefined();
    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0].group).toBe('core');
    expect(out.proposals[0].type).toBe('aislado');
    expect(out.proposals[0].equip).toBe('');
  });

  it('un grupo desconocido no tira la propuesta: se INFERE con nota', () => {
    const out = parseProposals(
      wrap({ exercises: [{ name: 'Remo con mancuerna', group: 'loquesea' }] }),
      parseCtx(),
    );
    expect(out.parseError).toBeUndefined();
    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0].group).toBe('espalda');
    expect(out.proposals[0].notes.join(' ')).toContain('Grupo inferido del nombre: «espalda»');
  });

  it('una clave de material desconocida queda como peso corporal (con aviso)', () => {
    const out = parseProposals(
      wrap({ exercises: [{ name: 'Zancada en el suelo', equip: 'teletransportador' }] }),
      parseCtx(),
    );
    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0].equip).toBe('');
    expect(out.proposals[0].notes.join(' ')).toContain('Material «teletransportador» desconocido');
  });

  it('material que NO se tiene activo → issue y FUERA (no se propone)', () => {
    const out = parseProposals(
      wrap({ exercises: [{ name: 'Prensa de piernas', equip: 'prensa' }] }),
      parseCtx(),
    );
    expect(out.proposals).toEqual([]);
    expect(out.issues[0]).toMatch(/^Prensa de piernas: No tienes «/);
  });

  it('un compuesto a&b|c se queda con la PRIMERA clave ACTIVA y lo avisa', () => {
    const both = parseProposals(
      wrap({ exercises: [{ name: 'Remo al mentón', equip: 'mancuernas_fijas&discos' }] }),
      parseCtx([], { mancuernas_fijas: true, discos: true }),
    );
    expect(both.proposals).toHaveLength(1);
    expect(both.proposals[0].equip).toBe('mancuernas_fijas');
    expect(both.proposals[0].notes.join(' ')).toContain('resuelto a');

    /* si la primera no está activa, salta a la siguiente que sí lo esté */
    const skipped = parseProposals(
      wrap({ exercises: [{ name: 'Remo al mentón', equip: 'mancuernas_fijas&discos' }] }),
      parseCtx([], { discos: true }),
    );
    expect(skipped.proposals[0].equip).toBe('discos');
    expect(skipped.proposals[0].notes.join(' ')).toContain('resuelto a');
  });

  it('unilateral se va al nombre cuando no lo lleva', () => {
    const out = parseProposals(
      wrap({ exercises: [{ name: 'Curl de bíceps con mancuerna', unilateral: true }] }),
      parseCtx(),
    );
    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0].name).toBe('Curl de bíceps con mancuerna unilateral');
    expect(out.proposals[0].notes.join(' ')).toContain('Añadido «unilateral» al nombre');
  });

  it('marcar duplicado NO descarta: se informa para que la tarjeta avise', () => {
    const library = [ex('ex-remo', 'Remo con mancuerna', 'espalda')];
    const out = parseProposals(
      wrap({ exercises: [{ name: 'Remo con mancuerna', group: 'espalda', equip: '' }] }),
      parseCtx(library),
    );
    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0].duplicateOf).toBe('Remo con mancuerna');
    expect(out.issues).toEqual([]);
  });

  it('dos propuestas repetidas en la misma tanda se quedan con la primera', () => {
    const out = parseProposals(
      wrap({ exercises: [{ name: 'Plancha lateral' }, { name: 'PLANCHA LATERAL' }] }),
      parseCtx(),
    );
    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0].name).toBe('Plancha lateral');
    expect(out.issues).toContain('«PLANCHA LATERAL»: repetido en la misma tanda, se ignora');
  });

  it('una fila que no es objeto va a issues, no rompe la tanda', () => {
    const out = parseProposals(
      wrap({ exercises: ['no soy un objeto', { name: 'Plancha lateral' }] }),
      parseCtx(),
    );
    expect(out.proposals).toHaveLength(1);
    expect(out.issues).toContain('Propuesta 1: no es un objeto con nombre');
  });

  it('JSON imposible → parseError, nunca throw', () => {
    const out = parseProposals('esto no es json', parseCtx());
    expect(out.proposals).toEqual([]);
    expect(out.parseError).toBe('no pude interpretar la respuesta');
  });

  it('JSON válido pero sin ejercicios → parseError legible', () => {
    const out = parseProposals(JSON.stringify({ nada: 1 }), parseCtx());
    expect(out.parseError).toBe('la respuesta no traía ningún ejercicio');
    expect(out.proposals).toEqual([]);
  });

  it('«advice» sin propuestas NO es un error: es franqueza', () => {
    const out = parseProposals(
      wrap({ exercises: [], advice: 'Ya cubres la espalda con Remo con Barra.' }),
      parseCtx(),
    );
    expect(out.parseError).toBeUndefined();
    expect(out.proposals).toEqual([]);
    expect(out.advice).toBe('Ya cubres la espalda con Remo con Barra.');
  });

  it('acepta una respuesta con SOLO advice (sin array de ejercicios)', () => {
    const out = parseProposals(
      wrap({ advice: 'No tienes historial para justificarlo.' }),
      parseCtx(),
    );
    expect(out.parseError).toBeUndefined();
    expect(out.advice).toBe('No tienes historial para justificarlo.');
  });

  it('el advice convive con las propuestas', () => {
    const out = parseProposals(
      wrap({ exercises: [{ name: 'Plancha lateral' }], advice: 'Ojo con el volumen de core.' }),
      parseCtx(),
    );
    expect(out.proposals).toHaveLength(1);
    expect(out.advice).toBe('Ojo con el volumen de core.');
  });
});

describe('materiales y claves del catálogo', () => {
  it('las claves que usa el prompt son claves reales de EQUIPMENT', () => {
    for (const key of ['mancuernas_ajustables', 'discos', 'mancuernas_fijas']) {
      expect(equipmentKeys).toContain(key);
    }
  });
});
