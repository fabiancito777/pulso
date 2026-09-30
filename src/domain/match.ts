/**
 * Matcher de nombres de ejercicios: el motor ÚNICO con el que la app asocia un
 * nombre propuesto (por el coach IA, por un plan guardado o por una repetición)
 * a un ejercicio de la biblioteca. Antes había tres criterios distintos para lo
 * mismo: `resolveName` (umbral 0,6), `resolveItems` y `resolvePlan` (solo
 * exacto, y lo demás se caía en silencio).
 *
 * Por qué no basta `similarity()`: compara CADENAS, no atributos. Con el umbral
 * viejo «Press de banca con barra inclinado» se reescribía como «Press de banca
 * con barra» (se perdía «inclinado») y «Remo con mancuerna bilateral» caía en
 * «Remo con mancuerna a una mano»: acababas haciendo OTRO ejercicio y el
 * historial se mezclaba con el del otro. Informe completo en
 * `_specs/matcher-nombres.md`.
 *
 * Dos salvaguardas, y ninguna toca `similarity()`/`norm()` (tienen tests que
 * fijan sus valores, `text.test.ts`): el veto va ENCIMA, aquí.
 *
 * 1. **Umbral 0,85** (el mismo criterio que `QUERY_SIMILARITY_MIN` de
 *    `features/coach/history.ts`): por debajo no se reescribe el nombre.
 * 2. **Veto por conflicto de atributos**: del nombre propuesto se infieren
 *    keywords (unilateral/bilateral, mancuerna/barra/polea/banda/máquina,
 *    inclinado, banco, suelo) y el candidato tiene que cumplirlas — en su nombre
 *    o en su `equip`—; si no, NO matchea y `conflict` trae la razón legible.
 *    Un nombre que choca se trata como desconocido: mejor un aviso que otro
 *    ejercicio. El material y el banco SÍ se validan contra `equip` («Floor
 *    Press con mancuerna» sí encuentra `Floor Press`), pero los calificativos de
 *    nombre (unilateral, inclinado…) solo valen si van en el nombre del
 *    candidato: son los que deciden qué ejercicio es.
 */
import { EQUIPMENT, findExerciseByName } from './data';
import { norm, similarity } from './text';
import type { Exercise } from './types';

/** A partir de esta similitud (0-1) un nombre se considera «el mismo ejercicio». */
export const MATCH_THRESHOLD = 0.85;

/** Lo que marca un nombre como de una sola mano/por lado (el mismo de la v1). */
export const UNILATERAL_RX = /unilateral|a una mano|una mano|kroc|por brazo|por lado|por pierna/;

/** Cómo quedó el nombre propuesto. */
export type MatchKind = 'exact' | 'fuzzy' | 'none';

/** Material que un nombre puede pedir (y que un `equip` puede declarar). */
export type MaterialKey = 'mancuerna' | 'barra' | 'polea' | 'banda' | 'maquina';

/** Etiqueta legible de cada material, para el `conflict`. */
const MATERIAL_LABEL: Record<MaterialKey, string> = {
  mancuerna: 'con mancuerna',
  barra: 'con barra',
  polea: 'de polea',
  banda: 'con banda',
  maquina: 'de máquina',
};

/** Keywords de material en un NOMBRE (normalizado: sin tildes ni signos). */
const MATERIAL_RX: readonly (readonly [MaterialKey, RegExp])[] = [
  ['mancuerna', /mancuern/],
  ['barra', /barra/],
  ['polea', /polea/],
  ['banda', /banda/],
  ['maquina', /maquina|smith/],
];

/** Claves de `equip` que sirven de banco (no `banco_dominadas`, que es un rack). */
const BENCH_KEYS = new Set(['banco_plano', 'banco_inclinable', 'banco_predicador']);

/** Claves de `equip` que son máquinas (`ext_cuadriceps`, `smith`…). */
const MACHINE_KEYS = new Set(
  EQUIPMENT.filter((item) => item.cat === 'Máquinas').map((item) => item.key),
);

