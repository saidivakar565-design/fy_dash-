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
      '.sg{display:inline-flex;align-items:center;gap:3px;border-radius:999px;padding:1px 6px;font-size:10.5px;font-weight:700;border:1px solid var(--grid);color:var(--muted)}',
      '.sg.b{color:#3fb950;border-color:#1f6f3a;background:#0d1f14}.sg.s{color:#f85149;border-color:#7f1d1d;background:#2a1214}.sg.empty{opacity:.7}',
      '.srow{background:#121820;border:1px solid var(--grid);border-radius:12px;padding:8px 10px;margin:0 0 8px;cursor:pointer}',
      '.srow .top{display:flex;justify-content:space-between;gap:8px;align-items:baseline}',
      '.srow .chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}',
      '.srow .meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;font-size:11px;color:var(--muted)}',
      '.srow .mom{font-weight:800;font-size:12px}.srow .mom.hi{color:#3fb950}.srow .mom.mid{color:#e3b341}',
      '.sscan{background:#0e1c33;border:1px solid #1f3b66;border-radius:12px;padding:8px 10px;margin:8px 0}',
      '.sscan .hd{display:flex;justify-content:space-between;align-items:center;gap:8px}',
      '.spills{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}',
      '.spill{border-radius:999px;padding:2px 8px;font-size:11px;border:1px solid #1f6feb;color:#9ecbff}',
      '.spill.opt{border-color:#9a6b12;color:#e3b341}',
      '.snew{background:#3b2f0b;border:1px solid #6b4f12;border-radius:10px;padding:8px 10px;margin:8px 0;font-size:12.5px;line-height:1.4}',
      '.spreset{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:8px 0;border-top:1px solid var(--grid)}',
      '.sdet{position:fixed;left:0;right:0;top:0;bottom:0;z-index:90;background:#0d1117;overflow:auto;padding:8px 10px calc(16px + env(safe-area-inset-bottom))}',
      '.sgrid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin:8px 0}',
      '.sgrid div{background:#161b22;border:1px solid var(--grid);border-radius:10px;padding:6px}',
      '.sgrid small{display:block;color:var(--muted);font-size:10px}.sgrid b{font-size:16px}',
      '.ssig td{font-size:12px;padding:6px 4px}',
      '.step{display:inline-flex;align-items:center;gap:6px}',
      '.step button{min-width:32px}',
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

  var SIGC = Object.create(null);
  var MCX_GROUP = { GOLD:'bullion', GOLDM:'bullion', GOLDTEN:'bullion', SILVER:'bullion', SILVERM:'bullion', SILVERMIC:'bullion', COPPER:'metal', ZINC:'metal', ZINCMINI:'metal', ALUMINI:'metal', ALUMINIUM:'metal', LEAD:'metal', NICKEL:'metal', WTI:'energy', CRUDEOIL:'energy', CRUDEOILM:'energy', NATGAS:'energy', NATURALGAS:'energy', NATGASMINI:'energy' };
  function coreScan() {
    return { id:'core', name:'SHN Core Buy', alert:true, tf:'D', mode:'signal', utWeakOnly:false,
      signals:{ ut:'must', shn:'must', ith:'must', dc20:'opt', dc40:'opt' },
      dir:'buy', within:5, ithWithin:25, optNeed:0, volOn:false, volMult:1.5, stopMax:null, momMin:null, hideUtWeak:false };
  }
  function defaultPresets() {
    return [
      coreScan(),
      { id:'brk', name:'Breakout + volume', alert:true, tf:'2h', mode:'signal', utWeakOnly:false,
        signals:{ ut:'off', shn:'must', ith:'off', dc20:'must', dc40:'opt' },
        dir:'buy', within:3, ithWithin:25, optNeed:0, volOn:true, volMult:1.5, stopMax:null, momMin:null, hideUtWeak:false },
      { id:'short', name:'Short side core', alert:false, tf:'2h', mode:'signal', utWeakOnly:false,
        signals:{ ut:'must', shn:'must', ith:'must', dc20:'opt', dc40:'off' },
        dir:'sell', within:5, ithWithin:25, optNeed:0, volOn:false, volMult:1.5, stopMax:null, momMin:null, hideUtWeak:false },
      { id:'weak', name:'Weakening watch', alert:false, tf:'2h', mode:'state', states:[2,4], utWeakOnly:true,
        signals:{ ut:'off', shn:'off', ith:'off', dc20:'off', dc40:'off' },
        dir:'both', within:5, ithWithin:25, optNeed:0, volOn:false, volMult:1.5, stopMax:null, momMin:null, hideUtWeak:false }
    ];
  }
  function presets() { var s = lj('shn_presets'); return (s && s.length) ? s : defaultPresets(); }
  function savePresets(list) { lj('shn_presets', list); }
  function scan() {
    if (!scan._c) { var s = lj('shn_scan'); scan._c = s && s.signals ? s : coreScan(); }
    return scan._c;
  }
  function saveScan() { lj('shn_scan', scan()); }
  function sectorOf(sym) {
    try { var s = (typeof DATA !== 'undefined' && DATA.series && DATA.series[sym]) || null; return (s && s.sector) || ''; } catch (e) { return ''; }
  }
  function groupOf(sym) { return MCX_GROUP[sym] || ''; }
  function infoOf(fy, tf, market) {
    if (!window.SHNSignals) return null;
    var hit = MEM[fy + '|' + tf];
    if (!hit || !hit.bars || hit.bars.length < 40) return null;
    var last = hit.bars[hit.bars.length - 1];
    var key = fy + '|' + tf + '|' + hit.bars.length + '|' + last[0] + '|' + last[4];
    if (SIGC[key]) return SIGC[key];
    try { SIGC[key] = SHNSignals.analyse(hit.bars, market); } catch (e) { SIGC[key] = null; }
    return SIGC[key];
  }
  function universe(u) {
    var cfg = scan();
    var tf = normTf(cfg.tf || (u === 'nse' ? 'D' : HUB_TF));
    var list = u === 'nse'
      ? wl().map(function (sym) { return { market:'NSE', sym:sym, fy:fyOfNse(sym), name:sym, sub:'NSE · ' + TFN[tf] }; })
      : mcxList().map(function (x) { return { market:'MCX', sym:x.sym, fy:x.fy, name:x.name, sub:'MCX · ' + TFN[tf] }; });
    if (u === 'nse' && lap.json) {
      var extra = (lap.json.symbols || lap.json.rows || []).filter(function (r) { return r && String(r.market || 'NSE').toUpperCase() === 'NSE'; });
      if (extra.length && !list.some(function (x) { return snapOf(x.fy, tf) || infoOf(x.fy, tf, 'NSE'); })) {
        list = extra.map(function (r) { var fy = r.fyers || fyOfNse(r.symbol); return { market:'NSE', sym:r.symbol, fy:fy, name:r.name || r.symbol, sub:'NSE · ' + TFN[tf] }; });
      }
    }
    var g = lj('shn_group') || 'all';
    var sec = lj('shn_sector') || 'all';
    if (u === 'mcx' && g !== 'all') {
      list = list.filter(function (x) {
        if (g === 'fav') return typeof fxIsFav === 'function' && fxIsFav('M:' + x.sym);
        return groupOf(x.sym) === g;
      });
    }
    if (u === 'nse' && sec !== 'all') list = list.filter(function (x) { return sectorOf(x.sym) === sec; });
    return { list:list, tf:tf };
  }
  function rowFit(x, tf, cfg) {
    var snap = snapOf(x.fy, tf);
    var info = infoOf(x.fy, tf, x.market);
    if (!snap && !info) return null;
    var fit = info && window.SHNSignals ? SHNSignals.fit(info, cfg) : null;
    if (cfg.mode === 'state') {
      var ok = snap && (cfg.states || []).indexOf(snap.code) >= 0 && (!cfg.utWeakOnly || snap.utWeak);
      fit = fit || { pass:false, chips:{}, optMet:0, optN:0, fresh:snap && snap.barsSinceFlip, mom:0, volX:null };
      fit.pass = !!ok;
      if (snap) fit.fresh = snap.barsSinceFlip;
    }
    if (!fit) return null;
    if (cfg.hideUtWeak && snap && snap.utWeak) fit.pass = false;
    var dist = snap ? distOf(snap, x.sym) : null;
    if (cfg.stopMax != null && dist != null && dist > cfg.stopMax + 1e-9) fit.pass = false;
    if (cfg.momMin != null && fit.mom != null && fit.mom < cfg.momMin) fit.pass = false;
    if (cfg.volOn && !(fit.volX != null && fit.volX >= (cfg.volMult || 1.5))) fit.pass = false;
    return { id:x.market + '|' + x.sym, sym:x.sym, fy:x.fy, name:x.name, sub:x.sub, market:x.market, tf:tf, snap:snap, fit:fit, dist:dist };
  }
  function scanRows(u) {
    var cfg = scan();
    var uni = universe(u || (UNIV === 'mcx' ? 'mcx' : 'nse'));
    var rows = [], have = 0;
    uni.list.forEach(function (x) {
      var row = rowFit(x, uni.tf, cfg);
      if (!row) return;
      have++;
      if (row.fit.pass) rows.push(row);
    });
    var sort = lj('shn_sort') || 'fresh';
    rows.sort(function (a, b) {
      if (sort === 'mom') return (b.fit.mom || 0) - (a.fit.mom || 0);
      if (sort === 'opt') return b.fit.optMet - a.fit.optMet || (a.fit.fresh == null ? 99 : a.fit.fresh) - (b.fit.fresh == null ? 99 : b.fit.fresh);
      if (sort === 'stop') return (a.dist == null ? 99 : a.dist) - (b.dist == null ? 99 : b.dist);
      return (a.fit.fresh == null ? 99 : a.fit.fresh) - (b.fit.fresh == null ? 99 : b.fit.fresh);
    });
    var seen = lj('shn_seen') || {};
    var seenKey = (cfg.id || 'core') + '|' + (u || 'nse') + '|' + uni.tf;
    var prev = seen[seenKey];
    var syms = rows.map(function (r) { return r.sym; });
    var freshIn = prev ? syms.filter(function (s) { return prev.indexOf(s) < 0; }) : [];
    if (prev && cfg.alert) {
      freshIn.forEach(function (sym) {
        var key = 'scan|' + seenKey + '|' + sym + '|' + (rows.filter(function (r) { return r.sym === sym; })[0].fit.time || '');
        var title = sym + ' entered ' + cfg.name;
        var body = TFN[uni.tf] + ' · ' + cfg.name + ' · notification only';
        if (typeof window.SHNAlert === 'function') { try { window.SHNAlert({ key:key, sym:sym, rule:'scan-enter', title:title, body:body }); } catch (e) {} }
      });
    }
    if (rows.length) { seen[seenKey] = syms; lj('shn_seen', seen); }
    return { rows:rows, scanned:have, universe:uni.list.length, tf:uni.tf, freshIn:freshIn };
  }
  function sigChip(label, hit) {
    if (!hit) return '<span class="sg empty">' + esc(label) + ' –</span>';
    return '<span class="sg ' + (hit.dir === 'S' ? 's' : 'b') + '">' + esc(label) + ' ' + hit.dir + ' ' + hit.ago + '</span>';
  }
  function momHTML(v) {
    if (v == null || !isFinite(v)) return '';
    var cls = v >= 75 ? 'hi' : v >= 50 ? 'mid' : '';
    return '<span class="mom ' + cls + '">MOM ' + Math.round(v) + '</span>';
  }
  function scanBlurb(cfg) {
    if (cfg.mode === 'state') return 'state = LONG WEAK / SHORT WEAK · UT weak · ' + (TFN[cfg.tf] || cfg.tf);
    var bits = [];
    [['ut','UT'],['shn','SHN'],['ith','ITH/ITL'],['dc20','DC20'],['dc40','DC40']].forEach(function (p) {
      var m = cfg.signals[p[0]]; if (!m || m === 'off') return;
      bits.push(p[1] + (m === 'must' ? ' must' : ' optional'));
    });
    var dir = cfg.dir === 'sell' ? 'Sell' : cfg.dir === 'both' ? 'Buy and sell' : 'Buy';
    var ith = cfg.signals && cfg.signals.ith && cfg.signals.ith !== 'off' ? ' (ITH/ITL: ' + cfg.ithWithin + ' bars after the pivot is confirmed)' : '';
    return dir + ' · every mandatory signal within the last ' + cfg.within + ' bars' + ith + ' · ' + (TFN[cfg.tf] || cfg.tf);
  }
  function paintBadge(n) {
    var b = $('shn-badge'); if (!b) return;
    if (!n) { b.hidden = true; b.textContent = ''; return; }
    b.hidden = false; b.textContent = String(n);
  }
  function paintScreener() {
    var host = $('tab-shn'); if (!host) return;
    var u = UNIV === 'mcx' ? 'mcx' : 'nse';
    var cfg = scan();
    var pack = scanRows(u);
    paintBadge(pack.rows.length);
    var sorts = [['fresh','Freshness'],['mom','Momentum'],['opt','Optional met'],['stop','Stop dist']];
    var curSort = lj('shn_sort') || 'fresh';
    var groups = u === 'mcx'
      ? [['all','All'],['bullion','Bullion'],['metal','Base metals'],['energy','Energy'],['fav','Favourites']]
      : [['all','All']].concat((function () {
          var set = {};
          wl().forEach(function (sym) { var s = sectorOf(sym); if (s) set[s] = 1; });
          return Object.keys(set).sort().map(function (s) { return [s, s]; });
        })());
    var gNow = u === 'mcx' ? (lj('shn_group') || 'all') : (lj('shn_sector') || 'all');
    var pills = [['ut','UT'],['shn','SHN'],['ith','ITH/ITL'],['dc20','DC20'],['dc40','DC40']].map(function (p) {
      var m = cfg.signals[p[0]]; if (!m || m === 'off') return '';
      return '<span class="spill' + (m === 'opt' ? ' opt' : '') + '">' + (m === 'must' ? '● ' : '○ ') + p[1] + (m === 'must' ? ' must' : ' optional') + '</span>';
    }).join('');
    var rows = pack.rows.length ? pack.rows.map(function (r) {
      var f = r.fit;
      var chips = sigChip('UT', f.chips.ut) + sigChip('SHN', f.chips.shn) + sigChip('ITL', f.chips.ith) + sigChip('DC20', f.chips.dc20) + sigChip('DC40', f.chips.dc40);
      var vol = f.volX == null ? '' : '<span>vol ' + f.volX.toFixed(1) + '×</span>';
      var stop = r.dist == null ? (r.snap && r.snap.stop == null ? '<span>flat</span>' : '') : '<span>stop ' + r.dist.toFixed(1) + '%</span>';
      var fr = f.fresh == null ? '' : '<span style="color:#3fb950">fresh ' + f.fresh + (f.fresh === 1 ? ' bar' : ' bars') + '</span>';
      return '<article class="srow" data-sym="' + esc(r.sym) + '" data-mkt="' + r.market + '"><div class="top"><div><b>' + esc(r.name) + '</b> <span class="shnsub" style="display:inline">' + esc(r.sub) + '</span> ' + (r.snap ? '<span class="shnst shn-' + r.snap.code + '">' + esc(shortLab(r.snap)) + '</span>' : '') + '</div>' + momHTML(f.mom) + '</div><div class="chips">' + chips + '</div><div class="meta"><span>' + f.optMet + ' of ' + f.optN + ' optional met</span>' + stop + vol + fr + '</div></article>';
    }).join('') : '<div class="shnempty">No closed-bar matches for this scan. Chips stay empty until the bars are on the phone.</div>';
    var banner = pack.freshIn.length ? '<div class="snew">New in scan · ' + esc(pack.freshIn.join(', ')) + ' entered “' + esc(cfg.name) + '”. Phone notification only, never an order.</div>' : '';
    var presetHTML = presets().map(function (p) {
      var on = p.alert ? ' checked' : '';
      var line = p.mode === 'state' ? 'state = LONG WEAK / SHORT WEAK · UT weak' : scanBlurb(p);
      return '<div class="spreset"><div><b>' + esc(p.name) + '</b><div class="shnsub">' + esc(line) + '</div></div><button type="button" class="btn" data-use="' + esc(p.id) + '">Use</button><label class="ck-sw" title="Alert when a new symbol enters"><input type="checkbox" data-al="' + esc(p.id) + '"' + on + '><i></i></label></div>';
    }).join('');
    host.innerHTML = '<div class="panel" style="margin-top:0"><div class="shnmk"><button type="button" data-u="nse"' + (u === 'nse' ? ' class="on"' : '') + '>NSE stocks</button><button type="button" data-u="mcx"' + (u === 'mcx' ? ' class="on"' : '') + '>MCX instruments</button></div>' +
      '<div class="shnchips" id="shn-grp">' + groups.map(function (g) { return '<button type="button" class="shnchip' + (gNow === g[0] ? ' on' : '') + '" data-g="' + esc(g[0]) + '">' + esc(g[1]) + '</button>'; }).join('') + '</div>' +
      '<div class="sscan"><div class="hd"><b>⚡ ' + esc(cfg.name) + '</b><button type="button" class="btn" id="shn-edit">Edit scan</button></div><div class="shnmeta" style="margin-top:4px">' + esc(scanBlurb(cfg)) + '</div><div class="spills">' + pills + '</div></div>' +
      '<div class="shnchips" id="shn-sort">' + sorts.map(function (s) { return '<button type="button" class="shnchip' + (curSort === s[0] ? ' on' : '') + '" data-sort="' + s[0] + '">' + s[1] + '</button>'; }).join('') + '</div>' +
      '<div class="shnstat"><div><b>' + pack.rows.length + '</b><small>match</small></div><div><b>' + pack.scanned + '</b><small>' + (pack.universe > pack.scanned ? 'of ' + pack.universe : 'scanned') + '</small></div><div><b>' + esc(TFN[pack.tf] || pack.tf) + '</b><small>timeframe</small></div><div><b>' + (pack.freshIn.length ? '+' + pack.freshIn.length : '0') + '</b><small>new</small></div></div>' +
      banner + rows +
      '<div class="shnmeta" style="margin-top:8px">Chip = signal · B / S · bars ago (0 = last closed bar). ● = mandatory. Tap a row for the timeline.</div>' +
      '<h2 class="ck-h2">Saved scan presets</h2>' + presetHTML + '</div>';
    bindScreener(host);
  }
  function bindScreener(host) {
    host.querySelectorAll('.shnmk button').forEach(function (b) { b.onclick = function () { UNIV = b.dataset.u; lj('shn_univ', UNIV); paintScreener(); if (UNIV === 'nse') ensureNse(); else queueMcx(scan().tf); }; });
    host.querySelectorAll('#shn-grp .shnchip').forEach(function (b) { b.onclick = function () { if (UNIV === 'mcx') lj('shn_group', b.dataset.g); else lj('shn_sector', b.dataset.g); paintScreener(); }; });
    host.querySelectorAll('#shn-sort .shnchip').forEach(function (b) { b.onclick = function () { lj('shn_sort', b.dataset.sort); paintScreener(); }; });
    var ed = $('shn-edit'); if (ed) ed.onclick = function () { openScan(); };
    host.querySelectorAll('.srow').forEach(function (el) { el.onclick = function () { openDetail(el.dataset.mkt, el.dataset.sym); }; });
    host.querySelectorAll('[data-use]').forEach(function (b) { b.onclick = function () { var p = presets().filter(function (x) { return x.id === b.dataset.use; })[0]; if (!p) return; scan._c = JSON.parse(JSON.stringify(p)); saveScan(); paintScreener(); }; });
    host.querySelectorAll('[data-al]').forEach(function (box) { box.onchange = function (e) { e.stopPropagation(); var list = presets(); list.forEach(function (p) { if (p.id === box.dataset.al) p.alert = box.checked; }); savePresets(list); if (scan().id === box.dataset.al) { scan().alert = box.checked; saveScan(); } }; });
  }
  function openRow(market, sym) {
    if (market === 'MCX' && typeof fxOpen === 'function' && typeof fxRow === 'function' && fxRow('M:' + sym)) { fxOpen('M:' + sym); return; }
    if (window.DC20Chart) {
      var tf = normTf(scan().tf || 'D');
      var code = tf === '4h' ? '4h' : tf === '2h' ? '2h' : tf === '15m' ? '15m' : 'D';
      DC20Chart.open({ market:market, sym:sym, tf:code, rule:'CHART', rule_text:'SHN v3.4 screener', dir:'none', bar_time:'', entry:null, invalidation:null, upper:null, mid:null, lower:null, atr:null, price:null, dist_atr:null, inv_rule:'-', key:market + '|' + sym + '|shn' });
    }
  }
  function spark(bars, marks) {
    var c = bars.map(function (b) { return Array.isArray(b) ? +b[4] : +b.close; }).slice(-80);
    if (c.length < 2) return '';
    var lo = Math.min.apply(null, c), hi = Math.max.apply(null, c), w = 360, h = 140;
    var pts = c.map(function (v, i) { return ((i / (c.length - 1)) * w).toFixed(1) + ',' + (h - ((hi > lo ? (v - lo) / (hi - lo) : 0.5) * (h - 8)) - 4).toFixed(1); }).join(' ');
    var dots = (marks || []).map(function (m) {
      var i = c.length - 1 - m.ago; if (i < 0) return '';
      var x = (i / (c.length - 1)) * w, y = h - ((hi > lo ? (c[i] - lo) / (hi - lo) : 0.5) * (h - 8)) - 4;
      return '<text x="' + x.toFixed(1) + '" y="' + Math.max(10, y - 6).toFixed(1) + '" fill="' + (m.dir === 'S' ? '#f85149' : '#3fb950') + '" font-size="9" text-anchor="middle">' + esc(m.label) + '</text>';
    }).join('');
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="150" role="img"><polyline points="' + pts + '" fill="none" stroke="#f85149" stroke-width="1.6"/>' + dots + '</svg>';
  }
  function openDetail(market, sym) {
    var old = $('shn-detail'); if (old) old.remove();
    var u = market === 'NSE' ? 'nse' : 'mcx';
    var tf = normTf(scan().tf || 'D');
    var fy = market === 'NSE' ? fyOfNse(sym) : fyOfMcx(sym);
    var snap = snapOf(fy, tf);
    var info = infoOf(fy, tf, market);
    var fit = info && window.SHNSignals ? SHNSignals.fit(info, scan()) : null;
    var bars = (MEM[fy + '|' + tf] && MEM[fy + '|' + tf].bars) || [];
    var marks = [];
    if (fit) [['UT','ut'],['SHN','shn'],['ITL','ith'],['DC20','dc20']].forEach(function (p) { var h = fit.chips[p[1]]; if (h) marks.push({ ago:h.ago, dir:h.dir, label:p[0] }); });
    var sigRows = [['UT Bot','ut'],['SHN flip (V4a)','shn'],['ITL / ITH','ith'],['DC20 breakout','dc20'],['DC40 breakout','dc40']].map(function (p) {
      var h = fit && fit.chips[p[1]];
      var mode = scan().signals[p[1]] || 'off';
      return '<tr><td>' + (mode === 'must' ? '● ' : mode === 'opt' ? '○ ' : '') + esc(p[0]) + '</td><td>' + (h ? esc(h.dir === 'B' ? 'Buy' : 'Sell') : '–') + '</td><td>' + (h ? h.ago : '–') + '</td><td>' + (h && h.time ? esc(istBar(h.time)) : '–') + '</td><td>' + (h && h.inScan ? '✓' : '–') + '</td></tr>';
    }).join('');
    var el = document.createElement('div');
    el.id = 'shn-detail'; el.className = 'sdet';
    el.innerHTML = '<div class="shnshhd"><button type="button" class="btn" id="shn-dx">←</button><b>' + esc(sym) + '</b> <span class="shnsub">' + esc(market + ' · ' + (TFN[tf] || tf)) + '</span>' + (snap ? ' <span class="shnst shn-' + snap.code + '">' + esc(shortLab(snap)) + '</span>' : '') + '<span style="margin-left:auto">' + (snap && snap.close != null ? num(snap.close) : '') + '</span></div>' +
      spark(bars, marks) +
      '<table class="shntable ssig"><thead><tr><th>Signal</th><th>Dir</th><th>Bars ago</th><th>Bar (IST)</th><th>In scan</th></tr></thead><tbody>' + sigRows + '</tbody></table>' +
      '<div class="sgrid"><div><small>MOMENTUM</small><b class="' + ((fit && fit.mom >= 75) ? 'up' : '') + '">' + (fit ? Math.round(fit.mom) : '–') + '</b><small>EMA13 · MACD hist · hist&gt;0 · no fresh squeeze</small></div><div><small>FRESHNESS</small><b>' + (fit && fit.fresh != null ? fit.fresh : '–') + '</b><small>bars since all mandatory signals were true</small></div><div><small>OPTIONAL</small><b>' + (fit ? fit.optMet + ' of ' + fit.optN : '–') + '</b><small>plain count, not a score</small></div></div>' +
      '<div class="sgrid"><div><small>V4a STOP</small><b>' + (snap && snap.stop != null ? num(snap.stop) : '–') + '</b><small>' + (snap && distOf(snap, sym) != null ? distOf(snap, sym).toFixed(1) + '% away' : '') + '</small></div><div><small>VOLUME</small><b>' + (fit && fit.volX != null ? fit.volX.toFixed(1) + '×' : '–') + '</b><small>vs 20-bar average</small></div><div><small>UT vs V4a</small><b>' + (snap && snap.utWeak ? 'weak' : snap && snap.utText === 'agree' ? 'agrees' : '–') + '</b></div></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="btn" id="shn-dchart">Chart + SHN panel</button><button type="button" class="btn" id="shn-dbell">Alert on exit / weak</button><button type="button" class="btn" id="shn-dwatch">Watch</button></div>';
    document.body.appendChild(el);
    $('shn-dx').onclick = function () { el.remove(); };
    $('shn-dchart').onclick = function () { el.remove(); openRow(market, sym); };
    $('shn-dbell').onclick = function () { toggleBell(market + '|' + sym, tf); this.textContent = bellOn(market + '|' + sym, tf) ? 'Alert on' : 'Alert on exit / weak'; };
    $('shn-dwatch').onclick = function () { if (market === 'MCX' && typeof fxToggleFav === 'function') fxToggleFav('M:' + sym); };
  }
  function modeBtn(sig, mode, label) {
    return '<button type="button" class="shnchip' + (scan().signals[sig] === mode ? ' on' : '') + '" data-sig="' + sig + '" data-mode="' + mode + '">' + label + '</button>';
  }
  function openScan() {
    var old = $('shn-scan'); if (old) old.remove();
    var cfg = scan();
    var names = { ut:'UT Bot', shn:'SHN candle flip (V4a)', ith:'ITH / ITL', dc20:'DC 20 breakout', dc40:'DC 40 breakout' };
    var hints = { ut:'UT Buy / UT Sell · key 1.0 · ATR 10 · close', shn:'HA colour flip, body ≥ 0.3 × ATR14', ith:'pivot 20 / 20 confirmed · ITL = buy, ITH = sell', dc20:'close crosses the prior 20-bar high / low', dc40:'close crosses the prior 40-bar high / low' };
    var rows = ['ut','shn','ith','dc20','dc40'].map(function (k) {
      var extra = k === 'ith' ? '<div class="shnmeta">Confirmation window <span class="step"><button type="button" id="shn-ith-m" type="button">−</button><b id="shn-ithn">' + cfg.ithWithin + '</b><button type="button" id="shn-ith-p">+</button></span> bars</div>' : '';
      return '<div style="padding:8px 0;border-top:1px solid var(--grid)"><b>' + names[k] + '</b><div class="shnmeta">' + hints[k] + '</div><div class="shnchips">' + modeBtn(k,'must','Mandatory') + modeBtn(k,'opt','Optional') + modeBtn(k,'off','Off') + '</div>' + extra + '</div>';
    }).join('');
    var el = document.createElement('div');
    el.id = 'shn-scan'; el.className = 'shnsheet';
    el.innerHTML = '<div class="shnshhd"><b>Build your scan</b><button type="button" class="btn x" id="shn-sx">Close</button></div>' +
      '<div class="shnmeta">SIGNALS · tap Mandatory / Optional / Off</div>' + rows +
      '<div class="shnslbl"><span>DIRECTION</span><span>SIGNAL WITHIN LAST N BARS</span></div><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span class="seg" id="shn-dir"><button type="button" data-dir="buy"' + (cfg.dir==='buy'?' class="on"':'') + '>Buy</button><button type="button" data-dir="sell"' + (cfg.dir==='sell'?' class="on"':'') + '>Sell</button><button type="button" data-dir="both"' + (cfg.dir==='both'?' class="on"':'') + '>Both</button></span><span class="step"><button type="button" id="shn-n-m">−</button><b id="shn-nn">' + cfg.within + '</b><button type="button" id="shn-n-p">+</button></span></div>' +
      '<div class="shnslbl"><span>OPTIONAL · NEED AT LEAST</span><span>TIMEFRAME</span></div><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span class="step"><button type="button" id="shn-k-m">−</button><b id="shn-kk">' + cfg.optNeed + '</b><button type="button" id="shn-k-p">+</button></span><span class="seg" id="shn-stf">' + TFS.map(function (t) { return '<button type="button" data-tf="' + t + '"' + (normTf(cfg.tf)===t?' class="on"':'') + '>' + TFN[t] + '</button>'; }).join('') + '</span></div>' +
      '<div class="shnchips" id="shn-ex"><button type="button" class="shnchip' + (cfg.volOn?' on':'') + '" data-ex="vol">Volume ≥ ' + cfg.volMult + '× avg</button><button type="button" class="shnchip' + (cfg.stopMax!=null?' on':'') + '" data-ex="stop">Stop ≤ 4%</button><button type="button" class="shnchip' + (cfg.momMin!=null?' on':'') + '" data-ex="mom">MOM ≥ 75</button><button type="button" class="shnchip' + (cfg.hideUtWeak?' on':'') + '" data-ex="utw">Hide UT weak</button></div>' +
      '<div style="display:flex;gap:8px;margin-top:10px"><button type="button" class="btn" id="shn-sreset">Reset</button><button type="button" class="btn" id="shn-ssave">Save preset</button><button type="button" class="btn pri" id="shn-srun">Run</button></div>';
    document.body.appendChild(el);
    function bump(key, d, lo, hi, lab) { cfg[key] = Math.max(lo, Math.min(hi, (cfg[key] || 0) + d)); if (lab) lab.textContent = cfg[key]; saveScan(); }
    $('shn-sx').onclick = function () { el.remove(); paintScreener(); };
    el.querySelectorAll('[data-sig]').forEach(function (b) { b.onclick = function () { cfg.signals[b.dataset.sig] = b.dataset.mode; saveScan(); openScan(); }; });
    el.querySelectorAll('#shn-dir button').forEach(function (b) { b.onclick = function () { cfg.dir = b.dataset.dir; saveScan(); openScan(); }; });
    el.querySelectorAll('#shn-stf button').forEach(function (b) { b.onclick = function () { cfg.tf = b.dataset.tf; saveScan(); openScan(); }; });
    $('shn-n-m').onclick = function () { bump('within', -1, 1, 20, $('shn-nn')); };
    $('shn-n-p').onclick = function () { bump('within', 1, 1, 20, $('shn-nn')); };
    $('shn-k-m').onclick = function () { bump('optNeed', -1, 0, 5, $('shn-kk')); };
    $('shn-k-p').onclick = function () { bump('optNeed', 1, 0, 5, $('shn-kk')); };
    var im = $('shn-ith-m'), ip = $('shn-ith-p');
    if (im) im.onclick = function () { bump('ithWithin', -1, 20, 60, $('shn-ithn')); };
    if (ip) ip.onclick = function () { bump('ithWithin', 1, 20, 60, $('shn-ithn')); };
    el.querySelectorAll('#shn-ex .shnchip').forEach(function (b) { b.onclick = function () {
      var k = b.dataset.ex;
      if (k === 'vol') cfg.volOn = !cfg.volOn;
      else if (k === 'stop') cfg.stopMax = cfg.stopMax == null ? 4 : null;
      else if (k === 'mom') cfg.momMin = cfg.momMin == null ? 75 : null;
      else cfg.hideUtWeak = !cfg.hideUtWeak;
      saveScan(); openScan();
    }; });
    $('shn-sreset').onclick = function () { scan._c = coreScan(); saveScan(); openScan(); };
    $('shn-ssave').onclick = function () { var list = presets(); var copy = JSON.parse(JSON.stringify(cfg)); copy.id = 'custom'; copy.name = 'Custom scan'; copy.alert = false; var i = list.findIndex(function (p) { return p.id === 'custom'; }); if (i >= 0) list[i] = copy; else list.push(copy); savePresets(list); };
    $('shn-srun').onclick = function () { el.remove(); paintScreener(); };
  }

  function paintAll() {
    try { decorateHub(); } catch (e) { console.warn('shn hub', e); }
    try { if ($('tab-dc20') && $('tab-dc20').classList.contains('active')) decorateDC(); } catch (e) { console.warn('shn dc', e); }
    try { paintFx(); } catch (e) {}
    try { if ($('tab-shn') && $('tab-shn').classList.contains('active')) paintScreener(); else paintBadge(scanRows(UNIV === 'mcx' ? 'mcx' : 'nse').rows.length); } catch (e) {}
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
  RENDER.shn = function () { paintScreener(); ensureNse(); queueMcx(scan().tf || HUB_TF); };
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
