/**
 * Pestaña **Hoy**: el panel diario  ( →
 * `V.render` sin sesión activa) con el mismo orden de bloques:
 *
 * saludo → hero del día → semana → Herramientas → Últimas sesiones.
 *
 * Decisiones que no se pueden romper sin querer:
 *
 * - **Sin sesión activa pinta la vista; con sesión manda `SessionCard`**: el
 *   guard está al FINAL, después de todos los hooks, para que el orden de los
 *   hooks no cambie cuando empiezas o terminas de entrenar (si no, Preact
 *   descarta el estado del render siguiente).
 * - **El plan se resuelve en `hoy-helpers` puro**, aquí solo se pintan datos y
 *   se lanzan acciones (`startFromRoutine`, `startFromPlan`, `setDay`…).
 * - **Todo lo que late por segundo vive en componentes pequeños**
 *   (`FreeTimer`, el `Clock` de SessionCard): el resto de la vista no debe
 *   repintar cada tic ni reescribir lo que estás mirando.
 * - **Sin modales propios**: el detalle de sesión y el selector de rutina son
 *   paneles en línea; el de ejercicios reutiliza el modal que ya usa
 *   `SessionCard` (`ExercisePickerModal`).
 */
import { useState } from 'preact/hooks';

import { go } from '@/app/router';
import { durationOf, sessionDate, setsOf, totals, volumeOf } from '@/domain/analytics';
import { groupLabel, resolveExercise } from '@/domain/data';
import { label as dateLabel, dowLong, today } from '@/domain/dates';
import { fmtDur, fmtMmss, fmtN, fmtVol, fmtW } from '@/domain/format';
import { maxLoadable } from '@/domain/plates';
import { clamp, int } from '@/domain/num';
import { unitLabel } from '@/domain/units';
import type { Session } from '@/domain/types';
import {
  active,
  rest,
  repeatSession,
  startFreeSession,
  startFromPlan,
  startFromRoutine,
  startRestTimer,
  stopRestTimer,
} from '@/state/session';
import { exercises, routines, schedule, sessions, setDay, settings } from '@/state/store';
import { restoreDayPlanPatch, restDayPatch } from './calendar-helpers';
import { ExercisePickerModal } from './ExercisePickerModal';
import { HelpBtn } from './HelpModal';
import { greeting, lastSessions, planRows, todayPlan, weekCells } from './hoy-helpers';
import type { TodayPlan } from './hoy-helpers';
import { Icon } from './Icon';
import { Kpi, SectionHead } from './kit';
import { PlatesCard } from './PlatesCard';
import { routineSets } from './routines-helpers';
import { toast } from './toast';

import '../styles/hoy.css';

/** Presetas del temporizador libre (las mismas de `ui.timer` ). */
const TIMER_PRESETS = [30, 45, 60, 90, 120, 180, 300];

/** Clase de la celda de la semana por estado (el vocabulario de `base.css`). */
const CELL_CLASS: Record<string, string> = {
  done: 'st-done',
  planned: 'planned',
  rest: 'st-rest',
  skipped: 'st-skip',
  free: '',
};

/* ---------- saludo ---------- */

/** Saludo + fecha: el `V.sub`  (appbar) como línea arriba de Hoy. */
function Greeting({ name }: { name: string }) {
  return (
    <div class="hy-greet">
      <span class="h2">{greeting(new Date().getHours(), name)}</span>
      <span class="tiny muted">· {dateLabel(today())}</span>
      {/* `.hy-greet` alinea por línea base: el ? se centra en su hueco */}
      <span style="align-self:center">
        <HelpBtn id="tab.hoy" title="Hoy" />
      </span>
    </div>
  );
}

/* ---------- hero del día ---------- */

