/* ==========================================================================
   Pulso · views-routines.js — biblioteca de rutinas y plantillas
   ========================================================================== */
(function () {
  'use strict';
  var U = App.u, D = App.data, S = App.store, T = App.trainer, C = App.coach;
  var V = {};
  V.title = 'Rutinas'; V.tab = 'rutinas'; V.icon = 'list';
  V.sub = function () {
    var n = S.routines().length;
    return n ? n + ' ' + U.plural(n, 'rutina guardada', 'rutinas guardadas') + ' · ' + D.TEMPLATES.length + ' plantillas' : 'Crea tu primera rutina o usa una plantilla';
  };

  function lastUsed(routineId) {
    var s = S.sessions().filter(function (x) { return x.routineId === routineId; })[0];
    return s ? U.d.label(s.date, 'medium') : null;
  }

  function routineCard(r) {
    var names = r.items.map(function (it) { var ex = S.byId(it.exId); return ex ? ex.name : it.exId; });
    var missing = r.items.filter(function (it) { var ex = S.byId(it.exId); return !ex || !S.isAvailable(ex); }).length;
    var blocked = r.items.filter(function (it) { var ex = S.byId(it.exId); return ex && !ex.allowed; }).length;
    var sets = U.sum(r.items, function (i) { return U.int(i.sets, 3); });
    var used = lastUsed(r.id);
    return '<div class="card">' +
      '<div class="between" style="align-items:flex-start">' +
        '<div style="min-width:0"><div class="h3">' + U.esc(r.name) + '</div>' +
          '<div class="tiny muted">' + U.esc(r.focus || (names.length + ' ejercicios')) + '</div></div>' +
        '<div class="row" style="gap:5px">' +
          (r.source === 'ia' ? '<span class="badge a">IA</span>' : (r.source === 'generador' ? '<span class="badge">auto</span>' : '')) +
          (missing ? '<span class="badge warn">' + missing + ' sin equipo</span>' : '') +
          (blocked ? '<span class="badge danger">' + blocked + ' off</span>' : '') +
        '</div></div>' +
      '<div class="tiny muted mt-s">' + r.items.length + ' ejercicios · ' + sets + ' series · ' + (used ? 'última vez ' + used : 'nunca usada') + '</div>' +
      (names.length ? '<div class="set-hint" style="margin-top:6px">' + U.esc(U.trunc(names.slice(0, 5).join(' · '), 96)) + (names.length > 5 ? ' …' : '') + '</div>' : '') +
      '<div class="row wrap" style="gap:6px;margin-top:10px">' +
        '<button class="btn primary sm" data-act="train:start-routine" data-id="' + r.id + '">' + U.icon('play') + 'Empezar</button>' +
        '<button class="btn sm" data-act="routines:detail" data-id="' + r.id + '">Ver</button>' +
        '<button class="btn sm ghost" data-act="routines:edit" data-id="' + r.id + '">' + U.icon('pencil') + 'Editar</button>' +
        '<button class="btn sm quiet" data-act="routines:schedule" data-id="' + r.id + '">' + U.icon('calendar') + 'Agendar</button>' +
        '<button class="btn sm quiet" data-act="routines:menu" data-id="' + r.id + '" title="Más">···</button>' +
      '</div></div>';
  }

  function templatesSection() {
    return '<div class="col" style="gap:9px">' + D.TEMPLATES.map(function (t) {
      var groups = U.uniq(t.recipe.map(function (p) { return D.groupLabel(p[0]); }));
      var total = U.sum(t.recipe, function (p) { return p[1]; });
      return '<div class="card tight"><div class="between"><div style="min-width:0">' +
        '<div class="h3">' + U.esc(t.name) + '</div>' +
        '<div class="tiny muted">' + total + ' ejercicios · ' + U.esc(groups.join(' · ')) + '</div>' +
        '<div class="tiny muted">' + U.esc(t.hint) + '</div></div>' +
        '<button class="btn sm" data-act="routines:template" data-id="' + t.id + '">' + U.icon('plus') + 'Crear</button>' +
      '</div></div>';
    }).join('') + '</div>';
  }

  V.render = function (root) {
    var list = S.routines();
    root.innerHTML =
      '<div class="grid c2">' +
        '<button class="btn lg primary" data-act="routines:new">' + U.icon('plus') + 'Nueva rutina</button>' +
        '<button class="btn lg" data-act="routines:generate">' + U.icon('wand') + 'Generar auto</button>' +
      '</div>' +
      '<div class="mt-s"><button class="btn block" data-act="routines:ai">' + U.icon('sparkles') + 'Generar rutina con el coach IA</button></div>' +
      '<section class="mt"><div class="sec-head"><span class="h3">Mis rutinas</span>' + (list.length ? '<span class="tiny muted">' + list.length + '</span>' : '') + '</div>' +
        (list.length
          ? '<div class="col" style="gap:10px">' + list.map(routineCard).join('') + '</div>'
          : '<div class="empty">' + U.icon('list') + '<div>Sin rutinas todavía</div><div class="tiny">Usa una plantilla o genera una con IA según tu historial</div></div>') +
      '</section>' +
      '<section class="mt"><div class="sec-head"><span class="h3">Plantillas</span><span class="tiny muted">se adaptan a tu equipo</span></div>' + templatesSection() + '</section>' +
      '<section class="mt"><div class="card ghost"><div class="row"><span class="ico muted">' + U.icon('info') + '</span>' +
        '<div class="tiny muted grow">Las plantillas y los generadores solo usan ejercicios permitidos que puedes hacer con tu equipamiento actual. Ajusta la biblioteca en Ajustes → Ejercicios.</div></div></div></section>';
  };

  App.actions = App.actions || {};
  App.actions['routines:new'] = function () { App.ui.routineEditor(null); };
  App.actions['routines:edit'] = function (el) { App.ui.routineEditor(el.getAttribute('data-id')); };
  App.actions['routines:detail'] = function (el) { App.ui.routineDetail(el.getAttribute('data-id')); };
  App.actions['routines:duplicate'] = function (el) {
    var r = S.duplicateRoutine(el.getAttribute('data-id'));
    if (r) { App.render(); U.toast('Rutina duplicada', { type: 'ok' }); }
  };
  App.actions['routines:delete'] = function (el) {
    var id = el.getAttribute('data-id');
    var r = S.routine(id);
    U.confirm({ title: 'Eliminar rutina', body: '<p>¿Eliminar <b>' + U.esc(r ? r.name : '') + '</b>?</p><p class="sub">Las sesiones ya registradas no se borran.</p>', okLabel: 'Eliminar', kind: 'danger' }).then(function (ok) {
      if (!ok) return;
      if (App.ui.closeModal) App.ui.closeModal();
      S.removeRoutine(id);
      App.render();
      U.toast('Rutina eliminada', { type: 'warn' });
    });
  };
  App.actions['routines:menu'] = function (el) {
    var id = el.getAttribute('data-id');
    U.modal({
      title: 'Opciones de rutina', subtitle: (S.routine(id) || {}).name || '',
      body: '<div class="list card flush">' +
        '<button class="list-item tappable" data-act="routines:edit" data-id="' + id + '">' + U.icon('pencil') + '<span class="li-main"><span class="li-title">Editar</span></span></button>' +
        '<button class="list-item tappable" data-act="routines:duplicate" data-id="' + id + '">' + U.icon('copy') + '<span class="li-main"><span class="li-title">Duplicar</span></span></button>' +
        '<button class="list-item tappable" data-act="routines:schedule" data-id="' + id + '">' + U.icon('calendar') + '<span class="li-main"><span class="li-title">Agendar en el calendario</span></span></button>' +
        '<button class="list-item tappable" data-act="routines:delete" data-id="' + id + '">' + U.icon('trash') + '<span class="li-main"><span class="li-title danger">Eliminar</span></span></button>' +
      '</div>'
    });
  };
  App.actions['routines:template'] = function (el) {
    var id = el.getAttribute('data-id');
    var r = S.routineFromTemplate(id);
    if (!r) { U.toast('No se pudo crear la rutina', { type: 'err' }); return; }
    App.render();
    U.toast('Rutina creada: ' + r.name, { type: 'ok' });
    App.ui.routineEditor(r.id);
  };
  App.actions['routines:generate'] = function () {
    U.modal({
      title: 'Generar rutina automática',
      subtitle: 'Con tus ejercicios permitidos y tu equipamiento',
      body: '<div class="col" style="gap:9px">' +
        '<label class="field"><span class="label">Enfoque</span><select class="select" data-in id="gen-tpl">' +
          D.TEMPLATES.map(function (t) { return '<option value="' + t.id + '">' + U.esc(t.name) + ' — ' + U.esc(t.hint) + '</option>'; }).join('') +
        '</select></label>' +
        '<label class="field"><span class="label">Evitar ejercicios de las últimas N sesiones</span>' +
          '<select class="select" data-in id="gen-rotate"><option value="0">No rotar</option><option value="2">2 sesiones</option><option value="3" selected>3 sesiones</option><option value="5">5 sesiones</option></select></label>' +
        '<p class="sub">Se ordenan primero los compuestos y se ajustan series, repeticiones y descansos a tu objetivo actual (' + U.esc(D.GOAL_LABEL(S.settings().goal)) + ').</p></div>',
      actions: [{ label: 'Cancelar', value: null, kind: 'ghost' }, {
        label: 'Generar', value: 'ok', kind: 'primary',
        onClick: function (box, close) {
          var tpl = box.querySelector('#gen-tpl').value;
          var rot = U.int(box.querySelector('#gen-rotate').value, 3);
          var t = D.TEMPLATES.filter(function (x) { return x.id === tpl; })[0];
          var items = S.itemsFromRecipe(t.recipe, { rotate: rot });
          var st = S.settings();
          items = items.map(function (it) {
            var ex = S.byId(it.exId);
            return {
              exId: it.exId, sets: ex.type === 'compuesto' ? (D.GOAL_SETS[st.goal] || 4) : Math.max(3, (D.GOAL_SETS[st.goal] || 4) - 1),
              repMin: D.GOAL_REPS[st.goal][0], repMax: D.GOAL_REPS[st.goal][1], rest: D.GOAL_REST[st.goal], notes: ''
            };
          });
          close('done');
          if (!items.length) { U.toast('No hay ejercicios disponibles con tu equipo', { type: 'warn' }); return; }
          var r = S.addRoutine({ name: t.name, focus: U.uniq(items.map(function (i) { return D.groupLabel((S.byId(i.exId) || {}).group); })).slice(0, 3).join(' · '), items: items, source: 'generador' });
          App.render();
          App.ui.routineEditor(r.id);
        }
      }]
    });
  };
  App.actions['routines:ai'] = function () {
    if (!C.hasKey()) { U.toast('Configura tu API key de Gemini primero', { type: 'warn' }); App.router.go('ajustes', 'coach'); return; }
    var t = U.toast('El coach IA está diseñando la rutina…', { loading: true, sticky: true });
    C.suggestWorkout({ useAI: true }).then(function (sug) {
      t.close();
      if (!sug.items || !sug.items.length) { U.toast('No se pudo generar la rutina', { type: 'err' }); return; }
      if (sug.error) U.toast('IA no disponible (' + sug.error + '): se guardó la versión local', { type: 'warn', ms: 6000 });
      App.ui.routineEditor(null, { prefill: sug.items, name: sug.title, notes: (sug.rationale || []).join(' '), source: sug.source === 'ia' ? 'ia' : 'generador' });
    });
  };
  App.actions['routines:schedule'] = function (el) {
    var id = el.getAttribute('data-id');
    App.ui.dayPicker({ title: 'Agendar rutina', routineId: id });
  };

  App.views = App.views || {};
  App.views.rutinas = V;
})();
