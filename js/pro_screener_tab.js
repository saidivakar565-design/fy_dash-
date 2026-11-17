/* PRO sheet → "Screener" tab (17 Nov 2026): NSE F&O + MCX Pro Screener from the VPS.  READ-ONLY — scores and signals only, never orders.
   Data:  GET https://srv2165780.hstgr.cloud/cockpit/screener            (all stocks, 15m / 2H / 4H / D + MTF scores, sectors, signals)
          GET https://srv2165780.hstgr.cloud/cockpit/screener/candles?name=&tf=   (tap a row: candles + EMA20/50 + SHN / UT / SD markers)
          GET https://srv2165780.hstgr.cloud/cockpit/screener/export?fmt=csv|xlsx&…   (downloads, via js/ck_downloads.js)
   X-API-KEY = OpenAlgo key saved on the Live feed tab (localStorage only, via window.VPSB). No key in this repo. */
(function () {
  'use strict';
  var d = document, T0 = Date.now();
  function $(id) { return d.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n(v, dp) { if (v == null || v === '' || !isFinite(+v)) return '–'; v = +v; var p = dp == null ? (Math.abs(v) >= 5000 ? 0 : 2) : dp; return v.toLocaleString('en-IN', { minimumFractionDigits: p, maximumFractionDigits: p }); }
  function sg(v, dp) { return v == null || !isFinite(v) ? '–' : (v > 0 ? '+' : '') + (+v).toFixed(dp == null ? 1 : dp); }
  function wide() { return window.innerWidth >= 1100; }
  function mob() { return window.innerWidth < 640; }
  function lsg(k, def) { try { var v = localStorage.getItem(k); return v == null ? def : v; } catch (e) { return def; } }
  function lss(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function ist(sec, day) { var x = new Date(sec * 1000 + 19800000), mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][x.getUTCMonth()];
    return x.getUTCDate() + ' ' + mo + (day ? '' : ' ' + ('0' + x.getUTCHours()).slice(-2) + ':' + ('0' + x.getUTCMinutes()).slice(-2)); }
  var TFS = ['15m', '2h', '4h', 'D'], TFL = { '15m': '15m', '2h': '2H', '4h': '4H', 'D': 'D', 'MTF': 'MTF' };
  var F = { u: lsg('scr_u', 'ALL'), tf: lsg('scr_tf', 'MTF'), sec: '', sig: 'any', grade: 'all', min: '', al: false, q: '', sort: lsg('scr_sort', 's'), dir: -1, lim: 60 };
  var SC = window.PROSCREENER = { j: null, at: 0, err: '', F: F };

  function scoreCol(s) { if (s == null) return '#30363d'; var t = Math.max(0, Math.min(1, (s - 25) / 55));
    var r = t < .5 ? 218 : Math.round(218 - (t - .5) * 2 * 180), g = t < .5 ? Math.round(54 + t * 2 * 120) : Math.round(174 + (t - .5) * 2 * 12); return 'rgb(' + r + ',' + g + ',' + (t < .5 ? 51 : 60) + ')'; }
  function biasCls(b) { return b === 'B' ? 'b' : b === 'S' ? 's' : 'n'; }
  function tfv(r, tf) { return tf === 'MTF' ? r.mtf : (r.tf || {})[tf]; }
  function sigOf(r, tf) {
    if (tf !== 'MTF') { var v = (r.tf || {})[tf]; return v && v.sig ? { tf: tf, s: v.sig } : null; }
    var best = null; TFS.forEach(function (t) { var v = (r.tf || {})[t]; if (v && v.sig && (!best || v.sig.age < best.s.age)) best = { tf: t, s: v.sig }; }); return best;
  }
  function match(r) {
    if (F.u !== 'ALL' && r.u !== F.u) return false;
    if (F.sec && r.sec !== F.sec) return false;
    var v = tfv(r, F.tf); if (!v) return false;
    if (F.min && v.s < +F.min) return false;
    if (F.grade === 'A' && v.g !== 'A') return false; if (F.grade === 'AB' && v.g !== 'A' && v.g !== 'B') return false; if (F.grade === 'D' && v.g !== 'D') return false;
    if (F.al && !r.align) return false;
    if (F.q && r.n.toUpperCase().indexOf(F.q.toUpperCase()) < 0 && r.sec.toUpperCase().indexOf(F.q.toUpperCase()) < 0) return false;
    if (F.sig !== 'any') { var x = sigOf(r, F.tf); if (!x) return false; var s = x.s;
      if (F.sig === 'buy' && s.dir !== 'BUY') return false; if (F.sig === 'sell' && s.dir !== 'SELL') return false;
      if (F.sig === 'fresh' && s.age > 3) return false; if (/^(shn|ut|sd)$/.test(F.sig) && String(s.src).toLowerCase() !== F.sig) return false; }
    return true;
  }
  function expQuery(fmt) {
    var q = ['fmt=' + fmt, 'tf=' + F.tf]; if (F.u !== 'ALL') q.push('u=' + F.u); if (F.sec) q.push('sector=' + encodeURIComponent(F.sec));
    if (F.sig !== 'any') q.push('signal=' + F.sig); if (F.min) q.push('min=' + F.min); if (F.grade === 'A') q.push('grade=A'); if (F.grade === 'AB') q.push('grade=A,B'); if (F.grade === 'D') q.push('grade=D');
    if (F.al) q.push('aligned=1'); if (F.q) q.push('q=' + encodeURIComponent(F.q)); return '/cockpit/screener/export?' + q.join('&');
  }

  function boot() {
    var V = window.VPSB, P = window.VPSPRO, tabs = $('proTabs'), body = $('proBody'), sheet = $('proSheet');
    if (!V || !P || !tabs || !body || !sheet) { if (Date.now() - T0 < 20000) return setTimeout(boot, 300); return; }
    if ($('pv-scr')) return;
    var S = P.S;
    var css = d.createElement('style');
    css.textContent = [
      '#pv-scr .tb{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0 0 6px}',
      '#pv-scr select,#pv-scr input[type=search],#pv-scr input[type=number]{background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:8px;padding:6px 7px;font-size:13px;max-width:100%}',
      '#pv-scr input[type=search]{width:110px}#pv-scr input[type=number]{width:62px}',
      '#pv-scr .seg{display:inline-flex;border:1px solid #30363d;border-radius:8px;overflow:hidden}#pv-scr .seg button{background:#0d1117;color:#8b949e;border:0;padding:6px 9px;font:700 12px system-ui;cursor:pointer}#pv-scr .seg button.on{background:#1f6feb;color:#fff}',
      '#pv-scr .hm{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:5px;margin:6px 0 10px}',
      '#pv-scr .hm button{border:1px solid rgba(0,0,0,.35);border-radius:8px;padding:5px 6px;text-align:left;color:#0d1117;cursor:pointer;min-height:54px;font:12px system-ui;overflow:hidden}',
      '#pv-scr .hm button b{display:block;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#pv-scr .hm button .v{font:800 16px system-ui}#pv-scr .hm button .m{font-size:10px;opacity:.85}',
      '#pv-scr .hm button.sel{outline:3px solid #58a6ff;outline-offset:-1px}#pv-scr .hm button .fl{float:right;font-size:9px;background:#0d1117;color:#f0b429;border-radius:4px;padding:0 3px}',
      '#pv-scr .tw{overflow-x:auto;-webkit-overflow-scrolling:touch}@media (min-width:640px){#pv-scr table{min-width:560px}}@media (max-width:639px){#pv-scr .bz{width:20px;font-size:9.5px}#pv-scr td{padding:6px 2px}#pv-scr td .s2{max-width:150px}}#pv-scr th{cursor:pointer;white-space:nowrap}#pv-scr th.on{color:#58a6ff}',
      '#pv-scr td{padding:6px 3px}#pv-scr td .s2{display:block;font-size:10px;color:#8b949e;font-weight:400;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px}',
      '#pv-scr .sc{display:inline-block;min-width:34px;text-align:center;border-radius:6px;padding:2px 4px;font-weight:800;color:#0d1117}',
      '#pv-scr .bz{display:inline-block;width:22px;text-align:center;border-radius:4px;font:700 10px system-ui;padding:2px 0}#pv-scr .bz.b{background:#238636;color:#fff}#pv-scr .bz.s{background:#da3633;color:#fff}#pv-scr .bz.n{background:#30363d;color:#c9d1d9}',
      '#pv-scr .sgb{font-size:11px;font-weight:700;white-space:nowrap}#pv-scr .sgb.buy{color:#3fb950}#pv-scr .sgb.sell{color:#f85149}',
      '#pv-scr .dl{margin-left:auto;display:flex;gap:6px}#pv-scr .dl .btn.x{background:#1a7f37;border-color:#2ea043}',
      '#pv-scr .more{display:block;width:100%;margin-top:8px}',
      '#scrModal{position:fixed;inset:0;z-index:10001;background:rgba(1,4,9,.82);display:flex;align-items:flex-start;justify-content:center;padding:calc(8px + env(safe-area-inset-top)) 6px 8px}',
      '#scrModal .bx{background:#0d1117;border:1px solid #30363d;border-radius:12px;width:min(1100px,100%);max-height:100%;overflow:auto;padding:8px}',
      '#scrModal .hd{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px}#scrModal .hd b{font-size:15px;flex:1 1 auto}',
      '#scrModal .btn{background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:8px;padding:6px 10px;font:600 12px system-ui;cursor:pointer}#scrModal .btn.on{background:#1f6feb;border-color:#1f6feb}',
      '#scrModal .kv{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:4px;margin-top:6px;font-size:12px}#scrModal .kv div{background:#161b22;border-radius:6px;padding:4px 6px}#scrModal .kv span{display:block;color:#8b949e;font-size:10px}',
      '#scrModal .mk{font-size:12px;margin-top:6px;color:#c9d1d9}#scrModal .mk div{padding:3px 0;border-top:1px solid #21262d}',
      '@media (min-width:1100px){#pv-scr{grid-column:1 / -1;grid-row:4}#pv-scr .hm{grid-template-columns:repeat(auto-fill,minmax(130px,1fr))}}'
    ].join('\n');
    d.head.appendChild(css);
    var btn = d.createElement('button'); btn.type = 'button'; btn.dataset.t = 'scr'; btn.textContent = 'Screener';
    var after = tabs.querySelector('button[data-t="bots"]'); tabs.insertBefore(btn, after ? after.nextSibling : (tabs.children[1] || null));
    var sec = d.createElement('section'); sec.className = 'pv'; sec.id = 'pv-scr';
    sec.innerHTML = '<h3>Pro Screener · NSE F&amp;O + MCX · 15m / 2H / 4H / D</h3><div class="pvb" id="pvb-scr"></div>';
    var ab = $('pv-bots'); body.insertBefore(sec, ab ? ab.nextSibling : body.firstChild);

    function shown() { return sheet.classList.contains('on') && (wide() || S.tab === 'scr'); }
    function sync() {
      var on = shown(); sec.classList.toggle('on', on); btn.classList.toggle('on', S.tab === 'scr' && !wide());
      if (on && (!SC.j || Date.now() - SC.at > 180000)) load();
      if (on && !SC.painted) paint();
    }
    tabs.addEventListener('click', function () { setTimeout(sync, 0); });
    new MutationObserver(function () { setTimeout(sync, 0); }).observe(sheet, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', function () { setTimeout(sync, 0); });
    setInterval(function () { if (shown() && !d.hidden && Date.now() - SC.at > 180000) load(); }, 30000);

    function load() {
      if (!V.key()) { paint(); return; }
      if (SC.busy) return; SC.busy = true;
      V.get('/cockpit/screener').then(function (j) { SC.j = j; SC.at = Date.now(); SC.err = ''; })
        .catch(function (e) { SC.err = e.message; }).then(function () { SC.busy = false; SC.painted = false; if (shown()) paint(); });
    }
    function paint() {
      var box = $('pvb-scr'); if (!box) return; SC.painted = true;
      if (!V.key()) { box.innerHTML = '<div class="warn">Save the Cloud OpenAlgo API key on the <b>Live feed</b> tab to load the screener.</div>'; return; }
      var j = SC.j;
      if (!j) { box.innerHTML = '<div class="st">' + (SC.err ? '<span class="dn">' + esc(SC.err) + '</span>' : 'Loading Pro Screener…') + '</div>'; return; }
      var secs = (j.sectors || []).filter(function (s) { return F.u === 'ALL' || s.u === F.u; });
      var secNames = (j.sectors || []).filter(function (s) { return F.u === 'ALL' || s.u === F.u; }).map(function (s) { return s.name; });
      if (F.sec && secNames.indexOf(F.sec) < 0) F.sec = '';
      var h = '';
      var ti = j.tf_info || {}, tfi = F.tf === 'MTF' ? null : ti[F.tf];
      h += '<div class="st">Run <b>' + esc(j.run_ist || '') + '</b> · ' + ((j.universe || {}).scored || (j.stocks || []).length) + ' scored' +
        (tfi ? ' · last ' + TFL[F.tf] + ' bar NSE ' + esc(tfi.nse_bar || '–') + ' / MCX ' + esc(tfi.mcx_bar || '–') : '') + (SC.err ? ' · <span class="dn">' + esc(SC.err) + '</span>' : '') +
        ' · <span class="mu">scores only, no orders</span></div>';
      h += '<div class="tb"><span class="seg" data-k="u">' + ['ALL', 'NSE', 'MCX'].map(function (u) { return '<button type="button" data-v="' + u + '" class="' + (F.u === u ? 'on' : '') + '">' + (u === 'ALL' ? 'All' : u) + '</button>'; }).join('') + '</span>' +
        '<span class="seg" data-k="tf">' + ['MTF'].concat(TFS).map(function (t) { return '<button type="button" data-v="' + t + '" class="' + (F.tf === t ? 'on' : '') + '">' + TFL[t] + '</button>'; }).join('') + '</span></div>';
      h += '<div class="hm">' + secs.slice().sort(function (a, b) { return (((b.tf || {})[F.tf] || {}).s || 0) - (((a.tf || {})[F.tf] || {}).s || 0); }).map(function (s) {
        var v = (s.tf || {})[F.tf] || {};
        return '<button type="button" data-sec="' + esc(s.name) + '" class="' + (F.sec === s.name ? 'sel' : '') + '" style="background:' + scoreCol(v.s) + '">' + (v.flip ? '<span class="fl">FLIP</span>' : '') +
          '<b>' + esc(s.name) + (F.u === 'ALL' && s.u === 'MCX' ? ' ·M' : '') + '</b><span class="v">' + n(v.s, 0) + '</span> <span class="m">' + sg(v.d) + '</span><div class="m">' + (v.breadth != null ? v.breadth + '% bull · ' : '') + (s.n || '') + ' stk</div></button>';
      }).join('') + '</div>';
      h += '<div class="tb"><select id="scrSec"><option value="">All sectors</option>' + secNames.map(function (x) { return '<option' + (F.sec === x ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select>' +
        '<select id="scrSig">' + [['any', 'Any signal'], ['fresh', 'Fresh ≤3 bars'], ['buy', 'Buy'], ['sell', 'Sell'], ['ut', 'UT'], ['shn', 'SHN'], ['sd', 'SD Rainbow']].map(function (o) { return '<option value="' + o[0] + '"' + (F.sig === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
        '<select id="scrGr">' + [['all', 'All grades'], ['A', 'Grade A'], ['AB', 'A + B'], ['D', 'Grade D']].map(function (o) { return '<option value="' + o[0] + '"' + (F.grade === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
        '<input type="number" id="scrMin" placeholder="min" min="0" max="100" value="' + esc(F.min) + '">' +
        '<label style="font-size:12px;white-space:nowrap"><input type="checkbox" id="scrAl"' + (F.al ? ' checked' : '') + '> 4-TF aligned</label>' +
        '<input type="search" id="scrQ" placeholder="Search" value="' + esc(F.q) + '">' +
        '<span class="dl"><button class="btn" type="button" data-dl="csv">⬇ CSV</button><button class="btn x" type="button" data-dl="xlsx">⬇ Excel</button></span></div>';
      var rows = (j.stocks || []).filter(match), key = F.sort, dir = F.dir;
      rows.sort(function (a, b) {
        var va, vb; if (key === 'n') { va = a.n; vb = b.n; return dir * (va < vb ? -1 : va > vb ? 1 : 0); }
        if (key === 'chg') { va = a.chg; vb = b.chg; } else if (key === 'd') { va = (tfv(a, F.tf) || {}).d; vb = (tfv(b, F.tf) || {}).d; }
        else if (key === 'sig') { var x = sigOf(a, F.tf), y = sigOf(b, F.tf); va = x ? -x.s.age : -999; vb = y ? -y.s.age : -999; }
        else { va = (tfv(a, F.tf) || {}).s; vb = (tfv(b, F.tf) || {}).s; }
        va = va == null ? -1e9 : va; vb = vb == null ? -1e9 : vb; return dir * (va - vb);
      });
      var M = mob(), cols = M ? [['n', 'Stock · signal'], ['s', TFL[F.tf]], ['', '15m 2H 4H D'], ['chg', 'LTP']] : [['n', 'Stock'], ['s', TFL[F.tf] + ' score'], ['d', 'Δ'], ['', '15m 2H 4H D'], ['sig', 'Signal'], ['chg', 'LTP · day']];
      h += '<div class="st">' + rows.length + ' of ' + (j.stocks || []).length + (F.sec ? ' · sector <b>' + esc(F.sec) + '</b> <a href="#" data-clr="1">clear</a>' : '') + ' · tap a row for its chart</div>';
      h += '<div class="tw"><table><thead><tr>' + cols.map(function (c) { return '<th' + (c[0] ? ' data-s="' + c[0] + '"' : '') + ' class="' + (c[0] && c[0] === key ? 'on' : '') + '">' + c[1] + (c[0] === key ? (dir < 0 ? ' ▼' : ' ▲') : '') + '</th>'; }).join('') + '</tr></thead><tbody>';
      h += rows.slice(0, F.lim).map(function (r) {
        var v = tfv(r, F.tf) || {}, x = sigOf(r, F.tf), s = x && x.s;
        var dots = TFS.map(function (t) { var z = (r.tf || {})[t]; return '<span class="bz ' + biasCls(z && z.b) + '" title="' + TFL[t] + ' ' + (z ? n(z.s, 0) : '–') + '">' + (z ? n(z.s, 0) : '–') + '</span>'; }).join(' ');
        var al = r.align ? ' <span class="tag" style="color:' + (r.align === 'B' ? '#3fb950' : '#f85149') + '">4TF' + (r.align === 'B' ? '▲' : '▼') + '</span>' : '';
        var sgh = s ? '<span class="sgb ' + (s.dir === 'BUY' ? 'buy' : 'sell') + '">' + esc(s.k) + '</span><span class="s2">' + TFL[x.tf] + ' · ' + s.age + ' bar' + (s.age === 1 ? '' : 's') + ' ago' + (s.e ? ' · @' + n(s.e) : '') + '</span>' : '<span class="mu">–</span>';
        var scd = '<span class="sc" style="background:' + scoreCol(v.s) + '">' + n(v.s, 0) + '</span> <span class="mu">' + esc(v.g || '') + '</span>';
        var dd = '<span class="' + (v.d > 0 ? 'ok' : v.d < 0 ? 'dn' : '') + '">' + sg(v.d) + '</span>';
        if (M) return '<tr data-row="' + esc(r.n) + '"><td><b>' + (r.fav ? '★ ' : '') + esc(r.n) + '</b>' + al + '<span class="s2">' + esc(r.sec) + (r.u === 'MCX' ? ' · MCX' : '') + '</span>' + (s ? '<span class="sgb ' + (s.dir === 'BUY' ? 'buy' : 'sell') + '" style="font-size:10.5px">' + esc(s.k) + ' · ' + TFL[x.tf] + ' · ' + s.age + 'b</span>' : '') + '</td>' +
          '<td style="white-space:nowrap">' + scd + '<span class="s2" style="text-align:right">' + dd + '</span></td><td style="white-space:nowrap">' + dots + '</td>' +
          '<td>' + n(r.ltp) + '<span class="s2 ' + (r.chg > 0 ? 'ok' : r.chg < 0 ? 'dn' : '') + '">' + sg(r.chg, 2) + '%</span></td></tr>';
        return '<tr data-row="' + esc(r.n) + '"><td><b>' + (r.fav ? '★ ' : '') + esc(r.n) + '</b>' + al + '<span class="s2">' + esc(r.sec) + (r.u === 'MCX' ? ' · MCX' : '') + '</span></td>' +
          '<td>' + scd + '</td><td>' + dd + '</td><td style="white-space:nowrap">' + dots + '</td><td>' + sgh + '</td>' +
          '<td>' + n(r.ltp) + '<span class="s2 ' + (r.chg > 0 ? 'ok' : r.chg < 0 ? 'dn' : '') + '">' + sg(r.chg, 2) + '%</span></td></tr>';
      }).join('') + '</tbody></table></div>';
      if (rows.length > F.lim) h += '<button class="btn more" type="button" data-more="1">Show ' + Math.min(60, rows.length - F.lim) + ' more (' + (rows.length - F.lim) + ' hidden)</button>';
      h += '<div class="st" style="margin-top:8px">Score = trend 30% · momentum 25% · relative strength 20% · volume 15% · signal 10%. Grades: ' + esc(j.grades || '') + '. Data from the VPS scan every 15 min (weekdays).</div>';
      var sx = box.querySelector('.tw'), sl = sx ? sx.scrollLeft : 0;
      box.innerHTML = h; if (sl && box.querySelector('.tw')) box.querySelector('.tw').scrollLeft = sl;
    }
    sec.addEventListener('click', function (e) {
      var t = e.target, b;
      if ((b = t.closest('.seg button'))) { var k = b.parentNode.dataset.k; F[k] = b.dataset.v; lss(k === 'u' ? 'scr_u' : 'scr_tf', F[k]); F.lim = 60; return paint(); }
      if ((b = t.closest('.hm button[data-sec]'))) { F.sec = F.sec === b.dataset.sec ? '' : b.dataset.sec; F.lim = 60; return paint(); }
      if ((b = t.closest('th[data-s]'))) { if (F.sort === b.dataset.s) F.dir = -F.dir; else { F.sort = b.dataset.s; F.dir = b.dataset.s === 'n' ? 1 : -1; } lss('scr_sort', F.sort); return paint(); }
      if ((b = t.closest('[data-more]'))) { F.lim += 60; return paint(); }
      if ((b = t.closest('[data-clr]'))) { e.preventDefault(); F.sec = ''; return paint(); }
      if ((b = t.closest('[data-dl]'))) { if (window.CKDL) CKDL.get(expQuery(b.dataset.dl), 'pro_screener.' + b.dataset.dl, b); return; }
      if ((b = t.closest('tr[data-row]'))) { var r = ((SC.j || {}).stocks || []).find(function (x) { return x.n === b.dataset.row; }); if (r) chart(r, F.tf === 'MTF' ? '2h' : F.tf); }
    });
    sec.addEventListener('change', function (e) {
      var id = e.target.id; if (id === 'scrSec') F.sec = e.target.value; else if (id === 'scrSig') F.sig = e.target.value; else if (id === 'scrGr') F.grade = e.target.value;
      else if (id === 'scrMin') F.min = e.target.value; else if (id === 'scrAl') F.al = e.target.checked; else return; F.lim = 60; paint();
    });
    var qt; sec.addEventListener('input', function (e) { if (e.target.id !== 'scrQ') return; clearTimeout(qt); qt = setTimeout(function () { F.q = e.target.value.trim(); F.lim = 60; paint(); var q = $('scrQ'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 350); });

    /* ---------- chart modal ---------- */
    function chart(r, tf) {
      var m = $('scrModal'); if (m) m.remove();
      m = d.createElement('div'); m.id = 'scrModal';
      var canCk = r.u === 'MCX' && typeof window.fxRow === 'function' && window.fxRow('M:' + r.n);
      m.innerHTML = '<div class="bx"><div class="hd"><b>' + esc(r.n) + ' <span class="mu" style="font-size:12px;font-weight:400">' + esc(r.sec) + ' · ' + esc(r.u) + '</span></b>' +
        TFS.map(function (t) { return '<button class="btn' + (t === tf ? ' on' : '') + '" type="button" data-tf="' + t + '">' + TFL[t] + '</button>'; }).join('') +
        (canCk ? '<button class="btn" type="button" data-ck="1">Cockpit chart</button>' : '') + '<button class="btn" type="button" data-x="1">✕</button></div>' +
        '<div id="scrKv"></div><div id="scrChart" style="height:' + (mob() ? 360 : 460) + 'px"></div><div class="mk" id="scrMk"></div></div>';
      d.body.appendChild(m);
      m.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (e.target === m || (b && b.dataset.x)) { try { Plotly.purge('scrChart'); } catch (er) {} m.remove(); return; }
        if (b && b.dataset.tf) { m.querySelectorAll('[data-tf]').forEach(function (z) { z.classList.toggle('on', z === b); }); draw(r, b.dataset.tf); }
        if (b && b.dataset.ck) { try { Plotly.purge('scrChart'); } catch (er) {} m.remove(); var c = $('proClose'); if (c) c.click(); setTimeout(function () { try { window.fxOpen('M:' + r.n); } catch (er) {} }, 60); }
      });
      draw(r, tf);
    }
    function draw(r, tf) {
      var v = (r.tf || {})[tf] || {}, kv = $('scrKv'), mk = $('scrMk'), el = $('scrChart'); if (!el) return;
      var sub = v.sub || [];
      kv.innerHTML = '<div class="kv"><div><span>Score ' + TFL[tf] + '</span><b>' + n(v.s, 0) + '</b> ' + esc(v.g || '') + ' ' + sg(v.d) + '</div><div><span>Trend · Mom</span>' + (sub[0] != null ? sub[0] + ' · ' + sub[1] : '–') + '</div>' +
        '<div><span>RS · Vol · Sig</span>' + (sub[2] != null ? sub[2] + ' · ' + sub[3] + ' · ' + sub[4] : '–') + '</div><div><span>RSI · ROC</span>' + n(v.rsi, 1) + ' · ' + sg(v.roc, 2) + '%</div>' +
        '<div><span>RS vs Nifty/sector</span>' + sg(v.rsN, 1) + ' / ' + sg(v.rsS, 1) + '%</div><div><span>SHN state</span>' + esc(v.shn_state || '–') + '</div>' +
        (v.sig ? '<div><span>Signal</span>' + esc(v.sig.k) + ' · ' + v.sig.age + ' bars · e ' + n(v.sig.e) + ' sl ' + n(v.sig.sl) + '</div>' : '') + '</div>';
      el.innerHTML = '<div class="st" style="padding:10px">Loading ' + TFL[tf] + ' candles…</div>'; mk.innerHTML = '';
      V.get('/cockpit/screener/candles?name=' + encodeURIComponent(r.n) + '&tf=' + tf).then(function (j) {
        if (!$('scrChart')) return;
        var bars = j.bars || [], x = bars.map(function (b) { return ist(b[0], tf === 'D'); }), idx = {};
        bars.forEach(function (b, i) { idx[b[0]] = i; });
        var T = [{ type: 'candlestick', x: x, open: bars.map(function (b) { return b[1]; }), high: bars.map(function (b) { return b[2]; }), low: bars.map(function (b) { return b[3]; }), close: bars.map(function (b) { return b[4]; }),
          increasing: { line: { color: '#26a69a', width: 1 }, fillcolor: '#26a69a' }, decreasing: { line: { color: '#ef5350', width: 1 }, fillcolor: '#ef5350' }, name: r.n, showlegend: false }];
        if (j.ema20) T.push({ type: 'scatter', mode: 'lines', x: x, y: j.ema20, name: 'EMA20', line: { color: '#e3b341', width: 1.2 }, hoverinfo: 'skip' });
        if (j.ema50) T.push({ type: 'scatter', mode: 'lines', x: x, y: j.ema50, name: 'EMA50', line: { color: '#d2a8ff', width: 1.2 }, hoverinfo: 'skip' });
        var rg = 0, cn = 0; bars.slice(-60).forEach(function (b) { rg += b[2] - b[3]; cn++; }); var pad = (cn ? rg / cn : 1) * 0.5;
        var ms = (j.markers || []).filter(function (q) { return idx[q.t] != null || bars.length; }).map(function (q) {
          var i = idx[q.t]; if (i == null) { for (var k = bars.length - 1; k >= 0; k--) if (bars[k][0] <= q.t) { i = k; break; } } if (i == null) return null;
          var up = q.side > 0 && !/exit/i.test(q.kind); return { i: i, up: up, q: q, y: up ? bars[i][3] - pad : bars[i][2] + pad };
        }).filter(Boolean);
        var col = function (o) { var s = /^SD/i.test(o.q.kind) ? 'SD' : /^UT/i.test(o.q.kind) ? 'UT' : 'SHN'; return o.up ? { SD: '#d2a8ff', UT: '#3fb950', SHN: '#56d4dd' }[s] : { SD: '#ff7ab6', UT: '#f85149', SHN: '#f0883e' }[s]; };
        if (ms.length) T.push({ type: 'scatter', mode: 'markers', x: ms.map(function (o) { return x[o.i]; }), y: ms.map(function (o) { return o.y; }), name: 'Signals',
          marker: { size: mob() ? 10 : 12, symbol: ms.map(function (o) { return o.up ? 'triangle-up' : /exit/i.test(o.q.kind) ? 'x-thin-open' : 'triangle-down'; }), color: ms.map(col), line: { color: ms.map(col), width: 1.5 } },
          hovertext: ms.map(function (o) { return esc(o.q.kind) + ' @ ' + n(o.q.price) + ' · ' + ist(o.q.t, tf === 'D') + (tf === 'D' ? '' : ' IST'); }), hoverinfo: 'text' });
        var nb = bars.length, w = mob() ? 70 : 140;
        var yr = function (a, z) { a = Math.max(0, Math.ceil(a)); z = Math.min(nb - 1, Math.floor(z)); var lo = Infinity, hi = -Infinity;
          for (var i = a; i <= z; i++) { if (bars[i][3] < lo) lo = bars[i][3]; if (bars[i][2] > hi) hi = bars[i][2]; }
          ms.forEach(function (o) { if (o.i >= a && o.i <= z) { lo = Math.min(lo, o.y); hi = Math.max(hi, o.y); } });
          if (!isFinite(lo)) return undefined; var p = (hi - lo) * 0.06 || hi * 0.01; return [lo - p, hi + p]; };
        var L = { paper_bgcolor: '#0d1117', plot_bgcolor: '#0d1117', font: { color: '#c9d1d9', size: 10 }, margin: { l: 6, r: 52, t: 24, b: 28 }, hovermode: 'closest', dragmode: 'pan', showlegend: true,
          legend: { orientation: 'h', y: 1.0, yanchor: 'bottom', x: 0, font: { size: 9.5 } },
          xaxis: { type: 'category', range: [Math.max(-0.5, nb - w), nb + 1], rangeslider: { visible: false }, nticks: mob() ? 4 : 8, gridcolor: 'rgba(48,54,61,.5)', tickfont: { size: 9 } },
          yaxis: { side: 'right', gridcolor: 'rgba(48,54,61,.5)', tickfont: { size: 9 }, range: yr(Math.max(0, nb - w), nb - 1), fixedrange: false } };
        el.innerHTML = ''; Plotly.react(el, T, L, { displaylogo: false, responsive: true, displayModeBar: false, scrollZoom: true });
        var fit = false; el.on('plotly_relayout', function (ev) { if (fit) return; var a = ev['xaxis.range[0]'], z = ev['xaxis.range[1]'], r2 = ev['xaxis.range'];
          var lo = a != null ? a : r2 && r2[0], hi = z != null ? z : r2 && r2[1]; if (lo == null || hi == null) return; var y = yr(+lo, +hi); if (!y) return;
          fit = true; Plotly.relayout(el, { 'yaxis.range': y }).then(function () { fit = false; }, function () { fit = false; }); });
        var last = ms.slice(-8).reverse();
        mk.innerHTML = last.length ? '<b>Latest signals (' + TFL[tf] + ')</b>' + last.map(function (o) { return '<div><b style="color:' + col(o) + '">' + (o.up ? '▲ ' : '▼ ') + esc(o.q.kind) + '</b> @ ' + n(o.q.price) + ' · ' + ist(o.q.t, tf === 'D') + (tf === 'D' ? '' : ' IST') + '</div>'; }).join('') :
          '<span class="mu">No SHN / UT / SD signals in the loaded ' + TFL[tf] + ' bars.</span>';
        mk.innerHTML += '<div class="mu">Updated ' + esc(j.updated_ist || '') + ' IST · closed bars from the VPS scan · tap a marker for price and time</div>';
      }).catch(function (e) { if ($('scrChart')) $('scrChart').innerHTML = '<div class="st dn" style="padding:10px">' + esc(e.message) + '</div>'; });
    }
    sync();
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot); else boot();
})();
