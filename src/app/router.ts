/**
 * Rutas por hash. Mismo esquema que la v1 (`#/tab` y `#/ajustes/<sub>`) para que
 * los enlaces guardados en el navegador sigan valiendo, pero con un signal en vez de
 * repintar a mano: cualquier componente que lea `route.value` se actualiza solo.
 */
import { signal } from '@preact/signals';

export interface Tab {
  key: string;
  label: string;
  icon: string;
  /** Falso mientras la vista siga en `legacy/`: la pestaña se muestra pero avisa. */
  ported: boolean;
  hint: string;
}

/**
 * Las 7 pestañas, en el orden de la v1. `ported: false` no es un error de la app:
 * es el estado de la migración a la vista (la pestaña existe y dice qué falta).
 */
export const TABS: readonly Tab[] = [
  { key: 'hoy', label: 'Hoy', icon: 'home', ported: true, hint: 'Tu día' },
  { key: 'entrenar', label: 'Entrenar', icon: 'dumbbell', ported: true, hint: 'Sesión en curso' },
  {
    key: 'rutinas',
    label: 'Rutinas',
    icon: 'list',
    ported: true,
    hint: 'Rutinas y plantillas',
  },
  {
    key: 'calendario',
    label: 'Calendario',
    icon: 'calendar',
    ported: true,
    hint: 'Plan semanal',
  },
  { key: 'coach', label: 'Coach', icon: 'sparkles', ported: true, hint: 'Chat con el coach' },
  { key: 'progreso', label: 'Progreso', icon: 'chart', ported: true, hint: 'Récords y volumen' },
  { key: 'ajustes', label: 'Ajustes', icon: 'gear', ported: true, hint: 'Configuración' },
];

export interface Route {
  tab: string;
  /** sub-sección de Ajustes (`ajustes/equipo`) */
  sub: string | null;
}

/** `#/ajustes/equipo` → `{ tab: 'ajustes', sub: 'equipo' }`; basura → `hoy`. */
export function parseHash(hash: string): Route {
  const clean = String(hash || '')
    .replace(/^#\/?/, '')
    .replace(/\/+$/, '');
  const [tab, sub] = clean.split('/');
  const key = TABS.some((t) => t.key === tab) ? tab : 'hoy';
  return { tab: key, sub: sub || null };
}

export const route = signal<Route>(parseHash(typeof location === 'undefined' ? '' : location.hash));

export function go(tab: string, sub?: string | null): void {
  const next = sub ? `#/${tab}/${sub}` : `#/${tab}`;
  if (location.hash === next) return;
  location.hash = next;
}

/** Escucha los cambios de hash. Devuelve la función para dejar de escuchar. */
export function startRouter(): () => void {
  const sync = () => {
    route.value = parseHash(location.hash);
  };
  window.addEventListener('hashchange', sync);
  sync();
  return () => window.removeEventListener('hashchange', sync);
}

export const isPorted = (tab: string): boolean => TABS.find((t) => t.key === tab)?.ported ?? false;
