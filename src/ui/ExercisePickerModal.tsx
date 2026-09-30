/**
 * Picker de ejercicios en modal, con multiselección: sustituye al `<select>` de
 * una sola opción de la tarjeta de sesión (v1 `App.ui.exercisePicker({multi:true})`
 * de `app.js:353`, con el mismo comportamiento):
 *
 * - **excluye** los `exId` que ya están en la sesión (no se pueden añadir dos veces);
 * - **solo disponibles por defecto** (spec `ejercicios-revamp.md` §3.2): la lista
 *   arranca con lo que puedes hacer hoy y se abre con el chip «Solo
 *   disponibles»; los ocultos (`hidden`) no salen nunca;
 * - **orden** (`ui/picker-helpers.ts`): ★ → permitidos y disponibles →
 *   familiaridad (los que ya has hecho, de más a menos) → nombre. Con el filtro
 *   abierto lo que te falta material o lo tienes desactivado no aparece; con el
 *   filtro apagado queda ABAJO, pero **se puede añadir igual**: solo es un aviso;
 * - búsqueda tolerante a tildes (`domain/text.norm`) y filtro por grupo;
 * - el contador dice «N seleccionados» mientras no confirmes;
 * - con `onlyIds` solo se pueden elegir los que ya aparecen en el historial (es
 *   el `onlyDone` de la v1, con el que Progresión abre el picker de «Otro»).
 */
import { useState } from 'preact/hooks';

import { GROUPS, groupLabel, missingEquipment } from '@/domain/data';
import { fmtN } from '@/domain/format';
import { norm, trunc } from '@/domain/text';
import { equipment, exercises, sessions } from '@/state/store';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { orderPickerItems, visiblePickerItems } from './picker-helpers';

export interface ExercisePickerModalProps {
  title?: string;
  /** `exId` que no se pueden elegir (los que ya están en la sesión). */
  exclude?: readonly string[];
  /** Si se pasa, SOLO se pueden elegir estos (v1 `onlyDone`: los ya entrenados). */
  onlyIds?: readonly string[];
  onClose: () => void;
  onPick: (ids: string[]) => void;
}

export function ExercisePickerModal({
  title = 'Añadir ejercicios',
  exclude = [],
  onlyIds,
  onClose,
  onPick,
}: ExercisePickerModalProps) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [selected, setSelected] = useState<readonly string[]>([]);
  /* comportamiento por defecto: solo lo que puedes hacer hoy (spec §3.2) */
  const [onlyAvail, setOnlyAvail] = useState(true);

  const equip = equipment.value;
  const needle = norm(query);

  /* familiaridad: cuántas sesiones del historial traen cada ejercicio (v1 `S.familiarity`) */
  const fam = new Map<string, number>();
  for (const session of sessions.value) {
    for (const entry of session.entries) fam.set(entry.exId, (fam.get(entry.exId) ?? 0) + 1);
  }

  const items = orderPickerItems(
    visiblePickerItems(exercises.value, {
      equip,
      availableOnly: onlyAvail,
      exclude,
      ...(onlyIds ? { onlyIds } : {}),
    }),
    { fam, equip },
  ).filter((ex) => (!group || ex.group === group) && (!needle || norm(ex.name).includes(needle)));

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

      <div class="row between mt-s" style="gap:8px">
        <button
          type="button"
          class={`toggle-pill ${onlyAvail ? 'on' : 'off'}`}
          aria-pressed={onlyAvail}
          onClick={() => setOnlyAvail((on) => !on)}
        >
          <Icon name="filter" />
          Solo disponibles
        </button>
        <span class="tiny muted">{fmtN(items.length, 0)} en la lista</span>
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
                    {ex.fav === true ? <span class="ex-star">★ </span> : null}
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
            <div>
              {onlyAvail
                ? 'Nada disponible con ese filtro · prueba a abrir «Solo disponibles»'
                : 'Nada que mostrar con ese filtro'}
            </div>
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
