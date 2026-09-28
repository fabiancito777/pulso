/**
 * Vista Coach: chat con Gemini, acciones rápidas y memoria editable.
 *
 * Port de `legacy/js/views-coach.js` (paridad: tarjeta de estado, acciones
 * rápidas, burbujas con razonamiento, composer pegajoso y «Limpiar») sobre la
 * capa `state/coach.ts`, que es la que habla con `features/coach`.
 *
 * Decisiones que conviene no olvidar:
 *
 * - **Historial**: `state/chat.ts` (señal + `state.chat` persistido en el
 *   estado, 80 mensajes, mismo formato que la v1).
 * - **Markdown**: propio y mínimo (`parseMd`/`mdInline` de `state/chat.ts`)
 *   convertido a nodos de Preact: nunca `innerHTML`, así que el texto del
 *   modelo queda escapado solo.
 * - **JSON de `suggest`/`plan`**: no se pinta en crudo; se guarda como `payload`
 *   del mensaje y se resume en una tarjeta con su botón de «Aplicar».
 * - El textarea de entrada usa `onInput` (no `change`): el borrador es estado
 *   local y Enter tiene que ver el valor ACTUAL; los campos que se PERSISTEN al
 *   confirmar —el de la memoria— también, para que el contador de caracteres
 *   sea vivo.
 */
import { Fragment } from 'preact';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { go } from '@/app/router';
import { nowTs } from '@/domain/dates';
import { int } from '@/domain/num';
import { GeminiError } from '@/features/coach/client';
import { MEMORY_LIMIT, defaultMemory } from '@/features/coach/memory';
import { parseJSON } from '@/features/coach/parse';
import type { CoachTask } from '@/features/coach/types';
import { applySuggestionAsRoutine, applyWeek, hasApiKey, runCoachTask } from '@/state/coach';
import type { CoachOutcome } from '@/state/coach';
import {
  addChat,
  chat,
  clearChat,
  markApplied,
  parseMd,
  promptHistory,
  reloadChat,
} from '@/state/chat';
import type { ChatLine, MdSpan } from '@/state/chat';
import { patchSettings, settings } from '@/state/store';
import { Icon } from '@/ui/Icon';

import '../styles/coach.css';

/* ---------- helpers ---------- */

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Pie de un mensaje de éxito: modelo · ms · tokens · memoria (el `aiFooter` de la v1). */
function footerOf(out: CoachOutcome, model: string): string {
  const bits = [`Coach IA · ${model}`, `${(out.ms / 1000).toFixed(1)} s`];
  if (out.usage) bits.push(`${out.usage.total} tokens`);
  if (out.memoryAdded.length) bits.push(`memoria +${out.memoryAdded.length}`);
  if (out.finish === 'MAX_TOKENS') bits.push('respuesta cortada por maxTokens');
  return bits.join(' · ');
}

/** JSON de `suggest`/`plan` ya parseado; `null` si no parece una propuesta. */
function payloadOf(text: string): Record<string, unknown> | null {
  let raw: unknown;
  try {
    raw = parseJSON<unknown>(text);
  } catch {
    return null;
  }
  if (!isPlain(raw)) return null;
  const list = raw.exercises ?? raw.items ?? raw.days;
  return Array.isArray(list) ? raw : null;
}

/** `rationale` de una propuesta: string o lista de frases (los dos formatos del modelo). */
function rationaleOf(payload: Record<string, unknown>): string {
  const raw = payload.rationale;
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw)) {
    return raw
      .filter((line): line is string => typeof line === 'string' && line.trim() !== '')
      .join('\n');
  }
  return '';
}

/** Mensaje del modelo a partir del resultado de `runCoachTask`. */
function resultLine(task: CoachTask, out: CoachOutcome, model: string): ChatLine {
  const notes = footerOf(out, model);
  const line: ChatLine = {
    role: 'model',
    text: out.text || '(respuesta vacía)',
    ts: nowTs(),
    notes,
  };
  if (out.thoughts) line.thoughts = out.thoughts;
  if (out.consulted.length) line.consulted = out.consulted;

  if (task === 'suggest' || task === 'plan') {
    const payload = payloadOf(out.text);
    if (!payload) {
      line.notes = `${notes} · no pude interpretar el JSON`;
      return line;
    }
    line.payload = payload;
    line.text =
      rationaleOf(payload) ||
      (task === 'plan' ? 'Plan semanal listo.' : 'Propuesta de entreno lista.');
  }
  return line;
}

