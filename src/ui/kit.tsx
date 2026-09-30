/**
 * Piezas de UI reutilizables (filas de ajustes, KPIs, avisos).
 *
 * En la v1 esto eran funciones que devolvían HTML con `data-act` y un manejador
 * global que volvía a leer el DOM. Aquí cada fila es un componente con su
 * `onChange`, así que el valor que se guarda es el que el usuario acaba de tocar
 * (no hay `getAttribute` de por medio, que era la fuente de la mitad de los bugs).
 */
import type { ComponentChildren } from 'preact';

import type { HelpId } from './help-content';
import { HelpBtn } from './HelpModal';
import { Icon } from './Icon';

interface RowProps {
  label: string;
  hint?: string;
  /** Explicación larga: añade el ⓘ final, que abre el modal de ayuda (spec `help-ux.md`). */
  help?: HelpId;
}

/** Fila con interruptor. */
export function SwitchRow({
  label,
  hint,
  help,
  value,
  onChange,
}: RowProps & {
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const inner = (
    <>
      <div class="li-main">
        <div class="li-title">{label}</div>
        {hint ? <div class="li-sub">{hint}</div> : null}
      </div>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span class="track">
        <span class="thumb" />
      </span>
    </>
  );
  /* Sin ayuda el marcado es el de siempre (raíz = `<label class="switch">`);
     con ayuda, la raíz pasa a ser un `div` para que el ⓘ NO quede dentro del
     label (spec §3.3, «regla dura»). */
  if (!help) {
    return (
      <label class="switch list-item" style="justify-content:space-between">
        {inner}
      </label>
    );
  }
  return (
    <div class="list-item help-row">
      <label class="switch" style="flex:1;min-width:0">
        {inner}
      </label>
      <HelpBtn id={help} title={label} />
    </div>
  );
}

/** Fila con número (`step`, `min` y `max` como en la v1). */
export function NumRow({
  label,
  hint,
  help,
  value,
  step = 1,
  min = 0,
  max,
  suffix,
  onChange,
}: RowProps & {
  value: number;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  onChange: (next: number) => void;
}) {
  return (
    <div class="list-item">
      <div class="li-main">
        <div class="li-title">{label}</div>
        {hint ? <div class="li-sub">{hint}</div> : null}
      </div>
      <input
        class="input num"
        style="width:96px"
        type="number"
        value={String(value)}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const raw = Number(e.currentTarget.value);
          onChange(Number.isFinite(raw) ? raw : min);
        }}
      />
      {suffix ? <span class="tiny muted">{suffix}</span> : null}
      {help ? <HelpBtn id={help} title={label} /> : null}
    </div>
  );
}

/** Campo de texto libre. */
export function TextRow({
  label,
  hint,
  help,
  value,
  placeholder,
  onChange,
}: RowProps & { value: string; placeholder?: string; onChange: (next: string) => void }) {
  const field = (
    <label class="field">
      <span class="label">{label}</span>
      <input
        class="input"
        value={value}
        placeholder={placeholder ?? ''}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
      {hint ? <span class="sub">{hint}</span> : null}
    </label>
  );
  /* El envolvente `.help-field` es `position:relative`: el ⓘ sale absoluto
     arriba-derecha y no altera el layout del campo (spec §3.3). */
  if (!help) return field;
  return (
    <div class="help-field">
      {field}
      <HelpBtn id={help} title={label} />
    </div>
  );
}

export interface Option {
  value: string;
  label: string;
}

