/**
 * Vista Rutinas: port de `legacy/js/views-routines.js` y del `App.ui.routineEditor`
 * de `legacy/js/app.js` (la v1 los abría en modales; aquí cada pantalla es un
 * componente).
 *
 * Dos vistas en una, conmutadas por `editId`: el listado (tarjetas con Empezar,
 * Editar, Duplicar y Eliminar + la propuesta del coach) y el editor.
 *
 * Reglas que respeta:
 *
 * - **Todo lo que se guarda pasa por los setters del store** (`addRoutine`,
 *   `updateRoutine`, `removeRoutine`), que hacen lectura-modificación-escritura
 *   sobre `localStorage`: aquí NO se muta `routines.value` ni un clon suyo, porque
 *   la v1 puede estar escribiendo el mismo estado en otra pestaña.
 * - **Los datos salen de las signals** (`routines`, `exercises`, `sessions`,
 *   `settings`, `active`), no por props: el componente se repinta solo.
 * - Lo que es lógica con casos borde (la propuesta del coach llega como texto,
 *   la búsqueda tolera tildes) vive en `routines-helpers.ts`, con sus tests.
 */
import { useState } from 'preact/hooks';

import { go } from '@/app/router';
import { GOAL_REPS, GOAL_REST, TEMPLATES, goalLabel, groupLabel, isAvailable } from '@/domain/data';
import { label as dateLabel, relative, today } from '@/domain/dates';
import { fmtN, inputNum } from '@/domain/format';
import { matchExercise, unresolvedNames } from '@/domain/match';
import { clamp, int } from '@/domain/num';
import { findTemplate } from '@/domain/plan';
import { trunc } from '@/domain/text';
import type { Exercise, RoutineItem } from '@/domain/types';
import { parseJSON } from '@/features/coach/parse';
import { applySuggestionAsRoutine, hasApiKey, runCoachTask } from '@/state/coach';
import { addRoutineToSession, startFromRoutine } from '@/state/session';
import {
  active,
  addRoutine,
  equipment,
  exercises,
  findRoutine,
  removeRoutine,
  routines,
  schedule,
  sessions,
  setDay,
  settings,
  updateRoutine,
} from '@/state/store';
import type { Routine } from '@/state/store';
import { HelpBtn } from './HelpModal';
import { Icon } from './Icon';
import { InfoCard, SectionHead, TextRow } from './kit';
import { Modal } from './Modal';
import {
  DEFAULT_ROTATE,
  ROTATE_OPTIONS,
  autoRoutineItems,
  bounded,
  detailRows,
  generateAuto,
  lastUsed,
  matchExercises,
  nextFreeDay,
  routineSets,
  scheduleRoutinePatch,
  sourceBadge,
  templateSummary,
  toSuggestion,
  validScheduleIso,
  weightOrNull,
} from './routines-helpers';
import type { AutoProposal, RoutineSuggestion } from './routines-helpers';

import '../styles/routines.css';

/** Aviso de la vista (guardado, error, sesión ya en curso…) con acción opcional. */
interface Notice {
  kind: 'ok' | 'warn' | 'err';
  text: string;
  action?: { label: string; run: () => void };
}

