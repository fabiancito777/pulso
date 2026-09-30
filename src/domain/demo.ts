/**
 * Datos de ejemplo: 8 semanas de sesiones ficticias para ver gráficos,
 * rachas y récords con contenido antes de haber entrenado nada.
 *
 * Port puro de `S.demoData` (`legacy/js/store.js` 711-755): aquí NO hay estado
 * (ni `localStorage`, ni signals) — ajustes, biblioteca, material e historial
 * entran por parámetro y el store es quien los persiste con
 * lectura-modificación-escritura.
 *
 * Datos CLAVADOS de la v1, que es lo que hace que las gráficas de ejemplo
 * salgan iguales en las dos ramas:
 * - patrón `dowPlan = [0, 2, 4, 5]` (lun/mié/vie/sáb) desde `startOfWeek(hoy)`,
 *   con 3 o 4 sesiones por semana (`3 + hashNum('d'+w) % 2`);
 * - plantilla `RECIPES[(w * 3 + k) % 7]` de las 7 recetas de la v1;
 * - SIN fechas futuras: los días de la semana en curso que aún no llegaron se
 *   saltan (`iso > hoy`);
 * - peso base 40/16 kg + `hashNum(id) % 24`, con progresión
 *   `1 + 0.015 * (weeks - w)` redondeado a 0,5 en la unidad de los ajustes;
 * - reps dentro de `repMin..repMax` (a peso corporal, 10-17);
 * - sesión con `source: 'demo'`, `demo: true`, `rpe: 7`, 18:00Z y 48-72 min.
 *
 * Ojo, dos cosas que la v1 hacía a propósito y aquí se conservan: NO deduplica
 * (dos clics = sesiones dobles) y las sesiones de ejemplo van al MISMO array
 * que las reales, así que la analítica no las filtra.
 */
import { addDays, startOfWeek } from './dates';
import { DEFAULT_SETTINGS } from './defaults';
import { int, uid } from './num';
import { pickForGroup } from './plan';
import type { PlanInput } from './plan';
import { fromKg, toKg } from './units';
import type { EquipmentMap } from './data';
import type { Exercise, RoutineTemplate, Session, SessionEntry, SetLog, Unit } from './types';

export interface DemoOptions {
  /** semanas hacia atrás (8 en la v1) */
  weeks: number;
  /** unidad en la que se guardan los pesos de las sesiones */
  unit: Unit;
  /** biblioteca ya fusionada: de aquí salen los ejercicios elegidos */
  exercises: readonly Exercise[];
  /** material activo: sin él solo se eligen ejercicios de peso corporal */
  equipment: EquipmentMap;
  /**
   * historial previo. Va además de `exercises`/`equipment` porque
   * `pickForGroup` rota y desempata por familiaridad con él (la v1 leía
   * `state.sessions` creciente: aquí se le van añadiendo las creadas).
   */
  sessions: readonly Session[];
  /** último día permitido (`YYYY-MM-DD`): los ejemplos nunca son futuros */
  todayIso: string;
  /** recetas del catálogo (`TEMPLATES`): la v1 usaba 7 de las suyas */
  templates: readonly RoutineTemplate[];
}

/** Recetas de la v1, en el mismo orden: de ahí sale `RECIPES[(w * 3 + k) % 7]`. */
const RECIPES = ['full_a', 'full_b', 'push', 'pull', 'legs', 'upper', 'lower'] as const;

/** lun / mié / vie / sáb, medidos desde el lunes de `startOfWeek`. */
const DOW_PLAN = [0, 2, 4, 5] as const;

/** Hash determinista de la v1 (`U` no lo traía, vivía dentro de `S.demoData`). */
function hashNum(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 100000;
  return h;
}

/**
 * Series de un ejercicio de ejemplo: 4 si es compuesto y 3 si no, con el peso
 * progresivo y reps dentro del rango de la biblioteca (misma fórmula que la v1,
 * redondeada a 0,5 en la unidad pedida).
 */
