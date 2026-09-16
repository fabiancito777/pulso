# Pulso · entrenamiento, progreso y coach AI

App de entrenamiento personal en **HTML + CSS + JS vanilla**, sin dependencias, sin build y sin
servidores propios. Todos los datos viven en tu dispositivo (`localStorage`). El coach con IA es
opcional y usa **tu propia API key de Gemini**.

---

## Cómo abrirla

**Opción A · doble clic**
Abre `index.html` en el navegador. Funciona directamente: la API de Gemini permite CORS desde
`file://`, así que el coach AI también funciona así.

**Opción B · servidor local (recomendado)**
Garantiza que `localStorage` siempre esté disponible (algunos navegadores lo restringen en `file://`):

```bash
cd /Users/fama/Documents/cline
python3 -m http.server 8080
# abre http://localhost:8080
```

En el móvil: sirve la carpeta y abre la IP de tu ordenador, o añádela a la pantalla de inicio
(la interfaz es mobile-first, con navegación inferior y soporte de área segura/notch).

---

## Qué incluye

### Hoy / Entrenar
- Sesión activa con **marcado de series** (peso × reps × check), añadir/quitar series y ejercicios,
  reordenar, notas por ejercicio y cronómetro total de la sesión.
- **Timer de descanso integrado en la sesión**: al marcar una serie, el propio **recuadro de sesión en
  curso** se convierte en la cuenta atrás (anillo + tiempo + ejercicio + `−15 s / +15 s / Saltar`); al
  terminar vuelve a mostrar el progreso de la sesión. Si navegas a otra pestaña queda como barra flotante
  compacta. El cómputo es por timestamp, así que la cuenta atrás es correcta aunque la pestaña quede en
  segundo plano o el móvil se bloquee.
- **El descanso no se configura a mano**: lo define cada ejercicio en la biblioteca (compuestos grandes
  ~180-240 s, auxiliares ~90-120 s, aislamientos ~60-75 s) y el coach IA puede ajustarlo por sesión.
  En la pantalla de sesión solo se muestra el tiempo sugerido.
- **Aviso de fin aunque no estés mirando la app**: al terminar suena el pitido, vibra y lanza una
  **notificación del sistema**; con la app en segundo plano la lanza el *service worker* (`sw.js`), y con el
  móvil bloqueado la recibes si instalas la app como PWA (Añadir a pantalla de inicio; en iOS es
  requisito, 16.4+). El aviso es un **pitido largo (~3,5 s) + vibración + notificación**: mientras hay
  sesión activa la app mantiene su audio en segundo plano (un audio en silencio en bucle) para que el
  navegador no la congele con el móvil bloqueado, y además el aviso queda **programado en el service
  worker** desde que empieza el descanso, de modo que salta aunque la app quede congelada o cerrada.
  Durante la sesión la pantalla se mantiene encendida (Wake Lock) y se recupera al volver a la app.
- **Autollenado progresivo**: cada serie se rellena con el peso sugerido a partir de tu última sesión
  del mismo ejercicio (fórmula de Epley) + tu incremento configurado.
- **Calculadora de discos** integrada (y como herramienta suelta) con **modo de carga**: barra, **1
  mancuerna** (unilateral) o **2 mancuernas** cargables. El mismo inventario no rinde igual en cada caso
  (dos mancuernas necesitan el doble de discos para el mismo peso), así que calcula discos **por lado o
  por extremo**, busca el **peso más cercano** al pedido (nunca uno imposible de montar), propone las dos
  alternativas de al lado y aplica el peso real al ejercicio. El modo se recuerda por ejercicio.
- **Inventario en kg o lb (mezclables)**: cada disco guarda su medida y su unidad; el cálculo se hace
  **siempre en kilogramos** y el resultado se muestra en ambas unidades (p. ej. un disco de 45 lb aparece
  como «20,41 kg · 45 lb»), también el máximo cargable y la equivalencia del objetivo.
- Repetir cualquier sesión anterior con los pesos que usaste, entrenamiento libre, o el plan del día.
- Panel del día: tira semanal, KPIs (sesiones, volumen, series), últimas sesiones.

### Rutinas
- Biblioteca de rutinas propias (crear, editar, duplicar, borrar, agendar, empezar).
- Editor con series, rango de repeticiones y descanso por ejercicio.
- **9 plantillas** (full body, push/pull/legs, torso, pierna, cardio, movilidad) que se materializan
  usando solo ejercicios permitidos y disponibles con tu equipamiento.
- Generador automático (rotando ejercicios que ya hiciste recientemente) y generador con IA.

