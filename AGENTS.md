# AGENTS.md · Pulso

Contexto para trabajar en esta app. Si el hilo se alarga o se pierde el contexto, **lee esto
primero**: aquí está lo vital (stack, comandos, arquitectura, convenciones y las decisiones que no
se deben "arreglar" sin querer).

> Última actualización: 26-nov-2026 · navegación móvil, planificación con vista previa y guías visuales en rutinas.

---

## 1. Qué es

App de entrenamiento personal: sesiones con series/peso/reps, timer de descanso, rutinas,
calendario, estadísticas y un coach con IA opcional. **Todo vive en el dispositivo**
(`localStorage`); el coach usa la **API key propia de Gemini** del usuario y **todo funciona sin
key** (el planificador local cubre sugerencias y plan semanal).

- **Stack**: Vite + TypeScript (strict) + Preact + `@preact/signals`. Sin router externo, sin
  librería de gráficos, sin framework de CSS.
- **Publicada**: <https://fabiancito777.github.io/pulso/> (GitHub Actions → Pages desde `main`).
- **PWA**: instalable y offline (`public/sw.js`, `public/manifest.webmanifest`).
- UI mobile-first en español, tema AMOLED por defecto.

---

## 2. Arrancar y verificar

```bash
npm install
npm run dev        # http://localhost:5173 (HMR)
npm run typecheck  # tsc --noEmit
npm run lint       # eslint .
npm test           # vitest offline (excluye smoke/edge/quality)
npm run build      # dist/ (sin sourcemaps a propósito: GitHub Pages sirve dist/ entero)
npm run verify     # typecheck + lint + test + build
```

| Extra                     | Qué hace                                                                          |
| ------------------------- | --------------------------------------------------------------------------------- |
| `npm run test:net`        | Incluye `smoke`/`edge`/`quality`, que llaman a Gemini con la key de `.env.local`. |
| `npm run test:quality`    | Solo el test de calidad del coach (API real).                                     |
| `npm run format`          | Prettier.                                                                         |
| `node tools/sync-dev.mjs` | Servidor de sincronización local, sin cuenta de Cloudflare.                       |

**Qué verificar según lo que toques**

- Dominio (`src/domain`), estado (`src/state`) o coach (`src/features/coach`): sus tests en
  `src/**/*.test.ts` (Vitest, sin navegador).
- UI: `npm run typecheck` + `npm run lint` y, si es un flujo de modal, timer, descanso con el móvil
  bloqueado o instalación de la PWA, **mirarlo en el navegador**: eso no lo cubren los tests.
- Antes de dar algo por bueno: `npm run verify`.

> Estado de referencia (24-nov-2026): `npm run verify` pasó con 59 archivos y 1186 pruebas.

**Entrega de cambios**

- Cierra cada tarea que modifique el repositorio con un commit y un push a la rama remota
  correspondiente, salvo que el usuario indique otra cosa. Ejecuta `npm run verify` antes del commit,
  incluye solo los archivos de la tarea y comprueba después que la rama local y su upstream coinciden.
  El push a `main` activa el despliegue de GitHub Pages.
- Para cambios de código, un subagente GPT‑6 Luna con esfuerzo alto implementa y otro Luna con
  esfuerzo alto revisa los flujos y hace la validación de navegador necesaria. El agente principal
  coordina, revisa el diff y los bugs, ejecuta `npm run verify` y se encarga del commit y el push; no
  prueba manualmente los flujos interactivos.
- La revisión de navegador se limita al comportamiento cambiado. Para las guías visuales cubre la
  miniatura, abrir/cerrar el visor, cambiar de fase, visibilidad en el modo afectado y carga del
  asset. No marques series ni pruebes el timer o flujos adyacentes salvo que hayan cambiado o haya
  evidencia concreta de regresión. Si no se puede delegar la validación de navegador, informa ese
  límite.

---

## 3. Arquitectura

