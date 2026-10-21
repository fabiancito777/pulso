/**
 * Rutas por hash (`#/tab` y `#/ajustes/<sub>`) con un signal en vez de repintar a
 * mano: cualquier componente que lea `route.value` se actualiza solo.
 */
import { signal } from '@preact/signals';

export interface Tab {
  key: string;
  label: string;
  icon: string;
  hint: string;
}

/** Las 7 pestañas, en el orden de la navegación. */
export const TABS: readonly Tab[] = [
  { key: 'hoy', label: 'Hoy', icon: 'home', hint: 'Tu día' },
  { key: 'entrenar', label: 'Entrenar', icon: 'dumbbell', hint: 'Sesión en curso' },
  { key: 'rutinas', label: 'Rutinas', icon: 'list', hint: 'Rutinas y plantillas' },
  { key: 'calendario', label: 'Calendario', icon: 'calendar', hint: 'Plan semanal' },
  { key: 'coach', label: 'Coach', icon: 'sparkles', hint: 'Chat con el coach' },
  { key: 'progreso', label: 'Progreso', icon: 'chart', hint: 'Récords y volumen' },
  { key: 'ajustes', label: 'Ajustes', icon: 'gear', hint: 'Configuración' },
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
