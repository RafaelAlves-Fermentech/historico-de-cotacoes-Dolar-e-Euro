/* =============================================================
   bcb-service.js — Camada de acesso aos dados do Banco Central.
   Única parte do sistema que fala com a rede. A UI nunca chama fetch.

   Recurso utilizado (Olinda / serviço PTAX v1):
     CotacaoMoedaPeriodo(moeda, dataInicial, dataFinalCotacao)

   Parâmetros aplicados:
     @moeda            'USD' | 'EUR'
     @dataInicial      MM-DD-YYYY
     @dataFinalCotacao MM-DD-YYYY
     $filter           tipoBoletim eq 'Fechamento'   -> PTAX oficial do dia
     $select           cotacaoVenda,dataHoraCotacao  -> só o que o painel usa
     $format           json

   COTAÇÃO DE VENDA: o campo lido é exclusivamente `cotacaoVenda`.
   `cotacaoCompra` não é sequer solicitado ao servidor ($select), portanto
   não há caminho possível para um valor de compra entrar no painel.
   ============================================================= */
(function (global) {
  'use strict';

  var CFG = global.APP_CONFIG;

  function buildUrl(currency, from, to) {
    return CFG.PTAX_BASE +
      '?@moeda=' + encodeURIComponent("'" + currency + "'") +
      '&@dataInicial=' + encodeURIComponent("'" + Dates.toBcb(from) + "'") +
      '&@dataFinalCotacao=' + encodeURIComponent("'" + Dates.toBcb(to) + "'") +
      '&$filter=' + encodeURIComponent("tipoBoletim eq '" + CFG.BULLETIN + "'") +
      '&$select=' + encodeURIComponent(CFG.SELL_FIELD + ',dataHoraCotacao') +
      '&$format=json';
  }

  /**
   * Divide o período em janelas de no máximo CHUNK_YEARS anos.
   * O BCB respondeu a 36 anos numa única chamada nos testes, mas janelas
   * menores dão progresso incremental, reaproveitam cache entre consultas
   * e evitam depender de um limite não documentado.
   */
  function windows(from, to) {
    var out = [], cursor = from;
    while (cursor <= to) {
      var end = Dates.addDays(Dates.addMonths(cursor, CFG.CHUNK_YEARS * 12), -1);
      if (end > to) end = to;
      out.push({ from: cursor, to: end });
      cursor = Dates.addDays(end, 1);
    }
    return out;
  }

  function normalize(currency, raw) {
    var meta = CFG.CURRENCIES[currency];
    var byDate = Object.create(null);
    (raw || []).forEach(function (r) {
      var v = r[CFG.SELL_FIELD];
      if (typeof v !== 'number' || !isFinite(v) || v <= 0) return;
      if (!r.dataHoraCotacao) return;
      var date = String(r.dataHoraCotacao).slice(0, 10); // "YYYY-MM-DD"
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      // Se houver mais de um registro para a mesma data, mantém o último
      // boletim retornado (a ordem da API é cronológica).
      byDate[date] = { date: date, currency: currency, currencyName: meta.name, sellRate: v };
    });
    return Object.keys(byDate).sort().map(function (d) { return byDate[d]; });
  }

  function fetchWindow(currency, from, to) {
    return fetch(buildUrl(currency, from, to), { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('BCB respondeu ' + res.status);
        return res.json();
      })
      .then(function (json) { return json.value || []; });
  }

  /**
   * Busca a série de uma moeda no período.
   * @param {'USD'|'EUR'} currency
   * @param {string} from  "YYYY-MM-DD"
   * @param {string} to    "YYYY-MM-DD"
   * @param {{force?:boolean, onProgress?:function}} opts
   * @returns {Promise<{rows:Array, stale:boolean, truncated:boolean}>}
   *   `stale` = alguma janela veio de cache vencido porque a API falhou.
   */
  function getSeries(currency, from, to, opts) {
    opts = opts || {};
    var meta = CFG.CURRENCIES[currency];
    // Não pede ao BCB períodos anteriores à primeira cotação da moeda.
    var start = from < meta.firstAvailable ? meta.firstAvailable : from;
    var truncated = from < meta.firstAvailable;
    if (start > to) return Promise.resolve({ rows: [], stale: false, truncated: truncated });

    var wins = windows(start, to);
    var stale = false;
    var done = 0;

    var jobs = wins.map(function (w) {
      var cached = RateCache.get(currency, w.from, w.to);
      if (cached && cached.fresh && !opts.force) {
        done++;
        if (opts.onProgress) opts.onProgress(done, wins.length);
        return Promise.resolve(cached.rows);
      }
      return fetchWindow(currency, w.from, w.to)
        .then(function (raw) {
          var rows = normalize(currency, raw);
          RateCache.set(currency, w.from, w.to, rows);
          done++;
          if (opts.onProgress) opts.onProgress(done, wins.length);
          return rows;
        })
        .catch(function (err) {
          // Sem rede: se houver janela em cache (mesmo vencida), usa e sinaliza.
          if (cached) { stale = true; done++; return cached.rows; }
          throw err;
        });
    });

    return Promise.all(jobs).then(function (parts) {
      var byDate = Object.create(null);
      parts.forEach(function (rows) {
        rows.forEach(function (r) {
          if (r.date >= from && r.date <= to) byDate[r.date] = r;
        });
      });
      var merged = Object.keys(byDate).sort().map(function (d) { return byDate[d]; });
      return { rows: merged, stale: stale, truncated: truncated };
    });
  }

  global.BcbService = {
    getSeries: getSeries,
    buildUrl: buildUrl,
    _windows: windows,
    _normalize: normalize
  };
})(window);
