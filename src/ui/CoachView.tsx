/**
 * Vista Coach: chat con Gemini, acciones rápidas y memoria editable.
 *
 * Port de  (paridad: tarjeta de estado, acciones
 * rápidas, burbujas con razonamiento, composer pegajoso y «Limpiar») sobre la
 * capa `state/coach.ts`, que es la que habla con `features/coach`.
 *
 * Decisiones que conviene no olvidar:
 *
 * - **Historial**: `state/chat.ts` (señal + `state.chat` persistido en el
 *   estado, 80 mensajes, mismo formato que antes).
 * - **Markdown**: propio y mínimo (`parseMd`/`mdInline` de `state/chat.ts`)
 *   convertido a nodos de Preact: nunca `innerHTML`, así que el texto del
 *   modelo queda escapado solo.
 * - **JSON de `suggest`/`plan`**: no se pinta en crudo; se guarda como `payload`
 *   del mensaje y se resume en una tarjeta con su botón de «Aplicar».
 * - **Tarjeta de estado**: «Probar» hace el ping real con `testConnection` (el
 *   `coach:test` ) y deja ms/ok en la propia tarjeta. Son los mismos 6
 *   chips rápidos de `views-coach.js:30`: los tres que faltaban van a un `chat`
 *   con el prompt literal.
 * - **Chips + caja**: al pulsar un chip, si la caja tiene texto escrito viaja
 *   como contexto detrás del `ask` (`chipText`) y la caja se vacía; con la caja
 *   vacía el chip manda su `ask` literal, igual que siempre. La caja libre
 *   sigue siendo chat a pelo: NO hay heurísticas de intención (el usuario las
 *   rechazó), solo esta unión explícita en los chips.
 * - **Historial en TODAS las tareas** (`promptHistory()` → `turnOpts`): viaja
 *   como `contents` de Gemini (12 turnos en chat, 6 en el resto), así los
 *   récords que el usuario pegó en turnos anteriores siguen disponibles al
 *   pedir un entreno con el chip (P1).
 * - **Fallback local visible** (`origin`/`fallback` del `CoachOutcome`): una
 *   propuesta local se firma «Generado en tu dispositivo»
 *   y lleva el motivo arriba en el texto; nunca «Coach IA».
 * - El textarea de entrada usa `onInput` (no `change`): el borrador es estado
 *   local y Enter tiene que ver el valor ACTUAL; los campos que se PERSISTEN al
 *   confirmar —el de la memoria— también, para que el contador de caracteres
 *   sea vivo.
 */
import { Fragment } from 'preact';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { go } from '@/app/router';
import { proposalToDraft } from '@/domain/ai-exercise';
import type { AIExerciseProposal, ProposalDraftResult } from '@/domain/ai-exercise';
import { label as dateLabel, nowTs } from '@/domain/dates';
import { equipLabel, groupLabel } from '@/domain/data';
import { fmtN } from '@/domain/format';
import { unresolvedNames } from '@/domain/match';
import { int, round } from '@/domain/num';
import { supersetGroups } from '@/domain/supersets';
import { norm } from '@/domain/text';
import type { PlanItem } from '@/domain/types';
import { fromKg, toKg } from '@/domain/units';
import { GeminiError, testConnection } from '@/features/coach/client';
import type { ChatMsg } from '@/features/coach/client';
import { useCoachWait, WaitMeta } from './coach-wait';
import { MEMORY_LIMIT, defaultMemory } from '@/features/coach/memory';
import { creationsFromPayload, parseJSON } from '@/features/coach/parse';
import type { CoachTask } from '@/features/coach/types';
import {
  applyImportedSessions,
  applySuggestionAsRoutine,
  applyWeek,
  hasApiKey,
  partitionUnresolved,
  resolveCoachItems,
  runCoachTask,
} from '@/state/coach';
import type { CoachOutcome, CoachTaskOpts } from '@/state/coach';
import {
  addChat,
  appendCreations,
  chat,
  clearChat,
  markApplied,
  markCreation,
  markSaved,
  markStarted,
  parseMd,
  promptHistory,
  reloadChat,
} from '@/state/chat';
import type { ChatLine, CreationState, MdSpan } from '@/state/chat';
import { createExerciseFromAI, requestEdit } from '@/state/exercise-create';
import { active, equipment, exercises, patchSettings, settings } from '@/state/store';
import { startFromPlan } from '@/state/session';
import { HelpBtn } from '@/ui/HelpModal';
import { Icon } from '@/ui/Icon';
import { Modal } from '@/ui/Modal';
import { toast } from '@/ui/toast';

import '../styles/coach.css';

/* ---------- helpers ---------- */

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Pie de un mensaje de éxito: modelo · ms · tokens · memoria (el `aiFooter` ). */
function footerOf(out: CoachOutcome, model: string): string {
  const bits = [`Coach IA · ${model}`, `${(out.ms / 1000).toFixed(1)} s`];
  if (out.usage) bits.push(`${out.usage.total} tokens`);
  if (out.memoryAdded.length) bits.push(`memoria +${out.memoryAdded.length}`);
  if (out.finish === 'MAX_TOKENS') bits.push('respuesta cortada por maxTokens');
  return bits.join(' · ');
}

/**
 * Pie de una respuesta que NO salió de la IA (`origin === 'local'`): NUNCA pone
 * «Coach IA» ni tokens, y si hubo un fallo de la API lo dice con su mensaje —
 * antes el plan local se firmaba como una llamada a `gemini-3.8-flash` (P2 del
 * diagnóstico), y era imposible distinguirlo de una respuesta buena.
 */
