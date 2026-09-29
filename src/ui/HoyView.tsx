/**
 * Pestaña **Hoy**: el panel diario de la v1 (`legacy/js/views-train.js` →
 * `V.render` sin sesión activa) con el mismo orden de bloques:
 *
 * saludo → hero del día → semana → Recomendado → KPIs 7d → Herramientas →
 * Libre/Elegir rutina → Últimas sesiones → migración.
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
 * - **Sin API key nada falla en silencio**: «Mejorar con IA» avisa y te lleva a
 *   Ajustes (spec `hoy.md`, decisión 9).
 */
import { useEffect, useMemo, useState } from 'preact/hooks';

import { go } from '@/app/router';
import { durationOf, sessionDate, setsOf, totals, volumeOf } from '@/domain/analytics';
import { groupColor, groupLabel } from '@/domain/data';
import { label as dateLabel, dowLong, today } from '@/domain/dates';
import { fmtDur, fmtMmss, fmtN, fmtVol, fmtW } from '@/domain/format';
import { maxLoadable } from '@/domain/plates';
import { clamp, int } from '@/domain/num';
import { unitLabel } from '@/domain/units';
import type { Session } from '@/domain/types';
import { localSuggest } from '@/features/coach/local';
import { parseJSON } from '@/features/coach/parse';
import { applySuggestionAsRoutine, hasApiKey, runCoachTask } from '@/state/coach';
import {
  active,
  rest,
  startFreeSession,
  startFromPlan,
  startFromRoutine,
  startRestTimer,
  stopRestTimer,
} from '@/state/session';
import {
  equipment,
  exercises,
  routines,
  schedule,
  sessions,
  setDay,
  settings,
} from '@/state/store';
import { restDayPatch } from './calendar-helpers';
import { ExercisePickerModal } from './ExercisePickerModal';
import {
  greeting,
  lastSessions,
  planRows,
  repeatItems,
  suggestionPlan,
  suggestionRows,
  suggestionSource,
  todayPlan,
  weekCells,
  weekKpis,
} from './hoy-helpers';
import type { TodayPlan } from './hoy-helpers';
import { Icon } from './Icon';
import { Kpi, SectionHead } from './kit';
import { MigrationCards } from './MigrationCards';
import { PlatesCard } from './PlatesCard';
import { routineSets, toSuggestion } from './routines-helpers';
import type { RoutineSuggestion } from './routines-helpers';
import { toast } from './toast';

import '../styles/hoy.css';

/** Presetas del temporizador libre (las mismas de `ui.timer` de la v1). */
const TIMER_PRESETS = [30, 45, 60, 90, 120, 180, 300];

/** Clase de la celda de la semana por estado (el vocabulario de `base.css`). */
const CELL_CLASS: Record<string, string> = {
  done: 'st-done',
  planned: 'planned',
  rest: 'st-rest',
  skipped: 'st-skip',
  free: '',
};

/** Aviso de la vista (error del coach, rutina creada…) ya con su tono. */
interface Notice {
  kind: 'ok' | 'warn' | 'err';
  text: string;
}

/* ---------- saludo ---------- */

/** Saludo + fecha: el `V.sub` de la v1 (appbar) como línea arriba de Hoy. */
function Greeting({ name }: { name: string }) {
  return (
    <div class="hy-greet">
      <span class="h2">{greeting(new Date().getHours(), name)}</span>
      <span class="tiny muted">· {dateLabel(today())}</span>
    </div>
  );
}

/* ---------- hero del día ---------- */

