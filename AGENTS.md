# AGENTS.md · Pulso

Documento de contexto para trabajar en esta app. Si el hilo se alarga o se pierde el
contexto, **lee primero esto**: aquí está lo vital (arquitectura, convenciones, decisiones de
diseño y por qué se hicieron así) y el registro de revisiones/cambios.

> Última actualización: 15-sep-2026 · revisión de bugs **y arreglo** de todos ellos (ver §7).

---

## 1. Qué es

App de entrenamiento personal en **HTML + CSS + JS vanilla**: sin dependencias, sin build, sin
backend. Todos los datos viven en `localStorage` (`pulso.state`). El coach con IA es opcional y
usa la **API key propia de Gemini** del usuario. UI mobile-first en español, con navegación
inferior y PWA instalable (`manifest.webmanifest` + `sw.js`).

Se abre con doble clic en `index.html` (funciona en `file://`) o servida en local.

---

## 2. Cómo ejecutarla y cómo verificarla

```bash
# servidor local (recomendado: algunos navegadores restringen localStorage en file://)
python -m http.server 8080     # http://localhost:8080
```

**No hay `package.json`, ni linter, ni framework de tests.** La verificación es:

| Herramienta | Cómo | Qué hace |
|---|---|---|
| Auto-test | `index.html?selftest=1` (o `#selftest`) | 66 comprobaciones (equipo, discos y modos de la calculadora, 1RM, planificador, ciclo completo de sesión, descanso en el recuadro, duración del pitido de fin, calendario, analítica, JSON tolerante, markdown, unidades, rutinas, contexto del coach, render de todas las vistas y capa de acciones). Muestra el informe, pone el resultado en `document.title` y **exporta y restaura tus datos al terminar**. Debe pasar también con datos y modos ya guardados (no dependas del estado previo). |
| Modo demo | `index.html?demo=1` | Carga 8 semanas de sesiones de ejemplo + plan semanal. Se quitan desde Ajustes → Datos. |
| `node --check js/*.js` | terminal | Comprobación de sintaxis (la que uso antes de cada verificación). |
| `_check.html` | abrir en el navegador | Comprueba la sintaxis de cada `js/*.js` con `new Function(src)`. |
| `_restshot.html` | abrir en el navegador | Captura el recuadro de descanso dentro de un iframe. |

`_check.html` y `_restshot.html` son **utilidades de desarrollo** que quedan en la raíz; no
forman parte de la app (no se referencian desde `index.html`).

⚠️ **El auto-test no cubre los flujos de modal/UI**, y ahí estaban todos los bugs de §7. Si
tocas un flujo con `U.modal`, verifícalo a mano en el navegador (los pasos que usé están en §7).

> Nota de entorno: `python -m http.server` no manda `Cache-Control`, así que el navegador puede
> servir los JS desde su caché heurística y **probar código viejo**. Para verificar cambios,
> sirve en un puerto nuevo (otro origen ⇒ otra caché) o haz un hard reload.

---

## 3. Arquitectura y orden de carga

`index.html` carga, en este orden exacto:

```
core.js → data.js → store.js → charts.js → trainer.js → coach.js
→ views-train.js → views-routines.js → views-calendar.js → views-coach.js
→ views-stats.js → views-settings.js → app.js
```

**Sin módulos ES a propósito** (nada de `import`/`export`, ni bundler, ni CORS): así la app
funciona con doble clic sobre `index.html`. Cada archivo es un IIFE que cuelga su API en
`window.App`. El orden importa: `app.js` envuelve `App.actions['settings:set']`, que ya debe
existir (se define en `views-settings.js`, que carga antes).