function localFooter(out: CoachOutcome, task: CoachTask): string {
  const etiqueta = task === 'suggest' || task === 'plan' ? 'Generado en tu dispositivo' : 'Sin IA';
  const motivo = out.fallback ? `IA no disponible: ${out.fallback.message}` : 'sin API key';
  return [etiqueta, motivo, `${(out.ms / 1000).toFixed(1)} s`].join(' · ');
}

/**
 * Aviso que se pone ARRIBA del texto de una propuesta local, para que no se lea
 * como respuesta del coach: el motivo real (clave o fallo de la API) va el
 * primero, y después queda claro de quién es el plan.
 */
function localAviso(out: CoachOutcome): string {
  const motivo = out.fallback
    ? `no pude usar la IA (${out.fallback.message})`
    : 'no hay API key configurada';
  return `**Generado en tu dispositivo:** ${motivo}; esta propuesta viene del planificador local, no de la IA.`;
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

function suggestionEntries(value: unknown): unknown[] {
  if (!isPlain(value)) return [];
  const list = Array.isArray(value.exercises) ? value.exercises : value.items;
  return Array.isArray(list) ? list : [];
}

function isSuggestionCard(payload: Record<string, unknown>, task?: CoachTask): boolean {
  const hasPlan = Array.isArray(payload.days) || Array.isArray(payload.sessions);
  const update = payload.action === 'update';
  return (
    !hasPlan &&
    !update &&
    (task === 'suggest' ||
      (!payload.action && (payload.focus !== undefined || payload.rationale !== undefined)))
  );
}

function decimalNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Convierte pesos fijados en la propuesta a la unidad actual antes de iniciar/guardar. */
export function payloadInCurrentUnit(
  value: unknown,
  sourceUnit: 'kg' | 'lb' | undefined,
  targetUnit: 'kg' | 'lb' = settings.value.units,
): unknown {
  if (!isPlain(value) || !sourceUnit || sourceUnit === targetUnit) return value;
  const convert = (list: unknown): unknown => {
    if (!Array.isArray(list)) return list;
    const entries: unknown[] = list;
    return entries.map((entry) => {
      if (!isPlain(entry)) return entry;
      const weight = decimalNumber(entry.weight);
      if (weight === null) return entry;
      return {
        ...entry,
        weight: round(fromKg(toKg(weight, sourceUnit), targetUnit), 2),
      };
    });
  };
  return {
    ...value,
    ...(Array.isArray(value.exercises) ? { exercises: convert(value.exercises) } : {}),
    ...(Array.isArray(value.items) ? { items: convert(value.items) } : {}),
  };
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

/**
 * Mensaje del modelo a partir del resultado de `runCoachTask`.
 *
 * Adjunta las propuestas de ejercicio NUEVO: en `chat` las que venían en el
 * bloque ```crear``` (`out.creations`) y en `suggest`/`plan` las que el payload
 * marca con `isNew: true` inline. En ningún caso se crea nada aquí: la tarjeta
 * espera su clic.
 *
 * Si `out.origin` es `'local'` (plan del dispositivo, sin key o tras un fallo
 * de la API) el pie cambia y el texto lleva un aviso encima: la propuesta
 * sigue siendo aplicable igual, pero ya no se vende como respuesta de la IA.
 */
export function resultLine(
  task: CoachTask,
  out: CoachOutcome,
  model: string,
  unit?: 'kg' | 'lb',
  timestamp = nowTs(),
): ChatLine {
  const local = out.origin === 'local';
  const notes = local ? localFooter(out, task) : footerOf(out, model);
  const line: ChatLine = {
    role: 'model',
    text: out.text || '(respuesta vacía)',
    ts: timestamp,
    notes,
    task,
  };
  if (unit) line.unit = unit;
  if (out.thoughts) line.thoughts = out.thoughts;
  if (out.consulted.length) line.consulted = out.consulted;
  if (out.creations.length) line.creations = out.creations.map((item) => ({ ...item }));

  if (task === 'chat' && (out.routinePayload || out.sessionsPayload)) {
    const chatPayload = out.routinePayload ?? out.sessionsPayload;
    line.payload = chatPayload;
    const fromRoutine = creationsFromPayload(chatPayload);
    if (fromRoutine.length) {
      const existing = new Set((line.creations ?? []).map((c) => norm(c.name)));
      const extra = fromRoutine.filter((c) => !existing.has(norm(c.name)));
      if (extra.length) line.creations = [...(line.creations ?? []), ...extra];
    }
  }

  if (task === 'suggest' || task === 'plan') {
    const payload = payloadOf(out.text);
    if (!payload) {
      line.notes = `${notes} · no pude interpretar el JSON`;
      return line;
    }
    line.payload = payload;
    const nuevas = creationsFromPayload(payload);
    if (nuevas.length) line.creations = nuevas.map((item) => ({ ...item }));
    const cuerpo =
      rationaleOf(payload) ||
      (task === 'plan' ? 'Plan semanal listo.' : 'Propuesta de entreno lista.');
    /* el aviso del fallback va ARRIBA y sobrevive al reescritura del rationale:
       era lo que se perdía, y por eso un plan local se leía como respuesta del
       coach («aún no hay historial suficiente») */
    line.text = local ? `${localAviso(out)}\n\n${cuerpo}` : cuerpo;
  }
  return line;
}

/* ---------- tarjeta de ejercicio nuevo ---------- */

/** Lo que se le puede pedir a la tarjeta de un ejercicio nuevo. */
export type CreationAction = 'create' | 'edit' | 'discard';

/** Un botón de esa tarjeta, ya con su estado habilitado/deshabilitado. */
export interface CreationButton {
  key: CreationAction;
  label: string;
  enabled: boolean;
}

/**
 * Botones de la tarjeta: activos SOLO mientras la propuesta está pendiente
 * (mismo criterio que el `done` de `PayloadCard`). La creación es siempre un
 * clic del usuario, nunca automática.
 */
export function creationButtons(status?: CreationState['status']): CreationButton[] {
  const enabled = status === undefined;
  return [
    { key: 'create', label: 'Crear', enabled },
    { key: 'edit', label: 'Crear y editar', enabled },
    { key: 'discard', label: 'Descartar', enabled },
  ];
}

/**
 * Línea de atributos de la tarjeta, con lo que `proposalToDraft` YA dedujo del
 * nombre y del candidato: grupo, material, unilateral, tipo y prescripción.
 */
export function creationSummary(proposal: AIExerciseProposal, draft: ProposalDraftResult): string {
  const value = draft.ok ? draft.draft : null;
  const unilateral = draft.ok ? draft.info.unilateral : proposal.unilateral === true;
  const bits = [
    value ? groupLabel(value.group) : '',
    value ? (value.equip ? equipLabel(value.equip) : 'peso corporal') : '',
    unilateral ? 'unilateral' : '',
    value?.type ?? '',
    value ? `${value.sets}×${value.repMin}-${value.repMax}` : '',
    value ? `${value.rest} s` : '',
  ];
  return bits.filter(Boolean).join(' · ');
}

/** Nombres entrecomillados, con el mismo formato que `unresolvedNames`. */
function quoted(list: readonly { name: string }[]): string {
  return list.map((item) => `«${item.name}»`).join(', ');
}

function unresolvedDetails(list: readonly { name: string; reason: string }[]): string {
  return list.map((item) => `«${item.name}»: ${item.reason}`).join('; ');
}

/**
 * Tarjeta de confirmación de un ejercicio NUEVO: lo que el modelo propuso, con
 * sus atributos ya inferidos y los tres botones (Crear / Crear y editar /
 * Descartar). Las descartadas no se pintan; las creadas quedan como constancia.
 *
 * Si el borrador no valida (p. ej. material que el usuario no tiene) se enseña
 * el motivo y SOLO queda «Descartar»: se avisa, nunca se crea algo que no puede
 * hacerse.
 */
function CreationCard({
  line,
  index,
  onAction,
}: {
  line: ChatLine;
  index: number;
  onAction: (index: number, creation: number, action: CreationAction) => void;
}) {
  const creations = line.creations ?? [];
  const shown = creations
    .map((creation, i) => ({ creation, i }))
    .filter(({ creation }) => creation.status !== 'discarded');
  if (!shown.length) return null;

  return (
    <div class="coach-card coach-create">
      <div class="row between">
        <b class="grow">Ejercicio nuevo propuesto</b>
        <span class="badge a">{shown.length}</span>
      </div>
      {shown.map(({ creation, i }) => {
        const draft = proposalToDraft(creation, exercises.value, equipment.value);
        const pending = creation.status === undefined;
        const buttons = creationButtons(creation.status).filter(
          (button) => button.key === 'discard' || (pending && draft.ok),
        );
        return (
          <div class="coach-create-item" key={`${i}-${creation.name}`}>
            <b>{creation.name}</b>
            <div class="tiny muted">{creationSummary(creation, draft)}</div>
            {creation.desc ? <div class="tiny">{creation.desc}</div> : null}
            {draft.ok ? null : <div class="tiny warn">{draft.error}</div>}
            {draft.ok && draft.info.notes.length ? (
              <div class="tiny muted">{draft.info.notes.join(' · ')}</div>
            ) : null}
            {creation.status === 'created' ? (
              <div class="tiny ok">Creado · ya está en tu biblioteca</div>
            ) : null}
            {buttons.length ? (
              <div class="row mt-s" style="gap:8px;flex-wrap:wrap">
                {buttons.map((button) => (
                  <button
                    key={button.key}
                    type="button"
                    class={`btn sm ${button.key === 'discard' ? 'ghost' : 'primary'}`}
                    onClick={() => onAction(index, i, button.key)}
                  >
                    <Icon name={button.key === 'discard' ? 'x' : 'plus'} />
                    {button.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
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
        if (span.kind === 'a') {
          /* Enlace automático: antes lo abría con `target="_blank"
             rel="noopener"`; el href es texto plano, nunca HTML del modelo. */
          return (
            <a key={i} href={span.href} target="_blank" rel="noopener">
              {span.text}
            </a>
          );
        }
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
    if (block.kind === 'table') {
      /* Las clases las pone el CSS  (`.msg table`, heredado en base.css):
         cabecera con `th` y filas con `td`, igual que el `<table>` de `U.md`. */
      return (
        <table key={i}>
          <thead>
            <tr>
              {block.head.map((cell, j) => (
                <th key={j}>
                  <Spans spans={cell} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, j) => (
                  <td key={j}>
                    <Spans spans={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
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
type ApplyKind = 'start' | 'routine' | 'plan' | 'sessions';

/** Una línea de la tarjeta: día del plan (título · tipo) o ejercicio (nombre · prescripción). */
function cardLine(item: unknown, isPlan: boolean, unit?: 'kg' | 'lb'): ComponentChildren {
  if (!isPlain(item)) return null;
  const title = asText(item.title) || asText(item.name) || asText(item.exercise);
  if (isPlan) {
    const type = asText(item.type);
    /* la fecha es lo que deja comprobar a qué día va cada entreno antes de
       aplicar: sin ella la tarjeta era una lista de títulos sueltos */
    const iso = (asText(item.date) || asText(item.iso)).slice(0, 10);
    const day = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? dateLabel(iso, 'short') : '';
    return (
      <>
        {day ? <span class="tiny muted num">{day}</span> : null}
        <span>{title || 'Día'}</span>
        {type ? <span class="tiny muted">{type}</span> : null}
      </>
    );
  }
  const sets = int(item.sets, 0);
  const repMin = int(item.repMin, 0);
  const repMax = int(item.repMax, 0);
  const weight = decimalNumber(item.weight);
  const bits = [
    sets && repMin ? `${sets}×${repMin}-${repMax || repMin}` : '',
    weight === null ? '' : `${fmtN(weight)}${unit ? ` ${unit}` : ''}`,
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
  task,
  unit,
  index,
  onApply,
}: {
  payload: unknown;
  task?: CoachTask;
  unit?: 'kg' | 'lb';
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
  const sessionsList = Array.isArray(payload.sessions) ? payload.sessions.filter(isPlain) : [];
  if (!days.length && !exercises.length && !sessionsList.length) return null;

  const isPlan = days.length > 0;
  const isSessions = sessionsList.length > 0;
  const isUpdate = asText(payload.action) === 'update';
  const isSuggestion = isSuggestionCard(payload, task);
  const title =
    asText(payload.title) ||
    (isPlan ? 'Plan semanal' : isSessions ? 'Entrenos anteriores' : 'Propuesta de entreno');
  const target = asText(payload.target) || title;
  const focus = asText(payload.focus);
  const done = payload.done === true;
  const saved = payload.saved === true || (isSuggestion && done);
  const started = payload.started === true;
  const list = isPlan ? days : isSessions ? sessionsList : exercises;
  /* los pares que propuso el coach se ven ANTES de aplicar: si no, la rutina se
     guardaba con superseries que el usuario nunca tuvo delante */
  const pairs =
    isPlan || isSessions ? [] : supersetGroups(exercises as { superset?: string | null }[]);
  const pairOf = (i: number): { letter: string; position: number; size: number } | null => {
    for (const group of pairs) {
      const at = group.indices.indexOf(i);
      if (at >= 0) return { letter: group.letter, position: at + 1, size: group.indices.length };
    }
    return null;
  };
  const sessionLine = (value: unknown): ComponentChildren => {
    if (!isPlain(value)) return null;
    const item = value;
    const iso = (asText(item.date) || asText(item.iso)).slice(0, 10);
    const day = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? dateLabel(iso, 'short') : '';
    const name = asText(item.name) || asText(item.title) || 'Sesión';
    const items = Array.isArray(item.exercises)
      ? item.exercises
      : Array.isArray(item.items)
        ? item.items
        : [];
    return (
      <>
        {day ? <span class="tiny muted num">{day} · </span> : null}
        <span>{name}</span>
        <span class="tiny muted">{items.length} ej.</span>
      </>
    );
  };

  return (
    <div class="coach-card">
      <div class="row between">
        <b class="grow ellipsis">{title}</b>
        <span class="badge a">
          {isPlan
            ? `${days.length} días`
            : isSessions
              ? `${sessionsList.length} ${sessionsList.length === 1 ? 'sesión' : 'sesiones'}`
              : `${exercises.length} ejercicios`}
        </span>
      </div>
      {focus ? <div class="tiny muted mt-s">{focus}</div> : null}
      <ul class="coach-list">
        {list.slice(0, 8).map((item, i) => {
          const pair = isPlan || isSessions ? null : pairOf(i);
          return (
            <li key={i}>
              {pair ? (
                <span class="ss-badge">
                  SS {pair.letter} · {pair.position}/{pair.size}
                </span>
              ) : null}
              {isSessions ? sessionLine(item) : cardLine(item, isPlan, unit)}
            </li>
          );
        })}
      </ul>
      {!isPlan && !isSessions && exercises.length > 8 ? (
        <div class="tiny muted">+{exercises.length - 8} ejercicios más</div>
      ) : null}
      {isSuggestion ? (
        <div class="row mt-s" style="gap:8px;flex-wrap:wrap">
          <button
            type="button"
            class="btn sm primary"
            disabled={started}
            onClick={() => onApply(index, 'start')}
          >
            <Icon name="dumbbell" />
            {started ? 'Entreno iniciado' : 'Empezar este entreno'}
          </button>
          <button
            type="button"
            class="btn sm ghost"
            disabled={saved}
            onClick={() => onApply(index, 'routine')}
          >
            <Icon name="plus" />
            {saved ? 'Rutina guardada' : 'Guardar como rutina'}
          </button>
        </div>
      ) : (
        <button
          type="button"
          class="btn sm primary mt-s"
          disabled={done}
          onClick={() => onApply(index, isPlan ? 'plan' : isSessions ? 'sessions' : 'routine')}
        >
          <Icon name={isPlan ? 'calendar' : 'check'} />
          {isSessions
          ? done
            ? 'Importadas'
            : 'Importar al historial'
          : done
            ? 'Aplicada'
            : isPlan
              ? 'Aplicar plan'
              : isUpdate
                ? `Actualizar «${target}»`
                : 'Aplicar como rutina'}
        </button>
      )}
    </div>
  );
}

/* ---------- burbuja ---------- */

function Bubble({
  line,
  index,
  onApply,
  onCreate,
}: {
  line: ChatLine;
  index: number;
  onApply: (index: number, kind: ApplyKind) => void;
  onCreate: (index: number, creation: number, action: CreationAction) => void;
}) {
  if (line.role === 'user') return <div class="msg me">{line.text}</div>;

  if (line.role === 'sys') {
    const action = line.action;
    const isError =
      /^(Error|No pude|No hay conexión|Cuota|La API bloqueó|Gemini devolvió|No entendí|No entendi)/u.test(
        line.text,
      );
    return (
      <div
        class="msg sys"
        role={isError ? 'alert' : undefined}
        aria-live={isError ? 'assertive' : undefined}
      >
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
      <PayloadCard payload={line.payload} task={line.task} unit={line.unit} index={index} onApply={onApply} />
      <CreationCard line={line} index={index} onAction={onCreate} />
      {line.consulted && line.consulted.length ? (
        <div class="coach-meta tiny muted">consultó: {line.consulted.join(' · ')}</div>
      ) : null}
      {line.notes ? (
        <div class="row coach-meta tiny muted" style="gap:6px">
          <span class="grow">{line.notes}</span>
          <HelpBtn id="coach.footer" title="Pie de cada respuesta" />
        </div>
      ) : null}
    </>
  );
}

/* ---------- tarjeta de estado ---------- */

/** Resultado del último «Probar» (el `coach:test` ), pintado en la tarjeta. */
export interface TestResult {
  ok: boolean;
  ms: number;
}

/** `0,8 s` — los milisegundos del test, con el mismo formato que los avisos. */
function secs(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Etiqueta del badge de la tarjeta de estado: `listo` antes del primer test y
 * `ok · 0,8 s` / `error · 2,1 s` después (el ms/ok que pi).
 */
export function testBadge(result: TestResult | null): string {
  if (!result) return 'listo';
  return `${result.ok ? 'ok' : 'error'} · ${secs(result.ms)}`;
}

function StatusCard() {
  const ai = settings.value.ai;
  const hasKey = hasApiKey();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  /** «Probar» (antes `coach:test`): un ping real y el ms/ok en la propia tarjeta. */
  async function runTest(): Promise<void> {
    if (testing) return;
    setTesting(true);
    const model = String(ai.model ?? '');
    const spin = toast(`Probando ${model}…`, { loading: true, sticky: true });
    let res;
    try {
      res = await testConnection(String(ai.apiKey ?? ''), model);
    } catch (err) {
      /* `testConnection` no debería lanzar, pero el aviso no puede perderse */
      res = { ok: false, ms: 0, detail: err instanceof Error ? err.message : String(err) };
    }
    spin.close();
    setTesting(false);
    setResult({ ok: res.ok, ms: res.ms });
    if (res.ok) {
      toast(`Conexión correcta · ${model} en ${secs(res.ms)}`, { kind: 'ok', ms: 4000 });
    } else {
      toast(`Error: ${res.detail}`, { kind: 'err', ms: 8000 });
    }
  }

  if (!hasKey) {
    return (
      <section class="card accent">
        <div class="row">
          <span class="ico" style="color:var(--accent-text)">
            <Icon name="key" />
          </span>
          <div class="grow">
            <div class="h3">Conecta tu coach</div>
            <div class="tiny muted">
              Pega tu API key de Google AI Studio y elige modelo y nivel de pensamiento. Se guarda
              solo en este dispositivo.
            </div>
          </div>
          <HelpBtn id="coach.apiKey" title="API key del coach" />
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
  const thinking = level === 'auto' ? 'auto' : level;

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
        <div class="row coach-test" style="gap:8px">
          <span
            class={`badge ${result && !result.ok ? 'danger' : 'ok'}`}
            role="status"
            aria-live={result && !result.ok ? 'assertive' : 'polite'}
          >
            {testBadge(result)}
          </span>
          <button
            type="button"
            class="btn sm ghost"
            disabled={testing}
            onClick={() => void runTest()}
          >
            <Icon name="zap" />
            {testing ? 'Probando…' : 'Probar'}
          </button>
        </div>
      </div>
      <div class="row wrap mt-s" style="gap:6px;align-items:center">
        <span class="tiny muted grow">Sabe de tu historial, tu plan y tu material.</span>
        <HelpBtn id="coach.what" title="Qué puede hacer el coach" />
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
        <span class="row" style="gap:6px">
          <span class="tiny muted">{memory.length} car.</span>
          <HelpBtn id="coach.memory" title="Memoria del coach" />
        </span>
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

export interface QuickAction {
  task: CoachTask;
  label: string;
  icon: string;
  /** lo que se apila en el chat como pregunta del usuario (paridad con antes) */
  ask: string;
  /**
   * pestaña a la que saltar cuando la tarea termina. antes solo lo hacía el
   * chip «Sesión de hoy» (`coach:quick` → `App.router.go('hoy')`): la
   * propuesta ya está lista y la pestaña Hoy tiene su tarjeta con «Empezar».
   */
  jump?: { tab: string; toast: string };
}

/**
 * Los 6 chips de `views-coach.js:30`, con sus mismos iconos y textos. Los tres
 * últimos antes los mandaba al chat con `send(prompts[kind])`, así que aquí son
 * una tarea `chat` con el MISMO `ask` (se apila como mensaje del usuario).
 */
export const QUICK_ACTIONS: readonly QuickAction[] = [
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
  {
    task: 'chat',
    label: 'Revisar volumen',
    icon: 'bars',
    ask: 'Revisa mi volumen semanal por grupo muscular y dime qué grupos están descompensados y cómo corregirlo.',
  },
  {
    task: 'chat',
    label: 'Romper un récord',
    icon: 'target',
    ask: 'Elige el ejercicio donde tengo más margen de mejora y dame un plan concreto de 4 semanas para subir mi récord.',
  },
  {
    task: 'chat',
    label: 'Consejo de recuperación',
    icon: 'rest',
    ask: '¿Qué ajustes de recuperación, sueño y alimentación me recomiendas según mi volumen actual de entrenamiento?',
  },
];

/**
 * Texto que manda un chip: el `ask` de siempre, y si la caja tenía algo
 * escrito, ese texto ABAJO marcado como contexto (dos saltos de línea + la
 * etiqueta). Con la caja vacía devuelve el `ask` SIN tocar, así que el chip se
 * comporta exactamente como antes.
 *
 * Es el string que se apila en el chat como mensaje del usuario (la burbuja
 * muestra lo que de verdad viaja) y el que `runCoachTask` recibe en `userText`.
 */
export function chipText(ask: string, draft: string): string {
  const context = draft.trim();
  return context ? `${ask}\n\nContexto adicional: ${context}` : ask;
}

/* ---------- la vista ---------- */

/**
 * Opciones de `runCoachTask` para UN turno de la vista.
 *
 * La pregunta viaja SIEMPRE en `userText`: en `chat` es el prompt entero (y el
 * prompt vacío hace que la API devuelva **HTTP 400 «Requests ending with a
 * model turn are not supported»**, porque el último turno de verdad sería el
 * del modelo); en el resto de tareas `buildRequest` la deja como cola del
 * prompt, en crudo, que es por donde los chips mandan el texto de la caja como
 * contexto. El historial viaja en las CUATRO tareas como `contents` de Gemini
 * (se calcula con `promptHistory()` y se acota en `buildRequest`), lo que
 * permite que el modelo vea los récords y las peticiones de turnos anteriores
 * (P1). Llega ya calculado porque `buildRequest` añade el turno actual por su
 * cuenta.
 */
export function turnOpts(text: string, history: ChatMsg[]): CoachTaskOpts {
  return { userText: text, history };
}

export function CoachView() {
  const msgs = chat.value;
  const hasKey = hasApiKey();
  /* La espera vive en un hook: segundos transcurridos, aviso de lentitud y
     Cancelar (antes era un `busy` binario que parecía colgado a los 60 s). */
  const wait = useCoachWait();
  const [draft, setDraft] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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
  }, [msgs.length, wait.running]);

  /* «Limpiar» pide confirmación en el propio botón (no hay modal en la v2). */
  useEffect(() => {
    if (!confirmClear) return;
    const id = setTimeout(() => setConfirmClear(false), 4000);
    return () => clearTimeout(id);
  }, [confirmClear]);

  async function run(task: CoachTask, userText: string, jump?: QuickAction['jump']): Promise<void> {
    const text = userText.trim();
    if (wait.running || !text) return;
    if (!hasKey && task !== 'suggest' && task !== 'plan') {
      addChat({
        role: 'sys',
        text: 'El coach está sin API key: añade la de Google AI Studio en Ajustes para que pueda responder.',
        action: { label: 'Configurar API key', tab: 'ajustes', sub: 'coach' },
        ts: nowTs(),
      });
      return;
    }

    /* El historial se calcula ANTES de apilar la pregunta: `buildRequest` añade
       el turno actual por su cuenta y con él dentro saldría duplicado. Viaja en
       las cuatro tareas como `contents` de Gemini: si no, «los récords que te
       pasé antes» se perdía al pedir un entreno con el chip (P1). */
    const history = promptHistory();
    const requestModel = String(settings.value.ai.model ?? '');
    const requestUnit = settings.value.units;
    const requestTimestamp = nowTs();
    const signal = wait.start();
    addChat({ role: 'user', text, ts: requestTimestamp });
    let ok = false;
    try {
      const out = await runCoachTask(task, {
        ...turnOpts(text, history),
        signal,
        onSlow: wait.markSlow,
      });
      addChat(resultLine(task, out, requestModel, requestUnit, requestTimestamp));
      ok = true;
    } catch (err) {
      /* Cancelar no es un fallo de la API: se dice tal cual, sin mandar a
         Ajustes ni disfrazarlo de «no hay conexión». */
      addChat(
        wait.cancelled()
          ? { role: 'sys', text: 'Cancelado: dejé de esperar la respuesta.', ts: nowTs() }
          : errorLine(err),
      );
    } finally {
      wait.end();
    }
    /* solo al terminar (y sin error): el salto es lo último, así la vista
       desmontada no vuelve a tocar su estado */
    if (ok && jump) {
      toast(jump.toast, { kind: 'ok' });
      go(jump.tab);
    }
  }

  function send(): void {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    void run('chat', text);
  }

  /**
   * Acciones de la tarjeta de ejercicio nuevo. NINGUNA creación es automática:
   * esto solo se invoca desde `onClick`.
   *
   * `create` → `createExerciseFromAI` (duplicado o material que falta vuelven en
   * `error`, que se avisa y NO marca la tarjeta). `edit` → lo mismo más
   * `requestEdit(id)`, que `SecEjercicios` recoge con su hook de Fase 0.
   * `discard` → solo estado en el chat, cero escrituras en `pulso.state`.
   */
  function create(index: number, creation: number, action: CreationAction): void {
    if (action === 'discard') {
      markCreation(index, creation, 'discarded');
      return;
    }
    const proposal = chat.value[index]?.creations?.[creation];
    if (!proposal) return;

    const result = createExerciseFromAI(proposal);
    if (!result.ok) {
      toast(result.error, { kind: 'err', ms: 8000 });
      return;
    }
    /* `markCreation` ANTES de `addChat`: si el historial está lleno, apilar el
       aviso recorta por el PRINCIPIO y el índice de la línea cambiaría. */
    markCreation(index, creation, 'created');
    toast(`Ejercicio creado: «${result.exercise.name}»`, { kind: 'ok' });
    addChat({
      role: 'sys',
      text: `Ejercicio creado: «${result.exercise.name}» · ya aparece en tu biblioteca`,
      ts: nowTs(),
    });
    if (action === 'edit') {
      requestEdit(result.exercise.id);
      go('ajustes', 'ejercicios');
    }
  }

  /**
   * Aplica la tarjeta de una propuesta/plan y avisa en el chat del resultado.
   *
   * Lo que no resuelve se parte con `partitionUnresolved`: el conflicto de
   * atributos sigue siendo el aviso de siempre, y lo que solo falla porque el
   * ejercicio NO EXISTE se ofrece como tarjeta de creación (aunque se haya
   * aplicado ya) — así «crear y volver a aplicar» completa la rutina sin tocar
   * `applySuggestionAsRoutine`/`applyWeek`.
   */
  function apply(index: number, kind: ApplyKind): void {
    const line = chat.value[index];
    if (!line) return;

    const payload = isPlain(line.payload) ? line.payload : null;

    if (kind === 'start' && payload) {
      const sessionPayload = payloadInCurrentUnit(line.payload, line.unit, settings.value.units);
      const entries = suggestionEntries(sessionPayload);
      const discarded = new Set(
        (line.creations ?? [])
          .filter((creation) => creation.status === 'discarded')
          .map((creation) => norm(creation.name)),
      );
      const kept = entries.filter((entry) => {
        if (!isPlain(entry)) return true;
        const name = asText(entry.name ?? entry.exercise ?? entry.exId);
        return !discarded.has(norm(name));
      });
      const { items, unresolved } = resolveCoachItems(kept);
      const keptPayload = {
        ...(isPlain(sessionPayload) ? sessionPayload : payload),
        ...(Array.isArray(payload.exercises) ? { exercises: kept } : {}),
        ...(Array.isArray(payload.items) ? { items: kept } : {}),
      };
      const { creatable, warnings } = partitionUnresolved(unresolved, keptPayload);
      if (creatable.length) {
        appendCreations(index, creatable);
        addChat({
          role: 'sys',
          text: `Antes de empezar, confirma o descarta los ejercicios nuevos de arriba y vuelve a pulsar «Empezar este entreno».`,
          ts: nowTs(),
        });
        toast(`Ejercicios por resolver: ${quoted(creatable)}`, { kind: 'warn' });
        return;
      }
      if (!items.length) {
        addChat({
          role: 'sys',
          text: warnings.length
            ? `No se inició el entreno porque ningún ejercicio está disponible: ${unresolvedDetails(warnings)}.`
            : 'No hay ejercicios disponibles para iniciar esta propuesta.',
          ts: nowTs(),
        });
        return;
      }
      if (active.value) {
        toast('Ya hay una sesión activa; la propuesta no la reemplazó.', { kind: 'warn' });
        go('hoy');
        return;
      }
      const planItems: PlanItem[] = items;
      const name = asText(payload.title) || 'Entreno sugerido por el coach';
      startFromPlan(planItems, {
        name,
        onUnresolved: (lost) => {
          if (lost.length) toast(`Sin incluir: ${unresolvedNames(lost)}`, { kind: 'warn' });
        },
      });
      markStarted(index);
      if (warnings.length) toast(`Sin incluir: ${unresolvedNames(warnings)}`, { kind: 'warn' });
      toast(`Entreno iniciado: ${name}`, { kind: 'ok' });
      go('hoy');
      return;
    }

    if (kind === 'routine') {
      const currentUnitPayload = payloadInCurrentUnit(line.payload, line.unit, settings.value.units);
      const discarded = new Set(
        (line.creations ?? [])
          .filter((creation) => creation.status === 'discarded')
          .map((creation) => norm(creation.name)),
      );
      const kept = suggestionEntries(currentUnitPayload).filter((entry) => {
        if (!isPlain(entry)) return true;
        return !discarded.has(norm(asText(entry.name ?? entry.exercise ?? entry.exId)));
      });
      const routinePayload = isPlain(currentUnitPayload)
        ? {
            ...currentUnitPayload,
            ...(Array.isArray(currentUnitPayload.exercises) ? { exercises: kept } : {}),
            ...(Array.isArray(currentUnitPayload.items) ? { items: kept } : {}),
          }
        : currentUnitPayload;
      const { routine, unresolved, updated } = applySuggestionAsRoutine(routinePayload);
      const { creatable, warnings } = partitionUnresolved(unresolved, routinePayload);
      if (creatable.length) appendCreations(index, creatable);
      if (!routine) {
        const detail = creatable.length
          ? `hay ejercicios nuevos pendientes: ${quoted(creatable)}`
          : warnings.length
            ? unresolvedDetails(warnings)
            : '';
        addChat({
          role: 'sys',
          text: detail
            ? `No guardé la rutina: ${detail}.${
                creatable.length
                  ? ' Créelos o descártelos desde sus tarjetas y vuelve a guardar.'
                  : ' Revisa estos ejercicios y vuelve a intentarlo.'
              }`
            : 'No pude guardar la propuesta como rutina: no traía ejercicios reconocidos.',
          ts: nowTs(),
        });
        return;
      }
      /* Mientras queden creables pendientes NO se marca «Aplicada», para que se
         pueda volver a pulsar tras crear los ejercicios nuevos. */
      if (!creatable.length) {
        if (isSuggestionCard(payload ?? {}, line.task)) markSaved(index);
        else markApplied(index);
      }
      const bits: string[] = [];
      if (creatable.length)
        bits.push(`nuevos por crear (${creatable.length}): ${quoted(creatable)}`);
      if (warnings.length) bits.push(`sin usar (${warnings.length}): ${unresolvedDetails(warnings)}`);
      addChat({
        role: 'sys',
        text: `${updated ? 'Rutina actualizada' : 'Rutina creada'}: ${routine.name}${bits.length ? ` · ${bits.join(' · ')}` : ''}`,
        ts: nowTs(),
      });
      return;
    }

    if (kind === 'sessions') {
      /* Los ejercicios descartados en la tarjeta no se reintentan: si el modelo
         los vuelve a proponer, los saltamos para no importarlos otra vez. */
      const skipNames = (line.creations ?? [])
        .filter((creation) => creation.status === 'discarded')
        .map((creation) => creation.name);
      const out = applyImportedSessions(line.payload, { skipNames });

      if (out.creatable.length) {
        appendCreations(index, out.creatable);
        addChat({
          role: 'sys',
          text: `No he importado nada todavía: faltan ${out.creatable.length} ejercicios por crear. Confirma o descarta los nuevos de arriba y vuelve a pulsar «Importar al historial».`,
          ts: nowTs(),
        });
        toast(`Ejercicios nuevos por crear: ${quoted(out.creatable)}`, { kind: 'warn' });
        return;
      }
      if (!out.sessions.length) {
        addChat({
          role: 'sys',
          text: 'No había sesiones válidas para importar: revisa las fechas y los ejercicios.',
          ts: nowTs(),
        });
        return;
      }

      markApplied(index);
      const count = `${out.sessions.length} ${out.sessions.length === 1 ? 'sesión' : 'sesiones'}`;
      toast(`Importadas ${count} al historial`, { kind: 'ok' });
      addChat({
        role: 'sys',
        text:
          `Importadas ${count} al historial` +
          (out.warnings.length
            ? ` · sin usar (${out.warnings.length}): ${unresolvedNames(out.warnings)}`
            : ''),
        ts: nowTs(),
      });
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
    const { creatable, warnings } = partitionUnresolved(out.unresolved, line.payload);
    if (creatable.length) appendCreations(index, creatable);
    if (!creatable.length) markApplied(index);
    const bits: string[] = [];
    if (creatable.length) bits.push(`nuevos por crear (${creatable.length}): ${quoted(creatable)}`);
    if (warnings.length) bits.push(`sin usar (${warnings.length}): ${unresolvedNames(warnings)}`);
    const skipped = bits.length ? ` · ${bits.join(' · ')}` : '';
    addChat({
      role: 'sys',
      text: `Plan aplicado: ${out.days} días${out.routines ? ` · ${out.routines} rutinas enlazadas` : ''}${skipped}`,
      ts: nowTs(),
    });
    /* El plan YA está en el calendario: se salta a verlo, igual que acababa la
       antes (allí era el propio Calendario quien aplicaba, `cal:apply-plan`). Si
       quedan creables, NO se salta: la tarjeta está en esta pestaña. */
    toast(
      out.routines
        ? `Semana agendada: ${out.days} días, ${out.routines} rutinas enlazadas`
        : `Semana agendada: ${out.days} días`,
      { kind: 'ok' },
    );
    if (warnings.length) {
      toast(`Sin usar: ${unresolvedNames(warnings)}`, { kind: 'warn' });
    }
    if (creatable.length) {
      toast(`Ejercicios nuevos por crear: ${quoted(creatable)}`, { kind: 'warn' });
      return;
    }
    go('calendario');
  }

  return (
    <section class="coach-view">
      <div class="between coach-heading">
        <span class="label help-h3">
          Conversación
          <HelpBtn id="tab.coach" title="Coach" />
        </span>
        <button type="button" class="btn quiet sm" aria-label="Opciones del coach" onClick={() => setMenuOpen(true)}>
          <Icon name="gear" />
          Opciones
        </button>
      </div>

      {msgs.length ? (
        <div class="between coach-clear-row">
          <span class="tiny muted">Tu conversación</span>
          <button
            type="button"
            class="btn quiet sm"
            onClick={() => {
              if (confirmClear) { clearChat(); setConfirmClear(false); }
              else setConfirmClear(true);
            }}
          >
            <Icon name="trash" />{confirmClear ? '¿Seguro?' : 'Limpiar'}
          </button>
        </div>
      ) : null}

      <div class="chat" role="log" aria-live="polite" aria-relevant="additions" ref={scroller}>
        {msgs.length ? (
          msgs.map((line, i) => (
            <Bubble key={`${line.ts ?? ''}-${i}`} line={line} index={i} onApply={apply} onCreate={create} />
          ))
        ) : (
          <div class="empty coach-empty">
            <Icon name="sparkles" />
            <div>¿En qué te ayudo?</div>
            <div class="tiny">Escribe tu pregunta o empieza con una propuesta para hoy o para toda la semana.</div>
            <div class="coach-empty-actions">
              {QUICK_ACTIONS.slice(0, 2).map((action) => (
                <button
                  key={action.label}
                  type="button"
                  class="btn primary"
                  disabled={wait.running}
                  onClick={() => { const text = chipText(action.ask, draft); if (draft.trim()) setDraft(''); void run(action.task, text); }}
                >
                  <Icon name={action.icon} />{action.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {wait.running ? (
          <div class="msg ai"><span class="coach-typing"><span class="typing"><i /><i /><i /></span><span class="tiny muted">Pensando…</span><WaitMeta wait={wait} /></span></div>
        ) : null}
      </div>

      <div class="composer">
        <div class="composer-inner">
          <textarea
            rows={1}
            value={draft}
            disabled={!hasKey || wait.running}
            aria-label="Mensaje"
            placeholder={hasKey ? 'Escribe tu pregunta…' : 'Configura la API key para chatear'}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button type="button" class="btn primary icon" disabled={wait.running || !hasKey || !draft.trim()} title="Enviar" onClick={send}>
            <Icon name="chev-r" />
          </button>
        </div>
      </div>

      {menuOpen ? (
        <Modal title="Opciones del coach" onClose={() => setMenuOpen(false)} help="coach.quick">
          <StatusCard />
          <div class="label mt">Acciones</div>
          <div class="coach-menu-actions">
            {QUICK_ACTIONS.slice(2).map((action) => (
            <button
              key={action.label}
              type="button"
              class="btn ghost"
              disabled={wait.running}
              title={draft.trim() ? 'Tu texto se enviará como contexto' : undefined}
              onClick={() => {
                const text = chipText(action.ask, draft);
                if (draft.trim()) setDraft(''); /* ya se envió: la caja queda vacía */
                setMenuOpen(false);
                void run(action.task, text, action.jump);
              }}
            >
              <Icon name={action.icon} />
              {action.label}
            </button>
          ))}
          </div>
          <MemoryPanel />
        </Modal>
      ) : null}
    </section>
  );
}
