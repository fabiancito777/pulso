import { render } from 'preact';

import { App } from '@/app/App';
import { applyTheme } from '@/platform/theme';
import { registerSW } from '@/platform/sw';
import { settings } from '@/state/store';
import '@/styles/base.css';
import '@/styles/v2.css';

/* Tema y acento ANTES del primer pintado: si no, el root aparece con el tema por
   defecto y parpadea (los cambios posteriores los aplica App con el mismo `applyTheme`). */
applyTheme(settings.value.theme, settings.value.accent);

const root = document.getElementById('app');
if (root) render(<App />, root);
else console.error('[pulso] no encuentro #app en index.html');

/* Service worker (solo producción, https/localhost): offline + avisos de descanso */
registerSW();
