/**
 * Aprendizaje del coach: "qué te fue bien y qué te fue mal".
 *
 * Todo sale de los parámetros (sesiones, rutinas, biblioteca, `todayIso`), así
 * que se prueba con fixtures en Vitest en vez de entrenando una semana. Los
 * umbrales están fijados en `insights.test.ts` para que no se muevan sin querer:
 *
 * - **desviación `below`**: kg por debajo del peso que pedía la rutina menos
 *   0,5 kg, **o** reps por debajo de su `repMin`; `above` es el espejo (+0,5 kg
 *   o `repMax`); lo que quede entre medias es `matched`. Sin `routineId` (o sin
 *   item para ese ejercicio) no hay desviación que comparar.
 * - **win `pr`**: el mejor 1RM de la ventana es el de la última vez y había
 *   registros anteriores (Epley, igual que `analytics.e1rm`).
 * - **win `progress`** vs la sesión anterior del mismo ejercicio: subió el peso
 *   (≥ 0,5 kg), o aguantó el peso y sumó ≥ 2 reps, o hizo más series.
 * - **miss `belowReps`**: en su última vez hizo menos reps que el mínimo que
 *   pedía ESA sesión: el `repMin` del item de su plan/rutina si lo trae, y solo
 *   como respaldo el `repMin` del objetivo del usuario (`GOAL_REPS[goal][0]`).
 *   Comparar SIEMPRE contra el global era el bug que hacía que «6 reps por
 *   debajo del mínimo (8)» conviviera con una rutina que prescribe 6-10.
 * - **miss `regression`**: bajó el peso por debajo de sus 2 últimas veces
 *   (− 0,5 kg) o mantuvo el peso pero con menos reps que las dos.
 * - **staleness**: ejercicio `allowed` con más de 10 días sin registrar series
 *   hechas. Los que nunca se han tocado no cuentan (eso es "sin datos", no
 *   "estancado").
 * - **planChanges**: solo si la sesión trae `Session.plan` (el snapshot de la
 *   rutina al arrancar), se compara con lo hecho: añadidos, quitados,
 *   sustituciones emparejadas por grupo y reordenaciones (`planChangesFor`).
 *
 * Sin sesiones no se inventa nada: todos los arrays y el `summary` salen vacíos.
 */
import { e1rm, sessionDate, setKg, totals } from '@/domain/analytics';
import { GOAL_REPS, groupLabel } from '@/domain/data';
import { diffDays } from '@/domain/dates';
import { fmtDur, fmtN, fmtVol } from '@/domain/format';
import { num, round } from '@/domain/num';
import { fromKg, toKg, unitLabel } from '@/domain/units';
import type { Exercise, Session, SessionEntry, SetLog } from '@/domain/types';
import type {
  BuildInsightsParams,
  CoachRoutine,
  Deviation,
  Insights,
  Miss,
  PlanChanges,
  StaleExercise,
  Verdict,
  Win,
} from './types';

/** Mejor serie (mayor 1RM) de una entrada, o null si no hay nada marcado. */
function topSet(session: Session, entry: SessionEntry): SetLog | null {
  const done = entry.sets.filter((set) => set.done && num(set.reps));
  if (!done.length) return null;
  return done.reduce((a, b) =>
    e1rm(setKg(b, session.unit), b.reps) > e1rm(setKg(a, session.unit), a.reps) ? b : a,
  );
}

/**
 * Rango de reps contra el que se juzga una serie.
 *
 * `fromPlan` dice si el rango sale del item del plan/rutina de la sesión (lo
 * que manda) o del rango del objetivo del usuario, que solo sirve de
 * **respaldo** cuando el item no trae `repMin`/`repMax`.
 */
interface RepRange {
  repMin: number;
  repMax: number;
  fromPlan: boolean;
}

/**
 * Rango aplicable a una entrada de ESA sesión: el `repMin`/`repMax` del
 * snapshot del plan (`Session.plan`, que es lo que la rutina pedía cuando la
 * sesión arrancó) o, si no, los del item de la rutina de la que salió. Sin
 * rango en ninguno de los dos cae al del objetivo del usuario.
 *
 * Con esto el aviso «por debajo del mínimo» y la desviación «cumple/no
 * cumplen» hablan del MISMO rango que la rutina, en vez de comparar contra el
 * `GOAL_REPS` global.
 */
