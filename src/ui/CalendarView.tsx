/**
 * Vista Calendario: la semana como vista por defecto, el mes como cuadrícula
 * con detalle lateral y la propuesta semanal (`planFromJson`/`parsePlan` →
 * previsualizar → `applyWeek`).
 *
 * Decisiones que vienen de `legacy/js/views-calendar.js` y no se rompen:
 *
 * - **DOS motores de plan, el local SIEMPRE visible**: «Auto-planificar» usa
 *   `localWeek` en el dispositivo (sin red, sin key) y «Con IA» —la mejora
 *   opcional, solo con key— usa `runCoachTask('plan')`, que ya resuelve en
 *   local si no hay key o si la llamada se cae (auth/red/cuota). Es el par
 *   `cal:autoplan` con `data-ai="0"` y `"1"` de la v1; sin key la opción IA se
 *   oculta y deja el pie «sin API key: plan local» en vez de un bloqueo.
 * - **Nunca se aplica solo**: las dos rutas acaban en la MISMA tarjeta de
 *   propuesta (preview común) y el calendario solo se toca en «Aplicar». Tras
 *   aplicar, la tarjeta se queda con «Aplicada (N días)» + «Regenerar», como
 *   `plan.applied` de la v1: re-planificar propone ANTES de escribir.
 * - **Local e IA se distinguen** en el `source` del plan: `localWeek` escribe
 *   `'local'` y el modelo, `'ia'` (o nada, que `normalizePlan` cuenta como
 *   IA). `applyWeek` lo copia tal cual al día —la rutina nacida del plan
 *   guarda `'generador'`—, así que Hoy pinta badge «plan» o «IA» igual que la
 *   v1 (`views-train.js:120`).
 * - **La semana son DOS capas**: la franja de 7 columnas de la v1
 *   (`week-strip`, para ver de un vistazo) y una tarjeta por día con el
 *   selector de rutina y las acciones rápidas. Siete columnas con un `<select>`
 *   dentro no caben en los 720 px del shell.
 * - **Un día con sesión real se ve HECHO** aunque el plan diga otra cosa, y el
 *   resumen de la semana cuenta `completados/planificados` como la v1.
 * - **Solo se escribe con `setDay(iso, patch)`** (el setter del store, que hace
 *   merge). Por eso "limpiar" pasa `clearDayPatch()`: `undefined` en cada campo
 *   que `JSON.stringify` omite, que es el `delete` de la v1 hecho con merge.
 * - **Fechas SIEMPRE ISO local** de `domain/dates` (`weekDates`, `monthDays`,
 *   `label`): nada de `toISOString().slice(0, 10)`, que desplaza el día según
 *   la zona horaria.
 * - Los componentes leen los signals (`schedule`, `sessions`, `routines`) ellos
 *   mismos: así el repintado es fino y no hay que pasarles el estado entero.
 */
import { useEffect, useState } from 'preact/hooks';

import { go } from '@/app/router';
import { durationOf, sessionDate, setsOf, volumeOf } from '@/domain/analytics';
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
import type { Session } from '@/domain/types';
import { localWeek } from '@/features/coach/local';
import { applyWeek, hasApiKey, runCoachTask } from '@/state/coach';
import {
  equipment,
  exercises,
  findExercise,
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
  autoPlanRequest,
  clearDayPatch,
  dayState,
  dayTitle,
  dayType,
  dayTypeLabel,
  monthDays,
  parsePlan,
  planControls,
  planEngine,
  planFromJson,
  planOrigin,
  restDayPatch,
  takeAutoPlanRequest,
  weekCounts,
} from './calendar-helpers';
import type { DayState, DayStatus, DayType, PlanEngine, PlanResult } from './calendar-helpers';
import { Icon } from './Icon';
import { Kpi } from './kit';

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

/** Clase de la barrita de la franja semanal (mismos nombres que la v1). */
const STRIP_CLASS: Record<DayState, string> = {
  done: 'st-done',
  rest: 'st-rest',
  skipped: 'st-skip',
  planned: 'planned',
  free: '',
};

/** Icono por tipo de día (no hay "cardio" en el catálogo, se usa el rayo). */
const TYPE_ICON: Record<DayType, string> = {
  entreno: 'dumbbell',
  cardio: 'zap',
  movilidad: 'target',
  descanso: 'moon',
};

/** Sesiones de un día concreto. Usa `sessionDate` por si una sesión vieja solo trae `startedAt`. */
function sessionsOn(iso: string): Session[] {
  return sessions.value.filter((s) => sessionDate(s) === iso);
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
  });
}

