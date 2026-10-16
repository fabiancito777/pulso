# Auditoría visual — Pulso v2

Fecha: 15-oct-2026 · Alcance: revisión de UI/UX (visual e interacción) de las 7
pestañas. Este documento **reporta** los hallazgos tal como se encontraron; su
arreglo posterior está resumido al final, en **Estado — todos los hallazgos
resueltos**.

> Nota: cuando se hizo la revisión no existía ningún `AUDITORIA.md` en el
> repositorio (la búsqueda `**/AUDITORIA*.md` no devolvía nada), así que este
> informe no se apoya en él. Apareció después, ya resuelto.

## Cómo se probó

- Servidor de desarrollo Vite ya en marcha en **http://localhost:5173** (rama v2).
- Navegador real vía Playwright (herramientas `browser_*`): snapshots de
  accesibilidad, clics, medidas del DOM (`getBoundingClientRect`) y capturas en
  `_shots/audit-*.png`.
- Anchos probados: **360×780**, **390×844** y **1280×900**.
- Pestañas: Hoy, Entrenar, Rutinas, Calendario, Coach, Progreso y Ajustes.
- Estados: usuario **nuevo** (onboarding, almacenamiento vacío) y usuario **con
  datos reales** (26 sesiones en `localStorage['pulso.state']`).
- Consola del navegador: 4 mensajes, **0 errores y 0 warnings** (solo
  `[vite] connecting/connected`, el script de una extensión `[MeowAI]` y un
  aviso informativo `beforeinstallprompt`).

## Hallazgos

### Alta

Ninguno. No hay pantallas rotas, ni desborde horizontal de página
(`scrollWidth == clientWidth` en los tres anchos), ni errores de consola, ni
acciones bloqueadas.

### Media

#### M1 · El historial muestra el id del ejercicio (slug) en vez de su nombre