function repRangeOf(
  session: Session,
  exId: string,
  routineById: ReadonlyMap<string, CoachRoutine>,
  goalRange: readonly [number, number],
): RepRange {
  const routine = session.routineId ? routineById.get(session.routineId) : undefined;
  const item =
    session.plan?.find((candidate) => candidate.exId === exId) ??
    routine?.items.find((candidate) => candidate.exId === exId);
  const fromPlan = item !== undefined && (item.repMin !== undefined || item.repMax !== undefined);
  return {
    repMin: num(item?.repMin, goalRange[0]),
    repMax: num(item?.repMax, goalRange[1]),
    fromPlan,
  };
}

/** Un vistazo a un ejercicio en una sesión concreta. */
interface Point {
  date: string;
  /** kg de la mejor serie */
  kg: number;
  reps: number;
  e1rm: number;
  /** series hechas */
  sets: number;
  /** rango de reps que pedía esa sesión (plan/rutina, o el objetivo si no trae) */
  range: RepRange;
}

const emptyInsights = (): Insights => ({
  deviations: [],
  wins: [],
  misses: [],
  staleness: [],
  planChanges: emptyPlanChanges(),
  summary: [],
});

const byDateDesc = <T extends { date: string }>(a: T, b: T): number => (a.date < b.date ? 1 : -1);

/* ---------- cambios en plena rutina (snapshot `Session.plan` vs lo hecho) ---------- */

const emptyPlanChanges = (): PlanChanges => ({
  unplanned: [],
  missing: [],
  swapped: [],
  reordered: false,
});

/**
 * Compara el snapshot de la rutina con el que arrancó la sesión (`Session.plan`)
 * con las entradas que se acabaron haciendo.
 *
 * - `unplanned`: entradas cuyo `exId` no está en el plan.
 * - `missing`: items del plan sin entrada (quitados o no llegados).
 * - `swapped`: heurística; si hay unplanned y missing del MISMO grupo se
 *   emparejan yendo de atrás hacia delante por el plan, así que el missing más
 *   reciente es el que se sustituye. Lo no emparejado sigue siendo añadido o
 *   quitado.
 * - `reordered`: mismo conjunto de ejercicios pero en otro orden.
 *
 * Sin `plan` (sesión manual, que es hoy el caso habitual) todo sale vacío. El
 * grupo del unplanned sale de la entrada (`group` de respaldo) o de la
 * biblioteca; sin grupo no se empareja, mejor reportar suelto que inventar.
 */
export function planChangesFor(session: Session, exercises: readonly Exercise[] = []): PlanChanges {
  const plan = session.plan;
  if (!plan || !plan.length) return emptyPlanChanges();

  const nameById = new Map(exercises.map((ex) => [ex.id, ex.name]));
  const groupById = new Map(exercises.map((ex) => [ex.id, ex.group]));
  const nameOf = (entry: SessionEntry): string =>
    String(entry.name ?? nameById.get(entry.exId) ?? entry.exId);
  const groupOf = (entry: SessionEntry): string =>
    String(entry.group ?? groupById.get(entry.exId) ?? '');
  const nameOfPlan = (item: { exId: string }): string =>
    String(nameById.get(item.exId) ?? item.exId);

  const planIds = plan.map((item) => item.exId);
  const entryIds = session.entries.map((entry) => entry.exId);
  const inPlan = new Set(planIds);
  const done = new Set(entryIds);

  const unplannedEntries = session.entries.filter((entry) => !inPlan.has(entry.exId));
  const missingItems = plan.filter((item) => !done.has(item.exId));

  const reordered =
    planIds.length > 0 &&
    !unplannedEntries.length &&
    !missingItems.length &&
    planIds.some((exId, index) => entryIds[index] !== exId);

  const swapped: { from: string; to: string }[] = [];
  const taken = new Set<number>();
  for (const entry of unplannedEntries) {
    const group = groupOf(entry);
    if (!group) continue;
    let pick = -1;
    for (let i = missingItems.length - 1; i >= 0; i--) {
      if (taken.has(i)) continue;
      const item = missingItems[i];
      if (String(groupById.get(item.exId) ?? '') !== group) continue;
      pick = i;
      break;
    }
    if (pick < 0) continue;
    taken.add(pick);
    swapped.push({ from: nameOfPlan(missingItems[pick]), to: nameOf(entry) });
  }

  return {
    unplanned: unplannedEntries.map(nameOf),
    missing: missingItems.map(nameOfPlan),
    swapped,
    reordered,
  };
}

