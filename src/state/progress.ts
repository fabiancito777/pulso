/**
 * Señales de la pestaña Progreso que necesitan ver SE dos lugares a la vez.
 *
 * En la v1 el ejercicio elegido en «Progresión» era una variable de módulo
 * (`views-stats.js` → `exId`) a la que llegaban tres acciones distintas: el chip,
 * la fila de la tabla de récords y el picker («Otro»). Aquí eso es un signal:
 * `charts.tsx` lo lee para pintar el chip activo y `PrTableModal` lo escribe al
 * pulsar una fila, sin que ninguno de los dos tenga que ser hijo del otro.
 *
 * Sin persistencia a propósito, igual que en la v1: al recargar, Progresión vuelve
 * al ejercicio más repetido.
 */
import { signal } from '@preact/signals';

/** Ejercicio seleccionado en «Progresión» (`null` = el más repetido del historial). */
export const pickedExercise = signal<string | null>(null);

/** Selecciona un ejercicio (chip, tabla de récords o picker) o limpia la elección. */
export function pickExercise(id: string | null): void {
  pickedExercise.value = id;
}
