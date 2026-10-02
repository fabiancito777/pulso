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
  'coach.what',
  'coach.sees',
  'coach.learns',
  'coach.memory',
  'coach.quick',
  'coach.generator',
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
      'Pulso tiene 7 pestañas. Hoy es tu día, Entrenar es la sesión en curso, Rutinas son tus listas guardadas, Calendario es el plan de la semana, Coach es el chat con IA, Progreso son tus récords y gráficos, y Ajustes es la configuración.',
      'Para empezar rápido: la tarjeta grande de Hoy arranca el entreno del día. «Repetir» vuelve a montar una sesión antigua. «Auto-planificar» llena la semana, tengas o no clave de IA.',
      'Si algo no queda claro, busca el botón ⓘ que hay al lado y tócalo: te explica esa opción. Desde aquí llegas a todas, también al glosario.',
    ],
    see: ['flow.start', 'flow.repeat', 'flow.plan'],
  },
  'flow.start': {
    id: 'flow.start',
    section: 'app',
    title: 'Empezar a entrenar',
    paras: [
      'Hoy → tarjeta del día → «Empezar sesión». Si hoy no hay plan, elige «Libre» o abre una rutina desde la pestaña Rutinas.',
      'Marca cada serie con el botón «ok» de su fila; el descanso arranca solo. Al terminar, «Finalizar sesión» guarda el entreno y marca el día como hecho.',
    ],
    see: ['tab.hoy', 'tab.entrenar'],
  },
  'flow.repeat': {
    id: 'flow.repeat',
    section: 'app',
    title: 'Repetir una sesión',
    paras: [
      'Hoy → «Últimas sesiones» → «Repetir». También desde Progreso → historial → una sesión → «Repetir sesión».',
      'Se abre el mismo entreno con los pesos de la última vez. Solo cambia el peso si hoy vas más fuerte: las series, los descansos y las notas vienen igual.',
    ],
    see: ['hoy.lastSessions', 'tab.progreso'],
  },
  'flow.plan': {
    id: 'flow.plan',
    section: 'app',
    title: 'Auto-planificar la semana',
    paras: [
      'Calendario → «Auto-planificar». También desde Hoy → «Plan automático». La semana se rellena con tus rutinas, tu material y tu historial.',
      'Con clave la escribe el coach (sello «IA»); sin clave, tu propio dispositivo (sello «local»). En los dos casos verás la propuesta antes de guardarla: la aplicas o la descartas.',
    ],
    see: ['cal.autoplan', 'cal.planProposal'],
  },

  /* ---------- las 7 pestañas ---------- */
  'tab.hoy': {
    id: 'tab.hoy',
    section: 'tabs',
    title: 'Hoy',
    paras: [
      'Tu día de un vistazo: el saludo, la tarjeta del día y la tira de la semana.',
      'Debajo: «Recomendado ahora» con la propuesta de hoy, tus números de los últimos 7 días, las últimas sesiones con «Repetir» y dos herramientas (calculadora de discos y temporizador).',
    ],
    see: ['hoy.suggest', 'flow.start'],
  },
  'tab.entrenar': {
    id: 'tab.entrenar',
    section: 'tabs',
    title: 'Entrenar',
    paras: [
      'La sesión en curso: cada ejercicio con sus series (peso, repeticiones y, si quieres, RPE), el descanso con cuenta atrás, las notas y «Finalizar sesión».',
      'Si no hay ninguna abierta, aquí la empiezas con «Elegir ejercicios…» o «Empezar en blanco».',
    ],
    see: ['entreno.suggested', 'entreno.drag'],
  },
  'tab.rutinas': {
    id: 'tab.rutinas',
    section: 'tabs',
    title: 'Rutinas',
    paras: [
      'Tus rutinas guardadas. Puedes escribir una a mano con «Nueva rutina», generarla sin conexión con «Generar auto» o pedírsela a la IA con «Sugerir rutina con IA».',
      'Cada tarjeta tiene Empezar, Ver, Editar, Agendar, Duplicar y Eliminar.',
    ],
    see: ['rutinas.autoVsIa', 'rutinas.source'],
  },
  'tab.calendario': {
    id: 'tab.calendario',
    section: 'tabs',
    title: 'Calendario',
    paras: [
      'El plan de la semana o del mes. Toca un día y verás su rutina y las sesiones que ya has registrado.',
      '«Auto-planificar» rellena la semana: con IA si tienes clave, o en tu dispositivo si no.',
    ],
    see: ['cal.states', 'cal.autoplan'],
  },
  'tab.coach': {
    id: 'tab.coach',
    section: 'tabs',
    title: 'Coach',
    paras: [
      'El chat con el coach, 6 acciones rápidas y la «Memoria del coach», que puedes editar.',
      'Puede montarte la sesión de hoy, sugerir una rutina, revisar tu volumen o tu reparto por músculo, atacar un récord y generar ejercicios nuevos. Ve tu historial, tu plan y tu material, así que sus propuestas encajan con lo que entrenas.',
      'Necesita una clave de Google AI Studio. Sin ella, la app sigue funcionando con el planificador local.',
    ],
    see: ['coach.what', 'coach.sees', 'coach.apiKey'],
  },
  'tab.progreso': {
    id: 'tab.progreso',
    section: 'tabs',
    title: 'Progreso',
    paras: [
      'Tus números: sesiones, kilos movidos y racha. Debajo, gráficos de volumen, reparto por grupo muscular, récords (el 1RM estimado) e historial de sesiones.',
    ],
    see: ['prog.e1rm', 'prog.prs'],
  },
  'tab.ajustes': {
    id: 'tab.ajustes',
    section: 'tabs',
    title: 'Ajustes',
    paras: [
      'Aquí lo configuras todo. Tiene 8 subsecciones: Perfil, Apariencia, Entreno, Equipo, Discos, Ejercicios, Coach AI y Datos.',
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
      'El peso en gris («sugerido») sale de tu última vez y de las repeticiones de hoy. La app calcula tu 1RM estimado y sube un escalón si la última vez te sobró.',
      'Si escribes otro peso, manda el tuyo: esa serie deja de ser una sugerencia.',
    ],
    see: ['glossary.1rm', 'opt.increment', 'entreno.drag'],
  },
  'entreno.drag': {
    id: 'entreno.drag',
    section: 'entreno',
    title: 'El peso se arrastra hacia abajo',
    paras: [
      'Cuando cambias el peso de una serie, ese valor se copia a las series de abajo del mismo ejercicio que estén vacías o sin marcar.',
      'Nunca sube ni toca las series ya marcadas. El RPE no se copia, y un hueco en blanco no es un cero: sigue esperando su dato.',
    ],
    see: ['entreno.suggested', 'glossary.rpe'],
  },
  'entreno.entryRest': {
    id: 'entreno.entryRest',
    section: 'entreno',
    title: 'Descanso de cada ejercicio',
    paras: [
      'El descanso de este ejercicio, en segundos. Lo tienes al lado del nombre: «descanso: 90 s · pulsa para cambiarlo».',
      'Si lo dejas en 0, se usa el descanso que trae el ejercicio de fábrica.',
    ],
    see: ['opt.autoRest', 'glossary.rest'],
  },
  'entreno.platesBtn': {
    id: 'entreno.platesBtn',
    section: 'entreno',
    title: 'Qué discos cargan este peso',
    paras: [
      'El botón «discos» abre la calculadora con el peso de ese ejercicio ya puesto. Te dice qué discos poner en cada lado, con el material que tienes.',
      'Si un peso no se puede montar, es que te faltan discos: añádelos en Ajustes → Discos.',
    ],
    see: ['opt.plates', 'opt.material'],
  },
  'entreno.rest': {
    id: 'entreno.rest',
    section: 'entreno',
    title: 'El descanso lo define cada ejercicio',
    paras: [
      'Cada ejercicio trae su propio descanso: más largo en los movimientos pesados y más corto en los aislamientos.',
      'Puedes cambiarlo en el propio ejercicio, o dejar que lo ajuste el coach cuando prepara la sesión.',
    ],
    see: ['entreno.entryRest', 'opt.autoRest'],
  },

  /* ---------- rutinas ---------- */
  'rutinas.generate': {
    id: 'rutinas.generate',
    section: 'rutinas',
    title: 'Generar rutina automática',
    paras: [
      '«Generar auto» coge una plantilla (Full body, Tren superior…) y la rellena con ejercicios que puedes hacer según tu material, con series, repeticiones y descanso según tu objetivo.',
      'Se calcula en tu dispositivo, sin conexión. Verás la propuesta antes de guardarla: si no te gusta, la descartas y no se guarda nada.',
    ],
    see: ['rutinas.autoVsIa', 'rutinas.rotate'],
  },
  'rutinas.rotate': {
    id: 'rutinas.rotate',
    section: 'rutinas',
    title: 'Evitar ejercicios de las últimas sesiones',
    paras: [
      'Con la rotación activada, la app evita proponerte los ejercicios que ya hiciste hace poco, para que cambie el estímulo.',
      '«No rotar» repite siempre los mismos. «3 sesiones» (lo normal) cambia los que salieron en tus tres últimos entrenos.',
    ],
    see: ['rutinas.generate', 'glossary.routine'],
  },
  'rutinas.autoVsIa': {
    id: 'rutinas.autoVsIa',
    section: 'rutinas',
    title: 'Generar auto y sugerir con IA',
    paras: [
      'Hay dos formas de conseguir una rutina. «Generar auto» la calcula tu dispositivo al momento y sin conexión. «Sugerir rutina con IA» se la pide al coach, que tiene en cuenta tu historial.',
      'La segunda necesita tu clave de Google AI Studio. Si no la has puesto, la app te avisa y te lleva a Ajustes.',
    ],
    see: ['rutinas.generate', 'coach.apiKey'],
  },
  'rutinas.source': {
    id: 'rutinas.source',
    section: 'rutinas',
    title: 'El sello de origen',
    paras: [
      'El sello dice de dónde sale la rutina. «IA»: la escribió el coach con tu clave. «auto»: la generó tu dispositivo. «manual»: es tuya.',
      'Es solo información: no cambia nada de la rutina.',
    ],
    see: ['rutinas.autoVsIa', 'glossary.localPlan'],
  },
  'rutinas.focus': {
    id: 'rutinas.focus',
    section: 'rutinas',
    title: 'Enfoque',
    paras: [
      'Una frase corta para recordar de qué va la rutina, como «tren inferior con abdomen». Sale debajo del nombre en la tarjeta.',
      'Es solo una etiqueta: no cambia los ejercicios ni el plan.',
    ],
    see: ['glossary.routine'],
  },
  'rutinas.schedule': {
    id: 'rutinas.schedule',
    section: 'rutinas',
    title: 'Agendar rutina',
    paras: [
      'Pone la rutina en un día concreto del calendario. La app te propone el próximo día libre y puedes cambiarlo con el selector de fecha.',
      'Si ese día ya tenía algo planificado, se sustituye por esta rutina. Las sesiones que ya has registrado no se tocan.',
    ],
    see: ['tab.calendario', 'glossary.routine'],
  },

  /* ---------- calendario ---------- */
  'cal.states': {
    id: 'cal.states',
    section: 'calendario',
    title: 'Estados de un día',
    paras: [
      'Cada día tiene un estado: «Planificado» (tiene rutina), «Hecho» (ya entrenaste), «Descanso», «Saltado» (no hiciste lo planeado) y «Libre» (sin nada).',
      'Si un día tiene sesiones registradas se pone «Hecho» aunque no estuviera planeado: manda lo que entrenaste de verdad.',
    ],
    see: ['tab.calendario', 'cal.kpis'],
  },
  'cal.kpis': {
    id: 'cal.kpis',
    section: 'calendario',
    title: 'Resumen de la semana',
    paras: [
      '«Volumen semanal» son los kilos movidos en los días que entrenaste. «Planificados» son los días con plan, incluidos los que ya completaste. «Series» cuenta las series y los minutos de la semana.',
    ],
    see: ['glossary.volume', 'cal.states'],
  },
  'cal.autoplan': {
    id: 'cal.autoplan',
    section: 'calendario',
    title: 'Auto-planificar',
    paras: [
      '«Auto-planificar» rellena la semana con tus rutinas, tu material y tu historial. Con clave lo hace el coach (botón «Con IA»); sin clave, tu dispositivo.',
      'Nunca escribe el calendario por su cuenta: verás la propuesta y solo se guarda si pulsas «Aplicar al calendario».',
    ],
    see: ['cal.planProposal', 'cal.noKey'],
  },
  'cal.planProposal': {
    id: 'cal.planProposal',
    section: 'calendario',
    title: 'Propuesta de semana',
    paras: [
      'Así quedaría la semana antes de guardarla. El sello dice quién la ha calculado.',
      'Puedes aplicarla, pedir otra o descartarla. Hasta que pulses «Aplicar al calendario», tu plan no cambia.',
    ],
    see: ['cal.autoplan', 'glossary.localPlan'],
  },
  'cal.noKey': {
    id: 'cal.noKey',
    section: 'calendario',
    title: 'Sin API key: plan local',
    paras: [
      'Sin clave de API, la semana la calcula tu propio dispositivo. Funciona igual; lo único que cambia es que no la escribe el coach.',
      'Si quieres usar el coach, añade la clave en Ajustes → Coach AI.',
    ],
    see: ['coach.apiKey', 'cal.autoplan'],
  },

  /* ---------- coach ---------- */
  'coach.what': {
    id: 'coach.what',
    section: 'coach',
    title: 'Qué puede hacer el coach',
    paras: [
      'Es un entrenador con IA que vive en la pestaña Coach. Le hablas en lenguaje normal y puede: montarte la sesión de hoy, sugerir una rutina, revisar tu volumen y tu reparto por músculo, decirte cómo atacar un récord, ajustar el plan de la semana y proponerte ejercicios nuevos para tu biblioteca.',
      'No solo contesta: lo que propone se puede llevar a la acción. «Sugerir entreno» deja la sesión en Hoy, el plan de la semana se aplica al Calendario y los ejercicios nuevos se añaden desde Ajustes → Ejercicios.',
    ],
    see: ['coach.sees', 'coach.quick', 'coach.generator'],
  },
  'coach.sees': {
    id: 'coach.sees',
    section: 'coach',
    title: 'Lo que el coach sabe de ti',
    paras: [
      'Antes de responder recibe un resumen de tus datos: el historial reciente (qué series, con qué peso y cuándo), el plan de la semana, el volumen por grupo muscular, tu material activo, tus ejercicios ★ y los que tienes prohibidos.',
      'Con eso ajusta lo que propone a lo que de verdad haces: no te manda a la barra si no tienes barra, ni repite el ejercicio de hace dos días. Y si tus datos no dan para justificar algo, te lo dice en vez de inventárselo.',
    ],
    see: ['coach.learns', 'coach.memory', 'opt.material'],
  },
  'coach.learns': {
    id: 'coach.learns',
    section: 'coach',
    title: 'Cómo aprende de ti',
    paras: [
      'Lo que le cuentas en el chat se guarda en la Memoria del coach: lesiones, cuánto llevas entrenando, lo que te gusta o te sienta mal, tus objetivos. La actualiza él solo y tú puedes corregirla o borrarla.',
      'También aprende de lo que haces: los ejercicios que marcas ★ salen primero en buscadores y generadores, y tu historial le sirve para no repetir estímulos y para ver qué te falta. Cuanto más entrenas con Pulso, mejor te conoce.',
    ],
    see: ['coach.memory', 'opt.exercises'],
  },
  'coach.memory': {
    id: 'coach.memory',
    section: 'coach',
    title: 'Memoria del coach',
    paras: [
      'Lo que el coach recuerda entre conversaciones: tus lesiones, cuánto llevas entrenando, lo que prefieres. Puedes escribirlo tú y él lo va actualizando con lo que le cuentas.',
      'Si lo borras, empieza de cero. Tiene un límite de caracteres: cuando se llena, se van quitando las entradas más antiguas.',
    ],
    see: ['coach.learns', 'coach.apiKey', 'tab.coach'],
  },
  'coach.quick': {
    id: 'coach.quick',
    section: 'coach',
    title: 'Acciones rápidas',
    paras: [
      'Son preguntas de un clic. El coach ya conoce tu historial, tu plan y tu volumen, así que solo eliges qué quieres que haga.',
      '«Sugerir entreno» deja la propuesta en la pestaña Hoy, «Romper un récord» te dice cómo atacar tu mejor marca y «Revisar volumen» mira si entrenas demasiado o muy poco.',
    ],
    see: ['coach.what', 'coach.sees', 'tab.coach'],
  },
  'coach.generator': {
    id: 'coach.generator',
    section: 'coach',
    title: 'Generador de ejercicios nuevos',
    paras: [
      'Está en Ajustes → Ejercicios, con «Generar con IA». Le describes qué buscas (o entras desde un grupo muscular sin ejercicios) y propone ejercicios que aún no tienes, mirando tu historial y tu material.',
      'Es sincero: si lo que pides ya lo cubres, o no tienes datos para justificarlo, te lo dirá y no rellenará con ejercicios de más. Antes de crear nada ves la previsualización con sus avisos (parecido a otro ejercicio, material que no tienes…): eliges cuáles añadir y solo entonces se guardan.',
    ],
    see: ['opt.exercises', 'coach.sees'],
  },
  'coach.apiKey': {
    id: 'coach.apiKey',
    section: 'coach',
    title: 'API key del coach',
    paras: [
      'Para usar el chat y el plan con IA necesitas una clave gratuita de Google AI Studio. Se guarda solo en este navegador y va directa a Google: no pasa por ningún servidor nuestro.',
      'Sin clave la app funciona entera. La semana y las rutinas las calcula tu dispositivo. Solo se quedan sin usar el chat y las propuestas con sello «IA».',
    ],
    see: ['coach.quick', 'cal.noKey'],
  },
  'coach.footer': {
    id: 'coach.footer',
    section: 'coach',
    title: 'Pie de cada respuesta',
    paras: [
      'El pie de cada respuesta dice con qué modelo contestó, cuánto tardó, cuántos tokens gastó (lo que te cobra Google) y si aprendió algo nuevo.',
      'Si lees «respuesta cortada por maxTokens», sube el máximo de tokens en Ajustes → Coach AI.',
    ],
    see: ['opt.maxTokens', 'opt.model'],
  },

  /* ---------- progreso ---------- */
  'prog.subtitle': {
    id: 'prog.subtitle',
    section: 'progreso',
    title: 'Resumen de Progreso',
    paras: [
      'Un resumen de tres datos: las sesiones que llevas registradas, los kilos movidos en total y los días seguidos entrenando sin faltar.',
    ],
    see: ['glossary.volume', 'glossary.streak'],
  },
  'prog.kpis': {
    id: 'prog.kpis',
    section: 'progreso',
    title: 'KPIs de Progreso',
    paras: [
      '«Volumen total» es todo el peso que has movido (peso × repeticiones). «Esta semana» es lo mismo solo de estos días. «Tiempo total» son las horas de entreno y «Racha», los días seguidos sin faltar.',
      'Estos números incluyen las sesiones de ejemplo hasta que las quites (llevan el sello «demo»).',
    ],
    see: ['glossary.volume', 'opt.demo'],
  },
  'prog.e1rm': {
    id: 'prog.e1rm',
    section: 'progreso',
    title: 'Progresión y 1RM estimado',
    paras: [
      'El 1RM es el peso máximo que podrías levantar una sola vez. Como no entrenamos al fallo, se estima con la fórmula de Epley a partir de tu mejor serie.',
      'Sirve para comparar tu progreso aunque cambies de repeticiones. La línea del gráfico sigue ese 1RM estimado y «Récord» es tu mejor marca.',
    ],
    see: ['glossary.1rm', 'prog.prs'],
  },
  'prog.prs': {
    id: 'prog.prs',
    section: 'progreso',
    title: 'Récords personales',
    paras: [
      'Tus mejores marcas por ejercicio, medidas con el 1RM estimado. Un récord nuevo solo aparece cuando superas tu marca anterior, no al repetir el mismo peso.',
      'Toca una fila para ver ese ejercicio en «Progresión», o «Ver tabla completa» para la lista entera.',
    ],
    see: ['glossary.1rm', 'prog.e1rm'],
  },
  'prog.consistency': {
    id: 'prog.consistency',
    section: 'progreso',
    title: 'Consistencia',
    paras: [
      'Cuántos días has entrenado en las últimas semanas. Cuanto más oscuro sale el cuadro, más sesiones hiciste ese día.',
    ],
    see: ['glossary.streak', 'prog.kpis'],
  },
  'prog.stimulus': {
    id: 'prog.stimulus',
    section: 'progreso',
    title: 'Último estímulo',
    paras: [
      'Cuántos días llevas sin entrenar cada zona. Si alguna pasa de muchos días, como 10 en espalda, toca meterle caña pronto.',
    ],
    see: ['tab.progreso', 'glossary.volume'],
  },

  /* ---------- ajustes (fase 2) ---------- */
  'opt.goal': {
    id: 'opt.goal',
    section: 'ajustes',
    title: 'Objetivo principal',
    paras: [
      'De aquí salen las repeticiones, las series y el descanso que propone la app. Fuerza usa pocas repeticiones y descansos largos; hipertrofia, más repeticiones y descanso medio; perder grasa, series cortas y seguidas.',
      'También lo usan el coach y el generador. No cambia las rutinas que ya tengas.',
    ],
    see: ['opt.level', 'glossary.routine'],
  },
  'opt.level': {
    id: 'opt.level',
    section: 'ajustes',
    title: 'Nivel',
    paras: [
      'Tu experiencia (principiante, intermedio o avanzado). Cuanto más alto, más ejercicios y series te propone la app.',
    ],
    see: ['opt.goal'],
  },
  'opt.days': {
    id: 'opt.days',
    section: 'ajustes',
    title: 'Días de entreno por semana',
    paras: [
      'Cuántos días quieres entrenar cada semana. Con eso el planificador reparte tus rutinas y Hoy te dice si vas al día.',
    ],
    see: ['opt.goal', 'hoy.kpis'],
  },
  'opt.units': {
    id: 'opt.units',
    section: 'ajustes',
    title: 'Unidades',
    paras: [
      'Kilos o libras. Solo cambia cómo se ven los pesos: por dentro todo se guarda y se calcula en kilos, así que no pierdes nada al cambiarlo.',
    ],
    see: ['glossary.volume'],
  },
  'opt.autoRest': {
    id: 'opt.autoRest',
    section: 'ajustes',
    title: 'Descanso automático al marcar serie',
    paras: [
      'Al marcar una serie arranca sola la cuenta atrás, con el descanso de ese ejercicio (o el general si el ejercicio está a 0).',
      'Si lo apagas, decides tú cuándo descansar. Los botones de +15 s y «Saltar» siguen ahí.',
    ],
    see: ['entreno.rest', 'glossary.rest'],
  },
  'opt.increment': {
    id: 'opt.increment',
    section: 'ajustes',
    title: 'Incremento de progresión',
    paras: [
      'Cuánto sube la sugerencia cuando la app ve que te sobró fuerza. Con 2,5 kg, si la última vez pusiste 60, la próxima te propondrá 62,5 en vez de repetir 60.',
      'La sugerencia nunca sube más de un escalón. Bájalo a 1 o 1,25 kg si prefieres progresar poco a poco.',
    ],
    see: ['glossary.increment', 'entreno.suggested'],
  },
  'opt.showRpe': {
    id: 'opt.showRpe',
    section: 'ajustes',
    title: 'Mostrar RPE',
    paras: [
      'El RPE es cuánto te costó la serie, del 1 al 10: 7 significa que aún podías hacer dos repeticiones y 10 que fuiste al fallo.',
      'Al activarlo aparece una columna más en cada serie. Se guarda y se promedia, pero no cambia ningún cálculo.',
    ],
    see: ['glossary.rpe', 'entreno.drag'],
  },
  'opt.countWarmups': {
    id: 'opt.countWarmups',
    section: 'ajustes',
    title: 'Contar aproximaciones',
    paras: [
      'Si se activa, las series de calentamiento contarían en el volumen total.',
      'Aviso: de momento no hace nada. El volumen solo cuenta las series de trabajo.',
    ],
    see: ['glossary.warmup', 'glossary.volume'],
  },
  'opt.quickFinish': {
    id: 'opt.quickFinish',
    section: 'ajustes',
    title: 'Finalizar rápido',
    paras: [
      'Quita el aviso «¡Todas las series marcadas! Pulsa Finalizar» que sale al terminar. El botón «Finalizar» sigue estando igual.',
    ],
    see: ['opt.autoRest'],
  },
  'opt.keepAwake': {
    id: 'opt.keepAwake',
    section: 'ajustes',
    title: 'Mantener la sesión despierta',
    paras: [
      'Mientras entrenas, la pantalla no se apaga sola, así ves el descanso sin tocar el móvil. Desactívalo si te importa la batería.',
    ],
    see: ['opt.notify'],
  },
  'opt.notify': {
    id: 'opt.notify',
    section: 'ajustes',
    title: 'Notificaciones del sistema',
    paras: [
      'Para que te avise con el móvil bloqueado hace falta dar permiso de notificaciones. Sin permiso, la cuenta atrás no puede sonar con la pantalla apagada.',
      'El botón de prueba manda una ahora mismo para que veas cómo llega.',
    ],
    see: ['opt.keepAwake', 'entreno.rest'],
  },
  'opt.lastTicks': {
    id: 'opt.lastTicks',
    section: 'ajustes',
    title: 'Aviso de los últimos 3 s',
    paras: [
      'Tres pitidos suaves justo antes de que acabe el descanso, para colocarte sin mirar el móvil.',
    ],
    see: ['opt.autoRest'],
  },
  'opt.material': {
    id: 'opt.material',
    section: 'ajustes',
    title: 'Tu material',
    paras: [
      'Marca solo lo que tengas. Con esta lista la app descarta los ejercicios que no puedes hacer y calcula qué discos necesitas.',
      'Si usas barra o mancuernas ajustables, marca también los discos. Si solo haces máquinas o peso corporal, no hace falta.',
    ],
    see: ['opt.plates', 'glossary.equipment'],
  },
  'opt.plates': {
    id: 'opt.plates',
    section: 'ajustes',
    title: 'Discos disponibles',
    paras: [
      'Los discos que tienes y de cuánto son. Con esto la calculadora sabe el máximo que puedes cargar en la barra y en cada mancuerna.',
      'Si un peso no se puede montar, o te faltan discos o ese material está apagado.',
    ],
    see: ['opt.material', 'entreno.platesBtn'],
  },
  'opt.bars': {
    id: 'opt.bars',
    section: 'ajustes',
    title: 'Peso de la barra y del mango',
    paras: [
      'Cuánto pesa el material vacío, sin discos. La app lo suma a lo que cargas: si tu barra olímpica pesa 20 kg, ponlo aquí o el cálculo saldrá bajo.',
      'Si es una barra de plástico o un mango de 0 kg, déjalo como está.',
    ],
    see: ['opt.plates'],
  },
  'opt.exercises': {
    id: 'opt.exercises',
    section: 'ajustes',
    title: 'Biblioteca de ejercicios',
    paras: [
      'Tu biblioteca, agrupada por músculo. Arriba eliges qué ver: ★ Favoritos, Catálogo, Propios u Ocultos. El atajo «★ Los de mis récords» marca de golpe los que ya tienen marca, y cada fila dice cuándo lo entrenaste, tu mejor 1RM y cuántas veces lo has hecho.',
      '★ son los que salen primero en los buscadores y generadores. «Oculto» solo lo esconde de esta lista. «Prohibido» es el único que lo quita de las propuestas. Para hacer algo con varias filas a la vez, pulsa «Seleccionar».',
    ],
    see: ['coach.generator', 'opt.material', 'glossary.equipment'],
  },
  'opt.model': {
    id: 'opt.model',
    section: 'ajustes',
    title: 'Modelo',
    paras: [
      'Qué versión de Gemini usa el coach. Los «Flash» son rápidos y baratos; el «Pro» razona más. El que viene marcado va bien para rutinas y análisis.',
    ],
    see: ['opt.thinkingLevel', 'coach.apiKey'],
  },
  'opt.thinkingLevel': {
    id: 'opt.thinkingLevel',
    section: 'ajustes',
    title: 'Nivel de pensamiento',
    paras: [
      'Cuánto piensa el modelo antes de responder. «Bajo» contesta rápido y es lo normal. Súbelo para rutinas complicadas o análisis: tardará más y gastará más.',
    ],
    see: ['opt.thinkingBudget', 'opt.temperature'],
  },
  'opt.thinkingBudget': {
    id: 'opt.thinkingBudget',
    section: 'ajustes',
    title: 'Presupuesto de pensamiento',
    paras: [
      'Los tokens que como mucho puede usar el modelo para pensar. Déjalo vacío y lo decide él. Solo toca esto con modelos 2.5, si quieres forzar más o menos razonamiento.',
      'Si arriba has elegido un nivel de pensamiento, este campo no hace nada.',
    ],
    see: ['opt.thinkingLevel', 'opt.maxTokens'],
  },
  'opt.temperature': {
    id: 'opt.temperature',
    section: 'ajustes',
    title: 'Temperature',
    paras: [
      'Cuánto varía el coach al responder. En 0 repite siempre lo mismo, que va bien para cálculos. En 1 propone cosas más distintas. Si una rutina te sale siempre igual, súbelo un poco.',
    ],
    see: ['opt.model'],
  },
  'opt.maxTokens': {
    id: 'opt.maxTokens',
    section: 'ajustes',
    title: 'Máximo de tokens de salida',
    paras: [
      'Cuánto puede escribir el coach de una vez (4096 por defecto). Súbelo si una rutina se queda a medias, bájalo si prefieres respuestas cortas.',
    ],
    see: ['coach.footer', 'opt.thinkingBudget'],
  },
  'opt.includeThoughts': {
    id: 'opt.includeThoughts',
    section: 'ajustes',
    title: 'Mostrar razonamiento del modelo',
    paras: [
      'Muestra un resumen de cómo ha pensado el modelo antes de responder. Es para curiosear; apágalo si ensucia el chat.',
    ],
    see: ['opt.thinkingLevel'],
  },
  'opt.systemPrompt': {
    id: 'opt.systemPrompt',
    section: 'ajustes',
    title: 'Instrucciones del sistema',
    paras: [
      'El texto que se manda delante de cada pregunta: cómo responder, en qué idioma y qué priorizar. Es el manual de uso del chat.',
      'Si lo dejas vacío, vuelve el de Pulso en la siguiente pregunta.',
    ],
    see: ['coach.memory', 'opt.model'],
  },
  'opt.demo': {
    id: 'opt.demo',
    section: 'ajustes',
    title: 'Datos de ejemplo',
    paras: [
      '«Cargar 8 semanas de ejemplo» rellena Progreso con sesiones inventadas, para que veas los gráficos antes de tener datos tuyos.',
      'Esas sesiones llevan el sello «demo» y cuentan para los gráficos y récords hasta que pulses «Quitar datos de ejemplo» en Ajustes → Datos.',
    ],
    see: ['prog.kpis', 'tab.progreso'],
  },
  'opt.export': {
    id: 'opt.export',
    section: 'ajustes',
    title: 'Exportar e importar copia',
    paras: [
      'Exportar descarga un archivo JSON con todo: ajustes, material, rutinas, sesiones y calendario. Sirve como copia o para pasarlo a otro móvil.',
      'Importar sustituye lo que tienes ahora, así que haz una copia antes.',
    ],
    see: ['opt.wipe'],
  },
  'opt.wipe': {
    id: 'opt.wipe',
    section: 'ajustes',
    title: 'Borrar todo',
    paras: [
      'Borra las rutinas, las sesiones, el calendario y los ajustes: la app queda como recién instalada. Haz una copia antes si no quieres perderlo.',
    ],
    see: ['opt.export'],
  },

  /* ---------- glosario ---------- */
  'glossary.series': {
    id: 'glossary.series',
    section: 'glosario',
    title: 'Serie',
    paras: [
      'Un grupo de repeticiones seguidas con el mismo peso. 4 × 10 son 4 series de 10 repeticiones.',
    ],
    see: ['glossary.reps'],
  },
  'glossary.reps': {
    id: 'glossary.reps',
    section: 'glosario',
    title: 'Repetición',
    paras: ['Subir y bajar el peso una vez. 10 reps son 10 veces.'],
    see: ['glossary.series'],
  },
  'glossary.volume': {
    id: 'glossary.volume',
    section: 'glosario',
    title: 'Volumen (kg movidos)',
    paras: [
      'El trabajo que has hecho: peso × repeticiones de todas tus series marcadas. Se muestra en kilos aunque uses libras.',
    ],
    see: ['glossary.series', 'prog.kpis'],
  },
  'glossary.1rm': {
    id: 'glossary.1rm',
    section: 'glosario',
    title: '1RM',
    paras: [
      'El peso máximo que crees que podrías levantar una sola vez. Aquí se estima con la fórmula de Epley a partir de tus series.',
    ],
    see: ['prog.e1rm', 'prog.prs'],
  },
  'glossary.rpe': {
    id: 'glossary.rpe',
    section: 'glosario',
    title: 'RPE',
    paras: [
      'Cuánto te costó la serie, del 1 al 10. 7 es que aún te quedaban dos repeticiones y 10 que fuiste al fallo. Solo se guarda y se promedia.',
    ],
    see: ['opt.showRpe', 'entreno.drag'],
  },
  'glossary.rest': {
    id: 'glossary.rest',
    section: 'glosario',
    title: 'Descanso',
    paras: [
      'El tiempo entre series. Lo marca cada ejercicio (más en los pesados, menos en los aislamientos) y puedes cambiarlo en plena sesión.',
      'Con el descanso automático activado, arranca solo al marcar una serie.',
    ],
    see: ['opt.autoRest', 'entreno.entryRest'],
  },
  'glossary.streak': {
    id: 'glossary.streak',
    section: 'glosario',
    title: 'Racha',
    paras: ['Días seguidos entrenando sin faltar ninguno.'],
    see: ['prog.consistency'],
  },
  'glossary.pr': {
    id: 'glossary.pr',
    section: 'glosario',
    title: 'Récord personal (PR)',
    paras: [
      'Tu mejor marca en un ejercicio. Se compara por 1RM estimado y no por el peso de una serie suelta: por eso un récord nuevo solo sale cuando superas tu marca anterior.',
    ],
    see: ['prog.prs', 'glossary.1rm'],
  },
  'glossary.warmup': {
    id: 'glossary.warmup',
    section: 'glosario',
    title: 'Aproximación (serie de calentamiento)',
    paras: [
      'Series ligeras antes de cargar pesado. De momento no cuentan para el volumen: solo suman las series de trabajo.',
    ],
    see: ['opt.countWarmups', 'glossary.volume'],
  },
  'glossary.increment': {
    id: 'glossary.increment',
    section: 'glosario',
    title: 'Incremento de progresión',
    paras: ['Cuánto sube la sugerencia de peso cuando te sobra fuerza (2,5 kg por defecto).'],
    see: ['opt.increment', 'entreno.suggested'],
  },
  'glossary.equipment': {
    id: 'glossary.equipment',
    section: 'glosario',
    title: 'Material (equipo)',
    paras: [
      'Lo que marcas en Ajustes → Equipo. Decide qué ejercicios te puede proponer la app y qué discos puede calcular.',
    ],
    see: ['opt.material', 'opt.plates'],
  },
  'glossary.routine': {
    id: 'glossary.routine',
    section: 'glosario',
    title: 'Rutina, plantilla y sesión',
    paras: [
      'Rutina es tu lista guardada. Plantilla es el punto de partida de «Generar auto». Sesión es lo que entrenas hoy y se guarda en el historial.',
    ],
    see: ['rutinas.generate', 'tab.entrenar'],
  },
  'glossary.localPlan': {
    id: 'glossary.localPlan',
    section: 'glosario',
    title: 'Plan local vs. IA',
    paras: [
      'Quién calcula un plan: tu dispositivo, sin clave, o el coach con tu clave. El sello de la propuesta te lo dice.',
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
