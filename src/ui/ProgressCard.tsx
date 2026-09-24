/**
 * Tarjeta de progreso: la cara visible de `src/domain/analytics.ts`.
 *
 * Sirve además de comprobación del port: lee las MISMAS sesiones que guarda la v1
 * en `pulso.state`, así que si estos números cuadran con la pestaña Progreso de la
 * rama `main`, la analítica está bien portada.
 */
import { prs, sessionDate, totals, weeklySeries } from '@/domain/analytics';
import { relative } from '@/domain/dates';
import { fmtDur, fmtN, fmtVol } from '@/domain/format';
import { exercises, sessions } from '@/state/store';

export function ProgressCard() {
  const list = sessions.value;
  const t = totals(list);
  const weeks = weeklySeries(list);
  const records = Object.values(prs(list));
  const dates = list.map(sessionDate).sort();
  const lastDate = dates.length ? (dates[dates.length - 1] ?? null) : null;
  const maxVolume = weeks.reduce((a, w) => Math.max(a, w.volume), 0);

  if (!list.length) {
    return (
      <section class="card">
        <div class="row between mb-s">
          <b>Progreso</b>
          <span class="tiny muted">analítica portada de la v1</span>
        </div>
        <div class="tiny muted">
          No hay sesiones en <code>pulso.state</code>. Entrena desde la rama <code>main</code> (o
          carga los datos de ejemplo) y aquí aparecerán los mismos números.
        </div>
      </section>
    );
  }

  return (
    <section class="card">
      <div class="row between mb-s">
        <b>Progreso</b>
        <span class="tiny muted">analítica portada de la v1</span>
      </div>

      <div class="pg-kpis">
        <Kpi label="Sesiones" value={fmtN(t.sessions, 0)} sub={`desde ${t.firstDate ?? '—'}`} />
        <Kpi label="Volumen" value={fmtVol(t.volume)} sub="kg movidos" />
        <Kpi label="Series" value={fmtN(t.sets, 0)} sub={`media ${fmtDur(t.avgDuration)}`} />
        <Kpi
          label="Racha"
          value={fmtN(t.streak, 0)}
          sub={`mejor ${fmtN(t.bestStreak, 0)} d · ${records.length} récords`}
        />
      </div>

      <div class="pg-chart">
        {weeks.map((w) => (
          <div key={w.iso} class="pg-col" title={`${w.label}: ${fmtVol(w.volume)} kg`}>
            <div class="pg-bar-wrap">
              <div
                class="pg-bar"
                style={{ height: `${maxVolume ? Math.max(3, (w.volume / maxVolume) * 100) : 3}%` }}
              />
            </div>
            <span class="pg-cap">{w.label.split(' ')[1] ?? w.label}</span>
            <span class={`pg-dot ${w.sessions ? 'on' : ''}`} />
          </div>
        ))}
      </div>
      <div class="tiny muted">
        8 semanas · volumen semanal (el mayor de la ventana: {fmtVol(maxVolume)} kg)
        {lastDate ? ` · último entrenamiento ${relative(lastDate)}` : ''}
      </div>

      {records.length ? (
        <div class="mt-s">
          <div class="tiny muted mb-s">Mejores marcas (1RM estimado con Epley)</div>
          {records
            .sort((a, b) => b.e1rm - a.e1rm)
            .slice(0, 3)
            .map((r) => {
              const ex = exercises.value.find((e) => e.id === r.exId);
              return (
                <div key={r.exId} class="kv">
                  <span class="k">{ex ? ex.name : r.exId}</span>
                  <span class="v">
                    {fmtN(r.weight)} × {fmtN(r.reps)} · {fmtN(r.e1rm)} kg
                    <span class="tiny muted"> {relative(r.date)}</span>
                  </span>
                </div>
              );
            })}
        </div>
      ) : null}
    </section>
  );
}

function Kpi(props: { label: string; value: string; sub: string }) {
  return (
    <div class="pg-kpi">
      <div class="pg-kpi-label">{props.label}</div>
      <div class="pg-kpi-value">{props.value}</div>
      <div class="tiny muted">{props.sub}</div>
    </div>
  );
}
