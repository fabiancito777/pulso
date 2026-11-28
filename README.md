# Pulso · entrenamiento, progreso y coach AI

App de entrenamiento personal hecha con **Vite + TypeScript + Preact**. Todos los datos viven en
tu dispositivo (`localStorage`). El coach con IA es opcional y usa **tu propia API key de Gemini**,
y **todo funciona sin key** (el planificador local cubre sugerencias y plan semanal).

**Web**: <https://fabiancito777.github.io/pulso/> (publicada por Actions desde `main`).

> Las convenciones, la arquitectura y el flujo de entrega están en [AGENTS.md](AGENTS.md).

En móvil, la barra inferior mantiene Hoy, Rutinas, Calendario y Progreso a un toque; **Más** abre un
único menú para Coach y Ajustes. Los enlaces directos siguen funcionando y Más queda marcado en esas
rutas. El acceso a perfiles permanece en la barra superior.

---

## Cómo abrirla

```bash
npm install          # una vez
npm run dev          # http://localhost:5173 — desarrollo con HMR
npm run build        # build de producción en dist/
npm run preview      # sirve el build
```

Verificación completa: `npm run verify` (typecheck + lint + tests + build).

En el móvil: despliega `dist/` en cualquier hosting estático (funciona desde un subdirectorio) o
sírvelo desde tu ordenador y abre su IP; puedes **añadirlo a la pantalla de inicio** (PWA: abre a
pantalla completa y funciona offline).

> Los tests de red del coach (`smoke`/`edge`/`quality`) leen la key de `.env.local` (gitignored) y
> hacen llamadas a Gemini. `npm run test` los excluye (pasada offline); para ejecutarlos:
> `npm run test:net` (o `npm run test:quality` solo el de calidad).

---

## Qué incluye

### Perfiles

- **Varios perfiles en el mismo dispositivo** (hasta 6) con un chip en la barra superior: un toque
  abre la hoja, otro cambia. Cada perfil tiene sus ajustes, equipo, sesiones, rutinas, calendario y
  chat; la **API key del coach se comparte** entre todos.
- Cambiar de perfil con una sesión activa la **guarda en ese perfil** (y avisa); al volver, la
  retomas donde estaba, con su descanso.
- **Gestión** en _Ajustes → Perfil_: crear, usar, renombrar y borrar. El perfil principal usa
  `pulso.state`; los demás, `pulso.state.<id>`, así que los datos existentes no se migran.
- **Backups**: por perfil (formato de siempre) o un archivo con **todos los perfiles**. La key se
  incluye solo si marcas la opción.
- **Sincronización móvil ↔ PC sin cuentas** (_Ajustes → Datos_): un **código de pareja** vincula los
  dispositivos y los datos viajan **cifrados con AES-GCM** (el servidor solo ve un hash y un texto
  cifrado). Las sesiones y rutinas se **suman** (nunca se pisan), los ajustes van por «último cambio
  gana» y, si los dos cambiaron lo mismo, la app **pregunta** antes de decidir. La sesión en curso se
  puede **retomar en el otro dispositivo**. La API key del coach nunca sale del navegador.
  El servidor es un Worker de Cloudflare + KV (`sync-worker/`); para probar sin cuenta,
  `node tools/sync-dev.mjs`.

### Hoy / Entrenar

- El plan del día recoge la sesión prevista. **Ver los N ejercicios** despliega la lista sin arrancar el
  entreno; puedes volver a plegarla antes de empezar.
- **Empezar** es la acción principal del plan; **Saltar** aparece en su menú, marca hoy como descanso y conserva
  la planificación. Puedes usar **Restaurar plan** desde Hoy o Calendario. **Entrenar libre** sigue disponible
  durante el descanso.
- La tarjeta **Última sesión** ofrece **Repetir sesión** con los pesos anteriores. También puedes
  repetir desde las últimas sesiones de Hoy o desde el historial de Progreso.
- Si cambias a otra pestaña con una sesión activa, la barra compacta mantiene el tiempo y el progreso;
  **Retomar sesión** vuelve a Hoy sin cerrar ni finalizarla.
- Sesión activa con **marcado de series** (peso × reps × check), añadir/quitar series y ejercicios,
  reordenar y ver el cronómetro de la sesión. Puedes plegar cada ejercicio para ver solo su avance.
