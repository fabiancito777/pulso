/* ==========================================================================
   Pulso · charts.js — gráficos SVG sin dependencias
   Cada chart() devuelve un placeholder; mountAll() lo dibuja midiendo el ancho
   real del contenedor (texto nítido a cualquier tamaño).
   ========================================================================== */
(function () {
  'use strict';
  var U = window.App.u, D = window.App.data;
  var C = {};
  var seq = 0;

  function ph(type, spec, cls) {
    seq++;
    return '<div class="chart-wrap ' + (cls || '') + '" data-chart="' + type + '" data-spec="' + U.esc(JSON.stringify(spec)) + '"></div>';
  }
  C.bar = function (spec) { return ph('bar', spec); };
  C.line = function (spec) { return ph('line', spec); };
  C.donut = function (spec) { return ph('donut', spec); };
  C.hbars = function (spec) { return ph('hbars', spec); };
  C.heat = function (spec) { return ph('heat', spec); };

  function fmtVal(v, kind) {
    if (kind === 'vol') return U.fmt.vol(v);
    if (kind === 'time') return U.fmt.dur(v);
    if (kind === 'n') return U.fmt.n(v, 0);
    if (kind === 'w') return U.fmt.n(v, 1);
    return U.fmt.n(v, 1);
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    var exp = Math.pow(10, Math.floor(Math.log10(v))), n = v / exp;
    var step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return step * exp;
  }
  function svgOpen(w, h) {
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" role="img">';
  }
  function emptyBox(msg, h) {
    return '<div class="empty" style="padding:18px"><div class="tiny">' + U.esc(msg || 'Sin datos todavía') + '</div></div>';
  }

  /* ---------- barras verticales ---------- */
  function renderBar(el, spec) {
    var w = Math.max(240, el.clientWidth || 320), h = spec.height || 150;
    var data = (spec.data || []).filter(function (d) { return d !== null; });
    if (!data.length || !U.sum(data, function (d) { return U.num(d.value); })) { el.innerHTML = emptyBox(spec.empty, h); return; }
    var padL = 34, padR = 6, padT = 14, padB = 20;
    var max = niceMax(U.max(data, function (d) { return U.num(d.value); }));
    var iw = w - padL - padR, ih = h - padT - padB;
    var slot = iw / data.length, bw = Math.min(34, Math.max(6, slot * (spec.gap === false ? 0.95 : 0.62)));
    var out = svgOpen(w, h);
    for (var g = 0; g <= 2; g++) {
      var y = padT + (ih / 2) * g;
      out += '<line class="ct-grid" x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (w - padR) + '" y2="' + y.toFixed(1) + '"/>';
      out += '<text class="ct-axis" x="' + (padL - 6) + '" y="' + (y + 3.2).toFixed(1) + '" text-anchor="end">' + fmtVal(max - (max / 2) * g, spec.format) + '</text>';
    }
    data.forEach(function (d, i) {
      var v = U.num(d.value), bh = max ? (v / max) * ih : 0;
      var x = padL + slot * i + (slot - bw) / 2, y = padT + ih - bh;
      var col = d.color || spec.color || 'var(--accent)';
      out += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, bh).toFixed(1) + '" rx="3" fill="' + col + '" opacity="' + (d.dim ? 0.35 : 1) + '"></rect>';
      if (spec.target) {
        var ty = padT + ih - (spec.target / max) * ih;
        if (ty > padT) out += '<line x1="' + padL + '" y1="' + ty.toFixed(1) + '" x2="' + (w - padR) + '" y2="' + ty.toFixed(1) + '" stroke="var(--muted-2)" stroke-dasharray="3 4" stroke-width="1.2"/>';
      }
      if (spec.showValues && slot > 26) {
        out += '<text class="ct-axis" x="' + (padL + slot * i + slot / 2).toFixed(1) + '" y="' + (y - 4).toFixed(1) + '" text-anchor="middle">' + fmtVal(v, spec.format) + '</text>';
      }
    });
    var step = data.length > 8 ? Math.ceil(data.length / 6) : 1;
    data.forEach(function (d, i) {
      if (i % step !== 0 && i !== data.length - 1) return;
      out += '<text class="ct-axis" x="' + (padL + slot * i + slot / 2).toFixed(1) + '" y="' + (h - 6) + '" text-anchor="middle">' + U.esc(d.label) + '</text>';
    });
    out += '</svg>';
    el.innerHTML = out;
  }

  /* ---------- línea / área ---------- */
  function renderLine(el, spec) {
    var w = Math.max(240, el.clientWidth || 320), h = spec.height || 170;
    var series = (spec.series || []).map(function (s) { return { name: s.name, color: s.color || 'var(--accent)', pts: (s.points || []).filter(function (p) { return p && isFinite(U.num(p.value)); }) }; })
      .filter(function (s) { return s.pts.length; });
    if (!series.length) { el.innerHTML = emptyBox(spec.empty, h); return; }
    var all = series.reduce(function (a, s) { return a.concat(s.pts); }, []);
    var padL = 36, padR = 10, padT = 16, padB = 22;
    var iw = w - padL - padR, ih = h - padT - padB;
    var vals = all.map(function (p) { return U.num(p.value); });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (spec.min !== undefined) lo = Math.min(lo, spec.min);
    if (spec.zero) lo = 0;
    var span = hi - lo || Math.max(1, hi * 0.1);
    var maxN = Math.max.apply(null, series.map(function (s) { return s.pts.length; }));
    var out = svgOpen(w, h);
    function X(i) { return padL + (maxN === 1 ? iw / 2 : (i / (maxN - 1)) * iw); }
    function Y(v) { return padT + ih - ((v - lo) / span) * ih; }
    for (var g = 0; g <= 2; g++) {
      var val = lo + (span / 2) * (2 - g), y = padT + (ih / 2) * g;
      out += '<line class="ct-grid" x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (w - padR) + '" y2="' + y.toFixed(1) + '"/>';
      out += '<text class="ct-axis" x="' + (padL - 6) + '" y="' + (y + 3.2).toFixed(1) + '" text-anchor="end">' + fmtVal(val, spec.format) + '</text>';
    }
    series.forEach(function (s) {
      var dPath = s.pts.map(function (p, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(U.num(p.value)).toFixed(1); }).join(' ');
      if (spec.area !== false && series.length === 1) {
        out += '<path d="' + dPath + ' L' + X(s.pts.length - 1).toFixed(1) + ' ' + (padT + ih).toFixed(1) + ' L' + X(0).toFixed(1) + ' ' + (padT + ih).toFixed(1) + ' Z" fill="' + s.color + '" opacity=".12" stroke="none"></path>';
      }
      out += '<path class="ct-line" d="' + dPath + '" stroke="' + s.color + '"></path>';
      s.pts.forEach(function (p, i) {
        var isLast = i === s.pts.length - 1;
        if (series.length > 1 && !isLast && s.pts.length > 10) return;
        out += '<circle class="ct-dot" cx="' + X(i).toFixed(1) + '" cy="' + Y(U.num(p.value)).toFixed(1) + '" r="' + (isLast ? 3.4 : 2.4) + '" fill="var(--surface)" stroke="' + s.color + '"></circle>';
        if (isLast && spec.showLast !== false) {
          out += '<text class="ct-axis" x="' + (X(i) - 2).toFixed(1) + '" y="' + (Y(U.num(p.value)) - 8).toFixed(1) + '" text-anchor="end">' + fmtVal(U.num(p.value), spec.format) + '</text>';
        }
      });
    });
    var base = series[0].pts;
    var idx = [0, Math.floor((base.length - 1) / 2), base.length - 1].filter(function (v, i, a) { return a.indexOf(v) === i; });
    idx.forEach(function (i) {
      var p = base[i];
      if (!p) return;
      out += '<text class="ct-axis" x="' + X(i).toFixed(1) + '" y="' + (h - 6) + '" text-anchor="' + (i === 0 ? 'start' : i === base.length - 1 ? 'end' : 'middle') + '">' + U.esc(p.label || '') + '</text>';
    });
    out += '</svg>';
    el.innerHTML = out;
  }

  /* ---------- donut ---------- */
  function renderDonut(el, spec) {
    var w = Math.max(240, el.clientWidth || 320), size = Math.min(spec.size || 190, w);
    var data = (spec.data || []).filter(function (d) { return U.num(d.value) > 0; });
    var total = U.sum(data, function (d) { return U.num(d.value); });
    if (!total) { el.innerHTML = emptyBox(spec.empty, size); return; }
    var sw = spec.thickness || 17, r = size / 2 - sw / 2, circ = 2 * Math.PI * r;
    var out = '<div class="row" style="justify-content:center;gap:16px;flex-wrap:wrap">';
    out += '<svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '">';
    out += '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="var(--surface-3)" stroke-width="' + sw + '"></circle>';
    var off = 0;
    data.forEach(function (d) {
      var frac = U.num(d.value) / total, len = circ * frac;
      out += '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + d.color + '" stroke-width="' + sw + '"' +
        ' stroke-dasharray="' + (len - 2).toFixed(1) + ' ' + (circ - len + 2).toFixed(1) + '" stroke-dashoffset="' + (-off).toFixed(1) + '"' +
        ' transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')" stroke-linecap="butt"></circle>';
      off += len;
    });
    if (spec.center) {
      out += '<text x="' + size / 2 + '" y="' + (size / 2 - 2) + '" text-anchor="middle" fill="var(--text)" style="font-family:var(--mono);font-size:19px;font-weight:650">' + U.esc(spec.center.value) + '</text>';
      out += '<text x="' + size / 2 + '" y="' + (size / 2 + 14) + '" text-anchor="middle" fill="var(--muted)" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.4px">' + U.esc(spec.center.label || '') + '</text>';
    }
    out += '</svg>';
    out += '<div class="col" style="gap:5px;min-width:130px">' + data.map(function (d) {
      return '<div class="row tiny" style="gap:7px"><i style="width:9px;height:9px;border-radius:3px;background:' + d.color + ';display:inline-block"></i>' +
        '<span class="grow ellipsis">' + U.esc(d.label) + '</span><span class="num muted">' + Math.round((U.num(d.value) / total) * 100) + '%</span></div>';
    }).join('') + '</div></div>';
    el.innerHTML = out;
  }

  /* ---------- barras horizontales ---------- */
  function renderHBars(el, spec) {
    var data = (spec.data || []).filter(function (d) { return U.num(d.value) > 0; });
    if (!data.length) { el.innerHTML = emptyBox(spec.empty, 60); return; }
    var max = niceMax(U.max(data, function (d) { return U.num(d.value); }));
    el.innerHTML = '<div class="col" style="gap:9px">' + data.map(function (d) {
      return '<div>' +
        '<div class="row between tiny" style="margin-bottom:3px"><span class="ellipsis" style="font-weight:600">' + U.esc(d.label) + '</span>' +
        '<span class="num muted">' + fmtVal(U.num(d.value), spec.format || 'vol') + (spec.unit ? ' ' + U.esc(spec.unit) : '') + '</span></div>' +
        '<div class="bar"><i style="width:' + ((U.num(d.value) / max) * 100).toFixed(1) + '%;background:' + (d.color || 'var(--accent)') + '"></i></div>' +
        '</div>';
    }).join('') + '</div>';
  }

  /* ---------- heatmap de consistencia ---------- */
  function renderHeat(el, spec) {
    var weeks = spec.weeks || 16;
    var byDate = {};
    (spec.cells || []).forEach(function (c) { byDate[c.iso] = U.num(c.value); });
    var start = U.d.startOfWeek(U.d.addDays(U.d.today(), -7 * (weeks - 1)));
    var maxV = Math.max(1, U.max(spec.cells || [], function (c) { return U.num(c.value); }));
    var cell = 13, gap = 3;
    var w = weeks * (cell + gap) + 22, h = 7 * (cell + gap) + 6;
    var out = svgOpen(w, h);
    for (var wk = 0; wk < weeks; wk++) {
      for (var dy = 0; dy < 7; dy++) {
        var iso = U.d.addDays(start, wk * 7 + dy);
        if (iso > U.d.today()) continue;
        var v = byDate[iso] || 0;
        var op = v === 0 ? 0 : Math.min(1, 0.25 + 0.75 * (v / maxV));
        var col = v === 0 ? 'var(--surface-2)' : (spec.color || 'var(--accent)');
        out += '<rect x="' + (22 + wk * (cell + gap)) + '" y="' + (dy * (cell + gap)) + '" width="' + cell + '" height="' + cell + '" rx="3" fill="' + col + '" opacity="' + (v === 0 ? 1 : op) + '"></rect>';
        if (iso === U.d.today()) out += '<rect x="' + (21 + wk * (cell + gap)) + '" y="' + (dy * (cell + gap) - 1) + '" width="' + (cell + 2) + '" height="' + (cell + 2) + '" rx="3" fill="none" stroke="var(--text)" stroke-width="1.4"></rect>';
      }
    }
    ['L', 'M', 'X', 'J', 'V', 'S', 'D'].forEach(function (lb, i) {
      out += '<text class="ct-axis" x="12" y="' + (i * (cell + gap) + cell / 2 + 1) + '" text-anchor="middle" dominant-baseline="middle">' + lb + '</text>';
    });
    out += '</svg>';
    el.innerHTML = out + '<div class="tiny muted mt-s">' + weeks + ' semanas · ' + U.esc(spec.caption || 'más opaco = más sesiones ese día') + '</div>';
  }

  C.renderers = { bar: renderBar, line: renderLine, donut: renderDonut, hbars: renderHBars, heat: renderHeat };
  C.mountAll = function (root) {
    U.$$('[data-chart]', root || document).forEach(function (el) {
      if (el.__mounted && el.clientWidth === el.__w) return;
      var type = el.getAttribute('data-chart');
      var spec = {};
      try { spec = JSON.parse(el.getAttribute('data-spec') || '{}'); } catch (e) { spec = {}; }
      var fn = C.renderers[type];
      if (fn) {
        try { fn(el, spec); } catch (err) { el.innerHTML = '<div class="tiny danger">Error al dibujar: ' + U.esc(err.message) + '</div>'; }
        el.__mounted = true;
        el.__w = el.clientWidth;
      }
    });
  };
  C.spark = function (points, color) {
    var vals = points.map(function (p) { return U.num(p.value); });
    if (vals.length < 2) return '';
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), span = hi - lo || 1;
    var w = 92, h = 26;
    var d = vals.map(function (v, i) { return (i ? 'L' : 'M') + ((i / (vals.length - 1)) * w).toFixed(1) + ' ' + (h - ((v - lo) / span) * (h - 4) - 2).toFixed(1); }).join(' ');
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '"><path d="' + d + '" fill="none" stroke="' + (color || 'var(--accent)') + '" stroke-width="1.8" stroke-linejoin="round"></path></svg>';
  };

  window.App.charts = C;
})();