| Archivo | Exporta | Responsabilidad |
|---|---|---|
| `js/core.js` | `App.u` (U) | DOM (`$`, `$$`), fechas (`U.d`), storage con fallback en memoria (`U.st`), toasts, modales (`U.modal`/`confirm`/`promptDialog`), audio/vibración/notificaciones/wake lock, catálogo de iconos, unidades kg↔lb, `U.md` (markdown-lite), `U.ring`, descarga/lectura de archivos. |
| `js/data.js` | `App.data` (D) | `GROUPS` (13), `EQUIPMENT` (49 piezas + `paralelas` insertada con `splice`), `EQUIP_PRESETS`/`equipPreset()`, `PLATES_DEFAULT`, `BARS_DEFAULT`, `DEFAULT_SETTINGS`, `SEED_EXERCISES` (136), `TEMPLATES` (9), `GOAL_REPS/SETS/REST`, `AI_MODELS`, `THINKING_LEVELS`. |
| `js/store.js` | `App.store` (S) | Estado único (`pulso.state`) + persistencia con debounce + analítica en `S.a` (volumen, 1RM, PRs, racha, staleness, series semanales) + generadores locales de rutina + `demoData`. |
| `js/charts.js` | `App.charts` (Ch) | Gráficos SVG propios (bar, line, donut, hbars, heat, spark). |
| `js/trainer.js` | `App.trainer` (T) | Sesión activa, timer de descanso, calculadora de discos. |
| `js/coach.js` | `App.coach` (C) | Cliente Gemini, `buildContext()`, planificador local, `parseJSON` tolerante, mapeo de respuestas IA, `applyWeek`. |
| `js/views-*.js` | `App.views.<tab>` | Cada vista es `{ title, tab, icon, sub(), render(root) }`. |
| `js/app.js` | `App` | Router por hash, delegación de eventos, tema/acento, `App.ui` (pickers, editores, detalle de sesión, calculadora, temporizador), arranque, `selfTest()`. |
| `sw.js` | — | Service worker: **shell offline** (precarga + network-first con respaldo en caché) y notificaciones de fin de descanso en segundo plano (`postMessage({type:'notify'})`) + `notificationclick`. ⚠️ Si añades un `js/*.js` o un CSS nuevo, súmalo a `SHELL` en `sw.js`. |

### Flujo de datos

```
localStorage ('pulso.state')
      ↕  S.load() / S.save() (debounce 220 ms)
   state (objeto único en memoria, estructura en freshState())
      ↕  setters + S.notify(reason) → guarda y avisa a los suscriptores
   vistas (leen con S.xxx() y repintan con App.render())
```

`state = { version, createdAt, settings, equipment, exercises, routines, sessions, schedule,
active, chat, meta }`.

---

## 4. Convenciones (respétalas al tocar el código)

- **Eventos por delegación global.** Nada de `addEventListener` por elemento en el HTML
  generado: se registra `App.actions['ns:accion']` y se usa en el markup
  `data-act="ns:accion"`, `data-act-change="..."` (inputs/selects, evento `change`) o
  `data-act-input="..."` (búsquedas, debounce 220 ms salvo si el nombre contiene `search`).
  Los parámetros van en `data-*` y se leen con `el.getAttribute('data-x')`.
  Navegación: `data-act="go" data-tab="hoy"` (y `data-sub` para `#/ajustes/<sub>`).
  ⚠️ Un `data-act` **sin acción registrada** ensucia la consola con `acción sin handler`, el
  aviso con el que se detectan los typos. Si un modal maneja sus propios botones, usa un
  atributo propio (`data-dact`, `data-ob-equip`, `data-ex`, `data-t`…), no `data-act`.
- **Rutas**: `#/tab` y `#/ajustes/<sub>`. `A.router.go(tab, sub)`.
- **Estado**: nunca tocar `state` desde una vista; siempre setters del store (`S.setDay`,
  `S.addSession`, `S.setEquipment`…) que llaman a `S.notify()`.
- **Ajustes anidados**: `App.setSettingPath('bars.olimpica', 20)`; las claves `ai.*` van a
  `settings.ai` (`A.setSettingPath('ai.temperature', 0.7)`). Los presets de equipamiento salen
  siempre de `D.equipPreset(kind)` (fuente única para onboarding y Ajustes).
- **Unidades**: todo se calcula **siempre en kg** (`U.units.toKg/fromKg`); cada sesión guarda su
  `unit` y cada disco del inventario guarda su propia `unit`, así que se pueden mezclar kg y lb.
- **Números en inputs**: `U.fmt.n()` formatea en español (coma decimal) y **no sirve para
  `value` de `<input type="number">`** (el navegador lo descarta y el campo sale vacío). En
  vistas-train hay un helper `inputNum(v)` que devuelve el número con punto.
- **Fechas**: ISO local `YYYY-MM-DD` con `U.d.*` (`U.d.today()`, `U.d.addDays()`). No uses
  `toISOString().slice(0,10)` para fechas de calendario (desfase por zona horaria).
- **Escapes**: todo lo que venga del usuario o de la IA pasa por `U.esc()`; el markdown del
  coach por `U.md()`.