- **Pantallas**: Progreso (chips de "Progresión" y lista de "Récords
  personales"), modal "Ver tabla completa" (PRs), Calendario (detalle del día),
  Hoy (detalle de la sesión), modal de detalle de sesión y Rutinas → "Ver".
- **Anchos**: 360, 390 y 1280.
- **Qué se ve mal**: donde debería ir el nombre aparece el id interno, p. ej.
  `zancadas-caminando`, `buenos-dias`, `press-landmine`,
  `press-landmine-a-una-mano`, `sentadilla-goblet`, `peso-muerto-rumano`,
  `remo-en-t`… En la misma pantalla otros sí resuelven ("Remo con Barra",
  "Curl con Barra", "Curl Martillo").
- **Evidencia**: `_shots/audit-progreso-slugs-360.png`,
  `_shots/audit-prtable-slugs-360.png`. En el estado real del usuario (26
  sesiones) hay **27 ejercicios referenciados en el historial que no están en la
  biblioteca actual**; el código cae al `exId` crudo.
- **Causa**: el nombre se busca contra la biblioteca actual (`findExercise`) y,
  si no está, se pinta el id. La biblioteca por defecto son 24 ejercicios, así
  que cualquier ejercicio antiguo (del catálogo de 136 o de datos previos) sale
  como slug.
- **Impacto**: Progreso y los récords personales —el sitio para revisar marcas—
  quedan ilegibles para los ejercicios que no están en la biblioteca.
- **`archivo:línea`**:
  - `src/ui/charts.tsx:738` (chip de progresión), `:717` (título
    "Progresión · …"), `:825` y `:837` (lista de PRs).
  - `src/ui/PrTableModal.tsx:48` y `:60`.
  - `src/ui/CalendarView.tsx:492`.
  - `src/ui/HoyView.tsx:544`.
  - `src/ui/SessionDetailModal.tsx:131` y `:159`.
  - `src/ui/RoutinesView.tsx:610` (vía `src/ui/routines-helpers.ts:470`).
  - Búsqueda: `src/domain/data.ts:186` y `src/state/store.ts:516`.

#### M2 · El texto de ayuda de un campo queda pegado (0 px) a la etiqueta del campo siguiente

- **Pantallas**: Ajustes → Perfil (Nivel, Objetivo principal, Días de entreno por
  semana, Unidades) y el modal "Generar rutina automática" de Rutinas.
- **Anchos**: 360, 390 y 1280.
- **Qué se ve mal**: entre la pista de un campo ("Se usa para saludarte…",
  "Ajusta volumen y complejidad de las sugerencias", …) y la etiqueta en
  MAYÚSCULAS del campo siguiente el hueco es **0 px**, así que cada pista parece
  describir el campo de abajo en vez del de arriba. Ejemplo claro: la pista
  "Ajusta volumen y complejidad de las sugerencias" (de Nivel) se lee pegada a
  "Objetivo principal".
- **Evidencia**: `_shots/audit-ajustes-perfil-360.png`. Medición del DOM:
  `labelTop - hintBottom == 0` para Objetivo principal, Días de entreno por
  semana y Unidades.
- **Causa**: cada campo se envuelve en `.help-field` (para colocar el ⓘ
  absoluto) y esos envolventes no llevan separación vertical; la `.card` tampoco
  añade `gap`, así que la pista y la etiqueta siguiente se tocan.
- **Impacto**: degrada la lectura de Ajustes y del generador de rutinas; hace
  dudar a qué campo pertenece cada explicación.
- **`archivo:línea`**: envolvente en `src/ui/kit.tsx:134` y `:200`; CSS
  `.help-field` en `src/styles/help.css:23` (solo `position:relative`); `.field`
  en `src/styles/base.css:157`; `.card` en `src/styles/base.css:102`. Campos en
  `src/ui/SettingsView.tsx:185,193` y `src/ui/RoutinesView.tsx:297,320`.

### Baja

#### B1 · Etiquetas de KPI truncadas en móvil

- **Pantallas**: Progreso ("Volumen total" → "Volumen t…") y Calendario
  ("Volumen semanal" → "VOLUMEN SEM…").
- **Anchos**: 360 y 390 (a 1280 se ven completas).
- **Evidencia**: `_shots/audit-calendario-planbar-360.png`. Medición:
  "Volumen total" 77 px de caja frente a 91 px de texto; "Volumen semanal"
  108 px frente a 110 px.
- **Causa**: el botón ⓘ (38 px en móvil) dentro de `.kpi-label-row` deja al
  `<span class="ellipsis">` demasiado poco ancho para una sola línea.
- **`archivo:línea`**: `src/ui/kit.tsx:238-246`, `src/styles/help.css:56-65`,
  `src/styles/base.css:199`.

#### B2 · ⓘ huérfano en la barra "Auto-planificar / Con IA" (Calendario) en móvil

- **Pantalla**: Calendario. **Anchos**: 360 y 390 (a 1280 queda junto a los
  botones).
- **Qué se ve mal**: el ⓘ de ayuda, al no caber, salta a una segunda línea y
  aparece solo, alineado a la izquierda, sin nada cerca que indique a qué botón
  ayuda.
- **Evidencia**: `_shots/audit-calendario-planbar-360.png`.
- **`archivo:línea`**: `src/ui/CalendarView.tsx:921` (el `HelpBtn` es el tercer
  hijo de la barra) con `src/styles/calendar.css:345` (`flex-wrap:wrap`) y
  `:353` (`flex:1 1 150px`).

#### B3 · El dibujo de discos desborda y exige scroll horizontal sin indicación

- **Pantallas**: Entrenar (calculadora de discos) y modal de discos.
  **Anchos**: 360 y 390.
- **Qué se ve mal**: la fila de discos es más ancha que su contenedor
  (`clientWidth` 289, `scrollWidth` 430, `.lv-row` ≈ 410), así que el lado
  derecho queda oculto y hay que arrastrar en horizontal sin ninguna pista
  visual de que se puede.
- **`archivo:línea`**: `src/styles/base.css:264`
  (`.load-vis{overflow-x:auto}`) y `:265` (`.lv-row{min-width:max-content}`).

#### B4 · Objetivo táctil por debajo de 34 px en Ajustes → Ejercicios

- **Pantalla**: Ajustes → Ejercicios. **Anchos**: 360 y 390.
- **Qué se ve mal**: los botones ★ de favorito (`button.ex-fav`) miden
  **32×32 px**, por debajo del mínimo recomendado de 34 px, y se repiten en cada
  fila (24 en la lista). El resto de controles medidos cumplen (ⓘ 38 px, chips
  de navegación 40 px de alto, botones de serie ≥ 34 px).
- **`archivo:línea`**: botón en `src/ui/SettingsView.tsx:1255`; tamaño en
  `src/styles/v2.css:210-216`.

#### B5 · El Coach muestra el error crudo de la API en inglés

- **Pantalla**: Coach (conversación guardada). **Anchos**: 360 y 1280.
- **Qué se ve mal**: junto al botón de reintento aparece
  `Error de Gemini (HTTP 503): This model is currently experiencing high demand…`
  en inglés, dentro de una app en castellano.
- **Nota**: es un estado de error real (no un fallo de maquetación) y depende del
  historial guardado.
- **`archivo:línea`**: render del error en `src/ui/CoachView.tsx` y mensaje en
  `src/features/coach/client.ts`.

## Verificado correcto

- Consola limpia: **0 errores y 0 warnings**.
- Sin desborde horizontal de página en 360/390/1280 (los `overflow-x` de chips y
  de la tira de días son intencionados, con `hr-scroll`).
- Las 7 pestañas renderizan correctamente en los tres anchos.
- Onboarding (estado nuevo) se muestra y se cierra con "Empezar".
- Entrenar: flujo completo (elegir ejercicios → marcar serie → recuadro de
  descanso pegajoso arriba que no tapa el contenido → finalizar/descartar con
  confirmación `confirm()` nativa).
- Calculadora de discos: 75 kg → 75,04 kg (8×3 + 4×2,5 + 1×5 lb + 1×1,25) y el
  modo se recuerda por ejercicio.
- Modales de ayuda, detalle de sesión, tabla de PR, picker, discos y resumen:
  abren y cierran bien.
- Navegación inferior: 7 chips, centra la pestaña activa y difumina los bordes.
- Reparto por grupo muscular, volumen, semanas, consistencia y "Frecuencia por
  día" se dibujan sin recortes.

## Estado — todos los hallazgos resueltos (15-oct-2026)

| #   | Arreglo                                                                                                                                     | Archivo(s)                                                                                                                                                      | Verificación en navegador                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| M1  | `resolveExercise(lib, id)` resuelve contra la biblioteca y **cae al catálogo completo**; toda la UI de historial lo usa                     | `src/domain/data.ts` + `charts.tsx`, `PrTableModal.tsx`, `routines-helpers.ts`, `CalendarView.tsx`, `HoyView.tsx`, `SessionDetailModal.tsx`, `RoutinesView.tsx` | Nombres ("Sentadilla goblet", "Zancadas caminando"…) en vez de slugs             |
| M2  | `.help-field + .help-field { margin-top: 10px }`                                                                                            | `src/styles/help.css`                                                                                                                                           | Hueco 10 px en Ajustes→Perfil (360 y 1280)                                       |
| B1  | En móvil, la etiqueta KPI (`kpi-label-row .ellipsis`) puede partir de línea                                                                 | `src/styles/v2.css` (media query)                                                                                                                               | "Volumen total/semanal" sin recorte (`clipped:false`)                            |
| B2  | `.cal-plan-bar .btn { flex: 1 1 118px }` + `.help-btn { flex:none; align-self:center }`                                                     | `src/styles/calendar.css`                                                                                                                                       | La ⓘ queda en la fila (360 px), ya no huérfana                                   |
| B3  | En móvil se compactan las piezas del dibujo de discos (padding, barra, grip, chip, tag) y se hace visible la barra de scroll de `.load-vis` | `src/styles/v2.css`                                                                                                                                             | 60 kg: `clientWidth == scrollWidth` (289), sin desborde                          |
| B4  | `.ex-fav { width:34px; height:34px }` (tras la regla base, dentro de su propio `@media`)                                                    | `src/styles/v2.css`                                                                                                                                             | ★ = 34×34 px                                                                     |
| B5  | `httpMessage()` traduce los errores `http` (5xx → "saturado o no disponible…"); `auth`/`quota` conservan el texto de la API                 | `src/features/coach/client.ts`                                                                                                                                  | Tests de `client.test.ts`: 503 traducido y sin inglés; 400 con prefijo traducido |

Verificación global: `npm run typecheck`, `npm run lint` y `npx vitest run
--exclude "src/features/coach/{smoke,edge}.test.ts"` en verde (**962 tests**;
nuevos: 3 de `resolveExercise` y 2 de traducción de errores). Consola del
navegador: 0 errores / 0 warnings. Capturas: `_shots/fix-*.png`.
