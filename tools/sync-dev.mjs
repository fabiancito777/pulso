/**
 * Servidor de sincronización para desarrollo: la misma API que el Worker de
 * `sync-worker/`, pero en memoria de proceso con un JSON en disco.
 *
 * Existe para poder probar el flujo de dos dispositivos sin cuenta de
 * Cloudflare. NO se despliega: el de verdad es el Worker.
 *
 *   node tools/sync-dev.mjs            → http://localhost:8787
 *   node tools/sync-dev.mjs 9000       → otro puerto
 *
 * Los blobs se guardan en `.sync-dev.json` (ignorado por git).
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.argv[2] ?? process.env.SYNC_PORT ?? 8787);
const FILE = '.sync-dev.json';
const MAX_BYTES = 1024 * 1024;

/** @type {Record<string, { rev: string, updatedAt: number, payload: string }>} */
let blobs = {};
try {
  blobs = JSON.parse(readFileSync(FILE, 'utf8'));
} catch {
  blobs = {};
}

const save = () => {
  try {
    writeFileSync(FILE, JSON.stringify(blobs));
  } catch (err) {
    console.warn('[sync-dev] no se pudo guardar', err);
  }
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

const send = (res, status, body) => {
  const text = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    ...CORS,
  });
  res.end(text);
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  console.log(`[sync-dev] ${req.method} ${url.pathname}`);

  if (req.method === 'OPTIONS') return send(res, 204);
  if (url.pathname === '/v1/health') return send(res, 200, { ok: true });

  const match = /^\/v1\/blob\/([^/]+)$/.exec(url.pathname);
  if (!match) return send(res, 404, { error: 'ruta desconocida' });

  const id = match[1];
  if (!/^[0-9a-f]{64}$/.test(id)) return send(res, 400, { error: 'id inválido' });

  if (req.method === 'GET') {
    const stored = blobs[id];
    return stored ? send(res, 200, stored) : send(res, 404, { error: 'no encontrado' });
  }

  if (req.method === 'DELETE') {
    delete blobs[id];
    save();
    return send(res, 204);
  }

  if (req.method !== 'PUT') return send(res, 405, { error: 'método no permitido' });

  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > MAX_BYTES) req.destroy();
  });
  req.on('end', () => {
    if (raw.length > MAX_BYTES) return send(res, 413, { error: 'blob demasiado grande' });

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return send(res, 400, { error: 'json inválido' });
    }
    if (!body || typeof body.payload !== 'string' || !body.payload) {
      return send(res, 400, { error: 'falta el payload' });
    }

    const existing = blobs[id];
    if ((existing?.rev ?? null) !== (body.rev ?? null)) {
      return send(res, 409, { error: 'versión desactualizada', rev: existing?.rev });
    }

    const rev = randomUUID().replace(/-/g, '');
    blobs[id] = { rev, updatedAt: Date.now(), payload: body.payload };
    save();
    send(res, 200, { rev });
  });
});

server.listen(PORT, () => {
  console.log(`[sync-dev] escuchando en http://localhost:${PORT} (blobs en ${FILE})`);
});
