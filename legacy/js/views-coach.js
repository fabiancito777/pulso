/* ==========================================================================
   Pulso · views-coach.js — chat con el coach IA y acciones rápidas
   ========================================================================== */
(function () {
  'use strict';
  var U = App.u, D = App.data, S = App.store, C = App.coach;
  var V = {};
  var busy = false;
  V.title = 'Coach AI'; V.tab = 'coach'; V.icon = 'sparkles';
  V.sub = function () {
    if (!C.hasKey()) return 'Configura tu API key de Gemini para activarlo';
    var lvl = C.cfg().thinkingLevel;
    return C.model() + ' · pensamiento ' + (lvl === 'auto' ? (C.cfg().thinkingBudget !== '' ? 'budget ' + C.cfg().thinkingBudget : 'auto') : lvl);
  };

  function statusCard() {
    if (!C.hasKey()) {
      return '<div class="card accent">' +
        '<div class="row"><span class="ico accent">' + U.icon('key') + '</span><div class="grow"><div class="h3">Conecta tu coach</div>' +
        '<div class="tiny muted">Pega tu API key de Google AI Studio y elige modelo y nivel de pensamiento. Se guarda solo en este dispositivo.</div></div></div>' +
        '<div class="row mt" style="gap:8px;flex-wrap:wrap"><button class="btn primary" data-act="go" data-tab="ajustes" data-sub="coach">' + U.icon('gear') + 'Configurar</button>' +
        '<a class="btn ghost" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Obtener API key</a></div></div>';
    }
    return '<div class="card tight"><div class="between">' +
      '<div class="row " style="gap:8px;min-width:0"><span class="ico ok">' + U.icon('robot') + '</span>' +
      '<div style="min-width:0"><div class="h3 ellipsis">' + U.esc(C.model()) + '</div><div class="tiny muted ellipsis">' + U.esc(V.sub()) + '</div></div></div>' +
      '<button class="btn sm ghost" data-act="coach:test">' + U.icon('zap') + 'Probar</button></div></div>';
  }

  function quickActions() {
    var items = [
      { k: 'hoy', label: 'Sesión de hoy', icon: 'dumbbell' },
      { k: 'semana', label: 'Planificar semana', icon: 'calendar' },
      { k: 'analisis', label: 'Analizar progreso', icon: 'chart' },
      { k: 'volumen', label: 'Revisar volumen', icon: 'bars' },
      { k: 'pr', label: 'Romper un récord', icon: 'target' },
      { k: 'dieta', label: 'Consejo de recuperación', icon: 'rest' }
    ];
    return '<div class="hr-scroll">' + items.map(function (i) {
      return '<button class="chip" data-act="coach:quick" data-kind="' + i.k + '">' + U.icon(i.icon) + U.esc(i.label) + '</button>';
    }).join('') + '</div>';
  }

  function msgHtml(m) {
    if (m.role === 'user') return '<div class="msg me">' + U.esc(m.text).replace(/\n/g, '<br>') + '</div>';
    if (m.role === 'sys') return '<div class="msg sys">' + U.esc(m.text) + '</div>';
    return (m.thoughts ? '<details class="thinking"><summary>' + U.icon('cpu') + 'Razonamiento del modelo</summary><div class="think-body">' + U.esc(m.thoughts) + '</div></details>' : '') +
      '<div class="msg ai">' + U.md(m.text) + '</div>' +
      (m.notes ? '<div class="tiny muted" style="align-self:flex-start">' + U.esc(m.notes) + '</div>' : '');
  }

  function chatHtml() {
    var msgs = S.chat();
    if (!msgs.length) {
      return '<div class="empty">' + U.icon('sparkles') +
        '<div>Habla con tu coach</div><div class="tiny">Pregunta por técnica, ajustes de volumen, dolores o pídele un plan concreto. El coach ya conoce tu equipamiento, tus rutinas y tu historial.</div></div>';
    }
    return '<div class="chat">' + msgs.map(msgHtml).join('') +
      (busy ? '<div class="msg ai"><span class="typing"><i></i><i></i><i></i></span></div>' : '') + '</div>';
  }

  function composer() {
    return '<div class="composer"><div class="composer-inner">' +
      '<textarea id="chat-input" rows="1" placeholder="' + (C.hasKey() ? 'Escribe tu pregunta…' : 'Configura la API key para chatear') + '"' + (C.hasKey() ? '' : ' disabled') + ' aria-label="Mensaje"></textarea>' +
      '<button class="btn primary icon" data-act="coach:send" ' + (C.hasKey() ? '' : 'disabled') + ' title="Enviar">' + U.icon('chev-r') + '</button>' +
    '</div></div>';
  }

  V.render = function (root) {
    root.innerHTML = statusCard() + '<section class="mt">' + quickActions() + '</section>' +
      '<section class="mt"><div class="between mb-s"><span class="label">Conversación</span>' +
        (S.chat().length ? '<button class="btn quiet sm" data-act="coach:clear">' + U.icon('trash') + 'Limpiar</button>' : '') + '</div>' +
      chatHtml() + '</section>' + composer();
    var ta = U.$('#chat-input');
    if (ta) {
      ta.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); App.actions['coach:send'](); }
      });
    }
    if (S.chat().length) {
      requestAnimationFrame(function () { window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); });
    }
  };

  function send(text) {
    if (busy) return;
    text = String(text || '').trim();
    if (!text) return;
    S.addChat({ role: 'user', text: text, ts: U.d.nowTs() });
    busy = true;
    App.render();
    C.chat(text).then(function (res) {
      busy = false;
      S.addChat({ role: 'model', text: res.text || '(respuesta vacía)', thoughts: res.thoughts, notes: res.notes, ts: U.d.nowTs() });
      App.render();
    }).catch(function (err) {
      busy = false;
      S.addChat({ role: 'sys', text: 'Error: ' + err.message, ts: U.d.nowTs() });
      App.render();
    });
  }
  V.send = send;

  App.actions = App.actions || {};
  App.actions['coach:send'] = function () {
    var ta = U.$('#chat-input');
    var text = ta ? ta.value : '';
    if (ta) ta.value = '';
    send(text);
  };
  App.actions['coach:clear'] = function () {
    U.confirm({ title: 'Limpiar conversación', body: '<p>Se borrarán los mensajes con el coach.</p>', okLabel: 'Limpiar', kind: 'danger' }).then(function (ok) {
      if (!ok) return;
      S.clearChat(); App.render();
    });
  };
  App.actions['coach:test'] = function () {
    var t = U.toast('Probando conexión con ' + C.model() + '…', { loading: true, sticky: true });
    C.test().then(function (res) {
      t.close();
      U.toast('Conexión correcta · ' + C.model() + ' en ' + (res.ms / 1000).toFixed(1) + 's', { type: 'ok', ms: 4000 });
    }).catch(function (err) {
      t.close();
      U.toast('Error: ' + err.message, { type: 'err', ms: 8000 });
    });
  };
  App.actions['coach:quick'] = function (el) {
    var kind = el.getAttribute('data-kind');
    if (kind === 'hoy') {
      if (!C.hasKey()) { U.toast('Sin API key: se usa el generador local', { type: 'warn' }); }
      var t1 = U.toast('Preparando la sesión de hoy…', { loading: true, sticky: true });
      C.suggestWorkout({ useAI: C.hasKey() }).then(function (sug) {
        t1.close();
        App.views.hoy.suggestion(sug);
        App.router.go('hoy');
        U.toast('Sesión lista en la pestaña Hoy', { type: 'ok' });
      });
      return;
    }
    if (kind === 'semana') {
      App.router.go('calendario');
      setTimeout(function () { App.views.calendario.autoPlan(C.hasKey()); }, 80);
      return;
    }
    if (!C.hasKey()) { U.toast('Configura la API key para usar el coach IA', { type: 'warn' }); App.router.go('ajustes', 'coach'); return; }
    if (kind === 'analisis') {
      var t2 = U.toast('Analizando tus últimas 6 semanas…', { loading: true, sticky: true });
      C.analyzeProgress({ weeks: 6 }).then(function (res) {
        t2.close();
        S.addChat({ role: 'user', text: 'Analiza mi progreso de las últimas 6 semanas', ts: U.d.nowTs() });
        S.addChat({ role: 'model', text: res.text, thoughts: res.thoughts, notes: res.notes, ts: U.d.nowTs() });
        App.render();
      }).catch(function (err) { t2.close(); U.toast('Error: ' + err.message, { type: 'err', ms: 7000 }); });
      return;
    }
    var prompts = {
      volumen: 'Revisa mi volumen semanal por grupo muscular y dime qué grupos están descompensados y cómo corregirlo.',
      pr: 'Elige el ejercicio donde tengo más margen de mejora y dame un plan concreto de 4 semanas para subir mi récord.',
      dieta: '¿Qué ajustes de recuperación, sueño y alimentación me recomiendas según mi volumen actual de entrenamiento?'
    };
    send(prompts[kind] || '¿Qué me recomiendas para la próxima semana?');
  };

  App.views = App.views || {};
  App.views.coach = V;
})();
