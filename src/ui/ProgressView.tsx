/**
 * Montaje único de la pestaña Progreso (spec S1 §3.1).
 *
 * Cabecera (`ProgressCard`, reconvertido en el sub de la v1) → gráficos
 * (`ProgressCharts` con el último estímulo dentro del reparto por grupo y el
 * botón de la tabla completa bajo los récords) → historial de sesiones con su
 * detalle, su borrado y la repetición.
 *
 * Guard de estado vacío: sin sesiones NO se monta `ProgressCharts` (así no hay
 * dos empty-states seguidos) y se pintan SOLO los dos botones de la v1
 * («Ir a entrenar» y «Cargar datos de ejemplo»). Al cargar el ejemplo cambia
 * `sessions` y todo lo demás se repinta solo (signals): no hay que refrescar
 * nada a mano.
 */
import { go } from '@/app/router';
import { demoData, sessions } from '@/state/store';

import { Icon } from './Icon';
import { LastStimulus } from './LastStimulus';
import { PrTableButton } from './PrTableModal';
import { ProgressCard } from './ProgressCard';
import { SessionHistory } from './SessionHistory';
import { toast } from './toast';
import { ProgressCharts } from './charts';

import '../styles/progreso.css';

function EmptyProgress() {
  function loadDemo(): void {
    const added = demoData(8);
    toast(`Datos de ejemplo: ${added} sesiones cargadas`, { kind: 'ok', ms: 4000 });
  }

  return (
    <div class="empty">
      <Icon name="chart" />
      <div>Sin datos todavía</div>
      <div class="tiny">
        Registra sesiones para desbloquear gráficos, récords y análisis de volumen por grupo
        muscular.
      </div>
      <div class="row mt" style="gap:8px;justify-content:center;flex-wrap:wrap">
        <button type="button" class="btn primary" onClick={() => go('hoy')}>
          Ir a entrenar
        </button>
        <button type="button" class="btn ghost" onClick={loadDemo}>
          Cargar datos de ejemplo
        </button>
      </div>
    </div>
  );
}

export function ProgressView() {
  if (!sessions.value.length) return <EmptyProgress />;

  return (
    <>
      <ProgressCard />
      <section class="card">
        <div class="row between mb-s">
          <b>Gráficos</b>
          <span class="tiny muted">charts.js portado · SVG sin librerías</span>
        </div>
        <ProgressCharts groupExtra={<LastStimulus />} prExtra={<PrTableButton />} />
      </section>
      <SessionHistory />
    </>
  );
}
