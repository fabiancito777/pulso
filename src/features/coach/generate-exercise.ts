/**
 * Generador IA de ejercicios (Ajustes → Ejercicios): system prompt, petición y
 * parseo de las propuestas. Cerebro PURO de la feature B (spec
 * `_specs/generador-ejercicios.md` §3): aquí solo se montan strings y se
 * validan respuestas; la red y el estado viven en `state/exgen.ts` y escribir
 * es trabajo de `state/exercise-create.ts`.
 *
 * Tres diferencias con `prompts.ts` (el coach) que no son accidentales:
 *
 * - **Sin la regla de «EXCLUSIVAMENTE la lista»**: el generador INVENTA
 *   ejercicios nuevos. Lo que no debe hacer es repetir los que ya tiene el
 *   usuario, y para eso van `existing` en la petición y `matchExercise` en
 *   `parseProposals` (marca `duplicateOf`, no descarta).
 * - **`equip` son claves simples de `EQUIPMENT`** (el editor manual tampoco
 *   guarda compuestos `a&b|c`) y SOLO las activas del usuario: el material
 *   viaja en la petición, no en el system, para que el system sirva para
 *   cualquier usuario sin regenerarlo.
 * - **Nada se escribe aquí**: la propuesta sale normalizada y validada con el
 *   contrato de Fase 0 (`proposalToDraft`), y la confirmación es un clic del
 *   usuario en la UI.
 */
import { AI_EXERCISE_SCHEMA, proposalToDraft } from '@/domain/ai-exercise';
import type { AIExerciseProposal } from '@/domain/ai-exercise';
import {
  daysSince,
  groupSets,
  groupVolume,
  lastTrained,
  recentExercises,
  sessionsSince,
} from '@/domain/analytics';
import { GROUPS } from '@/domain/data';
import type { EquipmentMap } from '@/domain/data';
import { fmtVol } from '@/domain/format';
import { UNILATERAL_RX } from '@/domain/match';
import { norm } from '@/domain/text';
import type { Exercise, Session } from '@/domain/types';

import { parseJSON } from './parse';
import type { CoachRequest } from './types';

/** Las 13 claves de `GROUPS`, en el orden del catálogo (nunca se escriben a mano). */
const GROUP_KEYS = GROUPS.map((g) => g.key).join(', ');

/**
 * Instrucción de sistema del generador: tono del `DEFAULT_SYSTEM` pero SIN su
 * regla de «EXCLUSIVAMENTE ejercicios de la lista» (`prompts.ts`), porque aquí
 * la lista es justo lo contrario: lo pedido son ejercicios que NO existen.
 * Contiene el esquema literal de cada objeto (compartido con el chat del coach)
 * y las 13 claves de grupo, así el modelo no puede devolver un grupo
 * inexistente.
 */
export const GENERATOR_SYSTEM = [
  'Eres el generador de ejercicios de Pulso. Inventas ejercicios NUEVOS para la biblioteca del usuario (no variantes de los que ya tiene, ni copias de los existentes).',
  'Reglas:',
  '- Responde SOLO con el JSON pedido: sin markdown, sin texto fuera del JSON, sin bloques ```consulta ni ```memoria.',
  `- "group" debe ser EXACTAMENTE uno de: ${GROUP_KEYS}.`,
  '- "equip" vacío (= peso corporal) o UNA clave simple de la lista de material que te paso en la petición (por ejemplo mancuernas_ajustables, barra_olimpica o banco_dominadas); prohíbo compuestos (a&b|c) y todo material que no esté en su inventario.',
  '- "type" ∈ compuesto | aislado | cardio | movilidad; "sets" 1-12, "rest" 0-600 s, "repMin" y "repMax" 1-100 con repMin <= repMax.',
  '- Si "unilateral" es true, el "name" DEBE contener «unilateral» / «a una mano» / «por brazo» (o «por pierna»); si es false, no lo lleve.',
  '- "desc": UNA frase en español con la clave técnica de la ejecución.',
  '- Nada de ejercicios que lastimen la espalda baja con cargas imposibles; prioriza el material que el usuario tiene activo y los grupos que aparecen en HUECOS.',
  '- Ejemplo de la forma exacta de cada elemento del array:',
  AI_EXERCISE_SCHEMA,
].join('\n');

/**
 * Texto corto con el que el chip «Según mis huecos del historial» rellena el
 * campo libre. El brief CON cifras lo calcula `gapsBrief` dentro de
 * `generateExercises`, en el momento del clic: pulsar el chip no cuesta ni una
 * request (spec §4).
 */
export const GAPS_HINT = 'según mis huecos del historial: grupos subestimados y variedad';

