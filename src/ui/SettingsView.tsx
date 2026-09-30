/**
 * Ajustes: port de `legacy/js/views-settings.js`.
 *
 * La v1 tenía 8 subsecciones repintadas con `innerHTML` y guardaba escuchando el
 * `change` de cada campo con `data-key` (leyendo el valor del DOM al guardar).
 * Aquí el valor sale del propio componente y las subsecciones leen los signals,
 * así que cambiar un ajuste repinta solo lo que depende de él.
 *
 * Nota: los ajustes SIN `onInput` se guardan al perder el foco (su `onChange` de
 * Preact es el evento `change` del navegador), igual que hacía la v1.
 */
import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';

import { EQUIPMENT } from '@/domain/catalog';
import { daysSince, exerciseSummary, prs, type ExerciseSummary } from '@/domain/analytics';
import {
  ACCENTS,
  AI_MODELS,
  EXERCISE_TYPES,
  GOALS,
  GOAL_REPS,
  GOAL_REST,
  GOAL_SETS,
  GROUPS,
  LEVELS,
  THEMES,
  THINKING_LEVELS,
  equipCats,
  equipPreset,
  equipPresetList,
  goalLabel,
  groupLabel,
  isAvailable,
  missingEquipment,
} from '@/domain/data';
import { today } from '@/domain/dates';
import { draftFrom, toExercise } from '@/domain/exercise-draft';
import type { ExerciseDraft } from '@/domain/exercise-draft';
import { fmtN, inputNum } from '@/domain/format';
import { maxLoadable, solvePlates } from '@/domain/plates';
import type { EquipmentItem, Exercise, ModelOption, PlateStock, Theme, Unit } from '@/domain/types';
import { fromKg } from '@/domain/units';
import { go } from '@/app/router';
import { listModels, testConnection } from '@/features/coach/client';
import { DEFAULT_SYSTEM } from '@/features/coach/prompts';
import { copyText } from '@/platform/clipboard';
import { downloadJSON, pickTextFile } from '@/platform/files';
import { hasSW, install, installable, installed } from '@/platform/install';
import { requestNotifyPermission } from '@/platform/notify';
import { applyTheme } from '@/platform/theme';
import {
  addPlate,
  applyEquipment,
  bulkSetAllowed,
  bulkSetExerciseFlag,
  clearDemo,
  demoData,
  equipment,
  exercises,
  exportState,
  importState,
  looksLikeState,
  patchSettings,
  removeExercise,
  removePlate,
  resetAll,
  saveExercise,
  sessions,
  setSettingsPath,
  settings,
  storageAvailable,
  storageBytes,
  togglePlate,
  updatePlate,
} from '@/state/store';
import { TEST_NOTICE_SEC, testRestNotice } from '@/state/session';
import { Icon } from '@/ui/Icon';
import { GuideIndex, HelpBtn } from '@/ui/HelpModal';
import {
  InfoCard,
  Kpi,
  ListButton,
  NumRow,
  SectionHead,
  SelectRow,
  SwitchRow,
  TextRow,
} from '@/ui/kit';
import { toast } from '@/ui/toast';

const SUBS = [
  { key: 'perfil', label: 'Perfil', icon: 'user' },
  { key: 'apariencia', label: 'Apariencia', icon: 'moon' },
  { key: 'entreno', label: 'Entreno', icon: 'timer' },
  { key: 'equipo', label: 'Equipo', icon: 'dumbbell' },
  { key: 'discos', label: 'Discos', icon: 'plate' },
  { key: 'ejercicios', label: 'Ejercicios', icon: 'database' },
  { key: 'coach', label: 'Coach AI', icon: 'sparkles' },
  { key: 'datos', label: 'Datos', icon: 'download' },
  { key: 'ayuda', label: 'Ayuda', icon: 'info' },
] as const;

type SubKey = (typeof SUBS)[number]['key'];

/**
 * Versión para «Acerca de»: la `version` de `package.json`, inyectada por
 * `define` en `vite.config.ts` (nada de `resolveJsonModule`, que está apagado).
 * El `typeof` es el fallback de entornos sin `define` (tests en node, spec
 * onboarding.md hueco 5).
 */
const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '2.0';

/**
 * Carcasa de los tres modales de Ajustes (`modal-scrim`/`modal` de `base.css`):
 * se cierra tocando fuera del recuadro y siempre con Escape/la X, nunca con
 * botones del propio form dentro de `modal-body`.
 */
function Modal({
  title,
  sub,
  onClose,
  children,
  foot,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: ComponentChildren;
  foot: ComponentChildren;
}) {
  return (
    <div
      class="modal-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div class="modal-head">
          <div>
            <div class="h3">{title}</div>
            {sub ? <div class="tiny muted">{sub}</div> : null}
          </div>
          <button type="button" class="icon-btn" aria-label="Cerrar" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div class="modal-body">{children}</div>
        <div class="modal-foot">{foot}</div>
      </div>
    </div>
  );
}

/* ---------- perfil ---------- */

function SecPerfil() {
  const st = settings.value;
  const goal = st.goal;
  return (
    <>
      <div class="card">
        <TextRow
          label="Nombre"
          hint="Se usa para saludarte y en los prompts del coach"
          value={st.name}
          placeholder="Tu nombre"
          onChange={(name) => setSettingsPath('name', name)}
        />
        <div class="divider" />
        <SelectRow
          label="Nivel"
          hint="Ajusta volumen y complejidad de las sugerencias"
          help="opt.level"
          value={st.level}
          options={LEVELS.map((l) => ({ value: l, label: l }))}
          onChange={(level) => setSettingsPath('level', level)}
        />
        <SelectRow
          label="Objetivo principal"
          hint="Define repeticiones, series y descansos por defecto"
          help="opt.goal"
          value={goal}
          options={GOALS.map((g) => ({ value: g.key, label: g.label }))}
          onChange={(g) => setSettingsPath('goal', g)}
        />
        <SelectRow
          label="Días de entreno por semana"
          hint="Se usa para el plan semanal"
          help="opt.days"
          value={String(st.daysPerWeek)}
          options={['2', '3', '4', '5', '6'].map((d) => ({ value: d, label: d }))}
          onChange={(d) => setSettingsPath('daysPerWeek', Number(d))}
        />
        <SelectRow
          label="Unidades"
          hint="Cambia la visualización de pesos"
          help="opt.units"
          value={st.units}
          options={[
            { value: 'kg', label: 'Kilogramos (kg)' },
            { value: 'lb', label: 'Libras (lb)' },
          ]}
          onChange={(u) => {
            if (u === st.units) return;
            setSettingsPath('units', u);
            /* igual que la v1 (app.js:199): cambiar la unidad no convierte nada,
               los discos del inventario pasan a leerse en la nueva */
            toast('Los discos del inventario se interpretan en la unidad elegida', {
              kind: 'warn',
              ms: 5000,
            });
          }}
        />
      </div>
      <InfoCard>
        Con objetivo <b>{goalLabel(goal)}</b> el coach propone {GOAL_REPS[goal]?.join('-')}{' '}
        repeticiones, {GOAL_SETS[goal]} series y descansos de ~{GOAL_REST[goal]} s.
      </InfoCard>
    </>
  );
}

/* ---------- apariencia ---------- */

