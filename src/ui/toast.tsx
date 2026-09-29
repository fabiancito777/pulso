/**
 * Avisos flotantes (el `U.toast` de la v1, `legacy/js/core.js:217`) con el CSS
 * que ya estaba en `base.css` (`.toasts` / `.toast`).
 *
 * No se monta en `App.tsx`: el host es un `<div>` que este módulo crea en
 * `document.body` a la primera llamada y en el que renderiza `<ToastHost />`,
 * así que cualquier vista puede avisar sin cablear nada en el shell. Si no hay
 * DOM (tests en Node) el aviso se descarta en silencio.
 *
 * Igual que en la v1: como máximo 3 a la vez, `err` dura 6 s y el resto 2,8 s
 * (o el `ms` pedido); con `sticky` no se cierra solo y hay que llamar a
 * `close()` — es lo que usan los spinners de «Probando…» y «Consultando
 * modelos…».
 */
import { signal } from '@preact/signals';
import { render } from 'preact';

import { Icon } from '@/ui/Icon';

export type ToastKind = 'ok' | 'err' | 'warn' | '';

export interface ToastOpts {
  /** borde del aviso: `ok`, `err`, `warn` o neutro */
  kind?: ToastKind;
  /** milisegundos visibles (por defecto 6000 en `err` y 2800 en el resto) */
  ms?: number;
  /** no se cierra solo: hay que guardar el `close()` que devuelve */
  sticky?: boolean;
  /** spinner en vez de icono (para operaciones en curso) */
  loading?: boolean;
}

interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
  loading: boolean;
}

/** El estado vive en un signal: repinta solo al host, sin estado en la app. */
const toasts = signal<ToastItem[]>([]);

let host: HTMLElement | null = null;
let seq = 0;

function ToastHost() {
  const list = toasts.value;
  if (!list.length) return null;
  return (
    <div class="toasts">
      {list.map((t) => (
        <div key={t.id} class={`toast ${t.kind}`} role="status">
          {t.loading ? (
            <div class="spinner" />
          ) : t.kind === 'ok' ? (
            <Icon name="check" />
          ) : t.kind === 'err' || t.kind === 'warn' ? (
            <Icon name="alert" />
          ) : null}
          <div class="grow">{t.text}</div>
        </div>
      ))}
    </div>
  );
}

function ensureHost(): void {
  if (host || typeof document === 'undefined') return;
  host = document.createElement('div');
  host.id = 'toast-root';
  document.body.appendChild(host);
  render(<ToastHost />, host);
}

/** Muestra un aviso. Devuelve `close()` para cerrarlo a mano (toasts `sticky`). */
export function toast(text: string, opts: ToastOpts = {}): { close: () => void } {
  const id = ++seq;
  const kind = opts.kind ?? '';
  const close = (): void => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  };
  if (typeof document === 'undefined') return { close };

  ensureHost();
  toasts.value = [...toasts.value, { id, text, kind, loading: opts.loading === true }].slice(-3);
  if (opts.sticky) return { close };

  const timer = setTimeout(close, opts.ms ?? (kind === 'err' ? 6000 : 2800));
  return {
    close: () => {
      clearTimeout(timer);
      close();
    },
  };
}