function Hero({
  plan,
  onStart,
  onSkip,
  onExtra,
}: {
  plan: TodayPlan;
  onStart: () => void;
  onSkip: () => void;
  onExtra: () => void;
}) {
  const now = today();

  if (plan.status === 'done') {
    return (
      <section class="card accent">
        <div class="between">
          <div>
            <div class="h2">Sesión de hoy completada</div>
            <div class="sub">{dateLabel(now)} · sigue así</div>
          </div>
          <Icon name="check-circle" />
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
            <div class="h1">{plan.title || 'Entrenamiento'}</div>
            <div class="sub">
              {plan.items.length} ejercicios · {plan.type || 'entreno'}
            </div>
          </div>
          <span class="badge a">{plan.source === 'ia' ? 'IA' : 'plan'}</span>
        </div>
        <div class="col mt" style="gap:5px">
          {planRows(plan.items, exercises.value).map((row, i) => (
            <div key={`${row.name}-${i}`} class="row" style="gap:8px">
              <span class="grow ellipsis tiny">{row.name}</span>
              <span class="tiny muted num">{row.spec}</span>
            </div>
          ))}
          {plan.items.length > 8 ? (
            <div class="tiny muted">+{plan.items.length - 8} más</div>
          ) : null}
        </div>
        <div class="row mt" style="gap:8px;flex-wrap:wrap">
          <button type="button" class="btn primary grow" onClick={onStart}>
            <Icon name="play" />
            Empezar sesión
          </button>
          <button type="button" class="btn" onClick={onSkip}>
            Saltar
          </button>
        </div>
      </section>
    );
  }

  return (
    <section class="card">
      <div class="between">
        <div>
          <div class="tiny muted hy-kicker">Hoy · {dowLong(now)}</div>
          <div class="h2">Sin plan para hoy</div>
          <div class="sub">Programa la semana o entrena libremente</div>
        </div>
        <Icon name="calendar" />
      </div>
      <div class="row mt" style="gap:8px;flex-wrap:wrap">
        <button type="button" class="btn primary" onClick={() => go('calendario')}>
          <Icon name="calendar" />
          Planificar semana
        </button>
        <button type="button" class="btn" onClick={() => go('coach')}>
          <Icon name="sparkles" />
          Plan automático
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

/* ---------- recomendado ahora ---------- */

function SuggestCard({
  suggestion,
  source,
  loading,
  notice,
  onRefresh,
  onAi,
  onStart,
  onSave,
}: {
  suggestion: RoutineSuggestion | null;
  source: 'ia' | 'local';
  loading: boolean;
  notice: Notice | null;
  onRefresh: () => void;
  onAi: () => void;
  onStart: () => void;
  onSave: () => void;
}) {
  if (!suggestion) {
    return (
      <section class="mt">
        <SectionHead title="Recomendado ahora" />
        <div class="empty">
          <Icon name="sparkles" />
          <div>No hay ninguna sugerencia disponible todavía</div>
          <div class="tiny">Recalcula o programa la semana para empezar</div>
        </div>
      </section>
    );
  }

  const rows = suggestionRows(suggestion, exercises.value);
  const badge =
    source === 'ia' ? { cls: 'badge a', label: 'IA' } : { cls: 'badge', label: 'local' };

  return (
    <section class="mt">
      <SectionHead
        title="Recomendado ahora"
        right={
          <button type="button" class="btn quiet sm" onClick={onRefresh} disabled={loading}>
            <Icon name="refresh" />
            Recalcular
          </button>
        }
      />
      <div class="card accent">
        <div class="between mb">
          <div style="min-width:0">
            <div class="h3">{suggestion.title}</div>
            <div class="tiny muted ellipsis">{suggestion.focus}</div>
          </div>
          <span class={badge.cls}>{badge.label}</span>
        </div>
        <div class="col" style="gap:6px">
          {rows.slice(0, 6).map((row, i) => {
            const color = row.group ? groupColor(row.group) : '';
            return (
              <div key={`${row.name}-${i}`} class="row" style="gap:8px">
                {row.group ? (
                  <span class="badge" style={`background:${color}22;color:${color}`}>
                    {groupLabel(row.group)}
                  </span>
                ) : null}
                <span class="grow ellipsis" style="font-size:13.5px">
                  {row.name}
                </span>
                <span class="tiny muted num">
                  {row.sets}×{row.reps}
                  {row.weight ? ` @ ${fmtN(row.weight)}` : ''}
                </span>
              </div>
            );
          })}
          {rows.length > 6 ? <div class="tiny muted">+{rows.length - 6} ejercicios</div> : null}
        </div>
        {suggestion.rationale.length ? (
          <>
            <div class="divider" />
            <div class="tiny muted">{suggestion.rationale.slice(0, 3).join(' · ')}</div>
          </>
        ) : null}
        {notice ? (
          <div class={`tiny ${notice.kind === 'err' ? 'danger' : notice.kind} mt-s`}>
            {notice.text}
          </div>
        ) : null}
        <div class="col mt-s" style="gap:8px">
          <button type="button" class="btn primary block" onClick={onStart}>
            {loading ? 'Pensando…' : 'Empezar ahora'}
          </button>
          <div class="grid c2" style="gap:8px">
            <button type="button" class="btn sm block" onClick={onAi} disabled={loading}>
              <Icon name="sparkles" />
              Mejorar con IA
            </button>
            <button type="button" class="btn sm ghost block" onClick={onSave}>
              Guardar rutina
            </button>
          </div>
        </div>
        <div class="tiny muted mt-s">
          Origen: {source === 'ia' ? 'IA del coach' : 'cálculo local'} · «Guardar rutina» la copia a
          Rutinas
        </div>
      </div>
    </section>
  );
}

/* ---------- KPIs de 7 días ---------- */

function Kpis({
  volume,
  sessions: count,
  sets,
  minutes,
  deltaPct,
  objective,
}: ReturnType<typeof weekKpis>) {
  return (
    <section class="mt">
      <div class="grid c3">
        <Kpi label="Sesiones 7d" value={count} delta={`objetivo ${objective}`} />
        <Kpi
          label="Volumen 7d"
          value={fmtVol(volume)}
          delta={
            deltaPct === null
              ? 'sin comparativa'
              : `${deltaPct > 0 ? '+' : ''}${deltaPct}% vs semana previa`
          }
        />
        <Kpi label="Series 7d" value={sets} delta={`${minutes} min de entreno`} />
      </div>
    </section>
  );
}

/* ---------- herramientas ---------- */

/** Temporizador libre: presets + cuenta atrás, visible sin sesión activa. */
function FreeTimer({ onClose }: { onClose: () => void }) {
  const [sec, setSec] = useState(90);

  /* MIENTRAS corre, la cuenta atrás la pinta el recuadro ÚNICO de descanso (el de
     `SessionCard`, igual que el `#session-rest` de la v1; `App.tsx` lo monta con
     `rest.running`). Aquí solo se avisa y se cancela: dos cuentas atrás para el
     mismo `pulso.rest` sería el duplicado que la v1 esquivaba con un solo nodo. */
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
  const byId = new Map(exercises.value.map((ex) => [ex.id, ex]));
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
            const ex = byId.get(entry.exId);
            const sets = Array.isArray(entry.sets) ? entry.sets : [];
            const text = sets
              .map((set) => {
                /* peso vacío = como el input en blanco de la v1: «×8», no «0×8» */
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
  const byId = new Map(exercises.value.map((ex) => [ex.id, ex]));

  return (
    <section class="mt">
      <SectionHead
        title="Últimas sesiones"
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
                      const ex = byId.get(entry.exId);
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
                  <button
                    type="button"
                    class="list-item tappable"
                    onClick={() => onToggle(session.id)}
                  >
                    <div class="li-main">
                      <div class="li-title">{session.name || 'Entrenamiento'}</div>
                      <div class="li-sub">
                        {dateLabel(sessionDate(session), 'medium')} · {fmtVol(volumeOf(session))} kg
                        · {fmtDur(durationOf(session))}
                        {groups ? ` · ${groups}` : ''}
                      </div>
                    </div>
                    <span
                      class="icon-btn"
                      role="button"
                      title="Repetir"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRepeat(session);
                      }}
                    >
                      <Icon name="refresh" />
                    </span>
                    <Icon name="chev-r" />
                  </button>
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
  const library = exercises.value;
  const plan = todayPlan(schedule.value[now], routines.value, list, now);
  const stats = totals(list, now);

  const [tool, setTool] = useState<'plates' | 'timer' | null>(null);
  const [openSession, setOpenSession] = useState<string | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [routinePick, setRoutinePick] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [ai, setAi] = useState<{
    raw: unknown;
    sug: RoutineSuggestion;
    source: 'ia' | 'local';
  } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  /* La sugerencia local se recalcula cuando cambia el historial (o cuando
     pides «Recalcular»): la IA solo entra como sustitución encima. */
  const localRaw = useMemo(
    () =>
      localSuggest({
        settings: s,
        exercises: library,
        equipment: equipment.value,
        sessions: list,
        todayIso: now,
      }),
    [list.length, nonce],
  );
  const localSug = useMemo(() => toSuggestion(localRaw, library), [localRaw, library]);

  useEffect(() => {
    setAi(null);
    setNotice(null);
  }, [list.length]);

  const suggestion = ai ? ai.sug : localSug;
  const raw = ai ? ai.raw : localRaw;
  const source = ai ? ai.source : suggestionSource(localRaw);

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
    setDay(now, restDayPatch());
    toast('Día marcado como descanso', { kind: 'ok', ms: 1600 });
  }

  function repeat(session: Session): void {
    startFromPlan(repeatItems(session), {
      name: session.name || 'Entrenamiento',
      dayIso: now,
    });
    toast('Sesión cargada con los pesos anteriores', { kind: 'ok' });
  }

  function startSuggestion(): void {
    if (!suggestion) return;
    const items = suggestionPlan(suggestion);
    if (!items.length) {
      toast('La sugerencia no tiene ejercicios reconocibles', { kind: 'warn' });
      return;
    }
    startFromPlan(items, { name: suggestion.title, dayIso: now });
  }

  function saveSuggestion(): void {
    if (!suggestion) return;
    const created = applySuggestionAsRoutine(raw);
    if (!created) {
      setNotice({
        kind: 'err',
        text: 'No se pudo guardar: ningún ejercicio de la lista está en tu biblioteca.',
      });
      return;
    }
    setNotice({ kind: 'ok', text: `Rutina creada: ${created.name}` });
    toast(`Rutina creada: ${created.name}`, { kind: 'ok' });
  }

  /** `Mejorar con IA`: sin key ni se intenta (nunca un throw silencioso). */
  async function improveWithAi(): Promise<void> {
    if (aiLoading) return;
    if (!hasApiKey()) {
      setNotice({
        kind: 'warn',
        text: 'Configura tu API key de Gemini para mejorar la sugerencia con IA.',
      });
      go('ajustes', 'coach');
      return;
    }
    setAiLoading(true);
    try {
      const outcome = await runCoachTask('suggest');
      /* `payload` viene ya parseado del coach; el texto es la red de seguridad
         (si el modelo devolvió el JSON embebido en ```consulta`). */
      let payload: unknown = outcome.payload;
      if (payload === undefined) {
        try {
          payload = parseJSON<unknown>(outcome.text);
        } catch {
          payload = null;
        }
      }
      const parsed = toSuggestion(payload, library);
      if (!parsed) {
        setNotice({ kind: 'err', text: 'El coach no devolvió una sugerencia legible.' });
        return;
      }
      /* Si la red/cuota cayó, `runCoachTask` resuelve con el planificador local
         y el payload lo dice: el toast no puede prometer IA en ese caso. */
      const nextSource = suggestionSource(payload, 'ia');
      setAi({ raw: payload, sug: parsed, source: nextSource });
      setNotice(null);
      if (nextSource === 'ia') {
        toast('Sugerencia mejorada con IA', { kind: 'ok' });
      } else {
        toast('Sugerencia regenerada con el plan local (sin IA)', { kind: 'warn' });
      }
    } catch (err) {
      setNotice({
        kind: 'err',
        text: err instanceof Error ? err.message : 'No se pudo contactar con el coach.',
      });
    } finally {
      setAiLoading(false);
    }
  }

  const kpis = weekKpis(list, now, s.daysPerWeek);
  const cells = weekCells(schedule.value, list, now, routines.value);
  const recent = lastSessions(list, 4);
  const load = maxLoadable({ plates: s.plates, bars: s.bars, mode: 'bar' });
  const timerVisible = tool === 'timer' || rest.value.running;

  return (
    <>
      <Greeting name={s.name} />
      <Hero plan={plan} onStart={startToday} onSkip={skipToday} onExtra={() => setPickOpen(true)} />

      <WeekStrip cells={cells} />

      <SuggestCard
        suggestion={suggestion}
        source={source}
        loading={aiLoading}
        notice={notice}
        onRefresh={() => {
          setAi(null);
          setNotice(null);
          setNonce((n) => n + 1);
        }}
        onAi={() => void improveWithAi()}
        onStart={startSuggestion}
        onSave={saveSuggestion}
      />

      <Kpis {...kpis} />

      <section class="mt">
        <SectionHead title="Herramientas" />
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
        {timerVisible ? <FreeTimer onClose={() => setTool(null)} /> : null}
      </section>

      {plan.status !== 'done' ? (
        <section class="mt">
          <div class="grid c2">
            <button type="button" class="btn lg" onClick={() => setPickOpen(true)}>
              <Icon name="plus" />
              Libre
            </button>
            <button type="button" class="btn lg" onClick={() => setRoutinePick(!routinePick)}>
              <Icon name="list" />
              Elegir rutina
            </button>
          </div>
          {routinePick ? (
            <RoutinePick
              onPick={(routineId) => {
                setRoutinePick(false);
                startFromRoutine(routineId);
              }}
            />
          ) : null}
        </section>
      ) : null}

      <LastSessions
        list={recent}
        stats={stats}
        openId={openSession}
        onToggle={(id) => setOpenSession(openSession === id ? null : id)}
        onRepeat={repeat}
      />

      <div class="mt">
        <MigrationCards />
      </div>

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
