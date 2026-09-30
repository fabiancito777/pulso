/**
 * Contenido del sistema de ayuda (spec `help-ux.md` §3.1 y `help-content.md`).
 *
 * Módulo **puro**: solo importa de `domain/` (`norm` para la búsqueda) — ni DOM,
 * ni signals, ni estado de la app. Así los textos se prueban con Vitest en node
 * y el componente no decide nada: `HELP_IDS` es la fuente del tipo, así que un
 * `help="…"` escrito a mano en cualquier `.tsx` lo comprueba `npm run typecheck`.
 *
 * Convenciones de los textos:
 *
 * - `paras` son párrafos CORTOS (≤ 600 caracteres) que el modal pinta como `<p>`
 *   separados; nunca hay HTML, Preact escapa el texto solo.
 * - `see` son chips «Ver también» que cambian de tema dentro del mismo modal y
 *   siempre apuntan a ids que existen (lo vigila `help-content.test.ts`).
 * - Los discos se explican en términos de **discos**, nunca de pares: el
 *   inventario está pasando a unidades (otro bloque lo tiene en marcha).
 *
 * Las entradas de Ajustes (`opt.*`) están conectadas a `SettingsView`: cada
 * `help="opt.…"` de esa vista apunta aquí y `settings-help.test.ts` vigila que
 * no se quede ninguno sin enganchar.
 */
import { norm } from '@/domain/text';

/** Secciones de la guía, en el orden en que se listan. */
export const HELP_SECTIONS = [
  'app',
  'tabs',
  'hoy',
  'entreno',
  'rutinas',
  'calendario',
  'coach',
  'progreso',
  'ajustes',
  'glosario',
] as const;
export type HelpSection = (typeof HELP_SECTIONS)[number];

/** Título visible de cada sección en el índice de la guía. */
export const SECTION_LABELS: Record<HelpSection, string> = {
  app: 'Cómo usar Pulso',
  tabs: 'Las 7 pestañas',
  hoy: 'Pestaña Hoy',
  entreno: 'Durante el entreno',
  rutinas: 'Rutinas',
  calendario: 'Calendario',
  coach: 'Coach IA',
  progreso: 'Progreso',
  ajustes: 'Ajustes que no son obvios',
  glosario: 'Glosario',
};

/** Todos los ids de ayuda, en orden de sección. De aquí sale `HelpId`. */
export const HELP_IDS = [
  /* --- cómo usar la app --- */
  'guide',
  'flow.start',
  'flow.repeat',
  'flow.plan',

  /* --- las 7 pestañas --- */
  'tab.hoy',
  'tab.entrenar',
  'tab.rutinas',
  'tab.calendario',
  'tab.coach',
  'tab.progreso',
  'tab.ajustes',

  /* --- Hoy --- */
  'hoy.plan',
  'hoy.suggest',
  'hoy.kpis',
  'hoy.lastSessions',
  'hoy.tools',

  /* --- entreno (sesión en curso) --- */
  'entreno.suggested',
  'entreno.drag',
  'entreno.entryRest',
  'entreno.platesBtn',
  'entreno.rest',

  /* --- rutinas --- */
  'rutinas.generate',
  'rutinas.rotate',
  'rutinas.autoVsIa',
  'rutinas.source',
  'rutinas.focus',
  'rutinas.schedule',

  /* --- calendario --- */
  'cal.states',
  'cal.kpis',
  'cal.autoplan',
  'cal.planProposal',
  'cal.noKey',

  /* --- coach --- */
  'coach.memory',
  'coach.quick',
  'coach.apiKey',
  'coach.footer',

  /* --- progreso --- */
  'prog.subtitle',
  'prog.kpis',
  'prog.e1rm',
  'prog.prs',
  'prog.consistency',
  'prog.stimulus',

  /* --- ajustes (fase 2: los datos están, la conexión no) --- */
  'opt.goal',
  'opt.level',
  'opt.days',
  'opt.units',
  'opt.autoRest',
  'opt.increment',
  'opt.showRpe',
  'opt.countWarmups',
  'opt.quickFinish',
  'opt.keepAwake',
  'opt.notify',
  'opt.lastTicks',
  'opt.material',
  'opt.plates',
  'opt.bars',
  'opt.exercises',
  'opt.model',
  'opt.thinkingLevel',
  'opt.thinkingBudget',
  'opt.temperature',
  'opt.maxTokens',
  'opt.includeThoughts',
  'opt.systemPrompt',
  'opt.demo',
  'opt.export',
  'opt.wipe',

  /* --- glosario --- */
  'glossary.series',
  'glossary.reps',
  'glossary.volume',
  'glossary.1rm',
  'glossary.rpe',
  'glossary.rest',
  'glossary.streak',
  'glossary.pr',
  'glossary.warmup',
  'glossary.increment',
  'glossary.equipment',
  'glossary.routine',
  'glossary.localPlan',
] as const;

export type HelpId = (typeof HELP_IDS)[number];

export interface HelpTopic {
  id: HelpId;
  section: HelpSection;
  /** cabecera del modal */
  title: string;
  /** 1..n párrafos cortos; el componente los pinta como `<p>` separados */
  paras: readonly string[];
  /** «Ver también»: chips que cambian de tema dentro del mismo modal */
  see?: readonly HelpId[];
}

