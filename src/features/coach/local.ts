/**
 * Planificador LOCAL del coach: `localSuggest` (entreno de hoy) y `localWeek`
 * (plan de 7 días) sin red, sin API key y sin estado.
 *
 * Es el port de `C.localSuggest` / `C.localWeek` de la v1
 * (`legacy/js/coach.js` ~309 y ~367) a la forma que ya consumen la v2:
 * `applySuggestionAsRoutine` y `applyWeek` (`state/coach.ts`), la tarjeta de
 * CoachView y `RoutinesView`/`CalendarView`, que leen `outcome.text` con
 * `parseJSON`. Por eso la salida es JSON «de modelo»: `SuggestJSON` con
 * `exercises` y `PlanJSON` con `days` (la v1 devolvía `items`/`iso`, que
 * `apply…` de la v2 también acepta como alias).
 *
 * Las decisiones que no se pueden romper:
 *
 * - **Sin historial** no hay vacío: se cae a la receta de cuerpo completo
 *   `cuadriceps 1 + pecho 1 + espalda 1` y el `rationale` lo dice.
 * - **Material**: los ejercicios salen de `pickForGroup`, que ya filtra con
 *   `isAvailable`; si un grupo entero se queda sin material, ese grupo no
 *   aparece (no se propone nada imposible de cargar).
 * - **Peso**: `suggestWeight` de `analytics` (inyectable con `suggest`, igual
 *   que `StartOptions.suggest`), siempre en la unidad del usuario.
 * - **`source: 'local'`** (la v1): al guardar, `apply…` lo traduce a
 *   `generador`, que es como la v1 etiquetaba la rutina nacida aquí.
 */
import { daysSince, groupSets, lastTrained, sessionsSince } from '@/domain/analytics';
import { GOAL_REPS, GOAL_SETS, GROUPS, goalLabel, groupLabel } from '@/domain/data';
import { addDays, startOfWeek } from '@/domain/dates';
import { clamp, int, num } from '@/domain/num';
import type { PlanExercise, PlanInput, SuggestFn } from '@/domain/plan';
import { findTemplate, itemsFromRecipe, pickForGroup, richItems, weekSlots } from '@/domain/plan';

/* ---------- formas de salida (las que pide el prompt de la IA) ---------- */

/** Tipos de día que entiende el calendario (`DAY_TYPES` del catálogo). */
export type PlanDayType = 'entreno' | 'cardio' | 'movilidad' | 'descanso';

/** Un ejercicio de la propuesta, con el nombre EXACTO de la biblioteca. */
export interface SuggestExercise {
  exId: string;
  name: string;
  sets: number;
  repMin: number;
  repMax: number;
  /** en la unidad del usuario (0 = peso corporal) */
  weight: number;
  rest: number;
  notes: string;
}

/** JSON de `suggest`: la misma forma que pide el prompt de `prompts.ts`. */
export interface SuggestJSON {
  title: string;
  focus: string;
  source: string;
  rationale: string[];
  notes: string;
  exercises: SuggestExercise[];
}

/** Un día del plan semanal. */
export interface PlanDayJSON {
  date: string;
  type: PlanDayType;
  title: string;
  focus: string;
  exercises: SuggestExercise[];
  /** plantilla del catálogo de la que salió (null en días de descanso) */
  template?: string;
}

/** JSON de `plan`: la misma forma que pide el prompt de `prompts.ts`. */
export interface PlanJSON {
  source: string;
  from: string;
  daysPerWeek: number;
  rationale: string[];
  days: PlanDayJSON[];
}

/** Parámetros comunes: `PlanInput` + la fecha de hoy (la inyecta el caller). */
export interface LocalParams extends PlanInput {
  /** ISO local de hoy: sin él los tests dependerían del reloj */
  todayIso: string;
  /** sugerencia de peso propia (por defecto `analytics.suggestWeight`) */
  suggest?: SuggestFn;
}

export interface LocalWeekParams extends LocalParams {
  /** lunes de la semana a planificar (por defecto `startOfWeek(todayIso)`) */
  from?: string;
  /** días de entreno; si falta, manda `settings.daysPerWeek` */
  daysPerWeek?: number;
}

/* ---------- utilidades ---------- */

/** Un grupo puntuado del `scored` de `localSuggest`. */
interface ScoredGroup {
  key: string;
  /** días desde la última vez que se entrenó (null = nunca) */
  days: number | null;
  /** series de ese grupo en los últimos 7 días */
  sets: number;
  score: number;
}

/** `serie`/`series`, el `U.plural` de la v1. */
function plural(n: number, singular: string, pluralWord: string): string {
  return `${n} ${n === 1 ? singular : pluralWord}`;
}

