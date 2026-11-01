/**
 * Cifrado del blob de sincronización, con Web Crypto y sin dependencias.
 *
 * El servidor solo ve un `id` (el hash del código) y un texto cifrado: ni tus
 * sesiones, ni tu nombre, ni el nombre de tus rutinas. La clave sale del código
 * de pareja, que **nunca se envía**: se queda en los dispositivos.
 *
 * Formato del sobre (`Sealed`): `{ v, iv, data }`, con `iv` y `data` en base64.
 * El `iv` es aleatorio en cada cifrado (AES-GCM no admite reutilizarlo), así que
 * dos subidas del mismo estado producen textos distintos.
 *
 * Nota sobre la sal de PBKDF2: es fija (`pulso-sync-v1`) a propósito. La
 * contraseña no es una frase elegida por el usuario, es un código aleatorio de 80
 * bits, así que el ataque de diccionario no aplica; una sal fija evita tener que
 * guardar y transportar una sal por blob.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // base32 sin I, L, O, U
const CODE_GROUPS = 4;
const GROUP_LEN = 4;
const CODE_LEN = CODE_GROUPS * GROUP_LEN;
const PREFIX = 'PULSO';
const KDF_SALT = 'pulso-sync-v1';
/** Iteraciones de PBKDF2. Alto a propósito: se deriva una vez por sesión. */
export const KDF_ITERATIONS = 210_000;

export interface Sealed {
  v: 1;
  /** vector de inicialización en base64 */
  iv: string;
  /** texto cifrado en base64 */
  data: string;
}

function base32(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/* devuelve `Uint8Array<ArrayBuffer>` (y no `<ArrayBufferLike>`) porque
   `crypto.subtle.decrypt` exige un buffer que no sea compartido */
function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function hex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return [...view].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Código de pareja nuevo: `PULSO-7F3K-QP9M-2XAB-4TDZ`.
 *
 * 16 caracteres base32 = 80 bits de entropía sacados de `crypto.getRandomValues`.
 * Se agrupa para poderlo dictar por teléfono, y el alfabeto no tiene caracteres
 * que se confundan al leerlo (I/L, O/0).
 */
export function generateSyncCode(): string {
  const bytes = new Uint8Array(CODE_LEN);
  crypto.getRandomValues(bytes);
  const chars = base32(bytes).split('');
  const groups: string[] = [];
  for (let i = 0; i < CODE_GROUPS; i++) {
    groups.push(chars.slice(i * GROUP_LEN, (i + 1) * GROUP_LEN).join(''));
  }
  return `${PREFIX}-${groups.join('-')}`;
}

/**
 * Normaliza lo que teclea el usuario: mayúsculas, sin espacios ni guiones, sin
 * el prefijo `PULSO-` y corrigiendo las confusiones típicas (O→0, I/L→1).
 * Devuelve `null` si no queda un código válido.
 */
export function normalizeSyncCode(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/^PULSO/, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');
  if (cleaned.length !== CODE_LEN) return null;
  for (const char of cleaned) {
    if (!ALPHABET.includes(char)) return null;
  }
  const groups = cleaned.match(new RegExp(`.{${GROUP_LEN}}`, 'g')) ?? [];
  return `${PREFIX}-${groups.join('-')}`;
}

/** Los 16 caracteres del código (lo que se cifra y se hashea). */
export function codeBody(code: string): string {
  return code.replace(/[^0-9A-Z]/g, '').replace(/^PULSO/, '');
}

/**
 * Id del blob: SHA-256 del código. Es lo único que conoce el servidor, y no
 * permite recuperar el código (80 bits aleatorios no se invierten por fuerza
 * bruta razonable).
 */
export async function syncBlobId(code: string): Promise<string> {
  const data = new TextEncoder().encode(`${KDF_SALT}:${codeBody(code)}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return hex(digest);
}

const keyCache = new Map<string, Promise<CryptoKey>>();

/** Clave AES-GCM derivada del código (cacheada por sesión: PBKDF2 tarda). */
export function deriveSyncKey(code: string, iterations = KDF_ITERATIONS): Promise<CryptoKey> {
  const cacheKey = `${iterations}:${codeBody(code)}`;
  const cached = keyCache.get(cacheKey);
  if (cached) return cached;
  const promise = (async () => {
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(codeBody(code)),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: new TextEncoder().encode(KDF_SALT),
        iterations,
        hash: 'SHA-256',
      },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  })();
  keyCache.set(cacheKey, promise);
  return promise;
}

/** Cifra un valor JSON y devuelve el sobre listo para subir. */
export async function sealJson(key: CryptoKey, value: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return { v: 1, iv: toBase64(iv), data: toBase64(new Uint8Array(cipher)) };
}

/** Descifra el sobre. Lanza si el código no es el correcto o el blob está roto. */
export async function openJson<T>(key: CryptoKey, sealed: Sealed): Promise<T> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(sealed.iv) },
    key,
    fromBase64(sealed.data),
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

/** Solo para tests: vacía la caché de claves derivadas. */
export function resetKeyCache(): void {
  keyCache.clear();
}
