/**
 * Calculadora de discos. Portada del modal de la v1 (`ui.plates` en
 * `legacy/js/app.js`) a un componente: el cálculo ya no se hace a mano en el
 * evento `input` — se recalcula solo cuando cambia lo que importa y el DOM lo
 * actualiza Preact, así que desaparecen los `innerHTML` y los `U.$('#pc-out')`.
 */
import { useMemo, useState } from 'preact/hooks';

import { fmtN, inputNum } from '@/domain/format';
import {
  maxLoadable,
  modeSpec,
  PLATE_MODE_KEYS,
  PLATE_MODES,
  solvePlates,
  type PlateSolution,
} from '@/domain/plates';
import type { BarWeights, PlateModeKey, PlateStock, Unit } from '@/domain/types';
import { fromKg, unitIncrement, unitLabel } from '@/domain/units';
import { LoadView, dual } from '@/ui/LoadView';

export interface PlatesProps {
  plates: readonly PlateStock[];
  bars: BarWeights;
  unit: Unit;
  initialTarget?: number | string;
  initialMode?: PlateModeKey;
  exerciseName?: string;
  onModeChange?: (mode: PlateModeKey) => void;
  /** kg en la unidad del usuario (lo que se aplicaría a la serie) */
  onUse?: (weight: number) => void;
}

/** "3 discos de 3 kg + 1 disco de 1,25 kg" (en palabras se entiende mejor que "3 kg ×3"). */
function perHoleWords(res: PlateSolution): string {
  return res.perHole
    .map((p) => {
      const label = p.srcUnit === 'lb' ? `${fmtN(p.srcW)} lb` : `${fmtN(p.kg, 2)} kg`;
      return `${fmtN(p.n, 0)} ${p.n > 1 ? 'discos' : 'disco'} de ${label}`;
    })
    .join(' + ');
}

function usageWords(res: PlateSolution): string {
  return res.usage
    .map((u) => {
      const label = u.srcUnit === 'lb' ? `${fmtN(u.srcW)} lb` : `${fmtN(u.kg, 2)} kg`;
      const left = u.have - u.used;
      return `${fmtN(u.used, 0)} de tus ${fmtN(u.have, 0)} discos de ${label}${left > 0 ? ` · te quedan ${fmtN(left, 0)}` : ''}`;
    })
    .join(' · ');
}

