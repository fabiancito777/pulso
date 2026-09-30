# AGENTS.md · Pulso **v2**

Documento de contexto de esta app. Aquí no es HTML+JS vanilla: es
**Vite + TypeScript + Preact**, con tests de verdad. La v1 congelada está en `legacy/` (y en el
tag **`v1-final`**, que es su última versión con los fixes de audio) y su documentación completa
—decisiones de diseño, reglas de la sesión, timer de descanso, coach IA— está en
**`AGENTS-v1.md`**: sigue siendo válida como referencia del _por qué_ de cada regla, así que si
dudas, mira ahí primero.

> Última actualización: 29-sep-2026 · **migración completa**: la v2 es la app por defecto
> (`main` = v2); las 7 pestañas montadas (Hoy, Entrenar, Rutinas, Calendario, Coach, Progreso y
> Ajustes), coach IA con cerebro, memoria y consultas **más** planificador local sin key, PWA y
> onboarding. `npm run test` ≈ **687 tests**; ojo: los `smoke`/`edge` de `src/features/coach/`
> hablan con la API REAL usando la key de `.env.local` (~13 llamadas por `npm run test`; se
> excluyen con `--exclude`).

---

## 1. Qué es esta app

| Situación      | Qué hay                                                                                           | Cómo se abre                                          |
| -------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **hoy**        | **v2**: la app portada a Vite 8 + TypeScript 6 + Preact 10 + Vitest 5, con ESLint/Prettier.       | `npm run dev` (o `npm run build` + `npm run preview`) |
| `v1-final`     | **v1** (HTML + CSS + JS vanilla, sin deps ni build), tal como quedó al cerrar la migración.       | sacar el tag y abrir `index.html`                     |

- `legacy/` es la **v1 congelada** (fuente de la migración). No se toca, no se formatea y no
  entra en el lint (`eslint.config.js` la ignora). Es el patrón de referencia.
- El estado sigue en `localStorage['pulso.state']` con el **mismo formato que la v1**: v2 lee y
  escribe lectura-modificación-escritura, así que los datos que ya tienes valen.

### Decisiones de stack y por qué

- **Vite 8** — servidor de desarrollo con HMR, `import`/`export` de verdad y build estático
  minificado (38 KB de JS, ~15 KB gzip). Config en `vite.config.ts`, con `base: './'` para que el
  `dist/` funcione también desde un subdirectorio.
- **Preact 10 + `@preact/signals`** — componentes con estado reactivo y ~4 KB de runtime (un
  framework grande engordaría la PWA offline sin dar nada a cambio). Esto elimina de raíz la clase
  de bug que más dolía en la v1: repintados a mano (`A.rerenderPart`, `Ch.mountAll`,
  `document.getElementById('session-rest')` cogiendo otra copia del mismo id…).
- **TypeScript 6** (no 7) — a 16-sep-2026 `typescript-eslint` 8.70 exige `typescript <6.1`, así
  que TS 7 dejaría el proyecto sin lint tipado. Cuando typescript-eslint lo soporte, subir a 7 es
  cambiar una versión.
- **Vitest 5** — las comprobaciones que en la v1 vivían dentro del auto-test del navegador
  (`legacy/js/app.js` → `selfTest()`) ahora son tests normales, sin navegador y con estado
  explícito. El auto-test sigue existiendo en `legacy/`, pero su sitio natural es `src/**/*.test.ts`.
- **ESLint 10 + `typescript-eslint` (tipado) + Prettier** — el lint usa información de tipos
  (`projectService`), por eso caza cosas que el lint clásico no ve.

---

## 2. Cómo ejecutarla y cómo verificarla

```bash
npm install          # una vez
npm run dev          # http://localhost:5173 — desarrollo con HMR
npm run build        # build de producción en dist/
npm run preview      # sirve el build
```

