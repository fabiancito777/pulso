/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

/* Versión de `package.json` inyectada en el bundle como `__APP_VERSION__`
   (la lee `SettingsView` para «Acerca de»). `resolveJsonModule` no está activo,
   así que en vez de importar el JSON se lee con `node:fs`. */
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version?: string;
};

export default defineConfig({
  plugins: [preact()],
  /* rutas relativas: el build también funciona abriendo dist/index.html o desde un subdirectorio */
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version ?? '2.0'),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