### Plan (calendario)
- Vista semanal con estado por día (planificado / hecho / descanso / saltado) y navegación entre semanas.
- Asignar cualquier rutina a un día, o guardar un plan de ejercicios concreto para ese día.
- **Auto-planificación semanal**: heurística local o plan con IA, con al menos 48 h entre grupos
  musculares, días de descanso activo y pesos sugeridos desde tu historial.
- Vista mensual con heatmap de adherencia y resumen semanal (volumen por grupo, planificadas vs hechas).

### Coach AI (Gemini)
- Chat con contexto real: perfil, objetivo, equipamiento, inventario de discos, ejercicios permitidos y
  prohibidos, historial reciente, días desde el último estímulo por grupo, récords y plan de la semana.
- Acciones rápidas: sesión de hoy, plan de la semana, análisis de progreso, revisión de volumen,
  plan para romper un récord.
- Decide el **descanso óptimo por ejercicio** (compuestos 180-240 s, auxiliares 90-120 s, aislamientos
  60-75 s): el usuario no configura descansos, la plantilla o el coach los proponen.
- Configurable desde la app: **API key**, **modelo** (lista curada + carga de modelos reales de tu cuenta),
  **thinking level** (`minimal|low|medium|high` o auto), **thinking budget** (modelos 2.5), mostrar u
  ocultar el resumen de razonamiento (`includeThoughts`), temperature, máximo de tokens y system prompt.
- Botón de prueba de conexión con diagnóstico de errores.
- **Todo funciona sin IA**: el planificador local cubre sugerencias y plan semanal sin key.

### Progreso (estadísticas)
- KPIs: volumen total y semanal (con % vs semana previa), sesiones, series, tiempo, racha actual y mejor racha.
- Gráficos SVG propios (sin librerías): volumen por semana, sesiones, series, minutos, donut de reparto
  por grupo muscular, barras por grupo, frecuencia por día de la semana, heatmap de consistencia.
- Progresión por ejercicio: 1RM estimado en el tiempo, récord, volumen acumulado, comparativa vs primera sesión.
- Tabla de récords personales con sparkline por ejercicio.
- Historial completo de sesiones con detalle (PRs detectados, series, duración, notas), repetir o borrar.
- Rangos: 4 / 8 / 12 semanas / 6 meses / todo.

### PWA (instalable y sin conexión)
- **Se instala como app** (Añadir a pantalla de inicio / icono de instalar del navegador) y abre a pantalla
  completa, sin barra del navegador. Desde *Ajustes → Datos → Instalar como aplicación* hay un botón que usa el
  diálogo nativo si está disponible y, si no (p. ej. Safari en iOS), explica los pasos.
- **Funciona sin conexión**: el *service worker* (`sw.js`) cachea el shell (HTML, CSS, JS e iconos) la primera
  vez y luego sirve **network-first con respaldo en caché**, así que online siempre entra la versión nueva y
  offline abre igual. Los datos ya eran locales, así que todo queda disponible.
- Las notificaciones de fin de descanso siguen funcionando con la app en segundo plano o el móvil bloqueado
  (requiere servirla por `http/https` y, en iOS, tenerla instalada).

