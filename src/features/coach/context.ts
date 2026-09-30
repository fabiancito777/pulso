/**
 * El contexto que se le pega al system prompt antes de cada petición.
 *
 * Es el port de `C.buildContext` de la v1 (`legacy/js/coach.js`) con tres
 * secciones nuevas que la v1 no tenía: `APRENDIZAJE DEL COACH` (desviaciones
 * frente a la plantilla, cambios en plena rutina y resumen de `buildInsights`),
 * `HISTORIAL CONSOLIDADO` (una ficha por ejercicio con TODO el histórico, la
 * memoria a largo plazo del modelo) y `MEMORIA DEL COACH` (el markdown de
 * `settings.ai.memory` tal cual).
 *
 * Todo entra por parámetro —ajustes, sesiones, rutinas, calendario, material,
 * biblioteca y `todayIso`—: ni estado global ni DOM, así que el texto se puede
 * comparar con `expect(...).toContain(...)` en Vitest.
 */
import {
  daysSince,
  durationOf,
  groupSets,
  groupVolume,
  lastTrained,
  prs,
  sessionDate,
  sessionsSince,
  setsOf,
  totals,
  volumeOf,
  weeklySeries,
} from '@/domain/analytics';
import {
  GROUPS,
  GOAL_REST,
  GOAL_REPS,
  GOAL_SETS,
  enabledEquipment,
  equipLabel,
  goalLabel,
  isAvailable,
} from '@/domain/data';
import { dow, dowLong, label as dateLabel, today, weekDates } from '@/domain/dates';
import { fmtDur, fmtN, fmtVol } from '@/domain/format';
import { int, num, sum } from '@/domain/num';
import { maxLoadable } from '@/domain/plates';
import { toKg, unitLabel } from '@/domain/units';
import type { Exercise, Session } from '@/domain/types';
import { consolidatedHistory } from './history';
import { buildInsights, planChangeBullets } from './insights';
import type { BuildContextParams, CoachRoutine } from './types';

/** Si una sesión no tiene `endedAt`, `durationOf` recibe 0: no se inventa duración. */
const OPEN_SESSION_NOW = 0;

/**
 * Línea de una sesión con los datos REALES serie a serie y, si salió de una
 * rutina o de un plan, el objetivo de la plantilla entre corchetes para comparar.
 *
 * `cumple k/n` se calcula contra el rango del ITEM (el que la plantilla pedía
 * para ese ejercicio); `goalRange` (el `GOAL_REPS` del usuario) solo entra de
 * respaldo cuando el item no trae `repMin`/`repMax`. Comparar siempre contra el
 * global era lo que hacía que la misma línea dijera «objetivo 6-10» y
 * «cumple 0» a la vez que `APRENDIZAJE` acusaba «6 reps por debajo del mínimo
 * (8)».
 */
function sessionLine(
  session: Session,
  routines: readonly CoachRoutine[],
  byId: ReadonlyMap<string, Exercise>,
  goalRange: readonly [number, number],
): string {
  const routine = session.routineId
    ? (routines.find((candidate) => candidate.id === session.routineId) ?? null)
    : null;
  const parts: string[] = [];
  session.entries.forEach((entry) => {
    const done = entry.sets.filter((set) => set.done);
    if (!done.length) return;
    const detail = done.map((set) => `${fmtN(set.weight)}x${fmtN(set.reps)}`).join(', ');
    let target = '';
    const item =
      session.plan?.find((candidate) => candidate.exId === entry.exId) ??
      routine?.items.find((candidate) => candidate.exId === entry.exId);
    if (item) {
      const repMin = int(item.repMin, goalRange[0]);
      const repMax = int(item.repMax, goalRange[1]);
      const cumplidas = done.filter((set) => {
        const reps = num(set.reps);
        return reps >= repMin && reps <= repMax;
      }).length;
      target =
        ` [objetivo plantilla: ${int(item.sets, 3)}x${repMin}-${repMax}` +
        ` · descanso ${int(item.rest, 90)}s · cumple ${cumplidas}/${done.length}]`;
    }
    const name = String(entry.name ?? byId.get(entry.exId)?.name ?? entry.exId);
    parts.push(`${name}: ${detail}${target}`);
  });
  if (!parts.length) return '';
  return (
    `${dateLabel(sessionDate(session), 'medium')} · ${session.name || 'Sesión'}` +
    ` (${fmtVol(volumeOf(session))} kg, ${setsOf(session)} series,` +
    ` ${fmtDur(durationOf(session, OPEN_SESSION_NOW))}): ${parts.join(' | ')}`
  );
}

