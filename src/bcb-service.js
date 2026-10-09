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
     $format           json

   ESTRATÉGIA DE RESILIÊNCIA
   Em 09/10/2026 o serviço do BCB passou a responder 403 a QUALQUER consulta
   que usasse `$select`, parâmetro que o painel empregava para trazer só dois
   campos. O recurso continuava íntegro: apenas aquele parâmetro passou a ser
   recusado. Por isso o `$select` foi removido e a consulta passou a ser
   montada em camadas, da mais enxuta para a mais crua:

     Tentativa 1 — com $filter   (payload menor, filtragem no servidor)
     Tentativa 2 — só $format    (traz todos os boletins, filtra aqui)

   Se o BCB recusar um parâmetro opcional no futuro, o painel cai para a
   tentativa seguinte em vez de ficar sem dados. Só o caminho mínimo
   — parâmetros de rota + $format — é tratado como obrigatório.

   COTAÇÃO DE VENDA: o campo lido é exclusivamente `cotacaoVenda`.
   A resposta agora traz também `cotacaoCompra` e as paridades, mas a
   normalização descarta tudo e constrói o modelo apenas com `cotacaoVenda`.
   Nenhum outro campo numérico atravessa esta camada.

   BOLETIM DE FECHAMENTO: `normalize` exige `tipoBoletim === 'Fechamento'`
   sempre que o campo existir no registro, independentemente de o filtro ter
   sido aplicado pelo servidor. A regra vale mesmo se o $filter for recusado.
   ============================================================= */
(function (global) {
  'use strict';

  var CFG = global.APP_CONFIG;

  /**
   * Monta a URL do recurso.
   * @param {boolean} [serverFilter=true] aplica $filter no servidor.
   *        Quando false, devolve todos os boletins do dia — a filtragem
   *        por Fechamento acontece em `normalize`, de qualquer forma.
   */
  function buildUrl(currency, from, to, serverFilter) {
    var url = CFG.PTAX_BASE +
      '?@moeda=' + encodeURIComponent("'" + currency + "'") +
      '&@dataInicial=' + encodeURIComponent("'" + Dates.toBcb(from) + "'") +
      '&@dataFinalCotacao=' + encodeURIComponent("'" + Dates.toBcb(to) + "'");
    if (serverFilter !== false) {
      url += '&$filter=' + encodeURIComponent("tipoBoletim eq '" + CFG.BULLETIN + "'");
    }
    return url + '&$format=json';
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
      // Só o boletim de fechamento. Vale tanto para a resposta já filtrada
      // pelo servidor quanto para a resposta crua do caminho de contingência.
      if (r.tipoBoletim !== undefined && r.tipoBoletim !== CFG.BULLETIN) return;

      // VENDA, e nada além disso. `cotacaoCompra` e as paridades podem vir na
      // resposta, mas não são lidas em nenhum ponto desta função.
      var v = r[CFG.SELL_FIELD];
      if (typeof v !== 'number' || !isFinite(v) || v <= 0) return;
      if (!r.dataHoraCotacao) return;
      var date = String(r.dataHoraCotacao).slice(0, 10); // "YYYY-MM-DD"
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      byDate[date] = { date: date, currency: currency, currencyName: meta.name, sellRate: v };
    });
    return Object.keys(byDate).sort().map(function (d) { return byDate[d]; });
  }

  function request(url) {
    return fetch(url, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) {
          var e = new Error('O Banco Central recusou a consulta (HTTP ' + res.status + ')');
          e.status = res.status;
          throw e;
        }
        return res.json();
      })
      .then(function (json) { return json.value || []; });
  }

  /**
   * Busca uma janela com degradação em camadas: se a consulta enxuta for
   * recusada (403/400 por causa de um parâmetro opcional), repete sem o
   * $filter. Um erro de rede não aciona o fallback — nesse caso a segunda
   * tentativa falharia igual e só atrasaria a resposta.
   */
  function fetchWindow(currency, from, to) {
    return request(buildUrl(currency, from, to, true))
      .catch(function (err) {
        if (!err.status) throw err;            // falha de rede/CORS
        if (err.status < 400 || err.status >= 500) throw err;
        if (global.console && console.warn) {
          console.warn('[BCB] $filter recusado (HTTP ' + err.status +
                       '). Repetindo sem o parâmetro e filtrando localmente.');
        }
        return request(buildUrl(currency, from, to, false));
      });
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
