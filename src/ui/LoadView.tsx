/**
 * Dibujo de cómo se carga. Portado del modal de la v1, con la misma idea: fiel
 * al modo (una barra, UNA mancuerna o las DOS), disco a disco cuando caben y
 * agrupado por medida cuando el hueco lleva muchos.
 *
 * Por qué existe el umbral: una barra de 60 kg pide 13 discos por lado y la fila
 * medía 984 px dentro de un modal de 579, así que se recortaba y parecía que un
 * lado iba vacío. Con más de 6 discos por hueco se dibuja una pila con "×N".
 */
import { fmtN } from '@/domain/format';
import { plateLabel, plateTone, type PlateGroup, type PlateSolution } from '@/domain/plates';
import type { Unit } from '@/domain/types';
import { fromKg } from '@/domain/units';

const DENSE_THRESHOLD = 6;

/** "18 kg" o "18 kg (39,7 lb)" cuando el usuario trabaja en libras. */
export function dual(kg: number, unit: Unit): string {
  const txt = `${fmtN(kg, 2)} kg`;
  return unit === 'lb' ? `${txt} (${fmtN(fromKg(kg, 'lb'), 1)} lb)` : txt;
}

function DiscChip({ group, count = 1 }: { group: PlateGroup; count?: number }) {
  const value = group.srcUnit === 'lb' ? fmtN(group.srcW, 2) : fmtN(group.kg, 2);
  return (
    <span
      class={`lv-chip ${plateTone(group.kg)}`}
      title={plateLabel(group.kg, group.srcW, group.srcUnit, count)}
    >
      <b>{value}</b>
      <i>
        {group.srcUnit === 'lb' ? 'lb' : 'kg'}
        {count > 1 ? ` ×${fmtN(count, 0)}` : ''}
      </i>
    </span>
  );
}

/** Pila de discos iguales: unas franjas por detrás y la medida con el "×N" delante. */
function DiscStack({ group }: { group: PlateGroup }) {
  const extra = Math.min(group.n, 3) - 1;
  return (
    <>
      {Array.from({ length: extra }, (_, i) => (
        <span key={i} class={`lv-chip lv-back ${plateTone(group.kg)}`} />
      ))}
      <DiscChip group={group} count={group.n} />
    </>
  );
}

/** Un lado del hueco. En el lado izquierdo se invierte para que el disco más pesado quede pegado al mango. */
function Side({ res, reverse }: { res: PlateSolution; reverse: boolean }) {
  const dense = res.discsPerHole > DENSE_THRESHOLD;
  const list: PlateGroup[] = dense
    ? [...res.perHole]
    : res.perHole.flatMap((p) => Array.from({ length: p.n }, () => p));
  const ordered = reverse ? [...list].reverse() : list;
  return (
    <span class="lv-side">
      {ordered.map((group, i) =>
        dense ? (
          <DiscStack key={`${group.kg}-${i}`} group={group} />
        ) : (
          <DiscChip key={`${group.kg}-${i}`} group={group} />
        ),
      )}
    </span>
  );
}

function LoadRow({ res, tag }: { res: PlateSolution; tag?: string }) {
  return (
    <div class="lv-row">
      {tag ? <span class="lv-tag">{tag}</span> : null}
      <Side res={res} reverse />
      <span class={res.mode === 'bar' ? 'lv-bar' : 'lv-grip'} />
      <Side res={res} reverse={false} />
    </div>
  );
}

export interface LoadViewProps {
  res: PlateSolution;
  unit: Unit;
}

export function LoadView({ res, unit }: LoadViewProps) {
  if (res.noPlates || !res.perHole.length) return null;

  const caption =
    res.mode === 'db2'
      ? `las dos iguales · ${dual(res.sideKg, unit)} por extremo`
      : res.mode === 'bar'
        ? `mismo peso en los dos lados · ${dual(res.sideKg, unit)} por lado`
        : `${dual(res.sideKg, unit)} por extremo`;

  return (
    <div class="load-vis">
      {res.mode === 'db2' ? (
        <>
          <LoadRow res={res} tag="1" />
          <LoadRow res={res} tag="2" />
        </>
      ) : (
        <LoadRow res={res} />
      )}
      <div class="lv-cap">{caption}</div>
    </div>
  );
}
