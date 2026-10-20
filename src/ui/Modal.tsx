/**
 * Modal compartido: scrim + cabecera + cuerpo + pie. Primitiva que reutiliza el
 * CSS heredado (`.modal-scrim/.modal-*` de `base.css`, el mismo de la v1) y que
 * comparten los discos, el picker de ejercicios, el de rutinas, Ajustes y la
 * ayuda.
 *
 * Detalles que evitan los típicos molestos:
 *
 * - **Pila de modales**: Escape y el clic en el scrim cierran SOLO el superior
 *   (`modal-stack.ts`), aunque haya varios abiertos a la vez.
 * - **Trampa de foco**: Tab/Shift+Tab ciclan dentro del diálogo y al cerrar se
 *   devuelve el foco al elemento que lo tenía antes.
 * - **Scroll bloqueado** mientras hay un modal (se restaura con el último).
 * - **El clic se comprueba en el `mousedown` del scrim** (no en el del diálogo):
 *   así arrastrar un texto dentro del modal hacia fuera no lo cierra al soltar.
 * - **El foco inicial va al propio diálogo** (no a un input): en móvil eso evita
 *   que se abra el teclado solo al aparecer el modal.
 * - **`onClose` va en un ref**: si entrara en las dependencias del `useEffect`,
 *   cada repintado (una tecla en el buscador) re-registraría el listener.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

import type { HelpId } from './help-content';
import { Icon } from './Icon';
import { HelpBtn } from './HelpModal';
import { closeTopModal, isTopModal, pushModal, removeModal } from './modal-stack';

export interface ModalProps {
  title: string;
  /** Subrayado bajo el título (Ajustes lo usaba en su modal local). */
  sub?: string;
  onClose: () => void;
  children?: ComponentChildren;
  /** Botones del pie (van con `flex:1`, lo pone `.modal-foot .btn`). */
  foot?: ComponentChildren;
  /**
   * `false` = solo se cierra con los botones del pie: ni ESC, ni clic fuera, ni la
   * X de la cabecera (el onboarding de la v1 era así, `dismissable:false`).
   */
  dismissable?: boolean;
  /** Tema de ayuda del modal: pinta el ⓘ en la cabecera. */
  help?: HelpId;
}

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

let scrollLocks = 0;
let previousOverflow = '';

function lockScroll(): void {
  if (typeof document === 'undefined') return;
  if (scrollLocks === 0) previousOverflow = document.body.style.overflow;
  scrollLocks += 1;
  document.body.style.overflow = 'hidden';
}

function unlockScroll(): void {
  if (typeof document === 'undefined' || scrollLocks === 0) return;
  scrollLocks -= 1;
  if (scrollLocks === 0) document.body.style.overflow = previousOverflow;
}

function focusableIn(box: HTMLElement): HTMLElement[] {
  return Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getAttribute('aria-hidden') !== 'true',
  );
}

export function Modal({
  title,
  sub,
  onClose,
  children,
  foot,
  dismissable = true,
  help,
}: ModalProps) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const idRef = useRef<number | null>(null);

  useEffect(() => {
    const previous =
      typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const id = pushModal({ dismissable, close: () => close.current() });
    idRef.current = id;
    lockScroll();
    box.current?.focus();

    const onKey = (event: KeyboardEvent): void => {
      if (!isTopModal(id)) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        closeTopModal();
        return;
      }

      if (event.key !== 'Tab' || !box.current) return;
      const items = focusableIn(box.current);
      if (!items.length) {
        event.preventDefault();
        box.current.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      const inside = active instanceof Node && box.current.contains(active);
      const onBox = active === box.current;
      if (event.shiftKey && (onBox || active === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (onBox || active === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      removeModal(id);
      idRef.current = null;
      unlockScroll();
      if (previous && previous.isConnected && previous !== document.body) previous.focus();
    };
  }, [dismissable]);

  return (
    <div
      class="modal-scrim"
      role="presentation"
      onMouseDown={(event: MouseEvent) => {
        if (event.target !== event.currentTarget) return;
        const id = idRef.current;
        if (id !== null && isTopModal(id)) closeTopModal();
      }}
    >
      <div class="modal" role="dialog" aria-modal="true" aria-label={title} ref={box} tabIndex={-1}>
        <div class="grabber" />
        <div class="modal-head">
          <div class="row" style="gap:4px;min-width:0;flex:1">
            <div style="min-width:0;flex:1">
              <b class="ellipsis" style="display:block;min-width:0">
                {title}
              </b>
              {sub ? (
                <div class="tiny muted ellipsis" style="min-width:0">
                  {sub}
                </div>
              ) : null}
            </div>
            {help ? <HelpBtn id={help} title={title} /> : null}
          </div>
          {dismissable ? (
            <button
              type="button"
              class="icon-btn"
              aria-label="Cerrar"
              title="Cerrar"
              onClick={onClose}
            >
              <Icon name="x" />
            </button>
          ) : null}
        </div>
        <div class="modal-body">{children}</div>
        {foot ? <div class="modal-foot">{foot}</div> : null}
      </div>
    </div>
  );
}
