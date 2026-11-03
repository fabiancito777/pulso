/**
 * Superseries: dos ejercicios seguidos que se hacen sin descansar entre ellos, una
 * serie de cada uno, y se descansa al cerrar el par.
 *
 * El vínculo es un **id compartido** (`superset`) en entradas consecutivas, no un
 * índice ni un grupo anidado. Así el par sobrevive a reordenar, añadir o quitar
 * ejercicios: si se rompe la vecindad deja de ser par y no queda nada roto detrás.
 *
 * Todo lo de aquí es puro y trabaja con la forma mínima (`superset` + `sets[].done`),
 * así que vale igual para la sesión en curso, para los items de una rutina y para
 * los del plan del coach.
 */

export interface SupersetMember {
  superset?: string | null;
}

export interface SupersetEntryLike extends SupersetMember {
  sets: readonly { done?: boolean }[];
}

export interface SupersetGroup {
  id: string;
  /** índices del array, en orden */
  indices: number[];
  /** letra que se pinta (A, B, C…) dentro de esta lista */
  letter: string;
}

/** Una posición dentro de su grupo, para pintar «SS A · 1/2». */
export interface SupersetPosition {
  id: string;
  letter: string;
  position: number;
  size: number;
}

const LETTERS = 'ABCDEFGH';

function letterFor(index: number): string {
  return LETTERS[index] ?? String(index + 1);
}

/**
 * Los grupos de la lista: solo cuentan las **runs consecutivas** de dos o más
 * ejercicios con el mismo `superset`. Un id suelto (el compañero se borró, se
 * movió el ejercicio…) no es un par: no se pinta insignia ni cambia el descanso.
 */
export function supersetGroups(list: readonly SupersetMember[]): SupersetGroup[] {
  const groups: SupersetGroup[] = [];
  let i = 0;
  while (i < list.length) {
    const id = list[i]?.superset ?? '';
    if (!id) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < list.length && (list[j]?.superset ?? '') === id) j++;
    if (j - i >= 2) {
      const indices: number[] = [];
      for (let k = i; k < j; k++) indices.push(k);
      groups.push({ id, indices, letter: letterFor(groups.length) });
    }
    i = j;
  }
  return groups;
}

/** El grupo al que pertenece `index`, o `null` si no está emparejado. */
export function groupOf(
  list: readonly SupersetMember[],
  index: number,
): SupersetGroup | null {
  const member = list[index];
  if (!member?.superset) return null;
  return supersetGroups(list).find((group) => group.indices.includes(index)) ?? null;
}

/** Posición dentro del grupo y letra, para la insignia de la tarjeta. */
export function supersetPosition(
  list: readonly SupersetMember[],
  index: number,
): SupersetPosition | null {
  const group = groupOf(list, index);
  if (!group) return null;
  return {
    id: group.id,
    letter: group.letter,
    position: group.indices.indexOf(index) + 1,
    size: group.indices.length,
  };
}

/**
 * El compañero al que toca cambiar: otro miembro del grupo con series pendientes.
 * `null` = no es superserie o el par está cerrado (ya se hicieron los dos), así que
 * lo que venga es un descanso normal.
 */
export function partnerAfter(entries: readonly SupersetEntryLike[], index: number): number | null {
  const group = groupOf(entries, index);
  if (!group) return null;
  for (const other of group.indices) {
    if (other === index) continue;
    const pending = entries[other]?.sets.some((set) => !set.done) === true;
    if (pending) return other;
  }
  return null;
}

/** Id estable y único para un par nuevo (nunca choca con los de otra rutina). */
let seq = 0;
export function newSupersetId(): string {
  seq += 1;
  return `ss-${Date.now().toString(36)}-${seq}`;
}

/**
 * Empareja el item `index` con el siguiente. Devuelve `null` si no hay vecino o si
 * alguno de los dos ya está en otro par: hay que separar primero para no anidar.
 */
export function linkAt<T extends SupersetMember>(
  items: readonly T[],
  index: number,
  id: string,
): T[] | null {
  const a = items[index];
  const b = items[index + 1];
  if (!a || !b || a.superset || b.superset) return null;
  return items.map((item, i) => (i === index || i === index + 1 ? { ...item, superset: id } : item));
}

/** Separa el par al que pertenece `index` (todos sus miembros). */
export function unlinkAt<T extends SupersetMember>(items: readonly T[], index: number): T[] {
  const id = items[index]?.superset;
  if (!id) return [...items];
  return items.map((item) => (item.superset === id ? { ...item, superset: null } : item));
}

/**
 * Renombra en bloque los runs cuyo id ya está en `taken` (o que repiten otro run de
 * la MISMA lista), para que pegar dos listas no fusione pares distintos en uno.
 *
 * El run es la unidad: un par son **dos entradas consecutivas con el mismo id**, así
 * que se le da un id nuevo al run entero. Un run sin colisión no se toca, y un id
 * suelto se respeta tal cual.
 *
 * Resuelve los cuatro caminos que se fusionaban: duplicar una rutina (el
 * `structuredClone` copiaba el id), añadir la misma rutina dos veces a la sesión, dos
 * rutinas del coach con la misma letra y dos rutinas que compartan id por casualidad.
 */
export function freshSupersetIds<T extends SupersetMember>(
  entries: readonly T[],
  taken: Iterable<string> = [],
): T[] {
  const used = new Set(taken);
  const out: T[] = [];
  let i = 0;
  while (i < entries.length) {
    const id = entries[i]?.superset ?? '';
    if (!id) {
      out.push(entries[i]);
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < entries.length && (entries[j]?.superset ?? '') === id) j += 1;
    const next = used.has(id) ? newSupersetId() : id;
    used.add(next);
    for (let k = i; k < j; k += 1) {
      const member = entries[k];
      out.push(member.superset === next ? member : { ...member, superset: next });
    }
    i = j;
  }
  return out;
}

/**
 * Limpia los ids que se quedaron solos. Un run de 1 no es par (`supersetGroups`
 * exige dos), pero el id seguía viajando al historial y a la sincronización y, peor,
 * bloqueaba el editor de rutinas: `linkAt` no empareja un item que ya tiene
 * `superset` y el botón «Separar» no aparece (también pide dos), así que pulsar
 * «Superserie» daba un error imposible de resolver.
 *
 * Se aplica al quitar o mover un ejercicio: desparejar por vecindad no debe dejar
 * basura.
 */
export function pruneSupersets<T extends SupersetMember>(items: readonly T[]): T[] {
  return items.map((item, index) => {
    const id = item.superset;
    if (!id) return item;
    const prev = items[index - 1]?.superset ?? '';
    const next = items[index + 1]?.superset ?? '';
    if (prev === id || next === id) return item;
    return { ...item, superset: null };
  });
}
