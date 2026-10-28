/**
 * Shell de la app: barra superior, **vista por pestaña** (rutas por hash, `router.ts`)
 * y la barra de abajo. Cada pestaña monta su vista.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

import { go, route, startRouter, TABS, type Tab } from '@/app/router';
import { totals } from '@/domain/analytics';
import { TEMPLATES } from '@/domain/data';
import { fmtClock } from '@/domain/format';
import { progress as sessionProgress } from '@/domain/session';
import { applyTheme } from '@/platform/theme';
import { active, rest, sessionSeconds, startLoop } from '@/state/session';
import { activeProfile, profileInitial } from '@/state/profiles';
import { meta, routines, sessions, settings, storageAvailable } from '@/state/store';
import { CalendarView } from '@/ui/CalendarView';
import { CoachView } from '@/ui/CoachView';
import { HoyView } from '@/ui/HoyView';
import { openHelp } from '@/ui/HelpModal';
import { Icon } from '@/ui/Icon';
import { Onboarding } from '@/ui/Onboarding';
import { ProfileSheet } from '@/ui/ProfileSheet';
import { ProgressView } from '@/ui/ProgressView';
import { RoutinesView } from '@/ui/RoutinesView';
import { RestDock, SessionCard, SessionDock } from '@/ui/SessionCard';
import { SettingsView } from '@/ui/SettingsView';

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

/**
 * Barra de navegación inferior. En móvil el carril de 7 chips NO cabe (≈660 px
 * para 390), así que se desliza en horizontal: aquí se centra la pestaña activa
 * al cambiar de vista y se difuminan los bordes que tienen contenido fuera, para
 * que se lea como «desliza» y no como un chip cortado (mismo recurso que el
 * carril de acciones del Coach).
 */
function BottomNav({ current }: { current: string }) {
  const nav = useRef<HTMLElement | null>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  /*
   * Todo en UN efecto porque las dos cosas van juntas: al cambiar de pestaña hay
   * que CENTRAR la activa y, acto seguido, medir los bordes con la posición ya
   * aplicada. Separarlos en dos efectos hacía que el `scroll` del centrado no
   * llegara a tiempo y el degradado saliera desfasado un tick.
   */
  useEffect(() => {
    const el = nav.current;
    if (!el) return;
    const measure = (): void => {
      const start = el.scrollLeft > 4;
      const end = el.scrollWidth - el.clientWidth - el.scrollLeft > 4;
      /* solo cambia si de verdad cambió: un objeto nuevo por cada tick de scroll
         dispararía un repintado de más */
      setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    };

    const chip = el.querySelector<HTMLElement>('.chip.on');
    if (chip) {
      /* Centra la activa: en una barra de 7 chips puede quedar fuera (Progreso,
         Ajustes). Instantáneo a propósito: con `smooth` el carril se queda a
         medias al encadenar pestañas. Se calcula el scrollLeft a mano en vez de
         `scrollIntoView` para no arrastrar la página. */
      el.scrollTo({
        left: chip.offsetLeft - (el.clientWidth - chip.clientWidth) / 2,
        behavior: 'auto',
      });
    }
    measure();

    el.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [current]);

  return (
    <nav
      class={`v2-tabs${edges.start ? ' has-start' : ''}${edges.end ? ' has-end' : ''}`}
      aria-label="Navegación principal"
      ref={nav}
    >
      {TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          class={`chip${t.key === current ? ' on accent' : ''}`}
          title={t.hint}
          aria-current={t.key === current ? 'page' : undefined}
          onClick={() => go(t.key)}
        >
          <Icon name={t.icon} />
          {t.label}
        </button>
      ))}
    </nav>
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
  const showSession = tab === 'entrenar' || (tab === 'hoy' && running);
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
    case 'entrenar':
      /* La calculadora de discos ya no vive fija aquí: es el botón «discos» de
         cada ejercicio dentro de la sesión, así solo aparece entrenando y abre
         con el peso que tiene ese ejercicio. */
      return null;
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
  const prog = session ? sessionProgress(session) : null;
  const { showSession, floatingDock } = sessionDockMode(
    current.key,
    Boolean(session),
    rest.value.running,
  );

  useEffect(() => applyTheme(s.theme, s.accent), [s.theme, s.accent]);

  /* Onboarding de primera vez (spec `onboarding.md`, hueco 1): 350 ms después de
     arrancar y solo si sigue sin verse. No se abre
     con una sesión o un descanso en marcha: taparía el entreno (caso e). El
     cierre lo detecta la signal `meta` (el modal la escribe al cerrarse). */
  const [boarding, setBoarding] = useState(false);
  const [profilesOpen, setProfilesOpen] = useState(false);
  const profile = activeProfile.value;
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

  /* Al cambiar de pestaña, la nueva sección empieza arriba. Si no, se heredaba
     el scroll de la anterior y parecía que la pantalla no había cambiado. */
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [current.key]);

  /* El bucle de 500 ms: cuenta atrás, tics y aviso de fin de descanso. */
  useEffect(() => startLoop(), []);

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
    <div class="v2-shell">
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

      <BottomNav current={current.key} />

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
      {boarding && meta.value.onboarded !== true ? <Onboarding /> : null}
    </div>
  );
}
