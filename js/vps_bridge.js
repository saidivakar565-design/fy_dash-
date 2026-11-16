/* Cloud OpenAlgo bridge (Hostinger VPS) — loaded in <head> before every other script.  READ-ONLY.
   Why: Fyers allows ONE active login per API app. The cloud OpenAlgo (srv2165780.hstgr.cloud) now holds that login,
   so this phone must never log in to Fyers itself ("Fyers direct" would cancel the server's token).
   What it does:
   1. Moves saved settings from "Fyers direct" / laptop URLs to the cloud OpenAlgo WebSocket (wss://…/ws).
   2. Re-routes every Fyers GET /data/history and /data/quotes call made by the cockpit to https://srv2165780.hstgr.cloud/cockpit/fyhist
      and /cockpit/fyquotes, which answer in the same Fyers format from OpenAlgo's /api/v1/history and /multiquotes (server-side login).
   3. Exposes window.VPSB for the Pro tools (js/vps_pro.js).
   The OpenAlgo API key is NEVER in this repo: you paste it once on the Live feed tab; it lives in this browser's
   localStorage (cc_live_cfg) and is sent only to srv2165780.hstgr.cloud. No order endpoint is ever called. */
(function () {
  'use strict';
  var BASE = 'https://srv2165780.hstgr.cloud', WS = 'wss://srv2165780.hstgr.cloud/ws';
  function lj(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function sj(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var host = location.hostname || '';
  var local = !host || /^(127\.0\.0\.1|localhost|\[?::1\]?)$/i.test(host);
  var notes = [];

  /* ---- 1. one-time migration of saved settings ---- */
  try {
    var fy = lj('fy_cfg');
    if (fy && fy.source === 'fyers') { fy.source = 'openalgo'; fy.auto = false; sj('fy_cfg', fy); notes.push('Data source moved from Fyers direct to Cloud OpenAlgo (Fyers direct would log the server out).'); }
    if (!fy) sj('fy_cfg', { source: 'openalgo', appId: '', secret: '', remember: false, redirect: '', auto: false });
    var lc = lj('cc_live_cfg') || {};
    if (!local && (!lc.url || !/srv2165780\.hstgr\.cloud/i.test(lc.url))) {
      if (lc.url) notes.push('WebSocket URL ' + lc.url + ' replaced with ' + WS + '.');
      lc.url = WS; if (!lc.mode) lc.mode = 'Quote'; if (!lc.v) lc.v = 3; sj('cc_live_cfg', lc);
    }
    if (!local && lc.enabled === undefined) { lc.enabled = true; sj('cc_live_cfg', lc); }
  } catch (e) {}

  function key() { var c = lj('cc_live_cfg'); return (c && c.key) || ''; }
  function source() { var c = lj('fy_cfg'); return (c && c.source) || 'openalgo'; }
  var VPSB = window.VPSB = {
    base: BASE, ws: WS, notes: notes,
    key: key,
    active: function () { return !!key() && source() !== 'fyers'; },
    tok: function () { var c = lj('fy_cfg') || {}; return { access: 'cloud-openalgo', appId: c.appId || 'CLOUD-OPENALGO', exp: Math.floor(Date.now() / 1000) + 12 * 3600, name: 'Cloud OpenAlgo', vps: true }; },
    /* GET /cockpit/* with the key in a header (never in the URL) */
    get: function (path) {
      return _fetch(BASE + path, { method: 'GET', headers: { 'X-API-KEY': key() }, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.message || ('HTTP ' + r.status)); return j; }); });
    },
    /* POST /api/v1/<read-only endpoint>; nginx only allows quotes/multiquotes/history/positionbook/funds/ping/... cross-origin */
    api: function (ep, body) {
      var b = Object.assign({ apikey: key() }, body || {});
      return _fetch(BASE + '/api/v1/' + ep, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b), credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok || j.status === 'error') throw new Error(j.message || ('HTTP ' + r.status)); return j; }); });
    },
    stats: { routed: 0, errors: 0, last: '' }
  };

  /* ---- 2. Fyers history + quotes → cloud OpenAlgo ---- */
  var _fetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var isH = url.indexOf('https://api-t1.fyers.in/data/history') === 0, isQ = url.indexOf('https://api-t1.fyers.in/data/quotes') === 0;
      if ((isH || isQ) && source() !== 'fyers') {
        var q = url.slice(url.indexOf('?')), ep = isH ? '/cockpit/fyhist' : '/cockpit/fyquotes';
        var k = key();
        if (!k) return Promise.resolve(new Response(JSON.stringify({ s: 'error', code: -16, message: 'Cloud OpenAlgo API key not set (Live feed tab)' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        VPSB.stats.routed++;
        return _fetch(BASE + ep + q, { method: 'GET', headers: { 'X-API-KEY': k }, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' })
          .then(function (r) { VPSB.stats.last = new Date().toISOString(); if (!r.ok) VPSB.stats.errors++; return r; });
      }
    } catch (e) {}
    return _fetch(input, init);
  };
})();
