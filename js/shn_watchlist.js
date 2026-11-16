/**
 * On-phone NSE screener watchlist. The cap is 50 names.
 * The fallback scan uses the existing 1.6s gap (under 40 requests a minute).
 * Fifty names therefore take about a minute and a half of spacing, so the
 * first scan of the day is about 1.5 to 2 minutes once each history call
 * returns. This file does not call Fyers.
 */
(function (global) {
  'use strict';
  var CAP = 50;
  var GAP_MS = 1600;

  function parseWatchlist(text, cap) {
    var limit = cap == null ? CAP : cap;
    var syms = String(text || '').toUpperCase().split(/[^A-Z0-9&.-]+/).filter(Boolean);
    var out = [];
    syms.forEach(function (s) {
      if (out.length < limit && out.indexOf(s) < 0) out.push(s);
    });
    return out;
  }

  function scanProgress(done, total) {
    if (!(total > 0) || done >= total) return '';
    var n = done < 0 ? 0 : Math.floor(done);
    if (n > total) n = total;
    return 'Scanning ' + n + '/' + total;
  }

  var api = { CAP: CAP, GAP_MS: GAP_MS, parseWatchlist: parseWatchlist, scanProgress: scanProgress };
  global.SHNWatch = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
