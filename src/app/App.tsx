/**
 * Shell de la v2: barra superior, **vista por pestaña** (rutas por hash, `router.ts`)
 * y la barra de abajo. Cada pestaña monta su vista portada; las que siguen en
 * `legacy/` muestran el aviso de "pendiente" (flag `ported` del router), que es el
 * estado real de la migración y no un error de la app.
 */
import { useEffect, useRef, useState } from 'preact/hooks';

import { ROADMAP, type PortState } from '@/app/roadmap';
import { go, route, startRouter, TABS, type Tab } from '@/app/router';
import { equipLabel, enabledEquipment, groupLabel, isAvailable } from '@/domain/data';
import { customExercises } from '@/domain/library';
import type { PlateModeKey } from '@/domain/types';
import { applyTheme } from '@/platform/theme';
import { active, startLoop } from '@/state/session';
import {
  equipment,
  exercises,
  rememberPlateMode,
  settings,
  storageAvailable,
  TOOL_MODE_KEY,
} from '@/state/store';
import { CalendarView } from '@/ui/CalendarView';
import { CoachView } from '@/ui/CoachView';
import { Icon } from '@/ui/Icon';
import { Plates } from '@/ui/Plates';
import { ProgressCard } from '@/ui/ProgressCard';
import { RoutinesView } from '@/ui/RoutinesView';
import { SessionCard } from '@/ui/SessionCard';
import { SettingsView } from '@/ui/SettingsView';
import { ProgressCharts } from '@/ui/charts';

const STATE_LABEL: Record<PortState, string> = {
  portado: 'portado',
  'en curso': 'en curso',
  pendiente: 'pendiente',
};

function LibraryCard() {
  const all = exercises.value;
  const equip = equipment.value;
  const available = all.filter((ex) => isAvailable(ex, equip));
  const enabled = enabledEquipment(equip);

  return (
    <section class="card">
      <div class="row between mb-s">
        <b>Biblioteca y material</b>
        <span class="tiny muted">catálogo portado de la v1</span>
      </div>
      <div class="kv">
        <span class="k">Ejercicios</span>
        <span class="v">
          {all.length} · {all.filter((e) => e.allowed).length} permitidos · {available.length}{' '}
          disponibles
        </span>
      </div>
      <div class="kv">
        <span class="k">Propios</span>
        <span class="v">{customExercises(all).length}</span>
      </div>
      <div class="kv">
        <span class="k">Material activo</span>
        <span class="v">{enabled.length} piezas</span>
      </div>
      <div class="tiny muted mt-s">
        {enabled.length ? enabled.map((k) => equipLabel(k)).join(' · ') : 'ninguna pieza activada'}
      </div>
      <div class="tiny muted">
        Ejemplo con tu material:{' '}
        {available
          .slice(0, 2)
          .map((ex) => `${ex.name} (${groupLabel(ex.group)})`)
          .join(' · ')}
      </div>
    </section>
  );
}

/** La calculadora de discos con sus ajustes reales (recuerda el modo por herramienta). */
function PlatesCard() {
  const s = settings.value;
  const [applied, setApplied] = useState<string | null>(null);
  const mode = s.plateModes[TOOL_MODE_KEY] ?? 'bar';
  return (
    <section class="card">
      <div class="row between mb-s">
        <b>Calculadora de discos</b>
        <span class="tiny muted">usa tus ajustes reales de la v1</span>
      </div>
      <Plates
        plates={s.plates}
        bars={s.bars}
        unit={s.units}
        initialMode={mode}
        onModeChange={(m: PlateModeKey) => rememberPlateMode(TOOL_MODE_KEY, m)}
        onUse={(kg) => setApplied(`${kg} ${s.units}`)}
      />
      {applied ? (
        <div class="tiny ok mt-s">
          Se aplicarían {applied} a la serie (aquí no hay sesión activa todavía).
        </div>
      ) : null}
    </section>
  );
}

