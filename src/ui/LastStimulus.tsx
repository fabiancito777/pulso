/**
 * «Último estímulo» por grupo muscular: la fila que la v1 montaba dentro del
 * bloque de reparto (`lastTrainedList`, `views-stats.js:76-89`).
 *
 * Va DENTRO de «Reparto por grupo muscular» (por eso entra como `groupExtra`
 * de `ProgressCharts`), no en una tarjeta aparte: el orden de secciones tiene
 * que ser el mismo que en `main`.
 *
 * Lee las signals (`sessions`, `exercises`) como el resto de vistas; los datos
 * y los tonos salen de `progress-helpers`, que es donde se prueban.
 */
import { relative } from '@/domain/dates';
import { exercises, sessions } from '@/state/store';

import { HelpBtn } from './HelpModal';
import { lastStimulusRows } from './progress-helpers';

export function LastStimulus() {
  const rows = lastStimulusRows(sessions.value, exercises.value);
  return (
    <div class="card flush mt">
      <div class="between" style="padding:10px 13px 6px">
        <span class="tiny muted" style="font-weight:650">
          Último estímulo
        </span>
        <HelpBtn id="prog.stimulus" title="Último estímulo" />
      </div>
      <div class="list">
        {rows.map((row) => (
          <div key={row.key} class="list-item">
            <span class="badge" style={`background:${row.color}22;color:${row.color}`}>
              {row.label}
            </span>
            <span class="grow tiny muted">
              {row.iso ? `Último estímulo ${relative(row.iso)}` : 'sin datos'}
            </span>
            <span class={`tiny ${row.tone}`}>{row.days === null ? '—' : `${row.days}d`}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
