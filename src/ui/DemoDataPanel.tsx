import { demoData, demoMode, demoSessions, clearDemo } from '@/state/store';
import { fmtN, fmtVol } from '@/domain/format';
import { volumeOf } from '@/domain/analytics';
import { weeklySeries } from '@/domain/analytics';

import { Icon } from './Icon';
import { LineChart } from './charts';

/** Entrada a la vista de demostración y resumen aislado de sus datos ficticios. */
export function DemoDataPanel() {
  if (!demoMode.value) {
    return (
      <button
        type="button"
        class="card pg2-demo-entry"
        onClick={() => demoData(8)}
        aria-label="Ver demostración de Progreso"
      >
        <Icon name="chart" />
        <span>
          <strong>Ver demostración</strong>
          <small>Explora Progreso con datos de ejemplo</small>
        </span>
        <span aria-hidden="true">→</span>
      </button>
    );
  }

  const samples = demoSessions.value;
  const sets = samples.reduce(
    (total, session) => total + session.entries.reduce((count, entry) => count + entry.sets.length, 0),
    0,
  );
  const volume = samples.reduce((total, session) => total + volumeOf(session), 0);
  const weeks = weeklySeries(samples, 8);
  return (
    <section class="card pg2-demo-view">
      <header class="row between">
        <div>
          <div class="eyebrow">Vista de demostración</div>
          <h2>Progreso con datos de ejemplo</h2>
        </div>
        <span class="badge">No se mezcla con tus entrenamientos</span>
      </header>
      <p class="muted">
        Estos datos son temporales y solo aparecen mientras exploras esta vista.
      </p>
      <div class="pg2-week-stats">
        <div><strong>{fmtN(samples.length, 0)}</strong><span>sesiones</span></div>
        <div><strong>{fmtN(sets, 0)}</strong><span>series</span></div>
        <div><strong>{fmtVol(volume)} <small>kg</small></strong><span>volumen</span></div>
      </div>
      <div class="pg2-demo-chart">
        <h3>Volumen por semana</h3>
        <LineChart
          series={[{ name: 'Volumen', points: weeks.map((week) => ({ label: week.label, value: week.volume })) }]}
          format="vol"
          zero
          area
          ariaLabel="Volumen de ejemplo por semana"
          empty="Sin sesiones de ejemplo en este periodo"
        />
      </div>
      <div class="pg2-demo-chart">
        <h3>Series por semana</h3>
        <LineChart
          series={[{ name: 'Series', points: weeks.map((week) => ({ label: week.label, value: week.sets })) }]}
          format="n"
          zero
          area
          ariaLabel="Series de ejemplo por semana"
          empty="Sin sesiones de ejemplo en este periodo"
        />
      </div>
      <div class="row gap-s mt-m">
        <button type="button" class="btn quiet" onClick={clearDemo}>Salir de la demostración</button>
      </div>
    </section>
  );
}
