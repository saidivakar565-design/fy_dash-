/* Radar tab on the VPS (added 17 Nov 2026, Radar Pro). READ-ONLY.
   Market Radar now runs on the cloud server (https://srv2165780.hstgr.cloud/radar, behind its own login), so the Radar and
   DC20 tabs no longer need the laptop:
   - every call the tabs make to the old laptop address (/api/latest, /dc20_retest.json, /dc20_candles/*.json, /api/dc20/candles)
     is answered by the cockpit bridge /cockpit/radar/... with the OpenAlgo key you already saved on the Live feed tab
     (sent only to srv2165780.hstgr.cloud in a header, never in a URL);
   - "Open full map ↗" opens the full Chain Reaction Map on the server (log in with your Market Radar user once). */
(function () {
  'use strict';
  var BASE = 'https://srv2165780.hstgr.cloud', RADAR = BASE + '/radar', OLD = /^https?:\/\/(desktop-3565pu7\.tailece833\.ts\.net(:\d+)?|127\.0\.0\.1(:\d+)?|localhost(:\d+)?|100\.\d+\.\d+\.\d+(:\d+)?)/i;
  function lj(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function key() { var c = lj('cc_live_cfg'); return (c && c.key) || ''; }
  try { var b = lj('radar_base'); if (!b || OLD.test(String(b))) localStorage.setItem('radar_base', JSON.stringify(RADAR)); } catch (e) {}
  var ALLOW = /^\/(api\/latest|dc20_retest\.json|api\/dc20\/candles|dc20_candles\/[A-Za-z0-9_]{1,40}\.json)(\?|$)/;
  var _f = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var m = /^https?:\/\/[^\/]+(\/radar)?(\/.*)$/i.exec(url), path = m && m[2];
      var mine = url.indexOf(RADAR + '/') === 0 || OLD.test(url);
      if (mine && path && ALLOW.test(path) && key()) {
        return _f(BASE + '/cockpit/radar' + path, { method: 'GET', cache: 'no-store', credentials: 'omit', headers: { 'X-API-KEY': key() }, signal: init && init.signal });
      }
    } catch (e) {}
    return _f(input, init);
  };
  /* wording: the map is no longer laptop-only */
  function fix(root) {
    try {
      (root || document).querySelectorAll('.rt-foot').forEach(function (el) {
        if (/needs the laptop/.test(el.textContent)) el.textContent = 'Summary from Market Radar on the cloud server. The full Chain Reaction Map (live MCX Pro chart with pinch / price-axis zoom, chain, who gains / who pays, economic calendar) opens with "Open full map ↗" - log in with your Market Radar user.';
      });
      (root || document).querySelectorAll('details.rt-cfg summary').forEach(function (s) { if (s.textContent === 'Laptop address') s.textContent = 'Server address'; });
      (root || document).querySelectorAll('.rt-ok,.rt-off').forEach(function (s) {
        if (/Laptop online/.test(s.textContent)) s.textContent = '● Server online';
        else if (/Laptop offline/.test(s.textContent)) s.textContent = key() ? '● Server not reachable' : '● Save your OpenAlgo API key on the Live feed tab';
      });
    } catch (e) {}
  }
  var mo = new MutationObserver(function () { fix(); }); mo.observe(document.body, { childList: true, subtree: true });
  fix();
  /* the tabs may have tried the laptop before this file loaded: reload them once */
  setTimeout(function () { try { if (window.RadarTabs && RadarTabs._sv) { RadarTabs._sv.ok = null; } if (window.RadarTabs && RadarTabs.reload) RadarTabs.reload(); } catch (e) {} }, 300);
})();
