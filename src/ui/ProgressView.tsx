import { useEffect, useState } from 'preact/hooks';

import { go } from '@/app/router';
import { sessionDate } from '@/domain/analytics';
import { resolveExercise } from '@/domain/data';
import { addDays, label as dateLabel, startOfWeek, today } from '@/domain/dates';
import { fmtN, fmtVol } from '@/domain/format';
import { norm } from '@/domain/text';
import { exercises, sessions, demoData } from '@/state/store';
import { pickExercise, pickedExercise } from '@/state/progress';

import { LineChart, ProgressCharts } from './charts';
import { Icon } from './Icon';
import { LastStimulus } from './LastStimulus';
import { PrTableButton } from './PrTableModal';
import { SessionHistory } from './SessionHistory';
import { toast } from './toast';
import {
  currentWeekSummary,
  exerciseProgressSummary,
  historyExerciseIds,
  latestRecords,
} from './progress-helpers';

import '../styles/progreso.css';

function exerciseName(id: string): string {
  const known = resolveExercise(exercises.value, id);
  if (known) return known.name;
  for (const session of sessions.value) {
    const entry = session.entries.find((item) => item.exId === id && item.name);
    if (entry?.name) return entry.name;
  }
  return id;
}

function setLabel(set: { weight: number | null; reps: number }): string {
  return `${set.weight === null ? 'Peso corporal' : `${fmtN(set.weight)} kg`} × ${fmtN(set.reps, 0)}`;
}

function EmptyAction() {
  function loadDemo(): void {
    const added = demoData(8);
    toast(`Datos de ejemplo: ${added} sesiones cargadas`, { kind: 'ok', ms: 4000 });
  }
  return (
    <div class="pg2-empty-action">
      <Icon name="chart" />
      <div class="pg2-empty-title">Aún no hay entrenamientos registrados</div>
      <div class="tiny muted">
        Tu semana, tus récords y la evolución por ejercicio aparecerán aquí después de entrenar.
      </div>
      <button type="button" class="btn primary" onClick={() => go('hoy')}>
        Ir a entrenar
      </button>
      <button type="button" class="btn quiet" onClick={loadDemo}>
        Cargar datos de ejemplo
      </button>
    </div>
  );
}

function WeekCard() {
  const week = currentWeekSummary(sessions.value, today());
  const start = startOfWeek(today());
  const end = addDays(start, 6);
  return (
    <section class="card pg2-week">
      <div class="row between mb-s">
        <h2>Esta semana</h2>
        <span class="tiny muted">
          {dateLabel(start, 'short')}–{dateLabel(end, 'short')}
        </span>
      </div>
      {week.sessions ? (
        <div class="pg2-week-stats">
          <div>
            <strong>{fmtN(week.sessions, 0)}</strong>
            <span>sesiones</span>
          </div>
          <div>
            <strong>{fmtN(week.sets, 0)}</strong>
            <span>series</span>
          </div>
          <div>
            <strong>
              {fmtVol(week.volume)} <small>kg</small>
            </strong>
            <span>volumen</span>
          </div>
        </div>
      ) : (
        <div class="pg2-section-empty">Sin sesiones esta semana</div>
      )}
    </section>
  );
}

function RecentRecords() {
  const records = latestRecords(sessions.value, 3);
  return (
    <section class="card">
      <h2 class="mb-s">Últimos récords</h2>
      {records.length ? (
        <div class="pg2-record-list">
          {records.map((record) => (
            <button
              type="button"
              class="pg2-record"
              key={record.exId}
              onClick={() => pickExercise(record.exId)}
            >
              <span class="pg2-record-name">{exerciseName(record.exId)}</span>
              <span class="pg2-record-value">
                {fmtN(record.weight)} kg × {fmtN(record.reps, 0)}
              </span>
              <span class="tiny muted">{dateLabel(record.date, 'medium')}</span>
            </button>
          ))}
        </div>
      ) : (
        <div class="pg2-section-empty">
          Completa una serie con peso para registrar tu primer récord.
        </div>
      )}
      <PrTableButton />
    </section>
  );
}