/** Estado de la migración visible en la app (no sustituye a los tests, orienta). */
function RoadmapCard() {
  return (
    <section class="card">
      <div class="row between mb-s">
        <b>Estado de la migración</b>
        <span class="tiny muted">
          {ROADMAP.filter((r) => r.state === 'portado').length} de {ROADMAP.length} bloques
        </span>
      </div>
      <div class="rm">
        {ROADMAP.map((item) => (
          <div key={item.area} class="rm-row">
            <span class={`rm-dot ${item.state === 'en curso' ? 'curso' : item.state}`} />
            <div>
              <div class="rm-head">
                <b>{item.area}</b>
                <span class="tiny muted">{STATE_LABEL[item.state]}</span>
              </div>
              <div class="tiny muted">
                {item.v1} → {item.v2}
              </div>
              <div class="tiny muted">{item.note}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Vistas que siguen en `legacy/`: el `ported: false` del router, explicado. */
function PendingTab({ tab }: { tab: Tab }) {
  return (
    <section class="card tight">
      <div class="row between mb-s">
        <b>{tab.label}</b>
        <span class="badge warn">pendiente</span>
      </div>
      <div class="tiny muted mb-s">
        {tab.hint} · esta vista todavía vive en <code>legacy/</code> (la v1 de la rama{' '}
        <code>main</code>).
      </div>
      <div class="tiny muted">
        El roadmap de la pestaña Hoy dice en qué bloque entra. Mientras tanto, las pestañas con el
        punto en verde ya funcionan aquí.
      </div>
      <div class="row mt-s" style="gap:8px">
        <button type="button" class="btn sm" onClick={() => go('hoy')}>
          <Icon name="home" />
          Hoy
        </button>
        <button type="button" class="btn sm ghost" onClick={() => go('entrenar')}>
          <Icon name="dumbbell" />
          Entrenar
        </button>
      </div>
    </section>
  );
}

/** El contenido de la pestaña activa: portada, o el aviso si aún no lo está. */
function CurrentView({ tab }: { tab: Tab }) {
  if (!tab.ported) return <PendingTab tab={tab} />;
  switch (tab.key) {
    case 'ajustes':
      return <SettingsView sub={route.value.sub} />;
    case 'progreso':
      return (
        <>
          <ProgressCard />
          <section class="card">
            <div class="row between mb-s">
              <b>Gráficos</b>
              <span class="tiny muted">charts.js portado · SVG sin librerías</span>
            </div>
            <ProgressCharts />
          </section>
        </>
      );
    case 'entrenar':
      return <PlatesCard />;
    case 'rutinas':
      return <RoutinesView />;
    case 'calendario':
      return <CalendarView />;
    case 'coach':
      return <CoachView />;
    default:
      return (
        <>
          <LibraryCard />
          <RoadmapCard />
          <section class="card tight">
            <div class="tiny muted">
              La v1 completa (HTML + JS vanilla) sigue congelada en <code>legacy/</code> y es la app
              que corre en la rama <code>main</code>. Aquí se porta bloque a bloque.
            </div>
          </section>
        </>
      );
  }
}

export function App() {
  const s = settings.value;
  const bar = useRef<HTMLElement | null>(null);
  const current = TABS.find((t) => t.key === route.value.tab) ?? TABS[0];
  /* La sesión y su descanso no se esconden al cambiar de pestaña (en la v1 la barra
     de descanso era global); lo demás vive solo en su pestaña. */
  const onTrainingTab = current.key === 'hoy' || current.key === 'entrenar';

  useEffect(() => applyTheme(s.theme, s.accent), [s.theme, s.accent]);

  /* Escucha `hashchange`: cualquier cambio de pestaña actualiza `route` y, con ella,
     la vista (el signal repinta solo). */
  useEffect(() => startRouter(), []);

  /* El bucle de 500 ms: cuenta atrás, tics y aviso de fin de descanso. Es el `T.loop`
     de la v1, que arrancaba app.js. */
  useEffect(() => startLoop(), []);

  /* El recuadro de descanso es pegajoso bajo la barra superior, así que la barra
     publica su altura en `--appbar-h` (en la v1 lo hacía `syncAppbarHeight()`). */
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const publish = () =>
      document.documentElement.style.setProperty('--appbar-h', `${el.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div class="v2-shell">
      <header class="v2-bar" ref={bar}>
        <div class="v2-brand">
          <b>Pulso</b>
          <span class="badge">v2</span>
        </div>
        <div class="tiny muted">Vite · TypeScript · Preact — migración en curso</div>
      </header>

      <main class="v2-main">
        {!storageAvailable ? (
          <div class="card tight">
            <div class="tiny warn">
              localStorage está bloqueado: los ajustes no se guardan entre recargas.
            </div>
          </div>
        ) : null}

        {onTrainingTab || active.value ? <SessionCard /> : null}

        <CurrentView tab={current} />
      </main>

      <nav class="v2-tabs" aria-label="Navegación principal">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            class={`chip${t.key === current.key ? ' accent' : ''}${t.ported ? '' : ' off'}`}
            title={t.ported ? t.hint : `${t.hint} · pendiente`}
            aria-current={t.key === current.key ? 'page' : undefined}
            onClick={() => go(t.key)}
          >
            <Icon name={t.icon} />
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
