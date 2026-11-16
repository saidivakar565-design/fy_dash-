/* PRO tools for the phone MCX cockpit — Cloud OpenAlgo (srv2165780.hstgr.cloud). READ-ONLY: no order buttons, no order endpoints.
   Tabs: Signals (SHN v3.4 server screener) · Watch (live MCX board) · P&L (positionbook) · Size (R-multiple lots) · Clock (session, 2H closes, expiries, events).
   Needs the OpenAlgo API key saved on the Live feed tab (localStorage only). */
(function () {
  'use strict';
  if (!window.VPSB) return;
  var V = window.VPSB, d = document;
  var WL_DEF = ['CRUDEOIL', 'CRUDEOILM', 'NATURALGAS', 'NATGASMINI', 'GOLD', 'GOLDM', 'SILVER', 'SILVERM', 'SILVERMIC', 'SILVER100', 'COPPER', 'ZINC', 'LEAD', 'ALUMINIUM', 'NICKEL', 'MCXBULLDEX'];
  var ROLL_DAYS = 3;
  var S = { tab: localStorage.getItem('pro_tab') || 'sig', open: false, con: null, conAt: 0, shn: null, shnAt: 0, shnErr: '', q: {}, qAt: 0, qErr: '', pb: null, pbAt: 0, pbErr: '', cal: null, sort: 'chg', tmr: null, sigTf: 'all' };
  function $(id) { return d.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n(v, dp) { if (v == null || v === '' || !isFinite(+v)) return '–'; v = +v; return v.toLocaleString('en-IN', { minimumFractionDigits: dp == null ? (Math.abs(v) < 100 ? 2 : Math.abs(v) < 10000 ? 1 : 0) : dp, maximumFractionDigits: dp == null ? (Math.abs(v) < 100 ? 2 : Math.abs(v) < 10000 ? 1 : 0) : dp }); }
  function inr(v) { if (v == null || !isFinite(+v)) return '–'; v = +v; var s = Math.abs(v) >= 1e7 ? (v / 1e7).toFixed(2) + ' Cr' : Math.abs(v) >= 1e5 ? (v / 1e5).toFixed(2) + ' L' : Math.round(v).toLocaleString('en-IN'); return '₹' + s; }
  function ist(t) { return new Date((t || Date.now()) + 5.5 * 3600e3); }
  function hhmm(ms) { var x = ist(ms); return ('0' + x.getUTCHours()).slice(-2) + ':' + ('0' + x.getUTCMinutes()).slice(-2); }
  function dur(ms) { ms = Math.max(0, ms); var m = Math.floor(ms / 60000), h = Math.floor(m / 60); return h ? h + 'h ' + ('0' + (m % 60)).slice(-2) + 'm' : m + 'm ' + ('0' + Math.floor(ms / 1000 % 60)).slice(-2) + 's'; }
  function ago(ms) { return ms ? dur(Date.now() - ms) + ' ago' : 'never'; }
  function lj(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function sj(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function noKey() { return !V.key(); }

  /* ---------- styles ---------- */
  var css = d.createElement('style');
  css.textContent = [
    '#proFab{position:fixed;right:14px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:9998;background:#1f6feb;color:#fff;border:0;border-radius:24px;padding:11px 16px;font:700 14px system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.5);letter-spacing:.5px}',
    '#proFab .b{display:inline-block;min-width:18px;margin-left:6px;padding:1px 5px;border-radius:9px;background:#f0b429;color:#111;font-size:11px}',
    '#proSheet{position:fixed;inset:0;z-index:9999;background:#0d1117;color:#e6edf3;display:none;flex-direction:column;font:14px system-ui,-apple-system,sans-serif}',
    '#proSheet.on{display:flex}',
    '#proSheet .ph{display:flex;align-items:center;gap:8px;padding:calc(10px + env(safe-area-inset-top)) 12px 8px;border-bottom:1px solid #30363d}',
    '#proSheet .ph b{font-size:15px;flex:1}#proSheet .ph .x{background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:8px;padding:6px 12px;font-size:14px}',
    '#proSheet .pt{display:flex;gap:4px;padding:8px 8px 0;overflow-x:auto;border-bottom:1px solid #30363d}',
    '#proSheet .pt button{flex:1 0 auto;background:none;border:0;color:#8b949e;padding:8px 10px;font:600 13px system-ui;border-bottom:2px solid transparent}',
    '#proSheet .pt button.on{color:#58a6ff;border-bottom-color:#58a6ff}',
    '#proSheet .pb{flex:1;overflow:auto;padding:10px 10px calc(24px + env(safe-area-inset-bottom));-webkit-overflow-scrolling:touch}',
    '#proSheet .st{font-size:12px;color:#8b949e;margin:2px 0 8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
    '#proSheet .ok{color:#3fb950}#proSheet .dn{color:#f85149}#proSheet .wn{color:#f0b429}#proSheet .mu{color:#8b949e}',
    '#proSheet .card{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:10px;margin:0 0 8px}',
    '#proSheet .card.buy{border-left:4px solid #3fb950}#proSheet .card.sell{border-left:4px solid #f85149}#proSheet .card.arm{border-left:4px solid #f0b429}',
    '#proSheet .row{display:flex;justify-content:space-between;gap:8px;align-items:baseline}',
    '#proSheet .nm{font-weight:700;font-size:15px}#proSheet .tag{font-size:11px;padding:1px 6px;border-radius:6px;background:#21262d;color:#8b949e;margin-left:4px}',
    '#proSheet .lv{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-top:6px;font-size:12px}#proSheet .lv div{background:#0d1117;border-radius:6px;padding:4px 6px}#proSheet .lv span{display:block;color:#8b949e;font-size:10px}',
    '#proSheet table{width:100%;border-collapse:collapse;font-size:13px}#proSheet th{color:#8b949e;font-weight:600;font-size:11px;text-align:right;padding:4px 3px;position:sticky;top:0;background:#0d1117}#proSheet th:first-child,#proSheet td:first-child{text-align:left}',
    '#proSheet td{text-align:right;padding:7px 3px;border-top:1px solid #21262d;font-variant-numeric:tabular-nums}',
    '#proSheet .rng{position:relative;height:6px;background:#30363d;border-radius:3px;min-width:56px}#proSheet .rng i{position:absolute;top:-3px;width:4px;height:12px;border-radius:2px;background:#e6edf3;margin-left:-2px}',
    '#proSheet .btn{background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:8px;padding:6px 10px;font:600 12px system-ui}#proSheet .btn.on{background:#1f6feb;border-color:#1f6feb}',
    '#proSheet .frm{display:grid;grid-template-columns:110px 1fr;gap:8px;align-items:center}#proSheet .frm input,#proSheet .frm select{background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:8px;padding:9px;font-size:16px;width:100%;box-sizing:border-box}',
    '#proSheet .big{font-size:28px;font-weight:800}#proSheet .kv{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}#proSheet .kv div{background:#0d1117;border-radius:8px;padding:8px}#proSheet .kv span{display:block;font-size:11px;color:#8b949e}',
    '#proSheet .warn{background:#3d2e00;border:1px solid #f0b429;color:#f0d78c;border-radius:10px;padding:8px 10px;margin:0 0 8px;font-size:13px}',
    '.vps-warn{background:#3d1d1d;border:1px solid #f85149;color:#ffb3ad;border-radius:8px;padding:8px 10px;margin-top:10px;font-size:13px}'
  ].join('\n');
  d.head.appendChild(css);

  /* ---------- shell ---------- */
  var fab = d.createElement('button'); fab.id = 'proFab'; fab.type = 'button'; fab.innerHTML = 'PRO<span class="b" id="proBadge" style="display:none"></span>';
  var sh = d.createElement('div'); sh.id = 'proSheet';
  var TABS = [['sig', 'Signals'], ['wl', 'Watch'], ['pnl', 'P&L'], ['size', 'Size'], ['clk', 'Clock']];
  sh.innerHTML = '<div class="ph"><b>MCX Pro · Cloud OpenAlgo</b><span class="mu" id="proConn" style="font-size:11px"></span><button class="x" id="proClose" type="button">Close</button></div>' +
    '<div class="pt" id="proTabs">' + TABS.map(function (t) { return '<button type="button" data-t="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div><div class="pb" id="proBody"></div>';
  d.body.appendChild(fab); d.body.appendChild(sh);
  fab.addEventListener('click', function () { openSheet(true); });
  $('proClose').addEventListener('click', function () { openSheet(false); });
  $('proTabs').addEventListener('click', function (e) { var b = e.target.closest('button[data-t]'); if (b) { S.tab = b.dataset.t; localStorage.setItem('pro_tab', S.tab); paint(); refresh(true); } });
  sh.addEventListener('click', onBodyClick); sh.addEventListener('input', onInput); sh.addEventListener('change', onInput);
  function openSheet(on) { S.open = on; sh.classList.toggle('on', on); if (on) { paint(); refresh(true); } }
  if (/[#&]pro(=|$|&)/.test(location.hash)) setTimeout(function () { openSheet(true); }, 50);

  /* ---------- data ---------- */
  function loadContracts(force) {
    if (!force && S.con && Date.now() - S.conAt < 10 * 60e3) return Promise.resolve(S.con);
    if (noKey()) return Promise.reject(new Error('no key'));
    return V.get('/cockpit/contracts').then(function (j) { S.con = j.data || {}; S.conAt = Date.now(); return S.con; });
  }
  /* front month that has more than ROLL_DAYS left (same rule as the cockpit), else the next one */
  function front(name) { var c = S.con && S.con[name]; if (!c) return null; if (c.days_left <= ROLL_DAYS && c.next) { var nx = c.next; return { name: name, symbol: nx.symbol, expiry: nx.expiry, lot: nx.lot, rolled: c.symbol, rolledExp: c.expiry }; } return { name: name, symbol: c.symbol, expiry: c.expiry, lot: c.lot, days: c.days_left }; }
  function wlNames() { var w = lj('pro_wl'); return Array.isArray(w) && w.length ? w : WL_DEF; }
  function loadQuotes() {
    return loadContracts().then(function () {
      var syms = wlNames().map(front).filter(Boolean);
      return V.api('multiquotes', { symbols: syms.map(function (s) { return { symbol: s.symbol, exchange: 'MCX' }; }) }).then(function (j) {
        (j.results || []).forEach(function (r) { var s = syms.filter(function (x) { return x.symbol === r.symbol; })[0]; if (s && r.data) S.q[s.name] = Object.assign({ at: Date.now(), f: s }, r.data); });
        S.qAt = Date.now(); S.qErr = '';
      });
    }).catch(function (e) { S.qErr = e.message; });
  }
  function loadShn(force) {
    if (!force && S.shn && Date.now() - S.shnAt < 60e3) return Promise.resolve();
    return V.get('/cockpit/shn').then(function (j) { S.shn = j; S.shnAt = Date.now(); S.shnErr = ''; badge(); }).catch(function (e) { S.shnErr = e.message; });
  }
  function loadPb() { return V.api('positionbook').then(function (j) { S.pb = j; S.pbAt = Date.now(); S.pbErr = ''; }).catch(function (e) { S.pbErr = e.message; }); }
  function loadCal() { if (S.cal) return Promise.resolve(); return fetch('data/calendar.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) { S.cal = j.events || []; }).catch(function () { S.cal = []; }); }

  var busy = false;
  function refresh(force) {
    if (busy && !force) return; if (noKey()) { paint(); return; }
    busy = true; var t = S.tab, p;
    if (t === 'sig') p = Promise.all([loadShn(force), loadContracts().catch(function () {})]);
    else if (t === 'wl') p = loadQuotes();
    else if (t === 'pnl') p = loadPb();
    else if (t === 'size') p = S.qAt && Date.now() - S.qAt < 15000 ? Promise.resolve() : loadQuotes();
    else p = Promise.all([loadContracts().catch(function () {}), loadCal()]);
    p.then(function () { busy = false; if (S.open) paint(); }, function () { busy = false; if (S.open) paint(); });
  }
  setInterval(function () {
    if (!S.open || d.visibilityState !== 'visible') return;
    var t = S.tab;
    if (t === 'wl') refresh(); else if (t === 'pnl' && Date.now() - S.pbAt > 4500) refresh(); else if (t === 'clk') paint(); else if (t === 'sig' && Date.now() - S.shnAt > 120e3) refresh();
  }, 3000);
  /* badge: fresh SHN triggers (last closed bar) + contracts expiring within ROLL_DAYS */
  function badge() {
    var b = $('proBadge'); if (!b) return; var k = 0;
    if (S.shn) k += (S.shn.triggers || []).filter(function (x) { return x.bars_ago === 0 && isEntry(x); }).length;
    b.textContent = k; b.style.display = k ? '' : 'none';
  }
  setTimeout(function () { if (!noKey()) { loadShn(true).then(badge); loadContracts().catch(function () {}); } }, 2500);
  setInterval(function () { if (!noKey() && d.visibilityState === 'visible' && !S.open) loadShn(true); }, 10 * 60e3);

  /* ---------- painting ---------- */
  function paint() {
    if (!S.open) return;
    [].forEach.call($('proTabs').children, function (b) { b.classList.toggle('on', b.dataset.t === S.tab); });
    var lf = (typeof LiveFeed !== 'undefined' && LiveFeed) || null;
    $('proConn').innerHTML = lf && lf.ws && (lf.phase === 'live' || lf.phase === 'subscribed') ? '<span class="ok">● live ticks</span>' : '<span class="mu">REST</span>';
    var h;
    if (noKey()) h = '<div class="warn">Paste your <b>OpenAlgo API key</b> once on the <b>Live feed</b> tab (WebSocket URL <code>' + esc(V.ws) + '</code> is pre-filled) and press Connect. The key stays in this phone only.</div>';
    else h = ({ sig: pSig, wl: pWl, pnl: pPnl, size: pSize, clk: pClk })[S.tab]();
    var y = $('proBody').scrollTop; $('proBody').innerHTML = h; $('proBody').scrollTop = y;
  }
  function trigCard(x, arm) {
    var dir = x.dir === 'SELL' ? 'sell' : 'buy', cls = arm ? 'arm' : dir;
    var lv = arm ? '' : '<div class="lv"><div><span>Entry</span>' + n(x.level) + '</div><div><span>Stop</span>' + n(x.stop) + '</div><div><span>T1</span>' + n(x.t1) + '</div><div><span>T2</span>' + n(x.t2) + '</div></div>';
    return '<div class="card ' + cls + '"><div class="row"><span class="nm">' + esc(x.name) + '<span class="tag">' + esc(x.tf === 'D' ? 'Daily' : x.tf) + '</span>' + (x.bars_ago === 0 ? '<span class="tag wn">last bar</span>' : x.bars_ago ? '<span class="tag">' + x.bars_ago + ' bars ago</span>' : '') + '</span><span class="' + (dir === 'buy' ? 'ok' : 'dn') + '"><b>' + esc(arm ? 'ARMED ' + x.dir : x.dir) + '</b></span></div>' +
      '<div class="mu" style="font-size:12px;margin-top:3px">' + esc(x.kind) + ' · bar ' + esc(x.bar_time || '') + (x.bars_ago ? ' (' + x.bars_ago + ' ago)' : '') + ' · LTP ' + n(x.ltp) + (x.status ? ' · ' + esc(x.status) : '') + '</div>' + lv +
      (arm || x.stop == null ? '' : '<div style="margin-top:6px"><button class="btn" type="button" data-size="' + esc(x.name) + '|' + x.level + '|' + x.stop + '|' + x.dir + '">Size this trade</button></div>') + '</div>';
  }
  function isEntry(x) { return /^SHN /.test(x.kind || '') && x.stop != null; }
  function miniTable(l) { return '<table><thead><tr><th>Name</th><th>TF</th><th>Event</th><th>Level</th><th>Bar</th></tr></thead><tbody>' + l.map(function (x) { return '<tr><td><b>' + esc(x.name) + '</b></td><td>' + esc(x.tf) + '</td><td class="' + (x.dir === 'BUY' ? 'ok' : x.dir === 'SELL' ? 'dn' : 'wn') + '" style="font-size:11px">' + esc(x.kind) + '</td><td>' + n(x.level) + '</td><td style="font-size:11px">' + esc(x.bar_time || '') + (x.bars_ago ? ' (' + x.bars_ago + ')' : '') + '</td></tr>'; }).join('') + '</tbody></table>'; }
  function pSig() {
    var j = S.shn; if (!j) return '<div class="st">' + (S.shnErr ? '<span class="dn">' + esc(S.shnErr) + '</span>' : 'Loading SHN v3.4 screener…') + '</div>';
    var tf = S.sigTf, f = function (x) { return tf === 'all' || x.tf === tf; };
    var tr = (j.triggers || []).filter(f), nr = (j.near_triggers || []).filter(f), stt = (j.state || []).filter(f);
    var h = '<div class="st">Server run <b>' + esc(j.run_at_ist) + '</b> · ' + esc(j.timeframes) + ' · MCX · auto every 2H close +5 min (weekdays) <button class="btn" type="button" data-act="shn">Reload</button></div>';
    h += '<div class="st">' + ['all', '2h', 'D'].map(function (t) { return '<button class="btn' + (tf === t ? ' on' : '') + '" type="button" data-tf="' + t + '">' + (t === 'all' ? 'All' : t === 'D' ? 'Daily' : '2H') + '</button>'; }).join('') + '</div>';
    var ent = tr.filter(isEntry), ex = tr.filter(function (x) { return x.dir === 'EXIT'; }), ut = tr.filter(function (x) { return !isEntry(x) && x.dir !== 'EXIT'; });
    h += '<h4 style="margin:8px 0 6px">SHN entries (' + ent.length + ')</h4>' + (ent.length ? ent.map(function (x) { return trigCard(x); }).join('') : '<div class="card mu">No SHN BUY/SELL entry on the last ' + (j.last_n_bars || 5) + ' closed bars.</div>');
    h += '<h4 style="margin:12px 0 6px">Exits (' + ex.length + ')</h4>' + (ex.length ? miniTable(ex) : '<div class="card mu">No exits.</div>');
    h += '<details style="margin-top:12px"><summary style="font-weight:700">UT Bot events (' + ut.length + ') — context only</summary>' + (ut.length ? miniTable(ut) : '') + '</details>';
    h += '<h4 style="margin:12px 0 6px">Armed (' + nr.length + ')</h4>' + (nr.length ? nr.map(function (x) { return trigCard(x, true); }).join('') : '<div class="card mu">Nothing armed.</div>');
    h += '<h4 style="margin:12px 0 6px">State</h4><table><thead><tr><th>Name</th><th>TF</th><th>State</th><th>HA</th><th>UT</th><th>3y PF</th></tr></thead><tbody>' + stt.map(function (x) {
      var st = String(x.state || ''), c = /BULL|LONG OPEN|OPEN/i.test(st) && !/NO LONG/i.test(st) ? 'ok' : /BEAR/i.test(st) ? 'dn' : 'mu';
      return '<tr><td><b>' + esc(x.name) + '</b></td><td>' + esc(x.tf) + '</td><td class="' + c + '" style="font-size:11px">' + esc(st) + '</td><td class="' + (x.ha === 'bull' ? 'ok' : 'dn') + '">' + esc(x.ha) + '</td><td class="' + (x.ut === 'long' ? 'ok' : 'dn') + '">' + esc(x.ut) + '</td><td>' + n(x.bt3y_pf, 2) + '</td></tr>'; }).join('') + '</tbody></table>';
    h += '<div class="st" style="margin-top:8px">' + esc(j.settings || '') + '. Signals only — never places orders.</div>';
    return h;
  }
  function pWl() {
    var names = wlNames(), rows = names.map(function (k) { var q = S.q[k]; if (!q) return { k: k }; var pc = q.prev_close ? (q.ltp - q.prev_close) / q.prev_close * 100 : null; return { k: k, q: q, pc: pc }; });
    if (S.sort === 'chg') rows.sort(function (a, b) { return Math.abs(b.pc || 0) - Math.abs(a.pc || 0); });
    var h = '<div class="st">' + (S.qErr ? '<span class="dn">' + esc(S.qErr) + '</span>' : 'Updated ' + (S.qAt ? hhmm(S.qAt) + ' IST · every 3 s' : '…')) + ' · sort <button class="btn' + (S.sort === 'chg' ? ' on' : '') + '" data-sort="chg" type="button">|% move|</button><button class="btn' + (S.sort === 'list' ? ' on' : '') + '" data-sort="list" type="button">list</button></div>';
    h += '<table><thead><tr><th>MCX fut</th><th>LTP</th><th>%</th><th>Day range</th><th>OI</th></tr></thead><tbody>' + rows.map(function (r) {
      var q = r.q; if (!q) return '<tr><td><b>' + esc(r.k) + '</b></td><td colspan="4" class="mu">…</td></tr>';
      var pos = q.high > q.low ? (q.ltp - q.low) / (q.high - q.low) * 100 : 50, f = q.f || {};
      var big = Math.abs(r.pc || 0) >= 1.5;
      return '<tr data-row="' + esc(r.k) + '"><td><b>' + esc(r.k) + '</b><div class="mu" style="font-size:10px">' + esc((f.expiry || '').slice(5)) + (f.rolled ? ' · rolled' : '') + '</div></td><td>' + n(q.ltp) + '</td><td class="' + (r.pc > 0 ? 'ok' : r.pc < 0 ? 'dn' : '') + '" style="' + (big ? 'font-weight:800' : '') + '">' + (r.pc == null ? '–' : (r.pc > 0 ? '+' : '') + r.pc.toFixed(2)) + '</td>' +
        '<td><div class="mu" style="font-size:10px;display:flex;justify-content:space-between"><span>' + n(q.low) + '</span><span>' + n(q.high) + '</span></div><div class="rng"><i style="left:' + Math.max(0, Math.min(100, pos)).toFixed(0) + '%"></i></div></td><td>' + (q.oi ? n(q.oi, 0) : '–') + '</td></tr>'; }).join('') + '</tbody></table>';
    h += '<div class="st" style="margin-top:8px">Front contract with more than ' + ROLL_DAYS + ' days left (auto-rolls). Tap a row to size a trade. Bold = move ≥ 1.5%. ' +
      '<button class="btn" type="button" data-act="wledit">Edit list</button></div>';
    return h;
  }
  function pPnl() {
    var j = S.pb; if (!j) return '<div class="st">' + (S.pbErr ? '<span class="dn">' + esc(S.pbErr) + '</span>' : 'Loading positions…') + '</div>';
    var rows = (j.data || []), paper = j.mode === 'analyze';
    var tot = j.total_pnl != null ? +j.total_pnl : rows.reduce(function (a, r) { return a + (+r.pnl || 0); }, 0);
    var h = '<div class="st">' + (paper ? '<span class="wn"><b>PAPER (Analyzer mode)</b></span>' : '<span class="dn"><b>LIVE account</b></span>') + ' · updated ' + hhmm(S.pbAt) + ' IST · every 5 s · read-only</div>';
    h += '<div class="card"><div class="row"><span class="mu">Total P&amp;L today</span><span class="big ' + (tot >= 0 ? 'ok' : 'dn') + '">' + (tot >= 0 ? '+' : '') + inr(tot) + '</span></div>' +
      '<div class="kv"><div><span>Unrealised</span>' + inr(j.total_unrealized_pnl) + '</div><div><span>Realised today</span>' + inr(j.total_today_realized_pnl) + '</div></div></div>';
    if (!rows.length) h += '<div class="card mu">No positions.</div>';
    rows.forEach(function (r) {
      var q = +r.quantity, side = q > 0 ? 'LONG' : q < 0 ? 'SHORT' : 'FLAT';
      h += '<div class="card ' + (q > 0 ? 'buy' : q < 0 ? 'sell' : '') + '"><div class="row"><span class="nm">' + esc(r.symbol) + '<span class="tag">' + esc(r.product) + '</span></span><span class="' + ((+r.pnl || 0) >= 0 ? 'ok' : 'dn') + '"><b>' + ((+r.pnl || 0) >= 0 ? '+' : '') + inr(r.pnl) + '</b></span></div>' +
        '<div class="lv"><div><span>Side</span>' + side + '</div><div><span>Qty</span>' + n(q, 0) + '</div><div><span>Avg</span>' + n(r.average_price) + '</div><div><span>LTP</span>' + n(r.ltp) + '</div></div></div>';
    });
    return h + '<div class="st">From OpenAlgo positionbook. This app has no order buttons; manage trades in OpenAlgo.</div>';
  }
  function sizeState() { var s = lj('pro_size') || {}; return Object.assign({ name: 'CRUDEOIL', side: 'BUY', entry: '', stop: '', risk: 2000, ppl: '' }, s); }
  function pSize() {
    var s = sizeState(), names = Object.keys(S.con || {}).length ? Object.keys(S.con) : WL_DEF, f = front(s.name) || {}, q = S.q[s.name];
    var lot = +s.ppl || +f.lot || 0, E = +s.entry || (q && q.ltp) || 0, SL = +s.stop, R = +s.risk || 0;
    var per = Math.abs(E - SL), riskLot = per * lot, lots = riskLot > 0 ? Math.floor(R / riskLot) : 0, dir = s.side === 'SELL' ? -1 : 1;
    var bad = SL && ((dir > 0 && SL >= E) || (dir < 0 && SL <= E));
    var h = '<div class="frm">' +
      '<label>Instrument</label><select id="szName">' + names.map(function (k) { return '<option' + (k === s.name ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('') + '</select>' +
      '<label>Side</label><select id="szSide"><option' + (s.side === 'BUY' ? ' selected' : '') + '>BUY</option><option' + (s.side === 'SELL' ? ' selected' : '') + '>SELL</option></select>' +
      '<label>Entry</label><input id="szEntry" inputmode="decimal" placeholder="' + (q ? 'LTP ' + q.ltp : 'price') + '" value="' + esc(s.entry) + '">' +
      '<label>Stop</label><input id="szStop" inputmode="decimal" placeholder="stop price" value="' + esc(s.stop) + '">' +
      '<label>Risk ₹</label><input id="szRisk" inputmode="decimal" value="' + esc(s.risk) + '">' +
      '<label>₹ per point / lot</label><input id="szPpl" inputmode="decimal" placeholder="' + (f.lot || '') + ' (lot size)" value="' + esc(s.ppl) + '">' +
      '</div>';
    h += '<div class="card" style="margin-top:10px">' + (bad ? '<div class="dn">Stop is on the wrong side of entry for a ' + esc(s.side) + '.</div>' : '') +
      '<div class="row"><span class="mu">Lots</span><span class="big">' + (SL && !bad ? lots : '–') + '</span></div>' +
      (SL && !bad && lots === 0 && riskLot > 0 ? '<div class="wn" style="font-size:12px">1 lot needs ' + inr(riskLot) + ' risk at this stop — raise risk, tighten the stop, or use the mini contract.</div>' : '') +
      '<div class="kv"><div><span>Contract</span>' + esc(f.symbol || '–') + '</div><div><span>Risk / lot (1R)</span>' + (SL ? inr(riskLot) : '–') + '</div>' +
      '<div><span>Actual risk</span>' + (SL && !bad ? inr(lots * riskLot) : '–') + '</div><div><span>Notional</span>' + (SL && !bad ? inr(lots * lot * E) : '–') + '</div>' +
      [1, 2, 3].map(function (m) { return '<div><span>' + m + 'R target</span>' + (SL && !bad ? n(E + dir * m * per) + ' <span class="ok">+' + inr(lots * riskLot * m) + '</span>' : '–') + '</div>'; }).join('') +
      '<div><span>Entry used</span>' + n(E) + (s.entry ? '' : ' (LTP)') + '</div></div></div>';
    h += '<div class="st">Lots = floor(Risk ÷ (|Entry − Stop| × ₹/point/lot)). ₹/point/lot defaults to the OpenAlgo lot size for MCX (e.g. CRUDEOIL 100, GOLD 100, SILVER 30, SILVERMIC 1, SILVER100 10). Calculator only — no orders.</div>';
    return h;
  }
  function closeAt(nowIst) { /* MCX non-agri close: 23:30 IST while the US is on daylight time, 23:55 otherwise */
    var y = nowIst.getUTCFullYear(), mar = new Date(Date.UTC(y, 2, 8)), nov = new Date(Date.UTC(y, 10, 1));
    var s = new Date(Date.UTC(y, 2, 8 + (7 - mar.getUTCDay()) % 7)), e = new Date(Date.UTC(y, 10, 1 + (7 - nov.getUTCDay()) % 7));
    var t = Date.UTC(y, nowIst.getUTCMonth(), nowIst.getUTCDate()); return t >= +s && t < +e ? 23 * 60 + 30 : 23 * 60 + 55;
  }
  function pClk() {
    var now = Date.now(), x = ist(now), dow = x.getUTCDay(), mins = x.getUTCHours() * 60 + x.getUTCMinutes(), cl = closeAt(x), wk = dow > 0 && dow < 6;
    var open = wk && mins >= 540 && mins < cl, base = Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()) - 5.5 * 3600e3;
    var st = open ? '<span class="ok">● MCX OPEN</span> · closes ' + (cl === 1410 ? '23:30' : '23:55') + ' IST in <b>' + dur(base + cl * 60e3 - now) + '</b>' : '<span class="dn">● MCX CLOSED</span>' + (wk && mins < 540 ? ' · opens 09:00 IST in ' + dur(base + 540 * 60e3 - now) : ' · opens 09:00 IST next weekday');
    var nx2 = null; for (var m = 660; m <= 1380; m += 120) if (m > mins) { nx2 = m; break; }
    var h = '<div class="card"><div class="big">' + hhmm(now) + ' <span class="mu" style="font-size:14px">IST</span></div><div style="margin-top:4px">' + st + '</div>' +
      (open && nx2 ? '<div class="kv"><div><span>Next 2H candle close</span>' + ('0' + Math.floor(nx2 / 60)).slice(-2) + ':00 · in ' + dur(base + nx2 * 60e3 - now) + '</div><div><span>Next SHN server scan</span>' + ('0' + Math.floor(nx2 / 60)).slice(-2) + ':05 IST</div></div>' : '') + '</div>';
    var exp = Object.keys(S.con || {}).map(function (k) { var c = S.con[k]; return { k: k, c: c }; }).filter(function (o) { return o.c.days_left <= 7; }).sort(function (a, b) { return a.c.days_left - b.c.days_left; });
    h += '<h4 style="margin:12px 0 6px">Near expiry (≤ 7 days)</h4>' + (exp.length ? exp.map(function (o) {
      var c = o.c, hot = c.days_left <= ROLL_DAYS;
      return '<div class="card ' + (hot ? 'sell' : 'arm') + '"><div class="row"><span class="nm">' + esc(o.k) + '</span><span class="' + (hot ? 'dn' : 'wn') + '"><b>' + (c.days_left <= 0 ? 'EXPIRES TODAY' : c.days_left + ' day' + (c.days_left > 1 ? 's' : '')) + '</b></span></div><div class="mu" style="font-size:12px">' + esc(c.symbol) + ' expires ' + esc(c.expiry) + (c.next ? ' → roll to ' + esc(c.next.symbol) : '') + (hot ? ' · cockpit already uses the next contract' : '') + '</div></div>'; }).join('') : '<div class="card mu">' + (S.con ? 'No MCX contract expires within 7 days.' : 'Loading contracts…') + '</div>');
    var ev = (S.cal || []).filter(function (e) { return Date.parse(e.when) > now - 30 * 60e3; }).sort(function (a, b) { return Date.parse(a.when) - Date.parse(b.when); }).slice(0, 6);
    h += '<h4 style="margin:12px 0 6px">Next events</h4>' + (ev.length ? ev.map(function (e) { var t = Date.parse(e.when); return '<div class="card ' + (e.impact === 'high' ? 'sell' : '') + '"><div class="row"><span><b>' + esc(e.title) + '</b></span><span class="' + (e.impact === 'high' ? 'dn' : 'mu') + '">' + esc(e.impact || '') + '</span></div><div class="mu" style="font-size:12px">' + esc(new Date(t + 5.5 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')) + ' IST · ' + (t > now ? 'in ' + dur(t - now) : 'just now') + '</div></div>'; }).join('') : '<div class="card mu">No upcoming events in data/calendar.json.</div>');
    return h;
  }

  /* ---------- interactions ---------- */
  function onBodyClick(e) {
    var t = e.target.closest('[data-act],[data-tf],[data-sort],[data-size],[data-row]'); if (!t) return;
    if (t.dataset.act === 'shn') { loadShn(true).then(paint); return; }
    if (t.dataset.act === 'wledit') { var v = prompt('MCX names, comma separated', wlNames().join(', ')); if (v != null) { var l = v.toUpperCase().split(/[\s,]+/).filter(Boolean); sj('pro_wl', l.length ? l : null); S.q = {}; refresh(true); } return; }
    if (t.dataset.tf) { S.sigTf = t.dataset.tf; paint(); return; }
    if (t.dataset.sort) { S.sort = t.dataset.sort; paint(); return; }
    if (t.dataset.size) { var p = t.dataset.size.split('|'); var s = sizeState(); s.name = p[0]; s.entry = (+p[1]).toFixed(2); s.stop = (+p[2]).toFixed(2); s.side = p[3] === 'SELL' ? 'SELL' : 'BUY'; s.ppl = ''; sj('pro_size', s); S.tab = 'size'; paint(); refresh(true); return; }
    if (t.dataset.row) { var s2 = sizeState(); s2.name = t.dataset.row; s2.entry = ''; s2.stop = ''; s2.ppl = ''; sj('pro_size', s2); S.tab = 'size'; paint(); return; }
  }
  function onInput(e) {
    var id = e.target.id; if (!/^sz/.test(id)) return;
    var s = sizeState(), m = { szName: 'name', szSide: 'side', szEntry: 'entry', szStop: 'stop', szRisk: 'risk', szPpl: 'ppl' }[id];
    s[m] = e.target.value; if (id === 'szName') { s.entry = ''; s.ppl = ''; } sj('pro_size', s);
    if (e.type === 'change' || id === 'szName' || id === 'szSide') { var a = d.activeElement && d.activeElement.id; paint(); if (a && $(a) && a !== 'szName' && a !== 'szSide') { var el = $(a); el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (x) {} } }
    else { var res = d.createElement('div'); res.innerHTML = pSize(); var card = $('proBody').querySelector('.card'), nc = res.querySelector('.card'); if (card && nc) card.innerHTML = nc.innerHTML; }
  }

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