function Hero({
  plan,
  onStart,
  onSkip,
  onRestore,
  onExtra,
  onFree,
  onPickRoutine,
}: {
  plan: TodayPlan;
  onStart: () => void;
  onSkip: () => void;
  onRestore: () => void;
  onExtra: () => void;
  /** «Entrenar libre»: abre el selector de ejercicios. */
  onFree: () => void;
  /** «Elegir rutina»: despliega `RoutinePick` justo debajo del hero. */
  onPickRoutine: () => void;
}) {
  const now = today();

  if (plan.status === 'rest') {
    return (
      <section class="card hy-rest-plan">
        <div class="between">
          <div>
            <div class="tiny muted hy-kicker">Hoy · {dowLong(now)}</div>
            <div class="h2">Día de descanso</div>
            {plan.canRestorePlan ? (
              <div class="sub">El plan se conserva en Calendario</div>
            ) : null}
          </div>
          <Icon name="moon" />
        </div>
        <div class="row mt" style="gap:8px;flex-wrap:wrap">
          {plan.canRestorePlan ? (
            <button type="button" class="btn primary" onClick={onRestore}>
              Restaurar plan
            </button>
          ) : null}
          <button type="button" class="btn ghost" onClick={onFree}>
            Entrenar libre
          </button>
        </div>
      </section>
    );
  }

  if (plan.status === 'done') {
    return (
      <section class="card accent">
        <div class="between">
          <div>
            <div class="h2">Sesión de hoy completada</div>
            <div class="sub">{dateLabel(now)} · sigue así</div>
          </div>
          <div class="row" style="gap:4px">
            <Icon name="check-circle" />
            <HelpBtn id="hoy.plan" title="Plan de hoy" />
          </div>
        </div>
        <div class="row mt" style="gap:8px;flex-wrap:wrap">
          <button type="button" class="btn" onClick={onExtra}>
            <Icon name="plus" />
            Entrenar extra
          </button>
          <button type="button" class="btn ghost" onClick={() => go('progreso')}>
            Ver progreso
          </button>
        </div>
      </section>
    );
  }

  if (plan.items.length) {
    return (
      <section class="card accent">
        <div class="between">
          <div style="min-width:0">
            <div class="tiny muted hy-kicker">Plan de hoy · {dowLong(now)}</div>
            <div class="h1 hy-plan-title">{plan.title || 'Entrenamiento'}</div>
            <div class="sub">
              {plan.items.length} ejercicios ·{' '}
              {plan.items.reduce((sum, item) => sum + int(item.sets, 3), 0)} series
            </div>
          </div>
          <div class="row" style="gap:4px">
            <span class="badge a">{plan.source === 'ia' ? 'IA' : 'plan'}</span>
            <HelpBtn id="hoy.plan" title="Plan de hoy" />
          </div>
        </div>
        <div class="row mt" style="gap:8px;flex-wrap:wrap">
          <button type="button" class="btn primary grow" onClick={onStart}>
            <Icon name="play" />
            Empezar
          </button>
          <details class="hy-plan-menu">
            <summary class="btn">⋯</summary>
            <button type="button" class="btn sm" onClick={onSkip}>
              Saltar · descansar hoy
            </button>
          </details>
          <HelpBtn id="flow.start" title="Empezar a entrenar" />
        </div>
        <details class="hy-plan-details mt-s">
          <summary>Ver los {plan.items.length} ejercicios</summary>
          <div class="col mt-s" style="gap:5px">
            {planRows(plan.items, exercises.value, plan.items.length).map((row, i) => (
              <div key={`${row.name}-${i}`} class="row" style="gap:8px">
                <span class="grow ellipsis tiny">{row.name}</span>
                <span class="tiny muted num">{row.spec}</span>
              </div>
            ))}
          </div>
        </details>
      </section>
    );
  }

  return (
    <section class="card">
      <div class="between">
        <div>
          <div class="tiny muted hy-kicker">Hoy · {dowLong(now)}</div>
          <div class="h2">Sin plan para hoy</div>
          <div class="sub">Entrena libre o elige una de tus rutinas</div>
        </div>
        <div class="row" style="gap:4px">
          <Icon name="calendar" />
          <HelpBtn id="hoy.plan" title="Plan de hoy" />
        </div>
      </div>
      <div class="row mt" style="gap:8px;flex-wrap:wrap">
        <button type="button" class="btn primary" onClick={onFree}>
          <Icon name="plus" />
          Entrenar libre
        </button>
        <button type="button" class="btn" onClick={onPickRoutine}>
          <Icon name="list" />
          Elegir rutina
        </button>
      </div>
    </section>
  );
}

/* ---------- semana ---------- */

