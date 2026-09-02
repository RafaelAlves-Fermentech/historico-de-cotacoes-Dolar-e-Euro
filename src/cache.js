/* =============================================================
   cache.js — Cache de janelas de consulta ao BCB.
   Camada: persistência local. Não conhece a UI.

   Estratégia de validade (§31):
   - Uma janela totalmente no passado (fim < hoje) é IMUTÁVEL: a PTAX de
     fechamento de um dia útil encerrado não muda. TTL longo (30 dias).
   - Uma janela que alcança hoje ou ontem pode ainda receber o boletim do dia
     (publicado por volta das 13h). TTL curto (20 minutos).
   - "Atualizar dados" ignora o cache e regrava as janelas.
   ============================================================= */
(function (global) {
  'use strict';

  var PREFIX = 'ptax.v1.';
  var TTL_CLOSED = 30 * 24 * 60 * 60 * 1000;
  var TTL_OPEN = 20 * 60 * 1000;
  var mem = Object.create(null);

  function available() {
    try {
      var k = PREFIX + 'probe';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  }
  var hasLS = available();

  function key(currency, from, to) { return PREFIX + currency + '.' + from + '.' + to; }

  function ttlFor(to) {
    return to < Dates.today() ? TTL_CLOSED : TTL_OPEN;
  }

  /**
   * @returns {{rows:Array, fetchedAt:number, fresh:boolean}|null}
   * `fresh:false` significa que o dado existe mas venceu — serve como
   * fallback quando o BCB está indisponível (§34).
   */
  function get(currency, from, to) {
    var k = key(currency, from, to);
    var entry = mem[k];
    if (!entry && hasLS) {
      try {
        var raw = localStorage.getItem(k);
        if (raw) { entry = JSON.parse(raw); mem[k] = entry; }
      } catch (e) { entry = null; }
    }
    if (!entry || !entry.rows) return null;
    return {
      rows: entry.rows,
      fetchedAt: entry.fetchedAt,
      fresh: (Date.now() - entry.fetchedAt) < ttlFor(to)
    };
  }

  function set(currency, from, to, rows) {
    var k = key(currency, from, to);
    var entry = { rows: rows, fetchedAt: Date.now() };
    mem[k] = entry;
    if (!hasLS) return;
    try {
      localStorage.setItem(k, JSON.stringify(entry));
    } catch (e) {
      // Cota estourada: descarta as janelas mais antigas e tenta de novo.
      prune();
      try { localStorage.setItem(k, JSON.stringify(entry)); } catch (e2) { /* mantém só em memória */ }
    }
  }

  /** Remove metade das janelas mais antigas do localStorage. */
  function prune() {
    if (!hasLS) return;
    var items = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(PREFIX) === 0) {
        var at = 0;
        try { at = (JSON.parse(localStorage.getItem(k)) || {}).fetchedAt || 0; } catch (e) {}
        items.push({ k: k, at: at });
      }
    }
    items.sort(function (a, b) { return a.at - b.at; });
    items.slice(0, Math.ceil(items.length / 2)).forEach(function (it) {
      try { localStorage.removeItem(it.k); delete mem[it.k]; } catch (e) {}
    });
  }

  function clear() {
    mem = Object.create(null);
    if (!hasLS) return;
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(PREFIX) === 0) keys.push(k);
    }
    keys.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
  }

  global.RateCache = { get: get, set: set, clear: clear, enabled: hasLS };
})(window);
