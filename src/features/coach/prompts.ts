/**
 * System prompt y peticiones al modelo. Puertos de `DEFAULT_SYSTEM` y de los
 * cuatro `C.suggestWorkout` / `C.planWeek` / `C.analyzeProgress` / `C.chat` de
 * la v1 (`legacy/js/coach.js`), sin tocar la red: aquí solo se montan strings.
 *
 * La semántica es la misma que en la v1:
 *
 * - `suggest` y `plan` piden JSON: eso se traduce en
 *   `responseMimeType: application/json` + `responseSchema` en `client.ts`, de
 *   modo que la respuesta sale con la forma fijada por `schema.ts` y no por la
 *   prosa del modelo (por eso mismo estos dos prompts ya no llevan el ejemplo
 *   JSON de la v1: la forma vive en un solo sitio);
 * - `analyze` pide markdown de ≤ 400 palabras;
 * - **el historial de conversación viaja como `contents` en las CUATRO tareas**
 *   (campo `history` de la petición, que `client.ts` convierte en `contents`),
 *   acotado por turno y por número de turnos (`boundedHistory`). En la v1 el
 *   transcript de `suggest`/`plan`/`analyze` se metía DENTRO del prompt como
 *   bloque `CONVERSACIÓN PREVIA`: era texto caro dentro de un prompt que ya es
 *   grande, y encima el modelo lo leía como parte de las instrucciones;
 * - `opts.question` viaja en TODAS las tareas: en `chat` es el prompt entero y
 *   en el resto es la COLA del prompt, en crudo y sin etiqueta, para que lo
 *   último que vea el modelo sea lo que el usuario pide (y solo aparece UNA vez:
 *   el historial se calcula antes de apilar ese turno);
 * - el contexto del usuario se inyecta SIEMPRE detrás de
 *   `system + "\n\nCONTEXTO DEL USUARIO:\n" + ctx`.
 */
import { AI_EXERCISE_SCHEMA } from '@/domain/ai-exercise';
import { EXERCISE_TYPES, GROUPS, goalLabel } from '@/domain/data';
import { int } from '@/domain/num';
import { trunc } from '@/domain/text';
import { PLAN_RESPONSE_SCHEMA, SUGGEST_RESPONSE_SCHEMA } from './schema';
import type { BuildRequestOpts, ChatMessage, CoachRequest, CoachTask } from './types';

/** Personalidad y reglas del coach (port literal del system de la v1). */
export const DEFAULT_SYSTEM = [
  'Eres Pulso Coach, entrenador personal y planificador de entrenamiento basado en evidencia.',
  'Reglas:',
  '- Responde siempre en español, con tono directo, profesional y cercano. Nada de relleno.',
  '- Usa preferentemente ejercicios de la lista de ejercicios permitidos que recibes en el contexto (respeta el nombre exacto de los que ya existen).',
  '- También puedes proponer ejercicios NUEVOS, pero solo si se ajustan a su material y a los grupos musculares del catálogo; nunca copies, reformules ni te acerques a los PROHIBIDOS de la lista.',
  '- Respeta el equipamiento e inventario del usuario: no propongas material que no tenga ni pesos imposibles de cargar.',
  '- Aplica sobrecarga progresiva usando el historial y los récords; indica un peso objetivo concreto por ejercicio.',
  '- Decide tú el descanso óptimo entre series de cada ejercicio (compuestos grandes 180-240 s, auxiliares 90-120 s, aislamientos 60-75 s) y devuélvelo en el campo rest; el usuario no configura los descansos.',
  '- Incluye descansos entre series y justifica brevemente cada decisión del plan.',
  '- Si el usuario pide JSON, devuelve ÚNICAMENTE el JSON, sin texto adicional ni markdown.',
  '- Prioriza seguridad: avisa si detectas señales de sobreentrenamiento o dolor, y recuerda que no eres un médico.',
].join('\n');

/**
 * Se añade al system para que el modelo cierre con un bloque ```memoria``` cuando
 * aprenda algo nuevo: así `extractMemoryBlock` puede separarlo de la respuesta y
 * `applyMemoryEntries` volcarlo en `settings.ai.memory`.
 */
