/* Proposed cleanup v1 (16 Nov 2026) — branch proposed-cleanup-20261116 only, NOT live.
   Read-only UI changes; no order endpoints, no keys. Turn off on a device with localStorage.cleanup_off='1'.
   1. Fewer duplicate pages: Radar, DC20+SHN, Live feed, Roadmap move under "More"; on Commodities the MCX Live table
      (same prices as the Hub) and the stale Yahoo research panels fold into closed sections.
   2. Stale-data warning on the Yahoo research data; calendar reads the VPS feed first, then data/calendar.json.
   3. Sector rotation: wheel/trackpad zoom + drag-pan on laptop; on phone one finger scrolls the page, two fingers zoom/pan; − + ⟲ buttons.
   4. Candle chart: smooth zoom (one coalesced redraw per frame instead of 3 per wheel notch), live ticks redraw at most every 1.5 s
      and never mid-gesture; event markers become short labelled badges (title + IST time) on non-overlapping rows; tap a badge
      for the full headline.
   5. DC20 tab: MCX close time shows 23:55 IST in US winter (was always 23:30). */
(function () {
  'use strict';
  try { if (localStorage.getItem('cleanup_off') === '1') return; } catch (e) {}
  var $ = function (id) { return document.getElementById(id); };
  var mob = function () { return window.innerWidth < 640; };
  function css(t) { var s = document.createElement('style'); s.textContent = t; document.head.appendChild(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function istFmt(ms, withDay) {
    var d = new Date(ms + 19800000), mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()], wd = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()];
    var hm = ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2);
    return withDay ? wd + ' ' + d.getUTCDate() + ' ' + mo + ', ' + hm : hm;
  }
  function usWinter(ms) {   // true while New York is on standard time
    try { var p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' }).formatToParts(new Date(ms || Date.now()));
      return (p.find(function (x) { return x.type === 'timeZoneName'; }) || {}).value === 'EST'; } catch (e) { return false; }
  }
  css('#nav .ckmore{border:1px dashed #30363d}#nav button.ckhid{display:none}#nav.ckshow button.ckhid{display:inline-block;opacity:.8}' +
      '.ckfold{margin:12px 0;border:1px solid #30363d;border-radius:10px;background:#0d1117}.ckfold>summary{cursor:pointer;padding:10px 14px;font-weight:600;color:#c9d1d9;list-style:none}' +
      '.ckfold>summary::before{content:"▸ ";color:#8b949e}.ckfold[open]>summary::before{content:"▾ "}.ckfold>summary .sub{font-weight:400;color:#8b949e;font-size:12px}' +
      '.ckstale{color:#e3b341;font-weight:600}' +
      '.ckzbar{position:absolute;right:8px;top:8px;z-index:5;display:flex;gap:4px}.ckzbar button{min-width:34px;height:32px;border-radius:8px;border:1px solid #30363d;background:#161b22;color:#e6edf3;font-size:16px}' +
      '#rrg{touch-action:pan-y}' +
      '.ckpop{position:absolute;z-index:30;max-width:min(360px,86vw);background:#161b22;border:1px solid #e3b341;border-radius:10px;padding:10px 12px;color:#e6edf3;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.5)}' +
      '.ckpop .t{font-weight:700;margin:4px 0}.ckpop .m{color:#8b949e;font-size:12px}.ckpop .x{position:absolute;right:6px;top:4px;background:none;border:0;color:#8b949e;font-size:18px}' +
      '.ckpop .imp{display:inline-block;padding:1px 6px;border-radius:6px;font-size:11px;margin-right:6px;border:1px solid #30363d}.ckpop .imp.high{color:#f85149;border-color:#f85149}.ckpop .imp.med{color:#e3b341;border-color:#e3b341}' +
      '@media (max-width:640px){body.fxopen #proFab{display:none}}' +
      '.fxev .cktime{color:#8b949e;font-size:11px;margin-right:6px;white-space:nowrap}');

  /* ---------- 1. navigation: duplicate / laptop-only pages under "More" ---------- */
  var MORE = { radar: 'Market Radar on the cloud server · full map ↗', dc20: 'same prices/signals as the Hub, PRO and Screener; laptop parts offline', live: 'settings only', roadmap: 'developer notes' };
  function nav() {
    var n = $('nav'); if (!n || n.dataset.ck) return; n.dataset.ck = '1';
    Object.keys(MORE).forEach(function (t) { var b = n.querySelector('[data-tab="' + t + '"]'); if (b) { b.classList.add('ckhid'); b.title = 'Moved under More: ' + MORE[t]; } });
    var m = document.createElement('button'); m.type = 'button'; m.className = 'ckmore'; m.textContent = 'More ▾';
    m.onclick = function (e) { e.stopPropagation(); n.classList.toggle('ckshow'); m.textContent = n.classList.contains('ckshow') ? 'Less ▴' : 'More ▾'; };
    n.appendChild(m);
  }
  /* ---------- Commodities: fold duplicates + stale research ---------- */
  function fold(nodes, title, sub, open) {
    nodes = nodes.filter(Boolean); if (!nodes.length || nodes[0].closest('.ckfold')) return;
    var d = document.createElement('details'); d.className = 'ckfold'; if (open) d.open = true;
    d.innerHTML = '<summary>' + title + ' <span class="sub">' + sub + '</span></summary>';
    nodes[0].parentNode.insertBefore(d, nodes[0]); nodes.forEach(function (x) { d.appendChild(x); });
    d.addEventListener('toggle', function () { if (d.open) setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 50); });
  }
  function dataAgeDays() { try { var a = (typeof DATA !== 'undefined' && DATA.asof) || ''; var t = Date.parse(a); return isFinite(t) ? Math.floor((Date.now() - t) / 864e5) : null; } catch (e) { return null; } }
  function commodities() {
    var tab = $('tab-commodities'); if (!tab) return;
    fold([$('mcxpanel')], 'MCX Live table', '· same prices as the Hub above, plus OHLC / volume / OI / expiry', false);
    var age = dataAgeDays(), st = age != null && age > 3 ? '<span class="ckstale">Yahoo daily data is ' + age + ' days old</span> · ' : '';
    var res = [$('ccards')].concat([].slice.call(tab.querySelectorAll(':scope > .panel')).filter(function (p) { return /Price chart|Rolling correlation|Driver deep-dive/.test((p.querySelector('h2') || {}).textContent || ''); }));
    fold(res, 'Research: global prices, indicators, correlation, drivers', '· ' + st + 'not live; the MCX prices above are live', false);
  }
  function staleBanner() {
    var a = $('asof'), age = dataAgeDays(); if (!a || age == null || age <= 3 || a.dataset.ck) return; a.dataset.ck = '1';
    var s = document.createElement('div'); s.className = 'ckstale'; s.style.fontSize = '12px';
    s.textContent = '⚠ Research data (Yahoo: heat map globals, macro, sector rotation, Nifty stats) is ' + age + ' days old — MCX prices, charts and signals are live.';
    a.parentNode.insertBefore(s, a.nextSibling);
  }

  /* ---------- 2. calendar: VPS feed first, then the file ---------- */
  var _feedLoad = window.feedLoad;
  if (typeof _feedLoad === 'function') {
    window.feedLoad = async function () {
      var r = await _feedLoad.apply(this, arguments);
      try {
        if (window.VPSB && VPSB.active()) {
          var j = await VPSB.get('/cockpit/calendar');
          if (j && Array.isArray(j.events) && (!FEED.cal || !FEED.cal.updated || Date.parse(j.updated) > Date.parse(FEED.cal.updated))) {
            FEED.cal = j; FEED.calErr = ''; renderCalendar(); try { renderNextUp(); } catch (e) {}
            if (window.FXV && FXV.open && FXV.bars) try { fxDraw(); } catch (e) {}
          }
        }
      } catch (e) { /* endpoint not deployed yet → keep data/calendar.json */ }
      try { var meta = $('calmeta'), u = FEED.cal && Date.parse(FEED.cal.updated); if (meta && u && Date.now() - u > 3 * 864e5) meta.insertAdjacentHTML('afterbegin', '<span class="ckstale">Calendar is ' + Math.floor((Date.now() - u) / 864e5) + ' days old. </span>'); } catch (e) {}
      return r;
    };
  }

  /* ---------- 3. sector rotation zoom ---------- */
  var _rrg = window.renderRRG;
  function rrgZoom(f, cx, cy) {   // f<1 zoom in; cx,cy = data-space centre
    var el = $('rrg'); if (!el || !el._fullLayout) return; var xa = el._fullLayout.xaxis.range, ya = el._fullLayout.yaxis.range;
    cx = cx == null ? (xa[0] + xa[1]) / 2 : cx; cy = cy == null ? (ya[0] + ya[1]) / 2 : cy;
    return Plotly.relayout(el, { 'xaxis.range': [cx - (cx - xa[0]) * f, cx + (xa[1] - cx) * f], 'yaxis.range': [cy - (cy - ya[0]) * f, cy + (ya[1] - cy) * f] });
  }
  function rrgBind(el) {
    if (el.dataset.ckz) return; el.dataset.ckz = '1';
    var host = el.parentNode; if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    var bar = document.createElement('div'); bar.className = 'ckzbar';
    bar.innerHTML = '<button type="button" data-z="out" title="Zoom out">−</button><button type="button" data-z="in" title="Zoom in">+</button><button type="button" data-z="reset" title="Reset">⟲</button>';
    bar.onclick = function (e) { var b = e.target.closest('button'); if (!b) return; if (b.dataset.z === 'reset') { el._ckr && Plotly.relayout(el, { 'xaxis.range': el._ckr[0].slice(), 'yaxis.range': el._ckr[1].slice() }); } else rrgZoom(b.dataset.z === 'in' ? 0.75 : 1 / 0.75); };
    host.insertBefore(bar, el);
    // two-finger pinch/pan on phones (one finger scrolls the page); rAF-coalesced, one relayout in flight at a time
    var pin = null, raf = 0, busy = false, want = null;
    function pt(t, r) { var fl = el._fullLayout, xa = fl.xaxis, ya = fl.yaxis; return { x: xa.p2l(t.clientX - r.left - xa._offset), y: ya.p2l(t.clientY - r.top - ya._offset) }; }
    function flush() { raf = 0; if (!want || busy) return; var u = want; want = null; busy = true; Plotly.relayout(el, u).then(function () { busy = false; if (want) flush(); }, function () { busy = false; }); }
    el.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 2 || !el._fullLayout) return; var r = el.getBoundingClientRect(), fl = el._fullLayout;
      var d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY) || 1;
      pin = { d: d, xr: fl.xaxis.range.slice(), yr: fl.yaxis.range.slice(), mx: (e.touches[0].clientX + e.touches[1].clientX) / 2, my: (e.touches[0].clientY + e.touches[1].clientY) / 2, r: r };
      e.preventDefault();
    }, { passive: false, capture: true });
    el.addEventListener('touchmove', function (e) {
      if (!pin || e.touches.length !== 2) return; e.preventDefault(); e.stopPropagation();
      var d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY) || 1, f = Math.max(0.15, Math.min(6, pin.d / d));
      var fl = el._fullLayout, xa = fl.xaxis, ya = fl.yaxis, sx = (pin.xr[1] - pin.xr[0]) / xa._length, sy = (pin.yr[1] - pin.yr[0]) / ya._length;
      var cx = pin.xr[0] + (pin.mx - pin.r.left - xa._offset) * sx, cy = pin.yr[1] - (pin.my - pin.r.top - ya._offset) * sy;
      var mx = (e.touches[0].clientX + e.touches[1].clientX) / 2, my = (e.touches[0].clientY + e.touches[1].clientY) / 2, dx = (mx - pin.mx) * sx * f, dy = (my - pin.my) * sy * f;
      want = { 'xaxis.range': [cx - (cx - pin.xr[0]) * f - dx, cx + (pin.xr[1] - cx) * f - dx], 'yaxis.range': [cy - (cy - pin.yr[0]) * f + dy, cy + (pin.yr[1] - cy) * f + dy] };
      if (!raf) raf = requestAnimationFrame(flush);
    }, { passive: false, capture: true });
    el.addEventListener('touchend', function (e) { if (e.touches.length < 2) pin = null; }, { passive: true, capture: true });
  }
  if (typeof _rrg === 'function') {
    window.renderRRG = function () {
      _rrg.apply(this, arguments);
      var el = $('rrg'); if (!el || !el.data) return;
      var m = mob(); el.layout.dragmode = m ? false : 'pan';
      var cfg = { displaylogo: false, responsive: true, displayModeBar: m ? false : 'hover', modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d', 'toggleSpikelines', 'zoom2d'], scrollZoom: !m, doubleClick: 'reset', showTips: false };
      Plotly.react(el, el.data, el.layout, cfg).then(function () { el._ckr = [el.layout.xaxis.range.slice(), el.layout.yaxis.range.slice()]; rrgBind(el); });
    };
  }

  /* ---------- 4. candle chart: smooth zoom, throttled live redraw, readable event badges ---------- */
  var INT = { until: 0 };   // "user is interacting" window
  function interacting() { return Date.now() < INT.until; }
  function touchInt(ms) { INT.until = Math.max(INT.until, Date.now() + (ms || 500)); }
  // 4a. one relayout in flight at a time; extra requests collapse into one follow-up
  var _apply = window.fxApplyView;
  if (typeof _apply === 'function') {
    var busy = false, again = false;
    window.fxApplyView = function () {
      var el = $('fxchart'), b = FXV.bars; if (!b || !FXV.view) return;
      if (!el || !el._fullLayout || !el.classList.contains('js-plotly-plot')) return fxDraw();
      if (busy) { again = true; return; }
      busy = true; var y = fxYRange(b, FXV.view), u = { 'xaxis.range': FXV.view.slice() }; if (y) u['yaxis.range'] = y;
      FXV.fitting = true;
      Plotly.relayout(el, u).then(done, done); fxZoomLbl(); badgeRelayoutSoon();
      function done() { FXV.fitting = false; busy = false; if (again) { again = false; window.fxApplyView(); } }
    };
  }
  // 4b. wheel → bar zoom at the cursor, rAF-coalesced (Plotly's own scrollZoom + y re-fit did 3 redraws per notch)
  function bindWheel(el) {
    if (el.dataset.ckw) return; el.dataset.ckw = '1'; var acc = 0, pan = 0, anchor = 1, raf = 0;
    el.addEventListener('wheel', function (e) {
      if (!FXV.bars || !el._fullLayout) return; e.preventDefault(); e.stopPropagation(); touchInt(600);
      var xa = el._fullLayout.xaxis, r = el.getBoundingClientRect(); anchor = Math.max(0, Math.min(1, (e.clientX - r.left - xa._offset) / xa._length));
      var dx = e.deltaX, dy = e.deltaY; if (e.deltaMode === 1) { dx *= 16; dy *= 16; }
      if (Math.abs(dx) > Math.abs(dy) || e.shiftKey) pan += (e.shiftKey ? dy || dx : dx); else acc += dy;
      if (!raf) raf = requestAnimationFrame(function () {
        raf = 0; var v = FXV.view || fxDefView(FXV.bars.c.length);
        if (pan) { var w = v[1] - v[0], d = pan / xa._length * w; pan = 0; var n = FXV.bars.c.length, hi = Math.min(n - 0.5 + fxPad(), v[1] + d), lo = hi - w; if (lo < -0.5 - w * 0.5) { lo = -0.5 - w * 0.5; hi = lo + w; } FXV.view = [lo, hi]; fxApplyView(); }
        if (acc) { var f = Math.exp(acc * (e.ctrlKey ? 0.01 : 0.0015)); acc = 0; fxZoomBars(f, anchor); }
      });
    }, { passive: false, capture: true });
    ['pointerdown', 'touchstart'].forEach(function (t) { el.addEventListener(t, function () { touchInt(1500); }, { passive: true, capture: true }); });
    ['pointermove', 'touchmove'].forEach(function (t) { el.addEventListener(t, function (e) { if (e.buttons || (e.touches && e.touches.length)) touchInt(800); }, { passive: true, capture: true }); });
  }
  // 4c. live ticks: update the bar every tick, redraw at most every 1.5 s and never mid-gesture
  var _live = window.fxLiveBar, lastDraw = 0, pend = null;
  if (typeof _live === 'function') {
    window.fxLiveBar = function (noDraw) {
      if (noDraw) return _live(true);
      var b = FXV.bars, r = FXV.open; if (!r || !b || !b.c.length) return;
      var step = FXV.tf === 'D' ? 86400 : (+FXV.tf) * 60, now = Date.now() / 1000;
      if (now >= b.t[b.t.length - 1] + step + 60) return _live(false);   // new bar → original refetch path
      _live(true);   // mutate the last bar only
      if (pend) return; var wait = Math.max(0, 1500 - (Date.now() - lastDraw));
      pend = setTimeout(function tick() { if (interacting()) { pend = setTimeout(tick, 400); return; } pend = null; lastDraw = Date.now(); try { fxDraw(); } catch (e) {} }, wait);
    };
  }
  // 4d. event badges
  /* Events lane: a strip BELOW the price/indicator panes, sharing the candle x-axis (zooms/pans in sync), dates under it. */
  var LANE_ROW_PX = 19;
  function laneRows() { return mob() ? 3 : 4; }
  function shortTitle(t, n) { t = String(t || '').replace(/\s+/g, ' ').trim(); var cut = t.split(/[;:—–(]/)[0].trim(); if (cut.length >= 6) t = cut; return t.length > n ? t.slice(0, n - 1) + '…' : t; }
  function badgeText(p) { return (p.kind === 'pin' ? '◆ ' : '◇ ') + shortTitle(p.title, mob() ? 13 : 22) + ' · ' + (FXV.tf === 'D' ? istFmt(p.when, true).replace(/, \d\d:\d\d$/, '') : istFmt(p.when, false)); }
  function layoutBadges(placed, el) {   // greedy rows in pixel space for the current view; returns rows used
    var v = (el && el._fullLayout && el._fullLayout.xaxis.range) || FXV.view || fxDefView(FXV.bars.c.length);
    var W = (el && el._fullLayout ? el._fullLayout.xaxis._length : (el ? el.clientWidth - 70 : 600)) || 600, ppb = W / Math.max(1, v[1] - v[0]);
    var ends = [], maxRows = Math.min(laneRows(), FXV._laneRows || laneRows()), rows = 0;
    placed.slice().sort(function (a, b) { return a.xnum - b.xnum; }).forEach(function (p) {
      var w = badgeText(p).length * (mob() ? 5.5 : 6.1) + 12, cx = (p.xnum - v[0]) * ppb, l = Math.max(0, cx - w / 2), r = l + w;
      if (r > W) { r = W; l = W - w; }
      p.vis = p.xnum >= v[0] - 0.5 && p.xnum <= v[1] + 0.5;
      if (!p.vis) { p.row = 0; return; }
      var row = 0; while (row < ends.length && ends[row] > l - 4) row++;
      if (row >= maxRows) { p.row = -1; return; }   // no room at this zoom: still in the list under the chart
      ends[row] = r; p.row = row; rows = Math.max(rows, row + 1);
    });
    return rows;
  }
  function badgeAnn(p, yref, nrows) {
    var gold = '#e3b341', hi = p.impact === 'high', pin = p.kind === 'pin';
    return { x: p.xnum, y: nrows - p.row - 0.5, xref: 'x', yref: yref || '__lane', text: esc(badgeText(p)), showarrow: false, yanchor: 'middle', xanchor: 'center', captureevents: true,
      font: { size: mob() ? 9.5 : 10.5, color: pin ? '#0d1117' : (hi ? '#ffd8a8' : gold) }, bgcolor: pin ? gold : 'rgba(13,17,23,.95)', bordercolor: hi ? '#f85149' : gold, borderwidth: 1.2, borderpad: 2,
      visible: p.vis && p.row >= 0, name: 'ckev-' + p.n, hovertext: esc(istFmt(p.when, true) + ' IST — ' + p.title) };
  }
  var _marks = window.fxFeedMarks;
  if (typeof _marks === 'function') {
    window.fxFeedMarks = function (r, b, x, shapes, ann, T, m) {
      var a0 = ann.length, s0 = shapes.length;
      _marks.apply(this, arguments);
      ann.splice(a0, ann.length - a0);   // drop the numbered badges at the top
      for (var i = s0; i < shapes.length; i++) { shapes[i].opacity = (shapes[i].opacity || 1) * 0.45; shapes[i].y0 = 0; shapes[i].y1 = 1; }
      FXV.feedTop = 0; FXV._laneRows = 0;
      var placed = FXV.feedMarks || []; if (!placed.length) return;
      FXV._laneRows = Math.min(laneRows(), placed.length);
      layoutBadges(placed, $('fxchart'));
      placed.forEach(function (p) { ann.push(badgeAnn(p, '__lane', FXV._laneRows)); });
    };
  }
  // reshape the layout fxDraw hands to Plotly: add the lane axis at the bottom, shrink the panes above it, put dates under the lane
  function addLane(L, T) {
    var n = FXV._laneRows || 0; if (!n || !L) return;
    var H = L.height || 500, mb = (L.margin && L.margin.b) || 28, mt = (L.margin && L.margin.t) || 28, plotH = Math.max(200, H - mb - mt);
    var lanePx = n * LANE_ROW_PX + 8, frac = Math.min(0.3, lanePx / plotH), gap = Math.min(0.04, 10 / plotH);
    var k = 1; Object.keys(L).forEach(function (key) { var m = /^yaxis(\d*)$/.exec(key); if (m) k = Math.max(k, +(m[1] || 1)); });
    var lane = 'y' + (k + 1), top = frac + gap;
    Object.keys(L).forEach(function (key) { var ax = L[key]; if (/^yaxis\d*$/.test(key) && ax && ax.domain) ax.domain = [top + ax.domain[0] * (1 - top), top + ax.domain[1] * (1 - top)]; });
    if (L.yaxis && !L.yaxis.domain) L.yaxis.domain = [top, 1];
    L['yaxis' + (k + 1)] = { domain: [0, frac], range: [0, n], fixedrange: true, showgrid: false, zeroline: false, showticklabels: false, showline: false };
    L.xaxis = L.xaxis || {}; L.xaxis.anchor = lane;
    (L.annotations || []).forEach(function (a) { if (a.yref === '__lane') a.yref = lane; });
    L.shapes = L.shapes || [];
    L.shapes.unshift({ type: 'rect', xref: 'paper', x0: 0, x1: 1, yref: 'paper', y0: 0, y1: frac, fillcolor: 'rgba(227,179,65,.05)', line: { color: 'rgba(227,179,65,.25)', width: 1 }, layer: 'below', name: 'cklane' });
    L.annotations = L.annotations || [];
    L.annotations.push({ xref: 'paper', x: 0, yref: 'paper', y: frac, text: 'EVENTS (IST) · tap', showarrow: false, xanchor: 'left', yanchor: 'bottom', font: { size: 9, color: '#8b949e' }, name: 'cklanelbl' });
    FXV._lane = lane;
  }
  var relT = 0;
  function badgeRelayoutSoon() {
    clearTimeout(relT); relT = setTimeout(function () {
      var el = $('fxchart'), placed = FXV.feedMarks || []; if (!el || !el.layout || !placed.length || !FXV.bars || !FXV._lane) return;
      layoutBadges(placed, el);
      var anns = (el.layout.annotations || []).filter(function (a) { return !(a.name || '').startsWith('ckev-'); });
      placed.forEach(function (p) { anns.push(badgeAnn(p, FXV._lane, FXV._laneRows)); });
      FXV.fitting = true; Plotly.relayout(el, { annotations: anns }).then(function () { FXV.fitting = false; }, function () { FXV.fitting = false; });
    }, 150);
  }
  function showPop(p, el) {
    var old = document.querySelector('.ckpop'); if (old) old.remove(); if (!p) return;
    var host = el.parentNode; if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    var d = document.createElement('div'); d.className = 'ckpop';
    var line = p.bias || p.note || '', url = p.url ? '<div class="m"><a href="' + esc(p.url) + '" target="_blank" rel="noopener">Source ↗</a></div>' : '';
    d.innerHTML = '<button class="x" type="button" aria-label="Close">×</button><div class="m"><span class="imp ' + esc(p.impact) + '">' + esc(p.impact) + '</span>' + (p.kind === 'pin' ? 'News' : 'Scheduled') + ' · ' + esc(istFmt(p.when, true)) + ' IST</div>' +
      '<div class="t">' + esc(p.title) + '</div>' + (line ? '<div>' + esc(line) + '</div>' : '') + url;
    var xa = el._fullLayout.xaxis, v = xa.range, px = xa._offset + (p.xnum - v[0]) / (v[1] - v[0]) * xa._length;
    var ly = el._fullLayout[(FXV._lane || 'y').replace('y', 'yaxis')] || el._fullLayout.yaxis, laneTop = ly ? ly._offset : el.clientHeight - 80;
    d.style.top = (el.offsetTop + laneTop - 6) + 'px'; d.style.transform = 'translateY(-100%)'; d.style.left = Math.max(4, Math.min(el.clientWidth - 300, px - 150) + el.offsetLeft) + 'px';
    d.querySelector('.x').onclick = function () { d.remove(); };
    host.appendChild(d);
  }
  function bindBadges(el) {
    if (el.dataset.ckb) return; el.dataset.ckb = '1';
    el.on('plotly_clickannotation', function (ev) {
      var nm = ev && ev.annotation && ev.annotation.name || ''; if (!nm.startsWith('ckev-')) return;
      var n = +nm.slice(5), p = (FXV.feedMarks || []).find(function (q) { return q.n === n; }); if (!p) return;
      FXV.feedSel = p.id; try { fxFeedFoot(); } catch (e) {} showPop(p, el);
    });
    el.on('plotly_click', function (ev) { var pt = ev.points && ev.points[0]; if (!pt || !pt.data || pt.data.legendgroup !== 'feed') return; var p = (FXV.feedMarks || []).find(function (q) { return q.id === pt.customdata; }); showPop(p, el); });
  }
  var _foot = window.fxFeedFoot;
  if (typeof _foot === 'function') {
    window.fxFeedFoot = function () {
      _foot.apply(this, arguments);
      var box = $('fxpin'); if (!box) return;
      box.querySelectorAll('.fxev').forEach(function (btn) { var p = (FXV.feedMarks || []).find(function (q) { return q.id === btn.dataset.fid; }); if (!p || btn.querySelector('.cktime')) return;
        var b = btn.querySelector('span > b'); if (b) b.insertAdjacentHTML('beforebegin', '<span class="cktime">' + esc(istFmt(p.when, true)) + ' IST</span>'); });
    };
  }
  var _close = window.fxClose;   // Plotly.purge drops plotly_* listeners: re-bind them on the next open
  if (typeof _close === 'function') window.fxClose = function () { var r = _close.apply(this, arguments); var el = $('fxchart'); if (el) { delete el.dataset.ckb; delete el.dataset.ckrl; } var pp = document.querySelector('.ckpop'); if (pp) pp.remove(); return r; };
  var _draw = window.fxDraw;
  if (typeof _draw === 'function') {
    window.fxDraw = function () {
      var react = Plotly.react, r;
      Plotly.react = function (gd, data, layout, cfg) { try { var id = typeof gd === 'string' ? gd : gd && gd.id; if (id === 'fxchart') { addLane(layout, data); cfg = Object.assign({}, cfg, { scrollZoom: false }); } } catch (e) {} return react.call(this, gd, data, layout, cfg); };
      try { r = _draw.apply(this, arguments); } finally { Plotly.react = react; }
      var el = $('fxchart');
      if (el && el.on) { bindWheel(el); bindBadges(el); if (!el.dataset.ckrl) { el.dataset.ckrl = '1'; el.on('plotly_relayout', function (ev) { if (ev && (ev['xaxis.range[0]'] != null || ev['xaxis.range'])) badgeRelayoutSoon(); }); } }
      return r;
    };
  }

  /* ---------- 5. DC20 tab close time (US winter = 23:55 IST) ---------- */
  function fixClose() {
    var root = $('rt-dc'); if (!root) return; var w = usWinter();
    var walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), n;
    while ((n = walk.nextNode())) {
      if (n.nodeValue.indexOf('closes 23:30 IST') < 0) continue;
      if (!w) continue;
      var now = new Date(Date.now() + 19800000), mins = now.getUTCHours() * 60 + now.getUTCMinutes(), left = 23 * 60 + 55 - mins;
      n.nodeValue = n.nodeValue.replace(/closes 23:30 IST · [^·]*left/, 'closes 23:55 IST · ' + (left >= 60 ? Math.floor(left / 60) + 'h ' + (left % 60) + 'm' : left + 'm') + ' left');
    }
  }

  function boot() {
    try { nav(); } catch (e) {} try { commodities(); } catch (e) {} try { staleBanner(); } catch (e) {}
    setInterval(function () { try { fixClose(); } catch (e) {} }, 1000);
    setTimeout(function () { try { if (typeof window.feedLoad === 'function') window.feedLoad(); } catch (e) {} }, 1500);   // pull the VPS calendar once at start
    setInterval(function () { try { if (!document.hidden) window.feedLoad(); } catch (e) {} }, 30 * 60 * 1000);
    try { if ($('tab-rotation') && $('tab-rotation').classList.contains('active')) renderRRG(); } catch (e) {}
    try { if (window.FXV && FXV.open && FXV.bars) fxDraw(); } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.CKCLEAN = { v: 1 };
})();
