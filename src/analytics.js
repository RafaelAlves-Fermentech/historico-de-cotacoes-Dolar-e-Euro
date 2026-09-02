/* =============================================================
   analytics.js — Cálculos do período. Funções puras sobre o modelo.
   Todos os cálculos usam o valor original retornado pelo BCB (sem
   arredondamento intermediário). O arredondamento existe só na exibição.
   ============================================================= */
(function (global) {
  'use strict';

  /** Abaixo disso a variação é tratada como estabilidade. */
  var FLAT_THRESHOLD = 0.005; // 0,005% — menor que a precisão exibida

  /**
   * @param {Array<{date:string, sellRate:number}>} rows  já ordenado por data
   * @returns {null|{first,last,min,max,changePct,direction,count}}
   */
  function summarize(rows) {
    if (!rows || !rows.length) return null;

    var first = rows[0];
    var last = rows[rows.length - 1];
    var min = rows[0];
    var max = rows[0];

    for (var i = 1; i < rows.length; i++) {
      if (rows[i].sellRate < min.sellRate) min = rows[i];
      if (rows[i].sellRate > max.sellRate) max = rows[i];
    }

    // Variação entre a PRIMEIRA e a ÚLTIMA cotação efetivamente disponíveis.
    var changePct = ((last.sellRate / first.sellRate) - 1) * 100;
    var direction = Math.abs(changePct) < FLAT_THRESHOLD
      ? 'flat'
      : (changePct > 0 ? 'up' : 'down');

    return {
      first: first,
      last: last,
      min: min,
      max: max,
      changePct: changePct,
      direction: direction,
      count: rows.length
    };
  }

  /**
   * Une as séries por data para a tabela. Uma linha por data em que ao menos
   * uma das moedas selecionadas tem boletim. Datas sem boletim não são criadas.
   */
  function mergeByDate(seriesMap, codes) {
    var byDate = Object.create(null);
    codes.forEach(function (code) {
      (seriesMap[code] || []).forEach(function (r) {
        if (!byDate[r.date]) byDate[r.date] = { date: r.date };
        byDate[r.date][code] = r.sellRate;
      });
    });
    return Object.keys(byDate).sort().map(function (d) { return byDate[d]; });
  }

  var GLYPH = { up: '\u25B2', down: '\u25BC', flat: '\u2192' };
  var WORD = { up: 'alta', down: 'queda', flat: 'est\u00E1vel' };

  function glyph(dir) { return GLYPH[dir] || GLYPH.flat; }
  function word(dir) { return WORD[dir] || WORD.flat; }

  global.Analytics = {
    summarize: summarize,
    mergeByDate: mergeByDate,
    glyph: glyph,
    word: word,
    FLAT_THRESHOLD: FLAT_THRESHOLD
  };
})(window);
