/* Chart signal markers (17 Nov 2026) — SD Rainbow / UT Bot / SHN Buy·Sell·Exit on the cockpit candle chart (#fxchart).  READ-ONLY.
   Data:  GET https://srv2165780.hstgr.cloud/cockpit/markers?name=SILVERMIC&tf=15m|2h|4h|D   (X-API-KEY from localStorage via window.VPSB)
     UT Buy/Sell + SHN entries/exits = SHN v3.4 model on the VPS (closed bars).  SD Buy/Sell = SD Rainbow TradingView alerts logged by the webhook.
   Draws ▲ under the bar low for buys, ▼ over the bar high for sells/exits, inside the price pane only (never in the EVENTS lane under it).
   Tap a bar with a marker → popup with price and IST time.  Tap SD / UT / SHN in the legend to hide a set.  Off on a device: localStorage.ckmk_off='1'.
   No key is stored in this file. */
(function () {
  'use strict';
  try { if (localStorage.getItem('ckmk_off') === '1') return; } catch (e) {}
  var d = document, T0 = Date.now();
  var TFM = { '15': '15m', '120': '2h', '240': '4h', 'D': 'D' };
  var STEP = { '15m': 900, '2h': 7200, '4h': 14400, 'D': 86400 };
  var C = {}, inflight = {};   // cache: name|tf -> {at, m:[...], note}
  var MK = window.CKMARKERS = { cache: C, v: 1, last: null };
  function $(id) { return d.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function mob() { return window.innerWidth < 640; }
  function ist(sec, day) {
    var x = new Date(sec * 1000 + 19800000), mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][x.getUTCMonth()];
    var hm = ('0' + x.getUTCHours()).slice(-2) + ':' + ('0' + x.getUTCMinutes()).slice(-2);
    return x.getUTCDate() + ' ' + mo + (day ? '' : ' ' + hm);
  }
  function px(v) { if (v == null || !isFinite(v)) return '–'; v = +v; return v.toLocaleString('en-IN', { maximumFractionDigits: Math.abs(v) >= 5000 ? 0 : 2, minimumFractionDigits: Math.abs(v) >= 5000 ? 0 : 2 }); }
  function src(m) { var k = String(m.kind || ''); return /^SD/i.test(k) ? 'SD' : /^UT/i.test(k) ? 'UT' : 'SHN'; }
  function isExit(m) { return /exit/i.test(m.kind || ''); }
  var COL = { SD: { b: '#d2a8ff', s: '#ff7ab6' }, UT: { b: '#3fb950', s: '#f85149' }, SHN: { b: '#56d4dd', s: '#f0883e' } };
  var SHORT = { SD: 'SD', UT: 'UT', SHN: 'SHN' };

  function want() {
    var r = window.FXV && FXV.open; if (!r) return null;
    var tf = TFM[FXV.tf]; if (!tf) return { skip: 'Signal markers: 15m / 2H / 4H / D only' };
    var name = String(r.key || r.label || '').toUpperCase().replace(/[^A-Z0-9&_-]/g, '');
    if (!name) return null;
    return { name: name, tf: tf, k: name + '|' + tf };
  }
  function load(w) {
    var V = window.VPSB; if (!V || !V.key() || inflight[w.k]) return;
    inflight[w.k] = 1;
    V.get('/cockpit/markers?name=' + encodeURIComponent(w.name) + '&tf=' + encodeURIComponent(w.tf)).then(function (j) {
      C[w.k] = { at: Date.now(), m: (j && j.markers) || [], note: (j && (j.ut_note || '')) || '', sd: j && j.sd_count };
    }).catch(function (e) { C[w.k] = { at: Date.now(), m: [], err: e.message }; })
      .then(function () { delete inflight[w.k]; var n = want(); if (n && n.k === w.k && window.FXV && FXV.bars) { try { fxDraw(); } catch (e) {} } });
  }
  function barIndex(b, t, step) {   // last bar whose start <= t (and t inside that bar)
    var a = b.t; if (!a || !a.length || t < a[0]) return -1;
    var lo = 0, hi = a.length - 1;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (a[mid] <= t) lo = mid; else hi = mid - 1; }
    if (lo === a.length - 1 && t >= a[lo] + step) return -1;   // newer than the loaded bars
    return lo;
  }
  /* add marker traces to the arrays fxDraw hands Plotly.react */
  function addTraces(T, L) {
    var w = want(); MK.last = null; if (!w || w.skip) return;
    var e = C[w.k]; if (!e || Date.now() - e.at > (w.tf === '15m' ? 120000 : 300000)) load(w);
    if (!e || !e.m.length) return;
    var b = FXV.bars, x = b.lab || b.x, n = b.c.length, step = STEP[w.tf];
    var rng = 0, cnt = 0; for (var i = Math.max(0, n - 60); i < n; i++) { rng += b.h[i] - b.l[i]; cnt++; }
    var pad = (cnt ? rng / cnt : b.c[n - 1] * 0.003) * 0.45;
    var stack = {}, sets = { SD: [], UT: [], SHN: [] }, byBar = {};
    e.m.forEach(function (m) {
      var i = barIndex(b, +m.t, step); if (i < 0 || i >= n) return;
      var s = src(m), up = m.side > 0 && !isExit(m), key = i + (up ? 'u' : 'd'), k = stack[key] = (stack[key] || 0) + 1;
      var y = up ? b.l[i] - pad * (0.6 + (k - 1) * 0.9) : b.h[i] + pad * (0.6 + (k - 1) * 0.9);
      var o = { i: i, y: y, up: up, s: s, m: m }; sets[s].push(o); (byBar[i] = byBar[i] || []).push(o);
    });
    var recent = {}; e.m.slice().sort(function (a, z) { return z.t - a.t; }).slice(0, mob() ? 6 : 10).forEach(function (m) { recent[m.t + '|' + m.kind] = 1; });
    var yref = 'y';
    ['SHN', 'UT', 'SD'].forEach(function (s) {
      var a = sets[s]; if (!a.length) return;
      T.push({ type: 'scatter', mode: 'markers+text', x: a.map(function (o) { return x[o.i]; }), y: a.map(function (o) { return o.y; }), yaxis: yref,
        name: SHORT[s] + ' signals', legendgroup: 'ckmk-' + s, showlegend: true, cliponaxis: true,
        text: a.map(function (o) { return recent[o.m.t + '|' + o.m.kind] ? SHORT[s] + (o.up ? ' B' : isExit(o.m) ? ' X' : ' S') : ''; }),
        textposition: a.map(function (o) { return o.up ? 'bottom center' : 'top center'; }),
        textfont: { size: mob() ? 8.5 : 9.5, color: a.map(function (o) { return o.up ? COL[s].b : COL[s].s; }) },
        marker: { size: mob() ? 9 : 11, symbol: a.map(function (o) { return o.up ? 'triangle-up' : isExit(o.m) ? 'x-thin-open' : 'triangle-down'; }),
          color: a.map(function (o) { return o.up ? COL[s].b : COL[s].s; }), line: { color: a.map(function (o) { return o.up ? COL[s].b : COL[s].s; }), width: 1.5 } },
        hovertext: a.map(function (o) { return esc(o.m.kind) + ' @ ' + px(o.m.price) + ' · ' + ist(o.m.t, w.tf === 'D') + ' IST'; }), hoverinfo: 'text',
        customdata: a.map(function (o) { return o.i; }) });
    });
    MK.last = { w: w, byBar: byBar, n: e.m.length };
  }
  function pop(i, el) {
    var old = d.querySelector('.ckmkpop'); if (old) old.remove();
    var L = MK.last; if (!L || !L.byBar[i]) return;
    var host = el.parentNode; if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    var tf = L.w.tf, b = FXV.bars;
    var rows = L.byBar[i].map(function (o) {
      var m = o.m, c = o.up ? COL[o.s].b : COL[o.s].s;
      return '<div class="r"><b style="color:' + c + '">' + (o.up ? '▲ ' : isExit(m) ? '✕ ' : '▼ ') + esc(m.kind) + '</b> @ <b>' + px(m.price) + '</b>' +
        (m.level != null ? '<span class="mu"> · stop/trail ' + px(m.level) + '</span>' : '') +
        '<div class="mu">' + (tf === 'D' ? 'Day ' + ist(m.t, true) : 'Bar ' + ist(m.t) + ' IST') + (m.logged_ist ? ' · alert logged ' + esc(String(m.logged_ist).slice(5, 16)) + ' IST' : '') + ' · ' + esc(m.src || '') + '</div></div>';
    }).join('');
    var p = d.createElement('div'); p.className = 'ckmkpop';
    p.innerHTML = '<button class="x" type="button" aria-label="Close">×</button><div class="h">' + esc(L.w.name) + ' · ' + esc(tf === 'D' ? 'D' : tf.toUpperCase()) + ' · ' + esc(tf === 'D' ? ist(b.t[i], true) : ist(b.t[i]) + ' IST') + '</div>' + rows;
    var xa = el._fullLayout.xaxis, ya = el._fullLayout.yaxis, v = xa.range, cx = xa._offset + (i - v[0]) / (v[1] - v[0]) * xa._length;
    p.style.left = Math.max(4, Math.min(el.clientWidth - 284, cx - 140) + el.offsetLeft) + 'px';
    p.style.top = (el.offsetTop + (ya ? ya._offset : 40) + 4) + 'px';
    p.querySelector('.x').onclick = function () { p.remove(); };
    host.appendChild(p);
  }
  function bind(el) {
    if (!el || !el.on || el.dataset.ckmk) return; el.dataset.ckmk = '1';
    el.on('plotly_click', function (ev) {
      var L = MK.last; if (!L || !ev || !ev.points) return;
      var pt = ev.points.find(function (p) { return p.data && /^ckmk-/.test(p.data.legendgroup || ''); });
      var i = pt ? pt.customdata : (ev.points[0] && typeof ev.points[0].pointIndex === 'number' && ev.points[0].data && ev.points[0].data.type === 'candlestick' ? ev.points[0].pointIndex : null);
      if (i != null && L.byBar[i]) pop(i, el);
    });
  }
  function boot() {
    if (typeof window.fxDraw !== 'function' || !window.Plotly) { if (Date.now() - T0 < 20000) return setTimeout(boot, 300); return; }
    if (window.fxDraw._ckmk) return;
    var s = d.createElement('style');
    s.textContent = '.ckmkpop{position:absolute;z-index:30;width:276px;max-width:calc(100vw - 16px);background:#161b22;border:1px solid #30363d;border-radius:10px;padding:8px 26px 8px 10px;font:12px system-ui,sans-serif;color:#e6edf3;box-shadow:0 6px 20px rgba(0,0,0,.55)}' +
      '.ckmkpop .h{font-weight:700;margin-bottom:4px;color:#8b949e}.ckmkpop .r{padding:4px 0;border-top:1px solid #21262d}.ckmkpop .r:first-of-type{border-top:0}.ckmkpop .mu{color:#8b949e;font-size:11px}' +
      '.ckmkpop .x{position:absolute;right:4px;top:2px;background:none;border:0;color:#8b949e;font-size:18px;cursor:pointer;padding:2px 6px}';
    d.head.appendChild(s);
    var _draw = window.fxDraw;
    var wrapped = function () {
      var react = Plotly.react, r;
      Plotly.react = function (gd, data, layout, cfg) { try { var id = typeof gd === 'string' ? gd : gd && gd.id; if (id === 'fxchart') addTraces(data, layout); } catch (e) {} return react.apply(this, arguments); };
      try { r = _draw.apply(this, arguments); } finally { Plotly.react = react; }
      bind($('fxchart'));
      return r;
    };
    wrapped._ckmk = 1; window.fxDraw = wrapped;
    var _close = window.fxClose;
    if (typeof _close === 'function') window.fxClose = function () { var r = _close.apply(this, arguments); var el = $('fxchart'); if (el) delete el.dataset.ckmk; var p = d.querySelector('.ckmkpop'); if (p) p.remove(); return r; };
    try { if (window.FXV && FXV.open && FXV.bars) fxDraw(); } catch (e) {}
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 50); }); else setTimeout(boot, 50);
})();