function WeekStrip({ cells }: { cells: ReturnType<typeof weekCells> }) {
  return (
    <section class="mt">
      <SectionHead
        title="Semana"
        right={
          <button type="button" class="btn quiet sm" onClick={() => go('calendario')}>
            Calendario
            <Icon name="chev-r" />
          </button>
        }
      />
      <div class="week-strip">
        {cells.map((cell) => (
          <button
            key={cell.iso}
            type="button"
            class={`day-cell ${CELL_CLASS[cell.state] ?? ''}${cell.isToday ? ' today' : ''}`}
            title={`${cell.tag || cell.iso}`}
            onClick={() => go('calendario')}
          >
            <span class="dnum">{int(cell.iso.slice(8), 1)}</span>
            <span class="ddow">{cell.dow}</span>
            <span class="dtag">{cell.tag}</span>
            <span class="dvol">
              {cell.volume ? fmtVol(cell.volume) : cell.state === 'done' ? 'hecho' : ''}
            </span>
            <span class="dstat" />
          </button>
        ))}
      </div>
    </section>
  );
}

/* ---------- herramientas ---------- */

/** Temporizador libre: presets + cuenta atrás, visible sin sesión activa. */
function FreeTimer({ onClose }: { onClose: () => void }) {
  const [sec, setSec] = useState(90);

  /* MIENTRAS corre, la cuenta atrás la pinta el recuadro ÚNICO de descanso (el de
     `SessionCard`, igual que el `#session-rest`; `App.tsx` lo monta con
     `rest.running`). Aquí solo se avisa y se cancela: dos cuentas atrás para el
     mismo `pulso.rest` sería el duplicado que antes esquivaba con un solo nodo. */
  if (rest.value.running) {
    return (
      <div class="card tight mt-s hy-timer">
        <div class="between">
          <div style="min-width:0">
            <div class="tiny muted hy-kicker">Temporizador en marcha</div>
            <div class="tiny muted ellipsis">la cuenta atrás está en el recuadro de descanso</div>
          </div>
          <span class="badge a">crono</span>
        </div>
        <div class="row mt-s" style="gap:8px">
          <button type="button" class="btn sm ghost grow" onClick={stopRestTimer}>
            Cancelar temporizador
          </button>
          <button type="button" class="btn sm quiet" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="card tight mt-s hy-timer">
      <div class="tiny muted hy-hint">
        Elige una duración. El temporizador corre aunque cierres este panel y se ve en el recuadro
        de descanso de arriba.
      </div>
      <div class="hr-scroll">
        {TIMER_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            class={`chip${sec === preset ? ' accent' : ''}`}
            aria-pressed={sec === preset}
            onClick={() => setSec(preset)}
          >
            {fmtMmss(preset)}
          </button>
        ))}
      </div>
      <label class="field mt-s">
        <span class="label">Segundos</span>
        <input
          class="input num"
          type="number"
          min={5}
          max={3600}
          value={String(sec)}
          onChange={(event) => setSec(int(event.currentTarget.value, 90))}
        />
      </label>
      <div class="row mt-s" style="gap:8px">
        <button
          type="button"
          class="btn primary grow"
          onClick={() => {
            const value = clamp(int(sec, 90), 5, 3600);
            startRestTimer(value, 'Temporizador');
            toast(`Temporizador de ${fmtMmss(value)} en marcha`, { kind: 'ok' });
          }}
        >
          Iniciar
        </button>
        <button type="button" class="btn quiet" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </div>
  );
}

/* ---------- últimas sesiones ---------- */

