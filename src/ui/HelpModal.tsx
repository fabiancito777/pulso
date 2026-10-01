/**
 * Modal de ayuda (spec `help-ux.md` §3.2): un solo mecanismo de apertura para
 * los tres niveles — ⓘ de cada opción, chips «Ver también» y la guía general.
 *
 * El patrón es el de `toast.tsx`: una signal con el id abierto y un host
 * `<div id="help-root">` que este módulo monta en `document.body` a la primera
 * llamada, fuera del shell. Así cualquier vista abre ayuda sin cablear nada en
 * `App.tsx`, el modal sobrevive a cambios de pestaña y, al ir montado el
 * ÚLTIMO, su `.modal-scrim` queda encima de cualquier otro modal sin tocar
 * `z-index`. Sin DOM (tests en Node) `openHelp` solo mueve la señal.
 *
 * El texto vive en `help-content.ts`: aquí no se escribe ni una frase. El índice
 * de la guía (buscador + un `<details>` por sección) se pinta dentro del tema
 * `guide` y, reexportado, en Ajustes → Ayuda: así un ⓘ de opción no arrastra 80
 * temas al modal, pero el índice sigue siendo uno solo.
 */
import { signal } from '@preact/signals';
import { render } from 'preact';
import { useState } from 'preact/hooks';

import {
  HELP_IDS,
  SECTION_LABELS,
  searchHelp,
  topic,
  topicsBySection,
  type HelpId,
  type HelpTopic,
} from './help-content';
import { Icon } from './Icon';
import { Modal } from './Modal';

import '../styles/help.css';

/** El id abierto, o `null` con el modal cerrado. Solo lo lee `HelpHost`. */
export const helpId = signal<HelpId | null>(null);

/**
 * Pila de temas visitados DENTRO del modal: es lo que hace funcionar el «Volver».
 * Al abrir el modal desde cero se vacía; al saltar de un tema a otro (chips «ver
 * también», índice de la guía) se apila el que dejas atrás.
 */
const trail = signal<HelpId[]>([]);

/**
 * Secciones desplegadas del índice. Vive a nivel de módulo a propósito: al
 * abrir un tema el índice se desmonta, y al volver debe seguir como lo dejaste
 * (si no, cada «Volver» te devuelve todo plegado y pierdes el hilo).
 */
const openSections = signal<ReadonlySet<string>>(new Set<string>());

function toggleSection(section: string, open: boolean): void {
  const next = new Set(openSections.value);
  if (open) next.add(section);
  else next.delete(section);
  openSections.value = next;
}

/** Para ignorar en runtime ids pasados a mano con un cast (los válidos los ve `tsc`). */
const KNOWN = new Set<string>(HELP_IDS);

let host: HTMLElement | null = null;

/**
 * Abre el modal de un tema. Un id desconocido se ignora en silencio (defensa
 * frente a `as HelpId` escrito a mano) y sin `document` no lanza: la señal
 * cambia igual, que es lo que comprueba `help.test.ts`.
 */
export function openHelp(id: HelpId): void {
  if (!KNOWN.has(id)) return;
  const current = helpId.value;
  if (current === null) trail.value = [];
  else if (current !== id) trail.value = [...trail.value, current];
  helpId.value = id;
  ensureHelpHost();
}

/** Retrocede al tema anterior; con la pila vacía, cierra el modal. */
export function backHelp(): void {
  const prev = trail.value;
  if (!prev.length) {
    closeHelp();
    return;
  }
  helpId.value = prev[prev.length - 1];
  trail.value = prev.slice(0, -1);
}

/** Cierra el modal (el scrim, la X y ESC llaman a esto vía `Modal`). */
export function closeHelp(): void {
  helpId.value = null;
  trail.value = [];
}

/**
 * El botón ⓘ. Va FUERA de cualquier `<label>` y de cualquier control: su
 * `preventDefault`/`stopPropagation` lo hacen seguro también dentro de un
 * `<summary>` o de una fila pulsable (spec §3.3, «regla dura»).
 */
