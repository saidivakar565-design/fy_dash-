/* Signal-group bots panel (PRO sheet → "Bots" tab; laptop: full-width strip on top).  READ-ONLY — never places orders.
   Groups: SD Rainbow (TradingView alert webhook → VPS) and SHN v3.4 (VPS screener → logger).
   Data:  GET https://srv2165780.hstgr.cloud/cockpit/bots  (X-API-KEY = OpenAlgo key saved on the Live feed tab, localStorage only)
   Live:  re-uses the PRO sheet's cloud OpenAlgo WebSocket (window.VPSPRO.S.ws) and subscribes the bots' open-trade symbols;
          falls back to /api/v1/multiquotes every 20 s for symbols with no fresh tick.
   Added 16 Nov 2026. No key or webhook token is stored in this repo. */
(function () {
  'use strict';
  var d = document, T0 = Date.now();
  function $(id) { return d.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n(v, dp) { if (v == null || v === '' || !isFinite(+v)) return '–'; v = +v; var p = dp == null ? (Math.abs(v) < 100 ? 2 : Math.abs(v) < 10000 ? 1 : 0) : dp; return v.toLocaleString('en-IN', { minimumFractionDigits: p, maximumFractionDigits: p }); }
  function sg(v, dp) { return v == null || !isFinite(v) ? '–' : (v > 0 ? '+' : '') + (+v).toFixed(dp == null ? 2 : dp); }
  function wide() { return window.innerWidth >= 1100; }
  var B = { j: null, at: 0, err: '', q: {}, qAt: 0, url: '', grp: localStorage.getItem('bots_grp') || 'all' };
  window.BOTSPANEL = B;

  function boot() {
    var V = window.VPSB, P = window.VPSPRO, tabs = $('proTabs'), body = $('proBody'), sheet = $('proSheet');
    if (!V || !P || !tabs || !body || !sheet) { if (Date.now() - T0 < 20000) return setTimeout(boot, 300); return; }
    if ($('pv-bots')) return;
    var S = P.S;
    var css = d.createElement('style');
    css.textContent = [
      '#pv-bots .bg{display:grid;grid-template-columns:1fr;gap:10px}',
      '#pv-bots .gh{display:flex;align-items:center;gap:8px;flex-wrap:wrap}#pv-bots .gh b{font-size:15px}',
      '#pv-bots .chips{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}#pv-bots .chips span{background:#0d1117;border:1px solid #21262d;border-radius:8px;padding:3px 7px;font-size:12px}',
      '#pv-bots .chips span i{font-style:normal;color:#8b949e;margin-right:4px}',
      '#pv-bots table td,#pv-bots table th{padding:5px 3px}#pv-bots .sm{font-size:11px}',
      '#pv-bots .src{font-size:11px;color:#8b949e}',
      '#pv-bots .url{word-break:break-all;font:12px ui-monospace,monospace;background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:6px;margin:6px 0}',
      '#pv-bots .live td.r{font-weight:800}',
      '#proTabs button[data-t="bots"] .b{display:inline-block;min-width:16px;margin-left:4px;padding:0 4px;border-radius:8px;background:#1f6feb;color:#fff;font-size:10px}',
      '#pv-bots .tw{overflow-x:auto;-webkit-overflow-scrolling:touch}#pv-bots td .s2{display:block;font-size:10px;color:#8b949e;font-weight:400}',
      '@media (min-width:1100px){#pv-bots{grid-column:1 / span 2;grid-row:3}#pv-bots .bg{grid-template-columns:1fr 1fr}}'
    ].join('\n');
    d.head.appendChild(css);
    var btn = d.createElement('button'); btn.type = 'button'; btn.dataset.t = 'bots'; btn.innerHTML = 'Bots<span class="b" id="botsCnt" style="display:none"></span>';
    tabs.insertBefore(btn, tabs.children[1] || null);
    var sec = d.createElement('section'); sec.className = 'pv'; sec.id = 'pv-bots';
    sec.innerHTML = '<h3>Signal-group bots · SD Rainbow + SHN</h3><div class="pvb" id="pvb-bots"></div>';
    body.insertBefore(sec, body.firstChild);

    function shown() { return sheet.classList.contains('on') && (wide() || S.tab === 'bots'); }
    function sync() {
      var on = shown(); sec.classList.toggle('on', on); btn.classList.toggle('on', S.tab === 'bots' && !wide());
      if (on && (!B.j || Date.now() - B.at > 60000)) load();
      if (on) paint();
    }
    tabs.addEventListener('click', function () { setTimeout(sync, 0); });
    new MutationObserver(function () { setTimeout(sync, 0); }).observe(sheet, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', function () { setTimeout(sync, 0); });
    sec.addEventListener('click', onClick);

    function load() {
      if (!V.key()) { paint(); return Promise.resolve(); }
      var t = localStorage.getItem('bots_test') === '1' ? '?test=1' : '';
      return V.get('/cockpit/bots' + t).then(function (j) { B.j = j; B.at = Date.now(); B.err = ''; badge(); subscribe(); paint(); })
        .catch(function (e) { B.err = e.message; paint(); });
    }
    function openTrades() { var o = []; ((B.j && B.j.groups) || []).forEach(function (g) { (g.open || []).forEach(function (x) { o.push(x); }); }); return o; }
    function syms() { var m = {}; openTrades().forEach(function (x) { if (x.symbol) m[(x.exchange || 'MCX') + '|' + x.symbol] = 1; }); return Object.keys(m); }
    function subscribe() {
      var w = S.ws; if (!w || w.readyState !== 1 || S.wsSt !== 'live') return;
      var add = syms().filter(function (k) { return !S.wsSubs[k.split('|')[1]]; });
      if (!add.length) return;
      add.forEach(function (k) { S.wsSubs[k.split('|')[1]] = 1; });
      w.send(JSON.stringify({ action: 'subscribe', mode: 'Quote', symbols: add.map(function (k) { var a = k.split('|'); return { exchange: a[0], symbol: a[1] }; }) }));
    }
    function tick(sym) { var t = S.tk[sym]; if (t && t.ltp && Date.now() - t.at < 120000) return { p: t.ltp, at: t.at, live: 1 }; var q = B.q[sym]; return q ? { p: q.ltp, at: q.at, live: 0 } : null; }
    function pollQuotes() {
      var need = syms().filter(function (k) { var t = S.tk[k.split('|')[1]]; return !(t && Date.now() - t.at < 30000); });
      if (!need.length || !V.key()) return;
      V.api('multiquotes', { symbols: need.slice(0, 40).map(function (k) { var a = k.split('|'); return { symbol: a[1], exchange: a[0] }; }) }).then(function (j) {
        (j.results || []).forEach(function (r) { if (r.data && r.data.ltp) B.q[r.symbol] = { ltp: +r.data.ltp, at: Date.now() }; });
      }).catch(function () {});
    }
    function dot(t) { var a = t ? Date.now() - t.at : 1e9; return '<i class="dot ' + (t && t.live && a < 5000 ? 'g' : a < 60000 ? 'a' : '') + '"></i>'; }
    function badge() { var c = $('botsCnt'), k = openTrades().length; if (c) { c.textContent = k; c.style.display = k ? '' : 'none'; } }

    function rNow(x, p) { var side = x.dir === 'SELL' ? -1 : 1, rk = Math.abs((x.entry || 0) - (x.stop || 0)); return p && rk ? side * (p - x.entry) / rk : null; }
    function status(x, p) {
      if (!p) return '<span class="mu">no tick</span>';
      var side = x.dir === 'SELL' ? -1 : 1, st = x.trail != null ? x.trail : x.stop;
      if (st != null && side * (p - st) <= 0) return '<span class="dn">stop/trail crossed</span>';
      if (x.t1 != null && side * (p - x.t1) >= 0) return '<span class="ok">≥ T1</span>';
      return '<span>open</span>';
    }
    function tfL(t) { return t === 'D' ? 'Daily' : String(t || '').toUpperCase() || '–'; }
    function group(g) {
      var s = g.stats || {}, open = g.open || [], sig = g.signals || [];
      var h = '<div class="card"><div class="gh"><b>' + esc(g.name) + '</b><span class="tag">' + open.length + ' open</span>' +
        (g.id === 'shn' && g.last_scan_ist ? '<span class="tag">scan ' + esc(g.last_scan_ist) + '</span>' : '') + '</div>' +
        '<div class="src">' + esc(g.source) + '</div>' +
        '<div class="chips"><span><i>Signals today</i>' + (g.signals_today || 0) + '</span><span><i>Logged</i>' + (g.total_signals || 0) + '</span>' +
        '<span><i>Closed</i>' + (s.closed || 0) + '</span><span><i>Win%</i>' + (s.win_pct == null ? '–' : s.win_pct) + '</span>' +
        '<span><i>Avg R</i><b class="' + (s.avg_r > 0 ? 'ok' : s.avg_r < 0 ? 'dn' : '') + '">' + sg(s.avg_r) + '</b></span><span><i>Total R</i>' + sg(s.total_r) + '</span>' +
        '<span><i>Last</i>' + esc(g.last_signal_ist ? g.last_signal_ist.slice(5, 16) + ' IST' : '–') + '</span></div>';
      if (open.length) {
        var rows = open.map(function (x) {
          var t = tick(x.symbol), p = t ? t.p : (x.ltp_scan || null), R = rNow(x, p), dir = x.dir === 'SELL' ? 'sell' : 'buy';
          return '<tr><td><b>' + esc(x.name) + '</b><span class="s2">' + esc(tfL(x.tf)) + (x.test ? ' · TEST' : '') + ' · ' + status(x, t ? t.p : null) + '</span></td><td><span class="bd ' + dir + '">' + (dir === 'buy' ? 'BUY' : 'SELL') + '</span></td>' +
            '<td>' + n(x.entry) + '<span class="s2">SL ' + n(x.trail != null ? x.trail : x.stop) + '</span></td><td>' + dot(t) + n(p) + '</td>' +
            '<td class="r ' + (R > 0 ? 'ok' : R < 0 ? 'dn' : 'mu') + '">' + (R == null ? '–' : sg(R) + 'R') + '</td></tr>';
        }).join('');
        h += '<div class="tw"><table class="live"><thead><tr><th>Name · status</th><th>Side</th><th>Entry / SL</th><th>LTP</th><th>R now</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      } else h += '<div class="mu" style="margin:6px 0">No open trade.</div>';
      if (g.id === 'sdrainbow' && !g.total_signals) {
        h += '<div class="warn" style="margin-top:8px">Waiting for the first SD Rainbow alert from TradingView. Create the alert on the chart with SD Rainbow + SDR Tester and paste this bot\'s webhook URL. ' +
          '<button class="btn" type="button" data-bots="url">Show webhook URL</button>' + (B.url ? '<div class="url" id="botsUrl">' + esc(B.url) + '</div><button class="btn" type="button" data-bots="copy">Copy</button> <span class="sm mu">Private — anyone with it can add signals (never orders).</span>' : '') + '</div>';
      }
      if (sig.length) {
        h += '<details' + (wide() ? ' open' : '') + ' style="margin-top:8px"><summary style="font-weight:700">Recent signals (' + sig.length + ')</summary><table><thead><tr><th>Bar / logged</th><th>Name</th><th>Event</th><th>Price</th><th>R</th></tr></thead><tbody>' +
          sig.slice(0, wide() ? 14 : 20).map(function (x) {
            return '<tr><td class="sm">' + esc(x.bar_time || '') + '<br><span class="mu">' + esc((x.ts_ist || '').slice(5, 16)) + '</span></td><td><b>' + esc(x.name) + '</b> <span class="sm mu">' + esc(tfL(x.tf)) + (x.test ? ' · TEST' : '') + '</span></td>' +
              '<td class="sm ' + (x.dir === 'BUY' ? 'ok' : x.dir === 'SELL' ? 'dn' : 'wn') + '">' + esc(x.kind) + '</td><td>' + n(x.price) + '</td><td class="' + (x.r > 0 ? 'ok' : x.r < 0 ? 'dn' : 'mu') + '">' + (x.r == null ? '' : sg(x.r) + 'R') + '</td></tr>';
          }).join('') + '</tbody></table></details>';
      }
      return h + '</div>';
    }
    function paint() {
      var el = $('pvb-bots'); if (!el || !shown()) return;
      if (!V.key()) { el.innerHTML = '<div class="warn">Paste your <b>OpenAlgo API key</b> once on the <b>Live feed</b> tab to see the bots.</div>'; return; }
      if (!B.j) { el.innerHTML = '<div class="st">' + (B.err ? '<span class="dn">' + esc(B.err) + '</span>' : 'Loading bots…') + '</div>'; return; }
      var gs = B.j.groups || [], f = B.grp;
      var h = '<div class="st"><button class="btn' + (f === 'all' ? ' on' : '') + '" data-grp="all" type="button">Both</button>' + gs.map(function (g) { return '<button class="btn' + (f === g.id ? ' on' : '') + '" data-grp="' + g.id + '" type="button">' + esc(g.name) + '</button>'; }).join('') +
        '<button class="btn" type="button" data-bots="reload">Reload</button><span>server ' + esc(B.j.time_ist) + ' IST · signals only, no orders</span></div>';
      var pv = $('pv-bots'), y = pv.scrollTop, y2 = $('proBody').scrollTop, op = [];
      [].forEach.call(el.querySelectorAll('details'), function (x, i) { op.push(x.open); });
      el.innerHTML = h + '<div class="bg">' + gs.filter(function (g) { return f === 'all' || g.id === f; }).map(group).join('') + '</div>';
      var ds = el.querySelectorAll('details'); op.forEach(function (o, i) { if (ds[i]) ds[i].open = o; });
      pv.scrollTop = y; $('proBody').scrollTop = y2;
    }
    function onClick(e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.grp) { B.grp = b.dataset.grp; localStorage.setItem('bots_grp', B.grp); paint(); }
      else if (b.dataset.bots === 'reload') load();
      else if (b.dataset.bots === 'url') V.get('/cockpit/bots/webhook').then(function (j) { B.url = j.url; paint(); }).catch(function (er) { B.err = er.message; paint(); });
      else if (b.dataset.bots === 'copy' && B.url) { try { navigator.clipboard.writeText(B.url); b.textContent = 'Copied'; } catch (er) {} }
    }
    setInterval(function () { if (shown()) { subscribe(); paint(); } }, 1500);
    setInterval(function () { if (shown()) pollQuotes(); }, 20000);
    setInterval(function () { if (shown() || (V.key() && d.visibilityState === 'visible')) load(); }, 60000);
    setTimeout(function () { if (V.key()) load(); }, 3000);
    sync();
  }
  boot();
})();