function demoSets(ex: Exercise, w: number, weeks: number, date: string, unit: Unit): SetLog[] {
  const base = ex.bw ? 0 : (ex.type === 'compuesto' ? 40 : 16) + (hashNum(ex.id) % 24);
  const prog = 1 + 0.015 * (weeks - w);
  const weight = ex.bw ? 0 : Math.round(fromKg(toKg(base, 'kg') * prog, unit) * 2) / 2;
  const total = ex.type === 'compuesto' ? 4 : 3;
  const range = Math.max(1, ex.repMax - ex.repMin + 1);

  const out: SetLog[] = [];
  for (let i = 0; i < total; i++) {
    const reps = ex.bw
      ? 10 + (hashNum(`${ex.id}${i}${w}`) % 8)
      : ex.repMin + ((hashNum(`${ex.id}${i}`) + w) % range);
    out.push({ weight, reps, done: true, ts: `${date}T18:0${i % 9}:00.000Z` });
  }
  return out;
}

/**
 * Genera las sesiones de ejemplo (sin tocar el estado). Devuelve SOLO las
 * nuevas, ya con su `id`; el orden lo decide el store, que las apila con las
 * existentes y reordena por `startedAt` descendente.
 *
 * Cada día se salta si la plantilla no trae ni un ejercicio disponible con el
 * material activo (la v1 hacía `if (!entries.length) continue`), así que con
 * «Solo peso corporal» sigue saliendo algo: los ejercicios de PC del catálogo.
 */
export function demoSessions(o: DemoOptions): Session[] {
  const weeks = Math.max(1, int(o.weeks, 8));
  const today = String(o.todayIso).slice(0, 10);
  const out: Session[] = [];

  /* el historial CRECE con cada sesión creada, igual que `state.sessions` en la
     v1: así la rotación (`rotate: 2`) y la familiaridad ven lo que ya llevamos */
  const history: Session[] = [...o.sessions];
  const input: PlanInput = {
    /* `pickForGroup` solo usa exercises/equipment/sessions; la unidad va aquí
       porque `PlanInput` es el contrato completo del planificador */
    settings: { ...DEFAULT_SETTINGS, units: o.unit },
    exercises: o.exercises,
    equipment: o.equipment,
    sessions: history,
  };

  for (let w = weeks - 1; w >= 0; w--) {
    const weekStart = addDays(startOfWeek(today), -7 * w);
    const daysCount = 3 + (hashNum(`d${w}`) % 2);
    for (let k = 0; k < daysCount; k++) {
      const date = addDays(weekStart, DOW_PLAN[(k + (w % 2)) % DOW_PLAN.length]);
      if (date > today) continue;

      const tpl = o.templates.find((t) => t.id === RECIPES[(w * 3 + k) % RECIPES.length]);
      if (!tpl) continue;

      const used: Record<string, boolean> = {};
      const entries: SessionEntry[] = [];
      for (const pair of tpl.recipe) {
        const picked = pickForGroup(input, pair[0], int(pair[1], 1), { used, rotate: 2 });
        for (const ex of picked) {
          used[ex.id] = true;
          entries.push({
            exId: ex.id,
            name: ex.name,
            restSec: ex.rest,
            sets: demoSets(ex, w, weeks, date, o.unit),
            notes: '',
          });
        }
      }
      if (!entries.length) continue;

      const startedAt = `${date}T18:00:00.000Z`;
      const minutes = 48 + (hashNum(date) % 25);
      const session: Session = {
        id: uid('s'),
        name: tpl.name,
        date,
        startedAt,
        endedAt: new Date(new Date(startedAt).getTime() + minutes * 60_000).toISOString(),
        unit: o.unit,
        source: 'demo',
        demo: true,
        entries,
        notes: '',
        rpe: 7,
      };
      out.push(session);
      history.push(session);
    }
  }
  return out;
}
