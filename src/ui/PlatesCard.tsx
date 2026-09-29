/**
 * La calculadora de discos como tarjeta reutilizable.
 *
 * Estaba dentro de `App.tsx` (v2 solo la enseñaba en la pestaña Entrenar); la
 * pestaña Hoy la muestra también, así que sale a su propio módulo. El `TOOL_MODE_KEY`
 * recuerda el modo por herramienta (barra/mancuerna…) igual que en la v1, donde
 * cada sitio donde vivía la calculadora tenía su llave.
 */
import { useState } from 'preact/hooks';

import type { PlateModeKey } from '@/domain/types';
import { Plates } from '@/ui/Plates';
import { rememberPlateMode, settings, TOOL_MODE_KEY } from '@/state/store';

export function PlatesCard() {
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