### Ajustes
- **Perfil**: nombre, nivel, objetivo (hipertrofia, fuerza, perder grasa, salud), días/semana, unidades kg/lb.
- **Apariencia**: tema **AMOLED (negro puro #000)**, oscuro o claro; 10 acentos de color; sonido y volumen;
  vibración; notificaciones; mantener pantalla encendida durante la sesión.
- **Entreno**: descanso automático (tiempo definido por ejercicio/plantilla o por el coach IA), incremento de progresión, RPE, etc.
- **Equipo**: 49 piezas en 6 categorías (barras, mancuernas, estructuras, máquinas, bancos, accesorios,
  cardio) con presets: casa básica, gimnasio completo, todo, solo peso corporal.
- **Discos**: inventario editable (medida × **pares** × disponible; un par = 2 discos, y se reparten entre
  los huecos), peso de barra/barra EZ/mango (**0 kg si es de plástico**), máximo cargable en barra y por
  mancuerna, y gráfico del inventario.
- **Ejercicios**: biblioteca de **136 ejercicios** con buscador y filtros (grupo, permitidos, prohibidos,
  sin material, propios). Permite **permitir/prohibir** individualmente o en bloque todo lo filtrado,
  y crear/editar/borrar ejercicios propios.
- **Coach AI**: toda la configuración descrita arriba.
- **Datos**: exportar/importar copia JSON, cargar 8 semanas de ejemplo para ver las gráficas,
  quitarlas, borrar todo y ver el espacio usado.

---

## Privacidad y datos

- Sesiones, rutinas, ajustes, inventario y la API key se guardan **solo en `localStorage` de tu navegador**.
- No hay backend propio ni analítica. La única salida de red es la llamada al endpoint de Gemini
  (`generativelanguage.googleapis.com`) cuando usas el coach, con la key que tú pegas.
- Exporta una copia desde *Ajustes → Datos* de vez en cuando: borrar los datos del navegador borra la app.

## Modelos y thinking (comprobado a sep-2026)

- Endpoint: `POST https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent?key=…`
- `generationConfig.thinkingConfig.thinkingLevel`: `minimal | low | medium | high` (modelos Gemini 3).
- `generationConfig.thinkingConfig.thinkingBudget`: modelos 2.5 (`0` lo desactiva, `-1` dinámico).
  Es mutuamente excluyente con `thinkingLevel`: en la app, si eliges un nivel se ignora el budget.
- `thinkingConfig.includeThoughts: true` devuelve el resumen de razonamiento (se muestra plegable en el chat).
- Modelos sugeridos por defecto: `gemini-3.8-flash` (recomendado), `3.7`, `3.6`, `3.5`, `3.5-flash-lite`,
  `3.1-flash-lite`, `2.5-flash`, `2.5-pro`. Puedes cargar la lista real de tu cuenta con *Cargar modelos*.

### Qué recibe exactamente el coach (transparencia del contexto)

Cada petición a Gemini lleva, como `systemInstruction`, el contexto generado por `buildContext()` en
`js/coach.js`. Se envía **en todas las funciones del coach** (chat, sesión de hoy, plan semanal y análisis):

1. **Perfil**: nombre, nivel, objetivo, días/semana, unidades, incremento, descanso base y rangos objetivo
   (series/reps/descanso derivados del objetivo).
2. **Equipamiento** activo e **inventario de discos en kg** (con el original en lb entre paréntesis), barra
   principal y máximo cargable.
3. **Biblioteca de ejercicios permitidos** agrupada por músculo (nombres exactos, los únicos que puede
   proponer), más la lista de **prohibidos** y de **no disponibles** por falta de material.
4. **Historial global con datos REALES**: hasta las últimas 16 sesiones con cada serie registrada
   (peso × reps, una a una). Si la sesión salió de una rutina guardada, incluye el **objetivo de la
   plantilla** y el **cumplimiento** (p. ej. «40x8, 40x7, 40x6, 40x6 [objetivo plantilla: 4x10-12 · cumple
   0/4]»): el modelo ve lo que hiciste de verdad, no lo que decía la plantilla.
5. **Estado actual**: días desde el último estímulo por grupo muscular, series y volumen de los últimos
   7 días, y récords (1RM estimado) con fecha.
6. **Rutinas guardadas** (biblioteca, hasta 12): nombre, origen (manual/generador/IA), última vez usada y
   su receta de ejercicios con series/reps/descanso. Va etiquetada como **prescripción**, claramente
   separada de lo realizado, para que el modelo no la confunda con tus marcas reales.
7. **Volumen por semana (últimas 8)**: kg, sesiones, series y minutos por semana.
8. **Plan semanal día a día** de la semana en curso con su estado (hecho/descanso/saltado) y los
   ejercicios ya realizados cada día.
9. En el plan semanal y en la sesión de hoy, además se envía la propuesta local generada en el dispositivo
   como base para que el modelo la corrija o mejore.

Con eso el modelo sabe qué entrenaste —y qué no— tanto en tu semana en curso como a nivel global, y de ahí
sale la recomendación de la próxima rutina. La petición sale solo hacia la API de Gemini con tu key; nada
se guarda en servidores propios.

---

## Estructura del proyecto

```
index.html              · shell: appbar, vista, modal de descanso, nav inferior, modales, toasts
sw.js                   · service worker: shell offline (network-first + caché) y notificaciones de descanso
manifest.webmanifest    · PWA instalable (Añadir a pantalla de inicio)
icons/                  · icono de la app (svg + png 192/512)
assets/styles.css       · design system (temas AMOLED/dark/light, componentes)
js/core.js              · utilidades: DOM, fechas, storage con fallback, toasts, modales, audio, iconos, markdown
js/data.js              · grupos musculares, catálogo de equipo, 136 ejercicios, plantillas, ajustes por defecto
js/store.js             · estado + persistencia + analítica (volumen, 1RM, PRs, racha, staleness) + generadores
js/charts.js            · gráficos SVG (barras, líneas/área, donut, barras horizontales, heatmap, sparkline)
js/trainer.js           · sesión activa, timer de descanso, calculadora de discos
js/coach.js             · cliente Gemini, contexto, planificador local, mapeo de respuestas de la IA
js/views-train.js       · pestaña Hoy (sesión activa + panel)
js/views-routines.js    · biblioteca y plantillas
js/views-calendar.js    · semana, día, mes y auto-planificación
js/views-coach.js       · chat y acciones rápidas
js/views-stats.js       · progreso y gráficos
js/views-settings.js    · todos los ajustes
js/app.js               · router, delegación de eventos, tema, modales/helpers de UI, arranque y auto-test
```

Sin módulos ES a propósito: se puede abrir con doble clic (`file://`) sin CORS ni bundler.

---

## Notas de desarrollo

- **Auto-test integrado**: añade `?selftest=1` (o `#selftest`) a la URL. Ejecuta 66 comprobaciones
  (equipo, discos, 1RM, planificador, ciclo completo de sesión, calendario, analítica, JSON tolerante,
  markdown, unidades, rutinas, contexto del coach y render de todas las vistas) y muestra el informe.
  Restaura tus datos al terminar. No cubre los flujos de modal: verifícalos a mano.
- **Modo demo**: `?demo=1` carga 8 semanas de sesiones de ejemplo, aplica un plan semanal y deja la app
  con datos para probar gráficos y calendario. Se quitan desde *Ajustes → Datos*.
- Añadir un ejercicio a la biblioteca: una línea en `D.SEED_EXERCISES` de `js/data.js`:
  `E('Nombre', 'grupo', 'material_a&material_b|c', 'compuesto', 4, 8, 12, 150)`.
  El material usa `&` (Y) y `|` (O); cadena vacía = peso corporal. Al recargar, la app fusiona la semilla
  y conserva tus flags de permitido/prohibido.
- Añadir una vista: cualquier objeto en `App.views` con `title`, `icon` y `render(root)`. Para añadir una
  pestaña, amplía `TABS` en `js/app.js`.
- Acciones: todo se maneja por delegación con `data-act`, `data-act-change` (p. ej. inputs) y
  `data-act-input` (búsquedas). Registra handlers en `App.actions['algo:accion']`.

---

## Sugerencias y siguientes pasos

Mejoras que encajan de forma natural si quieres seguir:

1. **Wearables / salud**: importar pasos, sueño y pulso (Apple Health / Google Fit) para correlacionar
   volumen, recuperación y ritmo cardíaco.
3. **Series de aproximación y RIR** con plantillas por ejercicio (calentamiento automático al 40/60/80 %).
4. **Supersets y circuitos**: agrupar ejercicios en bloques con descanso compartido y temporizador encadenado.
5. **Autorregulación**: sugerir el peso de la próxima sesión con doble progresión real (si completas el tope
   de reps en todas las series, sube; si no, mantén) y avisar de estancamientos por ejercicio.
6. **Métricas corporales**: peso, medidas y fotos, con gráficos sobre las mismas líneas temporales.
7. **Sync opcional multicuenta**: hoy todo es local; si quieres compartir entre móvil y PC, lo más simple es
   exportar/importar JSON o montar un backend pequeño (Supabase/Firebase) sin cambiar la arquitectura.
8. **Stack**: si más adelante quieres migrar, el código está separado por responsabilidades (store, planner,
   charts, vistas), así que portar a React/Svelte/Vue o a React Native/Expo sería directo manteniendo el modelo de datos.
9. **i18n**: los textos están en español dentro de los módulos; extraerlos a un diccionario es sencillo.
10. **Más estadísticas**: volumen efectivo por serie, distribución de RPE, tiempo bajo tensión y comparativas
    entre bloques de 4 semanas (mesociclos).

## Limitaciones conocidas

- El almacenamiento es por navegador y dispositivo: no se sincroniza solo.
- El 1RM es **estimado** (Epley); sirve para ver tendencias, no es un test real.
- Si cambias de unidad (`kg`/`lb`) los pesos del historial se convierten al mostrarse, pero el inventario
  de discos se interpreta en la unidad activa (avisa la app al cambiarla).
- El pitido de fin de descanso y el aviso con el móvil bloqueado dependen del navegador: en iOS el sonido
  con la app cerrada puede no llegar (ahí la notificación es lo fiable), y si la app se recargó sin que
  tocaras la pantalla el audio en segundo plano puede quedar bloqueado hasta el primer toque.
- La app no sustituye a un profesional sanitario: las sugerencias son orientativas.
