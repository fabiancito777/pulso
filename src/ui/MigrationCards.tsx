/**
 * Las tarjetas de "migración" que convivían en `App.tsx`: la biblioteca/material,
 * el roadmap de la migración y la nota sobre `legacy/`.
 *
 * Siguen siendo útiles para ver POR QUÉ la app no está al 100 %, pero ya no
 * encabezan ninguna pestaña: en Hoy cuelgan de un `<details>` al final (spec
 * `hoy.md`, decisión 8), y en el `default` del shell son el aviso de que algo
 * no cuadra con las pestañas.
 */
import { ROADMAP, type PortState } from '@/app/roadmap';
import { equipLabel, enabledEquipment, groupLabel, isAvailable } from '@/domain/data';
import { customExercises } from '@/domain/library';
import { equipment, exercises } from '@/state/store';

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

/**
 * Todo junto, colgado de un `<details>`: se ve cuando alguien lo abre, sin
 * robarle el primer pantallazo a la pestaña.
 */
export function MigrationCards({ open = false }: { open?: boolean } = {}) {
  return (
    <details class="card tight" open={open}>
      <summary class="h3" style="cursor:pointer">
        Migración y catálogo
      </summary>
      <div class="col mt-s" style="gap:14px">
        <LibraryCard />
        <RoadmapCard />
        <section class="card tight">
          <div class="tiny muted">
            La v1 completa (HTML + JS vanilla) sigue congelada en <code>legacy/</code> y es la app
            que corre en la rama <code>main</code>. Aquí se porta bloque a bloque.
          </div>
        </section>
      </div>
    </details>
  );
}
