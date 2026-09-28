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
import { useState } from 'preact/hooks';

import { EQUIPMENT } from '@/domain/catalog';
import {
  ACCENTS,
  AI_MODELS,
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
  goalLabel,
  groupLabel,
  isAvailable,
  missingEquipment,
} from '@/domain/data';
import { fmtN } from '@/domain/format';
import { maxLoadable, solvePlates } from '@/domain/plates';
import type { EquipmentItem, Exercise, PlateStock, Theme, Unit } from '@/domain/types';
import { fromKg } from '@/domain/units';
import { go } from '@/app/router';
import { applyTheme } from '@/platform/theme';
import { downloadJSON, pickTextFile } from '@/platform/files';
import {
  addPlate,
  applyEquipment,
  bulkSetAllowed,
  equipment,
  exercises,
  exportState,
  importState,
  looksLikeState,
  patchSettings,
  removePlate,
  resetAll,
  sessions,
  setSettingsPath,
  settings,
  storageAvailable,
  storageBytes,
  togglePlate,
  updatePlate,
} from '@/state/store';
import { Icon } from '@/ui/Icon';
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

const SUBS = [
  { key: 'perfil', label: 'Perfil', icon: 'user' },
  { key: 'apariencia', label: 'Apariencia', icon: 'moon' },
  { key: 'entreno', label: 'Entreno', icon: 'timer' },
  { key: 'equipo', label: 'Equipo', icon: 'dumbbell' },
  { key: 'discos', label: 'Discos', icon: 'plate' },
  { key: 'ejercicios', label: 'Ejercicios', icon: 'database' },
  { key: 'coach', label: 'Coach AI', icon: 'sparkles' },
  { key: 'datos', label: 'Datos', icon: 'download' },
] as const;