/**
 * Monta el bloque de contexto completo. `opts.todayIso` hace el texto
 * determinista (si falta, se usa el reloj) y `opts.maxSessions` limita el
 * HISTORIAL (por defecto 10, como en la v1).
 */
export function buildContext(params: BuildContextParams): string {
  const { settings, sessions, routines, schedule, equipment, exercises, opts = {} } = params;
  const todayIso = opts.todayIso ?? today();
  const lim = Math.max(1, int(opts.maxSessions, 10));
  const byId = new Map(exercises.map((ex) => [ex.id, ex]));
  const out: string[] = [];

  /* ---------- perfil ---------- */
  out.push('=== PERFIL ===');
  out.push(`Fecha de hoy: ${todayIso} (${dowLong(todayIso)})`);
  out.push(
    `Nombre: ${settings.name || 'sin especificar'} | Nivel: ${settings.level} |` +
      ` Objetivo: ${goalLabel(settings.goal)} | Días/semana: ${settings.daysPerWeek}`,
  );
  out.push(
    `Unidades: ${settings.units} | Incremento habitual: ${fmtN(settings.increment)}` +
      ` ${unitLabel(settings.units)} | Descanso base: ${settings.restDefault}s`,
  );
  const goalReps: readonly [number, number] = GOAL_REPS[settings.goal] ?? [8, 12];
  out.push(
    `Rango de repeticiones objetivo del objetivo: ${goalReps[0]}-${goalReps[1]} reps,` +
      ` ${GOAL_SETS[settings.goal] ?? 4} series, descanso ~${GOAL_REST[settings.goal] ?? 90}s`,
  );
  out.push('');

  /* ---------- equipamiento ---------- */
  out.push('=== EQUIPAMIENTO ===');
  const enabled = enabledEquipment(equipment).map(equipLabel);
  out.push(enabled.length ? enabled.join(', ') : 'solo peso corporal');
  const plates = (settings.plates ?? [])
    .filter((plate) => plate.on !== false)
    .map(
      (plate) =>
        `${fmtN(toKg(plate.w, plate.unit), 2)} kg` +
        `${plate.unit === 'lb' ? ` (${fmtN(plate.w)} lb)` : ''} · ${plate.discs} discos`,
    )
    .join(', ');
  out.push(
    `Inventario de discos (unidades = discos sueltos; en kg, con original entre paréntesis si es lb): ${plates || 'sin discos'}`,
  );
  const load = maxLoadable({ plates: settings.plates, bars: settings.bars, mode: 'bar' });
  out.push(
    `Barra principal: ${fmtN(load.handleKg, 1)} kg | Máximo cargable total: ${fmtN(load.totalKg, 1)} kg`,
  );
  out.push('');

  /* ---------- ejercicios ---------- */
  out.push('=== EJERCICIOS PERMITIDOS (usa estos nombres exactos) ===');
  const usable = exercises.filter((ex) => ex.allowed && isAvailable(ex, equipment));
  /* los ★ primero dentro de cada grupo (estables: el resto sigue el orden del
     catálogo) y marcados con «★ », que es como los pide la petición */
  const byFav = (a: Exercise, b: Exercise): number =>
    (b.fav === true ? 1 : 0) - (a.fav === true ? 1 : 0);
  const favs = usable.filter((ex) => ex.fav === true);
  if (favs.length) out.push(`FAVORITOS (prefiere estos): ${favs.map((ex) => ex.name).join(', ')}`);
  for (const group of GROUPS) {
    const list = usable.filter((ex) => ex.group === group.key).sort(byFav);
    if (!list.length) continue;
    const names = list.map((ex) => (ex.fav === true ? `★ ${ex.name}` : ex.name));
    out.push(`${group.label} (${list.length}): ${names.join(', ')}`);
  }
  const banned = exercises.filter((ex) => !ex.allowed);
  if (banned.length) {
    out.push(
      `PROHIBIDOS (no los propongas): ${banned
        .slice(0, 40)
        .map((ex) => ex.name)
        .join(', ')}`,
    );
  }
  const unavailable = exercises
    .filter((ex) => ex.allowed && !isAvailable(ex, equipment))
    .slice(0, 30);
  if (unavailable.length) {
    out.push(
      `NO DISPONIBLES por falta de material: ${unavailable.map((ex) => ex.name).join(', ')}`,
    );
  }
  out.push('');

  /* ---------- historial ---------- */
  out.push(
    '=== HISTORIAL (datos REALES registrados serie a serie, más reciente primero;' +
      ' el objetivo de la plantilla va entre corchetes para comparar) ===',
  );
  const recent = [...sessions]
    .sort((a, b) => (sessionDate(a) < sessionDate(b) ? 1 : -1))
    .slice(0, lim);
  if (!recent.length) out.push('Sin sesiones registradas todavía.');
  for (const session of recent) {
    const line = sessionLine(session, routines, byId, goalReps);
    if (line) out.push(line);
  }
  out.push('');

  /* ---------- estado actual ---------- */
  out.push('=== ESTADO ACTUAL ===');
  const last = lastTrained(sessions, exercises);
  const last7 = sessionsSince(sessions, 7, todayIso);
  const vol7 = groupVolume(last7, exercises);
  const sets7 = groupSets(last7, exercises);
  out.push('Días desde el último estímulo y volumen de los últimos 7 días:');
  for (const group of GROUPS) {
    const days = last[group.key] ? daysSince(last[group.key], todayIso) : null;
    const volume = vol7[group.key] ?? 0;
    const sets = sets7[group.key] ?? 0;
    if (days === null && !volume) continue;
    out.push(
      `- ${group.label}: ${days === null ? 'sin datos' : `${days} días`} |` +
        ` ${sets} series | ${fmtVol(volume)} kg`,
    );
  }
  const records = prs(sessions);
  const prLines = Object.keys(records)
    .map((exId) => ({ exId, pr: records[exId] }))
    .sort((a, b) => b.pr.e1rm - a.pr.e1rm)
    .slice(0, 15)
    .map(
      ({ exId, pr }) =>
        `${byId.get(exId)?.name ?? exId}: 1RM est. ${fmtN(pr.e1rm)} kg` +
        ` (${fmtN(pr.weight)}x${fmtN(pr.reps)} el ${pr.date})`,
    );
  if (prLines.length) out.push(`Récords (1RM estimado): ${prLines.join(' | ')}`);
  const tot = totals(sessions, todayIso);
  out.push(
    `Totales: ${tot.sessions} sesiones, ${fmtVol(tot.volume)} kg movidos,` +
      ` racha actual ${tot.streak} días, media ${fmtDur(tot.avgDuration)} por sesión.`,
  );
  out.push('');

  /* ---------- historial consolidado: la memoria a largo plazo ---------- */
  out.push(
    '=== HISTORIAL CONSOLIDADO (UNA ficha por ejercicio con TODO el histórico,' +
      ' sin ventana temporal, más reciente primero; pesos en ' +
      `${unitLabel(settings.units)}) ===`,
  );
  const consolidated = consolidatedHistory(sessions, {
    exercises,
    changes: true,
    unit: settings.units,
  });
  if (consolidated.length) out.push(...consolidated);
  else out.push('Sin sesiones registradas todavía.');
  out.push('');

  /* ---------- rutinas ---------- */
  out.push(
    '=== RUTINAS GUARDADAS (prescripcion/objetivo de las plantillas;' +
      ' NO es lo realizado, eso está en HISTORIAL) ===',
  );
  if (!routines.length) out.push('Sin rutinas guardadas todavía.');
  for (const routine of routines.slice(0, 12)) {
    let lastUsed: string | null = null;
    for (const session of sessions) {
      const iso = sessionDate(session);
      if (session.routineId === routine.id && (!lastUsed || iso > lastUsed)) lastUsed = iso;
    }
    const items = routine.items
      .map(
        (item) =>
          `${byId.get(item.exId)?.name ?? item.exId} ${int(item.sets, 3)}x` +
          `${int(item.repMin, goalReps[0])}-${int(item.repMax, goalReps[1])}` +
          `${item.rest ? `@${item.rest}s` : ''}`,
      )
      .join(', ');
    out.push(
      `- ${routine.name} [${routine.source ?? 'manual'}]` +
        `${lastUsed ? ` · última vez ${dateLabel(lastUsed, 'medium')}` : ' · sin usar'}: ${items}`,
    );
  }
  out.push('');

  /* ---------- volumen semanal ---------- */
  out.push('=== VOLUMEN POR SEMANA (últimas 8) ===');
  out.push(
    weeklySeries(sessions, 8, todayIso)
      .map(
        (week) =>
          `${week.label}: ${fmtVol(week.volume)} kg, ${week.sessions} ses,` +
          ` ${week.sets} series, ${week.minutes} min`,
      )
      .join(' | '),
  );
  out.push('');

  /* ---------- plan semanal ---------- */
  out.push('=== PLAN SEMANAL (semana en curso, día a día) ===');
  for (const iso of weekDates(todayIso)) {
    const day = schedule[iso] ?? {};
    const routine = day.routineId ? (routines.find((r) => r.id === day.routineId) ?? null) : null;
    const daySessions = sessions.filter((session) => sessionDate(session) === iso);
    let line = routine ? routine.name : day.title || day.type || 'libre';
    if (daySessions.length || day.status === 'done') {
      line += ` [HECHO: ${Math.round(sum(daySessions, (session) => volumeOf(session)))} kg]`;
      if (daySessions.length) {
        const names = [
          ...new Set(
            daySessions.flatMap((session) =>
              session.entries.map((entry) =>
                String(entry.name ?? byId.get(entry.exId)?.name ?? entry.exId),
              ),
            ),
          ),
        ].slice(0, 8);
        line += ` ejercicios: ${names.join(', ')}`;
      }
    } else if (day.status === 'rest') line += ' [DESCANSO]';
    else if (day.status === 'skipped') line += ' [SALTADO]';
    out.push(`- ${dateLabel(iso, 'medium')} (${dow(iso)}): ${line}`);
  }
  out.push('');

  /* ---------- aprendizaje (nuevo en v2) ---------- */
  out.push('=== APRENDIZAJE DEL COACH ===');
  const insights = buildInsights({
    sessions,
    routines,
    exercises,
    todayIso,
    unit: settings.units,
    goal: settings.goal,
    maxSessions: lim,
  });
  if (insights.summary.length) {
    out.push('Resumen:');
    for (const bullet of insights.summary) out.push(`- ${bullet}`);
  } else {
    out.push('Sin datos todavía para aprender (empieza a registrar sesiones).');
  }
  const planBullets = planChangeBullets(insights.planChanges);
  if (planBullets.length) {
    out.push('Cambios en plena rutina (frente a la rutina que tenías al empezar):');
    for (const bullet of planBullets) out.push(`- ${bullet}`);
  } else {
    out.push(
      'Sin cambios en plena rutina (las sesiones respetaron el plan o no venían de una rutina).',
    );
  }
  const notable = insights.deviations
    .filter((deviation) => deviation.verdict !== 'matched')
    .slice(0, 8);
  if (notable.length) {
    out.push('Desviaciones destacadas (hecho frente a lo recomendado):');
    for (const deviation of notable) out.push(`- ${deviation.date} · ${deviation.text}`);
  } else {
    out.push('Sin desviaciones destacadas frente a las rutinas.');
  }
  out.push('');

  /* ---------- memoria (nuevo en v2) ---------- */
  out.push('=== MEMORIA DEL COACH ===');
  out.push(String(settings.ai.memory ?? '').trim() || '(sin memoria todavía)');

  if (opts.extra) {
    out.push('');
    out.push(opts.extra);
  }
  return out.join('\n');
}