/** El `exercises` de la propuesta: ya resuelto, sin campos internos. */
function toSuggestExercises(items: readonly PlanExercise[]): SuggestExercise[] {
  return items.map((item) => ({
    exId: item.exId,
    name: item.name,
    sets: item.sets,
    repMin: item.repMin,
    repMax: item.repMax,
    weight: item.weight,
    rest: item.rest,
    notes: item.notes,
  }));
}

/** Grupos presentes en unos ejercicios, con su etiqueta, sin repetir. */
function focusOf(items: readonly PlanExercise[]): string {
  const labels: string[] = [];
  for (const item of items) {
    const label = groupLabel(item.group);
    if (!labels.includes(label)) labels.push(label);
  }
  return labels.join(' · ');
}

/* ---------- entreno de hoy ---------- */

/**
 * Propuesta de entreno para hoy, calculada con el historial de los últimos 7
 * días: cada grupo muscular recibe una puntuación por días sin estímulo y por
 * series de la semana, y los 4 primeros aportan 2, 2, 1 y 1 ejercicios (más un
 * bloque de core si no ha salido).
 *
 * **Primer día** (0 sesiones): no hay nada que puntuar, así que se va DIRECTO a
 * la receta de cuerpo completo de la v1 (`cuadriceps 1 + pecho 1 + espalda 1`),
 * igual que cuando ningún grupo punteado tiene material: «Sugerir entreno»
 * nunca devuelve una lista vacía y el `rationale` dice de dónde sale.
 */
export function localSuggest(params: LocalParams): SuggestJSON {
  const { settings, exercises, equipment, sessions, todayIso, suggest } = params;
  const input: PlanInput = { settings, exercises, equipment, sessions };
  const richOpts = suggest ? { suggest } : {};
  const targetSets = GOAL_SETS[settings.goal] || 4;

  const week = sessionsSince(sessions, 7, todayIso);
  const last = lastTrained(sessions, exercises);
  const sets7 = groupSets(week, exercises);
  const sinHistorial = sessions.length === 0;

  /* cardio y movilidad se miden en minutos: aquí no puntúan (v1) */
  const skip = new Set(['cardio', 'movilidad']);
  const scored: ScoredGroup[] = sinHistorial
    ? []
    : GROUPS.filter((g) => !skip.has(g.key))
        .map((g) => {
          const isoLast = last[g.key] ?? null;
          const days = daysSince(isoLast, todayIso);
          const sets = sets7[g.key] ?? 0;
          let score =
            (days === null ? 16 : Math.min(days, 16)) * 1.2 + Math.max(0, 10 - sets) * 1.7;
          if (days !== null && days < 2) score -= 14; /* descansar lo recién entrenado */
          return { key: g.key, days, sets, score };
        })
        .sort((a, b) => b.score - a.score);

  const counts = [2, 2, 1, 1];
  const used: Record<string, boolean> = {};
  const items: PlanExercise[] = [];
  const rationale: string[] = [];

  scored.slice(0, counts.length).forEach((entry, i) => {
    const picked = pickForGroup(input, entry.key, counts[i], { used, rotate: 2 });
    if (!picked.length) return; /* sin material: el grupo no sale (v1) */
    for (const ex of picked) used[ex.id] = true;
    items.push(
      ...richItems(
        input,
        picked.map((ex) => ({
          exId: ex.id,
          sets: ex.type === 'compuesto' ? targetSets : Math.max(3, targetSets - 1),
          repMin: ex.repMin,
          repMax: ex.repMax,
          reps: Math.round((ex.repMin + ex.repMax) / 2),
          rest: ex.rest,
        })),
        richOpts,
      ),
    );
    rationale.push(
      `${groupLabel(entry.key)}: ${
        entry.days === null ? 'sin estímulo registrado' : `hace ${entry.days} días`
      } · ${plural(entry.sets, 'serie', 'series')} en los últimos 7 días`,
    );
  });

  if (!items.length) {
    items.push(
      ...richItems(
        input,
        itemsFromRecipe(
          input,
          [
            ['cuadriceps', 1],
            ['pecho', 1],
            ['espalda', 1],
          ],
          { rotate: 2 },
        ),
        richOpts,
      ),
    );
    rationale.push('Sugerencia genérica de cuerpo completo: aún no hay historial suficiente.');
  }

  /* un bloque de core si no ha salido por las plantillas */
  if (!items.some((item) => item.group === 'core')) {
    for (const ex of pickForGroup(input, 'core', 1, { used, rotate: 2 })) {
      used[ex.id] = true;
      items.push(
        ...richItems(
          input,
          [
            {
              exId: ex.id,
              sets: 3,
              repMin: ex.repMin,
              repMax: ex.repMax,
              reps: Math.round((ex.repMin + ex.repMax) / 2),
              rest: ex.rest,
            },
          ],
          richOpts,
        ),
      );
    }
  }

  const groups = [...new Set(items.map((item) => item.group))];
  const goalReps = GOAL_REPS[settings.goal] ?? [8, 12];

  return {
    title: `Sesión de ${groups.slice(0, 2).map(groupLabel).join(' + ')}`,
    focus: groups.map(groupLabel).join(' · '),
    source: 'local',
    rationale,
    notes:
      `Generado en tu dispositivo con tus datos de los últimos 7 días ` +
      `(${goalLabel(settings.goal)}, ${goalReps[0]}-${goalReps[1]} reps).`,
    exercises: toSuggestExercises(items),
  };
}

