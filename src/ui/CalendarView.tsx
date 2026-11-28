/**
 * Vista Calendario: la semana como vista por defecto, el mes como cuadrícula
 * con detalle lateral y la propuesta semanal (`planFromJson`/`parsePlan` →
 * previsualizar → `applyWeek`).
 *
 * Decisiones que vienen de  y no se rompen:
 *
 * - **DOS motores de plan, el local SIEMPRE visible**: «Auto-planificar» usa
 *   `localWeek` en el dispositivo (sin red, sin key) y «Con IA» —la mejora
 *   opcional, solo con key— usa `runCoachTask('plan')`, que ya resuelve en
 *   local si no hay key o si la llamada se cae (auth/red/cuota). Es el par
 *   `cal:autoplan` con `data-ai="0"` y `"1"`; sin key la opción IA se
 *   oculta y deja el pie «sin API key: plan local» en vez de un bloqueo.
 * - **Nunca se aplica solo**: las dos rutas acaban en la MISMA tarjeta de
 *   propuesta (preview común) y el calendario solo se toca en «Aplicar». Tras
 *   aplicar, la tarjeta se queda con «Aplicada (N días)» + «Regenerar», como
 *   `plan.applied`: re-planificar propone ANTES de escribir.
 * - **Local e IA se distinguen** en el `source` del plan: `localWeek` escribe
 *   `'local'` y el modelo, `'ia'` (o nada, que `normalizePlan` cuenta como
 *   IA). `applyWeek` lo copia tal cual al día —la rutina nacida del plan
 *   guarda `'generador'`—, así que Hoy pinta badge «plan» o «IA» igual que la
 *   antes (`views-train.js:120`).
 * - **La semana son DOS capas**: la franja de 7 columnas
 *   (`week-strip`, para ver de un vistazo) y una tarjeta por día con el
 *   selector de rutina y las acciones rápidas. Siete columnas con un `<select>`
 *   dentro no caben en los 720 px del shell.
 * - **Un día con sesión real se ve HECHO** aunque el plan diga otra cosa, y el
 *   resumen de la semana cuenta `completados/planificados` como antes.
 * - **Solo se escribe con `setDay(iso, patch)`** (el setter del store, que hace
 *   merge). Por eso "limpiar" pasa `clearDayPatch()`: `undefined` en cada campo
 *   que `JSON.stringify` omite, que es el `delete`  hecho con merge.
 * - **Fechas SIEMPRE ISO local** de `domain/dates` (`weekDates`, `monthDays`,
 *   `label`): nada de `toISOString().slice(0, 10)`, que desplaza el día según
 *   la zona horaria.
 * - Los componentes leen los signals (`schedule`, `sessions`, `routines`) ellos
 *   mismos: así el repintado es fino y no hay que pasarles el estado entero.
 */
import { useRef, useState } from 'preact/hooks';

import { go } from '@/app/router';
import { durationOf, sessionDate, setsOf, volumeOf } from '@/domain/analytics';
import { resolveExercise } from '@/domain/data';
import {
  addDays,
  addMonths,
  dow,
  dowIdx,
  label as dateLabel,
  parse,
  relative,
  startOfWeek,
  today,
  weekDates,
} from '@/domain/dates';
import { fmtDur, fmtN, fmtVol } from '@/domain/format';
import { unresolvedNames } from '@/domain/match';
import type { RoutineItem, Session } from '@/domain/types';
import { localWeek } from '@/features/coach/local';
import { promptHistory } from '@/state/chat';
import { applyWeek, hasApiKey, runCoachTask } from '@/state/coach';
import {
  equipment,
  exercises,
  findRoutine,
  routines,
  schedule,
  sessions,
  setDay,
  settings,
} from '@/state/store';
import type { ScheduleDay } from '@/state/store';

import '../styles/calendar.css';
import {
  DAY_STATUSES,
  DAY_STATE_LABEL,
  DAY_STATUS_LABEL,
  clearDayPatch,
  dayState,
  dayTitle,
  dayType,
  dayTypeLabel,
  monthDays,
  monthLevel,
  parsePlan,
  planControls,
  planDateChanges,
  planEngine,
  planFromJson,
  planOrigin,
  restoreDayPlanPatch,
  restDayPatch,
  weekCounts,
  weekSubtitle,
} from './calendar-helpers';
import type { DayState, DayStatus, PlanEngine, PlanResult } from './calendar-helpers';
import { HelpBtn } from './HelpModal';
import { useCoachWait, WaitMeta } from './coach-wait';
import { Icon } from './Icon';
import { Kpi } from './kit';
import { requestEditRoutineDraft } from './routines-helpers';

type ViewMode = 'week' | 'month';

interface Notice {
  kind: 'ok' | 'warn' | 'err';
  text: string;
}