/** Mensaje amable para cualquier fallo (los `GeminiError` van por `kind`). */
function errorLine(err: unknown): ChatLine {
  const line: ChatLine = { role: 'sys', text: errorText(err), ts: nowTs() };
  if (err instanceof GeminiError && err.kind === 'auth') {
    line.action = { label: 'Configurar API key', tab: 'ajustes', sub: 'coach' };
  }
  return line;
}

function errorText(err: unknown): string {
  if (!(err instanceof GeminiError)) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
  switch (err.kind) {
    case 'auth':
      return `No pude autenticar con Gemini: ${err.message}`;
    case 'quota':
      return `Cuota agotada o límite de peticiones alcanzado: ${err.message}`;
    case 'blocked':
      return `La API bloqueó la respuesta: ${err.message}`;
    case 'network':
      return `No hay conexión con Gemini: ${err.message}`;
    case 'empty':
      return `Gemini devolvió una respuesta vacía: ${err.message}`;
    case 'parse':
      return `No entendi la respuesta de Gemini: ${err.message}`;
    default:
      return `Error de Gemini${err.status ? ` (HTTP ${err.status})` : ''}: ${err.message}`;
  }
}

/* ---------- markdown → nodos ---------- */

/** Un trozo con formato (o texto plano) ya convertido en nodo de Preact. */
function Spans({ spans }: { spans: MdSpan[] }) {
  return (
    <>
      {spans.map((span, i) => {
        if (span.kind === 'b') return <b key={i}>{span.text}</b>;
        if (span.kind === 'i') return <i key={i}>{span.text}</i>;
        if (span.kind === 'code') return <code key={i}>{span.text}</code>;
        return <Fragment key={i}>{span.text}</Fragment>;
      })}
    </>
  );
}

/** El markdown del chat, como nodos (sin HTML crudo por medio). */
function renderMd(text: string): ComponentChildren[] {
  return parseMd(text).map((block, i) => {
    if (block.kind === 'code') {
      return (
        <pre key={i}>
          <code>{block.text}</code>
        </pre>
      );
    }
    if (block.kind === 'h') {
      return (
        <h3 key={i}>
          <Spans spans={block.spans} />
        </h3>
      );
    }
    if (block.kind === 'ul' || block.kind === 'ol') {
      const items = block.items.map((item, j) => (
        <li key={j}>
          <Spans spans={item} />
        </li>
      ));
      return block.kind === 'ul' ? <ul key={i}>{items}</ul> : <ol key={i}>{items}</ol>;
    }
    /* `p` y `h` comparten forma, así que se pregunta por el `kind` concreto:
       con `p | h` en un solo miembro TS no estrecha lo suficiente. */
    if (block.kind === 'p') {
      return (
        <p key={i}>
          <Spans spans={block.spans} />
        </p>
      );
    }
    return null;
  });
}

/* ---------- tarjeta de la propuesta ---------- */

/** Qué botón lleva la tarjeta y qué se le pasa a `apply…`. */
type ApplyKind = 'routine' | 'plan';

/** Una línea de la tarjeta: día del plan (título · tipo) o ejercicio (nombre · prescripción). */
function cardLine(item: unknown, isPlan: boolean): ComponentChildren {
  if (!isPlain(item)) return null;
  const title = asText(item.title) || asText(item.name) || asText(item.exercise);
  if (isPlan) {
    const type = asText(item.type);
    return (
      <>
        <span>{title || 'Día'}</span>
        {type ? <span class="tiny muted">{type}</span> : null}
      </>
    );
  }
  const sets = int(item.sets, 0);
  const repMin = int(item.repMin, 0);
  const repMax = int(item.repMax, 0);
  const weight = item.weight === null || item.weight === undefined ? 0 : int(item.weight, 0);
  const bits = [
    sets && repMin ? `${sets}×${repMin}-${repMax || repMin}` : '',
    weight ? `${weight}` : '',
  ].filter(Boolean);
  return (
    <>
      <span>{title || 'Ejercicio'}</span>
      {bits.length ? <span class="tiny muted">{bits.join(' · ')}</span> : null}
    </>
  );
}

