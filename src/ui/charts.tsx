/**
 * Gráficos de progreso de la v1 como componentes Preact, sin librerías.
 *
 * Port de `legacy/js/charts.js` (barras, línea/área, donut, barras horizontales,
 * heatmap de consistencia y sparkline) con el mismo look, los mismos datos y el
 * mismo orden de secciones que `legacy/js/views-stats.js`.
 *
 * Decisión de API: los gráficos son componentes **PROPS puros** (los datos entran
 * por parámetro) para poder reutilizarlos desde cualquier tarjeta; el único que
 * lee signals es `ProgressCharts()`, el contenedor que monta la pestaña
 * Progreso entera a partir de `sessions`/`exercises` del store y de las métricas
 * de `domain/analytics`. El volumen se muestra SIEMPRE en kg, igual que la v1,
 * así que `settings` no hace falta aquí.
 *
 * El ancho no se mide: la v1 repintaba con `mountAll` midiendo `clientWidth`,
 * aquí todo va en un `viewBox` con `width:100%` y se escala al contenedor. El
 * heatmap y la sparkline conservan su tamaño natural (`max-width:100%`) porque
 * en la v1 tampoco crecían con la tarjeta.
 *
 * Tooltips: `<title>` SVG nativo (se ve al pasar el ratón y es lo que usa la
 * accesibilidad), colores con `var(--…)` de `base.css` y ejes con `fmtN`.
 */
import { useState } from 'preact/hooks';

import {
  byDow,
  exerciseSeries,
  groupSets,
  groupVolume,
  prs,
  sessionDate,
  sessionsSince,
  totals,
  weeklySeries,
} from '@/domain/analytics';
import { GROUPS, findExercise, groupColor } from '@/domain/data';
import { dowIdx, label as dateLabel, today } from '@/domain/dates';
import { fmtDur, fmtN, fmtVol } from '@/domain/format';
import { max as maxOf, sum } from '@/domain/num';
import { exercises, sessions } from '@/state/store';

import {
  barsEmpty,
  barLayout,
  donutLayout,
  fmtVal,
  heatLayout,
  lineLayout,
  niceMax,
  r1,
  sparkPath,
  targetY,
} from './charts-helpers';
import type { BarDatum, ChartFormat, DonutDatum, HeatCell, LineSeries } from './charts-helpers';
import { Icon } from './Icon';
import { Kpi, SectionHead } from './kit';

import '../styles/charts.css';

const EMPTY_MSG = 'Sin datos todavía';

function ChartEmpty({ msg }: { msg?: string }) {
  return (
    <div class="ch-empty">
      <div class="tiny">{msg ?? EMPTY_MSG}</div>
    </div>
  );
}

/* ---------- barras verticales ---------- */

export interface BarChartProps {
  data: readonly BarDatum[];
  /** formato de ejes y valores (por defecto `w` = un decimal) */
  format?: ChartFormat;
  height?: number;
  /** color por defecto de las barras (`var(--…)` de base.css) */
  color?: string;
  /** valores sobre cada barra (la v1 solo los pinta con hueco de más de 26 px) */
  showValues?: boolean;
  /** `false` = barras casi pegadas */
  gap?: boolean;
  /** línea discontinua de objetivo */
  target?: number;
  empty?: string;
  ariaLabel?: string;
  class?: string;
}

