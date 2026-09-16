/* ==========================================================================
   Pulso · trainer.js — sesión activa, timer de descanso (se pinta dentro del
   recuadro de sesión, o como barra compacta si el usuario está en otra pestaña)
   y calculadora de discos (cálculo en kg, admite inventario en kg y lb)
   ========================================================================== */
(function () {
  'use strict';
  var U = window.App.u, D = window.App.data, S = window.App.store;
  var T = {};

  /* ==================== sesión activa ==================== */
  function newEntry(exId, setsCount, repMin, repMax, rest) {
    var ex = S.byId(exId);
    var n = U.clamp(U.int(setsCount, ex ? ex.sets : 3), 1, 12);
    var sets = [];
    for (var i = 0; i < n; i++) sets.push({ weight: '', reps: '', done: false, ts: null, rpe: null });
    return {
      exId: exId, name: ex ? ex.name : exId, restSec: U.int(rest, ex ? ex.rest : 90),
      repMin: U.int(repMin, ex ? ex.repMin : 8), repMax: U.int(repMax, ex ? ex.repMax : 12),
      sets: sets, notes: ''
    };
  }
  function blankSet(weight, reps, targetReps) {
    /* sin peso se queda VACÍO (no 0): el input ya muestra su placeholder y
       tratarlo como 0 ensuciaba el volumen de los ejercicios a peso corporal */
    var w = (weight === '' || weight === undefined || weight === null) ? '' : U.num(weight);
    return { weight: w, reps: reps === '' || reps === undefined ? '' : U.num(reps), done: false, ts: null, rpe: null, target: targetReps };
  }
  /* rellena las series vacías con la sugerencia de progresión */
  function prefill(entry) {
    var sug = S.a.suggestWeight(entry.exId, Math.round((entry.repMin + entry.repMax) / 2), T.unit());
    entry.sets = entry.sets.map(function (set) {
      var s = set || {};
      if (s.weight === undefined || s.weight === null || s.weight === '') {
        /* sin historial se deja vacío: un 0 en todas las series parecía un dato
           obligatorio y daba a entender que el ejercicio pesaba 0 kg */
        s.weight = sug.weight ? sug.weight : '';
        s.suggested = !!sug.weight;
      }
      if (s.reps === undefined || s.reps === null || s.reps === '') s.reps = sug.reps || entry.repMin;
      s.done = !!s.done;
      return s;
    });
    entry.basis = sug.basis;
    return entry;
  }

  T.unit = function () { return S.settings().units || 'kg'; };
  T.active = function () { return S.active(); };

  T.start = function (opts) {
    opts = opts || {};
    if (T.active()) return T.active();
    var entries = [];
    if (opts.routineId) {
      var r = S.routine(opts.routineId);
      if (r) entries = r.items.map(function (it) {
        var en = prefill(newEntry(it.exId, it.sets, it.repMin, it.repMax, it.rest));
        /* el peso del plan manda sobre la sugerencia por historial, y las
           indicaciones del ejercicio (superseries, pausas…) llegan a la sesión */
        if (it.weight) en.sets = en.sets.map(function (s) { s.weight = U.num(it.weight); s.suggested = false; return s; });
        en.notes = it.notes || '';
        return en;
      });
    } else if (opts.exIds && opts.exIds.length) {
      entries = opts.exIds.map(function (id) { return prefill(newEntry(id)); });
    } else if (opts.plan && opts.plan.length) {
      entries = opts.plan.map(function (p) {
        var id = p.exId;
        if (!id && p.name) {
          var found = S.byName(p.name);
          if (found) id = found.id;
        }
        if (!id) return null;
        var en = newEntry(id, p.sets, p.repMin, p.repMax, p.rest);
        prefill(en);
        if (p.weight) en.sets = en.sets.map(function (st) { return { weight: U.num(p.weight), reps: st.reps, done: false, ts: null, rpe: null }; });
        return en;
      }).filter(Boolean);
    }
    var active = {
      id: U.uid('live'), routineId: opts.routineId || null,
      name: opts.name || (opts.routineId ? (S.routine(opts.routineId) || {}).name : 'Entrenamiento libre'),
      startedAt: new Date().toISOString(), unit: T.unit(), entries: entries, notes: '',
      dayIso: opts.dayIso || U.d.today(), source: opts.source || 'manual'
    };
    S.setActive(active);
    if (S.settings().keepAwake) U.wakeLock.on();
    keepAlive('Entrenamiento');
    U.audio.ensure();
    return active;
  };

  T.update = function (mutator) {
    var a = T.active();
    if (!a) return null;
    mutator(a);
    S.setActive(a);
    return a;
  };
  T.entry = function (idx) {
    var a = T.active();
    return a ? a.entries[U.int(idx)] : null;
  };
  T.addExercise = function (exId) {
    var ex = S.byId(exId);
    T.update(function (a) { a.entries.push(prefill(newEntry(exId))); });
    return ex;
  };
  T.removeExercise = function (idx) {
    return T.update(function (a) { a.entries.splice(U.int(idx), 1); });
  };
  T.moveExercise = function (idx, delta) {
    return T.update(function (a) {
      var i = U.int(idx), j = i + U.int(delta);
      if (j < 0 || j >= a.entries.length) return;
      var tmp = a.entries[i]; a.entries[i] = a.entries[j]; a.entries[j] = tmp;
    });
  };
  T.addSet = function (idx) {
    return T.update(function (a) {
      var en = a.entries[U.int(idx)];
      var last = en.sets[en.sets.length - 1] || {};
      en.sets.push(blankSet(last.weight, last.reps, last.target));
    });
  };
  T.removeSet = function (idx, setIdx) {
    return T.update(function (a) {
      var en = a.entries[U.int(idx)];
      if (en.sets.length <= 1) return;
      en.sets.splice(U.int(setIdx), 1);
    });
  };
  T.setSet = function (idx, setIdx, patch) {
    return T.update(function (a) {
      var en = a.entries[U.int(idx)], set = en.sets[U.int(setIdx)];
      if (!set) return;
      Object.keys(patch).forEach(function (k) { set[k] = patch[k]; });
    });
  };
  /* qué toca después: el mismo ejercicio si le quedan series, o el siguiente
     con series pendientes (útil al cambiar de ejercicio, p. ej. superseries) */
  function nextLabel(a, idx) {
    var i = U.int(idx), cur = a.entries[i];
    if (cur && cur.sets.some(function (s) { return !s.done; })) return cur.name;
    for (var k = i + 1; k < a.entries.length; k++) {
      if (a.entries[k].sets.some(function (s) { return !s.done; })) return a.entries[k].name;
    }
    return '';
  }
  /* marca/desmarca una serie completada; lanza el descanso automático
     · entre series del mismo ejercicio, si ya era la última, NO descansa;
     · pero al terminar un ejercicio SÍ descansa si queda otro por hacer, y el
       aviso anuncia cuál es el siguiente (el momento de cambiar de máquina);
     · marcar la última serie de la sesión tampoco descansa;
     · desmarcar una serie cancela el descanso en curso (no está hecha). */
  T.toggleSet = function (idx, setIdx, on) {
    var a = T.active();
    if (!a) return null;
    var en = a.entries[U.int(idx)];
    if (!en) return null;
    var set = en.sets[U.int(setIdx)];
    if (!set) return null;
    set.done = on === undefined ? !set.done : !!on;
    set.ts = set.done ? new Date().toISOString() : null;
    if (set.done) {
      U.audio.ensure();
      /* nextLabel devuelve cadena vacía cuando no queda nada pendiente en toda
         la sesión (última serie): ahí no hay descanso que hacer */
      var next = nextLabel(a, idx);
      if (next && S.settings().autoRest) {
        T.rest.start(en.restSec || S.settings().restDefault, next);
      }
    } else if (T.restState.running) {
      T.rest.stop();
    }
    S.setActive(a);
    return { entry: en, set: set, resting: T.restState.running };
  };
  /* arrastra un cambio hacia ABAJO: cambiar la serie 1 lo aplica a las
     siguientes; cambiarlo desde la 3, solo de la 3 en adelante. Nunca toca las
     de arriba ni las ya marcadas (esas ya se hicieron). */
  T.propagateSet = function (idx, setIdx, field, value) {
    return T.update(function (a) {
      var en = a.entries[U.int(idx)];
      if (!en || (field !== 'weight' && field !== 'reps')) return;
      for (var j = U.int(setIdx) + 1; j < en.sets.length; j++) {
        if (en.sets[j].done) continue;
        en.sets[j][field] = value;
      }
    });
  };
  T.setRestFor = function (idx, sec) {
    return T.update(function (a) { a.entries[U.int(idx)].restSec = U.int(sec, 90); });
  };
  T.sessionProgress = function () {
    var a = T.active();
    if (!a) return { done: 0, total: 0, pct: 0, volume: 0, sets: 0 };
    var done = 0, total = 0, volume = 0;
    a.entries.forEach(function (en) {
      total += en.sets.length;
      en.sets.forEach(function (s) {
        if (s.done) { done++; volume += U.units.toKg(U.num(s.weight), a.unit) * U.num(s.reps); }
      });
    });
    return { done: done, total: total, pct: total ? done / total : 0, volume: volume, sets: total };
  };
  T.finish = function (opts) {
    opts = opts || {};
    var a = T.active();
    if (!a) return null;
    var doneSets = 0, rpes = [];
    a.entries.forEach(function (en) {
      en.sets.forEach(function (s) { if (s.done) { doneSets++; if (s.rpe) rpes.push(U.num(s.rpe)); } });
    });
    var sess = {
      id: U.uid('s'), name: a.name, routineId: a.routineId, date: a.dayIso || U.d.today(),
      startedAt: a.startedAt, endedAt: new Date().toISOString(), unit: a.unit, source: a.source,
      entries: a.entries.map(function (en) {
        return {
          exId: en.exId, name: en.name, restSec: en.restSec, notes: en.notes || '',
          sets: en.sets.filter(function (s) { return s.done; }).map(function (s) {
            return { weight: U.num(s.weight), reps: U.num(s.reps), done: true, ts: s.ts, rpe: s.rpe ? U.num(s.rpe) : null };
          })
        };
      }).filter(function (en) { return en.sets.length; }),
      notes: opts.notes || a.notes || '', rpe: rpes.length ? U.round(U.avg(rpes), 1) : null
    };
    if (!sess.entries.length) {
      U.toast('No marcaste ninguna serie, la sesión no se guardó', { type: 'warn' });
      return null;
    }
    S.addSession(sess);
    S.setDay(sess.date, { status: 'done', sessionId: sess.id });
    S.setActive(null);
    U.wakeLock.off();
    U.keepAlive.off();
    T.rest.stop();
    U.beep('done');
    U.notify('Sesión guardada', sess.name + ' · ' + U.fmt.vol(S.a.volumeOf(sess)) + ' kg de volumen');
    return sess;
  };
  T.discard = function () {
    S.setActive(null);
    U.wakeLock.off();
    U.keepAlive.off();
    T.rest.stop();
  };

  /* ==================== timer de descanso ====================
     Se muestra DENTRO del recuadro de "sesión en curso" mientras dura el
     descanso (el tiempo lo sugiere el ejercicio/plantilla o el coach IA).
     Si el usuario navega a otra pestaña, queda como barra compacta.
     Cálculo por timestamp: correcto aunque la app pase a segundo plano o
     el móvil se bloquee; al terminar avisa con pitido, vibración y
     notificación (service worker si la app no está visible). */
  var R = { endsAt: 0, total: 0, running: false, label: '', doneFired: false, doneAt: 0, lastTick: null };
  T.restState = R;
  function persistRest() {
    U.st.set('rest', R.running ? { endsAt: R.endsAt, total: R.total, label: R.label } : null);
  }

  /* ---------- aviso de fin de descanso ----------
     Dos caminos, porque el móvil bloqueado es el caso duro:
     · la pestaña sigue viva (keep-alive de audio) → pitido de ~3,5 s + vibración;
     · la pestaña está congelada → el aviso lo tiene programado el service worker
       desde que arrancó el descanso y despierta a la hora exacta para lanzar la
       notificación del sistema. */
  function swPost(msg) {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage(msg);
        return true;
      }
    } catch (e) { /* noop */ }
    return false;
  }
  function restTitle() { return 'Descanso terminado'; }
  function restBody() { return R.label ? 'Siguiente serie: ' + U.trunc(R.label, 40) : 'Siguiente serie cuando estés listo'; }
  function scheduleRestNotice() {
    if (!R.running || S.settings().notify === false) return;
    swPost({ type: 'schedule-rest', at: R.endsAt, title: restTitle(), body: restBody(), tag: 'pulso-rest' });
  }
  function cancelRestNotice() { swPost({ type: 'cancel-rest' }); }
  function notifyEnd() {
    if (S.settings().notify === false) return;
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        if (document.hidden) {
          if (!swPost({ type: 'notify', title: restTitle(), body: restBody(), tag: 'pulso-rest', requireInteraction: true })) pageNotify();
        } else pageNotify();
      }
    } catch (e) { /* noop */ }
  }
  function pageNotify() {
    try {
      var n = new Notification(restTitle(), { body: restBody(), tag: 'pulso-rest' });
      n.onclick = function () { try { window.focus(); n.close(); } catch (e) { /* noop */ } };
    } catch (e) { /* noop */ }
  }
  /* la pestaña se mantiene viva mientras dura la sesión: sin esto el móvil la
     congela al bloquearse y el timer no podría avisar (ver U.keepAlive) */
  function keepAlive(label) {
    try {
      if (S.settings().keepAwake === false) { U.keepAlive.off(); return; }
      U.keepAlive.on(label || 'Entrenamiento');
    } catch (e) { /* noop */ }
  }

  T.rest = {
    start: function (sec, label) {
      sec = Math.max(1, U.int(sec, 90));
      R.total = sec;
      R.endsAt = Date.now() + sec * 1000;
      R.running = true;
      R.doneFired = false;
      R.lastTick = null;
      R.label = label || '';
      persistRest();
      scheduleRestNotice();
      keepAlive(label ? 'Descanso · ' + label : 'Descanso');
      T.rest.paint();
      return R;
    },
    add: function (sec) {
      var s = U.int(sec, 15);
      /* si el descanso ya terminó (se está viendo el aviso de "completado"),
         +15s arranca una cuenta NUEVA desde ahora: antes se sumaba a un final ya
         pasado y el botón parecía no hacer nada */
      if (!R.running || R.endsAt <= Date.now()) {
        R.endsAt = Date.now() + s * 1000;
        R.total = s;
      } else {
        R.endsAt += s * 1000;
        R.total = Math.max(R.total, Math.round((R.endsAt - Date.now()) / 1000));
      }
      R.running = true;
      R.doneFired = false;
      R.lastTick = null;
      persistRest();
      scheduleRestNotice();
      keepAlive(R.label ? 'Descanso · ' + R.label : 'Descanso');
      T.rest.paint();
      U.beep('tick');
    },
    sub: function (sec) {
      R.endsAt = Math.max(Date.now() + 1000, R.endsAt - U.int(sec, 15) * 1000);
      R.total = Math.max(1, Math.round((R.endsAt - Date.now()) / 1000));
      R.lastTick = null;
      persistRest();
      scheduleRestNotice();
      T.rest.paint();
      U.beep('tick');
    },
    stop: function () {
      R.running = false;
      R.doneFired = false;
      R.lastTick = null;
      persistRest();
      cancelRestNotice();
      T.rest.paint();
    },
    remaining: function () { return R.running ? Math.max(0, Math.round((R.endsAt - Date.now()) / 1000)) : 0; },
    startedTotal: function () { return R.total || 0; },
    restore: function () {
      var saved = U.st.get('rest', null);
      if (!saved) return;
      if (saved.endsAt > Date.now()) {
        R.endsAt = saved.endsAt; R.total = saved.total; R.label = saved.label || ''; R.running = true; R.lastTick = null;
        scheduleRestNotice();
        keepAlive(R.label ? 'Descanso · ' + R.label : 'Descanso');
      } else { U.st.del('rest'); }
    },
    /* ---- render: dentro del recuadro de sesión si existe; si no, barra compacta ---- */
    paint: function (root) {
      var bar = U.$('#restbar');
      if (!bar) return;
      /* si la vista nos pasa su contenedor, el recuadro es el suyo (evita
         confundirse con otra copia del mismo id en el documento) */
      var card = root ? root.querySelector('#session-rest') : document.getElementById('session-rest');
      if (!R.running) {
        bar.innerHTML = ''; bar.__built = false;
        if (card) { card.innerHTML = ''; card.__state = null; }
        return;
      }
      var left = T.rest.remaining(), total = R.total || left || 1;
      var frac = total ? left / total : 0;
      var over = left === 0;
      var what = R.label ? U.esc(U.trunc(R.label, 40)) : '';

      /* vista de resumen: el descanso vive en una línea compacta del resumen y
         NO se pinta la barra flotante (el recuadro pegajoso sigue a la vista) */
      var miniT = root ? root.querySelector('#sr-mini-time') : document.getElementById('sr-mini-time');
      if (miniT) {
        miniT.textContent = U.fmt.mmss(left);
        miniT.classList.toggle('over', over);
        var miniL = root ? root.querySelector('#sr-mini-label') : document.getElementById('sr-mini-label');
        if (miniL) miniL.textContent = over ? 'descanso terminado' : (R.label ? 'siguiente: ' + U.trunc(R.label, 30) : 'descanso');
        return;
      }

      /* dentro del recuadro de sesión en curso */
      if (card) {
        bar.innerHTML = ''; bar.__built = false;
        var state = over ? 'done' : 'run';
        if (card.__state !== state) {
          card.__state = state;
          card.innerHTML =
            '<div class="session-rest' + (over ? ' done' : '') + '">' +
              '<div class="sr-ring">' + U.ring(frac, 96, 6.5) + '<div class="sr-time" id="sr-time">' + U.fmt.mmss(left) + '</div></div>' +
              '<div class="sr-main">' +
                '<div class="tiny muted" style="text-transform:uppercase;letter-spacing:.4px;font-weight:700">' + (over ? 'descanso completado' : 'descanso en curso') + '</div>' +
                (what ? '<div class="h3 ellipsis">' + what + '</div>' : '<div class="h3">Siguiente serie</div>') +
                '<div class="tiny muted">' + (over ? 'a por la siguiente serie' : 'sugerido para este ejercicio · total ' + U.fmt.mmss(total)) + '</div>' +
                '<div class="sr-actions">' +
                  '<button class="btn sm" data-act="rest-sub" data-sec="15">-15s</button>' +
                  '<button class="btn sm" data-act="rest-add" data-sec="15">+15s</button>' +
                  '<button class="btn sm ghost" data-act="rest-skip">' + (over ? 'Continuar' : 'Saltar') + '</button>' +
                  '<button class="btn sm quiet" data-act="rest:view" title="Ver el resumen de la sesión">Resumen</button>' +
                '</div>' +
              '</div>' +
            '</div>';
        } else {
          var st2 = U.$('#sr-time', card);
          if (st2) st2.textContent = U.fmt.mmss(left);
          U.ringUpdate(U.$('svg[data-ring]', card), frac);
        }
        return;
      }

      /* barra compacta (usuario en otra pestaña de la app) */
      if (!bar.__built) {
        bar.innerHTML =
          '<div class="restbar-inner"><div class="rest-pill' + (over ? ' over' : '') + '">' +
            '<div class="col" style="gap:0">' +
              '<div class="rest-time" id="rest-time">' + U.fmt.mmss(left) + '</div>' +
              '<div class="rest-label" id="rest-label">' + (over ? '¡listo!' : (R.label ? U.trunc(R.label, 20) : 'descanso')) + '</div>' +
            '</div>' +
            U.ring(frac, 46, 4.5) +
            '<div class="rest-bar"><i id="rest-fill" style="width:' + (frac * 100).toFixed(1) + '%"></i></div>' +
            '<button class="btn sm" data-act="rest-add" data-sec="15">+15s</button>' +
            '<button class="btn sm ghost" data-act="rest-skip">Saltar</button>' +
          '</div></div>';
        bar.__built = true;
      }
      var pill = U.$('.rest-pill', bar);
      if (pill) pill.classList.toggle('over', over);
      var t = U.$('#rest-time', bar); if (t) t.textContent = U.fmt.mmss(left);
      var f = U.$('#rest-fill', bar); if (f) f.style.width = (frac * 100).toFixed(1) + '%';
      var lbl = U.$('#rest-label', bar); if (lbl) lbl.textContent = over ? '¡listo!' : (R.label ? U.trunc(R.label, 20) : 'descanso');
      var bsvg = U.$('svg[data-ring]', bar);
      U.ringUpdate(bsvg, frac);
      if (bsvg && bsvg.querySelector('.fg')) bsvg.querySelector('.fg').style.stroke = over ? 'var(--danger)' : 'var(--accent)';
    }
  };
  /* ---- bucle global (lo inicia app.js cada 500 ms) ---- */
  T.loop = function () {
    var wasRunning = R.running;
    if (R.running) {
      var left = T.rest.remaining();
      /* ticks suaves en los últimos 3 s (aviso opcional de que se acaba) */
      if (left > 0 && left <= 3 && S.settings().countdownTick !== false && R.lastTick !== left) {
        R.lastTick = left;
        U.beep('tick');
      }
      if (left === 0 && !R.doneFired) {
        R.doneFired = true;
        R.doneAt = Date.now();
        R.lastTick = null;
        U.beep('end');
        U.vibrate([160, 80, 160, 80, 160]);
        notifyEnd();
        cancelRestNotice();
      }
      /* el aviso de fin se queda 30 s y luego se cierra solo */
      if (R.doneFired && Date.now() - R.doneAt > 30000) {
        R.running = false; R.doneFired = false;
        persistRest();
        cancelRestNotice();
      }
    }
    T.rest.paint();
    if (wasRunning && !R.running && (document.getElementById('session-rest') || document.getElementById('sr-mini-time')) && window.App.render) window.App.render();
    var a = T.active();
    var chip = U.$('#btn-session-clock');
    if (chip) chip.hidden = !a;
    var lbl = U.$('#session-clock');
    if (lbl && a) lbl.textContent = U.fmt.clock(Math.round((Date.now() - new Date(a.startedAt).getTime()) / 1000));
  };

  /* ==================== calculadora de discos ====================
     Todo se calcula en kg (el inventario admite discos en kg y lb).
     El mismo inventario NO rinde igual en todo: la barra reparte los discos
     entre sus dos lados, una mancuerna ajustable entre sus dos extremos, y si
     entrenas con DOS mancuernas cargables necesitas el doble de discos para el
     mismo peso en cada una. Por eso el cálculo se resuelve por "huecos":

       barra         2 huecos (lados)       total = barra + 2·Σ(por lado)
       1 mancuerna   2 huecos (extremos)    total = mango + 2·Σ(por extremo)
       2 mancuernas  4 huecos (2 c/u)       total = mango + 2·Σ(por extremo)
       sin discos    0 huecos               máquina o mancuerna fija

     Un "par" son 2 discos, así que cada medida reparte 2·pares discos entre los
     huecos: cap = floor(2·pares / huecos). Con los 8 pares de 3 kg (16 discos)
     la barra admite 8 por lado, una mancuerna 8 por extremo y con dos
     mancuernas 4 por extremo en cada una. El reparto es siempre SIMÉTRICO y se
     enumeran todas las combinaciones para quedarse con la más cercana al peso
     pedido (nunca propone un peso inalcanzable). Cada ejercicio se calcula por
     su cuenta: los discos son los mismos y se mueven de un ejercicio a otro.
     ---------------------------------------------------------------- */
  function invKg() {
    return (S.settings().plates || [])
      .filter(function (p) { return p.on !== false && U.num(p.pairs) > 0; })
      .map(function (p) {
        return { kg: U.units.toKg(U.num(p.w), p.unit || 'kg'), n: U.int(p.pairs, 1), srcW: U.num(p.w), srcUnit: p.unit || 'kg' };
      })
      .filter(function (p) { return p.kg > 0; })
      .sort(function (a, b) { return b.kg - a.kg; });
  }
  T.invKg = invKg;

  var PLATE_MODES = {
    bar: { key: 'bar', label: 'Barra', hint: 'un disco por lado', places: 2, per: 'lado', handle: 'olimpica' },
    db1: { key: 'db1', label: '1 mancuerna', hint: 'unilateral · un disco por extremo', places: 2, per: 'extremo', handle: 'mancuerna' },
    db2: { key: 'db2', label: '2 mancuernas', hint: 'los mismos discos en cada mancuerna', places: 4, per: 'extremo', handle: 'mancuerna' },
    none: { key: 'none', label: 'Sin discos', hint: 'máquina o mancuerna fija', places: 0, per: '', handle: null }
  };
  T.PLATE_MODES = PLATE_MODES;
  T.PLATE_MODE_KEYS = ['bar', 'db1', 'db2', 'none'];
  T.plateMode = function (mode) { return PLATE_MODES[mode] || PLATE_MODES.bar; };

  /* peso del mango/barra sin discos, según el modo */
  T.plateHandleKg = function (mode, opts) {
    opts = opts || {};
    var spec = T.plateMode(mode);
    if (!spec.handle) return 0;
    if (opts.handleKg !== undefined) return U.num(opts.handleKg, 0);
    if (spec.key === 'bar' && opts.barKg !== undefined) return U.num(opts.barKg, 0);
    return U.num((S.settings().bars || {})[spec.handle], 0);
  };
  /* discos de cada medida que caben en UN hueco (lado de barra o extremo de mancuerna) */
  T.plateCaps = function (mode) {
    var places = Math.max(1, T.plateMode(mode).places);
    return invKg().map(function (p) {
      return { p: p, cap: Math.max(0, Math.floor(p.n * 2 / places)) };
    });
  };
  /* modo sugerido según el ejercicio (unilateral → una mancuerna, barra → barra) */
  var UNILATERAL_RX = /unilateral|a una mano|una mano|kroc|por brazo|por lado|por pierna/;
  T.plateModeFor = function (exId, name) {
    var saved = S.settings().plateModes || {};
    if (exId && PLATE_MODES[saved[exId]]) return saved[exId];
    /* la calculadora suelta (sin ejercicio) arranca en barra */
    if (!exId && !name) return PLATE_MODES[saved.__tool__] ? saved.__tool__ : 'bar';
    var ex = exId ? S.byId(exId) : null;
    var nm = String((ex && ex.name) || name || '').toLowerCase();
    var eq = ex ? String(ex.equip || '').toLowerCase() : '';
    if (ex && ex.bw) return 'none';
    var dumbbell = /mancuern/.test(nm) || /mancuernas_ajustables/.test(eq);
    var barbell = /barra/.test(nm) || /barra_olimpica|barra_ez/.test(eq);
    if (dumbbell && !barbell) return UNILATERAL_RX.test(nm) ? 'db1' : 'db2';
    if (barbell) return 'bar';
    if (S.has('mancuernas_ajustables')) return 'db2';
    return S.has('barra_olimpica') ? 'bar' : 'none';
  };
  /* el usuario puede forzar el modo de un ejercicio y se recuerda */
  T.setPlateMode = function (key, mode) {
    if (!PLATE_MODES[mode]) return null;
    var modes = U.clone(S.settings().plateModes || {});
    modes[key || '__tool__'] = mode;
    S.setSettings({ plateModes: modes });
    return mode;
  };

  function countDiscs(counts) {
    var n = 0;
    for (var i = 0; i < counts.length; i++) n += counts[i] || 0;
    return n;
  }
  /* todas las sumas alcanzables en un hueco y con qué discos se consiguen;
     si una suma se puede lograr con menos discos, se queda con ese reparto */
  function enumerateSums(caps, limitKg) {
    var size = caps.length, zero = [];
    for (var i = 0; i < size; i++) zero.push(0);
    var maps = { '0': zero };
    caps.forEach(function (item, idx) {
      var next = {};
      Object.keys(maps).forEach(function (k) {
        var counts = maps[k], base = U.num(k) / 1000, used = countDiscs(counts);
        for (var c = 0; c <= item.cap; c++) {
          var s = base + c * item.p.kg;
          if (s > limitKg + 1e-9) break;
          var key = String(Math.round(s * 1000));
          if (next[key] && countDiscs(next[key]) <= used + c) continue;
          var arr = counts.slice();
          arr[idx] = c;
          next[key] = arr;
        }
      });
      maps = next;
    });
    return maps;
  }

  T.plates = function (targetWeight, opts) {
    opts = opts || {};
    var spec = T.plateMode(opts.mode);
    var unit = opts.unit || T.unit();
    var target = U.num(targetWeight);
    var targetKg = U.units.toKg(target, unit);
    var handle = T.plateHandleKg(spec.key, opts);
    var out = {
      unit: unit, mode: spec.key, modeLabel: spec.label, per: spec.per, places: spec.places,
      handleKg: handle, barKg: handle, target: target, targetKg: targetKg, perSide: [],
      sideKg: 0, achieveKg: handle, diffKg: 0, exact: false, noPlates: !spec.places,
      caps: T.plateCaps(spec.key), maxKg: handle, belowKg: null, aboveKg: null,
      discsPerHole: 0, discsTotal: 0, usage: []
    };
    if (!spec.places) {
      /* no hay discos que poner: el peso pedido se usa tal cual */
      out.achieveKg = targetKg; out.diffKg = 0; out.exact = true;
      return out;
    }
    var maxSide = U.sum(out.caps, function (it) { return it.cap * it.p.kg; });
    out.maxKg = handle + 2 * maxSide;
    var maps = enumerateSums(out.caps, maxSide);
    var sums = Object.keys(maps).map(function (k) { return U.num(k) / 1000; }).sort(function (a, b) { return a - b; });
    var want = (targetKg - handle) / 2;
    var pick = 0, bestD = Infinity;
    sums.forEach(function (s, i) {
      var d = Math.abs(s - want);
      if (d < bestD - 1e-9) { bestD = d; pick = i; return; }
      /* empate: el más ligero (mejor quedarse corto que pasarse) */
      if (d <= bestD + 1e-9 && s < sums[pick]) pick = i;
    });
    var counts = maps[String(Math.round(sums[pick] * 1000))] || [];
    out.caps.forEach(function (it, i) {
      var c = counts[i] || 0;
      if (c > 0) out.perSide.push({ kg: it.p.kg, n: c, srcW: it.p.srcW, srcUnit: it.p.srcUnit });
    });
    /* Cuántos discos hacen falta en TOTAL y cómo quedan frente al inventario.
       Con dos mancuernas el mismo reparto se repite en los 4 extremos, así que
       hay que decirlo: "3 discos de 3 kg" por extremo son 12 discos reales, y
       el usuario necesita saber si le alcanzan (y cuántos le sobran). */
    out.discsPerHole = U.sum(out.perSide, function (p) { return p.n; });
    out.discsTotal = out.discsPerHole * spec.places;
    out.usage = out.caps.map(function (it, i) {
      var c = counts[i] || 0;
      return { kg: it.p.kg, srcW: it.p.srcW, srcUnit: it.p.srcUnit, used: c * spec.places, have: it.p.n * 2 };
    }).filter(function (u) { return u.used > 0; });
    out.sideKg = U.round(sums[pick], 3);
    out.achieveKg = U.round(handle + 2 * out.sideKg, 3);
    out.diffKg = U.round(targetKg - out.achieveKg, 3);
    /* 0,1 kg de margen: con discos mezclados en kg y lb el ajuste fino no da
       para más y marcar 0,04 kg como "te pasas" sería ruido */
    out.exact = Math.abs(out.diffKg) <= 0.1;
    out.belowKg = pick > 0 ? U.round(handle + 2 * sums[pick - 1], 3) : null;
    out.aboveKg = pick < sums.length - 1 ? U.round(handle + 2 * sums[pick + 1], 3) : null;
    return out;
  };
  T.plateLabel = function (kg, srcW, srcUnit, n) {
    var txt = U.fmt.n(kg, 2) + ' kg';
    if (srcUnit === 'lb' && srcW) txt += ' (' + U.fmt.n(srcW) + ' lb)';
    if (U.int(n, 1) > 1) txt += ' ×' + U.int(n, 1);
    return txt;
  };
  T.plateClass = function (kg) {
    var map = { 25: 'p25', 20: 'p20', 15: 'p15', 10: 'p10', 5: 'p5', 2.5: 'p2', 2: 'p2', 1.25: 'p1', 1: 'p1' };
    return map[U.round(U.num(kg), 2)] || '';
  };
  T.plateSummary = function (res) {
    if (!res.perSide.length) return 'solo la barra';
    return res.perSide.map(function (p) { return T.plateLabel(p.kg, p.srcW, p.srcUnit, p.n); }).join(' + ');
  };
  T.maxLoadable = function (opts) {
    opts = opts || {};
    var spec = T.plateMode(opts.mode);
    var handle = T.plateHandleKg(spec.key, opts);
    var sideKg = U.sum(T.plateCaps(spec.key), function (it) { return it.cap * it.p.kg; });
    return {
      mode: spec.key, per: spec.per, barKg: handle, handleKg: handle, sideKg: sideKg,
      totalKg: spec.places ? handle + sideKg * 2 : handle
    };
  };

  window.App.trainer = T;
})();
