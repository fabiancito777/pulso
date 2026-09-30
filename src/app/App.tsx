/**
 * Shell de la v2: barra superior, **vista por pestaña** (rutas por hash, `router.ts`)
 * y la barra de abajo. Cada pestaña monta su vista portada; las que siguen en
 * `legacy/` muestran el aviso de "pendiente" (flag `ported` del router), que es el
 * estado real de la migración y no un error de la app.
 */
import { useEffect, useRef, useState } from 'preact/hooks';

import { go, route, startRouter, TABS, type Tab } from '@/app/router';
import { totals } from '@/domain/analytics';
import { TEMPLATES } from '@/domain/catalog';
import { fmtClock } from '@/domain/format';
import { applyTheme } from '@/platform/theme';
import { active, rest, sessionSeconds, startLoop } from '@/state/session';
import { meta, routines, sessions, settings, storageAvailable } from '@/state/store';
import { CalendarView } from '@/ui/CalendarView';
import { CoachView } from '@/ui/CoachView';
import { HoyView } from '@/ui/HoyView';
import { Icon } from '@/ui/Icon';
import { MigrationCards } from '@/ui/MigrationCards';
import { Onboarding } from '@/ui/Onboarding';
import { PlatesCard } from '@/ui/PlatesCard';
import { ProgressView } from '@/ui/ProgressView';
import { RoutinesView } from '@/ui/RoutinesView';
import { SessionCard } from '@/ui/SessionCard';
import { SettingsView } from '@/ui/SettingsView';

/**
 * Reloj de la sesión en la barra (el `#btn-session-clock` de la v1,
 * `trainer.js:485`). Es un componente aparte A PROPÓSITO: es lo único de la
 * barra que lee `sessionSeconds`, así que solo él se repinta cada segundo y los
 * inputs de SessionCard no se reescriben mientras escribes.
 */
function SessionClock() {
  if (!active.value) return null;
  return (
    <button
      type="button"
      class="chip accent v2-clock"
      title="Sesión en curso · ir a Hoy"
      onClick={() => go('hoy')}
    >
      <span class="dot-live" />
      <span class="num">{fmtClock(sessionSeconds.value)}</span>
    </button>
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

/**
 * Subtítulo de pestaña: el `V.sub` de la v1, que `updateAppbar` (`app.js:60-63`)
 * pintaba bajo el título en `#appbar-sub`.
 *
 * Solo lo pintan aquí las pestañas que no lo llevan ya DENTRO de su vista: Hoy
 * sale con el saludo (`HoyView`), Progreso con `ProgressCard` y Coach con su
 * tarjeta de conexión; Entrenar es nuevo en la v2 y no tenía. El de Calendario
 * depende del cursor, que vive en `CalendarView`, así que lo pinta esa vista.
 * `App.test.ts` vigila que las 6 pestañas de la v1 sigan cubiertas entre las
 * dos mitades.
 */
export function tabSub(tab: string): string {
  if (tab === 'rutinas') {
    const n = routines.value.length;
    return n
      ? `${n} ${n === 1 ? 'rutina guardada' : 'rutinas guardadas'} · ${TEMPLATES.length} plantillas`
      : 'Crea tu primera rutina o usa una plantilla';
  }
  if (tab === 'ajustes') return 'Personaliza Pulso a tu medida';
  return '';
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
      /* contrato con I7: montaje único de la pestaña (ProgressCard + charts +
         historial) en su propio componente */
      return <ProgressView />;
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
  const sub = tabSub(current.key);
  const streak = totals(sessions.value).streak;
  /* La sesión (y el descanso, que también puede ser el temporizador libre de Hoy)
     no se esconden al cambiar de pestaña (en la v1 la barra de descanso era
     global); el placeholder de "sin sesión" solo manda en Entrenar, porque en
     Hoy el hero ya dice por dónde empezar (spec hoy.md, decisiones 6-7). Con
     `rest.running` y sin sesión, `SessionCard` pinta el recuadro ÚNICO de
     descanso (su rama `!session && resting`), nunca el placeholder. */
  const showSession = current.key === 'entrenar' || active.value || rest.value.running;

  useEffect(() => applyTheme(s.theme, s.accent), [s.theme, s.accent]);

  /* Onboarding de primera vez (spec `onboarding.md`, hueco 1): 350 ms después de
     arrancar, como la v1 (`app.js:1279`), y solo si sigue sin verse. No se abre
     con una sesión o un descanso en marcha: taparía el entreno (caso e). El
     cierre lo detecta la signal `meta` (el modal la escribe al cerrarse). */
  const [boarding, setBoarding] = useState(false);
  useEffect(() => {
    if (meta.value.onboarded === true) return;
    const timer = setTimeout(() => {
      if (meta.value.onboarded === true || active.value || rest.value.running) return;
      setBoarding(true);
    }, 350);
    return () => clearTimeout(timer);
  }, []);

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
          <SessionClock />
        </div>
        <div class="tiny muted">Vite · TypeScript · Preact — migración en curso</div>
      </header>

      <main class="v2-main">
        {sub ? <div class="v2-sub">{sub}</div> : null}

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

      {/* Overlay global de primera visita: se desmonta en cuanto la signal
          `meta.onboarded` pasa a true (los dos botones del modal lo marcan). */}
      {boarding && meta.value.onboarded !== true ? <Onboarding /> : null}
    </div>
  );
}