export function Plates({
  plates,
  bars,
  unit,
  initialTarget = '',
  initialMode,
  exerciseName,
  onModeChange,
  onUse,
}: PlatesProps) {
  const [mode, setMode] = useState<PlateModeKey>(initialMode ?? 'bar');
  const [barKey, setBarKey] = useState<'olimpica' | 'ez'>('olimpica');
  const [target, setTarget] = useState(() => inputNum(initialTarget));

  const spec = modeSpec(mode);
  const step = unitIncrement(unit);
  const label = unitLabel(unit);
  const hasTarget = target.trim() !== '';

  const res = useMemo(
    () => (hasTarget ? solvePlates(Number(target), { plates, bars, mode, unit, barKey }) : null),
    [hasTarget, target, plates, bars, mode, unit, barKey],
  );
  const max = useMemo(() => maxLoadable({ plates, bars, mode, barKey }), [plates, bars, mode, barKey]);

  const usable = res ? Math.round(fromKg(res.achieveKg, unit) * 100) / 100 : null;

  function pickMode(next: PlateModeKey) {
    setMode(next);
    onModeChange?.(next);
  }

  function nudge(delta: number) {
    const current = Number(target) || 0;
    setTarget(inputNum(Math.max(0, Math.round((current + delta) * 100) / 100)));
  }

  return (
    <div class="col" style="gap:11px">
      {exerciseName ? (
        <div class="tiny muted">
          Ejercicio: <b>{exerciseName}</b>
        </div>
      ) : null}

      <div>
        <div class="label" style="margin-bottom:6px">
          Cómo se carga
        </div>
        <div class="hr-scroll">
          {PLATE_MODE_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              class={`chip ${key === mode ? 'accent' : ''}`}
              title={PLATE_MODES[key].hint}
              onClick={() => pickMode(key)}
            >
              {PLATE_MODES[key].label}
            </button>
          ))}
        </div>
      </div>

      <div class="grid c2">
        <label class="field">
          <span class="label">Peso objetivo ({label})</span>
          <input
            class="input num"
            type="number"
            inputmode="decimal"
            step={step}
            min="0"
            value={target}
            placeholder={unit === 'lb' ? '225' : '100'}
            onInput={(e) => setTarget(e.currentTarget.value)}
          />
        </label>
        <div class="field">
          <span class="label">{mode === 'bar' ? 'Barra' : 'Mango'}</span>
          {mode === 'bar' ? (
            <select
              class="select"
              value={barKey}
              onChange={(e) => setBarKey(e.currentTarget.value as 'olimpica' | 'ez')}
            >
              {(['olimpica', 'ez'] as const).map((key) => (
                <option key={key} value={key}>
                  Barra {key === 'ez' ? 'EZ' : ''} · {fmtN(bars[key], 1)} kg
                </option>
              ))}
            </select>
          ) : (
            <div class="tiny muted">
              {spec.handle
                ? `${fmtN(bars.mancuerna, 1)} kg por mango`
                : 'este ejercicio no lleva discos'}
            </div>
          )}
        </div>
      </div>

      <div class="row" style="gap:6px">
        <button type="button" class="btn sm ghost" onClick={() => nudge(-step)}>
          -{fmtN(step)}
        </button>
        <button type="button" class="btn sm ghost" onClick={() => nudge(step)}>
          +{fmtN(step)}
        </button>
        <button type="button" class="btn sm quiet" onClick={() => setTarget('')}>
          Limpiar
        </button>
      </div>

      {res ? (
        <>
          <div class="card tight">
            {res.noPlates ? (
              <div class="tiny muted">Sin discos: usa {dual(res.achieveKg, unit)} y listo.</div>
            ) : (
              <div class="kv">
                <span class="k">Por {res.per}</span>
                <span class="v">{perHoleWords(res)}</span>
              </div>
            )}
            <div class="kv">
              <span class="k">
                {res.mode === 'bar'
                  ? 'Total en la barra'
                  : res.mode === 'db2'
                    ? 'Peso de cada mancuerna'
                    : res.mode === 'db1'
                      ? 'Peso de la mancuerna'
                      : 'Peso a usar'}
              </span>
              <span class="v">
                {dual(res.achieveKg, unit)}{' '}
                {res.noPlates ? null : res.exact ? (
                  <span class="ok">exacto</span>
                ) : (
                  <span class="warn">
                    {res.diffKg > 0 ? 'te quedas ' : 'te pasas '}
                    {fmtN(Math.abs(res.diffKg), 2)} kg
                  </span>
                )}
              </span>
            </div>
            {res.noPlates ? null : (
              <>
                <div class="kv">
                  <span class="k">Discos</span>
                  <span class="v">
                    {fmtN(res.discsTotal, 0)} en total
                    {res.mode === 'db2' ? ` · ${fmtN(res.discsPerHole * 2, 0)} por mancuerna` : ''}
                  </span>
                </div>
                <div class="kv">
                  <span class="k">{res.mode === 'bar' ? 'Barra' : 'Mango'}</span>
                  <span class="v">{dual(res.handleKg, unit)}</span>
                </div>
                <div class="kv">
                  <span class="k">
                    {res.mode === 'bar'
                      ? 'Máximo en la barra'
                      : res.mode === 'none'
                        ? 'Máximo'
                        : 'Máximo por mancuerna'}
                  </span>
                  <span class="v">{dual(max.totalKg, unit)}</span>
                </div>
              </>
            )}
          </div>

          <LoadView res={res} unit={unit} />

          {res.usage.length ? (
            <div class="tiny muted">
              De tu inventario: {usageWords(res)}
            </div>
          ) : null}

          {res.noPlates || res.exact ? null : (
            <>
              <div class="tiny muted">También puedes cargar:</div>
              <div class="hr-scroll">
                {[res.belowKg, res.aboveKg].filter((v): v is number => v !== null).map((kg) => (
                  <button
                    key={kg}
                    type="button"
                    class="chip"
                    onClick={() => setTarget(inputNum(Math.round(fromKg(kg, unit) * 100) / 100))}
                  >
                    {fmtN(Math.round(fromKg(kg, unit) * 100) / 100, 2)} {label} ·{' '}
                    {kg < res.achieveKg ? 'más ligero' : 'más pesado'}
                  </button>
                ))}
              </div>
            </>
          )}

          {onUse && usable !== null ? (
            <button type="button" class="btn primary" onClick={() => onUse(usable)}>
              Usar {fmtN(usable, 2)} {label}
            </button>
          ) : null}
        </>
      ) : (
        <div class="tiny muted">
          Escribe un peso y te digo qué discos poner (los mismos discos en{' '}
          {mode === 'db2'
            ? 'cada extremo de las dos mancuernas'
            : mode === 'bar'
              ? 'cada lado de la barra'
              : 'cada extremo'}
          , sin inventarte ninguno).
        </div>
      )}
    </div>
  );
}
