/**
 * Pulso · sincronización. El endpoint más pequeño que hace el trabajo.
 *
 * Guarda UN blob por id (el SHA-256 del código de pareja). El contenido llega
 * cifrado con AES-GCM desde el navegador, así que este Worker no puede leer
 * sesiones, nombres ni rutinas: solo ve un id, un texto y una versión.
 *
 * API:
 *   GET    /v1/health            → { ok: true }
 *   GET    /v1/blob/:id          → { rev, updatedAt, payload } | 404
 *   PUT    /v1/blob/:id          → { rev } | 409 si `rev` no coincide
 *   DELETE /v1/blob/:id          → 204
 *
 * `rev` es la versión del blob: el PUT la exige cuando ya existe, así dos
 * dispositivos no se pisan (el segundo recibe 409 y vuelve a fusionar).
 *
 * Límites: 1 MB por blob (un estado de años cabe de sobra). El plan gratuito de
 * KV aguanta 1.000 escrituras/día y 100.000 lecturas/día, muchísimo más de lo
 * que gasta un usuario con su móvil y su PC.
 */
const MAX_BYTES = 1024 * 1024;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
  });

const isHex64 = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

const newRev = () => crypto.randomUUID().replace(/-/g, '');

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === '/v1/health') {
      return json({ ok: true });
    }

    const match = /^\/v1\/blob\/([^/]+)$/.exec(url.pathname);
    if (!match) return json({ error: 'ruta desconocida' }, 404);

    const id = match[1];
    if (!isHex64(id)) return json({ error: 'id inválido' }, 400);
    if (!env.SYNC) return json({ error: 'falta el binding KV SYNC' }, 500);

    if (request.method === 'GET') {
      const stored = await env.SYNC.get(id, 'json');
      if (!stored) return json({ error: 'no encontrado' }, 404);
      return json(stored);
    }

    if (request.method === 'DELETE') {
      await env.SYNC.delete(id);
      return new Response(null, { status: 204, headers: CORS });
    }

    if (request.method !== 'PUT') {
      return json({ error: 'método no permitido' }, 405);
    }

    const raw = await request.text();
    if (raw.length > MAX_BYTES) return json({ error: 'blob demasiado grande' }, 413);

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: 'json inválido' }, 400);
    }
    if (!body || typeof body.payload !== 'string' || !body.payload) {
      return json({ error: 'falta el payload' }, 400);
    }

    const existing = await env.SYNC.get(id, 'json');
    const expected = body.rev ?? null;
    if (existing && existing.rev !== expected) {
      /* otro dispositivo subió entre el GET y el PUT de este: que vuelva a fusionar */
      return json({ error: 'versión desactualizada', rev: existing.rev }, 409);
    }
    if (!existing && expected) {
      return json({ error: 'versión desactualizada' }, 409);
    }

    const stored = { rev: newRev(), updatedAt: Date.now(), payload: body.payload };
    await env.SYNC.put(id, JSON.stringify(stored));
    return json({ rev: stored.rev });
  },
};