export const MEMORY_INSTRUCTION = [
  'Cuando aprendas algo nuevo y duradero sobre el usuario (preferencias, límites, lesiones, qué le funciona o qué le falla),',
  'cierra EXACTAMENTE tu respuesta con un bloque de memoria en este formato:',
  '```memoria',
  '- dato aprendido, en una sola línea',
  '```',
  'Una línea por dato, sin mezclar el bloque con el resto de la respuesta, y sin duplicar lo que ya aparece en su MEMORIA DEL COACH (la deduplicación final la hace la app): si dudas de si es nuevo, mejor guárdalo.',
  'Si el usuario te pregunta qué debería cambiar o mejorar, la conclusión a la que llegues sobre él también cuenta como aprendizaje: mete el bloque aunque el resto de la respuesta ya lo haya dicho.',
  'Si no hay nada nuevo que guardar, no pongas el bloque.',
].join('\n');

/** Cuántos mensajes de historial se mandan en el chat (el mismo tope que la v1). */
export const CHAT_HISTORY_LIMIT = 12;

/**
 * Cuántos turnos de conversación previa viajan en las tareas que NO son
 * `chat` (`suggest`, `plan`, `analyze`). Menos que los 12 del chat a
 * propósito: ahí el prompt ya es grande (contexto + propuesta local), y aunque
 * estos turnos van como `contents` —que es más barato que meterlos dentro del
 * prompt— un tope bajo obliga al modelo a mirar lo reciente.
 */
export const PROMPT_HISTORY_LIMIT = 6;

/**
 * Cuántos caracteres de un turno del USUARIO se conservan. Los turnos de
 * `suggest`/`plan` traen peticiones con contexto pegado (récords, material),
 * que es justo lo que hay que recordar, pero un pegado de kB no cabe entero
 * dentro de un tope de turnos.
 */
export const HISTORY_USER_LIMIT = 800;

/**
 * Cuántos caracteres de un turno del MODELO se conservan. Sus respuestas de
 * `suggest`/`plan` son JSON de varios kB que la vista ya guarda como `payload`
 * y resume en su línea visible: reenviar el JSON entero solo engorda la
 * entrada (mismo criterio de acotado que `history.ts` y `context.ts`).
 */
export const HISTORY_MODEL_LIMIT = 600;

/**
 * Historial recortado para viajar como `contents`: solo `user`/`model`, con los
 * espacios colapsados, cada turno dentro de su presupuesto por rol y los
 * últimos `turns` (los más recientes). Los turnos vacíos se descartan, así que
 * `client.buildBody` no manda nunca `parts: ['']`.
 *
 * `buildRequest` lo aplica ANTES de mandar: así el tope de turnos es el mismo
 * con o sin mensajes en blanco de por medio, y el límite por turno se fija en
 * un sitio (este) en vez de en cada vista.
 */
export function boundedHistory(
  history: readonly ChatMessage[] | undefined,
  turns: number,
): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const message of history ?? []) {
    if (message.role !== 'user' && message.role !== 'model') continue;
    const limit = message.role === 'user' ? HISTORY_USER_LIMIT : HISTORY_MODEL_LIMIT;
    const text = trunc(
      String(message.text ?? '')
        .replace(/\s+/g, ' ')
        .trim(),
      limit,
    );
    if (!text) continue;
    out.push({ role: message.role, text });
  }
  const max = Math.max(0, Math.floor(turns));
  /* `slice(-0)` sería `slice(0)` (devolvería TODO), de ahí el cálculo por la
     cola: `out.length - 0` corta exactamente al final */
  return out.slice(Math.max(0, out.length - max));
}

/**
 * Se añade al system SOLO de `chat` para que el modelo pueda proponer ejercicios
 * NUEVOS que no están en la biblioteca: los emite en un bloque ```crear``` (mismo
 * mecanismo que ```memoria```/```consulta```) y `extractCreations` lo separa de la
 * respuesta. La creación NUNCA es automática: la propuesta espera la
 * confirmación del usuario en su tarjeta (`CoachView.CreationCard`).
 *
 * El esquema es `AI_EXERCISE_SCHEMA` (compartido con el generador de Ajustes) y
 * los grupos salen del catálogo, así que la instrucción no se desincroniza.
 */
export const CREATION_INSTRUCTION = [
  'Puedes proponer ejercicios NUEVOS que no estén en la lista, SIEMPRE que se ajusten al EQUIPAMIENTO del usuario y a los grupos musculares, y nunca a uno de los PROHIBIDOS.',
  'Cuando propongas uno, cierra EXACTAMENTE tu respuesta con UN bloque de creación en este formato:',
  '```crear',
  `[${AI_EXERCISE_SCHEMA}]`,
  '```',
  `Campos: "name" (obligatorio, no repetir ninguno de la lista); "group" (una de: ${GROUPS.map((g) => g.key).join(', ')}); "equip" (una clave simple del EQUIPAMIENTO del usuario, o "" si es peso corporal); "type" (${EXERCISE_TYPES.join('|')}); "sets"/"rest"/"repMin"/"repMax" (por defecto 3/120/8/12); "unilateral" (true si es a una mano o por lado) y "desc" (una frase corta).`,
  'Un ejercicio nuevo se propone SIEMPRE con sus atributos completos: sin grupo y material no se puede crear.',
  'Si el ejercicio que quieres proponer YA está en la lista, NO uses el bloque: nómbralo con su nombre exacto.',
  'El bloque describe la propuesta; la app NO la crea hasta que el usuario lo confirme. Si no hay nada nuevo, no pongas el bloque.',
].join('\n');

