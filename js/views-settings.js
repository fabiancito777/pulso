/* ==========================================================================
   Pulso · views-settings.js — configuración completa de la app
   ========================================================================== */
(function () {
  'use strict';
  var U = App.u, D = App.data, S = App.store, T = App.trainer, C = App.coach, Ch = App.charts;
  var V = {};
  V.title = 'Ajustes'; V.tab = 'ajustes'; V.icon = 'gear';
  var sub = 'perfil';
  var filter = { q: '', group: '', equip: '', state: 'all' };
  var SUBS = [
    { k: 'perfil', l: 'Perfil', i: 'user' }, { k: 'apariencia', l: 'Apariencia', i: 'moon' },
    { k: 'entreno', l: 'Entreno', i: 'timer' }, { k: 'equipo', l: 'Equipo', i: 'dumbbell' },
    { k: 'discos', l: 'Discos', i: 'plate' }, { k: 'ejercicios', l: 'Ejercicios', i: 'database' },
    { k: 'coach', l: 'Coach AI', i: 'sparkles' }, { k: 'datos', l: 'Datos', i: 'download' }
  ];
  V.sub = function () { return 'Personaliza Pulso a tu medida'; };
  V.section = function (k) { if (k) sub = k; return sub; };

  function switchRow(label, hint, key, val) {
    return '<label class="switch list-item" style="justify-content:space-between"><div class="li-main"><div class="li-title">' + U.esc(label) + '</div>' +
      (hint ? '<div class="li-sub">' + U.esc(hint) + '</div>' : '') + '</div>' +
      '<input type="checkbox" ' + (val ? 'checked' : '') + ' data-act-change="settings:set" data-key="' + key + '" data-type="bool" data-rerender="1">' +
      '<span class="track"><span class="thumb"></span></span></label>';
  }
  function numRow(label, hint, key, val, step, min, max) {
    return '<div class="list-item"><div class="li-main"><div class="li-title">' + U.esc(label) + '</div>' + (hint ? '<div class="li-sub">' + U.esc(hint) + '</div>' : '') + '</div>' +
      '<input class="input num" style="width:96px" type="number" value="' + U.esc(val) + '" step="' + (step || 1) + '" min="' + (min === undefined ? 0 : min) + '"' + (max !== undefined ? ' max="' + max + '"' : '') + ' data-act-change="settings:set" data-key="' + key + '" data-type="number"></div>';
  }
  function textRow(label, hint, key, val, ph) {
    return '<label class="field"><span class="label">' + U.esc(label) + '</span>' +
      '<input class="input" value="' + U.esc(val || '') + '" placeholder="' + U.esc(ph || '') + '" data-act-change="settings:set" data-key="' + key + '" data-type="text">' +
      (hint ? '<span class="sub">' + U.esc(hint) + '</span>' : '') + '</label>';
  }
  function selectRow(label, hint, key, val, options) {
    return '<label class="field"><span class="label">' + U.esc(label) + '</span><select class="select" data-act-change="settings:set" data-key="' + key + '" data-type="text" data-rerender="1">' +
      options.map(function (o) { var v = typeof o === 'string' ? o : o.value, l = typeof o === 'string' ? o : o.label; return '<option value="' + U.esc(v) + '"' + (String(val) === String(v) ? ' selected' : '') + '>' + U.esc(l) + '</option>'; }).join('') +
      '</select>' + (hint ? '<span class="sub">' + U.esc(hint) + '</span>' : '') + '</label>';
  }

  /* ---------- perfil ---------- */
  function secPerfil() {
    var st = S.settings();
    return '<div class="card">' + textRow('Nombre', 'Se usa para saludarte y en los prompts del coach', 'name', st.name, 'Tu nombre') +
      '<div class="divider"></div>' +
      selectRow('Nivel', 'Ajusta volumen y complejidad de las sugerencias', 'level', st.level, D.LEVELS) +
      selectRow('Objetivo principal', 'Define repeticiones, series y descansos por defecto', 'goal', st.goal, D.GOALS.map(function (g) { return { value: g.key, label: g.label }; })) +
      selectRow('Días de entreno por semana', 'Se usa para el plan semanal', 'daysPerWeek', st.daysPerWeek, ['2', '3', '4', '5', '6']) +
      selectRow('Unidades', 'Cambia la visualización de pesos', 'units', st.units, [{ value: 'kg', label: 'Kilogramos (kg)' }, { value: 'lb', label: 'Libras (lb)' }]) +
    '</div>' +
    '<div class="card tight mt"><div class="row"><span class="ico muted">' + U.icon('info') + '</span><div class="tiny muted">Con objetivo <b>' + U.esc(D.GOAL_LABEL(st.goal)) + '</b> el coach propone ' + D.GOAL_REPS[st.goal].join('-') + ' repeticiones, ' + D.GOAL_SETS[st.goal] + ' series y descansos de ~' + D.GOAL_REST[st.goal] + ' s.</div></div></div>';
  }

  /* ---------- apariencia ---------- */
  function secApariencia() {
    var st = S.settings();
    return '<div class="card">' +
      '<div class="label mb-s">Tema</div><div class="grid c3">' + D.THEMES.map(function (t) {
        return '<button class="card tight" style="border-color:' + (st.theme === t.key ? 'var(--accent)' : 'var(--border)') + '" data-act="settings:theme" data-key="' + t.key + '">' +
          '<div class="h3">' + U.esc(t.label) + '</div><div class="tiny muted">' + U.esc(t.hint) + '</div></button>';
      }).join('') + '</div>' +
      '<div class="divider"></div><div class="label mb-s">Color de acento</div>' +
      '<div class="row wrap" style="gap:8px">' + D.ACCENTS.map(function (a) {
        return '<button style="width:36px;height:36px;border-radius:50%;background:' + a + ';border:2px solid ' + (st.accent.toLowerCase() === a.toLowerCase() ? 'var(--text)' : 'transparent') + '" data-act="settings:accent" data-key="' + a + '" aria-label="acento ' + a + '"></button>';
      }).join('') + '</div>' +
    '</div>' +
    '<div class="card flush mt">' +
      switchRow('Sonido', 'Pitidos al acabar el descanso y al completar series', 'sound', st.sound) +
      numRow('Volumen', '0 a 1', 'volume', st.volume, 0.1, 0, 1) +
      switchRow('Aviso de los últimos 3 s', 'Tres ticks suaves antes de que termine el descanso', 'countdownTick', st.countdownTick) +
      switchRow('Vibración', 'En móviles compatibles', 'vibrate', st.vibrate) +
      switchRow('Notificaciones del sistema', 'Aviso al terminar el descanso', 'notify', st.notify) +
      switchRow('Mantener la sesión despierta', 'Pantalla encendida durante el entreno', 'keepAwake', st.keepAwake) +
      switchRow('Audio en segundo plano', 'Aviso con el móvil bloqueado. Apágalo si escuchas música (Spotify…): atenúa el volumen', 'bgAudio', st.bgAudio !== false) +
    '</div>';
  }

  /* ---------- entreno ---------- */
  function secEntreno() {
    var st = S.settings();
    return '<div class="card flush">' +
      switchRow('Descanso automático al marcar serie', 'Usa el tiempo sugerido de cada ejercicio o el que proponga el coach', 'autoRest', st.autoRest) +
      numRow('Incremento de progresión', 'Cuánto subir cuando puedes con el rango alto', 'increment', st.increment, 0.5, 0.5, 20) +
      switchRow('Mostrar RPE', 'Registrar esfuerzo percibido (1-10) por serie', 'showRpe', st.showRpe) +
      switchRow('Finalizar rápido', 'No avisar cuando completes todas las series', 'quickFinish', st.quickFinish) +
      switchRow('Contar aproximaciones', 'Incluir series de calentamiento en el volumen', 'countWarmups', st.countWarmups) +
    '</div>' +
    '<div class="card tight mt"><div class="row"><span class="ico muted">' + U.icon('info') + '</span>' +
        '<div class="tiny muted grow">El descanso entre series lo define cada ejercicio en la biblioteca (más para compuestos, menos para aislamientos) y el coach IA puede ajustarlo por sesión. No se configura a mano para respetar los tiempos óptimos.</div></div></div>';
  }

  /* ---------- equipo ---------- */
  function secEquipo() {
    var eq = S.equipment();
    var on = D.EQUIPMENT.filter(function (e) { return eq[e.key]; }).length;
    var cats = D.equipCats();
    return '<div class="card tight">' +
      '<div class="between mb-s"><div class="h3">Tu material (' + on + '/' + D.EQUIPMENT.length + ')</div>' +
      '<span class="tiny muted">filtra qué ejercicios se pueden sugerir</span></div>' +
      '<div class="hr-scroll">' +
        '<button class="chip" data-act="equip:preset" data-kind="basico">Casa básica</button>' +
        '<button class="chip" data-act="equip:preset" data-kind="gym">Gym completo</button>' +
        '<button class="chip" data-act="equip:preset" data-kind="todo">Todo</button>' +
        '<button class="chip" data-act="equip:preset" data-kind="ninguno">Solo peso corporal</button>' +
      '</div></div>' +
      '<div class="col" style="gap:14px">' + cats.map(function (cat) {
        var items = D.EQUIPMENT.filter(function (e) { return e.cat === cat; });
        return '<section><div class="sec-head"><span class="h3">' + U.esc(cat) + '</span><span class="tiny muted">' + items.filter(function (i) { return eq[i.key]; }).length + '/' + items.length + '</span></div>' +
          '<div class="row wrap" style="gap:7px">' + items.map(function (e) {
            return '<button class="toggle-pill ' + (eq[e.key] ? 'on' : 'off') + '" data-act="equip:toggle" data-key="' + e.key + '" title="' + U.esc(e.hint) + '">' +
              (eq[e.key] ? U.icon('check') : U.icon('plus')) + U.esc(e.label) + '</button>';
          }).join('') + '</div></section>';
      }).join('') + '</div>' +
      '<div class="card ghost mt"><div class="row"><span class="ico muted">' + U.icon('info') + '</span><div class="tiny muted grow">Los ejercicios que necesiten material desactivado se excluyen de las sugerencias, las plantillas y los planes del coach. Marca <b>Discos / inventario de peso</b> si cargas peso con barras o mancuernas cargables.</div></div></div>';
  }

  /* ---------- discos (acepta kg y lb; el calculo se hace en kg) ---------- */
  function secDiscos() {
    var st = S.settings(), unit = st.units;
    var ml = T.maxLoadable();
    var inv = (st.plates || []).filter(function (p) { return p.on !== false; });
    var kgOf = function (p) { return U.units.toKg(U.num(p.w), p.unit || 'kg'); };
    var rows = (st.plates || []).map(function (p, i) {
      var pUnit = p.unit || 'kg';
      var kg = kgOf(p);
      return '<div class="list-item">' +
        '<input class="input num" style="width:76px" type="number" step="0.25" min="0" value="' + U.esc(p.w) + '" data-act-change="plates:update" data-i="' + i + '" data-field="w" aria-label="medida del disco">' +
        '<select class="select" style="width:82px;min-height:38px;padding:6px 26px 6px 10px" data-act-change="plates:update" data-i="' + i + '" data-field="unit" aria-label="unidad del disco">' +
          '<option value="kg"' + (pUnit === 'kg' ? ' selected' : '') + '>kg</option>' +
          '<option value="lb"' + (pUnit === 'lb' ? ' selected' : '') + '>lb</option></select>' +
        '<span class="tiny muted">x</span>' +
        '<input class="input num" style="width:60px" type="number" step="1" min="0" value="' + U.esc(p.pairs) + '" data-act-change="plates:update" data-i="' + i + '" data-field="pairs" aria-label="pares disponibles">' +
        '<span class="tiny muted grow num">= ' + U.fmt.n(kg, 2) + ' kg' + (pUnit === 'lb' ? ' · ' + U.fmt.n(p.w) + ' lb' : '') +
          ' · ' + U.int(p.pairs, 1) + ' ' + (U.int(p.pairs, 1) === 1 ? 'par' : 'pares') + ' (' + U.int(p.pairs, 1) * 2 + ' discos) · ' + U.fmt.n(kg * U.int(p.pairs, 1), 2) + ' kg por lado de barra</span>' +
        '<button class="toggle-pill ' + (p.on !== false ? 'on' : 'off') + '" data-act="plates:toggle" data-i="' + i + '">' + (p.on !== false ? U.icon('check') : 'no') + '</button>' +
        '<button class="icon-btn" data-act="plates:remove" data-i="' + i + '">' + U.icon('x') + '</button>' +
      '</div>';
    }).join('');
    var bars = st.bars || {};
    var mld = T.maxLoadable({ mode: 'db2' });
    var barHint = function (kg) { return 'Peso sin discos · 0 kg si es de plástico · ' + U.fmt.n(U.units.fromKg(U.num(kg), 'lb'), 1) + ' lb'; };
    return '<div class="grid c2">' +
      '<div class="kpi"><div class="kpi-label">Máximo en barra</div><div class="kpi-value">' + U.fmt.n(ml.totalKg, 1) + '<span class="tiny muted"> kg</span></div><div class="kpi-delta">= ' + U.fmt.n(U.units.fromKg(ml.totalKg, unit), 1) + ' ' + unit + ' · ' + U.fmt.n(ml.sideKg, 1) + ' kg por lado</div></div>' +
      '<div class="kpi"><div class="kpi-label">Máximo por mancuerna</div><div class="kpi-value">' + U.fmt.n(mld.totalKg, 1) + '<span class="tiny muted"> kg</span></div><div class="kpi-delta">cargando 2 mancuernas a la vez</div></div>' +
      '<div class="kpi"><div class="kpi-label">Discos activos</div><div class="kpi-value">' + inv.length + '</div><div class="kpi-delta">' + U.sum(inv, function (p) { return U.int(p.pairs, 1) * 2; }) + ' discos · ' + U.fmt.n(U.sum(inv, function (p) { return kgOf(p) * U.int(p.pairs, 1); }), 1) + ' kg por lado</div></div></div>' +
      '<div class="card tight mt"><div class="row"><span class="ico muted">' + U.icon('info') + '</span><div class="tiny muted grow">Un <b>par</b> son 2 discos: uno para cada lado de la barra o cada extremo de la mancuerna. Con los mismos discos la barra admite <b>' + U.fmt.n(ml.sideKg, 1) + ' kg por lado</b>, una mancuerna suelta <b>' + U.fmt.n(ml.sideKg, 1) + ' kg por extremo</b> y, cargando dos mancuernas a la vez, <b>' + U.fmt.n(U.sum(T.plateCaps('db2'), function (it) { return it.cap * it.p.kg; }), 1) + ' kg por extremo en cada una</b>. Se pueden mezclar discos en kg y en lb (todo se calcula en kilogramos).</div></div></div>' +
      '<div class="card flush mt"><div class="list">' + (rows || '<div class="empty">Sin discos configurados</div>') + '</div></div>' +
      '<button class="btn block mt-s" data-act="plates:add">' + U.icon('plus') + 'Añadir medida de disco</button>' +
      '<div class="card flush mt"><div class="list">' +
        numRow('Peso de la barra', barHint(bars.olimpica), 'bars.olimpica', bars.olimpica, 0.5, 0, 100) +
        numRow('Peso de la barra EZ', barHint(bars.ez), 'bars.ez', bars.ez, 0.5, 0, 100) +
        numRow('Peso del mango de mancuerna', barHint(bars.mancuerna), 'bars.mancuerna', bars.mancuerna, 0.5, 0, 50) +
      '</div></div>' +
      '<div class="mt">' + Ch.hbars({
        data: inv.slice().sort(function (a, b) { return kgOf(b) - kgOf(a); }).map(function (p) {
          var kg = kgOf(p);
          return { label: U.fmt.n(kg, 2) + ' kg' + (p.unit === 'lb' ? ' (' + U.fmt.n(p.w) + ' lb)' : ''), value: kg * U.int(p.pairs, 1) * 2, color: T.plateClass(kg) ? 'var(--accent)' : 'var(--surface-4)' };
        }), format: 'w', unit: 'kg totales'
      }) + '</div>' +
      '<div class="card tight mt"><button class="btn block" data-act="tools:plates">' + U.icon('plate') + 'Abrir calculadora de discos</button></div>';
  }

  /* ---------- ejercicios ---------- */
  function filteredExercises() {
    var q = U.norm(filter.q);
    return S.exercises().filter(function (e) {
      if (q && U.norm(e.name).indexOf(q) < 0) return false;
      if (filter.group && e.group !== filter.group) return false;
      if (filter.state === 'allowed' && !e.allowed) return false;
      if (filter.state === 'blocked' && e.allowed) return false;
      if (filter.state === 'unavailable' && S.isAvailable(e)) return false;
      if (filter.state === 'custom' && !e.custom) return false;
      return true;
    }).sort(function (a, b) {
      var ga = D.GROUPS.map(function (x) { return x.key; }).indexOf(a.group), gb = D.GROUPS.map(function (x) { return x.key; }).indexOf(b.group);
      if (ga !== gb) return ga - gb;
      return a.name < b.name ? -1 : 1;
    });
  }

  function exRow(e) {
    var missing = S.missingEquip(e);
    return '<div class="ex-pick' + (e.allowed ? '' : ' blocked') + '" style="' + (e.allowed ? '' : 'opacity:.55') + '">' +
      '<div class="grow" style="min-width:0"><div class="row" style="gap:6px"><span class="li-title ellipsis">' + U.esc(e.name) + '</span>' +
        (e.custom ? '<span class="badge">propio</span>' : '') + (e.bw ? '<span class="badge">PC</span>' : '') + '</div>' +
        '<div class="li-sub">' + U.esc(D.groupLabel(e.group)) + ' · ' + U.esc(e.type) + ' · ' + e.sets + '×' + e.repMin + '-' + e.repMax + ' · ' + e.rest + 's' +
        (missing.length ? ' · <span class="warn">falta: ' + U.esc(U.trunc(missing.join(', '), 40)) + '</span>' : '') + '</div></div>' +
      '<button class="toggle-pill ' + (e.allowed ? 'on' : 'off') + '" data-act="ex:allow" data-id="' + e.id + '" data-val="' + (e.allowed ? '0' : '1') + '" title="Permitir o prohibir">' + (e.allowed ? 'permitido' : 'prohibido') + '</button>' +
      '<button class="icon-btn" data-act="ex:edit" data-id="' + e.id + '">' + U.icon('pencil') + '</button>' +
      (e.custom ? '<button class="icon-btn" data-act="ex:delete" data-id="' + e.id + '">' + U.icon('trash') + '</button>' : '') +
    '</div>';
  }

  function exListHtml() {
    var list = filteredExercises();
    if (!list.length) return '<div class="empty">Sin resultados con estos filtros</div>';
    var blocked = list.filter(function (e) { return !e.allowed; }).length;
    return '<div class="row between wrap tiny muted" style="padding:2px 4px 8px;row-gap:6px"><span>' + list.length + ' ejercicios · ' + (list.length - blocked) + ' permitidos</span>' +
      '<span class="row wrap" style="gap:6px"><button class="btn sm ghost" data-act="ex:bulk" data-val="1">Permitir todos</button>' +
      '<button class="btn sm ghost" data-act="ex:bulk" data-val="0">Prohibir todos</button></span></div>' +
      '<div class="card flush">' + list.map(exRow).join('') + '</div>';
  }

  function secEjercicios() {
    var total = S.exercises().length;
    var blocked = S.exercises().filter(function (e) { return !e.allowed; }).length;
    return '<div class="grid c3">' +
      '<div class="kpi"><div class="kpi-label">Biblioteca</div><div class="kpi-value">' + total + '</div><div class="kpi-delta">ejercicios</div></div>' +
      '<div class="kpi"><div class="kpi-label">Permitidos</div><div class="kpi-value">' + (total - blocked) + '</div><div class="kpi-delta">' + blocked + ' prohibidos</div></div>' +
      '<div class="kpi"><div class="kpi-label">Con tu equipo</div><div class="kpi-value">' + S.usable().length + '</div><div class="kpi-delta">listos para sugerir</div></div></div>' +
      '<div class="card mt"><div class="search">' + U.icon('search') + '<input class="input" id="ex-search" placeholder="Buscar ejercicio…" value="' + U.esc(filter.q) + '" data-act-input="ex:search"></div>' +
        '<div class="grid c2 mt-s">' +
          '<select class="select" data-act-change="ex:filter" data-field="group"><option value="">Todos los grupos</option>' +
            D.GROUPS.map(function (g) { return '<option value="' + g.key + '"' + (filter.group === g.key ? ' selected' : '') + '>' + U.esc(g.label) + '</option>'; }).join('') + '</select>' +
          '<select class="select" data-act-change="ex:filter" data-field="state">' +
            [['all', 'Todos'], ['allowed', 'Permitidos'], ['blocked', 'Prohibidos'], ['unavailable', 'Sin material'], ['custom', 'Propios']].map(function (o) {
              return '<option value="' + o[0] + '"' + (filter.state === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
            }).join('') + '</select></div>' +
        '<div class="row mt-s" style="gap:8px"><button class="btn sm" data-act="ex:add">' + U.icon('plus') + 'Añadir propio</button>' +
          '<button class="btn sm ghost" data-act="ex:reset-filters">Limpiar filtros</button></div></div>' +
      '<div class="mt" id="ex-list">' + exListHtml() + '</div>';
  }

  /* ---------- coach ai ---------- */
  function secCoach() {
    var ai = S.settings().ai;
    var models = V.models && V.models.length ? V.models : D.AI_MODELS;
    if (models.filter(function (m) { return m.id === ai.model; }).length === 0) models = models.concat([{ id: ai.model, label: ai.model, hint: 'personalizado' }]);
    models = models.slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    var key = String(ai.apiKey || '');
    var masked = key ? key.slice(0, 6) + '…' + key.slice(-4) : '';
    return '<div class="card">' +
      '<div class="between mb-s"><div class="h3">' + U.icon('key') + ' API key de Gemini</div><span class="badge ' + (C.hasKey() ? 'ok' : 'warn') + '">' + (C.hasKey() ? 'configurada' : 'falta') + '</span></div>' +
      '<div class="row" style="gap:8px"><input class="input" id="ai-key" type="' + (V.showKey ? 'text' : 'password') + '" value="' + U.esc(V.showKey ? key : '') + '" placeholder="' + (key ? masked : 'AIza…') + '" autocomplete="off" spellcheck="false" data-act-change="ai:key">' +
        '<button class="icon-btn" data-act="ai:toggle-key" title="Mostrar u ocultar">' + U.icon(V.showKey ? 'eye-off' : 'eye') + '</button></div>' +
      '<div class="row mt-s" style="gap:8px;flex-wrap:wrap"><button class="btn sm" data-act="ai:test">' + U.icon('zap') + 'Probar conexión</button>' +
        '<button class="btn sm ghost" data-act="ai:fetch-models">' + U.icon('refresh') + 'Cargar modelos</button>' +
        '<a class="btn sm quiet" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Obtener key</a></div>' +
      '<p class="sub mt-s">La key se guarda solo en el almacenamiento local de este navegador y se envía directamente a Google (<i>generativelanguage.googleapis.com</i>).</p></div>' +
      '<div class="card flush mt">' +
        '<label class="field list-item" style="display:block"><span class="label">Modelo</span><select class="select" data-act-change="ai:set" data-key="model" data-rerender="1">' +
          models.map(function (m) { return '<option value="' + U.esc(m.id) + '"' + (ai.model === m.id ? ' selected' : '') + '>' + U.esc(m.label) + (m.hint ? ' — ' + U.esc(m.hint) : '') + '</option>'; }).join('') + '</select></label>' +
        '<label class="field list-item" style="display:block"><span class="label">Nivel de pensamiento (thinkingLevel)</span><select class="select" data-act-change="ai:set" data-key="thinkingLevel" data-rerender="1">' +
          D.THINKING_LEVELS.map(function (t) { return '<option value="' + t.key + '"' + (ai.thinkingLevel === t.key ? ' selected' : '') + '>' + U.esc(t.label) + ' — ' + U.esc(t.hint) + '</option>'; }).join('') + '</select></label>' +
        numRow('Presupuesto de pensamiento (thinkingBudget)', 'Solo modelos 2.5 · 0 lo desactiva, -1 es dinámico. Se ignora si eliges un nivel', 'ai.thinkingBudget', ai.thinkingBudget, 1, -1, 32768) +
        switchRow('Mostrar razonamiento del modelo', 'includeThoughts: muestra el resumen interno de Gemini', 'ai.includeThoughts', ai.includeThoughts) +
        numRow('Temperature', '0 = determinista, 1 = creativo', 'ai.temperature', ai.temperature, 0.1, 0, 2) +
        numRow('Máximo de tokens de salida', 'Súbelo si las rutinas se cortan', 'ai.maxTokens', ai.maxTokens, 512, 512, 65536) +
      '</div>' +
      '<div class="card mt"><label class="field"><span class="label">Instrucciones del sistema (systemInstruction)</span>' +
        '<textarea class="input" style="min-height:150px" data-act-change="ai:system" placeholder="' + U.esc(C.DEFAULT_SYSTEM.slice(0, 90)) + '…">' + U.esc(ai.systemPrompt || '') + '</textarea></label>' +
        '<div class="row mt-s" style="gap:8px"><button class="btn sm ghost" data-act="ai:system-default">Restaurar el prompt por defecto</button>' +
        '<button class="btn sm quiet" data-act="ai:system-copy">' + U.icon('copy') + 'Ver/editar el actual</button></div></div>' +
      '<div class="card tight mt"><div class="row"><span class="ico muted">' + U.icon('info') + '</span><div class="tiny muted grow">El coach recibe tu perfil, equipamiento, inventario, ejercicios permitidos e historial reciente en cada petición. Con la key configurada, la pestaña Coach y los generadores usan la IA; sin ella, todo funciona con el planificador local.</div></div></div>';
  }

  /* ---------- datos ---------- */
  function secDatos() {
    var bytes = U.st.bytes();
    var sess = S.sessions().length, demo = S.sessions().filter(function (s) { return s.demo; }).length;
    return '<div class="grid c2">' +
      '<div class="kpi"><div class="kpi-label">Sesiones</div><div class="kpi-value">' + sess + '</div><div class="kpi-delta">' + demo + ' de ejemplo</div></div>' +
      '<div class="kpi"><div class="kpi-label">Almacenamiento</div><div class="kpi-value">' + U.fmt.n(Math.round(bytes / 1024)) + '<span class="tiny muted"> KB</span></div><div class="kpi-delta">localStorage · ' + (U.st.available ? 'disponible' : 'solo memoria') + '</div></div></div>' +
      (U.st.available ? '' : '<div class="card tight mt" style="border-color:var(--warn)"><div class="tiny warn">Tu navegador está bloqueando localStorage (habitual al abrir con doble clic en algunos casos). Sirve la carpeta con <b>python3 -m http.server 8080</b> para guardar los datos permanentemente.</div></div>') +
      '<div class="card flush mt">' +
        '<button class="list-item tappable" data-act="pwa:install">' + U.icon('download') +
          '<span class="li-main"><span class="li-title">' + (App.pwa.installed() ? 'Instalada como aplicación' : 'Instalar como aplicación') + '</span>' +
          '<span class="li-sub">' + (App.pwa.installed() ? 'Funciona sin conexión y avisa con el móvil bloqueado' : 'PWA: a pantalla completa, sin conexión y con notificaciones') + '</span></span>' + U.icon('chev-r') + '</button>' +
      '</div>' +
      '<div class="card flush mt">' +
        '<button class="list-item tappable" data-act="data:export">' + U.icon('download') + '<span class="li-main"><span class="li-title">Exportar copia de seguridad</span><span class="li-sub">JSON con ajustes, equipo, rutinas, sesiones y calendario</span></span>' + U.icon('chev-r') + '</button>' +
        '<button class="list-item tappable" data-act="data:import">' + U.icon('upload') + '<span class="li-main"><span class="li-title">Importar copia</span><span class="li-sub">Reemplaza los datos actuales</span></span>' + U.icon('chev-r') + '</button>' +
        '<button class="list-item tappable" data-act="data:demo">' + U.icon('chart') + '<span class="li-main"><span class="li-title">Cargar 8 semanas de ejemplo</span><span class="li-sub">Para ver gráficos y estadísticas con contenido</span></span>' + U.icon('chev-r') + '</button>' +
        (demo ? '<button class="list-item tappable" data-act="data:demo-clear">' + U.icon('trash') + '<span class="li-main"><span class="li-title">Quitar datos de ejemplo</span><span class="li-sub">Mantiene tus sesiones reales</span></span>' + U.icon('chev-r') + '</button>' : '') +
        '<button class="list-item tappable" data-act="data:reset">' + U.icon('alert') + '<span class="li-main"><span class="li-title danger">Borrar todo</span><span class="li-sub">Deja la app como recién instalada</span></span>' + U.icon('chev-r') + '</button>' +
      '</div>' +
      '<div class="card tight mt"><div class="h3">Acerca de</div><div class="tiny muted mt-s">Pulso · app de entrenamiento sin dependencias externas. Datos 100% locales, sin cuentas ni servidores propios. Coach AI opcional con tu propia API key de Gemini. Versión ' + (window.App.VERSION || '1.0') + ' (HTML + CSS + JS vanilla).</div></div>';
  }

  V.render = function (root) {
    var section;
    if (sub === 'perfil') section = secPerfil();
    else if (sub === 'apariencia') section = secApariencia();
    else if (sub === 'entreno') section = secEntreno();
    else if (sub === 'equipo') section = secEquipo();
    else if (sub === 'discos') section = secDiscos();
    else if (sub === 'ejercicios') section = secEjercicios();
    else if (sub === 'coach') section = secCoach();
    else section = secDatos();
    root.innerHTML = '<div class="seg mb">' + SUBS.map(function (s) {
      return '<button class="' + (sub === s.k ? 'on' : '') + '" data-act="settings:sub" data-key="' + s.k + '">' + U.esc(s.l) + '</button>';
    }).join('') + '</div>' + section;
  };

  V.models = null;
  V.showKey = false;

  App.actions = App.actions || {};
  App.actions['settings:sub'] = function (el) { sub = el.getAttribute('data-key'); App.render(); };
  App.actions['settings:set'] = function (el) {
    var key = el.getAttribute('data-key'), type = el.getAttribute('data-type') || 'text';
    var val;
    if (type === 'bool') val = el.checked;
    else if (type === 'number') val = U.num(el.value);
    else val = el.value;
    App.setSettingPath(key, val);
    if (el.getAttribute('data-rerender') === '1') App.render();
  };
  App.actions['settings:theme'] = function (el) {
    S.setSettings({ theme: el.getAttribute('data-key') });
    App.applyTheme();
    App.render();
  };
  App.actions['settings:accent'] = function (el) {
    S.setSettings({ accent: el.getAttribute('data-key') });
    App.applyTheme();
    App.render();
  };
  App.actions['equip:toggle'] = function (el) {
    var key = el.getAttribute('data-key');
    S.setEquipment(key, !S.has(key));
    App.render();
  };
  App.actions['equip:preset'] = function (el) {
    /* presets compartidos con el onboarding (D.equipPreset): antes cada sitio
       tenía su propia lista y no coincidían */
    var preset = D.equipPreset(el.getAttribute('data-kind'));
    Object.keys(preset).forEach(function (k) { S.setEquipment(k, preset[k]); });
    App.render();
    U.toast('Equipamiento actualizado', { type: 'ok' });
  };
  App.actions['plates:add'] = function () {
    var st = S.settings();
    var plates = (st.plates || []).slice();
    plates.push({ w: 2.5, unit: st.units === 'lb' ? 'lb' : 'kg', pairs: 1, on: true });
    S.setSettings({ plates: plates });
    App.render();
  };
  App.actions['plates:update'] = function (el) {
    var st = S.settings();
    var plates = (st.plates || []).map(function (p) { return U.clone(p); });
    var i = U.int(el.getAttribute('data-i')), field = el.getAttribute('data-field');
    if (!plates[i]) return;
    plates[i][field] = field === 'unit' ? (el.value === 'lb' ? 'lb' : 'kg') : U.num(el.value);
    S.setSettings({ plates: plates });
    App.render();
  };
  App.actions['plates:toggle'] = function (el) {
    var st = S.settings();
    var plates = (st.plates || []).map(function (p) { return U.clone(p); });
    var i = U.int(el.getAttribute('data-i'));
    if (!plates[i]) return;
    plates[i].on = plates[i].on === false;
    S.setSettings({ plates: plates });
    App.render();
  };
  App.actions['plates:remove'] = function (el) {
    var st = S.settings();
    var plates = (st.plates || []).filter(function (p, i) { return i !== U.int(el.getAttribute('data-i')); });
    S.setSettings({ plates: plates });
    App.render();
  };

  App.actions['ex:search'] = function (el) {
    filter.q = el.value;
    var list = U.$('#ex-list');
    if (list) list.innerHTML = exListHtml();
  };
  App.actions['ex:filter'] = function (el) {
    filter[el.getAttribute('data-field')] = el.value;
    App.render();
  };
  App.actions['ex:reset-filters'] = function () {
    filter = { q: '', group: '', equip: '', state: 'all' };
    App.render();
  };
  App.actions['ex:allow'] = function (el) {
    S.setAllowed(el.getAttribute('data-id'), el.getAttribute('data-val') === '1');
    var list = U.$('#ex-list');
    if (list) list.innerHTML = exListHtml();
  };
  App.actions['ex:bulk'] = function (el) {
    var val = el.getAttribute('data-val') === '1';
    var ids = filteredExercises().map(function (e) { return e.id; });
    S.bulkSetAllowed(ids, val);
    U.toast(ids.length + ' ejercicios ' + (val ? 'permitidos' : 'prohibidos'), { type: 'ok' });
    App.render();
  };
  App.actions['ex:add'] = function () { App.ui.exerciseEditor(null); };
  App.actions['ex:edit'] = function (el) { App.ui.exerciseEditor(el.getAttribute('data-id')); };
  App.actions['ex:delete'] = function (el) {
    var id = el.getAttribute('data-id');
    U.confirm({ title: 'Eliminar ejercicio', body: '<p>Se quitará de tu biblioteca personal.</p>', okLabel: 'Eliminar', kind: 'danger' }).then(function (ok) {
      if (!ok) return;
      S.removeExercise(id);
      App.render();
    });
  };

  App.actions['ai:key'] = function (el) {
    S.setAiSettings({ apiKey: String(el.value || '').trim() });
    App.render();
  };
  App.actions['ai:toggle-key'] = function () { V.showKey = !V.showKey; App.render(); };
  App.actions['ai:set'] = function (el) {
    var patch = {};
    patch[el.getAttribute('data-key')] = el.value;
    S.setAiSettings(patch);
    if (el.getAttribute('data-rerender') === '1') App.render();
  };
  App.actions['ai:system'] = function (el) { S.setAiSettings({ systemPrompt: el.value }); };
  App.actions['ai:system-default'] = function () {
    S.setAiSettings({ systemPrompt: '' });
    App.render();
    U.toast('Prompt por defecto restaurado', { type: 'ok' });
  };
  App.actions['ai:system-copy'] = function () {
    U.modal({
      title: 'Instrucciones activas', subtitle: 'systemInstruction enviada a Gemini',
      body: '<div class="code-box">' + U.esc(C.system()) + '</div>',
      actions: [{ label: 'Cerrar', value: null, kind: 'ghost' }, { label: 'Copiar', value: 'copy', kind: 'primary' }]
    }).then(function (v) { if (v === 'copy') U.copy(C.system()); });
  };
  App.actions['ai:test'] = function () {
    if (!C.hasKey()) { U.toast('Añade primero la API key', { type: 'warn' }); return; }
    var t = U.toast('Probando ' + C.model() + '…', { loading: true, sticky: true });
    C.test().then(function (res) {
      t.close();
      U.toast('Conexión correcta (' + (res.ms / 1000).toFixed(1) + 's) · ' + C.model(), { type: 'ok', ms: 4000 });
    }).catch(function (err) {
      t.close();
      U.modal({
        title: 'Error de conexión',
        body: '<div class="card" style="border-color:var(--danger)"><div class="tiny danger">' + U.esc(err.message) + '</div></div>' +
          '<div class="tiny muted mt">Comprueba: la key es válida y del proyecto correcto, el modelo existe para tu cuenta, y que hay conexión a internet. CORS y la API de Gemini funcionan también abriendo el archivo en local.',
        actions: [{ label: 'Cerrar', value: null, kind: 'ghost' }]
      });
    });
  };
  App.actions['ai:fetch-models'] = function () {
    if (!C.hasKey()) { U.toast('Añade primero la API key', { type: 'warn' }); return; }
    var t = U.toast('Consultando modelos disponibles…', { loading: true, sticky: true });
    C.listModels().then(function (list) {
      t.close();
      V.models = list;
      App.render();
      U.toast(list.length + ' modelos con generateContent', { type: 'ok' });
    }).catch(function (err) { t.close(); U.toast('No se pudieron cargar: ' + err.message, { type: 'err', ms: 7000 }); });
  };
  App.actions['data:export'] = function () {
    var name = 'pulso-backup-' + U.d.today() + '.json';
    if (U.download(name, S.export())) U.toast('Copia descargada: ' + name, { type: 'ok' });
  };
  App.actions['data:import'] = function () {
    U.pickFile('.json,application/json').then(function (text) {
      if (!text) return;
      return U.confirm({ title: 'Importar copia', body: '<p>Se reemplazarán todos los datos actuales por los del archivo.</p>', okLabel: 'Importar' }).then(function (ok) {
        if (!ok) return;
        try {
          var res = S.importJSON(text);
          App.applyTheme();
          App.render();
          U.toast('Importadas ' + res.sessions + ' sesiones y ' + res.routines + ' rutinas', { type: 'ok', ms: 5000 });
        } catch (e) {
          U.toast('Archivo no válido: ' + e.message, { type: 'err', ms: 7000 });
        }
      });
    });
  };
  App.actions['data:reset'] = function () {
    U.confirm({
      title: 'Borrar todos los datos',
      body: '<p>Se eliminarán sesiones, rutinas, calendario, ajustes y la API key guardada.</p><p class="sub">Exporta una copia antes si quieres conservarlos.</p>',
      okLabel: 'Borrar todo', kind: 'danger'
    }).then(function (ok) {
      if (!ok) return;
      S.reset();
      App.applyTheme();
      App.render();
      U.toast('Datos borrados. Empieza de cero', { type: 'ok' });
    });
  };
  App.actions['data:demo'] = function () {
    var n = S.demoData(8);
    App.render();
    U.toast('Añadidas ' + n + ' sesiones de ejemplo', { type: 'ok' });
  };
  App.actions['data:demo-clear'] = function () {
    var n = S.clearDemo();
    App.render();
    U.toast('Quitadas ' + n + ' sesiones de ejemplo', { type: 'ok' });
  };

  App.views = App.views || {};
  App.views.ajustes = V;
})();