/** Lo que un nombre dice del ejercicio (keywords, no interpretación profunda). */
export interface NameAttrs {
  /** marcado como a una mano / por lado (incluye «kroc»: ver `UNILATERAL_RX`) */
  unilateral: boolean;
  /** marcado EXPLÍCITAMENTE como bilateral («bilateral», «dos manos») */
  bilateral: boolean;
  /** material que pide (un nombre puede pedir varios) */
  material: MaterialKey[];
  inclinado: boolean;
  declinado: boolean;
  /** «en banco» / «sobre banco» dicho en el nombre («banca» NO cuenta: es el ejercicio) */
  banco: boolean;
  /** «en suelo» / «de piso» */
  suelo: boolean;
}

/** Un nombre propuesto que NO se asoció a ningún ejercicio: nada se descarta en silencio. */
export interface UnresolvedName {
  /** tal y como lo escribió el modelo: se conserva sin reescribir */
  name: string;
  /** razón legible para el usuario */
  reason: string;
  /** el más parecido, por si la UI quiere ofrecer «usar este» */
  candidate?: { id: string; name: string };
}

/** Resultado de `matchExercise`. */
export interface MatchResult {
  /** ejercicio elegido: solo presente cuando `matched` no es `none` */
  ex?: Exercise;
  matched: MatchKind;
  /** razón legible por la que el mejor candidato quedó vetado */
  conflict?: string;
  /** mejor candidato aunque no matchee (por si la UI quiere ofrecerlo) */
  candidate?: Exercise;
  /** similitud del mejor candidato (0-1) */
  score: number;
}

/** Keywords que un nombre (normalizado) declara sobre el ejercicio. */
export function parseNameAttrs(name: string): NameAttrs {
  const text = norm(name);
  return {
    unilateral: UNILATERAL_RX.test(text),
    bilateral: /bilateral|dos manos/.test(text),
    material: MATERIAL_RX.filter(([, rx]) => rx.test(text)).map(([key]) => key),
    inclinado: /inclinad/.test(text),
    declinado: /declinad/.test(text),
    banco: /banco/.test(text),
    suelo: /suelo|piso/.test(text),
  };
}

/** Material y banco que el `equip` de un ejercicio declara (keys del catálogo). */
function equipAttrs(equip: string | undefined): { material: MaterialKey[]; banco: boolean } {
  const material: MaterialKey[] = [];
  let banco = false;
  for (const part of String(equip ?? '').split(/[&|]/)) {
    const key = part.trim();
    if (!key) continue;
    if (/^mancuern/.test(key)) material.push('mancuerna');
    else if (key.startsWith('barra') || key === 'trap_bar') material.push('barra');
    else if (key.startsWith('polea')) material.push('polea');
    else if (key === 'bandas') material.push('banda');
    else if (MACHINE_KEYS.has(key)) material.push('maquina');
    if (BENCH_KEYS.has(key)) banco = true;
  }
  return { material, banco };
}

/** Atributos de un ejercicio candidato: su nombre + lo que su `equip` declara. */
export function exerciseAttrs(ex: Exercise): NameAttrs {
  const fromName = parseNameAttrs(ex.name);
  const fromEquip = equipAttrs(ex.equip);
  const material = [...fromName.material];
  for (const key of fromEquip.material) if (!material.includes(key)) material.push(key);
  return { ...fromName, material, banco: fromName.banco || fromEquip.banco };
}

/**
 * Etiquetas legibles de lo que el candidato NO cumple respecto al nombre
 * propuesto. Vacío = sin conflicto. Solo se veta lo que el propuesto PIDE:
 * añadir un atributo extra del candidato no es un conflicto (pasar de un nombre
 * genérico a uno concreto no pierde nada de lo pedido).
 */
