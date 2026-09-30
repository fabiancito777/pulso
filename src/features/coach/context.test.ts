/**
 * El bloque de contexto completo: secciones de la v1 más las dos nuevas
 * (`APRENDIZAJE DEL COACH` y `MEMORIA DEL COACH`).
 *
 * Todo se monta con fixtures y `todayIso` fijo, así que el texto es estable y
 * se puede comparar con `toContain`.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '@/domain/defaults';
import type { Exercise, RoutineItem, Session, Settings } from '@/domain/types';
import { buildContext } from './context';
import type { BuildContextParams, CoachRoutine } from './types';

const HOY = '2026-09-24';

const ejercicio = (
  id: string,
  name: string,
  group: string,
  extra: Partial<Exercise> = {},
): Exercise => ({
  id,
  name,
  group,
  equip: '',
  type: 'compuesto',
  sets: 4,
  repMin: 8,
  repMax: 12,
  rest: 180,
  allowed: true,
  custom: false,
  bw: false,
  tags: [],
  tips: '',
  ...extra,
});

const BIBLIOTECA: Exercise[] = [
  ejercicio('ex-press', 'Press de banca', 'pecho'),
  ejercicio('ex-dominadas', 'Dominadas', 'espalda', { equip: 'barra_olimpica' }),
  ejercicio('ex-maquina', 'Curl de bíceps en máquina', 'biceps', { equip: 'maquina' }),
  ejercicio('ex-veto', 'Extensiones de cuádriceps', 'cuadriceps', { allowed: false }),
];

const RUTINA: CoachRoutine = {
  id: 'rt1',
  name: 'Empuje A',
  source: 'manual',
  items: [{ exId: 'ex-press', sets: 4, repMin: 8, repMax: 12, rest: 90, weight: 85 }],
};

const SESION: Session = {
  id: 's1',
  date: '2026-09-22',
  startedAt: '2026-09-22T10:00:00.000Z',
  endedAt: '2026-09-22T11:00:00.000Z',
  unit: 'kg',
  routineId: 'rt1',
  entries: [
    {
      exId: 'ex-press',
      name: 'Press de banca',
      sets: [
        { weight: 75, reps: 6, done: true },
        { weight: 75, reps: 6, done: true },
        { weight: 75, reps: 6, done: true },
        { weight: 75, reps: 6, done: true },
      ],
    },
  ],
};

const AJUSTES: Settings = {
  ...DEFAULT_SETTINGS,
  name: 'Ana',
  ai: { ...DEFAULT_SETTINGS.ai, memory: '## Perfil\n- Prefiere entrenar por la mañana' },
};

const params = (over: Partial<BuildContextParams> = {}): BuildContextParams => ({
  settings: AJUSTES,
  sessions: [SESION],
  routines: [RUTINA],
  schedule: {
    '2026-09-21': { status: 'planned', routineId: 'rt1' },
    '2026-09-23': { status: 'rest' },
    '2026-09-24': { status: 'done' },
  },
  equipment: { barra_olimpica: true, mancuernas_ajustables: true, maquina: false },
  exercises: BIBLIOTECA,
  opts: { todayIso: HOY },
  ...over,
});

const context = (over: Partial<BuildContextParams> = {}): string => buildContext(params(over));

describe('secciones de la v1', () => {
  const text = context();

  it('monta las ocho secciones originales', () => {
    for (const section of [
      '=== PERFIL ===',
      '=== EQUIPAMIENTO ===',
      '=== EJERCICIOS PERMITIDOS (usa estos nombres exactos) ===',
      '=== HISTORIAL',
      '=== ESTADO ACTUAL ===',
      '=== RUTINAS GUARDADAS',
      '=== VOLUMEN POR SEMANA (últimas 8) ===',
      '=== PLAN SEMANAL (semana en curso, día a día) ===',
    ]) {
      expect(text).toContain(section);
    }
  });

  it('describe el perfil con la fecha inyectada', () => {
    expect(text).toContain('Fecha de hoy: 2026-09-24 (jueves)');
    expect(text).toContain('Nombre: Ana');
    expect(text).toContain('Objetivo: Hipertrofia');
    expect(text).toContain('8-12 reps');
  });

  it('lista material, discos y máximo cargable', () => {
    expect(text).toContain('Barra cargable');
    expect(text).toContain('Mancuernas ajustables');
    expect(text).toContain('Inventario de discos');
    expect(text).toContain('unidades = discos sueltos');
    expect(text).toContain('con original entre paréntesis');
    expect(text).toContain('3 kg · 16 discos');
    expect(text).toContain('Máximo cargable total');
  });

  it('separa permitidos, prohibidos y no disponibles', () => {
    expect(text).toContain('Pecho (1): Press de banca');
    expect(text).toContain('PROHIBIDOS (no los propongas): Extensiones de cuádriceps');
    expect(text).toContain('NO DISPONIBLES por falta de material: Curl de bíceps en máquina');
  });

  it('el HISTORIAL trae la plantilla entre corchetes', () => {
    expect(text).toContain('Press de banca: 75x6, 75x6, 75x6, 75x6');
    expect(text).toContain('[objetivo plantilla: 4x8-12 · descanso 90s · cumple 0/4]');
  });

  it('el ESTADO ACTUAL trae estímulos, récords y totales', () => {
    expect(text).toContain('Días desde el último estímulo');
    expect(text).toContain('- Pecho: 2 días');
    expect(text).toContain('Récords (1RM estimado): Press de banca');
    expect(text).toContain('Totales: 1 sesiones');
  });

  it('las rutinas se listan con su último uso', () => {
    expect(text).toContain('- Empuje A [manual] · última vez 22 sep 2026');
    expect(text).toContain('Press de banca 4x8-12@90s');
  });

  it('el PLAN SEMANAL pinta hecho, descanso y libre', () => {
    expect(text).toContain('- 21 sep 2026 (lun): Empuje A');
    expect(text).toContain('[DESCANSO]');
    expect(text).toContain('libre [HECHO: 0 kg]');
  });
});

describe('secciones nuevas del coach', () => {
  const text = context();

  it('aprende del histórico y lo cuenta en APRENDIZAJE DEL COACH', () => {
    expect(text).toContain('=== APRENDIZAJE DEL COACH ===');
    expect(text).toContain('Resumen:');
    expect(text).toContain('Desviaciones destacadas');
    expect(text).toContain(
      '- 2026-09-22 · Press de banca: 75 kg × 6 · objetivo 85 kg × 8-12 (por debajo)',
    );
  });

  it('mete la memoria del coach tal cual', () => {
    expect(text).toContain('=== MEMORIA DEL COACH ===');
    expect(text).toContain('- Prefiere entrenar por la mañana');
  });

  it('acepta un bloque extra al final', () => {
    expect(context({ opts: { todayIso: HOY, extra: 'DÍA DE HOY: jueves' } })).toContain(
      'DÍA DE HOY: jueves',
    );
  });
});

describe('historial consolidado y cambios de plan', () => {
  const CON_PLAN: Session = {
    ...SESION,
    id: 's2',
    date: '2026-09-23',
    routineId: null,
    plan: [{ exId: 'ex-press' }],
    entries: [
      {
        exId: 'ex-dominadas',
        name: 'Dominadas',
        sets: [{ weight: null, reps: 8, done: true }],
      },
    ],
  };

  it('incluye HISTORIAL CONSOLIDADO con una ficha por ejercicio, tras ESTADO ACTUAL', () => {
    const text = context({ sessions: [SESION, CON_PLAN] });
    expect(text).toContain('=== HISTORIAL CONSOLIDADO');
    expect(text.indexOf('=== ESTADO ACTUAL ===')).toBeLessThan(
      text.indexOf('=== HISTORIAL CONSOLIDADO'),
    );
    expect(text).toContain('Dominadas · 1 sesión · 2026-09-23→2026-09-23');
    expect(text).toContain('Press de banca · 1 sesión · 2026-09-22→2026-09-22');
    expect(text).toContain('mejor e1RM 90 kg');
    expect(text).toContain('últ3: 75×6');
  });

  it('marca en la ficha lo que cambió en plena rutina', () => {
    const text = context({ sessions: [SESION, CON_PLAN] });
    const lineas = text
      .slice(text.indexOf('=== HISTORIAL CONSOLIDADO'))
      .split('\n')
      .filter((linea) => linea.includes('[cambió:'));
    expect(lineas.some((linea) => linea.endsWith('[cambió: +Dominadas]'))).toBe(true);
    expect(lineas.some((linea) => linea.endsWith('[cambió: −Press de banca]'))).toBe(true);
  });

  it('cuenta los cambios en APRENDIZAJE DEL COACH', () => {
    const text = context({ sessions: [SESION, CON_PLAN] });
    expect(text).toContain('Cambios en plena rutina');
    expect(text).toContain('Añadiste un ejercicio no planificado: Dominadas');
    expect(text).toContain('No llegaste a: Press de banca');
  });

  it('sin cambios de plan lo dice en claro', () => {
    expect(context()).toContain(
      'Sin cambios en plena rutina (las sesiones respetaron el plan o no venían de una rutina).',
    );
  });

  it('la sección está siempre, también sin sesiones', () => {
    const text = context({ sessions: [], routines: [], schedule: {} });
    expect(text).toContain('=== HISTORIAL CONSOLIDADO');
    expect(text).toContain('Sin sesiones registradas todavía.');
  });
});

/**
 * `cumple k/n` se mide contra el rango del ITEM de la plantilla; el
 * `GOAL_REPS` del objetivo solo entra de respaldo cuando el item no trae
 * `repMin`/`repMax`. Así la línea del HISTORIAL y los avisos de
 * `APRENDIZAJE DEL COACH` no se contradicen («objetivo 6-10» + «por debajo
 * del mínimo (8)»).
 */