function SessionDetail({ session }: { session: Session }) {
  return (
    <div class="hy-detail">
      <div class="grid c3">
        <Kpi label="Volumen" value={fmtVol(volumeOf(session))} delta="kg movidos" />
        <Kpi
          label="Series"
          value={setsOf(session)}
          delta={`${session.entries.length} ejercicios`}
        />
        <Kpi
          label="Duración"
          value={fmtDur(durationOf(session))}
          delta={session.rpe ? `RPE ${fmtN(session.rpe, 1)}` : 'sin RPE'}
        />
      </div>
      <div class="card flush mt-s">
        <div class="list">
          {session.entries.map((entry, i) => {
            const ex = resolveExercise(exercises.value, entry.exId);
            const sets = Array.isArray(entry.sets) ? entry.sets : [];
            const text = sets
              .map((set) => {
                /* peso vacío = como el input en blanco: «×8», no «0×8» */
                const reps = fmtN(set.reps);
                const load = set.weight === null ? `×${reps}` : `${fmtN(set.weight)}×${reps}`;
                return `${load}${set.rpe ? ` (RPE ${fmtN(set.rpe, 1)})` : ''}`;
              })
              .join(' · ');
            return (
              <div key={`${entry.exId}-${i}`} class="list-item">
                <div class="li-main">
                  <div class="li-title">{ex ? ex.name : entry.name || entry.exId}</div>
                  <div class="li-sub num">{text || 'sin series'}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {session.notes ? (
        <div class="card tight mt-s">
          <div class="tiny muted">Nota</div>
          <div class="tiny">{session.notes}</div>
        </div>
      ) : null}
    </div>
  );
}

function LastSessions({
  list,
  stats,
  openId,
  onToggle,
  onRepeat,
}: {
  list: Session[];
  stats: ReturnType<typeof totals>;
  openId: string | null;
  onToggle: (id: string) => void;
  onRepeat: (session: Session) => void;
}) {
  return (
    <section class="mt">
      <SectionHead
        title="Últimas sesiones"
        help="hoy.lastSessions"
        right={stats.sessions ? `${stats.sessions} en total · racha ${stats.streak} d` : undefined}
      />
      {!list.length ? (
        <div class="empty">
          <Icon name="clock" />
          <div>Aún no hay sesiones registradas</div>
          <div class="tiny">Empieza un entrenamiento y aparecerán aquí</div>
        </div>
      ) : (
        <div class="card flush">
          <div class="list">
            {list.map((session) => {
              const groups = [
                ...new Set(
                  session.entries
                    .map((entry) => {
                      const ex = resolveExercise(exercises.value, entry.exId);
                      return ex ? groupLabel(ex.group) : '';
                    })
                    .filter(Boolean),
                ),
              ]
                .slice(0, 3)
                .join(' · ');
              const open = openId === session.id;
              return (
                <div key={session.id} class={open ? 'hy-session-open' : undefined}>
                  <div class="list-item hy-session-row">
                    <button
                      type="button"
                      class="hy-session-main"
                      aria-expanded={open}
                      onClick={() => onToggle(session.id)}
                    >
                      <span class="li-main">
                        <span class="li-title">{session.name || 'Entrenamiento'}</span>
                        <span class="li-sub">
                          {dateLabel(sessionDate(session), 'medium')} · {fmtVol(volumeOf(session))}{' '}
                          kg · {fmtDur(durationOf(session))}
                          {groups ? ` · ${groups}` : ''}
                        </span>
                      </span>
                      <Icon name="chev-r" />
                    </button>
                    <button
                      type="button"
                      class="icon-btn"
                      title="Repetir"
                      aria-label={`Repetir ${session.name || 'este entrenamiento'}`}
                      onClick={() => onRepeat(session)}
                    >
                      <Icon name="refresh" />
                    </button>
                  </div>
                  {open ? <SessionDetail session={session} /> : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------- selector de rutina en línea ---------- */

function RoutinePick({ onPick }: { onPick: (routineId: string) => void }) {
  const list = routines.value;
  if (!list.length) {
    return (
      <div class="empty mt-s">
        <Icon name="list" />
        <div>No tienes rutinas guardadas todavía</div>
        <button type="button" class="btn sm mt-s" onClick={() => go('rutinas')}>
          Crear una rutina
        </button>
      </div>
    );
  }
  return (
    <div class="card flush mt-s">
      <div class="list">
        {list.map((routine) => (
          <button
            key={routine.id}
            type="button"
            class="list-item tappable"
            onClick={() => onPick(routine.id)}
          >
            <div class="li-main">
              <div class="li-title">{routine.name}</div>
              <div class="li-sub">
                {routine.items.length} ejercicios · {routineSets(routine.items)} series
                {routine.focus ? ` · ${routine.focus}` : ''}
              </div>
            </div>
            <Icon name="play" />
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- la vista ---------- */

export function HoyView() {
  const now = today();
  const s = settings.value;
  const list = sessions.value;
  const plan = todayPlan(schedule.value[now], routines.value, list, now);
  const stats = totals(list, now);

  const [tool, setTool] = useState<'plates' | 'timer' | null>(null);
  const [openSession, setOpenSession] = useState<string | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [routinePick, setRoutinePick] = useState(false);

  /* El guard de sesión activa va DESPUÉS de todos los hooks (ver cabecera). */
  if (active.value) return null;

  function startToday(): void {
    if (!plan.items.length) {
      toast('No hay plan para hoy', { kind: 'warn' });
      return;
    }
    if (plan.routineId) {
      startFromRoutine(plan.routineId);
      return;
    }
    startFromPlan(plan.items, { name: plan.title || 'Entrenamiento', dayIso: now });
  }

  function skipToday(): void {
    setDay(now, restDayPatch(schedule.value[now]));
    toast('Día marcado como descanso', { kind: 'ok', ms: 1600 });
  }

  function restoreToday(): void {
    setDay(now, restoreDayPlanPatch(schedule.value[now]));
    toast('Plan restaurado', { kind: 'ok', ms: 1600 });
  }

  function repeat(session: Session): void {
    if (!repeatSession(session, now)) {
      toast('Termina la sesión actual primero', { kind: 'warn' });
      return;
    }
    toast('Sesión cargada con los pesos anteriores', { kind: 'ok' });
  }

  const cells = weekCells(schedule.value, list, now, routines.value);
  const recent = lastSessions(list, 4);
  const latest = recent[0];
  const load = maxLoadable({ plates: s.plates, bars: s.bars, mode: 'bar' });
  const timerVisible = tool === 'timer' || rest.value.running;

  return (
    <>
      <Greeting name={s.name} />
      <Hero
        plan={plan}
        onStart={startToday}
        onSkip={skipToday}
        onRestore={restoreToday}
        onExtra={() => setPickOpen(true)}
        onFree={() => setPickOpen(true)}
        onPickRoutine={() => setRoutinePick(!routinePick)}
      />

      {latest ? (
        <button
          type="button"
          class="card tight hy-repeat-quick mt-s"
          onClick={() => repeat(latest)}
        >
          <span class="hy-repeat-copy">
            <span class="tiny muted hy-kicker">Última sesión</span>
            <span class="h3">{latest.name || 'Entrenamiento'}</span>
            <span class="tiny muted">
              {dateLabel(sessionDate(latest), 'medium')} · {setsOf(latest)} series
            </span>
          </span>
          <span class="btn sm quiet">
            <Icon name="refresh" /> Repetir sesión
          </span>
        </button>
      ) : null}

      {routinePick ? (
        <RoutinePick
          onPick={(routineId) => {
            setRoutinePick(false);
            startFromRoutine(routineId);
          }}
        />
      ) : null}

      <WeekStrip cells={cells} />

      <section class="hy-tools mt">
        <details class="hy-tools-disclosure" open={tool === 'plates'}>
          <summary class="hy-tools-summary">
            <span class="h3">Herramientas</span>
            <span class="tiny muted">Calculadora de discos · Temporizador</span>
          </summary>
          <div class="hy-tools-help">
            <HelpBtn id="hoy.tools" title="Ayuda sobre herramientas" />
          </div>
          <div class="grid c2">
            <button
              type="button"
              class="card tight"
              style="text-align:left"
              onClick={() => setTool(tool === 'plates' ? null : 'plates')}
            >
              <div class="row">
                <span class="ico accent">
                  <Icon name="plate" />
                </span>
                <div>
                  <div class="h3">Calculadora de discos</div>
                  <div class="tiny muted">
                    máx {fmtW(load.totalKg)} {unitLabel(s.units)} en barra
                  </div>
                </div>
              </div>
            </button>
            <button
              type="button"
              class="card tight"
              style="text-align:left"
              onClick={() => setTool(tool === 'timer' ? null : 'timer')}
            >
              <div class="row">
                <span class="ico accent">
                  <Icon name="timer" />
                </span>
                <div>
                  <div class="h3">Temporizador</div>
                  <div class="tiny muted">descanso libre o isométricos</div>
                </div>
              </div>
            </button>
          </div>
          {tool === 'plates' ? (
            <div class="mt-s">
              <PlatesCard />
            </div>
          ) : null}
        </details>
        {timerVisible ? <FreeTimer onClose={() => setTool(null)} /> : null}
      </section>

      <LastSessions
        list={recent}
        stats={stats}
        openId={openSession}
        onToggle={(id) => setOpenSession(openSession === id ? null : id)}
        onRepeat={repeat}
      />

      {pickOpen ? (
        <ExercisePickerModal
          title="Entrenamiento libre"
          onClose={() => setPickOpen(false)}
          onPick={(ids) => {
            setPickOpen(false);
            if (!ids.length) return;
            startFreeSession({ exIds: ids, name: 'Entrenamiento libre' });
            toast(
              `${ids.length} ${ids.length === 1 ? 'ejercicio añadido' : 'ejercicios añadidos'}`,
              { kind: 'ok' },
            );
          }}
        />
      ) : null}
    </>
  );
}