```
index.html            · entrada de Vite (CSP en meta) → src/main.tsx
src/main.tsx          · tema antes del primer pintado, install prompt, errores globales,
                        ?demo=1, monta <App /> y registra el SW
src/app/              · shell (App.tsx: appbar, navegación v2-tabs, rutas) y router por hash
src/domain/           · núcleo PURO (sin DOM ni signals): discos, analítica, sesión, descanso,
                        supersets, planner, fechas, formatos, catálogo y semilla
src/features/coach/   · contexto, memoria, historial, prompts, parseo tolerante, esquemas,
                        cliente Gemini, generador de ejercicios y planificador local
src/state/            · signals + persistencia: store, sesión activa, chat, coach, perfiles, sync
src/ui/               · vistas y componentes Preact (Hoy, Rutinas, Calendario, Coach,
                        Progreso, Ajustes, Onboarding) + kit, Modal, toast, gráficos, iconos
src/platform/         · lo que toca el navegador: audio, keep-alive, wake lock, SW, notify,
                        clipboard, files, theme, install, cripto de sync
src/styles/           · base.css (base y componentes) + v2.css + una hoja por vista
public/               · manifest, service worker e iconos
sync-worker/          · Worker de Cloudflare + KV (sincronización cifrada)
tools/                · utilidades de desarrollo (p. ej. `sync-dev.mjs`)
```

**Regla de dependencias**: `domain ← features ← state ← ui`, y `platform` se usa desde `state`/`ui`.
El dominio no importa nada de fuera de sí mismo (por eso se prueba sin navegador). Nada de imports
circulares entre capas.

**Flujo de datos**

```
localStorage  ⇄  signals de src/state/store.ts  →  componentes Preact (leen signals, se repintan solos)
```

No hay props-passing desde el shell para el estado: las vistas leen las signals directamente. El
router (`src/app/router.ts`) guarda `{tab, sub}` en un signal y escucha `hashchange`.

---

## 4. Convenciones

- **Rutas**: `#/tab` y `#/ajustes/<sub>`; `go(tab, sub)` en `src/app/router.ts`, pestañas en `TABS`.
- **Estado**: nunca escribir `localStorage` ni mutar el estado a mano. Se pasa por los setters de
  `src/state/store.ts` (lectura-modificación-escritura) o por los de `src/state/session.ts` para la
  sesión activa. Los hooks (`onStateWritten`, `onStateReplaced`) mantienen el resto en sincronía.
- **Perfiles**: cada perfil tiene su clave (`pulso.state` para el principal, `pulso.state.<id>` para
  el resto; también `pulso.rest` y las claves de siembra). Usa `currentStateKey()`/`currentRestKey()`
  en vez de componer claves a mano. La **API key del coach se comparte** entre perfiles.
- **Persistencia**. Los setters escriben el estado local. El descanso guarda su timestamp en su
  propia clave (`pulso.rest` en el perfil principal) y la subida por sincronización se agrupa con
  un debounce de 8 s.
- **Fechas**: ISO local `YYYY-MM-DD` con `src/domain/dates.ts` (`today()`, `addDays()`, `diffDays()`).
  Nunca `toISOString().slice(0, 10)` para fechas de calendario (desfase por zona horaria).
- **Números en inputs**: `fmtN()` da coma decimal y **no sirve para `value` de
  `<input type="number">`**; usa `inputNum()` (punto decimal). Todo se calcula en kg y se convierte
  con `src/domain/units.ts`; cada disco guarda su unidad.
- **Texto de usuario/IA**: Preact escapa solo; para HTML propio (markdown del chat, ayudas) pasa por
  el parser de `src/state/chat.ts` (`parseMd`/`mdInline`), no por `innerHTML` suelto.
- **Vistas**: un componente por pestaña dentro de `src/ui/`, estilos en `src/styles/<vista>.css`,
  y su lógica con casos borde en `<vista>-helpers.ts` **con tests**.
- **Añadir una pestaña**: entrada en `TABS` (`src/app/router.ts`) + componente en `src/ui/` + su
  bloque en `App.tsx` (appbar/subtítulo).
- **Modales**: `src/ui/Modal.tsx` + la pila de `src/ui/modal-stack.ts` (un `Escape` cierra solo el de
  arriba; el foco vuelve al anterior). No montes diálogos propios fuera de esa pila.
- **Avisos**: `toast()` (`src/ui/toast.tsx`) — máximo 3 a la vez, `err` 6 s, `sticky` para procesos en
  curso. Los errores globales los captura `main.tsx`.
- **Gráficos**: componentes de `src/ui/charts.tsx` (SVG propio) con las cuentas en
  `charts-helpers.ts`; no añadas una librería.
- **Iconos**: `src/ui/icons.ts` (mapa nombre → paths) + `<Icon name="…" />`. Si el nombre no existe,
  cae a un icono por defecto; borra los que dejes sin uso.
- **CSS**: `base.css` es la base y los componentes compartidos; `v2.css` y las hojas por vista
  añaden lo suyo. Evita duplicar reglas: el proyecto arrastró durante meses restos de la v1
  (`.nav*`, `.restbar*`, `.chart-wrap`…) que se limpiaron el 3-nov-2026.
