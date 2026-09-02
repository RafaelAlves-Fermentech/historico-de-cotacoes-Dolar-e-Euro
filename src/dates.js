/* =============================================================
   dates.js — Utilidades de data e formatação brasileira.
   Camada: utilitários puros. Sem rede, sem DOM.
   ============================================================= */
(function (global) {
  'use strict';

  /** "2026-08-28" -> Date em UTC (evita deslocamento por fuso). */
  function toUTC(iso) {
    var p = iso.split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  }

  /** Date -> "YYYY-MM-DD" (sempre em UTC). */
  function toISO(d) {
    return d.getUTCFullYear() + '-' +
      String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(d.getUTCDate()).padStart(2, '0');
  }

  /** Hoje no fuso local do usuário, como "YYYY-MM-DD". */
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  /** "YYYY-MM-DD" -> "DD/MM/YYYY". */
  function br(iso) {
    if (!iso) return '\u2014';
    var p = iso.split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }

  /** "YYYY-MM-DD" -> "MM-DD-YYYY", formato exigido pela API do BCB. */
  function toBcb(iso) {
    var p = iso.split('-');
    return p[1] + '-' + p[2] + '-' + p[0];
  }

  function addDays(iso, n) {
    var d = toUTC(iso);
    d.setUTCDate(d.getUTCDate() + n);
    return toISO(d);
  }

  function addMonths(iso, n) {
    var d = toUTC(iso);
    var day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n);
    // Preserva o fim de mês (ex.: 31/03 - 1 mês = 28/02).
    var last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return toISO(d);
  }

  function daysBetween(a, b) {
    return Math.round((toUTC(b) - toUTC(a)) / 86400000);
  }

  /** Rótulo curto para o eixo X: "28/08" ou "ago/26" em períodos longos. */
  var MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  function axisLabel(iso, longRange) {
    var p = iso.split('-');
    if (longRange) return MONTHS[+p[1] - 1] + '/' + p[0].slice(2);
    return p[2] + '/' + p[1];
  }

  /** Data e hora reais da última atualização: "31/08/2026 às 12:35". */
  function stamp(dateObj) {
    var d = dateObj || new Date();
    var dd = String(d.getDate()).padStart(2, '0');
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var hh = String(d.getHours()).padStart(2, '0');
    var mi = String(d.getMinutes()).padStart(2, '0');
    return dd + '/' + mm + '/' + d.getFullYear() + ' \u00E0s ' + hh + ':' + mi;
  }

  global.Dates = {
    toUTC: toUTC, toISO: toISO, today: today, br: br, toBcb: toBcb,
    addDays: addDays, addMonths: addMonths, daysBetween: daysBetween,
    axisLabel: axisLabel, stamp: stamp
  };
})(window);
