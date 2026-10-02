/**
 * Modal «Generar con IA» de Ajustes → Ejercicios (spec
 * `_specs/generador-ejercicios.md`).
 *
 * Flujo, con la regla dura de cuota en la frente: **abrir el modal no cuesta
 * nada, el chip de huecos tampoco y 1 clic en «Generar» = 1 petición**. No hay
 * `useEffect` de montaje ni previsualización automática: todo lo caro pasa
 * dentro del `onClick` de `run`.
 *
 * - **Campo libre + chip «según mis huecos del historial»**: el chip solo
 *   rellena el textarea y levanta la flag; el brief con cifras lo calcula
 *   `generateExercises` en el clic.
 * - **Confirmación antes de crear**: las propuestas son previsualización y
 *   NADA se escribe hasta «Crear» / «Crear N seleccionados» →
 *   `createExerciseFromAI`. «Crear y editar» cierra el modal y pide con
 *   `requestEdit(id)` el `ExerciseEditor` de `SecEjercicios`, que ya está
 *   enganchado (Fase 0).
 * - **Sin API key**: tarjeta con atajo a Ajustes → Coach AI (mismo patrón que
 *   `CoachView`), botón de generación deshabilitado y CERO peticiones.
 * - **Duplicados**: se marcan con `duplicateOf` y arrancan des-seleccionados;
 *   si el usuario insiste, la creación devuelve el aviso del matcher y no se
 *   escribe nada (mejor un aviso que dos ejercicios parecidos).
 *
 * El texto del modelo y el de los avisos PINTAN escapado solo (Preact): aquí no
 * hay `dangerouslySetInnerHTML` ni `innerHTML` en ninguna parte.
 */
import { useState } from 'preact/hooks';

import { go } from '@/app/router';
import { equipLabel, groupLabel } from '@/domain/data';
import type { ExerciseProposal } from '@/features/coach/generate-exercise';
import { hasApiKey } from '@/state/coach';
import { createExerciseFromAI, requestEdit } from '@/state/exercise-create';
import { exgenErrorText, generateExercises } from '@/state/exgen';

import { Icon } from './Icon';
import { Modal } from './Modal';
import { toast } from './toast';
import '../styles/exgen.css';

/** Cuántos ejercicios se pueden pedir por tanda (el default es el del runner). */
const COUNTS = [3, 4, 5, 6];

/** Una propuesta en la lista, con su estado de confirmación. */
interface GenItem {
  proposal: ExerciseProposal;
  selected: boolean;
  created: boolean;
  error: string;
}

/**
 * @param initialPrompt texto con el que arranca el campo libre. Lo usa la
 *   biblioteca para el atajo de un grupo vacío («Generar ejercicios de X»).
 */
