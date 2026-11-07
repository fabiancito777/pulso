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
 *    problema que antes esquivaba refrescando a mano solo los campos de abajo).
 * 2. **Los campos se guardan en `change`, no en `input`.** Fue la decisión
 *    por el mismo motivo, y es lo que hace útil el arrastre: el valor se copia a las
 *    series de abajo cuando terminas de escribir, no en cada tecla.
 */
import { useEffect, useRef, useState } from 'preact/hooks';

import { groupLabel } from '@/domain/data';
import { volumeOf } from '@/domain/analytics';
import { fmtClock, fmtMmss, fmtN, fmtVol, inputNum } from '@/domain/format';
import { num } from '@/domain/num';
import { restView } from '@/domain/rest';
import { entryVolume, MAX_SETS, progress as sessionProgress } from '@/domain/session';
import { supersetGroups } from '@/domain/supersets';
import type { SupersetGroup } from '@/domain/supersets';
import type { ActiveEntry, ActiveSession, Unit } from '@/domain/types';
import {
  active,
  addExercises,
  addRestSeconds,
  addRoutineToSession,
  addSet,
  applyPlateWeight,
  clearJustAdded,
  discardSession,
  editSet,
  finishEntryAt,
  finishSession,
  justAdded,
  moveExercise,
  removeExercise,
  removeSet,
  renameSession,
  rest,
  restSeconds,
  sessionSeconds,
  setEntryRest,
  setNotes,
  setRpe,
  setSessionNotes,
  startFreeSession,
  stopRestTimer,
  subRestSeconds,
  toggleSetAt,
} from '@/state/session';
import { exercises, settings as settingsSignal } from '@/state/store';
import { ExercisePickerModal } from './ExercisePickerModal';
import { HelpBtn } from './HelpModal';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { PlatesModal } from './PlatesModal';
import { Ring } from './Ring';
import { RoutinePickerModal } from './RoutinePickerModal';
import { toast } from './toast';

/** Reloj de la sesión. Aislado a propósito: es lo que se repinta cada segundo. */
function Clock() {
  return <span class="num">{fmtClock(sessionSeconds.value)}</span>;
}

/**
 * ¿Toca bajar la tarjeta de arriba? Se «acopla» al pie en cuanto scrolleas y
 * vuelve arriba al llegar al principio. Los umbrales son distintos (64/24) para
 * que no parpadee justo en el borde.
 */
function useDock(enabled: boolean): boolean {
  const [docked, setDocked] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setDocked(false);
      return;
    }
    const read = (): void => {
      const y = window.scrollY;
      setDocked((prev) => (prev ? y > 24 : y > 64));
    };
    read();
    window.addEventListener('scroll', read, { passive: true });
    window.addEventListener('resize', read);
    return () => {
      window.removeEventListener('scroll', read);
      window.removeEventListener('resize', read);
    };
  }, [enabled]);
  return docked;
}

/** La barra fija necesita hueco al final del documento para no tapar el último
 *  botón; lo gestiona el propio dock, se use arriba o en otra pestaña. */
function useDockBody(show: boolean): void {
  useEffect(() => {
    document.body.classList.toggle('has-dock', show);
    return () => document.body.classList.remove('has-dock');
  }, [show]);
}

/**
 * Cuenta atrás del descanso, aislada para no repintar los inputs de las series.
 *
 * Es el ÚNICO recuadro de descanso de la app (antes `#session-rest`, `trainer.js:380`):
 * también pinta el temporizador libre cuando no hay sesión (`free`), y por eso la
 * app solo lo monta una vez (el gate de `App.tsx` + esta rama de `!session`).
 */
