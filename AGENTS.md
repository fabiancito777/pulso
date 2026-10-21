# AGENTS.md · Pulso

Documento de contexto de la app: **Vite 8 + TypeScript 6 + Preact 10 + Vitest 5**, con ESLint y
Prettier. Siete pestañas montadas (Hoy, Entrenar, Rutinas, Calendario, Coach, Progreso y Ajustes),
coach IA con memoria y consultas, planificador local sin key, perfiles, PWA y onboarding.

> `npm run test` ≈ **1354 tests** offline. Los `smoke`/`edge`/`quality` de `src/features/coach/`
> hablan con la API REAL usando la key de `.env.local` y se excluyen por defecto (van con
> `npm run test:net`).

---

## 1. Qué es esta app

| Qué hay                                                                                   | Cómo se abre                                          |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Aplicación de entrenamiento con Vite 8, TypeScript 6, Preact 10, Vitest 5 y ESLint/Prettier. | `npm run dev` (o `npm run build` + `npm run preview`) |

- El estado vive en `localStorage` y se lee/escribe con lectura-modificación-escritura. Cada perfil
  tiene su espacio de claves; el perfil principal usa `pulso.state` y el resto `pulso.state.<id>`.
- El inventario de discos se guarda en **unidades** (`discs`). `normalizePlates` normaliza las filas
  al leer y al escribir, sin reescribir `localStorage` al arrancar.
- La API key del coach es única para todos los perfiles (`pulso.ai-key`).

### Decisiones de stack y por qué

- **Vite 8** — HMR, `import`/`export` reales y build estático minificado. `base: './'` para que el
  `dist/` funcione también desde un subdirectorio.
- **Preact 10 + `@preact/signals`** — estado reactivo con ~4 KB de runtime. Evita repintados a mano
  y la clase de bug de tener varias copias del mismo nodo.
- **TypeScript 6** (no 7) — a 16-sep-2026 `typescript-eslint` 8.70 exige `typescript <6.1`, así que
  TS 7 dejaría el proyecto sin lint tipado. Cuando typescript-eslint lo soporte, subir es cambiar
  una versión.
- **Vitest 5** — la lógica y la UI se prueban sin navegador y con estado explícito.
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

| Comando             | Qué hace                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck` | `tsc --noEmit` con `strict`, `noUnusedLocals`…                                                                  |
| `npm run lint`      | ESLint con reglas tipadas (`recommendedTypeChecked`)                                                            |
| `npm run test`      | Vitest **offline** (≈ **1354 tests**: dominio, estado y UI; excluye smoke/edge/quality, que van con `test:net`) |
| `npm run verify`    | typecheck + lint + test + build (lo que hay que dejar verde)                                                    |
| `npm run format`    | Prettier sobre el proyecto                                                                                      |

Notas de entorno:

- El servidor de Vite manda `no-store`, así que el navegador no sirve código viejo.
- Si algo de UI no se puede probar con Vitest (modales, timer, dibujo), se comprueba en el
  navegador con Playwright y se guarda una captura en `_shots/` (está en `.gitignore`).
- **Tests contra la API real**: `src/features/coach/smoke.test.ts`, `edge.test.ts` y `quality.test.ts`
  no mockean la red: leen la key de **`.env.local`** (gitignored, **nunca commitear**) y hacen
  llamadas a Gemini (presupuesto duro por archivo: 2 y 20; sin key se saltan enteros). `npm run test`
  los **excluye** por defecto (pasada offline, sin red ni cuota); para ejecutarlos: `npm run test:net`
  (o `npm run test:quality` solo el de calidad).
- `_specs/` guarda las specs de trabajo (gitignored, como `_shots/`).

---

## 3. Arquitectura y carpetas

```
index.html          → entrada de Vite (carga src/main.tsx)
src/main.tsx        → monta <App /> en #app e importa los estilos
src/app/            → shell de la app (App.tsx) y router.ts (pestañas y rutas por hash)
src/domain/         → NÚCLEO PURO: sin DOM, sin localStorage, sin estado global
    num / format / units / dates / text        utilidades base
    plates.ts                                  calculadora de discos (solver)
    analytics.ts                               volumen, 1RM (Epley), PRs, rachas, semanas
    session.ts                                 reglas de la sesión en curso (marcar, arrastrar, cerrar)
    rest.ts                                    timer de descanso por timestamp (máquina de estados)
    plan.ts                                    plantillas y planner local (rotación y pesos, sin IA)
    catalog.ts                                 catálogo base congelado (no se edita a mano)
    data.ts                                    API del catálogo (grupos, material, disponibilidad)
    library.ts                                 fusión semilla ↔ lo guardado (mergeSeed)
    defaults.ts                                ajustes e inventario por defecto
    types.ts                                   contrato del dominio y del estado
src/state/          → estado y persistencia (store.ts) + signals
    store.ts                                   ajustes, material, biblioteca, sesiones, apilar sesión
    profiles.ts                                índice de perfiles, claves por perfil y key compartida
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
    icons.ts                                   catálogo de iconos base congelado (no se edita)