| Comando                       | Qué hace                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`           | `tsc --noEmit` con `strict`, `noUnusedLocals`…                                                                            |
| `npm run lint`                | ESLint con reglas tipadas (`recommendedTypeChecked`)                                                                      |
| `npm run test`                | Vitest (hoy ≈ **585 tests**: dominio, estado y UI; ver las notas de abajo sobre los dos archivos de red del coach)        |
| `npm run verify`              | typecheck + lint + test + build (lo que hay que dejar verde)                                                              |
| `npm run format`              | Prettier sobre todo lo que no sea `legacy/`                                                                               |
| `node tools/port-catalog.mjs` | **Regenera** `src/domain/catalog.ts` desde `legacy/js/data.js` (luego `npx prettier --write src/domain/catalog.ts`)       |
| `node tools/port-icons.mjs`   | **Regenera** `src/ui/icons.ts` desde los `ico(...)` de `legacy/js/core.js` (luego `npx prettier --write src/ui/icons.ts`) |

Notas de entorno:

- El servidor de Vite manda `no-store`, así que **no** te pasa lo de la v1 con la caché del
  navegador sirviendo código viejo.
- Si algo de UI no se puede probar con Vitest (modales, timer, dibujo), se comprueba en el
  navegador con Playwright y se guarda una captura en `_shots/` (está en `.gitignore`).
- **Tests contra la API real**: `src/features/coach/smoke.test.ts` y `edge.test.ts` no mockean la
  red: leen la key de **`.env.local`** (gitignored, **nunca commitear**) y hacen ~13 llamadas a
  Gemini por `npm run test` (presupuesto duro por archivo: 2 y 20; sin key se saltan enteros). Para
  una pasada sin red ni cuota:
  `npx vitest run --exclude 'src/features/coach/{smoke,edge}.test.ts'`.
- `_specs/` guarda las specs de trabajo de la migración (gitignored, como `_shots/`): son el
  contrato de cada bloque; el estado consolidado —no duplicado— está en `src/app/roadmap.ts`.

---

## 3. Arquitectura y carpetas

```
index.html          → entrada de Vite (carga src/main.tsx)
src/main.tsx        → monta <App /> en #app e importa los estilos
src/app/            → shell de la app (App.tsx) y roadmap.ts (estado de la migración)
src/domain/         → NÚCLEO PURO: sin DOM, sin localStorage, sin estado global
    num / format / units / dates / text        utilidades base
    plates.ts                                  calculadora de discos (solver)
    analytics.ts                               volumen, 1RM (Epley), PRs, rachas, semanas
    session.ts                                 reglas de la sesión en curso (marcar, arrastrar, cerrar)
    rest.ts                                    timer de descanso por timestamp (máquina de estados)
    plan.ts                                    plantillas y planner local (rotación y pesos, sin IA)
    catalog.ts                                 catálogo GENERADO desde la v1 (no se edita a mano)
    data.ts                                    API del catálogo (grupos, material, disponibilidad)
    library.ts                                 fusión semilla ↔ lo guardado (mergeSeed)
    defaults.ts                                ajustes e inventario por defecto
    types.ts                                   contrato del dominio y del estado
src/state/          → estado y persistencia (store.ts) + signals
    store.ts                                   ajustes, material, biblioteca, sesiones, apilar sesión
    session.ts                                 sesión activa y descanso (signals + efectos: audio, loop)
    coach.ts                                   runner del coach: bucle de consultas y fallback local
src/features/       → piezas concretas con sus propios tests
    coach/                                     cerebro del coach: context (contexto), insights,
                                               memory (memoria), history (historial y consultas),
                                               prompts, parse (JSON), client (Gemini) y local
                                               (planificador sin key)
src/ui/             → componentes Preact (Plates.tsx, LoadView.tsx, ProgressCard.tsx,
                      SessionCard.tsx, Icon.tsx, Ring.tsx)
    *View.tsx                                  vistas de pestaña: Hoy, Settings, Progress, Routines,
                                               Calendar y Coach (+ Onboarding.tsx: primera visita)
    icons.ts                                   catálogo de iconos GENERADO desde la v1 (no se edita)
