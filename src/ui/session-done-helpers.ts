/**
 * El resumen que se enseña al TERMINAR una sesión (hoja `SessionDoneSheet`).
 *
 * Es aritmética pura sobre datos ya guardados, igual que `progress-helpers.ts`:
 * lo que se compara, lo que se cuenta y lo que se destaca tiene que poder
 * probarse sin navegador. La vista solo formatea.
 *
 * Decisiones que conviene no «arreglar» sin querer:
 *
 * - **La comparación es contra la sesión ANTERIOR**, no contra la media: la media
 *   esconde el caso que importa (una sesión mala tras una buena, o al revés) y
 *   con pocas sesiones ni existe. Si no hay anterior, `delta` es `null` y la
 *   vista calla en vez de inventar una comparación contra cero.
 * - **Los récords nuevos comparan contra lo ESTRICTAMENTE anterior** a la fecha
 *   de la sesión (`prsBefore`), con margen 0,01 kg: repetir el mismo peso no es
 *   un récord. Dos sesiones el mismo día no se comparan entre sí.
 * - **La racha se mide con la sesión ya dentro del historial**: es la racha de
 *   hoy, que es lo que el usuario quiere ver justo al terminar.
 */
import { durationOf, setsOf, streak, volumeOf } from '@/domain/analytics';
import type { Session } from '@/domain/types';

import { newPrs, prsBefore } from './progress-helpers';
import type { SessionPr } from './progress-helpers';

export interface SessionDoneSummary {
  /** la sesión recién guardada */
  session: Session;
  volume: number;
  sets: number;
  exercises: number;
  /** duración en MILISEGUNDOS (así la devuelve `durationOf`; `fmtDur` la formatea) */
  duration: number;
  /** racha actual (días) contando esta sesión */
  streak: number;
  /** récords nuevos, vacío si ninguno */
  records: SessionPr[];
  /** diferencia de volumen con la sesión anterior, `null` si no hay anterior */
  delta: number | null;
  /** nombre de la sesión anterior con la que se compara, para el texto */
  previousName: string | null;
  previousDate: string | null;
}

/** La sesión inmediatamente anterior por fecha (no cuenta la propia). */
function previousSession(sessions: readonly Session[], current: Session): Session | null {
  const date = sessionDateOf(current);
  let best: Session | null = null;
  let bestDate = '';
  for (const session of sessions) {
    if (session.id === current.id) continue;
    const candidate = sessionDateOf(session);
    /* el orden importa: a igual fecha gana la de `endedAt` más tardía */
    const later =
      candidate > bestDate ||
      (candidate === bestDate && (session.endedAt ?? '') > (best?.endedAt ?? ''));
    if (candidate <= date && later) {
      best = session;
      bestDate = candidate;
    }
  }
  return best;
}

function sessionDateOf(session: Session): string {
  return String(session.date ?? '');
}

/**
 * `sessions` es el historial COMPLETO ya con `current` dentro (es lo que acaba
 * de escribir `commitSession`). De ahí salen la anterior y la racha.
 */
export function sessionDoneSummary(
  current: Session,
  sessions: readonly Session[],
  todayIso: string,
): SessionDoneSummary {
  const volume = volumeOf(current);
  const previous = previousSession(sessions, current);
  const records = newPrs(current, prsBefore(sessions, sessionDateOf(current)));

  return {
    session: current,
    volume,
    sets: setsOf(current),
    exercises: current.entries.length,
    duration: durationOf(current),
    streak: streak(sessions, todayIso),
    records,
    delta: previous ? volume - volumeOf(previous) : null,
    previousName: previous ? (previous.name ?? null) : null,
    previousDate: previous ? sessionDateOf(previous) : null,
  };
}
