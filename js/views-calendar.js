/* ==========================================================================
   Pulso · views-calendar.js — planificación semanal y calendario
   ========================================================================== */
(function () {
  'use strict';
  var U = App.u, D = App.data, S = App.store, T = App.trainer, C = App.coach, Ch = App.charts;
  var V = {};
  V.title = 'Calendario'; V.tab = 'calendario'; V.icon = 'calendar';
  var cursor = null;
  var plan = null;
  var monthCursor = null;

  V.sub = function () {
    var from = U.d.startOfWeek(cursor || U.d.today());
    var week = S.week(from);
    var done = week.filter(function (d) { return d.sessions.length || (d.planned || {}).status === 'done'; }).length;
    var planned = week.filter(function (d) { return (d.planned || {}).routineId || (d.planned || {}).type === 'entreno'; }).length;
    return 'Semana del ' + U.d.label(from, 'medium') + ' · ' + done + '/' + Math.max(planned, 0) + ' completados';
  };

  function dayCard(d) {
    var p = d.planned || {};
    var r = p.routineId ? S.routine(p.routineId) : null;
    var title = p.title || (r ? r.name : (p.type === 'descanso' ? 'Descanso' : ''));
    var done = d.sessions.length || p.status === 'done';
    var st = done ? 'st-done' : (p.status === 'rest' || p.type === 'descanso' ? 'st-rest' : (p.status === 'skipped' ? 'st-skip' : 'planned'));
    var vol = U.sum(d.sessions, function (s) { return S.a.volumeOf(s); });
    return '<button class="day-cell ' + st + (d.isToday ? ' today' : '') + '" data-act="cal:day" data-date="' + d.iso + '" title="' + U.esc(title || d.iso) + '">' +
      '<span class="dnum">' + U.d.parse(d.iso).getDate() + '</span>' +
      '<span class="ddow">' + U.d.dow(d.iso) + '</span>' +
      '<span class="dtag">' + U.esc(U.trunc(title || (d.isToday ? 'hoy' : 'libre'), 34)) + '</span>' +
      (vol ? '<span class="dvol">' + U.fmt.vol(vol) + '</span>' : (done ? '<span class="dvol">hecho</span>' : '')) +
      '<span class="dstat"></span>' +
    '</button>';
  }

  function weekSummary() {
    var from = U.d.startOfWeek(cursor || U.d.today());
    var to = U.d.addDays(from, 6);
    var sess = S.sessions().filter(function (s) { var d = S.a.sessDate(s); return d >= from && d <= to; });
    var vol = S.a.groupVolume(sess);
    var data = D.GROUPS.map(function (g) { return { label: g.label, value: vol[g.key] || 0, color: g.color }; })
      .filter(function (x) { return x.value > 0; }).sort(function (a, b) { return b.value - a.value; });
    var planned = S.week(from).filter(function (d) { return (d.planned || {}).routineId || (d.planned || {}).type === 'entreno'; }).length;
    return '<div class="grid c3">' +
      '<div class="kpi"><div class="kpi-label">Volumen semanal</div><div class="kpi-value">' + U.fmt.vol(U.sum(sess, function (s) { return S.a.volumeOf(s); })) + '</div><div class="kpi-delta">' + sess.length + ' sesiones</div></div>' +
      '<div class="kpi"><div class="kpi-label">Planificadas</div><div class="kpi-value">' + planned + '</div><div class="kpi-delta">' + sess.length + ' completadas</div></div>' +
      '<div class="kpi"><div class="kpi-label">Series</div><div class="kpi-value">' + U.sum(sess, S.a.setsOf) + '</div><div class="kpi-delta">' + Math.round(U.sum(sess, S.a.durationOf) / 60000) + ' min</div></div>' +
    '</div>' +
    (data.length ? '<div class="mt">' + Ch.hbars({ data: data, format: 'vol', unit: 'kg' }) + '</div>' : '');
  }

  function planPreview() {
    if (!plan) return '';
    var training = plan.days.filter(function (d) { return d.items && d.items.length; });
    var applied = plan.applied;
    return '<div class="card accent">' +
      '<div class="between"><div><div class="h3">Propuesta de semana</div><div class="tiny muted">' +  U.esc(plan.notes || (plan.source === 'ia' ? 'generada por IA' : 'generada en el dispositivo')) + '</div></div>' +
        '<span class="badge ' + (plan.source === 'ia' ? 'a' : '') + '">' + U.esc(plan.source) + '</span></div>' +
      (plan.rationale && plan.rationale.length ? '<div class="tiny muted mt-s">' + U.esc(plan.rationale.join(' · ')) + '</div>' : '') +
      (plan.error ? '<div class="tiny danger mt-s">IA: ' + U.esc(plan.error) + '</div>' : '') +
      '<div class="col mt-s" style="gap:6px">' + plan.days.map(function (d) {
        if (!d.items || !d.items.length) {
          return '<div class="row tiny" style="gap:7px"><span class="badge">' + U.d.dow(d.iso) + '</span><span class="muted grow">' + U.esc(d.title) + '</span></div>';
        }
        return '<div class="card tight" style="background:var(--surface-2)"><div class="between"><span class="h3 tiny" style="font-size:13px">' + U.d.label(d.iso, 'short') + ' · ' + U.esc(d.title) + '</span>' +
          '<span class="tiny muted">' + d.items.length + ' ej.</span></div>' +
          '<div class="tiny muted" style="margin-top:4px">' + U.esc(U.trunc(d.items.map(function (i) { return i.name; }).join(' · '), 110)) + '</div></div>';
      }).join('') + '</div>' +
      (plan.unmatched && plan.unmatched.length ? '<div class="tiny warn mt-s">Ejercicios no reconocidos (omitidos): ' + U.esc(plan.unmatched.join(', ')) + '</div>' : '') +
      '<div class="row mt" style="gap:8px;flex-wrap:wrap">' +
        (applied
          ? '<button class="btn okline" data-act="go" data-tab="calendario">' + U.icon('check') + 'Aplicada (' + training.length + ' días)</button>'
          : '<button class="btn primary grow" data-act="cal:apply-plan">' + U.icon('check') + 'Aplicar al calendario</button>') +
        '<button class="btn" data-act="cal:regen" data-ai="0">' + U.icon('refresh') + 'Regenerar</button>' +
        '<button class="btn ghost" data-act="cal:close-plan">Descartar</button>' +
      '</div></div>';
  }

  V.render = function (root) {
    cursor = cursor || U.d.today();
    monthCursor = monthCursor || cursor.slice(0, 8) + '01';
    var week = S.week(cursor);
    var from = U.d.startOfWeek(cursor);
    root.innerHTML =
      planPreview() +
      '<div class="between"><div class="row" style="gap:6px">' +
        '<button class="icon-btn" data-act="cal:prev" title="Semana anterior">' + U.icon('chev-l') + '</button>' +
        '<button class="btn sm ghost" data-act="cal:today">Hoy</button>' +
        '<button class="icon-btn" data-act="cal:next" title="Semana siguiente">' + U.icon('chev-r') + '</button>' +
      '</div>' +
      '<div class="tiny muted">' + U.esc(U.d.label(from, 'medium')) + ' – ' + U.esc(U.d.label(U.d.addDays(from, 6), 'medium')) + '</div></div>' +
      '<div class="mt-s"><div class="week-strip">' + week.map(dayCard).join('') + '</div></div>' +
      '<div class="grid c2 mt">' +
        '<button class="btn" data-act="cal:autoplan" data-ai="0">' + U.icon('wand') + 'Auto-planificar</button>' +
        '<button class="btn primary" data-act="cal:autoplan" data-ai="1">' + U.icon('sparkles') + 'Plan con IA</button>' +
      '</div>' +
      '<section class="mt"><div class="sec-head"><span class="h3">Resumen de la semana</span></div>' + weekSummary() + '</section>' +
      '<section class="mt"><div class="sec-head"><span class="h3">Últimos 4 meses</span><button class="btn quiet sm" data-act="cal:month-toggle">' + U.icon('calendar') + 'Mes</button></div>' +
        Ch.heat({ cells: heatCells(), weeks: 17, caption: 'cada columna es una semana, cada fila un día' }) + '</section>';
  };

  function heatCells() {
    return S.sessions().map(function (s) { return { iso: S.a.sessDate(s), value: 1 }; });
  }

  V.autoPlan = function (useAI) {
    cursor = cursor || U.d.today();
    var from = U.d.startOfWeek(cursor);
    var t = U.toast(useAI ? 'El coach IA planifica tu semana…' : 'Generando plan semanal…', { loading: true, sticky: true });
    C.planWeek({ fromIso: from, useAI: !!useAI }).then(function (p) {
      t.close();
      plan = p;
      plan.applied = false;
      App.render();
      if (p.error) U.toast('IA no disponible: ' + p.error + ' (plan local mostrado)', { type: 'warn', ms: 6000 });
      else U.toast(useAI ? 'Plan generado con el coach IA' : 'Plan generado', { type: 'ok' });
    });
  };
  V.plan = function () { return plan; };
  V.setPlan = function (p) { plan = p; return plan; };

  App.actions = App.actions || {};
  App.actions['cal:prev'] = function () { cursor = U.d.addDays(cursor || U.d.today(), -7); App.render(); };
  App.actions['cal:next'] = function () { cursor = U.d.addDays(cursor || U.d.today(), 7); App.render(); };
  App.actions['cal:today'] = function () { cursor = U.d.today(); App.render(); };
  App.actions['cal:autoplan'] = function (el) { V.autoPlan(el.getAttribute('data-ai') === '1'); };
  App.actions['cal:regen'] = function (el) { V.autoPlan(el.getAttribute('data-ai') === '1'); };
  App.actions['cal:close-plan'] = function () { plan = null; App.render(); };
  App.actions['cal:apply-plan'] = function () {
    if (!plan) return;
    var res = C.applyWeek(plan);
    plan.applied = true;
    App.render();
    U.toast('Semana agendada: ' + res.days + ' días, ' + res.routines + ' rutinas creadas', { type: 'ok' });
  };

  /* ---------- detalle del día ---------- */
  function openDay(iso) {
    var d = (S.week(U.d.startOfWeek(iso)).filter(function (x) { return x.iso === iso; })[0]) || { iso: iso, planned: {}, sessions: [] };
    var p = d.planned || {};
    var r = p.routineId ? S.routine(p.routineId) : null;
    var items = r ? r.items.map(function (it) { var ex = S.byId(it.exId); return { exId: it.exId, name: ex ? ex.name : it.exId, sets: it.sets, repMin: it.repMin, repMax: it.repMax }; }) : (p.plan || []);
    var statuses = [
      { k: 'planned', label: 'Planificado' }, { k: 'done', label: 'Hecho' },
      { k: 'rest', label: 'Descanso' }, { k: 'skipped', label: 'Saltado' }
    ];
    var cur = p.status || (d.sessions.length ? 'done' : (p.type === 'descanso' ? 'rest' : 'planned'));
    var body =
      '<div class="seg">' + statuses.map(function (s) {
        return '<button class="' + (cur === s.k ? 'on accent' : '') + '" data-dact="cal:day-status" data-date="' + iso + '" data-status="' + s.k + '">' + s.label + '</button>';
      }).join('') + '</div>' +
      (items.length
        ? '<div class="card flush mt"><div class="list">' + items.map(function (it, i) {
            return '<div class="list-item"><span class="num tiny muted" style="width:18px">' + (i + 1) + '</span><div class="li-main"><div class="li-title">' + U.esc(it.name) + '</div>' +
              '<div class="li-sub">' + U.int(it.sets, 3) + ' series · ' + U.int(it.repMin, 8) + '-' + U.int(it.repMax, 12) + ' reps' + (it.weight ? ' · ' + U.fmt.n(it.weight) + ' ' + U.units.label(S.settings().units) : '') + '</div></div></div>';
          }).join('') + '</div></div>'
        : '<div class="empty mt"><div>Sin ejercicios asignados</div><div class="tiny">Asigna una rutina o genera un plan semanal</div></div>') +
      (d.sessions.length
        ? '<div class="mt"><div class="label">Sesiones registradas</div><div class="card flush"><div class="list">' + d.sessions.map(function (s) {
            return '<button class="list-item tappable" data-dact="session:open" data-id="' + s.id + '"><div class="li-main"><div class="li-title">' + U.esc(s.name) + '</div>' +
              '<div class="li-sub">' + U.fmt.vol(S.a.volumeOf(s)) + ' kg · ' + U.fmt.dur(S.a.durationOf(s)) + '</div></div>' + U.icon('chev-r') + '</button>';
          }).join('') + '</div></div></div>' : '') +
      (p.notes ? '<div class="card tight mt"><div class="tiny muted">Nota del plan</div><div class="tiny">' + U.esc(p.notes) + '</div></div>' : '');
    U.modal({
      title: U.d.label(iso, 'medium'), subtitle: r ? r.name : (p.title || U.d.relative(iso)), body: body,
      actions: [
        { label: 'Cerrar', value: null, kind: 'ghost' },
        { label: 'Rutina', value: 'routine', kind: 'ghost' },
        { label: items.length ? 'Empezar día' : 'Elegir rutina', value: items.length ? 'start' : 'routine', kind: 'primary' }
      ],
      onMount: function (box, close) {
        box.addEventListener('click', function (ev) {
          var btn = ev.target.closest('[data-dact]');
          if (!btn) return;
          var act = btn.getAttribute('data-dact');
          if (act === 'cal:day-status') {
            var st = btn.getAttribute('data-status');
            S.setDay(iso, { status: st, type: st === 'rest' ? 'descanso' : undefined });
            close(null);
            setTimeout(function () { openDay(iso); App.render(); }, 10);
          } else if (act === 'session:open') {
            close(null);
            setTimeout(function () { App.ui.sessionDetail(btn.getAttribute('data-id')); }, 60);
          }
        });
      }
    }).then(function (val) {
      if (val === 'start') {
        if (T.active()) { U.toast('Ya hay una sesión en curso', { type: 'warn' }); return; }
        if (r) T.start({ routineId: r.id, name: r.name, dayIso: iso, source: 'plan' });
        else App.views.hoy.startFromItems(items, p.title || 'Entrenamiento', iso);
        App.render();
        U.toast('Sesión iniciada para ' + U.d.label(iso, 'medium'), { type: 'ok' });
      } else if (val === 'routine') {
        App.ui.routinePicker().then(function (id) {
          if (!id) return;
          S.setDay(iso, { routineId: id, type: 'entreno', title: (S.routine(id) || {}).name, status: 'planned', source: 'manual' });
          App.render();
          U.toast('Rutina agendada el ' + U.d.label(iso, 'medium'), { type: 'ok' });
        });
      }
    });
  }
  V.openDay = openDay;

  function openMonth(isoMonth) {
    var m = isoMonth || (U.d.today().slice(0, 8) + '01');
    var cells = S.month(m);
    var firstDow = U.d.dowIdx(m);
    var label = U.d.label(m, 'month');
    var body = '<div class="between mb"><button class="icon-btn" data-dact="cal:month-nav" data-delta="-1">' + U.icon('chev-l') + '</button>' +
      '<div class="h3" style="text-transform:capitalize">' + U.esc(label) + '</div>' +
      '<button class="icon-btn" data-dact="cal:month-nav" data-delta="1">' + U.icon('chev-r') + '</button></div>' +
      '<div class="month-grid" style="margin-bottom:5px">' + ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(function (x) { return '<div class="tiny muted center">' + x + '</div>'; }).join('') + '</div>' +
      '<div class="month-grid">' + new Array(firstDow).fill('<div></div>').join('') + cells.map(function (c) {
        var lvl = c.count >= 2 ? 'lv3' : c.count === 1 ? 'lv2' : ((c.planned && c.planned.routineId) ? 'lv1' : '');
        return '<button class="month-cell ' + lvl + (c.iso === U.d.today() ? ' today' : '') + '" data-dact="cal:month-day" data-date="' + c.iso + '">' + U.d.parse(c.iso).getDate() + '</button>';
      }).join('') + '</div>' +
      '<div class="chart-legend"><span><i style="background:var(--surface-2)"></i>sin sesión</span><span><i style="background:color-mix(in srgb,var(--accent) 22%,var(--surface-2))"></i>planificado</span>' +
      '<span><i style="background:color-mix(in srgb,var(--accent) 45%,var(--surface-2))"></i>1 sesión</span><span><i style="background:color-mix(in srgb,var(--accent) 75%,var(--surface-2))"></i>2+ sesiones</span></div>';
    U.modal({
      title: 'Vista mensual', body: body,
      actions: [{ label: 'Cerrar', value: null, kind: 'ghost' }],
      onMount: function (box, close) {
        box.addEventListener('click', function (ev) {
          var btn = ev.target.closest('[data-dact]');
          if (!btn) return;
          var act = btn.getAttribute('data-dact');
          if (act === 'cal:month-nav') { close(null); setTimeout(function () { openMonth(U.d.addMonths(m, U.int(btn.getAttribute('data-delta')))); }, 40); }
          else if (act === 'cal:month-day') { close(null); setTimeout(function () { openDay(btn.getAttribute('data-date')); }, 40); }
        });
      }
    });
  }

  App.actions['cal:day'] = function (el) { openDay(el.getAttribute('data-date')); };
  App.actions['cal:month-toggle'] = function () { openMonth(monthCursor); };
  App.actions['cal:mark'] = function (el) {
    var iso = el.getAttribute('data-date'), st = el.getAttribute('data-status');
    S.setDay(iso, { status: st, type: st === 'rest' ? 'descanso' : undefined });
    App.render();
    U.toast(st === 'rest' ? 'Día marcado como descanso' : 'Día actualizado', { type: 'ok', ms: 1600 });
  };
  App.actions['cal:week-plan'] = function () { V.autoPlan(false); };

  App.views = App.views || {};
  App.views.calendario = V;
})();
