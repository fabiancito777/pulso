/* ==========================================================================
   Pulso · views-train.js — pestaña HOY (sesión activa + panel diario)
   ========================================================================== */
(function () {
  'use strict';
  var U = App.u, D = App.data, S = App.store, T = App.trainer, C = App.coach, Ch = App.charts;
  var V = {};
  V.title = 'Hoy'; V.tab = 'hoy'; V.icon = 'dumbbell';

  V.sub = function () {
    var st = S.settings();
    var greet = (new Date().getHours() < 13) ? 'Buenos días' : (new Date().getHours() < 20) ? 'Buenas tardes' : 'Buenas noches';
    return greet + (st.name ? ', ' + st.name.split(' ')[0] : '') + ' · ' + U.d.label(U.d.today());
  };

  /* ---------- plan de hoy ---------- */
  function todayPlan() {
    var day = S.getDay(U.d.today()) || {};
    var r = day.routineId ? S.routine(day.routineId) : null;
    var items = [];
    if (r) items = r.items.map(function (it) { var ex = S.byId(it.exId); return { exId: it.exId, name: ex ? ex.name : it.exId, sets: it.sets, reps: Math.round((it.repMin + it.repMax) / 2), repMin: it.repMin, repMax: it.repMax, rest: it.rest }; });
    else if (day.plan && day.plan.length) items = day.plan;
    return { day: day, routine: r, items: items, title: r ? r.name : (day.title || ''), type: day.type || (r ? 'entreno' : null), status: day.status || (S.sessions().some(function (s) { return s.date === U.d.today(); }) ? 'done' : 'planned') };
  }
  V.todayPlan = todayPlan;

  function weekStrip() {
    var week = S.week(U.d.today());
    return '<div class="week-strip">' + week.map(function (d) {
      var p = d.planned || {}, r = p.routineId ? S.routine(p.routineId) : null;
      var label = p.title || (r ? r.name : (p.type === 'descanso' ? 'Descanso' : ''));
      var done = d.sessions.length || p.status === 'done';
      var st = done ? 'st-done' : (p.status === 'rest' || p.type === 'descanso' ? 'st-rest' : (p.status === 'skipped' ? 'st-skip' : 'planned'));
      var vol = U.sum(d.sessions, function (s) { return S.a.volumeOf(s); });
      return '<button class="day-cell ' + st + (d.isToday ? ' today' : '') + '" data-act="cal:day" data-date="' + d.iso + '" title="' + U.esc(label || d.iso) + '">' +
        '<span class="dnum">' + U.d.parse(d.iso).getDate() + '</span>' +
        '<span class="ddow">' + U.d.dow(d.iso) + '</span>' +
        '<span class="dtag">' + U.esc(U.trunc(label || (d.isToday ? 'hoy' : 'libre'), 26)) + '</span>' +
        (vol ? '<span class="dvol">' + U.fmt.vol(vol) + '</span>' : (done ? '<span class="dvol">hecho</span>' : '')) +
        '<span class="dstat"></span>' +
      '</button>';
    }).join('') + '</div>';
  }

  function kpis() {
    var a = S.a, week = a.weeklySeries(1)[0] || { volume: 0, sessions: 0, sets: 0, minutes: 0 };
    var prev = a.weeklySeries(2)[0] || { volume: 0 };
    var delta = prev.volume ? Math.round(((week.volume - prev.volume) / prev.volume) * 100) : 0;
    return '<div class="grid c3">' +
      '<div class="kpi"><div class="kpi-label">Sesiones 7d</div><div class="kpi-value">' + week.sessions + '</div><div class="kpi-delta">objetivo ' + S.settings().daysPerWeek + '</div></div>' +
      '<div class="kpi"><div class="kpi-label">Volumen 7d</div><div class="kpi-value">' + U.fmt.vol(week.volume) + '</div><div class="kpi-delta">' + (delta ? (delta > 0 ? '+' : '') + delta + '% vs semana previa' : 'sin comparativa') + '</div></div>' +
      '<div class="kpi"><div class="kpi-label">Series 7d</div><div class="kpi-value">' + week.sets + '</div><div class="kpi-delta">' + week.minutes + ' min de entreno</div></div>' +
    '</div>';
  }

  function suggestionCard(opts) {
    opts = opts || {};
    var sug = opts.suggestion || C.localSuggest();
    var rows = sug.items.slice(0, 6).map(function (i) {
      return '<div class="row" style="gap:8px"><span class="badge" style="background:' + D.groupColor(i.group) + '22;color:' + D.groupColor(i.group) + '">' + U.esc(D.groupLabel(i.group)) + '</span>' +
        '<span class="grow ellipsis" style="font-size:13.5px">' + U.esc(i.name) + '</span>' +
        '<span class="tiny muted num">' + i.sets + '×' + i.reps + (i.weight ? ' @ ' + U.fmt.n(i.weight) : '') + '</span></div>';
    }).join('');
    var extra = sug.items.length > 6 ? '<div class="tiny muted">+' + (sug.items.length - 6) + ' ejercicios</div>' : '';
    var err = sug.error ? '<div class="tiny danger mt-s">' + U.esc(sug.error) + '</div>' : '';
    return '<div class="card accent">' +
      '<div class="between mb"><div><div class="h3">' + U.esc(sug.title) + '</div><div class="tiny muted">' + U.esc(sug.focus) + '</div></div>' +
        '<span class="badge ' + (sug.source === 'ia' ? 'a' : '') + '">' + (sug.source === 'ia' ? 'IA' : 'local') + '</span></div>' +
      '<div class="col" style="gap:6px">' + rows + extra + '</div>' +
      (sug.rationale && sug.rationale.length ? '<div class="divider"></div><div class="tiny muted">' + U.esc(sug.rationale.slice(0, 3).join(' · ')) + '</div>' : '') +
      err +
      '<div class="col mt-s" style="gap:8px">' +
        '<button class="btn primary block" data-act="train:start-suggestion">Empezar ahora</button>' +
        '<div class="grid c2" style="gap:8px">' +
          '<button class="btn sm block" data-act="suggest:ai" data-mode="hoy">' + U.icon('sparkles') + 'Mejorar con IA</button>' +
          '<button class="btn sm ghost block" data-act="train:save-suggestion">Guardar rutina</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function lastSessions(n) {
    var sess = S.sessions().slice(0, n);
    if (!sess.length) return '<div class="empty">' + U.icon('clock') + '<div>Aún no hay sesiones registradas</div><div class="tiny">Empieza un entrenamiento y aparecerán aquí</div></div>';
    return '<div class="card flush"><div class="list">' + sess.map(function (s) {
      var groups = U.uniq((s.entries || []).map(function (e) { var ex = S.byId(e.exId); return ex ? D.groupLabel(ex.group) : ''; }).filter(Boolean)).slice(0, 3).join(' · ');
      return '<button class="list-item tappable" data-act="session:open" data-id="' + s.id + '">' +
        '<div class="li-main"><div class="li-title">' + U.esc(s.name) + '</div>' +
          '<div class="li-sub">' + U.esc(U.d.label(s.date, 'medium')) + ' · ' + U.fmt.vol(S.a.volumeOf(s)) + ' kg · ' + U.fmt.dur(S.a.durationOf(s)) + (groups ? ' · ' + U.esc(groups) : '') + '</div></div>' +
        '<span class="icon-btn" data-act="train:repeat" data-id="' + s.id + '" title="Repetir">' + U.icon('refresh') + '</span>' +
        U.icon('chev-r') +
      '</button>';
    }).join('') + '</div></div>';
  }

  function toolsSection() {
    var ml = T.maxLoadable();
    return '<div class="grid c2">' +
      '<button class="card tight" data-act="tools:plates" style="text-align:left"><div class="row"><span class="ico accent">' + U.icon('plate') + '</span><div><div class="h3">Calculadora de discos</div><div class="tiny muted">máx ' + U.fmt.n(ml.totalKg, 1) + ' ' + U.units.label(S.settings().units) + ' en barra</div></div></div></button>' +
      '<button class="card tight" data-act="tools:timer" style="text-align:left"><div class="row"><span class="ico accent">' + U.icon('timer') + '</span><div><div class="h3">Temporizador</div><div class="tiny muted">descanso libre o isométricos</div></div></div></button>' +
    '</div>';
  }

  /* ---------- panel cuando no hay sesión activa ---------- */
  function renderHome(root) {
    var plan = todayPlan();
    var dayName = U.d.dowLong(U.d.today());
    var hero = '';
    if (plan.status === 'done') {
      hero = '<div class="card accent"><div class="between"><div><div class="h2">Sesión de hoy completada</div><div class="sub">' + U.esc(U.d.label(U.d.today())) + ' · sigue así</div></div>' + U.icon('check-circle') + '</div>' +
        '<div class="row mt" style="gap:8px;flex-wrap:wrap"><button class="btn" data-act="train:pick-empty">' + U.icon('plus') + 'Entrenar extra</button>' +
        '<button class="btn ghost" data-act="go" data-tab="progreso">Ver progreso</button></div></div>';
    } else if (plan.items.length) {
      hero = '<div class="card accent">' +
        '<div class="between"><div><div class="tiny muted" style="text-transform:uppercase;letter-spacing:.5px">Plan de hoy · ' + U.esc(dayName) + '</div>' +
          '<div class="h1">' + U.esc(plan.title || 'Entrenamiento') + '</div>' +
          '<div class="sub">' + plan.items.length + ' ejercicios · ' + U.esc(plan.type || 'entreno') + '</div></div>' +
          '<span class="badge a">' + (plan.day.source === 'ia' ? 'IA' : 'plan') + '</span></div>' +
        '<div class="col mt" style="gap:5px">' + plan.items.slice(0, 8).map(function (i) {
          var ex = S.byId(i.exId);
          return '<div class="row" style="gap:8px"><span class="grow ellipsis tiny">' + U.esc(i.name || (ex ? ex.name : '')) + '</span><span class="tiny muted num">' + (i.sets || 3) + '×' + (i.reps || (i.repMin ? Math.round((i.repMin + i.repMax) / 2) : '')) + (i.weight ? ' @ ' + U.fmt.n(i.weight) : '') + '</span></div>';
        }).join('') + (plan.items.length > 8 ? '<div class="tiny muted">+' + (plan.items.length - 8) + ' más</div>' : '') + '</div>' +
        '<div class="row mt" style="gap:8px;flex-wrap:wrap">' +
          '<button class="btn primary grow" data-act="train:start-today">' + U.icon('play') + 'Empezar sesión</button>' +
          '<button class="btn" data-act="cal:mark" data-date="' + U.d.today() + '" data-status="rest">Saltar</button>' +
        '</div></div>';
    } else {
      hero = '<div class="card">' +
        '<div class="between"><div><div class="tiny muted" style="text-transform:uppercase;letter-spacing:.5px">Hoy · ' + U.esc(dayName) + '</div>' +
        '<div class="h2">Sin plan para hoy</div><div class="sub">Programa la semana o entrena libremente</div></div>' + U.icon('calendar') + '</div>' +
        '<div class="row mt" style="gap:8px;flex-wrap:wrap">' +
          '<button class="btn primary" data-act="go" data-tab="calendario">' + U.icon('calendar') + 'Planificar semana</button>' +
          '<button class="btn" data-act="coach:quick" data-kind="week">' + U.icon('sparkles') + 'Plan automático</button>' +
        '</div></div>';
    }

    var st = S.a.totals();
    root.innerHTML =
      hero +
      '<section class="mt"><div class="sec-head"><span class="h3">Semana</span><button class="btn quiet sm" data-act="go" data-tab="calendario">Calendario' + U.icon('chev-r') + '</button></div>' + weekStrip() + '</section>' +
      '<section class="mt"><div class="sec-head"><span class="h3">Recomendado ahora</span>' +
        '<button class="btn quiet sm" data-act="suggest:refresh">' + U.icon('refresh') + 'Recalcular</button></div>' + suggestionCard() + '</section>' +
      '<section class="mt">' + kpis() + '</section>' +
      '<section class="mt"><div class="sec-head"><span class="h3">Herramientas</span></div>' + toolsSection() + '</section>' +
      (plan.status !== 'done' ? '<section class="mt"><div class="grid c2"><button class="btn lg" data-act="train:pick-empty">' + U.icon('plus') + 'Libre</button>' +
        '<button class="btn lg" data-act="routines:pick">' + U.icon('list') + 'Elegir rutina</button></div></section>' : '') +
      '<section class="mt"><div class="sec-head"><span class="h3">Últimas sesiones</span>' +
        (st.sessions ? '<span class="tiny muted">' + st.sessions + ' en total · racha ' + st.streak + ' d</span>' : '') + '</div>' + lastSessions(4) + '</section>';
  }

  /* ---------- UI de sesión activa ---------- */
  /* los <input type="number"> solo aceptan punto decimal: U.fmt.n() usa la coma
   de es-ES y el navegador descartaba el valor (el campo salía vacío). */
  function inputNum(v) {
    return (v === undefined || v === null || v === '') ? '' : String(U.num(v));
  }
  function setRow(en, i, j) {
    var s = en.sets[j] || {};
    var ex = S.byId(en.exId);
    var rpe = !!S.settings().showRpe;
    var isTime = ex && (ex.tags || []).some(function (t) { return t === 'segundos' || t === 'minutos'; });
    return '<div class="set-row' + (s.done ? ' done' : '') + (rpe ? ' with-rpe' : '') + '">' +
      '<span class="set-idx">' + (j + 1) + '</span>' +
      '<input class="input num" type="number" inputmode="decimal" step="' + (S.settings().units === 'lb' ? '5' : '2.5') + '" min="0" placeholder="' + (ex && ex.bw ? 'PC' : '0') + '" value="' + inputNum(s.weight) + '"' +
        ' data-act-change="train:set-field" data-i="' + i + '" data-j="' + j + '" data-field="weight" aria-label="peso serie ' + (j + 1) + '">' +
      '<input class="input num" type="number" inputmode="numeric" step="1" min="0" placeholder="' + (isTime ? 'seg' : 'reps') + '" value="' + inputNum(s.reps) + '"' +
        ' data-act-change="train:set-field" data-i="' + i + '" data-j="' + j + '" data-field="reps" aria-label="repeticiones serie ' + (j + 1) + '">' +
      (rpe ? '<input class="input num" type="number" inputmode="decimal" step="0.5" min="1" max="10" placeholder="–" value="' + inputNum(s.rpe) + '"' +
        ' data-act-change="train:set-field" data-i="' + i + '" data-j="' + j + '" data-field="rpe" aria-label="RPE serie ' + (j + 1) + '">' : '') +
      '<button class="set-check' + (s.done ? ' on' : '') + '" data-act="train:toggle-set" data-i="' + i + '" data-j="' + j + '" aria-pressed="' + (s.done ? 'true' : 'false') + '" title="Marcar serie completada">' + U.icon('check') + '</button>' +
      /* con una sola serie el botón no haría nada (removeSet se planta) */
      (en.sets.length > 1
        ? '<button class="icon-btn" data-act="train:del-set" data-i="' + i + '" data-j="' + j + '" title="Eliminar serie">' + U.icon('x') + '</button>'
        : '<span></span>') +
    '</div>';
  }

  function exCard(en, i) {
    var ex = S.byId(en.exId);
    var total = T.active() ? T.active().entries.length : 1;
    var doneSets = en.sets.filter(function (s) { return s.done; }).length;
    var allDone = doneSets === en.sets.length && en.sets.length > 0;
    var rpe = !!S.settings().showRpe;
    var vol = en.sets.reduce(function (a, s) { return a + (s.done ? U.units.toKg(U.num(s.weight), T.unit()) * U.num(s.reps) : 0); }, 0);
    return '<div class="ex-card' + (allDone ? ' done' : '') + '" data-ex="' + i + '">' +
      '<div class="ex-head">' +
        '<div class="grow" style="min-width:0"><div class="ex-name">' + U.esc(en.name) + '</div>' +
          '<div class="ex-meta">' + U.esc(ex ? D.groupLabel(ex.group) : '') + (ex ? ' · ' + U.esc(ex.type === 'compuesto' ? 'compuesto' : (ex.type === 'aislado' ? 'aislado' : ex.type)) : '') +
          ' · ' + doneSets + '/' + en.sets.length + ' series' + (vol ? ' · ' + U.fmt.vol(vol) + ' kg' : '') + '</div>' +
          (en.basis ? '<div class="ex-meta">' + U.icon('target') + ' ' + U.esc(en.basis) + '</div>' : '') + '</div>' +
        '<button class="icon-btn" data-act="train:move-ex" data-i="' + i + '" data-dir="-1" title="Subir"' + (i === 0 ? ' disabled' : '') + '>' + U.icon('chev-u') + '</button>' +
        '<button class="icon-btn" data-act="train:move-ex" data-i="' + i + '" data-dir="1" title="Bajar"' + (i >= total - 1 ? ' disabled' : '') + '>' + U.icon('chev-d') + '</button>' +
        '<button class="icon-btn" data-act="train:del-ex" data-i="' + i + '" title="Quitar ejercicio">' + U.icon('trash') + '</button>' +
      '</div>' +
      '<div class="ex-body">' +
        '<div class="set-head' + (rpe ? ' with-rpe' : '') + '"><span>#</span><span>peso (' + U.units.label(T.unit()) + ')</span><span>reps</span>' + (rpe ? '<span>rpe</span>' : '') + '<span>ok</span><span></span></div>' +
        en.sets.map(function (s, j) { return setRow(en, i, j); }).join('') +
        (en.notes ? '<div class="set-hint">' + U.icon('info') + ' ' + U.esc(en.notes) + '</div>' : '') +
        '<div class="prog-mini"><i style="width:' + ((doneSets / (en.sets.length || 1)) * 100).toFixed(0) + '%"></i></div>' +
        '<div class="row wrap" style="gap:6px;margin-top:9px">' +
          '<button class="btn sm ghost" data-act="train:add-set" data-i="' + i + '">' + U.icon('plus') + 'serie</button>' +
          '<button class="btn sm quiet" data-act="train:plate" data-i="' + i + '">' + U.icon('plate') + 'discos</button>' +
          '<button class="btn sm quiet" data-act="train:notes" data-i="' + i + '">' + U.icon('pencil') + 'nota</button>' +
        '</div>' +
        '<div class="set-hint">' + U.icon('rest') + ' descanso sugerido: ' + U.int(en.restSec) + 's (definido por el ejercicio o el coach)</div>' +
      '</div>' +
    '</div>';
  }

  /* Alterna entre el recuadro del descanso y el resumen de la sesión. Mientras
     hay descanso el recuadro queda PEGADO bajo la barra superior, así el tiempo
     sigue a la vista aunque estés en el último ejercicio de la lista. */
  var headerView = 'rest';

  function summaryHtml(a, prog, elapsed) {
    return '<div class="between"><div style="min-width:0"><div class="tiny muted" style="text-transform:uppercase;letter-spacing:.5px">En curso · ' + U.esc(U.d.label(a.dayIso, 'medium')) + '</div>' +
      '<div class="h2 ellipsis" data-act="train:rename" role="button" tabindex="0">' + U.esc(a.name) + '</div></div>' +
      '<div class="center"><div class="num" style="font-size:22px" id="session-clock-big">' + U.fmt.clock(elapsed) + '</div><div class="tiny muted">' + U.fmt.vol(prog.volume) + ' kg</div></div></div>' +
      '<div class="bar mt-s"><i style="width:' + (prog.pct * 100).toFixed(0) + '%"></i></div>' +
      '<div class="between tiny muted" style="margin-top:5px"><span>' + prog.done + ' de ' + prog.total + ' series</span><span>' + Math.round(prog.pct * 100) + '%</span></div>';
  }

  function renderSession(root) {
    var a = T.active();
    var prog = T.sessionProgress();
    var elapsed = Math.round((Date.now() - new Date(a.startedAt).getTime()) / 1000);
    var summary = summaryHtml(a, prog, elapsed);
    var header, cls = 'card accent';
    if (T.restState.running) {
      cls += ' rest-card';
      if (headerView === 'summary') {
        /* resumen + el descanso en una línea: el tiempo nunca se pierde */
        header = summary +
          '<div class="sr-strip mt-s">' +
            '<span class="num" id="sr-mini-time">0:00</span>' +
            '<span class="tiny muted grow ellipsis" id="sr-mini-label"></span>' +
            '<button class="btn sm quiet" data-act="rest:view">' + U.icon('timer') + 'Descanso</button>' +
          '</div>';
      } else {
        header = '<div id="session-rest"></div>';
      }
    } else {
      header = summary;
    }
    root.innerHTML =
      '<div class="' + cls + '">' + header + '</div>' +
      '<section class="mt"><div class="col" style="gap:10px">' +
        (a.entries.length ? a.entries.map(function (en, i) { return exCard(en, i); }).join('') : '<div class="empty">' + U.icon('dumbbell') + '<div>Añade tu primer ejercicio</div></div>') +
      '</div></section>' +
      '<div class="grid c2 mt">' +
        '<button class="btn lg" data-act="train:pick-empty">' + U.icon('plus') + 'Ejercicio</button>' +
        '<button class="btn lg" data-act="routines:pick">' + U.icon('list') + 'Añadir rutina</button>' +
      '</div>' +
      '<section class="mt"><button class="btn primary lg block" data-act="train:finish">' + U.icon('check') + 'Finalizar sesión</button>' +
        '<div class="row mt-s" style="gap:8px"><button class="btn ghost grow" data-act="train:notes-global">' + U.icon('pencil') + 'Nota de sesión</button>' +
        '<button class="btn danger grow" data-act="train:discard">' + U.icon('trash') + 'Descartar</button></div></section>' +
      (a.notes ? '<div class="card tight mt-s"><div class="tiny muted">Nota</div><div class="tiny">' + U.esc(a.notes) + '</div></div>' : '');
    /* el recuadro puede estar renderizado en otro contenedor (p. ej. el
       auto-test): pintamos el nuestro, no el primero del documento */
    if (T.restState.running) T.rest.paint(root);
  }

  V.render = function (root) {
    if (T.active()) renderSession(root); else renderHome(root);
  };

  /* ---------- acciones ---------- */
  var sug = null;
  V.suggestion = function (v) { if (v !== undefined) sug = v; return sug || C.localSuggest(); };

  function refresh() { App.render(); }
  /* lleva la vista al ejercicio recién añadido: si no, queda varias pantallas
     más abajo y parece que no se ha añadido nada */
  function focusEntry(idx) {
    var el = U.$$('#view .ex-card')[U.int(idx)];
    if (!el) return;
    el.classList.add('new');
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    catch (e) { try { el.scrollIntoView(); } catch (e2) { /* noop */ } }
    setTimeout(function () { el.classList.remove('new'); }, 1500);
  }
  function ensureActive() {
    if (!T.active()) T.start({ name: 'Entrenamiento libre' });
  }
  function afterSetChange() {
    var a = T.active();
    if (!a) return;
    var p = T.sessionProgress();
    if (p.done === p.total && p.total > 0 && !S.settings().quickFinish) {
      /* aviso una sola vez por sesión: guardamos solo la última sesión avisada
         en lugar de un mapa con una clave por sesión (crecimiento sin límite) */
      if (App.ui._notifiedSession !== a.id) {
        App.ui._notifiedSession = a.id;
        U.toast('¡Todas las series marcadas! Pulsa Finalizar', { type: 'ok' });
      }
    }
  }

  function startFromItems(items, name, dayIso) {
    T.start({ name: name || 'Entrenamiento', dayIso: dayIso || U.d.today() });
    T.update(function (a) {
      a.entries = items.map(function (it) {
        var ex = S.byId(it.exId);
        if (!ex) return null;
        var n = U.clamp(U.int(it.sets, ex.sets), 1, 12);
        var reps = U.int(it.reps, Math.round((U.int(it.repMin, ex.repMin) + U.int(it.repMax, ex.repMax)) / 2));
        var sug = it.weight ? { weight: U.num(it.weight), basis: it.basis || '' } : S.a.suggestWeight(ex.id, reps, T.unit());
        var sets = [];
        /* sin sugerencia el peso queda vacío, no en 0 */
        for (var i = 0; i < n; i++) sets.push({ weight: sug.weight ? sug.weight : '', reps: reps, done: false, ts: null, rpe: null });
        return {
          exId: ex.id, name: ex.name, restSec: U.int(it.rest, ex.rest), repMin: U.int(it.repMin, ex.repMin),
          repMax: U.int(it.repMax, ex.repMax), sets: sets, notes: it.notes || '', basis: sug.basis || it.basis || ''
        };
      }).filter(Boolean);
    });
    App.render();
  }
  V.startFromItems = startFromItems;

  App.actions = App.actions || {};
  App.actions['train:start-today'] = function () {
    var plan = todayPlan();
    if (!plan.items.length) { U.toast('No hay plan para hoy', { type: 'warn' }); return; }
    if (plan.routine) {
      T.start({ routineId: plan.routine.id, name: plan.routine.name, dayIso: U.d.today(), source: 'plan' });
      App.render();
    } else {
      startFromItems(plan.items, plan.title, U.d.today());
    }
  };
  App.actions['train:start-suggestion'] = function () {
    var s = V.suggestion();
    if (!s.items.length) { U.toast('La sugerencia está vacía', { type: 'warn' }); return; }
    startFromItems(s.items, s.title, U.d.today());
  };
  App.actions['train:save-suggestion'] = function () {
    var s = V.suggestion();
    if (!s.items.length) return;
    App.ui.routineEditor(null, { prefill: s.items, name: s.title, source: s.source === 'ia' ? 'ia' : 'generador' });
  };
  App.actions['train:start-routine'] = function (el) {
    var id = el.getAttribute('data-id');
    var r = S.routine(id);
    if (!r) return;
    if (T.active()) {
      U.confirm({ title: 'Ya hay una sesión en curso', body: '<p>¿Quieres añadir los ejercicios de <b>' + U.esc(r.name) + '</b> a la sesión actual?</p>', okLabel: 'Añadir' }).then(function (ok) {
        if (!ok) return;
        var first = T.active().entries.length;
        T.update(function (a) {
          r.items.forEach(function (it) {
            a.entries.push({
              exId: it.exId, name: (S.byId(it.exId) || {}).name || it.exId, restSec: it.rest, repMin: it.repMin, repMax: it.repMax,
              sets: new Array(U.clamp(it.sets, 1, 12)).fill(null).map(function () {
                var sug = it.weight ? { weight: U.num(it.weight) } : S.a.suggestWeight(it.exId, Math.round((it.repMin + it.repMax) / 2), T.unit());
                return { weight: sug.weight ? sug.weight : '', reps: Math.round((it.repMin + it.repMax) / 2), done: false, ts: null, rpe: null };
              }), notes: it.notes || '', basis: ''
            });
          });
        });
        App.render();
        focusEntry(first);
        U.toast('Rutina añadida a la sesión', { type: 'ok' });
      });
      return;
    }
    T.start({ routineId: r.id, name: r.name, dayIso: U.d.today(), source: 'rutina' });
    App.render();
    U.toast('¡A entrenar! ' + r.name, { type: 'ok' });
  };
  App.actions['train:repeat'] = function (el) {
    var id = el.getAttribute('data-id');
    var sess = S.session(id);
    if (!sess) return;
    if (T.active()) { U.toast('Termina la sesión actual primero', { type: 'warn' }); return; }
    var items = (sess.entries || []).map(function (en) {
      var sets = en.sets || [];
      var top = sets.reduce(function (a, b) { return U.num(b.weight) > U.num(a.weight) ? b : a; }, { weight: 0, reps: 10 });
      return { exId: en.exId, sets: Math.max(1, sets.length), reps: U.num(top.reps) || 10, rest: en.restSec, weight: U.num(top.weight), notes: en.notes || '', basis: 'repetición de ' + U.d.label(sess.date, 'medium') };
    });
    startFromItems(items, sess.name, U.d.today());
    U.toast('Sesión cargada con los pesos anteriores', { type: 'ok' });
  };
  App.actions['train:pick-empty'] = function () {
    App.ui.exercisePicker({ multi: true, title: 'Añadir ejercicios', exclude: T.active() ? T.active().entries.map(function (e) { return e.exId; }) : [] }).then(function (ids) {
      if (!ids || !ids.length) return;
      var first;
      if (!T.active()) {
        T.start({ name: 'Entrenamiento libre', dayIso: U.d.today(), exIds: ids });
        first = 0;
      } else {
        var a = T.active();
        first = a.entries.length;
        ids.forEach(function (id) {
          var ex = S.byId(id);
          if (!ex) return;
          var reps = Math.round((ex.repMin + ex.repMax) / 2);
          var sug = S.a.suggestWeight(id, reps, T.unit());
          var sets = [];
          for (var i = 0; i < U.clamp(ex.sets, 1, 12); i++) sets.push({ weight: sug.weight ? sug.weight : '', reps: reps, done: false, ts: null, rpe: null });
          a.entries.push({ exId: ex.id, name: ex.name, restSec: ex.rest, repMin: ex.repMin, repMax: ex.repMax, sets: sets, notes: '', basis: sug.basis });
        });
        T.update(function () { });
      }
      App.render();
      focusEntry(first);
      U.toast(ids.length + ' ' + U.plural(ids.length, 'ejercicio añadido', 'ejercicios añadidos'), { type: 'ok' });
    });
  };
  App.actions['routines:pick'] = function () {
    var list = S.routines();
    if (!list.length) {
      U.toast('No tienes rutinas guardadas todavía', { type: 'warn' });
      App.router.go('rutinas');
      return;
    }
    App.ui.routinePicker().then(function (id) {
      if (!id) return;
      App.actions['train:start-routine']({ getAttribute: function () { return id; } });
    });
  };
  App.actions['train:toggle-set'] = function (el) {
    var i = U.int(el.getAttribute('data-i')), j = U.int(el.getAttribute('data-j'));
    var res = T.toggleSet(i, j);
    if (!res) return;
    /* autorrelleno de la siguiente serie con los mismos valores */
    var a = T.active();
    var en = a.entries[i];
    if (res.set.done && en.sets[j + 1] && !en.sets[j + 1].done && !U.num(en.sets[j + 1].weight)) {
      en.sets[j + 1].weight = res.set.weight;
      en.sets[j + 1].reps = res.set.reps;
      T.update(function () { });
    }
    afterSetChange();
    App.render();
  };
  App.actions['train:set-field'] = function (el) {
    var i = U.int(el.getAttribute('data-i')), j = U.int(el.getAttribute('data-j')), field = el.getAttribute('data-field');
    var val = el.value === '' ? '' : U.num(el.value);
    if (field === 'rpe') val = val === '' ? '' : U.clamp(U.round(val, 1), 1, 10);
    var patch = {}; patch[field] = val;
    T.setSet(i, j, patch);
    /* el valor se arrastra hacia ABAJO: cambiar el peso en la serie 1 lo aplica
       a las siguientes; cambiarlo desde la 3, de la 3 en adelante. Nunca toca
       las de arriba ni las ya marcadas. */
    if (field !== 'weight' && field !== 'reps') return;
    T.propagateSet(i, j, field, val);
    /* los inputs de abajo se refrescan a mano: sin re-render no se vería el
       arrastre y re-renderizar cerraría el teclado en mitad de la serie */
    var en = T.entry(i);
    if (!en) return;
    U.$$('[data-act-change="train:set-field"][data-i="' + i + '"][data-field="' + field + '"]').forEach(function (inp) {
      var k = U.int(inp.getAttribute('data-j'));
      if (k > j && en.sets[k]) inp.value = inputNum(en.sets[k][field]);
    });
  };
  /* alterna descanso ↔ resumen en la cabecera de la sesión */
  App.actions['rest:view'] = function () {
    headerView = headerView === 'summary' ? 'rest' : 'summary';
    App.render();
  };
  App.actions['train:add-set'] = function (el) { T.addSet(U.int(el.getAttribute('data-i'))); App.render(); };
  App.actions['train:del-set'] = function (el) { T.removeSet(U.int(el.getAttribute('data-i')), U.int(el.getAttribute('data-j'))); App.render(); };
  App.actions['train:del-ex'] = function (el) {
    var i = U.int(el.getAttribute('data-i'));
    var en = T.entry(i);
    U.confirm({ title: 'Quitar ejercicio', body: '<p>¿Quitar <b>' + U.esc(en ? en.name : '') + '</b> de la sesión?</p>', okLabel: 'Quitar', kind: 'danger' }).then(function (ok) {
      if (!ok) return;
      T.removeExercise(i); App.render();
    });
  };
  App.actions['train:move-ex'] = function (el) { T.moveExercise(U.int(el.getAttribute('data-i')), U.int(el.getAttribute('data-dir'))); App.render(); };
  App.actions['train:plate'] = function (el) {
    var i = U.int(el.getAttribute('data-i'));
    var en = T.entry(i);
    if (!en) return;
    var last = en.sets.filter(function (s) { return U.num(s.weight); }).slice(-1)[0];
    var w = last ? U.num(last.weight) : (T.active() ? U.num(T.active().entries[i].sets[0].weight) : 0);
    App.ui.plates(w || '', {
      exId: en.exId, forExercise: en.name,
      onUse: function (val) {
        T.update(function (a) {
          var e = a.entries[i];
          if (!e) return;
          var target = e.sets.filter(function (s) { return !s.done && !U.num(s.weight); })[0] || e.sets[e.sets.length - 1];
          if (target) target.weight = val;
        });
        App.render();
        U.toast(U.fmt.n(val, 2) + ' ' + U.units.label(T.unit()) + ' cargados en ' + en.name, { type: 'ok', ms: 2400 });
      }
    });
  };
  App.actions['train:notes'] = function (el) {
    var i = U.int(el.getAttribute('data-i'));
    var en = T.entry(i);
    U.promptDialog({ title: 'Nota del ejercicio', label: en.name, value: en.notes || '', placeholder: 'sensaciones, técnica, dolor...', multiline: true }).then(function (val) {
      if (val === null) return;
      T.update(function (a) { a.entries[i].notes = val; });
      App.render();
    });
  };
  App.actions['train:notes-global'] = function () {
    var a = T.active();
    U.promptDialog({ title: 'Nota de la sesión', label: 'Notas', value: a.notes || '', placeholder: 'energía, sueño, incidencias...', multiline: true }).then(function (val) {
      if (val === null) return;
      T.update(function (x) { x.notes = val; });
      App.render();
    });
  };
  App.actions['train:rename'] = function () {
    var a = T.active();
    U.promptDialog({ title: 'Nombre de la sesión', label: 'Nombre', value: a.name }).then(function (val) {
      if (!val) return;
      T.update(function (x) { x.name = val; });
      App.render();
    });
  };
  App.actions['train:finish'] = function () {
    var prog = T.sessionProgress();
    U.confirm({
      title: 'Finalizar sesión',
      body: '<p>' + prog.done + ' de ' + prog.total + ' series marcadas · ' + U.fmt.vol(prog.volume) + ' kg de volumen.</p><p class="sub">Se guardará en tu historial y en el calendario.</p>',
      okLabel: 'Guardar sesión'
    }).then(function (ok) {
      if (!ok) return;
      var sess = T.finish();
      App.render();
      if (sess) App.ui.sessionDetail(sess.id, { justFinished: true });
    });
  };
  App.actions['train:discard'] = function () {
    U.confirm({ title: 'Descartar sesión', body: '<p>Se perderán las series marcadas en esta sesión.</p>', okLabel: 'Descartar', kind: 'danger' }).then(function (ok) {
      if (!ok) return;
      T.discard();
      App.render();
      U.toast('Sesión descartada', { type: 'warn' });
    });
  };
  App.actions['session:open'] = function (el) { App.ui.sessionDetail(el.getAttribute('data-id')); };
  App.actions['session:delete'] = function (el) {
    var id = el.getAttribute('data-id');
    U.confirm({ title: 'Eliminar sesión', body: '<p>Esta acción no se puede deshacer.</p>', okLabel: 'Eliminar', kind: 'danger' }).then(function (ok) {
      if (!ok) return;
      S.removeSession(id);
      if (App.ui.closeModal) App.ui.closeModal();
      App.render();
      U.toast('Sesión eliminada', { type: 'warn' });
    });
  };
  App.actions['suggest:refresh'] = function () { V.suggestion(C.localSuggest()); App.render(); };
  App.actions['suggest:ai'] = function () {
    if (!C.hasKey()) {
      U.toast('Configura tu API key de Gemini para usar el coach IA', { type: 'warn' });
      App.router.go('ajustes', 'coach');
      return;
    }
    var t = U.toast('El coach IA está pensando la sesión…', { loading: true, sticky: true });
    C.suggestWorkout({ useAI: true }).then(function (sug) {
      t.close();
      V.suggestion(sug);
      App.render();
      if (sug.error) U.toast('IA no disponible: ' + sug.error, { type: 'warn', ms: 6000 });
      else U.toast('Sesión propuesta por ' + C.model(), { type: 'ok' });
    });
  };
  App.actions['coach:quick'] = function (el) {
    var kind = el.getAttribute('data-kind');
    App.router.go('calendario');
    setTimeout(function () { App.views.calendario.autoPlan(kind !== 'local'); }, 60);
  };
  App.actions['tools:plates'] = function () { App.ui.plates(''); };
  App.actions['tools:timer'] = function () { App.ui.timer(90); };

  App.views = App.views || {};
  App.views.hoy = V;
})();
