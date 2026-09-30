/**
 * Modal de discos de un ejercicio: el `Plates` ya portado dentro del primitivo
 * `Modal`, en vez de en línea (el dibujo es ancho y en móvil empujaría las series).
 *
 * El peso inicial es el último peso ≠ 0 de la entrada (v1 `views-train.js:477`) y
 * "Usar X" lo escribe donde decida `plateTarget` — la primera serie pendiente sin
 * peso, si no la última (`views-train.js:485`). El modo de carga se recuerda POR
 * EJERCICIO, como en la v1, así que al reabrirlo sale el que usarías.
 */
import { plateInitialWeight } from '@/domain/session';
import type { ActiveEntry } from '@/domain/types';
import { rememberPlateMode, settings } from '@/state/store';
import { Modal } from './Modal';
import { Plates } from './Plates';

export interface PlatesModalProps {
  entry: ActiveEntry;
  onClose: () => void;
  /** kg en la unidad del usuario (la serie ya está escrita al llamar) */
  onUse: (kg: number) => void;
}

export function PlatesModal({ entry, onClose, onUse }: PlatesModalProps) {
  const s = settings.value;
  return (
    <Modal
      title={`Discos · ${entry.name}`}
      onClose={onClose}
      foot={
        <button type="button" class="btn ghost" onClick={onClose}>
          Cerrar
        </button>
      }
    >
      <Plates
        plates={s.plates}
        bars={s.bars}
        unit={s.units}
        initialTarget={plateInitialWeight(entry) || ''}
        initialMode={s.plateModes[entry.exId] ?? 'bar'}
        exerciseName={entry.name}
        onModeChange={(mode) => rememberPlateMode(entry.exId, mode)}
        onUse={onUse}
      />
    </Modal>
  );
}
