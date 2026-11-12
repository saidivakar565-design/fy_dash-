/* SHN Matrix v3.4 in the cockpit. Read-only candles and quotes. No orders, no tokens.
   MCX trade state: Fyers history already used by the Daily Board (closed bars, throttled).
   Falls back to the laptop Market Radar address (Tailscale) when Fyers is not logged in.
   NSE screener: laptop shn_v34_state.json when reachable, else a watchlist of at most 30 symbols on Daily. */
(function () {
  'use strict';
  if (!window.SHNv34) { console.warn('SHN v3.4 engine missing'); return; }

  var TF = {
    D: { res: 'D', span: 86400, days: 366, refresh: 86400000 },
    '4h': { res: '240', span: 14400, days: 100, refresh: 14400000 },
    '2h': { res: '120', span: 7200, days: 100, refresh: 7200000 },
    '15m': { res: '15', span: 900, days: 30, refresh: 16 * 60000 }
  };
  var TFS = ['D', '4h', '2h', '15m'];
  var TFN = { D: 'D', '4h': '4H', '2h': '2H', '15m': '15m' };
  var RES2TF = { D: 'D', '240': '4h', '120': '2h', '15': '15m', '60': '60' };
  var STATE_NAME = { 1: 'Strong long', 2: 'Long weakening', 3: 'Strong short', 4: 'Short weakening', 5: 'Wait for buy', 6: 'No long', 7: 'Mixed' };
  var SHORT = { 1: 'STRONG LONG', 2: 'LONG WEAK', 3: 'STRONG SHORT', 4: 'SHORT WEAK', 5: 'WAIT BUY', 6: 'NO LONG', 7: 'MIXED' };
  var NSE_DEF = ['LT', 'SBIN', 'BHARTIARTL', 'TATASTEEL', 'KALYANKJIL', 'HDFCBANK', 'RELIANCE', 'ICICIBANK', 'INFY', 'TCS', 'AXISBANK', 'HINDALCO', 'TITAN', 'MARUTI', 'BAJFINANCE', 'SUNPHARMA', 'ITC', 'KOTAKBANK', 'NTPC', 'ONGC', 'COALINDIA', 'POWERGRID', 'ULTRACEMCO', 'NESTLEIND', 'ASIANPAINT', 'ADANIENT', 'EICHERMOT', 'GRASIM', 'BEL', 'CIPLA'];
  var MEM = Object.create(null);
  var LAST = Object.create(null);
  var FILT = null;
  var UNIV = 'nse';
  var HUB_TF = '2h';
  var busy = Object.create(null);
  var gap = 1600, lastReq = 0, pauseUntil = 0, chain = Promise.resolve();
  var lap = { at: 0, ok: null, err: '', scan: '' };
  var started = false;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function lj(k, v) {
    try {
      if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null');
      localStorage.setItem(k, JSON.stringify(v));
      return true;
    } catch (e) { return v === undefined ? null : false; }
  }
  function num(v) {
    if (v == null || !isFinite(+v)) return '–';
    var n = +v, d = Math.abs(n) >= 1000 ? 0 : Math.abs(n) >= 100 ? 1 : 2;
    if (typeof fmtN === 'function') return fmtN(n, d);
    return n.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
  }
  function istStamp(ms) {
    var d = new Date((ms || Date.now()) + 19800000).toISOString();
    return d.slice(11, 16) + ' IST';
  }
  function istBar(sec) {
    if (sec == null || !isFinite(+sec)) return '';
    var d = new Date((+sec + 19800) * 1000).toISOString();
    var mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+d.slice(5, 7) - 1];
    return d.slice(8, 10) + ' ' + mon + ' ' + d.slice(11, 16);
  }
  function istNow() {
    var d = new Date(Date.now() + 19800000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate(), mins: d.getUTCHours() * 60 + d.getUTCMinutes() };
  }
  function normTf(tf) {
    var s = String(tf || 'D');
    if (s === '4H' || s === '240') return '4h';
    if (s === '2H' || s === '120') return '2h';
    if (s === '15' || s === '15M') return '15m';
    if (s === '60') return '60';
    return TF[s] ? s : 'D';
  }
  function settingsFor(market) { return market === 'NSE' ? SHNv34.SETTINGS_NSE : SHNv34.SETTINGS_MCX; }
  function shortLab(snap) {
    if (!snap) return '';
    if (snap.code === 6) return snap.allowShort ? 'WAIT SELL' : 'NO LONG';
    return SHORT[snap.code] || snap.label;
  }
  function cleanRows(rows) {
    var m = {}, out = [];
    (rows || []).forEach(function (x) {
      if (!x) return;
      var t = Array.isArray(x) ? +x[0] : +x.time;
      if (t > 1e12) t = Math.floor(t / 1000);
      var o = Array.isArray(x) ? +x[1] : +x.open;
      var h = Array.isArray(x) ? +x[2] : +x.high;
      var l = Array.isArray(x) ? +x[3] : +x.low;
      var c = Array.isArray(x) ? +x[4] : +x.close;
      var v = Array.isArray(x) ? +(x[5] || 0) : +(x.volume || 0);
      if (![t, o, h, l, c].every(isFinite)) return;
      if (h < l) { var z = h; h = l; l = z; }
      m[t] = [t, o, h, l, c, v];
    });
    Object.keys(m).map(Number).sort(function (a, b) { return a - b; }).forEach(function (k) { out.push(m[k]); });
    return out;
  }
  function dropForming(rows, tf, market) {
    rows = cleanRows(rows);
    if (!rows.length) return rows;
    var last = rows[rows.length - 1][0], now = Date.now() / 1000;
    if (tf === 'D') {
      var a = new Date((last + 19800) * 1000), b = istNow();
      var same = a.getUTCFullYear() === b.y && a.getUTCMonth() === b.m && a.getUTCDate() === b.day;
      var close = market === 'NSE' ? 15 * 60 + 30 : 23 * 60 + 30;
      if (same && b.mins < close) return rows.slice(0, -1);
      return rows;
    }
    var span = (TF[tf] && TF[tf].span) || 3600;
    if (now < last + span) return rows.slice(0, -1);
    return rows;
  }
  function livePx(sym) {
    try {
      if (typeof liveQuote === 'function') {
        var q = liveQuote(sym);
        if (q && q.ltp) return q.ltp;
      }
    } catch (e) {}
    if (window.CK && CK.px) {
      var id = 'MCX|' + sym;
      if (CK.px[id] && CK.px[id].ltp != null) return CK.px[id].ltp;
    }
    return null;
  }
  function distOf(snap, sym) {
    if (!snap || snap.stop == null) return null;
    var px = livePx(sym);
    if (px == null) px = snap.close;
    if (px == null || !isFinite(+px) || +px === 0) return null;
    return Math.abs(+px - snap.stop) / Math.abs(+px) * 100;
  }

  function filt() {
    if (FILT) return FILT;
    var s = lj('shn_filt');
    FILT = s && s.states ? s : { states: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 }, barsMax: 20, stopMax: 10, ut: 'any', tfNse: 'D', tfMcx: '2h' };
    TFS.concat([1, 2, 3, 4, 5, 6, 7]).forEach(function () {});
    return FILT;
  }
  function saveFilt() { lj('shn_filt', filt()); }
  function bells() { return lj('shn_bells') || {}; }
  function bellOn(id, tf) { return !!bells()[id + '|' + tf]; }
  function toggleBell(id, tf) {
    var b = bells(); var k = id + '|' + tf;
    if (b[k]) delete b[k]; else b[k] = 1;
    lj('shn_bells', b);
  }
  function wl() {
    var s = lj('shn_nse_wl');
    if (Array.isArray(s) && s.length) return s.slice(0, 30);
    return NSE_DEF.slice();
  }
  function saveWl(text) {
    var syms = String(text || '').toUpperCase().split(/[^A-Z0-9&.-]+/).filter(Boolean);
    var out = [];
    syms.forEach(function (s) { if (out.length < 30 && out.indexOf(s) < 0) out.push(s); });
    lj('shn_nse_wl', out);
    return out;
  }

  function auth() {
    try {
      if (typeof FyAuth === 'undefined' || !FyAuth.valid || !FyAuth.valid()) return null;
      var t = FyAuth.tok(); var id = (typeof FyCfg !== 'undefined' && FyCfg.appId) || t.appId;
      if (!id || !t.access) return null;
      return id + ':' + t.access;
    } catch (e) { return null; }
  }
  function throttle(fn) {
    var run = chain.then(function () {
      var wait = Math.max(0, lastReq + gap - Date.now(), pauseUntil - Date.now());
      return new Promise(function (r) { setTimeout(r, wait); });
    }).then(function () {
      lastReq = Date.now();
      return fn();
    }).then(function (v) { gap = 1600; return v; }, function (e) {
      if (String(e && e.message || e).indexOf('429') >= 0) { gap = Math.min(8000, gap * 2); pauseUntil = Date.now() + 20000; }
      throw e;
    });
    chain = run.then(function () {}, function () {});
    return run;
  }
  function fyOfMcx(k) {
    try {
      if (typeof fxRow === 'function') { var r = fxRow('M:' + k); if (r && r.fy) return r.fy; }
      if (typeof fyTicker === 'function' && window.LCFG && LCFG.map && LCFG.map[k]) return fyTicker(k, LCFG.map[k]);
      var mt = window.LCFG && LCFG.meta && LCFG.meta[k];
      return mt && mt.fyers || null;
    } catch (e) { return null; }
  }
  function fyOfNse(sym) {
    try {
      if (window.RadarTabs && RadarTabs.fySymbol) return RadarTabs.fySymbol('NSE', sym);
    } catch (e) {}
    return 'NSE:' + sym + '-EQ';
  }
  function radarBase() {
    try { if (window.RadarTabs && RadarTabs.base) return RadarTabs.base(); } catch (e) {}
    return 'https://desktop-3565pu7.tailece833.ts.net:8443';
  }

  function put(fy, tf, rows, src, persist) {
    if (!fy) return null;
    tf = normTf(tf);
    rows = dropForming(rows, tf, fy.indexOf('NSE:') === 0 ? 'NSE' : 'MCX');
    if (rows.length < 40) return null;
    var market = fy.indexOf('NSE:') === 0 ? 'NSE' : 'MCX';
    var snap = SHNv34.snapshot(rows, settingsFor(market));
    if (!snap) return null;
    var prev = LAST[fy + '|' + tf];
    MEM[fy + '|' + tf] = { fy: fy, tf: tf, bars: rows, snap: snap, at: Date.now(), src: src || 'fyers' };
    LAST[fy + '|' + tf] = snap.code + '|' + (snap.flipTime || '');
    if (persist !== false) persistBars(fy, tf, rows, src || 'fyers');
    if (prev != null && prev !== LAST[fy + '|' + tf]) ring(fy, tf, snap);
    return snap;
  }
  function persistBars(fy, tf, rows, src) {
    var key = 'shn_c2_' + tf + '_' + fy.replace(/[^A-Za-z0-9]+/g, '_');
    var keep = rows.slice(-420);
    var ok = lj(key, { at: Date.now(), src: src, bars: keep, fy: fy, tf: tf });
    if (!ok) return;
    var idx = lj('shn_c2_idx') || [];
    idx = idx.filter(function (k) { return k !== key; });
    idx.unshift(key);
    while (idx.length > 60) lj(idx.pop(), null);
    lj('shn_c2_idx', idx);
  }
  function loadStore() {
    var idx = lj('shn_c2_idx') || [];
    idx.forEach(function (key) {
      var rec = lj(key);
      if (!rec || !rec.fy || !rec.bars) return;
      var tf = normTf(rec.tf || 'D');
      put(rec.fy, tf, rec.bars, rec.src || 'saved', false);
      if (MEM[rec.fy + '|' + tf]) MEM[rec.fy + '|' + tf].at = rec.at || 0;
    });
  }
  function ring(fy, tf, snap) {
    var id = (fy.indexOf('NSE:') === 0 ? 'NSE|' + fy.replace(/^NSE:/, '').replace(/-EQ$/, '') : 'MCX|' + symOfFy(fy));
    if (!bellOn(id, tf) && !(window.CK && CK.rules && CK.rules.inst && CK.rules.inst[id] && CK.rules.inst[id].shnState && CK.rules.inst[id].shnState.on)) return;
    var title = 'SHN ' + snap.label;
    var body = TFN[tf] + ' · ' + snap.action;
    var key = 'shnState|' + id + '|' + tf + '|' + snap.code + '|' + (snap.flipTime || '');
    if (typeof window.SHNAlert === 'function') { try { window.SHNAlert({ key: key, sym: symOfFy(fy), rule: 'shn-state', title: title, body: body }); } catch (e) {} return; }
    try {
      if (window.Notification && Notification.permission === 'granted') new Notification(title, { body: body, tag: key, icon: 'icon-192.png' });
    } catch (e) {}
  }
  function symOfFy(fy) {
    var s = String(fy || '');
    if (s.indexOf('NSE:') === 0) return s.slice(4).replace(/-EQ$/, '');
    if (window.LCFG && LCFG.meta) {
      var keys = Object.keys(LCFG.meta);
      for (var i = 0; i < keys.length; i++) if (fyOfMcx(keys[i]) === fy) return keys[i];
    }
    return s.replace(/^MCX:/, '');
  }

  function fetchFy(fy, tf, market) {
    tf = normTf(tf);
    var spec = TF[tf];
    if (!spec || !fy) return Promise.resolve(null);
    var k = fy + '|' + tf;
    if (busy[k]) return busy[k];
    var h = auth();
    if (!h) return Promise.resolve(null);
    var now = Math.floor(Date.now() / 1000);
    var have = MEM[k] && MEM[k].bars && MEM[k].bars.length ? MEM[k].bars[MEM[k].bars.length - 1][0] - spec.span : 0;
    var from = have > 0 ? have : now - spec.days * 86400;
    var url = 'https://api-t1.fyers.in/data/history?symbol=' + encodeURIComponent(fy) + '&resolution=' + spec.res + '&date_format=0&range_from=' + Math.floor(from) + '&range_to=' + now + '&cont_flag=1';
    busy[k] = throttle(function () {
      return fetch(url, { method: 'GET', headers: { Authorization: h }, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { r: r, j: j }; }); })
        .then(function (x) {
          var j = x.j || {};
          if (x.r.status === 429 || j.code === 429 || j.code === -429) throw new Error('429');
          if (j.s !== 'ok' && j.s !== 'no_data') throw new Error(j.message || ('HTTP ' + x.r.status));
          var prev = (MEM[k] && MEM[k].bars) || [];
          var merged = cleanRows(prev.concat(j.candles || []));
          put(fy, tf, merged, 'fyers', true);
          return MEM[k] || null;
        });
    });
    busy[k] = busy[k].then(function (v) { delete busy[k]; return v; }, function (e) { delete busy[k]; throw e; });
    return busy[k];
  }
  function due(fy, tf) {
    var hit = MEM[fy + '|' + tf];
    if (!hit || !hit.bars || !hit.bars.length) return true;
    var spec = TF[normTf(tf)];
    if (!spec) return false;
    return Date.now() - (hit.at || 0) >= spec.refresh;
  }
  function mcxList() {
    var keys = typeof fxHubKeys === 'function' ? fxHubKeys() : ((window.LCFG && LCFG.mcx_keys) || []);
    return keys.map(function (k) { return { market: 'MCX', sym: k, fy: fyOfMcx(k), name: (typeof fxHubShort === 'function' ? fxHubShort(k) : k) }; }).filter(function (x) { return x.fy; });
  }
  function queueMcx(forceTf) {
    if (!auth()) return;
    var list = mcxList();
    var first = forceTf || HUB_TF;
    var order = [first].concat(TFS.filter(function (tf) { return tf !== first; }));
    var jobs = [];
    order.forEach(function (tf) {
      list.forEach(function (x) { if (due(x.fy, tf)) jobs.push({ fy: x.fy, tf: tf }); });
    });
    jobs.reduce(function (p, job) { return p.then(function () { return fetchFy(job.fy, job.tf, 'MCX').catch(function () {}); }); }, Promise.resolve())
      .then(paintAll);
  }
  function scanNse() {
    if (!auth()) return Promise.resolve();
    var syms = wl();
    return syms.reduce(function (p, sym) {
      var fy = fyOfNse(sym);
      return p.then(function () {
        if (!due(fy, 'D')) return null;
        return fetchFy(fy, 'D', 'NSE').catch(function () { return null; });
      });
    }, Promise.resolve()).then(function () { lap.scan = 'fyers'; paintScreener(); });
  }
  function pullLaptop() {
    var ctl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, 6000);
    return fetch(radarBase() + '/shn_v34_state.json', { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { 'X-Radar': '1' }, signal: ctl ? ctl.signal : undefined })
      .then(function (r) { clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        lap.ok = true; lap.at = Date.now(); lap.err = ''; lap.json = j; lap.scan = j && j.generated_ist ? j.generated_ist : istStamp(Date.now());
        applyJson(j);
        return true;
      }, function (e) {
        clearTimeout(t); lap.ok = false; lap.at = Date.now(); lap.err = e && e.name === 'AbortError' ? 'no answer' : String(e && e.message || e);
        return false;
      });
  }
  function applyJson(j) {
    var rows = j && (j.symbols || j.rows || j.items);
    if (!Array.isArray(rows)) return;
    rows.forEach(function (r) {
      if (!r || typeof r.symbol !== 'string' || !(r.state >= 1 && r.state <= 7) || typeof r.action !== 'string') return;
      var market = String(r.market || 'NSE').toUpperCase();
      var tf = normTf(r.tf || r.timeframe || (j.timeframe || 'D'));
      var fy = r.fyers || (market === 'NSE' ? fyOfNse(r.symbol) : fyOfMcx(r.symbol));
      if (!fy) return;
      if (MEM[fy + '|' + tf] && MEM[fy + '|' + tf].src === 'fyers') return;
      var allowShort = market === 'NSE' ? false : r.allow_short !== false;
      var snap = {
        code: r.state,
        label: r.state_label || SHNv34.stateLabel(r.state, allowShort),
        action: r.action,
        pos: r.pos || 0,
        entry: r.entry == null ? null : +r.entry,
        stop: r.stop == null ? null : +r.stop,
        utPos: r.ut_pos == null ? 0 : +r.ut_pos,
        utWeak: r.ut === 'weak',
        utText: r.ut === 'weak' || r.ut === 'agree' ? r.ut : 'flat',
        barsSinceFlip: r.bars_since_flip == null ? null : +r.bars_since_flip,
        barsSinceEntry: r.bars_since_entry == null ? null : +r.bars_since_entry,
        flipTime: r.flip_time || null,
        close: r.ltp == null ? null : +r.ltp,
        stopDistPct: r.stop_dist_pct == null ? null : +r.stop_dist_pct,
        exitHit: String(r.action).indexOf('EXIT HIT') === 0,
        allowShort: allowShort,
        confirmed: !r.forming,
        forming: !!r.forming,
        source: 'laptop'
      };
      MEM[fy + '|' + tf] = { fy: fy, tf: tf, bars: null, snap: snap, at: Date.now(), src: 'laptop', sym: r.symbol, name: r.name || r.symbol };
    });
  }
  function adoptPacks() {
    if (!window.CK || !CK.pack) return;
    Object.keys(CK.pack).forEach(function (id) {
      var p = CK.pack[id]; if (!p || !p.tfs) return;
      var market = id.indexOf('NSE|') === 0 || id.indexOf('GL|') === 0 ? 'NSE' : 'MCX';
      var sym = id.split('|').slice(1).join('|');
      var fy = market === 'NSE' ? fyOfNse(sym) : fyOfMcx(sym);
      if (!fy && window.CK.book) {
        var b = CK.book.filter(function (x) { return x.id === id; })[0];
        if (b) fy = b.fy;
      }
      if (!fy) return;
      TFS.forEach(function (tf) {
        var x = p.tfs[tf];
        if (!x || !x.bars || x.bars.length < 40) return;
        if (MEM[fy + '|' + tf] && MEM[fy + '|' + tf].src === 'fyers') return;
        put(fy, tf, x.bars, 'pack', false);
      });
    });
  }

  function snapOf(fy, tf) { var h = MEM[fy + '|' + normTf(tf)]; return h ? h.snap : null; }
  function stateFor(sym, tf, market) {
    tf = normTf(tf);
    var fy = market === 'NSE' || market === 'GL' ? fyOfNse(sym) : (fyOfMcx(sym) || (window.CK && CK.book && (CK.book.filter(function (b) { return b.sym === sym; })[0] || {}).fy));
    return fy ? snapOf(fy, tf) : null;
  }

  function css() {
    var s = document.createElement('style');
    s.textContent = [
      '.shnbadge{display:inline-block;margin-left:4px;background:#f85149;color:#fff;border-radius:999px;font-size:10px;font-weight:800;padding:0 5px;line-height:16px;vertical-align:1px}',
      '.shnbadge[hidden]{display:none}',
      '.shntf{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:8px 0 2px}',
      '.shntf .seg{flex:1 0 100%}',
      '.shntf .seg button{padding:5px 10px}',
      '.shnbit{display:flex;flex-direction:column;align-items:flex-start;gap:1px;margin-top:3px;min-width:0;width:100%}',
      '.shnst{display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9.5px;font-weight:800;letter-spacing:.03em;border-radius:4px;padding:1px 4px;line-height:1.35}',
      '.shn-1,.shn-5{color:#3fb950;background:#12301a}',
      '.shn-2,.shn-4{color:#e3b341;background:#3b2f0b}',
      '.shn-3,.shn-6{color:#f85149;background:#3d1416}',
      '.shn-7{color:#8b949e;background:#21262d}',
      '.shnmeta,.shnact{font-size:10px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}',
      '.shnact{white-space:normal;line-height:1.3}',
      '.fxht.big .shnst{font-size:11px;padding:2px 6px}',
      '.fxgn{position:absolute}',
      '.fxgn .shndot{position:absolute;top:-1px;right:-1px;width:8px;height:8px;border-radius:50%;background:#e3b341;border:1.5px solid #1f1300;box-shadow:0 0 0 1px rgba(227,179,65,.4)}',
      '.fxgn.shn-1 .fxgdot{border-color:#3fb950;box-shadow:0 0 12px rgba(63,185,80,.7)}',
      '.fxgn.shn-2 .fxgdot,.fxgn.shn-4 .fxgdot{border-color:#e3b341;box-shadow:0 0 12px rgba(227,179,65,.7)}',
      '.fxgn.shn-3 .fxgdot,.fxgn.shn-6 .fxgdot{border-color:#f85149;box-shadow:0 0 12px rgba(248,81,73,.65)}',
      '.fxgn.shn-5 .fxgdot{border-color:#3fb950;box-shadow:0 0 10px rgba(63,185,80,.45)}',
      '.fxgn.shn-7 .fxgdot{border-color:#8b949e;box-shadow:none}',
      '.shnleg{display:flex;flex-wrap:wrap;gap:6px 10px;justify-content:center;margin:6px 0 2px;font-size:10px;color:var(--muted)}',
      '.shnleg i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:3px;vertical-align:0}',
      '.shnsheet{position:fixed;left:0;right:0;bottom:0;z-index:80;background:#121820;border-top:1px solid var(--grid);border-radius:16px 16px 0 0;padding:10px 12px calc(14px + env(safe-area-inset-bottom));box-shadow:0 -12px 40px rgba(0,0,0,.45);max-height:78vh;overflow:auto}',
      '.shnsheet[hidden]{display:none}',
      '.shnshhd{display:flex;align-items:center;gap:8px;margin-bottom:6px}.shnshhd b{font-size:15px}.shnshhd .x{margin-left:auto}',
      '.shnkv{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-top:1px solid var(--grid);font-size:12.5px}.shnkv span{color:var(--muted)}',
      '#tab-shn{max-width:520px}',
      '.shnmk{display:grid;grid-template-columns:1fr 1fr;gap:4px;background:#121820;border:1px solid var(--grid);border-radius:12px;padding:4px;margin:8px 0}',
      '.shnmk button{border:0;background:transparent;color:var(--muted);border-radius:9px;padding:8px 6px;font-weight:750;font-size:13.5px;cursor:pointer}',
      '.shnmk button.on{background:#1f6feb;color:#fff}',
      '.shnchips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}',
      '.shnchip{border:1px solid var(--grid);background:#161b22;color:var(--muted);border-radius:999px;padding:4px 10px;font-size:12px;cursor:pointer}',
      '.shnchip.on{background:#1f6feb;border-color:#1f6feb;color:#fff;font-weight:700}',
      '.shnslbl{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-top:8px}',
      '.shnrange{width:100%;accent-color:#1f6feb;margin:4px 0 2px}',
      '.shnstat{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:8px 0}',
      '.shnstat div{background:#161b22;border:1px solid var(--grid);border-radius:10px;padding:6px 4px;text-align:center}',
      '.shnstat b{display:block;font-size:16px}.shnstat small{color:var(--muted);font-size:10px}',
      '.shntable{width:100%;border-collapse:collapse;font-size:12.5px}',
      '.shntable th{font-size:10.5px;color:var(--muted);font-weight:600;text-align:left;padding:4px}',
      '.shntable td{padding:8px 4px;border-top:1px solid var(--grid);vertical-align:middle}',
      '.shnrow{cursor:pointer}.shnrow:active{background:#1c2333}',
      '.shnsub{display:block;color:var(--muted);font-size:10px;font-weight:500}',
      '.shut{font-size:10px;font-weight:800;border-radius:999px;padding:1px 6px}',
      '.shut.ok{color:#3fb950;background:#12301a}.shut.wk{color:#e3b341;background:#3b2f0b}.shut.na{color:var(--muted)}',
      '.shnpanel{margin-top:8px;background:#121820;border:1px solid #2a3445;border-radius:12px;overflow:hidden}',
      '.shnpanel .hd{background:#0e2a47;color:#e5ecf6;padding:7px 10px;font-size:11px;font-weight:800;letter-spacing:.04em}',
      '.shnpanel .k{padding:6px 10px 0;color:#93c5fd;font-size:10px;font-weight:800;letter-spacing:.06em}',
      '.shnpanel .big{margin:4px 10px;border-radius:8px;text-align:center;font-weight:800;font-size:15px;padding:8px 6px}',
      '.shnpanel .row{display:flex;justify-content:space-between;gap:8px;padding:5px 10px;font-size:12px;border-top:1px solid #1c2636}',
      '.shnpanel .row span{color:#8b96a8}',
      '.shnpanel .act{padding:8px 10px;font-size:12.5px;font-weight:700;line-height:1.35}',
      '.shnpanel .note{padding:0 10px 8px;color:#8b96a8;font-size:11px;line-height:1.35}',
      '.shnwl{width:100%;box-sizing:border-box;min-height:64px;margin-top:6px}',
      '.shnempty{padding:16px 8px;text-align:center;color:var(--muted);line-height:1.45}',
      '@media (max-width:420px){.shnstat{grid-template-columns:repeat(4,minmax(0,1fr))}.shnstat b{font-size:14px}}'
    ].join('');
    document.head.appendChild(s);
  }

  function chipHTML(snap) {
    if (!snap) return '';
    var ut = snap.utText === 'agree' ? '<span class="shnmeta">UT ✓ agree</span>' : snap.utWeak ? '<span class="shnmeta" style="color:#e3b341">UT weak</span>' : '';
    var stop = snap.stop == null ? '' : '<span class="shnmeta">stop ' + num(snap.stop) + '</span>';
    return '<span class="shnbit"><span class="shnst shn-' + snap.code + '">' + esc(shortLab(snap)) + (snap.code === 1 ? ' ▲' : snap.code === 3 ? ' ▼' : '') + '</span>' + stop + ut + '</span>';
  }
  function decorateHub() {
    var tf = HUB_TF;
    document.querySelectorAll('#fxhubflat .fxht').forEach(function (btn) {
      var id = btn.getAttribute('data-id') || '';
      var k = id.indexOf('M:') === 0 ? id.slice(2) : '';
      var fy = fyOfMcx(k);
      var snap = fy ? snapOf(fy, tf) : null;
      var old = btn.querySelector('.shnbit'); if (old) old.remove();
      if (!snap) return;
      var wrap = document.createElement('span');
      wrap.innerHTML = chipHTML(snap);
      var bit = wrap.firstChild;
      if (btn.classList.contains('big') && snap.action) {
        var a = document.createElement('span');
        a.className = 'shnact';
        a.textContent = snap.action;
        bit.appendChild(a);
        if (snap.barsSinceFlip != null) {
          var b = document.createElement('span');
          b.className = 'shnmeta';
          b.textContent = snap.barsSinceFlip + (snap.barsSinceFlip === 1 ? ' bar since flip' : ' bars since flip');
          bit.appendChild(b);
        }
      }
      btn.appendChild(bit);
    });
    document.querySelectorAll('#fxhubglobe .fxgn').forEach(function (btn) {
      var id = btn.getAttribute('data-id') || '';
      var k = id.indexOf('M:') === 0 ? id.slice(2) : '';
      var snap = snapOf(fyOfMcx(k), tf);
      btn.classList.remove('shn-1', 'shn-2', 'shn-3', 'shn-4', 'shn-5', 'shn-6', 'shn-7');
      var dot = btn.querySelector('.shndot'); if (dot) dot.remove();
      if (!snap) return;
      btn.classList.add('shn-' + snap.code);
      if (snap.utWeak) {
        var i = document.createElement('i'); i.className = 'shndot'; i.title = 'UT weak';
        btn.appendChild(i);
      }
    });
    var leg = $('shnleg');
    if (!leg && $('fxhubglobe')) {
      leg = document.createElement('div'); leg.id = 'shnleg'; leg.className = 'shnleg';
      $('fxhubglobe').insertAdjacentElement('afterend', leg);
    }
    if (leg) {
      var any = document.body.classList.contains('fxhub-globe') && mcxList().some(function (x) { return snapOf(x.fy, tf); });
      leg.innerHTML = any ? '<span><i style="background:#3fb950"></i>Strong long</span><span><i style="background:#e3b341"></i>Long weak</span><span><i style="background:#f85149"></i>Strong short</span><span><i style="background:#e3b341"></i>Short weak</span><span><i style="background:#e3b341"></i>amber dot = UT weak</span>' : '';
    }
    var st = $('shnstatus');
    if (st) st.textContent = statusLine();
    var sw = $('shntf');
    if (sw) sw.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.tf === HUB_TF); });
  }
  function statusLine() {
    var n = mcxList().filter(function (x) { return snapOf(x.fy, HUB_TF); }).length;
    var total = mcxList().length;
    if (!total) return '';
    if (!auth() && !n) return 'Log in on Live feed for Fyers candles, or open this tab while the laptop is reachable';
    var src = n ? (MEM[mcxList().filter(function (x) { return snapOf(x.fy, HUB_TF); })[0].fy + '|' + HUB_TF] || {}).src : '';
    var via = src === 'laptop' ? 'laptop scan' : src === 'pack' ? 'saved candles' : src === 'fyers' ? 'Fyers closed bars' : 'closed bars';
    return TFN[HUB_TF] + ' · ' + n + '/' + total + ' · ' + via + (n ? ' · ' + istStamp(Date.now()) : '');
  }
  function ensureTf() {
    var hub = $('fxhub'); if (!hub || $('shntf')) return;
    var bar = document.createElement('div');
    bar.id = 'shntf'; bar.className = 'shntf';
    bar.innerHTML = '<span class="seg" id="shntfseg">' + TFS.map(function (tf) {
      return '<button type="button" data-tf="' + tf + '">' + TFN[tf] + '</button>';
    }).join('') + '</span><span class="sub">SHN v3.4</span><span class="sub" id="shnstatus"></span>';
    var hd = hub.querySelector('.fxhubhd');
    if (hd) hd.insertAdjacentElement('afterend', bar); else hub.insertBefore(bar, hub.firstChild);
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-tf]'); if (!b) return;
      HUB_TF = b.dataset.tf; lj('shn_tf', HUB_TF); decorateHub(); queueMcx(HUB_TF);
    });
  }

  function sheet(sym) {
    var old = $('shn-sheet'); if (old) old.remove();
    var fy = fyOfMcx(sym);
    var snap = fy ? snapOf(fy, HUB_TF) : null;
    var name = typeof fxHubShort === 'function' ? fxHubShort(sym) : sym;
    var el = document.createElement('div');
    el.id = 'shn-sheet'; el.className = 'shnsheet';
    var body = snap ? panelInner(snap, name, TFN[HUB_TF], sym) : '<p class="shnempty">No closed-bar trade state for ' + esc(name) + ' yet. ' + (auth() ? 'Candles are loading.' : 'Log in on the Live feed tab, or reach the laptop Market Radar.') + '</p>';
    el.innerHTML = '<div class="shnshhd"><b>' + esc(name) + '</b><span class="sub">' + esc(TFN[HUB_TF]) + '</span><button type="button" class="btn x" id="shn-sheet-x">Close</button></div>' + body +
      '<div style="display:flex;gap:8px;margin-top:8px"><button type="button" class="btn pri" id="shn-sheet-go">Open chart</button></div>';
    document.body.appendChild(el);
    $('shn-sheet-x').onclick = function () { el.remove(); };
    $('shn-sheet-go').onclick = function () { el.remove(); if (typeof fxOpen === 'function') fxOpen('M:' + sym); };
  }
  function panelInner(snap, name, tfName, sym) {
    var d = distOf(snap, sym);
    var v4 = snap.pos > 0 ? 'LONG ▲' : snap.pos < 0 ? 'SHORT ▼' : (snap.code === 5 || snap.code === 1 ? 'FLAT · HA bull' : snap.code === 6 || snap.code === 3 ? 'FLAT · HA bear' : 'FLAT');
    if (snap.barsSinceEntry != null && snap.pos) v4 += ' · ' + snap.barsSinceEntry + ' bars';
    var ut = snap.utPos > 0 ? 'LONG ▲' : snap.utPos < 0 ? 'SHORT ▼' : '–';
    if (snap.utWeak) ut += ' · UT weak';
    else if (snap.utText === 'agree') ut += ' · agrees';
    var actBg = snap.exitHit ? '#713f12' : snap.code === 1 ? '#14532d' : snap.code === 3 ? '#7f1d1d' : (snap.code === 2 || snap.code === 4) ? '#78350f' : '#263247';
    return '<div class="shnpanel"><div class="hd">SHN MATRIX v3.4 · ' + esc(name) + ' ' + esc(tfName) + '</div>' +
      '<div class="k">TRADE STATE</div><div class="big shn-' + snap.code + '">' + esc(snap.label) + '</div>' +
      '<div class="row"><span>V4a (opens / closes)</span><b>' + esc(v4) + '</b></div>' +
      '<div class="row"><span>UT Bot (early warning)</span><b>' + esc(ut) + '</b></div>' +
      '<div class="act" style="background:' + actBg + ';color:#fff">ACTION: ' + esc(snap.action) + '</div>' +
      '<div class="row"><span>Stop (trail)</span><b>' + (snap.stop == null ? '–' : num(snap.stop)) + '</b></div>' +
      '<div class="row"><span>Distance</span><b>' + (d == null ? (snap.stop == null ? 'flat' : '–') : d.toFixed(2) + '%') + '</b></div>' +
      '<div class="row"><span>Bars since flip</span><b>' + (snap.barsSinceFlip == null ? '–' : snap.barsSinceFlip) + (snap.flipTime ? ' · ' + esc(istBar(snap.flipTime)) : '') + '</b></div>' +
      '<div class="note">UT against an open V4a trade = weakening, not an exit. V4a stop / opposite flip still decide the exit. Closed bars only.</div></div>';
  }

  function decorateDC() {
    adoptPacks();
    document.querySelectorAll('#rt-dc .ck-card').forEach(function (card) {
      var sym = card.getAttribute('data-sym'); var mk = card.getAttribute('data-mk') || 'MCX';
      var line = card.querySelector('.ck-shnline'); if (!line) return;
      var fy = mk === 'GL' ? null : (mk === 'NSE' ? fyOfNse(sym) : (fyOfMcx(sym) || (window.CK && CK.book && (CK.book.filter(function (b) { return b.sym === sym; })[0] || {}).fy)));
      if (!fy) return;
      var bits = TFS.map(function (tf) {
        var s = snapOf(fy, tf);
        if (!s) return '<span class="ck-chip dim">' + TFN[tf] + '</span>';
        return '<span class="ck-chip on ' + (s.code === 3 || s.code === 6 ? 'short' : s.code === 7 ? '' : 'long') + '" title="' + esc(s.label) + '">' + TFN[tf] + ' ' + esc(shortLab(s)) + '</span>';
      }).join('');
      var focus = snapOf(fy, 'D') || snapOf(fy, HUB_TF) || snapOf(fy, '4h') || snapOf(fy, '2h') || snapOf(fy, '15m');
      if (!focus) {
        line.insertAdjacentHTML('beforeend', '<div class="shnmeta">SHN v3.4 · waiting for closed bars</div>');
        return;
      }
      var d = distOf(focus, sym);
      line.innerHTML = '<span class="shnst shn-' + focus.code + '">' + esc(focus.label) + '</span>' +
        '<span class="shnact">' + esc(focus.action) + '</span>' +
        (focus.stop == null ? '' : '<span>Stop <b class="ck-stop">' + num(focus.stop) + '</b></span>') +
        (d == null ? '' : '<span>' + d.toFixed(2) + '% to stop</span>') +
        (focus.utWeak ? '<span style="color:#e3b341">UT weak</span>' : focus.utText === 'agree' ? '<span>UT ✓ agree</span>' : '') +
        '<div class="ck-chips">' + bits + '</div>';
    });
  }
  function dccPanel() {
    var st = window.DC20Chart && DC20Chart._st;
    if (!st || !st.f) return '';
    var f = st.f, tf = normTf(st.tf || 'D');
    var fy = f.market === 'NSE' ? fyOfNse(f.sym) : (f.market === 'GL' ? null : (fyOfMcx(f.sym) || (window.CK && CK.book && (CK.book.filter(function (b) { return b.sym === f.sym; })[0] || {}).fy)));
    var rows = null;
    try {
      var pack = st.data && st.data.tfs && st.data.tfs[st.tf];
      if (pack && pack.bars) rows = dropForming(pack.bars, tf, f.market === 'NSE' ? 'NSE' : 'MCX');
    } catch (e) {}
    var snap = null;
    if (rows && rows.length >= 40) snap = SHNv34.snapshot(rows, settingsFor(f.market === 'NSE' ? 'NSE' : 'MCX'));
    else if (fy) snap = snapOf(fy, tf);
    if (!snap) return '<div class="shnpanel"><div class="hd">SHN MATRIX v3.4</div><div class="note">Trade state uses closed bars only. Nothing is filled in until those bars are here.</div></div>';
    return panelInner(snap, f.sym, TFN[tf] || tf, f.sym);
  }
  function paintFx() {
    var slot = $('fxshn'); if (!slot) return;
    var r = window.FXV && FXV.open;
    if (!r) { slot.innerHTML = ''; return; }
    var tf = RES2TF[FXV.tf] || 'D';
    var rows = null;
    if (FXV.bars && FXV.bars.c && FXV.bars.c.length) {
      rows = [];
      for (var i = 0; i < FXV.bars.c.length; i++) rows.push([FXV.bars.t[i], FXV.bars.o[i], FXV.bars.h[i], FXV.bars.l[i], FXV.bars.c[i], FXV.bars.v[i] || 0]);
      var span = { '15': 900, '60': 3600, '120': 7200, '240': 14400, D: 86400 }[FXV.tf] || 86400;
      if (rows.length && Date.now() / 1000 < rows[rows.length - 1][0] + span) rows.pop();
    }
    var market = r.kind === 'mcx' ? 'MCX' : 'NSE';
    var snap = rows && rows.length >= 40 ? SHNv34.snapshot(rows, settingsFor(market)) : (r.fy ? snapOf(r.fy, tf === '60' ? '2h' : tf) : null);
    slot.innerHTML = snap ? panelInner(snap, r.kind === 'mcx' && typeof fxHubShort === 'function' ? fxHubShort(r.key) : (r.label || r.name), (TFN[tf] || FXV.tf), r.key) : '<div class="shnpanel"><div class="hd">SHN MATRIX v3.4</div><div class="note">Closed bars for this chart are not on the phone yet.</div></div>';
  }
  function ensureFxSlot() {
    if ($('fxshn') || !$('fxc')) return;
    var foot = document.querySelector('#fxc .fxfoot');
    var d = document.createElement('div'); d.id = 'fxshn';
    if (foot) foot.parentNode.insertBefore(d, foot);
  }

  function rowsFor(univ) {
    var f = filt();
    var tf = univ === 'nse' ? normTf(f.tfNse || 'D') : normTf(f.tfMcx || HUB_TF);
    var list = univ === 'nse' ? wl().map(function (sym) { return { market: 'NSE', sym: sym, fy: fyOfNse(sym), name: sym, sub: 'NSE · ' + TFN[tf] }; }) : mcxList().map(function (x) { return { market: 'MCX', sym: x.sym, fy: x.fy, name: x.name, sub: 'MCX · ' + TFN[tf] }; });
    if (univ === 'nse' && lap.json) {
      var extra = (lap.json.symbols || lap.json.rows || []).filter(function (r) { return r && String(r.market || 'NSE').toUpperCase() === 'NSE' && r.state >= 1; });
      if (extra.length) {
        list = extra.map(function (r) {
          var fy = r.fyers || fyOfNse(r.symbol);
          var rtf = normTf(r.tf || r.timeframe || tf);
          return { market: 'NSE', sym: r.symbol, fy: fy, name: r.name || r.symbol, sub: 'NSE · ' + (TFN[rtf] || rtf), tf: rtf };
        });
      }
    }
    list = list.filter(function (x) { return !x.tf || normTf(x.tf) === tf; });
    var out = [], have = 0;
    list.forEach(function (x) {
      var rowTf = x.tf || tf;
      var snap = snapOf(x.fy, rowTf);
      if (!snap) return;
      have++;
      if (f.states && f.states[snap.code] === 0) return;
      if (snap.barsSinceFlip != null && snap.barsSinceFlip > f.barsMax) return;
      var d = snap.stopDistPct != null && livePx(x.sym) == null ? snap.stopDistPct : distOf(snap, x.sym);
      if (d != null && d > f.stopMax + 1e-6) return;
      if (f.ut === 'agree' && snap.utText !== 'agree') return;
      if (f.ut === 'weak' && !snap.utWeak) return;
      out.push({ id: x.market + '|' + x.sym, sym: x.sym, fy: x.fy, name: x.name, sub: x.sub, market: x.market, tf: rowTf, snap: snap, dist: d });
    });
    out.sort(function (a, b) {
      var d = a.snap.code - b.snap.code;
      if (d) return d;
      return (a.snap.barsSinceFlip == null ? 99 : a.snap.barsSinceFlip) - (b.snap.barsSinceFlip == null ? 99 : b.snap.barsSinceFlip);
    });
    return { rows: out, scanned: have, universe: list.length, tf: tf };
  }
  function paintBadge(n) {
    var b = $('shn-badge'); if (!b) return;
    if (!n) { b.hidden = true; b.textContent = ''; return; }
    b.hidden = false; b.textContent = String(n);
  }
  function paintScreener() {
    var host = $('tab-shn'); if (!host) return;
    var f = filt();
    var u = UNIV === 'mcx' ? 'mcx' : 'nse';
    var pack = rowsFor(u);
    paintBadge(pack.rows.length);
    var states = u === 'mcx'
      ? [[1, 'Strong long'], [2, 'Long weakening'], [3, 'Strong short'], [4, 'Short weakening'], [5, 'Wait for buy'], [6, 'Wait for sell'], [7, 'Mixed']]
      : [[1, 'Strong long'], [2, 'Long weakening'], [3, 'Strong short'], [4, 'Short weakening'], [5, 'Wait for buy'], [6, 'No long'], [7, 'Mixed']];
    var tf = pack.tf;
    var chips = states.map(function (s) {
      return '<button type="button" class="shnchip' + (f.states[s[0]] ? ' on' : '') + '" data-st="' + s[0] + '">' + s[1] + '</button>';
    }).join('');
    var srcMap = {};
    pack.rows.forEach(function (r) { var h = MEM[r.fy + '|' + r.tf]; if (h && h.src) srcMap[h.src] = 1; });
    var src = srcMap.fyers ? 'Fyers closed bars' : srcMap.laptop ? 'Laptop scan' : (srcMap.saved || srcMap.pack) ? 'Saved candles' : (lap.ok === false ? 'Laptop offline' : 'Waiting for bars');
    var when = lap.scan || (pack.rows.length ? istStamp(Date.now()) : '–');
    var table = pack.rows.length ? '<table class="shntable"><thead><tr><th>Symbol</th><th>Trade state</th><th>Bars</th><th>Stop dist</th><th>UT</th><th></th></tr></thead><tbody>' +
      pack.rows.map(function (r) {
        var ut = r.snap.utWeak ? '<span class="shut wk">weak</span>' : r.snap.utText === 'agree' ? '<span class="shut ok">✓</span>' : '<span class="shut na">–</span>';
        var on = bellOn(r.id, r.tf);
        return '<tr class="shnrow" data-sym="' + esc(r.sym) + '" data-mkt="' + r.market + '"><td><b>' + esc(r.name) + '</b><span class="shnsub">' + esc(r.sub) + '</span></td>' +
          '<td><span class="shnst shn-' + r.snap.code + '">' + esc(shortLab(r.snap)) + '</span></td><td>' + (r.snap.barsSinceFlip == null ? '–' : r.snap.barsSinceFlip) + '</td>' +
          '<td>' + (r.dist == null ? (r.snap.stop == null ? 'flat' : '–') : (r.snap.stop == null ? 'flat' : r.dist.toFixed(1) + '%')) + '</td><td>' + ut + '</td>' +
          '<td><button type="button" class="ck-bell shnbell' + (on ? ' on' : '') + '" data-id="' + esc(r.id) + '" data-tf="' + r.tf + '" aria-label="Alert on state change"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 3a5 5 0 0 0-5 5v2.6c0 .8-.3 1.6-.8 2.2L5 15.2h14l-1.2-2.4c-.5-.6-.8-1.4-.8-2.2V8a5 5 0 0 0-5-5z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M10 17.2a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.7"/></svg></button></td></tr>';
      }).join('') + '</tbody></table>' : '<div class="shnempty">' + (auth() || lap.ok ? 'No symbols match these filters yet. Closed bars only — nothing here is an example.' : 'Log in on Live feed to scan the watchlist from Fyers, or open this tab while the laptop Market Radar is reachable.') + '</div>';
    var wlBox = u === 'nse' ? '<details class="rt-cfg"><summary>NSE watchlist · up to 30 · Daily from Fyers when the laptop is offline</summary><textarea class="shnwl" id="shn-wl" spellcheck="false">' + esc(wl().join(' ')) + '</textarea><div class="shnmeta">One symbol per space. Saved on this phone. The scan uses your Fyers login and does not place orders.</div><button type="button" class="btn" id="shn-wl-save">Save &amp; scan</button></details>' : '';
    host.innerHTML = '<div class="panel" style="margin-top:0"><div class="shnmk"><button type="button" data-u="nse"' + (u === 'nse' ? ' class="on"' : '') + '>NSE stocks</button><button type="button" data-u="mcx"' + (u === 'mcx' ? ' class="on"' : '') + '>MCX instruments</button></div>' +
      '<div class="shnchips" id="shn-states">' + chips + '</div>' +
      '<div class="shnslbl"><span>Bars since V4a flip</span><b>0 – ' + (f.barsMax >= 20 ? '20+' : f.barsMax) + '</b></div><input class="shnrange" id="shn-bars" type="range" min="0" max="20" value="' + f.barsMax + '">' +
      '<div class="shnslbl"><span>Stop distance · ≤ % of price</span><b>' + (f.stopMax >= 10 ? '10%+' : f.stopMax + '%') + '</b></div><input class="shnrange" id="shn-stop" type="range" min="0" max="10" step="0.5" value="' + f.stopMax + '">' +
      '<div class="shnchips" id="shn-ut"><button type="button" class="shnchip' + (f.ut === 'any' ? ' on' : '') + '" data-ut="any">UT any</button><button type="button" class="shnchip' + (f.ut === 'agree' ? ' on' : '') + '" data-ut="agree">Agrees</button><button type="button" class="shnchip' + (f.ut === 'weak' ? ' on' : '') + '" data-ut="weak">UT weak only</button><button type="button" class="btn" id="shn-filter">Filter</button></div>' +
      '<div class="shnstat"><div><b>' + pack.rows.length + '</b><small>match</small></div><div><b>' + pack.scanned + '</b><small>' + (pack.universe > pack.scanned ? 'of ' + pack.universe : 'scanned') + '</small></div><div><b>' + esc(TFN[tf] || tf) + '</b><small>timeframe</small></div><div><b style="font-size:12px">' + esc(when) + '</b><small>' + esc(src) + '</small></div></div>' +
      table + wlBox +
      '<p class="shnmeta">Sorted strong long first, then fewest bars since the V4a flip. Tap a row for the chart and the trade-state panel. Read-only.</p></div>';
    bindScreener(host, pack);
  }
  function bindScreener(host, pack) {
    host.querySelectorAll('.shnmk button').forEach(function (b) {
      b.onclick = function () { UNIV = b.dataset.u; lj('shn_univ', UNIV); paintScreener(); if (UNIV === 'nse') ensureNse(); else queueMcx(filt().tfMcx); };
    });
    host.querySelectorAll('#shn-states .shnchip').forEach(function (b) {
      b.onclick = function () { var k = +b.dataset.st; filt().states[k] = filt().states[k] ? 0 : 1; saveFilt(); paintScreener(); };
    });
    var bars = $('shn-bars'), stop = $('shn-stop');
    if (bars) { bars.oninput = function () { filt().barsMax = +bars.value; var b = bars.previousElementSibling && bars.previousElementSibling.querySelector('b'); if (b) b.textContent = '0 – ' + (bars.value >= 20 ? '20+' : bars.value); }; bars.onchange = function () { saveFilt(); paintScreener(); }; }
    if (stop) { stop.oninput = function () { filt().stopMax = +stop.value; var b = stop.previousElementSibling && stop.previousElementSibling.querySelector('b'); if (b) b.textContent = stop.value >= 10 ? '10%+' : stop.value + '%'; }; stop.onchange = function () { saveFilt(); paintScreener(); }; }
    host.querySelectorAll('#shn-ut .shnchip').forEach(function (b) {
      b.onclick = function () { filt().ut = b.dataset.ut; saveFilt(); paintScreener(); };
    });
    var fb = $('shn-filter'); if (fb) fb.onclick = function () { openFilter(pack); };
    host.querySelectorAll('.shnrow').forEach(function (tr) {
      tr.onclick = function (e) {
        if (e.target.closest('.shnbell')) return;
        openRow(tr.dataset.mkt, tr.dataset.sym);
      };
    });
    host.querySelectorAll('.shnbell').forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); toggleBell(b.dataset.id, b.dataset.tf); paintScreener(); };
    });
    var save = $('shn-wl-save');
    if (save) save.onclick = function () { saveWl($('shn-wl').value); scanNse(); };
  }
  function openRow(market, sym) {
    if (market === 'MCX' && typeof fxOpen === 'function' && typeof fxRow === 'function' && fxRow('M:' + sym)) { fxOpen('M:' + sym); return; }
    if (window.DC20Chart) {
      var tf = market === 'NSE' ? (filt().tfNse || 'D') : (filt().tfMcx || '2h');
      DC20Chart.open({ market: market, sym: sym, tf: normTf(tf) === '4h' ? '4h' : normTf(tf) === '2h' ? '2h' : normTf(tf) === '15m' ? '15m' : 'D', rule: 'CHART', rule_text: 'SHN v3.4 screener', dir: 'none', bar_time: '', entry: null, invalidation: null, upper: null, mid: null, lower: null, atr: null, price: null, dist_atr: null, inv_rule: '-', key: market + '|' + sym + '|shn' });
    }
  }
  function openFilter(pack) {
    var old = $('shn-fsheet'); if (old) old.remove();
    var f = filt();
    var el = document.createElement('div');
    el.id = 'shn-fsheet'; el.className = 'shnsheet';
    var u = UNIV === 'mcx' ? 'mcx' : 'nse';
    var tf = u === 'nse' ? (f.tfNse || 'D') : (f.tfMcx || '2h');
    el.innerHTML = '<div class="shnshhd"><b>Filter · SHN v3.4</b><button type="button" class="btn x" id="shn-fx">Close</button></div>' +
      '<div class="k" style="color:#8b949e;font-size:11px;margin:6px 0">TRADE STATE</div>' +
      '<div class="shnchips">' + [1, 2, 3, 4, 5, 6, 7].map(function (c) {
        var name = c === 6 ? (u === 'mcx' ? 'Wait for sell' : 'No long') : STATE_NAME[c];
        return '<button type="button" class="shnchip' + (f.states[c] ? ' on' : '') + '" data-st="' + c + '">' + name + '</button>';
      }).join('') + '</div>' +
      '<div class="k" style="color:#8b949e;font-size:11px;margin:8px 0 4px">TIMEFRAME</div><span class="seg" id="shn-ftf">' + TFS.map(function (t) { return '<button type="button" data-tf="' + t + '"' + (normTf(tf) === t ? ' class="on"' : '') + '>' + TFN[t] + '</button>'; }).join('') + '</span>' +
      '<div class="shnslbl"><span>Bars since flip</span><b id="shn-fb">' + f.barsMax + '</b></div><input class="shnrange" id="shn-fbars" type="range" min="0" max="20" value="' + f.barsMax + '">' +
      '<div class="shnslbl"><span>Stop distance · ≤ %</span><b id="shn-fs">' + f.stopMax + '%</b></div><input class="shnrange" id="shn-fstop" type="range" min="0" max="10" step="0.5" value="' + f.stopMax + '">' +
      '<div class="k" style="color:#8b949e;font-size:11px;margin:8px 0 4px">UT BOT</div><div class="shnchips" id="shn-fut"><button type="button" class="shnchip' + (f.ut === 'agree' ? ' on' : '') + '" data-ut="agree">Agrees</button><button type="button" class="shnchip' + (f.ut === 'weak' ? ' on' : '') + '" data-ut="weak">UT weak only</button><button type="button" class="shnchip' + (f.ut === 'any' ? ' on' : '') + '" data-ut="any">Any</button></div>' +
      '<div style="display:flex;gap:8px;margin-top:10px"><button type="button" class="btn" id="shn-freset">Reset</button><button type="button" class="btn pri" id="shn-fshow">Show results</button><button type="button" class="btn" id="shn-falert">Alert on change</button></div>';
    document.body.appendChild(el);
    $('shn-fx').onclick = function () { el.remove(); };
    el.querySelectorAll('[data-st]').forEach(function (b) { b.onclick = function () { var k = +b.dataset.st; filt().states[k] = filt().states[k] ? 0 : 1; saveFilt(); openFilter(rowsFor(u)); }; });
    el.querySelectorAll('#shn-ftf button').forEach(function (b) {
      b.onclick = function () {
        if (u === 'nse') filt().tfNse = b.dataset.tf; else { filt().tfMcx = b.dataset.tf; HUB_TF = b.dataset.tf; }
        saveFilt(); openFilter(rowsFor(u)); queueMcx(b.dataset.tf);
      };
    });
    $('shn-fbars').oninput = function () { filt().barsMax = +this.value; $('shn-fb').textContent = this.value; saveFilt(); };
    $('shn-fstop').oninput = function () { filt().stopMax = +this.value; $('shn-fs').textContent = this.value + '%'; saveFilt(); };
    el.querySelectorAll('#shn-fut .shnchip').forEach(function (b) { b.onclick = function () { filt().ut = b.dataset.ut; saveFilt(); openFilter(rowsFor(u)); }; });
    $('shn-freset').onclick = function () { FILT = { states: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 }, barsMax: 20, stopMax: 10, ut: 'any', tfNse: 'D', tfMcx: '2h' }; saveFilt(); openFilter(rowsFor(u)); paintScreener(); };
    $('shn-fshow').onclick = function () { el.remove(); paintScreener(); };
    $('shn-falert').onclick = function () {
      var now = rowsFor(u);
      now.rows.forEach(function (r) { var b = bells(); b[r.id + '|' + r.tf] = 1; lj('shn_bells', b); });
      el.remove(); paintScreener();
    };
  }

  function paintAll() {
    try { decorateHub(); } catch (e) { console.warn('shn hub', e); }
    try { if ($('tab-dc20') && $('tab-dc20').classList.contains('active')) decorateDC(); } catch (e) { console.warn('shn dc', e); }
    try { paintFx(); } catch (e) {}
    try { if ($('tab-shn') && $('tab-shn').classList.contains('active')) paintScreener(); else paintBadge(rowsFor(UNIV === 'mcx' ? 'mcx' : 'nse').rows.length); } catch (e) {}
  }
  function ensureNse() {
    pullLaptop().then(function (ok) {
      if (!ok) scanNse();
      else paintScreener();
    });
  }
  function tick() {
    adoptPacks();
    if (auth()) queueMcx(HUB_TF);
    if ($('tab-shn') && $('tab-shn').classList.contains('active') && UNIV !== 'mcx' && lap.ok === false) {
      /* watchlist scan is paced by due() */
    }
    paintAll();
  }

  css();
  var savedTf = lj('shn_tf'); if (savedTf && TF[savedTf]) HUB_TF = savedTf;
  var savedU = lj('shn_univ'); if (savedU === 'mcx' || savedU === 'nse') UNIV = savedU;
  try { loadStore(); } catch (e) { console.warn('shn cache', e); }

  if (typeof fxHubPaint === 'function') {
    var _hub = fxHubPaint;
    fxHubPaint = function () { _hub(); ensureTf(); try { decorateHub(); } catch (e) { console.warn('shn hub', e); } };
  }
  ensureTf();
  document.addEventListener('click', function (e) {
    var n = e.target.closest && e.target.closest('#fxhubglobe .fxgn');
    if (!n) return;
    e.preventDefault(); e.stopPropagation();
    var id = n.getAttribute('data-id') || '';
    if (id.indexOf('M:') === 0) sheet(id.slice(2));
  }, true);

  if (typeof fxBuildPanel === 'function') {
    var _b = fxBuildPanel;
    fxBuildPanel = function () { _b(); ensureFxSlot(); };
  }
  ensureFxSlot();
  if (typeof fxLoad === 'function') {
    var _load = fxLoad;
    fxLoad = async function (force) { var p = _load(force); try { await p; } catch (e) {} paintFx(); return p; };
  }
  if (typeof fxGetBars === 'function') {
    var _bars = fxGetBars;
    fxGetBars = async function (r, res, force) {
      try { return await _bars(r, res, force); }
      catch (err) {
        var tf = RES2TF[res];
        var hit = r && r.fy && tf && MEM[r.fy + '|' + tf];
        if (hit && hit.bars && hit.bars.length && typeof fxCandles === 'function') return fxCandles(hit.bars, res);
        throw err;
      }
    };
  }
  if (window.CK && CK.paintDC) {
    var _dc = CK.paintDC;
    CK.paintDC = function () { _dc(); try { decorateDC(); } catch (e) { console.warn('shn dc', e); } };
  }
  if (window.CK && CK.detailExtra) {
    var _ex = CK.detailExtra;
    CK.detailExtra = function () { var extra = ''; try { extra = _ex() || ''; } catch (e) {} var p = ''; try { p = dccPanel(); } catch (e) {} return p + extra; };
  }
  window.RENDER = window.RENDER || {};
  RENDER.shn = function () { paintScreener(); ensureNse(); queueMcx(filt().tfMcx || HUB_TF); };
  if ((location.hash || '') === '#shn' && typeof showTab === 'function') showTab('shn');

  function boot() {
    if (started) return; started = true;
    queueMcx(HUB_TF);
    setInterval(tick, 30000);
    paintAll();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.SHN = {
    ingest: function (fy, tf, rows, market) { return put(fy, tf, rows, 'fyers', false); },
    stateFor: stateFor,
    snapOf: snapOf,
    setFilt: function (p) { FILT = Object.assign(filt(), p || {}); saveFilt(); paintScreener(); },
    setUniv: function (u) { UNIV = u === 'mcx' ? 'mcx' : 'nse'; paintScreener(); },
    setHubTf: function (tf) { if (TF[tf]) { HUB_TF = tf; decorateHub(); } },
    paint: paintAll,
    mem: MEM
  };
})();
