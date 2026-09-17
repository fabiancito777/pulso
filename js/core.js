/* ==========================================================================
   Pulso · core.js — utilidades base (sin dependencias)
   ========================================================================== */
(function () {
  'use strict';
  var U = {};

  /* ---------- DOM ---------- */
  U.$ = function (sel, root) { return (root || document).querySelector(sel); };
  U.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  U.esc = function (s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  U.uid = function (p) {
    return (p || 'id') + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  };
  U.clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  U.debounce = function (fn, ms) {
    var t; return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms || 250); };
  };
  U.setAttr = function (el, attrs) {
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  };
  U.focusIfDesktop = function () { return window.matchMedia('(hover:hover)').matches; };
  U.scrollTop = function (sel) { var e = U.$(sel); if (e) e.scrollTop = 0; };

  /* ---------- números ---------- */
  U.clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  U.num = function (v, def) { var n = parseFloat(v); return isFinite(n) ? n : (def === undefined ? 0 : def); };
  U.int = function (v, def) { var n = parseInt(v, 10); return isFinite(n) ? n : (def === undefined ? 0 : def); };
  U.round = function (v, d) {
    var f = Math.pow(10, d === undefined ? 1 : d);
    return Math.round((U.num(v) + Number.EPSILON) * f) / f;
  };
  U.sum = function (arr, fn) { return (arr || []).reduce(function (a, b) { return a + (fn ? fn(b) : U.num(b)); }, 0); };
  U.avg = function (arr, fn) { return arr && arr.length ? U.sum(arr, fn) / arr.length : 0; };
  U.max = function (arr, fn) { return (arr || []).reduce(function (a, b) { var v = fn ? fn(b) : U.num(b); return v > a ? v : a; }, -Infinity); };
  U.min = function (arr, fn) { return (arr || []).reduce(function (a, b) { var v = fn ? fn(b) : U.num(b); return v < a ? v : a; }, Infinity); };
  U.groupBy = function (arr, fn) {
    var out = {};
    (arr || []).forEach(function (x) { var k = fn(x); (out[k] = out[k] || []).push(x); });
    return out;
  };
  U.sortBy = function (arr, fn, dir) {
    return (arr || []).slice().sort(function (a, b) {
      var x = fn(a), y = fn(b), r = x < y ? -1 : x > y ? 1 : 0;
      return dir === 'desc' ? -r : r;
    });
  };
  U.uniq = function (arr) { return (arr || []).filter(function (v, i, a) { return a.indexOf(v) === i; }); };
  U.pct = function (a, b) { return b ? U.clamp(a / b, 0, 1) : 0; };
  U.plural = function (n, s, p) { return n === 1 ? s : (p || s + 's'); };

  /* ---------- formato ---------- */
  var nf0 = null, nf1 = null, nfCache = {};
  try { nf0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }); nf1 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }); } catch (e) { /* noop */ }
  function decFormatter(dec) {
    var k = String(dec);
    if (!(k in nfCache)) {
      try { nfCache[k] = new Intl.NumberFormat('es-ES', { maximumFractionDigits: dec }); } catch (e) { nfCache[k] = null; }
    }
    return nfCache[k];
  }
  U.fmt = {};
  /* dec = 0 redondea; cualquier otro número fija los decimales máximos */
  U.fmt.n = function (v, dec) {
    var n = U.num(v);
    if (dec === 0) return nf0 ? nf0.format(n) : String(Math.round(n));
    if (dec !== undefined && dec !== null) {
      var f = decFormatter(dec);
      if (f) return f.format(n);
    }
    if (Number.isInteger(n)) return nf0 ? nf0.format(n) : String(n);
    return nf1 ? nf1.format(n) : String(n);
  };
  /* un decimal, para pesos y 1RM en gráficos */
  U.fmt.w = function (v) { return U.fmt.n(v, 1); };
  U.fmt.vol = function (kg) {
    var v = U.num(kg);
    if (v >= 1000) return U.fmt.n(Math.round(v / 100) / 10) + 'k';
    return U.fmt.n(Math.round(v));
  };
  U.fmt.dur = function (ms) {
    var s = Math.max(0, Math.round(U.num(ms) / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h) return h + 'h ' + (m < 10 ? '0' : '') + m + 'm';
    return m + 'm';
  };
  U.fmt.clock = function (sec) {
    sec = Math.max(0, Math.round(U.num(sec)));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (sec >= 3600)
      ? Math.floor(sec / 3600) + ':' + String(Math.floor((sec % 3600) / 60)).padStart(2, '0') + ':' + String(s).padStart(2, '0')
      : m + ':' + String(s).padStart(2, '0');
  };
  U.fmt.mmss = function (sec) {
    sec = Math.max(0, Math.round(U.num(sec)));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
  };
  U.fmt.rpe = function (v) { return v ? U.fmt.n(v, 1) : '—'; };

  /* ---------- fechas (locales, ISO YYYY-MM-DD) ---------- */
  var DOW = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
  var DOW_LONG = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  var MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var d = {};
  d.DOW = DOW; d.DOW_LONG = DOW_LONG; d.MONTHS = MONTHS;
  d.iso = function (date) {
    var x = date ? new Date(date) : new Date();
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  };
  d.parse = function (iso) {
    if (!iso) return new Date();
    var p = String(iso).slice(0, 10).split('-');
    return new Date(U.int(p[0]), U.int(p[1], 1) - 1, U.int(p[2], 1));
  };
  d.today = function () { return d.iso(new Date()); };
  d.nowTs = function () { return new Date().toISOString(); };
  d.addDays = function (iso, n) { var x = d.parse(iso); x.setDate(x.getDate() + U.int(n)); return d.iso(x); };
  d.addMonths = function (iso, n) { var x = d.parse(iso); x.setMonth(x.getMonth() + U.int(n)); return d.iso(x); };
  d.diffDays = function (a, b) {
    var x = d.parse(a), y = d.parse(b);
    return Math.round((x - y) / 86400000);
  };
  d.dowIdx = function (iso) { return (d.parse(iso).getDay() + 6) % 7; }; /* 0 = lunes */
  d.startOfWeek = function (iso) { return d.addDays(iso || d.today(), -d.dowIdx(iso || d.today())); };
  d.weekDates = function (iso) {
    var s = d.startOfWeek(iso), out = [];
    for (var i = 0; i < 7; i++) out.push(d.addDays(s, i));
    return out;
  };
  d.weekKey = function (iso) { return d.startOfWeek(iso); };
  d.dow = function (iso) { return DOW[d.dowIdx(iso)]; };
  d.dowLong = function (iso) { return DOW_LONG[d.dowIdx(iso)]; };
  d.label = function (iso, style) {
    var x = d.parse(iso);
    if (style === 'short') return DOW[d.dowIdx(iso)] + ' ' + x.getDate();
    if (style === 'month') return MONTHS[x.getMonth()] + ' de ' + x.getFullYear();
    if (style === 'medium') return x.getDate() + ' ' + MONTHS[x.getMonth()].slice(0, 3) + ' ' + x.getFullYear();
    return DOW[d.dowIdx(iso)] + ', ' + x.getDate() + ' de ' + MONTHS[x.getMonth()];
  };
  d.relative = function (iso) {
    var n = d.diffDays(iso, d.today());
    if (n === 0) return 'hoy';
    if (n === 1) return 'ayer';
    if (n === -1) return 'mañana';
    if (n > 1) return 'hace ' + n + ' días';
    return 'en ' + Math.abs(n) + ' días';
  };
  d.timeAgo = function (ts) {
    var ms = Date.now() - new Date(ts).getTime(), m = Math.round(ms / 60000);
    if (m < 1) return 'ahora';
    if (m < 60) return 'hace ' + m + ' min';
    var h = Math.round(m / 60);
    if (h < 24) return 'hace ' + h + ' h';
    return 'hace ' + Math.round(h / 24) + ' d';
  };
  U.d = d;

  /* ---------- persistencia (localStorage con fallback en memoria) ---------- */
  var NS = 'pulso.';
  var mem = {};
  var canLS = (function () {
    try { var k = NS + '_t'; window.localStorage.setItem(k, '1'); window.localStorage.removeItem(k); return true; }
    catch (e) { return false; }
  })();
  U.st = {
    available: canLS,
    memory: !canLS,
    get: function (k, def) {
      try {
        var raw = canLS ? window.localStorage.getItem(NS + k) : mem[k];
        if (raw === null || raw === undefined) return def;
        return JSON.parse(raw);
      } catch (e) { return def; }
    },
    set: function (k, v) {
      var raw = JSON.stringify(v);
      try { if (canLS) window.localStorage.setItem(NS + k, raw); else mem[k] = raw; return true; }
      catch (e) { mem[k] = raw; U.st.memory = true; return false; }
    },
    del: function (k) { try { if (canLS) window.localStorage.removeItem(NS + k); delete mem[k]; } catch (e) { /* noop */ } },
    keys: function () {
      if (!canLS) return Object.keys(mem);
      var out = [];
      try { for (var i = 0; i < window.localStorage.length; i++) { var k = window.localStorage.key(i); if (k && k.indexOf(NS) === 0) out.push(k.slice(NS.length)); } } catch (e) { /* noop */ }
      return out;
    },
    bytes: function () {
      var t = 0;
      U.st.keys().forEach(function (k) { try { t += ((canLS ? window.localStorage.getItem(NS + k) : mem[k]) || '').length; } catch (e) { /* noop */ } });
      return t;
    }
  };

  /* ---------- ajustes (sonido, vibración) ----------
     Los ajustes viven en el estado de la app (pulso.state.settings) y store.js
     carga después que core.js, así que se leen al vuelo: del store si ya está
     disponible y, si no, directamente de localStorage. */
  function settings() {
    try {
      var S = window.App && window.App.store;
      if (S && S.settings) return S.settings() || {};
      var raw = U.st.get('state', {});
      return (raw && raw.settings) || {};
    } catch (e) { return {}; }
  }
  U.settings = settings;

  /* ---------- toast ---------- */
  var ICON_OK = '<svg class="ico" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_ERR = '<svg class="ico" viewBox="0 0 24 24"><path d="m12 8v5m0 3.5v.01M10.3 3.9 2.4 17.3A2 2 0 0 0 4.1 20h15.8a2 2 0 0 0 1.7-2.7L13.7 3.9a2 2 0 0 0-3.4 0Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  U.toast = function (msg, opts) {
    opts = opts || {};
    var root = U.$('#toast-root');
    if (!root) return;
    var kind = opts.type || '';
    var t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.setAttribute('role', 'status');
    var ico = kind === 'ok' ? ICON_OK : kind === 'err' || kind === 'warn' ? ICON_ERR : '';
    var spin = opts.loading ? '<div class="spinner"></div>' : ico;
    t.innerHTML = spin + '<div class="grow">' + U.esc(msg) + '</div>' + (opts.action ? '<button class="btn sm">' + U.esc(opts.action) + '</button>' : '');
    if (opts.action && opts.onAction) {
      t.querySelector('button').addEventListener('click', function () { opts.onAction(); t.remove(); });
    }
    root.appendChild(t);
    while (root.children.length > 3) root.removeChild(root.firstChild);
    if (!opts.sticky) setTimeout(function () { t.style.opacity = '0'; t.style.transition = 'opacity .25s'; setTimeout(function () { t.remove(); }, 260); }, opts.ms || (kind === 'err' ? 6000 : 2800));
    return { close: function () { t.remove(); } };
  };

  /* ---------- modal ---------- */
  U.modal = function (cfg) {
    cfg = cfg || {};
    return new Promise(function (resolve) {
      var prevFocus = document.activeElement;
      var prevModal = U.modal.current; /* pila: al cerrar se vuelve al modal de debajo */
      var closed = false;
      var scrim = document.createElement('div');
      scrim.className = 'modal-scrim';
      var actions = cfg.actions || [{ label: 'Cerrar', value: null, kind: 'ghost' }];
      scrim.innerHTML =
        '<div class="modal' + (cfg.wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' +
          '<div class="modal-head">' +
            '<div class="grow"><div class="h2">' + U.esc(cfg.title || '') + '</div>' +
              (cfg.subtitle ? '<div class="sub">' + U.esc(cfg.subtitle) + '</div>' : '') + '</div>' +
            '<button class="icon-btn" data-x aria-label="Cerrar"><svg class="ico" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>' +
          '</div>' +
          '<div class="modal-body">' + (cfg.body || '') + '</div>' +
          (cfg.footer === false ? '' : '<div class="modal-foot">' + actions.map(function (a, i) {
            return '<button class="btn ' + (a.kind || 'ghost') + '" data-i="' + i + '">' + U.esc(a.label) + '</button>';
          }).join('') + '</div>') +
        '</div>';
      document.getElementById('modal-root').appendChild(scrim);
      var box = scrim.querySelector('.modal');
      function close(val) {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKey);
        scrim.remove();
        if (U.modal.current === close) U.modal.current = prevModal || null;
        if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* noop */ }
        resolve(val);
      }
      function onKey(e) { if (e.key === 'Escape') close(null); }
      document.addEventListener('keydown', onKey);
      scrim.addEventListener('click', function (e) { if (e.target === scrim && cfg.dismissable !== false) close(null); });
      scrim.querySelector('[data-x]').addEventListener('click', function () { close(null); });
      U.$$('.modal-foot [data-i]', scrim).forEach(function (b) {
        b.addEventListener('click', function () {
          var a = actions[U.int(b.dataset.i)];
          if (a.onClick) a.onClick(box, close); else close(a.value);
        });
      });
      if (cfg.onMount) cfg.onMount(box, close);
      var first = box.querySelector('input,textarea,select,.btn.primary');
      if (first) setTimeout(function () { try { first.focus(); } catch (e) { /* noop */ } }, 60);
      U.modal.current = close;
    });
  };
  U.confirm = function (opts) {
    if (typeof opts === 'string') opts = { title: 'Confirmar', body: '<p>' + U.esc(opts) + '</p>' };
    return U.modal({
      title: opts.title, body: opts.body,
      actions: [
        { label: opts.cancelLabel || 'Cancelar', value: false, kind: 'ghost' },
        { label: opts.okLabel || 'Confirmar', value: true, kind: opts.kind || 'primary' }
      ]
    }).then(function (v) { return v === true; });
  };
  U.promptDialog = function (cfg) {
    cfg = cfg || {};
    return U.modal({
      title: cfg.title, subtitle: cfg.subtitle,
      body: '<label class="field"><span class="label">' + U.esc(cfg.label || 'Valor') + '</span>' +
        (cfg.multiline
          ? '<textarea class="input" data-in placeholder="' + U.esc(cfg.placeholder || '') + '">' + U.esc(cfg.value || '') + '</textarea>'
          : '<input class="input" data-in type="' + (cfg.inputType || 'text') + '" value="' + U.esc(cfg.value === undefined ? '' : cfg.value) + '" placeholder="' + U.esc(cfg.placeholder || '') + '">') +
        '</label>' + (cfg.hint ? '<p class="sub mt-s">' + U.esc(cfg.hint) + '</p>' : ''),
      /* El valor se lee en onClick, con el modal todavía montado. Leerlo desde el
         .then() devolvía siempre null: al resolver la promesa el modal ya se ha
         retirado del DOM (ver close() más arriba). */
      actions: [
        { label: 'Cancelar', value: null, kind: 'ghost' },
        { label: cfg.okLabel || 'Guardar', kind: 'primary', onClick: function (box, close) {
          var inp = box.querySelector('[data-in]');
          close(inp ? inp.value : null);
        } }
      ],
      onMount: function (box, close) {
        var inp = box.querySelector('[data-in]');
        inp.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && !cfg.multiline) { e.preventDefault(); close(inp.value); }
        });
      }
    });
  };

  /* ---------- audio + vibración ---------- */
  var actx = null;
  function ctx() {
    if (actx) return actx;
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    try { actx = new C(); } catch (e) { actx = null; }
    return actx;
  }
  U.audio = {
    /* Hasta cuándo hay pitidos sonando o programados (ms). Mientras no pase,
       no se suspende el contexto para no cortar la secuencia de aviso. */
    _busyUntil: 0,
    _suspT: null,
    _armSuspend: function (ms) {
      try {
        var c = actx;
        if (!c) return;
        if (U.audio._suspT) clearTimeout(U.audio._suspT);
        U.audio._suspT = setTimeout(function () {
          try {
            if (Date.now() >= U.audio._busyUntil && c.state === 'running') c.suspend();
          } catch (e) { /* noop */ }
        }, Math.max(0, U.int(ms, 500)));
      } catch (e) { /* noop */ }
    },
    /* Se llama en cada gesto para desbloquear el audio en iOS. NO deja el
       contexto abierto: un AudioContext en idle retiene la salida y varios
       Android mantienen la música de fondo (Spotify…) atenuada de forma
       permanente. Si no hay pitidos pendientes, se suspende solo al poco. */
    ensure: function () {
      var c = ctx();
      if (!c) return;
      if (c.state === 'suspended') { try { c.resume(); } catch (e) { /* noop */ } }
      U.audio._armSuspend(1500);
    },
    /* Suelta el foco de audio cuando los pitidos ya sonaron: un AudioContext
       abierto retiene la salida y, con Spotify u otro reproductor de fondo, el
       sistema mantiene la música atenuada (ducking) hasta que se suspende. */
    release: function (ms) {
      ms = Math.max(0, U.int(ms, 500));
      U.audio._busyUntil = Date.now() + ms;
      U.audio._armSuspend(ms);
    },
    tone: function (freq, dur, when, vol) {
      var c = ctx(); if (!c) return;
      if (c.state === 'suspended') { try { c.resume(); } catch (e) { /* noop */ } }
      var o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      var t0 = c.currentTime + (when || 0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.02, vol || 0.22), t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(c.destination);
      o.start(t0); o.stop(t0 + dur + 0.03);
    }
  };
  U.beep = function (kind) {
    try {
      var st = settings();
      if (st.sound === false) return;
      var v = U.num(st.volume, 0.6);
      U.audio.ensure();
      if (kind === 'end') {
        /* fin de descanso: ~3,5 s de pitidos repetidos (5 avisos cada 0,7 s),
           para que se oiga con el móvil bloqueado, en el bolsillo o lejos */
        for (var i = 0; i < 5; i++) {
          var t0 = i * 0.7;
          U.audio.tone(988, 0.16, t0, v);
          U.audio.tone(1319, 0.2, t0 + 0.17, v * 0.95);
        }
        U.audio.release(4200);
      }
      else if (kind === 'tick') { U.audio.tone(660, 0.06, 0, v * 0.6); U.audio.release(600); }
      else if (kind === 'done') { U.audio.tone(660, 0.1, 0, v); U.audio.tone(990, 0.14, 0.1, v); U.audio.release(800); }
      else { U.audio.tone(440, 0.05, 0, v * 0.5); U.audio.release(500); }
    } catch (e) { /* noop */ }
  };
  U.vibrate = function (pattern) {
    try { if (navigator.vibrate && settings().vibrate !== false) navigator.vibrate(pattern); } catch (e) { /* noop */ }
  };
  U.notify = function (title, body) {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      new Notification(title, { body: body, silent: false, tag: 'pulso-rest' });
    } catch (e) { /* noop */ }
  };
  U.wakeLock = (function () {
    var sentinel = null, want = false;
    function request() {
      try {
        if (!navigator.wakeLock || sentinel) return;
        navigator.wakeLock.request('screen').then(function (s) {
          sentinel = s;
          /* el sistema lo libera solo al ocultar la página: lo pedimos otra vez */
          try { s.addEventListener('release', function () { sentinel = null; }); } catch (e) { /* noop */ }
        }).catch(function () { /* noop */ });
      } catch (e) { /* noop */ }
    }
    return {
      on: function () { want = true; request(); },
      off: function () { want = false; try { if (sentinel) sentinel.release(); } catch (e) { /* noop */ } sentinel = null; },
      /* al volver a primer plano (o al reabrir la app) recupera el bloqueo */
      refresh: function () { if (want && !sentinel) request(); },
      active: function () { return !!sentinel; }
    };
  })();

  /* ---------- mantener el descanso vivo con el móvil bloqueado ----------
     Al bloquear el móvil el navegador congela la pestaña y no sonaría el aviso.
     Truco: un audio en bucle (pista de silencio) mantiene la página como
     "reproductor", así el temporizador sigue corriendo y el pitido final suena.
     Es best-effort: donde el sistema no lo permita, el aviso fiable es la
     notificación programada desde el service worker (ver sw.js).
     OJO con la música de fondo (Spotify…): un <audio> sonando pide el foco de
     audio y el sistema atenúa la música (ducking). Por eso:
     · SOLO se enciende mientras corre un descanso (ver trainer.js), nunca
       durante toda la sesión, y se apaga en cuanto termina o se cancela;
     · NO se publica metadata en mediaSession: antes anunciaba "Pulso" como
       reproductor y le robaba los controles/AVRCP del bluetooth a Spotify;
     · hay ajuste propio (bgAudio) para apagarlo del todo si escuchas música:
       el aviso sigue llegando por notificación del sistema + vibración. */
  U.keepAlive = (function () {
    var el = null, url = null;
    function silentWav() {
      var sr = 8000, n = sr, buf = new ArrayBuffer(44 + n), dv = new DataView(buf);
      function str(off, s) { for (var i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); }
      str(0, 'RIFF'); dv.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt ');
      dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
      dv.setUint32(24, sr, true); dv.setUint32(28, sr, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
      str(36, 'data'); dv.setUint32(40, n, true);
      for (var i = 0; i < n; i++) dv.setUint8(44 + i, 128);
      return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    }
    function clearMedia() {
      /* Devolvemos los controles multimedia a quien los tuviera (Spotify…):
         sin pista no hay nada que anunciar. */
      try {
        if (navigator.mediaSession) {
          try { navigator.mediaSession.metadata = null; } catch (e) { /* noop */ }
          try { navigator.mediaSession.playbackState = 'none'; } catch (e2) { /* noop */ }
        }
      } catch (e) { /* noop */ }
    }
    return {
      on: function () {
        try {
          if (el) return;
          url = url || silentWav();
          el = document.createElement('audio');
          el.src = url; el.loop = true; el.setAttribute('playsinline', '');
          el.style.display = 'none';
          document.body.appendChild(el);
          var p = el.play();
          if (p && p.catch) p.catch(function () { /* sin gesto previo: se ignora */ });
        } catch (e) { /* noop */ }
      },
      label: function () { /* se mantiene por compatibilidad: ya no se anuncia nada */ },
      /* tras recargar no hubo gesto de usuario y el navegador puede haber
         bloqueado el play(): se reintenta en el primer toque */
      retry: function () {
        try {
          if (el && el.paused) { var p = el.play(); if (p && p.catch) p.catch(function () { /* noop */ }); }
        } catch (e) { /* noop */ }
      },
      off: function () {
        try { if (el) { el.pause(); el.remove(); } } catch (e) { /* noop */ }
        el = null;
        clearMedia();
      },
      active: function () { return !!el; }
    };
  })();

  /* ---------- iconos (stroke: currentColor) ---------- */
  var I = {};
  function ico(name, paths, opts) {
    var o = opts || {};
    return (I[name] = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (o.sw || 1.9) + '" stroke-linecap="round" stroke-linejoin="round"' + (o.fill ? ' fill="currentColor" stroke="none"' : '') + '>' + paths + '</svg>');
  }
  ico('home', '<path d="M3 10.5 12 3l9 7.5V20a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 20Z"/><path d="M9.5 21.5V14h5v7.5"/>');
  ico('dumbbell', '<path d="M2.5 12h3M18.5 12h3M6 8.5v7M18 8.5v7M8.5 6.5v11M15.5 6.5v11M8.5 12h7"/><path d="M6 9.5h2.5M15.5 9.5H18M6 14.5h2.5M15.5 14.5H18"/>');
  ico('list', '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>');
  ico('calendar', '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>');
  ico('chart', '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>');
  ico('sparkles', '<path d="M12 3.5 13.6 8 18 9.6 13.6 11.2 12 15.7 10.4 11.2 6 9.6 10.4 8Z"/><path d="M18.5 15.5l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7Z"/>');
  ico('gear', '<circle cx="12" cy="12" r="3.4"/><circle cx="12" cy="12" r="7.6" stroke-dasharray="2.4 4.6"/><path d="M12 2.6v2.2M12 19.2v2.2M4.4 7.3l1.9 1.1M17.7 15.6l1.9 1.1M4.4 16.7l1.9-1.1M17.7 8.4l1.9-1.1"/>');
  ico('plus', '<path d="M12 5v14M5 12h14"/>', { sw: 2.2 });
  ico('minus', '<path d="M5 12h14"/>', { sw: 2.2 });
  ico('check', '<path d="M20 6 9 17l-5-5"/>', { sw: 2.6 });
  ico('x', '<path d="M18 6 6 18M6 6l12 12"/>', { sw: 2.1 });
  ico('trash', '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>');
  ico('pencil', '<path d="M4 20h4L20 8l-4-4L4 16Z"/><path d="M14.5 5.5 18.5 9.5"/>');
  ico('play', '<path d="M7 4.5 19 12 7 19.5Z" fill="currentColor" stroke="none"/>');
  ico('pause', '<path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor" stroke="none"/>');
  ico('stop', '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>');
  ico('timer', '<circle cx="12" cy="13" r="8"/><path d="M12 9.5V13l2.5 2M9 2h6"/>');
  ico('plate', '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>');
  ico('search', '<circle cx="11" cy="11" r="7"/><path d="m20 20-4.3-4.3"/>');
  ico('chev-l', '<path d="M15 5 8 12l7 7"/>');
  ico('chev-r', '<path d="m9 5 7 7-7 7"/>');
  ico('chev-d', '<path d="m6 9 6 6 6-6"/>');
  ico('chev-u', '<path d="m6 15 6-6 6 6"/>');
  ico('refresh', '<path d="M20 11A8 8 0 0 0 5.6 6.6L3 9M3 4v5h5M4 13a8 8 0 0 0 14.4 4.4L21 15M21 20v-5h-5"/>');
  ico('wand', '<path d="M15 4V2M15 10V8M12.5 6h-2M19.5 6h-2M4 20 14 10l1.5 1.5L5.5 21.5Z"/>');
  ico('download', '<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>');
  ico('upload', '<path d="M12 15V3m0 0 4 4m-4-4L8 7M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>');
  ico('alert', '<path d="M10.3 3.9 2.4 17.3A2 2 0 0 0 4.1 20h15.8a2 2 0 0 0 1.7-2.7L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4.5M12 17h.01"/>');
  ico('info', '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>');
  ico('check-circle', '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>');
  ico('user', '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5"/>');
  ico('key', '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8 2 2-1.5 1.5L21 9l-2 2-1.5-1.5L15 12"/>');
  ico('database', '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>');
  ico('sliders', '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>');
  ico('copy', '<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H5.5A2.5 2.5 0 0 0 3 5.5v7A2.5 2.5 0 0 0 5.5 15"/>');
  ico('filter', '<path d="M3 5h18l-7 8v6l-4-2v-4Z"/>');
  ico('clock', '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>');
  ico('fire', '<path d="M12 2.5s4.5 4 4.5 8a4.5 4.5 0 0 1-9 0c0-1.1.4-2.1 1.1-3.2 0 1.7.9 2.7 1.8 2.7.9 0 1.6-.9 1.6-2.2 0-1.9-1-3.2 0-5.3Z"/><path d="M7 14c0 3.9 2.2 7.5 5 7.5s5-3.6 5-7.5c1.2 1.4 1.6 3 1.6 4.4 0 2.6-2.9 5.6-6.6 5.6S5.4 21.9 5.4 18.4c0-1.4.4-3 1.6-4.4Z" opacity=".5"/>');
  ico('target', '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>');
  ico('zap', '<path d="M13 2 4 14h6l-1 8 9-12h-6Z"/>');
  ico('moon', '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>');
  ico('eye', '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12S18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>');
  ico('eye-off', '<path d="M4 4l16 16M9.9 5.9A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.8M6.2 7.7A17 17 0 0 0 2.5 12S6 18.5 12 18.5c1 0 1.9-.2 2.7-.5"/><path d="M10 10.2a3 3 0 0 0 4.1 4.2"/>');
  ico('robot', '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4.5V8M9 3h6M8.5 13.5h.01M15.5 13.5h.01M9.5 17h5"/>');
  ico('cpu', '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M4 10h3M4 14h3M17 10h3M17 14h3M10 4v3M14 4v3M10 17v3M14 17v3"/>');
  ico('skip', '<path d="M5 5v14M19 5 8 12l11 7Z"/>');
  ico('tag', '<path d="M20.5 12.5 12 21l-8.5-8.5V4h8.5Z"/><path d="M7.5 7.5h.01"/>');
  ico('scale', '<path d="M12 4v16M7 20h10M5 8h14M5 8l-2.5 5h5ZM19 8l-2.5 5h5ZM8.5 4h7"/>');
  ico('infinity', '<path d="M6.5 9a3 3 0 0 0 0 6c2.5 0 3.5-3 5.5-3s3 3 5.5 3a3 3 0 0 0 0-6c-2.5 0-3.5 3-5.5 3s-3-3-5.5-3Z"/>');
  ico('power', '<path d="M12 3v8"/><path d="M6.5 6.5a8 8 0 1 0 11 0"/>');
  ico('bars', '<path d="M4 7h16M4 12h16M4 17h10"/>');
  ico('bolt-circle', '<circle cx="12" cy="12" r="9"/><path d="m13 7-4.5 6.5H12L11 17l4.5-6.5H13Z"/>');
  ico('rest', '<path d="M4 17V8a4 4 0 0 1 8 0v9M4 13h8M12 17V8a4 4 0 0 1 8 0v9"/><path d="M4 21h16"/>');
  ico('lock', '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>');
  U.icon = function (name) { return I[name] || I.info; };

  /* ---------- unidades ---------- */
  var KG_PER_LB = 0.45359237;
  U.units = {
    KG_PER_LB: KG_PER_LB,
    toKg: function (v, unit) { return unit === 'lb' ? U.num(v) * KG_PER_LB : U.num(v); },
    fromKg: function (kg, unit) { return unit === 'lb' ? U.num(kg) / KG_PER_LB : U.num(kg); },
    label: function (unit) { return unit === 'lb' ? 'lb' : 'kg'; },
    inc: function (unit) { return unit === 'lb' ? 5 : 2.5; },
    round: function (v, unit) {
      var step = unit === 'lb' ? 2.5 : 1.25;
      return Math.round(U.num(v) / step) * step;
    },
    pretty: function (v, unit) { return U.fmt.n(U.round(v, 2)) + ' ' + U.units.label(unit); }
  };

  /* ---------- texto ---------- */
  U.norm = function (s) {
    return String(s === null || s === undefined ? '' : s)
      .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  };
  U.similarity = function (a, b) {
    var A = U.norm(a), B = U.norm(b);
    if (!A || !B) return 0;
    if (A === B) return 1;
    if (A.indexOf(B) >= 0 || B.indexOf(A) >= 0) return 0.88;
    var ta = A.split(' '), tb = B.split(' '), hit = 0;
    ta.forEach(function (t) { if (t.length > 2 && tb.indexOf(t) >= 0) hit++; });
    return hit / Math.max(ta.length, tb.length);
  };
  U.slug = function (s) { return U.norm(s).replace(/\s+/g, '-'); };
  U.trunc = function (s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  /* ---------- markdown-lite ---------- */
  U.md = function (text) {
    var src = U.esc(String(text || '')).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    var lines = src.split(/\r?\n/);
    var out = [], inUl = false, inOl = false, inTable = false;
    function closeLists() {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (inOl) { out.push('</ol>'); inOl = false; }
    }
    function closeTable() { if (inTable) { out.push('</tbody></table>'); inTable = false; } }
    function inline(s) {
      return s
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
    }
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var t = ln.trim();
      if (/^#{1,4}\s+/.test(t)) {
        closeLists(); closeTable();
        var lvl = Math.min(4, t.match(/^#+/)[0].length);
        out.push('<h' + lvl + '>' + inline(t.replace(/^#+\s+/, '')) + '</h' + lvl + '>');
        continue;
      }
      if (/^\|/.test(t) && t.indexOf('|', 1) > 0) {
        var cells = t.replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); });
        var isSep = cells.every(function (c) { return /^:?-{2,}:?$/.test(c); });
        if (isSep) continue;
        closeLists();
        var next = (lines[i + 1] || '').trim();
        var nextSep = /^\|/.test(next) && next.replace(/^\||\|$/g, '').split('|').every(function (c) { return /^:?-{2,}:?$/.test(c.trim()); });
        if (!inTable) {
          inTable = true;
          out.push('<table><thead><tr>' + cells.map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') + '</tr></thead>');
          if (!nextSep) out.push('<tbody>');
          else { out.push('<tbody>'); i++; continue; }
        }
        out.push('<tr>' + cells.map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>');
        continue;
      }
      closeTable();
      if (!t) { closeLists(); continue; }
      if (/^([-*•]|\u2022)\s+/.test(t)) {
        if (!inUl) { closeLists(); out.push('<ul>'); inUl = true; }
        out.push('<li>' + inline(t.replace(/^([-*•]|\u2022)\s+/, '')) + '</li>');
        continue;
      }
      if (/^\d+[.)]\s+/.test(t)) {
        if (!inOl) { closeLists(); out.push('<ol>'); inOl = true; }
        out.push('<li>' + inline(t.replace(/^\d+[.)]\s+/, '')) + '</li>');
        continue;
      }
      if (/^>\s?/.test(t)) { closeLists(); out.push('<blockquote>' + inline(t.replace(/^>\s?/, '')) + '</blockquote>'); continue; }
      if (/^```/.test(t)) {
        closeLists(); closeTable();
        var buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i].trim())) { buf.push(lines[i]); i++; }
        out.push('<pre>' + buf.join('\n') + '</pre>');
        continue;
      }
      closeLists();
      out.push('<p>' + inline(t) + '</p>');
    }
    closeLists(); closeTable();
    return out.join('');
  };

  /* ---------- misc ---------- */
  U.ring = function (frac, size, sw, cls) {
    var r = (size - sw) / 2, c = 2 * Math.PI * r, off = c * (1 - U.clamp(frac, 0, 1));
    return '<svg class="' + (cls || 'rest-ring') + '" viewBox="0 0 ' + size + ' ' + size + '" data-ring>' +
      '<circle class="bg" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '"/>' +
      '<circle class="fg" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/>' +
      '</svg>';
  };
  U.ringUpdate = function (svg, frac) {
    if (!svg) return;
    var c = svg.querySelector('circle.fg');
    if (!c) return;
    var r = U.num(c.getAttribute('r')), circ = 2 * Math.PI * r;
    c.setAttribute('stroke-dashoffset', (circ * (1 - U.clamp(frac, 0, 1))).toFixed(2));
  };
  U.download = function (filename, text, mime) {
    try {
      var blob = new Blob([text], { type: mime || 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      return true;
    } catch (e) { U.toast('No se pudo descargar el archivo', { type: 'err' }); return false; }
  };
  U.pickFile = function (accept) {
    return new Promise(function (resolve) {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = accept || '.json,application/json';
      inp.style.display = 'none';
      inp.addEventListener('change', function () {
        var f = inp.files && inp.files[0];
        if (!f) return resolve(null);
        var fr = new FileReader();
        fr.onload = function () { inp.remove(); resolve(String(fr.result)); };
        fr.onerror = function () { inp.remove(); resolve(null); };
        fr.readAsText(f);
      });
      document.body.appendChild(inp);
      inp.click();
    });
  };
  U.copy = function (text) {
    var done = function () { U.toast('Copiado al portapapeles', { type: 'ok' }); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, function () {}); return; }
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove(); done();
    } catch (e) { U.toast('No se pudo copiar', { type: 'err' }); }
  };
  U.rnd = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };
  U.chunk = function (arr, n) {
    var out = [];
    for (var i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  };

  window.App = window.App || {};
  window.App.VERSION = '1.0.2';
  window.App.u = U;
})();