src/platform/       → lo que toca el navegador (audio.ts: pitidos y vibración)
src/styles/         → base.css (heredada de la v1) + v2.css (shell)
tools/              → scripts de migración (port-catalog.mjs, port-icons.mjs)
legacy/             → v1 congelada (referencia y fuente de la migración)
_specs/             → specs de trabajo de la migración (gitignored)
.env.local          → API key del coach para los tests de red (gitignored, NUNCA commitear)
```

Reglas de dependencia (de dentro hacia fuera, nunca al revés):

```
domain  ←  features  ←  state  ←  ui
```

- **`domain/` no importa nada de `features/`, `state/` ni de `ui/`.** Es la regla que hace que la
  lógica se pueda probar sin navegador: el solver de discos recibe el inventario por parámetro en
  vez de ir a buscar los ajustes. En la v1 esto estaba mezclado (`T.plates` leía `S.settings()` por
  dentro) y por eso había que probarlo en el navegador.
- **`features/` solo importa de `domain/`** (el cerebro del coach es puro: contexto, prompts,
  parseo, memoria y planificador local), y es `state/coach.ts` quien le da red, clave y bucle.
- **Nada escribe el estado directamente**: se pasa por `state/store.ts` (`patchSettings`,
  `rememberPlateMode`), que lee-modifica-escribe el estado completo para no pisar lo que gestiona
  la v1.
- **Los componentes no montan HTML a mano.** Preact escapa solo, así que `U.esc()` no se porta
  (si algún día hace falta HTML crudo, será una decisión explícita y localizada).

### Flujo de datos

```
localStorage['pulso.state']  (mismo formato que la v1)
        ↕  readState() / writeState()  (tolerantes: JSON roto → valores por defecto)
   state (objeto completo en memoria)
        ↕  patchSettings(patch)
   signal `settings`  → cualquier componente que lea settings.value se repinta solo
```

`withDefaults()` rellena las claves que falten de forma recursiva, así que añadir un ajuste nuevo
**no** necesita migración (es el `mergeDefaults` de la v1, con tipos).

---

## 4. Convenciones (respétalas al portar)

- **Rutas y alias**: `@/…` apunta a `src/` (definido en `tsconfig.json` y en `vite.config.ts`).
- **`catalog.ts` y `ui/icons.ts` son generados**: no se editan a mano. Se cambia la v1 (o el
  generador) y se vuelve a lanzar `node tools/port-catalog.mjs` / `node tools/port-icons.mjs`. Lo que
  se añade a mano va en `data.ts`, y `data.test.ts` vigila la integridad del catálogo (grupos o
  material inexistentes, ids repetidos, rangos al revés).
- **Nada de estado que se repinte solo en exceso**: un componente que lee `restSeconds.value` se
  repinta cada segundo, así que eso vive en componentes pequeños (`RestBox`, `Clock`) y nunca en la
  tarjeta que contiene los inputs: si no, cada tic reescribiría el `value` de lo que estás
  escribiendo. Los campos de la sesión se guardan en `change` (no en `input`) por el mismo motivo,
  y para que el arrastre del peso copie el valor cuando terminas de teclear.
- **Material en los ejercicios**: `equip` es `''` (peso corporal) o `'a&b|c'` = exige `a` **y**
  (`b` **o** `c`). Se consulta con `isAvailable`/`missingEquipment`/`equipTags` pasando el mapa de
  material por parámetro (`{ clave: boolean }`), nunca leyendo el estado desde el dominio.
- **Imports de tipos** con `import type` (`verbatimModuleSyntax` está activo).
- **Números en inputs**: usa `inputNum()` de `src/domain/format.ts` para el `value` de un
  `<input type="number">`. `fmtN()` usa la coma de es-ES y el navegador **descarta** ese valor (el
  campo sale vacío). Fue un bug real de la v1.
- **Fechas**: ISO local `YYYY-MM-DD` con `src/domain/dates.ts`. Nunca
  `toISOString().slice(0, 10)` para fechas de calendario (desfase por zona horaria).
- **Unidades**: todo se calcula **siempre en kg** (`toKg`/`fromKg`) y solo se convierte para
  mostrar; cada sesión y cada disco guardan su unidad original.
- **JSDoc en castellano** y nombres de identificadores en inglés, igual que la v1. Los comentarios
  explican _por qué_, no _qué_.
- **CSS**: se hereda `base.css` de la v1 para que lo portado se vea igual. A las clases nuevas
  (`v2-*`, `rm-*`) se les añade su bloque en `v2.css`. Se irá podando cuando las vistas estén todas
  en componentes.
- **Estilos/prettier**: 2 espacios, comillas simples, ancho 100.

### Receta para portar un bloque de la v1

1. **Dominio primero**: lleva la lógica a `src/domain/`, quítale el acceso al estado (que entre por
   parámetro) y escribe el test en `xxx.test.ts`. Nada de UI todavía.
2. **Estado después**: si necesita persistencia, añade el setter a `src/state/store.ts`.
3. **UI al final**: crea el componente en `src/ui/`.
4. **Borra la copia desde `legacy/` solo cuando el bloque esté cubierto por tests**, y actualiza
   `src/app/roadmap.ts` (que es lo que se ve en la app: `portado` / `en curso` / `pendiente`).

El estado de cada bloque está en **`src/app/roadmap.ts`** — una sola fuente, sin listas duplicadas
en la documentación.

---

## 5. Cosas de la v1 que NO se pueden romper al portar

Están explicadas a fondo en `AGENTS-v1.md`; aquí queda el resumen de lo delicado:

- **Calculadora de discos**: el mismo inventario no rinde igual en todo, de ahí los **huecos**
  (`bar` 2 lados, `db1` 2 extremos, `db2` 4 huecos = 2 por mancuerna, `none` 0). `cap =