/** Cuántos ejercicios se piden por defecto y tope de la petición (spec §2). */
const COUNT_DEFAULT = 4;
const COUNT_MIN = 1;
const COUNT_MAX = 8;

/** Nombres de ejercicios que el modelo debe evitar, en el tope de la spec (§3). */
export const FORBIDDEN_MAX = 40;

/** Nombres existentes que se mandan para no duplicar, en el tope de la spec (§3). */
export const EXISTING_MAX = 200;

/* ---------- petición ---------- */

/** Foto de la biblioteca y del material que necesita el prompt (todo por parámetro). */
export interface GeneratorCtx {
  /** etiquetas del material ACTIVO (`enabledEquipment` + `equipLabel`) */
  material: string[];
  /** claves SIMPLES activas: los únicos valores válidos de `"equip"` */
  equipKeys: string[];
  /** nombres prohibidos (`allowed: false`), tope `FORBIDDEN_MAX` */
  forbidden: string[];
  /** ★ del usuario (contexto de estilo, no es un límite) */
  favorites: string[];
  /** nombres existentes, tope `EXISTING_MAX`, para que no repita */
  existing: string[];
  /** brief de huecos del historial ya montado (`gapsBrief`); solo con el atajo */
  gaps?: string;
  /** cuántos ejercicios se piden */
  count: number;
}

/**
 * Monta la petición del generador: secciones en el mismo estilo que
 * `context.ts` y `json: true` (la respuesta es SOLO el JSON de
 * `{"exercises":[ … ]}`).
 */
export function buildGeneratorRequest(userText: string, ctx: GeneratorCtx): CoachRequest {
  const count = Math.min(COUNT_MAX, Math.max(COUNT_MIN, Math.trunc(ctx.count) || COUNT_DEFAULT));
  const lines = [
    `MATERIAL DISPONIBLE: ${ctx.material.join(', ') || 'peso corporal (sin material activo)'}`,
    `CLAVES VÁLIDAS DE "equip": ${ctx.equipKeys.join(', ') || 'ninguna'}`,
  ];
  if (ctx.forbidden.length) {
    lines.push(`PROHIBIDOS (no los propongas ni pareados): ${ctx.forbidden.join(', ')}`);
  }
  if (ctx.favorites.length) {
    lines.push(`FAVORITOS (estilo a imitar, no a copiar): ${ctx.favorites.join(', ')}`);
  }
  if (ctx.existing.length) {
    lines.push(`YA EXISTEN (no copies ni variaciones cercanas): ${ctx.existing.join(', ')}`);
  }
  if (ctx.gaps?.trim()) {
    lines.push('HUECOS DEL HISTORIAL (grupos subestimados y variedad):', ctx.gaps.trim());
  }
  lines.push(
    `SOLICITUD DEL USUARIO: ${userText.trim() || 'sorpréndeme con ejercicios nuevos'}`,
    `Genera ${count} ejercicios nuevos. Devuelve SOLO este JSON:`,
    `{"exercises":[${AI_EXERCISE_SCHEMA}]}`,
  );
  return { system: GENERATOR_SYSTEM, prompt: lines.join('\n'), json: true };
}

/* ---------- atajo de huecos ---------- */

/**
 * Brief de los huecos del historial, en cliente y SIN llamada extra (spec §4):
 * volumen y series por grupo en 7 días, días desde el último estímulo y los
 * ejercicios que se repiten. Determinista con `todayIso` fijo, así que se prueba
 * sin reloj.
 *
 * Se calcula DENTRO de `generateExercises` (en el clic), no al activar el chip:
 * abrir el modal y marcar el atajo no cuestan ni una request.
 */
export function gapsBrief(
  sessions: readonly Session[],
  exercises: readonly Exercise[],
  todayIso: string,
): string {
  const week = sessionsSince(sessions, 7, todayIso);
  const vol = groupVolume(week, exercises);
  const sets = groupSets(week, exercises);
  const last = lastTrained(sessions, exercises);

  const lines = GROUPS.map((g) => {
    const kg = vol[g.key] ?? 0;
    const n = sets[g.key] ?? 0;
    const trained = last[g.key] ?? null;
    if (!kg && !n && !trained) return `- ${g.label}: sin datos`;
    const days = daysSince(trained, todayIso);
    return `- ${g.label}: ${days ?? 0} d desde el último estímulo · ${n} series / ${fmtVol(kg)} kg en 7 días`;
  });

  const recent = recentExercises(sessions, exercises, 8);
  if (recent.length) {
    const names = recent.map((r) => r.ex.name).join('», «');
    lines.push(`- Repetición: los últimos entrenos se centran en «${names}»`);
  }
  return lines.join('\n');
}

/* ---------- propuestas ---------- */

