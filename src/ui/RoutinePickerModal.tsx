/**
 * Picker de rutinas en modal para añadir una rutina a la sesión EN CURSO
 * (antes `ui.routinePicker` de `app.js:372`, con el mismo aviso: lo que ya está
 * hecho no se toca y la rutina se apila al final).
 *
 * Un toque en la fila **añade**. Antes la fila solo marcaba y el alta estaba en el
 * botón del pie: tocar la rutina no daba ninguna respuesta visible y parecía roto.
 * Con una sola elección posible, el paso extra solo escondía la acción.
 */
import { fmtN } from '@/domain/format';
import { routines } from '@/state/store';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { routineSets } from './routines-helpers';

export interface RoutinePickerModalProps {
  onClose: () => void;
  /** id de la rutina tocada: se añade a la sesión y el modal se cierra. */
  onPick: (routineId: string) => void;
}

export function RoutinePickerModal({ onClose, onPick }: RoutinePickerModalProps) {
  const list = routines.value;

  return (
    <Modal
      title="Añadir rutina"
      onClose={onClose}
      foot={
        <button type="button" class="btn ghost" onClick={onClose}>
          Cancelar
        </button>
      }
    >
      {list.length ? (
        <div class="card flush" style="max-height:46dvh;overflow:auto">
          {list.map((r) => (
            <button key={r.id} type="button" class="ex-pick" onClick={() => onPick(r.id)}>
              <div class="grow" style="min-width:0">
                <div class="ellipsis" style="font-size:14px;font-weight:600">
                  {r.name}
                </div>
                <div class="tiny muted ellipsis">
                  {fmtN(r.items.length, 0)} ejercicios · {routineSets(r.items)} series
                  {r.focus ? ` · ${r.focus}` : ''}
                </div>
              </div>
              <Icon name="plus" />
            </button>
          ))}
        </div>
      ) : (
        <div class="empty">
          <Icon name="list" />
          <div>No tienes rutinas guardadas todavía</div>
        </div>
      )}
      <div class="tiny muted mt-s">
        Toca una rutina: se apila al final de la sesión actual y las series que ya has hecho no se
        tocan.
      </div>
    </Modal>
  );
}
