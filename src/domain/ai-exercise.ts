/**
 * Ejercicios propuestos por IA: del JSON del modelo a un `ExerciseDraft`
 * validado, en dominio puro (sin estado, sin DOM). Es el contrato compartido de
 * las dos features que crean ejercicios (spec `_specs/creacion-ejercicios-plan.md`
 * §3.1): el coach que propone nuevos en el chat (A) y el generador de Ajustes (B)
 * pasan por aquí ANTES de `state/exercise-create.ts`, el único que escribe.
 *
 * Qué decide este módulo (y por qué no vive en `exercise-draft.ts`, que es el
 * form manual y no se toca):
 * - `group` que no es clave de `GROUPS` → se INFERE en orden candidato del
 *   matcher → keywords del nombre → `pecho`: nunca se guarda un grupo
 *   inexistente (`data.test.ts` vigila que todo grupo exista en el catálogo);
 * - `equip` → o está en el material del usuario o no se crea: una clave
 *   desconocida se corrige a `''`, un compuesto `a&b|c` se queda con la primera
 *   clave ACTIVA y un material que el usuario no tiene es error (no creamos algo
 *   que no puede hacer);
 * - `type` desconocido → `aislado`; los números los clampa `validateDraft`
 *   (series 1-12, descanso 0-600, reps 1-100 y `repMax >= repMin`);
 * - el matcher decide `duplicateOf` (match ≥ 0,85) y `conflict` (veto): el
 *   duplicado NO se crea (lo informa `createExerciseFromAI`) y el veto es un
 *   aviso para la tarjeta, no una creación.
 *
 * Ojo: `unilateral` y `desc` NO son campos de `Exercise` (el bilateralismo vive
 * en el NOMBRE, `match.UNILATERAL_RX`; `desc` se guarda en `tips`). Aquí salen
 * en `info` para que la tarjeta los pinte y para que el que cree los use.
 */
import { EQUIPMENT, EXERCISE_TYPES, GROUPS, equipLabel, equipmentKeys } from './data';
import type { EquipmentMap } from './data';
import { validateDraft } from './exercise-draft';
import type { ExerciseDraft } from './exercise-draft';
import { matchExercise, parseNameAttrs } from './match';
import type { MaterialKey, MatchResult } from './match';
import { int } from './num';
import { norm } from './text';
import type { Exercise, ExerciseType } from './types';

/** Claves del JSON que los dos prompts piden al modelo (mismo orden). */
export const AI_EXERCISE_KEYS = [
  'name',
  'group',
  'equip',
  'type',
  'sets',
  'rest',
  'repMin',
  'repMax',
  'unilateral',
  'desc',
] as const;

/**
 * Ejemplo literal que ambos prompts insertan en su petición (en el chat viaja
 * como array dentro de un bloque ```crear```; en el generador, envuelto en
 * `{"exercises":[ … ]}`). `json: true` hace que la respuesta sea SOLO ese JSON.
 */
export const AI_EXERCISE_SCHEMA =
  '{"name":"Remo con mancuerna a una mano en banco inclinado","group":"espalda","equip":"mancuernas_fijas","type":"compuesto","sets":3,"rest":120,"repMin":8,"repMax":12,"unilateral":true,"desc":"Remo unilateral con el pecho apoyado en un banco inclinado."}';

/**
 * Lo que el modelo propone para un ejercicio NUEVO. Solo `name` es imprescindible:
 * el resto se infiere o se por-defectúa (ver `proposalToDraft`), porque un JSON
 * a medias no debe tirar la propuesta entera.
 */
export interface AIExerciseProposal {
  /** obligatorio y no vacío */
  name: string;
  /** clave de `GROUPS` (o etiqueta); si no es válido se infiere */
  group?: string;
  /** clave simple de `EQUIPMENT`, etiqueta, compuesto `a&b|c` o `''` (peso corporal) */
  equip?: string;
  /** `compuesto | aislado | cardio | movilidad`; si no, `aislado` */
  type?: string;
  sets?: number;
  /** segundos */
  rest?: number;
  repMin?: number;
  repMax?: number;
  /** true si es a una mano / por lado (también se deduce del nombre) */
  unilateral?: boolean;
  /** una frase: se guarda en `Exercise.tips` */
  desc?: string;
}

/** De dónde salió el `group` del borrador (las tres últimas son inferencias). */
export type ProposalGroupSource = 'proposal' | 'label' | 'candidate' | 'keywords' | 'fallback';

/** Lo que la propuesta arrastra y el borrador no puede guardar tal cual. */
export interface ProposalInfo {
  groupSource: ProposalGroupSource;
  /** nombre del ejercicio existente con el que choca (match ≥ 0,85): NO se crea */
  duplicateOf?: string;
  /** veto del matcher: candidato cercano que no cumple el nombre (aviso, no bloquea) */
  conflict?: string;
  /** flag declarado O deducido del nombre (`UNILATERAL_RX`) */
  unilateral: boolean;
  /** frase para `Exercise.tips` */
  desc: string;
  /** avisos no bloqueantes (grupo inferido, material corregido…) para la UI */
  notes: string[];
}