export function ExerciseGenModal({
  onClose,
  initialPrompt = '',
}: {
  onClose: () => void;
  initialPrompt?: string;
}) {
  const [text, setText] = useState(initialPrompt);
  const [count, setCount] = useState(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [advice, setAdvice] = useState('');
  const [issues, setIssues] = useState<readonly string[]>([]);
  const [items, setItems] = useState<GenItem[]>([]);
  const hasKey = hasApiKey();

  const pending = items.filter((item) => item.selected && !item.created).length;

  /** Único punto del modal que pide una petición: 1 clic = 1 llamada, sin retry. */
  const run = async (): Promise<void> => {
    const prompt = text.trim();
    if (busy || !hasKey || !prompt) return;
    setBusy(true);
    setError('');
    setAdvice('');
    setIssues([]);
    try {
      const out = await generateExercises({ prompt, count });
      setAdvice(out.advice ?? '');
      setIssues(out.issues);
      setItems(
        out.proposals.map((proposal) => ({
          proposal,
          selected: !proposal.duplicateOf,
          created: false,
          error: '',
        })),
      );
    } catch (err) {
      setError(exgenErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const patch = (index: number, next: Partial<GenItem>): void =>
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...next } : item)));

  /**
   * Confirmación: LA ÚNICA escritura del modal (`createExerciseFromAI` →
   * `saveExercise`). Un fallo (duplicado, material que falta) se queda en la
   * tarjeta y no mueve nada.
   */
  const createOne = (index: number, thenEdit: boolean): void => {
    const item = items[index];
    if (!item) return;
    const result = createExerciseFromAI(item.proposal);
    if (!result.ok) {
      patch(index, { error: result.error });
      toast(result.error, { kind: 'err', ms: 8000 });
      return;
    }
    patch(index, { created: true, error: '', selected: false });
    toast('Ejercicio creado', { kind: 'ok' });
    if (thenEdit) {
      requestEdit(result.exercise.id);
      onClose();
    }
  };

  /** «Crear N seleccionados»: mismo camino, en una sola pasada. */
  const createSelected = (): void => {
    const targets = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.selected && !item.created);
    if (!targets.length) return;

    let ok = 0;
    const failed: string[] = [];
    const next: Partial<GenItem>[] = [];
    for (const { item, index } of targets) {
      const result = createExerciseFromAI(item.proposal);
      if (result.ok) {
        ok += 1;
        next[index] = { created: true, error: '', selected: false };
      } else {
        failed.push(result.error);
        next[index] = { error: result.error };
      }
    }
    setItems((prev) => prev.map((item, i) => (next[i] ? { ...item, ...next[i] } : item)));

    if (ok && !failed.length) {
      toast(ok === 1 ? 'Ejercicio creado' : `${ok} ejercicios creados`, { kind: 'ok' });
    } else if (failed.length) {
      toast(ok ? `${ok} creados · ${failed[0]}` : failed[0], { kind: 'warn', ms: 8000 });
    }
  };

  if (!hasKey) {
    return (
      <Modal
        title="Generar ejercicios con IA"
        onClose={onClose}
        foot={
          <button type="button" class="btn ghost" onClick={onClose}>
            Cerrar
          </button>
        }
      >
        <section class="card accent">
          <div class="row">
            <span class="ico" style="color:var(--accent)">
              <Icon name="key" />
            </span>
            <div class="grow">
              <div class="h3">Necesita API key</div>
              <div class="tiny muted">
                El generador inventa ejercicios nuevos con el mismo modelo que el coach. Añade tu
                API key de Google AI Studio en Ajustes → Coach AI y vuelve aquí.
              </div>
            </div>
          </div>
          <div class="row mt-s" style="gap:8px">
            <button type="button" class="btn primary" onClick={() => go('ajustes', 'coach')}>
              <Icon name="gear" />
              Configurar API key
            </button>
          </div>
        </section>
      </Modal>
    );
  }

  return (
    <Modal
      title="Generar ejercicios con IA"
      onClose={onClose}
      foot={
        <>
          <button type="button" class="btn ghost" onClick={onClose}>
            Cerrar
          </button>
          <button
            type="button"
            class="btn primary"
            disabled={busy || !pending}
            onClick={createSelected}
          >
            {pending ? `Crear ${pending} seleccionados` : 'Crear'}
          </button>
        </>
      }
    >
      <div class="tiny muted">
        Nada se escribe hasta que lo confirmas: aquí solo se previsualizan.
      </div>
      <div class="tiny muted mt-s">
        Mira siempre tu historial y tu material. Si lo que pides ya lo cubres, o no encaja con tus
        datos, te lo dirá en vez de inventarse ejercicios.
      </div>

      <label class="field mt-s">
        <span class="label">Describe qué buscas</span>
        <textarea
          class="input"
          rows={3}
          placeholder="p. ej. remo para dorsal con mancuernas que no sea con barra"
          value={text}
          onInput={(e) => setText(e.currentTarget.value)}
        />
      </label>

      <div class="row wrap mt-s" style="gap:8px">
        <select
          class="select"
          style="width:auto;max-width:160px"
          value={String(count)}
          onChange={(e) => setCount(Number(e.currentTarget.value))}
        >
          {COUNTS.map((n) => (
            <option key={n} value={n}>
              {n} ejercicios
            </option>
          ))}
        </select>
        <button
          type="button"
          class="btn primary grow"
          disabled={busy || !hasKey || !text.trim()}
          onClick={() => void run()}
        >
          {busy ? 'Generando…' : 'Generar'}
        </button>
      </div>

      {error ? <div class="exgen-error mt-s">{error}</div> : null}

      {advice ? (
        <section class="card accent mt-s">
          <div class="row" style="gap:9px;align-items:flex-start">
            <span class="ico" style="color:var(--accent)">
              <Icon name="sparkles" />
            </span>
            <div class="grow">
              <div class="h3">Te lo digo antes de inventar</div>
              <div class="sub">{advice}</div>
            </div>
          </div>
        </section>
      ) : null}

      {issues.length ? (
        <div class="exgen-issues mt-s">
          <div class="tiny warn">Avisos de la última generación</div>
          {issues.map((issue) => (
            <div class="tiny muted" key={issue}>
              · {issue}
            </div>
          ))}
        </div>
      ) : null}

      <div class="exgen-list mt-s">
        {items.length ? (
          items.map((item, index) => {
            const p = item.proposal;
            const bits = [
              p.group ? groupLabel(p.group) : '',
              p.equip ? equipLabel(p.equip) : 'peso corporal',
              p.unilateral ? 'unilateral' : '',
              p.type ?? '',
              `${p.sets ?? 3}×${p.repMin ?? 8}-${p.repMax ?? 12}`,
              `${p.rest ?? 90} s`,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <div class={`exgen-item${item.created ? ' created' : ''}`} key={index}>
                <label class="exgen-head">
                  <input
                    type="checkbox"
                    checked={item.selected}
                    disabled={item.created}
                    onChange={(e) => patch(index, { selected: e.currentTarget.checked })}
                  />
                  <span class="exgen-name">{p.name}</span>
                  {item.created ? <span class="badge ok">creado</span> : null}
                </label>
                <div class="tiny muted exgen-meta">{bits}</div>
                {p.desc ? <div class="exgen-desc">{p.desc}</div> : null}
                {p.duplicateOf ? (
                  <div class="exgen-warn">
                    Aviso: muy parecido a «{p.duplicateOf}» (no se creará si ya existe).
                  </div>
                ) : null}
                {p.conflict ? <div class="exgen-warn">{p.conflict}</div> : null}
                {p.notes.map((note) => (
                  <div class="tiny muted" key={note}>
                    {note}
                  </div>
                ))}
                {item.error ? <div class="exgen-error">{item.error}</div> : null}
                <div class="exgen-actions">
                  <button
                    type="button"
                    class="btn sm"
                    disabled={busy || item.created}
                    onClick={() => createOne(index, false)}
                  >
                    Crear
                  </button>
                  <button
                    type="button"
                    class="btn sm"
                    disabled={busy || item.created}
                    onClick={() => createOne(index, true)}
                  >
                    Crear y editar
                  </button>
                  <button
                    type="button"
                    class="btn sm ghost"
                    disabled={item.created}
                    onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                  >
                    Descartar
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div class="empty">
            <Icon name={advice ? 'check-circle' : 'sparkles'} />
            <div>
              {advice
                ? 'Sin propuestas nuevas: el aviso de arriba lo explica.'
                : 'Escribe qué buscas y pulsa «Generar»: cada clic hace una petición.'}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