- **Añadir un ejercicio** a la biblioteca: una línea en `D.SEED_EXERCISES`:
  `E('Nombre', 'grupo', 'material_a&material_b|c', 'compuesto', 4, 8, 12, 150)`.
  `&` = Y, `|` = O, cadena vacía = peso corporal. Al cargar, `mergeSeed()` (store.js) fusiona la
  semilla y **conserva** los flags permitido/prohibido y los ejercicios `custom` del usuario.
  ⚠️ `mergeSeed` sobrescribe `name/group/equip/type/repMin/repMax/bw` de los ejercicios de
  biblioteca y solo respeta `sets/rest/tags/tips` si `!custom`.
- **Añadir una vista**: objeto en `App.views` con `title/icon/render(root)` + entrada en `TABS`
  (`js/app.js`).
- **Añadir un icono**: una línea `ico('nombre', '<path …/>')` en `core.js`; se usa con
  `U.icon('nombre')` (si no existe, cae en `info`).
- **Gráficos**: `Ch.bar/line/donut/hbars/heat` devuelven un **placeholder** `[data-chart]` con el
  spec en JSON. Hay que llamar a `Ch.mountAll(root)` después de pintar (ya lo hace `App.render`);
  si repintas un trozo a mano, usa `A.rerenderPart(sel, html)`.
- **Material**: `S.isAvailable(ex)` y `S.missingEquip(ex)`; `S.equipTags(ex)` para etiquetas.

### Contrato de los modales (importante)

`U.modal(cfg)` devuelve una promesa y, al cerrarse, **retira el scrim del DOM antes de resolver**.
Por eso:

- ❌ **Nunca leas el DOM del modal dentro del `.then()`**: el modal ya no existe (`U.$('#campo')`
  → `null`). Ese fue el bug crítico de §7 (4 flujos rotos en silencio).
- ✅ Lee los valores en `onClick: function (box, close) { close(datos); }` o en `onMount`, y
  resuelve con el dato ya extraído. Los `.then()` solo reciben el valor.
- Los modales se **apilan**: `U.modal.current` apunta al de arriba y, al cerrarlo, vuelve
  automáticamente al anterior (`ui.closeModal()` cierra el correcto).
- `close()` es idempotente (`closed`): llamarlo dos veces no rompe nada.

---

## 5. Cómo funciona lo importante (y por qué)

### Sesión activa
`state.active` guarda la sesión en curso (entradas → series con `weight/reps/done/ts/rpe`).
`T.start()` prellenado con `S.a.suggestWeight()` (Epley de la última vez + `settings.increment`).
`T.finish()` filtra solo las series marcadas, calcula RPE medio, guarda en `sessions`, marca el
día como `done` en el calendario, apaga el wake lock y notifica. `T.discard()` la tira.

### Timer de descanso (por qué es por timestamp)
`T.rest` guarda `{ endsAt, total, running, label }` en memoria y espeja `{endsAt,total,label}` en
`localStorage` (`pulso.rest`). **No hay contador acumulado**: el tiempo restante se calcula con
`endsAt - Date.now()`, así que sigue siendo correcto aunque la pestaña quede en segundo plano o
el móvil se bloquee. `T.loop()` (cada 500 ms desde `app.js`) solo pinta y dispara el aviso de fin
una vez (`doneFired`).

- El descanso se muestra **dentro** del recuadro de sesión (`#session-rest`); si el usuario está
  en otra pestaña de la app (no hay `#session-rest`), cae a la barra compacta `#restbar`.
- **El descanso no lo configura el usuario**: lo define cada ejercicio en la biblioteca
  (compuestos 180-240 s, auxiliares 90-120 s, aislamientos 60-75 s) y el coach IA puede ajustarlo
  por sesión. El ajuste `autoRest` solo activa/desactiva el arranque automático al marcar serie.
- El aviso de fin es **pitido + vibración + notificación**. Ver el apartado siguiente, que es el
  punto delicado de toda la app.

### Aviso de descanso con el móvil bloqueado (por qué hay tres mecanismos)
Es el requisito más frágil del proyecto: el usuario bloquea el móvil mientras descansa y **tiene
que sonar** el aviso. Un solo mecanismo no basta, así que hay tres capas que se complementan:

1. **Pitido largo (~3,5 s) tirando de la pestaña viva.** `U.beep('end')` programa 5 avisos
   (988/1319 Hz) cada 0,7 s con la Web Audio API. Es largo a propósito: con el móvil en el bolsillo
   un beep corto se pierde. (Elegido sobre un `<audio>` con un mp3 para no añadir assets y porque el
   `AudioContext` se puede programar con precisión.)