export type ProposalDraftResult =
  | { ok: true; draft: ExerciseDraft; info: ProposalInfo }
  | { ok: false; error: string; info: ProposalInfo };

/* ---------- grupos ---------- */

/**
 * Keywords del nombre (NORMALIZADO: sin tildes ni signos) a grupo muscular.
 * El orden importa: lo específico va primero («curl femoral» antes que «curl»,
 * «gemelos» antes que «elevación», «press militar» antes que «press»).
 */
const GROUP_KEYWORDS: readonly (readonly [RegExp, string])[] = [
  /* Los 6 grupos que no venían en la v1 van PRIMERO: comparten palabras con los
     de siempre («encogimiento» no es hombros, «extensión de espalda» no es
     tríceps) y el catálogo los recorre en este orden. */
  [/cuello|cervical/, 'cuello'],
  [/trapecio|encogimiento|shrug/, 'trapecio'],
  [/lumbar|espalda baja|hiperextension|extension de espalda|buenos dias/, 'lumbares'],
  [/oblicuo|russian twist|lenador|hacha/, 'oblicuos'],
  [/aductor|aduccion|aductores/, 'aductores'],
  [/serrato|serratus|push up plus|plus push/, 'serrato'],
  [/antebrazo|muneca/, 'antebrazo'],
  [/curl femoral|isquio|femoral/, 'femoral'],
  [/curl|biceps/, 'biceps'],
  [/extens|triceps|rompecranos/, 'triceps'],
  [/dominad|jalon|pull|dorsal|remo|planea/, 'espalda'],
  [/sentadilla|cuadriceps|zancada|prensa/, 'cuadriceps'],
  [/gemelo|pantorrilla/, 'gemelos'],
  [/abdom|plancha|core|crunch|sit up/, 'core'],
  [/face pull|hombro|press militar|elevacion lateral/, 'hombros'],
  [/elevac|hip thrust|gluteo|puente/, 'gluteos'],
  [/flexion|pecho|press|banca|apertur|fondos/, 'pecho'],
  [/cardio|carrera|trote|bici|eliptica|saltar/, 'cardio'],
  [/movilidad|estiramiento|flexibilidad|movilizac/, 'movilidad'],
];

/** Clave de `GROUPS` a partir de una clave o de una etiqueta (normalizadas). */
function groupKeyOf(raw: string): string {
  const key = raw.trim();
  if (!key) return '';
  if (GROUPS.some((g) => g.key === key)) return key;
  const target = norm(key);
  return GROUPS.find((g) => norm(g.key) === target || norm(g.label) === target)?.key ?? '';
}

/** Primera keyword que casa, o `''`. */
function keywordGroup(name: string): string {
  const text = norm(name);
  for (const [rx, key] of GROUP_KEYWORDS) if (rx.test(text)) return key;
  return '';
}

/** Grupo: propuesta → candidato del matcher → keywords → `pecho` (default del form). */
function resolveGroup(
  raw: string,
  name: string,
  match: MatchResult,
): { key: string; source: ProposalGroupSource; note?: string } {
  const direct = groupKeyOf(raw);
  if (direct) {
    return direct === raw
      ? { key: direct, source: 'proposal' }
      : { key: direct, source: 'label', note: `Grupo «${raw}» entendido como «${direct}»` };
  }
  const candidate = match.candidate ?? null;
  const fromCandidate = candidate ? groupKeyOf(candidate.group) : '';
  if (candidate && fromCandidate) {
    return {
      key: fromCandidate,
      source: 'candidate',
      note: `Grupo inferido de «${candidate.name}»: «${fromCandidate}»`,
    };
  }
  const fromKeywords = keywordGroup(name);
  if (fromKeywords) {
    return {
      key: fromKeywords,
      source: 'keywords',
      note: `Grupo inferido del nombre: «${fromKeywords}»`,
    };
  }
  return { key: 'pecho', source: 'fallback', note: 'Sin grupo reconocible, se usa «pecho»' };
}

/* ---------- material ---------- */

/** Clave de `EQUIPMENT` a partir de una clave o de una etiqueta (normalizadas). */
function equipKeyOf(part: string): string {
  const key = part.trim();
  if (!key) return '';
  if (equipmentKeys.includes(key)) return key;
  const target = norm(key);
  return EQUIPMENT.find((e) => norm(e.key) === target || norm(e.label) === target)?.key ?? '';
}

/**
 * Claves conocidas que un `equip` menciona, en orden: acepta clave simple,
 * etiqueta y compuesto `a&b|c` (el form manual solo guarda la primera clave
 * simple, `exercise-draft.ts`, así que lo compuesto no se puede editar después).
 */
