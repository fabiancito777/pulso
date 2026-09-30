/* ==========================================================================
   Pulso · coach.js — Gemini API (configurable) + planificador local offline
   API: POST /v1beta/models/{model}:generateContent?key=...
   Thinking: generationConfig.thinkingConfig {thinkingLevel|thinkingBudget, includeThoughts}
   ========================================================================== */
(function () {
  'use strict';
  var U = window.App.u, D = window.App.data, S = window.App.store;
  var C = {};
  var BASE = 'https://generativelanguage.googleapis.com/v1beta';
  C.BASE = BASE;

  C.cfg = function () { return S.settings().ai; };
  C.model = function () { return C.cfg().model || 'gemini-3.8-flash'; };
  C.hasKey = function () { return !!String(C.cfg().apiKey || '').trim(); };

  function thinkingConfig(cfg) {
    var tc = {};
    var level = cfg.thinkingLevel;
    var budget = String(cfg.thinkingBudget === null || cfg.thinkingBudget === undefined ? '' : cfg.thinkingBudget).trim();
    if (level && level !== 'auto') tc.thinkingLevel = level;
    else if (budget !== '') tc.thinkingBudget = U.int(budget, -1);
    if (cfg.includeThoughts) tc.includeThoughts = true;
    return Object.keys(tc).length ? tc : null;
  }
  C.thinkingConfig = thinkingConfig;

  function buildBody(o) {
    var cfg = C.cfg();
    var gc = {
      temperature: cfg.temperature === undefined ? 0.7 : U.num(cfg.temperature, 0.7),
      maxOutputTokens: U.int(cfg.maxTokens, 4096)
    };
    if (o.json) gc.responseMimeType = 'application/json';
    var tc = thinkingConfig(cfg);
    if (tc && !o.noThinking) gc.thinkingConfig = tc;
    var body = {
      contents: o.contents,
      generationConfig: gc
    };
    var sys = o.system || cfg.systemPrompt;
    if (sys) body.systemInstruction = { parts: [{ text: sys }] };
    return body;
  }
  C.buildBody = buildBody;

  function parseResponse(data) {
    if (!data) throw new Error('respuesta vacía');
    if (data.error) throw new Error(data.error.message || 'error de la API');
    if (data.promptFeedback && data.promptFeedback.blockReason) {
      throw new Error('bloqueado por seguridad: ' + data.promptFeedback.blockReason);
    }
    var cand = (data.candidates || [])[0];
    if (!cand) throw new Error('sin candidatos en la respuesta');
    var parts = (cand.content && cand.content.parts) || [];
    var text = '', thoughts = '';
    parts.forEach(function (p) {
      if (!p || !p.text) return;
      if (p.thought) thoughts += p.text;
      else text += p.text;
    });
    if (!text && cand.finishReason === 'MAX_TOKENS') throw new Error('se cortó la respuesta (sube maxOutputTokens)');
    return {
      text: text.trim(), thoughts: thoughts.trim(), finish: cand.finishReason,
      usage: data.usageMetadata || null, model: data.modelVersion || null
    };
  }

  /* ---------- llamada genérica ---------- */
  C.generate = function (opts) {
    opts = opts || {};
    var key = String(C.cfg().apiKey || '').trim();
    if (!key) return Promise.reject(new Error('Falta la API key de Gemini (Ajustes → Coach AI)'));
    var model = opts.model || C.model();
    var url = BASE + '/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key);
    var body = C.buildBody({
      contents: opts.contents || [{ role: 'user', parts: [{ text: opts.prompt || '' }] }],
      system: opts.system, json: opts.json, noThinking: opts.noThinking
    });
    var t0 = Date.now();
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (res) {
        return res.text().then(function (txt) {
          var data;
          try { data = JSON.parse(txt); }
          catch (e) { throw new Error('respuesta no-JSON (' + res.status + '): ' + txt.slice(0, 160)); }
          if (!res.ok) throw new Error((data.error && data.error.message) || ('HTTP ' + res.status));
          var out = parseResponse(data);
          out.ms = Date.now() - t0;
          return out;
        });
      })
      .catch(function (err) {
        if (err && /Failed to fetch|NetworkError|Load failed/i.test(err.message || '')) {
          var hint = location.protocol === 'file:' ? ' Si abres el archivo con doble clic, prueba a servirlo con: python3 -m http.server 8080' : '';
          throw new Error('No se pudo conectar con Gemini.' + hint + ' (' + err.message + ')');
        }
        throw err;
      });
  };

  /* ---------- listar modelos disponibles (para el selector) ---------- */
  C.listModels = function () {
    var key = String(C.cfg().apiKey || '').trim();
    if (!key) return Promise.reject(new Error('Añade primero tu API key'));
    var found = [], token = '';
    function page() {
      var url = BASE + '/models?pageSize=200&key=' + encodeURIComponent(key) + (token ? '&pageToken=' + encodeURIComponent(token) : '');
      return fetch(url).then(function (r) { return r.json(); }).then(function (data) {
        if (data.error) throw new Error(data.error.message || 'error al listar modelos');
        (data.models || []).forEach(function (m) {
          var methods = m.supportedGenerationMethods || [];
          if (methods.indexOf('generateContent') < 0) return;
          var id = String(m.name || '').replace(/^models\//, '');
          if (!id || /embedding|aqa|imagen|veo|tts|live/i.test(id)) return;
          found.push({ id: id, label: (m.displayName || id), hint: m.description ? U.trunc(m.description, 90) : '' });
        });
        token = data.nextPageToken;
        if (token && found.length < 120) return page();
        return found;
      });
    }
    return page().then(function (list) {
      if (!list.length) throw new Error('la cuenta no devolvió modelos con generateContent');
      return list;
    });
  };

  /* ---------- test rápido de conexión ---------- */
  C.test = function () {
    return C.generate({
      prompt: 'Responde exactamente con: OK', json: false, noThinking: true,
      system: 'Eres un comprobador de conexión. Responde solo "OK".'
    });
  };

  /* ---------- utilidades JSON tolerantes ---------- */
  C.parseJSON = function (text) {
    var raw = String(text || '').trim();
    if (!raw) throw new Error('respuesta vacía');
    var fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) raw = fenced[1].trim();
    try { return JSON.parse(raw); } catch (e) { /* sigue */ }
    var start = raw.indexOf('{'), end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      var slice = raw.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1');
      try { return JSON.parse(slice); } catch (e2) { /* sigue */ }
    }
    var s2 = raw.indexOf('['), e2i = raw.lastIndexOf(']');
    if (s2 >= 0 && e2i > s2) {
      try { return JSON.parse(raw.slice(s2, e2i + 1)); } catch (e3) { /* sigue */ }
    }
    throw new Error('no pude interpretar el JSON de la respuesta');
  };

  /* ==================== contexto para el modelo ==================== */
  var DEFAULT_SYSTEM = [
    'Eres Pulso Coach, entrenador personal y planificador de entrenamiento basado en evidencia.',
    'Reglas:',
    '- Responde siempre en español, con tono directo, profesional y cercano. Nada de relleno.',
    '- Usa EXCLUSIVAMENTE ejercicios de la lista de ejercicios permitidos que recibes en el contexto (respeta el nombre exacto).',
    '- Respeta el equipamiento e inventario del usuario: no propongas material que no tenga ni pesos imposibles de cargar.',
    '- Aplica sobrecarga progresiva usando el historial y los récords; indica un peso objetivo concreto por ejercicio.',
    '- Decide tú el descanso óptimo entre series de cada ejercicio (compuestos grandes 180-240 s, auxiliares 90-120 s, aislamientos 60-75 s) y devuélvelo en el campo rest; el usuario no configura los descansos.',
    '- Incluye descansos entre series y justifica brevemente cada decisión del plan.',
    '- Si el usuario pide JSON, devuelve ÚNICAMENTE el JSON, sin texto adicional ni markdown.',
    '- Prioriza seguridad: avisa si detectas señales de sobreentrenamiento o dolor, y recuerda que no eres un médico.'
  ].join('\n');
  C.DEFAULT_SYSTEM = DEFAULT_SYSTEM;
  C.system = function () { return String(C.cfg().systemPrompt || '').trim() || DEFAULT_SYSTEM; };

  /* linea de sesion con los datos REALES (serie a serie) y, si la sesion salio
     de una rutina guardada, el objetivo de la plantilla para comparar */
  function sessionLine(sess) {
    var r = sess.routineId ? S.routine(sess.routineId) : null;
    var parts = [];
    (sess.entries || []).forEach(function (en) {
      var sets = (en.sets || []).filter(function (st) { return st.done; });
      if (!sets.length) return;
      var detail = sets.map(function (st) { return U.fmt.n(st.weight) + 'x' + U.fmt.n(st.reps); }).join(', ');
      var target = '';
      if (r) {
        var it = r.items.filter(function (i2) { return i2.exId === en.exId; })[0];
        if (it) {
          var cumplidas = sets.filter(function (st) { return U.num(st.reps) >= U.int(it.repMin, 1); }).length;
          target = ' [objetivo plantilla: ' + U.int(it.sets, 3) + 'x' + U.int(it.repMin, 8) + '-' + U.int(it.repMax, 12) + ' · descanso ' + U.int(it.rest, 90) + 's · cumple ' + cumplidas + '/' + sets.length + ']';
        }
      }
      parts.push(en.name + ': ' + detail + target);
    });
    if (!parts.length) return '';
    return U.d.label(sess.date || '', 'medium') + ' · ' + sess.name + ' (' + U.fmt.vol(S.a.volumeOf(sess)) + ' kg, ' + S.a.setsOf(sess) + ' series, ' + U.fmt.dur(S.a.durationOf(sess)) + '): ' + parts.join(' | ');
  }

  C.buildContext = function (opts) {
    opts = opts || {};
    var st = S.settings(), a = S.a, out = [];
    var lim = U.int(opts.sessions, 10);
    out.push('=== PERFIL ===');
    out.push('Fecha de hoy: ' + U.d.today() + ' (' + U.d.dowLong(U.d.today()) + ')');
    out.push('Nombre: ' + (st.name || 'sin especificar') + ' | Nivel: ' + st.level + ' | Objetivo: ' + D.GOAL_LABEL(st.goal) + ' | Días/semana: ' + st.daysPerWeek);
    out.push('Unidades: ' + st.units + ' | Incremento habitual: ' + st.increment + ' ' + U.units.label(st.units) + ' | Descanso base: ' + st.restDefault + 's');
    out.push('Rango de repeticiones objetivo del objetivo: ' + D.GOAL_REPS[st.goal].join('-') + ' reps, ' + D.GOAL_SETS[st.goal] + ' series, descanso ~' + D.GOAL_REST[st.goal] + 's');
    out.push('');
    out.push('=== EQUIPAMIENTO ===');
    var enabled = S.enabledEquipment();
    out.push(enabled.length ? enabled.map(D.equipLabel).join(', ') : 'solo peso corporal');
    var T = window.App.trainer;
    if (T) {
      var ml = T.maxLoadable();
      var plates = (S.settings().plates || []).filter(function (p) { return p.on !== false; })
        .map(function (p) {
          var kg = U.units.toKg(U.num(p.w), p.unit || 'kg');
          return U.fmt.n(kg, 2) + ' kg' + (p.unit === 'lb' ? ' (' + U.fmt.n(p.w) + ' lb)' : '') + ' x' + p.pairs;
        }).join(', ');
      out.push('Inventario de discos (en kg, con original entre paréntesis si es lb): ' + (plates || 'sin discos'));
      out.push('Barra principal: ' + U.fmt.n(ml.barKg, 1) + ' kg | Máximo cargable total: ' + U.fmt.n(ml.totalKg, 1) + ' kg');
    }
    out.push('');
    out.push('=== EJERCICIOS PERMITIDOS (usa estos nombres exactos) ===');
    var usable = S.usable();
    D.GROUPS.forEach(function (g) {
      var list = usable.filter(function (e) { return e.group === g.key; });
      if (!list.length) return;
      out.push(g.label + ' (' + list.length + '): ' + list.map(function (e) { return e.name; }).join(', '));
    });
    var banned = S.exercises().filter(function (e) { return !e.allowed; });
    if (banned.length) out.push('PROHIBIDOS (no los propongas): ' + banned.slice(0, 40).map(function (e) { return e.name; }).join(', '));
    var unavail = S.exercises().filter(function (e) { return e.allowed && !S.isAvailable(e); }).slice(0, 30);
    if (unavail.length) out.push('NO DISPONIBLES por falta de material: ' + unavail.map(function (e) { return e.name; }).join(', '));
    out.push('');
    out.push('=== HISTORIAL (datos REALES registrados serie a serie, más reciente primero; el objetivo de la plantilla va entre corchetes para comparar) ===');
    var sessions = state();
    if (!sessions.length) out.push('Sin sesiones registradas todavía.');
    sessions.slice(0, lim).forEach(function (s) { out.push(sessionLine(s)); });
    out.push('');
    out.push('=== ESTADO ACTUAL ===');
    var last = a.lastTrained();
    var vol7 = a.groupVolume(a.since(7));
    var sets7 = a.groupSets(a.since(7));
    out.push('Días desde el último estímulo y volumen de los últimos 7 días:');
    D.GROUPS.forEach(function (g) {
      var days = last[g.key] ? a.daysSince(last[g.key]) : null;
      var v = vol7[g.key] || 0, s = sets7[g.key] || 0;
      if (days === null && !v) return;
      out.push('- ' + g.label + ': ' + (days === null ? 'sin datos' : days + ' días') + ' | ' + s + ' series | ' + U.fmt.vol(v) + ' kg');
    });
    var prs = a.prs();
    var prLines = Object.keys(prs).map(function (k) { return { id: k, pr: prs[k] }; })
      .sort(function (x, y) { return y.pr.e1rm - x.pr.e1rm; }).slice(0, 15)
      .map(function (o) { var ex = S.byId(o.id); return (ex ? ex.name : o.id) + ': 1RM est. ' + U.fmt.n(o.pr.e1rm) + ' kg (' + U.fmt.n(o.pr.weight) + 'x' + U.fmt.n(o.pr.reps) + ' el ' + o.pr.date + ')'; });
    if (prLines.length) out.push('Récords (1RM estimado): ' + prLines.join(' | '));
    var tot = a.totals();
    out.push('Totales: ' + tot.sessions + ' sesiones, ' + U.fmt.vol(tot.volume) + ' kg movidos, racha actual ' + tot.streak + ' días, media ' + U.fmt.dur(tot.avgDuration) + ' por sesión.');
    out.push('');
    out.push('=== RUTINAS GUARDADAS (prescripcion/objetivo de las plantillas; NO es lo realizado, eso está en HISTORIAL) ===');
    var rts = S.routines();
    if (!rts.length) out.push('Sin rutinas guardadas todavía.');
    rts.slice(0, 12).forEach(function (r) {
      var lastUsed = null;
      S.sessions().forEach(function (sx) { if (sx.routineId === r.id && (!lastUsed || (sx.date || '') > lastUsed)) lastUsed = sx.date || ''; });
      out.push('- ' + r.name + ' [' + (r.source || 'manual') + ']' + (lastUsed ? ' · última vez ' + U.d.label(lastUsed, 'medium') : ' · sin usar') +
        ': ' + r.items.map(function (it) {
          var e2 = S.byId(it.exId);
          return (e2 ? e2.name : it.exId) + ' ' + U.int(it.sets, 3) + 'x' + U.int(it.repMin, 8) + '-' + U.int(it.repMax, 12) + (it.rest ? '@' + it.rest + 's' : '');
        }).join(', '));
    });
    out.push('');
    out.push('=== VOLUMEN POR SEMANA (últimas 8) ===');
    out.push(S.a.weeklySeries(8).map(function (w) { return w.label + ': ' + U.fmt.vol(w.volume) + ' kg, ' + w.sessions + ' ses, ' + w.sets + ' series, ' + w.minutes + ' min'; }).join(' | '));
    out.push('');
    out.push('=== PLAN SEMANAL (semana en curso, día a día) ===');
    S.week(U.d.startOfWeek(U.d.today())).forEach(function (d) {
      var p = d.planned || {};
      var r = p.routineId ? S.routine(p.routineId) : null;
      var txt = r ? r.name : (p.title || p.type || 'libre');
      if (d.sessions.length || p.status === 'done') {
        txt += ' [HECHO: ' + U.sum(d.sessions, function (s2) { return S.a.volumeOf(s2); }).toFixed(0) + ' kg]' +
          (d.sessions.length ? ' ejercicios: ' + U.uniq(d.sessions.reduce(function (acc, s2) { return acc.concat((s2.entries || []).map(function (e3) { return e3.name; })); }, [])).slice(0, 8).join(', ') : '');
      } else if (p.status === 'rest') txt += ' [DESCANSO]';
      else if (p.status === 'skipped') txt += ' [SALTADO]';
      out.push('- ' + U.d.label(d.iso, 'medium') + ' (' + U.d.dow(d.iso) + '): ' + txt);
    });
    if (opts.extra) { out.push(''); out.push(opts.extra); }
    return out.join('\n');
  };
  function state() { return S.sessions(); }

  /* ==================== planificador local (sin IA) ==================== */
  function richItems(list, opts) {
    opts = opts || {};
    var st = S.settings(), a = S.a;
    return (list || []).map(function (it) {
      var ex = S.byId(it.exId);
      if (!ex) return null;
      var reps = U.int(it.reps, Math.round((U.int(it.repMin, ex.repMin) + U.int(it.repMax, ex.repMax)) / 2));
      var sug = it.weight === undefined || it.weight === null || it.weight === ''
        ? a.suggestWeight(ex.id, reps, st.units) : { weight: U.num(it.weight), basis: opts.basis || 'peso objetivo indicado' };
      return {
        exId: ex.id, name: ex.name, group: ex.group, type: ex.type,
        sets: U.int(it.sets, ex.sets), reps: reps, repMin: U.int(it.repMin, ex.repMin), repMax: U.int(it.repMax, ex.repMax),
        weight: it.weight === undefined ? sug.weight : U.num(it.weight), unit: st.units,
        rest: U.int(it.rest, ex.rest), basis: sug.basis, notes: it.notes || ''
      };
    }).filter(Boolean);
  }
  C.richItems = richItems;

  C.localSuggest = function (opts) {
    opts = opts || {};
    var st = S.settings(), a = S.a;
    var targetSets = D.GOAL_SETS[st.goal] || 4;
    var last = a.lastTrained(), vol7 = a.groupVolume(a.since(7)), sets7 = a.groupSets(a.since(7));
    var skip = ['cardio', 'movilidad'];
    var scored = D.GROUPS.filter(function (g) { return skip.indexOf(g.key) < 0; }).map(function (g) {
      var days = last[g.key] ? a.daysSince(last[g.key]) : null;
      var sets = sets7[g.key] || 0;
      var score = (days === null ? 16 : Math.min(days, 16)) * 1.2 + Math.max(0, 10 - sets) * 1.7;
      if (days !== null && days < 2) score -= 14;
      return { g: g, days: days, sets: sets, vol: vol7[g.key] || 0, score: score };
    }).sort(function (x, y) { return y.score - x.score; });

    var counts = [2, 2, 1, 1];
    var used = {}, items = [], rationale = [];
    scored.slice(0, counts.length).forEach(function (s, i) {
      var exs = S.pickForGroup(s.g.key, counts[i], used, { rotate: 2 });
      if (!exs.length) return;
      exs.forEach(function (ex) { used[ex.id] = 1; });
      richItems(exs.map(function (ex) {
        return {
          exId: ex.id, sets: ex.type === 'compuesto' ? targetSets : Math.max(3, targetSets - 1),
          repMin: ex.repMin, repMax: ex.repMax, reps: Math.round((ex.repMin + ex.repMax) / 2), rest: ex.rest
        };
      })).forEach(function (it) { items.push(it); });
      rationale.push(D.groupLabel(s.g.key) + ': ' + (s.days === null ? 'sin estímulo registrado' : 'hace ' + s.days + ' días') +
        ' · ' + s.sets + ' ' + U.plural(s.sets, 'serie', 'series') + ' en los últimos 7 días');
    });

    if (!items.length) {
      items = richItems(S.itemsFromRecipe([['cuadriceps', 1], ['pecho', 1], ['espalda', 1]], { rotate: 2 }));
      rationale.push('Sugerencia genérica de cuerpo completo: aún no hay historial suficiente.');
    }
    /* añade un bloque de core si no está representado */
    if (!items.some(function (i) { return i.group === 'core'; })) {
      S.pickForGroup('core', 1, used, { rotate: 2 }).forEach(function (ex) {
        used[ex.id] = 1;
        richItems([{ exId: ex.id, sets: 3, repMin: ex.repMin, repMax: ex.repMax, reps: Math.round((ex.repMin + ex.repMax) / 2), rest: ex.rest }])
          .forEach(function (it) { items.push(it); });
      });
    }
    var groups = U.uniq(items.map(function (i) { return i.group; }));
    return {
      title: 'Sesión de ' + groups.slice(0, 2).map(D.groupLabel).join(' + '),
      focus: groups.map(D.groupLabel).join(' · '),
      source: 'local', rationale: rationale, items: items,
      notes: 'Generado en tu dispositivo con tus datos de los últimos 7 días (' + D.GOAL_LABEL(st.goal) + ', ' + D.GOAL_REPS[st.goal].join('-') + ' reps).'
    };
  };

  var WEEK_LAYOUT = { 1: [2], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6] };
  var WEEK_ROTATION = {
    1: ['full_a'], 2: ['full_a', 'full_b'], 3: ['full_a', 'full_b', 'full_a'],
    4: ['push', 'pull', 'legs', 'upper'], 5: ['push', 'pull', 'legs', 'upper', 'lower'],
    6: ['push', 'pull', 'legs', 'push', 'pull', 'legs'], 7: ['push', 'pull', 'legs', 'upper', 'lower', 'full_a', 'mobility']
  };
  C.localWeek = function (opts) {
    opts = opts || {};
    var st = S.settings();
    var from = opts.fromIso || U.d.startOfWeek(U.d.today());
    var n = U.clamp(U.int(opts.daysPerWeek, st.daysPerWeek) || 4, 1, 7);
    var layout = WEEK_LAYOUT[n] || WEEK_LAYOUT[4];
    var rotation = WEEK_ROTATION[n] || WEEK_ROTATION[4];
    var days = [];
    for (var i = 0; i < 7; i++) {
      var iso = U.d.addDays(from, i);
      var idx = layout.indexOf(i);
      if (idx < 0) {
        var isRecovery = i === 6 && n < 6;
        days.push({ iso: iso, type: isRecovery ? 'movilidad' : 'descanso', title: isRecovery ? 'Movilidad ligera' : 'Descanso', focus: isRecovery ? 'Recuperación activa' : '', items: [] });
        continue;
      }
      var tpl = D.TEMPLATES.filter(function (t) { return t.id === rotation[idx % rotation.length]; })[0] || D.TEMPLATES[0];
      var items = richItems(S.itemsFromRecipe(tpl.recipe, { rotate: 3 }));
      days.push({
        iso: iso, type: tpl.id === 'mobility' ? 'movilidad' : (tpl.id === 'hiit' ? 'cardio' : 'entreno'),
        title: tpl.name, focus: U.uniq(items.map(function (x) { return D.groupLabel(x.group); })).join(' · '),
        items: items, template: tpl.id
      });
    }
    return {
      source: 'local', from: from, daysPerWeek: n, days: days,
      rationale: ['Distribución de ' + n + ' días con al menos 48 h entre sesiones del mismo grupo muscular.',
        'Selección de ejercicios según material disponible, progresión por historial y rotación para evitar repetir los mismos movimientos.']
    };
  };

  /* ==================== mapeo de ejercicios propuestos por la IA ==================== */
  function mapItems(list, opts) {
    opts = opts || {};
    var items = [], unmatched = [], unavailable = [];
    (Array.isArray(list) ? list : []).forEach(function (it) {
      if (!it) return;
      var ex = S.byName(it.name || it.exercise || it.ejercicio || '');
      if (!ex) { if (it.name) unmatched.push(String(it.name)); return; }
      if (!S.isAvailable(ex)) unavailable.push(ex.name);
      var repMin = U.int(it.repMin || it.reps_min, ex.repMin);
      var repMax = U.int(it.repMax || it.reps_max, ex.repMax);
      var reps = U.int(it.reps, Math.round((repMin + repMax) / 2));
      items.push({
        exId: ex.id, name: ex.name, group: ex.group, type: ex.type,
        sets: U.clamp(U.int(it.sets, ex.sets), 1, 10), reps: reps, repMin: repMin, repMax: repMax,
        weight: U.num(it.weight), unit: S.settings().units, rest: U.clamp(U.int(it.rest, ex.rest), 0, 600),
        notes: it.notes || '', basis: opts.basis || 'propuesto por el coach IA'
      });
    });
    return { items: items, unmatched: U.uniq(unmatched), unavailable: U.uniq(unavailable) };
  }
  C.mapItems = mapItems;

  function aiFooter(res, extra) {
    var bits = ['Coach IA · ' + C.model()];
    if (res && res.ms) bits.push((res.ms / 1000).toFixed(1) + 's');
    if (res && res.usage && res.usage.totalTokenCount) bits.push(res.usage.totalTokenCount + ' tokens');
    if (extra) bits.push(extra);
    return bits.join(' · ');
  }

  /* ==================== sugerir sesión de hoy ==================== */
  C.suggestWorkout = function (opts) {
    opts = opts || {};
    var local = C.localSuggest(opts);
    if (!opts.useAI || !C.hasKey()) return Promise.resolve(local);
    var st = S.settings();
    var prompt = [
      'Genera el entrenamiento de HOY para este usuario.',
      'Devuelve SOLO un JSON con esta forma exacta:',
      '{"title":"titulo corto","focus":"grupos principales","rationale":["motivo 1","motivo 2"],"exercises":[{"name":"nombre EXACTO de la lista permitida","sets":4,"repMin":8,"repMax":10,"weight":40,"rest":120,"notes":"breve tip"}]}',
      'Restricciones: entre 4 y 7 ejercicios; usa solo nombres de la lista de ejercicios permitidos;',
      'weight en ' + st.units + ' (0 si es peso corporal) y debe ser cargable con su inventario;',
      'ordena de compuesto a aislado; incluye 1 bloque de core;',
      'asigna en rest el descanso óptimo de cada ejercicio (compuestos grandes 180-240 s, auxiliares 90-120 s, aislamientos 60-75 s).',
      '',
      'Propuesta generada en el dispositivo con sus datos (puedes mejorarla o corregirla):',
      JSON.stringify({ title: local.title, exercises: local.items.map(function (i) { return { name: i.name, sets: i.sets, reps: i.reps, weight: i.weight }; }) })
    ].join('\n');
    var ctx = C.buildContext({ extra: 'DÍA DE HOY: ' + U.d.label(U.d.today()) + ' (' + U.d.dowLong(U.d.today()) + ')' });
    return C.generate({ prompt: prompt, system: C.system() + '\n\nCONTEXTO DEL USUARIO:\n' + ctx, json: true })
      .then(function (res) {
        var data = C.parseJSON(res.text);
        var merged = mapItems(data.exercises || data.items, { basis: 'propuesto por el coach IA' });
        if (!merged.items.length) throw new Error('el modelo no devolvió ejercicios reconocibles');
        return {
          title: data.title || local.title, focus: data.focus || local.focus,
          rationale: Array.isArray(data.rationale) ? data.rationale : (data.rationale ? [String(data.rationale)] : local.rationale),
          items: merged.items, unmatched: merged.unmatched, unavailable: merged.unavailable,
          notes: aiFooter(res), source: 'ia', thoughts: res.thoughts, usage: res.usage
        };
      })
      .catch(function (err) {
        local.error = err.message;
        local.source = 'local (IA no disponible)';
        return local;
      });
  };

  /* ==================== plan semanal ==================== */
  C.planWeek = function (opts) {
    opts = opts || {};
    var local = C.localWeek(opts);
    if (!opts.useAI || !C.hasKey()) return Promise.resolve(local);
    var from = local.from, to = U.d.addDays(from, 6);
    var prompt = [
      'Planifica la semana de entrenamiento del ' + from + ' al ' + to + ' (7 días exactos).',
      'Objetivo del usuario: ' + D.GOAL_LABEL(S.settings().goal) + ' | días de entreno deseados: ' + local.daysPerWeek + '.',
      'Devuelve SOLO este JSON:',
      '{"rationale":"explicación breve del reparto","days":[{"date":"YYYY-MM-DD","type":"entreno|cardio|movilidad|descanso","title":"...","focus":"...","exercises":[{"name":"nombre EXACTO","sets":4,"repMin":8,"repMax":10,"weight":40,"rest":120,"notes":""}]}]}',
      'Reglas: respeta exactamente las fechas; usa solo ejercicios permitidos; deja al menos 48 h antes de repetir el mismo grupo muscular;',
      'asigna en rest el descanso óptimo de cada ejercicio (compuestos grandes 180-240 s, auxiliares 90-120 s, aislamientos 60-75 s);',
      'los días de descanso van con exercises vacío; ajusta los pesos al historial y al inventario disponible.',
      '',
      'Base generada en el dispositivo (revisa coherencia con el historial y mejórala si hace falta):',
      JSON.stringify(local.days.map(function (d) {
        return { date: d.iso, type: d.type, title: d.title, exercises: d.items.map(function (i) { return { name: i.name, sets: i.sets, reps: i.reps, weight: i.weight }; }) };
      }))
    ].join('\n');
    var ctx = C.buildContext({ sessions: 12, extra: 'SEMANA OBJETIVO: ' + from + ' → ' + to });
    return C.generate({ prompt: prompt, system: C.system() + '\n\nCONTEXTO DEL USUARIO:\n' + ctx, json: true })
      .then(function (res) {
        var data = C.parseJSON(res.text);
        if (!data || !Array.isArray(data.days)) throw new Error('el modelo no devolvió días');
        var byDate = {};
        data.days.forEach(function (d) { if (d && d.date) byDate[String(d.date).slice(0, 10)] = d; });
        var days = U.d.weekDates(from).map(function (iso, i) {
          var ai = byDate[iso], base = local.days[i];
          if (!ai) return base;
          var type = /^(entreno|cardio|movilidad|descanso)$/.test(ai.type) ? ai.type : (ai.exercises && ai.exercises.length ? 'entreno' : 'descanso');
          var merged = mapItems(ai.exercises, { basis: 'plan semanal del coach IA' });
          return {
            iso: iso, type: type, title: ai.title || base.title, focus: ai.focus || base.focus,
            items: merged.items.length ? merged.items : (type === 'descanso' ? [] : base.items),
            unmatched: merged.unmatched, fromAi: true
          };
        });
        return {
          source: 'ia', from: from, daysPerWeek: local.daysPerWeek, days: days,
          rationale: [data.rationale || 'Plan semanal del coach IA.', 'Generado con ' + (res.usage && res.usage.totalTokenCount ? res.usage.totalTokenCount + ' tokens' : 'la API') + '.'],
          notes: aiFooter(res), thoughts: res.thoughts, usage: res.usage
        };
      })
      .catch(function (err) {
        local.error = err.message;
        local.source = 'local (IA no disponible)';
        return local;
      });
  };

  /* ==================== análisis del progreso ==================== */
  C.analyzeProgress = function (opts) {
    opts = opts || {};
    if (!C.hasKey()) return Promise.reject(new Error('Añade tu API key de Gemini en Ajustes → Coach AI'));
    var weeks = U.int(opts.weeks, 6);
    var series = S.a.weeklySeries(weeks);
    var brief = series.map(function (w) { return w.label + ': ' + U.fmt.vol(w.volume) + ' kg, ' + w.sessions + ' sesiones, ' + w.sets + ' series'; }).join('\n');
    var prompt = [
      'Analiza mi progreso de las últimas ' + weeks + ' semanas y dame conclusiones accionables.',
      'Estructura en markdown con: 1) Resumen en 3 bullets, 2) Qué está funcionando, 3) Riesgos o desequilibrios, 4) 3 ajustes concretos para la próxima semana.',
      'Sé específico con números y no superes las 400 palabras.',
      '',
      'Volumen por semana:', brief
    ].join('\n');
    var ctx = C.buildContext({ sessions: 16 });
    return C.generate({ prompt: prompt, system: C.system() + '\n\nCONTEXTO DEL USUARIO:\n' + ctx })
      .then(function (res) { return { text: res.text, thoughts: res.thoughts, notes: aiFooter(res), usage: res.usage }; });
  };

  /* ==================== chat ==================== */
  C.chat = function (text) {
    if (!C.hasKey()) return Promise.reject(new Error('Añade tu API key de Gemini en Ajustes → Coach AI'));
    var hist = S.chat().filter(function (m) { return m.role === 'user' || m.role === 'model'; }).slice(-12);
    var contents = hist.map(function (m) { return { role: m.role, parts: [{ text: m.text }] }; });
    contents.push({ role: 'user', parts: [{ text: text }] });
    return C.generate({ contents: contents, system: C.system() + '\n\nCONTEXTO DEL USUARIO:\n' + C.buildContext({ sessions: 8 }) })
      .then(function (res) { return { text: res.text, thoughts: res.thoughts, notes: aiFooter(res), usage: res.usage }; });
  };

  /* ==================== aplicar planes ==================== */
  C.applySuggestionAsRoutine = function (sug) {
    if (!sug || !sug.items || !sug.items.length) return null;
    return S.addRoutine({
      name: sug.title || 'Rutina del coach', focus: sug.focus || '',
      source: sug.source === 'ia' ? 'ia' : 'generador',
      notes: (sug.notes || '') + (sug.rationale && sug.rationale.length ? ' | ' + sug.rationale.join(' ') : ''),
      items: sug.items.map(function (i) { return { exId: i.exId, sets: i.sets, repMin: i.repMin, repMax: i.repMax, rest: i.rest, weight: i.weight, notes: i.notes }; })
    });
  };
  C.applyWeek = function (plan) {
    if (!plan || !plan.days) return null;
    var created = 0;
    plan.days.forEach(function (d) {
      var patch = { type: d.type, title: d.title, status: d.type === 'descanso' ? 'rest' : 'planned', focus: d.focus || '', source: plan.source };
      if (d.items && d.items.length) {
        var r = S.addRoutine({
          name: d.title + ' · ' + U.d.label(d.iso, 'medium'), focus: d.focus || '',
          source: plan.source === 'ia' ? 'ia' : 'generador', notes: 'Plan semanal (' + plan.source + ')',
          items: d.items.map(function (i) { return { exId: i.exId, sets: i.sets, repMin: i.repMin, repMax: i.repMax, rest: i.rest, weight: i.weight, notes: i.notes }; })
        });
        patch.routineId = r.id;
        created++;
      }
      S.setDay(d.iso, patch);
    });
    S.setMeta({ lastPlanAt: U.d.nowTs() });
    return { days: plan.days.length, routines: created };
  };

  window.App.coach = C;
})();