2. **Keep-alive de audio** (`U.keepAlive`): mientras hay sesión activa se reproduce en bucle una
   **pista de silencio** generada en memoria (WAV de 1 s en un `<audio loop>`) y se declara
   `mediaSession.metadata`. Con eso el navegador trata la página como un reproductor
   (`<audio>`) y **no la congela** al bloquear el móvil, así que el timer sigue corriendo y el
   pitido del punto 1 llega a sonar. Se enciende en `T.start()`/`T.rest.start()` y se apaga en
   `T.finish()`/`T.discard()`/`T.rest.stop()`; el ajuste `keepAwake` lo controla. El `play()` puede
   quedar bloqueado si la app se recargó sin gesto de usuario: `U.keepAlive.retry()` (primer toque y
   al volver a primer plano) lo reintenta.
3. **Notificación PROGRAMADA en el service worker** (`sw.js` → `scheduleRest`). Si aun así la
   pestaña está congelada o cerrada, el SW se mantiene despierto con `waitUntil` hasta la hora exacta
   (`rest.endsAt`) y lanza la notificación del sistema (con `requireInteraction: true`). Esto es
   **distinto** de "pedir" una notificación: el mensaje `schedule-rest` se envía al ARRANCAR el
   descanso, y `cancel-rest` al terminar/saltar. `notifyWhenHidden()` evita el aviso duplicado si la
   app está delante. En iOS, sin notificaciones web instaladas, el pitido+keep-alive es la única vía.

También presente: el **wake lock** (`U.wakeLock`) mantiene la pantalla encendida, pero el sistema lo
suelta al ocultar la página; por eso `U.wakeLock.refresh()` se llama en `visibilitychange` (antes se
pedía una sola vez y se perdía para siempre).

### Sonido y vibración
`U.beep()` y `U.vibrate()` (core.js) leen los ajustes con el helper local `settings()`, que tira
del store (`App.store.settings()`) y, si aún no está cargado, de `localStorage` (`pulso.state`).
Se hace así **a propósito**: core.js carga antes que store.js, así que no puede capturar `S` en
tiempo de carga. `U.beep()` respeta `settings.sound === false` y `settings.volume`; `U.vibrate()`
respeta `settings.vibrate`. Tipos de pitido: `end` (5 avisos, ~3,5 s → fin de descanso), `tick`,
`done` (fin de sesión), `tap`.

### Calculadora de discos (v2: modos de carga)
Todo se calcula en kg (`invKg()`, `T.plates()`) y cada disco mantiene su unidad original para
mostrar "20,41 kg · 45 lb".

**El peso no sale solo de la barra.** El mismo inventario no rinde igual en todo, y por eso existe
el concepto de **huecos** (sitios donde entra un disco):

| modo | clave | huecos | lo que pesa `total` |
|---|---|---|---|
| Barra | `bar` | 2 (lados) | barra + 2·Σ(disco por lado) |
| 1 mancuerna (unilateral) | `db1` | 2 (extremos) | mango + 2·Σ(por extremo) |
| 2 mancuernas (bilateral) | `db2` | 4 (2 por mancuerna) | mango + 2·Σ(por extremo **en cada una**) |
| Máquina / mancuerna fija | `none` | 0 | el peso pedido tal cual |

- Un **par** son 2 discos, así que cada medida reparte `2·pares` discos entre los huecos:
  `cap = floor(2·pares / huecos)`. Con 8 pares de 3 kg (16 discos): la barra admite 8 por lado, una
  mancuerna 8 por extremo y, con dos a la vez, 4 por extremo en cada una. De ahí que `db2` alcance
  mucho menos peso que `db1` **a propósito** (es la realidad física, no un bug).
- El reparto es siempre **simétrico** (los mismos discos en cada hueco) y se elige por
  **enumeración completa (DP sobre las sumas alcanzables, `enumerateSums`)**, quedándose con la
  combinación **más cercana** al peso pedido —por encima o por debajo— y, si hay empate, con la que
  usa menos discos. Antes se hacía greedy (redondeaba hacia abajo) y podía dejar 4 kg sin usar.
  El margen `exact` es 0,1 kg: con discos de kg y lb mezclados no tiene sentido marcar 0,04 kg como
  "te pasas".
- Cada ejercicio se calcula **por su cuenta** (los discos son los mismos y se mueven de un ejercicio
  a otro; el inventario no se "gasta").
- El modo se **sugiere** por ejercicio (`T.plateModeFor`): `bw` → `none`; nombre/equipo con
  "mancuerna" → `db1` si el nombre es unilateral (`unilateral`, `a una mano`, `kroc`, `por lado`…)
  y `db2` si no; nombre o equipo con "barra" → `bar`. Lo que el usuario eligió a mano manda: se
  guarda en `settings.plateModes[exId]` (`T.setPlateMode`, clave `__tool__` para la calculadora
  suelta) y se recuerda entre sesiones.