function ExerciseProgress() {
  const ids = historyExerciseIds(sessions.value);
  const rawOptions = ids.map((id) => ({ id, name: exerciseName(id) }));
  const options = rawOptions.map((option) => ({
    ...option,
    label:
      rawOptions.filter((other) => norm(other.name) === norm(option.name)).length > 1
        ? `${option.name} · ${option.id}`
        : option.name,
  }));
  const mostRecentWithSets =
    [...sessions.value]
      .sort((a, b) => {
        const ta = Date.parse(a.endedAt ?? a.startedAt);
        const tb = Date.parse(b.endedAt ?? b.startedAt);
        return (
          (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0) ||
          sessionDate(b).localeCompare(sessionDate(a))
        );
      })
      .flatMap((session) =>
        session.entries
          .filter((entry) => entry.sets.some((set) => set.done && set.reps > 0))
          .map((entry) => entry.exId),
      )[0] ?? null;
  const chosenId =
    pickedExercise.value && ids.includes(pickedExercise.value)
      ? pickedExercise.value
      : mostRecentWithSets;
  const chosen = options.find((item) => item.id === chosenId) ?? null;
  const [query, setQuery] = useState(chosen?.name ?? '');
  useEffect(() => {
    const picked = options.find((item) => item.id === pickedExercise.value);
    if (picked) setQuery(picked.name);
  }, [pickedExercise.value]);
  const shown = options.filter((item) => !query || norm(item.name).includes(norm(query)));
  const exactMatches = options.filter((item) => norm(item.name) === norm(query));
  const exactQuery =
    exactMatches.length === 1
      ? exactMatches[0]
      : exactMatches.find((item) => item.id === pickedExercise.value);
  const selected = exactQuery ?? (query ? null : chosen);
  const stats = selected ? exerciseProgressSummary(sessions.value, selected.id) : null;
  const chartPoints = (stats?.trend ?? [])
    .filter((point) => point.e1rm > 0)
    .slice(-8)
    .map((point) => ({ label: dateLabel(point.date, 'short'), value: point.e1rm }));
  const estimable = chartPoints.length > 0;
  const showOptions = shown.length > 0 && (!query || exactMatches.length > 1 || !exactQuery);

  const choose = (id: string): void => {
    const item = options.find((option) => option.id === id);
    if (!item) return;
    pickExercise(id);
    setQuery(item.name);
  };

  return (
    <section class="card pg2-exercise" id="pg2-exercise-progress">
      <label class="pg2-label" for="pg2-exercise-search">
        Progreso por ejercicio
      </label>
      <input
        id="pg2-exercise-search"
        class="input pg2-exercise-search"
        type="search"
        aria-label="Buscar ejercicio en el historial"
        autocomplete="off"
        placeholder="Buscar ejercicio"
        value={query}
        onInput={(event) => {
          const value = event.currentTarget.value;
          setQuery(value);
          const matches = options.filter((item) => norm(item.name) === norm(value));
          if (matches.length === 1) pickExercise(matches[0].id);
        }}
      />
      {showOptions ? (
        <div class="pg2-exercise-options" aria-label="Coincidencias de ejercicios">
          {shown.slice(0, 6).map((item) => (
            <button type="button" key={item.id} onClick={() => choose(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      {query && !shown.length ? (
        <div class="pg2-section-empty">Sin coincidencias en el historial.</div>
      ) : null}
      {!ids.length ? (
        <div class="pg2-section-empty">
          El historial de ejercicios aparecerá aquí cuando completes entrenamientos.
        </div>
      ) : null}
      {ids.length && !selected ? (
        <div class="pg2-section-empty">Elige un ejercicio del historial para ver su evolución.</div>
      ) : null}
      {selected && stats ? (
        <div class="pg2-exercise-result" aria-live="polite">
          <div class="pg2-exercise-stats">
            <div>
              <span>Última · {dateLabel(stats.date, 'medium')}</span>
              <strong>{setLabel(stats.latest)}</strong>
            </div>
            <div>
              <span>Mejor marca</span>
              <strong>
                {stats.best.weight === null
                  ? `${fmtN(stats.best.reps, 0)} reps`
                  : `${fmtN(stats.best.weight)} kg × ${fmtN(stats.best.reps, 0)}`}
              </strong>
            </div>
          </div>
          <div class="tiny muted pg2-trend-heading">1RM estimado · últimas sesiones con carga</div>
          {estimable ? (
            <LineChart
              series={[
                {
                  name: '1RM estimado',
                  color: 'var(--accent)',
                  points: chartPoints,
                },
              ]}
              format="w"
              height={126}
              ariaLabel={`Tendencia de 1RM estimado de ${selected.name}`}
            />
          ) : (
            <div class="pg2-section-empty">Sin cargas registradas para estimar el 1RM.</div>
          )}
        </div>
      ) : null}
    </section>
  );
}

export function ProgressView() {
  if (!sessions.value.length) {
    return <EmptyAction />;
  }

  return (
    <div class="pg2-view">
      <WeekCard />
      <RecentRecords />
      <ExerciseProgress />
      <details class="card pg2-statistics">
        <summary>Ver estadísticas</summary>
        <div class="pg2-statistics-body">
          <div class="tiny muted">
            Elige un periodo para consultar volumen, sesiones, grupos musculares, progresión y
            consistencia.
          </div>
          <ProgressCharts groupExtra={<LastStimulus />} prExtra={<PrTableButton />} />
        </div>
      </details>
      <SessionHistory />
    </div>
  );
}