export const HELP: Record<HelpId, HelpTopic> = {
  /* ---------- cómo usar la app ---------- */
  guide: {
    id: 'guide',
    section: 'app',
    title: 'Guía de la app',
    paras: [
      'Pulso tiene 7 pestañas: Hoy (tu día), Entrenar (la sesión en curso), Rutinas (tus listas guardadas), Calendario (el plan de la semana), Coach (el chat con IA), Progreso (récords y gráficos) y Ajustes (la configuración).',
      'Tres cosas que puedes hacer en dos minutos: empieza la sesión del día desde la tarjeta grande de Hoy; repite una sesión antigua con «Repetir»; y pide la semana entera con «Auto-planificar», con tu clave de IA si la tienes y en el dispositivo si no.',
      'Casi cada opción confusa lleva un botón ⓘ: tócalo y se abre la explicación de esa opción. Aquí llegas a todas, también al glosario.',
    ],
    see: ['flow.start', 'flow.repeat', 'flow.plan'],
  },
  'flow.start': {
    id: 'flow.start',
    section: 'app',
    title: 'Empezar a entrenar',
    paras: [
      'Hoy → tarjeta del día → «Empezar sesión». Si hoy no hay plan, usa «Libre» o elige una rutina desde la pestaña Rutinas.',
      'Marcas cada serie con el botón de la columna «ok» y el descanso arranca solo con el tiempo de ese ejercicio. Al acabar, «Finalizar sesión» guarda la sesión y marca el día como hecho.',
    ],
    see: ['tab.hoy', 'tab.entrenar'],
  },
  'flow.repeat': {
    id: 'flow.repeat',
    section: 'app',
    title: 'Repetir una sesión',
    paras: [
      'Hoy → «Últimas sesiones» → «Repetir» (o Progreso → historial → detalle → «Repetir sesión»): se abre la misma sesión con los pesos de la última vez y con el aviso de repetición de la fecha original.',
      'Solo tienes que ajustar los pesos si ese día vas más fuerte; series, descansos y notas vienen igual.',
    ],
    see: ['hoy.lastSessions', 'tab.progreso'],
  },
  'flow.plan': {
    id: 'flow.plan',
    section: 'app',
    title: 'Auto-planificar la semana',
    paras: [
      'Calendario → «Auto-planificar» (o Hoy → «Plan automático»): la semana se llena sola con tus rutinas, tu material y tu historial.',
      'Con API key la escribe el coach (sello «IA»); sin clave, el planificador de tu dispositivo (sello «local»). En los dos casos la propuesta se muestra ANTES de guardarla: la aplicas con «Aplicar al calendario» o la descartas.',
    ],
    see: ['cal.autoplan', 'cal.planProposal'],
  },

  /* ---------- las 7 pestañas ---------- */
  'tab.hoy': {
    id: 'tab.hoy',
    section: 'tabs',
    title: 'Hoy',
    paras: [
      'Tu día de un vistazo: saludo y tarjeta del día («Empezar sesión», «Planificar semana», «Plan automático»), la tira de la semana, «Recomendado ahora» con la propuesta de entreno de hoy, los KPIs de 7 días, las últimas sesiones con «Repetir», las herramientas (calculadora de discos y temporizador) y, al final, las notas de migración.',
    ],
    see: ['hoy.suggest', 'flow.start'],
  },
  'tab.entrenar': {
    id: 'tab.entrenar',
    section: 'tabs',
    title: 'Entrenar',
    paras: [
      'La sesión en curso: cada ejercicio con sus series (peso, repeticiones y RPE opcional), el descanso con cuenta atrás, las notas y «Finalizar sesión».',
      'Si no hay sesión, aquí la empiezas con «Elegir ejercicios…» o «Empezar en blanco».',
    ],
    see: ['entreno.suggested', 'entreno.drag'],
  },
  'tab.rutinas': {
    id: 'tab.rutinas',
    section: 'tabs',
    title: 'Rutinas',
    paras: [
      'Tus rutinas guardadas: «Nueva rutina» para escribirla a mano, «Generar auto» (plantilla local, sin conexión) y «Sugerir rutina con IA» (necesita clave).',
      'Cada tarjeta tiene Empezar · Ver · Editar · Agendar · Duplicar · Eliminar.',
    ],
    see: ['rutinas.autoVsIa', 'rutinas.source'],
  },
  'tab.calendario': {
    id: 'tab.calendario',
    section: 'tabs',
    title: 'Calendario',
    paras: [
      'El plan semanal o mensual: estado de cada día, detalle del día con su rutina y sus sesiones registradas, y «Auto-planificar» la semana con IA o con el dispositivo.',
    ],
    see: ['cal.states', 'cal.autoplan'],
  },
  'tab.coach': {
    id: 'tab.coach',
    section: 'tabs',
    title: 'Coach',
    paras: [
      'Chat con el coach IA, 6 acciones rápidas (chips) y la «Memoria del coach» editable.',
      'Necesita una API key de Google AI Studio; sin clave, el planificador local sigue funcionando.',
    ],
    see: ['coach.memory', 'coach.apiKey'],
  },
  'tab.progreso': {
    id: 'tab.progreso',
    section: 'tabs',
    title: 'Progreso',
    paras: [
      'KPIs (sesiones, kilos movidos, racha), gráficos de volumen, reparto por grupo muscular, récords (1RM estimado) e historial de sesiones con su detalle.',
    ],
    see: ['prog.e1rm', 'prog.prs'],
  },
  'tab.ajustes': {
    id: 'tab.ajustes',
    section: 'tabs',
    title: 'Ajustes',
    paras: [
      '8 subsecciones: Perfil · Apariencia · Entreno · Equipo · Discos · Ejercicios · Coach AI · Datos. Ahí se configura todo lo que la app propone por defecto.',
    ],
    see: ['opt.goal', 'guide'],
  },

  /* ---------- Hoy ---------- */
  'hoy.plan': {
    id: 'hoy.plan',
    section: 'hoy',
    title: 'Plan de hoy',
    paras: [
      'El botón grande empieza la sesión que toca hoy: la app mira el Calendario, tus rutinas y tu historial para decidir qué te toca.',
      'Si no hay nada programado aparece «Sin plan para hoy»: puedes descansar («Saltar») o usar «Plan automático», que monta la semana entera en el Calendario sin pedirte clave.',
      '«Planificar semana» te lleva al Calendario para asignar rutinas a mano.',
    ],
    see: ['tab.hoy', 'cal.autoplan'],
  },
  'hoy.suggest': {
    id: 'hoy.suggest',
    section: 'hoy',
    title: 'Recomendado ahora',
    paras: [
      'La propuesta de entreno para hoy, calculada con tu historial y tu material, con ejercicios, series × repeticiones y peso.',
      'El sello dice quién la ha hecho: «IA» si la ha escrito el coach con tu clave, «local» si la ha calculado la app en tu dispositivo sin salir de aquí. En los dos casos puedes empezarla tal cual.',
      'Si no te convence, «Recalcular» te da otra al momento; «Mejorar con IA» se la pasa al coach (necesita clave) y «Guardar rutina» la deja en Rutinas para los próximos días.',
    ],
    see: ['flow.plan', 'rutinas.autoVsIa'],
  },
  'hoy.kpis': {
    id: 'hoy.kpis',
    section: 'hoy',
    title: 'KPIs de 7 días',
    paras: [
      'Resumen de los últimos 7 días: «Sesiones 7d» cuenta los días entrenados frente a tu objetivo semanal, «Volumen 7d» suma los kilos movidos y lo compara con la semana anterior, y «Series 7d» las series hechas con los minutos totales de entreno.',
    ],
    see: ['glossary.volume', 'glossary.streak'],
  },
  'hoy.lastSessions': {
    id: 'hoy.lastSessions',
    section: 'hoy',
    title: 'Últimas sesiones',
    paras: [
      'Tus sesiones más recientes con fecha, volumen, duración y grupos musculares. Toca una para ver el detalle de sus series.',
      '«Repetir» (el icono de la flecha) monta otra vez esa sesión con los pesos de la última vez: solo toca ajustarlos si ese día vas más fuerte.',
    ],
    see: ['flow.repeat', 'glossary.volume'],
  },
  'hoy.tools': {
    id: 'hoy.tools',
    section: 'hoy',
    title: 'Herramientas',
    paras: [
      'Dos atajos que funcionan sin sesión: la calculadora de discos te dice qué discos necesitas para un peso con el material que tienes, y el temporizador es una cuenta atrás libre (descansos, isométricos…) con presets.',
      'El temporizador no afecta a tus sesiones: mientras corre se ve en el recuadro de descanso de arriba.',
    ],
    see: ['opt.plates', 'entreno.platesBtn'],
  },

  /* ---------- entreno ---------- */
  'entreno.suggested': {
    id: 'entreno.suggested',
    section: 'entreno',
    title: 'Peso sugerido',
    paras: [
      'El peso que sale en gris («sugerido») está calculado con tu última vez y con las repeticiones que haces hoy: parte de tu 1RM estimado y sube un incremento de progresión si te quedaste cómodo.',
      'Si escribes otro peso, manda el tuyo: la serie deja de ser una sugerencia y ya no se propone nada por ella.',
    ],
    see: ['glossary.1rm', 'opt.increment', 'entreno.drag'],
  },
  'entreno.drag': {
    id: 'entreno.drag',
    section: 'entreno',
    title: 'El peso se arrastra hacia abajo',
    paras: [
      'Al cambiar el peso de una serie, el mismo valor se copia a las de abajo del MISMO ejercicio que estén vacías o pendientes. Nunca sube ni toca las series ya marcadas.',
      'El RPE no se arrastra, y un campo vacío no es cero: si dejas una serie en blanco, sigue esperando dato.',
    ],
    see: ['entreno.suggested', 'glossary.rpe'],
  },
  'entreno.entryRest': {
    id: 'entreno.entryRest',
    section: 'entreno',
    title: 'Descanso de cada ejercicio',
    paras: [
      'Los segundos de descanso que se usan al marcar una serie de este ejercicio. Están junto al nombre, con el texto «descanso: 90 s · pulsa para cambiarlo».',
      'Déjalo en 0 para que se use el tiempo que trae el ejercicio por defecto.',
    ],
    see: ['opt.autoRest', 'glossary.rest'],
  },
  'entreno.platesBtn': {
    id: 'entreno.platesBtn',
    section: 'entreno',
    title: 'Qué discos cargan este peso',
    paras: [
      'El botón «discos» abre la calculadora ya cargada con el peso de ese ejercicio y con tu material real: te enseña qué discos poner en la barra o en la mancuerna, repartidos por igual a los dos lados.',
      'Si el peso no se puede montar con lo que tienes, faltan discos: amplía el inventario en Ajustes → Discos.',
    ],
    see: ['opt.plates', 'opt.material'],
  },
  'entreno.rest': {
    id: 'entreno.rest',
    section: 'entreno',
    title: 'El descanso lo define cada ejercicio',
    paras: [
      'No hay un descanso general único: cada ejercicio trae su tiempo (más para movimientos pesados, menos para aislamientos).',
      'Puedes cambiarlo en el propio ejercicio o dejar que lo ajuste el coach cuando propone la sesión.',
    ],
    see: ['entreno.entryRest', 'opt.autoRest'],
  },

  /* ---------- rutinas ---------- */
  'rutinas.generate': {
    id: 'rutinas.generate',
    section: 'rutinas',
    title: 'Generar rutina automática',
    paras: [
      '«Generar auto» coge una plantilla del catálogo (Full body, Tren superior…) y la rellena con los ejercicios que puedes hacer con tu material, con series, repeticiones y descanso según tu objetivo. Todo se calcula en tu dispositivo, sin conexión.',
      'La propuesta se pinta ANTES de guardarla: si no te convence la descartas y no queda nada guardado.',
    ],
    see: ['rutinas.autoVsIa', 'rutinas.rotate'],
  },
  'rutinas.rotate': {
    id: 'rutinas.rotate',
    section: 'rutinas',
    title: 'Evitar ejercicios de las últimas sesiones',
    paras: [
      'Rotación de ejercicios: evita repetir los que ya has hecho recientemente, para que cambie el estímulo.',
      '«No rotar» repite siempre los mismos; con «3 sesiones» (el valor por defecto) cambia los que aparecían en tus tres últimos entrenos.',
    ],
    see: ['rutinas.generate', 'glossary.routine'],
  },
  'rutinas.autoVsIa': {
    id: 'rutinas.autoVsIa',
    section: 'rutinas',
    title: 'Generar auto y sugerir con IA',
    paras: [
      'Dos formas de conseguir una rutina: «Generar auto» la calcula aquí mismo sin conexión y es siempre rápida; «Sugerir rutina con IA» se la pide al coach para que proponga algo más afinado con tu historial.',
      'La segunda necesita tu API key de Google AI Studio; si no la hay, la app te avisa y te lleva a Ajustes.',
    ],
    see: ['rutinas.generate', 'coach.apiKey'],
  },
  'rutinas.source': {
    id: 'rutinas.source',
    section: 'rutinas',
    title: 'El sello de origen',
    paras: [
      '«IA»: la ha escrito el coach con tu clave. «auto»: la ha generado el planificador de tu dispositivo. «manual»: es tuya, escrita o editada por ti.',
      'El sello dice de dónde viene la rutina; no cambia nada de su contenido.',
    ],
    see: ['rutinas.autoVsIa', 'glossary.localPlan'],
  },
  'rutinas.focus': {
    id: 'rutinas.focus',
    section: 'rutinas',
    title: 'Enfoque',
    paras: [
      'Una frase corta para recordar de qué va la rutina («tren inferior con abdomen»). Aparece bajo el nombre en la tarjeta.',
      'Es solo una etiqueta: no cambia los ejercicios ni el plan.',
    ],
    see: ['glossary.routine'],
  },
  'rutinas.schedule': {
    id: 'rutinas.schedule',
    section: 'rutinas',
    title: 'Agendar rutina',
    paras: [
      'Escribe la rutina en un día concreto del calendario. El día propuesto es el próximo libre y puedes cambiarlo con el selector de fecha.',
      'Si el día ya tenía algo planificado se sustituye por esta rutina; las sesiones ya registradas de ese día no se tocan.',
    ],
    see: ['tab.calendario', 'glossary.routine'],
  },

  /* ---------- calendario ---------- */
  'cal.states': {
    id: 'cal.states',
    section: 'calendario',
    title: 'Estados de un día',
    paras: [
      'Cada día tiene un estado: «Planificado» (hay rutina asignada), «Hecho» (ya has entrenado), «Descanso», «Saltado» (marcaste lo planeado como no hecho) y «Libre» (sin nada).',
      'Un día con sesiones registradas se pone «Hecho» aunque no estuviera planeado: manda lo que de verdad entrenaste.',
    ],
    see: ['tab.calendario', 'cal.kpis'],
  },
  'cal.kpis': {
    id: 'cal.kpis',
    section: 'calendario',
    title: 'Resumen de la semana',
    paras: [
      '«Volumen semanal» son los kilos movidos en los días con sesión, «Planificados» los días con plan (incluidos los completados) y «Series» las series con los minutos de entreno que llevas en la semana.',
    ],
    see: ['glossary.volume', 'cal.states'],
  },
  'cal.autoplan': {
    id: 'cal.autoplan',
    section: 'calendario',
    title: 'Auto-planificar',
    paras: [
      'Pulsa «Auto-planificar» y la semana se llena sola con tus rutinas, tu material y tu historial. Con API key la resuelve el coach (botón «Con IA»); sin clave, el planificador del dispositivo.',
      'Nunca escribe el calendario solo: la propuesta se muestra primero y solo la toca «Aplicar al calendario».',
    ],
    see: ['cal.planProposal', 'cal.noKey'],
  },
  'cal.planProposal': {
    id: 'cal.planProposal',
    section: 'calendario',
    title: 'Propuesta de semana',
    paras: [
      'Así queda la semana propuesta antes de guardarla. El sello dice quién la calculó: «IA» si la ha escrito el coach con tu clave, o el origen del dispositivo si la ha calculado la app aquí mismo.',
      'Puedes aplicarla, regenerarla o descartarla: hasta que confirmes con «Aplicar al calendario», tu plan actual no cambia.',
    ],
    see: ['cal.autoplan', 'glossary.localPlan'],
  },
  'cal.noKey': {
    id: 'cal.noKey',
    section: 'calendario',
    title: 'Sin API key: plan local',
    paras: [
      'Si no has añadido una clave de API, la semana se calcula en tu dispositivo con el planificador local. Funciona igual; solo cambia que no la escribe el coach.',
      'Para usar el coach, añade la clave en Ajustes → Coach AI.',
    ],
    see: ['coach.apiKey', 'cal.autoplan'],
  },

  /* ---------- coach ---------- */
  'coach.memory': {
    id: 'coach.memory',
    section: 'coach',
    title: 'Memoria del coach',
    paras: [
      'Lo que el coach recuerda entre conversaciones: tus lesiones, cuánto llevas entrenando, qué prefieres. Se lo puedes escribir tú y él mismo lo actualiza cuando le das datos.',
      'Si lo vacías, empieza sin contexto. Tiene límite de caracteres: al pasarse se recortan las entradas más antiguas.',
    ],
    see: ['coach.apiKey', 'tab.coach'],
  },
  'coach.quick': {
    id: 'coach.quick',
    section: 'coach',
    title: 'Acciones rápidas',
    paras: [
      'Preguntas de un clic: el coach ya recibe tu historial, tu plan y tu volumen, así que solo tienes que elegir qué quieres que haga.',
      '«Romper un récord» propone cómo atacar tu mejor marca, «Revisar volumen» detecta si estás entrenando demasiado o de menos y «Sugerir entreno» deja la propuesta lista en la pestaña Hoy.',
    ],
    see: ['coach.memory', 'tab.coach'],
  },
  'coach.apiKey': {
    id: 'coach.apiKey',
    section: 'coach',
    title: 'API key del coach',
    paras: [
      'Necesitas una clave gratuita de Google AI Studio para que el chat y el plan semanal usen la IA. Se guarda solo en este navegador y se manda directamente a Google: no pasa por ningún servidor nuestro.',
      'Sin clave la app entera sigue funcionando: la semana y las rutinas las calcula el planificador local. Solo el chat y las propuestas con sello «IA» se quedan sin usar.',
    ],
    see: ['coach.quick', 'cal.noKey'],
  },
  'coach.footer': {
    id: 'coach.footer',
    section: 'coach',
    title: 'Pie de cada respuesta',
    paras: [
      'Datos técnicos de cada respuesta: con qué modelo contestó, cuánto tardó, cuántos tokens gastó (lo que te cobra Google) y si guardó algo nuevo en su memoria.',
      'Si el pie dice «respuesta cortada por maxTokens», sube el máximo de tokens en Ajustes → Coach AI.',
    ],
    see: ['opt.maxTokens', 'opt.model'],
  },

  /* ---------- progreso ---------- */
  'prog.subtitle': {
    id: 'prog.subtitle',
    section: 'progreso',
    title: 'Resumen de Progreso',
    paras: [
      '«N sesiones · N kg movidos · racha N días»: cuántas sesiones has registrado, cuántos kilos has movido en total y cuántos días seguidos llevas entrenando sin saltarte ninguno.',
    ],
    see: ['glossary.volume', 'glossary.streak'],
  },
  'prog.kpis': {
    id: 'prog.kpis',
    section: 'progreso',
    title: 'KPIs de Progreso',
    paras: [
      '«Volumen total» es todo el peso que has movido sumando tus series (peso × repeticiones), «Esta semana» lo mismo solo de esta semana, «Tiempo total» las horas de entreno y «Racha» los días seguidos sin saltarte ninguno.',
      'Los números incluyen las sesiones de ejemplo mientras no las quites (sello «demo»).',
    ],
    see: ['glossary.volume', 'opt.demo'],
  },
  'prog.e1rm': {
    id: 'prog.e1rm',
    section: 'progreso',
    title: 'Progresión y 1RM estimado',
    paras: [
      '1RM = el peso máximo que crees que podrías mover en una sola repetición. Como no cargamos a fallo, se calcula con la fórmula de Epley (peso × (1 + repeticiones/30)) a partir de tu mejor serie marcada.',
      'Sirve para comparar tu progreso aunque cambien las repeticiones: la línea sigue el 1RM estimado de cada sesión y «Récord» es tu máximo histórico.',
    ],
    see: ['glossary.1rm', 'prog.prs'],
  },
  'prog.prs': {
    id: 'prog.prs',
    section: 'progreso',
    title: 'Récords personales',
    paras: [
      'Tus mejores marcas por ejercicio según el 1RM estimado (Epley). Un «récord nuevo» aparece solo cuando superas tu mejor marca anterior, no al repetir el mismo peso.',
      'Toca una fila para llevar ese ejercicio a «Progresión»; «Ver tabla completa» abre la lista entera con su tendencia.',
    ],
    see: ['glossary.1rm', 'prog.e1rm'],
  },
  'prog.consistency': {
    id: 'prog.consistency',
    section: 'progreso',
    title: 'Consistencia',
    paras: [
      'Cuántos días has entrenado en las últimas semanas: tu constancia real, sin contar días sin datos. Cuanto más opaco el cuadrado, más sesiones ese día.',
    ],
    see: ['glossary.streak', 'prog.kpis'],
  },
  'prog.stimulus': {
    id: 'prog.stimulus',
    section: 'progreso',
    title: 'Último estímulo',
    paras: [
      'Cuántos días hace que entrenaste cada zona. Si pasan muchos días (por ejemplo 10 días de espalda), toca darle esa zona pronto.',
    ],
    see: ['tab.progreso', 'glossary.volume'],
  },

  /* ---------- ajustes (fase 2) ---------- */
  'opt.goal': {
    id: 'opt.goal',
    section: 'ajustes',
    title: 'Objetivo principal',
    paras: [
      'Fija cuántas repeticiones, series y descanso propone la app por defecto: fuerza trabaja pocas repeticiones con más descanso, hipertrofia muchas repeticiones con descanso medio y perder grasa series más cortas y rápidas.',
      'También lo usan el coach y el generador automático. No cambia las rutinas que ya tengas.',
    ],
    see: ['opt.level', 'glossary.routine'],
  },
  'opt.level': {
    id: 'opt.level',
    section: 'ajustes',
    title: 'Nivel',
    paras: [
      'Cuánta experiencia tienes (principiante, intermedio o avanzado). De ahí sale cuánto volumen propone la app: a más nivel, más ejercicios y series.',
    ],
    see: ['opt.goal'],
  },
  'opt.days': {
    id: 'opt.days',
    section: 'ajustes',
    title: 'Días de entreno por semana',
    paras: [
      'Cuántos días quieres entrenar cada semana: con eso el planificador reparte tus rutinas y el indicador de Hoy te dice si vas al día con tu objetivo.',
    ],
    see: ['opt.goal', 'hoy.kpis'],
  },
  'opt.units': {
    id: 'opt.units',
    section: 'ajustes',
    title: 'Unidades',
    paras: [
      'Kilos o libras. Solo cambia cómo se muestran los pesos; por dentro todo se guarda y se calcula en kilos, así que no pierdes nada si cambias de unidad.',
    ],
    see: ['glossary.volume'],
  },
  'opt.autoRest': {
    id: 'opt.autoRest',
    section: 'ajustes',
    title: 'Descanso automático al marcar serie',
    paras: [
      'Al marcar una serie empieza solo la cuenta atrás, con el tiempo de ese ejercicio (o con el ajuste general si el ejercicio está a 0).',
      'Si lo apagas, tú decides cuándo descansas: siguen estando los botones de +15 s y «Saltar» del recuadro de descanso.',
    ],
    see: ['entreno.rest', 'glossary.rest'],
  },
  'opt.increment': {
    id: 'opt.increment',
    section: 'ajustes',
    title: 'Incremento de progresión',
    paras: [
      'Cuánto subir el peso cuando la app ve que te quedas cómodo. Con 2,5 kg la sugerencia del próximo entreno sube de 60 a 62,5 kg en vez de repetir 60 kg.',
      'La sugerencia nunca se salta más de un incremento; baja a 1 o 1,25 kg si prefieres progresar poco a poco.',
    ],
    see: ['glossary.increment', 'entreno.suggested'],
  },
  'opt.showRpe': {
    id: 'opt.showRpe',
    section: 'ajustes',
    title: 'Mostrar RPE',
    paras: [
      'RPE = «cómo de duro se sintió» en una escala del 1 al 10 (7 = podrías haber hecho dos repeticiones más, 10 = al fallo).',
      'Al activarlo aparece una columna extra en cada serie. Se guarda y se promedia en la sesión; no arrastra a otras series ni cambia ningún cálculo.',
    ],
    see: ['glossary.rpe', 'entreno.drag'],
  },
  'opt.countWarmups': {
    id: 'opt.countWarmups',
    section: 'ajustes',
    title: 'Contar aproximaciones',
    paras: [
      'Incluir las series de calentamiento en los totales de volumen.',
      'Atención: hoy este interruptor todavía no afecta a los cálculos — el volumen cuenta solo las series con peso de trabajo.',
    ],
    see: ['glossary.warmup', 'glossary.volume'],
  },
  'opt.quickFinish': {
    id: 'opt.quickFinish',
    section: 'ajustes',
    title: 'Finalizar rápido',
    paras: [
      'Quita el aviso «¡Todas las series marcadas! Pulsa Finalizar» que aparece al terminar. Útil si terminas cada sesión y no quieres el recordatorio: el botón «Finalizar» sigue estando siempre.',
    ],
    see: ['opt.autoRest'],
  },
  'opt.keepAwake': {
    id: 'opt.keepAwake',
    section: 'ajustes',
    title: 'Mantener la sesión despierta',
    paras: [
      'Durante la sesión la pantalla no se apaga sola, para que veas el descanso sin tocar el móvil. Desactívalo si te preocupa la batería.',
    ],
    see: ['opt.notify'],
  },
  'opt.notify': {
    id: 'opt.notify',
    section: 'ajustes',
    title: 'Notificaciones del sistema',
    paras: [
      'Para que te avise aunque el móvil esté bloqueado hace falta permiso de notificaciones: es la única forma de que la cuenta atrás termine de sonar con la pantalla apagada.',
      'El botón de prueba manda una ahora mismo para que veas cómo llega.',
    ],
    see: ['opt.keepAwake', 'entreno.rest'],
  },
  'opt.lastTicks': {
    id: 'opt.lastTicks',
    section: 'ajustes',
    title: 'Aviso de los últimos 3 s',
    paras: [
      'Tres pitidos suaves justo antes de terminar el descanso, para que te pongas en posición sin mirar el móvil.',
    ],
    see: ['opt.autoRest'],
  },
  'opt.material': {
    id: 'opt.material',
    section: 'ajustes',
    title: 'Tu material',
    paras: [
      'Marca solo lo que tienes. La app usa esta lista para descartar ejercicios que no puedes hacer y para calcular qué discos necesitas.',
      'Si levantas con barra o mancuernas ajustables, marca también los discos; si solo haces máquinas o peso corporal, no hace falta.',
    ],
    see: ['opt.plates', 'glossary.equipment'],
  },
  'opt.plates': {
    id: 'opt.plates',
    section: 'ajustes',
    title: 'Discos disponibles',
    paras: [
      'El inventario de peso con el que trabaja la calculadora: qué discos tienes y de cuánto. De ahí salen los máximos de barra y de mancuerna.',
      'Si el peso de un ejercicio no se puede montar, te faltan discos o ese material está apagado.',
    ],
    see: ['opt.material', 'entreno.platesBtn'],
  },
  'opt.bars': {
    id: 'opt.bars',
    section: 'ajustes',
    title: 'Peso de la barra y del mango',
    paras: [
      'Cuánto pesa el material vacío (sin discos). La app lo suma al peso que cargas: si tu barra olímpica pesa 20 kg, ponlo aquí o el cálculo saldrá bajo.',
      'En una barra de plástico o una mancuerna de 0 déjalo como está (0 por defecto).',
    ],
    see: ['opt.plates'],
  },
  'opt.exercises': {
    id: 'opt.exercises',
    section: 'ajustes',
    title: 'Biblioteca de ejercicios',
    paras: [
      'De todo el catálogo, cuántos tienes activados (permitidos) y cuántos puedes hacer con tu material. «Prohibidos» son los que has apagado a mano, «Sin material» los que necesitan algo que no tienes y «Propios» los que has creado tú.',
      'Prohibir quita el ejercicio de las propuestas y los buscadores sin borrar tu historial; «Añadir propio» crea uno nuevo.',
    ],
    see: ['opt.material', 'glossary.equipment'],
  },
  'opt.model': {
    id: 'opt.model',
    section: 'ajustes',
    title: 'Modelo',
    paras: [
      'Qué versión de Gemini usa el coach. Los «Flash» son rápidos y baratos y el «Pro» razona más; el recomendado va bien para rutinas y análisis.',
    ],
    see: ['opt.thinkingLevel', 'coach.apiKey'],
  },
  'opt.thinkingLevel': {
    id: 'opt.thinkingLevel',
    section: 'ajustes',
    title: 'Nivel de pensamiento',
    paras: [
      'Cuánto razona el modelo antes de contestar. «Bajo» responde rápido y es la opción por defecto; súbelo si quieres que piense más (rutinas complejas o análisis), porque tardará más y gastará más tokens.',
    ],
    see: ['opt.thinkingBudget', 'opt.temperature'],
  },
  'opt.thinkingBudget': {
    id: 'opt.thinkingBudget',
    section: 'ajustes',
    title: 'Presupuesto de pensamiento',
    paras: [
      'Límite de tokens que el modelo puede usar para pensar. Déjalo vacío para que lo decida él: solo toca esto si usas un modelo 2.5 y quieres forzar más o menos razonamiento.',
      'No afecta si arriba has elegido un nivel de pensamiento.',
    ],
    see: ['opt.thinkingLevel', 'opt.maxTokens'],
  },
  'opt.temperature': {
    id: 'opt.temperature',
    section: 'ajustes',
    title: 'Temperature',
    paras: [
      'Qué de sorprendente es el coach. A 0 repite siempre lo mismo (bien para cálculos exactos); a 1 propone cosas más variadas. Si una rutina te sale siempre igual, súbelo un poco.',
    ],
    see: ['opt.model'],
  },
  'opt.maxTokens': {
    id: 'opt.maxTokens',
    section: 'ajustes',
    title: 'Máximo de tokens de salida',
    paras: [
      'Hasta cuánto puede escribir el coach de una vez (4096 por defecto). Si una rutina se queda a medias, súbelo; si quieres respuestas más cortas, bájalo.',
    ],
    see: ['coach.footer', 'opt.thinkingBudget'],
  },
  'opt.includeThoughts': {
    id: 'opt.includeThoughts',
    section: 'ajustes',
    title: 'Mostrar razonamiento del modelo',
    paras: [
      'Muestra el «pensamiento» del modelo (un resumen de cómo ha llegado a la respuesta). Es para curiosear; apágalo si te aburre o ensucia el chat.',
    ],
    see: ['opt.thinkingLevel'],
  },
  'opt.systemPrompt': {
    id: 'opt.systemPrompt',
    section: 'ajustes',
    title: 'Instrucciones del sistema',
    paras: [
      'Texto que se manda delante de cada petición: cómo debe responder, en qué idioma, qué debe priorizar. Es el «manual de uso» del chat.',
      'Si lo dejas vacío, se restaura el de Pulso en la siguiente llamada.',
    ],
    see: ['coach.memory', 'opt.model'],
  },
  'opt.demo': {
    id: 'opt.demo',
    section: 'ajustes',
    title: 'Datos de ejemplo',
    paras: [
      '«Cargar 8 semanas de ejemplo» rellena Progreso con sesiones inventadas para ver los gráficos antes de tener datos.',
      'Esas sesiones llevan el sello «demo» en el historial y ENTRAN en los gráficos y récords hasta que pulsas «Quitar datos de ejemplo» (Ajustes → Datos).',
    ],
    see: ['prog.kpis', 'tab.progreso'],
  },
  'opt.export': {
    id: 'opt.export',
    section: 'ajustes',
    title: 'Exportar e importar copia',
    paras: [
      'Exportar descarga un archivo JSON con todo (ajustes, material, rutinas, sesiones y calendario) que puedes guardar o pasar a otro móvil.',
      'Importar reemplaza lo que tienes ahora: haz una copia antes.',
    ],
    see: ['opt.wipe'],
  },
  'opt.wipe': {
    id: 'opt.wipe',
    section: 'ajustes',
    title: 'Borrar todo',
    paras: [
      'Borra la cuenta atrás, rutinas, sesiones, calendario y ajustes: la app queda como el primer día. Exporta una copia antes si no quieres perderlo.',
    ],
    see: ['opt.export'],
  },

  /* ---------- glosario ---------- */
  'glossary.series': {
    id: 'glossary.series',
    section: 'glosario',
    title: 'Serie',
    paras: [
      'Un bloque de repeticiones seguidas con el mismo peso: 4 × 10 es 4 series de 10 repeticiones.',
    ],
    see: ['glossary.reps'],
  },
  'glossary.reps': {
    id: 'glossary.reps',
    section: 'glosario',
    title: 'Repetición',
    paras: ['Una vez que subes y bajas el peso; 10 reps son 10 veces.'],
    see: ['glossary.series'],
  },
  'glossary.volume': {
    id: 'glossary.volume',
    section: 'glosario',
    title: 'Volumen (kg movidos)',
    paras: [
      'Peso × repeticiones de todas tus series marcadas: cuánto trabajo has hecho. Se muestra en kilos aunque cambies las unidades.',
    ],
    see: ['glossary.series', 'prog.kpis'],
  },
  'glossary.1rm': {
    id: 'glossary.1rm',
    section: 'glosario',
    title: '1RM',
    paras: [
      'Peso máximo que crees que podrías hacer en una sola repetición; aquí se estima con la fórmula de Epley a partir de tus series con varias repeticiones.',
    ],
    see: ['prog.e1rm', 'prog.prs'],
  },
  'glossary.rpe': {
    id: 'glossary.rpe',
    section: 'glosario',
    title: 'RPE',
    paras: [
      'Esfuerzo percibido del 1 al 10: 7 = aún me quedaban dos repeticiones, 10 = al fallo. Solo se guarda y se promedia en la sesión; no cambia ningún cálculo.',
    ],
    see: ['opt.showRpe', 'entreno.drag'],
  },
  'glossary.rest': {
    id: 'glossary.rest',
    section: 'glosario',
    title: 'Descanso',
    paras: [
      'Tiempo entre series. Lo marca cada ejercicio (más en los pesados, menos en los aislamientos) y puedes cambiarlo en la propia sesión.',
      'Si tienes el descanso automático activado, arranca solo al marcar una serie.',
    ],
    see: ['opt.autoRest', 'entreno.entryRest'],
  },
  'glossary.streak': {
    id: 'glossary.streak',
    section: 'glosario',
    title: 'Racha',
    paras: ['Días seguidos entrenando sin saltarte ninguno.'],
    see: ['prog.consistency'],
  },
  'glossary.pr': {
    id: 'glossary.pr',
    section: 'glosario',
    title: 'Récord personal (PR)',
    paras: [
      'Tu mejor marca en un ejercicio. Aquí se compara por 1RM estimado y no por el peso de una sola serie: por eso «récord nuevo» solo aparece cuando superas tu mejor marca anterior.',
    ],
    see: ['prog.prs', 'glossary.1rm'],
  },
  'glossary.warmup': {
    id: 'glossary.warmup',
    section: 'glosario',
    title: 'Aproximación (serie de calentamiento)',
    paras: [
      'Series ligeras antes de cargar pesado. Hoy no cuentan para el volumen: solo suman las series con peso de trabajo.',
    ],
    see: ['opt.countWarmups', 'glossary.volume'],
  },
  'glossary.increment': {
    id: 'glossary.increment',
    section: 'glosario',
    title: 'Incremento de progresión',
    paras: ['Cuánto sube la sugerencia de peso cuando te quedas cómodo (2,5 kg por defecto).'],
    see: ['opt.increment', 'entreno.suggested'],
  },
  'glossary.equipment': {
    id: 'glossary.equipment',
    section: 'glosario',
    title: 'Material (equipo)',
    paras: [
      'Lo que marcas en Ajustes → Equipo: decide qué ejercicios puede proponerte la app y qué discos puede calcular.',
    ],
    see: ['opt.material', 'opt.plates'],
  },
  'glossary.routine': {
    id: 'glossary.routine',
    section: 'glosario',
    title: 'Rutina, plantilla y sesión',
    paras: [
      'Rutina = tu lista guardada; plantilla = punto de partida de «Generar auto»; sesión = lo que entrenas hoy y se guarda en el historial.',
    ],
    see: ['rutinas.generate', 'tab.entrenar'],
  },
  'glossary.localPlan': {
    id: 'glossary.localPlan',
    section: 'glosario',
    title: 'Plan local vs. IA',
    paras: [
      'Quién calcula un plan: el generador de tu dispositivo (sin clave) o el coach con tu clave de API. El sello de la propuesta dice cuál ha sido.',
    ],
    see: ['cal.planProposal', 'coach.apiKey'],
  },
};

