/**
 * Pila de modales abiertos, de ámbito de módulo.
 *
 * Vive fuera de `Modal.tsx` para poder probarla sin DOM: con varios modales
 * apilados (el de ayuda se monta encima de cualquier otro) solo el superior
 * debe responder a Escape, al clic en el scrim y al bloqueo de foco.
 */
export interface ModalStackEntry {
  id: number;
  dismissable: boolean;
  close: () => void;
}

const stack: ModalStackEntry[] = [];
let seq = 0;

/** Apila un modal abierto y devuelve su id; el último es el superior. */
export function pushModal(entry: Omit<ModalStackEntry, 'id'>): number {
  seq += 1;
  const id = seq;
  stack.push({ ...entry, id });
  return id;
}

/** Quita un modal de la pila (al desmontarse). */
export function removeModal(id: number): void {
  const index = stack.findIndex((entry) => entry.id === id);
  if (index >= 0) stack.splice(index, 1);
}

/** `true` si ese modal es el de arriba del todo. */
export function isTopModal(id: number): boolean {
  const top = stack[stack.length - 1];
  return top !== undefined && top.id === id;
}

/** El modal superior, o `undefined` si no hay ninguno. */
export function topModal(): ModalStackEntry | undefined {
  return stack[stack.length - 1];
}

/**
 * Cierra SOLO el modal superior y siempre que sea descartable. Devuelve si se
 * cerró algo, para que Escape y el scrim no puedan atravesar la pila.
 */
export function closeTopModal(): boolean {
  const top = topModal();
  if (!top) return false;
  if (!top.dismissable) return false;
  /* se saca antes de llamar a `close`: aunque el desmontaje llegue después,
     dos Escape seguidos no pueden cerrar dos modales por error */
  removeModal(top.id);
  top.close();
  return true;
}

/** Solo para tests: deja la pila limpia entre casos. */
export function resetModalStack(): void {
  stack.length = 0;
  seq = 0;
}