- **Nav**: `v2-tabs` muestra cinco accesos fijos en móvil: Hoy, Rutinas, Calendario, Progreso y Más.
  Coach y Ajustes se abren desde el mismo modal de Más; los enlaces directos y las subsecciones de
  Ajustes siguen funcionando, y Más aparece seleccionado en esas dos rutas. La barra se oculta en
  modo súper simple únicamente mientras hay una sesión activa en Hoy; en las demás vistas sigue visible.

---

## 5. Cómo funciona lo importante

### Sesión activa

`sessions` guarda lo terminado; `active` la sesión en curso (entradas con `sets` → `weight/reps/done`,
más `basis`, `cue`, `notes`, `restSec` y supersets). Al empezar se prellena con `suggestWeight()`
(progresión por conjunto de series: solo sube si se completan las series prescritas con las reps
objetivo y sin RPE alto; si no, mantiene la carga. Considera pesos variables y usa una carga observada;
la explicación `basis` cuenta series/reps/esfuerzo y respeta los pesos fijados por la rutina).
**Sin historial el peso queda vacío**, no 0. Al terminar se guardan solo las
series marcadas, se calcula el RPE medio y el día queda `done` en el calendario.

- **Editar una serie se propaga hacia abajo** (`propagateSet`): el peso/reps de la serie N se copia a
  las siguientes sin marcar del mismo ejercicio, nunca a las de arriba ni a las ya hechas. El RPE no
  se arrastra.
- **`basis`**: cada entrada explica la sugerencia a partir de sus series («Repite 25 kg. Alcanzaste al menos
  10 reps en 1 de 4 series previstas»), una repetición anterior, o la falta de historial. Se muestra bajo
  el nombre del ejercicio: **el dato
  ya está en pantalla**, no lo dupliques en otro sitio.
- **Repetir exacto**: repetir desde Hoy o Progreso reconstruye series una por una con sus pesos y reps;
  convierte el peso desde la unidad guardada al perfil actual, copia descanso, superserie y consejo,
  y deja las series sin marcar, RPE y nota personal vacíos. El snapshot del plan de sesión conserva
  estos datos aunque después cambie la rutina original.
- Supersets: ejercicios consecutivos con el mismo `superset`. La insignia «SS A · 1/2» y el descanso corto del
  primero marcan la transición.
- **Modo súper simple** (`settings.simpleWorkoutMode`, apagado de fábrica): Ajustes → Entreno lo
  guarda por perfil. `App.tsx` aplica la vista focal cuando hay sesión activa en Hoy y `SessionCard.tsx`
  reutiliza la tabla, el progreso y las acciones de sesión. La cabecera **Pulso** abre Ajustes → Entreno
  sin finalizar. Volver a Hoy conserva la sesión. El temporizador libre mantiene su vista habitual.
- **Guías visuales** (`domain/exercise-guides.ts`): disponibles en tarjetas expandidas de la vista
  habitual, del modo súper simple y en el editor de rutinas (antes de añadir desde resultados y en las
  filas añadidas); cubren los 24 IDs de `seedExercises()` y mantienen
  dos aliases exactos ya guardados (`floor-press` y `curl-con-mancuernas`). No se infieren guías para
  ejercicios personalizados ni variantes. En ambos modos `Inicio`/`Final` se alternan manualmente y
  `Plancha` muestra una única postura estática. La miniatura y el visor se comparten en
  `ui/ExerciseGuidePreview.tsx`; su diálogo usa `Modal` y la pila compartida.
- **Biblioteca y migración**: la biblioteca disponible parte de los 24 ejercicios de `seed.ts`; el
  catálogo stock ampliado anterior ya no se incluye como opciones de entrenamiento. Al cargar un perfil
  antiguo, la migración retira solo ejercicios stock sin cambios del usuario y sin referencias activas.
  Conserva los usados, los editados y los ejercicios propios. Las etiquetas antiguas siguen resolviéndose
  en el historial aunque el ejercicio ya no esté en la biblioteca.
- **Consejo y nota personal**: la prescripción guarda el texto en `RoutineItem.notes` y lo copia a
  `ActiveEntry.cue`. `ActiveEntry.notes` es la nota personal y termina en `SessionEntry.personalNote`,
  fuera del contexto del coach. Al repetir se usa el consejo del ejercicio o la copia del plan guardada
  en la sesión. `normalizeActiveSession()` recupera el consejo antiguo cuando puede identificarlo y
  conserva como nota el texto ambiguo. Los interruptores `showExerciseCue` y `showExerciseRest` solo
  controlan qué se muestra en la tarjeta. El menú `⋯` del modo súper simple permite consultar el
  consejo y editar el descanso. En la vista habitual, el consejo tiene su propio acceso en la tarjeta.
