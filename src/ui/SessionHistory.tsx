/**
 * Historial de sesiones de la pestaña Progreso (v1 `sessionList`,
 * `views-stats.js:158-169`): las 40 primeras en la tarjeta y el 100 % en el
 * modal de «Ver todo» con su subtítulo «N registradas».
 *
 * Cada fila enseña fecha, nombre (con su badge `demo`), volumen, series,
 * duración y grupos; el ojo abre el detalle (`SessionDetailModal`) y la papelera
 * confirma y borra (`confirmRemoveSession`, patrón de `SettingsView`).
 *
 * El orden de la lista lo manda el store: `sessions` ya va por `startedAt`
 * descendente, igual que `S.sessions()` de la v1.
 */
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

import { label as dateLabel } from '@/domain/dates';
import { fmtDur, fmtN, fmtVol } from '@/domain/format';
import type { Session } from '@/domain/types';
import { exercises, sessions } from '@/state/store';

import { Icon } from './Icon';
import { Modal } from './Modal';
import { sessionSummary } from './progress-helpers';
import { confirmRemoveSession, SessionDetailModal } from './SessionDetailModal';
import { SectionHead } from './kit';

import '../styles/progreso.css';

/** La v1 enseñaba 40 en la tarjeta y dejaba el resto para «Ver todo». */
const LIST_LIMIT = 40;

function HistoryRow({
  session,
  onView,
  onDelete,
}: {
  session: Session;
  onView: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const s = sessionSummary(session, exercises.value);
  return (
    <div class="list-item">
      <div class="li-main">
        <div class="li-title">
          {s.name}
          {s.demo ? <span class="badge">demo</span> : null}
        </div>
        <div class="li-sub">
          {dateLabel(s.date, 'medium')} · {fmtVol(s.volume)} kg · {fmtN(s.sets, 0)} series ·{' '}
          {fmtDur(s.minutes * 60_000)}
        </div>
        {s.groups.length ? <div class="li-sub pg2-groups">{s.groups.join(' · ')}</div> : null}
      </div>
      <div class="pg2-actions">
        <button type="button" class="icon-btn" title="Ver detalle" onClick={() => onView(s.id)}>
          <Icon name="eye" />
        </button>
        <button
          type="button"
          class="icon-btn"
          title="Eliminar sesión"
          onClick={() => onDelete(s.id)}
        >
          <Icon name="trash" />
        </button>
      </div>
    </div>
  );
}

export function SessionHistory() {
  const list = sessions.value;
  const [all, setAll] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const view = (id: string): void => {
    setAll(false);
    setDetailId(id);
  };
  const remove = (id: string): void => {
    confirmRemoveSession(id, () => {
      setAll(false);
      setDetailId(null);
    });
  };
  const rows = (shown: readonly Session[]): ComponentChildren[] =>
    shown.map((s) => <HistoryRow key={s.id} session={s} onView={view} onDelete={remove} />);

  return (
    <section class="card">
      <SectionHead
        title="Historial de sesiones"
        right={
          list.length ? (
            <button type="button" class="btn quiet sm" onClick={() => setAll(true)}>
              Ver todo
            </button>
          ) : undefined
        }
      />

      {list.length ? (
        <div class="card flush mt-s">
          <div class="list">{rows(list.slice(0, LIST_LIMIT))}</div>
        </div>
      ) : (
        <div class="empty">Sin sesiones</div>
      )}

      {all ? (
        <Modal title="Historial de sesiones" onClose={() => setAll(false)}>
          <div class="tiny muted pg2-sub">{fmtN(list.length, 0)} registradas</div>
          <div class="card flush">
            <div class="list">{rows(list)}</div>
          </div>
        </Modal>
      ) : null}

      {detailId ? <SessionDetailModal id={detailId} onClose={() => setDetailId(null)} /> : null}
    </section>
  );
}