/**
 * Los cambios de plan en viñetas de castellano, listas para el prompt. Las
 * mismas usa el `summary` y la sección `APRENDIZAJE DEL COACH` del contexto,
 * para que el modelo lea exactamente lo mismo en los dos sitios.
 *
 * Las sustituciones van primero (es lo más interesante), después lo añadido y
 * por último lo que no se hizo; `reordered` se queda con su propia viñeta. Las
 * sustituciones NO se repiten en las otras dos. Máximo 4 viñetas.
 */
export function planChangeBullets(pc: PlanChanges): string[] {
  const bullets: string[] = [];
  const swappedTo = new Set(pc.swapped.map((pair) => pair.to));
  const swappedFrom = new Set(pc.swapped.map((pair) => pair.from));

  if (pc.swapped.length) {
    const pairs = pc.swapped.slice(0, 2).map((pair) => `${pair.from} por ${pair.to}`);
    bullets.push(`Sustituiste ${pairs.join(' y ')} en plena rutina.`);
  }
  const added = pc.unplanned.filter((name) => !swappedTo.has(name)).slice(0, 3);
  if (added.length === 1) bullets.push(`Añadiste un ejercicio no planificado: ${added[0]}.`);
  else if (added.length > 1) {
    bullets.push(`Añadiste ejercicios no planificados: ${added.join(', ')}.`);
  }
  const skipped = pc.missing.filter((name) => !swappedFrom.has(name)).slice(0, 3);
  if (skipped.length) bullets.push(`No llegaste a: ${skipped.join(', ')}.`);
  if (pc.reordered) bullets.push('Cambiaste el orden de los ejercicios respecto a la rutina.');

  return bullets;
}

/** Veredicto de una serie frente a la prescripción (umbrales de 0,5 kg). */
function verdictOf(
  kg: number,
  reps: number,
  targetKg: number | null,
  repMin: number,
  repMax: number,
): Verdict {
  if ((targetKg !== null && kg < targetKg - 0.5) || reps < repMin) return 'below';
  if ((targetKg !== null && kg > targetKg + 0.5) || reps > repMax) return 'above';
  return 'matched';
}

const VERDICT_LABEL: Record<Verdict, string> = {
  below: 'por debajo',
  above: 'por encima',
  matched: 'cumple',
};

/**
 * Qué te fue bien y qué te fue mal en las últimas `maxSessions` sesiones.
 *
 * `unit` es la unidad en la que la rutina fija `weight` (los pesos de las
 * sesiones se convierten SIEMPRE a kg antes de comparar, que es el convenio de
 * `analytics`). `staleness` se calcula con TODAS las sesiones recibidas, no solo
 * con la ventana: si no, un ejercicio entrenado ayer saldría como estancado
 * porque la ventana es corta.
 */