describe('cumple/no cumple contra el rango de la plantilla', () => {
  const rutinaDe = (item: Partial<RoutineItem>): CoachRoutine => ({
    id: 'rt-rango',
    name: 'Empuje 6-10',
    source: 'manual',
    items: [{ exId: 'ex-press', sets: 4, rest: 90, weight: 80, ...item }],
  });

  const sesionCon = (reps: number): Session => ({
    ...SESION,
    id: 's-rango',
    routineId: 'rt-rango',
    entries: [
      { exId: 'ex-press', name: 'Press de banca', sets: [{ weight: 80, reps, done: true }] },
    ],
  });

  const texto = (reps: number, item: Partial<RoutineItem> = { repMin: 6, repMax: 10 }): string =>
    context({ sessions: [sesionCon(reps)], routines: [rutinaDe(item)] });

  it('rutina 6-10 con una serie de 6 → cumple 1/1', () => {
    expect(texto(6)).toContain('[objetivo plantilla: 4x6-10 · descanso 90s · cumple 1/1]');
  });

  it('rutina 6-10 con una serie de 5 → cumple 0/1', () => {
    expect(texto(5)).toContain('[objetivo plantilla: 4x6-10 · descanso 90s · cumple 0/1]');
  });

  it('sin repMin en el item → fallback al rango del objetivo (8-12 de hipertrofia)', () => {
    expect(texto(8, {})).toContain('[objetivo plantilla: 4x8-12 · descanso 90s · cumple 1/1]');
    expect(texto(6, {})).toContain('[objetivo plantilla: 4x8-12 · descanso 90s · cumple 0/1]');
  });

  it('6 reps con plantilla 6-10 no aparece como «por debajo del mínimo» en el contexto', () => {
    const text = texto(6);
    expect(text).toContain('[objetivo plantilla: 4x6-10 · descanso 90s · cumple 1/1]');
    /* la desviación queda en `matched` y el aviso de mínimo no se dispara */
    expect(text).toContain('Sin desviaciones destacadas frente a las rutinas.');
    expect(text).not.toContain('por debajo del mínimo');
  });
});

describe('estado vacío', () => {
  const text = context({
    sessions: [],
    routines: [],
    schedule: {},
    settings: { ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai, memory: '' } },
  });

  it('no inventa datos', () => {
    expect(text).toContain('Sin sesiones registradas todavía.');
    expect(text).toContain('Sin rutinas guardadas todavía.');
    expect(text).toContain('Sin datos todavía para aprender (empieza a registrar sesiones).');
    expect(text).toContain('Sin desviaciones destacadas frente a las rutinas.');
    expect(text).toContain('(sin memoria todavía)');
  });

  it('sigue listando las secciones para que el modelo sepa qué hay', () => {
    expect(text).toContain('=== PERFIL ===');
    expect(text).toContain('=== MEMORIA DEL COACH ===');
    expect(text).not.toContain('[objetivo plantilla');
  });
});
