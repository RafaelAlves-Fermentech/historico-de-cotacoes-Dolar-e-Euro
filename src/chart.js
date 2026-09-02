/* =============================================================
   chart.js — Gráfico de linhas em SVG, sem bibliotecas externas.
   Camada: visualização. Recebe dados já normalizados e calculados.

   Eixo X: ordinal por dia de boletim (§7). Dias sem cotação não ocupam
   espaço no eixo e nenhum valor é inventado para preenchê-los.

   Escala (§18): dois modos.
     'brl'   — as duas moedas no mesmo eixo em R$. Preciso e direto.
     'index' — base 100 na primeira cotação do período. Torna a comparação
               de tendência legível quando os níveis absolutos diferem,
               sem recorrer a um eixo secundário.
   ============================================================= */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var PAD = { top: 18, right: 18, bottom: 34, left: 62 };
  var MAX_RENDER_POINTS = 900;

  function el(name, attrs) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    return n;
  }

  /** Escala "bonita" para os rótulos do eixo Y. */
  function niceTicks(lo, hi, count) {
    if (lo === hi) { lo -= 0.5; hi += 0.5; }
    var raw = (hi - lo) / count;
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    var start = Math.ceil(lo / step) * step;
    var ticks = [];
    for (var v = start; v <= hi + step * 0.001; v += step) ticks.push(+v.toFixed(10));
    return ticks;
  }

  /**
   * Reduz pontos para desenho preservando a envoltória (mín. e máx. de cada
   * bucket). O tooltip continua usando a série em resolução total.
   */
  function downsample(pts, limit) {
    if (pts.length <= limit) return pts;
    var buckets = Math.floor(limit / 2);
    var size = pts.length / buckets;
    var out = [pts[0]];
    for (var b = 0; b < buckets; b++) {
      var s = Math.floor(b * size), e = Math.min(pts.length, Math.floor((b + 1) * size));
      if (e <= s) continue;
      var lo = pts[s], hi = pts[s];
      for (var i = s + 1; i < e; i++) {
        if (pts[i].v < lo.v) lo = pts[i];
        if (pts[i].v > hi.v) hi = pts[i];
      }
      if (lo.i <= hi.i) { out.push(lo); if (hi !== lo) out.push(hi); }
      else { out.push(hi); out.push(lo); }
    }
    out.push(pts[pts.length - 1]);
    var seen = Object.create(null), dedup = [];
    out.forEach(function (p) { if (!seen[p.i]) { seen[p.i] = 1; dedup.push(p); } });
    return dedup.sort(function (a, b) { return a.i - b.i; });
  }

  function create(container, tooltipEl) {
    var state = null;
    var geo = null;

    function render(next) {
      if (next) state = next;
      if (!state) return;
      container.innerHTML = '';
      hideTip();

      var dates = state.dates;
      var series = state.series;
      if (!dates.length || !series.length) { geo = null; return; }

      var W = Math.max(320, container.clientWidth);
      var H = Math.max(260, container.clientHeight);
      var iw = W - PAD.left - PAD.right;
      var ih = H - PAD.top - PAD.bottom;
      var indexed = state.mode === 'index';

      /* Pontos por série, no espaço de valores do modo atual. */
      var prepared = series.map(function (s) {
        var base = null;
        if (indexed) {
          for (var d = 0; d < dates.length; d++) {
            var b = s.map[dates[d]];
            if (b !== undefined) { base = b; break; }
          }
        }
        var pts = [];
        for (var i = 0; i < dates.length; i++) {
          var raw = s.map[dates[i]];
          if (raw === undefined) continue;
          pts.push({ i: i, date: dates[i], raw: raw, v: indexed ? (raw / base) * 100 : raw });
        }
        return { code: s.code, name: s.name, color: s.color, pts: pts, base: base };
      }).filter(function (s) { return s.pts.length; });

      if (!prepared.length) { geo = null; return; }

      var lo = Infinity, hi = -Infinity;
      prepared.forEach(function (s) {
        s.pts.forEach(function (p) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; });
      });
      var span = (hi - lo) || Math.abs(hi) * 0.02 || 1;
      lo -= span * 0.10; hi += span * 0.10;

      var n = dates.length;
      function X(i) { return PAD.left + (n === 1 ? iw / 2 : (i / (n - 1)) * iw); }
      function Y(v) { return PAD.top + ih - ((v - lo) / (hi - lo)) * ih; }

      var svg = el('svg', {
        width: W, height: H, 'class': 'chart-svg',
        role: 'img', 'aria-label': state.ariaLabel || 'Gráfico de evolução das cotações'
      });

      /* Grade e eixo Y. */
      var ticks = niceTicks(lo, hi, 5);
      var gGrid = el('g', { 'class': 'chart-grid' });
      ticks.forEach(function (t) {
        var y = Y(t);
        gGrid.appendChild(el('line', { x1: PAD.left, x2: W - PAD.right, y1: y, y2: y }));
        var lbl = el('text', { x: PAD.left - 10, y: y + 4, 'class': 'chart-axis chart-axis-y' });
        lbl.textContent = indexed ? Fmt.num2(t) : Fmt.rate(t);
        gGrid.appendChild(lbl);
      });
      svg.appendChild(gGrid);

      /* Eixo X. */
      var longRange = Dates.daysBetween(dates[0], dates[n - 1]) > 200;
      var maxLabels = Math.max(2, Math.min(8, Math.floor(iw / 78)));
      var stepX = Math.max(1, Math.floor((n - 1) / (maxLabels - 1)) || 1);
      var gX = el('g');
      var lastX = -Infinity;
      var MIN_GAP = longRange ? 52 : 46; // espaço mínimo entre rótulos, em px
      for (var xi = 0; xi < n; xi += stepX) {
        var tx = el('text', { x: X(xi), y: H - PAD.bottom + 20, 'class': 'chart-axis chart-axis-x' });
        tx.textContent = Dates.axisLabel(dates[xi], longRange);
        gX.appendChild(tx);
        lastX = X(xi);
      }
      // A última data só entra se não colidir com o rótulo anterior.
      if (n > 1 && (n - 1) % stepX !== 0 && X(n - 1) - lastX >= MIN_GAP) {
        var lastLbl = el('text', { x: X(n - 1), y: H - PAD.bottom + 20, 'class': 'chart-axis chart-axis-x' });
        lastLbl.textContent = Dates.axisLabel(dates[n - 1], longRange);
        gX.appendChild(lastLbl);
      }
      svg.appendChild(gX);

      /* Linhas. */
      prepared.forEach(function (s) {
        var draw = downsample(s.pts, MAX_RENDER_POINTS);
        var d = draw.map(function (p, k) {
          return (k ? 'L' : 'M') + X(p.i).toFixed(2) + ' ' + Y(p.v).toFixed(2);
        }).join(' ');
        svg.appendChild(el('path', {
          d: d, fill: 'none', stroke: s.color, 'stroke-width': 2,
          'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'class': 'chart-line'
        }));

        if (draw.length === 1) {
          svg.appendChild(el('circle', { cx: X(draw[0].i), cy: Y(draw[0].v), r: 3.5, fill: s.color }));
        }

        /* Máxima e mínima, discretas. */
        if (s.pts.length >= 3) {
          var mn = s.pts[0], mx = s.pts[0];
          s.pts.forEach(function (p) { if (p.v < mn.v) mn = p; if (p.v > mx.v) mx = p; });
          [mx, mn].forEach(function (p) {
            svg.appendChild(el('circle', {
              cx: X(p.i), cy: Y(p.v), r: 3.5, fill: '#fff',
              stroke: s.color, 'stroke-width': 1.75, 'class': 'chart-extreme'
            }));
          });
        }
      });

      /* Camada de interação. */
      var cursor = el('line', {
        'class': 'chart-cursor', y1: PAD.top, y2: PAD.top + ih,
        x1: -10, x2: -10, 'stroke-dasharray': '3 3'
      });
      svg.appendChild(cursor);
      var dots = el('g', { 'class': 'chart-dots' });
      svg.appendChild(dots);

      container.appendChild(svg);

      geo = {
        svg: svg, cursor: cursor, dots: dots, prepared: prepared, dates: dates,
        X: X, Y: Y, W: W, H: H, indexed: indexed, n: n
      };
      if (state.focusIndex !== null && state.focusIndex !== undefined) showAt(state.focusIndex, true);
    }

    function hideTip() {
      if (tooltipEl) tooltipEl.hidden = true;
      if (geo) {
        geo.cursor.setAttribute('x1', -10);
        geo.cursor.setAttribute('x2', -10);
        geo.dots.innerHTML = '';
      }
    }

    function nearestIndex(clientX) {
      if (!geo) return null;
      var box = geo.svg.getBoundingClientRect();
      var x = clientX - box.left;
      var iw = geo.W - PAD.left - PAD.right;
      var t = (x - PAD.left) / (iw || 1);
      var i = Math.round(t * (geo.n - 1));
      return Math.max(0, Math.min(geo.n - 1, i));
    }

    function showAt(i, keepFocus) {
      if (!geo || !tooltipEl) return;
      var date = geo.dates[i];
      var px = geo.X(i);
      geo.cursor.setAttribute('x1', px);
      geo.cursor.setAttribute('x2', px);
      geo.dots.innerHTML = '';

      var lines = [];
      geo.prepared.forEach(function (s) {
        var hit = null;
        for (var k = 0; k < s.pts.length; k++) { if (s.pts[k].i === i) { hit = s.pts[k]; break; } }
        if (!hit) return;
        geo.dots.appendChild(el('circle', {
          cx: px, cy: geo.Y(hit.v), r: 4.5, fill: '#fff', stroke: s.color, 'stroke-width': 2.5
        }));
        lines.push({ name: s.name, color: s.color, raw: hit.raw, v: hit.v });
      });

      if (!lines.length) { hideTip(); return; }

      var html = '<div class="tip-date">' + Dates.br(date) + '</div>';
      lines.forEach(function (l) {
        html += '<div class="tip-row">' +
          '<span class="tip-swatch" style="background:' + l.color + '"></span>' +
          '<span class="tip-name">' + l.name + '</span>' +
          '<span class="tip-value">' + Fmt.brl(l.raw) + '</span>' +
          (geo.indexed ? '<span class="tip-index">' + Fmt.num2(l.v) + '</span>' : '') +
          '</div>';
      });
      tooltipEl.innerHTML = html;
      tooltipEl.hidden = false;

      var tw = tooltipEl.offsetWidth;
      var left = px + 16;
      if (left + tw > geo.W - 6) left = px - tw - 16;
      if (left < 6) left = 6;
      tooltipEl.style.left = left + 'px';
      tooltipEl.style.top = PAD.top + 'px';
      if (state && keepFocus) state.focusIndex = i;
    }

    container.addEventListener('mousemove', function (e) {
      var i = nearestIndex(e.clientX);
      if (i !== null) showAt(i);
    });
    container.addEventListener('mouseleave', hideTip);
    container.addEventListener('touchstart', function (e) {
      if (!e.touches.length) return;
      var i = nearestIndex(e.touches[0].clientX);
      if (i !== null) showAt(i);
    }, { passive: true });
    container.addEventListener('touchmove', function (e) {
      if (!e.touches.length) return;
      var i = nearestIndex(e.touches[0].clientX);
      if (i !== null) showAt(i);
    }, { passive: true });

    container.addEventListener('keydown', function (e) {
      if (!geo) return;
      var cur = (state && state.focusIndex != null) ? state.focusIndex : geo.n - 1;
      if (e.key === 'ArrowLeft') { showAt(Math.max(0, cur - 1), true); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { showAt(Math.min(geo.n - 1, cur + 1), true); e.preventDefault(); }
      else if (e.key === 'Home') { showAt(0, true); e.preventDefault(); }
      else if (e.key === 'End') { showAt(geo.n - 1, true); e.preventDefault(); }
      else if (e.key === 'Escape') { if (state) state.focusIndex = null; hideTip(); }
    });
    container.addEventListener('blur', function () { if (state) state.focusIndex = null; hideTip(); });

    var raf = null;
    if (global.ResizeObserver) {
      new ResizeObserver(function () {
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(function () { render(); });
      }).observe(container);
    } else {
      global.addEventListener('resize', function () { render(); });
    }

    return {
      render: render,
      clear: function () { container.innerHTML = ''; geo = null; state = null; if (tooltipEl) tooltipEl.hidden = true; }
    };
  }

  global.Chart = { create: create };
})(window);