- `T.maxLoadable({ mode })` devuelve `{ barKg, sideKg, totalKg, mode, per }` (**ojo: `totalKg`**, no
  `total`); el `sideKg` es por hueco, y en `db2` el `totalKg` ya es por mancuerna.
- **Defecto del inventario** (`D.PLATES_DEFAULT`): 3 kg ×8 pares, 2,5 kg ×4, 1,25 kg ×4, 5 lb ×4,
  2,5 lb ×4. **Barras a 0 kg** (`D.BARS_DEFAULT`): una barra de plástico no pesa, todo el peso lo
  ponen los discos; los tres campos (barra, barra EZ, mango de mancuerna) son editables por si algún
  día hay una barra que pesa. Equipo por defecto (`D.DEFAULT_EQUIPMENT`): mancuernas ajustables, discos,
  barra cargable, barra de dominadas y paralelas; el resto apagado hasta activarlo.
- La migración a estos valores va en `store.js` (`applyPersonalSetup`, clave `pulso.applied-setup` con
  el id `inventario-v2`), **una sola vez por dispositivo**: si el usuario cambia el inventario a mano,
  una recarga no se lo revierte, y un "Borrar todo" tampoco lo reaplica.

### Contexto del coach (`C.buildContext`, js/coach.js)
Se envía en **todas** las llamadas (chat, sesión de hoy, plan semanal, análisis): perfil,
equipamiento + inventario en kg, ejercicios permitidos por grupo, **historial serie a serie real**
(hasta 16-20 sesiones), días desde el último estímulo por grupo, récords, rutinas guardadas y
volumen semanal. Detalle clave: el historial va etiquetado como **lo realizado** y las rutinas
como **prescripción** ("NO es lo realizado"), y cuando la sesión salió de una rutina se añade el
objetivo de la plantilla y el cumplimiento (`40x8, 40x7 … [objetivo plantilla: 4x10-12 · cumple
0/4]`), para que el modelo no confunda el plan con las marcas.
`C.parseJSON()` es tolerante (fences ```json, comas finales, recortes) porque el modelo a veces
devuelve JSON envuelto.

### Thinking / modelos (a sep-2026)
Endpoint `POST {BASE}/models/{modelo}:generateContent?key=…`.
`generationConfig.thinkingConfig`: `thinkingLevel` (`minimal|low|medium|high`, Gemini 3) **o**
`thinkingBudget` (Gemini 2.5, `0` desactiva, `-1` dinámico) — son mutuamente excluyentes y en la
app el nivel tiene prioridad; `includeThoughts: true` devuelve el resumen de razonamiento (se
muestra plegable en el chat).

### Tema y acento
`A.applyTheme()` pone `data-theme` en `<html>` (amoled/dark/light), `--accent`, `--accent-soft` y
`--accent-ink` (contraste calculado con luminancia) y actualiza `<meta name="theme-color">`.

### Auto-test
`selfTest()` en `app.js` respalda con `S.export()`, ejecuta las comprobaciones y restaura con
`S.importJSON(backup)`. Cubre el store y el render de todas las vistas (en un sandbox fuera de
pantalla), no los modales.

### PWA: instalación y offline
- `manifest.webmanifest` (nombre, iconos 192/512 + maskable, `display: standalone`, `start_url: './'`)
  + `<link rel="manifest">` + `apple-touch-icon` y metas de iOS en `index.html`. Con eso la app es
  instalable y abre a pantalla completa.
- `sw.js` se registra en `init()` **solo si el protocolo es http/https** (`file://` no tiene service
  worker: abriendo el archivo con doble clic no hay offline ni notificaciones).
- Estrategia de caché: **network-first con respaldo en caché** (`pulso-shell-v2`). Se eligió así porque
  el proyecto no tiene build ni hashes de archivo: con cache-first la app se quedaría congelada en una
  versión vieja. Al estar online siempre entra la versión nueva y sin conexión se abre desde la caché.
- El `?v=` de los assets se resuelve con `caches.match(req, { ignoreSearch: true })`, así la precarga no
  necesita conocer la versión. Los POST (API de Gemini) y los orígenes externos **no** se interceptan.
- `A.pwa` (en `app.js`) centraliza el estado: `installed()` (display-mode standalone), `canInstall()`
  (evento `beforeinstallprompt` diferido), `hasSW()` e `install()`. La fila "Instalar como aplicación"
  está en Ajustes → Datos y, si no hay prompt nativo, abre un modal con los pasos por plataforma.