function RestBox({ free = false }: { free?: boolean }) {
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
          {info.over
            ? 'descanso completado'
            : free
              ? 'temporizador en marcha'
              : 'descanso en curso'}
        </div>
        <div class="h3 ellipsis">{info.label || (free ? 'Temporizador' : 'Siguiente serie')}</div>
        <div class="num" style="font-size:26px;font-weight:650">
          {fmtMmss(left)}
        </div>
        <div class="tiny muted">
          {info.over
            ? free
              ? 'tiempo cumplido'
              : 'a por la siguiente serie'
            : free
              ? `cuenta atrás · total ${fmtMmss(info.total)}`
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

/**
 * Descanso acoplado al pie: la versión reducida de `RestBox` para cuando la
 * tarjeta grande ya no está a la vista. Solo lo esencial: tiempo, ±15 s y
 * saltar; el resto (ejercicio, resumen) sigue en la tarjeta de arriba.
 */
export function RestDock({ show }: { show: boolean }) {
  const left = restSeconds.value;
  const info = restView(rest.value, Date.now());
  const tab = show ? undefined : -1;
  useDockBody(show);
  return (
    <div class={`rest-dock${show ? ' in' : ''}`} aria-hidden={!show}>
      <div class="rest-dock-inner">
        <Ring frac={info.frac} size={34} width={3.5} over={info.over} />
        <span class={`rest-dock-time${info.over ? ' over' : ''}`}>{fmtMmss(left)}</span>
        <button class="btn sm" tabIndex={tab} onClick={() => subRestSeconds(15)}>
          -15 s
        </button>
        <button class="btn sm" tabIndex={tab} onClick={() => addRestSeconds(15)}>
          +15 s
        </button>
        <button class="btn sm ghost" tabIndex={tab} onClick={stopRestTimer}>
          {info.over ? 'Continuar' : 'Saltar'}
        </button>
      </div>
    </div>
  );
}

/**
 * Versión reducida de la tarjeta «en curso» para cuando se baja: nombre,
 * series, tiempo y volumen. Sin renombrar ni ayuda, que eso vive arriba.
 */
export function SessionDock({
  show,
  name,
  done,
  total,
  volume,
  pct,
}: {
  show: boolean;
  name: string;
  done: number;
  total: number;
  volume: number;
  pct: number;
}) {
  useDockBody(show);
  return (
    <div class={`rest-dock session-dock${show ? ' in' : ''}`} aria-hidden={!show}>
      <div class="rest-dock-inner">
        <Ring frac={pct} size={34} width={3.5} />
        <div class="session-dock-main">
          <div class="session-dock-name">{name || 'Sesión'}</div>
          <div class="tiny muted">
            {fmtN(done)} de {fmtN(total)} series
          </div>
        </div>
        <div class="session-dock-nums">
          <span class="rest-dock-time">{fmtClock(sessionSeconds.value)}</span>
          <span class="tiny muted">{fmtVol(volume)} kg</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Nombre del ejercicio que se puede deslizar en su propio recuadro cuando no
 * cabe: en el móvil «Curl de muñeca con mancuerna unilateral» se cortaba en
 * «Curl de muñeca…» y no había forma de leerlo. El marquesina va y viene
 * (ping-pong) solo si de verdad sobra texto, así que los nombres cortos no se
 * mueven y no se pierde el `ellipsis` en los demás.
 */
function ExName({ name }: { name: string }) {
  const box = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);

  useEffect(() => {
    const el = box.current;
    const tx = text.current;
    if (!el || !tx) return;
    const measure = (): void => {
      const over = Math.max(0, tx.scrollWidth - el.clientWidth);
      setShift((prev) => (Math.abs(prev - over) > 1 ? (over > 2 ? over : 0) : prev));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(tx);
    return () => ro.disconnect();
  }, [name]);

  const duration = Math.max(3, Math.min(14, shift / 22));
  return (
    <div
      ref={box}
      class={`ex-name ex-name-scroll${shift ? ' marquee' : ''}`}
      title={name}
      style={shift ? `--marquee-shift:-${shift}px;--marquee-dur:${duration.toFixed(1)}s` : undefined}
    >
      <span ref={text}>{name}</span>
    </div>
  );
}

function SetRow(props: {
  entry: ActiveEntry;
  entryIndex: number;
  setIndex: number;
  unit: Unit;
  /** todas las series hechas: el «×» de borrar deja sitio a «Completar» */
  locked?: boolean;
}) {
  const { entry, entryIndex: i, setIndex: j, unit, locked } = props;
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
      {entry.sets.length > 1 && !locked ? (
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

/**
 * «Completar ejercicio»: aparece cuando todas las series están marcadas y ocupa
 * el sitio que tenían los «×» de borrar serie (que se ocultan al cerrar).
 *
 * Guarda ESE ejercicio como una sesión aparte, con su fecha y hora
 * (`finishEntryAt`), para poder repartir una rutina entre días. Pide
 * confirmación porque saca el ejercicio de la sesión en curso (aunque las series
 * quedan guardadas en el historial y se pueden deshacer desde allí).
 */
function CompletionButton({
  index,
  name,
  sets,
  onDone,
}: {
  index: number;
  name: string;
  sets: number;
  onDone?: (index: number) => void;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <button
        type="button"
        class="btn complete-set mt-s"
        onClick={() => setAsking(true)}
        title="Guardar este ejercicio en el historial sin cerrar la rutina"
      >
        <Icon name="check-circle" />
        Completar ejercicio
      </button>
      {asking ? (
        <Modal
          title="¿Completar este ejercicio?"
          sub={name}
          onClose={() => setAsking(false)}
          foot={
            <>
              <button type="button" class="btn ghost" onClick={() => setAsking(false)}>
                Cancelar
              </button>
              <button
                type="button"
                class="btn primary"
                onClick={() => {
                  setAsking(false);
                  onDone?.(index);
                }}
              >
                <Icon name="check" />
                Completar
              </button>
            </>
          }
        >
          <div class="tiny muted">
            Se guardarán {fmtN(sets, 0)} series en el historial con la fecha y hora de ahora, y el
            ejercicio saldrá de esta rutina. Si es el último que queda, la sesión se cierra.
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function EntryCard(props: {
  entry: ActiveEntry;
  index: number;
  total: number;
  unit: Unit;
  /** recién añadido: scroll hasta aquí y la clase `.new` durante 1,5 s */
  highlight?: boolean;
  /** posición en su par de superserie (insignia «SS A · 1/2») */
  superset?: { letter: string; position: number; size: number };
  onPlates?: (index: number) => void;
  onComplete?: (index: number) => void;
}) {
  const { entry: en, index: i, total, unit, onPlates } = props;
  const [notesOpen, setNotesOpen] = useState(false);
  const [restOpen, setRestOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const highlight = props.highlight === true;
  const ex = exercises.value.find((e) => e.id === en.exId);
  const doneSets = en.sets.filter((s) => s.done).length;
  const volume = entryVolume(en, unit);
  const showRpe = settingsSignal.value.showRpe;
  /* todas marcadas: el «×» de borrar deja su sitio a «Completar» y no se puede
     deshacer el ejercicio por accidente al guardarlo como sesión suelta */
  const complete = en.sets.length > 0 && doneSets === en.sets.length;

  /* El ejercicio recién añadido queda varias pantallas más abajo: si no, parece
     que no se ha añadido nada (antes `focusEntry`, views-train.js:274). El scroll va
     en el efecto y no en el render para no arrastrar el navegador en cada repintado. */
  useEffect(() => {
    if (!highlight) return;
    const el = box.current;
    if (!el) return;
    el.classList.add('new');
    try {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch {
      try {
        el.scrollIntoView();
      } catch {
        /* noop */
      }
    }
    const id = window.setTimeout(() => {
      el.classList.remove('new');
      clearJustAdded();
    }, 1500);
    return () => {
      window.clearTimeout(id);
      el.classList.remove('new');
    };
  }, [highlight]);

  return (
    <div class={`ex-card${doneSets === en.sets.length ? ' done' : ''}`} ref={box}>
      <div class="ex-head">
        <div class="grow" style="min-width:0">
          {props.superset ? (
            <div class="ss-badge">
              SS {props.superset.letter} · {props.superset.position}/{props.superset.size}
            </div>
          ) : null}
          <ExName name={en.name} />
          <div class="ex-meta">
            {ex ? `${groupLabel(ex.group)} · ${ex.type} · ` : ''}
            {doneSets}/{en.sets.length} series{volume ? ` · ${fmtVol(volume)} kg` : ''}
          </div>
          {en.basis ? (
            <div class="ex-meta" style="display:flex;gap:4px;align-items:center">
              <Icon name="target" />
              <span class="grow" style="min-width:0;overflow:hidden;text-overflow:ellipsis">
                {en.basis}
              </span>
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
          <SetRow key={j} entry={en} entryIndex={i} setIndex={j} unit={unit} locked={complete} />
        ))}
        {complete ? (
          <CompletionButton
            index={i}
            name={en.name}
            sets={en.sets.length}
            onDone={props.onComplete}
          />
        ) : null}
        {notesOpen ? (
          <input
            class="input sm mt-s"
            placeholder="Nota del ejercicio (superserie, cómo lo sentiste…)"
            aria-label="Nota del ejercicio"
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
          <button
            class="btn sm ghost"
            disabled={en.sets.length >= MAX_SETS}
            title={
              en.sets.length >= MAX_SETS
                ? `Máximo ${MAX_SETS} series por ejercicio: borra una para añadir otra`
                : 'Añadir una serie a este ejercicio'
            }
            onClick={() => addSet(i)}
          >
            <Icon name="plus" />
            serie
          </button>
          <button
            class="btn sm quiet"
            title="Qué discos cargan este peso"
            onClick={() => onPlates?.(i)}
          >
            <Icon name="plate" />
            discos
          </button>
          <HelpBtn id="entreno.platesBtn" title="Qué discos cargan este peso" />
          <button class="btn sm quiet" onClick={() => setNotesOpen((open) => !open)}>
            <Icon name="pencil" />
            {notesOpen ? 'cerrar nota' : 'nota'}
          </button>
        </div>
        <div class="row" style="gap:6px">
          {restOpen ? (
            <input
              class="input num sm mt-s"
              type="number"
              inputmode="numeric"
              min="0"
              step="5"
              value={inputNum(en.restSec)}
              aria-label="descanso de este ejercicio, en segundos"
              title="Descanso que arranca al marcar serie (0 = el ajuste general)"
              onChange={(event: Event) => {
                const raw = (event.currentTarget as HTMLInputElement).value.trim();
                /* vacío = sin cambios (el valor se escribe al confirmar, no en cada tecla) */
                if (raw === '') return;
                setEntryRest(i, Math.max(0, num(raw)));
              }}
              onBlur={() => setRestOpen(false)}
            />
          ) : (
            <button
              type="button"
              class="set-hint"
              title="Pulsa para cambiar el descanso de este ejercicio"
              onClick={() => setRestOpen(true)}
            >
              <Icon name="rest" /> descanso: {en.restSec}s · pulsa para cambiarlo
            </button>
          )}
          <HelpBtn id="entreno.entryRest" title="Descanso de cada ejercicio" />
        </div>
      </div>
    </div>
  );
}

/**
 * La lista de ejercicios, con los pares de superserie dentro de un bloque propio.
 *
 * El agrupado es presentación derivada de `superset` (`domain/supersets`): no hay
 * estado de grupo que sincronizar, y si un par se rompe al mover o quitar algo
 * simplemente deja de pintarse como tal.
 */
function EntryList(props: {
  session: ActiveSession;
  highlight: number | null;
  onPlates: (index: number) => void;
  onComplete: (index: number) => void;
}) {
  const entries = props.session.entries;
  const groups = supersetGroups(entries);
  const byIndex = new Map<number, SupersetGroup>();
  for (const group of groups) for (const idx of group.indices) byIndex.set(idx, group);

  const chunks: { indices: number[]; group: SupersetGroup | null }[] = [];
  const seen = new Set<number>();
  entries.forEach((_entry, i) => {
    if (seen.has(i)) return;
    const group = byIndex.get(i) ?? null;
    const indices = group ? group.indices : [i];
    for (const idx of indices) seen.add(idx);
    chunks.push({ indices, group });
  });

  const card = (i: number) => {
    const group = byIndex.get(i);
    return (
      <EntryCard
        key={`${entries[i]?.exId ?? 'ex'}-${i}`}
        entry={entries[i]}
        index={i}
        total={entries.length}
        unit={props.session.unit}
        highlight={props.highlight === i}
        superset={
          group ? { letter: group.letter, position: group.indices.indexOf(i) + 1, size: group.indices.length } : undefined
        }
        onPlates={props.onPlates}
        onComplete={props.onComplete}
      />
    );
  };

  return (
    <>
      {chunks.map((chunk) =>
        chunk.group ? (
          <div class="ss-group" key={`ss-${chunk.group.id}`}>
            <div class="ss-head">
              Superserie {chunk.group.letter} · {chunk.indices.length} ejercicios · descanso al cerrar el par
            </div>
            {chunk.indices.map(card)}
          </div>
        ) : (
          card(chunk.indices[0] ?? 0)
        ),
      )}
    </>
  );
}

type Message = { text: string; tone: 'ok' | 'warn' };

export function SessionCard() {
  const s = settingsSignal.value;
  const session = active.value;
  const [view, setView] = useState<'rest' | 'summary'>('rest');
  const [renaming, setRenaming] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [routinesOpen, setRoutinesOpen] = useState(false);
  const [platesFor, setPlatesFor] = useState<number | null>(null);
  /* índice del último ejercicio añadido (señal compartida: RoutinesView también la usa) */
  const highlight = justAdded.value;
  const resting = rest.value.running;
  const docked = useDock(Boolean(session) || resting);
  const sessionId = session?.id ?? null;
  const previousId = useRef(sessionId);

  /* Al empezar/cambiar de sesión se limpia el aviso anterior. Al terminarla no:
     el mensaje de «Sesión guardada» se pinta ya en la vista sin sesión. */
  useEffect(() => {
    if (sessionId === previousId.current) return;
    previousId.current = sessionId;
    if (sessionId !== null) setMessage(null);
  }, [sessionId]);

  if (!session) {
    /* Descanso/temporizador libre SIN sesión: el gate de `App.tsx` monta esta
       tarjeta también con `rest.running`, y aquí manda el recuadro ÚNICO de
       descanso (spec hoy.md §3.6). Sin esta rama el temporizador libre se vería
       como el placeholder de "empezar" con un contador suelto al lado. */
    if (resting) {
      return (
        <>
          <div class={`card accent rest-card dockable${docked ? ' is-docked' : ''}`}>
            <RestBox free />
          </div>
          <RestDock show={docked} />
        </>
      );
    }
    return (
      <section class="card">
        <div class="row between mb-s">
          <div class="row" style="gap:4px">
            <b>Entrenar</b>
            <HelpBtn id="tab.entrenar" title="Entrenar" />
          </div>
          <span class="tiny muted">sin sesión activa</span>
        </div>
        <div class="between mb-s">
          <div class="tiny muted grow">
            Marca tus series y el descanso arranca solo con el tiempo del ejercicio; el peso viene
            sugerido de tu última vez.
          </div>
        </div>
        <div class="row" style="gap:8px">
          <button type="button" class="btn grow" onClick={() => setPickerOpen(true)}>
            <Icon name="plus" />
            Elegir ejercicios…
          </button>
          <button type="button" class="btn primary" onClick={() => startFreeSession({ exIds: [] })}>
            <Icon name="play" />
            Empezar en blanco
          </button>
        </div>
        {message ? (
          <div
            class={`tiny ${message.tone} mt-s`}
            role="status"
            aria-live={message.tone === 'warn' ? 'assertive' : 'polite'}
          >
            {message.text}
          </div>
        ) : null}
        {pickerOpen ? (
          <ExercisePickerModal
            onClose={() => setPickerOpen(false)}
            onPick={(ids) => {
              setPickerOpen(false);
              if (ids.length) startFreeSession({ exIds: ids });
            }}
          />
        ) : null}
      </section>
    );
  }

  const prog = sessionProgress(session);
  const completeEntry = (index: number): void => {
    const entry = session.entries[index];
    const volume = entry ? entryVolume(entry, session.unit) : 0;
    const result = finishEntryAt(index);
    if (!result.ok) {
      setMessage({
        text:
          result.reason === 'save'
            ? 'No se pudo guardar el ejercicio. Inténtalo de nuevo.'
            : 'Marca alguna serie con repeticiones antes de completar.',
        tone: 'warn',
      });
      return;
    }
    setMessage({
      text: result.remaining
        ? `${entry?.name ?? 'Ejercicio'} guardado · ${fmtVol(volume)} kg · quedan ${fmtN(result.remaining, 0)} ejercicios`
        : `Ejercicio guardado · ${fmtVol(volume)} kg de volumen.`,
      tone: 'ok',
    });
  };
  const finish = () => {    /* el volumen se captura ANTES: al terminar, la sesión activa desaparece */
    const result = finishSession();
    setNotesOpen(false);
    /* El acuse NO se pinta aquí: `finishSession` publica la sesión en
       `lastFinished` y el shell monta `SessionDoneSheet`, que sobrevive a esta
       tarjeta (se desmonta al terminar desde Hoy). Aquí solo queda el aviso
       rápido, que sí puede morir con el componente. */
    if (result.ok) {
      toast(`Sesión guardada · ${fmtVol(volumeOf(result.session))} kg`, { kind: 'ok' });
    } else if (result.reason === 'empty') {
      setMessage({
        text: 'No marcaste ninguna serie: la sesión no se guardó.',
        tone: 'warn',
      });
    } else {
      setMessage({
        text: 'No se pudo guardar la sesión. Inténtalo de nuevo.',
        tone: 'warn',
      });
    }
  };

  return (
    <>
      <div
        class={`card accent dockable${resting ? ' rest-card' : ''}${docked ? ' is-docked' : ''}`}
      >
        {resting && view === 'rest' ? (
          <RestBox />
        ) : (
          <>
            <div class="between">
              <div style="min-width:0">
                <div
                  class="between tiny muted"
                  style="text-transform:uppercase;letter-spacing:.5px"
                >
                  <span class="row" style="gap:2px">
                    <span>
                      En curso · {fmtN(prog.done)} de {fmtN(prog.total)} series
                    </span>
                  </span>
                  <HelpBtn id="entreno.drag" title="El peso se arrastra hacia abajo" />
                </div>
                {renaming ? (
                  <input
                    class="input"
                    aria-label="Nombre de la sesión"
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
                <div class="row mt-s" style="gap:6px">
                  <button class="btn sm quiet" onClick={() => setView('rest')}>
                    <Icon name="timer" />
                    Descanso
                  </button>
                  <HelpBtn id="entreno.rest" title="El descanso lo define cada ejercicio" />
                </div>
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
            <EntryList
              session={session}
              highlight={highlight}
              onPlates={setPlatesFor}
              onComplete={completeEntry}
            />
          ) : (
            <div class="empty">
              <Icon name="dumbbell" />
              <div>Añade tu primer ejercicio</div>
            </div>
          )}
        </div>
        <div class="grid c2 mt-s">
          <button type="button" class="btn" onClick={() => setPickerOpen(true)}>
            <Icon name="plus" />
            Añadir ejercicio…
          </button>
          <button type="button" class="btn" onClick={() => setRoutinesOpen(true)}>
            <Icon name="list" />
            Añadir rutina
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
            aria-label="Nota de la sesión"
            value={session.notes}
            onChange={(event: Event) =>
              setSessionNotes((event.currentTarget as HTMLInputElement).value)
            }
          />
        ) : session.notes ? (
          <div class="tiny muted mt-s">Nota: {session.notes}</div>
        ) : null}
        {message ? (
          <div
            class={`tiny ${message.tone} mt-s`}
            role="status"
            aria-live={message.tone === 'warn' ? 'assertive' : 'polite'}
          >
            {message.text}
          </div>
        ) : null}
        <div class="tiny muted mt-s">
          {s.autoRest ? 'Descanso automático al marcar serie' : 'Descanso automático apagado'} · RPE{' '}
          {s.showRpe ? 'on' : 'off'}
        </div>
      </section>
      {pickerOpen ? (
        <ExercisePickerModal
          exclude={session.entries.map((en) => en.exId)}
          onClose={() => setPickerOpen(false)}
          onPick={(ids) => {
            setPickerOpen(false);
            const added = addExercises(ids);
            setMessage(
              added === null
                ? { text: 'Ese ejercicio ya está en la sesión.', tone: 'warn' }
                : {
                    text: `${fmtN(ids.length, 0)} ${ids.length === 1 ? 'ejercicio añadido' : 'ejercicios añadidos'}.`,
                    tone: 'ok',
                  },
            );
          }}
        />
      ) : null}
      {routinesOpen ? (
        <RoutinePickerModal
          onClose={() => setRoutinesOpen(false)}
          onPick={(routineId) => {
            setRoutinesOpen(false);
            const added = addRoutineToSession(routineId);
            setMessage(
              added === null
                ? { text: 'No se pudo añadir la rutina.', tone: 'warn' }
                : { text: 'Rutina añadida a la sesión.', tone: 'ok' },
            );
          }}
        />
      ) : null}
      {platesFor !== null && session.entries[platesFor] ? (
        <PlatesModal
          entry={session.entries[platesFor]}
          onClose={() => setPlatesFor(null)}
          onUse={(kg) => {
            if (platesFor === null) return;
            const entry = session.entries[platesFor];
            if (!entry) return;
            applyPlateWeight(platesFor, kg);
            setPlatesFor(null);
            setMessage({
              text: `${fmtN(kg, 2)} ${session.unit} cargados en ${entry.name}`,
              tone: 'ok',
            });
          }}
        />
      ) : null}
      {resting ? (
        <RestDock show={docked} />
      ) : (
        <SessionDock
          show={docked}
          name={session.name}
          done={prog.done}
          total={prog.total}
          volume={prog.volume}
          pct={prog.pct}
        />
      )}
    </>
  );
}