export function buildInsights(params: BuildInsightsParams): Insights {
  const {
    sessions,
    routines,
    exercises = [],
    todayIso,
    unit = 'kg',
    goal = 'hipertrofia',
    maxSessions = 12,
    staleDays = 10,
    staleLimit = 12,
    maxDeviations = 20,
  } = params;

  const ordered = [...sessions].sort((a, b) => (sessionDate(a) < sessionDate(b) ? -1 : 1));
  const window = ordered.slice(-Math.max(1, Math.trunc(num(maxSessions, 12))));
  if (!window.length) return emptyInsights();

  const names = new Map<string, string>();
  for (const ex of exercises) names.set(ex.id, ex.name);
  const nameOf = (exId: string, fallback?: string): string =>
    names.get(exId) ?? (fallback ? String(fallback) : exId);

  /* rango del objetivo: RESPALDO cuando el item del plan no trae repMin/repMax */
  const goalRange: readonly [number, number] = GOAL_REPS[goal] ?? [8, 12];
  const goalMin = num(goalRange[0], 8);
  const goalMax = num(goalRange[1], 12);
  const routineById = new Map(routines.map((routine) => [routine.id, routine]));

  /* ---------- puntos por ejercicio (sesión a sesión, en orden) ---------- */
  const points = new Map<string, Point[]>();
  for (const session of window) {
    for (const entry of session.entries) {
      const top = topSet(session, entry);
      if (!top) continue;
      const point: Point = {
        date: sessionDate(session),
        kg: round(setKg(top, session.unit), 2),
        reps: num(top.reps),
        e1rm: round(e1rm(setKg(top, session.unit), top.reps), 2),
        sets: entry.sets.filter((set) => set.done).length,
        range: repRangeOf(session, entry.exId, routineById, goalRange),
      };
      const list = points.get(entry.exId);
      if (list) list.push(point);
      else points.set(entry.exId, [point]);
      if (!names.has(entry.exId) && entry.name) names.set(entry.exId, String(entry.name));
    }
  }

  const fmtKg = (kg: number): string => `${fmtN(fromKg(kg, unit), 1)} ${unitLabel(unit)}`;

  /* ---------- victorias y avisos ---------- */
  const wins: Win[] = [];
  const misses: Miss[] = [];

  for (const [exId, pts] of points) {
    const latest = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    const prev2 = pts[pts.length - 3];
    const name = nameOf(exId);

    const reasons: string[] = [];
    const before = pts.slice(0, -1);
    let isPr = false;
    if (before.length) {
      const oldBest = Math.max(...before.map((p) => p.e1rm));
      if (latest.e1rm > oldBest + 0.05) {
        isPr = true;
        reasons.push(`nuevo PR de 1RM: ${fmtN(latest.e1rm, 1)} kg (antes ${fmtN(oldBest, 1)} kg)`);
      }
    }
    if (prev) {
      if (latest.kg >= prev.kg + 0.5) {
        reasons.push(`peso ${fmtN(prev.kg, 1)} → ${fmtN(latest.kg, 1)} kg × ${latest.reps}`);
      } else if (Math.abs(latest.kg - prev.kg) <= 0.5 && latest.reps >= prev.reps + 2) {
        reasons.push(`mismo peso (${fmtN(latest.kg, 1)} kg) y +${latest.reps - prev.reps} reps`);
      }
      if (latest.sets > prev.sets) {
        reasons.push(`+${latest.sets - prev.sets} serie (${latest.sets} vs ${prev.sets})`);
      }
    }
    if (reasons.length) {
      wins.push({
        kind: 'win',
        reason: isPr ? 'pr' : 'progress',
        exId,
        name,
        date: latest.date,
        text: `${name}: ${reasons.join(' · ')}`,
      });
    }

    let miss: Miss | null = null;
    if (prev && prev2) {
      const minPrevKg = Math.min(prev.kg, prev2.kg);
      const sameWeight =
        Math.abs(latest.kg - prev.kg) <= 0.5 && Math.abs(latest.kg - prev2.kg) <= 0.5;
      if (latest.kg < minPrevKg - 0.5) {
        miss = {
          kind: 'miss',
          reason: 'regression',
          exId,
          name,
          date: latest.date,
          text: `${name}: bajó a ${fmtN(latest.kg, 1)} kg × ${latest.reps} (sus 2 últimas: ${fmtN(prev.kg, 1)} y ${fmtN(prev2.kg, 1)} kg)`,
        };
      } else if (sameWeight && latest.reps < Math.min(prev.reps, prev2.reps)) {
        miss = {
          kind: 'miss',
          reason: 'regression',
          exId,
          name,
          date: latest.date,
          text: `${name}: mismo peso (${fmtN(latest.kg, 1)} kg) pero ${latest.reps} reps frente a ${prev.reps} y ${prev2.reps}`,
        };
      }
    }
    /* el mínimo manda: el del plan/rutina de ESA sesión si lo trae, y solo si
       no, el del objetivo del usuario (¿6 reps con una rutina 6-10? cumple) */
    if (!miss && latest.reps > 0 && latest.reps < latest.range.repMin) {
      const origen = latest.range.fromPlan ? 'de la plantilla' : 'del objetivo';
      miss = {
        kind: 'miss',
        reason: 'belowReps',
        exId,
        name,
        date: latest.date,
        text: `${name}: ${latest.reps} reps por debajo del mínimo ${origen} (${latest.range.repMin})`,
      };
    }
    if (miss) misses.push(miss);
  }

  /* ---------- desviaciones frente a la rutina ---------- */
  const deviations: Deviation[] = [];
  for (let i = window.length - 1; i >= 0 && deviations.length < maxDeviations; i--) {
    const session = window[i];
    if (!session.routineId) continue;
    const routine = routineById.get(session.routineId);
    if (!routine) continue;
    for (const entry of session.entries) {
      if (deviations.length >= maxDeviations) break;
      /* manda el snapshot de la sesión (lo que la plantilla pedía ESE día);
         la rutina de hoy entra solo como respaldo si el plan no lo trae */
      const item =
        session.plan?.find((candidate) => candidate.exId === entry.exId) ??
        routine.items.find((candidate) => candidate.exId === entry.exId);
      if (!item) continue;
      const done = entry.sets.filter((set) => set.done);
      if (!done.length) continue;
      const top = topSet(session, entry);
      if (!top) continue;
      const targetKg =
        item.weight === null || item.weight === undefined
          ? null
          : round(toKg(item.weight, unit), 2);
      /* el rango del item manda; el del objetivo solo cuando el item no trae */
      const repMin = num(item.repMin, goalMin);
      const repMax = num(item.repMax, goalMax);
      const kg = round(setKg(top, session.unit), 2);
      const reps = num(top.reps);

      let below = 0;
      let above = 0;
      for (const set of done) {
        const verdict = verdictOf(
          setKg(set, session.unit),
          num(set.reps),
          targetKg,
          repMin,
          repMax,
        );
        if (verdict === 'below') below++;
        else if (verdict === 'above') above++;
      }
      const verdict: Verdict = below ? 'below' : above ? 'above' : 'matched';
      const name = nameOf(entry.exId, entry.name);
      const target = `${targetKg === null ? '' : `${fmtKg(targetKg)} × `}${repMin}-${repMax}`;
      deviations.push({
        exId: entry.exId,
        name,
        date: sessionDate(session),
        verdict,
        kg,
        reps,
        targetKg,
        repMin,
        repMax,
        text: `${name}: ${fmtKg(kg)} × ${reps} · objetivo ${target} (${VERDICT_LABEL[verdict]})`,
      });
    }
  }

  /* ---------- estancados ---------- */
  const lastByEx = new Map<string, string>();
  for (const session of ordered) {
    const iso = sessionDate(session);
    for (const entry of session.entries) {
      if (!entry.sets.some((set) => set.done)) continue;
      const current = lastByEx.get(entry.exId);
      if (!current || current < iso) lastByEx.set(entry.exId, iso);
    }
  }
  const staleness: StaleExercise[] = exercises
    .filter((ex) => ex.allowed)
    .map((ex) => ({ ex, date: lastByEx.get(ex.id) ?? '' }))
    .filter(({ date }) => date && diffDays(todayIso, date) > staleDays)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(0, Math.max(0, Math.trunc(num(staleLimit, 12))))
    .map(({ ex, date }) => ({
      exId: ex.id,
      name: ex.name,
      group: ex.group,
      date,
      days: diffDays(todayIso, date) ?? 0,
    }))
    .sort((a, b) => b.days - a.days);

  /* ---------- cambios en plena rutina (solo si el snapshot existe) ---------- */
  const planChanges = emptyPlanChanges();
  const mergeNames = (target: string[], extra: readonly string[]): void => {
    for (const name of extra) if (!target.includes(name)) target.push(name);
  };
  for (const session of window) {
    if (!session.plan || !session.plan.length) continue;
    const changes = planChangesFor(session, exercises);
    mergeNames(planChanges.unplanned, changes.unplanned);
    mergeNames(planChanges.missing, changes.missing);
    for (const pair of changes.swapped) {
      const key = `${pair.from}→${pair.to}`;
      if (!planChanges.swapped.some((seen) => `${seen.from}→${seen.to}` === key)) {
        planChanges.swapped.push(pair);
      }
    }
    if (changes.reordered) planChanges.reordered = true;
  }

  return {
    deviations: deviations.sort(byDateDesc),
    wins: wins.sort(byDateDesc),
    misses: misses.sort(byDateDesc),
    staleness,
    planChanges,
    summary: buildSummary({
      window,
      todayIso,
      wins,
      misses,
      deviations,
      staleness,
      exercises,
      planChanges,
    }),
  };
}

