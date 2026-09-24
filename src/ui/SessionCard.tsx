/**
 * La sesión en curso: la pantalla que hace usable todo lo portado antes
 * (`domain/session.ts` para las reglas, `domain/rest.ts` para el timer y
 * `state/session.ts` para los efectos).
 *
 * Dos detalles de por qué está partida en componentes pequeños:
 *
 * 1. **La cuenta atrás no puede repintar los inputs.** `RestBox`, `RestStrip` y
 *    `Clock` son los únicos que leen `restSeconds`/`sessionSeconds`, así que son los
 *    únicos que se repintan cada segundo. Si los leyera la tarjeta entera, cada tic
 *    reescribiría el `value` de los inputs y borraría lo que estás escribiendo (el
 *    problema que la v1 esquivaba refrescando a mano solo los campos de abajo).
 * 2. **Los campos se guardan en `change`, no en `input`.** Fue la decisión de la v1
 *    por el mismo motivo, y es lo que hace útil el arrastre: el valor se copia a las
 *    series de abajo cuando terminas de escribir, no en cada tecla.
 */
import { useState } from 'preact/hooks';

import { groupLabel, isAvailable } from '@/domain/data';
import { fmtClock, fmtMmss, fmtN, fmtVol, inputNum } from '@/domain/format';
import { num } from '@/domain/num';
import { restView } from '@/domain/rest';
import { entryVolume, progress as sessionProgress } from '@/domain/session';
import type { ActiveEntry, Unit } from '@/domain/types';
import {
  active,
  addExercise,
  addRestSeconds,
  addSet,
  discardSession,
  editSet,
  finishSession,
  moveExercise,
  removeExercise,
  removeSet,
  renameSession,
  rest,
  restSeconds,
  sessionSeconds,
  setNotes,
  setRpe,
  setSessionNotes,
  startFreeSession,
  stopRestTimer,
  subRestSeconds,
  toggleSetAt,
} from '@/state/session';
import { equipment, exercises, settings as settingsSignal } from '@/state/store';
import { Icon } from './Icon';
import { Ring } from './Ring';

/** Reloj de la sesión. Aislado a propósito: es lo que se repinta cada segundo. */
function Clock() {
  return <span class="num">{fmtClock(sessionSeconds.value)}</span>;
}