function SecApariencia() {
  const st = settings.value;
  return (
    <>
      <div class="card">
        <div class="label mb-s">Tema</div>
        <div class="grid c3">
          {THEMES.map((t) => (
            <button
              key={t.key}
              type="button"
              class="card tight"
              style={`border-color:${st.theme === t.key ? 'var(--accent)' : 'var(--border)'}`}
              onClick={() => {
                patchSettings({ theme: t.key as Theme });
                applyTheme(t.key as Theme, settings.value.accent);
              }}
            >
              <div class="h3">{t.label}</div>
              <div class="tiny muted">{t.hint}</div>
            </button>
          ))}
        </div>
        <div class="divider" />
        <div class="label mb-s">Color de acento</div>
        <div class="row wrap" style="gap:8px">
          {ACCENTS.map((a) => (
            <button
              key={a}
              type="button"
              aria-label={`acento ${a}`}
              style={`width:36px;height:36px;border-radius:50%;background:${a};border:2px solid ${
                st.accent.toLowerCase() === a.toLowerCase() ? 'var(--text)' : 'transparent'
              }`}
              onClick={() => {
                patchSettings({ accent: a });
                applyTheme(settings.value.theme, a);
              }}
            />
          ))}
        </div>
      </div>
      <div class="card flush mt">
        <SwitchRow
          label="Sonido"
          hint="Pitidos al acabar el descanso y al completar series"
          value={st.sound}
          onChange={(v) => setSettingsPath('sound', v)}
        />
        <NumRow
          label="Volumen"
          hint="0 a 1"
          value={st.volume}
          step={0.1}
          min={0}
          max={1}
          onChange={(v) => setSettingsPath('volume', v)}
        />
        <SwitchRow
          label="Aviso de los últimos 3 s"
          hint="Tres ticks suaves antes de que termine el descanso"
          help="opt.lastTicks"
          value={st.countdownTick}
          onChange={(v) => setSettingsPath('countdownTick', v)}
        />
        <SwitchRow
          label="Vibración"
          hint="En móviles compatibles"
          value={st.vibrate}
          onChange={(v) => setSettingsPath('vibrate', v)}
        />
        <SwitchRow
          label="Notificaciones del sistema"
          hint="Aviso al terminar el descanso (llega con el bloque PWA)"
          help="opt.notify"
          value={st.notify}
          onChange={(v) => {
            setSettingsPath('notify', v);
            /* solo al ACTIVAR (la v1 callaba al desactivar); tiene que ser dentro
               del propio click: Safari iOS no deja pedirlo fuera de un gesto */
            if (!v) return;
            const state = requestNotifyPermission();
            if (state === 'denied') {
              toast('Permiso de notificaciones bloqueado en el navegador', {
                kind: 'warn',
                ms: 5000,
              });
            }
          }}
        />
        <SwitchRow
          label="Mantener la sesión despierta"
          hint="Pantalla encendida durante el entreno"
          help="opt.keepAwake"
          value={st.keepAwake}
          onChange={(v) => setSettingsPath('keepAwake', v)}
        />
      </div>
      {/* Botón de prueba (v1 `6361477`, `T.testRestNotice`): comprueba la capa
          del service worker en el móvil real. Está en Apariencia, junto a los
          avisos, igual que en la v1. */}
      <div class="card flush mt">
        <ListButton
          icon="timer"
          title="Probar aviso con el móvil bloqueado"
          sub={`Programa un aviso de prueba en ${TEST_NOTICE_SEC} segundos para comprobar que te llega`}
          onClick={() => {
            /* `testRestNotice` decide y programa; los toasts son de la UI
               (`state/` no importa de `ui/`), igual que los de la v1 */
            const result = testRestNotice(TEST_NOTICE_SEC);
            if (result === 'rest-running') {
              toast('Hay un descanso en curso: primero termínalo o sáltalo', {
                kind: 'warn',
                ms: 5000,
              });
              return;
            }
            if (result === 'notify-off') {
              toast('Activa «Notificaciones del sistema» para probar el aviso', {
                kind: 'warn',
                ms: 5000,
              });
              return;
            }
            toast(`Bloquea el móvil: el aviso llega en ${TEST_NOTICE_SEC} s`, {
              kind: 'ok',
              ms: 4000,
            });
          }}
        />
      </div>
    </>
  );
}

/* ---------- entreno ---------- */

function SecEntreno() {
  const st = settings.value;
  return (
    <>
      <div class="card flush">
        <SwitchRow
          label="Descanso automático al marcar serie"
          hint="Usa el tiempo sugerido de cada ejercicio o el que proponga el coach"
          help="opt.autoRest"
          value={st.autoRest}
          onChange={(v) => setSettingsPath('autoRest', v)}
        />
        <NumRow
          label="Incremento de progresión"
          hint="Cuánto subir cuando puedes con el rango alto"
          help="opt.increment"
          value={st.increment}
          step={0.5}
          min={0.5}
          max={20}
          suffix="kg"
          onChange={(v) => setSettingsPath('increment', v)}
        />
        <SwitchRow
          label="Mostrar RPE"
          hint="Registrar esfuerzo percibido (1-10) por serie"
          help="opt.showRpe"
          value={st.showRpe}
          onChange={(v) => setSettingsPath('showRpe', v)}
        />
        <SwitchRow
          label="Finalizar rápido"
          hint="No avisar cuando completes todas las series"
          help="opt.quickFinish"
          value={st.quickFinish}
          onChange={(v) => setSettingsPath('quickFinish', v)}
        />
        <SwitchRow
          label="Contar aproximaciones"
          hint="Incluir series de calentamiento en el volumen"
          help="opt.countWarmups"
          value={st.countWarmups}
          onChange={(v) => setSettingsPath('countWarmups', v)}
        />
      </div>
      <InfoCard>
        El descanso entre series lo define cada ejercicio en la biblioteca (más para compuestos,
        menos para aislamientos) y el coach IA puede ajustarlo por sesión. No se configura a mano
        para respetar los tiempos óptimos.
      </InfoCard>
    </>
  );
}

/* ---------- equipo ---------- */