interface SummaryInput {
  window: readonly Session[];
  todayIso: string;
  wins: readonly Win[];
  misses: readonly Miss[];
  deviations: readonly Deviation[];
  staleness: readonly StaleExercise[];
  exercises: readonly Exercise[];
  planChanges: PlanChanges;
}

/**
 * 3-6 viñetas con cifras, listas para pegarse en el prompt. Con datos siempre
 * sale algo (la actividad y el reparto por grupos nunca fallan); sin sesiones no
 * se llega aquí (`buildInsights` devuelve `[]`).
 */
function buildSummary(input: SummaryInput): string[] {
  const { window, todayIso, wins, misses, deviations, staleness, exercises, planChanges } = input;
  const bullets: string[] = [];

  const t = totals(window, todayIso);
  bullets.push(
    `Últimas ${window.length} sesiones: ${fmtVol(t.volume)} kg movidos en ${t.sets} series · racha de ${t.streak} día${t.streak === 1 ? '' : 's'} · media ${fmtDur(t.avgDuration)} por sesión.`,
  );

  /* los cambios en plena rutina van pegados arriba: si no, con 6 viñetas de
     tope se caerían justamente cuando más le importan al modelo */
  bullets.push(...planChangeBullets(planChanges));

  const groups: Record<string, number> = {};
  for (const session of window) {
    for (const entry of session.entries) {
      const ex = exercises.find((candidate) => candidate.id === entry.exId);
      const key = ex?.group || entry.group || 'otros';
      const kg = entry.sets.reduce(
        (acc, set) => acc + (set.done ? setKg(set, session.unit) * num(set.reps) : 0),
        0,
      );
      groups[key] = (groups[key] ?? 0) + kg;
    }
  }
  const topGroup = Object.entries(groups).sort((a, b) => b[1] - a[1])[0];
  if (topGroup) {
    bullets.push(
      `Grupo con más volumen: ${groupLabel(topGroup[0])} con ${fmtVol(topGroup[1])} kg.`,
    );
  }

  if (wins.length) {
    bullets.push(
      `${wins.length} progresiones: ${wins
        .slice(0, 2)
        .map((w) => w.text)
        .join(' | ')}.`,
    );
  }
  const below = deviations.filter((deviation) => deviation.verdict === 'below');
  if (below.length) {
    bullets.push(
      `Por debajo de la plantilla en ${below.length} ejercicio${below.length === 1 ? '' : 's'}: ${below
        .slice(0, 3)
        .map((deviation) => `${deviation.name} ${fmtN(deviation.kg, 1)} kg × ${deviation.reps}`)
        .join(', ')}.`,
    );
  }
  if (misses.length) {
    bullets.push(
      `Avisos: ${misses
        .slice(0, 2)
        .map((miss) => miss.text)
        .join(' | ')}.`,
    );
  }
  if (staleness.length) {
    bullets.push(
      `Sin tocar hace más de ${staleness[0].days} días: ${staleness
        .slice(0, 3)
        .map((stale) => `${stale.name} (${stale.days} d)`)
        .join(', ')}.`,
    );
  }

  const fallbacks = [
    `Ejercicios distintos entrenados en la ventana: ${
      new Set(window.flatMap((session) => session.entries.map((entry) => entry.exId))).size
    }.`,
    'Sin regresiones ni ejercicios por debajo del mínimo de repeticiones.',
    'Sin datos suficientes para más conclusiones: sigue registrando sesiones.',
  ];
  let i = 0;
  while (bullets.length < 3 && i < fallbacks.length) bullets.push(fallbacks[i++]);

  return bullets.slice(0, 6);
}