/** Clase del indicador de estado (los `badge` de base.css). */
const BADGE_CLASS: Record<DayState, string> = {
  done: 'badge ok',
  rest: 'badge',
  skipped: 'badge warn',
  planned: 'badge a',
  free: 'badge',
};

/** Sesiones de un día concreto. Usa `sessionDate` por si una sesión vieja solo trae `startedAt`. */
function sessionsOn(iso: string): Session[] {
  return sessions.value.filter((s) => sessionDate(s) === iso);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Items sueltos de `day.plan` (días del plan sin rutina asociada). */
function dayPlanEntries(day: ScheduleDay | undefined): Record<string, unknown>[] {
  const raw: unknown = day?.plan;
  return Array.isArray(raw) ? raw.filter(isRecord) : [];
}

/** Abre el editor con un borrador local; no escribe hasta que se guarda. */
function editDayExercises(
  iso: string,
  routine: ReturnType<typeof findRoutine>,
  planEntries: readonly Record<string, unknown>[],
): void {
  const day = schedule.value[iso];
  if (day?.status === 'rest' || day?.type === 'descanso') return;
  const entries: readonly (RoutineItem | Record<string, unknown>)[] = routine?.items ?? planEntries;
  const items: RoutineItem[] = [];
  for (const entry of entries) {
    const exId = typeof entry.exId === 'string' ? entry.exId.trim() : '';
    if (!exId) continue;
    items.push({
      exId,
      sets: typeof entry.sets === 'number' ? entry.sets : undefined,
      repMin: typeof entry.repMin === 'number' ? entry.repMin : undefined,
      repMax: typeof entry.repMax === 'number' ? entry.repMax : undefined,
      rest: typeof entry.rest === 'number' ? entry.rest : undefined,
      weight:
        typeof entry.weight === 'number' ? entry.weight : entry.weight === null ? null : undefined,
      notes: typeof entry.notes === 'string' ? entry.notes : undefined,
      superset: typeof entry.superset === 'string' ? entry.superset : undefined,
    });
  }
  if (!items.length) return;
  const focusRaw: unknown = day?.focus;
  const sourceRaw: unknown = day?.source;
  requestEditRoutineDraft({
    iso,
    name: dayTitle(day, routine?.name ?? '') || 'Rutina del plan',
    focus: typeof focusRaw === 'string' ? focusRaw : '',
    source: typeof sourceRaw === 'string' ? sourceRaw : 'ia',
    items,
  });
  go('rutinas');
}

/** Asigna (o quita) la rutina de un día. Quitarla deja el día sin plan. */
function assignRoutine(iso: string, routineId: string): void {
  if (!routineId) {
    setDay(iso, clearDayPatch());
    return;
  }
  const routine = findRoutine(routineId);
  setDay(iso, {
    routineId,
    type: 'entreno',
    title: routine?.name ?? '',
    status: 'planned',
    source: 'manual',
    restorePlan: undefined,
  });
}

/** Marca el día como descanso: el título manda, la rutina asignada se conserva. */
function markRest(iso: string): void {
  setDay(iso, restDayPatch(schedule.value[iso]));
}

function clearDay(iso: string): void {
  setDay(iso, clearDayPatch());
}

function restoreDay(iso: string): void {
  setDay(iso, restoreDayPlanPatch(schedule.value[iso]));
}

/** Cambia el estado desde el detalle del día (el `cal:day-status` ). */
function setStatus(iso: string, status: DayStatus): void {
  if (status === 'rest') {
    markRest(iso);
    return;
  }
  const patch: Partial<ScheduleDay> = { status, source: 'manual' };
  patch.restorePlan = undefined;
  /* un día que era descanso y vuelve a "planificado" pierde el tipo, no la rutina */
  if (dayType(schedule.value[iso]) === 'descanso') {
    patch.type = undefined;
    patch.title = undefined;
  }
  setDay(iso, patch);
}

/** Selector de rutina de un día (vacío = sin rutina). */
function RoutineSelect({ iso, day }: { iso: string; day: ScheduleDay | undefined }) {
  const list = routines.value;
  const current = typeof day?.routineId === 'string' ? day.routineId : '';
  const value = list.some((r) => r.id === current) ? current : '';
  return (
    <label class="field cal-routine">
      <span class="label">Rutina</span>
      <select
        class="select"
        value={value}
        onChange={(e) => assignRoutine(iso, e.currentTarget.value)}
      >
        <option value="">Sin rutina</option>
        {list.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Fila con la sesión registrada de ese día (si la hay) → Progreso. */
function SessionRow({ session }: { session: Session }) {
  return (
    <button type="button" class="cal-session" onClick={() => go('progreso')}>
      <Icon name="check-circle" />
      <span class="grow ellipsis">{session.name || 'Sesión registrada'}</span>
      <span class="num tiny">
        {fmtVol(volumeOf(session))} kg · {fmtDur(durationOf(session))}
      </span>
    </button>
  );
}

/** Acciones rápidas de cualquier día (compartidas por tarjeta y detalle). */
function DayActions({ iso, state, day }: { iso: string; state: DayState; day?: ScheduleDay }) {
  const canRestore = Boolean(day?.restorePlan && typeof day.restorePlan === 'object');
  return (
    <div class="cal-day-actions">
      {canRestore ? (
        <button type="button" class="btn sm ghost" onClick={() => restoreDay(iso)}>
          Restaurar plan
        </button>
      ) : null}
      <button
        type="button"
        class="btn sm ghost"
        onClick={() => markRest(iso)}
        disabled={state === 'rest'}
      >
        <Icon name="moon" />
        Descanso
      </button>
      <button
        type="button"
        class="btn sm ghost"
        onClick={() => clearDay(iso)}
        disabled={state === 'free'}
      >
        <Icon name="trash" />
        Limpiar
      </button>
    </div>
  );
}

/** Tarjeta de un día de la semana: tipo, título, rutina, sesión y acciones. */
function WeekDayRow({ iso, selected, onSelect }: { iso: string; selected: boolean; onSelect: (iso: string) => void }) {
  const day = schedule.value[iso];
  const daySessions = sessionsOn(iso);
  const state = dayState(day, daySessions.length);
  const routine = findRoutine(typeof day?.routineId === 'string' ? day.routineId : '');
  const title = dayTitle(day, routine?.name ?? '');
  const isToday = iso === today();

  return (
    <button
      id={`cal-${iso}`}
      type="button"
      class={`cal-week-row ${state}${isToday ? ' today' : ''}${selected ? ' sel' : ''}`}
      aria-expanded={selected}
      onClick={() => onSelect(iso)}
    >
      <span class="cal-week-date"><b>{dow(iso)}</b> {parse(iso).getDate()}{isToday ? ' · hoy' : ''}</span>
      <span class="cal-week-title">{title || 'Sin plan todavía'}</span>
      <span class={BADGE_CLASS[state]}>{DAY_STATE_LABEL[state]}</span>
      <span class="cal-week-type">{dayTypeLabel(day, state)}</span>
      <Icon name="chev-r" />
    </button>
  );
}

/** Vista de semana: resumen, franja, estado vacío (si no hay nada planeado) y tarjetas. */
function WeekView({
  cursor,
  selected,
  onSelect,
}: {
  cursor: string;
  selected: string | null;
  onSelect: (iso: string) => void;
}) {
  const days = weekDates(cursor);
  const from = days[0];
  const to = days[6];
  const states = days.map((iso) => dayState(schedule.value[iso], sessionsOn(iso).length));
  const counts = weekCounts(states);
  const weekSessions = sessions.value.filter((s) => {
    const d = sessionDate(s);
    return d >= from && d <= to;
  });
  const volume = weekSessions.reduce((sum, s) => sum + volumeOf(s), 0);
  const sets = weekSessions.reduce((sum, s) => sum + setsOf(s), 0);
  const minutes = Math.round(weekSessions.reduce((sum, s) => sum + durationOf(s), 0) / 60_000);

  return (
    <>
      <div class="cal-kpis">
        <Kpi
          label="Volumen semanal"
          value={fmtVol(volume)}
          unit="kg"
          delta={`${weekSessions.length} sesiones`}
          help="cal.kpis"
        />
        <Kpi
          label="Planificados"
          value={fmtN(counts.planned, 0)}
          delta={`${counts.done} completados`}
        />
        <Kpi label="Series" value={fmtN(sets, 0)} delta={`${minutes} min`} />
      </div>

      {routines.value.length === 0 ? (
        <div class="card tight cal-hint">
          <div class="row">
            <Icon name="info" />
            <span class="tiny grow">
              Aún no tienes rutinas: créala primero y podrás asignarla a cualquier día.
            </span>
            <button type="button" class="btn sm" onClick={() => go('rutinas')}>
              Crear rutina
            </button>
          </div>
        </div>
      ) : null}

      {counts.planned === 0 ? (
        <div class="empty cal-empty">
          <Icon name="calendar" />
          <div>Semana sin plan</div>
          <div class="tiny">Asigna rutinas a los días desde su detalle</div>
        </div>
      ) : null}

      <div class="cal-week-rows">
        {days.map((iso) => (
          <div key={iso} class="cal-week-entry">
            <WeekDayRow iso={iso} selected={selected === iso} onSelect={onSelect} />
            {selected === iso ? (
              <DayDetail iso={iso} onClose={() => onSelect(iso)} />
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}

/** Celda del mes: indicador de hecho/planificado/descanso y clic → detalle. */
function MonthCell({
  iso,
  selected,
  onSelect,
}: {
  iso: string;
  selected: boolean;
  onSelect: (iso: string) => void;
}) {
  const day = schedule.value[iso];
  const count = sessionsOn(iso).length;
  const state = dayState(day, count);
  const modifier = state === 'free' ? '' : ` cal-${state}`;
  /* Intensidad mensual: `lvl3` = 2+ sesiones (el planificado y la sesión única
     ya se pintan con `cal-planned`/`cal-done`). */
  const level = monthLevel(count);
  return (
    <button
      id={`cal-${iso}`}
      type="button"
      class={`month-cell${modifier}${level ? ` ${level}` : ''}${iso === today() ? ' today' : ''}${
        selected ? ' cal-sel' : ''
      }`}
      title={`${dateLabel(iso)} · ${DAY_STATE_LABEL[state]}`}
      onClick={() => onSelect(iso)}
    >
      {parse(iso).getDate()}
    </button>
  );
}

/** Detalle de un día: estados, rutina con sus ejercicios, sesiones y acciones. */
function DayDetail({ iso, onClose }: { iso: string; onClose: () => void }) {
  const day = schedule.value[iso];
  const daySessions = sessionsOn(iso);
  const state = dayState(day, daySessions.length);
  const routine = findRoutine(typeof day?.routineId === 'string' ? day.routineId : '');
  const planEntries = dayPlanEntries(day);
  const hasPlan = planEntries.length > 0;

  return (
    <aside id={`cal-detail-${iso}`} class="cal-detail cal-week-detail" tabIndex={-1}>
      <div class="between">
        <div class="grow">
          <div class="h3">{dateLabel(iso, 'medium')}</div>
          <div class="tiny muted">
            {dateLabel(iso)} · {relative(iso)}
          </div>
        </div>
        <button type="button" class="icon-btn" onClick={onClose} title="Cerrar detalle">
          <Icon name="x" />
        </button>
      </div>

      <div class="row" style="gap:6px">
        <span class={BADGE_CLASS[state]}>{DAY_STATE_LABEL[state]}</span>
        <HelpBtn id="cal.states" title="Estados de un día" />
      </div>

      <div class="seg">
        {DAY_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            class={state === status ? 'on accent' : ''}
            onClick={() => setStatus(iso, status)}
          >
            {DAY_STATUS_LABEL[status]}
          </button>
        ))}
      </div>

      <RoutineSelect iso={iso} day={day} />

      {routine && routine.items.length ? (
        <div>
          <div class="label">Ejercicios de {routine.name}</div>
          <div class="cal-items">
            {routine.items.map((item, i) => {
              const ex = resolveExercise(exercises.value, item.exId);
              return (
                <div key={`${item.exId}-${i}`} class="kv">
                  <span class="k ellipsis">
                    {i + 1}. {ex?.name ?? item.exId}
                  </span>
                  <span class="v num tiny">
                    {fmtN(item.sets ?? 3, 0)} × {fmtN(item.repMin ?? 8, 0)}-
                    {fmtN(item.repMax ?? 12, 0)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : !routine && hasPlan ? (
        <div>
          <div class="label">Ejercicios del plan</div>
          <div class="cal-items">
            {planEntries.map((entry, i) => {
              const exId = typeof entry.exId === 'string' ? entry.exId : '';
              const ex = exId ? resolveExercise(exercises.value, exId) : null;
              const name = ex?.name ?? (typeof entry.name === 'string' ? entry.name : exId);
              const sets = typeof entry.sets === 'number' ? entry.sets : 3;
              const reps =
                typeof entry.reps === 'number'
                  ? fmtN(entry.reps, 0)
                  : `${fmtN(typeof entry.repMin === 'number' ? entry.repMin : 8, 0)}-${fmtN(typeof entry.repMax === 'number' ? entry.repMax : 12, 0)}`;
              const weight = typeof entry.weight === 'number' ? ` @ ${fmtN(entry.weight)}` : '';
              return (
                <div key={`${exId || name}-${i}`} class="kv">
                  <span class="k ellipsis">
                    {i + 1}. {name}
                  </span>
                  <span class="v num tiny">
                    {fmtN(sets, 0)} × {reps}
                    {weight}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div class="tiny muted">Sin ejercicios asignados: elige una rutina o genera el plan.</div>
      )}

      {routine || hasPlan ? (
        <button
          type="button"
          class="btn sm ghost"
          disabled={state === 'rest'}
          title={state === 'rest' ? 'Restaura el plan antes de editarlo' : undefined}
          onClick={() => editDayExercises(iso, routine, planEntries)}
        >
          <Icon name="pencil" />
          Editar ejercicios del día
        </button>
      ) : null}

      {daySessions.length ? (
        <div>
          <div class="label">Sesiones registradas</div>
          <div class="col cal-sessions">
            {daySessions.map((s) => (
              <SessionRow key={s.id} session={s} />
            ))}
          </div>
        </div>
      ) : null}

      <DayActions iso={iso} state={state} day={day} />
    </aside>
  );
}

/** Vista de mes: cuadrícula con indicadores + detalle del día elegido al lado. */
function MonthView({
  cursor,
  selected,
  onSelect,
}: {
  cursor: string;
  selected: string | null;
  onSelect: (iso: string) => void;
}) {
  const days = monthDays(cursor);
  const pad = dowIdx(days[0]);

  return (
    <div class="cal-month">
      <div class="cal-month-main">
        <div class="cal-dow-row">
          {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => (
            <span key={d} class="tiny muted center">
              {d}
            </span>
          ))}
        </div>
        <div class="month-grid">
          {Array.from({ length: pad }, (_, i) => (
            <span key={`pad-${i}`} class="month-cell cal-pad" />
          ))}
          {days.map((iso) => (
            <MonthCell key={iso} iso={iso} selected={selected === iso} onSelect={onSelect} />
          ))}
        </div>
        <div class="chart-legend">
          <span>
            <i style="background:color-mix(in srgb,var(--ok) 45%,var(--surface-2))" />
            hecho
          </span>
          <span>
            <i style="background:color-mix(in srgb,var(--ok) 60%,var(--surface-2))" />
            2+ sesiones
          </span>
          <span>
            <i style="background:color-mix(in srgb,var(--accent) 35%,var(--surface-2))" />
            planificado
          </span>
          <span>
            <i style="background:var(--surface-3)" />
            descanso
          </span>
          <span>
            <i style="background:var(--surface-2)" />
            sin plan
          </span>
        </div>
      </div>

      {selected ? (
        <DayDetail iso={selected} onClose={() => onSelect(selected)} />
      ) : (
        <div class="empty cal-detail-empty">
          <Icon name="calendar" />
          <div>Elige un día</div>
          <div class="tiny">Toca una casilla para ver y editar su plan</div>
        </div>
      )}
    </div>
  );
}

/**
 * Propuesta de semana ya normalizada (la MISMA tarjeta para el plan local y el
 * de la IA) con sus tres salidas: aplicar, regenerar (antes `cal:regen`, propone
 * otra vez sin tocar el calendario) y descartar.
 */
function PlanCard({
  plan,
  applied,
  currentSchedule,
  routineNames,
  onApply,
  onRegen,
  onDiscard,
}: {
  plan: PlanResult;
  /** días que ya escribió ESTA propuesta; `null` = todavía sin aplicar */
  applied: number | null;
  currentSchedule: typeof schedule.value;
  routineNames: Readonly<Record<string, string>>;
  onApply: () => void;
  onRegen: () => void;
  onDiscard: () => void;
}) {
  const preview = plan.preview;
  const origin = planOrigin(preview.source);
  const training = preview.days.filter((d) => d.exercises.length).length;
  const changes = planDateChanges(preview, currentSchedule, today(), routineNames);
  const added = applied === null ? changes.filter((change) => change.kind === 'add').length : 0;
  const changed =
    applied === null ? changes.filter((change) => change.kind === 'change').length : 0;
  const skipped = applied === null ? changes.filter((change) => change.kind === 'past').length : 0;
  return (
    <section class="card accent cal-plan">
      <div class="between">
        <div class="grow">
          <div class="h3">Propuesta de semana</div>
          <div class="tiny muted">{origin.subtitle}</div>
        </div>
        <div class="row" style="gap:4px">
          <span class={origin.badge}>{preview.source}</span>
          <HelpBtn id="cal.planProposal" title="Propuesta de semana" />
        </div>
      </div>

      {preview.rationale ? <div class="tiny muted mt-s">{preview.rationale}</div> : null}

      <div class="tiny muted mt-s">
        {applied === null ? 'Qué pasará con las fechas de la propuesta' : 'Fechas de la propuesta'}
      </div>
      <div class="cal-plan-days mt-s">
        {changes.map((change, index) => {
          const d = preview.days[index];
          if (!d) return null;
          const proposedTitle = d.title || (d.exercises.length ? 'Entreno' : 'Descanso');
          const showResult = applied === null;
          return (
            <div key={d.iso} class="cal-plan-day">
              <div class="grow">
                <div class="cal-plan-title">{dateLabel(d.iso, 'short')}</div>
                <div class={showResult ? 'tiny' : 'tiny muted'}>
                  {showResult
                    ? change.kind === 'past'
                      ? `Se omitirá · ${proposedTitle}`
                      : change.kind === 'change'
                        ? `${change.currentTitle || 'Plan actual'} → ${proposedTitle}`
                        : proposedTitle
                    : proposedTitle}
                </div>
                <div class="tiny muted">
                  {[d.focus, d.exercises.join(' · ')].filter(Boolean).join(' — ') ||
                    'sin ejercicios'}
                </div>
                {showResult && change.retainedPlan ? (
                  <div class="tiny muted">{change.retainedPlan}</div>
                ) : null}
              </div>
              {showResult ? (
                <div class="cal-plan-change">
                  <span class={`badge${change.kind === 'change' ? ' warn' : ''}`}>
                    {change.kind === 'past'
                      ? 'Se omite'
                      : change.kind === 'add'
                        ? 'Se añade'
                        : 'Se actualizará'}
                  </span>
                  <span class="tiny muted num">
                    {d.exercises.length ? `${d.exercises.length} ej.` : '—'}
                  </span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {applied === null && added + changed === 0 ? (
        <div class="tiny muted">No hay fechas futuras para aplicar.</div>
      ) : null}
      {applied === null ? (
        <div class="tiny muted mt-s">
          {added} fechas nuevas · {changed} días existentes que se actualizarán
          {skipped ? ` · ${skipped} días pasados que se omitirán` : ''}
        </div>
      ) : null}

      <div class="row wrap mt">
        {applied === null ? (
          <button
            type="button"
            class="btn primary grow"
            onClick={onApply}
            disabled={added + changed === 0}
          >
            <Icon name="check" />
            Aplicar al calendario
          </button>
        ) : (
          <button type="button" class="btn okline grow" disabled>
            <Icon name="check" />
            Aplicada ({applied} días)
          </button>
        )}
        <button type="button" class="btn" onClick={onRegen}>
          <Icon name="refresh" />
          Regenerar
        </button>
        <button type="button" class="btn ghost" onClick={onDiscard}>
          <Icon name="x" />
          Descartar
        </button>
      </div>
      <div class="tiny muted mt-s">{training} días de entreno en la propuesta.</div>
    </section>
  );
}

export function CalendarView() {
  const planRequestVersion = useRef(0);
  const [cursor, setCursor] = useState(today());
  const [mode, setMode] = useState<ViewMode>('week');
  const [selected, setSelected] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [applied, setApplied] = useState<number | null>(null);
  const [loading, setLoading] = useState<PlanEngine | null>(null);
  const [showPlannerChoices, setShowPlannerChoices] = useState(false);
  /* espera de la IA: segundos, aviso de lentitud y Cancelar */
  const wait = useCoachWait();
  const [notice, setNotice] = useState<Notice | null>(null);

  /* Botón «Con IA» y pie: la key se lee aquí para que el repintado la note
     (es una signal) sin tener que consultarla dentro de cada handler. */
  const controls = planControls(hasApiKey());

  const weekStart = startOfWeek(cursor);
  const monthLabel = dateLabel(`${cursor.slice(0, 7)}-01`, 'month');
  const rangeLabel =
    mode === 'week'
      ? `${dateLabel(weekStart, 'medium')} – ${dateLabel(addDays(weekStart, 6), 'medium')}`
      : monthLabel;
  /* Subtítulo `V.sub`  (`views-calendar.js:13-19`), pintado arriba de la
     vista como el de Hoy y el de Progreso. Los estados salen de la MISMA lógica
     que las tarjetas (`dayState` + `sessionsOn`), así que nunca miente sobre lo
     de abajo, y sigue siendo la semana del cursor en los dos modos (como antes). */
  const subtitle = weekSubtitle(
    weekStart,
    weekDates(cursor).map((iso) => dayState(schedule.value[iso], sessionsOn(iso).length)),
  );

  function move(delta: number): void {
    planRequestVersion.current++;
    setSelected(null);
    setPlan(null);
    setApplied(null);
    setCursor(mode === 'week' ? addDays(cursor, delta * 7) : addMonths(cursor, delta));
  }

  /** Cambiar de semana/mes deja fuera de la vista el día seleccionado. */
  function changeMode(next: ViewMode): void {
    setSelected(null);
    setMode(next);
  }

  function selectDay(iso: string): void {
    const closing = selected === iso;
    setSelected(closing ? null : iso);
    requestAnimationFrame(() => {
      const target = document.getElementById(closing ? `cal-${iso}` : `cal-detail-${iso}`);
      if (!target) return;
      if (target instanceof HTMLElement) target.focus({ preventScroll: true });
      target.scrollIntoView({
        block: closing ? 'nearest' : 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
    });
  }

  /**
   * Plan del dispositivo sobre la semana que se está mirando. La IA recibe
   * el mismo lunes de semana para que preview, fallback y aplicación coincidan.
   */
  function localPlanJson(from: string): unknown {
    return localWeek({
      settings: settings.value,
      exercises: exercises.value,
      equipment: equipment.value,
      sessions: sessions.value,
      todayIso: today(),
      from,
    });
  }

  /** Envoltorio síncrono: los `onClick` no pueden recibir una promesa. */
  function generateLocalPlan(): void {
    void requestPlan('local');
  }

  /**
   * Genera la propuesta y la deja en pantalla. NUNCA escribe el calendario:
   * eso solo lo hace «Aplicar», así que ni «Auto-planificar» ni «Regenerar»
   * pisan lo que ya tenías planificado sin pasar por la tarjeta (antes:
   * `cal:autoplan`/`cal:regen` solo rellenaban `plan`).
   *
   * - `local` → `localWeek` en el dispositivo (cero llamadas).
   * - `ia` → `runCoachTask('plan')`: sin key resuelve en local y con key cae
   *   al plan local si la llamada se cae (auth/red/cuota), así que el botón
   *   «Con IA» nunca puede fallar por falta de configuración.
   */
  async function requestPlan(engine: PlanEngine): Promise<void> {
    if (loading) return;
    const requestedFrom = startOfWeek(cursor);
    const requestVersion = ++planRequestVersion.current;
    setLoading(engine);
    setNotice(null);
    /* el plan local es síncrono: solo la IA necesita espera (y cancelación) */
    const signal = engine === 'ia' ? wait.start() : undefined;
    try {
      let parsed: PlanResult | null;
      if (engine === 'ia') {
        /* transcript del chat como `contents`: «Con IA» parte de lo pedido antes */
        const outcome = await runCoachTask('plan', {
          from: requestedFrom,
          history: promptHistory(),
          signal,
          ...(signal ? { onSlow: wait.markSlow } : {}),
        });
        if (requestVersion !== planRequestVersion.current) return;
        /* `payload` es el camino directo (en local ya viene del planificador);
           el texto es la red de seguridad por si el JSON viene en una cercilla */
        parsed = planFromJson(outcome.payload, requestedFrom) ?? parsePlan(outcome.text, requestedFrom);
        if (parsed && planEngine(parsed.preview.source) === 'local') {
          setNotice({
            kind: 'warn',
            text: hasApiKey()
              ? 'IA no disponible: te dejo el plan local.'
              : 'sin API key: plan local',
          });
        }
      } else {
        parsed = planFromJson(localPlanJson(requestedFrom), requestedFrom);
      }
      if (requestVersion !== planRequestVersion.current) return;
      if (!parsed) {
        setNotice({
          kind: 'err',
          text: 'El coach no devolvió un plan que se pueda leer. Prueba a generarlo otra vez.',
        });
        return;
      }
      if (!parsed.preview.days.length) {
        setNotice({
          kind: 'warn',
          text: `${parsed.ignoredOutsideWeek ?? 0} fechas de la respuesta quedaron fuera de la semana elegida; no se aplicó ninguna.`,
        });
        return;
      }
      setPlan(parsed);
      setApplied(null);
      setShowPlannerChoices(false);
      if (parsed.ignoredOutsideWeek) {
        setNotice({
          kind: 'warn',
          text: `${parsed.ignoredOutsideWeek} fechas fuera de la semana elegida se omitieron.`,
        });
      }
    } catch (err) {
      if (requestVersion !== planRequestVersion.current) return;
      setNotice(
        wait.cancelled()
          ? { kind: 'warn', text: 'Cancelado: dejé de esperar el plan de la IA.' }
          : {
              kind: 'err',
              text: err instanceof Error ? err.message : 'No se pudo generar el plan.',
            },
      );
    } finally {
      setLoading(null);
      wait.end();
    }
  }

  /** `cal:apply-plan`: el ÚNICO sitio donde se escribe el calendario. */
  function applyPlan(): void {
    if (!plan) return;
    const result = applyWeek(plan.raw, today(), plan.weekFrom ?? weekStart);
    setApplied(result.days);
    /* Los días pasados/fuera de rango y las fechas sin ejercicios viables se
       explican para que no parezca que se perdió el plan. */
    const skipped = result.skipped ? ` · ${result.skipped} días pasados o fuera de semana ignorados` : '';
    const omitted = result.omittedDates?.length
      ? ` · sin cambios en ${result.omittedDates.map((iso) => dateLabel(iso, 'short')).join(', ')}: ningún ejercicio de esa propuesta se puede usar`
      : '';
    /* Los ejercicios del plan se guardan en `day.plan`, no como rutinas: con
       cero rutinas nuevas no tiene sentido decir «0 rutinas». */
    const base = result.days === 0 && result.omittedDates?.length
      ? `No se aplicaron días${skipped}${omitted}`
      : result.routines
      ? `Plan aplicado: ${result.days} días, ${result.routines} rutinas${skipped}`
      : `Plan aplicado: ${result.days} días${skipped}${omitted}`;
    setNotice({
      kind: result.unresolved.length ? 'warn' : 'ok',
      text: result.unresolved.length
        ? `${base} · sin usar (${result.unresolved.length}): ${unresolvedNames(result.unresolved)}`
        : base,
    });
  }

  /** `cal:regen`: otra propuesta (MISMO motor) y vuelta a la tarjeta. */
  function regenPlan(): void {
    if (!plan) return;
    void requestPlan(planEngine(plan.preview.source));
  }

  function discardPlan(): void {
    setPlan(null);
    setApplied(null);
  }

  return (
    <section class="cal-view">
      {/* Subtítulo de la pestaña (subtítulo de la pestaña): `weekSubtitle`.
          En su fila con el ? de la pestaña, que el `.v2-sub` solo no admite. */}
      <div class="help-row">
        <div class="v2-sub">{subtitle}</div>
        <HelpBtn id="tab.calendario" title="Calendario" />
      </div>

      {notice ? (
        <div
          class={`cal-notice ${notice.kind}`}
          role={notice.kind === 'err' ? 'alert' : 'status'}
          aria-live={notice.kind === 'err' ? 'assertive' : 'polite'}
        >
          <Icon name={notice.kind === 'ok' ? 'check-circle' : 'alert'} />
          <span class="grow">{notice.text}</span>
          <button type="button" class="icon-btn" onClick={() => setNotice(null)} title="Cerrar">
            <Icon name="x" />
          </button>
        </div>
      ) : null}

      {loading ? (
        <div class="cal-loading">
          <span class="dot-live accent" />
          {loading === 'ia' ? 'El coach IA planifica tu semana…' : 'Preparando tu semana…'}
          {loading === 'ia' ? <WaitMeta wait={wait} /> : null}
        </div>
      ) : null}

      {plan ? (
        <PlanCard
          plan={plan}
          applied={applied}
          currentSchedule={schedule.value}
          routineNames={Object.fromEntries(
            routines.value.map((routine) => [routine.id, routine.name]),
          )}
          onApply={applyPlan}
          onRegen={regenPlan}
          onDiscard={discardPlan}
        />
      ) : null}

      <div class="cal-toolbar">
        <div class="row" style="gap:6px">
          <button type="button" class="icon-btn" onClick={() => move(-1)} title="Anterior">
            <Icon name="chev-l" />
          </button>
          <button
            type="button"
            class="btn sm ghost"
            onClick={() => {
              setCursor(today());
              setSelected(null);
            }}
          >
            Hoy
          </button>
          <button type="button" class="icon-btn" onClick={() => move(1)} title="Siguiente">
            <Icon name="chev-r" />
          </button>
        </div>
        <span class="cal-range">{rangeLabel}</span>
        <div class="seg cal-mode">
          <button
            type="button"
            class={mode === 'week' ? 'on accent' : ''}
            aria-pressed={mode === 'week'}
            onClick={() => changeMode('week')}
          >
            Semana
          </button>
          <button
            type="button"
            class={mode === 'month' ? 'on accent' : ''}
            aria-pressed={mode === 'month'}
            onClick={() => changeMode('month')}
          >
            Mes
          </button>
        </div>
      </div>

      <div class="cal-planner">
        <button
          type="button"
          class="btn primary cal-planner-trigger"
          aria-expanded={showPlannerChoices}
          onClick={() => setShowPlannerChoices((open) => !open)}
          disabled={loading !== null}
        >
          <Icon name="wand" />
          {loading
            ? loading === 'local'
              ? 'Preparando semana…'
              : 'Pidiendo al coach…'
            : 'Planificar semana'}
          {!loading ? <Icon name={showPlannerChoices ? 'chev-u' : 'chev-d'} /> : null}
        </button>
        {showPlannerChoices && !loading ? (
          <div class="cal-planner-choices">
            <button type="button" class="btn primary" onClick={generateLocalPlan}>
              <Icon name="wand" />
              Plan local
              <span class="tiny muted">En este dispositivo, sin conexión</span>
            </button>
            {controls.ai ? (
              <button type="button" class="btn" onClick={() => void requestPlan('ia')}>
                <Icon name="sparkles" />
                Pedir al coach
                <span class="tiny muted">Puede usar tu conversación anterior</span>
              </button>
            ) : (
              <div class="tiny muted cal-planner-note">
                El plan local está disponible sin configurar la API del coach.
              </div>
            )}
            <HelpBtn id="cal.autoplan" title="Planificar semana" />
          </div>
        ) : null}
        {loading === 'ia' && wait.running ? (
          <button type="button" class="btn sm ghost" onClick={wait.cancel}>
            Cancelar
          </button>
        ) : null}
      </div>

      {mode === 'week' ? (
        <WeekView cursor={cursor} selected={selected} onSelect={selectDay} />
      ) : (
        <MonthView cursor={cursor} selected={selected} onSelect={selectDay} />
      )}
    </section>
  );
}
