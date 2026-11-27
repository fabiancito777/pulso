/**
 * Shell de la app: barra superior, **vista por pestaña** (rutas por hash, `router.ts`)
 * y la barra de abajo. Cada pestaña monta su vista.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

import { go, route, startRouter, TABS, type Tab } from '@/app/router';
import { totals } from '@/domain/analytics';
import { TEMPLATES } from '@/domain/data';
import { today } from '@/domain/dates';
import { fmtClock } from '@/domain/format';
import { progress as sessionProgress } from '@/domain/session';
import { applyTheme } from '@/platform/theme';
import {
  active,
  lastFinished,
  rest,
  repeatSession,
  sessionSeconds,
  startLoop,
} from '@/state/session';
import { startSyncAuto } from '@/state/sync';
import { activeProfile, profileInitial } from '@/state/profiles';
import { demoMode, meta, routines, sessions, settings, storageAvailable } from '@/state/store';
import { CalendarView } from '@/ui/CalendarView';
import { CoachView } from '@/ui/CoachView';
import { HoyView } from '@/ui/HoyView';
import { openHelp } from '@/ui/HelpModal';
import { Icon } from '@/ui/Icon';
import { Modal } from '@/ui/Modal';
import { Onboarding } from '@/ui/Onboarding';
import { ProfileSheet } from '@/ui/ProfileSheet';
import { ProgressView } from '@/ui/ProgressView';
import { RoutinesView } from '@/ui/RoutinesView';
import { RestDock, SessionCard, SessionDock } from '@/ui/SessionCard';
import { SessionDoneSheet } from '@/ui/SessionDoneSheet';
import { sessionDoneSummary } from '@/ui/session-done-helpers';
import { SettingsView } from '@/ui/SettingsView';
import { toast } from '@/ui/toast';

/**
 * Hoja de fin de sesión. Se monta en el SHELL, no en `SessionCard`, porque esa
 * tarjeta se desmonta al terminar si cierras desde Hoy: el acuse tiene que vivir
 * por encima de la pestaña y de la propia sesión.
 *
 * El resumen (récords, comparación con la anterior, racha) se calcula aquí a
 * partir de `lastFinished` y del historial ya guardado; el estado solo publica
 * la sesión cerrada.
 */
function FinishedSheet() {
  const done = lastFinished.value;
  if (!done) return null;
  return (
    <SessionDoneSheet
      summary={sessionDoneSummary(done, sessions.value, today())}
      onClose={() => {
        lastFinished.value = null;
      }}
      onProgress={() => {
        lastFinished.value = null;
        go('progreso');
      }}
      onCalendar={() => {
        lastFinished.value = null;
        go('calendario');
      }}
      onRepeat={(session) => {
        if (!repeatSession(session)) {
          toast('Termina la sesión actual primero', { kind: 'warn' });
          return false;
        }
        go('hoy');
        return true;
      }}
    />
  );
}

/**
 * Reloj de la sesión en la barra. Es un componente aparte A PROPÓSITO: es lo único
 * de la barra que lee `sessionSeconds`, así que solo él se repinta cada segundo y
 * los inputs de SessionCard no se reescriben mientras escribes.
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

export function isMoreRoute(current: string): boolean {
  return current === 'coach' || current === 'ajustes';
}

/** Navegación inferior fija: los destinos menos frecuentes viven en «Más». */
function BottomNav({
  current,
  moreOpen,
  onMore,
}: {
  current: string;
  moreOpen: boolean;
  onMore: () => void;
}) {
  const visibleTabs = TABS.filter((t) => t.key !== 'coach' && t.key !== 'ajustes');
  return (
    <nav class="v2-tabs" aria-label="Navegación principal">
      {visibleTabs.map((t) => (
        <button
          key={t.key}
          type="button"
          class={`chip${t.key === current ? ' on accent' : ''}`}
          title={t.hint}
          aria-current={t.key === current ? 'page' : undefined}
          onClick={() => go(t.key)}
        >
          <Icon name={t.icon} />
          <span>{t.label}</span>
        </button>
      ))}
      <button
        type="button"
        class={`chip${isMoreRoute(current) ? ' on accent' : ''}`}
        title="Más opciones"
        aria-haspopup="dialog"
        aria-expanded={moreOpen}
        aria-current={isMoreRoute(current) ? 'page' : undefined}
        onClick={onMore}
      >
        <Icon name="bars" />
        <span>Más</span>
      </button>
    </nav>
  );
}