/* ---------- plan semanal ---------- */

/**
 * Plan de 7 días empezando en `from` (por defecto el lunes de la semana de
 * `todayIso`): reparto de `WEEK_LAYOUT` + `WEEK_ROTATION`, una plantilla del
 * catálogo por día de entreno y el resto de descanso —con el domingo de
 * recuperación activa cuando sobra (`n < 6`).
 *
 * Cada día de entreno expande su receta con `rotate: 3` (no repetir los mismos
 * movimientos de la semana pasada) y pasa por `richItems`, así que los pesos
 * son los del historial y el material el del usuario.
 */
export function localWeek(params: LocalWeekParams): PlanJSON {
  const { settings, exercises, equipment, sessions, todayIso, suggest } = params;
  const input: PlanInput = { settings, exercises, equipment, sessions };
  const richOpts = suggest ? { suggest } : {};

  const from = params.from ?? startOfWeek(todayIso);
  const n = clamp(int(params.daysPerWeek ?? settings.daysPerWeek, 4) || 4, 1, 7);

  const days: PlanDayJSON[] = weekSlots(n).map((slot) => {
    const date = addDays(from, slot.index);
    if (!slot.templateId) {
      return {
        date,
        type: slot.recovery ? 'movilidad' : 'descanso',
        title: slot.recovery ? 'Movilidad ligera' : 'Descanso',
        focus: slot.recovery ? 'Recuperación activa' : '',
        exercises: [],
      };
    }

    const tpl = findTemplate(slot.templateId);
    if (!tpl) {
      /* no puede pasar (los ids salen del catálogo), pero no se inventa un día */
      return {
        date,
        type: 'descanso',
        title: 'Descanso',
        focus: '',
        exercises: [],
      };
    }

    const items = richItems(input, itemsFromRecipe(input, tpl.recipe, { rotate: 3 }), richOpts);
    return {
      date,
      type: tpl.id === 'mobility' ? 'movilidad' : tpl.id === 'hiit' ? 'cardio' : 'entreno',
      title: tpl.name,
      focus: focusOf(items),
      exercises: toSuggestExercises(items),
      template: tpl.id,
    };
  });

  return {
    source: 'local',
    from,
    daysPerWeek: n,
    rationale: [
      `Distribución de ${n} días con al menos 48 h entre sesiones del mismo grupo muscular.`,
      'Selección de ejercicios según material disponible, progresión por historial y rotación para evitar repetir los mismos movimientos.',
    ],
    days,
  };
}

/* ---------- resumen legible ---------- */

/**
 * Resumen en castellano de una propuesta local para `CoachOutcome.text`: lo que
 * ve el usuario (título + rationale) SIN el JSON, que viaja aparte en
 * `payload`.
 *
 * Los días de entreno salen de `daysPerWeek` (el número REAL de sesiones) y no
 * de contar días que no sean `descanso`: el domingo de recuperación activa es
 * `type: 'movilidad'` y así un plan de 4 días no anunciaría «5 días de
 * entreno». Solo si el JSON no trae el número (una propuesta de la IA) se
 * cuenta por tipo.
 */
export function summarizeLocal(payload: SuggestJSON | PlanJSON): string {
  const head =
    'days' in payload
      ? (() => {
          const first = payload.days[0]?.date ?? '';
          const last = payload.days[payload.days.length - 1]?.date ?? '';
          const declared = num(payload.daysPerWeek, 0);
          const sessions =
            declared > 0
              ? Math.trunc(declared)
              : payload.days.filter((d) => d.type !== 'descanso').length;
          return `Plan semanal: del ${first} al ${last} · ${plural(sessions, 'día', 'días')} de entreno`;
        })()
      : payload.title;

  const notes = 'notes' in payload ? payload.notes : '';
  return [head, ...payload.rationale.map((line) => `- ${line}`), notes]
    .filter((line) => line.trim() !== '')
    .join('\n');
}
