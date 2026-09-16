import { render } from 'preact';

import { App } from '@/app/App';
import '@/styles/base.css';
import '@/styles/v2.css';

const root = document.getElementById('app');
if (root) render(<App />, root);
else console.error('[pulso] no encuentro #app en index.html');