/** Marca el día como descanso: el título manda, la rutina asignada se conserva. */
function markRest(iso: string): void {
  setDay(iso, restDayPatch());
}

function clearDay(iso: string): void {
  setDay(iso, clearDayPatch());
}

/** Cambia el estado desde el detalle del día (el `cal:day-status` de la v1). */
function setStatus(iso: string, status: DayStatus): void {
  if (status === 'rest') {
    markRest(iso);
    return;
  }
  const patch: Partial<ScheduleDay> = { status, source: 'manual' };
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
function DayActions({ iso, state }: { iso: string; state: DayState }) {
  return (
    <div class="cal-day-actions">
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
function WeekDayCard({ iso, selected }: { iso: string; selected: boolean }) {
  const day = schedule.value[iso];
  const daySessions = sessionsOn(iso);
  const state = dayState(day, daySessions.length);
  const routine = findRoutine(typeof day?.routineId === 'string' ? day.routineId : '');
  const title = dayTitle(day, routine?.name ?? '');
  const type = dayType(day);
  const isToday = iso === today();

  return (
    <article
      id={`cal-${iso}`}
      class={`cal-day ${state}${isToday ? ' today' : ''}${selected ? ' sel' : ''}`}
    >
      <div class="cal-day-head">
        <span class="cal-day-when">
          <b>{dow(iso)}</b> <span class="num">{parse(iso).getDate()}</span>
          {isToday ? <span class="badge a">hoy</span> : null}
        </span>
        <span class={BADGE_CLASS[state]}>{DAY_STATE_LABEL[state]}</span>
      </div>

      <span class="chip cal-type">
        <Icon name={type ? TYPE_ICON[type] : 'calendar'} />
        {dayTypeLabel(day, state)}
      </span>

      <div class="cal-day-title" title={title}>
        {title || 'Sin plan todavía'}
      </div>

      <RoutineSelect iso={iso} day={day} />

      {daySessions.length ? <SessionRow session={daySessions[0]} /> : null}

      <DayActions iso={iso} state={state} />
    </article>
  );
}

/** Franja de 7 columnas (el `week-strip` de la v1): de un vistazo y para saltar a un día. */
function WeekStrip({
  days,
  selected,
  onSelect,
}: {
  days: string[];
  selected: string | null;
  onSelect: (iso: string) => void;
}) {
  const todayIso = today();
  return (
    <div class="week-strip">
      {days.map((iso) => {
        const day = schedule.value[iso];
        const daySessions = sessionsOn(iso);
        const state = dayState(day, daySessions.length);
        const routine = findRoutine(typeof day?.routineId === 'string' ? day.routineId : '');
        const title = dayTitle(day, routine?.name ?? '');
        const vol = daySessions.reduce((sum, s) => sum + volumeOf(s), 0);
        return (
          <button
            key={iso}
            type="button"
            class={`day-cell ${STRIP_CLASS[state]}${iso === todayIso ? ' today' : ''}${
              selected === iso ? ' sel' : ''
            }`}
            title={title || dateLabel(iso)}
            onClick={() => onSelect(iso)}
          >
            <span class="dnum">{parse(iso).getDate()}</span>
            <span class="ddow">{dow(iso)}</span>
            <span class="dtag">{title || (iso === todayIso ? 'hoy' : 'libre')}</span>
            <span class="dvol">
              {vol ? fmtVol(vol) : state === 'done' ? 'hecho' : dayTypeLabel(day, state)}
            </span>
            <span class="dstat" />
          </button>
        );
      })}
    </div>
  );
}

/** Vista de semana: resumen, franja, estado vacío (si no hay nada planeado) y tarjetas. */
function WeekView({
  cursor,
  selected,
  onSelect,
  onGenerate,
  loading,
}: {
  cursor: string;
  selected: string | null;
  onSelect: (iso: string) => void;
  onGenerate: () => void;
  loading: boolean;
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
        />
        <Kpi
          label="Planificados"
          value={fmtN(counts.planned, 0)}
          delta={`${counts.done} completados`}
        />
        <Kpi label="Series" value={fmtN(sets, 0)} delta={`${minutes} min`} />
      </div>

      <WeekStrip days={days} selected={selected} onSelect={onSelect} />

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
          <div class="tiny">Arrastra o asigna rutinas a los días</div>
          <div class="cal-empty-actions">
            <button type="button" class="btn sm primary" onClick={onGenerate} disabled={loading}>
              <Icon name="wand" />
              Auto-planificar
            </button>
          </div>
        </div>
      ) : null}

      <div class="cal-days">
        {days.map((iso) => (
          <WeekDayCard key={iso} iso={iso} selected={selected === iso} />
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
  const state = dayState(day, sessionsOn(iso).length);
  const modifier = state === 'free' ? '' : ` cal-${state}`;
  return (
    <button
      type="button"
      class={`month-cell${modifier}${iso === today() ? ' today' : ''}${selected ? ' cal-sel' : ''}`}
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

  return (
    <aside class="cal-detail">
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

      <span class={BADGE_CLASS[state]}>{DAY_STATE_LABEL[state]}</span>

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
              const ex = findExercise(item.exId);
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
      ) : (
        <div class="tiny muted">Sin ejercicios asignados: elige una rutina o genera el plan.</div>
      )}

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

      <DayActions iso={iso} state={state} />
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
 * de la IA) con sus tres salidas: aplicar, regenerar (v1 `cal:regen`, propone
 * otra vez sin tocar el calendario) y descartar.
 */
function PlanCard({
  plan,
  applied,
  onApply,
  onRegen,
  onDiscard,
}: {
  plan: PlanResult;
  /** días que ya escribió ESTA propuesta; `null` = todavía sin aplicar */
  applied: number | null;
  onApply: () => void;
  onRegen: () => void;
  onDiscard: () => void;
}) {
  const preview = plan.preview;
  const origin = planOrigin(preview.source);
  const training = preview.days.filter((d) => d.exercises.length).length;
  return (
    <section class="card accent cal-plan">
      <div class="between">
        <div class="grow">
          <div class="h3">Propuesta de semana</div>
          <div class="tiny muted">{origin.subtitle}</div>
        </div>
        <span class={origin.badge}>{preview.source}</span>
      </div>

      {preview.rationale ? <div class="tiny muted mt-s">{preview.rationale}</div> : null}

      <div class="cal-plan-days mt-s">
        {preview.days.map((d) => (
          <div key={d.iso} class="cal-plan-day">
            <div class="grow">
              <div class="cal-plan-title">
                {dateLabel(d.iso, 'short')} ·{' '}
                {d.title || (d.exercises.length ? 'Entreno' : 'Descanso')}
              </div>
              <div class="tiny muted">
                {[d.focus, d.exercises.join(' · ')].filter(Boolean).join(' — ') || 'sin ejercicios'}
              </div>
            </div>
            <span class="tiny muted num">
              {d.exercises.length ? `${d.exercises.length} ej.` : '—'}
            </span>
          </div>
        ))}
      </div>

      <div class="row wrap mt">
        {applied === null ? (
          <button type="button" class="btn primary grow" onClick={onApply}>
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
      <div class="tiny muted mt-s">
        Se agendarán {training} días de entreno de {preview.days.length}.
      </div>
    </section>
  );
}

export function CalendarView() {
  const [cursor, setCursor] = useState(today());
  const [mode, setMode] = useState<ViewMode>('week');
  const [selected, setSelected] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [applied, setApplied] = useState<number | null>(null);
  const [loading, setLoading] = useState<PlanEngine | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  /* Botón «Con IA» y pie: la key se lee aquí para que el repintado la note
     (es una signal) sin tener que consultarla dentro de cada handler. */
  const controls = planControls(hasApiKey());

  /* «Plan automático» de Hoy: la petición viaja en la signal del helper y se
     consume UNA vez (el `coach:quick` de la v1 llamaba a `autoPlan` de la vista
     del calendario). El efecto también corre al montar, que es como llega la
     petición cuando se cambia de pestaña. */
  const autoRequest = autoPlanRequest.value;
  useEffect(() => {
    const engine = takeAutoPlanRequest();
    if (engine) void requestPlan(engine);
  }, [autoRequest]);

  const weekStart = startOfWeek(cursor);
  const monthLabel = dateLabel(`${cursor.slice(0, 7)}-01`, 'month');
  const rangeLabel =
    mode === 'week'
      ? `${dateLabel(weekStart, 'medium')} – ${dateLabel(addDays(weekStart, 6), 'medium')}`
      : monthLabel;

  function move(delta: number): void {
    setCursor(mode === 'week' ? addDays(cursor, delta * 7) : addMonths(cursor, delta));
  }

  function selectDay(iso: string): void {
    setSelected(selected === iso ? null : iso);
    document.getElementById(`cal-${iso}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /**
   * Plan del dispositivo sobre la semana que se está MIRANDO, igual que
   * `V.autoPlan` de la v1 (`startOfWeek(cursor)`): sin red, sin key y sin
   * promesa. La IA no puede elegir semana (`runCoachTask('plan')` trabaja
   * siempre sobre la de hoy), por eso el salto de cursor es suyo y este no.
   */
  function localPlanJson(): unknown {
    return localWeek({
      settings: settings.value,
      exercises: exercises.value,
      equipment: equipment.value,
      sessions: sessions.value,
      todayIso: today(),
      from: startOfWeek(cursor),
    });
  }

  /** Envoltorio síncrono: los `onClick` no pueden recibir una promesa. */
  function generateLocalPlan(): void {
    void requestPlan('local');
  }

  /**
   * Genera la propuesta y la deja en pantalla. NUNCA escribe el calendario:
   * eso solo lo hace «Aplicar», así que ni «Auto-planificar» ni «Regenerar»
   * pisan lo que ya tenías planificado sin pasar por la tarjeta (v1:
   * `cal:autoplan`/`cal:regen` solo rellenaban `plan`).
   *
   * - `local` → `localWeek` en el dispositivo (cero llamadas).
   * - `ia` → `runCoachTask('plan')`: sin key resuelve en local y con key cae
   *   al plan local si la llamada se cae (auth/red/cuota), así que el botón
   *   «Con IA» nunca puede fallar por falta de configuración.
   */
  async function requestPlan(engine: PlanEngine): Promise<void> {
    if (loading) return;
    setLoading(engine);
    setNotice(null);
    try {
      let parsed: PlanResult | null;
      if (engine === 'ia') {
        const outcome = await runCoachTask('plan');
        /* `payload` es el camino directo (en local ya viene del planificador);
           el texto es la red de seguridad por si el JSON viene en una cercilla */
        parsed = planFromJson(outcome.payload) ?? parsePlan(outcome.text);
        if (parsed && planEngine(parsed.preview.source) === 'local') {
          setNotice({
            kind: 'warn',
            text: hasApiKey()
              ? 'IA no disponible: te dejo el plan local.'
              : 'sin API key: plan local',
          });
        }
      } else {
        parsed = planFromJson(localPlanJson());
      }
      if (!parsed) {
        setNotice({
          kind: 'err',
          text: 'El coach no devolvió un plan que se pueda leer. Prueba a generarlo otra vez.',
        });
        return;
      }
      setPlan(parsed);
      setApplied(null);
      if (engine === 'ia') {
        const first = parsed.preview.days[0]?.iso;
        /* la IA planifica la semana de hoy: la vista salta ahí para verlo */
        if (first) setCursor(first);
      }
    } catch (err) {
      setNotice({
        kind: 'err',
        text: err instanceof Error ? err.message : 'No se pudo generar el plan.',
      });
    } finally {
      setLoading(null);
    }
  }

  /** `cal:apply-plan` de la v1: el ÚNICO sitio donde se escribe el calendario. */
  function applyPlan(): void {
    if (!plan) return;
    const result = applyWeek(plan.raw);
    setApplied(result.days);
    setNotice({
      kind: 'ok',
      text: `Plan aplicado: ${result.days} días, ${result.routines} rutinas`,
    });
  }

  /** `cal:regen` de la v1: otra propuesta (MISMO motor) y vuelta a la tarjeta. */
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
      {notice ? (
        <div class={`cal-notice ${notice.kind}`}>
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
        </div>
      ) : null}

      {plan ? (
        <PlanCard
          plan={plan}
          applied={applied}
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
            onClick={() => setMode('week')}
          >
            Semana
          </button>
          <button
            type="button"
            class={mode === 'month' ? 'on accent' : ''}
            onClick={() => setMode('month')}
          >
            Mes
          </button>
        </div>
      </div>

      <div class="cal-plan-bar">
        <button
          type="button"
          class="btn primary block"
          onClick={generateLocalPlan}
          disabled={loading !== null}
        >
          <Icon name="wand" />
          {loading === 'local' ? 'Generando…' : 'Auto-planificar'}
        </button>
        {controls.ai ? (
          <button
            type="button"
            class="btn block"
            onClick={() => void requestPlan('ia')}
            disabled={loading !== null}
          >
            <Icon name="sparkles" />
            {loading === 'ia' ? 'Generando…' : 'Con IA'}
          </button>
        ) : null}
      </div>
      {controls.foot ? <div class="tiny muted cal-plan-foot">{controls.foot}</div> : null}

      {mode === 'week' ? (
        <WeekView
          cursor={cursor}
          selected={selected}
          onSelect={selectDay}
          onGenerate={generateLocalPlan}
          loading={loading !== null}
        />
      ) : (
        <MonthView cursor={cursor} selected={selected} onSelect={selectDay} />
      )}
    </section>
  );
}