/** Resumen del JSON de `suggest`/`plan` con su botón de «Aplicar». */
function PayloadCard({
  payload,
  index,
  onApply,
}: {
  payload: unknown;
  index: number;
  onApply: (index: number, kind: ApplyKind) => void;
}) {
  if (!isPlain(payload)) return null;
  const days = Array.isArray(payload.days) ? payload.days.filter(isPlain) : [];
  const exercises = Array.isArray(payload.exercises)
    ? payload.exercises
    : Array.isArray(payload.items)
      ? payload.items
      : [];
  if (!days.length && !exercises.length) return null;

  const isPlan = days.length > 0;
  const title = asText(payload.title) || (isPlan ? 'Plan semanal' : 'Propuesta de entreno');
  const focus = asText(payload.focus);
  const done = payload.done === true;
  const list = isPlan ? days : exercises;

  return (
    <div class="coach-card">
      <div class="row between">
        <b class="grow ellipsis">{title}</b>
        <span class="badge a">
          {isPlan ? `${days.length} días` : `${exercises.length} ejercicios`}
        </span>
      </div>
      {focus ? <div class="tiny muted mt-s">{focus}</div> : null}
      <ul class="coach-list">
        {list.slice(0, 8).map((item, i) => (
          <li key={i}>{cardLine(item, isPlan)}</li>
        ))}
      </ul>
      {!isPlan && exercises.length > 8 ? (
        <div class="tiny muted">+{exercises.length - 8} ejercicios más</div>
      ) : null}
      <button
        type="button"
        class="btn sm primary mt-s"
        disabled={done}
        onClick={() => onApply(index, isPlan ? 'plan' : 'routine')}
      >
        <Icon name={isPlan ? 'calendar' : 'plus'} />
        {done ? 'Aplicada' : isPlan ? 'Aplicar plan' : 'Aplicar como rutina'}
      </button>
    </div>
  );
}

/* ---------- burbuja ---------- */

