/* =============================================================
   format.js — Formatação brasileira de números e percentuais.
   Regra: 4 casas decimais na interface; nunca arredondar antes do cálculo.
   ============================================================= */
(function (global) {
  'use strict';

  var nf4 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  var nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var nfPct = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always'
  });
  var nfInt = new Intl.NumberFormat('pt-BR');

  /** 5.1625 -> "5,1625" (sem prefixo). */
  function rate(v) {
    return (v === null || v === undefined || !isFinite(v)) ? '\u2014' : nf4.format(v);
  }

  /** 5.1625 -> "R$ 5,1625". */
  function brl(v) {
    return (v === null || v === undefined || !isFinite(v)) ? '\u2014' : 'R$ ' + nf4.format(v);
  }

  /**
   * Divide a cotação para o tratamento tipográfico do boletim:
   * "5,1625" -> { head: "5,16", tail: "25" }
   */
  function splitRate(v) {
    if (v === null || v === undefined || !isFinite(v)) return { head: '\u2014', tail: '' };
    var s = nf4.format(v);
    return { head: s.slice(0, s.length - 2), tail: s.slice(-2) };
  }

  /** 2.3456 -> "+2,35%" ; -1.2 -> "-1,20%". */
  function pct(v) {
    return (v === null || v === undefined || !isFinite(v)) ? '\u2014' : nfPct.format(v) + '%';
  }

  function num2(v) {
    return (v === null || v === undefined || !isFinite(v)) ? '\u2014' : nf2.format(v);
  }

  function int(v) { return nfInt.format(v); }

  global.Fmt = { rate: rate, brl: brl, splitRate: splitRate, pct: pct, num2: num2, int: int };
})(window);
