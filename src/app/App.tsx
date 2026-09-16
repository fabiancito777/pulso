/**
 * Shell de la v2. Todavía no es la app entera: es el punto de montaje donde van
 * entrando las pantallas portadas, con la calculadora de discos funcionando de
 * verdad contra los ajustes guardados (los mismos que usa la v1).
 */
import { useEffect, useState } from 'preact/hooks';

import { ROADMAP, type PortState } from '@/app/roadmap';
import type { PlateModeKey, Theme } from '@/domain/types';
import { rememberPlateMode, settings, storageAvailable, TOOL_MODE_KEY } from '@/state/store';
import { Plates } from '@/ui/Plates';

const TABS = ['Hoy', 'Entrenar', 'Rutinas', 'Calendario', 'Coach', 'Progreso', 'Ajustes'] as const;

const STATE_LABEL: Record<PortState, string> = {
  portado: 'portado',
  'en curso': 'en curso',
  pendiente: 'pendiente',
};

function applyTheme(theme: Theme, accent: string) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.setProperty('--accent', accent);
}

export function App() {
  const s = settings.value;
  const [applied, setApplied] = useState<string | null>(null);

  useEffect(() => {
    applyTheme(s.theme, s.accent);
  }, [s.theme, s.accent]);

  const mode = s.plateModes[TOOL_MODE_KEY] ?? 'bar';

  return (
    <div class="v2-shell">
      <header class="v2-bar">
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

        <section class="card tight">
          <div class="tiny muted">
            La v1 completa (HTML + JS vanilla) sigue congelada en <code>legacy/</code> y es la app que
            corre en la rama <code>main</code>. Aquí se porta bloque a bloque.
          </div>
        </section>
      </main>

      <nav class="v2-tabs">
        {TABS.map((t) => (
          <button key={t} type="button" class="chip" disabled title="Se porta más adelante">
            {t}
          </button>
        ))}
      </nav>
    </div>
  );
}