function MoreModal({ current, onClose }: { current: string; onClose: () => void }) {
  const destinations = TABS.filter((t) => t.key === 'coach' || t.key === 'ajustes');
  return (
    <Modal title="Más" sub="Coach y configuración" onClose={onClose}>
      <div class="more-destinations">
        {destinations.map((t) => (
          <button
            key={t.key}
            type="button"
            class={`list-item tappable${t.key === current ? ' on accent' : ''}`}
            aria-current={t.key === current ? 'page' : undefined}
            onClick={() => {
              onClose();
              go(t.key);
            }}
          >
            <Icon name={t.icon} />
            <span class="li-main"><span class="li-title">{t.label}</span></span>
            {t.key === current ? <span class="tiny muted">Actual</span> : null}
          </button>
        ))}
      </div>
    </Modal>
  );
}

/**
 * Subtítulo de pestaña.
 *
 * Solo lo pintan aquí las pestañas que no lo llevan ya DENTRO de su vista: Hoy
 * sale con el saludo (`HoyView`), Progreso con `ProgressCard` y Coach con su
 * tarjeta de conexión. El de Calendario depende del cursor, que vive en
 * `CalendarView`, así que lo pinta esa vista. `App.test.ts` vigila ese reparto.
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

/**
 * La tarjeta completa de sesión solo vive en Entrenar y Hoy; en el resto de
 * pestañas manda la sección y, si hay sesión o descanso, queda la barra compacta
 * de abajo. En Hoy sin nada no se pinta el placeholder: el hero ya dice por dónde
 * empezar. `App.test.ts` fija este reparto.
 */
export function sessionDockMode(
  tab: string,
  hasSession: boolean,
  resting: boolean,
): { showSession: boolean; floatingDock: boolean } {
  const running = hasSession || resting;
  const showSession = tab === 'hoy' && running;
  return { showSession, floatingDock: !showSession && running };
}

/** El contenido de la pestaña activa. */
function CurrentView({ tab }: { tab: Tab }) {
  switch (tab.key) {
    case 'hoy':
      return <HoyView />;
    case 'ajustes':
      return <SettingsView sub={route.value.sub} />;
    case 'progreso':
      /* contrato con I7: montaje único de la pestaña (ProgressCard + charts +
         historial) en su propio componente */
      return <ProgressView />;
    case 'rutinas':
      return <RoutinesView />;
    case 'calendario':
      return <CalendarView />;
    case 'coach':
      return <CoachView />;
    default:
      /* todas las pestañas de `TABS` tienen su vista */
      return null;
  }
}