/**
 * Se añade al system de `chat` y `analyze` para que el modelo pueda PEDIR datos
 * históricos en vez de inventarlos: emite un bloque ```consulta``` y la app le
 * responde con `queryHistory` antes de que conteste. Va después de
 * `MEMORY_INSTRUCTION` y solo en las dos tareas que no piden JSON (en `suggest`
 * y `plan` el bloque estorbaría, ahí manda el HISTORIAL CONSOLIDADO del
 * contexto).
 */
export const CONSULT_INSTRUCTION = [
  'Si necesitas detalles históricos que no están en el contexto, puedes pedirlos ANTES de responder:',
  'emite EXACTAMENTE UN bloque con este formato y la app te responderá con los datos:',
  '```consulta',
  '{"ejercicio":"Press banca","tipo":"full","desde":"YYYY-MM-DD","hasta":"YYYY-MM-DD","limite":30}',
  '```',
  'Campos: "ejercicio" (obligatorio, nombre del ejercicio), "tipo": "full" = detalle de cada sesión, "reciente" = últimas sesiones, "evolucion" = kg×reps por sesión con el delta global; "desde" y "hasta" (fechas opcionales YYYY-MM-DD) y "limite" (sesiones, 30 por defecto).',
  'Un solo bloque por respuesta; no lo mezcles con la respuesta final y espera a que te devolvamos los datos.',
  'NUNCA inventes datos de sesiones, pesos, series o récords que no estén en el contexto: si no los tienes, consulta o dilo claramente.',
  'Antes de consultar, mira el HISTORIAL CONSOLIDADO: ya resume TODO el histórico por ejercicio (nº de sesiones, rango de fechas, primera y última serie, mejor 1RM y las tres últimas), así que solo consulta si necesitas detalle sesión a sesión.',
].join('\n');

/**
 * La petición del usuario como COLA del prompt: en crudo, sin etiqueta y al
 * FINAL, para que lo último que lea el modelo sea lo que se le pide («solo
 * empuje», «sin press banca»…). Aparece SOLO AQUÍ: el historial de turnos se
 * calcula antes de apilar este turno, así que no se duplica. En `chat` no se
 * usa: allí `question` ES el prompt entero.
 */
function questionTail(opts: BuildRequestOpts): string[] {
  const question = opts.question?.trim();
  return question ? ['', question] : [];
}

/**
 * Bloque `local` (propuesta del dispositivo) como DATOS de apertura del prompt:
 * el modelo lo recibe primero, como contexto que puede mejorar, y después vienen
 * las instrucciones y la petición. Cada tarea rotula el bloque a su manera
 * (mismos textos que en la v1).
 */
function localHead(opts: BuildRequestOpts, label: string): string[] {
  if (opts.local === undefined) return [];
  return [label, JSON.stringify(opts.local), ''];
}

function suggestPrompt(opts: BuildRequestOpts): string {
  const unit = opts.unit ?? 'kg';
  const lines = [
    ...localHead(
      opts,
      'Propuesta generada en el dispositivo con sus datos (puedes mejorarla o corregirla):',
    ),
    'Genera el entrenamiento de HOY para este usuario.',
    'Devuelve SOLO un JSON: la forma exacta la fija el esquema de la respuesta (title, focus, rationale[] y exercises[] con name/sets/repMin/repMax/weight/rest/notes).',
    'Restricciones: entre 4 y 7 ejercicios; usa nombres de la lista de ejercicios permitidos siempre que encajen;',
    'si NINGUNO encaja con su material, puedes inventar uno: márcalo con "isNew":true en ese mismo objeto y llévale "group", "equip", "type" (y opcionalmente "unilateral"/"desc"); el resto de nombres siguen teniendo que ser de la lista;',
    `weight en ${unit} (0 si es peso corporal) y debe ser cargable con su inventario;`,
    'ordena de compuesto a aislado; incluye 1 bloque de core;',
    'asigna en rest el descanso óptimo de cada ejercicio (compuestos grandes 180-240 s, auxiliares 90-120 s, aislamientos 60-75 s).',
  ];
  lines.push(...questionTail(opts));
  return lines.join('\n');
}