function SecEquipo() {
  const eq = equipment.value;
  const active = Object.keys(eq).filter((k) => eq[k]).length;
  return (
    <>
      <div class="card tight">
        <div class="between mb-s">
          <div class="h3 help-h3">
            Tu material ({active}/{Object.keys(eq).length})
            <HelpBtn id="opt.material" title="Tu material" />
          </div>
          <span class="tiny muted">filtra qué ejercicios se pueden sugerir</span>
        </div>
        <div class="hr-scroll">
          {equipPresetList().map((preset) => (
            <button
              key={preset.key}
              type="button"
              class="chip"
              title={preset.fullLabel}
              onClick={() => applyEquipment(equipPreset(preset.key))}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
      <div class="col" style="gap:14px">
        {equipCats().map((cat) => {
          const items = EQUIPMENT_BY_CAT(cat);
          return (
            <section key={cat}>
              <SectionHead
                title={cat}
                right={`${items.filter((i) => eq[i.key]).length}/${items.length}`}
              />
              <div class="row wrap" style="gap:7px">
                {items.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    title={item.hint}
                    class={`toggle-pill ${eq[item.key] ? 'on' : 'off'}`}
                    onClick={() => applyEquipment({ ...eq, [item.key]: !eq[item.key] })}
                  >
                    <Icon name={eq[item.key] ? 'check' : 'plus'} />
                    {item.label}
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <InfoCard ghost>
        Los ejercicios que necesiten material desactivado se excluyen de las sugerencias, las
        plantillas y los planes del coach. Marca <b>Discos / inventario de peso</b> si cargas peso
        con barras o mancuernas cargables.
      </InfoCard>
    </>
  );
}

/* ---------- discos ---------- */

function PlateRow({ plate, index }: { plate: PlateStock; index: number }) {
  const kg = plate.unit === 'lb' ? plate.w * 0.45359237 : plate.w;
  const discs = plate.discs || 0;
  /* el reparto es simétrico: con un número impar sobra un disco por hueco */
  const perSide = Math.floor(discs / 2);
  return (
    <div class="list-item">
      <input
        class="input num"
        style="width:76px"
        type="number"
        step={0.25}
        min={0}
        value={String(plate.w)}
        aria-label="medida del disco"
        onChange={(e) => updatePlate(index, { w: Number(e.currentTarget.value) })}
      />
      <select
        class="select"
        style="width:82px;min-height:38px;padding:6px 26px 6px 10px"
        value={plate.unit}
        aria-label="unidad del disco"
        onChange={(e) => updatePlate(index, { unit: e.currentTarget.value as Unit })}
      >
        <option value="kg">kg</option>
        <option value="lb">lb</option>
      </select>
      <span class="tiny muted">x</span>
      <input
        class="input num"
        style="width:60px"
        type="number"
        step={1}
        min={0}
        value={String(plate.discs)}
        aria-label="discos disponibles"
        onChange={(e) => updatePlate(index, { discs: Number(e.currentTarget.value) })}
      />
      <span class="tiny muted grow num">
        = {fmtN(kg, 2)} kg{plate.unit === 'lb' ? ` · ${fmtN(plate.w)} lb` : ''} · {discs}{' '}
        {discs === 1 ? 'disco' : 'discos'} · {fmtN(kg * perSide, 2)} kg por lado
        {discs % 2 ? ' · sobra 1 disco' : ''}
      </span>
      <button
        type="button"
        class={`toggle-pill ${plate.on !== false ? 'on' : 'off'}`}
        onClick={() => togglePlate(index)}
      >
        <Icon name={plate.on !== false ? 'check' : 'x'} />
      </button>
      <button type="button" class="icon-btn" onClick={() => removePlate(index)}>
        <Icon name="x" />
      </button>
    </div>
  );
}

function SecDiscos() {
  const st = settings.value;
  const plates = st.plates ?? [];
  const bars = st.bars;
  const active = plates.filter((p) => p.on !== false);
  const bar = maxLoadable({ plates, bars, mode: 'bar' });
  const dbs = maxLoadable({ plates, bars, mode: 'db2' });
  /* discos por lado = lo que reparte la barra de verdad (floor(discos/2) por
     medida), así que con un inventario impar nunca se anuncia un peso inflado */
  const discs = active.reduce((sum, p) => sum + (p.discs || 0), 0);
  const barHint = (kg: number) =>
    `Peso sin discos · 0 kg si es de plástico · ${fmtN(fromKg(kg, 'lb'), 1)} lb`;
  return (
    <>
      <div class="grid c2">
        <Kpi
          label="Máximo en barra"
          help="opt.plates"
          value={fmtN(bar.totalKg, 1)}
          unit="kg"
          delta={`= ${fmtN(fromKg(bar.totalKg, st.units), 1)} ${st.units} · ${fmtN(bar.sideKg, 1)} kg por lado`}
        />
        <Kpi
          label="Máximo por mancuerna"
          value={fmtN(dbs.totalKg, 1)}
          unit="kg"
          delta="cargando 2 mancuernas a la vez"
        />
        <Kpi
          label="Medidas activas"
          value={active.length}
          delta={`${discs} discos · ${fmtN(bar.sideKg, 1)} kg por lado`}
        />
      </div>
      <InfoCard>
        El inventario se cuenta en <b>discos</b> individuales: es cuántos discos de cada medida
        tienes. Como la carga es simétrica, la barra reparte lo mismo en los dos lados y la
        mancuerna en sus dos extremos, así que <b>con un número impar sobra un disco</b>. Con los
        discos actuales la barra admite <b>{fmtN(bar.sideKg, 1)} kg por lado</b>, una mancuerna
        suelta <b>{fmtN(bar.sideKg, 1)} kg por extremo</b> y, cargando dos mancuernas a la vez,{' '}
        <b>{fmtN(dbs.sideKg, 1)} kg por extremo en cada una</b>. Se pueden mezclar discos en kg y en
        lb (todo se calcula en kilogramos).
      </InfoCard>
      <div class="card flush mt">
        <div class="list">
          {plates.length ? (
            plates.map((p, i) => <PlateRow key={`${p.w}-${p.unit}-${i}`} plate={p} index={i} />)
          ) : (
            <div class="empty">Sin discos configurados</div>
          )}
        </div>
      </div>
      <button type="button" class="btn block mt-s" onClick={() => addPlate()}>
        <Icon name="plus" />
        Añadir medida de disco
      </button>
      <div class="card flush mt">
        <div class="list">
          <NumRow
            label="Peso de la barra"
            hint={barHint(bars.olimpica)}
            help="opt.bars"
            value={bars.olimpica}
            step={0.5}
            min={0}
            max={100}
            onChange={(v) => setSettingsPath('bars.olimpica', v)}
          />
          <NumRow
            label="Peso de la barra EZ"
            hint={barHint(bars.ez)}
            help="opt.bars"
            value={bars.ez}
            step={0.5}
            min={0}
            max={100}
            onChange={(v) => setSettingsPath('bars.ez', v)}
          />
          <NumRow
            label="Peso del mango de mancuerna"
            hint={barHint(bars.mancuerna)}
            help="opt.bars"
            value={bars.mancuerna}
            step={0.5}
            min={0}
            max={50}
            onChange={(v) => setSettingsPath('bars.mancuerna', v)}
          />
        </div>
      </div>
      <InfoCard>
        Con el inventario actual, 60 kg en barra se montan como{' '}
        {solvePlates(60, { plates, bars, mode: 'bar' })
          .perHole.map((p) => `${p.n}×${fmtN(p.kg, 2)} kg`)
          .join(' + ') || '—'}{' '}
        por lado. La calculadora de la pestaña Entrenar te deja probarlo con cualquier peso.
      </InfoCard>
    </>
  );
}

/* ---------- ejercicios ---------- */

/** Los cuatro segmentos de la lista (spec `ejercicios-revamp.md` §3.3.1). */
const EX_SEGMENTS = [
  { key: 'fav', label: '★ Favoritos' },
  { key: 'catalogo', label: 'Catálogo' },
  { key: 'custom', label: 'Propios' },
  { key: 'ocultos', label: 'Ocultos' },
] as const;

type ExSegment = (typeof EX_SEGMENTS)[number]['key'];

function SecEjercicios() {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('');
  const [state, setState] = useState('all');
  /* Segmento inicial: ★ si ya hay alguno, si no el catálogo. Es una decisión de
     ESTA apertura (no se persiste): al recargar volverías a favoritos solo si
     sigues teniendo alguno. */
  const [segment, setSegment] = useState<ExSegment>(
    exercises.value.some((e) => e.fav === true) ? 'fav' : 'catalogo',
  );
  /* `null` = editor cerrado · `'new'` = creando · `Exercise` = editando ese */
  const [editor, setEditor] = useState<Exercise | 'new' | null>(null);
  const list = exercises.value;
  const eq = equipment.value;
  const blocked = list.filter((e) => !e.allowed).length;
  const usable = list.filter((e) => e.allowed && isAvailable(e, eq));
  const favCount = list.filter((e) => e.fav === true).length;
  const hiddenCount = list.filter((e) => e.hidden === true).length;

  /* Métricas de la fila en UNA pasada por el historial, memorizada por render:
     con 139 filas, que cada una recorra las sesiones sería O(filas × sesiones). */
  const summary = useMemo(() => exerciseSummary(sessions.value), [sessions.value]);

  /* Los de la biblioteca no se borran: `removeExercise` devuelve `false` y aquí
     se avisa (en la v1 lo hacía el toast del store). */
  const confirmDelete = (ex: Exercise): void => {
    if (!window.confirm(`¿Eliminar «${ex.name}» de tu biblioteca personal?`)) return;
    if (removeExercise(ex.id)) {
      toast('Ejercicio eliminado', { kind: 'ok' });
      return;
    }
    toast('Solo puedes eliminar ejercicios propios; los de la biblioteca puedes desactivarlos', {
      kind: 'warn',
      ms: 5000,
    });
  };

  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  const needle = norm(q.trim());
  const filtered = list
    .filter((e) => {
      /* el segmento y el select de estado se combinan en AND */
      const hidden = e.hidden === true;
      if (segment === 'ocultos' ? !hidden : hidden) return false;
      if (segment === 'fav' && e.fav !== true) return false;
      if (segment === 'catalogo' && e.custom) return false;
      if (segment === 'custom' && !e.custom) return false;
      if (needle && !norm(e.name).includes(needle)) return false;
      if (group && e.group !== group) return false;
      if (state === 'allowed' && !e.allowed) return false;
      if (state === 'blocked' && e.allowed) return false;
      if (state === 'unavailable' && isAvailable(e, eq)) return false;
      return true;
    })
    .sort((a, b) => {
      const ga = GROUPS.findIndex((x) => x.key === a.group);
      const gb = GROUPS.findIndex((x) => x.key === b.group);
      if (ga !== gb) return ga - gb;
      const fa = a.fav === true ? 0 : 1;
      const fb = b.fav === true ? 0 : 1;
      if (fa !== fb) return fa - fb;
      return a.name.localeCompare(b.name, 'es');
    });
  const shown = filtered.filter((e) => e.allowed).length;
  const filteredIds = filtered.map((e) => e.id);
  const flagFiltered = (patch: Partial<Pick<Exercise, 'fav' | 'hidden'>>): void => {
    bulkSetExerciseFlag(filteredIds, patch);
  };

  /* Atajo de la petición 1: ★ a los ejercicios con los que ya tienes récords.
     Es un ATAJO, no el modelo: los ★ se siguen pudiendo marcar a mano. */
  const favMyRecords = (): void => {
    const known = new Set(list.map((e) => e.id));
    const ids = Object.keys(prs(sessions.value)).filter((id) => known.has(id));
    if (!ids.length) {
      toast('Todavía no tienes récords: entrena un poco y vuelve a marcarlos', { kind: 'warn' });
      return;
    }
    bulkSetExerciseFlag(ids, { fav: true });
    toast(`${ids.length} ejercicios marcados con ★`, { kind: 'ok' });
  };

  return (
    <>
      <div class="grid c3">
        <Kpi
          label="Biblioteca"
          value={list.length}
          delta={`${list.length - blocked} permitidos`}
          help="opt.exercises"
        />
        <Kpi label="★ Favoritos" value={favCount} delta={`${hiddenCount} ocultos`} />
        <Kpi label="Con tu equipo" value={usable.length} delta="listos para sugerir" />
      </div>
      {/* pegado bajo la barra superior: los segmentos y el buscador son lo que
          más se toca y la lista mide 139 filas (spec §3.3.1) */}
      <div class="card tight mt ex-toolbar">
        <div class="seg">
          {EX_SEGMENTS.map((s) => (
            <button
              key={s.key}
              type="button"
              class={segment === s.key ? 'on' : ''}
              onClick={() => setSegment(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div class="search mt-s">
          <Icon name="search" />
          <input
            class="input"
            placeholder="Buscar ejercicio…"
            value={q}
            onInput={(e) => setQ(e.currentTarget.value)}
          />
        </div>
      </div>
      <div class="card mt-s">
        <div class="grid c2">
          <select class="select" value={group} onChange={(e) => setGroup(e.currentTarget.value)}>
            <option value="">Todos los grupos</option>
            {GROUPS.map((g) => (
              <option key={g.key} value={g.key}>
                {g.label}
              </option>
            ))}
          </select>
          <select class="select" value={state} onChange={(e) => setState(e.currentTarget.value)}>
            <option value="all">Todos</option>
            <option value="allowed">Permitidos</option>
            <option value="blocked">Prohibidos</option>
            <option value="unavailable">Sin material</option>
          </select>
        </div>
        <div class="row mt-s" style="gap:8px">
          <button type="button" class="btn sm" onClick={() => setEditor('new')}>
            <Icon name="plus" />
            Añadir propio
          </button>
          <button
            type="button"
            class="btn sm ghost"
            onClick={() => {
              setQ('');
              setGroup('');
              setState('all');
            }}
          >
            Limpiar filtros
          </button>
          <span class="tiny muted grow">
            {filtered.length} ejercicios · {shown} permitidos con estos filtros
          </span>
        </div>
      </div>
      <div class="card tight mt-s">
        <div class="row wrap" style="gap:8px">
          <button
            type="button"
            class="btn sm ghost"
            onClick={() => bulkSetAllowed(filteredIds, true)}
          >
            Permitir
          </button>
          <button
            type="button"
            class="btn sm ghost"
            onClick={() => bulkSetAllowed(filteredIds, false)}
          >
            Prohibir
          </button>
          <button type="button" class="btn sm ghost" onClick={() => flagFiltered({ fav: true })}>
            ★ Marcar
          </button>
          <button type="button" class="btn sm ghost" onClick={() => flagFiltered({ fav: false })}>
            Quitar ★
          </button>
          <button type="button" class="btn sm ghost" onClick={() => flagFiltered({ hidden: true })}>
            Ocultar
          </button>
          <button
            type="button"
            class="btn sm ghost"
            onClick={() => flagFiltered({ hidden: false })}
          >
            Mostrar
          </button>
        </div>
        <div class="row mt-s" style="gap:8px">
          <button type="button" class="btn sm ghost" onClick={favMyRecords}>
            ★ Los de mis récords
          </button>
          <span class="tiny muted grow">acciones sobre los {filteredIds.length} filtrados</span>
        </div>
      </div>
      <div class="card flush mt">
        {filtered.length ? (
          filtered.map((e) => (
            <ExerciseRow
              key={e.id}
              ex={e}
              stats={summary.get(e.id)}
              showHidden={segment === 'ocultos' || e.hidden === true}
              onEdit={() => setEditor(e)}
              onDelete={() => confirmDelete(e)}
            />
          ))
        ) : (
          <div class="empty">Sin resultados con estos filtros</div>
        )}
      </div>
      <InfoCard>
        <b>★ Favorito</b> es prioridad, no exclusión: los marcados salen primeros en los buscadores,
        en los generadores y en los consejos del coach. <b>Oculto</b> es solo presentación (lo saca
        de esta lista y del selector, pero el coach sigue pudiendo nombrarlo). <b>Prohibido</b> es
        el único que lo aparta de las propuestas. Los ejercicios del catálogo solo se permiten o se
        prohíben; <b>crear, editar y borrar</b> vale para los <b>propios</b>.
      </InfoCard>
      {editor === null ? null : (
        <ExerciseEditor
          current={editor === 'new' ? null : editor}
          onClose={() => setEditor(null)}
        />
      )}
    </>
  );
}

/**
 * Modal de «Nuevo ejercicio» / «Editar ejercicio»: form con estado propio
 * (`useState`), sin bloque de modales compartido, y con la validación en
 * `domain/exercise-draft.ts` — aquí solo se pinta y se llamó a `saveExercise`.
 *
 * Ojo: los materiales se exponen como CLAVE SIMPLE (como en la v1): escribir un
 * `equip` compuesto perdería la parte `a&b|c` del ejercicio editado. Por eso el
 * editor solo se abre para ejercicios propios.
 */
function ExerciseEditor({ current, onClose }: { current: Exercise | null; onClose: () => void }) {
  const [draft, setDraft] = useState<ExerciseDraft>(() => draftFrom(current));
  const [error, setError] = useState('');

  function set<K extends keyof ExerciseDraft>(key: K, value: ExerciseDraft[K]): void {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function setNum(key: 'sets' | 'rest' | 'repMin' | 'repMax', raw: string): void {
    const value = Number(raw);
    setDraft((prev) => {
      const next = { ...prev, [key]: Number.isFinite(value) ? value : prev[key] };
      /* la v1 igualaba repMax al subir repMin (escuchaba el change de repMin) */
      if (key === 'repMin' && next.repMax < next.repMin) next.repMax = next.repMin;
      return next;
    });
  }

  const save = (): void => {
    const built = toExercise(draft, {
      taken: exercises.value.map((e) => e.id),
      ...(current ? { currentId: current.id } : {}),
    });
    if (!built.ok) {
      setError(built.error);
      return;
    }
    saveExercise(built.value);
    toast(current ? 'Ejercicio actualizado' : 'Ejercicio añadido', { kind: 'ok' });
    onClose();
  };

  const numRow = (
    label: string,
    key: 'sets' | 'rest' | 'repMin' | 'repMax',
    opts: { min: number; max: number; step?: number },
  ) => (
    <label class="field">
      <span class="label">{label}</span>
      <input
        class="input num"
        type="number"
        min={opts.min}
        max={opts.max}
        step={opts.step ?? 1}
        value={inputNum(draft[key])}
        onChange={(e) => setNum(key, e.currentTarget.value)}
      />
    </label>
  );

  return (
    <Modal
      title={current ? 'Editar ejercicio' : 'Nuevo ejercicio'}
      sub={current ? current.name : 'Se guardará como propio'}
      onClose={onClose}
      foot={
        <>
          <button type="button" class="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" class="btn primary" onClick={save}>
            Guardar
          </button>
        </>
      }
    >
      <div class="col" style="gap:11px">
        <label class="field">
          <span class="label">Nombre</span>
          <input
            class="input"
            placeholder="Ej. Remo en polea alta"
            value={draft.name}
            onChange={(e) => set('name', e.currentTarget.value)}
          />
        </label>
        <div class="grid c2">
          <label class="field">
            <span class="label">Grupo muscular</span>
            <select
              class="select"
              value={draft.group}
              onChange={(e) => set('group', e.currentTarget.value)}
            >
              {GROUPS.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          <label class="field">
            <span class="label">Tipo</span>
            <select
              class="select"
              value={draft.type}
              onChange={(e) => set('type', e.currentTarget.value as Exercise['type'])}
            >
              {EXERCISE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label class="field">
          <span class="label">Material necesario</span>
          <select
            class="select"
            value={draft.equip}
            onChange={(e) => set('equip', e.currentTarget.value)}
          >
            <option value="">Ninguno (peso corporal)</option>
            {EQUIPMENT.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
          <span class="sub">
            Si el ejercicio requiere material, quedará excluido cuando no lo tengas activo.
          </span>
        </label>
        <div class="grid c2">
          {numRow('Series', 'sets', { min: 1, max: 12 })}
          {numRow('Descanso (s)', 'rest', { min: 0, max: 600, step: 15 })}
          {numRow('Rep min', 'repMin', { min: 1, max: 100 })}
          {numRow('Rep max', 'repMax', { min: 1, max: 100 })}
        </div>
        <label class="switch" style="justify-content:space-between">
          <span>Permitido en sugerencias</span>
          <input
            type="checkbox"
            checked={draft.allowed}
            onChange={(e) => set('allowed', e.currentTarget.checked)}
          />
          <span class="track">
            <span class="thumb" />
          </span>
        </label>
        {error ? <div class="tiny danger">{error}</div> : null}
        <div class="tiny muted">
          {current
            ? 'El id no cambia aunque renombres: rutinas y sesiones lo referencian.'
            : 'Los ejercicios propios se pueden editar y borrar cuando quieras.'}
        </div>
      </div>
    </Modal>
  );
}

function ExerciseRow({
  ex,
  stats,
  showHidden,
  onEdit,
  onDelete,
}: {
  ex: Exercise;
  /** métricas del historial (`exerciseSummary`); vacías = sin datos todavía */
  stats?: ExerciseSummary;
  /** el pill de ocultar/mostrar solo se muestra en «Ocultos» o si ya está oculto */
  showHidden: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const missing = missingEquipment(ex, equipment.value);
  /* `hace Nd · PR · ×n`: lo que haya; sin series hechas la línea no sale */
  const bits: string[] = [];
  if (stats) {
    if (stats.n > 0 && stats.lastIso) bits.push(`hace ${daysSince(stats.lastIso, today())}d`);
    if (stats.e1rm > 0) bits.push(`PR ${fmtN(stats.e1rm)} kg`);
    if (stats.n > 0) bits.push(`×${fmtN(stats.n)}`);
  }
  const fav = ex.fav === true;
  const hidden = ex.hidden === true;
  return (
    <div class="ex-pick" style={ex.allowed ? '' : 'opacity:.55'}>
      <button
        type="button"
        class={`ex-fav${fav ? ' on' : ''}`}
        title={fav ? 'Quitar de favoritos' : 'Marcar como favorito'}
        aria-pressed={fav}
        aria-label={fav ? 'Quitar de favoritos' : 'Marcar como favorito'}
        onClick={() => bulkSetExerciseFlag([ex.id], { fav: !fav })}
      >
        ★
      </button>
      <div class="grow" style="min-width:0">
        <div class="row" style="gap:6px">
          <span class="li-title ellipsis">{ex.name}</span>
          {ex.custom ? <span class="badge">propio</span> : null}
          {ex.bw ? <span class="badge">PC</span> : null}
        </div>
        <div class="li-sub">
          {groupLabel(ex.group)} · {ex.type} · {ex.sets}×{ex.repMin}-{ex.repMax} · {ex.rest}s
          {missing.length ? (
            <>
              {' · '}
              <span class="warn">falta: {missing.join(', ')}</span>
            </>
          ) : null}
        </div>
        {bits.length ? <div class="li-sub ex-metrics num">{bits.join(' · ')}</div> : null}
      </div>
      {showHidden ? (
        <button
          type="button"
          class="toggle-pill"
          title={hidden ? 'Volver a mostrar' : 'Sacar de la vista'}
          aria-pressed={hidden}
          onClick={() => bulkSetExerciseFlag([ex.id], { hidden: !hidden })}
        >
          <Icon name={hidden ? 'eye' : 'eye-off'} />
          {hidden ? 'mostrar' : 'ocultar'}
        </button>
      ) : null}
      <button
        type="button"
        class={`toggle-pill ${ex.allowed ? 'on' : 'off'}`}
        title="Permitir o prohibir"
        onClick={() => bulkSetAllowed([ex.id], !ex.allowed)}
      >
        {ex.allowed ? 'permitido' : 'prohibido'}
      </button>
      {ex.custom ? (
        <>
          <button type="button" class="icon-btn" title="Editar" onClick={onEdit}>
            <Icon name="pencil" />
          </button>
          <button type="button" class="icon-btn" title="Eliminar" onClick={onDelete}>
            <Icon name="trash" />
          </button>
        </>
      ) : null}
    </div>
  );
}

/* ---------- coach ---------- */

function SecCoach() {
  const ai = settings.value.ai;
  const [showKey, setShowKey] = useState(false);
  /* Lista de `GET /models`: vacía (o caída) ⇒ manda el catálogo `AI_MODELS` */
  const [remote, setRemote] = useState<ModelOption[]>([]);
  const [busy, setBusy] = useState<'' | 'test' | 'models'>('');
  const [connErr, setConnErr] = useState<{ auth: boolean; detail: string } | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const key = ai.apiKey ?? '';
  const masked = key ? `${key.slice(0, 6)}…${key.slice(-4)}` : '';

  /* Decisión híbrida de la v1 (`V.models`): catálogo remoto si lo hay, si no el
     estático; el modelo actual entra aunque no esté en ninguno («personalizado»)
     y todo ordenado por id. */
  const models: ModelOption[] = [...(remote.length ? remote : AI_MODELS)];
  if (!models.some((m) => m.id === ai.model)) {
    models.push({ id: ai.model, label: ai.model, hint: 'personalizado' });
  }
  models.sort((a, b) => (a.id < b.id ? -1 : 1));

  /* «Probar conexión»: spinner mientras va y, si falla, el modal con las
     pistas de la v1 — con la key mala el título es el de `kind === 'auth'`. */
  const runTest = async (): Promise<void> => {
    if (busy) return;
    if (!key) {
      toast('Añade primero la API key', { kind: 'warn' });
      return;
    }
    setBusy('test');
    const spin = toast(`Probando ${ai.model}…`, { loading: true, sticky: true });
    const res = await testConnection(key, ai.model);
    spin.close();
    setBusy('');
    if (res.ok) {
      toast(`Conexión correcta (${(res.ms / 1000).toFixed(1)}s) · ${ai.model}`, {
        kind: 'ok',
        ms: 4000,
      });
      return;
    }
    setConnErr({ auth: res.kind === 'auth', detail: res.detail });
  };

  /* «Cargar modelos»: si falla (sin red, 403, 429…) se queda el catálogo. */
  const runListModels = async (): Promise<void> => {
    if (busy) return;
    if (!key) {
      toast('Añade primero la API key', { kind: 'warn' });
      return;
    }
    setBusy('models');
    const spin = toast('Consultando modelos disponibles…', { loading: true, sticky: true });
    try {
      const list = await listModels(key);
      setRemote(list);
      toast(`${list.length} modelos con generateContent`, { kind: 'ok' });
    } catch (err) {
      toast(`No se pudieron cargar: ${err instanceof Error ? err.message : String(err)}`, {
        kind: 'err',
        ms: 7000,
      });
    } finally {
      spin.close();
      setBusy('');
    }
  };

  /* Lo que se manda de verdad: el guardado o, vacío, el de fábrica. */
  const activePrompt = (): string => (ai.systemPrompt ?? '').trim() || DEFAULT_SYSTEM;

  const copyPrompt = async (): Promise<void> => {
    const ok = await copyText(activePrompt());
    toast(ok ? 'Prompt copiado al portapapeles' : 'No se pudo copiar el prompt', {
      kind: ok ? 'ok' : 'err',
      ms: ok ? 3000 : 6000,
    });
  };

  const restorePrompt = (): void => {
    if ((ai.systemPrompt ?? '') === '') {
      toast('Ya estaba el prompt por defecto de Pulso', { kind: 'warn' });
      return;
    }
    setSettingsPath('ai.systemPrompt', '');
    toast('Prompt por defecto de Pulso restaurado', { kind: 'ok' });
  };

  return (
    <>
      <div class="card">
        <div class="between mb-s">
          <div class="h3 help-h3">
            <Icon name="key" /> API key de Gemini
            <HelpBtn id="coach.apiKey" title="API key de Gemini" />
          </div>
          <span class={`badge ${key ? 'ok' : 'warn'}`}>{key ? 'configurada' : 'falta'}</span>
        </div>
        <div class="row" style="gap:8px">
          <input
            class="input"
            type={showKey ? 'text' : 'password'}
            value={showKey ? key : ''}
            placeholder={key ? masked : 'AIza…'}
            autocomplete="off"
            spellcheck={false}
            onChange={(e) => setSettingsPath('ai.apiKey', e.currentTarget.value)}
          />
          <button
            type="button"
            class="icon-btn"
            title="Mostrar u ocultar"
            onClick={() => setShowKey(!showKey)}
          >
            <Icon name={showKey ? 'eye-off' : 'eye'} />
          </button>
        </div>
        <div class="row mt-s" style="gap:8px;flex-wrap:wrap">
          <button
            type="button"
            class="btn sm"
            disabled={busy !== ''}
            onClick={() => void runTest()}
          >
            <Icon name="zap" />
            {busy === 'test' ? 'Probando…' : 'Probar conexión'}
          </button>
          <button
            type="button"
            class="btn sm ghost"
            disabled={busy !== ''}
            onClick={() => void runListModels()}
          >
            <Icon name="refresh" />
            {busy === 'models' ? 'Cargando…' : 'Cargar modelos'}
          </button>
          <a
            class="btn sm quiet"
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener"
          >
            Obtener key
          </a>
        </div>
        <p class="sub mt-s">
          La key se guarda solo en el almacenamiento local de este navegador y se envía directamente
          a Google (<i>generativelanguage.googleapis.com</i>).
        </p>
      </div>
      <div class="card flush mt">
        <SelectRow
          inline
          label="Modelo"
          help="opt.model"
          value={ai.model}
          options={models.map((m) => ({
            value: m.id,
            label: m.hint ? `${m.label} — ${m.hint}` : m.label,
          }))}
          onChange={(v) => setSettingsPath('ai.model', v)}
        />
        <SelectRow
          inline
          label="Nivel de pensamiento (thinkingLevel)"
          help="opt.thinkingLevel"
          value={ai.thinkingLevel}
          options={THINKING_LEVELS.map((t) => ({
            value: t.key,
            label: `${t.label} — ${t.hint ?? ''}`,
          }))}
          onChange={(v) => setSettingsPath('ai.thinkingLevel', v)}
        />
        <NumRow
          label="Presupuesto de pensamiento (thinkingBudget)"
          hint="Solo modelos 2.5 · 0 lo desactiva, -1 es dinámico. Se ignora si eliges un nivel"
          help="opt.thinkingBudget"
          value={Number(ai.thinkingBudget) || 0}
          step={1}
          min={-1}
          max={32768}
          onChange={(v) => setSettingsPath('ai.thinkingBudget', v)}
        />
        <SwitchRow
          label="Mostrar razonamiento del modelo"
          hint="includeThoughts: muestra el resumen interno de Gemini"
          help="opt.includeThoughts"
          value={ai.includeThoughts}
          onChange={(v) => setSettingsPath('ai.includeThoughts', v)}
        />
        <NumRow
          label="Temperature"
          hint="0 = determinista, 1 = creativo"
          help="opt.temperature"
          value={ai.temperature}
          step={0.1}
          min={0}
          max={2}
          onChange={(v) => setSettingsPath('ai.temperature', v)}
        />
        <NumRow
          label="Máximo de tokens de salida"
          hint="Súbelo si las rutinas se cortan"
          help="opt.maxTokens"
          value={ai.maxTokens}
          step={512}
          min={512}
          max={65536}
          onChange={(v) => setSettingsPath('ai.maxTokens', v)}
        />
      </div>
      <div class="card mt">
        <div class="help-field">
          <label class="field">
            <span class="label">Instrucciones del sistema (systemInstruction)</span>
            <textarea
              class="input"
              style="min-height:150px"
              placeholder="Vacío = usa el prompt por defecto de Pulso"
              value={ai.systemPrompt ?? ''}
              onChange={(e) => setSettingsPath('ai.systemPrompt', e.currentTarget.value)}
            />
          </label>
          <HelpBtn id="opt.systemPrompt" title="Instrucciones del sistema" />
        </div>
        <div class="row mt-s" style="gap:8px;flex-wrap:wrap">
          <button type="button" class="btn sm" onClick={() => setShowPrompt(true)}>
            <Icon name="eye" />
            Ver prompt activo
          </button>
          <button type="button" class="btn sm ghost" onClick={() => void copyPrompt()}>
            <Icon name="copy" />
            Copiar prompt
          </button>
          <button type="button" class="btn sm ghost" onClick={restorePrompt}>
            <Icon name="refresh" />
            Restaurar por defecto
          </button>
        </div>
        <p class="sub mt-s">
          Se guarda al perder el foco. Vacío = se usa el de fábrica, y ahí no se escribe nunca desde
          Ajustes: lo resuelve el cliente al generar la petición.
        </p>
      </div>
      <InfoCard>
        El coach recibe tu perfil, equipamiento, inventario, ejercicios permitidos e historial
        reciente en cada petición. Aquí solo se configuran los ajustes:{' '}
        <b>el cliente de Gemini llega con el bloque del Coach</b> (pestaña Coach, plan semanal y
        análisis).
      </InfoCard>
      {connErr ? (
        <ConnErrModal
          auth={connErr.auth}
          detail={connErr.detail}
          onClose={() => setConnErr(null)}
        />
      ) : null}
      {showPrompt ? (
        <PromptModal value={ai.systemPrompt ?? ''} onClose={() => setShowPrompt(false)} />
      ) : null}
    </>
  );
}

/**
 * Modal de fallo de «Probar conexión»: con la key mala usa el título de la v1
 * (`errAuth`) y siempre muestra el detalle crudo de `fetch`.
 */
function ConnErrModal({
  auth,
  detail,
  onClose,
}: {
  auth: boolean;
  detail: string;
  onClose: () => void;
}) {
  return (
    <Modal
      title={auth ? 'API key no válida' : 'No se pudo probar la conexión'}
      sub="El modelo no ha respondido"
      onClose={onClose}
      foot={
        <button type="button" class="btn primary" onClick={onClose}>
          Entendido
        </button>
      }
    >
      <div class="card tight" style="border-color:var(--danger)">
        <div class="tiny danger" style="white-space:pre-wrap">
          {detail}
        </div>
      </div>
      <div class="tiny muted mt-s">
        Comprueba que la key es válida y del proyecto correcto, que el modelo existe para tu cuenta
        y que hay conexión a internet. La API de Gemini no necesita CORS especial: puedes usarla
        abriendo el archivo en local.
      </div>
    </Modal>
  );
}

/**
 * Modal «Ver prompt activo»: abre con lo que se manda de verdad
 * (`systemPrompt.trim() || DEFAULT_SYSTEM`) y es editable; al perder el foco ya
 * ha quedado guardado, igual que el textarea de la tarjeta.
 */
function PromptModal({ value, onClose }: { value: string; onClose: () => void }) {
  const [text, setText] = useState(() => value.trim() || DEFAULT_SYSTEM);

  const apply = (next: string): void => {
    setText(next);
    setSettingsPath('ai.systemPrompt', next);
  };

  const copy = async (): Promise<void> => {
    const ok = await copyText(text);
    toast(ok ? 'Prompt copiado al portapapeles' : 'No se pudo copiar el prompt', {
      kind: ok ? 'ok' : 'err',
      ms: ok ? 3000 : 6000,
    });
  };

  return (
    <Modal
      title="Instrucciones del sistema"
      sub="systemInstruction que recibe Gemini"
      onClose={onClose}
      foot={
        <>
          <button type="button" class="btn ghost" onClick={onClose}>
            Cerrar
          </button>
          <button type="button" class="btn primary" onClick={() => void copy()}>
            <Icon name="copy" />
            Copiar
          </button>
        </>
      }
    >
      <textarea
        class="input"
        style="min-height:240px"
        value={text}
        onChange={(e) => apply(e.currentTarget.value)}
      />
      <div class="tiny muted mt-s">
        Dejarlo vacío = vuelve al prompt por defecto de Pulso en la siguiente petición.
      </div>
    </Modal>
  );
}

/* ---------- datos ---------- */

/** Cuánto trae un array importado (`routines` es `unknown` en el estado). */
function countOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function SecDatos() {
  const [msg, setMsg] = useState('');
  const [howto, setHowto] = useState(false);
  /* lee el signal: si el navegador emite `beforeinstallprompt` con Ajustes ya
     abierto, la fila se actualiza sola (espec. hueco 3) */
  const disponible = installable.value;
  const instalada = installed();
  const sess = sessions.value.length;
  /* las de ejemplo llevan `demo: true` (mismo selector que `clearDemo`) */
  const demo = sessions.value.filter((s) => s.demo === true).length;
  const kb = Math.round(storageBytes() / 1024);
  return (
    <>
      <div class="grid c2">
        <Kpi label="Sesiones" value={sess} delta={demo ? `${demo} de ejemplo` : 'guardadas'} />
        <Kpi
          label="Almacenamiento"
          value={fmtN(kb)}
          unit="KB"
          delta={`localStorage · ${storageAvailable ? 'disponible' : 'solo memoria'}`}
        />
      </div>
      {storageAvailable ? null : (
        <div class="card tight mt" style="border-color:var(--warn)">
          <div class="tiny warn">
            Tu navegador está bloqueando localStorage. Los datos no persisten al cerrar: sirve la
            carpeta con <b>npm run dev</b> para guardarlos.
          </div>
        </div>
      )}
      {msg ? (
        <div class="card tight mt">
          <div class="tiny">{msg}</div>
        </div>
      ) : null}
      <div class="card flush mt">
        <ListButton
          icon="download"
          title={instalada ? 'Instalada como aplicación' : 'Instalar como aplicación'}
          sub={
            instalada
              ? 'Funciona sin conexión y avisa con el móvil bloqueado'
              : disponible
                ? 'PWA: a pantalla completa, sin conexión y con notificaciones'
                : 'PWA · sin instalación automática, te enseñamos cómo añadirla'
          }
          onClick={() => {
            /* ya instalada ⇒ aviso y nada más (la v1 no volvía a preguntar) */
            if (installed()) {
              toast('Ya la estás usando como app instalada', { kind: 'ok' });
              return;
            }
            /* sin `beforeinstallprompt` (Firefox/Safari, o en dev) `install()`
               devuelve false y se enseñan las instrucciones manuales */
            void install().then((accepted) => {
              if (!accepted) setHowto(true);
            });
          }}
        />
        <ListButton
          icon="download"
          title="Exportar copia de seguridad"
          sub="JSON con ajustes, equipo, rutinas, sesiones y calendario"
          help="opt.export"
          onClick={() => {
            /* mismo prefijo que la v1 (`pulso-backup-<fecha>.json`) */
            downloadJSON(exportState(), 'pulso-backup');
            setMsg('Copia descargada.');
          }}
        />
        <ListButton
          icon="upload"
          title="Importar copia"
          sub="Reemplaza los datos actuales"
          help="opt.export"
          onClick={() => {
            void pickTextFile().then((text) => {
              if (text === null) return;
              /* igual que la v1 (`views-settings.js`): se confirma ANTES de pisar nada */
              if (
                !window.confirm('Se reemplazarán todos los datos actuales por los del archivo.')
              ) {
                return;
              }
              try {
                const raw: unknown = JSON.parse(text);
                if (!looksLikeState(raw)) {
                  setMsg('Ese archivo no parece una copia de Pulso.');
                  return;
                }
                const next = importState(raw);
                setMsg(
                  `Importadas ${countOf(next.sessions)} sesiones y ${countOf(next.routines)} rutinas.`,
                );
              } catch {
                setMsg('No se pudo leer el archivo (¿JSON válido?).');
              }
            });
          }}
        />
        <ListButton
          icon="zap"
          title="Cargar 8 semanas de ejemplo"
          help="opt.demo"
          sub={
            demo
              ? `Ahora mismo hay ${demo} sesiones de ejemplo`
              : 'Sesiones ficticias para ver las gráficas'
          }
          onClick={() => {
            const n = demoData(8);
            setMsg(
              n
                ? `Añadidas ${n} sesiones de ejemplo (se marcan como ejemplo y las puedes quitar).`
                : 'No se pudo generar el ejemplo.',
            );
          }}
        />
        <ListButton
          icon="trash"
          title="Quitar datos de ejemplo"
          sub="Deja solo tus sesiones reales"
          help="opt.demo"
          onClick={() => {
            if (!window.confirm('Se quitan solo las sesiones de ejemplo. ¿Seguro?')) return;
            const n = clearDemo();
            setMsg(n ? `Quitadas ${n} sesiones de ejemplo.` : 'No había sesiones de ejemplo.');
          }}
        />
        <ListButton
          icon="alert"
          title="Borrar todo"
          danger
          sub="Deja la app como recién instalada"
          help="opt.wipe"
          onClick={() => {
            if (
              !window.confirm(
                'Se van a borrar todos tus datos de Pulso. ¿Seguro? Exporta una copia antes si quieres conservarlos.',
              )
            ) {
              return;
            }
            resetAll();
            setMsg('Datos borrados.');
          }}
        />
      </div>
      <InfoCard>
        <b>Acerca de</b> · Pulso, app de entrenamiento sin dependencias externas: datos 100 %
        locales, sin cuentas ni servidores propios · Coach AI opcional con tu propia API key de
        Gemini. Se lee y escribe el mismo formato que la v1, así que las dos ramas abren los mismos
        datos. Versión {APP_VERSION}.
      </InfoCard>

      {/* Instrucciones manuales: cuando `install()` no ha podido (navegador sin
          `beforeinstallprompt`, o abierto con doble clic). Texto de la v1
          (`app.js:327-333`), con el matiz del service worker según `hasSW()`. */}
      {howto ? (
        <Modal
          title="Instalar Pulso"
          sub="Añádela a la pantalla de inicio"
          onClose={() => setHowto(false)}
          foot={
            <button type="button" class="btn ghost" onClick={() => setHowto(false)}>
              Cerrar
            </button>
          }
        >
          <div class="col" style="gap:10px">
            <div class="card tight">
              <div class="h3">iPhone / iPad (Safari)</div>
              <div class="tiny muted">
                Compartir → «Añadir a pantalla de inicio». En iOS es obligatorio para recibir las
                notificaciones del timer (16.4+).
              </div>
            </div>
            <div class="card tight">
              <div class="h3">Android (Chrome)</div>
              <div class="tiny muted">
                Menú → «Instalar aplicación» o «Añadir a pantalla de inicio».
              </div>
            </div>
            <div class="card tight">
              <div class="h3">Escritorio</div>
              <div class="tiny muted">
                El icono de instalar de la barra de direcciones (Chrome/Edge).
              </div>
            </div>
            <div class="tiny muted">
              {hasSW()
                ? 'Con la app instalada funciona sin conexión y el timer avisa con el móvil bloqueado.'
                : 'Sirviendo la carpeta por http:// funciona sin conexión; abriendo el archivo con doble clic no hay service worker ni notificaciones.'}
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/* ========================================================================== */

/* ---------- ayuda ---------- */

/**
 * Subsección Ayuda (`#/ajustes/ayuda`, spec `help-ux.md` §3.4.2): el MISMO
 * índice que el modal de la guía, aquí siempre visible y sin abrir nada.
 * `GuideIndex` es el que exporta `HelpModal.tsx`, así que buscador, secciones y
 * filas son idénticos en los dos sitios (una sola fuente, cero duplicación).
 */
function SecAyuda() {
  return (
    <>
      <InfoCard>
        La guía entera de Pulso, aquí a mano: busca un término (1RM, descanso, racha…) o despliega
        una sección y toca cualquier tema. Es el mismo índice que abre el ⓘ de la barra superior, y
        los ⓘ de cada opción de Ajustes llegan a estos mismos temas.
      </InfoCard>
      <div class="card mt">
        <GuideIndex />
      </div>
    </>
  );
}

export function SettingsView({ sub }: { sub: string | null }) {
  const key: SubKey = SUBS.find((s) => s.key === sub)?.key ?? 'perfil';
  return (
    <>
      {/* `.seg` de la v1 estiliza `button`, así que la subnavegación va con botones
          que cambian el hash (el router es la única fuente de la subsección). El ?
          de la pestaña va fuera del `.seg` (que es scrollable) en su fila. */}
      <div class="help-row mb">
        <div class="seg">
          {SUBS.map((s) => (
            <button
              key={s.key}
              type="button"
              class={key === s.key ? 'on' : ''}
              onClick={() => go('ajustes', s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <HelpBtn id="tab.ajustes" title="Ajustes" />
      </div>
      {key === 'perfil' ? <SecPerfil /> : null}
      {key === 'apariencia' ? <SecApariencia /> : null}
      {key === 'entreno' ? <SecEntreno /> : null}
      {key === 'equipo' ? <SecEquipo /> : null}
      {key === 'discos' ? <SecDiscos /> : null}
      {key === 'ejercicios' ? <SecEjercicios /> : null}
      {key === 'coach' ? <SecCoach /> : null}
      {key === 'datos' ? <SecDatos /> : null}
      {key === 'ayuda' ? <SecAyuda /> : null}
    </>
  );
}

/* El catálogo se filtra una vez por render; el agrupado se calcula aquí para no
   recorrer las 49 piezas cuatro veces (una por categoría). */
const EQUIPMENT_BY_CAT = (cat: string): EquipmentItem[] => EQUIPMENT.filter((e) => e.cat === cat);