- El **mismo** service worker atiende los avisos de descanso: mensajes `notify` (aviso inmediato),
  `schedule-rest` (programado, se mantiene despierto con `waitUntil`) y `cancel-rest`. Ver §5
  "Aviso de descanso con el móvil bloqueado".

### Rutinas personales puntuales (no son defaults)
En `store.js` hay un array `PERSONAL_ROUTINES` con rutinas concretas que se inyectan **una sola vez por
dispositivo** desde `seedPersonalRoutines()`: la rutina entra en `state.routines` y, si el día está
libre, se agenda para hoy (aparece en la pestaña Hoy con "Empezar sesión").
- El registro de "ya sembrado" va en su **propia clave de localStorage** (`pulso.seeded-routines`, vía
  `SEED_KEY`), no en el estado: así, al hacer *Ajustes → Datos → Borrar todo*, la rutina **no vuelve**
  (el estado se reemplaza por `freshState()`, pero las claves sueltas no se tocan).
- Para añadir otra: un objeto en `PERSONAL_ROUTINES` con `id` estable (`rt-personal-…`), `name`, `focus`,
  `source: 'manual'` y `items`. Al ser una clave nueva de id, se sembrará en el siguiente arranque.

### Superseries (cómo se representan hoy)
La app **no tiene soporte nativo de superseries** (sigue en la lista de mejoras del README). En una rutina
con superseries se representan como ejercicios consecutivos y se usa el temporizador a favor:
- el **primer** ejercicio del par lleva `rest: 15` (transición) → el timer solo marca el cambio de ejercicio;
- el **segundo** lleva el descanso real de la superserie (`45`/`60`) → ahí es donde toca descansar;
- y cada `notes` empieza por `SUPERSERIE n (1/2)` / `(2/2)` para que se lea en la sesión.

### Peso y notas en las rutinas (por qué `weight` existe)
Los items de rutina son `{ exId, sets, repMin, repMax, rest, weight, notes }`:
- `weight` es **opcional** (puede ser `null`): lo usan las rutinas con pesos concretos y los planes del
  coach IA. `S.addRoutine` lo conserva, `T.start({routineId})` lo aplica a todas las series (tiene
  prioridad sobre la sugerencia por historial) y el editor de rutina lo mantiene al editar (no tiene
  campo propio, pero `commit(box)` solo sobrescribe series/reps/descanso).
- `notes` de cada item llegan a la sesión como pista debajo de las series (antes se perdían al arrancar
  desde una rutina, porque solo las usaba el plan del día).

---

## 6. Privacidad

Sesiones, rutinas, ajustes, inventario y la API key viven **solo en `localStorage`**. No hay
backend ni analítica. La única salida de red es `generativelanguage.googleapis.com` cuando se usa
el coach. Si `localStorage` está bloqueado, `U.st` cae a memoria y la app avisa (los datos no
persisten).

---

## 7. Revisión de bugs y arreglos (15-sep-2026)

Verificado en navegador real (servidor local + Playwright) además de por lectura de código.
**Todo lo de esta sección está arreglado y verificado**; queda como referencia de por qué se
programó así.

### 🔴 Crítico · `U.modal()` borraba el DOM antes de resolver la promesa
`close(val)` hacía `scrim.remove()` y **después** `resolve(val)`; los `.then()` corren como
microtask, o sea después del borrado, así que cualquier handler que leyera el modal con
`U.$('#algo')` recibía `null` o `undefined`. Una sola causa raíz, seis funciones rotas:

| Función | Síntoma (verificado antes del arreglo) | Arreglo |
|---|---|---|
| `U.promptDialog()` | Devolvía siempre `null` → no se guardaban notas de ejercicio, nota de sesión ni el renombrado de sesión. | El valor se lee en `onClick` del botón Guardar (y con Enter en `onMount`). |
| `ui.exerciseEditor()` | `TypeError: …reading 'trim'` → crear/editar ejercicios propios no guardaba nada y fallaba en silencio (unhandled rejection). | Nuevo `readPatch(box)` en `onClick`; valida el nombre antes de cerrar (si está vacío, avisa y **no cierra**). |
| `ui.routineEditor()` | Guardaba "Rutina sin nombre" y perdía nombre/enfoque/notas. | `commit(box)` en `onClick` lee cabecera **y** las series/reps de cada ejercicio del modal. |
| `ui.plates()` | "Usar este peso" no aplicaba nada (`onUse` nunca se llamaba). | El botón resuelve con el peso leído en ese momento. |
| `ui.timer()` | Ignoraba los segundos elegidos y siempre arrancaba 90 s. | El botón resuelve con `#tm-sec` (acotado 5-3600). |
| `onboarding()` | El equipo elegido se perdía: elegir "Gimnasio completo" cargaba "casa básica". | El botón Empezar resuelve con un objeto `{name, goal, days, units, equip}`. |

