/**
 * SHN Matrix v3.4 trade-state engine for the MCX Cockpit.
 * The calc() body is the validated OpenAlgo reference (js/shn_matrix_v34_reference.js),
 * which matches the Python model on 32/32 cases. The only addition inside calc is flipAge /
 * flipTime / entryAge bookkeeping after the trade loop, which does not change entries, stops or states.
 * Read-only. This file never places an order and holds no tokens.
 */
(function (global) {
'use strict';
/**
 * SHN Matrix v3.4 (Shi Hanbun No Ashi + UT Bot + DFSM) - OpenAlgo Desktop custom indicator (chart only).
 * Port of the TradingView Pine 'SHN Matrix v3.4'. Indicator only: it never places an order.
 *
 * Core: Shi Hanbun No Ashi V4a HA flip (body >= 0.3 x ATR14), single position.
 *       Each bar: (1) check the PREVIOUS bar's stop (fill at the open on a gap-through), then the
 *       optional target, then the opposite flip; (2) enter on a confirmed flip, stop = close -/+ ATR x mult
 *       (default 2.0); (3) ratchet the stop only in the favourable direction at the close.
 *       Fib golden-zone pull-back filter ON, longs only, target None, UT confirm Off (defaults).
 *       Like Pine's barstate.isconfirmed, a still-forming last bar never opens or closes a trade.
 * UT Bot: exact port of 'UT Bot Alerts' (QuantNomad). v3.4 display: green 'UT Buy' / red 'UT Sell' only
 *       when flat or agreeing with the open V4a trade; a UT signal AGAINST an open trade is an amber
 *       'UT weak' plate (early warning, not an exit). UT never opens or closes a trade.
 * Display only (never used by signals unless an optional filter input is turned on):
 *   volume-shaded HA candles (light / normal / heavy), climax candles (gold / purple), absorption dots,
 *   session VWAP, Donchian 40/20 + middle, LuxAlgo zig-zag + gradient channel, deep Fib, latest S/R
 *   zones, LRL, projection line, BOS / CHoCH, ITH / ITL, background (V4a direction, optional yellow
 *   legacy mode), stop line, T1 / T2 / T3 and target lines, one dashboard table with TRADE STATE and
 *   ACTION, alerts. MTF chips are folded from the chart's own bars (higher timeframes only).
 * Not ported: Asia high / low (off by default in Pine), the separate full backtest table (its numbers are
 *   in the dashboard's SYSTEM STATS rows), MTF chips for timeframes below the chart timeframe.
 * Stats are in-sample on the loaded history and are not a guarantee. Research, not advice.
 *
 * CREDITS / LICENCE (keep this block when sharing or editing)
 *   Core engine: Shi Hanbun No Ashi V4a (Dhiva's own indicator).
 *   UT Bot: exact port of the open-source 'UT Bot Alerts' (QuantNomad; key value a, ATR period c).
 *   Part of DFSM - Deep Fibonacci, S/R boxes, ITH/ITL, LRL, BOS/CHoCH, Donchian channel 40/20, dashboard:
 *     (c) Dark_Ace_Master - Mozilla Public License 2.0 - https://mozilla.org/MPL/2.0/
 *   Donchian Zig-Zag:
 *     (c) LuxAlgo - CC BY-NC-SA 4.0 - https://creativecommons.org/licenses/by-nc-sa/4.0/
 *   Squeeze definition (BB 20/2 inside KC 20/1.5): after LazyBear's 'Squeeze Momentum Indicator'.
 *   Elder impulse: after Dr Alexander Elder (EMA13 slope + MACD histogram slope).
 *   Combined version: personal, non-commercial use only. Do not sell or publish it without checking the licences.
 */

function shnMatrixV34Factory(lib) {
  const { registerIndicator, atr } = lib

  function numSetting(v, def, min, max) {
    if (v === '' || v === null || v === undefined) return def
    const n = Number(v)
    if (!Number.isFinite(n)) return def
    return Math.min(max, Math.max(min, n))
  }
  function boolSetting(v, def) {
    if (v === '' || v === null || v === undefined) return def
    if (typeof v === 'boolean') return v
    if (v === 'true' || v === '1' || v === 1) return true
    if (v === 'false' || v === '0' || v === 0) return false
    return def
  }
  function strSetting(v, def) {
    if (v === '' || v === null || v === undefined) return def
    return String(v)
  }
  function colSetting(v, def) {
    return typeof v === 'string' && v.trim() !== '' ? v : def
  }
  function markerPad(bars) {
    let sum = 0, count = 0
    for (const bar of bars) {
      const range = bar.high - bar.low
      if (Number.isFinite(range) && range > 0) { sum += range; count++ }
    }
    const mean = count > 0 ? sum / count : 0
    const last = bars.length > 0 ? Math.abs(bars[bars.length - 1].close) : 0
    return Math.max(mean * 0.5, last * 0.0005) || 0.01
  }
  const fin = (x) => x !== null && x !== undefined && Number.isFinite(x)

  // colour helpers
  function hexRgb(c) {
    if (typeof c !== 'string') return null
    const s = c.trim()
    let m = /^#([0-9a-f]{3})$/i.exec(s)
    if (m) return [0, 1, 2].map((k) => parseInt(m[1][k] + m[1][k], 16))
    m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s)
    if (m) return [0, 2, 4].map((k) => parseInt(m[1].slice(k, k + 2), 16))
    m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(s)
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
    return null
  }
  function alpha(c, a) {
    const rgb = hexRgb(c)
    if (!rgb) return c
    return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`
  }
  function mix(c1, c2, t) {
    const a = hexRgb(c1), b = hexRgb(c2)
    if (!a || !b) return c1
    const k = Math.max(0, Math.min(1, t))
    const h = (x) => Math.round(x).toString(16).padStart(2, '0')
    return '#' + h(a[0] + (b[0] - a[0]) * k) + h(a[1] + (b[1] - a[1]) * k) + h(a[2] + (b[2] - a[2]) * k)
  }

  // Wilder ATR (same as Pine ta.atr); uses host helper when present
  function atrWilder(h, l, c, len) {
    if (typeof atr === 'function') return atr(h, l, c, len)
    const n = h.length, out = new Array(n).fill(null), trA = new Array(n)
    for (let i = 0; i < n; i++) {
      const p = i > 0 ? c[i - 1] : null
      trA[i] = p === null ? h[i] - l[i] : Math.max(h[i] - l[i], Math.abs(h[i] - p), Math.abs(l[i] - p))
    }
    if (n < len) return out
    let s = 0
    for (let i = 0; i < len; i++) s += trA[i]
    out[len - 1] = s / len
    for (let i = len; i < n; i++) out[i] = (out[i - 1] * (len - 1) + trA[i]) / len
    return out
  }
  function highestArr(arr, len) {
    const n = arr.length, out = new Array(n).fill(null)
    for (let i = len - 1; i < n; i++) {
      let m = -Infinity
      for (let j = i - len + 1; j <= i; j++) m = Math.max(m, arr[j])
      out[i] = m
    }
    return out
  }
  function lowestArr(arr, len) {
    const n = arr.length, out = new Array(n).fill(null)
    for (let i = len - 1; i < n; i++) {
      let m = Infinity
      for (let j = i - len + 1; j <= i; j++) m = Math.min(m, arr[j])
      out[i] = m
    }
    return out
  }
  // pivot confirmed at bar i (pivot bar = i - L): strict on the left, >= / <= on the right
  function pivotArr(x, L, isHigh) {
    const n = x.length, out = new Array(n).fill(null)
    for (let i = 2 * L; i < n; i++) {
      const p = i - L, v = x[p]
      let ok = true
      for (let j = p - L; j < p && ok; j++) ok = isHigh ? x[j] < v : x[j] > v
      for (let j = p + 1; j <= i && ok; j++) ok = isHigh ? x[j] <= v : x[j] >= v
      if (ok) out[i] = v
    }
    return out
  }
  // rolling mean over a full window of finite values (Pine ta.sma)
  function smaArr(x, len) {
    const n = x.length, out = new Array(n).fill(null)
    let s = 0, bad = 0
    for (let i = 0; i < n; i++) {
      if (fin(x[i])) s += x[i]; else bad++
      if (i >= len) { if (fin(x[i - len])) s -= x[i - len]; else bad-- }
      if (i >= len - 1 && bad === 0) out[i] = s / len
    }
    return out
  }
  // Pine ta.ema: alpha 2/(len+1), seeded from the first finite value
  function emaArr(x, len) {
    const n = x.length, out = new Array(n).fill(null), a = 2 / (len + 1)
    let prev = null
    for (let i = 0; i < n; i++) {
      if (!fin(x[i])) { out[i] = prev; continue }
      prev = prev === null ? x[i] : a * x[i] + (1 - a) * prev
      out[i] = prev
    }
    return out
  }
  // Pine ta.rma: seeded with the SMA of the first len finite values
  function rmaArr(x, len) {
    const n = x.length, out = new Array(n).fill(null)
    let prev = null, s = 0, cnt = 0
    for (let i = 0; i < n; i++) {
      if (!fin(x[i])) { out[i] = prev; continue }
      if (prev === null) {
        s += x[i]; cnt++
        if (cnt === len) prev = s / len
      } else prev = (prev * (len - 1) + x[i]) / len
      out[i] = prev
    }
    return out
  }
  function stdevArr(x, len) {
    const n = x.length, out = new Array(n).fill(null)
    for (let i = len - 1; i < n; i++) {
      let s = 0, ok = true
      for (let j = i - len + 1; j <= i; j++) { if (!fin(x[j])) { ok = false; break } s += x[j] }
      if (!ok) continue
      const m = s / len
      let v = 0
      for (let j = i - len + 1; j <= i; j++) v += (x[j] - m) * (x[j] - m)
      out[i] = Math.sqrt(v / len)
    }
    return out
  }
  function wmaArr(x, len) {
    const n = x.length, out = new Array(n).fill(null), den = len * (len + 1) / 2
    for (let i = len - 1; i < n; i++) {
      let s = 0
      for (let k = 0; k < len; k++) s += x[i - k] * (len - k)
      out[i] = s / den
    }
    return out
  }
  function sumWin(x, len, i) {
    if (i < len - 1) return null
    let s = 0
    for (let j = i - len + 1; j <= i; j++) s += x[j]
    return s
  }
  function percentileLinear(x, len, pct, i) {
    if (i < len - 1) return null
    const w = []
    for (let j = i - len + 1; j <= i; j++) if (fin(x[j])) w.push(x[j])
    if (w.length < len) return null
    w.sort((a, b) => a - b)
    const r = (pct / 100) * (w.length - 1), lo = Math.floor(r), hi = Math.ceil(r)
    return w[lo] + (w[hi] - w[lo]) * (r - lo)
  }

  // time zone helpers (IST default; DST-aware zones via Intl)
  const fmtCache = {}
  function partsAt(t, tz) {
    try {
      if (!fmtCache[tz]) {
        fmtCache[tz] = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: 'short', day: '2-digit',
          hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
      }
      const p = fmtCache[tz].formatToParts(new Date(t * 1000))
      const g = (k) => (p.find((x) => x.type === k) || {}).value || ''
      return { y: g('year'), mon: g('month'), d: g('day'), hh: g('hour'), mm: g('minute'), dow: g('weekday') }
    } catch (e) {
      const d = new Date((t + 19800) * 1000)
      const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      const W = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      const z = (v) => String(v).padStart(2, '0')
      return { y: String(d.getUTCFullYear()), mon: M[d.getUTCMonth()], d: z(d.getUTCDate()), hh: z(d.getUTCHours()), mm: z(d.getUTCMinutes()), dow: W[d.getUTCDay()] }
    }
  }
  const fmtT = (t, tz) => { if (!fin(t)) return '-'; const p = partsAt(t, tz); return `${p.d} ${p.mon} ${p.hh}:${p.mm}` }
  const fmtTD = (t, tz) => { if (!fin(t)) return '-'; const p = partsAt(t, tz); return `${p.dow} ${p.d} ${p.mon} ${p.hh}:${p.mm}` }
  const fmtMY = (t, tz) => { if (!fin(t)) return '-'; const p = partsAt(t, tz); return `${p.mon} ${p.y}` }
  // UTC offset (seconds) of a zone at time t
  const offFmt = {}
  function zoneOff(t, tz) {
    if (tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta') return 19800
    try {
      if (!offFmt[tz]) offFmt[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' })
      const p = offFmt[tz].formatToParts(new Date(t * 1000)); const g = (k) => Number((p.find((x) => x.type === k) || {}).value)
      return Math.round((Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) / 1000 - t) / 60) * 60
    } catch (e) { return 19800 }
  }

  const POS = [
    { label: 'Top right', value: 'top-right' }, { label: 'Top left', value: 'top-left' }, { label: 'Top center', value: 'top-center' },
    { label: 'Middle right', value: 'middle-right' }, { label: 'Middle left', value: 'middle-left' },
    { label: 'Bottom right', value: 'bottom-right' }, { label: 'Bottom left', value: 'bottom-left' }, { label: 'Bottom center', value: 'bottom-center' },
  ]
  const TFS = [
    { label: '15m', value: '15' }, { label: '30m', value: '30' }, { label: '1H', value: '60' }, { label: '2H', value: '120' },
    { label: '4H', value: '240' }, { label: 'D', value: 'D' }, { label: 'W', value: 'W' }, { label: 'Off', value: 'off' },
  ]
  const G_ENG = '1. Shi Hanbun No Ashi engine (V4a)', G_UT = '2. UT Bot', G_FILT = '3. Entry filters', G_VOL = '4. Volume filter'
  const G_SL = '5. Stop and target', G_ZZ = '6. Donchian Zig-Zag (LuxAlgo)', G_DC = '7. Donchian Channel (DFSM)', G_FIB = '8. Deep Fibonacci'
  const G_SR = '9. S/R Boxes', G_WAVE = '10. Price Wave', G_ARR = '11. Projection', G_LRL = '12. Low Resistance Liquidity'
  const G_SMC = '13. BOS and CHoCH', G_ITH = '14. ITH and ITL', G_TRD = '16. Trade display', G_STAT = '17. Dashboard'
  const G_BT = '18. Stats window', G_AL = '19. Alerts', G_BG = '21. Background colour', G_MOM = '22. Momentum (display only)'
  const G_CTX = '23. Context (MTF, session, EIA)', G_VV = '24. VWAP and volume shading'

  // dashboard theme (Pine defaults)
  const TH = { bg: '#131a26', head: '#0e2a47', sec: '#1c2636', border: '#2a3445', text: '#e5ecf6', muted: '#8b96a8', secTx: '#93c5fd',
    good: '#14532d', bad: '#7f1d1d', warn: '#713f12', neut: '#263247', goodTx: '#22c55e', badTx: '#ef4444', warnTx: '#eab308' }

  registerIndicator({
    id: 'custom-shn-matrix-v34',
    name: 'SHN Matrix v3.4 (Shi Hanbun No Ashi + UT Bot + DFSM)',
    category: 'Custom',
    placement: 'onchart',
    markerAnchor: 'price',

    inputs: [
      { key: 'atrLen', type: 'number', label: 'ATR length', default: 14, min: 2, max: 500, step: 1, group: G_ENG },
      { key: 'atrMult', type: 'number', label: 'ATR trailing SL multiplier', default: 2.0, min: 0.1, max: 50, step: 0.1, group: G_ENG },
      { key: 'bodyMul', type: 'number', label: 'Min flip body (x ATR)', default: 0.3, min: 0, max: 20, step: 0.05, group: G_ENG },
      { key: 'showHA', type: 'boolean', label: 'Plot HA candles', default: true, group: G_ENG },
      { key: 'hideMain', type: 'boolean', label: 'Hide the normal price candles (transparent)', default: false, group: G_ENG,
        tooltip: 'Display only. Paints the main chart candles transparent so only the HA candles show. Off restores them.' },

      { key: 'utMode', type: 'select', label: 'UT Bot confirm', default: 'off', group: G_UT,
        options: [{ label: 'Off', value: 'off' }, { label: 'Confirm (UT state bullish)', value: 'confirm' }, { label: 'UT buy within N bars', value: 'within' }] },
      { key: 'utKey', type: 'number', label: 'Key value (a)', default: 1.0, min: 0.1, max: 20, step: 0.1, group: G_UT },
      { key: 'utAtr', type: 'number', label: 'ATR period (c)', default: 10, min: 1, max: 500, step: 1, group: G_UT },
      { key: 'utN', type: 'number', label: 'Within N bars', default: 3, min: 0, max: 50, step: 1, group: G_UT },
      { key: 'showUT', type: 'boolean', label: 'Show UT trailing stop line', default: false, group: G_UT },
      { key: 'showUTSig', type: 'boolean', label: "Show UT Bot labels (amber 'UT weak' when against an open V4a trade)", default: true, group: G_UT },
      { key: 'utHA', type: 'boolean', label: 'UT signals from Heikin Ashi candles', default: false, group: G_UT },

      { key: 'useFib', type: 'boolean', label: 'Fib golden-zone pull-back filter', default: true, group: G_FILT },
      { key: 'fibLen', type: 'number', label: 'Fib swing lookback', default: 40, min: 5, max: 500, step: 1, group: G_FILT },
      { key: 'fibLevel', type: 'number', label: 'Pull-back must touch level', default: 0.618, min: 0.1, max: 0.95, step: 0.001, group: G_FILT },
      { key: 'fibHold', type: 'number', label: 'Close must hold above level', default: 0.786, min: 0.1, max: 1.0, step: 0.001, group: G_FILT },
      { key: 'fibLookback', type: 'number', label: 'Touch within last N bars', default: 5, min: 0, max: 50, step: 1, group: G_FILT },
      { key: 'useZZ', type: 'boolean', label: 'Zig-zag rising filter', default: false, group: G_FILT },
      { key: 'useSMC', type: 'boolean', label: 'SMC bullish structure filter', default: false, group: G_FILT },

      { key: 'volMode', type: 'select', label: 'Volume filter', default: 'off', group: G_VOL,
        options: [{ label: 'Off', value: 'off' }, { label: 'Simple (vol >= SMA x mult)', value: 'simple' }, { label: 'VC spike confirm (within N bars)', value: 'vc' }] },
      { key: 'volMult', type: 'number', label: 'Volume >= SMA x', default: 1.0, min: 0.1, max: 20, step: 0.1, group: G_VOL },
      { key: 'volLen', type: 'number', label: 'Volume SMA length', default: 20, min: 1, max: 500, step: 1, group: G_VOL },
      { key: 'volN', type: 'number', label: 'VC: spike within last N bars', default: 3, min: 0, max: 20, step: 1, group: G_VOL },
      { key: 'volBodyLen', type: 'number', label: 'VC: average body length', default: 14, min: 1, max: 200, step: 1, group: G_VOL },
      { key: 'volTag', type: 'boolean', label: 'Yellow BUY / SELL text when volume confirms', default: true, group: G_VOL },

      { key: 'tgtMode', type: 'select', label: 'Target', default: 'none', group: G_SL,
        options: [{ label: 'None (trail only)', value: 'none' }, { label: 'Nearest ITH / ITL', value: 'ith' }, { label: 'R-multiple', value: '2r' }] },
      { key: 'tgtR', type: 'number', label: 'Target R-multiple (also ITH fallback)', default: 2.0, min: 0.1, max: 20, step: 0.1, group: G_SL },
      { key: 'skip1R', type: 'boolean', label: 'Skip trade if target < 1R', default: true, group: G_SL },
      { key: 'allowLong', type: 'boolean', label: 'Allow longs (BUY)', default: true, group: G_SL },
      { key: 'allowShort', type: 'boolean', label: 'Allow shorts (SELL)', default: false, group: G_SL },

      { key: 'showZZ', type: 'boolean', label: 'Show zig-zag line', default: true, group: G_ZZ },
      { key: 'zzLen', type: 'number', label: 'Length', default: 10, min: 2, max: 500, step: 1, group: G_ZZ },
      { key: 'zzBounce', type: 'number', label: 'Bounce speed', default: 2.0, min: 1, max: 20, step: 0.1, group: G_ZZ },
      { key: 'showZZBand', type: 'boolean', label: 'Show channel fill', default: true, group: G_ZZ },
      { key: 'zzGradient', type: 'boolean', label: 'Gradient fill (off = flat colour)', default: true, group: G_ZZ },
      { key: 'zzLo', type: 'color', label: 'Gradient: bottom of range', default: '#FF1100', group: G_ZZ },
      { key: 'zzMid', type: 'color', label: 'Gradient: middle', default: '#FFAB00', group: G_ZZ },
      { key: 'zzHi', type: 'color', label: 'Gradient: top of range', default: '#30FF85', group: G_ZZ },
      { key: 'zzFlat', type: 'color', label: 'Flat fill colour', default: '#808080', group: G_ZZ },

      { key: 'showDC', type: 'boolean', label: 'Show Donchian channel', default: true, group: G_DC },
      { key: 'dcUpLen', type: 'number', label: 'Upper length (highest high)', default: 40, min: 2, max: 500, step: 1, group: G_DC },
      { key: 'dcLoLen', type: 'number', label: 'Lower length (lowest low)', default: 20, min: 2, max: 500, step: 1, group: G_DC },
      { key: 'showDCMid', type: 'boolean', label: 'Show middle line', default: true, group: G_DC },

      { key: 'showFibVis', type: 'boolean', label: 'Show deep Fibonacci (last bar)', default: true, group: G_FIB },
      { key: 'fibVisLen', type: 'number', label: 'Swing lookback', default: 40, min: 10, max: 500, step: 1, group: G_FIB },
      { key: 'showBoxes', type: 'boolean', label: 'Show S/R zones', default: true, group: G_SR },
      { key: 'srLen', type: 'number', label: 'Sensitivity', default: 20, min: 5, max: 200, step: 1, group: G_SR },
      { key: 'showWave', type: 'boolean', label: 'Show wave line', default: false, group: G_WAVE },
      { key: 'waveLen', type: 'number', label: 'Wave sensitivity (WMA length)', default: 20, min: 3, max: 500, step: 1, group: G_WAVE },
      { key: 'showArrow', type: 'boolean', label: 'Show projection line', default: true, group: G_ARR },
      { key: 'arrowDist', type: 'number', label: 'Forward bars', default: 12, min: 5, max: 100, step: 1, group: G_ARR },
      { key: 'showLRL', type: 'boolean', label: 'Show low resistance liquidity', default: true, group: G_LRL },
      { key: 'lrlLen', type: 'number', label: 'Lookback', default: 25, min: 10, max: 500, step: 1, group: G_LRL },

      { key: 'showSMC', type: 'boolean', label: 'Show BOS and CHoCH labels (no lines)', default: true, group: G_SMC },
      { key: 'smcLen', type: 'number', label: 'Sensitivity', default: 10, min: 2, max: 100, step: 1, group: G_SMC },
      { key: 'showITH', type: 'boolean', label: 'Show ITH and ITL badges', default: true, group: G_ITH },
      { key: 'ithLen', type: 'number', label: 'Lookback', default: 20, min: 2, max: 200, step: 1, group: G_ITH },

      { key: 'showTrades', type: 'boolean', label: 'Show BUY / SELL labels and exit x', default: true, group: G_TRD },
      { key: 'showLevels', type: 'boolean', label: 'Show stop / target while a trade is open', default: true, group: G_TRD },
      { key: 'showTgtLv', type: 'boolean', label: 'Draw T1 / T2 / T3 lines while a trade is open', default: true, group: G_TRD,
        tooltip: "Display only. The real exit target is still the 'Target' input in section 5." },
      { key: 'tgtCol', type: 'color', label: 'Target colour', default: '#2dd4bf', group: G_TRD },

      { key: 'showStatus', type: 'boolean', label: 'Show dashboard', default: true, group: G_STAT },
      { key: 'statPos', type: 'select', label: 'Position', default: 'top-right', group: G_STAT, options: POS },
      { key: 'statSize', type: 'select', label: 'Text size', default: 'tiny', group: G_STAT,
        options: [{ label: 'Tiny', value: 'tiny' }, { label: 'Small', value: 'small' }, { label: 'Normal', value: 'normal' }, { label: 'Phone (compact)', value: 'phone' }] },
      { key: 'dashTz', type: 'text', label: 'Time zone for times and the VWAP day', default: 'Asia/Kolkata', group: G_STAT },
      { key: 'secState', type: 'boolean', label: 'Section: Trade state (V4a + UT Bot) and action', default: true, group: G_STAT },
      { key: 'secBias', type: 'boolean', label: 'Section: Bias and strength', default: true, group: G_STAT },
      { key: 'secConf', type: 'boolean', label: 'Section: Confirms', default: true, group: G_STAT },
      { key: 'secVV', type: 'boolean', label: 'Section: VWAP and volume', default: true, group: G_STAT },
      { key: 'secPos', type: 'boolean', label: 'Section: Position and risk', default: true, group: G_STAT },
      { key: 'secTgt', type: 'boolean', label: 'Section: Targets', default: true, group: G_STAT },
      { key: 'secStats', type: 'boolean', label: 'Section: System stats', default: true, group: G_STAT },
      { key: 'secMom', type: 'boolean', label: 'Section: Momentum', default: true, group: G_STAT },
      { key: 'secCtx', type: 'boolean', label: 'Section: Context (MTF, session, EIA, last signal)', default: true, group: G_STAT },
      { key: 'secDfsm', type: 'boolean', label: 'Section: DFSM extras (golden zone, Donchian, wave, ATR)', default: false, group: G_STAT },
      { key: 'pointVal', type: 'number', label: 'Point value per lot (Rs per 1.0 move, 0 = hide Rs)', default: 0, min: 0, max: 1000000, step: 1, group: G_STAT },

      { key: 'btYears', type: 'number', label: 'Stats window: last N years (0 = all history)', default: 3, min: 0, max: 50, step: 0.25, group: G_BT },
      { key: 'cost', type: 'number', label: 'Commission % per side', default: 0.05, min: 0, max: 5, step: 0.01, group: G_BT },

      { key: 'alertsOn', type: 'boolean', label: 'Enable alerts', default: true, group: G_AL },

      { key: 'showBg', type: 'boolean', label: 'Background colour', default: true, group: G_BG,
        tooltip: 'Green = open long, red = open short; when flat, green / red follow the HA candle.' },
      { key: 'bgMode', type: 'select', label: 'Background mode', default: 'dir', group: G_BG,
        options: [{ label: 'V4a direction only', value: 'dir' }, { label: 'Direction + yellow when flat in squeeze / chop', value: 'legacy' }] },
      { key: 'bgTransp', type: 'number', label: 'Transparency (higher = fainter)', default: 92, min: 50, max: 100, step: 1, group: G_BG },
      { key: 'bgGreen', type: 'color', label: 'Green', default: '#22c55e', group: G_BG },
      { key: 'bgRed', type: 'color', label: 'Red', default: '#ef4444', group: G_BG },
      { key: 'bgYellow', type: 'color', label: 'Yellow', default: '#eab308', group: G_BG },
      { key: 'sqzPct', type: 'number', label: 'Squeeze: DC width below this percentile', default: 20, min: 1, max: 50, step: 1, group: G_BG },
      { key: 'sqzLook', type: 'number', label: 'Squeeze: percentile lookback (bars)', default: 100, min: 20, max: 1000, step: 1, group: G_BG },
      { key: 'chopBody', type: 'number', label: 'Chop: HA body below x ATR', default: 0.3, min: 0, max: 5, step: 0.05, group: G_BG },
      { key: 'chopFlipN', type: 'number', label: 'Chop: window for HA flips (bars)', default: 6, min: 2, max: 50, step: 1, group: G_BG },
      { key: 'chopFlips', type: 'number', label: 'Chop: flips in window', default: 2, min: 1, max: 50, step: 1, group: G_BG },

      { key: 'momEma', type: 'number', label: 'EMA length (rising)', default: 13, min: 2, max: 200, step: 1, group: G_MOM },
      { key: 'momFast', type: 'number', label: 'MACD fast', default: 12, min: 1, max: 200, step: 1, group: G_MOM },
      { key: 'momSlow', type: 'number', label: 'MACD slow', default: 26, min: 2, max: 400, step: 1, group: G_MOM },
      { key: 'momSig', type: 'number', label: 'MACD signal', default: 9, min: 1, max: 200, step: 1, group: G_MOM },
      { key: 'momBBLen', type: 'number', label: 'Squeeze BB length', default: 20, min: 2, max: 400, step: 1, group: G_MOM },
      { key: 'momBBMul', type: 'number', label: 'Squeeze BB mult', default: 2.0, min: 0.1, max: 10, step: 0.1, group: G_MOM },
      { key: 'momKCLen', type: 'number', label: 'Squeeze KC length', default: 20, min: 2, max: 400, step: 1, group: G_MOM },
      { key: 'momKCMul', type: 'number', label: 'Squeeze KC mult', default: 1.5, min: 0.1, max: 10, step: 0.1, group: G_MOM },
      { key: 'momFireN', type: 'number', label: "'Squeeze just fired' = within N bars", default: 5, min: 1, max: 50, step: 1, group: G_MOM },

      { key: 'showMTF', type: 'boolean', label: 'Show MTF HA trend chips (folded from chart bars)', default: true, group: G_CTX,
        tooltip: 'HA direction of the previous closed bar of each higher timeframe, folded from the bars on this chart. A timeframe below the chart timeframe shows n/a.' },
      { key: 'mtf1', type: 'select', label: 'MTF 1', default: '15', group: G_CTX, options: TFS },
      { key: 'mtf2', type: 'select', label: 'MTF 2', default: '120', group: G_CTX, options: TFS },
      { key: 'mtf3', type: 'select', label: 'MTF 3', default: '240', group: G_CTX, options: TFS },
      { key: 'mtf4', type: 'select', label: 'MTF 4', default: 'D', group: G_CTX, options: TFS },
      { key: 'mtfAnchor', type: 'text', label: 'Intraday MTF bars start at (HH:MM)', default: '09:00', group: G_CTX,
        tooltip: 'MCX 09:00, NSE 09:15. Used to fold 2H / 4H buckets.' },
      { key: 'showSess', type: 'boolean', label: 'Show MCX session (close 23:30 IST in US summer / 23:55 IST in US winter)', default: true, group: G_CTX },
      { key: 'eiaMode', type: 'select', label: 'EIA report', default: 'auto', group: G_CTX,
        options: [{ label: 'Auto', value: 'auto' }, { label: 'Crude (Wed 10:30 New York)', value: 'crude' }, { label: 'Nat gas (Thu 10:30 New York)', value: 'gas' }, { label: 'Both', value: 'both' }, { label: 'Off', value: 'off' }] },

      { key: 'shadeOn', type: 'boolean', label: 'Shade HA candles by volume (3 shades)', default: true, group: G_VV },
      { key: 'shLen', type: 'number', label: 'Volume average length', default: 20, min: 1, max: 500, step: 1, group: G_VV },
      { key: 'shNorm', type: 'number', label: 'Normal from (x average)', default: 1.0, min: 0, max: 20, step: 0.05, group: G_VV },
      { key: 'shHeavy', type: 'number', label: 'Heavy from (x average)', default: 1.5, min: 0, max: 20, step: 0.05, group: G_VV },
      { key: 'cBullL', type: 'color', label: 'Bull light', default: '#81c784', group: G_VV },
      { key: 'cBullN', type: 'color', label: 'Bull normal', default: '#43a047', group: G_VV },
      { key: 'cBullH', type: 'color', label: 'Bull heavy', default: '#1b6e20', group: G_VV },
      { key: 'cBearL', type: 'color', label: 'Bear light', default: '#e57373', group: G_VV },
      { key: 'cBearN', type: 'color', label: 'Bear normal', default: '#e53935', group: G_VV },
      { key: 'cBearH', type: 'color', label: 'Bear heavy', default: '#9b1111', group: G_VV },
      { key: 'cBullB', type: 'color', label: 'Bull border + wick', default: '#1b5e20', group: G_VV,
        tooltip: 'On a dark chart theme a light outline (#c8e6c9) reads better.' },
      { key: 'cBearB', type: 'color', label: 'Bear border + wick', default: '#7f0000', group: G_VV,
        tooltip: 'On a dark chart theme a light outline (#ffcdd2) reads better.' },
      { key: 'lightSty', type: 'select', label: 'Light-volume candle style', default: 'shaded', group: G_VV,
        options: [{ label: 'Shaded', value: 'shaded' }, { label: 'Hollow', value: 'hollow' }] },
      { key: 'showClx', type: 'boolean', label: 'Climax candles (gold bull / purple bear)', default: true, group: G_VV },
      { key: 'clxMult', type: 'number', label: 'Climax from (x average)', default: 2.5, min: 0, max: 50, step: 0.1, group: G_VV },
      { key: 'cClxBull', type: 'color', label: 'Climax bull', default: '#f5b301', group: G_VV },
      { key: 'cClxBear', type: 'color', label: 'Climax bear', default: '#8e24aa', group: G_VV },
      { key: 'showAbs', type: 'boolean', label: 'Absorption dots (heavy volume, small HA body)', default: true, group: G_VV },
      { key: 'absBody', type: 'number', label: 'Absorption: HA body below x ATR', default: 0.35, min: 0, max: 5, step: 0.05, group: G_VV },
      { key: 'cAbs', type: 'color', label: 'Absorption dot', default: '#00e5ff', group: G_VV },
      { key: 'showVwap', type: 'boolean', label: 'Show session VWAP (resets each trading day)', default: true, group: G_VV },
      { key: 'skipLight', type: 'boolean', label: 'Skip light-volume entries (filter, default OFF)', default: false, group: G_VV,
        tooltip: 'OFF = same trades and backtest as v3. ON = V4a entries on light-volume bars are skipped.' },
    ],

    plots: [
      { key: 'ha', type: 'candlestick', title: 'HA candle',
        ohlc: { open: 'haOpen', high: 'haHigh', low: 'haLow', close: 'haClose' },
        style: { upColor: '#26a69a', downColor: '#ef5350', borderVisible: true, wickVisible: true },
        colorParts: ({ index, values }) => {
          const b = values.haBodyCol?.[index], e = values.haEdgeCol?.[index]
          return b ? { body: b, wick: e, border: e } : undefined
        } },
      { key: 'zzUp', type: 'line', title: 'ZZ channel upper', style: { color: 'rgba(0,0,0,0)', lineWidth: 1 } },
      { key: 'zzDn', type: 'line', title: 'ZZ channel lower', style: { color: 'rgba(0,0,0,0)', lineWidth: 1 } },
      { key: 'dcHi', type: 'line', title: 'DC upper', style: { color: '#ff9800', lineWidth: 2 } },
      { key: 'dcLo', type: 'line', title: 'DC lower', style: { color: '#9c27b0', lineWidth: 2 } },
      { key: 'dcMid', type: 'line', title: 'DC middle', style: { color: '#9e9e9e', lineWidth: 1 } },
      { key: 'vwap', type: 'line', title: 'Session VWAP', style: { color: '#38bdf8', lineWidth: 1 } },
      { key: 'utLine', type: 'line', title: 'UT trail', style: { color: '#22c55e', lineWidth: 1 },
        colorBy: ({ index, values }) => (values.utPos?.[index] === 1 ? '#22c55e' : '#ef4444') },
      { key: 'zigzag', type: 'line', title: 'Zig-zag', style: { color: '#2157f3', lineWidth: 2 } },
      { key: 'stop', type: 'line', title: 'Stop (open trade only)', style: { color: '#ff4081', lineWidth: 2 } },
      { key: 'wave', type: 'line', title: 'Wave line (WMA)', style: { color: '#00e676', lineWidth: 2 },
        colorBy: ({ index, values }) => (values.waveUp?.[index] ? '#00e676' : '#ff1744') },
    ],

    // zig-zag channel: per-bar gradient from the channel position (LuxAlgo), 85% transparent like Pine
    fills: [
      { between: ['zzUp', 'zzDn'], colorUp: '#30FF85', colorDown: '#FF1100', opacity: 0.15,
        colorBy: ({ index, values }) => values.zzCol?.[index] || undefined },
    ],

    calc(bars, settings, store, ctx) {
      const n = bars.length
      const E = () => new Array(n).fill(null)
      const B = () => new Array(n).fill(false)
      const V = {
        haOpen: E(), haHigh: E(), haLow: E(), haClose: E(), haBodyCol: E(), haEdgeCol: E(),
        zzUp: E(), zzDn: E(), zzCol: E(), dcHi: E(), dcLo: E(), dcMid: E(), vwap: E(), utLine: E(), zigzag: E(), stop: E(), wave: E(), waveUp: B(),
        utPos: new Array(n).fill(0), utMk: new Array(n).fill(0), atr14: E(),
        entryBuy: B(), entrySell: B(), vTag: B(), exitMark: B(), exitPx: E(), slHit: B(), tpHit: B(), anyExit: B(),
        bosUp: B(), bosDn: B(), chochUp: B(), chochDn: B(), smcPrice: E(), smcX: E(), ithMark: E(), itlMark: E(),
        absDot: B(), clxBar: B(), dcBoUp: B(), dcBoDn: B(), zzFlipUp: B(), zzFlipDn: B(), waveFlipUp: B(), waveFlipDn: B(), goldenX: B(),
        utBuy: B(), utSell: B(), momWeakEntry: B(), highConvEntry: B(), bgState: new Array(n).fill(0), bgChanged: B(),
        tsCode: new Array(n).fill(7), tsChanged: B(), confirmed: new Array(n).fill(true),
        stats: E(), drawList: E(), dashRows: E(),
      }
      if (n === 0) return V

      // ---------- settings ----------
      const S = settings || {}
      const atrLen = Math.floor(numSetting(S.atrLen, 14, 2, 500))
      const atrMult = numSetting(S.atrMult, 2.0, 0.1, 50)
      const bodyMul = numSetting(S.bodyMul, 0.3, 0, 20)
      const showHA = boolSetting(S.showHA, true)
      const useFib = boolSetting(S.useFib, true)
      const fibLen = Math.floor(numSetting(S.fibLen, 40, 5, 500))
      const fibLevel = numSetting(S.fibLevel, 0.618, 0.1, 0.95)
      const fibHold = numSetting(S.fibHold, 0.786, 0.1, 1.0)
      const fibLB = Math.floor(numSetting(S.fibLookback, 5, 0, 50))
      const useZZ = boolSetting(S.useZZ, false)
      const useSMC = boolSetting(S.useSMC, false)
      const tgtMode = strSetting(S.tgtMode, 'none')
      const tgtR = numSetting(S.tgtR, 2.0, 0.1, 20)
      const skip1R = boolSetting(S.skip1R, true)
      const allowLong = boolSetting(S.allowLong, true)
      const allowShort = boolSetting(S.allowShort, false)
      const zzLen = Math.floor(numSetting(S.zzLen, 10, 2, 500))
      const zzBounce = numSetting(S.zzBounce, 2.0, 1, 20)
      const showZZ = boolSetting(S.showZZ, true)
      const showZZBand = boolSetting(S.showZZBand, true)
      const zzGradient = boolSetting(S.zzGradient, true)
      const smcLen = Math.floor(numSetting(S.smcLen, 10, 2, 100))
      const showSMC = boolSetting(S.showSMC, true)
      const ithLen = Math.floor(numSetting(S.ithLen, 20, 2, 200))
      const showITH = boolSetting(S.showITH, true)
      const volMode = strSetting(S.volMode, 'off')
      const volMult = numSetting(S.volMult, 1.0, 0.1, 20)
      const volLen = Math.floor(numSetting(S.volLen, 20, 1, 500))
      const volN = Math.floor(numSetting(S.volN, 3, 0, 20))
      const volBodyLen = Math.floor(numSetting(S.volBodyLen, 14, 1, 200))
      const volTag = boolSetting(S.volTag, true)
      const utMode = strSetting(S.utMode, 'off')
      const utKey = numSetting(S.utKey, 1.0, 0.1, 20)
      const utAtrLen = Math.floor(numSetting(S.utAtr, 10, 1, 500))
      const utN = Math.floor(numSetting(S.utN, 3, 0, 50))
      const showUT = boolSetting(S.showUT, false)
      const utHA = boolSetting(S.utHA, false)
      const showDC = boolSetting(S.showDC, true)
      const dcUpLen = Math.floor(numSetting(S.dcUpLen, 40, 2, 500))
      const dcLoLen = Math.floor(numSetting(S.dcLoLen, 20, 2, 500))
      const showDCMid = boolSetting(S.showDCMid, true)
      const btYears = numSetting(S.btYears, 3, 0, 50)
      const cost = numSetting(S.cost, 0.05, 0, 5) / 100
      const showLevels = boolSetting(S.showLevels, true)
      const shadeOn = boolSetting(S.shadeOn, true)
      const shLen = Math.floor(numSetting(S.shLen, 20, 1, 500))
      const shNorm = numSetting(S.shNorm, 1.0, 0, 20)
      const shHeavy = numSetting(S.shHeavy, 1.5, 0, 20)
      const showClx = boolSetting(S.showClx, true)
      const clxMult = numSetting(S.clxMult, 2.5, 0, 50)
      const absBody = numSetting(S.absBody, 0.35, 0, 5)
      const showVwap = boolSetting(S.showVwap, true)
      const skipLight = boolSetting(S.skipLight, false)
      const hollow = strSetting(S.lightSty, 'shaded') === 'hollow'
      const C = {
        bullL: colSetting(S.cBullL, '#81c784'), bullN: colSetting(S.cBullN, '#43a047'), bullH: colSetting(S.cBullH, '#1b6e20'),
        bearL: colSetting(S.cBearL, '#e57373'), bearN: colSetting(S.cBearN, '#e53935'), bearH: colSetting(S.cBearH, '#9b1111'),
        bullB: colSetting(S.cBullB, '#1b5e20'), bearB: colSetting(S.cBearB, '#7f0000'),
        clxBull: colSetting(S.cClxBull, '#f5b301'), clxBear: colSetting(S.cClxBear, '#8e24aa'), abs: colSetting(S.cAbs, '#00e5ff'),
      }
      const bgMode = strSetting(S.bgMode, 'dir')
      const sqzPct = numSetting(S.sqzPct, 20, 1, 50)
      const sqzLook = Math.floor(numSetting(S.sqzLook, 100, 20, 1000))
      const chopBody = numSetting(S.chopBody, 0.3, 0, 5)
      const chopFlipN = Math.floor(numSetting(S.chopFlipN, 6, 2, 50))
      const chopFlips = Math.floor(numSetting(S.chopFlips, 2, 1, 50))
      const tz = strSetting(S.dashTz, 'Asia/Kolkata')

      const o = bars.map((b) => b.open), h = bars.map((b) => b.high), l = bars.map((b) => b.low), c = bars.map((b) => b.close)
      const t = bars.map((b) => b.time)
      const a = atrWilder(h, l, c, atrLen)
      const a14 = atrWilder(h, l, c, 14)
      for (let i = 0; i < n; i++) V.atr14[i] = fin(a14[i]) ? a14[i] : null
      // like Pine barstate.isconfirmed: a still-forming last bar never opens or closes a trade
      const lastOpen = !!(ctx && ctx.barState && ctx.barState.isConfirmed === false)
      const engN = lastOpen ? n - 1 : n
      if (lastOpen) V.confirmed[n - 1] = false

      // ---------- Heikin-Ashi exactly as V4a ----------
      const haO = new Array(n), haC = new Array(n), haH = new Array(n), haL = new Array(n), bull = new Array(n), haBody = new Array(n)
      for (let i = 0; i < n; i++) {
        const hc = (o[i] + h[i] + l[i] + c[i]) / 4
        const ho = i === 0 ? (o[i] + c[i]) / 2 : (haO[i - 1] + haC[i - 1]) / 2
        haO[i] = ho; haC[i] = hc; haH[i] = Math.max(h[i], ho, hc); haL[i] = Math.min(l[i], ho, hc)
        bull[i] = hc >= ho; haBody[i] = Math.abs(hc - ho)
      }
      const buyF = B(), sellF = B()
      for (let i = 1; i < n; i++) {
        const ok = fin(a[i]) && haBody[i] >= a[i] * bodyMul
        buyF[i] = ok && bull[i] && !bull[i - 1]
        sellF[i] = ok && !bull[i] && bull[i - 1]
      }

      // ---------- volume (VC ribbon logic); auto-pass when the symbol has no volume ----------
      const v = bars.map((b) => (fin(b.volume) ? b.volume : 0))
      const volL = B(), volS = B(), hasVol = B(), vSimple = B()
      {
        let cum = 0, vsum = 0, bsum = 0, lastBull = -Infinity, lastBear = -Infinity
        for (let i = 0; i < n; i++) {
          cum += v[i]
          vsum += v[i]; if (i >= volLen) vsum -= v[i - volLen]
          const body = Math.abs(c[i] - o[i])
          bsum += body; if (i >= volBodyLen) bsum -= Math.abs(c[i - volBodyLen] - o[i - volBodyLen])
          const vs = i >= volLen - 1 ? vsum / volLen : null
          const ab = i >= volBodyLen - 1 ? bsum / volBodyLen : null
          const vr = fin(vs) && vs > 0 ? v[i] / vs : 0
          const spike = vr >= volMult && fin(ab) && ab > 0 && body / ab >= 1.0
          if (spike && c[i] > o[i]) lastBull = i
          if (spike && c[i] < o[i]) lastBear = i
          hasVol[i] = cum > 0
          vSimple[i] = vr >= volMult
          volL[i] = !hasVol[i] || (volMode === 'vc' ? i - lastBull <= volN : vSimple[i])
          volS[i] = !hasVol[i] || (volMode === 'vc' ? i - lastBear <= volN : vSimple[i])
        }
      }
      // v3.1 relative volume + session VWAP (manual accumulators, reset on a new day in the chosen zone)
      const rvSma = smaArr(v, shLen)
      const rvX = new Array(n), rvCls = new Array(n), vwNew = B(), vwapV = E()
      {
        let pv = 0, vv = 0, prevDay = null
        for (let i = 0; i < n; i++) {
          rvX[i] = fin(rvSma[i]) && rvSma[i] > 0 ? v[i] / rvSma[i] : 0
          rvCls[i] = rvX[i] >= shHeavy ? 2 : rvX[i] >= shNorm ? 1 : 0
          const day = Math.floor((t[i] + zoneOff(t[i], tz)) / 86400)
          vwNew[i] = prevDay === null || day !== prevDay
          prevDay = day
          const hlc3 = (h[i] + l[i] + c[i]) / 3
          pv = vwNew[i] ? hlc3 * v[i] : pv + hlc3 * v[i]
          vv = vwNew[i] ? v[i] : vv + v[i]
          vwapV[i] = vv > 0 ? pv / vv : null
          // null on the first bar of a day hides the jump from yesterday's value (Pine: colour na)
          if (showVwap && hasVol[i] && !vwNew[i]) V.vwap[i] = vwapV[i]
        }
      }
      const isClx = B(), isAbs = B()
      for (let i = 0; i < n; i++) {
        isClx[i] = hasVol[i] && fin(rvSma[i]) && rvSma[i] > 0 && rvX[i] >= clxMult
        isAbs[i] = hasVol[i] && fin(rvSma[i]) && rvSma[i] > 0 && rvX[i] >= shHeavy && fin(a[i]) && a[i] > 0 && haBody[i] < absBody * a[i]
        V.clxBar[i] = showClx && isClx[i]
        V.absDot[i] = showHA && boolSetting(S.showAbs, true) && isAbs[i]
      }

      // ---------- HA candle output + volume shading ----------
      const shadeCol = (i) => (bull[i] ? (rvCls[i] === 2 ? C.bullH : rvCls[i] === 1 ? C.bullN : C.bullL) : (rvCls[i] === 2 ? C.bearH : rvCls[i] === 1 ? C.bearN : C.bearL))
      if (showHA) {
        for (let i = 0; i < n; i++) {
          V.haOpen[i] = haO[i]; V.haHigh[i] = haH[i]; V.haLow[i] = haL[i]; V.haClose[i] = haC[i]
          V.haBodyCol[i] = showClx && isClx[i] ? (bull[i] ? C.clxBull : C.clxBear)
            : shadeOn && hasVol[i] ? (rvCls[i] === 0 && hollow ? 'rgba(0,0,0,0)' : shadeCol(i))
              : (bull[i] ? '#26a69a' : '#ef5350')
          V.haEdgeCol[i] = bull[i] ? C.bullB : C.bearB
        }
      }

      // ---------- UT Bot Alerts (exact port): trail with nz(prev, 0), pos state, ema(src, 1) crossover ----------
      const utOkL = new Array(n).fill(true), utOkS = new Array(n).fill(true), utPos = V.utPos, utTS = E()
      {
        const xa = atrWilder(h, l, c, utAtrLen)
        const sr = utHA ? haC : c
        let lastB = null, lastS = null
        for (let i = 0; i < n; i++) {
          const p = i > 0 && fin(utTS[i - 1]) ? utTS[i - 1] : 0
          const s0 = sr[i], s1 = i > 0 ? sr[i - 1] : NaN
          const nl = fin(xa[i]) ? utKey * xa[i] : null
          if (nl === null) utTS[i] = null
          else if (s0 > p && s1 > p) utTS[i] = Math.max(p, s0 - nl)
          else if (s0 < p && s1 < p) utTS[i] = Math.min(p, s0 + nl)
          else utTS[i] = s0 > p ? s0 - nl : s0 + nl
          utPos[i] = s1 < p && s0 > p ? 1 : s1 > p && s0 < p ? -1 : (i > 0 ? utPos[i - 1] : 0)
          const ok = fin(utTS[i]) && i > 0 && fin(utTS[i - 1])
          V.utBuy[i] = ok && s0 > utTS[i] && s1 <= utTS[i - 1]
          V.utSell[i] = ok && s0 < utTS[i] && utTS[i - 1] <= s1
          if (V.utBuy[i]) lastB = i
          if (V.utSell[i]) lastS = i
          if (utMode === 'confirm') { utOkL[i] = utPos[i] === 1; utOkS[i] = utPos[i] === -1 }
          else if (utMode === 'within') { utOkL[i] = lastB !== null && i - lastB <= utN; utOkS[i] = lastS !== null && i - lastS <= utN }
          if (showUT) V.utLine[i] = utTS[i]
        }
      }

      // ---------- Donchian channel 40 / 20 (display + alerts only) ----------
      const dh = highestArr(h, dcUpLen), dl = lowestArr(l, dcLoLen), dmid = E(), dcDir = new Array(n).fill(0)
      for (let i = 0; i < n; i++) {
        if (fin(dh[i]) && fin(dl[i])) dmid[i] = (dh[i] + dl[i]) / 2
        if (i >= 2 && fin(dh[i - 1]) && fin(dh[i - 2])) V.dcBoUp[i] = c[i] > dh[i - 1] && c[i - 1] <= dh[i - 2]
        if (i >= 2 && fin(dl[i - 1]) && fin(dl[i - 2])) V.dcBoDn[i] = c[i] < dl[i - 1] && c[i - 1] >= dl[i - 2]
        dcDir[i] = V.dcBoUp[i] ? 1 : V.dcBoDn[i] ? -1 : (i > 0 ? dcDir[i - 1] : 0)
        if (showDC) { V.dcHi[i] = dh[i]; V.dcLo[i] = dl[i]; if (showDCMid) V.dcMid[i] = dmid[i] }
      }

      // ---------- Fib golden zone (entry filter) ----------
      const fH = highestArr(h, fibLen), fL = lowestArr(l, fibLen)
      const lowLB = lowestArr(l, fibLB + 1), highLB = highestArr(h, fibLB + 1)
      const fibOkL = (i) => fin(fH[i]) && lowLB[i] <= fH[i] - fibLevel * (fH[i] - fL[i]) && c[i] > fH[i] - fibHold * (fH[i] - fL[i])
      const fibOkS = (i) => fin(fL[i]) && highLB[i] >= fL[i] + fibLevel * (fH[i] - fL[i]) && c[i] < fL[i] + fibHold * (fH[i] - fL[i])

      // ---------- LuxAlgo Donchian zig-zag ----------
      const up = highestArr(c, zzLen), dn = lowestArr(c, zzLen)
      const osc = new Array(n).fill(0), zz = E(), zzNorm = E()
      {
        let zv = null
        const cross = (a0, a1, b0, b1) => fin(b0) && fin(b1) && ((a1 > b1 && a0 <= b0) || (a1 < b1 && a0 >= b0))
        const rawNorm = E()
        for (let i = 0; i < n; i++) {
          const zp = i > 0 && fin(zz[i - 1]) ? zz[i - 1] : c[i]
          const zpp = i > 1 && fin(zz[i - 2]) ? zz[i - 2] : (i > 0 ? c[i - 1] : null)
          const cu = i > 0 && cross(zpp, zp, up[i - 1], up[i])
          const cd = i > 0 && cross(zpp, zp, dn[i - 1], dn[i])
          osc[i] = cu ? -1 : cd ? 1 : (i > 0 ? osc[i - 1] : 0)
          if (i > 0 && osc[i] !== osc[i - 1]) { zv = up[i] - dn[i]; V.zzFlipUp[i] = osc[i] === 1; V.zzFlipDn[i] = osc[i] === -1 }
          zz[i] = zp + osc[i] * (zv === null ? 0 : zv) / zzLen * zzBounce
          if (fin(up[i]) && fin(dn[i]) && up[i] !== dn[i]) rawNorm[i] = Math.max(0, Math.min(1, (c[i] - dn[i]) / (up[i] - dn[i])))
        }
        for (let i = zzLen - 1; i < n; i++) {
          let s = 0, ok = true
          for (let j = i - zzLen + 1; j <= i; j++) { if (!fin(rawNorm[j])) { ok = false; break } s += rawNorm[j] }
          zzNorm[i] = ok ? s / zzLen : null
        }
        const gLo = colSetting(S.zzLo, '#FF1100'), gMid = colSetting(S.zzMid, '#FFAB00'), gHi = colSetting(S.zzHi, '#30FF85'), gFlat = colSetting(S.zzFlat, '#808080')
        for (let i = 0; i < n; i++) {
          if (showZZ) V.zigzag[i] = zz[i]
          if (!showZZBand) continue
          V.zzUp[i] = up[i]; V.zzDn[i] = dn[i]
          if (!zzGradient) { V.zzCol[i] = gFlat; continue }
          if (!fin(zzNorm[i])) continue
          const q = Math.round(zzNorm[i] * 20) / 20 // 21 steps keep the band segments few
          V.zzCol[i] = q < 0.5 ? mix(gLo, gMid, q / 0.5) : mix(gMid, gHi, (q - 0.5) / 0.5)
        }
      }

      // ---------- SMC BOS / CHoCH ----------
      const ph = pivotArr(h, smcLen, true), pl = pivotArr(l, smcLen, false)
      const trend = new Array(n).fill(0)
      let lastStruct = 'NONE'
      {
        let cph = null, cpl = null, cphi = null, cpli = null, tr = 0, prevLph = null, prevLpl = null
        for (let i = 0; i < n; i++) {
          if (fin(ph[i])) { cph = ph[i]; cphi = i - smcLen }
          if (fin(pl[i])) { cpl = pl[i]; cpli = i - smcLen }
          const lph = cph, lpl = cpl
          const bu = i > 0 && fin(lph) && fin(prevLph) && c[i] > lph && c[i - 1] <= prevLph
          const bd = i > 0 && fin(lpl) && fin(prevLpl) && c[i] < lpl && c[i - 1] >= prevLpl
          if (bu) {
            if (tr === -1) V.chochUp[i] = true; else V.bosUp[i] = true
            lastStruct = 'BULL ' + (tr === -1 ? 'CHoCH' : 'BOS')
            V.smcPrice[i] = lph; V.smcX[i] = Math.floor((cphi + i) / 2); tr = 1; cph = null
          }
          if (bd) {
            if (tr === 1) V.chochDn[i] = true; else V.bosDn[i] = true
            lastStruct = 'BEAR ' + (tr === 1 ? 'CHoCH' : 'BOS')
            V.smcPrice[i] = lpl; V.smcX[i] = Math.floor((cpli + i) / 2); tr = -1; cpl = null
          }
          trend[i] = tr
          prevLph = lph; prevLpl = lpl
        }
      }

      // ---------- ITH / ITL ----------
      const ith = pivotArr(h, ithLen, true), itl = pivotArr(l, ithLen, false)
      for (let i = 0; i < n; i++) {
        if (showITH && fin(ith[i])) V.ithMark[i - ithLen] = ith[i]
        if (showITH && fin(itl[i])) V.itlMark[i - ithLen] = itl[i]
      }

      // ---------- v3 display series: squeeze / chop (background legacy mode), ADX, momentum ----------
      const dcSqz = B(), haChop = B()
      {
        const dcW = E()
        for (let i = 0; i < n; i++) if (fin(a[i]) && a[i] > 0 && fin(dh[i]) && fin(dl[i])) dcW[i] = (dh[i] - dl[i]) / a[i]
        const flipI = new Array(n).fill(0)
        for (let i = 1; i < n; i++) flipI[i] = bull[i] !== bull[i - 1] ? 1 : 0
        for (let i = 0; i < n; i++) {
          // the percentile is only needed where it is read: every bar in legacy mode, else the last bar (dashboard)
          const q = bgMode === 'legacy' || i === n - 1 ? percentileLinear(dcW, sqzLook, sqzPct, i) : null
          dcSqz[i] = fin(dcW[i]) && fin(q) && dcW[i] < q
          const fs = sumWin(flipI, chopFlipN, i)
          haChop[i] = (fin(a[i]) && haBody[i] < chopBody * a[i]) || (fs !== null && fs >= chopFlips)
        }
      }
      // DMI / ADX 14 (Pine ta.dmi)
      const adx = E()
      {
        const trA = new Array(n), pDM = new Array(n), mDM = new Array(n)
        for (let i = 0; i < n; i++) {
          trA[i] = i === 0 ? NaN : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]))
          const u = i === 0 ? NaN : h[i] - h[i - 1], d = i === 0 ? NaN : -(l[i] - l[i - 1])
          pDM[i] = i === 0 ? NaN : (u > d && u > 0 ? u : 0)
          mDM[i] = i === 0 ? NaN : (d > u && d > 0 ? d : 0)
        }
        const trR = rmaArr(trA, 14), pR = rmaArr(pDM, 14), mR = rmaArr(mDM, 14)
        const dx = E()
        for (let i = 0; i < n; i++) {
          if (!fin(trR[i]) || !fin(pR[i]) || !fin(mR[i]) || trR[i] === 0) continue
          const p = 100 * pR[i] / trR[i], m = 100 * mR[i] / trR[i], s = p + m
          dx[i] = Math.abs(p - m) / (s === 0 ? 1 : s)
        }
        const ar = rmaArr(dx, 14)
        for (let i = 0; i < n; i++) adx[i] = fin(ar[i]) ? 100 * ar[i] : null
      }
      const momEma = Math.floor(numSetting(S.momEma, 13, 2, 200))
      const momFireN = Math.floor(numSetting(S.momFireN, 5, 1, 50))
      const mEma = emaArr(c, momEma)
      const emF = emaArr(c, Math.floor(numSetting(S.momFast, 12, 1, 200))), emS = emaArr(c, Math.floor(numSetting(S.momSlow, 26, 2, 400)))
      const mMacd = c.map((_, i) => (fin(emF[i]) && fin(emS[i]) ? emF[i] - emS[i] : null))
      const mSig = emaArr(mMacd, Math.floor(numSetting(S.momSig, 9, 1, 200)))
      const mHist = c.map((_, i) => (fin(mMacd[i]) && fin(mSig[i]) ? mMacd[i] - mSig[i] : null))
      const bbDev = stdevArr(c, Math.floor(numSetting(S.momBBLen, 20, 2, 400)))
      const trT = c.map((_, i) => (i === 0 ? h[i] - l[i] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]))))
      const kcR = smaArr(trT, Math.floor(numSetting(S.momKCLen, 20, 2, 400)))
      const bbMul = numSetting(S.momBBMul, 2.0, 0.1, 10), kcMul = numSetting(S.momKCMul, 1.5, 0.1, 10)
      const sqzOn = B(), sqzRecent = B(), momL = new Array(n).fill(0), momS = new Array(n).fill(0), elder = new Array(n).fill(0)
      const sinceFire = E()
      {
        const sqzI = new Array(n).fill(0)
        let lastFire = null
        for (let i = 0; i < n; i++) {
          sqzOn[i] = fin(bbDev[i]) && fin(kcR[i]) && bbMul * bbDev[i] < kcMul * kcR[i]
          sqzI[i] = sqzOn[i] ? 1 : 0
          if (i > 0 && sqzOn[i - 1] && !sqzOn[i]) lastFire = i
          sinceFire[i] = lastFire === null ? null : i - lastFire
          const prevSum = i > 0 ? sumWin(sqzI, momFireN, i - 1) : null
          sqzRecent[i] = !sqzOn[i] && (prevSum || 0) >= 1
          const eUp = i > 0 && fin(mEma[i - 1]) && mEma[i] > mEma[i - 1], eDn = i > 0 && fin(mEma[i - 1]) && mEma[i] < mEma[i - 1]
          const hUp = i > 0 && fin(mHist[i]) && fin(mHist[i - 1]) && mHist[i] > mHist[i - 1]
          const hDn = i > 0 && fin(mHist[i]) && fin(mHist[i - 1]) && mHist[i] < mHist[i - 1]
          momL[i] = 25 * ((eUp ? 1 : 0) + (hUp ? 1 : 0) + (fin(mHist[i]) && mHist[i] > 0 ? 1 : 0) + (sqzRecent[i] ? 0 : 1))
          momS[i] = 25 * ((eDn ? 1 : 0) + (hDn ? 1 : 0) + (fin(mHist[i]) && mHist[i] < 0 ? 1 : 0) + (sqzRecent[i] ? 0 : 1))
          elder[i] = eUp && hUp ? 1 : eDn && hDn ? -1 : 0
        }
      }

      // ---------- wave (WMA), golden-zone cross (alerts) ----------
      const waveLen = Math.floor(numSetting(S.waveLen, 20, 3, 500))
      const wma = wmaArr(c, waveLen)
      const fibVisLen = Math.floor(numSetting(S.fibVisLen, 40, 10, 500))
      const vH = highestArr(h, fibVisLen), vL = lowestArr(l, fibVisLen)
      const showWave = boolSetting(S.showWave, false)
      for (let i = 0; i < n; i++) {
        V.waveUp[i] = i > 0 && fin(wma[i]) && fin(wma[i - 1]) && wma[i] > wma[i - 1]
        if (i > 0) { V.waveFlipUp[i] = V.waveUp[i] && !V.waveUp[i - 1]; V.waveFlipDn[i] = !V.waveUp[i] && V.waveUp[i - 1] }
        if (showWave) V.wave[i] = wma[i]
        if (i > 0 && fin(vH[i]) && fin(vH[i - 1])) {
          const p0 = vH[i] - 0.618 * (vH[i] - vL[i]), p1 = vH[i - 1] - 0.618 * (vH[i - 1] - vL[i - 1])
          V.goldenX[i] = (c[i] > p0 && c[i - 1] <= p1) || (c[i] < p0 && c[i - 1] >= p1)
        }
      }

      // ---------- trade engine (V4a; identical to the verified v2 / Pine engine) ----------
      const lastT = t[n - 1]
      const startT = btYears > 0 ? lastT - btYears * 365.25 * 86400 : -Infinity
      let pos = 0, stop = null, tgt = null, ent = null, risk = null, entT = null
      const ithQ = [], itlQ = []
      const rets = [], Rs = []
      let btFirst = null, firstTr = null, lastExit = '-'
      let tEntBar = null, tMomE = null, tT1 = null, tT2 = null, tT3 = null, tH1 = null, tH2 = null, tH3 = null
      let hLoN = 0, hLoR = 0, hHiN = 0, hHiR = 0, vvHvN = 0, vvHvR = 0, vvLtN = 0, vvLtR = 0
      let tRvE = null, tRvC = null, tAbE = null, tSideE = 0, lastSigTxt = '-', lastSigT = null, lastSigMom = null
      let exBar = null, exPx = null, exWhy = '', utLastT = null
      const nearest = (d, e) => {
        let best = null
        if (d > 0) { for (const x of ithQ) if (x > e && (best === null || x < best)) best = x }
        else { for (const x of itlQ) if (x < e && (best === null || x > best)) best = x }
        return best
      }
      const convOf = (side, ab, cls) => {
        if (ab === null || cls === null || side === 0) return 0
        const withV = side > 0 ? ab === 1 : ab === 0
        return withV && cls === 2 ? 3 : (withV && cls === 1) || (!withV && cls === 2) ? 2 : 1
      }
      for (let i = 0; i < n; i++) {
        if (fin(ith[i])) { ithQ.push(ith[i]); if (ithQ.length > 30) ithQ.shift() }
        if (fin(itl[i])) { itlQ.push(itl[i]); if (itlQ.length > 30) itlQ.shift() }
        if (i < engN) {
          const ai = a[i]
          let exited = false, why = null
          if (pos !== 0) {
            // 1) exits vs the stop carried from the previous bar (gap-aware fill), then target, then opposite flip
            let px = null
            if (pos > 0 && l[i] <= stop) { px = Math.min(stop, o[i]); why = 'SL' }
            else if (pos < 0 && h[i] >= stop) { px = Math.max(stop, o[i]); why = 'SL' }
            else if (tgt !== null && pos > 0 && h[i] >= tgt) { px = Math.max(tgt, o[i]); why = 'TP' }
            else if (tgt !== null && pos < 0 && l[i] <= tgt) { px = Math.min(tgt, o[i]); why = 'TP' }
            else if (pos > 0 && sellF[i]) { px = c[i]; why = 'OPP' }
            else if (pos < 0 && buyF[i]) { px = c[i]; why = 'OPP' }
            if (px !== null) {
              const ret = (pos > 0 ? px / ent - 1 : (ent - px) / ent) - 2 * cost
              const rr = pos * (px - ent) / risk
              if (entT >= startT) {
                rets.push(ret); Rs.push(rr)
                if (firstTr === null) firstTr = entT
                if (tMomE !== null) { if (tMomE <= 50) { hLoN++; hLoR += rr } else if (tMomE >= 75) { hHiN++; hHiR += rr } }
                if (tRvC !== null) { if (tRvC === 2) { vvHvN++; vvHvR += rr } else if (tRvC === 0) { vvLtN++; vvLtR += rr } }
              }
              lastExit = why + ' ' + rr.toFixed(2) + 'R'
              V.exitMark[i] = true; V.exitPx[i] = px; V.anyExit[i] = true
              if (why === 'SL') V.slHit[i] = true
              if (why === 'TP') V.tpHit[i] = true
              exBar = i; exPx = px; exWhy = (why === 'SL' ? 'stop' : why === 'TP' ? 'target' : 'opposite flip') + ' · ' + lastExit
              pos = 0; exited = true; stop = null; tgt = null
            } else if (fin(ai)) {
              // 3) ratchet at the close, favourable direction only
              stop = pos > 0 ? Math.max(stop, c[i] - atrMult * ai) : Math.min(stop, c[i] + atrMult * ai)
            }
          }
          // 2) entry on a confirmed flip (same bar re-entry after an SL or opposite-flip exit)
          if (pos === 0 && fin(ai) && ai > 0 && (!exited || why === 'OPP' || why === 'SL')) {
            const lightOk = !skipLight || !hasVol[i] || rvCls[i] >= 1
            const okL = utOkL[i] && (!useFib || fibOkL(i)) && (!useZZ || osc[i] === 1) && (!useSMC || trend[i] === 1) && (volMode === 'off' || volL[i]) && lightOk
            const okS = utOkS[i] && (!useFib || fibOkS(i)) && (!useZZ || osc[i] === -1) && (!useSMC || trend[i] === -1) && (volMode === 'off' || volS[i]) && lightOk
            let d = allowLong && buyF[i] && okL ? 1 : (allowShort && sellF[i] && okS ? -1 : 0)
            if (d !== 0) {
              const e = c[i], s = e - d * atrMult * ai, rk = Math.abs(e - s)
              let tg = null
              if (tgtMode === '2r') tg = e + d * tgtR * rk
              else if (tgtMode === 'ith') { const nt = nearest(d, e); tg = nt === null ? e + d * tgtR * rk : nt }
              if (tg !== null && skip1R && Math.abs(tg - e) < rk - 1e-10) d = 0
              if (d !== 0) {
                pos = d; ent = e; stop = s; risk = rk; tgt = tg; entT = t[i]
                if (d > 0) V.entryBuy[i] = true; else V.entrySell[i] = true
                V.vTag[i] = volTag && hasVol[i] && (d > 0 ? volL[i] : volS[i])
                tEntBar = i; tMomE = d > 0 ? momL[i] : momS[i]
                tT1 = e + d * rk; tT2 = e + 2 * d * rk; tT3 = nearest(d, e); tH1 = tH2 = tH3 = null
                lastSigTxt = d > 0 ? 'BUY ' : 'SELL '; lastSigT = t[i]; lastSigMom = tMomE
                tRvE = rvX[i]; tRvC = hasVol[i] ? rvCls[i] : null; tAbE = fin(vwapV[i]) ? (c[i] > vwapV[i] ? 1 : 0) : null; tSideE = d
                V.momWeakEntry[i] = tMomE <= 50
                V.highConvEntry[i] = convOf(tSideE, tAbE, tRvC) === 3
              }
            }
          }
          if (btFirst === null && t[i] >= startT) btFirst = t[i]
          // display-only target hit times
          if (pos !== 0 && i > tEntBar) {
            if (tH1 === null && (pos > 0 ? h[i] >= tT1 : l[i] <= tT1)) tH1 = t[i]
            if (tH2 === null && (pos > 0 ? h[i] >= tT2 : l[i] <= tT2)) tH2 = t[i]
            if (tT3 !== null && tH3 === null && (pos > 0 ? h[i] >= tT3 : l[i] <= tT3)) tH3 = t[i]
          }
          // v3.4 UT labels (confirmed bars): against an open V4a trade = amber 'UT weak'
          if (V.utBuy[i] || V.utSell[i]) {
            utLastT = t[i]
            const against = (pos > 0 && V.utSell[i]) || (pos < 0 && V.utBuy[i])
            V.utMk[i] = against ? (V.utSell[i] ? -2 : 2) : (V.utSell[i] ? -1 : 1)
          }
        }
        V.stop[i] = showLevels && pos !== 0 ? stop : null
        V.tsCode[i] = pos > 0 ? (utPos[i] === 1 ? 1 : 2) : pos < 0 ? (utPos[i] === -1 ? 3 : 4) : bull[i] && utPos[i] === 1 ? 5 : !bull[i] && utPos[i] === -1 ? 6 : 7
        V.bgState[i] = pos > 0 ? 1 : pos < 0 ? -1 : (bgMode === 'legacy' && (dcSqz[i] || haChop[i])) ? 2 : bull[i] ? 1 : -1
        if (i > 0 && V.confirmed[i]) { V.bgChanged[i] = V.bgState[i] !== V.bgState[i - 1]; V.tsChanged[i] = V.tsCode[i] !== V.tsCode[i - 1] }
      }

      // ---------- stats (closed trades whose entry is inside the window; in-sample) ----------
      let eq = 1, peak = 1, mdd = 0, gw = 0, gl = 0, wins = 0
      for (const r of rets) {
        eq *= 1 + r; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1)
        if (r > 0) { gw += r; wins++ } else gl -= r
      }
      const st = {
        trades: rets.length, wins, winPct: rets.length ? 100 * wins / rets.length : 0,
        pf: gl > 0 ? gw / gl : (gw > 0 ? 99 : 0), totalPct: 100 * (eq - 1), maxDDPct: 100 * mdd,
        avgR: Rs.length ? Rs.reduce((x, y) => x + y, 0) / Rs.length : 0, sumR: Rs.reduce((x, y) => x + y, 0),
        from: btFirst, firstTr, to: lastT, openDir: pos, openEntry: ent, openStop: stop, openTarget: tgt, lastExit,
      }
      V.stats[n - 1] = st

      // ---------- formatting ----------
      const tick = Number(ctx && ctx.tickSize) || 0
      const dec = tick > 0 ? Math.max(0, Math.min(8, Math.ceil(-Math.log10(tick) - 1e-9))) : (Math.abs(c[n - 1]) >= 1000 ? 1 : 2)
      const fpx = (x) => (fin(x) ? x.toFixed(dec) : '-')
      const fsg = (x) => (fin(x) ? (x >= 0 ? '+' : '') + x.toFixed(2) : '-')
      const momLbl = (s) => (s === null || s === undefined ? '-' : s <= 50 ? 'WEAK' : s >= 100 ? 'FULL' : 'GOOD')
      const L = n - 1
      // chart interval (seconds) from the smallest recent bar spacing
      let barSec = 0
      {
        const ds = []
        for (let i = Math.max(1, n - 200); i < n; i++) { const d = t[i] - t[i - 1]; if (d > 0) ds.push(d) }
        ds.sort((x, y) => x - y)
        barSec = ds.length ? ds[0] : 0
      }
      const tfLbl = (sec) => (sec <= 0 ? '' : sec < 3600 ? Math.round(sec / 60) + 'm' : sec < 86400 ? Math.round(sec / 3600) + 'H' : sec < 604800 ? 'D' : sec < 2419200 ? 'W' : 'M')
      const tfSec = (k) => (k === 'D' ? 86400 : k === 'W' ? 604800 : Number(k) * 60)

      // MTF HA direction of the previous closed bucket, folded from the chart's own bars
      const am = /^(\d{1,2}):(\d{2})$/.exec(strSetting(S.mtfAnchor, '09:00').trim())
      const anchorSec = am ? Number(am[1]) * 3600 + Number(am[2]) * 60 : 9 * 3600
      const isDaily = barSec >= 86400 - 3600
      function mtfDir(k) {
        if (k === 'off') return { off: true }
        const sec = tfSec(k)
        // a daily chart's bars are already days: treat D as equal, intraday as lower
        if (!(sec > 0) || barSec <= 0 || (sec < barSec && !(isDaily && k === 'D'))) return { na: true, sec }
        let curKey = null, bo = 0, bh = 0, bl = 0, bc = 0, pHo = null, pHc = null, prevDir = null
        for (let i = 0; i < n; i++) {
          const loc = t[i] + zoneOff(t[i], tz), day = Math.floor(loc / 86400)
          let key
          if (k === 'D') key = day
          else if (k === 'W') key = Math.floor((day - 4) / 7)
          else key = day * 10000 + Math.floor((loc - day * 86400 - anchorSec) / sec)
          if (key !== curKey) {
            if (curKey !== null) {
              const hc = (bo + bh + bl + bc) / 4, ho = pHo === null ? (bo + bc) / 2 : (pHo + pHc) / 2
              prevDir = hc >= ho ? 1 : -1; pHo = ho; pHc = hc
            }
            curKey = key; bo = o[i]; bh = h[i]; bl = l[i]; bc = c[i]
          } else { bh = Math.max(bh, h[i]); bl = Math.min(bl, l[i]); bc = c[i] }
        }
        return { d: prevDir, sec }
      }

      // ---------- dashboard (one 12-column table like the Pine one, rebuilt from the last bar) ----------
      const sizeIn = strSetting(S.statSize, 'tiny')
      const cmp = sizeIn === 'phone'
      const sz = ({ tiny: 10, small: 11, normal: 12, phone: 11 })[sizeIn] || 10
      const szs = cmp ? 11 : sizeIn === 'normal' ? 11 : sz === 10 ? 9 : 10
      const szB = cmp ? 13 : sizeIn === 'normal' ? 16 : 13
      const rows = []
      let cur = null
      const nr = () => { cur = []; for (let j = 0; j < 12; j++) cur.push({ text: '' }); rows.push(cur) }
      const fc = (c0, c1, txt, bg, fg, fsz, al, bold) => {
        const cell = { text: String(txt), bgColor: bg, textColor: fg, fontSize: fsz, align: al || 'left' }
        if (c1 > c0) cell.colSpan = c1 - c0 + 1
        if (bold) cell.bold = true
        cur[c0] = cell
      }
      const sec = (txt) => { nr(); fc(0, 11, txt, TH.sec, TH.secTx, szs, 'left', true) }
      const kv = (k, val, vbg, vfg, fsz) => { nr(); fc(0, 5, k, TH.bg, TH.muted, fsz, 'left'); fc(6, 11, val, vbg, vfg, fsz, 'center') }
      const bc = bull[L]
      const dirN = pos !== 0 ? pos : bc ? 1 : -1
      const bCell = dirN > 0 ? TH.good : TH.bad, oCell = dirN > 0 ? TH.bad : TH.good
      const bTx = dirN > 0 ? TH.goodTx : TH.badTx
      const bChip = dirN > 0 ? '#bbf7d0' : '#fecaca', oChip = dirN > 0 ? '#fecaca' : '#bbf7d0'
      const dirW = dirN > 0 ? 'LONG' : 'SHORT'
      const tickRow = (nm, stt, isDir) => {
        const agBg = dirN > 0 ? TH.good : TH.bad, agTx = dirN > 0 ? '#bbf7d0' : '#fecaca'
        const opBg = isDir ? (dirN > 0 ? TH.bad : TH.good) : TH.neut, opTx = isDir ? (dirN > 0 ? '#fecaca' : '#bbf7d0') : TH.muted
        nr(); fc(0, 5, nm, TH.bg, TH.muted, sz, 'left')
        fc(6, 11, stt === 1 ? '✓' : stt === 0 ? '✗' : 'n/a', stt === 1 ? agBg : stt === 0 ? opBg : TH.neut, stt === 1 ? agTx : stt === 0 ? opTx : TH.muted, sz, 'center')
      }
      const sym = ctx && typeof ctx.symbol === 'string' ? ctx.symbol : ''
      const tsCode = V.tsCode[L], uP = utPos[L]
      if (boolSetting(S.showStatus, true)) {
        nr()
        fc(0, 7, 'SHN MATRIX v3.4' + (sym ? ' · ' + sym : '') + (barSec ? ' ' + tfLbl(barSec) : ''), TH.head, TH.text, sz, 'left', true)
        fc(8, 11, pos > 0 ? 'LONG OPEN' : pos < 0 ? 'SHORT OPEN' : 'FLAT', pos > 0 ? '#15803d' : pos < 0 ? '#b91c1c' : TH.neut, '#ffffff', sz, 'center', true)
        if (!cmp) { nr(); fc(0, 11, fmtT(t[L], tz) + ' · core: V4a HA flip (body ≥ ' + bodyMul + '×ATR)' + (lastOpen ? ' · bar forming' : ''), TH.head, TH.muted, szs, 'left') }
        // ---- v3.4 TRADE STATE and ACTION
        if (boolSetting(S.secState, true)) {
          const tsTx = tsCode === 1 ? 'STRONG LONG ▲' : tsCode === 2 ? 'LONG · WEAKENING' : tsCode === 3 ? 'STRONG SHORT ▼' : tsCode === 4 ? 'SHORT · WEAKENING'
            : tsCode === 5 ? 'BULLISH · WAIT FOR BUY' : tsCode === 6 ? (allowShort ? 'BEARISH · WAIT FOR SELL' : 'BEARISH · NO LONG') : 'WAIT · MIXED'
          const tsBg = tsCode === 1 ? '#16a34a' : tsCode === 3 ? '#dc2626' : tsCode === 2 || tsCode === 4 ? '#f59e0b' : tsCode === 5 ? '#86efac' : tsCode === 6 ? '#fca5a5' : '#9ca3af'
          const tsFg = tsCode === 1 || tsCode === 3 ? '#ffffff' : tsCode === 2 || tsCode === 4 ? '#1f1300' : tsCode === 5 ? '#052e16' : tsCode === 6 ? '#450a0a' : '#111827'
          sec('TRADE STATE')
          nr(); fc(0, 11, tsTx, tsBg, tsFg, szB, 'center', true)
          const v4Tx = pos > 0 ? 'LONG ▲ · open since ' + fmtT(entT, tz) : pos < 0 ? 'SHORT ▼ · open since ' + fmtT(entT, tz) : 'FLAT · HA ' + (bc ? 'bull ▲' : 'bear ▼')
          nr(); fc(0, 5, cmp ? 'V4a' : 'V4a (opens / closes)', TH.bg, TH.muted, szs, 'left')
          fc(6, 11, v4Tx, pos > 0 ? TH.good : pos < 0 ? TH.bad : TH.neut, '#ffffff', szs, 'center')
          const utTx = (uP === 1 ? 'LONG ▲' : uP === -1 ? 'SHORT ▼' : '–') + (utLastT === null ? '' : ' · UT ' + (uP === 1 ? 'buy ' : 'sell ') + fmtT(utLastT, tz))
          nr(); fc(0, 5, cmp ? 'UT Bot' : 'UT Bot (early warning)', TH.bg, TH.muted, szs, 'left')
          fc(6, 11, utTx, uP === 1 ? TH.good : uP === -1 ? TH.bad : TH.neut, '#ffffff', szs, 'center')
          const exitNow = pos === 0 && exBar !== null && L - exBar <= 1
          const actTx = exitNow ? 'EXIT HIT · ' + exWhy + ' at ' + fpx(exPx)
            : tsCode === 1 || tsCode === 3 ? 'HOLD · trail stop ' + fpx(stop)
              : tsCode === 2 ? 'HOLD · no adds · exit only if price < ' + fpx(stop) + ' (V4a stop)'
                : tsCode === 4 ? 'HOLD · no adds · exit only if price > ' + fpx(stop) + ' (V4a stop)'
                  : tsCode === 5 ? (allowLong ? 'WAIT · next BUY needs a V4a flip' : 'WAIT · longs disabled')
                    : tsCode === 6 ? (allowShort ? 'WAIT · next SELL needs a V4a flip' : 'STAND ASIDE · no long') : 'WAIT · mixed, no new trade'
          const actBg = exitNow ? TH.warn : tsCode === 1 ? TH.good : tsCode === 3 ? TH.bad : tsCode === 2 || tsCode === 4 ? '#78350f' : TH.neut
          const actFg = tsCode === 2 || tsCode === 4 ? '#fde68a' : '#ffffff'
          nr(); fc(0, 11, 'ACTION: ' + actTx, actBg, actFg, sz, 'left', true)
          if (!cmp) { nr(); fc(0, 11, 'UT against an open V4a trade = weakening, not an exit. V4a stop / opposite flip still decide the exit.', TH.bg, TH.muted, szs, 'left') }
        }
        // ---- bias and strength
        if (boolSetting(S.secBias, true)) {
          sec('BIAS & STRENGTH')
          const bs = V.bgState[L]
          const bgWhy = (pos > 0 ? 'open long' : pos < 0 ? 'open short' : bc ? 'HA bull' : 'HA bear') + (pos === 0 && (dcSqz[L] || haChop[L]) ? ' · ⚠ ' + (dcSqz[L] ? 'squeeze' : 'chop') : '')
          kv('Background', (bs === 1 ? 'GREEN' : bs === -1 ? 'RED' : 'YELLOW') + ' · ' + bgWhy, bs === 1 ? TH.good : bs === -1 ? TH.bad : TH.warn, TH.text, sz)
          const bodyA = fin(a[L]) && a[L] > 0 ? haBody[L] / a[L] : 0
          const slp = fin(a[L]) && a[L] > 0 && L >= 5 && fin(dmid[L]) && fin(dmid[L - 5]) ? dirN * (dmid[L] - dmid[L - 5]) / a[L] : 0
          const adxL = fin(adx[L]) ? adx[L] : 0
          const strV = 100 * (0.4 * Math.min(bodyA, 1) + 0.4 * Math.min(adxL / 40, 1) + 0.2 * Math.min(Math.max(slp, 0), 1))
          const stc = strV >= 65 ? bTx : strV >= 35 ? alpha(bTx, 0.65) : TH.muted
          kv('Trend strength', (strV >= 65 ? 'STRONG ' : strV >= 35 ? 'MEDIUM ' : 'WEAK ') + strV.toFixed(0) + (dirN > 0 ? ' ▲' : ' ▼'), TH.bg, stc, sz)
          nr(); for (let j = 0; j < 12; j++) cur[j] = { text: ' ', bgColor: strV >= (j + 1) * 100 / 12 - 100 / 24 ? stc : TH.neut, fontSize: szs }
          if (!cmp) { nr(); fc(0, 11, 'HA body ' + bodyA.toFixed(2) + '×ATR · ADX ' + adxL.toFixed(0) + ' · DC-mid slope ' + fsg(slp), TH.bg, TH.muted, szs, 'left') }
        }
        // ---- confirms (ticks only, never used by the engine unless the filter inputs are on)
        if (boolSetting(S.secConf, true)) {
          sec('CONFIRMS · vs ' + dirW)
          tickRow('Fib pull-back', (dirN > 0 ? fibOkL(L) : fibOkS(L)) ? 1 : 0, true)
          tickRow('Volume ≥ ' + volLen + '-bar avg', !hasVol[L] ? -1 : vSimple[L] ? 1 : 0, false)
          tickRow('Zig-zag agrees', osc[L] === dirN ? 1 : 0, true)
          tickRow('SMC trend', trend[L] === dirN ? 1 : 0, true)
        }
        // ---- VWAP and volume (info only)
        if (boolSetting(S.secVV, true)) {
          sec(cmp ? 'VWAP & VOLUME' : 'VWAP & VOLUME · info only')
          if (!hasVol[L]) { nr(); fc(0, 11, 'No volume on this symbol', TH.bg, TH.muted, sz, 'left') }
          else {
            const vw = vwapV[L], above = fin(vw) && c[L] > vw
            const vwD = fin(a[L]) && a[L] > 0 && fin(vw) ? (c[L] - vw) / a[L] : null
            kv('Session VWAP', !fin(vw) ? '-' : (above ? 'ABOVE ▲ ' : 'BELOW ▼ ') + (above === (dirN > 0) ? '✓' : '✗') + ' · ' + fsg(vwD) + ' ATR',
              !fin(vw) ? TH.neut : above === (dirN > 0) ? bCell : oCell, '#ffffff', sz)
            const clsTx = rvCls[L] === 2 ? 'HEAVY ' : rvCls[L] === 1 ? 'NORMAL ' : 'LIGHT '
            kv('Bar volume', (isClx[L] ? 'CLIMAX ' : clsTx) + rvX[L].toFixed(1) + '× · ' + (bc ? 'bull' : 'bear') + (isAbs[L] ? ' · ABSORB' : ''),
              isClx[L] ? alpha(bc ? C.clxBull : C.clxBear, 0.6) : isAbs[L] ? alpha(C.abs, 0.3) : rvCls[L] === 0 ? TH.neut : TH.bg, TH.text, sz)
            const shC = shadeCol(L)
            nr(); for (let j = 0; j < 12; j++) cur[j] = { text: ' ', bgColor: Math.min(rvX[L], 2.4) >= (j + 1) * 0.2 ? shC : TH.neut, fontSize: szs }
            if (tSideE !== 0) {
              const convE = convOf(tSideE, tAbE, tRvC)
              const eCls = tRvC === null ? '-' : tRvC === 2 ? 'HEAVY ' : tRvC === 1 ? 'NORMAL ' : 'LIGHT '
              kv(pos !== 0 ? 'Entry: VWAP · volume' : 'Last ' + (tSideE > 0 ? 'BUY' : 'SELL') + ': VWAP · vol',
                (tAbE === null ? '-' : tAbE === 1 ? 'above' : 'below') + ' · ' + eCls + (fin(tRvE) ? tRvE.toFixed(1) : '-') + '×', TH.bg,
                convE >= 2 ? (tSideE > 0 ? TH.goodTx : TH.badTx) : TH.warnTx, sz)
              kv(pos !== 0 ? 'Conviction tag' : 'Conviction (last signal)', convE === 3 ? 'HIGH' : convE === 2 ? 'MEDIUM' : convE === 1 ? 'LOW' : '-',
                convE === 3 ? (tSideE > 0 ? TH.good : TH.bad) : convE === 2 ? (tSideE > 0 ? '#1f5135' : '#4c1d1d') : convE === 1 ? TH.warn : TH.neut, '#ffffff', sz)
            }
            if (!cmp) {
              nr(); fc(0, 11, 'History (closed trades) · heavy ≥' + shHeavy + '×: n' + vvHvN + ' avg ' + (vvHvN > 0 ? fsg(vvHvR / vvHvN) : '-') + 'R · light <' + shNorm + '×: n' + vvLtN + ' avg ' + (vvLtN > 0 ? fsg(vvLtR / vvLtN) : '-') + 'R', TH.bg, TH.muted, szs, 'left')
            }
          }
        }
        // ---- position and risk
        if (boolSetting(S.secPos, true)) {
          sec('POSITION & RISK')
          if (pos !== 0) {
            const openR = risk > 0 ? pos * (c[L] - ent) / risk : null, lockR = risk > 0 ? pos * (stop - ent) / risk : null
            nr(); fc(0, 3, 'Entry', TH.bg, TH.muted, szs, 'center'); fc(4, 7, 'Stop (trail)', TH.bg, TH.muted, szs, 'center'); fc(8, 11, 'Risk', TH.bg, TH.muted, szs, 'center')
            nr(); fc(0, 3, fpx(ent), TH.bg, TH.text, sz, 'center'); fc(4, 7, fpx(stop), TH.bg, '#ff4081', sz, 'center'); fc(8, 11, fpx(risk) + ' pts', TH.bg, TH.text, sz, 'center')
            nr(); fc(0, 3, 'Open', TH.bg, TH.muted, szs, 'center'); fc(4, 7, 'Locked', TH.bg, TH.muted, szs, 'center'); fc(8, 11, 'In trade', TH.bg, TH.muted, szs, 'center')
            nr(); fc(0, 3, fsg(openR) + ' R', TH.bg, openR >= 0 ? TH.goodTx : TH.badTx, sz, 'center'); fc(4, 7, fsg(lockR) + ' R', TH.bg, lockR >= 0 ? TH.goodTx : TH.badTx, sz, 'center')
            fc(8, 11, (L - tEntBar) + ' bars', TH.bg, TH.text, sz, 'center')
            const pv = numSetting(S.pointVal, 0, 0, 1e6)
            if (pv > 0) {
              const rs = (x) => Math.round(x).toLocaleString('en-IN')
              nr(); fc(0, 11, 'Per lot: risk Rs ' + rs(risk * pv) + ' · locked Rs ' + rs(pos * (stop - ent) * pv) + ' · open Rs ' + rs(pos * (c[L] - ent) * pv), TH.bg, TH.muted, szs, 'left')
            }
          } else { nr(); fc(0, 11, 'Flat · waiting for a V4a flip' + (allowShort ? '' : ' (longs only)'), TH.bg, TH.muted, sz, 'left') }
        }
        // ---- targets (display only; the real exit target is the section 5 'Target' input)
        if (boolSetting(S.secTgt, true) && pos !== 0) {
          const tgtCol = colSetting(S.tgtCol, '#2dd4bf')
          sec(cmp ? 'TARGETS' : 'TARGETS · display · ⅓ T1 · ⅓ T2 · runner on trail')
          for (let k = 1; k <= 3; k++) {
            const px = k === 1 ? tT1 : k === 2 ? tT2 : tT3, hb = k === 1 ? tH1 : k === 2 ? tH2 : tH3
            const nm = k === 1 ? 'T1 1R' : k === 2 ? 'T2 2R' : (pos > 0 ? 'T3 ITH' : 'T3 ITL')
            nr(); fc(0, 2, nm, TH.bg, tgtCol, sz, 'left'); fc(3, 6, px === null ? '—' : fpx(px), TH.bg, px === null ? TH.muted : TH.text, sz, 'center')
            fc(7, 11, px === null ? 'trail only' : hb === null ? 'pending' : 'HIT ' + fmtT(hb, tz), px === null ? TH.neut : hb === null ? TH.warn : TH.good, px === null ? TH.muted : TH.text, szs, 'center')
          }
        }
        // ---- system stats (same counters and window as the engine; in-sample)
        if (boolSetting(S.secStats, true)) {
          sec('SYSTEM STATS · closed trades' + (firstTr === null ? '' : ' since ' + fmtMY(firstTr, tz)) + ' · in-sample')
          nr(); fc(0, 2, 'Trades', TH.bg, TH.muted, szs, 'center'); fc(3, 5, 'Win %', TH.bg, TH.muted, szs, 'center'); fc(6, 8, 'PF', TH.bg, TH.muted, szs, 'center'); fc(9, 11, 'Avg R', TH.bg, TH.muted, szs, 'center')
          nr(); fc(0, 2, String(st.trades), TH.bg, TH.text, sz, 'center'); fc(3, 5, st.trades ? st.winPct.toFixed(0) + '%' : '-', TH.bg, TH.text, sz, 'center')
          fc(6, 8, st.trades ? st.pf.toFixed(2) : '-', TH.bg, st.pf >= 1.5 ? TH.goodTx : st.pf >= 1 ? TH.warnTx : TH.badTx, sz, 'center')
          fc(9, 11, st.trades ? fsg(st.avgR) : '-', TH.bg, st.sumR >= 0 ? TH.goodTx : TH.badTx, sz, 'center')
          if (!cmp) {
            nr(); fc(0, 11, 'Total ' + st.totalPct.toFixed(1) + '% · max DD ' + st.maxDDPct.toFixed(1) + '% · last exit ' + lastExit + ' · ' + (allowShort ? 'long + short' : 'long only') + ' · ATR×' + atrMult + ' · not a guarantee', TH.bg, TH.muted, szs, 'left')
          }
        }
        // ---- momentum (display only)
        if (boolSetting(S.secMom, true)) {
          const mNow = dirN > 0 ? momL[L] : momS[L]
          const eUp = L > 0 && fin(mEma[L - 1]) && mEma[L] > mEma[L - 1], eDn = L > 0 && fin(mEma[L - 1]) && mEma[L] < mEma[L - 1]
          const hUp = L > 0 && fin(mHist[L]) && fin(mHist[L - 1]) && mHist[L] > mHist[L - 1], hDn = L > 0 && fin(mHist[L]) && fin(mHist[L - 1]) && mHist[L] < mHist[L - 1]
          const hPos = fin(mHist[L]) && mHist[L] > 0, hNeg = fin(mHist[L]) && mHist[L] < 0
          const c1 = dirN > 0 ? eUp : eDn, c2 = dirN > 0 ? hUp : hDn, c3 = dirN > 0 ? hPos : hNeg
          sec(cmp ? 'MOMENTUM · info only' : 'MOMENTUM · info only, V4a still opens / closes')
          kv('Momentum score', mNow + ' · ' + momLbl(mNow) + ' for ' + dirW, mNow <= 50 ? TH.warn : bCell, '#ffffff', sz)
          nr()
          fc(0, 2, 'EMA' + momEma + (eUp ? ' ▲' : ' ▼'), c1 ? bCell : oCell, c1 ? bChip : oChip, szs, 'center')
          fc(3, 5, 'MACD-h' + (hUp ? ' ▲' : ' ▼'), c2 ? bCell : oCell, c2 ? bChip : oChip, szs, 'center')
          fc(6, 8, hPos ? 'MACD-h > 0' : 'MACD-h < 0', c3 ? bCell : oCell, c3 ? bChip : oChip, szs, 'center')
          fc(9, 11, sqzRecent[L] ? 'sqz just fired' : 'no fresh sqz', sqzRecent[L] ? TH.warn : bCell, sqzRecent[L] ? TH.text : bChip, szs, 'center')
          const el = elder[L]
          kv('Elder impulse', (el === 1 ? 'GREEN' : el === -1 ? 'RED' : 'BLUE') + (el === 0 ? ' · neutral' : el === dirN ? ' ✓' : ' ✗'), el === 0 ? '#1e3a8a' : el === dirN ? bCell : oCell, TH.text, sz)
          kv('Squeeze (BB in KC)', sqzOn[L] ? 'ON' : sinceFire[L] === null ? 'OFF' : 'OFF · fired ' + sinceFire[L] + ' bars ago', sqzOn[L] || sqzRecent[L] ? TH.warn : TH.bg, TH.text, sz)
          kv('At entry', pos !== 0 ? tMomE + ' · ' + momLbl(tMomE) + ' · ' + fmtT(entT, tz) : lastSigMom === null ? '-' : 'last ' + lastSigMom + ' · ' + momLbl(lastSigMom), TH.bg,
            pos !== 0 ? (tMomE <= 50 ? TH.warnTx : (pos > 0 ? TH.goodTx : TH.badTx)) : TH.text, sz)
          if (!cmp) { nr(); fc(0, 11, 'History (closed trades) · ≤50: n' + hLoN + ' avg ' + (hLoN > 0 ? fsg(hLoR / hLoN) : '-') + 'R · ≥75: n' + hHiN + ' avg ' + (hHiN > 0 ? fsg(hHiR / hHiN) : '-') + 'R', TH.bg, TH.muted, szs, 'left') }
          nr(); fc(0, 11, 'Use on 2H: ≤50 at a BUY → half size or skip. Daily: ignore.', TH.warn, TH.text, szs, 'left')
        }
        // ---- context
        if (boolSetting(S.secCtx, true)) {
          sec('CONTEXT · times ' + tz)
          if (boolSetting(S.showMTF, true)) {
            nr()
            const defs = ['15', '120', '240', 'D']
            ;['mtf1', 'mtf2', 'mtf3', 'mtf4'].forEach((key, j) => {
              const r = mtfDir(strSetting(S[key], defs[j]))
              const lb = r.off ? '' : tfLbl(r.sec)
              const d = r.d === undefined ? null : r.d
              const txt = r.off ? 'off' : r.na ? lb + ' n/a' : lb + (d === null ? ' –' : (d === 1 ? ' ▲' : ' ▼') + (d === dirN ? '✓' : '✗'))
              fc(j * 3, j * 3 + 2, txt, d === null ? TH.neut : d === 1 ? TH.good : TH.bad, d === null ? TH.muted : TH.text, szs, 'center')
            })
          }
          const nowRaw = ctx && typeof ctx.now === 'function' ? Number(ctx.now()) : NaN
          const now = Number.isFinite(nowRaw) && nowRaw > 0 ? nowRaw : Math.floor(Date.now() / 1000)
          const usDst = zoneOff(now, 'America/New_York') === -4 * 3600
          if (boolSetting(S.showSess, true)) {
            const ist = now + 19800, istDay = Math.floor(ist / 86400), istMin = Math.floor((ist - istDay * 86400) / 60)
            const dw = (istDay + 4) % 7 // 0 = Sunday
            const open = dw >= 1 && dw <= 5 && istMin >= 540 && istMin < (usDst ? 1410 : 1435)
            kv('MCX session', (open ? 'OPEN' : 'CLOSED') + ' · close ' + (usDst ? '23:30' : '23:55') + ' IST', TH.bg, open ? TH.text : TH.muted, sz)
          }
          const eia = strSetting(S.eiaMode, 'auto')
          const isNG = /NATURALGAS|NATGAS/i.test(sym)
          const nextEvt = (dow) => {
            for (let k = 0; k <= 7; k++) {
              const tk = now + k * 86400, off = zoneOff(tk, 'America/New_York'), day = Math.floor((tk + off) / 86400)
              if ((day + 4) % 7 !== dow) continue
              const ts = day * 86400 + 10 * 3600 + 30 * 60 - off
              if (ts > now) return ts
            }
            return null
          }
          if (eia === 'crude' || eia === 'both' || (eia === 'auto' && !isNG)) {
            const tC = nextEvt(3); kv('EIA crude', tC === null ? '-' : fmtTD(tC, tz), tC !== null && tC - now < 86400 ? TH.warn : TH.bg, TH.text, sz)
          }
          if (eia === 'gas' || eia === 'both' || (eia === 'auto' && isNG)) {
            const tG = nextEvt(4); kv('EIA nat gas', tG === null ? '-' : fmtTD(tG, tz), tG !== null && tG - now < 86400 ? TH.warn : TH.bg, TH.text, sz)
          }
          kv('Last signal', lastSigT === null ? '-' : lastSigTxt + fmtTD(lastSigT, tz), TH.bg, TH.text, sz)
        }
        // ---- DFSM extras (optional)
        if (boolSetting(S.secDfsm, false) && !cmp) {
          sec('DFSM')
          const p618 = fin(vH[L]) ? vH[L] - 0.618 * (vH[L] - vL[L]) : null
          kv('Golden zone 0.618', fpx(p618) + (fibOkL(L) ? ' · LONG ZONE' : ''), TH.bg, '#ffd600', sz)
          kv('Donchian ' + dcUpLen + '/' + dcLoLen, !showDC ? 'OFF' : dcDir[L] === 1 ? 'LAST BREAK UP' : dcDir[L] === -1 ? 'LAST BREAK DOWN' : 'NO BREAK', TH.bg, dcDir[L] === 1 ? TH.goodTx : dcDir[L] === -1 ? TH.badTx : TH.text, sz)
          kv('Market flow (wave)', V.waveUp[L] ? 'BULLISH' : 'BEARISH', TH.bg, V.waveUp[L] ? '#00e676' : '#ff1744', sz)
          kv('Structure (last break)', lastStruct, TH.bg, TH.text, sz)
          kv('ATR 14', fpx(a14[L]), TH.bg, TH.text, sz)
        }
        V.dashRows[L] = rows
      }

      // ---------- drawings (last bar): target + T lines, deep Fib, S/R zones, projection, LRL ----------
      {
        const out = []
        const step = barSec > 0 ? barSec : (n > 1 ? t[n - 1] - t[n - 2] : 60)
        const fx = (k) => t[L] + k * step
        const lbl = (time, price, text, color, textColor) => ({ kind: 'label', at: { time, price }, text, color, textColor, align: 'left', fontSize: 10 })
        const tgtCol = colSetting(S.tgtCol, '#2dd4bf')
        if (showLevels && pos !== 0 && tEntBar !== null) {
          const t0 = t[tEntBar]
          if (fin(tgt)) {
            out.push({ kind: 'line', from: { time: t0, price: tgt }, to: { time: fx(3), price: tgt }, color: tgtCol, lineWidth: 2 })
            out.push(lbl(fx(3), tgt, 'TARGET ' + fpx(tgt), tgtCol, '#000000'))
          }
          if (boolSetting(S.showTgtLv, true)) {
            for (const [px, nm] of [[tT1, 'T1 1R'], [tT2, 'T2 2R'], [tT3, pos > 0 ? 'T3 ITH' : 'T3 ITL']]) {
              if (!fin(px)) continue
              out.push({ kind: 'line', from: { time: t0, price: px }, to: { time: fx(3), price: px }, color: alpha(tgtCol, 0.7), lineWidth: 1, lineStyle: 'dashed' })
              out.push(lbl(fx(3), px, nm + ' ' + fpx(px), 'rgba(0,0,0,0)', tgtCol))
            }
          }
        }
        if (boolSetting(S.showFibVis, true) && fin(vH[L])) {
          const d = vH[L] - vL[L], x1 = t[Math.max(0, L - 25)]
          const lv = [[0.5, '0.50 EQ', alpha('#ffffff', 0.7), 1, 'rgba(0,0,0,0)', '#ffffff'], [0.618, '0.618 Golden Zone', '#ffd600', 2, '#ffd600', '#000000'], [0.786, '0.786 Deep Discount', '#00e5ff', 2, 'rgba(0,0,0,0)', '#00e5ff']]
          for (const [f, nm, col, w, plate, tc] of lv) {
            const p = vH[L] - f * d
            out.push({ kind: 'line', from: { time: x1, price: p }, to: { time: fx(15), price: p }, color: col, lineWidth: w })
            out.push(lbl(fx(15), p, nm, plate, tc))
          }
        }
        if (boolSetting(S.showBoxes, true)) {
          const srLen = Math.floor(numSetting(S.srLen, 20, 5, 200))
          const sh = pivotArr(h, srLen, true), sl = pivotArr(l, srLen, false)
          let ri = -1, si = -1
          for (let i = 0; i < n; i++) { if (fin(sh[i])) ri = i; if (fin(sl[i])) si = i }
          const zone = (idx, p, col, txt) => {
            const pd = a14[idx] * 0.35
            out.push({ kind: 'box', from: { time: t[idx - srLen], price: p + pd }, to: { time: fx(20), price: p - pd }, color: col, fillColor: col, opacity: 0.2, text: txt, textColor: '#ffffff', align: 'right', fontSize: 10 })
          }
          if (ri >= 0 && fin(a14[ri])) zone(ri, sh[ri], '#ff1744', 'RESISTANCE ZONE')
          if (si >= 0 && fin(a14[si])) zone(si, sl[si], '#00e676', 'SUPPORT ZONE')
        }
        const wUp = V.waveUp[L], wCol = wUp ? '#00e676' : '#ff1744'
        if (boolSetting(S.showArrow, true) && fin(a14[L])) {
          const dist = Math.floor(numSetting(S.arrowDist, 12, 5, 100))
          const pe = wUp ? c[L] + a14[L] * 1.5 : c[L] - a14[L] * 1.5
          out.push({ kind: 'line', from: { time: t[L], price: c[L] }, to: { time: fx(dist), price: pe }, color: wCol, lineWidth: 3 })
          out.push(lbl(fx(dist), pe, (wUp ? '▲ PROJECTION HIGH ' : '▼ PROJECTION LOW ') + fpx(pe), 'rgba(0,0,0,0)', wCol))
        }
        if (boolSetting(S.showLRL, true)) {
          const lrlLen = Math.floor(numSetting(S.lrlLen, 25, 10, 500))
          const lh = highestArr(h, lrlLen), ll = lowestArr(l, lrlLen)
          const lp = wUp ? lh[L] : ll[L]
          if (fin(lp)) {
            out.push({ kind: 'line', from: { time: t[Math.max(0, L - lrlLen)], price: lp }, to: { time: fx(20), price: lp }, color: '#ffea00', lineWidth: 2, lineStyle: 'dashed' })
            out.push(lbl(fx(20), lp, 'LOW RESISTANCE LIQUIDITY', '#ffea00', '#000000'))
          }
        }
        V.drawList[L] = out
      }

      if (!showSMC) for (let i = 0; i < n; i++) { V.bosUp[i] = V.bosDn[i] = V.chochUp[i] = V.chochDn[i] = false }
      // Display bookkeeping only (does not change entries, stops or tsCode). Bars since the last V4a HA flip.
      {
        let lastFlip = -1
        V.flipAge = new Array(n).fill(null)
        V.flipTime = new Array(n).fill(null)
        for (let i = 1; i < n; i++) {
          if (buyF[i] || sellF[i]) lastFlip = i
          if (lastFlip >= 0) { V.flipAge[i] = i - lastFlip; V.flipTime[i] = t[lastFlip] }
        }
        V.entryAge = pos !== 0 && tEntBar !== null ? (L - tEntBar) : null
        V.flipBuy = buyF
        V.flipSell = sellF
        V.momLong = momL
        V.momShort = momS
      }
      return V
    },

    markers({ bars, values, settings }) {
      const pad = markerPad(bars)
      const res = []
      const v = values
      const showTrades = boolSetting(settings?.showTrades, true)
      const showUTSig = boolSetting(settings?.showUTSig, true)
      const cAbs = colSetting(settings?.cAbs, '#00e5ff')
      for (let i = 0; i < bars.length; i++) {
        const bar = bars[i]
        if (showTrades && v.entryBuy?.[i]) res.push({ time: bar.time, position: 'atPrice', price: bar.low - pad, shape: 'labelUp', size: 'small', color: '#16a34a', text: 'BUY', textColor: v.vTag?.[i] ? '#fde047' : '#ffffff' })
        if (showTrades && v.entrySell?.[i]) res.push({ time: bar.time, position: 'atPrice', price: bar.high + pad, shape: 'labelDown', size: 'small', color: '#dc2626', text: 'SELL', textColor: v.vTag?.[i] ? '#fde047' : '#ffffff' })
        if (showTrades && v.exitMark?.[i]) res.push({ time: bar.time, position: 'atPrice', price: v.exitPx[i], shape: 'xcross', size: 'small', color: v.tpHit?.[i] ? '#2dd4bf' : '#fb923c' })
        if (v.absDot?.[i]) res.push({ time: bar.time, position: 'atPrice', price: bar.high + pad * 0.5, shape: 'circle', size: 'tiny', color: cAbs })
        const u = v.utMk?.[i]
        if (showUTSig && u) {
          const at = Number.isFinite(v.atr14?.[i]) ? v.atr14[i] : pad
          if (u === 2 || u === -2) res.push({ time: bar.time, position: 'atPrice', price: u === -2 ? bar.high + at : bar.low - at, shape: u === -2 ? 'labelDown' : 'labelUp', size: 'tiny', color: '#f59e0b', text: 'UT weak', textColor: '#1f1300' })
          else if (u === -1) res.push({ time: bar.time, position: 'atPrice', price: bar.high + at, shape: 'labelDown', size: 'tiny', color: '#f44336', text: 'UT Sell', textColor: '#ffffff' })
          else res.push({ time: bar.time, position: 'atPrice', price: bar.low - at, shape: 'labelUp', size: 'tiny', color: '#4caf50', text: 'UT Buy', textColor: '#ffffff' })
        }
        const sx = v.smcX?.[i]
        if (sx !== null && sx !== undefined && bars[sx]) {
          if (v.bosUp?.[i]) res.push({ time: bars[sx].time, position: 'atPrice', price: v.smcPrice[i], shape: 'text', size: 'tiny', color: '#00e676', text: 'BOS' })
          if (v.chochUp?.[i]) res.push({ time: bars[sx].time, position: 'atPrice', price: v.smcPrice[i], shape: 'text', size: 'tiny', color: '#00e676', text: 'CHoCH' })
          if (v.bosDn?.[i]) res.push({ time: bars[sx].time, position: 'atPrice', price: v.smcPrice[i], shape: 'text', size: 'tiny', color: '#ff1744', text: 'BOS' })
          if (v.chochDn?.[i]) res.push({ time: bars[sx].time, position: 'atPrice', price: v.smcPrice[i], shape: 'text', size: 'tiny', color: '#ff1744', text: 'CHoCH' })
        }
        if (v.ithMark?.[i] !== null && v.ithMark?.[i] !== undefined) res.push({ time: bar.time, position: 'atPrice', price: v.ithMark[i] + pad, shape: 'labelDown', size: 'tiny', color: '#ff1744', text: 'ITH', textColor: '#ffffff' })
        if (v.itlMark?.[i] !== null && v.itlMark?.[i] !== undefined) res.push({ time: bar.time, position: 'atPrice', price: v.itlMark[i] - pad, shape: 'labelUp', size: 'tiny', color: '#00e676', text: 'ITL', textColor: '#000000' })
      }
      // lightweight-charts requires markers sorted by time
      res.sort((x, y) => (x.time > y.time ? 1 : x.time < y.time ? -1 : 0))
      return res
    },

    draws({ bars, values }) {
      const n = bars.length
      const d = n ? values.drawList?.[n - 1] : null
      return Array.isArray(d) ? d : []
    },

    background({ bars, values, settings }) {
      const n = bars.length
      if (!boolSetting(settings?.showBg, true)) return new Array(n).fill(null)
      const k = 1 - numSetting(settings?.bgTransp, 92, 50, 100) / 100
      const g = alpha(colSetting(settings?.bgGreen, '#22c55e'), k), r = alpha(colSetting(settings?.bgRed, '#ef4444'), k), y = alpha(colSetting(settings?.bgYellow, '#eab308'), k)
      const s = values.bgState || []
      const out = new Array(n)
      for (let i = 0; i < n; i++) out[i] = s[i] === 1 ? g : s[i] === -1 ? r : s[i] === 2 ? y : null
      return out
    },

    barColors({ bars, settings }) {
      return new Array(bars.length).fill(boolSetting(settings?.hideMain, false) ? 'rgba(0,0,0,0)' : null)
    },

    table({ bars, values, settings }) {
      const n = bars.length
      if (!n || !boolSetting(settings?.showStatus, true)) return null
      const rows = values.dashRows?.[n - 1]
      if (!Array.isArray(rows) || rows.length === 0) return null
      const sizeIn = strSetting(settings?.statSize, 'tiny')
      return {
        rows,
        options: { position: strSetting(settings?.statPos, 'top-right'), cellWidth: 'auto', cellHeight: sizeIn === 'normal' ? 20 : 17,
          fontSize: sizeIn === 'normal' ? 12 : sizeIn === 'small' || sizeIn === 'phone' ? 11 : 10, borderColor: TH.border, borderWidth: 1, background: TH.bg },
      }
    },

    alerts: [
      ['shn-buy', 'SHN BUY', (v, i) => v.entryBuy?.[i]],
      ['shn-sell', 'SHN SELL', (v, i) => v.entrySell?.[i]],
      ['shn-buy-v', 'SHN BUY volume-confirmed', (v, i) => v.entryBuy?.[i] && v.vTag?.[i]],
      ['shn-sl', 'SHN stop hit', (v, i) => v.slHit?.[i]],
      ['shn-exit', 'SHN any exit', (v, i) => v.anyExit?.[i]],
      ['shn-mom-weak', 'SHN entry momentum weak', (v, i) => v.momWeakEntry?.[i]],
      ['shn-high-conv', 'SHN entry HIGH conviction', (v, i) => v.highConvEntry?.[i]],
      ['shn-bg', 'Background colour changed', (v, i) => v.bgChanged?.[i]],
      ['shn-ts', 'Trade state changed', (v, i) => v.tsChanged?.[i]],
      ['ut-buy', 'UT Bot buy', (v, i) => v.utBuy?.[i] && v.confirmed?.[i]],
      ['ut-sell', 'UT Bot sell', (v, i) => v.utSell?.[i] && v.confirmed?.[i]],
      ['smc-bull', 'Bullish structure (BOS or CHoCH)', (v, i) => v.bosUp?.[i] || v.chochUp?.[i]],
      ['smc-bear', 'Bearish structure (BOS or CHoCH)', (v, i) => v.bosDn?.[i] || v.chochDn?.[i]],
      ['dc-up', 'Donchian breakout up', (v, i) => v.dcBoUp?.[i]],
      ['dc-dn', 'Donchian breakdown', (v, i) => v.dcBoDn?.[i]],
      ['zz-up', 'Zig-zag turns up', (v, i) => v.zzFlipUp?.[i]],
      ['zz-dn', 'Zig-zag turns down', (v, i) => v.zzFlipDn?.[i]],
      ['wave-up', 'Wave turns up', (v, i) => v.waveFlipUp?.[i]],
      ['wave-dn', 'Wave turns down', (v, i) => v.waveFlipDn?.[i]],
      ['fib-618', 'Price crosses 0.618', (v, i) => v.goldenX?.[i]],
      ['clx-abs', 'Climax or absorption candle', (v, i) => v.confirmed?.[i] && (v.clxBar?.[i] || v.absDot?.[i])],
    ].map(([id, title, f]) => ({
      id, title, message: 'SHN Matrix v3.4: ' + title,
      when: ({ values, settings, index }) => boolSetting(settings?.alertsOn, true) && !!f(values, index),
    })),
  })
}


  let _ind = null
  function indicator() {
    if (_ind) return _ind
    shnMatrixV34Factory({ registerIndicator(def) { _ind = def } })
    if (!_ind || typeof _ind.calc !== 'function') throw new Error('SHN Matrix v3.4 did not register')
    return _ind
  }

  // Same strings as the v3.4 dashboard (tsTx / actTx). The snapshot reads ACTION from the engine table
  // and checks it against this map in tests.
  function stateLabel(code, allowShort) {
    return code === 1 ? 'STRONG LONG ▲' : code === 2 ? 'LONG · WEAKENING' : code === 3 ? 'STRONG SHORT ▼' : code === 4 ? 'SHORT · WEAKENING'
      : code === 5 ? 'BULLISH · WAIT FOR BUY' : code === 6 ? (allowShort ? 'BEARISH · WAIT FOR SELL' : 'BEARISH · NO LONG') : 'WAIT · MIXED'
  }

  const QUIET = {
    showHA: false, showZZ: false, showZZBand: false, showDC: false, showFibVis: false, showBoxes: false,
    showArrow: false, showLRL: false, showSMC: false, showITH: false, showWave: false, showVwap: false,
    showClx: false, showAbs: false, showBg: false, showMTF: false, alertsOn: false, showTrades: false,
    secBias: false, secConf: false, secVV: false, secTgt: false, secStats: false, secMom: false, secCtx: false, secDfsm: false,
    showStatus: true, secState: true, secPos: true,
    atrLen: 14, atrMult: 2.0, bodyMul: 0.3, utKey: 1.0, utAtr: 10, utMode: 'off', utHA: false,
    useFib: true, tgtMode: 'none', allowLong: true, volMode: 'off', skipLight: false
  }
  // MCX futures: shorts on (owner). NSE cash: the reference default, longs only.
  const SETTINGS_MCX = Object.assign({}, QUIET, { allowShort: true })
  const SETTINGS_NSE = Object.assign({}, QUIET, { allowShort: false })

  function rowsToBars(rows) {
    const out = []
    for (const x of rows || []) {
      if (!x) continue
      const time = Array.isArray(x) ? +x[0] : +x.time
      const open = Array.isArray(x) ? +x[1] : +x.open
      const high = Array.isArray(x) ? +x[2] : +x.high
      const low = Array.isArray(x) ? +x[3] : +x.low
      const close = Array.isArray(x) ? +x[4] : +x.close
      const volume = Array.isArray(x) ? +x[5] || 0 : +x.volume || 0
      if (![time, open, high, low, close].every(Number.isFinite)) continue
      out.push({ time, open, high, low, close, volume })
    }
    out.sort((a, b) => a.time - b.time)
    return out
  }

  function actionOf(rows) {
    if (!Array.isArray(rows)) return ''
    for (const row of rows) {
      if (!row) continue
      for (const cell of row) {
        const t = cell && cell.text != null ? String(cell.text) : ''
        if (t.indexOf('ACTION:') === 0) return t.replace(/^ACTION:\s*/, '')
      }
    }
    return ''
  }

  function snapshot(bars, settings, ctx) {
    const S = Object.assign({}, QUIET, settings || {})
    const list = Array.isArray(bars) && bars.length && bars[0] && bars[0].open == null && Array.isArray(bars[0]) ? rowsToBars(bars) : bars
    if (!list || !list.length) return null
    const V = indicator().calc(list, S, {}, ctx || {})
    const L = list.length - 1
    const code = V.tsCode[L]
    const st = V.stats[L] || {}
    const allowShort = S.allowShort !== false && S.allowShort !== 0 && S.allowShort !== 'false'
    const pos = st.openDir || 0
    const ut = V.utPos[L] || 0
    const stop = pos !== 0 ? st.openStop : null
    const close = list[L].close
    const utWeak = (pos > 0 && ut !== 1) || (pos < 0 && ut !== -1)
    let utText = 'flat'
    if (pos !== 0) utText = utWeak ? 'weak' : 'agree'
    else if ((code === 5 && ut === 1) || (code === 6 && ut === -1)) utText = 'agree'
    const action = actionOf(V.dashRows[L])
    return {
      code, label: stateLabel(code, !!allowShort), action,
      pos, entry: pos !== 0 ? st.openEntry : null, stop,
      utPos: ut, utWeak, utText,
      barsSinceFlip: V.flipAge ? V.flipAge[L] : null,
      barsSinceEntry: V.entryAge != null ? V.entryAge : null,
      flipTime: V.flipTime ? V.flipTime[L] : null,
      close, stopDistPct: stop != null && close ? Math.abs(close - stop) / Math.abs(close) * 100 : null,
      exitHit: action.indexOf('EXIT HIT') === 0,
      allowShort: !!allowShort,
      confirmed: V.confirmed[L] !== false
    }
  }

  const api = {
    calc(bars, settings, store, ctx) { return indicator().calc(bars, settings || SETTINGS_MCX, store || {}, ctx || {}) },
    snapshot, stateLabel, rowsToBars, actionOf,
    SETTINGS_MCX, SETTINGS_NSE, QUIET
  }
  globalThis.SHNv34 = api
  if (typeof module === 'object' && module.exports) module.exports = api

})(typeof globalThis !== "undefined" ? globalThis : this);