function Bubble({
  line,
  index,
  onApply,
}: {
  line: ChatLine;
  index: number;
  onApply: (index: number, kind: ApplyKind) => void;
}) {
  if (line.role === 'user') return <div class="msg me">{line.text}</div>;

  if (line.role === 'sys') {
    const action = line.action;
    return (
      <div class="msg sys">
        <div>{line.text}</div>
        {action ? (
          <button
            type="button"
            class="btn sm ghost"
            onClick={() => go(action.tab, action.sub ?? null)}
          >
            <Icon name="gear" />
            {action.label}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <>
      {line.thoughts ? (
        <details class="thinking">
          <summary>
            <Icon name="cpu" />
            Razonamiento del modelo
          </summary>
          <div class="think-body">{line.thoughts}</div>
        </details>
      ) : null}
      <div class="msg ai">{renderMd(line.text)}</div>
      <PayloadCard payload={line.payload} index={index} onApply={onApply} />
      {line.consulted && line.consulted.length ? (
        <div class="coach-meta tiny muted">consultó: {line.consulted.join(' · ')}</div>
      ) : null}
      {line.notes ? <div class="coach-meta tiny muted">{line.notes}</div> : null}
    </>
  );
}

/* ---------- tarjeta de estado ---------- */

function StatusCard() {
  const ai = settings.value.ai;
  const hasKey = hasApiKey();

  if (!hasKey) {
    return (
      <section class="card accent">
        <div class="row">
          <span class="ico" style="color:var(--accent)">
            <Icon name="key" />
          </span>
          <div class="grow">
            <div class="h3">Conecta tu coach</div>
            <div class="tiny muted">
              Pega tu API key de Google AI Studio y elige modelo y nivel de pensamiento. Se guarda
              solo en este dispositivo.
            </div>
          </div>
        </div>
        <div class="row mt-s" style="gap:8px;flex-wrap:wrap">
          <button type="button" class="btn primary" onClick={() => go('ajustes', 'coach')}>
            <Icon name="gear" />
            Configurar
          </button>
          <a
            class="btn ghost"
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener"
          >
            Obtener API key
          </a>
        </div>
      </section>
    );
  }

  const level = String(ai.thinkingLevel ?? 'auto');
  const budget = String(ai.thinkingBudget ?? '').trim();
  const thinking = level === 'auto' ? (budget ? `budget ${budget}` : 'auto') : level;

  return (
    <section class="card tight">
      <div class="between">
        <div class="row" style="gap:8px;min-width:0">
          <span class="ico ok">
            <Icon name="robot" />
          </span>
          <div style="min-width:0">
            <div class="h3 ellipsis">{String(ai.model ?? '')}</div>
            <div class="tiny muted ellipsis">pensamiento {thinking}</div>
          </div>
        </div>
        <span class="badge ok">listo</span>
      </div>
    </section>
  );
}

/* ---------- memoria editable ---------- */

/**
 * «Memoria del coach»: `settings.ai.memory` en un textarea con Guardar y
 * Restablecer plantilla. El coach ya escribe aquí solo (bloque ```memoria``` de
 * cada respuesta), así que el textarea se refresca cuando la señal cambia.
 */
function MemoryPanel() {
  const memory = settings.value.ai.memory ?? '';
  const [draft, setDraft] = useState(memory);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(memory);
  }, [memory]);

  const over = draft.length > MEMORY_LIMIT;
  const dirty = draft !== memory;

  const persist = (next: string): void => {
    patchSettings({ ai: { ...settings.value.ai, memory: next } });
    setDraft(next);
    setSaved(true);
  };

  return (
    <details class="coach-memory mt-s">
      <summary>
        <span class="row" style="gap:7px">
          <Icon name="cpu" />
          <span class="h3">Memoria del coach</span>
        </span>
        <span class="tiny muted">{memory.length} car.</span>
      </summary>
      <div class="mt-s">
        <textarea
          class="input"
          rows={8}
          value={draft}
          aria-label="Memoria del coach"
          onInput={(e) => {
            setDraft(e.currentTarget.value);
            setSaved(false);
          }}
        />
        <div class="between mt-s">
          <span class={`tiny ${over ? 'warn' : 'muted'}`}>
            {draft.length} / {MEMORY_LIMIT} caracteres
          </span>
          <span class="tiny ok">{saved ? 'Guardada' : ''}</span>
        </div>
        <div class="row mt-s" style="gap:8px;flex-wrap:wrap">
          <button
            type="button"
            class="btn sm primary"
            disabled={!dirty || over}
            onClick={() => persist(draft.slice(0, MEMORY_LIMIT))}
          >
            <Icon name="check" />
            Guardar
          </button>
          <button type="button" class="btn sm ghost" onClick={() => persist(defaultMemory())}>
            <Icon name="refresh" />
            Restablecer plantilla
          </button>
        </div>
        <div class="tiny muted mt-s">
          El coach añade aquí lo que aprende de ti en cada respuesta (se ve al instante). Límite de{' '}
          {MEMORY_LIMIT} caracteres: si se pasa, se recortan las entradas de patrones más antiguas.
        </div>
      </div>
    </details>
  );
}

/* ---------- acciones rápidas ---------- */

interface QuickAction {
  task: CoachTask;
  label: string;
  icon: string;
  /** lo que se apila en el chat como pregunta del usuario (paridad con la v1) */
  ask: string;
}

const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    task: 'suggest',
    label: 'Sugerir entreno',
    icon: 'dumbbell',
    ask: 'Genera el entreno de hoy para mí.',
  },
  {
    task: 'plan',
    label: 'Plan semanal',
    icon: 'calendar',
    ask: 'Planifica mi semana de entrenamiento.',
  },
  {
    task: 'analyze',
    label: 'Analizar progreso',
    icon: 'chart',
    ask: 'Analiza mi progreso de las últimas 6 semanas.',
  },
];

/* ---------- la vista ---------- */

