# AGENTS.md · Pulso **v2** (rama `v2`)

Documento de contexto de **esta rama**. Aquí la app no es HTML+JS vanilla: es
**Vite + TypeScript + Preact**, con tests de verdad. La v1 sigue viva en `main` (solo HTML+JS,
sin build) y su documentación completa —decisiones de diseño, reglas de la sesión, timer de
descanso, coach IA— está en **`AGENTS-v1.md`**: sigue siendo válida para todo lo que todavía no
se ha portado, así que si dudas de *por qué* algo funciona así, mira ahí primero.

> Última actualización: 16-sep-2026 · arranque de la v2: toolchain, dominio puro (utilidades +
> calculadora de discos) con tests, ajustes reactivos y shell de la app.

---

## 1. Qué es esta rama

| Rama | Qué hay | Cómo se abre |
|---|---|---|
| `main` | **v1**: HTML + CSS + JS vanilla, sin deps ni build. Es la app que usas. | doble clic en `index.html` |
| `v2` (esta) | **v2**: la misma app portada a Vite 8 + TypeScript 6 + Preact 10 + Vitest 5, con ESLint/Prettier. | `npm run dev` (o `npm run build` + `npm run preview`) |

- `legacy/` es la **v1 congelada** (fuente de la migración). No se toca, no se formatea y no
  entra en el lint (`eslint.config.js` la ignora). Es el patrón de referencia mientras se porta.
- El estado sigue en `localStorage['pulso.state']` con el **mismo formato que la v1**: v2 lee y
  escribe lectura-modificación-escritura, así que los datos que ya tienes valen en las dos ramas.
- Nada se rompe en `main`: la migración es un port incremental, no un big bang.

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

| Comando | Qué hace |
|---|---|
| `npm run typecheck` | `tsc --noEmit` con `strict`, `noUnusedLocals`… |
| `npm run lint` | ESLint con reglas tipadas (`recommendedTypeChecked`) |
| `npm run test` | Vitest (dominio puro; hoy 33 comprobaciones) |
| `npm run verify` | typecheck + lint + test + build (lo que hay que dejar verde) |
| `npm run format` | Prettier sobre todo lo que no sea `legacy/` |

Notas de entorno:
- El servidor de Vite manda `no-store`, así que **no** te pasa lo de la v1 con la caché del
  navegador sirviendo código viejo.
- Si algo de UI no se puede probar con Vitest (modales, timer, dibujo), se comprueba en el
  navegador con Playwright y se guarda una captura en `_shots/` (está en `.gitignore`).

---

## 3. Arquitectura y carpetas

```
index.html          → entrada de Vite (carga src/main.tsx)
src/main.tsx        → monta <App /> en #app e importa los estilos
src/app/            → shell de la app (App.tsx) y roadmap.ts (estado de la migración)
src/domain/         → NÚCLEO PURO: sin DOM, sin localStorage, sin estado global
src/state/          → estado y persistencia (store.ts) + signals
src/ui/             → componentes Preact (Plates.tsx, LoadView.tsx)
src/styles/         → base.css (heredada de la v1) + v2.css (shell)
legacy/             → v1 congelada (referencia y fuente de la migración)
```

Reglas de dependencia (de dentro hacia fuera, nunca al revés):

```
domain  ←  state  ←  ui
```

- **`domain/` no importa nada de `state/` ni de `ui/`.** Es la regla que hace que la lógica se
  pueda probar sin navegador: el solver de discos recibe el inventario por parámetro en vez de ir
  a buscar los ajustes. En la v1 esto estaba mezclado (`T.plates` leía `S.settings()` por dentro) y
  por eso había que probarlo en el navegador.
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
- **Imports de tipos** con `import type` (`verbatimModuleSyntax` está activo).
- **Números en inputs**: usa `inputNum()` de `src/domain/format.ts` para el `value` de un
  `<input type="number">`. `fmtN()` usa la coma de es-ES y el navegador **descarta** ese valor (el
  campo sale vacío). Fue un bug real de la v1.
- **Fechas**: ISO local `YYYY-MM-DD` con `src/domain/dates.ts`. Nunca
  `toISOString().slice(0, 10)` para fechas de calendario (desfase por zona horaria).
- **Unidades**: todo se calcula **siempre en kg** (`toKg`/`fromKg`) y solo se convierte para
  mostrar; cada sesión y cada disco guardan su unidad original.
- **JSDoc en castellano** y nombres de identificadores en inglés, igual que la v1. Los comentarios
  explican *por qué*, no *qué*.
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
- **Aviso con el móvil bloqueado**: pitido largo + keep-alive de audio + notificación programada en
  el service worker. Son tres capas a propósito; no basta con una.
- **PWA**: manifest instalable, service worker network-first (para no congelar versiones sin
  hashes) y notificaciones de fin de descanso.

---

## 6. Registro de cambios

| Fecha | Cambio | Por qué |
|---|---|---|
| 16-sep-2026 | Rama `v2` desde `main`: `legacy/` con la v1 congelada, toolchain (Vite 8 + TypeScript 6 + Preact 10 + Vitest 5 + ESLint/Prettier) y scripts `dev/build/test/lint/typecheck/verify` | Tener un stack donde el estado tenga tipos, la lógica se pueda probar sin navegador y las vistas no se monten concatenando strings. |
| 16-sep-2026 | Dominio puro portado: `num`, `format`, `units`, `dates`, `defaults` y `plates` (el solver de discos, ahora sin estado escondido) + **33 tests** con Vitest | Son las piezas que más se tocan y las que en la v1 solo se podían verificar dentro del navegador con `?selftest=1`. |
| 16-sep-2026 | `src/state/store.ts`: ajustes reactivos con signals, lectura tolerante y **mismo formato de `localStorage`** que la v1 | Los datos ya existentes valen en las dos ramas y no hace falta migrar nada. |
| 16-sep-2026 | `src/ui/Plates.tsx` + `src/ui/LoadView.tsx`: la calculadora de discos ya funciona en la v2 (modo, ±, alternativas, inventario usado y el dibujo con pilas) y recuerda el modo por ejercicio | Primer bloque end-to-end en el stack nuevo; sirve de referencia para portar el resto. |
| 16-sep-2026 | `src/app/App.tsx` (shell + estado de migración visible) y `src/styles/v2.css` sobre `base.css` | Poder abrir la v2 y ver qué está portado y qué no, sin depender de la documentación. |
| 16-sep-2026 | Añadido `useGrouping: true` explícito en los formateadores | V8/Intl ya no separa millares de 4 dígitos por defecto: 1000 kg se leían "1000" en vez de "1.000". |
| 16-sep-2026 | Movido el tooling de la v1 (`tools/serve|check|selftest.mjs`) fuera de esta rama | Esas comprobaciones eran para `js/*.js` y el auto-test del navegador; en v2 su equivalente es typecheck + lint + Vitest + build. Siguen en `main`. |