type SubKey = (typeof SUBS)[number]['key'];

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
          value={st.level}
          options={LEVELS.map((l) => ({ value: l, label: l }))}
          onChange={(level) => setSettingsPath('level', level)}
        />
        <SelectRow
          label="Objetivo principal"
          hint="Define repeticiones, series y descansos por defecto"
          value={goal}
          options={GOALS.map((g) => ({ value: g.key, label: g.label }))}
          onChange={(g) => setSettingsPath('goal', g)}
        />
        <SelectRow
          label="Días de entreno por semana"
          hint="Se usa para el plan semanal"
          value={String(st.daysPerWeek)}
          options={['2', '3', '4', '5', '6'].map((d) => ({ value: d, label: d }))}
          onChange={(d) => setSettingsPath('daysPerWeek', Number(d))}
        />
        <SelectRow
          label="Unidades"
          hint="Cambia la visualización de pesos"
          value={st.units}
          options={[
            { value: 'kg', label: 'Kilogramos (kg)' },
            { value: 'lb', label: 'Libras (lb)' },
          ]}
          onChange={(u) => setSettingsPath('units', u)}
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
          value={st.notify}
          onChange={(v) => setSettingsPath('notify', v)}
        />
        <SwitchRow
          label="Mantener la sesión despierta"
          hint="Pantalla encendida y aviso de descanso con el móvil bloqueado"
          value={st.keepAwake}
          onChange={(v) => setSettingsPath('keepAwake', v)}
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
          value={st.autoRest}
          onChange={(v) => setSettingsPath('autoRest', v)}
        />
        <NumRow
          label="Incremento de progresión"
          hint="Cuánto subir cuando puedes con el rango alto"
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
          value={st.showRpe}
          onChange={(v) => setSettingsPath('showRpe', v)}
        />
        <SwitchRow
          label="Finalizar rápido"
          hint="No avisar cuando completes todas las series"
          value={st.quickFinish}
          onChange={(v) => setSettingsPath('quickFinish', v)}
        />
        <SwitchRow
          label="Contar aproximaciones"
          hint="Incluir series de calentamiento en el volumen"
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
          <div class="h3">
            Tu material ({active}/{Object.keys(eq).length})
          </div>
          <span class="tiny muted">filtra qué ejercicios se pueden sugerir</span>
        </div>
        <div class="hr-scroll">
          {(
            [
              ['basico', 'Casa básica'],
              ['gym', 'Gym completo'],
              ['todo', 'Todo'],
              ['ninguno', 'Solo peso corporal'],
            ] as const
          ).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              class="chip"
              onClick={() => applyEquipment(equipPreset(kind))}
            >
              {label}
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
  const pairs = plate.pairs || 0;
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
        value={String(plate.pairs)}
        aria-label="pares disponibles"
        onChange={(e) => updatePlate(index, { pairs: Number(e.currentTarget.value) })}
      />
      <span class="tiny muted grow num">
        = {fmtN(kg, 2)} kg{plate.unit === 'lb' ? ` · ${fmtN(plate.w)} lb` : ''} · {pairs}{' '}
        {pairs === 1 ? 'par' : 'pares'} ({pairs * 2} discos) · {fmtN(kg * pairs, 2)} kg por lado de
        barra
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
  const kgOf = (p: PlateStock) => (p.unit === 'lb' ? p.w * 0.45359237 : p.w);
  const bar = maxLoadable({ plates, bars, mode: 'bar' });
  const dbs = maxLoadable({ plates, bars, mode: 'db2' });
  const perSide = active.reduce((sum, p) => sum + kgOf(p) * (p.pairs || 0), 0);
  const discs = active.reduce((sum, p) => sum + (p.pairs || 0) * 2, 0);
  const barHint = (kg: number) =>
    `Peso sin discos · 0 kg si es de plástico · ${fmtN(fromKg(kg, 'lb'), 1)} lb`;
  return (
    <>
      <div class="grid c2">
        <Kpi
          label="Máximo en barra"
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
          label="Discos activos"
          value={active.length}
          delta={`${discs} discos · ${fmtN(perSide, 1)} kg por lado`}
        />
      </div>
      <InfoCard>
        Un <b>par</b> son 2 discos: uno para cada lado de la barra o cada extremo de la mancuerna.
        Con los mismos discos la barra admite <b>{fmtN(bar.sideKg, 1)} kg por lado</b>, una
        mancuerna suelta <b>{fmtN(bar.sideKg, 1)} kg por extremo</b> y, cargando dos mancuernas a la
        vez, <b>{fmtN(dbs.sideKg, 1)} kg por extremo en cada una</b>. Se pueden mezclar discos en kg
        y en lb (todo se calcula en kilogramos).
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
            value={bars.olimpica}
            step={0.5}
            min={0}
            max={100}
            onChange={(v) => setSettingsPath('bars.olimpica', v)}
          />
          <NumRow
            label="Peso de la barra EZ"
            hint={barHint(bars.ez)}
            value={bars.ez}
            step={0.5}
            min={0}
            max={100}
            onChange={(v) => setSettingsPath('bars.ez', v)}
          />
          <NumRow
            label="Peso del mango de mancuerna"
            hint={barHint(bars.mancuerna)}
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

function SecEjercicios() {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('');
  const [state, setState] = useState('all');
  const list = exercises.value;
  const blocked = list.filter((e) => !e.allowed).length;
  const usable = list.filter((e) => e.allowed && isAvailable(e, equipment.value));

  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  const needle = norm(q.trim());
  const filtered = list
    .filter((e) => {
      if (needle && !norm(e.name).includes(needle)) return false;
      if (group && e.group !== group) return false;
      if (state === 'allowed' && !e.allowed) return false;
      if (state === 'blocked' && e.allowed) return false;
      if (state === 'unavailable' && isAvailable(e, equipment.value)) return false;
      if (state === 'custom' && !e.custom) return false;
      return true;
    })
    .sort((a, b) => {
      const ga = GROUPS.findIndex((x) => x.key === a.group);
      const gb = GROUPS.findIndex((x) => x.key === b.group);
      if (ga !== gb) return ga - gb;
      return a.name.localeCompare(b.name, 'es');
    });
  const shown = filtered.filter((e) => e.allowed).length;

  return (
    <>
      <div class="grid c3">
        <Kpi label="Biblioteca" value={list.length} delta="ejercicios" />
        <Kpi label="Permitidos" value={list.length - blocked} delta={`${blocked} prohibidos`} />
        <Kpi label="Con tu equipo" value={usable.length} delta="listos para sugerir" />
      </div>
      <div class="card mt">
        <div class="search">
          <Icon name="search" />
          <input
            class="input"
            placeholder="Buscar ejercicio…"
            value={q}
            onInput={(e) => setQ(e.currentTarget.value)}
          />
        </div>
        <div class="grid c2 mt-s">
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
            <option value="custom">Propios</option>
          </select>
        </div>
        <div class="row mt-s" style="gap:8px">
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
      <div class="row wrap between mt-s" style="gap:8px">
        <button
          type="button"
          class="btn sm ghost"
          onClick={() =>
            bulkSetAllowed(
              filtered.map((e) => e.id),
              true,
            )
          }
        >
          Permitir los {filtered.length} filtrados
        </button>
        <button
          type="button"
          class="btn sm ghost"
          onClick={() =>
            bulkSetAllowed(
              filtered.map((e) => e.id),
              false,
            )
          }
        >
          Prohibir los {filtered.length} filtrados
        </button>
      </div>
      <div class="card flush mt">
        {filtered.length ? (
          filtered.map((e) => <ExerciseRow key={e.id} ex={e} />)
        ) : (
          <div class="empty">Sin resultados con estos filtros</div>
        )}
      </div>
      <InfoCard>
        El editor de ejercicios propios (crear, editar y borrar) llega con el bloque de modales; por
        ahora se permite o se prohíbe cualquier ejercicio de la biblioteca.
      </InfoCard>
    </>
  );
}

function ExerciseRow({ ex }: { ex: Exercise }) {
  const missing = missingEquipment(ex, equipment.value);
  return (
    <div class="ex-pick" style={ex.allowed ? '' : 'opacity:.55'}>
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
      </div>
      <button
        type="button"
        class={`toggle-pill ${ex.allowed ? 'on' : 'off'}`}
        title="Permitir o prohibir"
        onClick={() => bulkSetAllowed([ex.id], !ex.allowed)}
      >
        {ex.allowed ? 'permitido' : 'prohibido'}
      </button>
    </div>
  );
}

/* ---------- coach ---------- */

function SecCoach() {
  const ai = settings.value.ai;
  const [showKey, setShowKey] = useState(false);
  const key = ai.apiKey ?? '';
  const masked = key ? `${key.slice(0, 6)}…${key.slice(-4)}` : '';
  const models = AI_MODELS.some((m) => m.id === ai.model)
    ? AI_MODELS
    : [...AI_MODELS, { id: ai.model, label: ai.model, hint: 'personalizado' }];
  return (
    <>
      <div class="card">
        <div class="between mb-s">
          <div class="h3">
            <Icon name="key" /> API key de Gemini
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
          value={Number(ai.thinkingBudget) || 0}
          step={1}
          min={-1}
          max={32768}
          onChange={(v) => setSettingsPath('ai.thinkingBudget', v)}
        />
        <SwitchRow
          label="Mostrar razonamiento del modelo"
          hint="includeThoughts: muestra el resumen interno de Gemini"
          value={ai.includeThoughts}
          onChange={(v) => setSettingsPath('ai.includeThoughts', v)}
        />
        <NumRow
          label="Temperature"
          hint="0 = determinista, 1 = creativo"
          value={ai.temperature}
          step={0.1}
          min={0}
          max={2}
          onChange={(v) => setSettingsPath('ai.temperature', v)}
        />
        <NumRow
          label="Máximo de tokens de salida"
          hint="Súbelo si las rutinas se cortan"
          value={ai.maxTokens}
          step={512}
          min={512}
          max={65536}
          onChange={(v) => setSettingsPath('ai.maxTokens', v)}
        />
      </div>
      <div class="card mt">
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
      </div>
      <InfoCard>
        El coach recibe tu perfil, equipamiento, inventario, ejercicios permitidos e historial
        reciente en cada petición. Aquí solo se configuran los ajustes:{' '}
        <b>el cliente de Gemini llega con el bloque del Coach</b> (pestaña Coach, plan semanal y
        análisis).
      </InfoCard>
    </>
  );
}

/* ---------- datos ---------- */

function SecDatos() {
  const [msg, setMsg] = useState('');
  const sess = sessions.value.length;
  const kb = Math.round(storageBytes() / 1024);
  return (
    <>
      <div class="grid c2">
        <Kpi label="Sesiones" value={sess} delta="guardadas" />
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
          title="Exportar copia de seguridad"
          sub="JSON con ajustes, equipo, rutinas, sesiones y calendario"
          onClick={() => {
            downloadJSON(exportState());
            setMsg('Copia descargada.');
          }}
        />
        <ListButton
          icon="upload"
          title="Importar copia"
          sub="Reemplaza los datos actuales"
          onClick={() => {
            void pickTextFile().then((text) => {
              if (text === null) return;
              try {
                const raw: unknown = JSON.parse(text);
                if (!looksLikeState(raw)) {
                  setMsg('Ese archivo no parece una copia de Pulso.');
                  return;
                }
                importState(raw);
                setMsg('Copia importada. Los ajustes y las sesiones se han reemplazado.');
              } catch {
                setMsg('No se pudo leer el archivo (¿JSON válido?).');
              }
            });
          }}
        />
        <ListButton
          icon="alert"
          title="Borrar todo"
          danger
          sub="Deja la app como recién instalada"
          onClick={() => {
            if (!window.confirm('Se van a borrar todos tus datos de Pulso. ¿Seguro?')) return;
            resetAll();
            setMsg('Datos borrados.');
          }}
        />
      </div>
      <InfoCard>
        Sin dependencias externas ni cuentas: todo lo que hay aquí vive en este navegador. La
        calculadora, la sesión y la analítica leen y escriben el <b>mismo</b> formato de datos que
        la v1, así que las dos ramas pueden abrir los mismos datos.
      </InfoCard>
    </>
  );
}

/* ========================================================================== */

export function SettingsView({ sub }: { sub: string | null }) {
  const key: SubKey = SUBS.find((s) => s.key === sub)?.key ?? 'perfil';
  return (
    <>
      {/* `.seg` de la v1 estiliza `button`, así que la subnavegación va con botones
          que cambian el hash (el router es la única fuente de la subsección) */}
      <div class="seg mb">
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
      {key === 'perfil' ? <SecPerfil /> : null}
      {key === 'apariencia' ? <SecApariencia /> : null}
      {key === 'entreno' ? <SecEntreno /> : null}
      {key === 'equipo' ? <SecEquipo /> : null}
      {key === 'discos' ? <SecDiscos /> : null}
      {key === 'ejercicios' ? <SecEjercicios /> : null}
      {key === 'coach' ? <SecCoach /> : null}
      {key === 'datos' ? <SecDatos /> : null}
    </>
  );
}

/* El catálogo se filtra una vez por render; el agrupado se calcula aquí para no
   recorrer las 49 piezas cuatro veces (una por categoría). */
const EQUIPMENT_BY_CAT = (cat: string): EquipmentItem[] => EQUIPMENT.filter((e) => e.cat === cat);