- Al pulsar **Finalizar sesión**, el resumen confirma series, duración y récords nuevos. **Ver detalle**
  despliega volumen, RPE, series por ejercicio y nota; **Listo** cierra la hoja y **Ver progreso** abre
  las estadísticas. Calendario y Repetir quedan como accesos secundarios.
- **Modo súper simple** (_Ajustes → Entreno_). Muestra la sesión activa en negro y lima, con **Finalizar**
  arriba, el progreso y el descanso a la vista, y una tabla para apuntar peso, repeticiones y series.
  Toca **Pulso** para volver a Ajustes sin cerrar la sesión. El modo se guarda por perfil y viene
  apagado de fábrica. En la vista habitual puedes editar el RPE y borrar series.
- **Guías visuales**. En la vista habitual y en modo súper simple, expande cualquiera de los **24
  ejercicios** de la biblioteca predeterminada y toca su miniatura para ver las posturas de inicio y
  final, que se alternan manualmente. **Plancha** muestra una sola postura estática. La sesión y el
  descanso siguen mientras miras la guía.
  En el editor de rutinas, puedes abrir la miniatura de un resultado antes de añadirlo y volver a
  consultar la guía desde la fila del ejercicio añadido. No se infieren guías para ejercicios propios
  ni variantes.
  Las imágenes se sirven con la app. Además de las ilustraciones de Pulso, se usan recursos de
  [Open Exercise Illustrations](https://github.com/hitmanrepo/open-exercise-illustrations/tree/2786aefa4b36a08faeca8114e0d1eb0af3ef6732)
  (CC0) y fotos de [Free Exercise DB](https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5)
  (Unlicense) para los curls de muñeca a un brazo.
- **Consejo del ejercicio y nota personal**. Abre **Ver consejo** para consultar la indicación de la
  rutina o de la biblioteca. En modo súper simple está en `⋯`, junto a **Nota personal**, donde puedes
  guardar cómo te sentiste. En _Ajustes → Entreno_ puedes dejar visibles el consejo y el descanso
  configurado para cada ejercicio.
- **Temporizador de descanso**. En la vista habitual, **Resumen / Descanso** alterna entre el progreso
  y la cuenta atrás, con `−15 s`, `+15 s` y **Saltar**. En el modo súper simple, el resumen sigue
  visible y el descanso tiene su propia fila con `+15 s` y **Saltar**. Puedes seguir viendo la cuenta
  al desplazarte o cambiar de pestaña. El temporizador calcula el tiempo restante a partir de la hora
  de fin, incluso al volver del segundo plano o desbloquear el móvil.
- **El descanso solo arranca cuando tiene sentido**: no salta al marcar la **última** serie de un
  ejercicio (no hay nada entre medias), pero **sí** al terminarlo si te queda otro por hacer —y entonces
  el aviso nombra el **siguiente ejercicio**, que es cuando de verdad cambias de máquina—. En la última
  serie de la sesión no arranca nada, desmarcar una serie lo cancela, `+15 s` con el descanso ya
  terminado arranca una cuenta nueva y los últimos 3 segundos suenan con ticks suaves (Ajustes →
  Apariencia).
- **Editar una serie se aplica hacia abajo**: cambiar el peso (o las reps) de la serie 2 lo copia a las
  siguientes de ese ejercicio; nunca a las de arriba ni a las ya marcadas (esas ya se hicieron). Así no
  repites el mismo peso cuatro veces.
- **Descanso editable**. Puedes cambiarlo en `⋯` durante la sesión, en el editor de rutinas y al
  crear o editar ejercicios propios. Un valor de `0` desactiva el descanso de ese ejercicio. Si no
  tiene un tiempo asignado, se usa el descanso general.
- **Aviso de fin aunque no estés mirando la app**: al terminar suena el pitido, vibra y lanza una
  **notificación del sistema**; con la app en segundo plano la lanza el _service worker_
  (`public/sw.js`), y con el
  móvil bloqueado la recibes si instalas la app como PWA (Añadir a pantalla de inicio; en iOS es
  requisito, 16.4+). El aviso es un **pitido largo (~3,5 s) + vibración + notificación**: el aviso queda
  **programado en el service worker** desde que empieza el descanso, de modo que salta aunque la app
  quede congelada o cerrada. Como último recurso (iOS o navegadores sin service worker), el audio en
  silencio se activa **solo durante el descanso**, para no atenuar otras apps, y se apaga al terminar.
  Durante la sesión la pantalla se mantiene encendida (Wake Lock) y se recupera al volver a la app.
- **Autollenado progresivo**: la sugerencia considera las series de la última sesión, las reps y series
  prescritas, el RPE apuntado y tu incremento configurado. Solo sube si se completan las series previstas
  con las reps objetivo y un esfuerzo razonable; si no, mantiene la carga. Los pesos se comparan en kg,
  aunque cada sesión conserve su unidad. La explicación aparece bajo el ejercicio. Sin historial, el campo
  queda **vacío**; si la carga varió, usa una referencia realmente levantada.
- **RPE por serie opcional** (_Ajustes → Entreno_). Añade una columna en la vista habitual para
  apuntar el esfuerzo de cada serie (1-10). Se guarda con la sesión y aparece en el detalle.
- **Calculadora de discos** integrada (y como herramienta suelta) con **modo de carga**: barra, **1
  mancuerna** (unilateral) o **2 mancuernas** cargables. El mismo inventario no rinde igual en cada caso
  (dos mancuernas necesitan el doble de discos para el mismo peso), así que calcula discos **por lado o
  por extremo**, busca el **peso más cercano** al pedido (nunca uno imposible de montar), propone las dos
  alternativas de al lado y aplica el peso real al ejercicio. El modo se recuerda por ejercicio.
- **Inventario en kg o lb (mezclables)**: cada disco guarda su medida y su unidad; el cálculo se hace
  **siempre en kilogramos** y el resultado se muestra en ambas unidades (p. ej. un disco de 45 lb aparece
  como «20,41 kg · 45 lb»), también el máximo cargable y la equivalencia del objetivo.
- **Repetir cualquier sesión anterior** recupera serie por serie los pesos y repeticiones registrados,
  además del descanso y las indicaciones del ejercicio. Las series nuevas quedan sin marcar, sin RPE ni nota
  personal; la nota original se conserva solo en el historial. También puedes entrenar libre o iniciar el plan del día.
- Panel del día: tira semanal, KPIs (sesiones, volumen, series), últimas sesiones.

### Rutinas

- Biblioteca de rutinas propias (crear, editar, duplicar, borrar, agendar, empezar).
- Las rutinas guardadas aparecen primero; **Nueva rutina** abre opciones para empezar desde cero,
  usar una plantilla local o pedir una propuesta al coach.
- Editor con series, rango de repeticiones y descanso por ejercicio.
- Al editar desde Calendario, el editor trabaja sobre un borrador de ese día. **Guardar plan del día** escribe
  los cambios solo en esa fecha; cancelar descarta el borrador y no crea una rutina ni modifica una compartida.
- **7 plantillas** (Full body A/B, empuje, tirón, pierna, torso completo y pierna + core) que se
  materializan usando solo ejercicios permitidos y disponibles con tu equipamiento.
- Generador automático (rotando ejercicios que ya hiciste recientemente) y generador con IA.

### Plan (calendario)

- Vista semanal en siete filas compactas; al seleccionar un día se abre el mismo detalle que en la vista mensual.
  Incluye estados (planificado / hecho / descanso / saltado) y navegación entre semanas.
- Asignar cualquier rutina a un día, o guardar un plan de ejercicios concreto para ese día.
- **Descanso** conserva el plan previo para restaurarlo. **Limpiar** elimina rutina, ejercicios del plan, tipo,
  título, estado, foco y copia de restauración, pero mantiene las sesiones registradas. **Editar ejercicios del día**
  crea un borrador propio de esa fecha: cancelar no guarda ni crea rutinas y Guardar solo cambia ese día.
- **Auto-planificación semanal**: heurística local o plan con IA, con al menos 48 h entre grupos
  musculares, días de descanso activo y pesos sugeridos desde tu historial.
- Antes de guardar, una vista previa muestra qué fechas y días del calendario cambiarían. Puedes
  aplicar la propuesta, pedir otra o descartarla; el calendario no se modifica hasta **Aplicar al
  calendario**. Sin clave se usa el planificador local; con clave puedes pedir al coach.
- Vista mensual con heatmap de adherencia y resumen semanal (volumen por grupo, planificadas vs hechas).

### Coach AI (Gemini)

- Chat con contexto real: perfil, objetivo, equipamiento, inventario de discos, ejercicios permitidos y
  prohibidos, historial reciente, días desde el último estímulo por grupo, récords y plan de la semana.
- Acciones rápidas: sugerir un entreno, plan de la semana, análisis de progreso, revisión de volumen,
  plan para romper un récord.
- **Sugerir entreno** deja la propuesta como tarjeta en el chat. **Empezar este entreno** inicia esa
  prescripción desde los ejercicios disponibles, sin guardar una rutina; **Guardar como rutina** es
  independiente. Si hay ejercicios nuevos, primero puedes crearlos o descartarlos y luego reintentar.
  Una sesión activa nunca se reemplaza. El historial del chat conserva un resumen corto del orden,
  las series, repeticiones, peso y descanso de las tarjetas, para que el siguiente turno pueda
  modificarlas sin reenviar todo el JSON.
- Propone el **descanso por ejercicio** (compuestos 180-240 s, auxiliares 90-120 s, aislamientos
  60-75 s), que puedes ajustar a mano durante la sesión, en la rutina o en tus ejercicios.
- En Ajustes → Coach AI quedan a la vista la **API key**, su estado y la prueba de conexión. En
  **Avanzado** se configuran el modelo (`gemini-4-hydrogen`, recomendado, o `gemini-3.8-flash` y
  `gemini-3.5-flash-lite` como respaldo), el **thinking level** (`auto|minimal|low|medium|high|xhigh`),
  el resumen de razonamiento (`includeThoughts`), el máximo de tokens, la espera y el system prompt.
  No hay `temperature` ni `thinkingBudget`: Gemini 3 las ignora o no las usa. Hydrogen convierte
  `minimal` en `low` porque rechaza ese nivel.
- **Espera máxima de respuesta**. Se calcula según el nivel de pensamiento o se puede fijar en
  segundos. Mientras espera, la app muestra cuánto tiempo ha pasado y permite cancelar.
- Botón de prueba de conexión con diagnóstico de errores.
- **Todo funciona sin IA**: el planificador local cubre sugerencias y plan semanal sin key. Las propuestas locales
  se identifican como generadas en el dispositivo y pueden aplicarse sin conectar el coach.

### Progreso (estadísticas)

- Puedes abrir una **demostración temporal** con sesiones de ejemplo desde Progreso o Ajustes → Datos. Las sesiones
  de demostración no se mezclan con tu historial guardado ni se sincronizan; salir de la demostración vuelve a tus
  datos reales. También puedes generar otra muestra desde el panel.
- KPIs: volumen total y semanal (con % vs semana previa), sesiones, series, tiempo, racha actual y mejor racha.
- La tarjeta **Esta semana** resume sesiones, series y volumen; **Últimos récords** muestra las marcas
  mejoradas recientemente y permite abrir la tabla completa.
- Busca un ejercicio en el historial para ver su última sesión, mejor marca y curva de 1RM estimado.
- **Ver estadísticas** despliega los gráficos y sus filtros. El historial se lista en la misma vista;
  **Ver todo** abre la lista completa y cada fila abre su detalle, desde donde puedes repetir la sesión.
- Gráficos SVG propios (sin librerías): volumen por semana, sesiones, series, minutos, donut de reparto
  por grupo muscular, barras por grupo, frecuencia por día de la semana, heatmap de consistencia.
- Progresión por ejercicio: 1RM estimado en el tiempo, récord, volumen acumulado, comparativa vs primera sesión.
- Tabla de récords personales con sparkline por ejercicio.
- Historial completo de sesiones con detalle (PRs detectados, series, duración, notas), repetir o borrar.
- Rangos: 4 / 8 / 12 semanas / 6 meses / todo.

### PWA (instalable y sin conexión)

- **Se instala como app** (Añadir a pantalla de inicio / icono de instalar del navegador) y abre a pantalla
  completa, sin barra del navegador. Desde _Ajustes → Datos → Instalar como aplicación_ hay un botón que usa el
  diálogo nativo si está disponible y, si no (p. ej. Safari en iOS), explica los pasos.
- **Funciona sin conexión**: el _service worker_ (`public/sw.js`) cachea el shell (HTML, CSS, JS e iconos) la primera
  vez y luego sirve **network-first con respaldo en caché**, así que online siempre entra la versión nueva y
  offline abre igual. Los datos ya eran locales, así que todo queda disponible.
- Las notificaciones de fin de descanso siguen funcionando con la app en segundo plano o el móvil bloqueado
  (requiere servirla por `http/https` y, en iOS, tenerla instalada).

### Ajustes

- **Perfil**: nombre, nivel, objetivo (hipertrofia, fuerza, perder grasa, salud), días/semana, unidades kg/lb.
- **Apariencia**: tema **AMOLED (negro puro #000)**, oscuro o claro; 10 acentos de color; sonido y volumen;
  vibración; notificaciones; mantener pantalla encendida durante la sesión.
- **Entreno**. Descanso automático, incremento de progresión, RPE, visibilidad del consejo y del
  descanso por ejercicio, y modo súper simple.
- **Equipo**: 49 piezas en 6 categorías (barras, mancuernas, estructuras, máquinas, bancos, accesorios,
  cardio) con presets: casa básica, gimnasio completo, todo, solo peso corporal.
- **Discos**: inventario editable (medida × **discos** × disponible; se cuenta en unidades sueltas y se
  reparten entre los huecos, así que **con un número impar sobra uno**), peso de barra/barra EZ/mango
  (**0 kg si es de plástico**), máximo cargable en barra y por mancuerna, y gráfico del inventario.
- **Ejercicios**: biblioteca por defecto de **24 ejercicios** con buscador y cuatro segmentos
  (★ Favoritos, Catálogo, Propios, Ocultos), además de acordeones por grupo muscular. Permite
  **permitir/prohibir** y marcar como favorito u oculto, individualmente o en bloque, y crear/editar/borrar
  ejercicios propios. El catálogo stock ampliado de versiones anteriores ya no aparece como opciones.
  Al actualizar un perfil antiguo se retiran solo los ejercicios stock que sigan intactos y no estén
  referenciados; se conservan los usados, los editados por el usuario y los propios. El historial sigue
  mostrando el nombre de los ejercicios retirados.
- **Coach AI**: toda la configuración descrita arriba.
- **Entreno**: el diagnóstico «Probar aviso con el móvil bloqueado» está en **Avanzado**.
- **Datos**: exportar/importar copia JSON, cargar 8 semanas de ejemplo para ver las gráficas,
  quitarlas, borrar todo y ver el espacio usado.

---

## Privacidad y datos

- Los datos se guardan en `localStorage`. Si vinculas otro dispositivo, Pulso sincroniza una copia
  cifrada mediante el Worker. La API key se excluye de la sincronización.
- Cuando usas el coach en línea, Pulso envía el contexto descrito abajo a Gemini con tu API key.
  Las notas personales nuevas por ejercicio se guardan aparte, fuera de ese contexto.
- Exporta una copia desde _Ajustes → Datos_ de vez en cuando: borrar los datos del navegador borra la app.

## Modelos y thinking

- Endpoint: `POST https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent`
  (la key va en la cabecera `x-goog-api-key`, nunca en la URL).
- Modelos soportados: `gemini-4-hydrogen` (recomendado), `gemini-3.8-flash` y `gemini-3.5-flash-lite`
  (respaldo). No hay descubrimiento remoto de modelos ni soporte para los 2.5 (usaban `thinkingBudget`).
- `generationConfig.thinkingConfig.thinkingLevel`: `auto | minimal | low | medium | high | xhigh`.
  Hydrogen no acepta `minimal` (HTTP 400): se envía `low` en su lugar.
- `thinkingConfig.includeThoughts: true` devuelve el resumen de razonamiento (se muestra plegable en el chat).
- No se envía `temperature` (Gemini 3 la ignora) ni `thinkingBudget` (es de los modelos 2.5).

### Qué recibe exactamente el coach (transparencia del contexto)

Cada petición a Gemini lleva, como `systemInstruction`, el contexto generado por `buildContext()` en
`src/features/coach/context.ts`. Se envía **en todas las funciones del coach** (chat, sesión de hoy,
plan semanal y análisis):

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
index.html              · entrada de Vite (carga src/main.tsx)
src/main.tsx            · monta <App /> en #app e importa los estilos
src/app/                · shell de la app (App.tsx) y router de pestañas
src/domain/             · NÚCLEO PURO (sin DOM ni estado): discos, analítica, sesión,
                          descanso, planner local, taxonomía, semilla de ejercicios y formatos
src/state/              · estado + persistencia (store, sesión activa, coach, chat)
src/features/coach/     · cerebro del coach: contexto, memoria, historial, prompts,
                          parseo, cliente Gemini y planificador local
src/ui/                 · componentes y vistas Preact (Hoy, Rutinas,
                          Calendario, Coach, Progreso, Ajustes, Onboarding)
src/platform/           · lo que toca el navegador (audio, keep-alive, SW, notify, theme)
src/styles/             · base.css (hoja base) + v2.css y estilos por vista
public/                 · manifest, service worker e iconos de la PWA
```

Regla de dependencias: `domain ← features ← state ← ui`. El dominio no importa nada de
fuera de sí mismo, así que se prueba sin navegador.

---

## Herramientas de desarrollo

| Comando             | Qué hace                                                                |
| ------------------- | ----------------------------------------------------------------------- |
| `npm run dev`       | Servidor de desarrollo con HMR en http://localhost:5173.                |
| `npm run typecheck` | `tsc --noEmit` con `strict`.                                            |
| `npm run lint`      | ESLint con reglas tipadas.                                              |
| `npm run test`      | Vitest offline para dominio, estado y UI.                               |
| `npm run verify`    | typecheck + lint + test + build: la puerta antes de dar algo por bueno. |
| `npm run format`    | Prettier sobre el proyecto.                                             |

---

## Notas de desarrollo

- **Entrega**. Ejecuta `npm run verify`, crea el commit y haz push a la rama remota correspondiente.
  GitHub Actions despliega Pages con los pushes a `main`.
- **Tests**: viven en `src/**/*.test.ts` (Vitest), sin navegador; los flujos de modal y timer
  que no se pueden probar así se verifican con Playwright.
- **Modo demo**: `?demo=1` carga 8 semanas de sesiones de ejemplo con datos para probar gráficos y
  calendario. Se quitan desde _Ajustes → Datos_.
- **Datos base e iconos**: `src/domain/catalog.ts` contiene grupos, material y opciones del coach;
  los ejercicios iniciales están en `src/domain/seed.ts`. Ambos ficheros y `src/ui/icons.ts` se editan
  a mano con cuidado; las comprobaciones de dominio están en `src/domain/data.test.ts`.
- **Añadir un ejercicio**: a la semilla (`src/domain/seed.ts`) o desde _Ajustes → Ejercicios_ (los propios
  se fusionan con la semilla al recargar, conservando tus flags de permitido/prohibido).
- **Añadir una pestaña**: amplía `TABS` en `src/app/router.ts` y añade la vista en `src/ui/`.
- **Estado**: todo pasa por los setters de `src/state/store.ts` (lectura-modificación-escritura),
  nunca se escribe el estado a mano.

---

## Sugerencias y siguientes pasos

Mejoras que encajan de forma natural si quieres seguir:

1. **Wearables / salud**: importar pasos, sueño y pulso (Apple Health / Google Fit) para correlacionar
   volumen, recuperación y ritmo cardíaco.
2. **Series de aproximación y RIR** con plantillas por ejercicio (calentamiento automático al 40/60/80 %).
3. **Métricas corporales**: peso, medidas y fotos, con gráficos sobre las mismas líneas temporales.
4. **Stack**: si más adelante quieres migrar, el código está separado por responsabilidades (store, planner,
   charts, vistas), así que portar a React/Svelte/Vue o a React Native/Expo sería directo manteniendo el modelo de datos.
5. **i18n**: los textos están en español dentro de los módulos; extraerlos a un diccionario es sencillo.
6. **Más estadísticas**: volumen efectivo por serie, distribución de RPE, tiempo bajo tensión y comparativas
   entre bloques de 4 semanas (mesociclos).

## Limitaciones conocidas

- El almacenamiento es por navegador y dispositivo: sin el código de pareja no se sincroniza nada entre dispositivos.
- El 1RM es **estimado** (Epley); sirve para ver tendencias, no es un test real.
- Si cambias de unidad (`kg`/`lb`) los pesos del historial se convierten al mostrarse, pero el inventario
  de discos se interpreta en la unidad activa (avisa la app al cambiarla).
- El pitido de fin de descanso y el aviso con el móvil bloqueado dependen del navegador: en iOS el sonido
  con la app cerrada puede no llegar (ahí la notificación es lo fiable), y si la app se recargó sin que
  tocaras la pantalla el audio en segundo plano puede quedar bloqueado hasta el primer toque.
- La app no sustituye a un profesional sanitario: las sugerencias son orientativas.
