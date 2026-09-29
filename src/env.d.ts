/**
 * Constantes de entorno que inyecta Vite (`define` en `vite.config.ts`).
 *
 * `__APP_VERSION__` es la `version` de `package.json`, sustituida en tiempo de
 * build. El `typeof` de `SettingsView` es la red de seguridad: en tests (node)
 * o en cualquier sitio donde el `define` no se aplique, el identificador no
 * existe y se cae al fallback `'2.0'` sin lanzar (el `typeof` de una variable
 * no declarada no es un error).
 */
declare const __APP_VERSION__: string;
