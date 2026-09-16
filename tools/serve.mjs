#!/usr/bin/env node
/* ==========================================================================
   Pulso · servidor estático de desarrollo (sin dependencias)
   --------------------------------------------------------------------------
   ¿Por qué no `python -m http.server`? Porque no manda `Cache-Control`, así que
   el navegador puede servir los JS/CSS desde su caché heurística y acabas
   probando código viejo (el fallo clásico al verificar cambios). Aquí todo sale
   con `no-store`, MIME correcto y sin sorpresas.

     node tools/serve.mjs [puerto]        # por defecto 8080

   Sirve la RAÍZ del repositorio (index.html incluido). No intercepta nada más.
   ========================================================================== */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    res.writeHead(400, { 'Cache-Control': 'no-store' });
    res.end('400');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';

  const file = path.join(ROOT, pathname);
  /* nada de salirse de la raíz del proyecto */
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'Cache-Control': 'no-store' });
    res.end('403');
    return;
  }

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Cache-Control': 'no-store' });
      res.end('404 · ' + pathname);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-store, must-revalidate',
      'Service-Worker-Allowed': '/'
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error('El puerto ' + PORT + ' está ocupado: usa otro (node tools/serve.mjs 8081).');
  else console.error('[serve] ' + e.message);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log('Pulso en http://localhost:' + PORT + '  (raíz: ' + ROOT + ')');
  console.log('Ctrl-C para parar. Sin caché y con MIME correcto.');
});
