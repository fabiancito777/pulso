/**
 * Hoja de fin de sesión: lo que se ve JUSTO después de pulsar «Finalizar».
 *
 * Por qué existe: antes el único acuse era una línea `tiny` dentro de
 * `SessionCard`, y esa tarjeta se desmonta al terminar cuando cierras desde Hoy
 * (`App.tsx` → `sessionDockMode`), así que la confirmación desaparecía con ella.
 * Peor aún: el texto solo decía el volumen, no DEMOSTRABA nada. Aquí se enseña
 * lo guardado y lo que ha mejorado, que es lo que el usuario quiere comprobar.
 *
 * Reglas que no conviene romper:
 *
 * - **No la cierra el tiempo**: se queda hasta que el usuario la cierra (o usa
 *   uno de los atajos del pie). Un aviso que se esfuma solo no confirma nada.
 * - **Todo sale del resumen ya calculado** (`sessionDoneSummary`): aquí solo se
 *   formatea. Si no hay sesión anterior o no hay récords, esas filas NO se
 *   pintan; nada de «+0 kg» ni de huecos vacíos.
 * - Vive en la pila de modales (`ui/Modal.tsx`), no en un diálogo propio.
 */
import { fmtDur, fmtN, fmtVol } from '@/domain/format';
import { label as dateLabel } from '@/domain/dates';
import { resolveExercise } from '@/domain/data';
import type { Session } from '@/domain/types';
import { exercises } from '@/state/store';

import { Icon } from './Icon';
import { Kpi } from './kit';
import { Modal } from './Modal';
import type { SessionDoneSummary } from './session-done-helpers';

import '../styles/progreso.css';

/** Texto del delta: «+1,2k kg vs. el 22 sep». Sin anterior no se pinta. */
function deltaText(summary: SessionDoneSummary): string | null {
  if (summary.delta === null || summary.previousDate === null) return null;
  const sign = summary.delta > 0 ? '+' : summary.delta < 0 ? '−' : '';
  const abs = Math.abs(summary.delta);
  return `${sign}${fmtVol(abs)} kg vs. el ${dateLabel(summary.previousDate, 'short')}`;
}

export interface SessionDoneSheetProps {
  summary: SessionDoneSummary;
  onClose: () => void;
  /** «Ver en Progreso» */
  onProgress: () => void;
  /** «Ver el día» en el calendario */
  onCalendar: () => void;
  /** «Repetir esta sesión» (opcional: solo si la vista puede) */
  onRepeat?: (session: Session) => void;
}

export function SessionDoneSheet({
  summary,
  onClose,
  onProgress,
  onCalendar,
  onRepeat,
}: SessionDoneSheetProps) {
  const { session, records } = summary;
  const delta = deltaText(summary);

  return (
    <Modal
      title="Sesión guardada"
      sub={session.name}
      onClose={onClose}
      foot={
        <>
          {onRepeat ? (
            <button
              type="button"
              class="btn"
              onClick={() => {
                onClose();
                onRepeat(session);
              }}
            >
              Repetir
            </button>
          ) : null}
          <button
            type="button"
            class="btn"
            onClick={() => {
              onClose();
              onCalendar();
            }}
          >
            Calendario
          </button>
          <button
            type="button"
            class="btn primary"
            onClick={() => {
              onClose();
              onProgress();
            }}
          >
            Progreso
          </button>
        </>
      }
    >
      <div class="card tight accent">
        <div class="row">
          <span class="ico accent">
            <Icon name="check" />
          </span>
          <div class="grow">
            <div class="h3">Guardada</div>
            <div class="tiny muted">
              {summary.sets} {summary.sets === 1 ? 'serie' : 'series'} ·{' '}
              {summary.exercises} {summary.exercises === 1 ? 'ejercicio' : 'ejercicios'}
              {summary.streak > 1 ? ` · racha de ${summary.streak} días` : ''}
            </div>
          </div>
        </div>
      </div>

      <div class="grid c3 mt">
        <Kpi label="Volumen" value={fmtVol(summary.volume)} delta={delta ?? 'kg movidos'} />
        <Kpi label="Series" value={fmtN(summary.sets, 0)} delta={`${summary.exercises} ejercicios`} />
        <Kpi
          label="Duración"
          value={fmtDur(summary.duration)}
          delta={session.rpe ? `RPE ${fmtN(session.rpe, 1)}` : 'sin RPE'}
        />
      </div>

      {records.length ? (
        <div class="card tight accent mt">
          <div class="row">
            <span class="ico accent">
              <Icon name="fire" />
            </span>
            <div class="grow">
              <div class="h3">
                {records.length} {records.length === 1 ? 'récord nuevo' : 'récords nuevos'}
              </div>
              <div class="tiny muted">
                {records
                  .map((record) => {
                    const ex = resolveExercise(exercises.value, record.exId);
                    return `${ex ? ex.name : record.exId} · ${fmtN(record.weight)}×${fmtN(record.reps)}`;
                  })
                  .join(' · ')}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div class="card flush mt">
        <div class="list">
          {session.entries.map((entry, i) => {
            const ex = resolveExercise(exercises.value, entry.exId);
            const sets = Array.isArray(entry.sets) ? entry.sets : [];
            const text = sets
              .map((set) => {
                const reps = fmtN(set.reps);
                const load =
                  set.weight === null || set.weight === undefined
                    ? `×${reps}`
                    : `${fmtN(set.weight)}×${reps}`;
                return `${load}${set.rpe ? ` (RPE ${fmtN(set.rpe, 1)})` : ''}`;
              })
              .join(' · ');
            return (
              <div key={`${entry.exId}-${i}`} class="list-item">
                <div class="li-main">
                  <div class="li-title">{ex ? ex.name : entry.name || entry.exId}</div>
                  <div class="li-sub num">{text || 'sin series'}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {session.notes ? (
        <div class="card tight mt">
          <div class="tiny muted">Nota</div>
          <div class="tiny">{session.notes}</div>
        </div>
      ) : null}
    </Modal>
  );
}
