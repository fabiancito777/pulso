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
import { GOAL_REPS, GOAL_REST, groupLabel, isAvailable } from '@/domain/data';
import { label as dateLabel, relative } from '@/domain/dates';
import { fmtN, inputNum } from '@/domain/format';
import { clamp, int } from '@/domain/num';
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
  sessions,
  settings,
  updateRoutine,
} from '@/state/store';
import type { Routine } from '@/state/store';
import { Icon } from './Icon';
import { InfoCard, SectionHead, TextRow } from './kit';
import {
  bounded,
  lastUsed,
  matchExercises,
  routineSets,
  sourceBadge,
  toSuggestion,
  weightOrNull,
} from './routines-helpers';
import type { RoutineSuggestion } from './routines-helpers';

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
  onApply,
  onDiscard,
}: {
  proposal: RoutineSuggestion;
  unit: string;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const unmatched = proposal.exercises.filter((ex) => !ex.matched).length;
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
        {proposal.exercises.map((ex, i) => (
          <div class="rt-trow" key={`${ex.name}-${i}`}>
            <span class="rt-tname">
              <span class="ellipsis">{ex.name}</span>
              {!ex.matched ? <span class="badge danger">no está en tu biblioteca</span> : null}
            </span>
            <span class="num">
              {ex.sets} × {ex.repMin}-{ex.repMax}
            </span>
            <span class="num">{ex.rest} s</span>
            <span class="num">{ex.weight === null ? '—' : `${fmtN(ex.weight)} ${unit}`}</span>
          </div>
        ))}
      </div>

      {unmatched ? (
        <div class="tiny warn mt-s">
          {unmatched} {unmatched === 1 ? 'ejercicio no está' : 'ejercicios no están'} en tu
          biblioteca: se omitirán al aplicar.
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

/** La pestaña Rutinas: listado + propuesta del coach + editor. */
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
    const created = applySuggestionAsRoutine(proposal);
    if (!created) {
      setNotice({
        kind: 'err',
        text: 'No se pudo aplicar la propuesta: ningún ejercicio de la lista está en tu biblioteca.',
      });
      return;
    }
    setProposal(null);
    setNotice({
      kind: 'ok',
      text: `Rutina creada: ${created.name}`,
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
          <button type="button" class="btn sm" onClick={() => setEditId(routine.id)}>
            <Icon name="pencil" />
            Editar
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

  return (
    <>
      <div class="col rt-top">
        <button type="button" class="btn lg primary block rt-btn" onClick={() => setEditId(null)}>
          <Icon name="plus" />
          Nueva rutina
        </button>
        <button
          type="button"
          class="btn lg block rt-btn"
          disabled={aiLoading}
          onClick={() => void suggest()}
        >
          <Icon name="sparkles" />
          {aiLoading ? 'El coach está pensando…' : 'Sugerir rutina con IA'}
        </button>
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
            onApply={applyProposal}
            onDiscard={() => setProposal(null)}
          />
        </div>
      ) : null}

      <section class="mt">
        <SectionHead title="Mis rutinas" right={list.length ? String(list.length) : undefined} />
        {list.length ? (
          <div class="col" style="gap:10px">
            {list.map(renderCard)}
          </div>
        ) : (
          <div class="empty">
            <Icon name="list" />
            <div>Aún no tienes rutinas</div>
            <div class="tiny">Crea una con «Nueva rutina» o deja que el coach te proponga una</div>
          </div>
        )}
      </section>

      <InfoCard>
        Las rutinas usan los ejercicios que tienes permitidos y que puedes hacer con tu material
        actual: si falta alguno, la tarjeta lo avisa. Ajusta la biblioteca en Ajustes → Ejercicios.
      </InfoCard>
    </>
  );
}