Extra: `onboarding()` usaba la clave inexistente **`bosca`** (es `bosu`) en el preset gym y su
"Casa básica" no coincidía con la de Ajustes. Ahora los dos usan `D.equipPreset(kind)` en
`data.js` (fuente única) y los tests confirman que el preset gym excluye `bosu` y `trap_bar`.

**Por qué se programó así ahora:** el patrón `close(datos)` deja el `.then()` como consumidor
puro de valores y elimina la dependencia de "el DOM sigue vivo". Ver §4 · Contrato de los modales.

### 🟠 Alto · `views-train.js` mostraba "máx 0 kg"
`T.maxLoadable()` devuelve `totalKg`; la tarjeta de la calculadora de discos usaba `ml.total`
(inexistente). Arreglado → "máx 200 kg" en el caso por defecto.

### 🟡 Medio · Los ajustes de sonido y vibración se leían de una clave inexistente
`U.beep()`/`U.vibrate()` leían `U.st.get('settings')`, pero los ajustes están en
`pulso.state.settings` (la única clave es `pulso.state`). Efectos: el volumen siempre era 0,6 y
los interruptores "Vibración" y "Sonido" no hacían nada. Arreglado con el helper `settings()` de
core.js (store → localStorage) y respetando `sound`.

### 🟡 Medio · Pesos con decimales invisibles en la sesión
En `setRow` (views-train.js) el `value` de los `<input type="number">` se generaba con
`U.fmt.n()` (coma decimal, "2,5"), y el navegador **descarta** ese valor: el campo aparecía
vacío (aviso en consola `The specified value "2,5" cannot be parsed`). Afectaba a cualquier peso
o repetición decimal (medio kilo/lb, conversiones kg↔lb). Arreglado con el helper `inputNum(v)`
(punto decimal).

### 🟡 Bajo · Duplicidad y limpieza
- Ajustes → Entreno tenía **dos filas para el mismo ajuste** `autoRest` ("Descanso automático al
  marcar serie" e "Iniciar descanso automático"); se quitó la segunda (no era un ajuste distinto).
- El onboarding usaba `data-act="ob:equip"` sin acción registrada → aviso `acción sin handler` en
  cada click. Ahora usa `data-ob-equip`, como el resto de modales (`data-dact`).
- `index.html`: añadido `<meta name="mobile-web-app-capable">` (el de Apple está deprecado en
  Chrome). Consola limpia: 0 errores y 0 avisos en una carga normal.
- `U.fmt.n(v, dec)` ignoraba `dec` (salvo 0) y `U.fmt.w()` era código muerto con ramas idénticas;
  ahora `dec` fija los decimales máximos (con caché de formateadores) y `U.fmt.w()` = 1 decimal.
- `views-coach.js`: eliminada la condición `!V._noScroll` (variable que nunca se asignaba).
- `views-routines.js`: eliminado un `var last` sin usar.
- `App.ui._notified` crecía sin límite; ahora se guarda solo la última sesión avisada
  (`_notifiedSession`).
- `README.md`: "24 comprobaciones" → 57; nota de que el auto-test no cubre modales.
- `trainer.js`: comentario de cabecera actualizado (ya no hay modal de descanso).

### Cómo se verificó (útil para repetirlo)
Con la app servida en local y Playwright: auto-test 57/57, `node --check` de todos los JS, y los
flujos a mano: `promptDialog` devolviendo el texto escrito, editor de rutina guardando
nombre/enfoque/series, editor de ejercicio creando y editando, calculadora devolviendo el peso,
temporizador respetando 45 s, `beep` silencioso con Sonido off y con volumen 0,2, tarjeta "máx
200 kg", onboarding aplicando gym y solo-peso-corporal, sesión completa (empezar → marcar serie →
descanso dentro del recuadro → finalizar → detalle), notas de sesión, y menú de rutina →
eliminar dejando 0 modales abiertos. Consola: 0 errores.

---

## 8. Registro de cambios

