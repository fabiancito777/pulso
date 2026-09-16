#!/usr/bin/env node
/* ==========================================================================
   Pulso · comprobaciones estáticas (sin dependencias)
   --------------------------------------------------------------------------
   No es un linter genérico: comprueba los enganches propios de esta app, que
   son los que se rompen EN SILENCIO (varios ya nos han mordido):

     1. Sintaxis de cada `js/*.js` (equivale a `node --check`).
     2. `index.html`: cada script/stylesheet existe y no se queda ningún
        `js/*.js` sin cargar (un archivo olvidado = código muerto misterioso).
     3. `sw.js`: el SHELL precarga todos los assets de `index.html` y todos
        existen (si falta uno, la app no abre offline).
     4. Ningún `data-act` / `data-act-change` / `data-act-input` estático sin
        handler en `App.actions` (el aviso "acción sin handler" de la consola).
     5. Ningún `U.icon('x')` sin su `ico('x')` en `core.js` (cae a `info` sin
        avisar, así que un typo se ve como un icono raro).
     6. Orden de carga: los módulos de datos/vistas van antes de `app.js`.

     node tools/check.mjs
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const clean = (u) => u.split('?')[0].split('#')[0];

const problems = [];
const infos = [];
const checks = [];

function check(name, fn) {
  const before = problems.length;
  let detail = '';
  try {
    detail = fn() || '';
  } catch (e) {
    problems.push('[' + name + '] excepción: ' + e.message);
  }
  const bad = problems.slice(before);
  checks.push({ name, ok: problems.length === before, detail, bad });
}

const jsDir = path.join(ROOT, 'js');
const jsFiles = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js')).sort();
const allJs = jsFiles.map((f) => 'js/' + f);
const indexHtml = read('index.html');
const swJs = read('sw.js');
const jsSources = allJs.map((f) => ({ file: f, src: read(f) }));
const repoText = indexHtml + '\n' + swJs + '\n' + jsSources.map((s) => s.src).join('\n');

/* ---------- 1 · sintaxis ---------- */
check('sintaxis', () => {
  jsFiles.forEach((f) => {
    const r = spawnSync(process.execPath, ['--check', path.join(jsDir, f)], { encoding: 'utf8' });
    if (r.status !== 0) {
      const msg = (r.stderr || '').split('\n').filter((l) => l.trim()).slice(0, 3).join(' ');
      problems.push('js/' + f + ': ' + msg);
    }
  });
  return jsFiles.length + ' archivos js';
});

/* ---------- 2 · index.html ---------- */
check('index.html', () => {
  const scripts = [...indexHtml.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => clean(m[1]));
  const links = [...indexHtml.matchAll(/<link\b[^>]*\brel="(?:stylesheet|manifest)"[^>]*\bhref="([^"]+)"/g)].map((m) => clean(m[1]));
  const missing = [...scripts, ...links].filter((f) => !fs.existsSync(path.join(ROOT, f)));
  missing.forEach((f) => problems.push('assets: no existe "' + f + '" (referenciado en index.html)'));
  allJs.forEach((f) => {
    if (!scripts.includes(f)) problems.push('assets: ' + f + ' no se carga en index.html');
  });
  const localScripts = scripts.filter((s) => s.startsWith('js/'));
  if (localScripts[localScripts.length - 1] !== 'js/app.js') problems.push('orden: app.js debe ser el último script');
  if (localScripts[0] !== 'js/core.js') problems.push('orden: core.js debe ser el primero');
  return scripts.length + ' scripts + ' + links.length + ' enlaces';
});

/* ---------- 3 · service worker ---------- */
check('sw.js', () => {
  const m = /SHELL\s*=\s*\[([\s\S]*?)\]/.exec(swJs);
  if (!m) {
    problems.push('sw.js: no encuentro el array SHELL');
    return '';
  }
  const shell = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => clean(x[1])).filter((s) => s !== './');
  [...shell, 'index.html'].forEach((f) => {
    if (!fs.existsSync(path.join(ROOT, f))) problems.push('sw.js: SHELL apunta a "' + f + '", que no existe');
  });
  const used = [
    ...allJs,
    ...[...indexHtml.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"/g)].map((x) => clean(x[1]))
  ];
  used.forEach((f) => {
    if (!shell.includes(f)) problems.push('sw.js: SHELL no incluye "' + f + '" (offline incompleto)');
  });
  return shell.length + ' recursos precargados';
});

/* ---------- 4 · acciones (data-act → App.actions) ---------- */
check('acciones', () => {
  const files = [{ file: 'index.html', src: indexHtml }].concat(jsSources);
  const used = new Map();
  files.forEach((f) => {
    const re = /data-act(?:-change|-input)?="([a-zA-Z0-9_:-]+)"/g;
    for (const m of f.src.matchAll(re)) if (!used.has(m[1])) used.set(m[1], f.file);
  });
  /* ojo: app.js registra con el alias local `A.actions[...]` */
  const handlers = new Set([...repoText.matchAll(/\b(?:App|A)\.actions\[['"]([^'"]+)['"]\]/g)].map((m) => m[1]));
  used.forEach((file, act) => {
    if (!handlers.has(act)) problems.push('acción "' + act + '" usada en ' + file + ' sin registrar en App.actions');
  });
  handlers.forEach((h) => {
    if (used.has(h)) return;
    const hits = repoText.split('"' + h + '"').length + repoText.split("'" + h + "'").length - 2;
    if (hits <= 1) infos.push('acción "' + h + '" registrada y nunca usada (¿código muerto?)');
  });
  return used.size + ' data-act / ' + handlers.size + ' handlers';
});

/* ---------- 5 · iconos ---------- */
check('iconos', () => {
  const core = read('js/core.js');
  const defined = new Set([...core.matchAll(/\bico\(\s*['"]([a-zA-Z0-9_:-]+)['"]/g)].map((m) => m[1]));
  const used = new Set();
  jsSources.forEach((s) => {
    for (const m of s.src.matchAll(/U\.icon\(\s*['"]([a-zA-Z0-9_:-]+)['"]/g)) {
      if (!defined.has(m[1])) problems.push('icono "' + m[1] + '" usado en ' + s.file + ' y no definido en core.js');
      used.add(m[1]);
    }
  });
  const unused = [...defined].filter((d) => !used.has(d));
  if (unused.length) infos.push('iconos definidos sin usar (' + unused.length + '): ' + unused.slice(0, 8).join(', ') + (unused.length > 8 ? ' …' : ''));
  return used.size + ' usados / ' + defined.size + ' definidos';
});

/* ---------- informe ---------- */
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));
console.log('\nPulso · comprobaciones estáticas\n');
checks.forEach((c) => {
  console.log((c.ok ? '  \u2713 ' : '  \u2717 ') + pad(c.name, 12) + c.detail);
  c.bad.forEach((b) => console.log('      · ' + b));
});
infos.forEach((i) => console.log('  (i) ' + i));
const failed = problems.length;
console.log('\n' + (failed ? failed + ' problema(s).' : 'Todo correcto.') + '\n');
process.exit(failed ? 1 : 0);
