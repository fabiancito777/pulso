/**
 * System prompt y peticiones al modelo. Puertos de `DEFAULT_SYSTEM` y de los
 * cuatro `C.suggestWorkout` / `C.planWeek` / `C.analyzeProgress` / `C.chat` de
 * la v1 (`legacy/js/coach.js`), sin tocar la red: aquí solo se montan strings.
 *
 * La semántica es la misma que en la v1:
 *
 * - `suggest` y `plan` piden JSON (eso se traduce en
 *   `responseMimeType: application/json` en `client.ts`);
 * - `analyze` pide markdown de ≤ 400 palabras;
 * - `chat` se lleva los últimos 12 mensajes del historial (como `contents` de
 *   Gemini, que es lo único que va por ahí: el resto de tareas lo mete DENTRO
 *   del prompt como bloque `CONVERSACIÓN PREVIA`, acotado, para que «los
 *   récords que te pasé antes» se cumpla también al pedir un entreno con el
 *   chip);
 * - `opts.question` viaja en TODAS las tareas: en `chat` es el prompt entero y
 *   en el resto se añade al prompt como «Petición del usuario: …» (así los
 *   chips de acción rápida pueden llevar el texto de la caja como contexto);
 * - el contexto del usuario se inyecta SIEMPRE detrás de
 *   `system + "\n\nCONTEXTO DEL USUARIO:\n" + ctx`.
 */
import { AI_EXERCISE_SCHEMA } from '@/domain/ai-exercise';
import { EXERCISE_TYPES, GROUPS, goalLabel } from '@/domain/data';
import { int } from '@/domain/num';
import { trunc } from '@/domain/text';
import type { BuildRequestOpts, CoachRequest, CoachTask } from './types';

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
 * Cuántos mensajes de conversación previa entran en los prompts que NO son
 * `chat` (`suggest`, `plan`, `analyze`). Menos que los 12 del chat a propósito:
 * ahí el historial va como `contents` (tokens de entrada baratos) y aquí se
 * convierte en texto DENTRO del prompt, junto a un contexto que ya es grande.
 */
export const PROMPT_HISTORY_LIMIT = 6;

/**
 * Cuántos caracteres de cada mensaje previo se conservan en ese bloque. Los
 * turnos de `suggest`/`plan` son JSON de varios kB: recortados aportan «qué se
 * pidió y qué se propuso» sin disparar el tamaño del prompt (mismo criterio de
 * acotado que `history.ts` y `context.ts`).
 */
export const PROMPT_HISTORY_MSG_LIMIT = 800;

/**
 * Trozo `CONVERSACIÓN PREVIA` para `suggest`/`plan`/`analyze`.
 *
 * Es la respuesta a «ten en cuenta los récords que te pasé antes»: sin esto,
 * esas tareas solo reciben el turno ACTUAL (`opts.question`) y todo lo que el
 * usuario pegó en mensajes anteriores se perdía. El rol se rotula en
 * castellano, los saltos de línea se colapsan (el bloque es una lista) y cada
 * mensaje se recorta con `trunc`.
 *
 * Devuelve `[]` cuando no hay historial, para no dejar cabeceras vacías.
 */
