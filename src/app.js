/* =============================================================
   app.js — Estado do dashboard e ligação com os componentes visuais.
   Esta camada não conhece HTTP: pede séries ao BcbService e desenha.
   ============================================================= */
(function (global) {
  'use strict';

  var CFG = global.APP_CONFIG;
  var $ = function (id) { return document.getElementById(id); };

  /* ------------------------------------------------------------- estado -- */
  var state = {
    start: null,
    end: null,
    period: '30d',
    selection: 'BOTH',
    scale: 'brl',
    sortDir: 'desc',
    pageSize: 25,
    page: 1,
    series: { USD: [], EUR: [] },
    summaries: {},
    merged: [],
    dates: [],
    loading: false,
    error: null,
    stale: false,
    truncated: null,
    lastUpdate: null
  };

  var chart;
  var reqToken = 0;

  function codes() {
    return state.selection === 'BOTH' ? CFG.ORDER.slice() : [state.selection];
  }

  /* ------------------------------------------------- períodos de atalho -- */
  function rangeFor(period) {
    var t = Dates.today();
    switch (period) {
      case '7d':  return [Dates.addDays(t, -7), t];
      case '30d': return [Dates.addDays(t, -30), t];
      case '90d': return [Dates.addDays(t, -90), t];
      case '6m':  return [Dates.addMonths(t, -6), t];
      case '12m': return [Dates.addMonths(t, -12), t];
      case 'ytd': return [t.slice(0, 4) + '-01-01', t];
      default:    return [state.start, state.end];
    }
  }

  /* --------------------------------------------------------- carregamento */
  function load(opts) {
    opts = opts || {};
    var token = ++reqToken;
    var wanted = codes();

    state.loading = true;
    state.error = null;
    state.stale = false;
    renderAll();

    // Cada moeda falha por conta própria: uma indisponibilidade no Euro não
    // pode descartar um Dólar que veio corretamente.
    var jobs = CFG.ORDER.map(function (code) {
      if (wanted.indexOf(code) === -1) return Promise.resolve({ code: code, res: null });
      return BcbService.getSeries(code, state.start, state.end, { force: opts.force })
        .then(function (res) { return { code: code, res: res }; })
        .catch(function (err) { return { code: code, res: null, err: err }; });
    });

    return Promise.all(jobs).then(function (results) {
      if (token !== reqToken) return;

      // O estado anterior é descartado sempre: dados de outro período nunca
      // podem permanecer na tela sob os filtros atuais.
      state.series = { USD: [], EUR: [] };
      state.stale = false;
      state.truncated = null;
      state.error = null;

      results.forEach(function (r) {
        if (r.err) {
          state.error = r.err.message || 'Falha na consulta';
          return;
        }
        if (!r.res) return;
        state.series[r.code] = r.res.rows;
        if (r.res.stale) state.stale = true;
        if (r.res.truncated) state.truncated = r.code;
      });

      state.loading = false;
      if (!state.error) state.lastUpdate = new Date();
      state.page = 1;
      recompute();
      renderAll();
    });
  }

  function recompute() {
    var list = codes();
    state.summaries = {};
    list.forEach(function (c) { state.summaries[c] = Analytics.summarize(state.series[c]); });
    state.merged = Analytics.mergeByDate(state.series, list);
    state.dates = state.merged.map(function (r) { return r.date; });
  }

  /* ------------------------------------------------------------ avisos --- */
  function renderBanner() {
    var b = $('banner');
    var html = '';
    var cls = 'banner';

    if (state.loading) {
      cls += ' is-loading';
      html = '<span class="banner-dot" aria-hidden="true"></span>' +
             '<span>Atualizando cotações do Banco Central&hellip;</span>';
    } else if (state.error && !hasAnyData()) {
      cls += ' is-error';
      html = '<span><strong>Não foi possível atualizar as cotações.</strong> ' +
             'Tente novamente em alguns instantes. ' +
             '<span style="color:var(--gray)">(' + escapeHtml(state.error) + ')</span></span>';
    } else if (state.error && hasAnyData()) {
      // Uma moeda respondeu e a outra não.
      cls += ' is-error';
      html = '<span><strong>Não foi possível carregar todas as moedas.</strong> ' +
             'Exibindo apenas o que o Banco Central retornou.</span>';
    } else if (state.stale) {
      cls += ' is-warn';
      html = '<span><strong>Exibindo dados armazenados anteriormente.</strong> ' +
             'O Banco Central não respondeu a parte da consulta.</span>';
    } else if (state.truncated) {
      var m = CFG.CURRENCIES[state.truncated];
      cls += ' is-warn';
      html = '<span>A série do <strong>' + m.name + '</strong> no Banco Central começa em ' +
             Dates.br(m.firstAvailable) + '. O período foi ajustado a partir dessa data.</span>';
    }

    b.className = cls;
    b.innerHTML = html;
    b.hidden = !html;
  }

  function hasAnyData() {
    return codes().some(function (c) { return (state.series[c] || []).length > 0; });
  }

  /* ------------------------------------------------------------- cards --- */
  function skeletonCard() {
    return '<article class="card">' +
      '<div class="skeleton sk-line" style="width:38%"></div>' +
      '<div class="skeleton sk-rate"></div>' +
      '<div class="skeleton sk-line" style="width:56%;margin:0"></div>' +
      '</article>';
  }

  function renderCards() {
    var host = $('cards');
    var list = codes();

    if (state.loading) {
      var sk = '';
      for (var i = 0; i < list.length * 2; i++) sk += skeletonCard();
      host.innerHTML = sk;
      return;
    }

    var html = '';

    // Cotação atual: última cotação disponível DENTRO do período (§13).
    list.forEach(function (code) {
      var m = CFG.CURRENCIES[code];
      var s = state.summaries[code];
      var parts = s ? Fmt.splitRate(s.last.sellRate) : { head: '—', tail: '' };
      html += '<article class="card card-primary" style="--c:' + m.color + '">' +
        '<span class="stamp">Venda</span>' +
        '<div class="card-head">' +
          '<span class="swatch" aria-hidden="true"></span>' +
          '<span class="card-name">' + m.name + '</span>' +
          '<span class="card-code">' + m.code + '</span>' +
        '</div>' +
        '<p class="rate">' +
          (s ? '<span class="rate-cur">R$</span>' : '') +
          '<span class="rate-head">' + parts.head + '</span>' +
          '<span class="rate-tail">' + parts.tail + '</span>' +
        '</p>' +
        '<p class="card-foot">' +
          (s ? 'Última cotação: <b>' + Dates.br(s.last.date) + '</b>'
             : 'Sem cotação no período') +
        '</p>' +
      '</article>';
    });

    // Variação entre a primeira e a última cotação disponíveis (§14).
    list.forEach(function (code) {
      var m = CFG.CURRENCIES[code];
      var s = state.summaries[code];
      html += '<article class="card card-var" style="--c:' + m.color + '">' +
        '<div class="card-head">' +
          '<span class="swatch" aria-hidden="true"></span>' +
          '<span class="card-name">' + m.name + ' no período</span>' +
        '</div>' +
        '<p class="delta">' +
          (s
            ? '<span class="delta-glyph" aria-hidden="true">' + Analytics.glyph(s.direction) + '</span>' +
              '<span class="delta-value">' + Fmt.pct(s.changePct) + '</span>' +
              '<span class="delta-word">' + Analytics.word(s.direction) + '</span>'
            : '<span class="delta-value">—</span>') +
        '</p>' +
        '<p class="card-foot">' +
          (s
            ? 'De <b>' + Fmt.rate(s.first.sellRate) + '</b> (' + Dates.br(s.first.date) + ') ' +
              'a <b>' + Fmt.rate(s.last.sellRate) + '</b> (' + Dates.br(s.last.date) + ')'
            : 'Sem cotação no período') +
        '</p>' +
      '</article>';
    });

    host.innerHTML = html;
  }

  /* ------------------------------------------------------------ gráfico -- */
  function renderLegend() {
    $('legend').innerHTML = codes().map(function (code) {
      var m = CFG.CURRENCIES[code];
      return '<span class="legend-item"><span class="swatch" style="--c:' + m.color +
             ';background:' + m.color + '"></span>' + m.name + '</span>';
    }).join('');
  }

  function chartAriaLabel() {
    var list = codes();
    var parts = list.map(function (c) {
      var s = state.summaries[c];
      if (!s) return CFG.CURRENCIES[c].name + ': sem cotação no período';
      return CFG.CURRENCIES[c].name + ': de ' + Fmt.brl(s.first.sellRate) + ' em ' +
             Dates.br(s.first.date) + ' a ' + Fmt.brl(s.last.sellRate) + ' em ' +
             Dates.br(s.last.date) + ', ' + Analytics.word(s.direction) + ' de ' +
             Fmt.pct(s.changePct) + '. Máxima ' + Fmt.brl(s.max.sellRate) +
             ', mínima ' + Fmt.brl(s.min.sellRate);
    });
    return 'Evolução das cotações de venda. ' + parts.join('. ') + '.';
  }

  function renderChart() {
    var empty = $('chartEmpty');
    var host = $('chart');

    if (state.loading) {
      empty.hidden = true;
      host.style.display = '';
      host.innerHTML = '<div class="skeleton" style="height:100%;border-radius:4px"></div>';
      return;
    }
    if (!state.dates.length) {
      chart.clear();
      empty.hidden = false;
      empty.innerHTML = '<p class="empty-title">Nenhuma cotação encontrada para o período selecionado.</p>' +
        '<p class="empty-help">Selecione outro período. O Banco Central publica boletim apenas em dias úteis.</p>';
      host.style.display = 'none';
      return;
    }
    empty.hidden = true;
    host.style.display = '';

    var series = codes().map(function (code) {
      var m = CFG.CURRENCIES[code];
      var map = Object.create(null);
      (state.series[code] || []).forEach(function (r) { map[r.date] = r.sellRate; });
      return { code: code, name: m.name, color: m.color, map: map };
    });

    chart.render({
      dates: state.dates,
      series: series,
      mode: state.scale,
      focusIndex: null,
      ariaLabel: chartAriaLabel()
    });

    $('scaleNote').textContent = state.scale === 'index'
      ? 'Cada moeda parte de 100 na sua primeira cotação do período, o que permite comparar a tendência das duas mesmo com níveis diferentes. O tooltip continua mostrando o valor em reais.'
      : 'Ambas as moedas no mesmo eixo, em reais.';
  }

  /* -------------------------------------------------- máxima e mínima ---- */
  function renderExtremes() {
    var host = $('extremes');
    if (state.loading) {
      host.innerHTML = codes().map(function () {
        return '<div class="ext"><div class="skeleton sk-line" style="width:30%"></div>' +
               '<div class="skeleton sk-line" style="width:70%;height:22px;margin-top:14px"></div></div>';
      }).join('');
      return;
    }
    host.innerHTML = codes().map(function (code) {
      var m = CFG.CURRENCIES[code];
      var s = state.summaries[code];
      return '<div class="ext" style="--c:' + m.color + '">' +
        '<div class="ext-head"><span class="swatch" aria-hidden="true"></span>' +
        '<span class="ext-name">' + m.name + '</span></div>' +
        '<div class="ext-grid">' +
          '<div><p class="ext-label">Máxima</p>' +
            '<p class="ext-value">' + (s ? Fmt.brl(s.max.sellRate) : '—') + '</p>' +
            '<p class="ext-date">' + (s ? Dates.br(s.max.date) : '') + '</p></div>' +
          '<div><p class="ext-label">Mínima</p>' +
            '<p class="ext-value">' + (s ? Fmt.brl(s.min.sellRate) : '—') + '</p>' +
            '<p class="ext-date">' + (s ? Dates.br(s.min.date) : '') + '</p></div>' +
        '</div></div>';
    }).join('');
  }

  /* ------------------------------------------------------------- tabela -- */
  function renderTable() {
    var list = codes();
    var head = $('ratesHead');
    var body = $('ratesBody');
    var empty = $('tableEmpty');
    var pager = $('pager');

    head.innerHTML = '<tr>' +
      '<th scope="col" aria-sort="' + (state.sortDir === 'asc' ? 'ascending' : 'descending') + '">' +
        '<button type="button" id="sortDate">Data ' +
        '<span aria-hidden="true">' + (state.sortDir === 'asc' ? '↑' : '↓') + '</span>' +
        '<span class="sr-only">alternar ordenação</span></button></th>' +
      list.map(function (c) {
        return '<th scope="col">' + CFG.CURRENCIES[c].name + ' (R$)</th>';
      }).join('') + '</tr>';
    $('sortDate').addEventListener('click', function () {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      state.page = 1;
      renderTable();
    });

    if (state.loading) {
      body.innerHTML = new Array(9).join('|').split('|').map(function () {
        return '<tr><td colspan="' + (list.length + 1) + '" style="padding:7px 22px">' +
               '<div class="skeleton sk-line" style="margin:0"></div></td></tr>';
      }).join('');
      empty.hidden = true; pager.hidden = true;
      $('tableCount').textContent = '';
      return;
    }

    var rows = state.merged.slice();
    if (state.sortDir === 'desc') rows.reverse();

    if (!rows.length) {
      body.innerHTML = '';
      empty.hidden = false;
      empty.innerHTML = '<p class="empty-title">Nenhuma cotação encontrada para o período selecionado.</p>' +
        '<p class="empty-help">Selecione outro período.</p>';
      pager.hidden = true;
      $('tableCount').textContent = '';
      return;
    }
    empty.hidden = true;

    var pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
    if (state.page > pages) state.page = pages;
    var from = (state.page - 1) * state.pageSize;
    var slice = rows.slice(from, from + state.pageSize);

    body.innerHTML = slice.map(function (r) {
      return '<tr><td>' + Dates.br(r.date) + '</td>' +
        list.map(function (c) {
          return r[c] !== undefined
            ? '<td>' + Fmt.brl(r[c]) + '</td>'
            : '<td class="nodata" title="Sem boletim para esta moeda nesta data">—</td>';
        }).join('') + '</tr>';
    }).join('');

    $('tableCount').textContent = Fmt.int(rows.length) +
      (rows.length === 1 ? ' boletim' : ' boletins');

    pager.hidden = pages === 1;
    $('pageInfo').textContent = Fmt.int(from + 1) + '–' + Fmt.int(from + slice.length) +
      ' de ' + Fmt.int(rows.length);
    $('prevPage').disabled = state.page === 1;
    $('nextPage').disabled = state.page === pages;
  }

  /* ------------------------------------------------------------- rodapé -- */
  function renderFooter() {
    $('lastUpdate').textContent = state.lastUpdate ? Dates.stamp(state.lastUpdate) : '—';
  }

  function renderAll() {
    renderBanner();
    renderCards();
    renderLegend();
    renderChart();
    renderExtremes();
    renderTable();
    renderFooter();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* -------------------------------------------------------------- filtros */
  function setPeriodPill(period) {
    state.period = period;
    Array.prototype.forEach.call($('periodPills').children, function (b) {
      b.setAttribute('aria-checked', String(b.dataset.period === period));
    });
  }

  function syncDateInputs() {
    $('dateStart').value = state.start;
    $('dateEnd').value = state.end;
  }

  function applyPeriod(period) {
    var r = rangeFor(period);
    state.start = r[0];
    state.end = r[1];
    setPeriodPill(period);
    syncDateInputs();
    load();
  }

  function onDateChange() {
    var s = $('dateStart').value;
    var e = $('dateEnd').value;
    if (!s || !e) return;
    if (s > e) {
      var b = $('banner');
      b.className = 'banner is-error';
      b.innerHTML = '<span><strong>Período inválido.</strong> A data inicial precisa ser anterior à data final.</span>';
      b.hidden = false;
      return;
    }
    state.start = s < CFG.MIN_DATE ? CFG.MIN_DATE : s;
    state.end = e;
    syncDateInputs();
    setPeriodPill('custom');
    load();
  }

  /* ---------------------------------------------------------------- init -- */
  function init() {
    chart = Chart.create($('chart'), $('tooltip'));

    var t = Dates.today();
    $('dateStart').min = CFG.MIN_DATE;
    $('dateEnd').min = CFG.MIN_DATE;
    $('dateStart').max = t;
    $('dateEnd').max = t;

    $('dateStart').addEventListener('change', onDateChange);
    $('dateEnd').addEventListener('change', onDateChange);

    Array.prototype.forEach.call($('periodPills').children, function (b) {
      b.addEventListener('click', function () { applyPeriod(b.dataset.period); });
    });

    Array.prototype.forEach.call($('currencySeg').children, function (b) {
      b.addEventListener('click', function () {
        if (state.selection === b.dataset.sel) return;
        state.selection = b.dataset.sel;
        Array.prototype.forEach.call($('currencySeg').children, function (x) {
          x.setAttribute('aria-checked', String(x.dataset.sel === state.selection));
        });
        load();
      });
    });

    Array.prototype.forEach.call($('scaleSeg').children, function (b) {
      b.addEventListener('click', function () {
        if (state.scale === b.dataset.mode) return;
        state.scale = b.dataset.mode;
        Array.prototype.forEach.call($('scaleSeg').children, function (x) {
          x.setAttribute('aria-checked', String(x.dataset.mode === state.scale));
        });
        renderChart();
      });
    });

    $('pageSize').addEventListener('change', function () {
      state.pageSize = parseInt(this.value, 10) || 25;
      state.page = 1;
      renderTable();
    });
    $('prevPage').addEventListener('click', function () {
      if (state.page > 1) { state.page--; renderTable(); }
    });
    $('nextPage').addEventListener('click', function () {
      state.page++; renderTable();
    });

    $('refreshBtn').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      btn.classList.add('is-busy');
      $('refreshLabel').textContent = 'Atualizando…';
      load({ force: true }).then(function () {
        btn.disabled = false;
        btn.classList.remove('is-busy');
        $('refreshLabel').textContent = state.error ? 'Tentar novamente' : 'Dados atualizados';
        setTimeout(function () { $('refreshLabel').textContent = 'Atualizar dados'; }, 2600);
      });
    });

    applyPeriod('30d');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.__dash = { state: state, load: load };
})(window);
