/**
 * Copiar al portapapeles. Es el `U.copy` de la v1 (`legacy/js/core.js:661`),
 * separado aquí para que la vista no tenga que tratar con `navigator` ni con el
 * fallback de `execCommand` (necesario en http y en navegadores viejos).
 *
 * Devuelve `false` si no se pudo copiar (permiso denegado, contexto no seguro…)
 * para que la UI avise en vez de prometer un portapapeles que no llegó.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* sin permiso o sin contexto seguro: se intenta el fallback de abajo */
  }

  try {
    if (typeof document === 'undefined') return false;
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