- **Resumen al terminar** (`ui/SessionDoneSheet.tsx`): series, duración y récords nuevos quedan a la
  vista; volumen, RPE, serie a serie y nota se despliegan con «Ver detalle». «Listo» es la acción
  principal; Progreso, Calendario y Repetir siguen disponibles como accesos secundarios.

### Timer de descanso

`src/domain/rest.ts` calcula **por timestamp** (`endsAt - now`), no acumulando: sigue siendo correcto
con la pestaña en segundo plano o el móvil bloqueado. Se espeja en `pulso.rest`.

- Arranca al marcar una serie **si queda algo por hacer**: series pendientes del ejercicio, o el
  siguiente ejercicio si acabas de cerrar el actual (ahí el aviso lo nombra).
- Desmarcar una serie lo cancela; `+15 s` con el descanso terminado abre una cuenta nueva.
- En la vista habitual se pinta en el recuadro de sesión o en la barra compacta al desplazarse o
  cambiar de pestaña. En modo súper simple se pinta como una fila `sticky` independiente del resumen.
- **Aviso con el móvil bloqueado (requisito frágil)**: pitido largo (~3,5 s) + vibración +
  notificación del sistema. Tres capas: audio de silencio en bucle + `mediaSession` (`keepAlive`),
  wake lock que se refresca al volver a la app, y notificación **programada en el service worker**
  (`schedule-rest` / `cancel-rest`) para cuando la pestaña está congelada. No quites ninguna.

### Calculadora de discos

Modos de carga: `bar` (2 huecos), `db1` (1 mancuerna), `db2` (2 mancuernas, 4 huecos) y `none`
(máquina). Reparto **simétrico** y búsqueda del peso **más cercano** por enumeración de sumas
(`src/domain/plates.ts`), no greedy. El modo se sugiere por ejercicio y se recuerda por id.

### Coach (Gemini)

`src/features/coach/`: `context.ts` construye el contexto (perfil, material e inventario, biblioteca
permitida, historial serie a serie, días desde el último estímulo, récords, rutinas y volumen
semanal), `prompts.ts` arma la petición, `parse.ts` tolera JSON envuelto, `local.ts` es el
planificador **sin key**, `memory.ts` guarda lo que el usuario pide recordar.

- **Modelos** en `AI_MODELS` (`src/domain/catalog.ts`). `gemini-4-hydrogen` es el predeterminado
  desde la migración v5. `gemini-3.8-flash` y `gemini-3.5-flash-lite` están disponibles como respaldo.
  El selector usa ese catálogo local.
- **`thinkingConfig`** admite `thinkingLevel` (`auto`, `minimal`, `low`, `medium`, `high`, `xhigh`)
  e `includeThoughts`. `client.ts` adapta `minimal` a `low` en Hydrogen. La espera automática depende
  del nivel, se puede configurar en segundos y admite cancelación. La migración v4
  retiró `temperature` y `thinkingBudget` del estado.
- **Validación de la salida**: lo que devuelve el modelo NO se guarda a ciegas. `domain/prescription.ts`
  (`sanitizePrescription`) acota series/reps/descanso/peso antes de crear rutinas o días, y se comparte
  con el planificador local; la UI usa la misma función (`ui/routines-helpers.ts`).
- **Fallback local**: `suggest`/`plan` sin key, o con fallo de red/auth/cuota o JSON ilegible, resuelven
  con `local.ts` y marcan `origin: 'local'` + `fallback` (motivo conservado para la vista). La base
  local viaja además DENTRO del prompt como borrador a mejorar (`localHead` en `prompts.ts`).
- **Sugerir entreno**: la propuesta queda en su tarjeta de Coach. «Empezar este entreno» la convierte
  en plan de sesión en el orden y prescripción propuestos; no crea rutinas. El acceso «Guardar como
  rutina» es independiente. Los ejercicios inexistentes se ofrecen para crear o descartar, y hay que
  reintentar antes de iniciar/guardar; una sesión activa no se reemplaza. La unidad y el modelo se
  capturan al pedir la propuesta. Si cambia la unidad, el peso se convierte una sola vez al iniciar o
  guardar. Tarjetas antiguas sin unidad conservan su cifra, sin inferir una equivalencia.