export function HelpBtn({ id, title }: { id: HelpId; title?: string }) {
  return (
    <button
      type="button"
      class="icon-btn help-btn"
      aria-label={title ? `Ayuda: ${title}` : 'Ayuda'}
      aria-haspopup="dialog"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openHelp(id);
      }}
    >
      <Icon name="info" />
    </button>
  );
}

/** Fila del índice: un tema del que se puede abrir su modal. */
function TopicRow({ t }: { t: HelpTopic }) {
  return (
    <li>
      <button type="button" class="list-item tappable" onClick={() => openHelp(t.id)}>
        <span class="li-main">
          <span class="li-title">{t.title}</span>
        </span>
        <Icon name="chev-r" />
      </button>
    </li>
  );
}

/**
 * Índice de la guía: buscador sin acentos (mientras se escribe manda la lista
 * de resultados) y, sin búsqueda, un `<details>` por sección con sus temas.
 *
 * Se exporta porque también se pinta en Ajustes → Ayuda (`SecAyuda`): el mismo
 * markup en el modal y en la subsección, sin duplicar el índice.
 */
export function GuideIndex() {
  const [q, setQ] = useState('');
  const results = searchHelp(q);
  const groups = topicsBySection();
  return (
    <div class="help-index">
      <div class="search">
        <Icon name="search" />
        <input
          class="input"
          type="search"
          placeholder="Buscar: 1RM, descanso, racha…"
          autocomplete="off"
          value={q}
          onInput={(event) => setQ(event.currentTarget.value)}
        />
      </div>
      {q ? (
        <ul class="help-list">
          {results.map((t) => (
            <TopicRow key={t.id} t={t} />
          ))}
          {results.length === 0 ? <li class="tiny muted help-empty">Sin resultados.</li> : null}
        </ul>
      ) : (
        <div>
          {groups.map((g) => {
            const open = openSections.value.has(g.section);
            return (
              <details class="help-gloss" key={g.section} open={open}>
                <summary
                  onClick={(event) => {
                    /* el desplegado lo manda el estado (así sobrevive al volver),
                     no el navegador */
                    event.preventDefault();
                    toggleSection(g.section, !open);
                  }}
                >
                  <Icon name="chev-r" class="gloss-caret" />
                  <span class="grow">{SECTION_LABELS[g.section]}</span>
                  <span class="gloss-count">{g.topics.length}</span>
                </summary>
                <ul class="help-list">
                  {g.topics.map((t) => (
                    <TopicRow key={t.id} t={t} />
                  ))}
                </ul>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** El contenido del modal: sección, párrafos, «ver también» e índice (solo en `guide`). */
function TopicView({ id }: { id: HelpId }) {
  const t = topic(id);
  const see = t.see ?? [];
  return (
    <>
      <div class="tiny muted help-sec">{SECTION_LABELS[t.section]}</div>
      <div class="help-body">
        {t.paras.map((p, i) => (
          <p class="sub" key={i}>
            {p}
          </p>
        ))}
      </div>
      {see.length ? (
        <div class="help-see">
          {see.map((s) => (
            <button type="button" class="chip" key={s} onClick={() => openHelp(s)}>
              {topic(s).title}
            </button>
          ))}
        </div>
      ) : null}
      {id === 'guide' ? <GuideIndex /> : null}
    </>
  );
}

function HelpHost() {
  const id = helpId.value;
  if (id === null) return null;
  const canBack = trail.value.length > 0;
  return (
    <Modal
      title={topic(id).title}
      onClose={closeHelp}
      foot={
        canBack || id !== 'guide' ? (
          <>
            {canBack ? (
              <button type="button" class="btn ghost" onClick={backHelp}>
                <Icon name="chev-l" />
                Volver
              </button>
            ) : null}
            {id === 'guide' ? null : (
              <button type="button" class="btn ghost" onClick={() => openHelp('guide')}>
                <Icon name="info" />
                Guía completa
              </button>
            )}
          </>
        ) : null
      }
    >
      <TopicView id={id} />
    </Modal>
  );
}

/** Crea `#help-root` en el `body` una sola vez (patrón `toast.tsx`). */
function ensureHelpHost(): void {
  if (host || typeof document === 'undefined') return;
  host = document.createElement('div');
  host.id = 'help-root';
  document.body.appendChild(host);
  render(<HelpHost />, host);
}