/** El tema de un id (el tipo lo garantiza; `HELP_IDS` lo comprueba en test). */
export function topic(id: HelpId): HelpTopic {
  return HELP[id];
}

/** Todos los temas agrupados por sección, en el orden de `HELP_SECTIONS`. */
export function topicsBySection(): { section: HelpSection; topics: HelpTopic[] }[] {
  const bySection = new Map<HelpSection, HelpTopic[]>();
  for (const id of HELP_IDS) {
    const t = HELP[id];
    const bucket = bySection.get(t.section);
    if (bucket) bucket.push(t);
    else bySection.set(t.section, [t]);
  }
  return HELP_SECTIONS.filter((section) => bySection.has(section)).map((section) => ({
    section,
    topics: bySection.get(section) ?? [],
  }));
}

/**
 * Búsqueda insensible a acentos, mayúsculas y signos (reutiliza `norm` de
 * `domain/text`). Todos los términos tienen que coincidir; sin nada que
 * buscar devuelve `[]` (no el catálogo entero).
 */
export function searchHelp(q: string): HelpTopic[] {
  const needle = norm(q);
  if (!needle) return [];
  const terms = needle.split(' ').filter(Boolean);
  return HELP_IDS.map((id) => HELP[id]).filter((t) => {
    const hay = norm(`${t.id} ${t.title} ${t.paras.join(' ')}`);
    return terms.every((term) => hay.includes(term));
  });
}
