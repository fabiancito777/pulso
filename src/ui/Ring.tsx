/**
 * Anillo de progreso del descanso. Misma geometría que `U.ring` de la v1: radio
 * `(size - grosor)/2` y un `stroke-dashoffset` que va de la circunferencia entera
 * (nada) a 0 (anillo completo). En la v1 esto se repintaba a mano con
 * `U.ringUpdate`; aquí basta con volver a renderizar el componente.
 */
export interface RingProps {
  /** 1 = recién arrancado, 0 = terminado */
  frac: number;
  size?: number;
  /** grosor del trazo: tiene que cuadrar con el radio */
  width?: number;
  /** terminado: el CSS lo pinta en verde */
  over?: boolean;
  class?: string;
}

export function Ring({ frac, size = 96, width = 6.5, over = false, class: cls }: RingProps) {
  const r = (size - width) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.min(1, Math.max(0, frac));
  const center = size / 2;
  return (
    <svg
      class={[cls ?? 'rest-ring', over ? 'over' : ''].filter(Boolean).join(' ')}
      viewBox={`0 0 ${size} ${size}`}
    >
      <circle class="bg" cx={center} cy={center} r={r} />
      <circle
        class="fg"
        cx={center}
        cy={center}
        r={r}
        stroke-dasharray={circumference.toFixed(2)}
        stroke-dashoffset={(circumference * (1 - clamped)).toFixed(2)}
        transform={`rotate(-90 ${center} ${center})`}
      />
    </svg>
  );
}
