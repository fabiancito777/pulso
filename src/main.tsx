import { render } from 'preact';

import { App } from '@/app/App';
import { initInstall } from '@/platform/install';
import { applyTheme } from '@/platform/theme';
import { registerSW } from '@/platform/sw';
import { settings } from '@/state/store';
import { toast } from '@/ui/toast';
import '@/styles/base.css';
import '@/styles/v2.css';

/* Tema y acento ANTES del primer pintado: si no, el root aparece con el tema por
   defecto y parpadea (los cambios posteriores los aplica App con el mismo `applyTheme`). */
applyTheme(settings.value.theme, settings.value.accent);

/* Eventos de instalación ANTES del render: `beforeinstallprompt` llega al cargar
   la página y se pierde si no hay nadie escuchando (spec onboarding.md, hueco 2). */
initInstall();

/* Errores globales con aviso (el `app.js:278-289` de la v1): un toast `err` de 8 s
   con dedup de 15 s, para que un fallo repetido en bucle no tape la pantalla; el
   detalle sigue yendo a la consola. */
if (typeof window !== 'undefined') {
  let lastToast = 0;
  const notify = (text: string): void => {
    const now = Date.now();
    if (now - lastToast < 15000) return;
    lastToast = now;
    toast(text, { kind: 'err', ms: 8000 });
  };
  window.addEventListener('error', (event) => {
    console.error('[pulso] error', event.error || event.message);
    notify(`Error de la app: ${event.message || 'desconocido'} (mira la consola)`);
  });
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[pulso] promesa rechazada', event.reason);
    const reason: unknown = event.reason;
    const text =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : 'desconocido';
    notify(`Promesa rechazada: ${text} (mira la consola)`);
  });
}

const root = document.getElementById('app');
if (root) render(<App />, root);
else console.error('[pulso] no encuentro #app en index.html');

/* Service worker (solo producción, https/localhost): offline + avisos de descanso */
registerSW();
