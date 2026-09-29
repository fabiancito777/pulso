/**
 * Cabecera de la pestaña Progreso.
 *
 * Antes era una tarjeta de "comprobación del port" con sus propios KPIs y sus
 * barras de volumen, que salían DUPLICADOS junto a los de `ProgressCharts` (la
 * única rejilla que replica a la v1). Ahora es la cabecera de la pestaña: el
 * subtítulo `V.sub` de la v1 (`N sesiones · N kg movidos · racha N días`) y la
 * fecha desde la que hay datos; los KPIs y los gráficos viven en
 * `ProgressCharts`, que es donde los pinta la v1 también.
 *
 * Su estado vacío se fue a `ProgressView`, que monta este componente SOLO si
 * hay sesiones.
 */
import { totals } from '@/domain/analytics';
import { label as dateLabel } from '@/domain/dates';
import { fmtN, fmtVol } from '@/domain/format';
import { sessions } from '@/state/store';

/** El `V.sub` de la v1 (`views-stats.js:13-17`), en componentes. */
function subtitle(count: number, volume: number, streak: number): string {
  if (!count) return 'Aún sin datos · empieza a entrenar';
  return `${fmtN(count, 0)} sesiones · ${fmtVol(volume)} kg movidos · racha ${fmtN(streak, 0)} días`;
}

export function ProgressCard() {
  const t = totals(sessions.value);

  return (
    <section class="card">
      <div class="row between mb-s">
        <b>Progreso</b>
        <span class="tiny muted">
          {t.firstDate ? `Desde ${dateLabel(t.firstDate, 'medium')}` : ''}
        </span>
      </div>
      <div class="tiny muted">{subtitle(t.sessions, t.volume, t.streak)}</div>
    </section>
  );
}
