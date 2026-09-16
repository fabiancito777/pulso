/* ==========================================================================
   Pulso · store.js — estado, persistencia y analítica
   ========================================================================== */
(function () {
  'use strict';
  var U = window.App.u, D = window.App.data;
  var S = {};
  var KEY = 'state';
  var VERSION = 1;
  var subs = [];

  function seedExercises() { return D.SEED_EXERCISES.map(function (e) { return U.clone(e); }); }

  function freshState() {
    return {
      version: VERSION,
      createdAt: U.d.nowTs(),
      settings: U.clone(D.DEFAULT_SETTINGS),
      equipment: U.clone(D.DEFAULT_EQUIPMENT),
      exercises: seedExercises(),
      routines: [],
      sessions: [],
      schedule: {},
      active: null,
      chat: [],
      meta: { onboarded: false, lastPlanAt: null, lastAiAt: null }
    };
  }

  /* ----------------------------------------------------------------
     Rutinas personales puntuales. NO son defaults ni plantillas de la app:
     son rutinas concretas que el usuario pidió dejar cargadas una sola vez.
     Se insertan la primera vez que se carga el estado y quedan apuntadas en
     meta.seededRoutines para que no vuelvan a aparecer si las borra.
     ---------------------------------------------------------------- */
  var PERSONAL_ROUTINES = [
    {
      id: 'rt-personal-kroc',
      name: 'Espalda + Pecho + Brazos (superseries)',
      focus: 'Espalda · Pecho · Hombros · Bíceps · Tríceps · Antebrazo',
      source: 'manual',
      notes: 'Cargada a mano para una sesión. El peso de cada ejercicio va en el plan. En las superseries el primer ejercicio lleva 15 s de transición y el segundo el descanso real (45-60 s).',
      items: [
        { exId: 'remo-con-mancuerna-a-una-mano', sets: 3, repMin: 10, repMax: 10, rest: 60, weight: 17,
          notes: 'KROC ROW a una mano · 17 kg · 3x10 por lado · descanso 60 s al terminar los dos lados' },
        { exId: 'press-de-banca-con-mancuernas', sets: 3, repMin: 10, repMax: 10, rest: 60, weight: 18,
          notes: 'PRESS DE PISO · 18 kg por mancuerna · pausa de 1 s con los codos tocando el suelo y subida explosiva' },
        { exId: 'press-militar-con-mancuernas', sets: 3, repMin: 8, repMax: 8, rest: 15, weight: 11,
          notes: 'SUPERSERIE 1 (1/2) · 11 kg por mano x 8 · pasa sin descanso a las elevaciones laterales' },
        { exId: 'elevaciones-laterales-con-mancuernas', sets: 3, repMin: 15, repMax: 15, rest: 45, weight: 4,
          notes: 'SUPERSERIE 1 (2/2) · 4 kg por mano x 15 · descanso 45 s al terminar la superserie' },
        { exId: 'extension-sobre-la-cabeza-con-mancuerna', sets: 3, repMin: 10, repMax: 12, rest: 15, weight: 14,
          notes: 'SUPERSERIE 2 (1/2) · rompecráneos en suelo 14 kg · 10-12 reps con los codos cerrados' },
        { exId: 'curl-con-barra', sets: 3, repMin: 8, repMax: 10, rest: 60, weight: 18.5,
          notes: 'SUPERSERIE 2 (2/2) · 18,5 kg x 8-10 · descanso 60 s al terminar la superserie' },
        { exId: 'curl-martillo', sets: 3, repMin: 10, repMax: 10, rest: 15, weight: 9,
          notes: 'SUPERSERIE 3 (1/2) · 9 kg por mano x 10' },
        { exId: 'encogimientos-con-barra', sets: 3, repMin: 12, repMax: 12, rest: 45, weight: 36,
          notes: 'SUPERSERIE 3 (2/2) · 36 kg x 12 · mantén 2 s arriba apretando el trapecio · descanso 45 s' },
        { exId: 'pajaros-con-mancuernas', sets: 3, repMin: 15, repMax: 15, rest: 45, weight: 4,
          notes: 'Deltoides posterior · 4 kg por mano x 15 · bajada controlada en 2 s' },
        { exId: 'curl-de-muneca', sets: 2, repMin: 10, repMax: 10, rest: 30, weight: 11,
          notes: 'ANTEBRAZOS (1/2) · unilateral 11 kg x 10 por brazo · sin descanso pasa al otro brazo' },
        { exId: 'curl-inverso-con-barra', sets: 2, repMin: 15, repMax: 15, rest: 30, weight: 5,
          notes: 'ANTEBRAZOS (2/2) · unilateral 5 kg x 15 por brazo · descanso 30 s entre rondas' }
      ]
    }
  ];

  /* Inserta las rutinas personales UNA vez por dispositivo y las agenda para
     hoy si el día está libre (así las tienes a un toque en la pestaña Hoy).
     El registro va en su propia clave de localStorage, no en el estado: si
     borras todos los datos desde Ajustes no vuelven a aparecer. */
  var SEED_KEY = 'seeded-routines';
  function seedPersonalRoutines(raw) {
    var done = U.st.get(SEED_KEY, null);
    if (!Array.isArray(done)) done = [];
    var changed = false;
    PERSONAL_ROUTINES.forEach(function (r) {
      if (done.indexOf(r.id) >= 0) return;
      done.push(r.id);
      changed = true;
      if (!Array.isArray(raw.routines)) raw.routines = [];
      if (raw.routines.some(function (x) { return x && x.id === r.id; })) return;
      var obj = U.clone(r);
      obj.createdAt = U.d.nowTs();
      raw.routines.push(obj);
      var today = U.d.today();
      if (!raw.schedule || typeof raw.schedule !== 'object') raw.schedule = {};
      var day = raw.schedule[today];
      if (!day || (!day.routineId && !day.plan && !day.title)) {
        raw.schedule[today] = {
          routineId: obj.id, type: 'entreno', title: obj.name,
          status: 'planned', source: 'manual'
        };
      }
    });
    if (changed) U.st.set(SEED_KEY, done);
  }

  /* mezcla profunda de ajustes para tolerar nuevas claves en el futuro */
  function mergeDefaults(target, def) {
    var out = U.clone(target || {});
    Object.keys(def || {}).forEach(function (k) {
      if (out[k] === undefined || out[k] === null) out[k] = U.clone(def[k]);
      else if (typeof def[k] === 'object' && !Array.isArray(def[k]) && typeof out[k] === 'object' && !Array.isArray(out[k])) {
        out[k] = mergeDefaults(out[k], def[k]);
      }
    });
    return out;
  }
  /* fusiona la semilla de ejercicios con lo guardado (mantiene flags del usuario) */
  function mergeSeed(stored) {
    stored = Array.isArray(stored) ? stored : [];
    var byId = {};
    stored.forEach(function (e) { if (e && e.id) byId[e.id] = e; });
    D.SEED_EXERCISES.forEach(function (s) {
      var cur = byId[s.id];
      if (!cur) { stored.push(U.clone(s)); return; }
      cur.name = s.name; cur.group = s.group; cur.equip = s.equip; cur.type = s.type;
      cur.repMin = s.repMin; cur.repMax = s.repMax; cur.bw = s.bw;
      if (!cur.custom) { cur.sets = s.sets; cur.rest = s.rest; cur.tags = s.tags; cur.tips = s.tips; }
    });
    return stored.map(function (e) {
      e.allowed = e.allowed !== false;
      e.sets = Math.max(1, U.int(e.sets, 3));
      e.rest = Math.max(0, U.int(e.rest, 90));
      e.repMin = U.int(e.repMin, 8); e.repMax = U.int(e.repMax, 12);
      return e;
    });
  }

  var state = null;
  var saveTimer = null;

  S.load = function () {
    var raw = U.st.get(KEY, null);
    if (!raw || typeof raw !== 'object') raw = freshState();
    raw = mergeDefaults(raw, freshState());
    raw.settings = mergeDefaults(raw.settings, D.DEFAULT_SETTINGS);
    raw.settings.ai = mergeDefaults(raw.settings.ai, D.DEFAULT_SETTINGS.ai);
    /* inventario de discos: cada disco guarda su unidad (kg|lb);
       los antiguos sin unidad se interpretan en la unidad de ajustes */
    if (!Array.isArray(raw.settings.plates)) raw.settings.plates = U.clone(D.PLATES_DEFAULT);
    var dispUnit = raw.settings.units === 'lb' ? 'lb' : 'kg';
    raw.settings.plates = raw.settings.plates.map(function (pl) {
      return {
        w: Math.max(0, U.num(pl.w)),
        unit: (pl.unit === 'kg' || pl.unit === 'lb') ? pl.unit : dispUnit,
        pairs: Math.max(0, U.int(pl.pairs, 1)),
        on: pl.on !== false
      };
    });
    if (!raw.settings.bars || typeof raw.settings.bars !== 'object') raw.settings.bars = U.clone(D.BARS_DEFAULT);
    raw.settings.bars.olimpica = U.num(raw.settings.bars.olimpica, 20);
    raw.settings.bars.ez = U.num(raw.settings.bars.ez, 10);
    raw.settings.bars.mancuerna = U.num(raw.settings.bars.mancuerna, 2);
    raw.exercises = mergeSeed(raw.exercises);
    if (!Array.isArray(raw.sessions)) raw.sessions = [];
    if (!Array.isArray(raw.routines)) raw.routines = [];
    if (!Array.isArray(raw.chat)) raw.chat = [];
    if (!raw.schedule || typeof raw.schedule !== 'object') raw.schedule = {};
    applyPersonalSetup(raw);
    seedPersonalRoutines(raw);
    state = raw;
    return state;
  };
  S.state = function () { return state; };
  S.saveNow = function () {
    var ok = U.st.set(KEY, state);
    if (!ok && !S._warned) { S._warned = true; U.toast('No se pudo guardar en localStorage: los datos viven solo en esta pestaña', { type: 'warn', ms: 6000 }); }
    return ok;
  };
  S.save = function () { clearTimeout(saveTimer); saveTimer = setTimeout(S.saveNow, 220); };
  S.notify = function (reason) {
    S.save();
    subs.forEach(function (fn) { try { fn(reason); } catch (e) { /* noop */ } });
  };
  S.onChange = function (fn) { subs.push(fn); return function () { subs = subs.filter(function (x) { return x !== fn; }); }; };
  S.reset = function () { state = freshState(); S.saveNow(); S.notify('reset'); };
  S.export = function () {
    return JSON.stringify({
      app: 'pulso', version: VERSION, exportedAt: U.d.nowTs(),
      settings: state.settings, equipment: state.equipment, exercises: state.exercises,
      routines: state.routines, sessions: state.sessions, schedule: state.schedule, meta: state.meta
    }, null, 2);
  };
  S.importJSON = function (text) {
    var data = JSON.parse(text);
    if (!data || typeof data !== 'object') throw new Error('JSON inválido');
    var base = freshState();
    if (data.settings) base.settings = mergeDefaults(data.settings, D.DEFAULT_SETTINGS);
    if (data.equipment) base.equipment = mergeDefaults(data.equipment, D.DEFAULT_EQUIPMENT);
    if (Array.isArray(data.exercises) && data.exercises.length) base.exercises = mergeSeed(data.exercises);
    if (Array.isArray(data.routines)) base.routines = data.routines;
    if (Array.isArray(data.sessions)) base.sessions = data.sessions;
    if (data.schedule && typeof data.schedule === 'object') base.schedule = data.schedule;
    if (data.meta) base.meta = mergeDefaults(data.meta, base.meta);
    base.meta.onboarded = true;
    state = base;
    S.saveNow(); S.notify('import');
    return { sessions: state.sessions.length, routines: state.routines.length };
  };

  /* ----------------------------------------------------------------
     Aplicación única del "setup" personal (inventario de discos, barras y
     equipamiento). Va en su propia clave, como las rutinas personales, para que
     se aplique una sola vez: si más adelante lo cambias a mano en Ajustes, un
     recargado no te lo revierte. */
  var SETUP_KEY = 'applied-setup';
  var SETUP_ID = 'inventario-v2';
  function applyPersonalSetup(raw) {
    var done = U.st.get(SETUP_KEY, null);
    if (!Array.isArray(done)) done = [];
    if (done.indexOf(SETUP_ID) >= 0) return;
    raw.settings.plates = U.clone(D.PLATES_DEFAULT);
    raw.settings.bars = U.clone(D.BARS_DEFAULT);
    if (!raw.equipment || typeof raw.equipment !== 'object') raw.equipment = {};
    D.EQUIPMENT.forEach(function (e) { raw.equipment[e.key] = !!D.DEFAULT_EQUIPMENT[e.key]; });
    done.push(SETUP_ID);
    U.st.set(SETUP_KEY, done);
  }

  /* ---------- ajustes ---------- */
  S.settings = function () { return state.settings; };
  S.setSettings = function (patch) {
    Object.keys(patch || {}).forEach(function (k) { state.settings[k] = patch[k]; });
    S.notify('settings');
  };
  S.setAiSettings = function (patch) {
    Object.keys(patch || {}).forEach(function (k) { state.settings.ai[k] = patch[k]; });
    S.notify('ai');
  };
  S.meta = function () { return state.meta; };
  S.setMeta = function (patch) { Object.keys(patch || {}).forEach(function (k) { state.meta[k] = patch[k]; }); S.save(); };

  /* ---------- equipamiento ---------- */
  S.equipment = function () { return state.equipment; };
  S.has = function (key) { return !!state.equipment[key]; };
  S.setEquipment = function (key, on) { state.equipment[key] = !!on; S.notify('equipment'); };
  S.enabledEquipment = function () {
    return Object.keys(state.equipment).filter(function (k) { return state.equipment[k]; });
  };
  S.isAvailable = function (ex) {
    if (!ex || !ex.equip) return true;
    return String(ex.equip).split('&').every(function (grp) {
      return grp.split('|').some(function (k) { return !!state.equipment[k] || k === ''; });
    });
  };
  S.missingEquip = function (ex) {
    var miss = [];
    if (!ex || !ex.equip) return miss;
    String(ex.equip).split('&').forEach(function (grp) {
      var ks = grp.split('|');
      if (!ks.some(function (k) { return !!state.equipment[k] || k === ''; })) {
        ks.forEach(function (k) { if (k) miss.push(D.equipLabel(k)); });
      }
    });
    return miss;
  };
  S.equipTags = function (ex) {
    if (!ex || !ex.equip) return ['peso corporal'];
    var out = [];
    String(ex.equip).split('&').forEach(function (grp) { out.push(grp.split('|').map(D.equipLabel).join(' o ')); });
    return out;
  };

  /* ---------- ejercicios ---------- */
  S.exercises = function () { return state.exercises; };
  S.allowedExercises = function () { return state.exercises.filter(function (e) { return e.allowed; }); };
  S.byId = function (id) { return state.exercises.filter(function (e) { return e.id === id; })[0] || null; };
  S.byName = function (name) {
    var best = null, bestScore = 0;
    state.exercises.forEach(function (e) {
      var s = U.similarity(e.name, name);
      if (s > bestScore) { bestScore = s; best = e; }
    });
    return bestScore >= 0.55 ? best : null;
  };
  S.usable = function () {
    return state.exercises.filter(function (e) { return e.allowed && S.isAvailable(e); });
  };
  S.addExercise = function (ex) {
    var id = U.slug(ex.name);
    if (S.byId(id)) id = U.uid('ex');
    var obj = mergeDefaults({
      id: id, name: ex.name, group: ex.group, equip: ex.equip || '', type: ex.type || 'aislado',
      sets: U.int(ex.sets, 3), repMin: U.int(ex.repMin, 8), repMax: U.int(ex.repMax, 12),
      rest: U.int(ex.rest, 90), allowed: ex.allowed !== false, custom: true, bw: !!ex.bw, tags: [], tips: ex.tips || ''
    }, {});
    state.exercises.push(obj);
    S.notify('exercise:add');
    return obj;
  };
  S.updateExercise = function (id, patch) {
    var e = S.byId(id);
    if (!e) return null;
    Object.keys(patch || {}).forEach(function (k) { e[k] = patch[k]; });
    S.notify('exercise:update');
    return e;
  };
  S.removeExercise = function (id) {
    var e = S.byId(id);
    if (!e) return false;
    if (!e.custom) { U.toast('Solo puedes eliminar ejercicios propios; los de la biblioteca puedes desactivarlos', { type: 'warn', ms: 5000 }); return false; }
    state.exercises = state.exercises.filter(function (x) { return x.id !== id; });
    S.notify('exercise:remove');
    return true;
  };
  S.setAllowed = function (id, on) {
    var e = S.byId(id);
    if (!e) return;
    e.allowed = !!on;
    S.notify('exercise:flag');
    return e;
  };
  S.bulkSetAllowed = function (ids, on) {
    var set = {}; ids.forEach(function (i) { set[i] = 1; });
    state.exercises.forEach(function (e) { if (set[e.id]) e.allowed = !!on; });
    S.notify('exercise:bulk');
    return ids.length;
  };

  /* ---------- rutinas ---------- */
  S.routines = function () { return state.routines; };
  S.routine = function (id) { return state.routines.filter(function (r) { return r.id === id; })[0] || null; };
  S.addRoutine = function (r) {
    var obj = {
      id: r.id || U.uid('rt'), name: r.name || 'Nueva rutina', focus: r.focus || '',
      notes: r.notes || '', createdAt: r.createdAt || U.d.nowTs(),
      source: r.source || 'manual',
      items: (r.items || []).map(function (it) {
        /* weight es opcional: si la rutina trae pesos (plan del coach, rutina
           personal…) se conservan y la sesión los aplica tal cual */
        var w = (it.weight === undefined || it.weight === null || it.weight === '') ? null : U.num(it.weight);
        return { exId: it.exId, sets: U.int(it.sets, 3), repMin: U.int(it.repMin, 8), repMax: U.int(it.repMax, 12), rest: U.int(it.rest, 90), weight: w, notes: it.notes || '' };
      })
    };
    state.routines.push(obj);
    S.notify('routine:add');
    return obj;
  };
  S.updateRoutine = function (id, patch) {
    var r = S.routine(id);
    if (!r) return null;
    Object.keys(patch || {}).forEach(function (k) { r[k] = patch[k]; });
    S.notify('routine:update');
    return r;
  };
  S.removeRoutine = function (id) {
    state.routines = state.routines.filter(function (r) { return r.id !== id; });
    Object.keys(state.schedule).forEach(function (day) {
      if (state.schedule[day] && state.schedule[day].routineId === id) delete state.schedule[day].routineId;
    });
    S.notify('routine:remove');
  };
  S.duplicateRoutine = function (id) {
    var r = S.routine(id);
    if (!r) return null;
    var copy = U.clone(r);
    copy.id = U.uid('rt'); copy.name = r.name + ' (copia)'; copy.createdAt = U.d.nowTs();
    state.routines.push(copy);
    S.notify('routine:dup');
    return copy;
  };

  /* ---------- sesiones ---------- */
  S.sessions = function () { return state.sessions; };
  S.session = function (id) { return state.sessions.filter(function (s) { return s.id === id; })[0] || null; };
  S.addSession = function (sess) {
    state.sessions.push(sess);
    state.sessions.sort(function (a, b) { return (a.startedAt || '') < (b.startedAt || '') ? 1 : -1; });
    S.notify('session:add');
    return sess;
  };
  S.updateSession = function (id, patch) {
    var s = S.session(id);
    if (!s) return null;
    Object.keys(patch || {}).forEach(function (k) { s[k] = patch[k]; });
    S.notify('session:update');
    return s;
  };
  S.removeSession = function (id) {
    state.sessions = state.sessions.filter(function (s) { return s.id !== id; });
    S.notify('session:remove');
  };
  S.active = function () { return state.active; };
  S.setActive = function (a) { state.active = a; S.notify('active'); };

  /* ---------- calendario ---------- */
  S.schedule = function () { return state.schedule; };
  S.getDay = function (iso) { return state.schedule[iso] || null; };
  S.setDay = function (iso, patch) {
    var cur = state.schedule[iso] || {};
    Object.keys(patch || {}).forEach(function (k) {
      if (patch[k] === null || patch[k] === undefined) delete cur[k]; else cur[k] = patch[k];
    });
    if (Object.keys(cur).length === 0) delete state.schedule[iso]; else state.schedule[iso] = cur;
    S.notify('schedule');
    return state.schedule[iso] || null;
  };
  S.clearDay = function (iso) { delete state.schedule[iso]; S.notify('schedule'); };
  S.week = function (iso) {
    return U.d.weekDates(iso).map(function (dIso) {
      var day = S.getDay(dIso) || {};
      var sess = state.sessions.filter(function (s) { return (s.date || '') === dIso; });
      return {
        iso: dIso, planned: day, sessions: sess, isToday: dIso === U.d.today(),
        status: day.status || (sess.length ? 'done' : 'planned')
      };
    });
  };
  S.month = function (isoMonth) {
    var first = isoMonth.slice(0, 8) + '01';
    var x = U.d.parse(first);
    var days = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
    var out = [];
    for (var i = 1; i <= days; i++) {
      var iso = first.slice(0, 8) + String(i).padStart(2, '0');
      out.push({ iso: iso, count: state.sessions.filter(function (s) { return s.date === iso; }).length, planned: S.getDay(iso) });
    }
    return out;
  };

  /* ---------- chat ---------- */
  S.chat = function () { return state.chat; };
  S.addChat = function (msg) {
    state.chat.push(msg);
    if (state.chat.length > 80) state.chat = state.chat.slice(-80);
    S.notify('chat');
    return msg;
  };
  S.clearChat = function () { state.chat = []; S.notify('chat'); };

  /* ==================== analítica ==================== */
  var A = {};
  S.a = A;
  A.sessDate = function (s) { return s.date || (s.startedAt || '').slice(0, 10); };
  A.setKg = function (set, unit) { return U.units.toKg(U.num(set && set.weight), unit || 'kg'); };
  A.setVolumeKg = function (set, unit) {
    if (!set || !set.done) return 0;
    return A.setKg(set, unit) * U.num(set.reps);
  };
  A.e1rm = function (kg, reps) {
    kg = U.num(kg); reps = U.num(reps);
    if (!kg || !reps || reps < 1) return 0;
    if (reps === 1) return kg;
    return kg * (1 + reps / 30);
  };
  A.volumeOf = function (sess, unit) {
    unit = unit || sess.unit || 'kg';
    var v = 0;
    (sess.entries || []).forEach(function (en) {
      (en.sets || []).forEach(function (set) { v += A.setVolumeKg(set, unit); });
    });
    return v;
  };
  A.setsOf = function (sess) {
    var n = 0;
    (sess.entries || []).forEach(function (en) { n += (en.sets || []).filter(function (x) { return x.done; }).length; });
    return n;
  };
  A.durationOf = function (sess) {
    if (!sess.startedAt) return 0;
    var end = sess.endedAt ? new Date(sess.endedAt).getTime() : Date.now();
    return Math.max(0, end - new Date(sess.startedAt).getTime());
  };
  A.since = function (days) {
    var from = U.d.addDays(U.d.today(), -U.num(days) + 1);
    return state.sessions.filter(function (s) { return A.sessDate(s) >= from; });
  };
  A.groupVolume = function (sessions) {
    var out = {};
    (sessions || state.sessions).forEach(function (sess) {
      (sess.entries || []).forEach(function (en) {
        var ex = S.byId(en.exId);
        var grp = (ex && ex.group) || en.group || 'otros';
        out[grp] = (out[grp] || 0) + (en.sets || []).reduce(function (a, set) { return a + A.setVolumeKg(set, sess.unit); }, 0);
      });
    });
    return out;
  };
  A.groupSets = function (sessions) {
    var out = {};
    (sessions || state.sessions).forEach(function (sess) {
      (sess.entries || []).forEach(function (en) {
        var ex = S.byId(en.exId);
        var grp = (ex && ex.group) || en.group || 'otros';
        out[grp] = (out[grp] || 0) + (en.sets || []).filter(function (x) { return x.done; }).length;
      });
    });
    return out;
  };
  A.lastTrained = function () {
    var out = {};
    state.sessions.forEach(function (sess) {
      var iso = A.sessDate(sess);
      (sess.entries || []).forEach(function (en) {
        var ex = S.byId(en.exId);
        var grp = (ex && ex.group) || en.group;
        if (!grp) return;
        if (!out[grp] || out[grp] < iso) out[grp] = iso;
      });
    });
    return out;
  };
  A.daysSince = function (iso) { return iso ? U.d.diffDays(U.d.today(), iso) : null; };
  A.weeklySeries = function (weeks) {
    weeks = U.int(weeks, 8);
    var out = [], startThisWeek = U.d.startOfWeek(U.d.today());
    for (var i = weeks - 1; i >= 0; i--) {
      var from = U.d.addDays(startThisWeek, -7 * i), to = U.d.addDays(from, 6);
      var sess = state.sessions.filter(function (s) { var d = A.sessDate(s); return d >= from && d <= to; });
      out.push({
        iso: from, label: U.d.label(from, 'short'), from: from, to: to,
        volume: U.sum(sess, function (s) { return A.volumeOf(s); }),
        sessions: sess.length,
        sets: U.sum(sess, A.setsOf),
        minutes: Math.round(U.sum(sess, A.durationOf) / 60000)
      });
    }
    return out;
  };
  A.streak = function () {
    var dates = {};
    state.sessions.forEach(function (s) { dates[A.sessDate(s)] = 1; });
    var streak = 0, cursor = U.d.today();
    if (!dates[cursor]) cursor = U.d.addDays(cursor, -1);
    while (dates[cursor]) { streak++; cursor = U.d.addDays(cursor, -1); }
    return streak;
  };
  A.bestStreak = function () {
    var dates = U.uniq(state.sessions.map(A.sessDate)).sort();
    var best = 0, run = 0, prev = null;
    dates.forEach(function (d) {
      run = (prev && U.d.diffDays(d, prev) === 1) ? run + 1 : 1;
      prev = d;
      if (run > best) best = run;
    });
    return best;
  };
  A.prs = function () {
    var out = {};
    state.sessions.forEach(function (sess) {
      (sess.entries || []).forEach(function (en) {
        (en.sets || []).forEach(function (set) {
          if (!set.done || !set.reps) return;
          var kg = A.setKg(set, sess.unit), e = A.e1rm(kg, set.reps);
          var cur = out[en.exId];
          if (!cur || e > cur.e1rm) out[en.exId] = { exId: en.exId, e1rm: e, weight: kg, reps: U.num(set.reps), date: A.sessDate(sess) };
        });
      });
    });
    return out;
  };
  A.exerciseSeries = function (exId) {
    var pts = [];
    state.sessions.slice().sort(function (a, b) { return A.sessDate(a) < A.sessDate(b) ? -1 : 1; }).forEach(function (sess) {
      var best = 0, top = 0, vol = 0, reps = 0, n = 0;
      (sess.entries || []).forEach(function (en) {
        if (en.exId !== exId) return;
        (en.sets || []).forEach(function (set) {
          if (!set.done) return;
          var kg = A.setKg(set, sess.unit);
          vol += kg * U.num(set.reps);
          var e = A.e1rm(kg, set.reps);
          if (e > best) { best = e; top = kg; reps = U.num(set.reps); }
          n++;
        });
      });
      if (n) pts.push({ iso: A.sessDate(sess), e1rm: best, top: top, reps: reps, volume: vol, sets: n });
    });
    return pts;
  };
  A.lastEntry = function (exId) {
    var sess = state.sessions.slice().sort(function (a, b) { return A.sessDate(a) < A.sessDate(b) ? 1 : -1; })
      .filter(function (s) { return (s.entries || []).some(function (e) { return e.exId === exId; }); })[0];
    if (!sess) return null;
    return { session: sess, entry: (sess.entries || []).filter(function (e) { return e.exId === exId; })[0] };
  };
  A.suggestWeight = function (exId, targetReps, unit) {
    var last = A.lastEntry(exId);
    var ex = S.byId(exId);
    var inc = U.num(state.settings.increment, unit === 'lb' ? 5 : 2.5);
    if (!last) return { weight: 0, reps: targetReps || (ex ? ex.repMin : 8), basis: 'sin historial', kg: 0 };
    var sets = (last.entry.sets || []).filter(function (s) { return s.done && s.reps; });
    if (!sets.length) return { weight: 0, reps: targetReps || 8, basis: 'sin series registradas', kg: 0 };
    var top = sets.reduce(function (a, b) { return A.e1rm(A.setKg(b, last.session.unit), b.reps) > A.e1rm(A.setKg(a, last.session.unit), a.reps) ? b : a; });
    var kg = A.setKg(top, last.session.unit);
    var e = A.e1rm(kg, top.reps);
    var reps = U.int(targetReps, ex ? ex.repMax : 10);
    var suggestedKg = e / (1 + reps / 30);
    var displayUnit = unit || state.settings.units;
    var suggested = U.round(U.units.fromKg(suggestedKg, displayUnit), 2);
    var prevDisplay = U.round(U.units.fromKg(kg, displayUnit), 2);
    if (suggested >= prevDisplay) suggested = U.round(prevDisplay + inc, 2);
    return {
      weight: Math.max(0, suggested), reps: reps, kg: U.units.toKg(suggested, displayUnit),
      basis: 'última vez ' + U.fmt.n(prevDisplay) + ' ' + U.units.label(displayUnit) + ' × ' + U.fmt.n(top.reps) + ' · ' + U.d.relative(A.sessDate(last.session)),
      prev: prevDisplay, prevReps: U.num(top.reps)
    };
  };
  A.totals = function () {
    var all = state.sessions;
    return {
      sessions: all.length,
      volume: U.sum(all, function (s) { return A.volumeOf(s); }),
      sets: U.sum(all, A.setsOf),
      time: U.sum(all, A.durationOf),
      avgDuration: all.length ? U.sum(all, A.durationOf) / all.length : 0,
      streak: A.streak(), bestStreak: A.bestStreak(),
      firstDate: all.length ? all.map(A.sessDate).sort()[0] : null
    };
  };
  A.byDow = function () {
    var out = [0, 0, 0, 0, 0, 0, 0];
    state.sessions.forEach(function (s) { out[U.d.dowIdx(A.sessDate(s))]++; });
    return out;
  };
  A.hrSeries = function (exId) { return A.exerciseSeries(exId); };
  A.recentExercises = function (n) {
    var seen = {}, out = [];
    state.sessions.slice().sort(function (a, b) { return A.sessDate(a) < A.sessDate(b) ? 1 : -1; }).forEach(function (sess) {
      (sess.entries || []).forEach(function (en) {
        if (seen[en.exId]) return;
        seen[en.exId] = 1;
        var ex = S.byId(en.exId);
        if (ex) out.push({ ex: ex, date: A.sessDate(sess) });
      });
    });
    return out.slice(0, n || 12);
  };
  S.a = A;

  /* ---------- generadores de rutina (local, sin IA) ---------- */
  function familiarity(exId) {
    var n = 0;
    state.sessions.forEach(function (s) {
      (s.entries || []).forEach(function (e) { if (e.exId === exId) n++; });
    });
    return n;
  }
  S.familiarity = familiarity;

  /* devuelve un mapa de ejercicios usados en las ultimas N sesiones (para rotar) */
  function recentlyUsedSessions(n) {
    var out = {};
    state.sessions.slice(0, U.int(n, 3)).forEach(function (s) {
      (s.entries || []).forEach(function (e) { out[e.exId] = (out[e.exId] || 0) + 1; });
    });
    return out;
  }

  /* elige ejercicios para una receta [[grupo, cantidad], ...] respetando equipo y prohibiciones */
  S.pickForGroup = function (group, count, used, opts) {
    opts = opts || {};
    used = used || {};
    var recent = opts.recent || recentlyUsedSessions(opts.rotate || 3);
    var cands = S.usable().filter(function (e) {
      if (e.group !== group || used[e.id]) return false;
      if (opts.exclude && opts.exclude[e.id]) return false;
      return true;
    });
    cands.sort(function (a, b) {
      var ca = a.type === 'compuesto' ? 0 : 1, cb = b.type === 'compuesto' ? 0 : 1;
      if (ca !== cb) return ca - cb;
      var ra = recent[a.id] ? 1 : 0, rb = recent[b.id] ? 1 : 0;
      if (ra !== rb) return ra - rb;
      var fa = familiarity(b.id) - familiarity(a.id);
      if (fa !== 0) return fa;
      return a.name < b.name ? -1 : 1;
    });
    return cands.slice(0, U.int(count, 1));
  };

  S.itemsFromRecipe = function (recipe, opts) {
    opts = opts || {};
    var used = {}, items = [], recent = recentlyUsedSessions(opts.rotate === undefined ? 3 : opts.rotate);
    (recipe || []).forEach(function (pair) {
      var group = pair[0], count = U.int(pair[1], 1);
      S.pickForGroup(group, count, used, { recent: recent, exclude: opts.exclude }).forEach(function (ex) {
        used[ex.id] = 1;
        items.push({ exId: ex.id, sets: U.int(ex.sets, 3), repMin: ex.repMin, repMax: ex.repMax, rest: ex.rest });
      });
    });
    return items;
  };

  S.buildRoutineFromRecipe = function (recipe, name, opts) {
    opts = opts || {};
    var items = S.itemsFromRecipe(recipe, opts);
    var groups = U.uniq(items.map(function (i) { var e = S.byId(i.exId); return e ? D.groupLabel(e.group) : ''; }).filter(Boolean));
    return S.addRoutine({
      name: name || 'Rutina sugerida', focus: groups.slice(0, 3).join(' · '),
      items: items, source: opts.source || 'generador', notes: opts.notes || ''
    });
  };

  S.routineFromTemplate = function (tplId, opts) {
    var tpl = D.TEMPLATES.filter(function (t) { return t.id === tplId; })[0];
    if (!tpl) return null;
    return S.buildRoutineFromRecipe(tpl.recipe, tpl.name, opts);
  };

  /* ---------- datos de ejemplo (para ver graficas con contenido) ---------- */
  function hashNum(str) {
    var h = 0;
    for (var i = 0; i < String(str).length; i++) h = (h * 31 + String(str).charCodeAt(i)) % 100000;
    return h;
  }
  S.demoData = function (weeks) {
    weeks = U.int(weeks, 8);
    var unit = state.settings.units;
    var recipes = ['full_a', 'full_b', 'push', 'pull', 'legs', 'upper', 'lower'];
    var added = 0;
    var dowPlan = [0, 2, 4, 5];
    for (var w = weeks - 1; w >= 0; w--) {
      var weekStart = U.d.addDays(U.d.startOfWeek(U.d.today()), -7 * w);
      var daysCount = 3 + (hashNum('d' + w) % 2);
      for (var k = 0; k < daysCount; k++) {
        var iso = U.d.addDays(weekStart, dowPlan[(k + (w % 2)) % dowPlan.length]);
        if (iso > U.d.today()) continue;
        var tplId = recipes[(w * 3 + k) % recipes.length];
        var tpl = D.TEMPLATES.filter(function (t) { return t.id === tplId; })[0];
        if (!tpl) continue;
        var used = {}, entries = [];
        tpl.recipe.forEach(function (pair) {
          S.pickForGroup(pair[0], U.int(pair[1], 1), used, { rotate: 2 }).forEach(function (ex) {
            used[ex.id] = 1;
            var base = ex.bw ? 0 : (ex.type === 'compuesto' ? 40 : 16) + (hashNum(ex.id) % 24);
            var prog = 1 + 0.015 * (weeks - w);
            var weight = ex.bw ? 0 : Math.round(U.units.fromKg(U.units.toKg(base, 'kg') * prog, unit) * 2) / 2;
            var sets = [];
            var nSets = ex.type === 'compuesto' ? 4 : 3;
            for (var i = 0; i < nSets; i++) {
              var reps = ex.bw ? (10 + (hashNum(ex.id + i + w) % 8)) : (ex.repMin + ((hashNum(ex.id + i) + w) % Math.max(1, ex.repMax - ex.repMin + 1)));
              sets.push({ weight: weight, reps: reps, done: true, ts: iso + 'T18:0' + (i % 9) + ':00.000Z' });
            }
            entries.push({ exId: ex.id, name: ex.name, restSec: ex.rest, sets: sets, notes: '' });
          });
        });
        if (!entries.length) continue;
        var start = iso + 'T18:00:00.000Z';
        var mins = 48 + (hashNum(iso) % 25);
        var end = new Date(new Date(start).getTime() + mins * 60000).toISOString();
        state.sessions.push({
          id: U.uid('s'), name: tpl.name, date: iso, startedAt: start, endedAt: end,
          unit: unit, source: 'demo', demo: true,
          entries: entries, notes: '', rpe: 7
        });
        added++;
      }
    }
    state.sessions.sort(function (a, b) { return (a.startedAt || '') < (b.startedAt || '') ? 1 : -1; });
    S.notify('demo');
    return added;
  };
  S.clearDemo = function () {
    var before = state.sessions.length;
    state.sessions = state.sessions.filter(function (s) { return !s.demo; });
    S.notify('demo:clear');
    return before - state.sessions.length;
  };

  window.App.store = S;
})();