| Fecha | Cambio | Por qué |
|---|---|---|
| 15-sep-2026 | Creación de `AGENTS.md` | Documentar arquitectura, decisiones e informe de la revisión para no perder contexto entre sesiones. |
| 15-sep-2026 | Arreglo del bug crítico de `U.modal` en los 6 flujos afectados (promptDialog, editores de rutina y ejercicio, calculadora de discos, temporizador, onboarding) | Eran funciones que no guardaban nada y fallaban sin avisar. Se adoptó el patrón `onClick(box, close)` y se documentó el contrato en §4. |
| 15-sep-2026 | Helper `settings()` en core.js; `U.beep` respeta `sound` y `volume`; `U.vibrate` respeta `vibrate` | Los ajustes se leían de una clave de localStorage que no existe: los interruptores no hacían nada. |
| 15-sep-2026 | `D.equipPreset()` / `D.EQUIP_PRESETS` y uso en onboarding y Ajustes → Equipo | Unificar los presets, que no coincidían, y corregir la clave inexistente `bosca` → `bosu`. |
| 15-sep-2026 | `inputNum()` en views-train + `U.fmt.n(dec)` corregido | Los pesos decimales se pintaban con coma y los `<input type="number">` los descartaban (campos vacíos). |
| 15-sep-2026 | `ml.total` → `ml.totalKg`; pila de modales en `U.modal`; fila duplicada de `autoRest`; limpiezas varias | Bugs menores y ruido; la pila hace que cerrar un diálogo devuelva el foco al modal de debajo en vez de dejarlo huérfano. |
| 15-sep-2026 | `sw.js` con shell offline + precarga; `manifest` ampliado (`id`, `dir`, `display_override`, `categories`); `A.pwa` + fila "Instalar como aplicación" en Ajustes → Datos | La app ya era instalable pero no había offline: el service worker solo atendía notificaciones. Se eligió network-first con respaldo en caché para no congelar versiones en un proyecto sin hashes. |
| 15-sep-2026 | `weight` opcional en los items de rutina (+ `T.start` lo aplica y arrastra las `notes`); coach y editor lo conservan | Los pesos del coach y de las rutinas con peso se perdían al guardar/arrancar: la sesión siempre prellenaba con la sugerencia por historial. |
| 15-sep-2026 | `PERSONAL_ROUTINES` + `seedPersonalRoutines()` con la rutina "Espalda + Pecho + Brazos (superseries)" y su agenda para el día | El usuario pidió esa rutina para entrenar ya, y solo una vez: se siembra una sola vez por dispositivo (clave `pulso.seeded-routines`) y no reaparece al borrar los datos. |
| 16-sep-2026 | Aviso de fin de descanso de ~3,5 s (`U.beep('end')` = 5 avisos) + `U.keepAlive` (audio de silencio en bucle + `mediaSession`) + `U.wakeLock.refresh()` | Con el móvil bloqueado el navegador congela la pestaña y no sonaba nada: el keep-alive la mantiene viva para que el pitido llegue, y el aviso es largo para oírse desde lejos. |
| 16-sep-2026 | `schedule-rest` / `cancel-rest`: el descanso se **programa** en el service worker (`waitUntil` + `showNotification` con `requireInteraction`) | Tercera capa del aviso con el móvil bloqueado o la app cerrada; `notifyWhenHidden()` evita el duplicado si la app está delante. |
| 16-sep-2026 | Calculadora de discos v2: modos `bar`/`db1`/`db2`/`none`, huecos y `cap = floor(2·pares/huecos)`, reparto simétrico por enumeración completa y alternativas (±1 paso) en la UI; `settings.plateModes` recuerda el modo por ejercicio | Antes asumía una barra: con mancuernas ajustables daba pesos imposibles de montar con el inventario real. Ahora busca el peso más cercano al pedido y explica cómo cargarlo. |
| 16-sep-2026 | Inventario y equipo por defecto nuevos (`D.PLATES_DEFAULT`, `BARS_DEFAULT` a 0 kg, `DEFAULT_EQUIPMENT` con mancuernas ajustables + discos + dominadas + paralelas) y migración única `inventario-v2` (`pulso.applied-setup`) | Ajustar la app al material real del usuario sin pisarle los cambios que haga después a mano. |
| 16-sep-2026 | `paint(root)` en el timer de descanso (la vista le pasa su contenedor) | `document.getElementById('session-rest')` podía pintar otra copia del mismo id (p. ej. el render del auto-test) y dejaba el recuadro vacío. |
| 16-sep-2026 | Auto-test ampliado a 66 comprobaciones (modos de la calculadora, caps por modo, beep de ~3,5 s, precisión del solver) y ahora independiente de los modos guardados | El test anterior no cubría nada de esto y fallaba si el usuario había guardado un modo a mano. |