function NoticeBox({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  return (
    <div class={`rt-notice ${notice.kind}`}>
      <Icon name={notice.kind === 'ok' ? 'check' : 'alert'} />
      <span class="grow">{notice.text}</span>
      {notice.action ? (
        <button type="button" class="btn sm okline" onClick={notice.action.run}>
          {notice.action.label}
        </button>
      ) : null}
      <button type="button" class="btn sm quiet" aria-label="Cerrar aviso" onClick={onClose}>
        <Icon name="x" />
      </button>
    </div>
  );
}

/** La propuesta del coach, ya normalizada, con su tabla y sus botones. */
function ProposalCard({
  proposal,
  unit,
  library,
  onApply,
  onDiscard,
}: {
  proposal: RoutineSuggestion;
  unit: string;
  library: readonly Exercise[];
  onApply: () => void;
  onDiscard: () => void;
}) {
  const unmatched = proposal.exercises.filter((ex) => !ex.matched).length;
  /* El motivo se recalcula aquí con el MISMO matcher que usará «Aplicar»
     (`domain/match`): si el veto de atributos rechazó el nombre, el badge no
     puede decir «no está en tu biblioteca» si ahí está. */
  const reasonFor = (name: string): { label: string; reason: string } => {
    const match = matchExercise(name, library);
    return match.conflict
      ? { label: 'no encaja en tu biblioteca', reason: match.conflict }
      : { label: 'no está en tu biblioteca', reason: 'no está en tu biblioteca' };
  };
  return (
    <section class="card rt-proposal">
      <div class="between">
        <div class="grow">
          <div class="h3 ellipsis">{proposal.title}</div>
          <div class="tiny muted">{proposal.focus || 'propuesta del coach para hoy'}</div>
        </div>
        <span class="badge a">IA</span>
      </div>

      {proposal.rationale.length ? (
        <ul class="rt-why">
          {proposal.rationale.map((line) => (
            <li>{line}</li>
          ))}
        </ul>
      ) : null}

      <div class="rt-table mt-s">
        <div class="rt-trow head">
          <span>Ejercicio</span>
          <span>Series × reps</span>
          <span>Descanso</span>
          <span>Peso</span>
        </div>
        {proposal.exercises.map((ex, i) => {
          const reason = ex.matched ? null : reasonFor(ex.name);
          return (
            <div class="rt-trow" key={`${ex.name}-${i}`}>
              <span class="rt-tname">
                <span class="ellipsis">{ex.name}</span>
                {reason ? (
                  <span class="badge danger" title={reason.reason}>
                    {reason.label}
                  </span>
                ) : null}
              </span>
              <span class="num">
                {ex.sets} × {ex.repMin}-{ex.repMax}
              </span>
              <span class="num">{ex.rest} s</span>
              <span class="num">{ex.weight === null ? '—' : `${fmtN(ex.weight)} ${unit}`}</span>
            </div>
          );
        })}
      </div>

      {unmatched ? (
        <div class="tiny warn mt-s">
          {unmatched} {unmatched === 1 ? 'ejercicio no' : 'ejercicios no'} se aplicarán: no están en
          tu biblioteca o no encajan con ella. Se avisará al aplicar.
        </div>
      ) : null}

      <div class="row wrap rt-actions">
        <button type="button" class="btn primary" onClick={onApply}>
          <Icon name="check" />
          Aplicar
        </button>
        <button type="button" class="btn ghost" onClick={onDiscard}>
          Descartar
        </button>
      </div>
    </section>
  );
}

/**
 * Propuesta del generador local («Generar auto»): la misma tabla que la del
 * coach pero con badge «auto» y con el peso ya resuelto por `suggestWeight`.
 *
 * Se pinta ANTES de guardar: si no te convence la descartas y no queda nada en
 * el estado (igual que la propuesta de la IA, que tampoco se guarda sola).
 */
function AutoCard({
  proposal,
  unit,
  onSave,
  onDiscard,
}: {
  proposal: AutoProposal;
  unit: string;
  onSave: () => void;
  onDiscard: () => void;
}) {
  return (
    <section class="card rt-proposal">
      <div class="between">
        <div class="grow">
          <div class="h3 ellipsis">{proposal.name}</div>
          <div class="tiny muted">
            {proposal.focus || 'generada con tus plantillas, tu material y tu historial'}
          </div>
        </div>
        <span class="badge">auto</span>
      </div>

      <div class="rt-table mt-s">
        <div class="rt-trow head">
          <span>Ejercicio</span>
          <span>Series × reps</span>
          <span>Descanso</span>
          <span>Peso</span>
        </div>
        {proposal.items.map((item, i) => (
          <div class="rt-trow" key={`${item.exId}-${i}`}>
            <span class="rt-tname">
              <span class="ellipsis">{item.name}</span>
              <span class="tiny muted">
                {item.group}
                {item.basis ? ` · ${item.basis}` : ''}
              </span>
            </span>
            <span class="num">
              {item.sets} × {item.repMin}-{item.repMax}
            </span>
            <span class="num">{item.rest} s</span>
            <span class="num">{item.weight === null ? '—' : `${fmtN(item.weight)} ${unit}`}</span>
          </div>
        ))}
      </div>

      <div class="row wrap rt-actions">
        <button type="button" class="btn primary" onClick={onSave}>
          <Icon name="check" />
          Guardar
        </button>
        <button type="button" class="btn ghost" onClick={onDiscard}>
          Descartar
        </button>
      </div>
    </section>
  );
}

/**
 * Modal «Generar auto»: plantilla del catálogo + rotación. Todo local: no pide
 * clave ni toca la red, que es lo que en la v1 hacía `routines:generate`
 * (`views-routines.js:115`).
 */
function GenerateModal({
  onClose,
  onGenerate,
}: {
  onClose: () => void;
  onGenerate: (templateId: string, rotate: number) => void;
}) {
  const [templateId, setTemplateId] = useState(TEMPLATES[0]?.id ?? '');
  const [rotate, setRotate] = useState(String(DEFAULT_ROTATE));
  const tpl = findTemplate(templateId);
  const summary = tpl ? templateSummary(tpl) : null;

  return (
    <Modal
      title="Generar rutina automática"
      onClose={onClose}
      foot={
        <>
          <button type="button" class="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            class="btn primary"
            disabled={!tpl}
            onClick={() => onGenerate(templateId, int(rotate, DEFAULT_ROTATE))}
          >
            <Icon name="wand" />
            Generar
          </button>
        </>
      }
    >
      <div class="help-field">
        <label class="field">
          <span class="label">Plantilla</span>
          <select
            class="select"
            value={templateId}
            onChange={(e) => setTemplateId(e.currentTarget.value)}
          >
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} — {t.hint}
              </option>
            ))}
          </select>
          {summary ? (
            <span class="sub">
              {summary.count} ejercicios · {summary.groups}
            </span>
          ) : null}
        </label>
        <HelpBtn id="rutinas.generate" title="Generar rutina automática" />
      </div>

      <div class="help-field mt-s">
        <label class="field">
          <span class="label">Evitar ejercicios de las últimas N sesiones</span>
          <select class="select" value={rotate} onChange={(e) => setRotate(e.currentTarget.value)}>
            {ROTATE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <HelpBtn id="rutinas.rotate" title="Evitar ejercicios de las últimas sesiones" />
      </div>

      <p class="tiny muted mt-s">
        Los compuestos van primero y series, repeticiones y descanso se ajustan a tu objetivo actual
        ({goalLabel(settings.value.goal)}). Solo se usan ejercicios permitidos que puedes hacer con
        tu material.
      </p>
    </Modal>
  );
}