floor(2·pares/huecos)` y reparto **simétrico**, eligiendo la suma más cercana al peso pedido por
  enumeración completa (nunca propone discos que no tengas). El margen `exact` es 0,1 kg y en `db2`
  el peso devuelto es el de **cada** mancuerna. El dibujo se agrupa en pilas con "×N" cuando el
  hueco lleva más de 6 discos, porque si no la fila mide 984 px dentro de un contenedor de 579 y se
  ve cortada (parecía que un lado iba vacío).
- **Reglas de la sesión**: el valor se arrastra hacia ABAJO (nunca hacia arriba ni a las series ya
  marcadas), el RPE no se arrastra, el peso puede estar vacío (`''` ≠ `0`), desmarcar cancela el
  descanso, y el descanso arranca en la última serie del ejercicio **solo** si quedan series de otro
  (anunciando el siguiente ejercicio).
  - En v2 el arrastre son **dos pasos** (`setSet` + `propagateSet`, igual que el handler de la v1).
    Al portarlo se añadió `editSetField`, que hace los dos: `propagateSet` **no** escribe la serie
    editada, solo las de abajo, y es fácil creer que sí.
  - `toggleSet` **devuelve** la decisión de descanso (`start`/`cancel`/`none`) en vez de ejecutarla:
    así "cuándo hay descanso" se prueba con Vitest y el timer, el pitido y el service worker viven
    fuera del dominio.
  - **Marcar una serie autorrellena la siguiente** con su peso y sus reps si está vacía
    (`autofillNext`), y el descanso de una serie no se corta al marcar la última: si ya estaba
    corriendo, sigue. Ojo: eso significa que marcar la última serie de la sesión no arranca nada
    **pero tampoco para** lo que hubiera; lo para `finishSession`.
- **Timer de descanso**: el tiempo restante sale de `endsAt - Date.now()` (nunca de un contador), así
  que sigue siendo correcto con la pestaña congelada. `+15 s` con el descanso ya terminado arranca una
  cuenta NUEVA y el aviso de "completado" se cierra solo a los 30 s. El bucle (500 ms) lo arranca
  `App.tsx` y solo pinta/avisa: las decisiones están en `domain/rest.ts`.
- **Sugerencia de peso**: si el 1RM calculado sale **igual o por encima** del peso de la última vez,
  se propone `anterior + increment` (con las mismas reps el cálculo da exactamente el peso anterior,
  así que repetir el entreno sugiere subir) y nunca se salta más de un incremento. Al revés, si pides
  **más** repeticiones el peso baja de verdad. Está fijado en `analytics.test.ts` para que no se
  "arregle" por parecer raro.
- **Aviso con el móvil bloqueado**: pitido largo + keep-alive de audio + notificación programada en
  el service worker. Son tres capas a propósito; no basta con una.
- **PWA**: manifest instalable, service worker network-first (para no congelar versiones sin
  hashes) y notificaciones de fin de descanso.

---

## 6. Registro de cambios

| Fecha       | Cambio                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Por qué                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 16-sep-2026 | Rama `v2` desde `main`: `legacy/` con la v1 congelada, toolchain (Vite 8 + TypeScript 6 + Preact 10 + Vitest 5 + ESLint/Prettier) y scripts `dev/build/test/lint/typecheck/verify`                                                                                                                                                                                                                                                                     | Tener un stack donde el estado tenga tipos, la lógica se pueda probar sin navegador y las vistas no se monten concatenando strings.                                                                                                                                                                                                                                                                                                |
| 16-sep-2026 | Dominio puro portado: `num`, `format`, `units`, `dates`, `defaults` y `plates` (el solver de discos, ahora sin estado escondido) + **33 tests** con Vitest                                                                                                                                                                                                                                                                                             | Son las piezas que más se tocan y las que en la v1 solo se podían verificar dentro del navegador con `?selftest=1`.                                                                                                                                                                                                                                                                                                                |
| 16-sep-2026 | `src/state/store.ts`: ajustes reactivos con signals, lectura tolerante y **mismo formato de `localStorage`** que la v1                                                                                                                                                                                                                                                                                                                                 | Los datos ya existentes valen en las dos ramas y no hace falta migrar nada.                                                                                                                                                                                                                                                                                                                                                        |
| 16-sep-2026 | `src/ui/Plates.tsx` + `src/ui/LoadView.tsx`: la calculadora de discos ya funciona en la v2 (modo, ±, alternativas, inventario usado y el dibujo con pilas) y recuerda el modo por ejercicio                                                                                                                                                                                                                                                            | Primer bloque end-to-end en el stack nuevo; sirve de referencia para portar el resto.                                                                                                                                                                                                                                                                                                                                              |
| 16-sep-2026 | `src/app/App.tsx` (shell + estado de migración visible) y `src/styles/v2.css` sobre `base.css`                                                                                                                                                                                                                                                                                                                                                         | Poder abrir la v2 y ver qué está portado y qué no, sin depender de la documentación.                                                                                                                                                                                                                                                                                                                                               |
| 16-sep-2026 | Añadido `useGrouping: true` explícito en los formateadores                                                                                                                                                                                                                                                                                                                                                                                             | V8/Intl ya no separa millares de 4 dígitos por defecto: 1000 kg se leían "1000" en vez de "1.000".                                                                                                                                                                                                                                                                                                                                 |
| 16-sep-2026 | Catálogo portado: `catalog.ts` (generado con `tools/port-catalog.mjs` desde `legacy/js/data.js`) + `data.ts` (grupos, material, presets, disponibilidad) + `text.ts` (norm/slug/similarity) + `library.ts` (`mergeSeed`) con 24 comprobaciones nuevas                                                                                                                                                                                                  | El catálogo son ~300 líneas de datos que se colaban a mano con erratas (grupo o material inexistente, ids repetidos): ahora se genera y hay tests de integridad. De paso aparecieron dos datos curiosos que quedan fijados en los tests: el catálogo tiene **49** piezas de material (48 + `paralelas`, no 50 como decía la doc de la v1) y **10** ejercicios de cardio/movilidad con `rest: 0` a propósito (se miden en minutos). |
| 16-sep-2026 | `src/state/store.ts`: material (`equipment`) y biblioteca (`exercises`, ya fusionada con lo guardado) como signals, con `setEquipment` y `setExerciseAllowed`                                                                                                                                                                                                                                                                                          | Para que el dominio puro sea usable desde la UI sin volver a leer el estado a mano, y para que la tarjeta de biblioteca muestre datos reales (136 ejercicios, 45 disponibles con el material por defecto).                                                                                                                                                                                                                         |
| 16-sep-2026 | Movido el tooling de la v1 (`tools/serve                                                                                                                                                                                                                                                                                                                                                                                                               | check                                                                                                                                                                                                                                                                                                                                                                                                                              | selftest.mjs`) fuera de esta rama | Esas comprobaciones eran para `js/*.js` y el auto-test del navegador; en v2 su equivalente es typecheck + lint + Vitest + build. Siguen en `main`. |
| 24-sep-2026 | Analítica portada: `src/domain/analytics.ts` (1RM de Epley, volumen, series, duración, ventanas, reparto por grupo, _staleness_, semanas, rachas, PRs, histórico y sugerencia de peso, todo por parámetro) + **42 tests** y la tarjeta `ProgressCard`                                                                                                                                                                                                  | Era el bloque que necesita "Progreso", y es puro: se prueba entero sin navegador. La regla de la sugerencia de peso (subir un incremento cuando el cálculo no da más) parecía un bug hasta ver el caso, así que queda documentada y fijada en tests.                                                                                                                                                                               |
| 24-sep-2026 | `src/state/store.ts`: signal de solo lectura `sessions`, con validación de forma                                                                                                                                                                                                                                                                                                                                                                       | La tarjeta de progreso lee el mismo `pulso.state` que la v1, así que los números de las dos ramas se pueden contrastar a ojo. Apilar y editar sesiones llega con el bloque de la sesión activa.                                                                                                                                                                                                                                    |
| 24-sep-2026 | Timer de descanso portado a `src/domain/rest.ts` (**23 tests**) y pitido/vibración a `src/platform/audio.ts`                                                                                                                                                                                                                                                                                                                                           | La máquina de estados (ticks de los últimos 3 s, aviso de fin una sola vez, cierre a los 30 s, `+15 s` que arranca cuenta nueva) deja de estar dentro del bucle de la UI. El `now` entra por parámetro, así que se prueba sin esperar 90 s de verdad.                                                                                                                                                                              |
| 24-sep-2026 | Catálogo de **iconos** generado con `tools/port-icons.mjs` (54 iconos) + `src/ui/Icon.tsx` y `src/ui/Ring.tsx`                                                                                                                                                                                                                                                                                                                                         | Copiar 54 trazos SVG a mano es la misma trampa que el catálogo de ejercicios: se genera desde `legacy/js/core.js`. El anillo del descanso pasa a ser un componente (en la v1 había que refrescarlo a mano con `U.ringUpdate`).                                                                                                                                                                                                     |
| 24-sep-2026 | `src/state/session.ts` (sesión en curso + descanso con signals y **la misma persistencia que la v1**: `pulso.state.active` y `pulso.rest`) y `src/ui/SessionCard.tsx`                                                                                                                                                                                                                                                                                  | Ya se puede entrenar entero en la v2: marcar series, arrastre del peso, descanso con recuadro pegajoso, notas, finalizar (apila la sesión y marca el día como hecho, con el mismo formato que la v1) o descartar. Verificado en el navegador de principio a fin.                                                                                                                                                                   |
| 24-sep-2026 | `autofillNext` en `domain/session.ts` (marcar rellena la siguiente) y el aviso de "todas las series marcadas"                                                                                                                                                                                                                                                                                                                                          | Eran dos detalles de la v1 que estaban en el handler del click, no en `T.toggleSet`: sin el autorrelleno, cada serie se escribe desde cero.                                                                                                                                                                                                                                                                                        |
| 24-sep-2026 | Reglas de la sesión portadas a `src/domain/session.ts` (**39 tests**) con tipos `ActiveSet`/`ActiveEntry`/`ActiveSession`, `findExerciseByName` en `data.ts` y la operación combinada `editSetField`                                                                                                                                                                                                                                                   | Son las reglas que más se rompen sin querer (arrastre hacia abajo, peso vacío ≠ 0, cuándo arranca el descanso) y en la v1 solo se podían comprobar entrenando o con el auto-test del navegador. Las funciones no mutan nada (para que Preact repinte solo) y devuelven la decisión de descanso en vez de arrancar el timer.                                                                                                        |
| 29-sep-2026 | Migración **prácticamente completa**: las 7 pestañas montadas (Hoy, Entrenar, Rutinas, Calendario, Coach, Progreso y Ajustes), coach IA (`src/features/coach/` + `src/state/coach.ts`) con memoria, consultas al historial y planificador local sin key (`src/domain/plan.ts`), extras de sesión (discos por serie, «Añadir rutina», picker multi, descanso editable), avisos con el móvil bloqueado, PWA e onboarding. `npm run test` ≈ **585 tests** | `src/app/roadmap.ts` queda en **16 de 16 bloques `portado`**, así que el estado se mira ahí y no en la doc. Los dos archivos de red del coach (`smoke.test.ts`, `edge.test.ts`) son los únicos que hablan con Gemini de verdad: van con la key de `.env.local` y se excluyen con `--exclude`.                                                                                                                                      |