function planPrompt(opts: BuildRequestOpts): string {
  const lines = [
    ...localHead(
      opts,
      'Base generada en el dispositivo (revisa coherencia con el historial y mejórala si hace falta):',
    ),
    `Planifica la semana de entrenamiento del ${opts.from ?? ''} al ${opts.to ?? ''} (7 días exactos).`,
    `Objetivo del usuario: ${goalLabel(opts.goal ?? 'hipertrofia')} | días de entreno deseados: ${int(opts.daysPerWeek, 4)}.`,
    'Devuelve SOLO un JSON: la forma exacta la fija el esquema de la respuesta (rationale y days[] con date, type, title, focus y exercises[]).',
    'Reglas: respeta exactamente las fechas; usa ejercicios permitidos y, solo si alguno no encaja con el material, inventa uno con "isNew":true + "group"/"equip"/"type" en su objeto; deja al menos 48 h antes de repetir el mismo grupo muscular;',
    'asigna en rest el descanso óptimo de cada ejercicio (compuestos grandes 180-240 s, auxiliares 90-120 s, aislamientos 60-75 s);',
    'los días de descanso van con exercises vacío; ajusta los pesos al historial y al inventario disponible.',
  ];
  lines.push(...questionTail(opts));
  return lines.join('\n');
}

function analyzePrompt(opts: BuildRequestOpts): string {
  const weeks = int(opts.weeks, 6);
  const lines = [
    'Volumen por semana:',
    opts.weeklyBrief ?? '(sin datos de semanas todavía)',
    '',
    `Analiza mi progreso de las últimas ${weeks} semanas y dame conclusiones accionables.`,
    'Estructura en markdown con: 1) Resumen en 3 bullets, 2) Qué está funcionando, 3) Riesgos o desequilibrios, 4) 3 ajustes concretos para la próxima semana.',
    'Sé específico con números y no superes las 400 palabras.',
  ];
  lines.push(...questionTail(opts));
  return lines.join('\n');
}

/**
 * Monta la petición completa para una tarea: `system` (con la memoria, las
 * instrucciones de consulta y de creación y el contexto ya inyectados),
 * `prompt` (que en las tres tareas que no son `chat` CIERRA con la petición del
 * usuario), `json` y el historial acotado con `boundedHistory`.
 *
 * El `opts.history` se usa SIEMPRE: en las CUATRO tareas sale como historial de
 * Gemini (campo `history` de la petición, que `client.ts` convierte en
 * `contents`), con tope de turnos de 12 en `chat` y 6 en el resto. Eso es lo
 * que permite que «los récords que te pasé antes» se cumpla también al pedir un
 * entreno con el chip (P1), y además es más barato y más limpio que meter el
 * transcript como texto DENTRO del prompt.
 */
export function buildRequest(task: CoachTask, opts: BuildRequestOpts = {}): CoachRequest {
  const base = opts.system?.trim() || DEFAULT_SYSTEM;
  let system = opts.memory === false ? base : `${base}\n\n${MEMORY_INSTRUCTION}`;
  const consult = opts.consult !== false && (task === 'chat' || task === 'analyze');
  if (consult) system += `\n\n${CONSULT_INSTRUCTION}`;
  /* SOLO en chat: en suggest/plan manda el JSON (el bloque ```crear``` no cabría
     y los nuevos se piden con "isNew":true dentro del propio ejercicio) y en
     analyze no se propone nada. */
  if (opts.create !== false && task === 'chat') system += `\n\n${CREATION_INSTRUCTION}`;
  if (opts.context) system += `\n\nCONTEXTO DEL USUARIO:\n${opts.context}`;

  const history = boundedHistory(
    opts.history,
    task === 'chat' ? CHAT_HISTORY_LIMIT : PROMPT_HISTORY_LIMIT,
  );

  switch (task) {
    case 'suggest':
      return {
        system,
        prompt: suggestPrompt(opts),
        json: true,
        responseSchema: SUGGEST_RESPONSE_SCHEMA,
        history,
      };
    case 'plan':
      return {
        system,
        prompt: planPrompt(opts),
        json: true,
        responseSchema: PLAN_RESPONSE_SCHEMA,
        history,
      };
    case 'analyze':
      return { system, prompt: analyzePrompt(opts), json: false, history };
    case 'chat':
      return { system, prompt: String(opts.question ?? ''), json: false, history };
  }
}