/**
 * Modal «Agendar»: input de fecha con el próximo día libre del calendario ya
 * puesto (v1 `App.ui.dayPicker`, que arrancaba en hoy y ofrecía 14 jornadas).
 * El día se escribe con `setDay`, el mismo setter del Calendario.
 */
function ScheduleModal({
  routine,
  defaultIso,
  onClose,
  onConfirm,
}: {
  routine: Routine;
  defaultIso: string;
  onClose: () => void;
  onConfirm: (iso: string) => void;
}) {
  const min = today();
  const [iso, setIso] = useState(defaultIso);
  const [error, setError] = useState('');

  function confirm(): void {
    if (!validScheduleIso(iso, min)) {
      setError('Elige un día desde hoy.');
      return;
    }
    onConfirm(iso);
  }

  return (
    <Modal
      title="Agendar rutina"
      onClose={onClose}
      foot={
        <>
          <button type="button" class="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" class="btn primary" onClick={confirm}>
            <Icon name="calendar" />
            Agendar
          </button>
        </>
      }
    >
      <div class="between">
        <div class="tiny muted grow ellipsis">{routine.name}</div>
        <HelpBtn id="rutinas.schedule" title="Agendar rutina" />
      </div>
      <label class="field mt-s">
        <span class="label">Día</span>
        <input
          class="input rt-date"
          type="date"
          min={min}
          value={iso}
          onInput={(e) => {
            setIso(e.currentTarget.value);
            setError('');
          }}
        />
        <span class="sub">
          {validScheduleIso(iso, min)
            ? `Se planificará el ${dateLabel(iso, 'long')}`
            : 'Formato de fecha no válido'}
        </span>
      </label>
      <p class="tiny muted mt-s">
        Si el día ya tenía algo planificado se sustituye por esta rutina; lo demás del día (sesión
        registrada, notas) no se toca.
      </p>
      {error ? (
        <div class="rt-notice err mt-s">
          <Icon name="alert" />
          <span class="grow">{error}</span>
        </div>
      ) : null}
    </Modal>
  );
}

/**
 * Modal «Ver»: detalle de solo lectura de una rutina (v1 `App.ui.routineDetail`,
 * `app.js:583`). Muestra nombre, enfoque, notas y cada ejercicio con sus números;
 * para cambiar nada se pasa por el editor (botón «Editar» del pie).
 */
function DetailModal({
  routine,
  onClose,
  onEdit,
  onStart,
}: {
  routine: Routine;
  onClose: () => void;
  onEdit: () => void;
  onStart: () => void;
}) {
  const rows = detailRows(routine.items, exercises.value, equipment.value);
  const unit = settings.value.units;
  const focus = typeof routine.focus === 'string' ? routine.focus : '';
  const notes = typeof routine.notes === 'string' ? routine.notes : '';
  const created = typeof routine.createdAt === 'string' ? routine.createdAt.slice(0, 10) : '';

  return (
    <Modal
      title={routine.name}
      onClose={onClose}
      foot={
        <>
          <button type="button" class="btn ghost" onClick={onClose}>
            Cerrar
          </button>
          <button type="button" class="btn ghost" onClick={onEdit}>
            <Icon name="pencil" />
            Editar
          </button>
          <button type="button" class="btn primary" onClick={onStart}>
            <Icon name="play" />
            Empezar
          </button>
        </>
      }
    >
      {focus ? <div class="tiny muted">{focus}</div> : null}

      <div class="card flush mt-s">
        {rows.length ? (
          rows.map((row, i) => (
            <div class="list-item" key={`${row.name}-${i}`}>
              <span class="num tiny muted" style="width:18px">
                {i + 1}
              </span>
              <div class="li-main">
                <div class="li-title ellipsis">{row.name}</div>
                <div class="li-sub">
                  {row.sets} × {row.repMin}-{row.repMax} · {row.rest} s
                  {row.group ? ` · ${row.group}` : ''}
                  {row.weight !== null ? ` · ${fmtN(row.weight)} ${unit}` : ''}
                  {row.missing ? ' · falta material' : ''}
                </div>
                {row.notes ? <div class="tiny muted">{row.notes}</div> : null}
              </div>
            </div>
          ))
        ) : (
          <div class="empty">
            <Icon name="list" />
            <div>Sin ejercicios</div>
          </div>
        )}
      </div>

      {notes ? (
        <div class="card tight mt-s">
          <div class="tiny muted">Notas</div>
          <div class="tiny">{notes}</div>
        </div>
      ) : null}

      <div class="tiny muted mt-s">
        {rows.length} {rows.length === 1 ? 'ejercicio' : 'ejercicios'} ·{' '}
        {routineSets(routine.items)} series
        {created ? ` · creada ${dateLabel(created, 'medium')}` : ''} · origen{' '}
        {sourceBadge(routine.source).label}
      </div>
    </Modal>
  );
}