function equipCandidates(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(/[&|]/)) {
    const key = equipKeyOf(part);
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

/** Claves candidatas, en orden de preferencia, para el material que el NOMBRE pide. */
function materialCandidates(name: string, material: MaterialKey): string[] {
  const text = norm(name);
  if (material === 'mancuerna') return equipmentKeys.filter((k) => k.startsWith('mancuern'));
  if (material === 'barra') {
    const barras = EQUIPMENT.filter((e) => e.cat === 'Barras').map((e) => e.key);
    return /dominad|pull/.test(text) ? ['banco_dominadas', ...barras] : barras;
  }
  if (material === 'polea') return equipmentKeys.filter((k) => k.startsWith('polea'));
  if (material === 'banda') return equipmentKeys.filter((k) => k.includes('banda'));
  return EQUIPMENT.filter((e) => e.cat === 'Máquinas').map((e) => e.key);
}

type EquipResult = { ok: true; key: string; note?: string } | { ok: false; error: string };

/**
 * Material: lo declarado manda si el usuario lo tiene; sin material declarado se
 * deduce del nombre SOLO si el usuario tiene ese material (así «Remo con
 * mancuerna» no acaba creado como peso corporal, y un material ausente no crea
 * un ejercicio que no se puede hacer).
 */
function resolveEquip(name: string, raw: string, equipment: EquipmentMap): EquipResult {
  if (raw) {
    const known = equipCandidates(raw);
    if (!known.length) {
      return {
        ok: true,
        key: '',
        note: `Material «${raw}» desconocido, se guarda como peso corporal`,
      };
    }
    const active = known.find((k) => equipment[k] === true);
    if (!active) {
      return { ok: false, error: `No tienes «${equipLabel(known[0])}» para crear «${name}»` };
    }
    if (known.length > 1) {
      return {
        ok: true,
        key: active,
        note: `Material «${raw}» resuelto a «${equipLabel(active)}»`,
      };
    }
    return active === raw
      ? { ok: true, key: active }
      : {
          ok: true,
          key: active,
          note: `Material «${raw}» entendido como «${equipLabel(active)}»`,
        };
  }

  const wanted = parseNameAttrs(name).material;
  const candidates = wanted.flatMap((m) => materialCandidates(name, m));
  if (!candidates.length) return { ok: true, key: '' };
  const active = candidates.find((k) => equipment[k] === true);
  if (!active) return { ok: false, error: `No tienes el material que «${name}» necesita` };
  return { ok: true, key: active, note: `Material deducido del nombre: «${equipLabel(active)}»` };
}

/* ---------- propuesta → borrador ---------- */

/**
 * Propuesta de la IA → borrador YA validado (listo para `toExercise`), con la
 * información que el borrador no puede llevar (`unilateral`, `desc`,
 * `duplicateOf`, `conflict`) y los avisos para la UI.
 *
 * No escribe nada: el único punto de escritura es `state/exercise-create.ts`.
 *
 * @param proposal propuesta cruda (tolerante: lo que no sea del tipo esperado cae en el default)
 * @param library biblioteca completa con la que mirar duplicados y candidatos
 * @param equipment material ACTIVO del usuario (`{ clave: boolean }`), como en el resto del dominio
 */
export function proposalToDraft(
  proposal: AIExerciseProposal,
  library: readonly Exercise[],
  equipment: EquipmentMap,
): ProposalDraftResult {
  const input = (proposal ?? {}) as Partial<AIExerciseProposal>;
  const notes: string[] = [];
  const name = String(input.name ?? '').trim();
  const info: ProposalInfo = {
    groupSource: 'fallback',
    unilateral: input.unilateral === true || parseNameAttrs(name).unilateral,
    desc: String(input.desc ?? '').trim(),
    notes,
  };
  const fail = (error: string): ProposalDraftResult => ({ ok: false, error, info });
  if (!name) return fail('El nombre es obligatorio');

  const match = matchExercise(name, library);
  if (match.ex) info.duplicateOf = match.ex.name;
  if (match.conflict) info.conflict = match.conflict;

  const group = resolveGroup(String(input.group ?? '').trim(), name, match);
  info.groupSource = group.source;
  if (group.note) notes.push(group.note);

  const equip = resolveEquip(name, String(input.equip ?? '').trim(), equipment);
  if (!equip.ok) return fail(equip.error);
  if (equip.note) notes.push(equip.note);

  const rawType = String(input.type ?? '').trim();
  const typeOk = (EXERCISE_TYPES as readonly string[]).includes(rawType);
  if (rawType && !typeOk) notes.push(`Tipo «${rawType}» no existe, se usa «aislado»`);

  const checked = validateDraft({
    name,
    group: group.key,
    equip: equip.key,
    type: typeOk ? (rawType as ExerciseType) : 'aislado',
    /* defaults del prompt (3/120/8/12): validateDraft clampa y iguala repMax */
    sets: int(input.sets, 3),
    rest: int(input.rest, 120),
    repMin: int(input.repMin, 8),
    repMax: int(input.repMax, 12),
    allowed: true,
  });
  if (!checked.ok) return fail(checked.error);
  return { ok: true, draft: checked.value, info };
}
