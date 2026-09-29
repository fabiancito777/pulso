/**
 * Tabla COMPLETA de récords personales (v1 `prTable(0)` + el modal
 * `stats:prs`, `views-stats.js:188/212`).
 *
 * `PrTableButton` es lo que `ProgressCharts` monta tras su top-6 (por la prop
 * `prExtra`); el modal lista todos los ejercicios con récord, con su
 * `Sparkline` de los últimos 8 puntos, y al pulsar una fila se SELECCIONA ese
 * ejercicio en «Progresión» (`pickedExercise`) y se cierra: el chip queda
 * resaltado arriba, igual que en la v1.
 */
import { useState } from 'preact/hooks';

import { exerciseSeries } from '@/domain/analytics';
import { findExercise, groupColor } from '@/domain/data';
import { label as dateLabel } from '@/domain/dates';
import { fmtN } from '@/domain/format';
import { pickExercise } from '@/state/progress';
import { exercises, sessions } from '@/state/store';

import { Sparkline } from './charts';
import { Modal } from './Modal';
import { prRows } from './progress-helpers';

export function PrTableModal({ onClose }: { onClose: () => void }) {
  const rows = prRows(sessions.value);
  const pick = (exId: string): void => {
    pickExercise(exId);
    onClose();
  };

  return (
    <Modal title="Récords personales" onClose={onClose}>
      <div class="tiny muted pg2-sub">1RM estimado por ejercicio</div>
      {rows.length ? (
        <div class="card flush">
          <div class="list">
            {rows.map((r) => {
              const info = findExercise(exercises.value, r.exId);
              const hist = exerciseSeries(sessions.value, r.exId).slice(-8);
              return (
                <button
                  key={r.exId}
                  type="button"
                  class="list-item tappable"
                  onClick={() => pick(r.exId)}
                >
                  <div class="li-main">
                    <div class="li-title">{info ? info.name : r.exId}</div>
                    <div class="li-sub">
                      {fmtN(r.weight)} kg × {fmtN(r.reps)} · {dateLabel(r.date, 'medium')}
                    </div>
                  </div>
                  <div class="ch-pr">
                    <div class="num">{fmtN(r.e1rm)}</div>
                    <div class="tiny muted">1RM est.</div>
                  </div>
                  <Sparkline
                    points={hist.map((p) => p.e1rm)}
                    color={info ? groupColor(info.group) : 'var(--accent)'}
                    ariaLabel={`Tendencia de 1RM de ${info ? info.name : r.exId}`}
                  />
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div class="empty">Sin récords aún</div>
      )}
    </Modal>
  );
}

/** El botón «Ver tabla completa» de debajo del top-6 (`prExtra` de los gráficos). */
export function PrTableButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" class="btn ghost block mt-s" onClick={() => setOpen(true)}>
        Ver tabla completa
      </button>
      {open ? <PrTableModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}
