/**
 * Descargar y leer archivos (exportar/importar copia de seguridad).
 * Es la parte con DOM de `U.download`/`U.readFile` de la v1, separada del dominio
 * para que el store siga siendo probable en Node.
 */

/** Descarga un objeto como JSON con la fecha en el nombre. */
export function downloadJSON(data: unknown, name = 'pulso'): void {
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  /* se libera en el siguiente tick: si se revoca antes, Safari cancela la descarga */
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Abre el selector de archivos y devuelve su texto (o `null` si se cancela). */
export function pickTextFile(accept = 'application/json,.json'): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';

    let detached = false;

    /* Único cierre del nodo: sin él, cancelar el diálogo dejaba el `<input>`
       huérfano en el DOM y la promesa colgada (el `change` era el único camino). */
    const detach = (): void => {
      if (detached) return;
      detached = true;
      input.removeEventListener('cancel', onCancel);
      input.removeEventListener('change', onChange);
      input.remove();
    };

    /* El usuario cierra el diálogo sin elegir (Chrome/Firefox emiten `cancel`). */
    const onCancel = (): void => {
      detach();
      resolve(null);
    };

    const onChange = (): void => {
      const file = input.files?.[0];
      detach();
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        /* `readAsText` siempre da string; el guard evita stringificar un ArrayBuffer */
        const result = reader.result;
        resolve(typeof result === 'string' ? result : '');
      });
      reader.addEventListener('error', () => resolve(null));
      reader.readAsText(file);
    };

    input.addEventListener('cancel', onCancel);
    input.addEventListener('change', onChange);
    document.body.appendChild(input);
    input.click();
  });
}