export function historyPrompt(opts: BuildRequestOpts): string[] {
  const messages = (opts.history ?? [])
    .filter((message) => message.role === 'user' || message.role === 'model')
    .slice(-PROMPT_HISTORY_LIMIT);
  if (!messages.length) return [];
  const lines = messages.map(
    (message) =>
      `- ${message.role === 'user' ? 'usuario' : 'coach'}: ` +
      trunc(message.text.replace(/\s+/g, ' ').trim(), PROMPT_HISTORY_MSG_LIMIT),
  );
  return [
    '',
    'CONVERSACIÓN PREVIA (lo que ya se han dicho en este chat; los datos, ' +
      'récords o preferencias que el usuario pegó ahí siguen en vigor):',
    ...lines,
  ];
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
 * La petición del usuario cuando llega rellena (la caja libre, o el `ask` de un
 * chip de acción rápida con contexto detrás). Va DESPUÉS de las reglas y ANTES
 * del bloque `local`: el JSON de salida sigue mandando, esto es solo contexto
 * adicional que el modelo puede usar para concretar («solo empuje», «sin press
 * banca»…). En `chat` no se usa: allí `question` ES el prompt entero.
 */
function requestContext(opts: BuildRequestOpts): string[] {
  const question = opts.question?.trim();
  return question ? ['', `Petición del usuario: ${question}`] : [];
}

function suggestPrompt(opts: BuildRequestOpts): string {
  const unit = opts.unit ?? 'kg';
  const lines = [
    'Genera el entrenamiento de HOY para este usuario.',
    'Devuelve SOLO un JSON con esta forma exacta:',
    '{"title":"titulo corto","focus":"grupos principales","rationale":["motivo 1","motivo 2"],"exercises":[{"name":"nombre EXACTO de la lista permitida","sets":4,"repMin":8,"repMax":10,"weight":40,"rest":120,"notes":"breve tip"}]}',
    'Restricciones: entre 4 y 7 ejercicios; usa nombres de la lista de ejercicios permitidos siempre que encajen;',
    'si NINGUNO encaja con su material, puedes inventar uno: márcalo con "isNew":true en ese mismo objeto y llévale "group", "equip", "type" (y opcionalmente "unilateral"/"desc"); el resto de nombres siguen teniendo que ser de la lista;',
    `weight en ${unit} (0 si es peso corporal) y debe ser cargable con su inventario;`,
    'ordena de compuesto a aislado; incluye 1 bloque de core;',
    'asigna en rest el descanso óptimo de cada ejercicio (compuestos grandes 180-240 s, auxiliares 90-120 s, aislamientos 60-75 s).',
  ];
  lines.push(...historyPrompt(opts));
  lines.push(...requestContext(opts));
  if (opts.local !== undefined) {
    lines.push(
      '',
      'Propuesta generada en el dispositivo con sus datos (puedes mejorarla o corregirla):',
      JSON.stringify(opts.local),
    );
  }
  return lines.join('\n');
}

function planPrompt(opts: BuildRequestOpts): string {
  const lines = [
    `Planifica la semana de entrenamiento del ${opts.from ?? ''} al ${opts.to ?? ''} (7 días exactos).`,
    `Objetivo del usuario: ${goalLabel(opts.goal ?? 'hipertrofia')} | días de entreno deseados: ${int(opts.daysPerWeek, 4)}.`,
    'Devuelve SOLO este JSON:',
    '{"rationale":"explicación breve del reparto","days":[{"date":"YYYY-MM-DD","type":"entreno|cardio|movilidad|descanso","title":"...","focus":"...","exercises":[{"name":"nombre EXACTO","sets":4,"repMin":8,"repMax":10,"weight":40,"rest":120,"notes":""}]}]}',
    'Reglas: respeta exactamente las fechas; usa ejercicios permitidos y, solo si alguno no encaja con el material, inventa uno con "isNew":true + "group"/"equip"/"type" en su objeto; deja al menos 48 h antes de repetir el mismo grupo muscular;',
    'asigna en rest el descanso óptimo de cada ejercicio (compuestos grandes 180-240 s, auxiliares 90-120 s, aislamientos 60-75 s);',
    'los días de descanso van con exercises vacío; ajusta los pesos al historial y al inventario disponible.',
  ];
  lines.push(...historyPrompt(opts));
  lines.push(...requestContext(opts));
  if (opts.local !== undefined) {
    lines.push(
      '',
      'Base generada en el dispositivo (revisa coherencia con el historial y mejórala si hace falta):',
      JSON.stringify(opts.local),
    );
  }
  return lines.join('\n');
}

function analyzePrompt(opts: BuildRequestOpts): string {
  const weeks = int(opts.weeks, 6);
  const lines = [
    `Analiza mi progreso de las últimas ${weeks} semanas y dame conclusiones accionables.`,
    'Estructura en markdown con: 1) Resumen en 3 bullets, 2) Qué está funcionando, 3) Riesgos o desequilibrios, 4) 3 ajustes concretos para la próxima semana.',
    'Sé específico con números y no superes las 400 palabras.',
    '',
    'Volumen por semana:',
    opts.weeklyBrief ?? '(sin datos de semanas todavía)',
  ];
  lines.push(...historyPrompt(opts));
  if (opts.question?.trim()) lines.push('', opts.question.trim());
  return lines.join('\n');
}

/**
 * Monta la petición completa para una tarea: `system` (con la memoria, las
 * instrucciones de consulta y de creación y el contexto ya inyectados),
 * `prompt`, si se espera JSON (`json`) y, en el chat, los últimos 12 mensajes de
 * historial.
 *
 * El `opts.history` se usa SIEMPRE, pero de dos formas distintas: en `chat`
 * sale como historial de Gemini (campo `history` de la petición, que `client`
 * convierte en `contents`) y en el resto de tareas se inyecta en el prompt como
 * bloque `CONVERSACIÓN PREVIA` (el campo NO se devuelve: si fuera `contents`
 * el modelo lo continuaría en vez de leer la petición de JSON).
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

  switch (task) {
    case 'suggest':
      return { system, prompt: suggestPrompt(opts), json: true };
    case 'plan':
      return { system, prompt: planPrompt(opts), json: true };
    case 'analyze':
      return { system, prompt: analyzePrompt(opts), json: false };
    case 'chat':
      return {
        system,
        prompt: String(opts.question ?? ''),
        json: false,
        history: (opts.history ?? [])
          .filter((message) => message.role === 'user' || message.role === 'model')
          .slice(-CHAT_HISTORY_LIMIT),
      };
  }
}
