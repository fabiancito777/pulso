/** Convierte una sesión guardada en un plan que conserva sus cargas por serie. */
import { sessionDate } from './analytics';
import { label as dateLabel } from './dates';
import { int, num } from './num';
import type { PlanItem, Session } from './types';

export interface RepeatPlanItem extends PlanItem {
  reps?: number;
  basis?: string;
  notes?: string;
}

/**
 * Items para repetir una sesión, conservando el peso y las reps de cada serie
 * registrada y la unidad de origen. El inicio las convierte a la unidad actual.
 */
export function repeatItems(session: Session): RepeatPlanItem[] {
  const basis = `repetición de ${dateLabel(sessionDate(session), 'medium')}`;
  return session.entries.map((entry) => {
    const sets = Array.isArray(entry.sets) ? entry.sets : [];
    const top = sets.length
      ? sets.reduce((best, set) => (num(set.weight) > num(best.weight) ? set : best))
      : { weight: 0, reps: 10, done: true };
    const reps = int(top.reps, 0) || 10;
    const recorded = sets.length
      ? sets.map((set) => ({
          weight: set.weight === null || set.weight === undefined ? null : num(set.weight),
          reps: int(set.reps, reps) || reps,
        }))
      : [{ weight: num(top.weight), reps }];
    const repsList = recorded.map((set) => set.reps);
    const matchingPlan = Array.isArray(session.plan)
      ? session.plan.filter((item) => item?.exId === entry.exId)
      : [];
    /* La nota personal nunca se convierte en consejo. */
    const cue =
      typeof entry.cue === 'string'
        ? entry.cue
        : matchingPlan.length === 1 && typeof matchingPlan[0]?.notes === 'string'
          ? matchingPlan[0].notes
          : '';
    return {
      exId: entry.exId,
      sets: recorded.length,
      repMin: Math.min(...repsList),
      repMax: Math.max(...repsList),
      rest: int(entry.restSec, 90),
      weight: top.weight === null ? null : num(top.weight),
      reps,
      basis,
      repeatSets: recorded,
      sourceUnit: session.unit,
      ...(entry.superset ? { superset: entry.superset } : {}),
      ...(cue ? { notes: cue } : {}),
    };
  });
}
