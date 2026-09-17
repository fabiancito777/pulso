/* ==========================================================================
   Pulso · service worker
   --------------------------------------------------------------------------
   1) App shell offline: al instalarla se cachean HTML, CSS, JS e iconos, así
      que la app abre y funciona sin conexión (los datos ya son locales).
      Estrategia: network-first con respaldo en caché → estando online siempre
      se sirve la versión nueva (el proyecto no tiene build ni hashes, así que
      cache-first dejaría la app congelada) y sin conexión se abre igual.
   2) Avisos de fin de descanso: con la pestaña en segundo plano o el móvil
      bloqueado lanza la notificación del sistema. La app no solo pide el aviso
      (mensaje 'notify'): además lo PROGRAMA aquí ('schedule-rest'), porque al
      bloquear el móvil la pestaña se congela y no llegaría a avisar. El service
      worker se mantiene despierto con waitUntil hasta la hora exacta.
      Requiere servir por http/https y, en iOS, tener la app instalada en la
      pantalla de inicio.

   ⚠️ Si añades un archivo js/css nuevo, súmalo a SHELL.
   ========================================================================== */
var CACHE = 'pulso-shell-v3';
var SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'assets/styles.css',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/core.js', 'js/data.js', 'js/store.js', 'js/charts.js', 'js/trainer.js', 'js/coach.js',
  'js/views-train.js', 'js/views-routines.js', 'js/views-calendar.js', 'js/views-coach.js',
  'js/views-stats.js', 'js/views-settings.js', 'js/app.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (cache) {
    /* addAll falla entero si un recurso no está: mejor uno a uno */
    return Promise.all(SHELL.map(function (url) {
      return cache.add(new Request(url, { cache: 'reload' })).catch(function () { /* noop */ });
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                     /* la API de Gemini va por POST */
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;      /* nunca cacheamos terceros */

  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put(req, copy); }).catch(function () { /* noop */ });
      }
      return res;
    }).catch(function () {
      /* sin conexión: buscamos en caché ignorando el ?v= de los assets */
      return caches.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        if (req.mode === 'navigate') {
          return caches.match('index.html', { ignoreSearch: true }).then(function (page) {
            return page || new Response('<h1>Pulso</h1><p>Sin conexión.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
          });
        }
        return new Response('', { status: 504, statusText: 'Sin conexión' });
      });
    })
  );
});

/* ---------- avisos de fin de descanso ---------- */
function showNotice(title, body, tag, requireInteraction, at) {
  return self.registration.showNotification(title || 'Pulso', {
    body: body || '',
    tag: tag || 'pulso-rest',
    renotify: true,
    requireInteraction: !!requireInteraction,
    vibrate: [150, 80, 150],
    silent: false,
    timestamp: Number(at) || Date.now(),
    icon: './icons/icon-192.png',
    badge: './icons/icon.svg',
    data: { url: './' }
  });
}

/* solo notifica si la app no está delante: si el usuario la tiene abierta ya
   avisa el propio pitido (y si no, la notificación del sistema es el plan B) */
function notifyWhenHidden(title, body, tag, at) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    var visible = list.some(function (c) { return c.visibilityState === 'visible'; });
    if (visible) return null;
    return showNotice(title, body, tag, true, at);
  }).catch(function () { /* sin permiso de notificaciones: no hay nada que hacer */ });
}

/* un único descanso pendiente a la vez */
var rest = { id: 0, timer: null, waiters: [] };
function releaseRest() {
  var w = rest.waiters;
  rest.waiters = [];
  w.forEach(function (resolve) { resolve(); });
}
function clearRest() {
  if (rest.timer) { clearTimeout(rest.timer); rest.timer = null; }
  releaseRest();
}
/* devuelve una promesa que mantiene vivo al service worker hasta el aviso */
function scheduleRest(d) {
  clearRest();
  var id = ++rest.id;
  var delay = Math.max(0, Number(d.at || 0) - Date.now());
  rest.timer = setTimeout(function () {
    rest.timer = null;
    if (id !== rest.id) return;
    notifyWhenHidden(d.title, d.body, d.tag, d.at).then(releaseRest, releaseRest);
  }, delay);
  return new Promise(function (resolve) { rest.waiters.push(resolve); });
}

self.addEventListener('message', function (e) {
  var d = e.data || {};
  if (d.type === 'notify') {
    e.waitUntil(showNotice(d.title, d.body, d.tag, d.requireInteraction));
  } else if (d.type === 'schedule-rest') {
    e.waitUntil(scheduleRest(d));
  } else if (d.type === 'cancel-rest') {
    clearRest();
  }
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if ('focus' in c) return c.focus();
    }
    return self.clients.openWindow('./');
  }));
});
