/**
 * Tema y acento. Portado de `A.applyTheme()` de la v1 (`legacy/js/app.js`).
 *
 * Se calcula el color de tinta del acento con la luminancia relativa en vez de
 * fijar blanco/negro a mano: así un acento claro (lima) lleva texto oscuro y uno
 * saturado oscuro (violeta) lo lleva claro, sin tocar el CSS de cada componente.
 */
import type { Theme } from '@/domain/types';

/** Fondo de la barra del sistema por tema (el `<meta name="theme-color">`). */
const THEME_COLOR: Record<Theme, string> = {
  amoled: '#000000',
  dark: '#0e1116',
  light: '#f4f5f7',
};

function channels(hex: string): [number, number, number] {
  const value = hex.replace('#', '').trim();
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value.padEnd(6, '0').slice(0, 6);
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ];
}

/** Un color con alfa, sin depender de `color-mix` (Safari viejo no lo tiene). */
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Texto que se lee sobre el acento: oscuro si el fondo es claro. */
export function inkFor(hex: string): string {
  const [r, g, b] = channels(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.45 ? '#0b0d10' : '#f7f8fa';
}

/**
 * Aplica tema y acento a `<html>`. Se llama en cada arranque y al cambiarlos en
 * Ajustes → Apariencia (no hay CSS por componente que sepa del tema).
 */
export function applyTheme(theme: Theme | undefined, accent: string | undefined): void {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  const key = theme ?? 'amoled';
  const color = accent || '#c8ff2e';
  el.setAttribute('data-theme', key);
  el.style.setProperty('--accent', color);
  el.style.setProperty('--accent-soft', rgba(color, 0.15));
  el.style.setProperty('--accent-ink', inkFor(color));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[key] ?? THEME_COLOR.dark);
}
