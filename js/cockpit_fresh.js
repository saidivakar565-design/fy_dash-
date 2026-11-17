/* cockpit_fresh.js (17 Nov 2026, radar fix) - keeps the Commodities Cockpit current without the laptop.
   1) Fresh data: sector rotation (RRG), macro, heat map and commodity history are rebuilt on the VPS every 15 min
      (cron build_cockpit_data.py: Yahoo + OpenAlgo NSE sector-index history) and swapped in here at load and every 15 min.
   2) Market Radar copy only (/radar/cockpit/...): live prices are polled from the server's OpenAlgo every 3 s
      (/radar/api/mquotes, key stays on the server) - no API key, no Fyers login in the browser.
   Read-only. No order endpoint is ever called. */
(function () {
  'use strict';
  var RADAR = /\/radar\//.test(location.pathname);
  var VPS = 'https://srv2165780.hstgr.cloud';
  var $id = function (i) { return document.getElementById(i); };
  function key() { try { var c = JSON.parse(localStorage.getItem('cc_live_cfg')); return (c && c.key) || ''; } catch (e) { return ''; } }
  function hdrs() { return RADAR ? { 'X-Radar': '1' } : { 'X-API-KEY': key() }; }
  function dataUrl() { return RADAR ? '../api/cockpitdata' : VPS + '/cockpit/cockpitdata'; }
  var state = { built: null, err: null, lastLive: 0, nLive: 0 };
  window.CockpitFresh = state;

  function banner() {
    var el = $id('asof'); if (!el) return;
    var b = state.built ? 'Server data ' + state.built : (state.err ? 'Server data not loaded (' + state.err + ')' : 'Loading server data…');
    var a = (typeof DATA !== 'undefined' && DATA.asof) ? ' · closes to ' + (typeof fmtDay === 'function' ? fmtDay(DATA.asof) : DATA.asof) : '';
    var l = RADAR && state.lastLive ? ' · live ' + new Date(state.lastLive).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }) + ' IST' : '';
    el.textContent = b + a + l;
  }

  function provisional(s) {
    var q = s.q;
    if (q && q.status === 'intraday' && q.c != null && s.d && q.d > s.d[s.d.length - 1]) {
      s.d.push(q.d); s.o.push(q.o != null ? q.o : q.c); s.h.push(q.h != null ? q.h : q.c); s.l.push(q.l != null ? q.l : q.c); s.c.push(q.c);
      if (s.v) s.v.push(q.v || 0); s.prov = true;
    }
  }

  function apply(j) {
    if (!j || !j.series || !j.rrg || typeof DATA === 'undefined') throw new Error('bad payload');
    Object.keys(j.series).forEach(function (k) { var s = j.series[k]; provisional(s); S[k] = s; });
    DATA.rrg.splice.apply(DATA.rrg, [0, DATA.rrg.length].concat(j.rrg));
    ['asof', 'quote_ts', 'mcap_ts', 'generated', 'failed', 'missing_mcap', 'sources'].forEach(function (k) { if (k in j) DATA[k] = j[k]; });
    try { if (typeof RET === 'object') Object.keys(RET).forEach(function (k) { delete RET[k]; }); } catch (e) {}
    try { if (typeof rrgSel !== 'undefined') j.rrg.forEach(function (r) { rrgSel.add(r.key); }); } catch (e) {}
    state.built = (j.server && j.server.built_ist) || j.generated; state.err = null; state.rrgWeek = j.server && j.server.rrg_week;
    banner();
    try { document.querySelectorAll('.ckstale').forEach(function (e) { if (/Research data|Yahoo daily data/.test(e.textContent)) e.remove(); }); } catch (e) {}
    try {
      var qb = $id('qbanner');
      if (qb) qb.innerHTML = '<span class="qlive">● <b>Server refresh</b>: ' + state.built + ' · sector rotation to week of ' + (state.rrgWeek || '–') +
        ' · NSE sector indices from OpenAlgo (Fyers), commodities/macro from Yahoo (~15 min delayed)' + (RADAR ? ' · MCX/NSE live prices from the server every 3 s' : '') + '</span>';
    } catch (e) {}
    try {
      var act = (document.querySelector('nav button.active') || {}).dataset; act = act && act.tab;
      Object.keys(rendered).forEach(function (t) { rendered[t] = false; });
      if (act) showTab(act);
    } catch (e) { console.warn('cockpit_fresh re-render', e); }
  }

  function load() {
    if (!RADAR && !key()) { state.err = 'add your OpenAlgo API key in Live feed'; banner(); return; }
    fetch(dataUrl() + (dataUrl().indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(), { headers: hdrs(), cache: 'no-store', credentials: RADAR ? 'same-origin' : 'omit' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { if (!state.built || (j.server && j.server.built_ist) !== state.built) apply(j); })
      .catch(function (e) { state.err = String(e.message || e); banner(); console.warn('cockpit_fresh', e); });
  }

  /* ---------- Market Radar copy: server-polled live prices ---------- */
  function liveSetup() {
    var st = document.createElement('style');
    st.textContent = '#fypanel,#fybox,#fylogin,#fypill,#fysrc,#fysrchelp,#oabox,#oapanel,#mcxconn{display:none!important}';
    document.head.appendChild(st);
    var tab = $id('tab-live');
    if (tab) {
      var n = document.createElement('div'); n.className = 'panel'; n.id = 'srvlive'; n.style.marginTop = '0';
      n.innerHTML = '<div class="lvhead"><h2>Live feed: server</h2><span class="lvpill ok" id="srvpill">Starting…</span></div>' +
        '<div class="note">Prices come from the <b>cloud OpenAlgo on the server</b> (Fyers, logged in once a day in OpenAlgo). ' +
        'Nothing to connect, no API key and <b>no Fyers login on this page</b>. Updated every 3 s.</div><div class="sub" id="srvmsg" style="margin-top:6px"></div>';
      tab.insertBefore(n, tab.firstChild);
    }
  }

  function fixMcx() {
    var n = state.nLive, ok = n > 0;
    var pill = $id('mcxpill'); if (pill) { pill.textContent = ok ? 'Live (server)' : 'Waiting for server prices'; pill.className = 'lvpill ' + (ok ? 'ok' : 'wait'); }
    var mm = $id('mcxmsg'); if (mm) mm.textContent = 'Live MCX prices from the cloud OpenAlgo on the server, every 3 s' + (state.lastLive ? ' · last update ' + new Date(state.lastLive).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }) + ' IST' : '') + '. No Fyers login needed here.';
    var h = document.querySelector('#mcxpanel h2 .sub'); if (h) h.textContent = '· real-time ₹ futures from the server OpenAlgo (Fyers)';
  }
  function hookMcx() {
    try { if (typeof renderMcxPanel === 'function' && !renderMcxPanel.__fresh) { var o = renderMcxPanel; renderMcxPanel = function () { var r = o.apply(this, arguments); fixMcx(); return r; }; renderMcxPanel.__fresh = true; } } catch (e) {}
    try { DataLayer.subscribe(function () { fixMcx(); }); } catch (e) {}
    fixMcx();
  }
  var busy = false;
  function poll() {
    if (busy || typeof LCFG === 'undefined' || typeof DataLayer === 'undefined') return;
    var map = (typeof LiveFeed !== 'undefined' && LiveFeed.cfg && LiveFeed.cfg.customMap && LiveFeed.cfg.map) || LCFG.map || {};
    var keys = Object.keys(map), want = [], back = {};
    keys.forEach(function (k) { var m = map[k]; if (m && m.exchange && m.symbol) { var id = m.exchange + ':' + m.symbol; want.push(id); back[id] = k; } });
    if (!want.length) return;
    busy = true;
    fetch('../api/mquotes?s=' + encodeURIComponent(want.slice(0, 100).join(',')) + '&t=' + Date.now(), { headers: { 'X-Radar': '1' }, cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        var n = 0, qs = j.quotes || {};
        Object.keys(qs).forEach(function (id) {
          var k = back[id], d = qs[id]; if (!k || !d || !(d.ltp > 0)) return;
          var p = id.split(':');
          DataLayer.applyTick(k, +d.ltp, { ts: j.as_of, exchange: p[0], symbol: p.slice(1).join(':'), close: d.prev_close,
            q: { ltp: d.ltp, open: d.open, high: d.high, low: d.low, close: d.prev_close, volume: d.volume, oi: d.oi, timestamp: j.as_of,
                 change_percent: d.prev_close ? (d.ltp / d.prev_close - 1) * 100 : null } });
          n++;
        });
        state.lastLive = Date.now(); state.nLive = n;
        var msg = n + ' of ' + want.length + ' symbols priced · ' + new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }) + ' IST' +
          ((j.errors && j.errors.length) ? ' · ' + j.errors.join('; ') : '');
        var pill = $id('srvpill'); if (pill) { pill.textContent = n ? 'Live (server)' : 'No prices'; pill.className = 'lvpill ' + (n ? 'ok' : 'err'); }
        var m = $id('srvmsg'); if (m) m.textContent = msg;
        ['lvstat', 'lvpill', 'mcxpill'].forEach(function (i) { var e = $id(i); if (e) { e.textContent = n ? 'Live (server)' : 'No prices'; e.className = 'lvpill ' + (n ? 'ok' : 'err'); } });
        fixMcx();
        banner();
      })
      .catch(function (e) { var m = $id('srvmsg'); if (m) m.textContent = 'Server prices unavailable: ' + (e.message || e); var pill = $id('srvpill'); if (pill) { pill.textContent = 'Error'; pill.className = 'lvpill err'; } })
      .then(function () { busy = false; });
  }

  function start() {
    banner(); load(); setInterval(load, 15 * 60 * 1000);
    if (RADAR) {
      liveSetup(); hookMcx();
      try { if (typeof LiveFeed !== 'undefined' && LiveFeed.ws) LiveFeed.disconnect(true); } catch (e) {}
      poll(); setInterval(function () { if (!document.hidden) poll(); }, 3000);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
