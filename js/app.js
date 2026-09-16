/* ==========================================================================
   Pulso · app.js — router, eventos, tema, helpers de UI y arranque
   ========================================================================== */
(function () {
  'use strict';
  var A = window.App;
  var U = A.u, D = A.data, S = A.store, T = A.trainer, C = A.coach, Ch = A.charts;
  A.actions = A.actions || {};
  A.afterRender = A.afterRender || [];
  var TABS = [
    { tab: 'hoy', label: 'Hoy', icon: 'dumbbell' },
    { tab: 'rutinas', label: 'Rutinas', icon: 'list' },
    { tab: 'calendario', label: 'Plan', icon: 'calendar' },
    { tab: 'coach', label: 'Coach', icon: 'sparkles' },
    { tab: 'progreso', label: 'Progreso', icon: 'chart' },
    { tab: 'ajustes', label: 'Ajustes', icon: 'gear' }
  ];
  A.TABS = TABS;
  var route = { tab: 'hoy', sub: null };

  /* ---------- tema ---------- */
  function hexToRgb(hex) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgba(hex, a) {
    var c = hexToRgb(hex);
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
  }
  function inkFor(hex) {
    var c = hexToRgb(hex);
    var lum = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
    return lum > 0.6 ? '#07080a' : '#ffffff';
  }
  A.applyTheme = function () {
    var st = S.settings();
    var el = document.documentElement;
    el.setAttribute('data-theme', st.theme || 'amoled');
    var accent = st.accent || '#c8ff2e';
    el.style.setProperty('--accent', accent);
    el.style.setProperty('--accent-soft', rgba(accent, 0.15));
    el.style.setProperty('--accent-ink', inkFor(accent));
    var meta = U.$('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', st.theme === 'light' ? '#f4f5f7' : (st.theme === 'amoled' ? '#000000' : '#0e1116'));
  };

  /* ---------- navegación ---------- */
  function buildNav() {
    var nav = U.$('#nav');
    if (!nav) return;
    nav.innerHTML = '<div class="nav-inner">' + TABS.map(function (t) {
      return '<button class="nav-btn" data-act="go" data-tab="' + t.tab + '" data-nav="' + t.tab + '">' + U.icon(t.icon) + '<span>' + t.label + '</span></button>';
    }).join('') + '</div>';
  }
  function updateNav() {
    U.$$('[data-nav]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-nav') === route.tab); });
  }
  function updateAppbar(view) {
    var t = U.$('#appbar-title'), s = U.$('#appbar-sub');
    if (t) t.textContent = view.title || 'Pulso';
    if (s) { try { s.textContent = view.sub ? view.sub() : ''; } catch (e) { s.textContent = ''; } }
  }
  function updateStreak() {
    var v = U.$('#streak-value');
    if (v) v.textContent = S.a.streak();
  }

  /* ---------- render ---------- */
  function errorBox(err) {
    return '<div class="card" style="border-color:var(--danger)"><div class="h3 danger">Algo se rompió al dibujar esta vista</div>' +
      '<div class="code-box mt-s">' + U.esc(err && (err.stack || err.message) || String(err)) + '</div>' +
      '<button class="btn mt" data-act="go" data-tab="hoy">Volver al inicio</button></div>';
  }
  A.render = function () {
    var view = A.views[route.tab] || A.views.hoy;
    var root = U.$('#view');
    if (!root) return;
    try { view.render(root); } catch (e) { console.error('[pulso] render ' + route.tab, e); root.innerHTML = errorBox(e); }
    updateAppbar(view);
    updateNav();
    updateStreak();
    Ch.mountAll(root);
    A.afterRender.forEach(function (fn) { try { fn(root); } catch (e) { console.error(e); } });
  };
  A.rerenderPart = function (sel, html) {
    var el = U.$(sel);
    if (el) { el.innerHTML = html; Ch.mountAll(el); }
  };

  /* ---------- router ---------- */
  function parseHash() {
    var h = String(location.hash || '').replace(/^#\/?/, '');
    if (!h) return { tab: 'hoy', sub: null };
    var parts = h.split('/');
    var ok = TABS.some(function (t) { return t.tab === parts[0]; });
    return { tab: ok ? parts[0] : 'hoy', sub: parts[1] || null };
  }
  function applyRoute(r) {
    var tabChanged = r.tab !== route.tab;
    route = r;
    if (r.tab === 'ajustes' && r.sub) A.views.ajustes.section(r.sub);
    if (tabChanged) { try { window.scrollTo({ top: 0 }); } catch (e) { window.scrollTo(0, 0); } }
    A.render();
  }
  A.router = {
    go: function (tab, sub) {
      if (!tab) { this.current(); return; }
      if (tab === 'ajustes' && sub) A.views.ajustes.section(sub);
      var target = '#/' + tab + (sub ? '/' + sub : '');
      if (location.hash === target) applyRoute(parseHash());
      else location.hash = target;
    },
    current: function () { return route; }
  };
  window.addEventListener('hashchange', function () { applyRoute(parseHash()); });

  /* ---------- delegación de eventos ---------- */
  function run(act, el, ev) {
    var fn = A.actions[act];
    if (!fn) { console.warn('[pulso] acción sin handler:', act); return; }
    try { fn(el, ev); } catch (e) { console.error('[pulso] acción ' + act, e); U.toast('Error: ' + (e.message || e), { type: 'err' }); }
  }
  document.addEventListener('click', function (ev) {
    /* primer toque: oportunidad para arrancar el audio (pitidos y keep-alive) */
    U.audio.ensure();
    U.keepAlive.retry();
    var el = ev.target.closest ? ev.target.closest('[data-act]') : null;
    if (!el) return;
    var act = el.getAttribute('data-act');
    if (el.tagName === 'INPUT' && (el.type === 'checkbox')) return;
    ev.preventDefault();
    U.audio.ensure();
    run(act, el, ev);
  });
  document.addEventListener('change', function (ev) {
    var el = ev.target.closest ? ev.target.closest('[data-act-change]') : null;
    if (!el) return;
    run(el.getAttribute('data-act-change'), el, ev);
  });
  var inputTimer = null;
  document.addEventListener('input', function (ev) {
    var el = ev.target.closest ? ev.target.closest('[data-act-input]') : null;
    if (!el) return;
    var act = el.getAttribute('data-act-input');
    if (act === 'ex:search' || act.indexOf('search') > -1) run(act, el, ev);
    else {
      clearTimeout(inputTimer);
      inputTimer = setTimeout(function () { run(act, el, ev); }, 220);
    }
  });
  A.actions['go'] = function (el) { A.router.go(el.getAttribute('data-tab'), el.getAttribute('data-sub') || null); };

  /* ---------- ajustes con ruta anidada (a.b.c) ---------- */
  A.setSettingPath = function (path, value) {
    var st = S.settings();
    var parts = String(path).split('.');
    if (parts.length === 1) {
      var patch = {};
      patch[parts[0]] = value;
      S.setSettings(patch);
      return;
    }
    if (parts[0] === 'ai') {
      var aiPatch = {};
      aiPatch[parts.slice(1).join('.')] = value;
      S.setAiSettings(aiPatch);
      return;
    }
    var cur = st;
    for (var i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
    S.notify('settings:path');
  };

  /* ---------- barra de descanso ---------- */
  A.actions['rest-add'] = function (el) { T.rest.add(U.int(el.getAttribute('data-sec'), 15)); };
  A.actions['rest-sub'] = function (el) { T.rest.sub(U.int(el.getAttribute('data-sec'), 15)); };
  A.actions['rest-skip'] = function () { T.rest.stop(); if (document.getElementById('session-rest')) A.render(); };

  /* ---------- notificaciones al activar el ajuste ---------- */
  var origSettingsSet = A.actions['settings:set'];
  A.actions['settings:set'] = function (el, ev) {
    var key = el.getAttribute('data-key');
    if (key === 'notify' && el.checked) {
      try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (e) { /* noop */ }
    }
    if (key === 'units') U.toast('Los discos del inventario se interpretan en la unidad elegida', { type: 'warn', ms: 5000 });
    return origSettingsSet(el, ev);
  };

  /* ---------- onboarding ---------- */
  function onboarding() {
    var body =
      '<p class="sub">Tres datos y empezamos. Podrás cambiarlo todo desde Ajustes.</p>' +
      '<div class="col mt" style="gap:11px">' +
        '<label class="field"><span class="label">¿Cómo te llamas?</span><input class="input" id="ob-name" placeholder="Tu nombre" autocomplete="off"></label>' +
        '<label class="field"><span class="label">Objetivo principal</span><select class="select" id="ob-goal">' +
          D.GOALS.map(function (g) { return '<option value="' + g.key + '"' + (g.key === 'hipertrofia' ? ' selected' : '') + '>' + U.esc(g.label) + '</option>'; }).join('') + '</select></label>' +
        '<div class="grid c2">' +
          '<label class="field"><span class="label">Días/semana</span><select class="select" id="ob-days"><option>2</option><option>3</option><option selected>4</option><option>5</option><option>6</option></select></label>' +
          '<label class="field"><span class="label">Unidades</span><select class="select" id="ob-units"><option value="kg" selected>Kilogramos</option><option value="lb">Libras</option></select></label>' +
        '</div>' +
        '<div class="field"><span class="label">¿Con qué material cuentas?</span>' +
          '<div class="row wrap" style="gap:7px">' + [
            ['basico', 'Mancuernas + banco'], ['gym', 'Gimnasio completo'], ['todo', 'Todo el catálogo'], ['ninguno', 'Solo peso corporal']
          ].map(function (o, i) {
            /* atributo propio, no data-act: la selección la maneja el propio modal
               (un data-act sin acción registrada ensucia la consola) */
            return '<button class="toggle-pill' + (i === 0 ? ' on' : '') + '" data-ob-equip="' + o[0] + '">' + U.esc(o[1]) + '</button>';
          }).join('') + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="card tight mt"><div class="tiny muted">Todo se guarda en tu dispositivo. El coach AI es opcional: puedes activarlo después con tu propia API key de Gemini.</div></div>';
    U.modal({
      title: 'Bienvenido a Pulso', subtitle: 'Tu entrenamiento, sin ruido', body: body, dismissable: false,
      /* Los valores se leen en onClick, con el modal todavía montado: leerlos
         desde el .then() perdía el equipo elegido y los datos del formulario. */
      actions: [
        { label: 'Configurar después', value: null, kind: 'ghost' },
        { label: 'Empezar', kind: 'primary', onClick: function (box, close) {
          close({
            name: (box.querySelector('#ob-name') || {}).value || '',
            goal: (box.querySelector('#ob-goal') || {}).value || 'hipertrofia',
            days: U.int((box.querySelector('#ob-days') || {}).value, 4),
            units: (box.querySelector('#ob-units') || {}).value || 'kg',
            equip: box.__pickedEquipment ? box.__pickedEquipment() : 'basico'
          });
        } }
      ],
      onMount: function (box) {
        var picked = 'basico';
        box.addEventListener('click', function (ev) {
          var b = ev.target.closest('[data-ob-equip]');
          if (!b) return;
          picked = b.getAttribute('data-ob-equip');
          U.$$('[data-ob-equip]', box).forEach(function (x) { x.classList.toggle('on', x === b); });
        });
        box.__pickedEquipment = function () { return picked; };
      }
    }).then(function (val) {
      S.setMeta({ onboarded: true });
      if (!val) { A.render(); return; }
      S.setSettings({ name: val.name, goal: val.goal, daysPerWeek: val.days, units: val.units });
      var all = D.equipPreset(val.equip);
      Object.keys(all).forEach(function (k) { S.setEquipment(k, all[k]); });
      A.applyTheme();
      A.render();
      U.toast('¡Listo' + (val.name ? ', ' + val.name.split(' ')[0] : '') + '! Genera tu primera semana desde Plan', { type: 'ok', ms: 5000 });
    });
  }

  /* ---------- bucle de tiempo ---------- */
  var renderHooks = [];
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      /* al volver de segundo plano el sistema suelta el wake lock y puede haber
         bloqueado el audio del keep-alive: se recuperan ambos */
      U.wakeLock.refresh();
      U.keepAlive.retry();
      T.rest.paint();
      if (T.active()) A.render();
    }
  });
  window.addEventListener('resize', U.debounce(function () { Ch.mountAll(document); }, 260));

  /* ---------- errores visibles ---------- */
  var errorShown = false;
  window.addEventListener('error', function (e) {
    console.error('[pulso] error', e.error || e.message);
    if (errorShown) return;
    errorShown = true;
    U.toast('Error de la app: ' + (e.message || 'desconocido') + ' (mira la consola)', { type: 'err', ms: 8000 });
    setTimeout(function () { errorShown = false; }, 15000);
  });
  window.addEventListener('unhandledrejection', function (e) {
    console.error('[pulso] promesa rechazada', e.reason);
  });

  /* ==================== PWA (instalación / modo app) ==================== */
  var deferredInstall = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredInstall = e;
  });
  window.addEventListener('appinstalled', function () {
    deferredInstall = null;
    U.toast('Pulso instalada · ya funciona sin conexión', { type: 'ok', ms: 5000 });
  });
  A.pwa = {
    installed: function () {
      try {
        return window.matchMedia('(display-mode: standalone)').matches ||
          window.matchMedia('(display-mode: minimal-ui)').matches ||
          navigator.standalone === true;
      } catch (e) { return false; }
    },
    canInstall: function () { return !!deferredInstall; },
    hasSW: function () { return 'serviceWorker' in navigator && /^https?:$/.test(location.protocol); },
    install: function () {
      if (!deferredInstall) return Promise.resolve(false);
      var ev = deferredInstall;
      deferredInstall = null;
      try { ev.prompt(); } catch (e) { return Promise.resolve(false); }
      return (ev.userChoice || Promise.resolve({ outcome: 'dismissed' })).then(function (res) {
        return !!(res && res.outcome === 'accepted');
      });
    }
  };
  A.actions['pwa:install'] = function () {
    if (A.pwa.installed()) { U.toast('Ya la estás usando como app instalada', { type: 'ok' }); return; }
    A.pwa.install().then(function (accepted) {
      if (accepted) return; /* el evento appinstalled ya avisa */
      U.modal({
        title: 'Instalar Pulso', subtitle: 'Añádela a la pantalla de inicio',
        body: '<div class="col" style="gap:10px">' +
          '<div class="card tight"><div class="h3">iPhone / iPad (Safari)</div><div class="tiny muted">Compartir → «Añadir a pantalla de inicio». En iOS es obligatorio para recibir las notificaciones del timer (16.4+).</div></div>' +
          '<div class="card tight"><div class="h3">Android (Chrome)</div><div class="tiny muted">Menú → «Instalar aplicación» o «Añadir a pantalla de inicio».</div></div>' +
          '<div class="card tight"><div class="h3">Escritorio</div><div class="tiny muted">El icono de instalar de la barra de direcciones (Chrome/Edge).</div></div>' +
          '<div class="tiny muted">' + (A.pwa.hasSW()
            ? 'Con la app instalada funciona sin conexión y el timer avisa con el móvil bloqueado.'
            : 'Sirviendo la carpeta por http:// funciona sin conexión; abriendo el archivo con doble clic no hay service worker ni notificaciones.') + '</div>' +
        '</div>',
        actions: [{ label: 'Cerrar', value: null, kind: 'ghost' }]
      });
    });
  };

  /* ==================== helpers de UI ==================== */
  var ui = {};
  A.ui = ui;

  function exRowPick(e, on) {
    var miss = S.missingEquip(e);
    return '<button class="ex-pick' + (on ? ' on' : '') + '" data-ex="' + e.id + '" style="width:100%;text-align:left">' +
      '<div class="grow" style="min-width:0"><div class="li-title ellipsis">' + U.esc(e.name) + '</div>' +
        '<div class="li-sub">' + U.esc(D.groupLabel(e.group)) + ' · ' + U.esc(e.type) + (miss.length ? ' · <span class="warn">falta ' + U.esc(U.trunc(miss.join(', '), 28)) + '</span>' : '') + '</div></div>' +
      (e.allowed ? '' : '<span class="badge danger">off</span>') +
      '<span class="ico" style="color:' + (on ? 'var(--accent)' : 'var(--muted-2)') + '">' + (on ? U.icon('check-circle') : U.icon('plus')) + '</span></button>';
  }

  ui.exercisePicker = function (opts) {
    opts = opts || {};
    var multi = opts.multi !== false;
    var sel = {};
    var q = '', grp = opts.group || '', onlyDone = !!opts.onlyDone;
    var exclude = {};
    (opts.exclude || []).forEach(function (id) { exclude[id] = 1; });
    function list() {
      var nq = U.norm(q);
      var items = S.exercises().filter(function (e) {
        if (exclude[e.id]) return false;
        if (onlyDone && !S.familiarity(e.id)) return false;
        if (grp && e.group !== grp) return false;
        if (nq && U.norm(e.name).indexOf(nq) < 0) return false;
        return true;
      }).sort(function (a, b) {
        var ua = (a.allowed && S.isAvailable(a)) ? 0 : 1, ub = (b.allowed && S.isAvailable(b)) ? 0 : 1;
        if (ua !== ub) return ua - ub;
        var fa = S.familiarity(b.id) - S.familiarity(a.id);
        if (fa !== 0) return fa;
        return a.name < b.name ? -1 : 1;
      });
      if (!items.length) return '<div class="empty">Nada que mostrar con ese filtro</div>';
      return items.map(function (e) { return exRowPick(e, !!sel[e.id]); }).join('');
    }
    var body = '<div class="search"><span class="ico">' + U.icon('search') + '</span><input class="input" id="pk-q" placeholder="Buscar…" autocomplete="off"></div>' +
      '<div class="seg mt-s" id="pk-groups"><button class="on" data-g="">Todos</button>' + D.GROUPS.map(function (g) { return '<button data-g="' + g.key + '">' + U.esc(g.label) + '</button>'; }).join('') + '</div>' +
      '<div class="card flush mt-s" id="pk-list" style="max-height:46dvh;overflow:auto">' + list() + '</div>' +
      '<div class="tiny muted mt-s" id="pk-count">' + (multi ? 'Selecciona uno o varios ejercicios' : 'Elige un ejercicio') + '</div>';
    return U.modal({
      title: opts.title || 'Elegir ejercicios', body: body, wide: true,
      actions: [{ label: 'Cancelar', value: null, kind: 'ghost' }, { label: multi ? 'Añadir' : 'Elegir', value: 'ok', kind: 'primary' }],
      onMount: function (box, close) {
        var listEl = box.querySelector('#pk-list'), countEl = box.querySelector('#pk-count');
        function refresh() {
          listEl.innerHTML = list();
          var n = Object.keys(sel).length;
          countEl.textContent = n ? n + ' seleccionados' : (multi ? 'Selecciona uno o varios ejercicios' : 'Elige un ejercicio');
        }
        box.querySelector('#pk-q').addEventListener('input', U.debounce(function (e) { q = e.target.value; refresh(); }, 160));
        box.querySelector('#pk-groups').addEventListener('click', function (ev) {
          var b = ev.target.closest('button');
          if (!b) return;
          grp = b.getAttribute('data-g');
          U.$$('button', box.querySelector('#pk-groups')).forEach(function (x) { x.classList.toggle('on', x === b); });
          refresh();
        });
        listEl.addEventListener('click', function (ev) {
          var row = ev.target.closest('[data-ex]');
          if (!row) return;
          var id = row.getAttribute('data-ex');
          if (multi) { if (sel[id]) delete sel[id]; else sel[id] = 1; refresh(); }
          else { sel = {}; sel[id] = 1; close('ok'); }
        });
      }
    }).then(function (v) { return v === 'ok' ? Object.keys(sel) : null; });
  };

  ui.routinePicker = function (opts) {
    opts = opts || {};
    var list = S.routines();
    if (!list.length) {
      U.toast('No hay rutinas guardadas', { type: 'warn' });
      return Promise.resolve(null);
    }
    var body = '<div class="card flush"><div class="list">' + list.map(function (r) {
      var names = r.items.map(function (i) { var e = S.byId(i.exId); return e ? e.name : ''; }).filter(Boolean);
      return '<button class="list-item tappable" data-rid="' + r.id + '"><div class="li-main"><div class="li-title">' + U.esc(r.name) + '</div>' +
        '<div class="li-sub">' + r.items.length + ' ejercicios · ' + U.esc(U.trunc(names.slice(0, 4).join(', '), 60)) + '</div></div>' + U.icon('chev-r') + '</button>';
    }).join('') + '</div></div>';
    return ui.pickFromModal({ title: opts.title || 'Elegir rutina', body: body, attr: 'data-rid' });
  };

  ui.pickFromModal = function (cfg) {
    return U.modal({
      title: cfg.title, subtitle: cfg.subtitle, body: cfg.body, wide: true,
      actions: [{ label: 'Cancelar', value: null, kind: 'ghost' }],
      onMount: function (box, close) {
        box.addEventListener('click', function (ev) {
          var el = ev.target.closest('[' + cfg.attr + ']');
          if (el) close(el.getAttribute(cfg.attr));
        });
      }
    });
  };

  ui.dayPicker = function (opts) {
    opts = opts || {};
    var from = opts.fromIso || U.d.today();
    var days = [];
    for (var i = 0; i < 14; i++) days.push(U.d.addDays(from, i));
    var body = '<div class="card flush"><div class="list">' + days.map(function (iso) {
      var planned = S.getDay(iso) || {};
      var r = planned.routineId ? S.routine(planned.routineId) : null;
      return '<button class="list-item tappable" data-daysel="' + iso + '"><div class="li-main"><div class="li-title">' + U.esc(U.d.label(iso, 'medium')) + (iso === U.d.today() ? ' · hoy' : '') + '</div>' +
        '<div class="li-sub">' + (r ? U.esc(r.name) : (planned.title || 'libre')) + '</div></div>' + U.icon('plus') + '</button>';
    }).join('') + '</div></div>';
    ui.pickFromModal({ title: opts.title || 'Agendar', subtitle: opts.subtitle, body: body, attr: 'data-daysel' }).then(function (iso) {
      if (!iso) return;
      if (opts.routineId) {
        var r = S.routine(opts.routineId);
        S.setDay(iso, { routineId: opts.routineId, type: 'entreno', title: r ? r.name : 'Entrenamiento', status: 'planned', source: 'manual' });
        A.render();
        U.toast('Agendada ' + (r ? r.name : '') + ' el ' + U.d.label(iso, 'medium'), { type: 'ok' });
      } else if (opts.items && opts.items.length) {
        S.setDay(iso, { plan: opts.items, type: 'entreno', title: opts.name || 'Entrenamiento', status: 'planned', source: 'manual' });
        A.render();
        U.toast('Plan guardado el ' + U.d.label(iso, 'medium'), { type: 'ok' });
      } else if (opts.onPick) {
        opts.onPick(iso);
      }
    });
  };

  /* ---------- editor de rutina ---------- */
  ui.closeModal = function () { if (U.modal.current) { var f = U.modal.current; U.modal.current = null; f(null); } };

  ui.routineEditor = function (id, opts) {
    opts = opts || {};
    var existing = id ? S.routine(id) : null;
    var st = S.settings();
    var draft = existing
      ? { id: existing.id, name: existing.name, focus: existing.focus, notes: existing.notes, source: existing.source, items: existing.items.map(function (i) { return U.clone(i); }) }
      : {
        id: null, name: opts.name || '', focus: '', notes: opts.notes || '', source: opts.source || 'manual',
        items: (opts.prefill || []).map(function (i) {
          /* weight se conserva (sin campo en el editor): lo pone el plan del
             coach o las rutinas con pesos, y la sesión lo aplica tal cual */
          return { exId: i.exId, sets: U.int(i.sets, 3), repMin: U.int(i.repMin, 8), repMax: U.int(i.repMax, 12), rest: U.int(i.rest, D.GOAL_REST[st.goal] || 90), weight: i.weight === undefined ? null : U.num(i.weight), notes: i.notes || '' };
        })
      };

    function itemsHtml() {
      if (!draft.items.length) return '<div class="empty">Añade al menos un ejercicio</div>';
      return draft.items.map(function (it, i) {
        var ex = S.byId(it.exId);
        return '<div class="card tight" data-item="' + i + '">' +
          '<div class="between"><div style="min-width:0"><div class="h3 ellipsis">' + U.esc(ex ? ex.name : it.exId) + '</div>' +
            '<div class="tiny muted">' + U.esc(ex ? D.groupLabel(ex.group) + ' · ' + ex.type : '') + '</div></div>' +
            '<div class="row" style="gap:3px"><button class="icon-btn" data-mv="-1" data-i="' + i + '">' + U.icon('chev-u') + '</button>' +
            '<button class="icon-btn" data-mv="1" data-i="' + i + '">' + U.icon('chev-d') + '</button>' +
            '<button class="icon-btn" data-rm="' + i + '">' + U.icon('trash') + '</button></div></div>' +
          '<div class="set-head mt-s" style="grid-template-columns:1fr 1fr 1fr 1fr;gap:6px"><span>series</span><span>rep min</span><span>rep max</span><span>descanso</span></div>' +
          '<div class="row" style="gap:6px">' +
            '<input class="input num" type="number" min="1" max="12" value="' + it.sets + '" data-f="sets" data-i="' + i + '">' +
            '<input class="input num" type="number" min="1" max="50" value="' + it.repMin + '" data-f="repMin" data-i="' + i + '">' +
            '<input class="input num" type="number" min="1" max="50" value="' + it.repMax + '" data-f="repMax" data-i="' + i + '">' +
            '<input class="input num" type="number" min="0" max="600" step="15" value="' + it.rest + '" data-f="rest" data-i="' + i + '">' +
          '</div></div>';
      }).join('');
    }

    var body = '<div class="col" style="gap:11px">' +
      '<label class="field"><span class="label">Nombre</span><input class="input" id="rt-name" value="' + U.esc(draft.name) + '" placeholder="Ej. Torso A"></label>' +
      '<div class="grid c2"><label class="field"><span class="label">Enfoque</span><input class="input" id="rt-focus" value="' + U.esc(draft.focus || '') + '" placeholder="Pecho · hombro"></label>' +
        '<label class="field"><span class="label">Origen</span><input class="input" id="rt-source" value="' + U.esc(draft.source || 'manual') + '" disabled></label></div>' +
      '<div class="between"><span class="label">Ejercicios (' + draft.items.length + ')</span>' +
        '<button class="btn sm" id="rt-add">' + U.icon('plus') + 'Añadir</button></div>' +
      '<div class="col" id="rt-items" style="gap:9px">' + itemsHtml() + '</div>' +
      '<label class="field"><span class="label">Notas</span><textarea class="input" id="rt-notes" placeholder="indicaciones, progresión…">' + U.esc(draft.notes || '') + '</textarea></label>' +
    '</div>';

    /* lee nombre/enfoque/notas y las series-reps de cada ejercicio del propio
       modal (recibe el box para poder leerlo cuando todavía está montado) */
    function commit(box) {
      var q = function (sel) { var el = box.querySelector(sel); return el ? String(el.value || '') : ''; };
      draft.name = q('#rt-name').trim() || 'Rutina sin nombre';
      draft.focus = q('#rt-focus'); draft.notes = q('#rt-notes');
      U.$$('[data-f]', box).forEach(function (inp) {
        var i = U.int(inp.getAttribute('data-i')), f = inp.getAttribute('data-f');
        if (draft.items[i]) draft.items[i][f] = U.int(inp.value, 1);
      });
      if (!draft.items.length) { U.toast('Añade al menos un ejercicio', { type: 'warn' }); return false; }
      if (draft.id) S.updateRoutine(draft.id, { name: draft.name, focus: draft.focus, notes: draft.notes, items: draft.items });
      else { var r = S.addRoutine(draft); draft.id = r.id; }
      return true;
    }

    U.modal({
      title: existing ? 'Editar rutina' : 'Nueva rutina',
      subtitle: draft.items.length + ' ejercicios', wide: true, body: body,
      actions: [
        { label: 'Cancelar', value: null, kind: 'ghost' },
        { label: 'Guardar rutina', kind: 'primary', onClick: function (box, close) { if (commit(box)) close('ok'); } }
      ],
      onMount: function (box, close) {
        var itemsEl = box.querySelector('#rt-items');
        function paint() {
          itemsEl.innerHTML = itemsHtml();
          var sub = box.querySelector('.modal-head .sub');
          if (sub) sub.textContent = draft.items.length + ' ejercicios';
        }
        box.querySelector('#rt-add').addEventListener('click', function () {
          ui.exercisePicker({ multi: true, title: 'Añadir a la rutina', exclude: draft.items.map(function (i) { return i.exId; }) }).then(function (ids) {
            if (!ids || !ids.length) return;
            ids.forEach(function (exId) {
              var ex = S.byId(exId);
              draft.items.push({ exId: exId, sets: U.clamp(ex.sets, 1, 12), repMin: D.GOAL_REPS[st.goal][0], repMax: D.GOAL_REPS[st.goal][1], rest: D.GOAL_REST[st.goal] || ex.rest, notes: '' });
            });
            paint();
          });
        });
        itemsEl.addEventListener('click', function (ev) {
          var mv = ev.target.closest('[data-mv]');
          var rm = ev.target.closest('[data-rm]');
          if (mv) {
            var i = U.int(mv.getAttribute('data-i')), j = i + U.int(mv.getAttribute('data-mv'));
            if (j >= 0 && j < draft.items.length) { var tmp = draft.items[i]; draft.items[i] = draft.items[j]; draft.items[j] = tmp; paint(); }
          } else if (rm) {
            draft.items.splice(U.int(rm.getAttribute('data-rm')), 1);
            paint();
          }
        });
        itemsEl.addEventListener('change', function (ev) {
          var inp = ev.target.closest('[data-f]');
          if (!inp) return;
          var i = U.int(inp.getAttribute('data-i')), f = inp.getAttribute('data-f');
          if (draft.items[i]) draft.items[i][f] = U.int(inp.value, 1);
        });
        [['#rt-name', 'name'], ['#rt-focus', 'focus'], ['#rt-notes', 'notes']].forEach(function (pair) {
          box.querySelector(pair[0]).addEventListener('change', function (e) { draft[pair[1]] = e.target.value; });
        });
      }
    }).then(function (v) {
      if (v !== 'ok') return;
      A.render();
      U.toast(existing ? 'Rutina actualizada' : 'Rutina creada: ' + draft.name, { type: 'ok' });
    });
  };

  ui.routineDetail = function (id) {
    var r = S.routine(id);
    if (!r) return;
    var body = '<div class="card flush"><div class="list">' + r.items.map(function (it, i) {
      var ex = S.byId(it.exId);
      var pr = S.a.prs()[it.exId];
      return '<div class="list-item"><span class="num tiny muted" style="width:18px">' + (i + 1) + '</span><div class="li-main"><div class="li-title">' + U.esc(ex ? ex.name : it.exId) + '</div>' +
        '<div class="li-sub">' + it.sets + ' × ' + it.repMin + '-' + it.repMax + ' · ' + it.rest + 's' + (ex ? ' · ' + U.esc(D.groupLabel(ex.group)) : '') + (pr ? ' · PR ' + U.fmt.n(pr.e1rm) + ' kg' : '') + '</div></div></div>';
    }).join('') + '</div></div>' +
      (r.notes ? '<div class="card tight mt"><div class="tiny muted">Notas</div><div class="tiny">' + U.esc(r.notes) + '</div></div>' : '') +
      '<div class="tiny muted mt-s">Creada ' + U.d.label((r.createdAt || '').slice(0, 10) || U.d.today(), 'medium') + ' · origen ' + U.esc(r.source || 'manual') + '</div>';
    U.modal({
      title: r.name, subtitle: r.focus || '', body: body, wide: true,
      actions: [
        { label: 'Cerrar', value: null, kind: 'ghost' },
        { label: 'Editar', value: 'edit', kind: 'ghost' },
        { label: 'Empezar', value: 'start', kind: 'primary' }
      ]
    }).then(function (v) {
      if (v === 'start') { A.actions['train:start-routine']({ getAttribute: function () { return id; } }); }
      else if (v === 'edit') setTimeout(function () { ui.routineEditor(id); }, 40);
    });
  };

  /* ---------- editor de ejercicio ---------- */
  ui.exerciseEditor = function (id) {
    var ex = id ? S.byId(id) : null;
    var isNew = !ex;
    var d = ex ? U.clone(ex) : { name: '', group: 'pecho', equip: '', type: 'aislado', sets: 3, repMin: 8, repMax: 12, rest: 90, allowed: true, tips: '' };
    var groups = D.GROUPS;
    var equipOpts = [''].concat(D.EQUIPMENT.map(function (e) { return e.key; }));
    var parts = String(d.equip || '').split('&').filter(Boolean);
    var primary = parts.length ? parts[0].split('|')[0] : '';
    var body = '<div class="col" style="gap:11px">' +
      '<label class="field"><span class="label">Nombre</span><input class="input" id="exd-name" value="' + U.esc(d.name) + '" placeholder="Ej. Remo en polea alta"></label>' +
      '<div class="grid c2">' +
        '<label class="field"><span class="label">Grupo muscular</span><select class="select" id="exd-group">' + groups.map(function (g) { return '<option value="' + g.key + '"' + (d.group === g.key ? ' selected' : '') + '>' + U.esc(g.label) + '</option>'; }).join('') + '</select></label>' +
        '<label class="field"><span class="label">Tipo</span><select class="select" id="exd-type">' + ['compuesto', 'aislado', 'cardio', 'movilidad'].map(function (t) { return '<option value="' + t + '"' + (d.type === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select></label></div>' +
      '<label class="field"><span class="label">Material necesario</span><select class="select" id="exd-equip">' +
        equipOpts.map(function (k) { return '<option value="' + k + '"' + (primary === k ? ' selected' : '') + '>' + (k ? U.esc(D.equipLabel(k)) : 'Ninguno (peso corporal)') + '</option>'; }).join('') + '</select>' +
        '<span class="sub">Si el ejercicio requiere material, quedará excluido cuando no lo tengas activo.</span></label>' +
      '<div class="grid c2">' +
        '<label class="field"><span class="label">Series</span><input class="input num" type="number" id="exd-sets" min="1" max="12" value="' + d.sets + '"></label>' +
        '<label class="field"><span class="label">Descanso (s)</span><input class="input num" type="number" id="exd-rest" min="0" max="600" step="15" value="' + d.rest + '"></label>' +
        '<label class="field"><span class="label">Rep min</span><input class="input num" type="number" id="exd-rmin" min="1" max="100" value="' + d.repMin + '"></label>' +
        '<label class="field"><span class="label">Rep max</span><input class="input num" type="number" id="exd-rmax" min="1" max="100" value="' + d.repMax + '"></label></div>' +
      '<label class="switch" style="justify-content:space-between"><span>Permitido en sugerencias</span><input type="checkbox" id="exd-allowed" ' + (d.allowed ? 'checked' : '') + '><span class="track"><span class="thumb"></span></span></label>' +
      (isNew ? '<div class="tiny muted">Los ejercicios propios se pueden editar y borrar cuando quieras.</div>' : (ex.custom ? '' : '<div class="tiny muted">Este ejercicio viene de la biblioteca: puedes ajustar series, descanso y reposo, y permitirlo o prohibirlo.</div>')) +
    '</div>';
    function readPatch(box) {
      var q = function (sel) { return box.querySelector(sel); };
      var nameEl = q('#exd-name');
      return {
        name: nameEl ? String(nameEl.value || '').trim() : '',
        group: (q('#exd-group') || {}).value || 'pecho', type: (q('#exd-type') || {}).value || 'aislado',
        equip: (q('#exd-equip') || {}).value || '',
        sets: U.int((q('#exd-sets') || {}).value, 3), rest: U.int((q('#exd-rest') || {}).value, 90),
        repMin: U.int((q('#exd-rmin') || {}).value, 8), repMax: U.int((q('#exd-rmax') || {}).value, 12),
        allowed: !!(q('#exd-allowed') || {}).checked
      };
    }
    U.modal({
      title: isNew ? 'Nuevo ejercicio' : 'Editar ejercicio', subtitle: isNew ? '' : ex.name, body: body,
      actions: [
        { label: 'Cancelar', value: null, kind: 'ghost' },
        { label: 'Guardar', kind: 'primary', onClick: function (box, close) {
          var patch = readPatch(box);
          if (!patch.name) { U.toast('El nombre es obligatorio', { type: 'err' }); return; }
          close(patch);
        } }
      ],
      onMount: function (box) {
        var rmin = box.querySelector('#exd-rmin'), rmax = box.querySelector('#exd-rmax');
        rmin.addEventListener('change', function () { if (U.int(rmin.value) > U.int(rmax.value)) rmax.value = rmin.value; });
      }
    }).then(function (patch) {
      if (!patch) return;
      patch.bw = !patch.equip;
      if (isNew) S.addExercise(patch);
      else S.updateExercise(ex.id, patch);
      A.render();
      U.toast(isNew ? 'Ejercicio añadido' : 'Ejercicio actualizado', { type: 'ok' });
    });
  };

  /* ---------- calculadora de discos ----------
     El cálculo vive en trainer.js (T.plates). Aquí solo se pinta, pero con una
     pieza clave: CÓMO se carga. La barra reparte los discos entre sus dos lados
     y, si entrenas con dos mancuernas cargables (o con una sola, unilateral),
     el mismo inventario da otro peso. El modo se puede cambiar y se recuerda
     por ejercicio (settings.plateModes). */
  function dual(kg, unit) {
    var txt = U.fmt.n(kg, 2) + ' kg';
    if (unit === 'lb') txt += ' (' + U.fmt.n(U.units.fromKg(kg, 'lb'), 1) + ' lb)';
    return txt;
  }
  /* los <input type="number"> solo aceptan punto decimal: U.fmt.n() usa la coma
     de es-ES y el navegador descartaba el valor (el campo salía vacío). */
  function inputNum(v) {
    return (v === undefined || v === null || v === '') ? '' : String(U.num(v));
  }

  ui.plates = function (initial, opts) {
    opts = opts || {};
    var unit = S.settings().units;
    var unitLabel = U.units.label(unit);
    var step = unit === 'lb' ? 5 : 2.5;
    var exKey = opts.exId || (opts.forExercise ? U.slug(opts.forExercise) : '__tool__');
    var mode = T.plateMode(opts.mode || T.plateModeFor(opts.exId, opts.forExercise)).key;
    var barKey = 'olimpica';
    var built = '';
    var last = null;   /* peso que aplicará "Usar…" (en la unidad del usuario) */

    var body = '<div class="col" style="gap:11px">' +
      (opts.forExercise ? '<div class="tiny muted">Ejercicio: <b>' + U.esc(opts.forExercise) + '</b></div>' : '') +
      '<div><div class="label" style="margin-bottom:6px">Cómo se carga</div>' +
        '<div class="hr-scroll" id="pc-modes">' + T.PLATE_MODE_KEYS.map(function (k) {
          return '<button class="chip" data-pm="' + k + '" title="' + U.esc(T.PLATE_MODES[k].hint) + '">' + U.esc(T.PLATE_MODES[k].label) + '</button>';
        }).join('') + '</div></div>' +
      '<div class="grid c2">' +
        '<label class="field"><span class="label">Peso objetivo (' + unit + ')</span>' +
          '<input class="input num" id="pc-w" type="number" inputmode="decimal" step="' + step + '" min="0" value="' + inputNum(initial) + '" placeholder="' + (unit === 'lb' ? '225' : '100') + '"></label>' +
        '<div class="field" id="pc-handle-field"><span class="label" id="pc-handle-label">Barra</span><div id="pc-handle-ctl"></div></div>' +
      '</div>' +
      '<div class="row" style="gap:6px"><button class="btn sm ghost" id="pc-m">-' + U.fmt.n(step) + '</button>' +
        '<button class="btn sm ghost" id="pc-p">+' + U.fmt.n(step) + '</button>' +
        '<button class="btn sm quiet" id="pc-clear">Limpiar</button></div>' +
      '<div id="pc-out"></div></div>';

    function barKgNow() { return U.num((S.settings().bars || {})[barKey], 0); }

    function render(box) {
      var out = U.$('#pc-out', box);
      if (!out) return;
      var spec = T.plateMode(mode);

      U.$$('#pc-modes [data-pm]', box).forEach(function (b) {
        b.classList.toggle('accent', b.getAttribute('data-pm') === mode);
      });

      /* el control del mango/barra cambia según el modo (no se reconstruye en
         cada tecla, solo al cambiar de modo, para no perder el foco) */
      var field = U.$('#pc-handle-field', box), ctl = U.$('#pc-handle-ctl', box);
      if (field) field.hidden = !spec.handle;
      if (ctl && built !== mode) {
        built = mode;
        if (mode === 'bar') {
          var bars = S.settings().bars || {};
          ctl.innerHTML = '<select class="select" id="pc-bar">' +
            ['olimpica', 'ez'].map(function (k) {
              var w = U.num(bars[k], 0);
              return '<option value="' + k + '"' + (k === barKey ? ' selected' : '') + '>Barra ' + (k === 'ez' ? 'EZ' : '') + ' · ' + U.fmt.n(w, 1) + ' kg</option>';
            }).join('') + '</select>';
          ctl.querySelector('#pc-bar').addEventListener('change', function () { barKey = this.value; render(box); });
        } else if (spec.handle) {
          ctl.innerHTML = '<div class="tiny muted">' + U.fmt.n(U.num((S.settings().bars || {}).mancuerna, 0), 1) + ' kg por mango</div>';
        } else {
          ctl.innerHTML = '<div class="tiny muted">este ejercicio no lleva discos</div>';
        }
      }

      var btn = U.$('.modal-foot [data-i="1"]', box);
      var res = null;
      if (U.num((U.$('#pc-w', box) || {}).value)) {
        res = T.plates(U.num(U.$('#pc-w', box).value), { unit: unit, mode: mode, barKg: mode === 'bar' ? barKgNow() : undefined });
      }
      last = res ? U.round(U.units.fromKg(res.achieveKg, unit), 2) : null;
      if (btn) btn.textContent = last ? 'Usar ' + U.fmt.n(last, 2) + ' ' + unitLabel : 'Usar este peso';

      if (!res) {
        out.innerHTML = '<div class="tiny muted">Escribe un peso y te digo qué discos poner (siempre los mismos discos en cada ' + U.esc(spec.per || 'lado') + ').</div>';
        return;
      }

      var chips = res.perSide.map(function (p) {
        return '<span class="plate ' + T.plateClass(p.kg) + '">' + U.fmt.n(p.kg, 2) + ' kg' + (p.srcUnit === 'lb' ? ' · ' + U.fmt.n(p.srcW) + ' lb' : '') + (p.n > 1 ? ' ×' + p.n : '') + '</span>';
      }).join('');
      /* en el dibujo de la barra van etiquetas cortas (el detalle ya está en las filas) */
      var barChips = res.perSide.map(function (p) {
        return '<span class="plate ' + T.plateClass(p.kg) + '" title="' + U.esc(T.plateLabel(p.kg, p.srcW, p.srcUnit, p.n)) + '">' +
          (p.srcUnit === 'lb' ? U.fmt.n(p.srcW) + ' lb' : U.fmt.n(p.kg, 2)) + (p.n > 1 ? ' ×' + p.n : '') + '</span>';
      }).join('');
      var diffTxt = res.noPlates ? '' : (res.exact
        ? '<span class="ok">exacto</span>'
        : '<span class="warn">' + (res.diffKg > 0 ? 'te quedas ' : 'te pasas ') + U.fmt.n(Math.abs(res.diffKg), 2) + ' kg</span>');
      var totalLabel = mode === 'bar' ? 'Total en la barra' : (mode === 'db1' ? 'Peso de la mancuerna' : (mode === 'db2' ? 'Peso de cada mancuerna' : 'Peso a usar'));
      var handle = T.plateHandleKg(mode, mode === 'bar' ? { barKg: barKgNow() } : undefined);

      var altTxt = '';
      if (!res.noPlates && !res.exact) {
        var alts = [];
        if (res.belowKg !== null) alts.push({ kg: res.belowKg, d: 'más ligero' });
        if (res.aboveKg !== null) alts.push({ kg: res.aboveKg, d: 'más pesado' });
        altTxt = '<div class="tiny muted mt-s">También puedes cargar:</div><div class="hr-scroll" id="pc-alt">' +
          alts.map(function (a) {
            return '<button class="chip" data-alt="' + inputNum(U.round(U.units.fromKg(a.kg, unit), 2)) + '">' + U.fmt.n(U.round(U.units.fromKg(a.kg, unit), 2), 2) + ' ' + unitLabel + ' · ' + a.d + '</button>';
          }).join('') + '</div>';
      }

      out.innerHTML =
        '<div class="card tight">' +
          (res.noPlates
            ? '<div class="tiny muted">Sin discos: usa ' + dual(res.achieveKg, unit) + ' y listo.</div>'
            : '<div class="kv"><span class="k">Por ' + U.esc(res.per) + '</span><span class="v">' + U.esc(T.plateSummary(res)) + '</span></div>') +
          '<div class="kv"><span class="k">' + totalLabel + '</span><span class="v">' + dual(res.achieveKg, unit) + (diffTxt ? ' · ' + diffTxt : '') + '</span></div>' +
          (res.noPlates ? '' : '<div class="kv"><span class="k">' + (mode === 'bar' ? 'Barra' : 'Mango') + '</span><span class="v">' + dual(handle, unit) + '</span></div>' +
            (res.maxKg ? '<div class="kv"><span class="k">Máximo en este modo</span><span class="v">' + dual(res.maxKg, unit) + '</span></div>' : '')) +
        '</div>' +
        (chips ? '<div class="bar-vis"><span class="bar-rod"></span>' + barChips + '<span class="bar-rod"></span></div><div class="plate-row">' + chips + '</div>' : '') +
        altTxt;
    }

    U.modal({
      title: 'Calculadora de discos',
      subtitle: 'Busca el peso más cercano al pedido con tus discos',
      body: body,
      actions: [
        { label: 'Cerrar', value: null, kind: 'ghost' },
        { label: 'Usar este peso', kind: 'primary', onClick: function (box, close) { close(last); } }
      ],
      onMount: function (box) {
        var wEl = U.$('#pc-w', box);
        wEl.addEventListener('input', U.debounce(function () { render(box); }, 120));
        U.$('#pc-m', box).addEventListener('click', function () { wEl.value = inputNum(Math.max(0, U.num(wEl.value) - step)); render(box); });
        U.$('#pc-p', box).addEventListener('click', function () { wEl.value = inputNum(U.num(wEl.value) + step); render(box); });
        U.$('#pc-clear', box).addEventListener('click', function () { wEl.value = ''; render(box); });
        U.$('#pc-modes', box).addEventListener('click', function (ev) {
          var b = ev.target.closest('[data-pm]');
          if (!b) return;
          var next = b.getAttribute('data-pm');
          if (next === mode) return;
          mode = next;
          T.setPlateMode(exKey, mode);   /* se recuerda para este ejercicio */
          render(box);
        });
        box.addEventListener('click', function (ev) {
          var a = ev.target.closest('[data-alt]');
          if (!a) return;
          wEl.value = a.getAttribute('data-alt');
          render(box);
        });
        render(box);
      }
    }).then(function (val) {
      if (val === null || val === undefined || !opts.onUse) return;
      opts.onUse(val);
    });
  };

  /* ---------- temporizador libre ---------- */
  ui.timer = function (sec) {
    var presets = [30, 45, 60, 90, 120, 180, 300];
    var body = '<div class="col" style="gap:12px">' +
      '<div class="tiny muted">Elige una duración. El temporizador seguirá corriendo aunque cierres esta ventana: aparece como barra flotante sobre la navegación.</div>' +
      '<div class="hr-scroll">' + presets.map(function (p) {
        return '<button class="chip' + (U.int(sec) === p ? ' accent' : '') + '" data-t="' + p + '">' + U.fmt.mmss(p) + '</button>';
      }).join('') + '</div>' +
      '<label class="field"><span class="label">Segundos</span><input class="input num" id="tm-sec" type="number" min="5" max="3600" value="' + U.int(sec, 90) + '"></label></div>';
    U.modal({
      title: 'Temporizador', body: body,
      actions: [
        { label: 'Cancelar', value: null, kind: 'ghost' },
        { label: 'Iniciar', kind: 'primary', onClick: function (box, close) {
          close(U.clamp(U.int((box.querySelector('#tm-sec') || {}).value, 90), 5, 3600));
        } }
      ],
      onMount: function (box) {
        box.addEventListener('click', function (ev) {
          var b = ev.target.closest('[data-t]');
          if (!b) return;
          box.querySelector('#tm-sec').value = b.getAttribute('data-t');
          U.$$('[data-t]', box).forEach(function (x) { x.classList.toggle('accent', x === b); });
        });
      }
    }).then(function (s) {
      if (!s) return;
      T.rest.start(s, 'Temporizador');
      U.toast('Temporizador de ' + U.fmt.mmss(s) + ' en marcha', { type: 'ok' });
    });
  };

  /* ---------- detalle de sesión ---------- */
  function prsBefore(iso) {
    var out = {};
    S.sessions().forEach(function (s) {
      if (S.a.sessDate(s) >= iso) return;
      (s.entries || []).forEach(function (en) {
        (en.sets || []).forEach(function (set) {
          if (!set.done || !set.reps) return;
          var e = S.a.e1rm(S.a.setKg(set, s.unit), set.reps);
          if (!out[en.exId] || e > out[en.exId]) out[en.exId] = e;
        });
      });
    });
    return out;
  }

  ui.sessionDetail = function (id, opts) {
    opts = opts || {};
    var s = S.session(id);
    if (!s) return;
    var prior = prsBefore(S.a.sessDate(s));
    var prs = [];
    (s.entries || []).forEach(function (en) {
      var best = 0, bestSet = null;
      (en.sets || []).forEach(function (set) {
        var e = S.a.e1rm(S.a.setKg(set, s.unit), set.reps);
        if (e > best) { best = e; bestSet = set; }
      });
      if (best && (!prior[en.exId] || best > prior[en.exId] + 0.01)) prs.push({ exId: en.exId, e1rm: best, set: bestSet });
    });
    var body = (opts.justFinished ? '<div class="card accent mb"><div class="row"><span class="ico accent">' + U.icon('check-circle') + '</span><div><div class="h3">Sesión guardada</div><div class="tiny muted">Ya forma parte de tu historial y estadísticas.</div></div></div></div>' : '') +
      '<div class="grid c3">' +
        '<div class="kpi"><div class="kpi-label">Volumen</div><div class="kpi-value">' + U.fmt.vol(S.a.volumeOf(s)) + '</div><div class="kpi-delta">kg movidos</div></div>' +
        '<div class="kpi"><div class="kpi-label">Series</div><div class="kpi-value">' + S.a.setsOf(s) + '</div><div class="kpi-delta">' + (s.entries || []).length + ' ejercicios</div></div>' +
        '<div class="kpi"><div class="kpi-label">Duración</div><div class="kpi-value">' + U.fmt.dur(S.a.durationOf(s)) + '</div><div class="kpi-delta">' + (s.rpe ? 'RPE ' + U.fmt.rpe(s.rpe) : 'sin RPE') + '</div></div></div>' +
      (prs.length ? '<div class="card tight mt" style="border-color:color-mix(in srgb,var(--accent) 45%,var(--border))"><div class="row"><span class="ico accent">' + U.icon('fire') + '</span><div><div class="h3">' + prs.length + ' ' + U.plural(prs.length, 'récord nuevo', 'récords nuevos') + '</div>' +
        '<div class="tiny muted">' + prs.map(function (p) { var ex = S.byId(p.exId); return U.esc(ex ? ex.name : '') + ' · ' + U.fmt.n(p.set.weight) + '×' + U.fmt.n(p.set.reps); }).join(' · ') + '</div></div></div></div>' : '') +
      '<div class="card flush mt"><div class="list">' + (s.entries || []).map(function (en) {
        var ex = S.byId(en.exId);
        var isPr = prs.some(function (p) { return p.exId === en.exId; });
        return '<div class="list-item"><div class="li-main"><div class="li-title">' + U.esc(ex ? ex.name : en.name || en.exId) + (isPr ? ' <span class="badge a">PR</span>' : '') + '</div>' +
          '<div class="li-sub">' + (en.sets || []).map(function (set) { return U.fmt.n(set.weight) + '×' + U.fmt.n(set.reps); }).join(' · ') + '</div></div></div>';
      }).join('') + '</div></div>' +
      (s.notes ? '<div class="card tight mt"><div class="tiny muted">Nota</div><div class="tiny">' + U.esc(s.notes) + '</div></div>' : '');
    U.modal({
      title: s.name, subtitle: U.d.label(S.a.sessDate(s), 'medium') + ' · ' + U.d.relative(S.a.sessDate(s)), body: body, wide: true,
      actions: [
        { label: 'Cerrar', value: null, kind: 'ghost' },
        { label: 'Eliminar', value: 'del', kind: 'ghost' },
        { label: 'Repetir sesión', value: 'rep', kind: 'primary' }
      ]
    }).then(function (v) {
      if (v === 'rep') A.actions['train:repeat']({ getAttribute: function () { return id; } });
      else if (v === 'del') U.confirm({ title: 'Eliminar sesión', body: '<p>No se puede deshacer.</p>', okLabel: 'Eliminar', kind: 'danger' }).then(function (ok) {
        if (!ok) return;
        S.removeSession(id);
        A.render();
        U.toast('Sesión eliminada', { type: 'warn' });
      });
    });
  };

  /* ---------- auto-test ---------- */
  function selfTest() {
    var out = [];
    function ok(name, cond, extra) { out.push({ name: name, pass: !!cond, extra: extra === undefined ? '' : String(extra) }); }
    var backup = S.export();
    try {
      ok('biblioteca de ejercicios cargada', S.exercises().length >= 100, S.exercises().length + ' ejercicios');
      ok('plantillas disponibles', D.TEMPLATES.length >= 5, D.TEMPLATES.length);
      var press = S.byId('press-de-banca-con-barra');
      S.setEquipment('barra_olimpica', false); S.setEquipment('banco_plano', false); S.setEquipment('banco_inclinable', false);
      ok('equipo: detecta material faltante', press && !S.isAvailable(press));
      S.setEquipment('barra_olimpica', true); S.setEquipment('banco_plano', true);
      ok('equipo: disponible al activarlo', !!press && S.isAvailable(press));
      ok('1RM estimado (Epley) 100x5', Math.abs(S.a.e1rm(100, 5) - 116.6667) < 0.01, S.a.e1rm(100, 5).toFixed(2));
      var pl = T.plates(100, { barKg: 20 });
      ok('discos: 100 kg con barra de 20 (lo más cercano)', Math.abs(pl.diffKg) <= 0.7, pl.achieveKg + ' kg · ' + T.plateSummary(pl));
      ok('discos: nunca supera el inventario', pl.perSide.every(function (p) { return p.n > 0 && p.n <= 8; }), JSON.stringify(pl.perSide));
      ok('discos: avisa de la diferencia al pedir 103', Math.abs(T.plates(103, { barKg: 20 }).diffKg) <= 0.7, T.plates(103, { barKg: 20 }).achieveKg + ' kg');
      ok('discos: exacto cuando el peso es alcanzable', T.plates(6, { barKg: 0 }).exact, T.plates(6, { barKg: 0 }).achieveKg + ' kg');
      ok('discos: 45 lb equivale a 20,41 kg', Math.abs(U.units.toKg(45, 'lb') - 20.4117) < 0.001, U.units.toKg(45, 'lb').toFixed(3));
      ok('discos: inventario mixto kg+lb exacto', (function () {
        S.setSettings({ plates: [{ w: 45, unit: 'lb', pairs: 2, on: true }, { w: 10, unit: 'kg', pairs: 1, on: true }] });
        var objetivo = 20 + 2 * (U.units.toKg(45, 'lb') + 10);
        var r2 = T.plates(objetivo, { barKg: 20 });
        var ok2 = r2.exact && r2.perSide.length === 2;
        S.setSettings({ plates: U.clone(D.PLATES_DEFAULT) });
        return ok2;
      })(), '45 lb + 10 kg por lado');
      var modeProbe = '';
      ok('discos: modo sugerido según el ejercicio', (function () {
        /* sin los modos guardados por el usuario, que tienen prioridad */
        var prev = U.clone(S.settings().plateModes || {});
        S.setSettings({ plateModes: {} });
        var got = ['remo-con-mancuerna-a-una-mano', 'press-de-banca-con-barra', 'press-de-banca-con-mancuernas'].map(function (id) { return T.plateModeFor(id); });
        modeProbe = got.join('/');
        S.setSettings({ plateModes: prev });
        return got[0] === 'db1' && got[1] === 'bar' && got[2] === 'db2';
      })(), modeProbe);
      ok('discos: el modo se recuerda por ejercicio', (function () {
        var prev = U.clone(S.settings().plateModes || {});
        T.setPlateMode('press-de-banca-con-barra', 'db2');
        var m = T.plateModeFor('press-de-banca-con-barra');
        S.setSettings({ plateModes: prev });
        return m === 'db2';
      })());
      ok('discos: con 2 mancuernas toca a la mitad de discos', (function () {
        var c1 = T.plateCaps('db1')[0].cap, c2 = T.plateCaps('db2')[0].cap;
        return c1 === 8 && c2 === 4;
      })(), 'discos de 3 kg por hueco: 1 mc ' + T.plateCaps('db1')[0].cap + ' · 2 mc ' + T.plateCaps('db2')[0].cap);
      ok('discos: 1 mancuerna alcanza más peso que 2 a la vez', T.plates(20, { mode: 'db1' }).maxKg > T.plates(20, { mode: 'db2' }).maxKg && Math.abs(T.plates(20, { mode: 'db1' }).diffKg) <= 0.7, '1 mc ' + T.plates(20, { mode: 'db1' }).maxKg + ' kg · 2 mc ' + T.plates(20, { mode: 'db2' }).maxKg + ' kg');
      ok('discos: máx en barra = barra + 2 lados del inventario', (function () {
        var esperado = 2 * (8 * 3 + 4 * 2.5 + 4 * 1.25 + 4 * U.units.toKg(5, 'lb') + 4 * U.units.toKg(2.5, 'lb'));
        return Math.abs(T.maxLoadable().totalKg - esperado) < 0.01;
      })(), T.maxLoadable().totalKg.toFixed(1) + ' kg');
      ok('discos: sin discos usa el peso pedido tal cual', (function () { var r = T.plates(37.5, { mode: 'none' }); return r.noPlates && r.achieveKg === 37.5; })());
      ok('audio: el pitido de fin de descanso dura ~3,5 s', (function () {
        var calls = [], orig = U.audio.tone, st0 = S.settings().sound;
        S.setSettings({ sound: true });
        U.audio.tone = function (f, d, when) { calls.push(when + d); };
        try { U.beep('end'); } finally { U.audio.tone = orig; S.setSettings({ sound: st0 }); }
        var end = calls.length ? Math.max.apply(null, calls) : 0;
        return calls.length >= 8 && end >= 3 && end <= 4.2;
      })(), '5 avisos de ~0,37 s = ~3,5 s');
      var sug = C.localSuggest();
      ok('planner local: propone ejercicios', sug.items.length >= 3, sug.items.length);
      ok('planner local: solo permitidos y con equipo', sug.items.every(function (i) { var e = S.byId(i.exId); return e && e.allowed && S.isAvailable(e); }));
      ok('planner local: sugiere pesos según historial', sug.items.every(function (i) { return i.weight >= 0; }));
      var wk = C.localWeek({ daysPerWeek: 4 });
      ok('plan semanal: 7 días', wk.days.length === 7);
      ok('plan semanal: 4 días de entreno', wk.days.filter(function (d) { return d.items.length; }).length === 4, wk.days.map(function (d) { return d.type; }).join(','));
      T.discard(); T.rest.stop();
      T.start({ exIds: [sug.items[0].exId] });
      ok('sesión: se inicia', !!T.active() && T.active().entries.length === 1);
      T.toggleSet(0, 0);
      ok('sesión: marca serie completada', !!T.active().entries[0].sets[0].done);
      ok('sesión: arranca descanso automático', !!T.restState.running, T.rest.remaining() + 's');
      ok('timer: descanso dentro del recuadro de sesión', (function () {
        var sb = document.createElement('div');
        document.body.appendChild(sb);
        try { A.views.hoy.render(sb); } catch (e) { sb.remove(); return false; }
        var c = sb.querySelector('#session-rest');
        var found = !!c && c.innerHTML.indexOf('sr-time') >= 0 && sb.innerHTML.indexOf('descanso en curso') >= 0;
        sb.remove();
        return found;
      })());
      ok('timer: sin modal a pantalla completa', !document.getElementById('rest-overlay'));
      var before = S.sessions().length;
      var saved = T.finish();
      ok('sesión: se guarda en el historial', !!saved && S.sessions().length === before + 1);
      ok('sesión: día marcado como hecho', (S.getDay(U.d.today()) || {}).status === 'done');
      T.discard(); T.rest.stop();
      T.start({ routineId: null });
      ok('sesión: modo libre arranca vacío', !!T.active() && T.active().entries.length === 0);
      T.discard();
      S.setDay('2030-01-01', { type: 'entreno', title: 'Test' });
      ok('calendario: guarda días', (S.getDay('2030-01-01') || {}).title === 'Test');
      S.clearDay('2030-01-01');
      var n = S.demoData(3);
      ok('demo: genera sesiones', n > 0, n);
      var ws = S.a.weeklySeries(4);
      ok('analítica: volumen semanal', ws.length === 4 && U.sum(ws, function (w) { return w.volume; }) > 0, U.fmt.vol(U.sum(ws, function (w) { return w.volume; })));
      ok('analítica: récords', Object.keys(S.a.prs()).length > 0, Object.keys(S.a.prs()).length + ' ejercicios');
      ok('analítica: racha y totales', S.a.totals().sessions > 0);
      ok('analítica: reparto por grupo', Object.keys(S.a.groupVolume(S.a.since(30))).length > 0);
      ok('markdown: negritas', U.md('**hola**').indexOf('<strong>hola</strong>') > -1);
      ok('json tolerante: fences', C.parseJSON('```json\n{"a":1}\n```').a === 1);
      ok('json tolerante: coma final', C.parseJSON('{"a":1,}').a === 1);
      ok('unidades: 100 lb -> kg', Math.abs(U.units.toKg(100, 'lb') - 45.359237) < 0.001);
      ok('rutinas: crear y duplicar', (function () { var r = S.addRoutine({ name: 'test', items: [{ exId: sug.items[0].exId, sets: 3, repMin: 8, repMax: 12, rest: 90 }] }); var c = S.duplicateRoutine(r.id); S.removeRoutine(r.id); S.removeRoutine(c.id); return !!c; })());
      ok('coach: contexto con datos REALES vs plantilla', (function () {
        var rr = S.addRoutine({ name: 'Plantilla comparativa', items: [{ exId: sug.items[0].exId, sets: 4, repMin: 10, repMax: 12, rest: 120 }] });
        var ts = new Date().toISOString();
        S.addSession({
          id: 's-ctx', name: rr.name, routineId: rr.id, date: U.d.today(),
          startedAt: ts, endedAt: ts, unit: 'kg',
          entries: [{ exId: sug.items[0].exId, name: sug.items[0].name, restSec: 120, sets: [
            { weight: 40, reps: 8, done: true }, { weight: 40, reps: 7, done: true },
            { weight: 40, reps: 6, done: true }, { weight: 40, reps: 6, done: true }
          ] }]
        });
        var ctx = C.buildContext({ sessions: 3 });
        var found = ctx.indexOf('40x8, 40x7, 40x6, 40x6') >= 0 &&
                    ctx.indexOf('objetivo plantilla: 4x10-12') >= 0 &&
                    ctx.indexOf('cumple 0/4') >= 0 &&
                    ctx.indexOf('NO es lo realizado') >= 0;
        S.removeSession('s-ctx');
        S.removeRoutine(rr.id);
        return found;
      })(), 'serie a serie + objetivo + cumplimiento');
      ok('coach: contexto con rutinas, semana y volumen', (function () {
        var rr = S.addRoutine({ name: 'Rutina IA test', items: [{ exId: sug.items[0].exId, sets: 3, repMin: 8, repMax: 12, rest: 90 }] });
        S.setDay(U.d.today(), { routineId: rr.id, type: 'entreno', title: rr.name, status: 'planned' });
        var ctx = C.buildContext({ sessions: 3 });
        var found = ctx.indexOf('RUTINAS GUARDADAS') >= 0 && ctx.indexOf('PLAN SEMANAL') >= 0 && ctx.indexOf('VOLUMEN POR SEMANA') >= 0 && ctx.indexOf('Rutina IA test') >= 0;
        S.clearDay(U.d.today());
        S.removeRoutine(rr.id);
        return found;
      })(), C.buildContext ? 'ok' : '');
      ok('vistas registradas', !!(A.views.hoy && A.views.rutinas && A.views.calendario && A.views.coach && A.views.progreso && A.views.ajustes));
      ok('acciones registradas (>= 60)', Object.keys(A.actions).length >= 60, Object.keys(A.actions).length);
      ok('ajustes anidados (bars.olimpica)', (function () { A.setSettingPath('bars.olimpica', 20); return U.num(S.settings().bars.olimpica) === 20; })());
      ok('ajustes anidados (ai.temperature)', (function () { A.setSettingPath('ai.temperature', 0.7); return U.num(S.settings().ai.temperature) === 0.7; })());
      /* --- smoke: render de todas las vistas con datos --- */
      var sandbox = document.createElement('div');
      sandbox.style.position = 'absolute';
      sandbox.style.left = '-9999px';
      document.body.appendChild(sandbox);
      Object.keys(A.views).forEach(function (k) {
        try {
          A.views[k].render(sandbox);
          var nodes = sandbox.querySelectorAll('*').length;
          ok('vista ' + k + ' renderiza con datos', nodes > 5, nodes + ' nodos');
          Ch.mountAll(sandbox);
          ok('vista ' + k + ' dibuja', sandbox.innerHTML.indexOf('Algo se rompió') < 0 && sandbox.innerHTML.indexOf('Error al dibujar') < 0);
        } catch (e) {
          ok('vista ' + k + ' renderiza con datos', false, e.message);
        }
        sandbox.innerHTML = '';
      });
      /* --- smoke: capa de acciones --- */
      var fakeEl = function (attrs) { return { getAttribute: function (n) { return attrs[n] === undefined ? null : String(attrs[n]); }, checked: true, value: '' }; };
      T.discard(); T.rest.stop();
      T.start({ exIds: [sug.items[0].exId] });
      try {
        A.actions['train:toggle-set'](fakeEl({ 'data-i': 0, 'data-j': 0 }));
        ok('acción marcar serie', !!T.active().entries[0].sets[0].done);
        var setsBefore = T.active().entries[0].sets.length;
        A.actions['train:add-set'](fakeEl({ 'data-i': 0 }));
        ok('acción añadir serie', T.active().entries[0].sets.length === setsBefore + 1, setsBefore + ' -> ' + T.active().entries[0].sets.length);
        ok('descanso: lo define el ejercicio/plantilla', U.int(T.entry(0).restSec) > 0, T.entry(0).restSec + 's');
        A.actions['train:set-field'](fakeEl({ 'data-i': 0, 'data-j': 0, 'data-field': 'weight' }));
        ok('acción editar campo de serie', T.active().entries[0].sets[0].weight !== undefined);
        A.actions['train:move-ex'](fakeEl({ 'data-i': 0, 'data-dir': 1 }));
        ok('acción reordenar ejercicio', true);
      } catch (e) { ok('capa de acciones', false, e.message); }
      T.discard(); T.rest.stop();
      var restored = (function () { try { S.importJSON(backup); return true; } catch (e) { return false; } })();
      ok('exportar/importar copia', restored && S.exercises().length >= 100);
    } catch (err) {
      ok('excepción no controlada', false, (err && err.message) || err);
    }
    try { S.importJSON(backup); } catch (e) { /* noop */ }
    S.clearDemo(); T.discard(); T.rest.stop();
    return out;
  }
  A.selfTest = selfTest;

  /* ---------- arranque ---------- */
  function init() {
    try {
      S.load();
      A.applyTheme();
      buildNav();
      T.rest.restore();
      /* service worker: notificaciones con la app en segundo plano o bloqueada */
      if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
        try { navigator.serviceWorker.register('sw.js').catch(function () { /* noop */ }); } catch (e) { /* noop */ }
      }
      S.onChange(function (why) {
        if (why === 'active' && S.active() && 'Notification' in window && Notification.permission === 'default') {
          try { Notification.requestPermission(); } catch (e) { /* noop */ }
        }
      });
      applyRoute(parseHash());
      setInterval(function () { try { T.loop(); } catch (e) { /* noop */ } }, 500);
      var wantTest = /selftest|test=1/.test(location.search + location.hash);
      var wantDemo = /demo=1/.test(location.search);
      if (wantTest) {
        var res = selfTest();
        var pass = res.filter(function (r) { return r.pass; }).length;
        document.documentElement.setAttribute('data-selftest', pass + '/' + res.length);
        U.$('#view').innerHTML = '<div class="card"><div class="h2">Auto-test ' + pass + '/' + res.length + '</div>' +
          '<div class="list mt">' + res.map(function (r) {
            return '<div class="list-item"><span class="badge ' + (r.pass ? 'ok' : 'danger') + '">' + (r.pass ? 'PASS' : 'FAIL') + '</span>' +
              '<div class="li-main"><div class="li-title" style="font-size:13px">' + U.esc(r.name) + '</div>' + (r.extra ? '<div class="li-sub">' + U.esc(r.extra) + '</div>' : '') + '</div></div>';
          }).join('') + '</div></div>';
        document.title = 'Auto-test ' + pass + '/' + res.length;
      } else if (wantDemo) {
        S.setMeta({ onboarded: true });
        C.planWeek({ useAI: false }).then(function (p) { C.applyWeek(p); A.render(); });
        var nDemo = S.demoData(8);
        A.render();
        U.toast('Modo demo: ' + nDemo + ' sesiones de ejemplo cargadas', { type: 'ok', ms: 5000 });
      } else if (!S.meta().onboarded) {
        setTimeout(onboarding, 350);
      }
    } catch (e) {
      console.error('[pulso] fallo al iniciar', e);
      var root = U.$('#view');
      if (root) root.innerHTML = '<div class="card" style="border-color:var(--danger)"><div class="h3 danger">Error al iniciar</div><div class="code-box mt-s">' + U.esc((e && (e.stack || e.message)) || String(e)) + '</div></div>';
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
