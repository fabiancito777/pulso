/**
 * Modal mínimo: scrim + cabecera + cuerpo + pie. Primitiva que reutiliza el CSS
 * heredado (`.modal-scrim/.modal-*` de `base.css`, el mismo de la v1) y que van a
 * compartir los discos, el picker de ejercicios, el de rutinas y (más adelante)
 * el editor de ejercicios.
 *
 * Tres detalles que evitan los típicos molestos:
 *
 * - **ESC y clic fuera cierran**, pero el clic se comprueba en el `mousedown` del
 *   scrim (no en el del diálogo): así arrastrar un texto dentro del modal hacia
 *   fuera no lo cierra al soltar.
 * - **El foco inicial va al propio diálogo** (no a un input): en móvil eso evita
 *   que se abra el teclado solo al aparecer el modal de discos.
 * - **`onClose` va en un ref**: si entrara en las dependencias del `useEffect`,
 *   cada repintado (una tecla en el buscador) re-registraría el listener y
 *   robaría el foco.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

import { Icon } from './Icon';

export interface ModalProps {
  title: string;
  onClose: () => void;
  children?: ComponentChildren;
  /** Botones del pie (van con `flex:1`, lo pone `.modal-foot .btn`). */
  foot?: ComponentChildren;
  /**
   * `false` = solo se cierra con los botones del pie: ni ESC, ni clic fuera, ni la
   * X de la cabecera (el onboarding de la v1 era así, `dismissable:false`).
   */
  dismissable?: boolean;
}

export function Modal({ title, onClose, children, foot, dismissable = true }: ModalProps) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const open = useRef(dismissable);
  open.current = dismissable;

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (open.current && event.key === 'Escape') close.current();
    };
    document.addEventListener('keydown', onKey);
    box.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      class="modal-scrim"
      role="presentation"
      onMouseDown={(event: MouseEvent) => {
        if (open.current && event.target === event.currentTarget) onClose();
      }}
    >
      <div class="modal" role="dialog" aria-modal="true" aria-label={title} ref={box} tabIndex={-1}>
        <div class="grabber" />
        <div class="modal-head">
          <b class="ellipsis">{title}</b>
          {dismissable ? (
            <button type="button" class="icon-btn" title="Cerrar" onClick={onClose}>
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
