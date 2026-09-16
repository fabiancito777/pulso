/**
 * Shell de la v2. Todavía no es la app entera: es el punto de montaje donde van
 * entrando las pantallas portadas, con la calculadora de discos funcionando de
 * verdad contra los ajustes guardados (los mismos que usa la v1).
 */
import { useEffect, useState } from 'preact/hooks';

import { ROADMAP, type PortState } from '@/app/roadmap';
import { equipLabel, enabledEquipment, groupLabel, isAvailable } from '@/domain/data';
import { customExercises } from '@/domain/library';
import type { PlateModeKey, Theme } from '@/domain/types';
import {
  equipment,
  exercises,
  rememberPlateMode,
  settings,
  storageAvailable,
  TOOL_MODE_KEY,
} from '@/state/store';
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

        <LibraryCard />

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
