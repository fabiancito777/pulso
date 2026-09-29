/**
 * Shell de la v2: barra superior, **vista por pestaña** (rutas por hash, `router.ts`)
 * y la barra de abajo. Cada pestaña monta su vista portada; las que siguen en
 * `legacy/` muestran el aviso de "pendiente" (flag `ported` del router), que es el
 * estado real de la migración y no un error de la app.
 */
import { useEffect, useRef } from 'preact/hooks';

import { go, route, startRouter, TABS, type Tab } from '@/app/router';
import { totals } from '@/domain/analytics';
import { applyTheme } from '@/platform/theme';
import { active, rest, startLoop } from '@/state/session';
import { sessions, settings, storageAvailable } from '@/state/store';
import { CalendarView } from '@/ui/CalendarView';
import { CoachView } from '@/ui/CoachView';
import { HoyView } from '@/ui/HoyView';
import { Icon } from '@/ui/Icon';
import { MigrationCards } from '@/ui/MigrationCards';
import { PlatesCard } from '@/ui/PlatesCard';
import { ProgressCard } from '@/ui/ProgressCard';
import { RoutinesView } from '@/ui/RoutinesView';
import { SessionCard } from '@/ui/SessionCard';
import { SettingsView } from '@/ui/SettingsView';
import { ProgressCharts } from '@/ui/charts';

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
    case 'hoy':
      return <HoyView />;
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
      return <MigrationCards />;
  }
}

export function App() {
  const s = settings.value;
  const bar = useRef<HTMLElement | null>(null);
  const current = TABS.find((t) => t.key === route.value.tab) ?? TABS[0];
  const streak = totals(sessions.value).streak;
  /* La sesión (y el descanso, que también puede ser el temporizador libre de Hoy)
     no se esconden al cambiar de pestaña (en la v1 la barra de descanso era
     global); el placeholder de "sin sesión" solo manda en Entrenar, porque en
     Hoy el hero ya dice por dónde empezar (spec hoy.md, decisiones 6-7). Con
     `rest.running` y sin sesión, `SessionCard` pinta el recuadro ÚNICO de
     descanso (su rama `!session && resting`), nunca el placeholder. */
  const showSession = current.key === 'entrenar' || active.value || rest.value.running;

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
          <button
            type="button"
            class="chip v2-streak"
            title="Racha de entrenamiento"
            onClick={() => go('progreso')}
          >
            <Icon name="fire" />
            <span>{streak}</span>
          </button>
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

        {showSession ? <SessionCard /> : null}

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