/** Foto con la que se validan las propuestas (biblioteca + material activo). */
export interface ParseContext {
  /** biblioteca con la que se detectan duplicados y candidatos */
  library: readonly Exercise[];
  /** material ACTIVO del usuario (`{ clave: boolean }`), como en el resto del dominio */
  equipment: EquipmentMap;
}

/**
 * Una propuesta ya normalizada por `proposalToDraft`: nombre recortado, grupo y
 * material resueltos, rangos validados. `duplicateOf`/`conflict`/`notes` es la
 * información que el borrador no puede guardar (spec §3) y es lo que la tarjeta
 * pinta como aviso.
 */
export interface ExerciseProposal extends AIExerciseProposal {
  /** nombre parecido ya existente (match ≥ 0,85): se avisa y NO se crea */
  duplicateOf?: string;
  /** candidato cercano con conflicto de atributos (aviso, no bloquea) */
  conflict?: string;
  /** avisos no bloqueantes (grupo inferido, material corregido…) */
  notes: string[];
}

export interface ParseOutcome {
  proposals: ExerciseProposal[];
  /** problemas concretos («no tienes ese material», «propuesta 2 ilegible»…) */
  issues: string[];
  /** la respuesta no era JSON interpretable ni traía ejercicios */
  parseError?: string;
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Texto de un campo del JSON del modelo: solo se aceptan cadenas (un número o
 * un objeto mandado por el modelo NO se convierten en «[object Object]»: el
 * campo queda vacío y ya lo avisa `proposalToDraft`).
 */
function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Respuesta del modelo → propuestas validadas, SIN throw nunca (un JSON roto
 * devuelve `parseError`, que es lo que `state/exgen.ts` traduce a
 * `GeminiError('parse')`).
 *
 * Lo que `proposalToDraft` rechaza (nombre vacío, material que el usuario no
 * tiene) va a `issues`; lo que solo avisa (grupo inferido, `duplicateOf`) se
 * queda en la propuesta para que la UI lo muestre sin perderla.
 */
export function parseProposals(text: string, ctx: ParseContext): ParseOutcome {
  const issues: string[] = [];
  const proposals: ExerciseProposal[] = [];

  let payload: unknown;
  try {
    payload = parseJSON<unknown>(text);
  } catch {
    return { proposals, issues, parseError: 'no pude interpretar la respuesta' };
  }

  const list: unknown[] | null = Array.isArray(payload)
    ? (payload as unknown[])
    : isPlain(payload) && Array.isArray(payload.exercises)
      ? (payload.exercises as unknown[])
      : null;
  if (!list) {
    return { proposals, issues, parseError: 'la respuesta no traía ningún ejercicio' };
  }

  const seen = new Set<string>();
  list.forEach((entry, index) => {
    if (!isPlain(entry)) {
      issues.push(`Propuesta ${index + 1}: no es un objeto con nombre`);
      return;
    }
    const raw = entry;
    const result = proposalToDraft(
      {
        name: asText(raw.name),
        group: asText(raw.group),
        equip: asText(raw.equip),
        type: asText(raw.type),
        sets: raw.sets as number | undefined,
        rest: raw.rest as number | undefined,
        repMin: raw.repMin as number | undefined,
        repMax: raw.repMax as number | undefined,
        unilateral: raw.unilateral === true || raw.unilateral === 'true',
        desc: asText(raw.desc),
      },
      ctx.library,
      ctx.equipment,
    );
    if (!result.ok) {
      const name = asText(raw.name).trim();
      issues.push(`${name || `Propuesta ${index + 1}`}: ${result.error}`);
      return;
    }

    const { draft, info } = result;
    const notes = [...info.notes];
    /* `unilateral` no es campo de `Exercise`: vive en el NOMBRE
       (`UNILATERAL_RX`), así que el flag manda y el nombre se corrige aquí. */
    const name =
      info.unilateral && !UNILATERAL_RX.test(draft.name) ? `${draft.name} unilateral` : draft.name;
    if (name !== draft.name)
      notes.push('Añadido «unilateral» al nombre (el bilateralismo va en el nombre)');

    const key = norm(name);
    if (seen.has(key)) {
      issues.push(`«${name}»: repetido en la misma tanda, se ignora`);
      return;
    }
    seen.add(key);

    proposals.push({
      name,
      group: draft.group,
      equip: draft.equip,
      type: draft.type,
      sets: draft.sets,
      rest: draft.rest,
      repMin: draft.repMin,
      repMax: draft.repMax,
      unilateral: info.unilateral,
      desc: info.desc,
      notes,
      ...(info.duplicateOf ? { duplicateOf: info.duplicateOf } : {}),
      ...(info.conflict ? { conflict: info.conflict } : {}),
    });
  });

  return { proposals, issues };
}
