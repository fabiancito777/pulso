/* ==========================================================================
   Pulso · views-stats.js — estadísticas y gráficos de progreso
   ========================================================================== */
(function () {
  'use strict';
  var U = App.u, D = App.data, S = App.store, C = App.coach, Ch = App.charts;
  var V = {};
  V.title = 'Progreso'; V.tab = 'progreso'; V.icon = 'chart';
  var range = 8;
  var exId = null;
  var groupKey = null;

  V.sub = function () {
    var t = S.a.totals();
    if (!t.sessions) return 'Aún sin datos · empieza a entrenar';
    return t.sessions + ' sesiones · ' + U.fmt.vol(t.volume) + ' kg movidos · racha ' + t.streak + ' días';
  };

  function kpis() {
    var t = S.a.totals();
    var weeks = S.a.weeklySeries(2);
    var cur = weeks[1] || { volume: 0, sessions: 0, sets: 0, minutes: 0 };
    var prev = weeks[0] || { volume: 0 };
    var delta = prev.volume ? Math.round(((cur.volume - prev.volume) / prev.volume) * 100) : 0;
    var prs = Object.keys(S.a.prs()).length;
    return '<div class="grid c2">' +
      '<div class="kpi"><div class="kpi-label">Volumen total</div><div class="kpi-value">' + U.fmt.vol(t.volume) + '<span class="tiny muted"> kg</span></div><div class="kpi-delta">' + t.sets + ' series en ' + t.sessions + ' sesiones</div></div>' +
      '<div class="kpi"><div class="kpi-label">Esta semana</div><div class="kpi-value">' + U.fmt.vol(cur.volume) + '<span class="tiny muted"> kg</span></div><div class="kpi-delta">' + (delta ? (delta > 0 ? '+' : '') + delta + '% vs semana previa' : 'sin comparativa') + '</div></div>' +
      '<div class="kpi"><div class="kpi-label">Tiempo total</div><div class="kpi-value">' + U.fmt.dur(t.time) + '</div><div class="kpi-delta">media ' + U.fmt.dur(t.avgDuration) + ' por sesión</div></div>' +
      '<div class="kpi"><div class="kpi-label">Racha</div><div class="kpi-value">' + t.streak + '<span class="tiny muted"> días</span></div><div class="kpi-delta">mejor racha ' + t.bestStreak + ' · ' + prs + ' récords</div></div>' +
    '</div>';
  }

  function rangeBar() {
    var opts = [{ k: 4, l: '4 sem' }, { k: 8, l: '8 sem' }, { k: 12, l: '12 sem' }, { k: 26, l: '6 meses' }, { k: 0, l: 'Todo' }];
    return '<div class="seg">' + opts.map(function (o) {
      return '<button class="' + (range === o.k ? 'on' : '') + '" data-act="stats:range" data-weeks="' + o.k + '">' + o.l + '</button>';
    }).join('') + '</div>';
  }

  function seriesForRange() {
    var all = S.a.weeklySeries(52);
    if (!range) return all.filter(function (w) { return w.sessions || w.volume; });
    return all.slice(-range);
  }

  function mainCharts() {
    var series = seriesForRange();
    var bars = series.map(function (w) { return { label: w.label, value: w.volume }; });
    var sess = series.map(function (w) { return { label: w.label, value: w.sessions }; });
    var dur = series.map(function (w) { return { label: w.label, value: w.minutes * 60000 }; });
    var dm = series.map(function (w) { return { label: w.label, value: w.sets }; });
    var weeksCount = series.length;
    return '<section class="mt"><div class="sec-head"><span class="h3">Volumen por semana (kg)</span>' +
      '<span class="tiny muted">mejor semana: ' + U.fmt.vol(U.max(bars, function (b) { return b.value; })) + ' kg</span></div>' +
      Ch.bar({ data: bars, format: 'vol', height: 160, showValues: weeksCount <= 12 }) + '</section>' +
      '<section class="mt"><div class="sec-head"><span class="h3">Sesiones y series</span></div>' +
      '<div class="grid c2">' + Ch.bar({ data: sess, format: 'n', height: 130, color: 'var(--info)' }) + Ch.bar({ data: dm, format: 'n', height: 130, color: 'var(--ok)' }) + '</div>' +
      (dur.length ? '<div class="mt">' + Ch.line({ series: [{ name: 'minutos', color: 'var(--warn)', points: dur.map(function (d, i) { return { label: d.label, value: d.value }; }) }], format: 'time', height: 140 }) + '</div>' : '') +
      '</section>';
  }

  function groupCharts() {
    var sinceDays = range ? range * 7 : 3650;
    var sess = S.a.since(sinceDays);
    var vol = S.a.groupVolume(sess);
    var sets = S.a.groupSets(sess);
    var data = D.GROUPS.map(function (g) { return { label: g.label, value: vol[g.key] || 0, color: g.color, sets: sets[g.key] || 0 }; })
      .filter(function (x) { return x.value > 0 || x.sets > 0; }).sort(function (a, b) { return b.value - a.value; });
    return '<section class="mt"><div class="sec-head"><span class="h3">Reparto por grupo muscular</span></div>' +
      Ch.donut({ data: data, center: { value: U.fmt.vol(U.sum(data, function (d) { return d.value; })), label: 'kg totales' } }) +
      '<div class="mt">' + Ch.hbars({ data: data.map(function (d) { return { label: d.label, value: d.sets, color: d.color }; }), format: 'n', unit: 'series' }) + '</div>' +
      lastTrainedList() + '</section>';
  }

  function lastTrainedList() {
    var last = S.a.lastTrained();
    var rows = D.GROUPS.filter(function (g) { return ['cardio', 'movilidad'].indexOf(g.key) < 0; }).map(function (g) {
      var iso = last[g.key];
      var days = iso ? S.a.daysSince(iso) : null;
      var tone = days === null ? 'muted' : days <= 3 ? 'ok' : days <= 7 ? 'warn' : 'danger';
      return { g: g, days: days, tone: tone, iso: iso };
    }).sort(function (a, b) { return (b.days === null ? 999 : b.days) - (a.days === null ? 999 : a.days); });
    return '<div class="card flush mt"><div class="list">' + rows.map(function (r) {
      return '<div class="list-item"><span class="badge" style="background:' + r.g.color + '22;color:' + r.g.color + '">' + U.esc(r.g.label) + '</span>' +
        '<span class="grow tiny muted">' + (r.iso ? 'último estímulo ' + U.d.relative(r.iso) : 'sin datos') + '</span>' +
        '<span class="tiny ' + r.tone + '">' + (r.days === null ? '—' : r.days + 'd') + '</span></div>';
    }).join('') + '</div></div>';
  }

  function exercisePickerRow() {
    var counts = {};
    S.sessions().forEach(function (s) {
      (s.entries || []).forEach(function (e) { counts[e.exId] = (counts[e.exId] || 0) + 1; });
    });
    var top = Object.keys(counts).map(function (id) { return { id: id, n: counts[id] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 8);
    if (!exId && top.length) exId = top[0].id;
    return '<div class="hr-scroll">' + top.map(function (t) {
      var ex = S.byId(t.id);
      return '<button class="chip' + (exId === t.id ? ' accent' : '') + '" data-act="stats:exercise" data-id="' + t.id + '">' + U.esc(ex ? U.trunc(ex.name, 22) : t.id) + '</button>';
    }).join('') + '<button class="chip" data-act="stats:exercise-pick">' + U.icon('search') + 'Otro</button></div>';
  }

  function progression() {
    if (!exId) return '<section class="mt"><div class="empty">Registra sesiones para ver tu progresión por ejercicio</div></section>';
    var ex = S.byId(exId);
    var pts = S.a.exerciseSeries(exId);
    if (!ex) return '';
    if (pts.length < 1) {
      return '<section class="mt"><div class="sec-head"><span class="h3">Progresión · ' + U.esc(ex.name) + '</span></div>' + exercisePickerRow() + '<div class="empty mt-s">Todavía no hay series registradas de este ejercicio</div></section>';
    }
    var first = pts[0], last = pts[pts.length - 1];
    var delta = first.e1rm ? Math.round(((last.e1rm - first.e1rm) / first.e1rm) * 100) : 0;
    var pr = S.a.prs()[exId];
    return '<section class="mt"><div class="sec-head"><span class="h3">Progresión · ' + U.esc(ex.name) + '</span>' +
      '<span class="tiny ' + (delta >= 0 ? 'ok' : 'danger') + '">' + (delta > 0 ? '+' : '') + delta + '% desde ' + U.esc(U.d.label(first.iso, 'medium')) + '</span></div>' +
      exercisePickerRow() +
      Ch.line({ series: [{ name: '1RM est.', color: ex ? D.groupColor(ex.group) : 'var(--accent)', points: pts.map(function (p) { return { label: U.d.label(p.iso, 'short'), value: p.e1rm }; }) }], format: 'w', height: 170 }) +
      '<div class="grid c3 mt-s">' +
        '<div class="kpi"><div class="kpi-label">1RM est. actual</div><div class="kpi-value">' + U.fmt.n(last.e1rm) + '</div><div class="kpi-delta">' + U.fmt.n(last.top) + ' × ' + U.fmt.n(last.reps) + '</div></div>' +
        '<div class="kpi"><div class="kpi-label">Récord</div><div class="kpi-value">' + U.fmt.n(pr ? pr.e1rm : 0) + '</div><div class="kpi-delta">' + (pr ? U.d.label(pr.date, 'medium') : '—') + '</div></div>' +
        '<div class="kpi"><div class="kpi-label">Sesiones</div><div class="kpi-value">' + pts.length + '</div><div class="kpi-delta">' + U.fmt.vol(U.sum(pts, function (p) { return p.volume; })) + ' kg acumulados</div></div>' +
      '</div>' +
      '<div class="mt">' + Ch.bar({ data: pts.slice(-12).map(function (p) { return { label: U.d.label(p.iso, 'short'), value: p.volume }; }), format: 'vol', height: 120, color: 'var(--info)' }) + '</div>' +
      '</section>';
  }

  function weekdayChart() {
    var counts = S.a.byDow();
    var names = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
    return '<section class="mt"><div class="sec-head"><span class="h3">Frecuencia por día</span></div>' +
      Ch.bar({ data: counts.map(function (c, i) { return { label: names[i], value: c, color: (i === U.d.dowIdx(U.d.today())) ? 'var(--accent)' : 'var(--surface-4)' }; }), format: 'n', height: 120 }) + '</section>';
  }

  function consistency() {
    var cells = S.sessions().map(function (s) { return { iso: S.a.sessDate(s), value: 1 }; });
    return '<section class="mt"><div class="sec-head"><span class="h3">Consistencia</span><span class="tiny muted">días con entrenamiento</span></div>' +
      Ch.heat({ cells: cells, weeks: Math.min(26, Math.max(8, range || 12)) }) + '</section>';
  }

  function prTable(limit) {
    var prs = S.a.prs();
    var rows = Object.keys(prs).map(function (id) { return prs[id]; }).sort(function (a, b) { return b.e1rm - a.e1rm; });
    if (!rows.length) return '<div class="empty">Sin récords aún</div>';
    var shown = limit ? rows.slice(0, limit) : rows;
    return '<div class="card flush"><div class="list">' + shown.map(function (r) {
      var ex = S.byId(r.exId);
      var series = S.a.exerciseSeries(r.exId);
      var spark = Ch.spark(series.slice(-8).map(function (p) { return { value: p.e1rm }; }), ex ? D.groupColor(ex.group) : 'var(--accent)');
      return '<button class="list-item tappable" data-act="stats:exercise" data-id="' + r.exId + '">' +
        '<div class="li-main"><div class="li-title">' + U.esc(ex ? ex.name : r.exId) + '</div>' +
        '<div class="li-sub">' + U.fmt.n(r.weight) + ' kg × ' + U.fmt.n(r.reps) + ' · ' + U.esc(U.d.label(r.date, 'medium')) + '</div></div>' +
        '<div class="center"><div class="num" style="font-size:14px;font-weight:650">' + U.fmt.n(r.e1rm) + '</div><div class="tiny muted">1RM est.</div></div>' +
        spark + '</button>';
    }).join('') + '</div></div>';
  }

  function sessionList() {
    var sess = S.sessions().slice(0, 40);
    if (!sess.length) return '<div class="empty">Sin sesiones</div>';
    return '<div class="col" style="gap:8px">' + sess.map(function (s) {
      var groups = U.uniq((s.entries || []).map(function (e) { var ex = S.byId(e.exId); return ex ? D.groupLabel(ex.group) : ''; }).filter(Boolean));
      return '<div class="card tight"><div class="between"><div style="min-width:0"><div class="h3 ellipsis">' + U.esc(s.name) + (s.demo ? ' <span class="badge">demo</span>' : '') + '</div>' +
        '<div class="tiny muted">' + U.esc(U.d.label(s.date, 'medium')) + ' · ' + U.fmt.vol(S.a.volumeOf(s)) + ' kg · ' + S.a.setsOf(s) + ' series · ' + U.fmt.dur(S.a.durationOf(s)) + '</div>' +
        (groups.length ? '<div class="tiny muted">' + U.esc(groups.join(' · ')) + '</div>' : '') + '</div>' +
        '<div class="row" style="gap:4px"><button class="icon-btn" data-act="session:open" data-id="' + s.id + '">' + U.icon('eye') + '</button>' +
        '<button class="icon-btn" data-act="session:delete" data-id="' + s.id + '">' + U.icon('trash') + '</button></div></div></div>';
    }).join('') + '</div>';
  }

  V.render = function (root) {
    var t = S.a.totals();
    if (!t.sessions) {
      root.innerHTML = '<div class="empty">' + U.icon('chart') + '<div>Sin datos todavía</div>' +
        '<div class="tiny">Registra sesiones para desbloquear gráficos, récords y análisis de volumen por grupo muscular.</div>' +
        '<div class="row mt" style="gap:8px;justify-content:center;flex-wrap:wrap"><button class="btn primary" data-act="go" data-tab="hoy">Ir a entrenar</button>' +
        '<button class="btn ghost" data-act="settings:demo">Cargar datos de ejemplo</button></div></div>';
      return;
    }
    root.innerHTML =
      '<div class="between mb"><span class="tiny muted">' + U.esc(t.firstDate ? 'Desde ' + U.d.label(t.firstDate, 'medium') : '') + '</span>' + rangeBar() + '</div>' +
      kpis() +
      mainCharts() +
      groupCharts() +
      progression() +
      '<section class="mt"><div class="sec-head"><span class="h3">Récords personales</span>' +
        '<span class="tiny muted">1RM estimado (Epley)</span></div>' + prTable(6) +
        '<button class="btn ghost block mt-s" data-act="stats:prs">Ver tabla completa</button></section>' +
      weekdayChart() +
      consistency() +
      '<section class="mt"><div class="sec-head"><span class="h3">Historial de sesiones</span>' +
        '<button class="btn quiet sm" data-act="stats:sessions">Ver todo</button></div>' + sessionList() + '</section>';
  };

  App.actions = App.actions || {};
  App.actions['stats:range'] = function (el) { range = U.int(el.getAttribute('data-weeks')); App.render(); };
  App.actions['stats:exercise'] = function (el) {
    exId = el.getAttribute('data-id');
    if (App.ui.closeModal) App.ui.closeModal();
    App.render();
  };
  App.actions['stats:exercise-pick'] = function () {
    App.ui.exercisePicker({ multi: false, title: 'Elegir ejercicio', onlyDone: true }).then(function (ids) {
      if (!ids || !ids.length) return;
      exId = ids[0];
      App.render();
    });
  };
  App.actions['stats:sessions'] = function () {
    U.modal({ title: 'Historial de sesiones', subtitle: S.sessions().length + ' registradas', body: sessionList(), footer: false, actions: [{ label: 'Cerrar', value: null, kind: 'ghost' }] });
  };
  App.actions['stats:prs'] = function () {
    U.modal({ title: 'Récords personales', subtitle: '1RM estimado por ejercicio', body: prTable(0), actions: [{ label: 'Cerrar', value: null, kind: 'ghost' }], onMount: function (box) {
      box.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-act="stats:exercise"]');
        if (b) { exId = b.getAttribute('data-id'); U.modal.current && U.modal.current(null); App.render(); }
      });
    } });
  };
  V.exercise = function (id) { if (id) exId = id; return exId; };
  /* El botón "Cargar datos de ejemplo" del estado vacío: hacía falta un handler
     (se quedó sin registrar y no hacía nada, solo el aviso de la consola).
     Mismo camino que `?demo=1`, pero sin recargar la página. */
  App.actions['settings:demo'] = function () {
    var n = S.demoData(8);
    C.planWeek({ useAI: false }).then(function (p) { C.applyWeek(p); }).catch(function () { /* sin plan: las sesiones ya están */ }).then(function () {
      App.render();
      U.toast('Datos de ejemplo: ' + n + ' sesiones cargadas', { type: 'ok', ms: 4000 });
    });
  };

  App.views = App.views || {};
  App.views.progreso = V;
})();