/** Desplegable. Los valores siempre viajan como texto (igual que en la v1). */
export function SelectRow({
  label,
  hint,
  help,
  value,
  options,
  inline,
  onChange,
}: RowProps & {
  value: string;
  options: readonly Option[];
  /** `inline` = dentro de un `list-item` (Ajustes → discos) en vez de un `field` */
  inline?: boolean;
  onChange: (next: string) => void;
}) {
  const select = (
    <select class="select" value={value} onChange={(e) => onChange(e.currentTarget.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
  if (inline) {
    const field = (
      <label class={help ? 'field' : 'field list-item'} style="display:block">
        <span class="label">{label}</span>
        {select}
        {hint ? <span class="sub">{hint}</span> : null}
      </label>
    );
    /* Mismo patrón que `SwitchRow`: con ⓘ, el `<label>` deja de ser la raíz
       (el botón va fuera) y el `.list-item` pasa al envolvente `.help-row`. */
    if (!help) return field;
    return (
      <div class="list-item help-row">
        <div class="grow" style="min-width:0">
          {field}
        </div>
        <HelpBtn id={help} title={label} />
      </div>
    );
  }
  const field = (
    <label class="field">
      <span class="label">{label}</span>
      {select}
      {hint ? <span class="sub">{hint}</span> : null}
    </label>
  );
  if (!help) return field;
  return (
    <div class="help-field">
      {field}
      <HelpBtn id={help} title={label} />
    </div>
  );
}

/** Tarjeta con el icono de información (los avisos de "por qué esto es así"). */
export function InfoCard({ children, ghost }: { children: ComponentChildren; ghost?: boolean }) {
  return (
    <div class={`card ${ghost ? 'ghost ' : 'tight '}mt`}>
      <div class="row">
        <span class="ico muted">
          <Icon name="info" />
        </span>
        <div class="tiny muted grow">{children}</div>
      </div>
    </div>
  );
}

/** Cifra con etiqueta y pie. */
export function Kpi({
  label,
  value,
  unit,
  delta,
  help,
}: {
  label: string;
  value: ComponentChildren;
  unit?: string;
  delta?: ComponentChildren;
  /** Explicación larga del KPI: ⓘ a la derecha de su etiqueta. */
  help?: HelpId;
}) {
  return (
    <div class="kpi">
      <div class={`kpi-label${help ? ' kpi-label-row' : ''}`}>
        {help ? (
          <>
            <span class="ellipsis">{label}</span>
            <HelpBtn id={help} title={label} />
          </>
        ) : (
          label
        )}
      </div>
      <div class="kpi-value">
        {value}
        {unit ? <span class="tiny muted"> {unit}</span> : null}
      </div>
      {delta ? <div class="kpi-delta">{delta}</div> : null}
    </div>
  );
}

/** Botón-fila grande (acciones de la pestaña de Datos, "Empezar sesión"…). */
export function ListButton({
  icon,
  title,
  sub,
  danger,
  help,
  onClick,
}: {
  icon: string;
  title: string;
  sub?: string;
  danger?: boolean;
  /** Explicación larga: añade el ? a la derecha de la fila (spec `help-ux.md`). */
  help?: HelpId;
  onClick: () => void;
}) {
  /* El ? no puede ir dentro del `<button>` (botón anidado), así que con ayuda la
     fila se envuelve en `.help-row` y el botón pasa a ser su primer hijo: por eso
     su separador inferior hay que devolverlo a mano en `help.css`. */
  const row = (
    <button class="list-item tappable" type="button" onClick={onClick}>
      <Icon name={icon} />
      <span class="li-main">
        <span class={`li-title${danger ? ' danger' : ''}`}>{title}</span>
        {sub ? <span class="li-sub">{sub}</span> : null}
      </span>
      <Icon name="chev-r" />
    </button>
  );
  if (!help) return row;
  return (
    <div class="help-row">
      {row}
      <HelpBtn id={help} title={title} />
    </div>
  );
}

/** Título de sección con su contador a la derecha. */
export function SectionHead({
  title,
  right,
  help,
}: {
  title: string;
  right?: ComponentChildren;
  /** Explicación larga de la sección: ⓘ junto al título (spec `help-ux.md` §3.3). */
  help?: HelpId;
}) {
  return (
    <div class="sec-head">
      <span class={help ? 'h3 help-h3' : 'h3'}>
        {title}
        {help ? <HelpBtn id={help} title={title} /> : null}
      </span>
      {right ? <span class="tiny muted">{right}</span> : null}
    </div>
  );
}