/** Cuenta atrás del descanso, aislada para no repintar los inputs de las series. */
function RestBox() {
  const left = restSeconds.value;
  const info = restView(rest.value, Date.now());
  return (
    <div class={`session-rest${info.over ? ' done' : ''}`}>
      <div class="sr-ring">
        <Ring frac={info.frac} size={96} width={6.5} over={info.over} />
      </div>
      <div class="sr-main">
        <div
          class="tiny muted"
          style="text-transform:uppercase;letter-spacing:.4px;font-weight:700"
        >
          {info.over ? 'descanso completado' : 'descanso en curso'}
        </div>
        <div class="h3 ellipsis">{info.label || 'Siguiente serie'}</div>
        <div class="num" style="font-size:26px;font-weight:650">
          {fmtMmss(left)}
        </div>
        <div class="tiny muted">
          {info.over
            ? 'a por la siguiente serie'
            : `sugerido para este ejercicio · total ${fmtMmss(info.total)}`}
        </div>
        <div class="sr-actions">
          <button class="btn sm" onClick={() => subRestSeconds(15)}>
            −15 s
          </button>
          <button class="btn sm" onClick={() => addRestSeconds(15)}>
            +15 s
          </button>
          <button class="btn sm ghost" onClick={stopRestTimer}>
            {info.over ? 'Continuar' : 'Saltar'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** El descanso en una línea, para cuando estás mirando el resumen. */
function RestStrip() {
  const left = restSeconds.value;
  const info = restView(rest.value, Date.now());
  return (
    <div class="sr-strip mt-s">
      <span class={`num${info.over ? ' over' : ''}`}>{fmtMmss(left)}</span>
      <span class="tiny muted grow ellipsis">
        {info.over ? 'descanso terminado' : `siguiente: ${info.label || 'descanso'}`}
      </span>
      <Ring frac={info.frac} size={46} width={4.5} over={info.over} />
    </div>
  );
}

function SetRow(props: { entry: ActiveEntry; entryIndex: number; setIndex: number; unit: Unit }) {
  const { entry, entryIndex: i, setIndex: j, unit } = props;
  const set = entry.sets[j];
  if (!set) return null;
  const showRpe = settingsSignal.value.showRpe;
  const readValue = (event: Event): string => (event.currentTarget as HTMLInputElement).value;
  return (
    <div class={`set-row${set.done ? ' done' : ''}${showRpe ? ' with-rpe' : ''}`}>
      <span class="set-idx">{j + 1}</span>
      <input
        class="input num"
        type="number"
        inputmode="decimal"
        min="0"
        step={unit === 'lb' ? 5 : 2.5}
        placeholder={set.suggested ? 'sugerido' : '—'}
        value={inputNum(set.weight)}
        onChange={(event: Event) => {
          const value = readValue(event);
          editSet(i, j, 'weight', value === '' ? '' : num(value));
        }}
        aria-label={`peso serie ${j + 1}`}
      />
      <input
        class="input num"
        type="number"
        inputmode="numeric"
        min="0"
        placeholder={set.target ? String(set.target) : 'reps'}
        value={inputNum(set.reps)}
        onChange={(event: Event) => {
          const value = readValue(event);
          editSet(i, j, 'reps', value === '' ? '' : num(value));
        }}
        aria-label={`repeticiones serie ${j + 1}`}
      />
      {showRpe ? (
        <input
          class="input num"
          type="number"
          inputmode="decimal"
          min="1"
          max="10"
          step="0.5"
          placeholder="–"
          value={inputNum(set.rpe)}
          onChange={(event: Event) => {
            const value = readValue(event);
            setRpe(i, j, value === '' ? '' : num(value));
          }}
          aria-label={`RPE serie ${j + 1}`}
        />
      ) : null}
      <button
        type="button"
        class={`set-check${set.done ? ' on' : ''}`}
        aria-pressed={set.done}
        title="Marcar serie completada"
        onClick={() => toggleSetAt(i, j)}
      >
        <Icon name="check" />
      </button>
      {entry.sets.length > 1 ? (
        <button
          type="button"
          class="icon-btn"
          title="Eliminar serie"
          onClick={() => removeSet(i, j)}
        >
          <Icon name="x" />
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

function EntryCard(props: { entry: ActiveEntry; index: number; total: number; unit: Unit }) {
  const { entry: en, index: i, total, unit } = props;
  const [notesOpen, setNotesOpen] = useState(false);
  const ex = exercises.value.find((e) => e.id === en.exId);
  const doneSets = en.sets.filter((s) => s.done).length;
  const volume = entryVolume(en, unit);
  const showRpe = settingsSignal.value.showRpe;
  return (
    <div class={`ex-card${doneSets === en.sets.length ? ' done' : ''}`}>
      <div class="ex-head">
        <div class="grow" style="min-width:0">
          <div class="ex-name">{en.name}</div>
          <div class="ex-meta">
            {ex ? `${groupLabel(ex.group)} · ${ex.type} · ` : ''}
            {doneSets}/{en.sets.length} series{volume ? ` · ${fmtVol(volume)} kg` : ''}
          </div>
          {en.basis ? (
            <div class="ex-meta">
              <Icon name="target" /> {en.basis}
            </div>
          ) : null}
        </div>
        <button
          class="icon-btn"
          title="Subir"
          disabled={i === 0}
          onClick={() => moveExercise(i, -1)}
        >
          <Icon name="chev-u" />
        </button>
        <button
          class="icon-btn"
          title="Bajar"
          disabled={i >= total - 1}
          onClick={() => moveExercise(i, 1)}
        >
          <Icon name="chev-d" />
        </button>
        <button class="icon-btn" title="Quitar ejercicio" onClick={() => removeExercise(i)}>
          <Icon name="trash" />
        </button>
      </div>
      <div class="ex-body">
        <div class={`set-head${showRpe ? ' with-rpe' : ''}`}>
          <span>#</span>
          <span>peso ({unit})</span>
          <span>reps</span>
          {showRpe ? <span>rpe</span> : null}
          <span>ok</span>
          <span />
        </div>
        {en.sets.map((_set, j) => (
          <SetRow key={j} entry={en} entryIndex={i} setIndex={j} unit={unit} />
        ))}
        {notesOpen ? (
          <input
            class="input sm mt-s"
            placeholder="Nota del ejercicio (superserie, cómo lo sentiste…)"
            value={en.notes}
            onChange={(event: Event) =>
              setNotes(i, (event.currentTarget as HTMLInputElement).value)
            }
          />
        ) : en.notes ? (
          <div class="set-hint">
            <Icon name="info" /> {en.notes}
          </div>
        ) : null}
        <div class="prog-mini">
          <i style={`width:${((doneSets / (en.sets.length || 1)) * 100).toFixed(0)}%`} />
        </div>
        <div class="row wrap" style="gap:6px;margin-top:9px">
          <button class="btn sm ghost" onClick={() => addSet(i)}>
            <Icon name="plus" />
            serie
          </button>
          <button class="btn sm quiet" onClick={() => setNotesOpen((open) => !open)}>
            <Icon name="pencil" />
            {notesOpen ? 'cerrar nota' : 'nota'}
          </button>
        </div>
        <div class="set-hint">
          <Icon name="rest" /> descanso sugerido: {en.restSec}s (lo define el ejercicio o el coach)
        </div>
      </div>
    </div>
  );
}

/** Selector de ejercicio: solo los permitidos y que se puedan hacer con tu material. */
function ExercisePicker(props: { value: string; onPick: (id: string) => void; label: string }) {
  const candidates = exercises.value.filter((ex) => ex.allowed && isAvailable(ex, equipment.value));
  return (
    <select
      class="select grow"
      value={props.value}
      onChange={(event: Event) => props.onPick((event.currentTarget as HTMLSelectElement).value)}
    >
      <option value="">{props.label}</option>
      {candidates.map((ex) => (
        <option key={ex.id} value={ex.id}>
          {ex.name}
        </option>
      ))}
    </select>
  );
}

export function SessionCard() {
  const s = settingsSignal.value;
  const session = active.value;
  const [pick, setPick] = useState('');
  const [view, setView] = useState<'rest' | 'summary'>('rest');
  const [renaming, setRenaming] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [message, setMessage] = useState('');
  const resting = rest.value.running;

  if (!session) {
    return (
      <section class="card">
        <div class="row between mb-s">
          <b>Entrenar</b>
          <span class="tiny muted">sesión en curso</span>
        </div>
        <div class="tiny muted mb-s">
          Marca tus series y el descanso arranca solo con el tiempo del ejercicio; el peso viene
          sugerido de tu última vez.
        </div>
        <div class="row" style="gap:8px">
          <ExercisePicker
            value={pick}
            onPick={setPick}
            label="Elige un ejercicio (o empieza en blanco)…"
          />
          <button
            class="btn primary"
            onClick={() => startFreeSession({ exIds: pick ? [pick] : [] })}
          >
            <Icon name="play" />
            Empezar
          </button>
        </div>
        {message ? <div class="tiny warn mt-s">{message}</div> : null}
      </section>
    );
  }

  const prog = sessionProgress(session);
  const finish = () => {
    const saved = finishSession();
    setNotesOpen(false);
    setMessage(
      saved
        ? `Sesión guardada · ${fmtVol(prog.volume)} kg de volumen.`
        : 'No marcaste ninguna serie: la sesión no se guardó.',
    );
  };

  return (
    <>
      <div class={`card accent${resting ? ' rest-card' : ''}`}>
        {resting && view === 'rest' ? (
          <RestBox />
        ) : (
          <>
            <div class="between">
              <div style="min-width:0">
                <div class="tiny muted" style="text-transform:uppercase;letter-spacing:.5px">
                  En curso · {fmtN(prog.done)} de {fmtN(prog.total)} series
                </div>
                {renaming ? (
                  <input
                    class="input"
                    value={session.name}
                    onChange={(event: Event) =>
                      renameSession((event.currentTarget as HTMLInputElement).value)
                    }
                    onBlur={() => setRenaming(false)}
                  />
                ) : (
                  <div class="h2 ellipsis">
                    {session.name}
                    <button
                      class="icon-btn"
                      title="Renombrar la sesión"
                      onClick={() => setRenaming(true)}
                    >
                      <Icon name="pencil" />
                    </button>
                  </div>
                )}
              </div>
              <div class="center">
                <Clock />
                <div class="tiny muted">{fmtVol(prog.volume)} kg</div>
              </div>
            </div>
            <div class="bar mt-s">
              <i style={`width:${(prog.pct * 100).toFixed(0)}%`} />
            </div>
            {resting ? (
              <>
                <RestStrip />
                <button class="btn sm quiet mt-s" onClick={() => setView('rest')}>
                  <Icon name="timer" />
                  Descanso
                </button>
              </>
            ) : null}
          </>
        )}
        {resting && view === 'rest' ? (
          <button class="btn sm quiet mt-s" onClick={() => setView('summary')}>
            <Icon name="list" />
            Resumen
          </button>
        ) : null}
      </div>
      <section class="card tight">
        <div class="col" style="gap:10px">
          {session.entries.length ? (
            session.entries.map((en, i) => (
              <EntryCard
                key={`${en.exId}-${i}`}
                entry={en}
                index={i}
                total={session.entries.length}
                unit={session.unit}
              />
            ))
          ) : (
            <div class="empty">
              <Icon name="dumbbell" />
              <div>Añade tu primer ejercicio</div>
            </div>
          )}
        </div>
        <div class="row mt-s" style="gap:8px">
          <ExercisePicker value={pick} onPick={setPick} label="Añadir ejercicio…" />
          <button
            class="btn"
            disabled={!pick}
            onClick={() => {
              if (pick) addExercise(pick);
              setPick('');
            }}
          >
            <Icon name="plus" />
            Añadir
          </button>
        </div>
      </section>{' '}
      <section class="card tight">
        {prog.total > 0 && prog.done === prog.total && !s.quickFinish ? (
          <div class="tiny ok mb-s">¡Todas las series marcadas! Pulsa Finalizar.</div>
        ) : null}
        <button class="btn primary lg block" onClick={finish}>
          <Icon name="check" />
          Finalizar sesión
        </button>
        <div class="row mt-s" style="gap:8px">
          <button class="btn ghost grow" onClick={() => setNotesOpen((open) => !open)}>
            <Icon name="pencil" />
            {notesOpen ? 'Cerrar nota' : 'Nota de sesión'}
          </button>
          <button
            class="btn danger grow"
            onClick={() => {
              if (window.confirm('¿Descartar la sesión en curso? No se guardará nada.'))
                discardSession();
            }}
          >
            <Icon name="trash" />
            Descartar
          </button>
        </div>
        {notesOpen ? (
          <input
            class="input mt-s"
            placeholder="Cómo fue la sesión (se guarda con ella)"
            value={session.notes}
            onChange={(event: Event) =>
              setSessionNotes((event.currentTarget as HTMLInputElement).value)
            }
          />
        ) : session.notes ? (
          <div class="tiny muted mt-s">Nota: {session.notes}</div>
        ) : null}
        {message ? <div class="tiny ok mt-s">{message}</div> : null}
        <div class="tiny muted mt-s">
          {s.autoRest ? 'Descanso automático al marcar serie' : 'Descanso automático apagado'} · RPE{' '}
          {s.showRpe ? 'on' : 'off'}
        </div>
      </section>
    </>
  );
}
