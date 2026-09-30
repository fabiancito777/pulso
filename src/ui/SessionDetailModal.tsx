/**
 * Detalle de una sesión guardada (v1 `App.ui.sessionDetail`, `app.js:932-976`).
 *
 * Paridad de acciones, ni más ni menos: **ver · eliminar · repetir**. La v1 no
 * deja editar nombre ni notas (`S.updateSession` no tenía ni un llamador allí),
 * así que aquí tampoco se abre esa puerta (spec S1 §1).
 *
 * Dos detalles que no conviene perder:
 *
 * - el bloque de «N récords nuevos» compara contra las sesiones ANTERIORES a
 *   esta (`prsBefore` + margen 0,01), no contra el histórico completo: borrar la
 *   sesión de antes puede convertir un récord en no-récord, y eso es correcto;
 * - «Repetir» se niega con un aviso si ya hay una sesión en curso (v1
 *   `views-train.js:375`), porque `startFromPlan` en ese caso devolvería la
 *   sesión que ya estaba y parecería que no hacía nada.
 */
import { go } from '@/app/router';
import { durationOf, sessionDate, setsOf, volumeOf } from '@/domain/analytics';
import { label as dateLabel, relative, today } from '@/domain/dates';
import { fmtDur, fmtN, fmtRpe, fmtVol } from '@/domain/format';
import type { Session } from '@/domain/types';
import { startFromPlan } from '@/state/session';
import { active, exercises, removeSession, sessions } from '@/state/store';

import { HelpBtn } from './HelpModal';
import { Icon } from './Icon';
import { repeatItems } from './hoy-helpers';
import { Kpi } from './kit';
import { Modal } from './Modal';
import { newPrs, prsBefore } from './progress-helpers';
import { toast } from './toast';

import '../styles/progreso.css';

/**
 * Confirmación + borrado + aviso, compartido por la lista y por el detalle
 * (mismo patrón que `SettingsView.tsx:594`: `window.confirm` y luego el toast).
 *
 * `before` se ejecuta DESPUÉS de confirmar y ANTES de borrar: es donde la lista
 * cierra sus modales, para que con la última sesión fuera la pestaña vuelva al
 * estado vacío sin dejar un modal huérfano encima.
 */
export function confirmRemoveSession(id: string, before?: () => void): void {
  if (!window.confirm('¿Eliminar la sesión? Esta acción no se puede deshacer.')) return;
  before?.();
  removeSession(id);
  toast('Sesión eliminada', { kind: 'warn' });
}

export function SessionDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const found = sessions.value.find((s) => s.id === id) ?? null;
  if (!found) return null;
  /* anotada: los closures de abajo (borrar, repetir) la ven SIN `null` */
  const session: Session = found;

  const date = sessionDate(session);
  const byId = new Map(exercises.value.map((ex) => [ex.id, ex]));
  const records = newPrs(session, prsBefore(sessions.value, date));
  const prIds = new Set(records.map((r) => r.exId));

  /** Confirmar → cerrar → borrar: así nunca queda el modal sobre un vacío. */
  function remove(): void {
    confirmRemoveSession(id, onClose);
  }

  function repeat(): void {
    if (active.value) {
      toast('Termina la sesión actual primero', { kind: 'warn' });
      return;
    }
    startFromPlan(repeatItems(session), {
      name: session.name || 'Entrenamiento',
      dayIso: today(),
    });
    onClose();
    toast('Sesión cargada con los pesos anteriores', { kind: 'ok' });
    go('entrenar');
  }

  return (
    <Modal
      title={session.name || 'Entrenamiento'}
      onClose={onClose}
      foot={
        <>
          <button type="button" class="btn ghost" onClick={onClose}>
            Cerrar
          </button>
          <button type="button" class="btn danger" onClick={remove}>
            Eliminar
          </button>
          <button type="button" class="btn primary" onClick={repeat}>
            Repetir sesión
          </button>
          <HelpBtn id="flow.repeat" title="Repetir una sesión" />
        </>
      }
    >
      <div class="tiny muted pg2-sub">
        {dateLabel(date, 'medium')} · {relative(date)}
      </div>

      <div class="grid c3">
        <Kpi label="Volumen" value={fmtVol(volumeOf(session))} delta="kg movidos" />
        <Kpi
          label="Series"
          value={fmtN(setsOf(session), 0)}
          delta={`${session.entries.length} ejercicios`}
        />
        <Kpi
          label="Duración"
          value={fmtDur(durationOf(session))}
          delta={session.rpe ? `RPE ${fmtRpe(session.rpe)}` : 'sin RPE'}
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
                  .map((r) => {
                    const ex = byId.get(r.exId);
                    return `${ex ? ex.name : r.exId} · ${fmtN(r.weight)}×${fmtN(r.reps)}`;
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
            const ex = byId.get(entry.exId);
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
                  <div class="li-title">
                    {ex ? ex.name : entry.name || entry.exId}
                    {prIds.has(entry.exId) ? <span class="badge a">PR</span> : null}
                  </div>
                  <div class="li-sub num pg2-sets">{text || 'sin series'}</div>
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
