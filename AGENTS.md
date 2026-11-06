# AGENTS.md · Pulso

Contexto para trabajar en esta app. Si el hilo se alarga o se pierde el contexto, **lee esto
primero**: aquí está lo vital (stack, comandos, arquitectura, convenciones y las decisiones que no
se deben "arreglar" sin querer).

> Última actualización: 3-nov-2026 · reescrito para la v2 real (Vite + Preact). El anterior describía
> la app vanilla de `js/*.js`, que ya no existe en el repo.

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

| Extra | Qué hace |
|---|---|
| `npm run test:net` | Incluye `smoke`/`edge`/`quality`, que llaman a Gemini con la key de `.env.local`. |
| `npm run test:quality` | Solo el test de calidad del coach (API real). |
| `npm run format` | Prettier. |
| `node tools/sync-dev.mjs` | Servidor de sincronización local, sin cuenta de Cloudflare. |

**Qué verificar según lo que toques**

- Dominio (`src/domain`), estado (`src/state`) o coach (`src/features/coach`): sus tests en
  `src/**/*.test.ts` (Vitest, sin navegador).
- UI: `npm run typecheck` + `npm run lint` y, si es un flujo de modal, timer, descanso con el móvil
  bloqueado o instalación de la PWA, **mirarlo en el navegador**: eso no lo cubren los tests.
- Antes de dar algo por bueno: `npm run verify`.

> Estado de referencia (3-nov-2026): 77 archivos de test, 1436 comprobaciones, todas en verde;
> `typecheck` y `lint` limpios.

---

## 3. Arquitectura

```
index.html            · entrada de Vite (CSP en meta) → src/main.tsx
src/main.tsx          · tema antes del primer pintado, install prompt, errores globales,
                        ?demo=1, monta <App /> y registra el SW
src/app/              · shell (App.tsx: appbar, nav v2-tabs, rutas) y router por hash
src/domain/           · núcleo PURO (sin DOM ni signals): discos, analítica, sesión, descanso,
                        supersets, planner, fechas, formatos, catálogo y semilla
src/features/coach/   · contexto, memoria, historial, prompts, parseo tolerante, esquemas,
                        cliente Gemini, generador de ejercicios y planificador local
src/state/            · signals + persistencia: store, sesión activa, chat, coach, perfiles, sync
src/ui/               · vistas y componentes Preact (Hoy, Entrenar, Rutinas, Calendario, Coach,
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
- **Persistencia**: el estado se escribe con debounce; el descanso va en su propia clave
  (`pulso.rest`) porque cambia cada segundo y no merece reescribir todo.
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
- **Nav**: la barra es `v2-tabs`, un **carril horizontal con scroll** (`overflow-x:auto`) que centra
  la pestaña activa y difumina el borde cuando queda contenido fuera. No es una barra fija: no la
  "arregles" recortando pestañas.

---

## 5. Cómo funciona lo importante

### Sesión activa
`sessions` guarda lo terminado; `active` la sesión en curso (entradas con `sets` → `weight/reps/done`,
más `basis`, `notes`, `restSec`, supersets). Al empezar se prellena con `suggestWeight()`
(Epley + incremento); **sin historial el peso queda vacío**, no 0. Al terminar se guardan solo las
series marcadas, se calcula el RPE medio y el día queda `done` en el calendario.

- **Editar una serie se propaga hacia abajo** (`propagateSet`): el peso/reps de la serie N se copia a
  las siguientes sin marcar del mismo ejercicio, nunca a las de arriba ni a las ya hechas. El RPE no
  se arrastra.
- **`basis`**: cada entrada lleva de dónde sale el peso («última vez 60 kg × 8 · hace 3 días»,
  «repetición de 21 sep 2026», «sin historial»). Se muestra bajo el nombre del ejercicio: **el dato
  ya está en pantalla**, no lo dupliques en otro sitio.
- Supersets: ejercicios consecutivos con `ssId`; la insignia «SS A · 1/2» y el descanso corto del
  primero marcan la transición.

### Timer de descanso
`src/domain/rest.ts` calcula **por timestamp** (`endsAt - now`), no acumulando: sigue siendo correcto
con la pestaña en segundo plano o el móvil bloqueado. Se espeja en `pulso.rest`.
- Arranca al marcar una serie **si queda algo por hacer**: series pendientes del ejercicio, o el
  siguiente ejercicio si acabas de cerrar el actual (ahí el aviso lo nombra).
- Desmarcar una serie lo cancela; `+15 s` con el descanso terminado abre una cuenta nueva.
- Se pinta dentro del recuadro de sesión (y como barra compacta en otras pestañas); el recuadro es
  `position: sticky` bajo la appbar.
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
`thinkingConfig`: `thinkingLevel` (Gemini 3) o `thinkingBudget` (2.5), mutuamente excluyentes; el
nivel manda. La espera máxima se ajusta al thinking (60/120/240 s) y se puede cancelar.

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

- `?demo=1` carga 8 semanas de ejemplo (se quitan en *Ajustes → Datos*); no dependas de ello en tests.
- Los tests de red (`smoke`/`edge`/`quality`) gastan cuota real: no los metas en `npm test`.
- `src/ui/icons.ts` y `src/domain/catalog.ts` son ficheros base sensibles: el catálogo lo vigila
  `src/domain/data.test.ts` (nombres, grupos, material). Tócalos a mano y con cuidado.
- El `ResizeObserver` avisa a veces al medir la nav; `main.tsx` **filtra ese aviso** para no enseñar
  un error técnico en inglés. No vuelvas a volcarlo al usuario.
- `applyTheme()` corre **antes** del render: si lo mueves, la app parpadea con el tema por defecto.
- Antes de añadir un `localStorage` nuevo, pregúntate si cabe en el estado o en una clave por perfil.

---

## 7. Registro de cambios

| Fecha | Cambio | Por qué |
|---|---|---|
| 15-sep-2026 | Primera versión de este documento (app vanilla). | Dejar contexto entre sesiones. |
| 3-nov-2026 | `AGENTS.md` reescrito para la v2 (Vite + Preact); documentados router, signals, perfiles, sync, coach y PWA reales. | El documento describía `js/*.js`, `?selftest=1` y utilidades que ya no existen. |
| 3-nov-2026 | `main.tsx`: se filtran los avisos benignos de `ResizeObserver` y los errores se muestran en lenguaje humano. | La app se acusaba a sí misma con un mensaje interno en inglés al abrir Ajustes y Coach. |
| 3-nov-2026 | Limpieza de código muerto: 32 reglas CSS de la v1 (nav, appbar, restbar, chart-wrap, skeleton…), 10 exports y 9 iconos sin uso. | Restos de la UI anterior; nada de eso se usaba desde ningún `.tsx`. Verificado con `typecheck`, `lint`, 1436 tests y `build`. |
