/* PRO tools for the MCX cockpit — Cloud OpenAlgo (srv2165780.hstgr.cloud). READ-ONLY: no order buttons, no order endpoints.
   Panels: Signals (SHN v3.4, both directions) · Watch · P&L · Size · Clock.  Phone: one panel per tab.  Laptop (>= 1100 px): all panels side by side.
   Live: its own read-only WebSocket to wss://srv2165780.hstgr.cloud/ws (Quote mode) subscribed to every symbol shown here.
   Needs the OpenAlgo API key saved on the Live feed tab (localStorage only). */
(function () {
  'use strict';
  if (!window.VPSB) return;
  var V = window.VPSB, d = document;
  var WL_DEF = ['CRUDEOIL', 'CRUDEOILM', 'NATURALGAS', 'NATGASMINI', 'GOLD', 'GOLDM', 'SILVER', 'SILVERM', 'SILVERMIC', 'SILVER100', 'COPPER', 'ZINC', 'ZINCMINI', 'LEAD', 'LEADMINI', 'ALUMINIUM', 'ALUMINI', 'NICKEL', 'MCXBULLDEX'];
  var ROLL_DAYS = 3, PANELS = [['sig', 'Signals'], ['wl', 'Watch'], ['pnl', 'P&L'], ['size', 'Size'], ['clk', 'Clock']];
  var S = { tab: localStorage.getItem('pro_tab') || 'sig', open: false, con: null, conAt: 0, shn: null, shnAt: 0, shnErr: '', q: {}, qAt: 0, qErr: '', pb: null, pbAt: 0, pbErr: '',
    cal: null, sort: 'chg', sigTf: 'all', sigDir: localStorage.getItem('pro_dir') || 'all', tk: {}, dirty: {}, ws: null, wsSt: 'off', wsSubs: {}, wsN: 0 };
  function $(id) { return d.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n(v, dp) { if (v == null || v === '' || !isFinite(+v)) return '–'; v = +v; var p = dp == null ? (Math.abs(v) < 100 ? 2 : Math.abs(v) < 10000 ? 1 : 0) : dp; return v.toLocaleString('en-IN', { minimumFractionDigits: p, maximumFractionDigits: p }); }
  function inr(v) { if (v == null || !isFinite(+v)) return '–'; v = +v; var s = Math.abs(v) >= 1e7 ? (v / 1e7).toFixed(2) + ' Cr' : Math.abs(v) >= 1e5 ? (v / 1e5).toFixed(2) + ' L' : Math.round(v).toLocaleString('en-IN'); return (v < 0 ? '−' : '') + '₹' + s.replace('-', ''); }
  function sg(v, dp) { return v == null || !isFinite(v) ? '–' : (v > 0 ? '+' : '') + v.toFixed(dp == null ? 2 : dp); }
  function ist(t) { return new Date((t || Date.now()) + 5.5 * 3600e3); }
  function hhmm(ms) { var x = ist(ms); return ('0' + x.getUTCHours()).slice(-2) + ':' + ('0' + x.getUTCMinutes()).slice(-2); }
  function hms(ms) { var x = ist(ms); return hhmm(ms) + ':' + ('0' + x.getUTCSeconds()).slice(-2); }
  function dur(ms) { ms = Math.max(0, ms); var m = Math.floor(ms / 60000), h = Math.floor(m / 60); return h ? h + 'h ' + ('0' + (m % 60)).slice(-2) + 'm' : m + 'm ' + ('0' + Math.floor(ms / 1000 % 60)).slice(-2) + 's'; }
  function lj(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function sj(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function noKey() { return !V.key(); }
  function wide() { return window.innerWidth >= 1100; }

  /* ---------- styles ---------- */
  var css = d.createElement('style');
  css.textContent = [
    '#proFab{position:fixed;right:14px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:9998;background:#1f6feb;color:#fff;border:0;border-radius:24px;padding:11px 16px;font:700 14px system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.5);letter-spacing:.5px;cursor:pointer}',
    '#proFab .b{display:inline-block;min-width:18px;margin-left:6px;padding:1px 5px;border-radius:9px;background:#f0b429;color:#111;font-size:11px}',
    '#proSheet{position:fixed;inset:0;z-index:9999;background:#0d1117;color:#e6edf3;display:none;flex-direction:column;font:14px system-ui,-apple-system,"Segoe UI",sans-serif}',
    '#proSheet.on{display:flex}',
    '#proSheet .ph{display:flex;align-items:center;gap:10px;padding:calc(10px + env(safe-area-inset-top)) 12px 8px;border-bottom:1px solid #30363d}',
    '#proSheet .ph b{font-size:15px;flex:1}#proSheet .ph .x{background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:8px;padding:6px 12px;font-size:14px;cursor:pointer}',
    '#proSheet .pt{display:flex;gap:4px;padding:8px 8px 0;overflow-x:auto;border-bottom:1px solid #30363d}',
    '#proSheet .pt button{flex:1 0 auto;background:none;border:0;color:#8b949e;padding:8px 10px;font:600 13px system-ui;border-bottom:2px solid transparent;cursor:pointer}',
    '#proSheet .pt button.on{color:#58a6ff;border-bottom-color:#58a6ff}',
    '#proSheet .pb{flex:1;overflow:auto;padding:10px 10px calc(24px + env(safe-area-inset-bottom));-webkit-overflow-scrolling:touch}',
    '#proSheet .pv{display:none}#proSheet .pv.on{display:block}',
    '#proSheet .pv>h3{display:none;margin:0 0 8px;font-size:13px;letter-spacing:.6px;text-transform:uppercase;color:#8b949e}',
    '#proSheet .st{font-size:12px;color:#8b949e;margin:2px 0 8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
    '#proSheet .ok{color:#3fb950}#proSheet .dn{color:#f85149}#proSheet .wn{color:#f0b429}#proSheet .mu{color:#8b949e}',
    '#proSheet .card{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:10px;margin:0 0 8px}',
    '#proSheet .card.buy{border-left:4px solid #3fb950}#proSheet .card.sell{border-left:4px solid #f85149}#proSheet .card.arm{border-left:4px solid #f0b429}',
    '#proSheet .row{display:flex;justify-content:space-between;gap:8px;align-items:baseline}',
    '#proSheet .nm{font-weight:700;font-size:15px}#proSheet .tag{font-size:11px;padding:1px 6px;border-radius:6px;background:#21262d;color:#8b949e;margin-left:4px;font-weight:600}',
    '#proSheet .bd{font:800 12px system-ui;padding:3px 9px;border-radius:6px;color:#fff}#proSheet .bd.buy{background:#238636}#proSheet .bd.sell{background:#da3633}',
    '#proSheet .lv{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-top:6px;font-size:12px}#proSheet .lv div{background:#0d1117;border-radius:6px;padding:4px 6px}#proSheet .lv span{display:block;color:#8b949e;font-size:10px}',
    '#proSheet .live{display:flex;gap:10px;align-items:baseline;margin-top:6px;font-variant-numeric:tabular-nums;flex-wrap:wrap}#proSheet .live .px{font-size:18px;font-weight:800}',
    '#proSheet .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#484f58;margin-right:4px;vertical-align:middle}#proSheet .dot.g{background:#3fb950;box-shadow:0 0 6px #3fb950}#proSheet .dot.a{background:#f0b429}',
    '#proSheet table{width:100%;border-collapse:collapse;font-size:13px}#proSheet th{color:#8b949e;font-weight:600;font-size:11px;text-align:right;padding:4px 3px;position:sticky;top:0;background:#0d1117}#proSheet th:first-child,#proSheet td:first-child{text-align:left}',
    '#proSheet td{text-align:right;padding:7px 3px;border-top:1px solid #21262d;font-variant-numeric:tabular-nums}',
    '#proSheet tr[data-row]{cursor:pointer}',
    '#proSheet .rng{position:relative;height:6px;background:#30363d;border-radius:3px;min-width:56px}#proSheet .rng i{position:absolute;top:-3px;width:4px;height:12px;border-radius:2px;background:#e6edf3;margin-left:-2px}',
    '#proSheet .btn{background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:8px;padding:6px 10px;font:600 12px system-ui;cursor:pointer}#proSheet .btn.on{background:#1f6feb;border-color:#1f6feb}#proSheet .btn.on.b{background:#238636;border-color:#238636}#proSheet .btn.on.s{background:#da3633;border-color:#da3633}',
    '#proSheet .frm{display:grid;grid-template-columns:110px 1fr;gap:8px;align-items:center}#proSheet .frm input,#proSheet .frm select{background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:8px;padding:9px;font-size:16px;width:100%;box-sizing:border-box}',
    '#proSheet .big{font-size:28px;font-weight:800}#proSheet .kv{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}#proSheet .kv div{background:#0d1117;border-radius:8px;padding:8px}#proSheet .kv span{display:block;font-size:11px;color:#8b949e}',
    '#proSheet .warn{background:#3d2e00;border:1px solid #f0b429;color:#f0d78c;border-radius:10px;padding:8px 10px;margin:0 0 8px;font-size:13px}',
    '#proSheet .modes{font-size:12px;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:6px 8px;margin-bottom:8px}',
    '.vps-warn{background:#3d1d1d;border:1px solid #f85149;color:#ffb3ad;border-radius:8px;padding:8px 10px;margin-top:10px;font-size:13px}',
    /* laptop: all panels at once, like the Market Radar desktop dashboard */
    '@media (min-width:1100px){#proSheet .pt{display:none}#proSheet .pb{display:grid;grid-template-columns:minmax(420px,1.5fr) minmax(380px,1.2fr) minmax(320px,1fr);grid-template-rows:auto auto;gap:12px;align-content:start;padding:12px 16px 24px}',
    '#proSheet .pv{display:block;background:#0d1117;border:1px solid #21262d;border-radius:12px;padding:10px;overflow:auto;max-height:calc(100vh - 80px)}#proSheet .pv>h3{display:block}',
    '#pv-sig{grid-row:1 / span 2}#pv-wl{grid-row:1 / span 2}#pv-pnl{grid-column:3}#pv-size{grid-column:3}#pv-clk{grid-column:3}',
    '#proSheet .pb{grid-template-rows:auto auto auto}#pv-sig .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:8px}#pv-sig .cards .card{margin:0}',
    '#proSheet .ph b{font-size:17px}#proFab{padding:13px 20px;font-size:15px}}',
    '@media (min-width:1700px){#pv-sig .cards{grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}}'
  ].join('\n');
  d.head.appendChild(css);

  /* ---------- shell ---------- */
  var fab = d.createElement('button'); fab.id = 'proFab'; fab.type = 'button'; fab.innerHTML = 'PRO<span class="b" id="proBadge" style="display:none"></span>';
  var sh = d.createElement('div'); sh.id = 'proSheet';
  sh.innerHTML = '<div class="ph"><b>MCX Pro · Cloud OpenAlgo</b><span id="proConn" style="font-size:12px"></span><button class="x" id="proClose" type="button">Close</button></div>' +
    '<div class="pt" id="proTabs">' + PANELS.map(function (t) { return '<button type="button" data-t="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>' +
    '<div class="pb" id="proBody">' + PANELS.map(function (t) { return '<section class="pv" id="pv-' + t[0] + '"><h3>' + t[1] + '</h3><div class="pvb" id="pvb-' + t[0] + '"></div></section>'; }).join('') + '</div>';
  d.body.appendChild(fab); d.body.appendChild(sh);
  fab.addEventListener('click', function () { openSheet(true); });
  $('proClose').addEventListener('click', function () { openSheet(false); });
  $('proTabs').addEventListener('click', function (e) { var b = e.target.closest('button[data-t]'); if (b) { S.tab = b.dataset.t; localStorage.setItem('pro_tab', S.tab); layout(); paintAll(); refresh(true); } });
  sh.addEventListener('click', onBodyClick); sh.addEventListener('input', onInput); sh.addEventListener('change', onInput);
  function openSheet(on) { S.open = on; sh.classList.toggle('on', on); try { history.replaceState(null, '', location.pathname + location.search + (on ? '#pro' : '')); } catch (e) {} if (on) { layout(); paintAll(); refresh(true); wsEnsure(); } }
  function layout() { [].forEach.call($('proTabs').children, function (b) { b.classList.toggle('on', b.dataset.t === S.tab); }); PANELS.forEach(function (t) { $('pv-' + t[0]).classList.toggle('on', wide() || t[0] === S.tab); }); }
  window.addEventListener('resize', function () { if (S.open) { layout(); paintAll(); } });
  function visible(p) { return S.open && (wide() || S.tab === p); }
  if (/#pro\b/.test(location.hash)) setTimeout(function () { openSheet(true); }, 50);
  window.addEventListener('hashchange', function () { if (/#pro\b/.test(location.hash) && !S.open) openSheet(true); });

  /* ---------- live ticks: own WebSocket, subscribed to every symbol this panel shows ---------- */
  function wantSyms() {
    var m = {};
    wlNames().forEach(function (k) { var f = front(k); if (f) m[f.symbol] = 1; });
    if (S.shn) (S.shn.active || []).concat(S.shn.triggers || []).forEach(function (x) { if (x.exchange === 'MCX' && x.symbol) m[x.symbol] = 1; });
    if (S.pb) (S.pb.data || []).forEach(function (r) { if (r.exchange === 'MCX' && r.symbol) m[r.symbol] = 1; });
    var ss = sizeState(), f2 = front(ss.name); if (f2) m[f2.symbol] = 1;
    return Object.keys(m);
  }
  function wsEnsure() {
    if (noKey()) return;
    if (S.ws && (S.ws.readyState === 0 || S.ws.readyState === 1)) { wsSub(); return; }
    var w; try { w = new WebSocket(V.ws); } catch (e) { S.wsSt = 'err'; return; }
    S.ws = w; S.wsSt = 'connecting'; S.wsSubs = {};
    w.onopen = function () { w.send(JSON.stringify({ action: 'authenticate', api_key: V.key() })); };
    w.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type === 'auth') { S.wsSt = m.status === 'success' ? 'live' : 'autherr'; if (S.wsSt === 'live') wsSub(); return; }
      if (m.type === 'market_data' && m.data) {
        var x = m.data, s = m.symbol || x.symbol; if (!s || !(+x.ltp > 0)) return;
        var o = S.tk[s] || {}; o.prev = o.ltp; o.ltp = +x.ltp; o.at = Date.now(); o.n = (o.n || 0) + 1;
        ['open', 'high', 'low', 'close', 'volume', 'oi'].forEach(function (k) { if (x[k] != null && +x[k] > 0) o[k] = +x[k]; });
        S.tk[s] = o; S.wsN++; S.dirty.t = 1;
      }
    };
    w.onclose = function () { if (S.ws === w) { S.ws = null; S.wsSt = 'off'; setTimeout(function () { if (S.open || d.visibilityState === 'visible') wsEnsure(); }, 3000); } };
    w.onerror = function () { S.wsSt = 'err'; };
  }
  function wsSub() {
    if (!S.ws || S.ws.readyState !== 1 || S.wsSt !== 'live') return;
    var add = wantSyms().filter(function (s) { return !S.wsSubs[s]; });
    if (!add.length) return;
    add.forEach(function (s) { S.wsSubs[s] = 1; });
    for (var i = 0; i < add.length; i += 25) S.ws.send(JSON.stringify({ action: 'subscribe', mode: 'Quote', symbols: add.slice(i, i + 25).map(function (s) { return { exchange: 'MCX', symbol: s }; }) }));
  }
  function px(sym) { var t = S.tk[sym]; return t && t.ltp ? t.ltp : null; }
  function dot(sym) { var t = S.tk[sym], a = t && t.at ? Date.now() - t.at : 1e9; return '<i class="dot ' + (a < 5000 ? 'g' : a < 60000 ? 'a' : '') + '" title="' + (t && t.at ? 'last tick ' + hms(t.at) + ' IST' : 'no tick yet') + '"></i>'; }
  window.VPSPRO = { S: S, wantSyms: wantSyms };

  /* ---------- data ---------- */
  function loadContracts(force) {
    if (!force && S.con && Date.now() - S.conAt < 10 * 60e3) return Promise.resolve(S.con);
    if (noKey()) return Promise.reject(new Error('no key'));
    return V.get('/cockpit/contracts').then(function (j) { S.con = j.data || {}; S.conAt = Date.now(); wsSub(); return S.con; });
  }
  function front(name) { var c = S.con && S.con[name]; if (!c) return null; if (c.days_left <= ROLL_DAYS && c.next) { var nx = c.next; return { name: name, symbol: nx.symbol, expiry: nx.expiry, lot: nx.lot, rolled: c.symbol }; } return { name: name, symbol: c.symbol, expiry: c.expiry, lot: c.lot, days: c.days_left }; }
  function wlNames() { var w = lj('pro_wl'); return Array.isArray(w) && w.length ? w : WL_DEF; }
  function loadQuotes() {
    return loadContracts().then(function () {
      var syms = wlNames().map(front).filter(Boolean);
      return V.api('multiquotes', { symbols: syms.map(function (s) { return { symbol: s.symbol, exchange: 'MCX' }; }) }).then(function (j) {
        (j.results || []).forEach(function (r) { var s = syms.filter(function (x) { return x.symbol === r.symbol; })[0]; if (s && r.data) S.q[s.name] = Object.assign({ at: Date.now(), f: s }, r.data); });
        S.qAt = Date.now(); S.qErr = ''; wsSub();
      });
    }).catch(function (e) { S.qErr = e.message; });
  }
  function loadShn(force) {
    if (!force && S.shn && Date.now() - S.shnAt < 60e3) return Promise.resolve();
    return V.get('/cockpit/shn').then(function (j) { S.shn = j; S.shnAt = Date.now(); S.shnErr = ''; badge(); wsSub(); }).catch(function (e) { S.shnErr = e.message; });
  }
  function loadPb() { return V.api('positionbook').then(function (j) { S.pb = j; S.pbAt = Date.now(); S.pbErr = ''; wsSub(); }).catch(function (e) { S.pbErr = e.message; }); }
  function loadCal() { if (S.cal) return Promise.resolve(); return fetch('data/calendar.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) { S.cal = j.events || []; }).catch(function () { S.cal = []; }); }
  function refresh(force) {
    if (noKey()) { paintAll(); return; }
    var jobs = [loadContracts().catch(function () {})];
    if (visible('sig')) jobs.push(loadShn(force));
    if (visible('wl') || visible('size')) jobs.push(loadQuotes());
    if (visible('pnl')) jobs.push(loadPb());
    if (visible('clk')) jobs.push(loadCal());
    Promise.all(jobs).then(function () { if (S.open) paintAll(); });
  }
  /* repaint live panels at most 1x per second when ticks arrive; REST refresh: quotes 20 s (OI/day range), positions 10 s, signals 2 min */
  setInterval(function () {
    if (!S.open || d.visibilityState !== 'visible') return;
    if (S.dirty.t) { S.dirty.t = 0; ['sig', 'wl', 'pnl'].forEach(function (p) { if (visible(p)) paint(p); }); }
    else ['sig', 'wl'].forEach(function (p) { if (visible(p)) paint(p); });   // keep tick-age dots honest
    if (visible('clk')) paint('clk');
    paintConn();
  }, 1000);
  setInterval(function () {
    if (!S.open || d.visibilityState !== 'visible' || noKey()) return;
    if ((visible('wl') || visible('size')) && Date.now() - S.qAt > 20000) loadQuotes();
    if (visible('pnl') && Date.now() - S.pbAt > 10000) loadPb();
    if (visible('sig') && Date.now() - S.shnAt > 120e3) loadShn(true);
    wsEnsure();
  }, 5000);
  function badge() { var b = $('proBadge'); if (!b) return; var k = S.shn ? (S.shn.triggers || []).filter(function (x) { return x.bars_ago === 0 && isEntry(x); }).length : 0; b.textContent = k; b.style.display = k ? '' : 'none'; }
  setTimeout(function () { if (!noKey()) { loadShn(true); loadContracts().catch(function () {}); } }, 2500);
  setInterval(function () { if (!noKey() && d.visibilityState === 'visible' && !S.open) loadShn(true); }, 10 * 60e3);

  /* ---------- painting ---------- */
  function paintConn() {
    var c = $('proConn'); if (!c) return;
    var live = Object.keys(S.wsSubs).filter(function (s) { var t = S.tk[s]; return t && Date.now() - t.at < 60000; }).length, tot = Object.keys(S.wsSubs).length;
    c.innerHTML = S.wsSt === 'live' ? '<span class="ok">● live</span> <span class="mu">' + live + '/' + tot + ' ticking</span>' : S.wsSt === 'autherr' ? '<span class="dn">● key rejected</span>' : '<span class="mu">○ ' + esc(S.wsSt) + '</span>';
  }
  function paintAll() { PANELS.forEach(function (t) { if (visible(t[0])) paint(t[0]); }); paintConn(); }
  function paint(p) {
    var el = $('pvb-' + p); if (!el) return;
    if (noKey()) { el.innerHTML = p === 'sig' || !wide() ? '<div class="warn">Paste your <b>OpenAlgo API key</b> once on the <b>Live feed</b> tab (WebSocket URL <code>' + esc(V.ws) + '</code> is pre-filled) and press Connect. The key stays in this browser only.</div>' : ''; return; }
    if (p === 'size' && el.childNodes.length && el.contains(d.activeElement)) return;
    var h = ({ sig: pSig, wl: pWl, pnl: pPnl, size: pSize, clk: pClk })[p]();
    var pv = $('pv-' + p), y = pv.scrollTop, y2 = $('proBody').scrollTop, op = [];
    [].forEach.call(el.querySelectorAll('details'), function (x, i) { if (x.open) op.push(i); });
    el.innerHTML = h; var ds = el.querySelectorAll('details'); op.forEach(function (i) { if (ds[i]) ds[i].open = true; });
    pv.scrollTop = y; $('proBody').scrollTop = y2;
  }
  function isEntry(x) { return /^SHN /.test(x.kind || '') && x.stop != null; }
  function liveLine(x) {
    var p = px(x.symbol), side = x.dir === 'SELL' ? -1 : 1, rk = Math.abs(x.level - x.stop);
    var pct = p ? side * (p - x.level) / x.level * 100 : null, R = p && rk ? side * (p - x.level) / rk : null;
    var p0 = p || x.ltp;
    return '<div class="live">' + dot(x.symbol) + '<span class="px">' + n(p0) + '</span>' + (p ? '' : '<span class="mu">(scan LTP)</span>') +
      '<span class="' + (pct > 0 ? 'ok' : pct < 0 ? 'dn' : 'mu') + '">' + (pct == null ? '' : sg(pct) + '% vs entry') + '</span>' +
      '<span class="' + (R > 0 ? 'ok' : R < 0 ? 'dn' : 'mu') + '"><b>' + (R == null ? '' : sg(R) + 'R') + '</b></span></div>';
  }
  function sigCard(x, active) {
    var dir = x.dir === 'SELL' ? 'sell' : 'buy', short = x.mode === 'allow_shorts' || /Allow-shorts/.test(x.kind || '');
    var trail = active && x.trail != null ? '<div><span>Trail stop</span>' + n(x.trail) + '</div>' : '<div><span>T2</span>' + n(x.t2) + '</div>';
    return '<div class="card ' + dir + '"><div class="row"><span class="nm">' + esc(x.name) + '<span class="tag">' + esc(x.tf === 'D' ? 'Daily' : x.tf.toUpperCase()) + '</span>' +
      '<span class="tag">' + (short ? 'Allow-shorts' : 'Default') + '</span></span><span class="bd ' + dir + '">' + (dir === 'buy' ? 'BUY' : 'SELL') + '</span></div>' +
      '<div class="mu" style="font-size:12px;margin-top:3px">' + esc(x.symbol) + (x.rolled_from ? ' <span class="wn">(rolled from ' + esc(x.rolled_from) + ')</span>' : '') + ' · entry bar ' + esc(x.bar_time || '') + (x.bars_ago ? ' · ' + x.bars_ago + ' bars ago' : ' · last closed bar') + '</div>' +
      liveLine(x) +
      '<div class="lv"><div><span>Entry</span>' + n(x.level) + '</div><div><span>Stop</span>' + n(x.stop) + '</div><div><span>T1 (1R)</span>' + n(x.t1) + '</div>' + trail + '</div>' +
      '<div style="margin-top:6px"><button class="btn" type="button" data-size="' + esc(x.name) + '|' + x.level + '|' + x.stop + '|' + x.dir + '|' + esc(x.symbol) + '">Size this trade</button></div></div>';
  }
  function miniTable(l) { return '<table><thead><tr><th>Name</th><th>TF</th><th>Event</th><th>Level</th><th>Bar</th></tr></thead><tbody>' + l.map(function (x) { return '<tr><td><b>' + esc(x.name) + '</b></td><td>' + esc(x.tf) + '</td><td class="' + (x.dir === 'BUY' ? 'ok' : x.dir === 'SELL' ? 'dn' : 'wn') + '" style="font-size:11px">' + esc(x.kind) + '</td><td>' + n(x.level) + '</td><td style="font-size:11px">' + esc(x.bar_time || '') + (x.bars_ago ? ' (' + x.bars_ago + ')' : '') + '</td></tr>'; }).join('') + '</tbody></table>'; }
  function pSig() {
    var j = S.shn; if (!j) return '<div class="st">' + (S.shnErr ? '<span class="dn">' + esc(S.shnErr) + '</span>' : 'Loading SHN v3.4 screener…') + '</div>';
    var tf = S.sigTf, dr = S.sigDir, f = function (x) { return (tf === 'all' || x.tf === tf) && (dr === 'all' || x.dir === (dr === 'buy' ? 'BUY' : 'SELL')); };
    var act = (j.active || []).filter(f), tr = (j.triggers || []), ent = tr.filter(isEntry).filter(f);
    var nB = (j.active || []).filter(function (x) { return x.dir === 'BUY'; }).length, nS = (j.active || []).length - nB;
    var h = '<div class="modes"><b class="ok">Longs:</b> v3.4 default &nbsp;|&nbsp; <b class="dn">Shorts:</b> Allow-shorts mode · server scan <b>' + esc(j.run_at_ist) + '</b> · every 2H close +5 min <button class="btn" type="button" data-act="shn">Reload</button></div>';
    h += '<div class="st"><button class="btn' + (dr === 'all' ? ' on' : '') + '" data-dir="all" type="button">All ' + (nB + nS) + '</button><button class="btn b' + (dr === 'buy' ? ' on' : '') + '" data-dir="buy" type="button">Buy ' + nB + '</button><button class="btn s' + (dr === 'sell' ? ' on' : '') + '" data-dir="sell" type="button">Sell ' + nS + '</button>' +
      '<span style="width:8px"></span>' + ['all', '2h', 'D'].map(function (t) { return '<button class="btn' + (tf === t ? ' on' : '') + '" type="button" data-tf="' + t + '">' + (t === 'all' ? 'All TF' : t === 'D' ? 'Daily' : '2H') + '</button>'; }).join('') + '</div>';
    if (!j.active) h += '<div class="warn">This scan predates the both-directions update; the next scan (or Reload in a minute) adds open shorts.</div>';
    h += '<h4 style="margin:8px 0 6px">Open trades (' + act.length + ') <span class="mu" style="font-weight:400;font-size:12px">— live LTP, % vs entry and R from ticks</span></h4>' +
      (act.length ? '<div class="cards">' + act.map(function (x) { return sigCard(x, true); }).join('') + '</div>' : '<div class="card mu">No open ' + (dr === 'all' ? '' : dr.toUpperCase() + ' ') + 'trade for this filter.</div>');
    h += '<h4 style="margin:12px 0 6px">Fresh entries, last ' + (j.last_n_bars || 5) + ' closed bars (' + ent.length + ')</h4>' + (ent.length ? '<div class="cards">' + ent.map(function (x) { return sigCard(x, false); }).join('') + '</div>' : '<div class="card mu">No new entry for this filter.</div>');
    var ex = tr.filter(function (x) { return x.dir === 'EXIT'; }), ut = tr.filter(function (x) { return !isEntry(x) && x.dir !== 'EXIT'; });
    h += '<details style="margin-top:12px"><summary style="font-weight:700">Exits (' + ex.length + ') · UT Bot events (' + ut.length + ') · Armed (' + (j.near_triggers || []).length + ')</summary>' + miniTable(ex.concat(ut, j.near_triggers || [])) + '</details>';
    var stt = (j.state || []).filter(function (x) { return tf === 'all' || x.tf === tf; });
    h += '<details style="margin-top:8px"><summary style="font-weight:700">Trade state table (' + stt.length + ')</summary><table><thead><tr><th>Name</th><th>TF</th><th>State</th><th>HA</th><th>UT</th><th>3y PF</th></tr></thead><tbody>' + stt.map(function (x) {
      var st = String(x.state || ''), c = /LONG/.test(st) && !/NO LONG/.test(st) ? 'ok' : /BEAR|SHORT/.test(st) ? 'dn' : 'mu';
      return '<tr><td><b>' + esc(x.name) + '</b></td><td>' + esc(x.tf) + '</td><td class="' + c + '" style="font-size:11px">' + esc(st) + '</td><td class="' + (x.ha === 'bull' ? 'ok' : 'dn') + '">' + esc(x.ha) + '</td><td class="' + (x.ut === 'long' ? 'ok' : 'dn') + '">' + esc(x.ut) + '</td><td>' + n(x.bt3y_pf, 2) + '</td></tr>'; }).join('') + '</tbody></table></details>';
    return h + '<div class="st" style="margin-top:8px">Signals only — this app never places orders.</div>';
  }
  function pWl() {
    var names = wlNames(), rows = names.map(function (k) {
      var q = S.q[k], f = front(k); if (!f) return { k: k };
      var t = S.tk[f.symbol] || {}, pcl = (q && q.prev_close) || t.close, ltp = t.ltp || (q && q.ltp), hi = Math.max(t.high || 0, (q && q.high) || 0), lo = Math.min(t.low || 1e18, (q && q.low) || 1e18);
      return { k: k, f: f, ltp: ltp, pc: ltp && pcl ? (ltp - pcl) / pcl * 100 : null, hi: hi, lo: lo < 1e18 ? lo : null, oi: t.oi || (q && q.oi), up: t.prev ? t.ltp > t.prev : null, dn: t.prev ? t.ltp < t.prev : null };
    });
    if (S.sort === 'chg') rows.sort(function (a, b) { return Math.abs(b.pc || 0) - Math.abs(a.pc || 0); });
    var h = '<div class="st">' + (S.qErr ? '<span class="dn">' + esc(S.qErr) + '</span> ' : '') + 'Live ticks · ● green = tick in last 5 s · sort <button class="btn' + (S.sort === 'chg' ? ' on' : '') + '" data-sort="chg" type="button">|% move|</button><button class="btn' + (S.sort === 'list' ? ' on' : '') + '" data-sort="list" type="button">list</button></div>';
    h += '<table><thead><tr><th>MCX fut</th><th>LTP</th><th>%</th><th>Day range</th><th>OI</th></tr></thead><tbody>' + rows.map(function (r) {
      if (!r.ltp) return '<tr><td><b>' + esc(r.k) + '</b></td><td colspan="4" class="mu">…</td></tr>';
      var pos = r.hi > r.lo ? (r.ltp - r.lo) / (r.hi - r.lo) * 100 : 50, big = Math.abs(r.pc || 0) >= 1.5;
      return '<tr data-row="' + esc(r.k) + '"><td>' + dot(r.f.symbol) + '<b>' + esc(r.k) + '</b><div class="mu" style="font-size:10px;margin-left:12px">' + esc(r.f.symbol.replace(r.k, '')) + (r.f.rolled ? ' · rolled' : '') + '</div></td><td class="' + (r.up ? 'ok' : r.dn ? 'dn' : '') + '">' + n(r.ltp) + '</td><td class="' + (r.pc > 0 ? 'ok' : r.pc < 0 ? 'dn' : '') + '" style="' + (big ? 'font-weight:800' : '') + '">' + sg(r.pc) + '</td>' +
        '<td><div class="mu" style="font-size:10px;display:flex;justify-content:space-between;gap:4px"><span>' + n(r.lo) + '</span><span>' + n(r.hi) + '</span></div><div class="rng"><i style="left:' + Math.max(0, Math.min(100, pos)).toFixed(0) + '%"></i></div></td><td>' + (r.oi ? n(r.oi, 0) : '–') + '</td></tr>'; }).join('') + '</tbody></table>';
    return h + '<div class="st" style="margin-top:8px">Front contract with more than ' + ROLL_DAYS + ' days left (auto-rolls). Tap a row to size a trade. <button class="btn" type="button" data-act="wledit">Edit list</button></div>';
  }
  function pPnl() {
    var j = S.pb; if (!j) return '<div class="st">' + (S.pbErr ? '<span class="dn">' + esc(S.pbErr) + '</span>' : 'Loading positions…') + '</div>';
    var rows = (j.data || []), paper = j.mode === 'analyze', live = 0, liveOk = true;
    var rs = rows.map(function (r) { var q = +r.quantity, p = px(r.symbol), pnl = +r.pnl || 0; if (q && p) { pnl = (p - +r.average_price) * q + (+r.today_realized_pnl || 0); } else if (q) liveOk = false; live += pnl; return { r: r, q: q, p: p || +r.ltp, pnl: pnl }; });
    var h = '<div class="st">' + (paper ? '<span class="wn"><b>PAPER (Analyzer mode)</b></span>' : '<span class="dn"><b>LIVE account</b></span>') + ' · positions ' + hhmm(S.pbAt) + ' IST · P&amp;L marked to live ticks · read-only</div>';
    h += '<div class="card"><div class="row"><span class="mu">Total P&amp;L today</span><span class="big ' + (live >= 0 ? 'ok' : 'dn') + '">' + (live >= 0 ? '+' : '') + inr(live) + '</span></div>' +
      '<div class="kv"><div><span>Server total</span>' + inr(j.total_pnl) + '</div><div><span>Realised today</span>' + inr(j.total_today_realized_pnl) + '</div></div></div>';
    if (!rows.length) h += '<div class="card mu">No positions.</div>';
    rs.forEach(function (o) {
      var r = o.r, q = o.q;
      h += '<div class="card ' + (q > 0 ? 'buy' : q < 0 ? 'sell' : '') + '"><div class="row"><span class="nm">' + esc(r.symbol) + '<span class="tag">' + esc(r.product) + '</span></span><span class="' + (o.pnl >= 0 ? 'ok' : 'dn') + '"><b>' + (o.pnl >= 0 ? '+' : '') + inr(o.pnl) + '</b></span></div>' +
        '<div class="lv"><div><span>Side</span>' + (q > 0 ? '<b class="ok">LONG</b>' : q < 0 ? '<b class="dn">SHORT</b>' : 'FLAT') + '</div><div><span>Qty</span>' + n(q, 0) + '</div><div><span>Avg</span>' + n(r.average_price) + '</div><div><span>LTP ' + dot(r.symbol) + '</span>' + n(o.p) + '</div></div></div>';
    });
    return h + '<div class="st">From OpenAlgo positionbook. No order buttons; manage trades in OpenAlgo.</div>';
  }
  function sizeState() { var s = lj('pro_size') || {}; return Object.assign({ name: 'CRUDEOIL', side: 'BUY', entry: '', stop: '', risk: 2000, ppl: '' }, s); }
  function sizeCalc() {
    var s = sizeState(), f = front(s.name) || {}, q = S.q[s.name], lot = +s.ppl || +f.lot || 0, live = px(f.symbol) || (q && q.ltp) || 0;
    var E = +s.entry || live, SL = +s.stop, R = +s.risk || 0, per = Math.abs(E - SL), riskLot = per * lot, lots = riskLot > 0 ? Math.floor(R / riskLot) : 0, dir = s.side === 'SELL' ? -1 : 1;
    var bad = SL && ((dir > 0 && SL >= E) || (dir < 0 && SL <= E)), ok = SL && !bad;
    return '<div class="card" id="szOut">' + (bad ? '<div class="dn">Stop is on the wrong side of entry for a ' + esc(s.side) + '.</div>' : '') +
      '<div class="row"><span class="mu">Lots</span><span class="big">' + (ok ? lots : '–') + '</span></div>' +
      (ok && lots === 0 && riskLot > 0 ? '<div class="wn" style="font-size:12px">1 lot needs ' + inr(riskLot) + ' risk at this stop — raise risk, tighten the stop, or use the mini contract.</div>' : '') +
      '<div class="kv"><div><span>Contract</span>' + esc(f.symbol || '–') + '</div><div><span>Live LTP</span>' + n(live) + '</div><div><span>Risk / lot (1R)</span>' + (SL ? inr(riskLot) : '–') + '</div>' +
      '<div><span>Actual risk</span>' + (ok ? inr(lots * riskLot) : '–') + '</div>' +
      [1, 2, 3].map(function (m) { return '<div><span>' + m + 'R target</span>' + (ok ? n(E + dir * m * per) + ' <span class="ok">+' + inr(lots * riskLot * m) + '</span>' : '–') + '</div>'; }).join('') +
      '<div><span>Notional</span>' + (ok ? inr(lots * lot * E) : '–') + '</div><div><span>Entry used</span>' + n(E) + (s.entry ? '' : ' (live LTP)') + '</div></div></div>';
  }
  function pSize() {
    var s = sizeState(), names = Object.keys(S.con || {}).length ? Object.keys(S.con) : WL_DEF, f = front(s.name) || {};
    return '<div class="frm">' +
      '<label>Instrument</label><select id="szName">' + names.map(function (k) { return '<option' + (k === s.name ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('') + '</select>' +
      '<label>Side</label><select id="szSide"><option' + (s.side === 'BUY' ? ' selected' : '') + '>BUY</option><option' + (s.side === 'SELL' ? ' selected' : '') + '>SELL</option></select>' +
      '<label>Entry</label><input id="szEntry" inputmode="decimal" placeholder="live LTP" value="' + esc(s.entry) + '">' +
      '<label>Stop</label><input id="szStop" inputmode="decimal" placeholder="stop price" value="' + esc(s.stop) + '">' +
      '<label>Risk ₹</label><input id="szRisk" inputmode="decimal" value="' + esc(s.risk) + '">' +
      '<label>₹ per point / lot</label><input id="szPpl" inputmode="decimal" placeholder="' + (f.lot || '') + ' (lot size)" value="' + esc(s.ppl) + '">' +
      '</div><div style="height:10px"></div>' + sizeCalc() +
      '<div class="st">Lots = floor(Risk ÷ (|Entry − Stop| × ₹/point/lot)). ₹/point/lot defaults to the OpenAlgo lot size (CRUDEOIL 100, GOLD 100, SILVER 30, SILVERMIC 1, SILVER100 10). Calculator only — no orders.</div>';
  }
  function closeAt(x) { var y = x.getUTCFullYear(), mar = new Date(Date.UTC(y, 2, 8)), nov = new Date(Date.UTC(y, 10, 1));
    var s = new Date(Date.UTC(y, 2, 8 + (7 - mar.getUTCDay()) % 7)), e = new Date(Date.UTC(y, 10, 1 + (7 - nov.getUTCDay()) % 7)), t = Date.UTC(y, x.getUTCMonth(), x.getUTCDate());
    return t >= +s && t < +e ? 23 * 60 + 30 : 23 * 60 + 55; }
  function pClk() {
    var now = Date.now(), x = ist(now), dow = x.getUTCDay(), mins = x.getUTCHours() * 60 + x.getUTCMinutes(), cl = closeAt(x), wk = dow > 0 && dow < 6;
    var open = wk && mins >= 540 && mins < cl, base = Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()) - 5.5 * 3600e3;
    var st = open ? '<span class="ok">● MCX OPEN</span> · closes ' + (cl === 1410 ? '23:30' : '23:55') + ' IST in <b>' + dur(base + cl * 60e3 - now) + '</b>' : '<span class="dn">● MCX CLOSED</span>' + (wk && mins < 540 ? ' · opens 09:00 IST in ' + dur(base + 540 * 60e3 - now) : ' · opens 09:00 IST next weekday');
    var nx2 = null; for (var m = 660; m <= 1380; m += 120) if (m > mins) { nx2 = m; break; }
    var h = '<div class="card"><div class="big">' + hms(now) + ' <span class="mu" style="font-size:14px">IST</span></div><div style="margin-top:4px">' + st + '</div>' +
      (open && nx2 ? '<div class="kv"><div><span>Next 2H candle close</span>' + ('0' + Math.floor(nx2 / 60)).slice(-2) + ':00 · in ' + dur(base + nx2 * 60e3 - now) + '</div><div><span>Next SHN server scan</span>' + ('0' + Math.floor(nx2 / 60)).slice(-2) + ':05 IST</div></div>' : '') + '</div>';
    var exp = Object.keys(S.con || {}).map(function (k) { return { k: k, c: S.con[k] }; }).filter(function (o) { return o.c.days_left <= 7; }).sort(function (a, b) { return a.c.days_left - b.c.days_left; });
    h += '<h4 style="margin:12px 0 6px">Near expiry (≤ 7 days)</h4>' + (exp.length ? exp.map(function (o) { var c = o.c, hot = c.days_left <= ROLL_DAYS;
      return '<div class="card ' + (hot ? 'sell' : 'arm') + '"><div class="row"><span class="nm">' + esc(o.k) + '</span><span class="' + (hot ? 'dn' : 'wn') + '"><b>' + (c.days_left <= 0 ? 'EXPIRES TODAY' : c.days_left + ' day' + (c.days_left > 1 ? 's' : '')) + '</b></span></div><div class="mu" style="font-size:12px">' + esc(c.symbol) + ' expires ' + esc(c.expiry) + (c.next ? ' → ' + esc(c.next.symbol) : '') + (hot ? ' · cockpit, Watch and SHN scan use the next contract' : '') + '</div></div>'; }).join('') : '<div class="card mu">' + (S.con ? 'No MCX contract expires within 7 days.' : 'Loading contracts…') + '</div>');
    var ev = (S.cal || []).filter(function (e) { return Date.parse(e.when) > now - 30 * 60e3; }).sort(function (a, b) { return Date.parse(a.when) - Date.parse(b.when); }).slice(0, 6);
    h += '<h4 style="margin:12px 0 6px">Next events</h4>' + (ev.length ? ev.map(function (e) { var t = Date.parse(e.when); return '<div class="card ' + (e.impact === 'high' ? 'sell' : '') + '"><div class="row"><span><b>' + esc(e.title) + '</b></span><span class="' + (e.impact === 'high' ? 'dn' : 'mu') + '">' + esc(e.impact || '') + '</span></div><div class="mu" style="font-size:12px">' + esc(new Date(t + 5.5 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')) + ' IST · ' + (t > now ? 'in ' + dur(t - now) : 'just now') + '</div></div>'; }).join('') : '<div class="card mu">No upcoming events in data/calendar.json.</div>');
    return h;
  }

  /* ---------- interactions ---------- */
  function onBodyClick(e) {
    var t = e.target.closest('[data-act],[data-tf],[data-dir],[data-sort],[data-size],[data-row]'); if (!t) return;
    if (t.dataset.act === 'shn') { loadShn(true).then(function () { paint('sig'); }); return; }
    if (t.dataset.act === 'wledit') { var v = prompt('MCX names, comma separated', wlNames().join(', ')); if (v != null) { var l = v.toUpperCase().split(/[\s,]+/).filter(Boolean); sj('pro_wl', l.length ? l : null); S.q = {}; refresh(true); } return; }
    if (t.dataset.tf) { S.sigTf = t.dataset.tf; paint('sig'); return; }
    if (t.dataset.dir) { S.sigDir = t.dataset.dir; localStorage.setItem('pro_dir', S.sigDir); paint('sig'); return; }
    if (t.dataset.sort) { S.sort = t.dataset.sort; paint('wl'); return; }
    var go = function () { if (!wide()) { S.tab = 'size'; layout(); } paint('size'); wsSub(); };
    if (t.dataset.size) { var p = t.dataset.size.split('|'); var s = sizeState(); s.name = p[0]; s.entry = (+p[1]).toFixed(2); s.stop = (+p[2]).toFixed(2); s.side = p[3] === 'SELL' ? 'SELL' : 'BUY'; s.ppl = ''; sj('pro_size', s); go(); return; }
    if (t.dataset.row) { var s2 = sizeState(); s2.name = t.dataset.row; s2.entry = ''; s2.stop = ''; s2.ppl = ''; sj('pro_size', s2); go(); return; }
  }
  function onInput(e) {
    var id = e.target.id; if (!/^sz/.test(id)) return;
    var s = sizeState(), m = { szName: 'name', szSide: 'side', szEntry: 'entry', szStop: 'stop', szRisk: 'risk', szPpl: 'ppl' }[id];
    s[m] = e.target.value; if (id === 'szName') { s.entry = ''; s.ppl = ''; } sj('pro_size', s);
    if (id === 'szName') { var el = $('pvb-size'); el.innerHTML = pSize(); wsSub(); return; }
    var o = $('szOut'); if (o) o.outerHTML = sizeCalc();
  }
  setInterval(function () { if (visible('size') && !noKey()) { var o = $('szOut'); if (o) o.outerHTML = sizeCalc(); } }, 1000);

  /* ---------- Live feed tab: cloud notes + Fyers-direct warning ---------- */
  function liveTabNotes() {
    var box = $('fypanel'); if (!box || $('vpsWarn')) return;
    var w = d.createElement('div'); w.id = 'vpsWarn'; w.className = 'vps-warn';
    w.innerHTML = '<b>Fyers direct is switched off.</b> Your Fyers API app allows one login at a time; logging in from this phone would log out the cloud OpenAlgo server (and Market Radar). All prices, candles and SHN signals now come from <b>' + esc(V.base.replace('https://', '')) + '</b> — do your one daily Fyers login there.' +
      (V.notes.length ? '<div style="margin-top:6px;font-size:12px">' + V.notes.map(esc).join('<br>') + '</div>' : '');
    box.appendChild(w);
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', liveTabNotes); else liveTabNotes();
})();
/* proposed-cleanup-20261116: load the cleanup layer (external file, allowed by script-src 'self') */
(function () { try { if (document.querySelector('script[data-ck]')) return; var s = document.createElement('script'); s.src = 'js/cleanup_v1.js?v=20261116'; s.dataset.ck = '1'; s.async = false; document.body.appendChild(s); } catch (e) {} })();
(function () { try { if (document.querySelector('script[data-bots]')) return; var s = document.createElement('script'); s.src = 'js/bots_panel.js?v=20261116'; s.dataset.bots = '1'; s.async = false; document.body.appendChild(s); } catch (e) {} })();
