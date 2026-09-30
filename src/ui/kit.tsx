/**
 * Piezas de UI reutilizables (filas de ajustes, KPIs, avisos).
 *
 * En la v1 esto eran funciones que devolvían HTML con `data-act` y un manejador
 * global que volvía a leer el DOM. Aquí cada fila es un componente con su
 * `onChange`, así que el valor que se guarda es el que el usuario acaba de tocar
 * (no hay `getAttribute` de por medio, que era la fuente de la mitad de los bugs).
 */
import type { ComponentChildren } from 'preact';

import { Icon } from './Icon';

interface RowProps {
  label: string;
  hint?: string;
}

/** Fila con interruptor. */
export function SwitchRow({
  label,
  hint,
  value,
  onChange,
}: RowProps & {
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label class="switch list-item" style="justify-content:space-between">
      <div class="li-main">
        <div class="li-title">{label}</div>
        {hint ? <div class="li-sub">{hint}</div> : null}
      </div>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span class="track">
        <span class="thumb" />
      </span>
    </label>
  );
}

/** Fila con número (`step`, `min` y `max` como en la v1). */
export function NumRow({
  label,
  hint,
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
    </div>
  );
}

/** Campo de texto libre. */
export function TextRow({
  label,
  hint,
  value,
  placeholder,
  onChange,
}: RowProps & { value: string; placeholder?: string; onChange: (next: string) => void }) {
  return (
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
}

export interface Option {
  value: string;
  label: string;
}

/** Desplegable. Los valores siempre viajan como texto (igual que en la v1). */
export function SelectRow({
  label,
  hint,
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
    return (
      <label class="field list-item" style="display:block">
        <span class="label">{label}</span>
        {select}
        {hint ? <span class="sub">{hint}</span> : null}
      </label>
    );
  }
  return (
    <label class="field">
      <span class="label">{label}</span>
      {select}
      {hint ? <span class="sub">{hint}</span> : null}
    </label>
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
}: {
  label: string;
  value: ComponentChildren;
  unit?: string;
  delta?: ComponentChildren;
}) {
  return (
    <div class="kpi">
      <div class="kpi-label">{label}</div>
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
  onClick,
}: {
  icon: string;
  title: string;
  sub?: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button class="list-item tappable" type="button" onClick={onClick}>
      <Icon name={icon} />
      <span class="li-main">
        <span class={`li-title${danger ? ' danger' : ''}`}>{title}</span>
        {sub ? <span class="li-sub">{sub}</span> : null}
      </span>
      <Icon name="chev-r" />
    </button>
  );
}

/** Título de sección con su contador a la derecha. */
export function SectionHead({ title, right }: { title: string; right?: ComponentChildren }) {
  return (
    <div class="sec-head">
      <span class="h3">{title}</span>
      {right ? <span class="tiny muted">{right}</span> : null}
    </div>
  );
}
