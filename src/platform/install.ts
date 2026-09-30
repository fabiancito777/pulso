/**
 * Instalación de la PWA (`legacy/js/app.js:291-338`).
 *
 * El navegador emite `beforeinstallprompt` cuando considera que la app se puede
 * instalar; si no se cancela con `preventDefault()` muestra su propio banner, y
 * aquí lo que queremos es el botón de Ajustes → Datos. Así que:
 *
 * - `initInstall()` (en `main.tsx`, ANTES de `render`: el evento llega al cargar
 *   la página) captura el evento y lo guarda, escucha `appinstalled` y avisa;
 * - `install()` dispara `prompt()` y devuelve si el usuario aceptó;
 * - Firefox/Safari no emiten el evento ⇒ `install()` devuelve `false` y la UI
 *   abre el modal de instrucciones manuales (es el comportamiento de la v1).
 *
 * Todo con guardas de soporte: sin `window` (tests en Node) nada se registra.
 */
import { signal } from '@preact/signals';

import { toast } from '@/ui/toast';

/** El evento `beforeinstallprompt` guardado, con la forma mínima que usamos. */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: string }>;
};

let deferred: InstallPromptEvent | null = null;

/**
 * ¿Hay un `beforeinstallprompt` pendiente? Como signal, la fila de Ajustes se
 * repinta sola cuando el navegador decide que ya se puede instalar.
 */
export const installable = signal(false);

/** ¿El navegador permite instalar ahora mismo? (la versión sin reactividad) */
export function canInstall(): boolean {
  return deferred !== null;
}

/** ¿Estamos corriendo como app instalada (standalone / minimal-ui / iOS)? */
export function installed(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches ||
      (navigator as { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

/** ¿Hay service worker disponible? (solo http/https: con doble clic no.) */
export function hasSW(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    /^https?:$/.test(location.protocol)
  );
}

/**
 * Pide la instalación. Devuelve `true` si el usuario aceptó (el aviso de
 * «instalada» lo dispara el evento `appinstalled`, igual que en la v1).
 */
export async function install(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  deferred = null;
  installable.value = false;
  try {
    void event.prompt(); /* el resultado lo cuenta `userChoice`, no el prompt */
  } catch {
    return false;
  }
  const choice = event.userChoice ? await event.userChoice : null;
  return choice?.outcome === 'accepted';
}

/**
 * Engancha los dos eventos. Idempotente y sin efectos si no hay DOM: se llama
 * una sola vez desde `main.tsx`.
 */
export function initInstall(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); /* sin esto, el banner del navegador tapa la app */
    deferred = event as InstallPromptEvent;
    installable.value = true;
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    installable.value = false;
    toast('Pulso instalada · ya funciona sin conexión', { kind: 'ok', ms: 5000 });
  });
}