/**
 * Editor de una rutina (crear si `routineId` es `null`). Los campos viven en el
 * estado local y se persisten AL GUARDAR, con `addRoutine`/`updateRoutine` — lo
 * mismo que hacía el modal de la v1 en su botón «Guardar rutina».
 */
function RoutineEditor({
  routineId,
  onDone,
}: {
  routineId: string | null;
  onDone: (notice: Notice | null) => void;
}) {
  const routine = findRoutine(routineId);
  const library = exercises.value;
  const unit = settings.value.units;

  const [name, setName] = useState(routine ? routine.name : '');
  const [focus, setFocus] = useState(typeof routine?.focus === 'string' ? routine.focus : '');
  const [notes, setNotes] = useState(typeof routine?.notes === 'string' ? routine.notes : '');
  const [items, setItems] = useState<RoutineItem[]>(
    routine ? routine.items.map((item) => ({ ...item })) : [],
  );
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  const matches = matchExercises(
    query,
    library,
    items.map((item) => item.exId),
  );
  const byId = new Map(library.map((ex) => [ex.id, ex] as const));

  function patch(index: number, next: Partial<RoutineItem>): void {
    setItems(items.map((item, i) => (i === index ? { ...item, ...next } : item)));
  }

  function move(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const a = next[index];
    const b = next[target];
    if (!a || !b) return;
    next[index] = b;
    next[target] = a;
    setItems(next);
  }

  function addItem(ex: Exercise): void {
    const goal = settings.value.goal;
    const reps = GOAL_REPS[goal] ?? [8, 12];
    setItems([
      ...items,
      {
        exId: ex.id,
        sets: clamp(int(ex.sets, 3), 1, 12),
        repMin: int(reps[0], 8),
        repMax: int(reps[1], 12),
        rest: int(GOAL_REST[goal], ex.rest),
        weight: null,
        notes: '',
      },
    ]);
    setQuery('');
    setError('');
  }

  function save(): void {
    if (!items.length) {
      setError('Añade al menos un ejercicio antes de guardar.');
      return;
    }
    const finalName = name.trim() || 'Rutina sin nombre';
    const patchData = {
      name: finalName,
      focus: focus.trim(),
      notes: notes.trim(),
      items: items.map((item) => ({ ...item })),
    };
    if (routine) {
      const updated = updateRoutine(routine.id, patchData);
      if (!updated) {
        setError('Esta rutina ya no existe (¿la eliminaste en otra pestaña?).');
        return;
      }
      onDone({ kind: 'ok', text: `Rutina actualizada: ${finalName}` });
      return;
    }
    const created = addRoutine({ ...patchData, source: 'manual' });
    onDone({ kind: 'ok', text: `Rutina creada: ${created.name}` });
  }

  function renderItem(item: RoutineItem, index: number) {
    const ex = byId.get(item.exId) ?? null;
    const missing = ex ? !isAvailable(ex, equipment.value) : false;
    return (
      <div class="card tight rt-item" key={`${item.exId}:${index}`}>
        <div class="rt-item-head">
          <div class="grow">
            <div class="h3 ellipsis">{ex ? ex.name : item.exId}</div>
            <div class="tiny muted">
              {ex ? `${groupLabel(ex.group)} · ${ex.type}` : 'fuera de la biblioteca'}
            </div>
          </div>
          <div class="row" style="gap:3px">
            <button
              type="button"
              class="icon-btn"
              aria-label="Subir"
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <Icon name="chev-u" />
            </button>
            <button
              type="button"
              class="icon-btn"
              aria-label="Bajar"
              disabled={index === items.length - 1}
              onClick={() => move(index, 1)}
            >
              <Icon name="chev-d" />
            </button>
            <button
              type="button"
              class="icon-btn"
              aria-label="Quitar ejercicio"
              onClick={() => setItems(items.filter((_, i) => i !== index))}
            >
              <Icon name="trash" />
            </button>
          </div>
        </div>

        <div class="rt-nums">
          <label class="field">
            <span class="label">Series</span>
            <input
              class="input num"
              type="number"
              min="1"
              max="12"
              value={inputNum(item.sets ?? 3)}
              onChange={(e) => patch(index, { sets: bounded(e.currentTarget.value, 1, 12, 3) })}
            />
          </label>
          <label class="field">
            <span class="label">Rep min</span>
            <input
              class="input num"
              type="number"
              min="1"
              max="50"
              value={inputNum(item.repMin ?? 8)}
              onChange={(e) => patch(index, { repMin: bounded(e.currentTarget.value, 1, 50, 8) })}
            />
          </label>
          <label class="field">
            <span class="label">Rep max</span>
            <input
              class="input num"
              type="number"
              min="1"
              max="50"
              value={inputNum(item.repMax ?? 12)}
              onChange={(e) => patch(index, { repMax: bounded(e.currentTarget.value, 1, 50, 12) })}
            />
          </label>
          <label class="field">
            <span class="label">Descanso (s)</span>
            <input
              class="input num"
              type="number"
              min="0"
              max="600"
              step="15"
              value={inputNum(item.rest ?? 90)}
              onChange={(e) => patch(index, { rest: bounded(e.currentTarget.value, 0, 600, 90) })}
            />
          </label>
        </div>

        <div class="rt-nums rt-two">
          <label class="field">
            <span class="label">Peso base ({unit})</span>
            <input
              class="input num"
              type="number"
              min="0"
              step="0.5"
              placeholder="sin peso"
              value={inputNum(item.weight)}
              onChange={(e) => patch(index, { weight: weightOrNull(e.currentTarget.value) })}
            />
          </label>
          <label class="field">
            <span class="label">Notas</span>
            <input
              class="input"
              type="text"
              placeholder="superserie, técnica…"
              value={item.notes ?? ''}
              onChange={(e) => patch(index, { notes: e.currentTarget.value })}
            />
          </label>
        </div>

        {missing ? (
          <div class="tiny warn mt-s">Ahora mismo te falta material para este ejercicio.</div>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <div class="rt-head">
        <button type="button" class="btn sm ghost" onClick={() => onDone(null)}>
          <Icon name="chev-l" />
          Volver
        </button>
        <div class="grow">
          <b>{routine ? 'Editar rutina' : 'Nueva rutina'}</b>
          <div class="tiny muted">
            {items.length} {items.length === 1 ? 'ejercicio' : 'ejercicios'}
            {routine ? ` · origen ${sourceBadge(routine.source).label}` : ''}
          </div>
        </div>
      </div>

      <section class="card">
        <TextRow
          label="Nombre"
          hint="Cómo se llamará en la lista y en el calendario"
          placeholder="Ej. Torso A"
          value={name}
          onChange={setName}
        />
        <div class="divider" />
        <TextRow
          label="Enfoque"
          hint="Grupos o intención de la rutina"
          placeholder="Pecho · hombro"
          value={focus}
          help="rutinas.focus"
          onChange={setFocus}
        />
        <div class="divider" />
        <label class="field">
          <span class="label">Notas</span>
          <textarea
            class="input rt-notes"
            rows={3}
            placeholder="indicaciones, progresión…"
            value={notes}
            onInput={(e) => setNotes(e.currentTarget.value)}
          />
        </label>
      </section>

      <section class="card mt">
        <div class="rt-search-head">
          <span class="label">Ejercicios ({items.length})</span>
          <span class="tiny muted">por defecto se copian series y descansos del ejercicio</span>
        </div>
        <label class="field">
          <span class="label">Añadir</span>
          <input
            class="input"
            type="search"
            placeholder="Busca por nombre o grupo: «press», «pecho»…"
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
        </label>
        <div class="rt-results">
          {matches.length ? (
            matches.map((ex) => (
              <button type="button" class="rt-result" key={ex.id} onClick={() => addItem(ex)}>
                <Icon name="plus" />
                <span class="grow">
                  <span class="rt-result-name ellipsis">{ex.name}</span>
                  <span class="tiny muted">
                    {groupLabel(ex.group)} · {ex.sets} × {ex.repMin}-{ex.repMax}
                  </span>
                </span>
                {!ex.allowed ? <span class="badge danger">off</span> : null}
                {!isAvailable(ex, equipment.value) ? (
                  <span class="badge warn">sin equipo</span>
                ) : null}
              </button>
            ))
          ) : (
            <div class="tiny muted">
              Ningún ejercicio coincide con «{query}». Prueba con otra palabra o con el grupo
              muscular.
            </div>
          )}
        </div>

        <div class="col mt-s" style="gap:9px">
          {items.length ? (
            items.map(renderItem)
          ) : (
            <div class="empty">
              <Icon name="list" />
              <div>Aún sin ejercicios</div>
              <div class="tiny">Busca arriba y toca uno para añadirlo</div>
            </div>
          )}
        </div>
      </section>

      {error ? (
        <div class="rt-notice err mt-s">
          <Icon name="alert" />
          <span class="grow">{error}</span>
        </div>
      ) : null}

      <div class="row wrap rt-actions">
        <button type="button" class="btn primary" onClick={save}>
          <Icon name="check" />
          Guardar rutina
        </button>
        <button type="button" class="btn ghost" onClick={() => onDone(null)}>
          Cancelar
        </button>
      </div>

      <InfoCard>
        Los cambios se guardan al pulsar <b>Guardar rutina</b>. El peso base queda fijo en la
        rutina; si lo dejas vacío, la sesión propone el peso según tu historial.
      </InfoCard>
    </>
  );
}

/** La pestaña Rutinas: listado + generar (local o con IA) + detalle/agendar + editor. */
export function RoutinesView() {
  const list = routines.value;
  const library = exercises.value;
  const equip = equipment.value;
  const unit = settings.value.units;

  /* `undefined` = listado · `null` = rutina nueva · string = editar esa rutina */
  const [editId, setEditId] = useState<string | null | undefined>(undefined);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [proposal, setProposal] = useState<RoutineSuggestion | null>(null);
  /* generación local (sin API key): modal de plantillas + propuesta sin guardar */
  const [genOpen, setGenOpen] = useState(false);
  const [auto, setAuto] = useState<AutoProposal | null>(null);
  /* modal «Agendar» (fecha) y modal «Ver» (detalle de solo lectura) */
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [scheduleIso, setScheduleIso] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);

  const byId = new Map(library.map((ex) => [ex.id, ex] as const));

  if (editId !== undefined) {
    return (
      <RoutineEditor
        key={editId ?? 'nueva'}
        routineId={editId}
        onDone={(next) => {
          setEditId(undefined);
          setNotice(next);
        }}
      />
    );
  }

  /** Pide una rutina al coach. Sin API key ni se intenta: se va a Ajustes. */
  async function suggest(): Promise<void> {
    if (aiLoading) return;
    if (!hasApiKey()) {
      setNotice({
        kind: 'warn',
        text: 'Configura tu API key de Gemini para que el coach te proponga una rutina.',
        action: { label: 'Abrir Coach AI', run: () => go('ajustes', 'coach') },
      });
      go('ajustes', 'coach');
      return;
    }
    setAiLoading(true);
    setProposal(null);
    try {
      const outcome = await runCoachTask('suggest');
      const parsed = toSuggestion(parseJSON<unknown>(outcome.text), library);
      if (!parsed) {
        setNotice({
          kind: 'err',
          text: 'El coach no devolvió una rutina legible. Inténtalo otra vez.',
        });
        return;
      }
      setNotice(null);
      setProposal(parsed);
    } catch (err) {
      setNotice({
        kind: 'err',
        text: err instanceof Error ? err.message : 'No se pudo contactar con el coach.',
      });
    } finally {
      setAiLoading(false);
    }
  }

  function applyProposal(): void {
    if (!proposal) return;
    const { routine: created, unresolved } = applySuggestionAsRoutine(proposal);
    if (!created) {
      setNotice({
        kind: 'err',
        text: unresolved.length
          ? `No se pudo aplicar: ${unresolvedNames(unresolved)} no ${
              unresolved.length === 1 ? 'está' : 'están'
            } en tu biblioteca.`
          : 'No se pudo aplicar la propuesta: ningún ejercicio de la lista está en tu biblioteca.',
      });
      return;
    }
    setProposal(null);
    setNotice({
      kind: unresolved.length ? 'warn' : 'ok',
      text: unresolved.length
        ? `Rutina creada: ${created.name} · sin usar (${unresolved.length}): ${unresolvedNames(unresolved)}`
        : `Rutina creada: ${created.name}`,
      action: { label: 'Ver rutina', run: () => setEditId(created.id) },
    });
  }

  function startRoutine(routine: Routine): void {
    /* Si ya hay sesión en curso NO se bloquea (criterio 3): se ofrecen las dos
       salidas posibles vía `Notice.action` — apilar la rutina a lo que llevas
       encima o ir a mirar la sesión. */
    if (active.value) {
      setNotice({
        kind: 'warn',
        text: `Ya hay una sesión en curso: puedes añadir «${routine.name}» a lo que llevas encima.`,
        action: {
          label: 'Añadir a la sesión',
          run: () => {
            const added = addRoutineToSession(routine.id);
            if (added === null) {
              setNotice({ kind: 'err', text: 'No se pudo añadir la rutina a la sesión.' });
              return;
            }
            setNotice(null);
            go('entrenar');
          },
        },
      });
      return;
    }
    if (!startFromRoutine(routine.id)) {
      setNotice({ kind: 'err', text: 'No se pudo arrancar la sesión desde esta rutina.' });
      return;
    }
    setNotice(null);
    go('entrenar');
  }

  function duplicate(routine: Routine): void {
    const created = addRoutine({
      name: `${routine.name} (copia)`,
      focus: typeof routine.focus === 'string' ? routine.focus : '',
      source: typeof routine.source === 'string' && routine.source ? routine.source : 'manual',
      notes: typeof routine.notes === 'string' ? routine.notes : '',
      items: routine.items.map((item) => ({ ...item })),
    });
    setNotice({
      kind: 'ok',
      text: `Rutina duplicada: ${created.name}`,
      action: { label: 'Editar', run: () => setEditId(created.id) },
    });
  }

  /**
   * Genera la propuesta local a partir de una plantilla. Nada de red ni de clave:
   * esto es lo que en la v1 hacía el modal `routines:generate` y en v2 era LA vía
   * de generación que había quedado sin llamador.
   */
  function runGenerate(templateId: string, rotate: number): void {
    setGenOpen(false);
    const draft = generateAuto(
      { settings: settings.value, exercises: library, equipment: equip, sessions: sessions.value },
      templateId,
      rotate,
    );
    if (!draft) {
      setNotice({
        kind: 'warn',
        text: 'No hay ejercicios disponibles con tu equipo para esa plantilla.',
      });
      return;
    }
    setNotice(null);
    setProposal(null);
    setAuto(draft);
  }

  /** Guarda la propuesta del generador en la biblioteca (`addRoutine`). */
  function saveAuto(): void {
    if (!auto) return;
    const created = addRoutine({
      name: auto.name,
      focus: auto.focus,
      notes: auto.notes,
      source: auto.source,
      items: autoRoutineItems(auto.items),
    });
    setAuto(null);
    setNotice({
      kind: 'ok',
      text: `Rutina creada: ${created.name}`,
      action: { label: 'Editar', run: () => setEditId(created.id) },
    });
  }

  /** Abre el picker de día con el próximo hueco del calendario ya puesto. */
  function openSchedule(routine: Routine): void {
    setScheduleId(routine.id);
    setScheduleIso(nextFreeDay(schedule.value, sessions.value, today()));
  }

  /** Escribe el día en el calendario y confirma en línea. */
  function confirmSchedule(iso: string): void {
    const routine = findRoutine(scheduleId);
    if (!routine) {
      setScheduleId(null);
      setNotice({ kind: 'err', text: 'Esta rutina ya no existe (¿la borraste en otra pestaña?).' });
      return;
    }
    setDay(iso, scheduleRoutinePatch(routine));
    setScheduleId(null);
    setNotice({
      kind: 'ok',
      text: `«${routine.name}» agendada el ${dateLabel(iso, 'medium')}`,
      action: { label: 'Ver calendario', run: () => go('calendario') },
    });
  }

  function renderCard(routine: Routine) {
    const resolved = routine.items.map((item) => byId.get(item.exId) ?? null);
    const missing = resolved.filter((ex) => ex && !isAvailable(ex, equip)).length;
    const blocked = resolved.filter((ex) => ex && !ex.allowed).length;
    const names = resolved.filter((ex): ex is Exercise => ex !== null).map((ex) => ex.name);
    const used = lastUsed(sessions.value, routine.id);
    const badge = sourceBadge(routine.source);

    return (
      <article class="card" key={routine.id}>
        <div class="between" style="align-items:flex-start">
          <div class="grow">
            <div class="h3 ellipsis">{routine.name}</div>
            <div class="tiny muted">{routine.focus || `${names.length} ejercicios`}</div>
          </div>
          <div class="row" style="gap:5px">
            <HelpBtn id="rutinas.source" title="El sello de origen" />
            <span class={badge.cls}>{badge.label}</span>
            {missing ? <span class="badge warn">{missing} sin equipo</span> : null}
            {blocked ? <span class="badge danger">{blocked} off</span> : null}
          </div>
        </div>

        <div class="tiny muted mt-s">
          {routine.items.length} ejercicios · {routineSets(routine.items)} series ·{' '}
          {used
            ? `última vez ${dateLabel(used.date, 'medium')} (${relative(used.date)})`
            : 'nunca usada'}
        </div>

        {names.length ? (
          <div class="set-hint rt-names">
            {trunc(names.slice(0, 5).join(' · '), 96)}
            {names.length > 5 ? ' …' : ''}
          </div>
        ) : null}

        <div class="row wrap rt-actions">
          <button type="button" class="btn primary sm" onClick={() => startRoutine(routine)}>
            <Icon name="play" />
            Empezar
          </button>
          <button type="button" class="btn sm" onClick={() => setDetailId(routine.id)}>
            <Icon name="eye" />
            Ver
          </button>
          <button type="button" class="btn sm" onClick={() => setEditId(routine.id)}>
            <Icon name="pencil" />
            Editar
          </button>
          <button type="button" class="btn sm ghost" onClick={() => openSchedule(routine)}>
            <Icon name="calendar" />
            Agendar
          </button>
          <button type="button" class="btn sm ghost" onClick={() => duplicate(routine)}>
            <Icon name="copy" />
            Duplicar
          </button>
          <button type="button" class="btn sm quiet" onClick={() => setConfirmId(routine.id)}>
            <Icon name="trash" />
            Eliminar
          </button>
        </div>

        {confirmId === routine.id ? (
          <div class="rt-confirm">
            <span class="tiny grow">
              ¿Eliminar <b>{routine.name}</b>? Las sesiones ya registradas no se borran.
            </span>
            <div class="row" style="gap:6px">
              <button
                type="button"
                class="btn sm danger"
                onClick={() => {
                  removeRoutine(routine.id);
                  setConfirmId(null);
                  setNotice({ kind: 'warn', text: `Rutina eliminada: ${routine.name}` });
                }}
              >
                Eliminar
              </button>
              <button type="button" class="btn sm ghost" onClick={() => setConfirmId(null)}>
                No
              </button>
            </div>
          </div>
        ) : null}
      </article>
    );
  }

  const scheduleRoutine = findRoutine(scheduleId);
  const detailRoutine = findRoutine(detailId);

  return (
    <>
      <div class="col rt-top">
        <div class="grid c2">
          <button type="button" class="btn lg primary block rt-btn" onClick={() => setEditId(null)}>
            <Icon name="plus" />
            Nueva rutina
          </button>
          <button type="button" class="btn lg block rt-btn" onClick={() => setGenOpen(true)}>
            <Icon name="wand" />
            Generar auto
          </button>
        </div>
        <div class="row" style="gap:6px">
          <button
            type="button"
            class="btn lg grow rt-btn"
            disabled={aiLoading}
            onClick={() => void suggest()}
          >
            <Icon name="sparkles" />
            {aiLoading ? 'El coach está pensando…' : 'Sugerir rutina con IA'}
          </button>
          <HelpBtn id="rutinas.autoVsIa" title="Generar auto y sugerir con IA" />
        </div>
      </div>

      {notice ? <NoticeBox notice={notice} onClose={() => setNotice(null)} /> : null}

      {aiLoading ? (
        <div class="card tight mt-s">
          <div class="row">
            <Icon name="sparkles" class="muted" />
            <div class="tiny muted grow">
              El coach está mirando tu historial y tu material para proponerte el entreno de hoy…
            </div>
          </div>
        </div>
      ) : null}

      {proposal ? (
        <div class="mt-s">
          <ProposalCard
            proposal={proposal}
            unit={unit}
            library={library}
            onApply={applyProposal}
            onDiscard={() => setProposal(null)}
          />
        </div>
      ) : null}

      {auto ? (
        <div class="mt-s">
          <AutoCard proposal={auto} unit={unit} onSave={saveAuto} onDiscard={() => setAuto(null)} />
        </div>
      ) : null}

      <section class="mt">
        <SectionHead
          title="Mis rutinas"
          help="tab.rutinas"
          right={list.length ? String(list.length) : undefined}
        />
        {list.length ? (
          <div class="col" style="gap:10px">
            {list.map(renderCard)}
          </div>
        ) : (
          <div class="empty">
            <Icon name="list" />
            <div>Aún no tienes rutinas</div>
            <div class="tiny">
              Crea una con «Nueva rutina», genera una desde una plantilla o deja que el coach te
              proponga una
            </div>
          </div>
        )}
      </section>

      <InfoCard>
        Las rutinas y las plantillas de «Generar auto» solo usan ejercicios permitidos que puedes
        hacer con tu material actual: si falta alguno, la tarjeta lo avisa. Ajusta la biblioteca en
        Ajustes → Ejercicios.
      </InfoCard>

      {genOpen ? (
        <GenerateModal
          onClose={() => setGenOpen(false)}
          onGenerate={(templateId, rotate) => runGenerate(templateId, rotate)}
        />
      ) : null}

      {scheduleRoutine && scheduleId ? (
        <ScheduleModal
          key={scheduleId}
          routine={scheduleRoutine}
          defaultIso={scheduleIso}
          onClose={() => setScheduleId(null)}
          onConfirm={confirmSchedule}
        />
      ) : null}

      {detailRoutine && detailId ? (
        <DetailModal
          key={detailId}
          routine={detailRoutine}
          onClose={() => setDetailId(null)}
          onEdit={() => {
            setDetailId(null);
            setEditId(detailId);
          }}
          onStart={() => {
            const routine = detailRoutine;
            setDetailId(null);
            startRoutine(routine);
          }}
        />
      ) : null}
    </>
  );
}
