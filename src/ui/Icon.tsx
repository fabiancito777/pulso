/**
 * Un icono del catálogo generado (`icons.ts`), con la misma envoltura que el `ico()`
 * de la v1: `viewBox` 24, trazo con `currentColor` y esquinas redondeadas.
 *
 * Los trazos se inyectan tal cual porque son constantes nuestras (generadas desde
 * `legacy/js/core.js`), no texto del usuario: Preact sigue escapando todo lo demás.
 */
import { ICONS, type IconSpec } from './icons';

export interface IconProps {
  name: string;
  /** clase extra (`accent`, `muted`…); el tamaño y el color los pone el CSS */
  class?: string;
}

export function Icon({ name, class: cls }: IconProps) {
  const spec: IconSpec = ICONS[name] ?? ICONS.info;
  return (
    <svg
      class={cls ? `ico ${cls}` : 'ico'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={spec.sw ?? 1.9}
      stroke-linecap="round"
      stroke-linejoin="round"
      dangerouslySetInnerHTML={{ __html: spec.paths }}
    />
  );
}
