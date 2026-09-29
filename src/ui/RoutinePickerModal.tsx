/**
 * Picker de rutinas en modal para añadir una rutina a la sesión EN CURSO
 * (v1 `ui.routinePicker` de `app.js:372`, con el mismo aviso: lo que ya está
 * hecho no se toca y la rutina se apila al final).
 *
 * Es el "añadir rutina" del criterio 3 de la spec: la rutina se transforma en
 * ejercicios con `entriesFromRoutine`, no reemplaza nada.
 */
import { useState } from 'preact/hooks';

import { fmtN } from '@/domain/format';
import { routines } from '@/state/store';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { routineSets } from './routines-helpers';

export interface RoutinePickerModalProps {
  onClose: () => void;
  /** id de la rutina elegida (se confirma con «Añadir»). */
  onPick: (routineId: string) => void;
}

export function RoutinePickerModal({ onClose, onPick }: RoutinePickerModalProps) {
  const [selected, setSelected] = useState('');
  const list = routines.value;
  const chosen = list.find((r) => r.id === selected);

  return (
    <Modal
      title="Añadir rutina"
      onClose={onClose}
      foot={
        <>
          <button type="button" class="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            class="btn primary"
            disabled={!selected}
            onClick={() => onPick(selected)}
          >
            {selected ? 'Añadir a la sesión' : 'Añadir'}
          </button>
        </>
      }
    >
      {list.length ? (
        <div class="card flush" style="max-height:46dvh;overflow:auto">
          {list.map((r) => {
            const on = selected === r.id;
            return (
              <button
                key={r.id}
                type="button"
                class={`ex-pick${on ? ' on' : ''}`}
                onClick={() => setSelected(on ? '' : r.id)}
              >
                <div class="grow" style="min-width:0">
                  <div class="ellipsis" style="font-size:14px;font-weight:600">
                    {r.name}
                  </div>
                  <div class="tiny muted ellipsis">
                    {fmtN(r.items.length, 0)} ejercicios · {routineSets(r.items)} series
                    {r.focus ? ` · ${r.focus}` : ''}
                  </div>
                </div>
                <Icon name={on ? 'check-circle' : 'plus'} />
              </button>
            );
          })}
        </div>
      ) : (
        <div class="empty">
          <Icon name="list" />
          <div>No tienes rutinas guardadas todavía</div>
        </div>
      )}
      <div class="tiny muted mt-s">
        {chosen
          ? chosen.items.length === 1
            ? 'Se añadirá 1 ejercicio al final de la sesión actual; las series que ya has hecho no se tocan.'
            : `Se añadirán ${fmtN(chosen.items.length, 0)} ejercicios al final de la sesión actual; las series que ya has hecho no se tocan.`
          : 'Elige una rutina: se apila al final de la sesión en curso.'}
      </div>
    </Modal>
  );
}
