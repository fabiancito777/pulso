/**
 * Onboarding de primera vez (`meta.onboarded`).
 *
 * La v1 lo hacía todo dentro del modal (`legacy/js/app.js:204`); aquí la lógica
 * se separa de la UI para poder probarla sin DOM: el modal solo recoge los
 * valores y llama a `applyOnboarding`.
 *
 * Ojo: `meta.onboarded` lo escribía ANTES solo `importState` (`store.ts`), así
 * que sin este módulo un usuario nuevo nunca veía el modal y la clave se
 * quedaba `false` para siempre.
 */
import { equipPreset } from '@/domain/data';
import { applyEquipment, setMeta, setSettingsPath } from '@/state/store';

/** Lo que el usuario elige en el modal (los mismos campos que la v1). */
export interface OnboardingValues {
  name: string;
  goal: string;
  days: number;
  units: string;
  /** preset de material: `basico | gym | todo | ninguno` */
  equip: string;
}

/** Marca el onboarding como visto (los dos caminos de salida del modal). */
export function markOnboarded(): void {
  setMeta({ onboarded: true });
}

/**
 * Aplica lo elegido y cierra el onboarding.
 *
 * `values === null` = «Configurar después»: solo se marca como visto (la v1
 * hacía exactamente lo mismo, `app.js:253-254`). Con datos se escriben las 4
 * claves de ajustes (una a una, con la misma ruta que usa Ajustes) y el preset
 * de material entero de una sola escritura.
 */
export function applyOnboarding(values: OnboardingValues | null): void {
  markOnboarded();
  if (!values) return;
  setSettingsPath('name', values.name);
  setSettingsPath('goal', values.goal);
  setSettingsPath('daysPerWeek', values.days);
  setSettingsPath('units', values.units);
  applyEquipment(equipPreset(values.equip));
}