src/platform/       → lo que toca el navegador (audio.ts: pitidos y vibración)
src/styles/         → base.css (hoja base) + v2.css (shell) y estilos por vista
_specs/             → specs de trabajo (gitignored)
.env.local          → API key del coach para los tests de red (gitignored, NUNCA commitear)
```

Reglas de dependencia (de dentro hacia fuera, nunca al revés):

```
domain  ←  features  ←  state  ←  ui
```

- **`domain/` no importa nada de `features/`, `state/` ni de `ui/`.** Es la regla que hace que la
  lógica se pueda probar sin navegador: el solver de discos recibe el inventario por parámetro en
  vez de ir a buscar los ajustes.
- **`features/` solo importa de `domain/`** (el cerebro del coach es puro: contexto, prompts,
  parseo, memoria y planificador local), y es `state/coach.ts` quien le da red, clave y bucle.
- **Nada escribe el estado directamente**: se pasa por `state/store.ts` (`patchSettings`,
  `rememberPlateMode`), que lee-modifica-escribe el estado completo.
- **Perfiles**: cada perfil usa `pulso.state` (el principal) o `pulso.state.<id>`; el descanso va
  igual en `pulso.rest[.<id>]`. El índice vive en `pulso.profiles`, el activo en
  `pulso.active-profile` y la **API key del coach es única** en `pulso.ai-key` (se inyecta al leer
  y se sincroniza al escribir). Cambiar de perfil recarga la app para reinicializar los signals; no
  se mueven datos del perfil principal.
- **Los componentes no montan HTML a mano.** Preact escapa solo; si algún día hace falta HTML crudo,
  será una decisión explícita y localizada.

### Flujo de datos

```
localStorage['pulso.state'] / pulso.state.<id>  (placas en unidades, `discs`)
        ↕  readState() / writeState()  (tolerantes: JSON roto → valores por defecto)
   state (objeto completo en memoria)
        ↕  patchSettings(patch)
   signal `settings`  → cualquier componente que lea settings.value se repinta solo
```

`withDefaults()` rellena las claves que falten de forma recursiva, así que añadir un ajuste nuevo
**no** necesita migración.

---

## 4. Convenciones

- **Rutas y alias**: `@/…` apunta a `src/` (definido en `tsconfig.json` y en `vite.config.ts`).
- **`catalog.ts` y `ui/icons.ts` son ficheros base congelados**: no se regeneran ni se tocan a la
  ligera. Lo que se añade a mano (presets, ejercicios) va en `data.ts` / `seed.ts`, y `data.test.ts`
  vigila la integridad del catálogo (grupos o material inexistentes, ids repetidos, rangos al revés).
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
  campo sale vacío). Fue un bug real.
- **Fechas**: ISO local `YYYY-MM-DD` con `src/domain/dates.ts`. Nunca
  `toISOString().slice(0, 10)` para fechas de calendario (desfase por zona horaria).
- **Unidades**: todo se calcula **siempre en kg** (`toKg`/`fromKg`) y solo se convierte para
  mostrar; cada sesión y cada disco guardan su unidad original.
- **JSDoc en castellano** y nombres de identificadores en inglés. Los comentarios explican _por qué_,
  no _qué_.
- **CSS**: `base.css` (hoja base) + `v2.css` (shell) y un fichero por vista. Las clases nuevas se
  añaden a su bloque correspondiente.
- **Estilos/prettier**: 2 espacios, comillas simples, ancho 100.

### Receta para añadir una funcionalidad

1. **Dominio primero**: lleva la lógica a `src/domain/`, sin acceso al estado (que entre por
   parámetro), y escribe el test en `xxx.test.ts`. Nada de UI todavía.
2. **Estado después**: si necesita persistencia, añade el setter a `src/state/store.ts`.
3. **UI al final**: crea el componente en `src/ui/`.
4. **Da el bloque por cerrado solo cuando esté cubierto por tests.**

---

## 5. Reglas que no se pueden romper

- **Calculadora de discos**: el mismo inventario no rinde igual en todo, de ahí los **huecos**
  (`bar` 2 lados, `db1` 2 extremos, `db2` 4 huecos = 2 por mancuerna, `none` 0). El inventario se
  cuenta en **discos sueltos** (`PlateStock.discs`, enteros: un impar sobra uno en el reparto) y
  `cap = floor(discos/huecos)` con reparto **simétrico**, eligiendo la suma más cercana al peso
  pedido por enumeración completa (nunca propone discos que no tengas). El margen `exact` es 0,1 kg
  y en `db2` el peso devuelto es el de **cada** mancuerna. El dibujo se agrupa en pilas con "×N"
  cuando el hueco lleva más de 6 discos, porque si no la fila mide 984 px dentro de un contenedor de
  579 y se ve cortada (parecía que un lado iba vacío).
- **Reglas de la sesión**: el valor se arrastra hacia ABAJO (nunca hacia arriba ni a las series ya
  marcadas), el RPE no se arrastra, el peso puede estar vacío (`''` ≠ `0`), desmarcar cancela el
  descanso, y el descanso arranca en la última serie del ejercicio **solo** si quedan series de otro
  (anunciando el siguiente ejercicio).
  - El arrastre son **dos pasos** (`setSet` + `propagateSet`). `editSetField` hace los dos:
    `propagateSet` **no** escribe la serie editada, solo las de abajo, y es fácil creer que sí.
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

## 6. Historial

El historial completo vive en `git log`. Este documento describe el estado actual.