export function BarChart(props: BarChartProps) {
  if (barsEmpty(props.data)) return <ChartEmpty msg={props.empty} />;
  const l = barLayout(props.data, { height: props.height, gap: props.gap });
  const fmt = props.format ?? 'w';
  const base = props.color ?? 'var(--accent)';
  const right = l.width - 6;
  const ty = props.target !== undefined ? targetY(l, props.target) : 0;
  const showTarget = props.target !== undefined && ty > l.padT;
  const tipOf = (r: (typeof l.rects)[number]): string => {
    const d = props.data[r.index];
    return d?.tip ?? `${r.label}: ${fmtVal(r.value, fmt)}`;
  };
  return (
    <div class={props.class ? `ch-wrap ${props.class}` : 'ch-wrap'}>
      <svg
        viewBox={`0 0 ${l.width} ${l.height}`}
        role="img"
        aria-label={props.ariaLabel ?? 'Gráfico de barras'}
      >
        {l.ticks.map((t, i) => (
          <g key={`t${i}`}>
            <line class="ct-grid" x1={l.padL} y1={t.y} x2={right} y2={t.y} />
            <text class="ct-axis" x={l.padL - 6} y={r1(t.y + 3.2)} text-anchor="end">
              {fmtVal(t.v, fmt)}
            </text>
          </g>
        ))}
        {l.rects.map((r) => (
          <g key={`b${r.index}`}>
            <rect
              x={r.x}
              y={r.y}
              width={r.w}
              height={r.h}
              rx="3"
              fill={r.color ?? base}
              opacity={r.dim ? 0.35 : 1}
            >
              <title>{tipOf(r)}</title>
            </rect>
            {props.showValues && l.slot > 26 ? (
              <text
                class="ct-axis"
                x={r1(l.padL + l.slot * r.index + l.slot / 2)}
                y={r1(r.y - 4)}
                text-anchor="middle"
              >
                {fmtVal(r.value, fmt)}
              </text>
            ) : null}
          </g>
        ))}
        {showTarget ? (
          <line
            x1={l.padL}
            y1={ty}
            x2={right}
            y2={ty}
            stroke="var(--muted-2)"
            stroke-dasharray="3 4"
            stroke-width="1.2"
          />
        ) : null}
        {l.rects.map((r) =>
          r.index % l.labelStep === 0 || r.index === l.rects.length - 1 ? (
            <text
              class="ct-axis"
              key={`x${r.index}`}
              x={r1(l.padL + l.slot * r.index + l.slot / 2)}
              y={l.height - 6}
              text-anchor="middle"
            >
              {r.label}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

/* ---------- línea / área ---------- */

export interface LineChartProps {
  series: readonly LineSeries[];
  format?: ChartFormat;
  height?: number;
  /** relleno bajo la línea (solo con una serie, como en la v1) */
  area?: boolean;
  /** etiqueta con el último valor (por defecto sí) */
  showLast?: boolean;
  /** eje arrancando en 0 */
  zero?: boolean;
  /** suelo del eje Y */
  min?: number;
  empty?: string;
  ariaLabel?: string;
  class?: string;
}

export function LineChart(props: LineChartProps) {
  const l = lineLayout(props.series, {
    height: props.height,
    min: props.min,
    zero: props.zero,
    area: props.area,
  });
  if (!l.series.length) return <ChartEmpty msg={props.empty} />;
  const fmt = props.format ?? 'w';
  const showLast = props.showLast !== false;
  return (
    <div class={props.class ? `ch-wrap ${props.class}` : 'ch-wrap'}>
      <svg
        viewBox={`0 0 ${l.width} ${l.height}`}
        role="img"
        aria-label={props.ariaLabel ?? 'Gráfico de líneas'}
      >
        {l.ticks.map((t, i) => (
          <g key={`t${i}`}>
            <line class="ct-grid" x1={l.padL} y1={t.y} x2={l.width - 10} y2={t.y} />
            <text class="ct-axis" x={l.padL - 6} y={r1(t.y + 3.2)} text-anchor="end">
              {fmtVal(t.v, fmt)}
            </text>
          </g>
        ))}
        {l.series.map((s, si) => (
          <g key={`s${si}`}>
            {s.area ? <path d={s.area} fill={s.color} opacity=".12" stroke="none" /> : null}
            <path class="ct-line" d={s.path} stroke={s.color} />
            {s.dots
              .filter((d) => !d.hidden)
              .map((d, di) => (
                <g key={`d${si}-${di}`}>
                  <circle
                    class="ct-dot"
                    cx={d.x}
                    cy={d.y}
                    r={d.r}
                    fill="var(--surface)"
                    stroke={s.color}
                  >
                    <title>{`${d.label}: ${fmtVal(d.value, fmt)}`}</title>
                  </circle>
                  {d.last && showLast ? (
                    <text class="ct-axis" x={r1(d.x - 2)} y={r1(d.y - 8)} text-anchor="end">
                      {fmtVal(d.value, fmt)}
                    </text>
                  ) : null}
                </g>
              ))}
          </g>
        ))}
        {l.xLabels.map((t) => (
          <text class="ct-axis" key={`x${t.i}`} x={t.x} y={l.height - 6} text-anchor={t.anchor}>
            {t.text}
          </text>
        ))}
      </svg>
    </div>
  );
}

/* ---------- donut ---------- */

export interface DonutChartProps {
  data: readonly DonutDatum[];
  center?: { value: string; label?: string };
  size?: number;
  thickness?: number;
  empty?: string;
  ariaLabel?: string;
}

export function DonutChart(props: DonutChartProps) {
  const l = donutLayout(props.data, { size: props.size, thickness: props.thickness });
  if (!l.total) return <ChartEmpty msg={props.empty} />;
  const c = l.size / 2;
  return (
    <div class="ch-donut">
      <svg
        viewBox={`0 0 ${l.size} ${l.size}`}
        role="img"
        aria-label={props.ariaLabel ?? 'Reparto por grupo muscular'}
      >
        <circle cx={c} cy={c} r={l.r} fill="none" stroke="var(--surface-3)" stroke-width={l.sw} />
        {l.segments.map((s) => (
          <circle
            key={s.label}
            cx={c}
            cy={c}
            r={l.r}
            fill="none"
            stroke={s.color}
            stroke-width={l.sw}
            stroke-dasharray={s.dash}
            stroke-dashoffset={s.dashoffset}
            transform={`rotate(-90 ${c} ${c})`}
            stroke-linecap="butt"
          >
            <title>{`${s.label}: ${fmtVal(s.value, 'vol')} kg · ${s.pct}%`}</title>
          </circle>
        ))}
        {props.center ? (
          <g>
            <text
              x={c}
              y={r1(c - 2)}
              text-anchor="middle"
              fill="var(--text)"
              style="font-family:var(--mono);font-size:19px;font-weight:650"
            >
              {props.center.value}
            </text>
            <text
              x={c}
              y={r1(c + 14)}
              text-anchor="middle"
              fill="var(--muted)"
              style="font-size:10.5px;text-transform:uppercase;letter-spacing:.4px"
            >
              {props.center.label ?? ''}
            </text>
          </g>
        ) : null}
      </svg>
      <div class="ch-legend">
        {l.segments.map((s) => (
          <div key={s.label} class="ch-legend-row">
            <i style={`background:${s.color}`} />
            <span class="grow ellipsis">{s.label}</span>
            <span class="num muted">{s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- barras horizontales ---------- */

export interface HBarsProps {
  data: readonly BarDatum[];
  format?: ChartFormat;
  /** unidad que se pega al valor (`series`, `kg`…) */
  unit?: string;
  empty?: string;
}

export function HBars(props: HBarsProps) {
  const rows = props.data.filter((d) => Number(d.value) > 0);
  if (!rows.length) return <ChartEmpty msg={props.empty} />;
  const fmt = props.format ?? 'vol';
  const top = niceMax(maxOf(rows, (d) => Number(d.value)));
  return (
    <div class="ch-hb">
      {rows.map((d) => (
        <div key={d.label}>
          <div class="ch-hb-label tiny">
            <span class="ellipsis">{d.label}</span>
            <span class="num muted">
              {fmtVal(Number(d.value), fmt)}
              {props.unit ? ` ${props.unit}` : ''}
            </span>
          </div>
          <div class="bar">
            <i
              style={`width:${r1((Number(d.value) / top) * 100)}%;background:${
                d.color ?? 'var(--accent)'
              }`}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- heatmap de consistencia ---------- */

export interface HeatChartProps {
  cells: readonly HeatCell[];
  weeks?: number;
  color?: string;
  caption?: string;
  /** fecha inyectable (para tests y para que el layout no dependa del reloj) */
  todayIso?: string;
  ariaLabel?: string;
}

export function HeatChart(props: HeatChartProps) {
  const l = heatLayout(props.cells, {
    weeks: props.weeks,
    todayIso: props.todayIso,
    color: props.color,
  });
  const caption = props.caption ?? 'más opaco = más sesiones ese día';
  return (
    <div class="ch-heat">
      <svg
        viewBox={`0 0 ${l.width} ${l.height}`}
        width={l.width}
        height={l.height}
        role="img"
        aria-label={props.ariaLabel ?? `Días entrenados en las últimas ${l.weeks} semanas`}
      >
        {l.cells.map((c) => (
          <rect
            key={c.iso}
            x={c.x}
            y={c.y}
            width={c.w}
            height={c.h}
            rx="3"
            fill={c.color}
            opacity={c.opacity}
          >
            <title>{c.value ? `${c.iso}: ${c.value} sesión(es)` : `${c.iso}: sin sesión`}</title>
          </rect>
        ))}
        {l.cells
          .filter((c) => c.today)
          .map((c) => (
            <rect
              key={`t${c.iso}`}
              x={c.x - 1}
              y={c.y - 1}
              width={c.w + 2}
              height={c.h + 2}
              rx="3"
              fill="none"
              stroke="var(--text)"
              stroke-width="1.4"
            />
          ))}
        {l.dayLabels.map((d) => (
          <text
            class="ct-axis"
            key={d.text}
            x={d.x}
            y={d.y}
            text-anchor="middle"
            dominant-baseline="middle"
          >
            {d.text}
          </text>
        ))}
      </svg>
      <div class="tiny muted mt-s">
        {l.weeks} semanas · {caption}
      </div>
    </div>
  );
}

/* ---------- sparkline ---------- */

export function Sparkline({
  points,
  color,
  ariaLabel,
}: {
  points: readonly number[];
  color?: string;
  ariaLabel?: string;
}) {
  const d = sparkPath(points);
  if (!d) return null;
  return (
    <span class="ch-spark">
      <svg
        viewBox="0 0 92 26"
        width={92}
        height={26}
        role="img"
        aria-label={ariaLabel ?? 'Tendencia reciente'}
      >
        <path
          d={d}
          fill="none"
          stroke={color ?? 'var(--accent)'}
          stroke-width="1.8"
          stroke-linejoin="round"
        />
      </svg>
    </span>
  );
}

/* ---------- contenedor: la pestaña Progreso entera ---------- */

const RANGES: readonly { k: number; l: string }[] = [
  { k: 4, l: '4 sem' },
  { k: 8, l: '8 sem' },
  { k: 12, l: '12 sem' },
  { k: 26, l: '6 meses' },
  { k: 0, l: 'Todo' },
];

const DOW_NAMES = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/**
 * La pestaña Progreso de la v1 (`views-stats.js`) montada con componentes:
 * KPIs → volumen semanal → sesiones/series/minutos → reparto por grupo →
 * progresión del ejercicio elegido → récords con sparkline → frecuencia por día
 * → consistencia. Lee `sessions` y `exercises` del store y NO recibe props
 * (las vistas nuevas funcionan así); los datos intermedios salen de
 * `domain/analytics` igual que en la v1.
 */
export function ProgressCharts() {
  const list = sessions.value;
  const exs = exercises.value;
  const [range, setRange] = useState(8);
  const [picked, setPicked] = useState<string | null>(null);

  if (!list.length) {
    return (
      <div class="empty">
        <Icon name="chart" />
        <div>Sin datos todavía</div>
        <div class="tiny">
          Registra sesiones para desbloquear gráficos, récords y análisis de volumen por grupo
          muscular.
        </div>
      </div>
    );
  }

  const t = totals(list);
  const two = weeklySeries(list, 2);
  const cur = two[1] ?? { volume: 0, sessions: 0, sets: 0, minutes: 0 };
  const prev = two[0] ?? { volume: 0 };
  const delta = prev.volume ? Math.round(((cur.volume - prev.volume) / prev.volume) * 100) : 0;
  const recordCount = Object.keys(prs(list)).length;

  /* --- series semanales (la v1 pide 52 y se queda con la ventana elegida) --- */
  const all = weeklySeries(list, 52);
  const series = range ? all.slice(-range) : all.filter((w) => w.sessions || w.volume);
  const volBars: BarDatum[] = series.map((w) => ({ label: w.label, value: w.volume }));
  const sessBars: BarDatum[] = series.map((w) => ({ label: w.label, value: w.sessions }));
  const setBars: BarDatum[] = series.map((w) => ({ label: w.label, value: w.sets }));
  const minutes: LineSeries[] = [
    {
      name: 'minutos',
      color: 'var(--warn)',
      points: series.map((w) => ({ label: w.label, value: w.minutes * 60000 })),
    },
  ];
  const bestWeek = fmtVol(maxOf(volBars, (b) => b.value));

  /* --- reparto por grupo muscular --- */
  const recent = sessionsSince(list, range ? range * 7 : 3650);
  const volByGroup = groupVolume(recent, exs);
  const setsByGroup = groupSets(recent, exs);
  const groupRows = GROUPS.map((g) => ({
    label: g.label,
    value: volByGroup[g.key] ?? 0,
    color: g.color,
    sets: setsByGroup[g.key] ?? 0,
  }))
    .filter((g) => g.value > 0 || g.sets > 0)
    .sort((a, b) => b.value - a.value);
  const donutData: DonutDatum[] = groupRows.map((g) => ({
    label: g.label,
    value: g.value,
    color: g.color,
  }));
  const setsRows: BarDatum[] = groupRows.map((g) => ({
    label: g.label,
    value: g.sets,
    color: g.color,
  }));
  const groupTotal = sum(groupRows, (g) => g.value);

  /* --- progresión del ejercicio elegido --- */
  const counts = new Map<string, number>();
  for (const s of list) {
    for (const e of s.entries) counts.set(e.exId, (counts.get(e.exId) ?? 0) + 1);
  }
  const top = [...counts.entries()]
    .map(([id, n]) => ({ id, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);
  const activeId = picked ?? top[0]?.id ?? null;
  const active = activeId ? findExercise(exs, activeId) : null;
  const pts = activeId ? exerciseSeries(list, activeId) : [];
  const first = pts[0];
  const last = pts[pts.length - 1];
  const deltaPct = first?.e1rm ? Math.round(((last.e1rm - first.e1rm) / first.e1rm) * 100) : 0;
  const activePr = activeId ? prs(list)[activeId] : undefined;

  /* --- récords, día de la semana y consistencia --- */
  const prList = Object.values(prs(list))
    .sort((a, b) => b.e1rm - a.e1rm)
    .slice(0, 6);
  const dowBars: BarDatum[] = byDow(list).map((n, i) => ({
    label: DOW_NAMES[i] ?? '',
    value: n,
    color: i === dowIdx(today()) ? 'var(--accent)' : 'var(--surface-4)',
  }));
  const heatCells: HeatCell[] = list.map((s) => ({ iso: sessionDate(s), value: 1 }));
  const heatWeeks = Math.min(26, Math.max(8, range || 12));

  return (
    <div>
      <div class="between mb">
        <span class="tiny muted">
          {t.firstDate ? `Desde ${dateLabel(t.firstDate, 'medium')}` : ''}
        </span>
        <div class="seg">
          {RANGES.map((o) => (
            <button
              key={o.k}
              type="button"
              class={range === o.k ? 'on' : ''}
              onClick={() => setRange(o.k)}
            >
              {o.l}
            </button>
          ))}
        </div>
      </div>

      <div class="grid c2">
        <Kpi
          label="Volumen total"
          value={fmtVol(t.volume)}
          unit="kg"
          delta={`${fmtN(t.sets, 0)} series en ${fmtN(t.sessions, 0)} sesiones`}
        />
        <Kpi
          label="Esta semana"
          value={fmtVol(cur.volume)}
          unit="kg"
          delta={delta ? `${delta > 0 ? '+' : ''}${delta}% vs semana previa` : 'sin comparativa'}
        />
        <Kpi
          label="Tiempo total"
          value={fmtDur(t.time)}
          delta={`media ${fmtDur(t.avgDuration)} por sesión`}
        />
        <Kpi
          label="Racha"
          value={fmtN(t.streak, 0)}
          unit="días"
          delta={`mejor racha ${fmtN(t.bestStreak, 0)} · ${fmtN(recordCount, 0)} récords`}
        />
      </div>

      <section class="mt">
        <SectionHead title="Volumen por semana (kg)" right={`mejor semana: ${bestWeek} kg`} />
        <BarChart
          data={volBars}
          format="vol"
          height={160}
          showValues={series.length <= 12}
          ariaLabel="Volumen en kilogramos por semana"
        />
      </section>

      <section class="mt">
        <SectionHead title="Sesiones y series" />
        <div class="grid c2">
          <BarChart
            data={sessBars}
            format="n"
            height={130}
            color="var(--info)"
            ariaLabel="Sesiones por semana"
          />
          <BarChart
            data={setBars}
            format="n"
            height={130}
            color="var(--ok)"
            ariaLabel="Series por semana"
          />
        </div>
        {series.length ? (
          <div class="mt">
            <LineChart
              series={minutes}
              format="time"
              height={140}
              ariaLabel="Minutos de entrenamiento por semana"
            />
          </div>
        ) : null}
      </section>

      <section class="mt">
        <SectionHead title="Reparto por grupo muscular" />
        <DonutChart data={donutData} center={{ value: fmtVol(groupTotal), label: 'kg totales' }} />
        <div class="mt">
          <HBars data={setsRows} format="n" unit="series" empty="Sin series por grupo" />
        </div>
      </section>

      {activeId ? (
        <section class="mt">
          <SectionHead
            title={`Progresión · ${active ? active.name : activeId}`}
            right={
              first ? (
                <span class={deltaPct >= 0 ? 'ok' : 'danger'}>
                  {deltaPct > 0 ? '+' : ''}
                  {deltaPct}% desde {dateLabel(first.iso, 'medium')}
                </span>
              ) : null
            }
          />
          <div class="hr-scroll">
            {top.map((ex) => {
              const info = findExercise(exs, ex.id);
              return (
                <button
                  key={ex.id}
                  type="button"
                  class={activeId === ex.id ? 'chip accent' : 'chip'}
                  onClick={() => setPicked(ex.id)}
                >
                  {info ? info.name : ex.id}
                </button>
              );
            })}
          </div>
          {!pts.length || !last ? (
            <ChartEmpty msg="Todavía no hay series registradas de este ejercicio" />
          ) : (
            <>
              <LineChart
                series={[
                  {
                    name: '1RM est.',
                    color: active ? groupColor(active.group) : 'var(--accent)',
                    points: pts.map((p) => ({ label: dateLabel(p.iso, 'short'), value: p.e1rm })),
                  },
                ]}
                format="w"
                height={170}
                ariaLabel={`1RM estimado de ${active ? active.name : activeId}`}
              />
              <div class="grid c3 mt-s">
                <Kpi
                  label="1RM est. actual"
                  value={fmtN(last.e1rm)}
                  delta={`${fmtN(last.top)} × ${fmtN(last.reps)}`}
                />
                <Kpi
                  label="Récord"
                  value={fmtN(activePr ? activePr.e1rm : 0)}
                  delta={activePr ? dateLabel(activePr.date, 'medium') : '—'}
                />
                <Kpi
                  label="Sesiones"
                  value={fmtN(pts.length, 0)}
                  delta={`${fmtVol(sum(pts, (p) => p.volume))} kg acumulados`}
                />
              </div>
              <div class="mt-s">
                <BarChart
                  data={pts.slice(-12).map((p) => ({
                    label: dateLabel(p.iso, 'short'),
                    value: p.volume,
                  }))}
                  format="vol"
                  height={120}
                  color="var(--info)"
                  ariaLabel="Volumen por sesión del ejercicio"
                />
              </div>
            </>
          )}
        </section>
      ) : null}

      <section class="mt">
        <SectionHead title="Récords personales" right="1RM estimado (Epley)" />
        {prList.length ? (
          <div class="card flush">
            <div class="list">
              {prList.map((r) => {
                const info = findExercise(exs, r.exId);
                const hist = exerciseSeries(list, r.exId).slice(-8);
                return (
                  <div key={r.exId} class="list-item">
                    <div class="li-main">
                      <div class="li-title">{info ? info.name : r.exId}</div>
                      <div class="li-sub">
                        {fmtN(r.weight)} kg × {fmtN(r.reps)} · {dateLabel(r.date, 'medium')}
                      </div>
                    </div>
                    <div class="ch-pr">
                      <div class="num">{fmtN(r.e1rm)}</div>
                      <div class="tiny muted">1RM est.</div>
                    </div>
                    <Sparkline
                      points={hist.map((p) => p.e1rm)}
                      color={info ? groupColor(info.group) : 'var(--accent)'}
                      ariaLabel={`Tendencia de 1RM de ${info ? info.name : r.exId}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <ChartEmpty msg="Sin récords aún" />
        )}
      </section>

      <section class="mt">
        <SectionHead title="Frecuencia por día" />
        <BarChart
          data={dowBars}
          format="n"
          height={120}
          ariaLabel="Sesiones por día de la semana"
        />
      </section>

      <section class="mt">
        <SectionHead title="Consistencia" right="días con entrenamiento" />
        <HeatChart cells={heatCells} weeks={heatWeeks} />
      </section>
    </div>
  );
}
