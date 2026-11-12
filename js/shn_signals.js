/**
 * Screener signals on closed bars. UT Bot and the V4a HA flip come from the SHN v3.4 engine
 * (the same calc the trade state uses). ITH/ITL and Donchian crosses follow the Pine rules below.
 * Read-only. No orders.
 *
 * UT: src = close, key 1.0, ATR 10. Buy when src > trail and ema(src, 1) crosses above the trail.
 *     ema(src, 1) is src. Sell is the mirror. The engine stores this on utBuy / utSell.
 * SHN flip: Heikin Ashi, haOpen seeded (o+c)/2, flip when the colour changes and
 *     |haClose-haOpen| >= 0.3 * ATR(14). Engine flipBuy / flipSell.
 * ITL = pivotlow(low, 20, 20) confirmed 20 bars later = Buy.
 * ITH = pivothigh(high, 20, 20) confirmed 20 bars later = Sell.
 *     Bars ago are counted from that confirmation bar.
 * DC20 Buy: crossover(close, highest(high, 20)[1]). Sell: crossunder(close, lowest(low, 20)[1]).
 * DC40 is the same length 40.
 * Momentum 0-100, 25 points each: EMA13 rising, MACD(12,26,9) histogram rising, histogram > 0,
 * and no squeeze (BB 20/2 inside KC 20/1.5) that ended within the last 5 bars. Shorts mirror it.
 */
(function (global) {
  'use strict';
  const SHN = global.SHNv34 || (typeof require === 'function' ? require('./shn_v34.js') : null);
  if (!SHN) throw new Error('SHN v3.4 engine missing');

  function pivotAt(x, L, isHigh) {
    const n = x.length;
    const out = new Array(n).fill(false);
    for (let i = 2 * L; i < n; i++) {
      const p = i - L;
      const v = x[p];
      let ok = true;
      for (let j = p - L; j < p && ok; j++) ok = isHigh ? x[j] < v : x[j] > v;
      for (let j = p + 1; j <= i && ok; j++) ok = isHigh ? x[j] <= v : x[j] >= v;
      if (ok) out[i] = true;
    }
    return out;
  }

  function donchian(high, low, close, len) {
    const n = close.length;
    const buy = new Array(n).fill(false);
    const sell = new Array(n).fill(false);
    function extreme(arr, a, b, hi) {
      let m = hi ? -Infinity : Infinity;
      for (let j = a; j <= b; j++) m = hi ? Math.max(m, arr[j]) : Math.min(m, arr[j]);
      return m;
    }
    for (let i = len + 1; i < n; i++) {
      const hh = extreme(high, i - len, i - 1, true);
      const prevH = extreme(high, i - 1 - len, i - 2, true);
      const ll = extreme(low, i - len, i - 1, false);
      const prevL = extreme(low, i - 1 - len, i - 2, false);
      buy[i] = close[i - 1] <= prevH && close[i] > hh;
      sell[i] = close[i - 1] >= prevL && close[i] < ll;
    }
    return { buy, sell };
  }

  function volRatio(bars, len) {
    const n = bars.length;
    if (n < len) return null;
    let s = 0;
    let any = false;
    for (let i = n - len; i < n; i++) {
      const v = +bars[i].volume || 0;
      if (v > 0) any = true;
      s += v;
    }
    if (!any) return null;
    const sma = s / len;
    if (!(sma > 0)) return null;
    return (+bars[n - 1].volume || 0) / sma;
  }

  function pack(flagBuy, flagSell, times) {
    const ev = [];
    for (let i = 0; i < flagBuy.length; i++) {
      if (flagBuy[i]) ev.push({ i, dir: 'B', time: times[i] });
      else if (flagSell[i]) ev.push({ i, dir: 'S', time: times[i] });
    }
    return ev;
  }

  function analyse(bars, market) {
    const list = Array.isArray(bars) && bars[0] && bars[0].open == null ? SHN.rowsToBars(bars) : bars;
    if (!list || list.length < 30) return null;
    const settings = market === 'NSE' ? SHN.SETTINGS_NSE : SHN.SETTINGS_MCX;
    const V = SHN.calc(list, settings);
    const n = list.length;
    const L = n - 1;
    const high = list.map((b) => b.high);
    const low = list.map((b) => b.low);
    const close = list.map((b) => b.close);
    const times = list.map((b) => b.time);
    const ith = pivotAt(high, 20, true);
    const itl = pivotAt(low, 20, false);
    const dc20 = donchian(high, low, close, 20);
    const dc40 = donchian(high, low, close, 40);
    return {
      n,
      time: times[L],
      close: close[L],
      momLong: V.momLong ? V.momLong[L] : 0,
      momShort: V.momShort ? V.momShort[L] : 0,
      volX: volRatio(list, 20),
      ut: pack(V.utBuy, V.utSell, times),
      shn: pack(V.flipBuy || [], V.flipSell || [], times),
      ith: pack(itl, ith, times),
      dc20: pack(dc20.buy, dc20.sell, times),
      dc40: pack(dc40.buy, dc40.sell, times)
    };
  }

  function pick(events, end, within, dir) {
    if (!events) return null;
    for (let k = events.length - 1; k >= 0; k--) {
      const e = events[k];
      const ago = end - e.i;
      if (ago < 0 || ago > within) continue;
      if (dir === 'buy' && e.dir !== 'B') continue;
      if (dir === 'sell' && e.dir !== 'S') continue;
      return { dir: e.dir, ago, time: e.time, i: e.i };
    }
    return null;
  }

  const SIGS = ['ut', 'shn', 'ith', 'dc20', 'dc40'];

  function fit(info, cfg) {
    if (!info) return null;
    const end = info.n - 1;
    const dir = cfg.dir === 'sell' ? 'sell' : cfg.dir === 'both' ? 'both' : 'buy';
    const within = cfg.within == null ? 5 : cfg.within;
    const ithWithin = cfg.ithWithin == null ? 25 : cfg.ithWithin;
    const chips = {};
    let optMet = 0;
    let optN = 0;
    let mustOk = true;
    let fresh = 0;
    let musts = 0;
    SIGS.forEach((k) => {
      const mode = (cfg.signals && cfg.signals[k]) || 'off';
      const win = k === 'ith' ? ithWithin : within;
      const hit = pick(info[k], end, win, dir);
      const shown = pick(info[k], end, win, 'both');
      chips[k] = shown ? { dir: shown.dir, ago: shown.ago, time: shown.time, inScan: !!hit && mode !== 'off' } : null;
      if (mode === 'off') return;
      if (mode === 'opt') {
        optN++;
        if (hit) optMet++;
      } else if (hit) {
        musts++;
        if (hit.ago > fresh) fresh = hit.ago;
      } else mustOk = false;
    });
    const need = cfg.optNeed == null ? 0 : cfg.optNeed;
    const mom = dir === 'sell' ? info.momShort : info.momLong;
    return {
      pass: mustOk && optMet >= need,
      chips, optMet, optN, fresh: musts ? fresh : null, mom,
      volX: info.volX, close: info.close, time: info.time
    };
  }

  const api = { analyse, fit, pick, donchian, pivotAt, volRatio, SIGS };
  global.SHNSignals = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
