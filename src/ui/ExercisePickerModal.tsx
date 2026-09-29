/**
 * Picker de ejercicios en modal, con multiselección: sustituye al `<select>` de
 * una sola opción de la tarjeta de sesión (v1 `App.ui.exercisePicker({multi:true})`
 * de `app.js:353`, con el mismo comportamiento):
 *
 * - **excluye** los `exId` que ya están en la sesión (no se pueden añadir dos veces);
 * - **orden v1** (`app.js:368`): disponibles y permitidos → familiaridad (los que
 *   ya has hecho, de más a menos) → nombre. Lo que te falta material o lo tienes
 *   desactivado queda ABAJO, pero **se puede añadir igual**: solo es un aviso;
 * - búsqueda tolerante a tildes (`domain/text.norm`) y filtro por grupo;
 * - el contador dice «N seleccionados» mientras no confirmes.
 */
import { useState } from 'preact/hooks';

import { GROUPS, groupLabel, isAvailable, missingEquipment } from '@/domain/data';
import { fmtN } from '@/domain/format';
import { norm, trunc } from '@/domain/text';
import type { Exercise } from '@/domain/types';
import { equipment, exercises, sessions } from '@/state/store';
import { Icon } from './Icon';
import { Modal } from './Modal';

export interface ExercisePickerModalProps {
  title?: string;
  /** `exId` que no se pueden elegir (los que ya están en la sesión). */
  exclude?: readonly string[];
  onClose: () => void;
  onPick: (ids: string[]) => void;
}

export function ExercisePickerModal({
  title = 'Añadir ejercicios',
  exclude = [],
  onClose,
  onPick,
}: ExercisePickerModalProps) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [selected, setSelected] = useState<readonly string[]>([]);

  const equip = equipment.value;
  const hidden = new Set(exclude);
  const needle = norm(query);

  /* familiaridad: cuántas sesiones del historial traen cada ejercicio (v1 `S.familiarity`) */
  const fam = new Map<string, number>();
  for (const session of sessions.value) {
    for (const entry of session.entries) fam.set(entry.exId, (fam.get(entry.exId) ?? 0) + 1);
  }
  const rank = (ex: Exercise): number => (ex.allowed && isAvailable(ex, equip) ? 0 : 1);

  const items = exercises.value
    .filter((ex) => !hidden.has(ex.id))
    .filter((ex) => !group || ex.group === group)
    .filter((ex) => !needle || norm(ex.name).includes(needle))
    .sort((a, b) => {
      const byRank = rank(a) - rank(b);
      if (byRank) return byRank;
      const byFam = (fam.get(b.id) ?? 0) - (fam.get(a.id) ?? 0);
      if (byFam) return byFam;
      return a.name < b.name ? -1 : 1;
    });

  const toggle = (id: string): void =>
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );

  return (
    <Modal
      title={title}
      onClose={onClose}
      foot={
        <>
          <button type="button" class="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            class="btn primary"
            disabled={!selected.length}
            onClick={() => onPick([...selected])}
          >
            {selected.length ? `Añadir ${fmtN(selected.length, 0)}` : 'Añadir'}
          </button>
        </>
      }
    >
      <div class="search">
        <Icon name="search" />
        <input
          class="input"
          type="search"
          placeholder="Buscar…"
          autocomplete="off"
          value={query}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
      </div>

      <div class="seg mt-s">
        <button type="button" class={group ? '' : 'on'} onClick={() => setGroup('')}>
          Todos
        </button>
        {GROUPS.map((g) => (
          <button
            key={g.key}
            type="button"
            class={group === g.key ? 'on' : ''}
            onClick={() => setGroup(g.key)}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div class="card flush mt-s" style="max-height:46dvh;overflow:auto">
        {items.length ? (
          items.map((ex) => {
            const on = selected.includes(ex.id);
            const missing = missingEquipment(ex, equip);
            return (
              <button
                key={ex.id}
                type="button"
                class={`ex-pick${on ? ' on' : ''}`}
                onClick={() => toggle(ex.id)}
              >
                <div class="grow" style="min-width:0">
                  <div class="ellipsis" style="font-size:14px;font-weight:600">
                    {ex.name}
                  </div>
                  <div class="tiny muted ellipsis">
                    {groupLabel(ex.group)} · {ex.type}
                    {missing.length ? (
                      <>
                        {' · '}
                        <span class="warn">falta {trunc(missing.join(', '), 28)}</span>
                      </>
                    ) : null}
                  </div>
                </div>
                {ex.allowed ? null : <span class="badge danger">off</span>}
                <Icon name={on ? 'check-circle' : 'plus'} />
              </button>
            );
          })
        ) : (
          <div class="empty">
            <Icon name="search" />
            <div>Nada que mostrar con ese filtro</div>
          </div>
        )}
      </div>

      <div class="tiny muted mt-s">
        {selected.length
          ? `${fmtN(selected.length, 0)} ${selected.length === 1 ? 'seleccionado' : 'seleccionados'}`
          : 'Selecciona uno o varios ejercicios'}
      </div>
    </Modal>
  );
}
