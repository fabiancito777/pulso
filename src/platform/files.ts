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
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
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
    });
    /* si el usuario cierra el diálogo sin elegir, en algunos navegadores no hay evento:
       el input queda huérfano hasta el siguiente intento, que lo reemplaza */
    document.body.appendChild(input);
    input.click();
  });
}
