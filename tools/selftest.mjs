#!/usr/bin/env node
/* ==========================================================================
   Pulso · auto-test en Chrome headless (sin dependencias)
   --------------------------------------------------------------------------
   Arranca `tools/serve.mjs`, abre `index.html?selftest=1` en Chrome headless,
   lee `data-selftest="N/M"` del DOM y falla si no pasan todas.

   No sustituye a mirar la app en el navegador (el auto-test no cubre los
   modales), pero es la puerta rápida: si esto falla, algo se ha roto.

     node tools/selftest.mjs                  # puerto y Chrome automáticos
     node tools/selftest.mjs --port 8099      # puerto concreto
     node tools/selftest.mjs --chrome "C:/ruta/a/chrome.exe"
     node tools/selftest.mjs --verbose        # imprime también los PASS

   Variables: CHROME_PATH (ruta al binario) · PORT.
   ========================================================================== */
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const VERBOSE = argv.includes('--verbose');
const TIMEOUT_MS = 45000;

/* ---------- utilidades ---------- */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

function findChrome() {
  const explicit = arg('chrome', process.env.CHROME_PATH);
  if (explicit) return explicit;

  const candidates = {
    win32: [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    ],
    linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium']
  }[process.platform] || [];

  const found = candidates.filter(Boolean).find((p) => fs.existsSync(p));
  if (!found) {
    console.error('No encuentro Chrome. Pásalo con --chrome "ruta" o define CHROME_PATH.');
    process.exit(2);
  }
  return found;
}

function waitFor(fn, ms) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      if (fn()) return resolve();
      if (Date.now() - t0 > ms) return reject(new Error('timeout esperando al servidor'));
      setTimeout(poll, 120);
    })();
  });
}

async function reachable(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.on('connect', () => { s.end(); resolve(true); });
    s.on('error', () => resolve(false));
    setTimeout(() => { s.destroy(); resolve(false); }, 400);
  });
}

function dumpDom(chrome, url, profile) {
  return new Promise((resolve, reject) => {
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--user-data-dir=' + profile,
      '--virtual-time-budget=12000',
      '--dump-dom',
      url
    ];
    const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('timeout de Chrome')); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', () => { clearTimeout(timer); resolve({ out, err }); });
  });
}

/* ---------- ejecución ---------- */
const port = Number(arg('port', process.env.PORT || 0)) || await freePort();
const chrome = findChrome();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-chrome-'));

console.log('\nPulso · auto-test en Chrome headless');
console.log('  chrome  ' + chrome);
console.log('  puerto  ' + port);

const server = spawn(process.execPath, [path.join(ROOT, 'tools/serve.mjs'), String(port)], { stdio: 'ignore' });
let dom = '';
let stderr = '';
let code = 1;

try {
  await waitFor(() => reachable(port), 5000);
  const res = await dumpDom(chrome, 'http://127.0.0.1:' + port + '/index.html?selftest=1', profile);
  dom = res.out;
  stderr = res.err;
} catch (e) {
  console.error('  ✗ ' + e.message);
} finally {
  server.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* noop */ }
}

const m = /data-selftest="(\d+)\/(\d+)"/.exec(dom) || /Auto-test (\d+)\/(\d+)/.exec(dom);
if (!m) {
  console.error('  ✗ el auto-test no llegó a ejecutarse.');
  const hint = (stderr || dom).split('\n').filter((l) => l.trim()).slice(0, 6).join('\n      ');
  if (hint) console.error('      ' + hint);
} else {
  const pass = Number(m[1]), total = Number(m[2]);
  const fails = [...dom.matchAll(/badge danger[^>]*>FAIL<\/span><div class="li-main"><div class="li-title"[^>]*>([^<]+)/g)].map((x) => x[1]);
  console.log('  ' + (pass === total && total > 0 ? '✓' : '✗') + ' auto-test ' + pass + '/' + total);
  fails.forEach((f) => console.log('      · ' + f));
  if (VERBOSE) {
    [...dom.matchAll(/<div class="li-title" style="font-size:13px">([^<]+)<\/div>(?:<div class="li-sub">([^<]*)<\/div>)?/g)]
      .forEach((r) => console.log('      - ' + r[1] + (r[2] ? '  (' + r[2] + ')' : '')));
  }
  /* aviso de documentación desincronizada (no falla el test) */
  const docs = [['README.md', /Ejecuta (\d+) comprobaciones/], ['AGENTS.md', /(\d+) comprobaciones/]];
  docs.forEach(([file, re]) => {
    try {
      const dm = re.exec(fs.readFileSync(path.join(ROOT, file), 'utf8'));
      if (dm && Number(dm[1]) !== total) console.log('  (i) ' + file + ' dice ' + dm[1] + ' comprobaciones y hay ' + total + ': actualízalo');
    } catch (e) { /* noop */ }
  });
  code = pass === total && total > 0 ? 0 : 1;
}

console.log(code === 0 ? '\nTodo correcto.\n' : '\nHay fallos.\n');
process.exit(code);
