/**
 * Espera del coach: cronómetro, aviso de «va lento» y botón Cancelar.
 *
 * Las llamadas a Gemini pueden tardar minutos con pensamiento alto (las tareas
 * JSON van con historial, inventario y esquema de respuesta). Antes las cuatro
 * vistas que llaman al coach (`CoachView`, `HoyView`, `RoutinesView`,
 * `CalendarView`) tenían un `loading` binario: un «Pensando…» inmóvil durante
 * tres minutos parece colgado.
 *
 * El aviso de lentitud NO lo decide el cronómetro local: lo dispara el cliente
 * (`onSlow`, al pasar `SLOW_NOTIFY_MS`), así que no aparece cuando el tope de
 * espera es más corto que el umbral (ahí el vencimiento llega antes y no hay
 * nada que avisar).
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

/** Estado de una espera del coach, con lo que necesitan las vistas. */
export interface CoachWait {
  /** true mientras la llamada está en curso */
  running: boolean;
  /** segundos completos desde `start()` (el «12 s» del aviso) */
  seconds: number;
  /** el cliente avisó de que está tardando más de lo normal */
  slow: boolean;
  /** true si el usuario pulsó Cancelar (la llamada rechaza por aborto) */
  cancelled: () => boolean;
  /** arranca una espera y devuelve su `AbortSignal` (para `runCoachTask`) */
  start: () => AbortSignal;
  /** la llamada terminó: bien, mal o cancelada */
  end: () => void;
  /** `opts.onSlow`: avisa de que va lenta sin cortar nada */
  markSlow: () => void;
  /** aborta la llamada en curso */
  cancel: () => void;
}

export function useCoachWait(): CoachWait {
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [slow, setSlow] = useState(false);
  /* En un ref y no en estado: el `catch` del `await` lee la marca con la
     clausura de ANTES de cancelar, cuando el estado aún valía `false`. */
  const wasCancelled = useRef(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const start = useCallback((): AbortSignal => {
    const ctrl = new AbortController();
    controller.current = ctrl;
    wasCancelled.current = false;
    setSeconds(0);
    setSlow(false);
    setRunning(true);
    return ctrl.signal;
  }, []);

  const end = useCallback((): void => {
    controller.current = null;
    setRunning(false);
  }, []);

  const markSlow = useCallback((): void => setSlow(true), []);

  const cancel = useCallback((): void => {
    wasCancelled.current = true;
    controller.current?.abort();
  }, []);

  return {
    running,
    seconds,
    slow,
    cancelled: () => wasCancelled.current,
    start,
    end,
    markSlow,
    cancel,
  };
}

/**
 * Lo que se enseña mientras se espera: los segundos que lleva y, si el cliente
 * avisó de lentitud, el texto completo con «Cancelar». `null` si no hay nada
 * que contar todavía.
 */
export function WaitMeta({ wait }: { wait: CoachWait }) {
  if (!wait.running) return null;
  if (!wait.slow) {
    return wait.seconds > 0 ? <span class="tiny muted"> · {wait.seconds} s</span> : null;
  }
  return (
    <span class="row" style="gap:6px;align-items:center">
      <span class="tiny warn">Tardando más de lo normal ({wait.seconds} s)</span>
      <button type="button" class="btn sm ghost" onClick={wait.cancel}>
        Cancelar
      </button>
    </span>
  );
}