- **Historial del chat**: `promptHistory()` resume las tarjetas de sugerencia y plan con el orden y
  una muestra compacta de series, reps, carga y descanso. El texto que recibe el modelo sigue limitado
  a 600 caracteres por respuesta; las propuestas históricas sin payload conservan su texto.
- **Guardar rutina desde Coach**: las tarjetas dejan crear y descartar ejercicios nuevos antes de
  guardar y permiten reintentar sin duplicar. `applySuggestionAsRoutine` no persiste una rutina con
  ejercicios pendientes y una actualización no pisa parcialmente la rutina existente si faltan items.
- **Restricciones de las propuestas**: sugerencias locales puntúan grupos con ejercicios permitidos y
  material disponible; al aplicar propuestas de IA/local se vuelven a comprobar esos dos requisitos.
  Los omitidos explican si están vetados, falta material, chocan atributos o no existen. Solo los
  nombres inexistentes se pueden ofrecer para crear; vetados y no disponibles nunca se duplican.
- **`applyWeek` descarta los días anteriores a hoy** (`skipped`); las fechas se comparan como ISO local.
- **Vista previa antes de aplicar**: la propuesta enseña el impacto por fechas y días antes de escribir
  el calendario. Solo «Aplicar al calendario» confirma los cambios; pedir otra propuesta o descartarla
  no altera el plan guardado. Local e IA usan la semana del cursor y se omiten fechas de respuesta que
  queden fuera de esa semana. Sin key se usa el planificador local; con key se puede pedir al coach.
- **Hoy y calendario**: la semana del calendario son siete filas compactas que abren el mismo detalle
  de día que la vista mensual. «Saltar»/«Descanso» guarda una copia del plan previo en `restorePlan`;
  «Restaurar plan» recupera título, fuente, foco y rutina o ejercicios. «Limpiar» elimina los campos
  del plan, incluido `focus` y `restorePlan`, pero conserva `sessionId` y sesiones reales.
- **Editar ejercicios desde Calendario** manda un borrador aislado al editor: no modifica el estado al
  abrirlo ni al cancelar; «Guardar plan del día» escribe los ejercicios en ese día, sin crear rutina
  ni cambiar una rutina usada en otras fechas. No se puede abrir mientras el día está en descanso.
- **Demostración de Progreso** usa señales en memoria para las sesiones de ejemplo. No se añaden al
  historial persistido ni se sincronizan; salir vuelve a los datos reales. `?demo=1` inicia una muestra
  temporal, y los datos demo persistidos de versiones anteriores se limpian durante la carga.

### Sincronización y perfiles

Código de pareja → se deriva una clave (AES-GCM) y el servidor (Worker + KV, `sync-worker/`) solo ve
un hash y el texto cifrado. Sesiones y rutinas **se suman**; ajustes por «último cambio gana» usando
las marcas de `src/domain/sync.ts`; si ambos cambiaron lo mismo, la app pregunta. Los tombstones
evitan que un borrado resucite. `applySyncedState` **no re-sella** el estado a propósito.

### PWA

`public/sw.js`: precarga del shell y **network-first con respaldo en caché** (sin hashes de archivo,
cache-first congelaría versiones). Mismo SW para las notificaciones de descanso. Solo se registra en
`http/https`. El build va sin sourcemaps porque Pages publica `dist/` entero.

---

## 6. Trampas conocidas

- `?demo=1` carga 8 semanas de ejemplo (se quitan en _Ajustes → Datos_); no dependas de ello en tests.
- Los tests de red (`smoke`/`edge`/`quality`) gastan cuota real: no los metas en `npm test`.
- `src/ui/icons.ts` y `src/domain/catalog.ts` son ficheros base sensibles: el catálogo lo vigila
  `src/domain/data.test.ts` (nombres, grupos, material). Tócalos a mano y con cuidado.
- El `ResizeObserver` avisa a veces al medir la nav; `main.tsx` **filtra ese aviso** para no enseñar
  un error técnico en inglés. No vuelvas a volcarlo al usuario.
- `applyTheme()` corre **antes** del render: si lo mueves, la app parpadea con el tema por defecto.
- Antes de añadir un `localStorage` nuevo, pregúntate si cabe en el estado o en una clave por perfil.

---

## 7. Registro de cambios

