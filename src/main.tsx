import { render } from 'preact';

import { App } from '@/app/App';
import { runDemoBoot } from '@/app/demo-boot';
import { initInstall } from '@/platform/install';
import { applyTheme } from '@/platform/theme';
import { registerSW } from '@/platform/sw';
import { settings } from '@/state/store';
import { toast } from '@/ui/toast';
import '@/styles/base.css';
import '@/styles/v2.css';
import '@/styles/profiles.css';

/* Tema y acento ANTES del primer pintado: si no, el root aparece con el tema por
   defecto y parpadea (los cambios posteriores los aplica App con el mismo `applyTheme`). */
applyTheme(settings.value.theme, settings.value.accent);

/* Eventos de instalación ANTES del render: `beforeinstallprompt` llega al cargar
   la página y se pierde si no hay nadie escuchando (spec onboarding.md, hueco 2). */
initInstall();

/* Errores globales con aviso (el `app.js:278-289` ): un toast `err` de 8 s
   con dedup de 15 s, para que un fallo repetido en bucle no tape la pantalla; el
   detalle sigue yendo a la consola. */
if (typeof window !== 'undefined') {
  let lastToast = 0;
  /* Avisos benignos que no deben llegar al usuario: el `ResizeObserver` se queja
     cuando cambia el layout dentro de su propio callback, y la app lo usa a
     propósito (centrar la nav en `App.tsx`). Se registran en consola y ya. */
  const BENIGN =
    /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/i;
  const notify = (text: string): void => {
    const now = Date.now();
    if (now - lastToast < 15000) return;
    lastToast = now;
    toast(text, { kind: 'err', ms: 8000 });
  };
  window.addEventListener('error', (event) => {
    console.error('[pulso] error', event.error || event.message);
    if (BENIGN.test(event.message || '')) return;
    notify('Algo falló al dibujar esta pantalla. El detalle queda en la consola.');
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
    if (BENIGN.test(text)) return;
    notify('No se pudo completar la acción. El detalle queda en la consola.');
  });
}

/* `?demo=1` (el arranque, `app.js:1261-1277`): sesiones de ejemplo y
   onboarding por visto ANTES del primer pintado, para que la app nazca cargada.
   Sin la query o con datos ya existentes no hace nada. */
const demoAdded = runDemoBoot(location.search);

const root = document.getElementById('app');
if (root) render(<App />, root);
else console.error('[pulso] no encuentro #app en index.html');

/* El aviso va después del render: el host de los toasts se monta en el DOM. */
if (demoAdded > 0) {
  toast(`Modo demo: ${demoAdded} sesiones de ejemplo cargadas`, { kind: 'ok', ms: 5000 });
}

/* Service worker (solo producción, https/localhost): offline + avisos de descanso */
registerSW();