export function CoachView() {
  const msgs = chat.value;
  const hasKey = hasApiKey();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  /* El historial puede cambiar FUERA de esta vista (import de datos, «Borrar
     todo»): al montar se vuelve a leer de `state.chat`. */
  useEffect(() => {
    reloadChat();
  }, []);

  /* Scroll automático al final cuando entran mensajes o cambia el «pensando…». */
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, busy]);

  /* «Limpiar» pide confirmación en el propio botón (no hay modal en la v2). */
  useEffect(() => {
    if (!confirmClear) return;
    const id = setTimeout(() => setConfirmClear(false), 4000);
    return () => clearTimeout(id);
  }, [confirmClear]);

  async function run(task: CoachTask, userText: string): Promise<void> {
    const text = userText.trim();
    if (busy || !text) return;
    if (!hasKey) {
      addChat({
        role: 'sys',
        text: 'El coach está sin API key: añade la de Google AI Studio en Ajustes para que pueda responder.',
        action: { label: 'Configurar API key', tab: 'ajustes', sub: 'coach' },
        ts: nowTs(),
      });
      return;
    }

    /* El historial se calcula ANTES de apilar la pregunta: `buildRequest` añade
       el turno actual por su cuenta y con él dentro saldría duplicado. */
    const history = task === 'chat' ? promptHistory() : [];
    setBusy(true);
    addChat({ role: 'user', text, ts: nowTs() });
    try {
      const out = await runCoachTask(task, task === 'chat' ? { history } : {});
      addChat(resultLine(task, out, String(settings.value.ai.model ?? '')));
    } catch (err) {
      addChat(errorLine(err));
    } finally {
      setBusy(false);
    }
  }

  function send(): void {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    void run('chat', text);
  }

  /** Aplica la tarjeta de una propuesta/plan y avisa en el chat del resultado. */
  function apply(index: number, kind: ApplyKind): void {
    const line = chat.value[index];
    if (!line) return;

    if (kind === 'routine') {
      const routine = applySuggestionAsRoutine(line.payload);
      if (!routine) {
        addChat({
          role: 'sys',
          text: 'No pude convertir la propuesta en rutina: no traía ejercicios reconocidos.',
          ts: nowTs(),
        });
        return;
      }
      markApplied(index);
      addChat({ role: 'sys', text: `Rutina creada: ${routine.name}`, ts: nowTs() });
      return;
    }

    const out = applyWeek(line.payload);
    if (!out.days) {
      addChat({
        role: 'sys',
        text: 'El plan no traía días con fecha válida: no se escribió nada en el calendario.',
        ts: nowTs(),
      });
      return;
    }
    markApplied(index);
    addChat({
      role: 'sys',
      text: `Plan aplicado: ${out.days} días${out.routines ? ` · ${out.routines} rutinas creadas` : ''}`,
      ts: nowTs(),
    });
  }

  return (
    <section class="coach-view">
      <StatusCard />

      <div class="hr-scroll mt-s">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.task}
            type="button"
            class="chip"
            disabled={busy}
            onClick={() => {
              void run(action.task, action.ask);
            }}
          >
            <Icon name={action.icon} />
            {action.label}
          </button>
        ))}
      </div>

      <MemoryPanel />

      <div class="between mt">
        <span class="label">Conversación</span>
        {msgs.length ? (
          <button
            type="button"
            class="btn quiet sm"
            onClick={() => {
              if (confirmClear) {
                clearChat();
                setConfirmClear(false);
              } else {
                setConfirmClear(true);
              }
            }}
          >
            <Icon name="trash" />
            {confirmClear ? '¿Seguro?' : 'Limpiar'}
          </button>
        ) : null}
      </div>

      <div class="chat" ref={scroller}>
        {msgs.length ? (
          msgs.map((line, i) => (
            <Bubble key={`${line.ts ?? ''}-${i}`} line={line} index={i} onApply={apply} />
          ))
        ) : (
          <div class="empty">
            <Icon name="sparkles" />
            <div>Habla con tu coach</div>
            <div class="tiny">
              Pregunta por técnica, volumen o pídele un plan concreto: ya conoce tu material, tus
              rutinas y tu historial.
            </div>
          </div>
        )}
        {busy ? (
          <div class="msg ai">
            <span class="coach-typing">
              <span class="typing">
                <i />
                <i />
                <i />
              </span>
              <span class="tiny muted">Pensando…</span>
            </span>
          </div>
        ) : null}
      </div>

      <div class="composer">
        <div class="composer-inner">
          <textarea
            rows={1}
            value={draft}
            disabled={!hasKey || busy}
            aria-label="Mensaje"
            placeholder={hasKey ? 'Escribe tu pregunta…' : 'Configura la API key para chatear'}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button
            type="button"
            class="btn primary icon"
            disabled={busy || !hasKey || !draft.trim()}
            title="Enviar"
            onClick={send}
          >
            <Icon name="chev-r" />
          </button>
        </div>
      </div>
    </section>
  );
}