export function App() {
  const s = settings.value;
  const bar = useRef<HTMLElement | null>(null);
  const current = TABS.find((t) => t.key === route.value.tab) ?? TABS[0];
  const sub = tabSub(current.key);
  const streak = totals(sessions.value).streak;
  const session = active.value;
  const focusedWorkout = Boolean(session && s.simpleWorkoutMode && current.key === 'hoy');
  const prog = session ? sessionProgress(session) : null;
  const { showSession, floatingDock } = sessionDockMode(
    current.key,
    Boolean(session),
    rest.value.running,
  );

  useEffect(() => applyTheme(s.theme, s.accent), [s.theme, s.accent]);
  useEffect(() => setMoreOpen(false), [route.value.tab, route.value.sub]);

  /* Onboarding de primera vez (spec `onboarding.md`, hueco 1): 350 ms después de
     arrancar y solo si sigue sin verse. No se abre
     con una sesión o un descanso en marcha: taparía el entreno (caso e). El
     cierre lo detecta la signal `meta` (el modal la escribe al cerrarse). */
  const [boarding, setBoarding] = useState(false);
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const profile = activeProfile.value;
  useEffect(() => {
    if (meta.value.onboarded === true || demoMode.value) return;
    const timer = setTimeout(() => {
      if (meta.value.onboarded === true || demoMode.value || active.value || rest.value.running) return;
      setBoarding(true);
    }, 350);
    return () => clearTimeout(timer);
  }, [demoMode.value]);

  /* Escucha `hashchange`: cualquier cambio de pestaña actualiza `route` y, con ella,
     la vista (el signal repinta solo). */
  useEffect(() => startRouter(), []);

  /* Al cambiar de pestaña, la nueva sección empieza arriba. Si no, se heredaba
     el scroll de la anterior y parecía que la pantalla no había cambiado. */
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [current.key]);

  /* El bucle de 500 ms: cuenta atrás, tics y aviso de fin de descanso. */
  useEffect(() => startLoop(), []);

  /* Sincronización automática (si hay un código vinculado): al arrancar, al
     volver a la pestaña, al recuperar la red y 8 s después de cada cambio. */
  useEffect(() => startSyncAuto(), []);

  /* El recuadro de descanso es pegajoso bajo la barra superior, así que la barra
     publica su altura en `--appbar-h`. */
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
    <div class={`v2-shell${focusedWorkout ? ' simple-workout-shell' : ''}`}>
      <header class="v2-bar" ref={bar}>
        <div class="v2-brand">
          <b>Pulso</b>
          <button
            type="button"
            class="chip v2-streak"
            title="Racha de entrenamiento"
            onClick={() => go('progreso')}
          >
            <Icon name="fire" />
            <span>{streak}</span>
          </button>
          {profile ? (
            <button
              type="button"
              class="chip pf-chip"
              title={`Perfil: ${profile.name}`}
              aria-label={`Cambiar de perfil (${profile.name})`}
              aria-haspopup="dialog"
              onClick={() => setProfilesOpen(true)}
            >
              <span class="pf-avatar" style={`background:${profile.color}`} aria-hidden="true">
                {profileInitial(profile.name)}
              </span>
              <span class="pf-name">{profile.name}</span>
              <Icon name="chev-d" />
            </button>
          ) : null}
          <SessionClock />
          <button
            type="button"
            class="chip"
            title="Guía de la app"
            aria-label="Guía de la app"
            aria-haspopup="dialog"
            onClick={() => openHelp('guide')}
          >
            <Icon name="info" />
          </button>
        </div>
      </header>

      <main class="v2-main">
        {!focusedWorkout && sub ? <div class="v2-sub">{sub}</div> : null}

        {!storageAvailable ? (
          <div class="card tight">
            <div class="tiny warn">
              localStorage está bloqueado: los ajustes no se guardan entre recargas.
            </div>
          </div>
        ) : null}

        {showSession ? <SessionCard /> : null}

        {!focusedWorkout ? <CurrentView tab={current} /> : null}

        {floatingDock ? (
          rest.value.running ? (
            <RestDock show />
          ) : session && prog ? (
            <SessionDock
              show
              name={session.name}
              done={prog.done}
              total={prog.total}
              volume={prog.volume}
              pct={prog.pct}
            />
          ) : null
        ) : null}
      </main>

      {!focusedWorkout ? (
        <BottomNav
          current={current.key}
          moreOpen={moreOpen}
          onMore={() => setMoreOpen(true)}
        />
      ) : null}

      {moreOpen ? <MoreModal current={current.key} onClose={() => setMoreOpen(false)} /> : null}

      <FinishedSheet />

      {profilesOpen ? (
        <ProfileSheet
          onClose={() => setProfilesOpen(false)}
          onManage={() => {
            setProfilesOpen(false);
            go('ajustes', 'perfil');
          }}
        />
      ) : null}

      {/* Overlay global de primera visita: se desmonta en cuanto la signal
          `meta.onboarded` pasa a true (los dos botones del modal lo marcan). */}
      {boarding && meta.value.onboarded !== true && !demoMode.value ? <Onboarding /> : null}
    </div>
  );
}
