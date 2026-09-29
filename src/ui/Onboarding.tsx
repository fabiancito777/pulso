/**
 * Onboarding de primera vez (el `onboarding()` de `legacy/js/app.js:204`).
 *
 * Modal **no descartable**: ni ESC, ni clic fuera, ni la X cierran — las dos
 * salidas son los botones del pie («Configurar después» y «Empezar»), y las dos
 * marcan `meta.onboarded` vía `applyOnboarding`, así que el modal no vuelve a
 * aparecer en recargas sucesivas.
 *
 * Los campos viven en `useState` (no en signals): son locales a este modal y no
 * deben repintar nada fuera de él. La lógica de guardado está en
 * `state/onboarding.ts`, probada sin DOM.
 */
import { useState } from 'preact/hooks';

import { GOALS } from '@/domain/data';
import { applyOnboarding, type OnboardingValues } from '@/state/onboarding';
import { Modal } from '@/ui/Modal';
import { TextRow } from '@/ui/kit';
import { toast } from '@/ui/toast';

import '../styles/onboarding.css';

/** Material: los mismos 4 presets de la v1 (`app.js:217`). */
const EQUIP_OPTIONS = [
  { key: 'basico', label: 'Mancuernas + banco' },
  { key: 'gym', label: 'Gimnasio completo' },
  { key: 'todo', label: 'Todo el catálogo' },
  { key: 'ninguno', label: 'Solo peso corporal' },
] as const;

const DAYS = ['2', '3', '4', '5', '6'];

export function Onboarding() {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('hipertrofia');
  const [days, setDays] = useState('4');
  const [units, setUnits] = useState('kg');
  const [equip, setEquip] = useState<string>('basico');

  /* Los dos caminos marcan `onboarded`; con datos se guardan los ajustes y el
     material, y se avisa (la v1 decía «desde Plan», aquí la pestaña es
     Calendario). El nombre se usa solo para el saludo y el primer nombre es el
     que ya usaba el toast de la v1. */
  const finish = (values: OnboardingValues | null): void => {
    applyOnboarding(values);
    if (!values) return;
    const first = values.name.trim().split(/\s+/)[0] ?? '';
    toast(`¡Listo${first ? `, ${first}` : ''}! Genera tu primera semana en Calendario`, {
      kind: 'ok',
      ms: 5000,
    });
  };

  return (
    <Modal
      title="Bienvenido a Pulso"
      dismissable={false}
      onClose={() => finish(null)}
      foot={
        <>
          <button type="button" class="btn ghost" onClick={() => finish(null)}>
            Configurar después
          </button>
          <button
            type="button"
            class="btn primary"
            onClick={() => finish({ name, goal, days: Number(days), units, equip })}
          >
            Empezar
          </button>
        </>
      }
    >
      <div class="tiny muted mb-s">Tu entrenamiento, sin ruido</div>
      <p class="sub">Tres datos y empezamos. Podrás cambiarlo todo desde Ajustes.</p>
      <div class="col mt" style="gap:11px">
        <TextRow label="¿Cómo te llamas?" value={name} placeholder="Tu nombre" onChange={setName} />
        <label class="field">
          <span class="label">Objetivo principal</span>
          <select class="select" value={goal} onChange={(e) => setGoal(e.currentTarget.value)}>
            {GOALS.map((g) => (
              <option key={g.key} value={g.key}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <div class="grid c2">
          <label class="field">
            <span class="label">Días/semana</span>
            <select class="select" value={days} onChange={(e) => setDays(e.currentTarget.value)}>
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label class="field">
            <span class="label">Unidades</span>
            <select class="select" value={units} onChange={(e) => setUnits(e.currentTarget.value)}>
              <option value="kg">Kilogramos</option>
              <option value="lb">Libras</option>
            </select>
          </label>
        </div>
        <div class="field">
          <span class="label">¿Con qué material cuentas?</span>
          <div class="ob-pills">
            {EQUIP_OPTIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                class={`toggle-pill${equip === o.key ? ' on' : ''}`}
                aria-pressed={equip === o.key}
                onClick={() => setEquip(o.key)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div class="card tight mt">
        <div class="tiny muted">
          Todo se guarda en tu dispositivo. El coach AI es opcional: puedes activarlo después con tu
          propia API key de Gemini.
        </div>
      </div>
    </Modal>
  );
}