| Fecha       | Cambio                                                                                                                                                                                                                                                                                                                                                               | Por qué                                                                                                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 15-sep-2026 | Primera versión de este documento (app vanilla).                                                                                                                                                                                                                                                                                                                     | Dejar contexto entre sesiones.                                                                                                                                                   |
| 3-nov-2026  | `AGENTS.md` reescrito para la v2 (Vite + Preact); documentados router, signals, perfiles, sync, coach y PWA reales.                                                                                                                                                                                                                                                  | El documento describía `js/*.js`, `?selftest=1` y utilidades que ya no existen.                                                                                                  |
| 3-nov-2026  | `main.tsx`: se filtran los avisos benignos de `ResizeObserver` y los errores se muestran en lenguaje humano.                                                                                                                                                                                                                                                         | La app se acusaba a sí misma con un mensaje interno en inglés al abrir Ajustes y Coach.                                                                                          |
| 3-nov-2026  | Limpieza de código muerto: 32 reglas CSS de la v1 (nav, appbar, restbar, chart-wrap, skeleton…), 10 exports y 9 iconos sin uso.                                                                                                                                                                                                                                      | Restos de la UI anterior; nada de eso se usaba desde ningún `.tsx`. Verificado con `typecheck`, `lint`, 1436 tests y `build`.                                                    |
| 7-nov-2026  | Coach: validación de la salida del modelo (`domain/prescription.ts`), la propuesta local viaja en el prompt como borrador, `applyWeek` descarta días pasados, tope de tokens más alto en tareas JSON, política de reintentos unificada, catálogo reducido a `gemini-3.8-flash` y `gemini-3.5-flash-lite`, y `temperature`/`thinkingBudget` retirados (migración v4). | El modelo devolvía números imposibles, fechas antiguas y cambios de ajustes sin efecto; mitad del código del cliente era andamiaje sin uso.                                      |
| 24-nov-2026 | Modo súper simple por perfil y separación entre consejo y nota personal. Se documenta la entrega con commit y push.                                                                                                                                                                                                                                                  | Reduce los controles durante la sesión y preserva las notas personales al guardar.                                                                                               |
| 25-nov-2026 | Guías visuales para los 24 ejercicios predeterminados y limpieza del catálogo stock ampliado en perfiles antiguos.                                                                                                                                                                                                                                                   | Las guías cubren la biblioteca inicial; la migración retira stock sin cambios y sin uso, conservando ejercicios propios, editados o referenciados y las etiquetas del historial. |
| 25-nov-2026 | Guías visuales accesibles también desde las tarjetas expandidas de la sesión habitual.                                                                                                                                                                                                                                                                               | Reutilizar las mismas miniaturas, visor y fases en ambos modos de entrenamiento.                                                                                                 |
| 25-nov-2026 | Rutinas prioriza las guardadas y concentra creación en «Nueva rutina» → Desde cero / Usar plantilla / Pedir al coach. Coach AI deja key, estado y prueba de conexión a la vista; opciones de modelo y prompt pasan a Avanzado. El diagnóstico del aviso con móvil bloqueado está en Ajustes → Entreno → Avanzado.                                                    | Menos acciones competidoras y acceso directo a las opciones de configuración comunes.                                                                                            |
| 25-nov-2026 | Hoy permite desplegar los ejercicios del plan, repetir la última sesión desde una tarjeta y retomar una sesión activa desde la barra compacta al cambiar de pestaña. Progreso muestra el resumen semanal y los últimos récords antes de búsqueda, estadísticas plegables e historial.                                                                                | Accesos más directos a entrenar y revisar el progreso.                                                                                                                           |
| 26-nov-2026 | Navegación inferior móvil con cinco accesos fijos y un modal compartido para Coach y Ajustes; se conserva el estado por ruta y el acceso a perfiles.                                                                                                                                                                                                                 | Los destinos principales caben en pantalla y Coach/Ajustes siguen disponibles sin perder los enlaces directos.                                                                   |
| 26-nov-2026 | El cierre de sesión prioriza series, duración y récords con detalle plegable; las guías visuales se reutilizan desde el editor de rutinas. La planificación semanal muestra el impacto por fecha antes de aplicarse.                                                                                                                                                 | Confirmar lo guardado de un vistazo y revisar ejercicios y cambios del calendario antes de actuar.                                                                               |
| 26-nov-2026 | Hoy y Calendario distinguen descanso con restauración del plan; Calendario usa filas compactas con un detalle compartido y edita ejercicios mediante borrador por fecha. Repetir recupera las series exactas y Progreso puede abrir una demostración temporal.                                                                                                       | Evitar que saltar o editar un día borre la planificación, y facilitar la revisión y repetición sin alterar datos reales.                                                         |