export function attrConflicts(proposed: NameAttrs, candidate: NameAttrs): string[] {
  const labels: string[] = [];
  const add = (label: string): void => {
    if (!labels.includes(label)) labels.push(label);
  };
  for (const key of proposed.material)
    if (!candidate.material.includes(key)) add(MATERIAL_LABEL[key]);
  if (proposed.unilateral && !candidate.unilateral) add('unilateral');
  if (proposed.bilateral && candidate.unilateral) add('bilateral');
  if (proposed.inclinado && !candidate.inclinado) add('inclinado');
  if (proposed.declinado && !candidate.declinado) add('declinado');
  if (proposed.banco && !candidate.banco) add('en banco');
  if (proposed.suelo && !candidate.suelo) add('en el suelo');
  return labels;
}

/** La razón de `conflict`, ya en forma de frase. */
function conflictText(candidate: Exercise, labels: readonly string[]): string {
  return `«${candidate.name}» no cumple: ${labels.join(', ')}`;
}

/**
 * Asocia un nombre propuesto con un ejercicio de la biblioteca.
 *
 * - `exact`: slug o `norm` igual (con tildes, mayúsculas o el id va primero);
 * - `fuzzy`: `similarity ≥ MATCH_THRESHOLD` **y** sin conflicto de atributos de
 *   TODOS los que superan el umbral (si el mejor choca pero otro cumplidor no,
 *   se lleva el segundo);
 * - `none`: no se parece lo suficiente o todos los que superan el umbral quedaron
 *   vetados (entonces `conflict` dice por qué, contra el mejor) y `candidate`/
 *   `score` viajan siempre que haya mejor candidato, por si la UI quiere ofrecerlo.
 *
 * El match exacto NO se veta: el nombre idéntico trae los mismos atributos.
 */
export function matchExercise(name: string, library: readonly Exercise[]): MatchResult {
  const text = String(name ?? '').trim();
  if (!text) return { matched: 'none', score: 0 };

  const exact = findExerciseByName(library, text);
  if (exact) return { ex: exact, matched: 'exact', score: 1 };

  const query = norm(text);
  const proposed = parseNameAttrs(text);
  let best: Exercise | null = null;
  let bestScore = 0;
  let bestOk: Exercise | null = null;
  let bestOkScore = 0;
  for (const ex of library) {
    const s = similarity(query, ex.name);
    if (s > bestScore) {
      bestScore = s;
      best = ex;
    }
    if (
      s >= MATCH_THRESHOLD &&
      s > bestOkScore &&
      !attrConflicts(proposed, exerciseAttrs(ex)).length
    ) {
      bestOkScore = s;
      bestOk = ex;
    }
  }

  if (bestOk) return { ex: bestOk, matched: 'fuzzy', score: bestOkScore };
  if (!best) return { matched: 'none', score: 0 };

  /* El conflicto solo se CUELLA como motivo cuando el candidato estaba cerca
     (≥ umbral): decirle a alguien que «Pullover con mancuerna» no cumple
     «unilateral» para un nombre que se parece un 0,4 es mentirle. Más abajo lo
     que pasa es que el nombre no existe, y así se le cuenta. */
  const labels = bestScore >= MATCH_THRESHOLD ? attrConflicts(proposed, exerciseAttrs(best)) : [];
  if (labels.length) {
    return {
      matched: 'none',
      conflict: conflictText(best, labels),
      candidate: best,
      score: bestScore,
    };
  }
  return { matched: 'none', candidate: best, score: bestScore };
}

/**
 * Un `MatchResult` sin match traducido a lo que la UI debe avisar: el nombre
 * ORIGINAL (nunca el reescrito) con su razón. Es lo que acumulan `resolveItems`
 * y `resolvePlan` en sus `unresolved`.
 */
export function unresolvedName(name: string, match: MatchResult): UnresolvedName {
  const out: UnresolvedName = { name, reason: match.conflict ?? 'no está en tu biblioteca' };
  if (match.candidate) out.candidate = { id: match.candidate.id, name: match.candidate.name };
  return out;
}

/** Los nombres sin resolver como texto para un aviso: «a», «b» y «c». */
export function unresolvedNames(items: readonly UnresolvedName[]): string {
  return items.map((item) => `«${item.name}»`).join(', ');
}
