/**
 * NSE sector rotation. Same approximation the Rotation tab already documents.
 * This is not the proprietary JdK normalisation.
 *
 * RS = close ÷ benchmark close, joined on the IST calendar day.
 * EMA is the cockpit EMA: the first value is the simple average of the first
 * `len` finite points, then alpha = 2 / (len + 1). Nulls are skipped.
 * RS-Ratio = 100 × EMA10(RS) ÷ EMA26(RS)
 * RS-Momentum = 100 × RS-Ratio ÷ EMA6(RS-Ratio)
 *
 * Quadrant, with the axes included in Leading:
 *   RS-Ratio >= 100 and RS-Momentum >= 100 → Leading
 *   RS-Ratio >= 100 and RS-Momentum <  100 → Weakening
 *   RS-Ratio <  100 and RS-Momentum >= 100 → Improving
 *   RS-Ratio <  100 and RS-Momentum <  100 → Lagging
 *
 * Weekly points are the last aligned daily close of each IST ISO week,
 * then the same two EMAs. A point is omitted until both EMAs exist.
 * "Days in quadrant" is the number of trailing daily points that share
 * the latest daily quadrant. Missing inputs stay null. Nothing here is filled
 * with a sample number.
 */
(function (global) {
  'use strict';

  function ema(a, n) {
    const o = new Array(a.length).fill(null);
    const k = 2 / (n + 1);
    let p = null;
    const buf = [];
    for (let i = 0; i < a.length; i++) {
      if (a[i] == null || !isFinite(a[i])) continue;
      if (p == null) {
        buf.push(a[i]);
        if (buf.length === n) {
          let s = 0;
          for (let j = 0; j < buf.length; j++) s += buf[j];
          p = s / n;
          o[i] = p;
        }
        continue;
      }
      p = a[i] * k + p * (1 - k);
      o[i] = p;
    }
    return o;
  }

  function quadrant(x, y) {
    if (!isFinite(x) || !isFinite(y)) return null;
    if (x >= 100 && y >= 100) return 'Leading';
    if (x >= 100 && y < 100) return 'Weakening';
    if (x < 100 && y >= 100) return 'Improving';
    return 'Lagging';
  }

  function dayKey(unix) {
    const d = new Date((+unix + 19800) * 1000);
    return d.getUTCFullYear() + '-' + d.getUTCMonth() + '-' + d.getUTCDate();
  }

  function isoWeek(unix) {
    const ist = new Date((+unix + 19800) * 1000);
    const utc = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
    const day = new Date(utc).getUTCDay() || 7;
    const thu = utc + (4 - day) * 86400000;
    const thuY = new Date(thu).getUTCFullYear();
    const w = Math.floor((thu - Date.UTC(thuY, 0, 1)) / 86400000 / 7) + 1;
    return thuY + '-' + w;
  }

  function align(stock, bench) {
    const b = new Map();
    (bench || []).forEach(function (p) {
      if (!p || !isFinite(+p[0]) || !isFinite(+p[1]) || +p[1] === 0) return;
      b.set(dayKey(+p[0]), +p[1]);
    });
    const byDay = new Map();
    (stock || []).forEach(function (p) {
      if (!p || !isFinite(+p[0]) || !isFinite(+p[1]) || +p[1] === 0) return;
      const k = dayKey(+p[0]);
      const bv = b.get(k);
      if (bv == null) return;
      const prev = byDay.get(k);
      if (prev && prev.t > +p[0]) return;
      byDay.set(k, { t: +p[0], rs: +p[1] / bv, px: +p[1] });
    });
    return Array.from(byDay.values()).sort(function (a, c) { return a.t - c.t; });
  }

  function rrgPoints(pairs) {
    const rs = pairs.map(function (p) { return p.rs; });
    const e10 = ema(rs, 10);
    const e26 = ema(rs, 26);
    const ratio = rs.map(function (_, i) {
      return e10[i] != null && e26[i] ? 100 * e10[i] / e26[i] : null;
    });
    const e6 = ema(ratio, 6);
    const out = [];
    for (let i = 0; i < pairs.length; i++) {
      if (ratio[i] == null || e6[i] == null || e6[i] === 0) continue;
      const y = 100 * ratio[i] / e6[i];
      const q = quadrant(ratio[i], y);
      if (!q) continue;
      out.push({ t: pairs[i].t, x: ratio[i], y: y, q: q });
    }
    return out;
  }

  function toWeekly(pairs) {
    const weeks = [];
    let cur = null;
    (pairs || []).forEach(function (p) {
      const k = isoWeek(p.t);
      if (!cur || cur.k !== k) {
        cur = { k: k, t: p.t, rs: p.rs, px: p.px };
        weeks.push(cur);
      } else {
        cur.t = p.t;
        cur.rs = p.rs;
        cur.px = p.px;
      }
    });
    return weeks;
  }

  function daysIn(points) {
    if (!points || !points.length) return null;
    const q = points[points.length - 1].q;
    if (!q) return null;
    let n = 0;
    for (let i = points.length - 1; i >= 0; i--) {
      if (points[i].q !== q) break;
      n++;
    }
    return n;
  }

  function changePct(pairs, n) {
    if (!pairs || pairs.length <= n || n < 1) return null;
    const last = pairs[pairs.length - 1].px;
    const prev = pairs[pairs.length - 1 - n].px;
    if (!isFinite(last) || !isFinite(prev) || prev === 0) return null;
    return (last / prev - 1) * 100;
  }

  function tail(points, n) {
    const k = n == null ? 6 : n;
    return (points || []).slice(-k);
  }

  function build(stock, bench) {
    const pairs = align(stock, bench);
    if (pairs.length < 32) return null;
    const daily = rrgPoints(pairs);
    const weekly = rrgPoints(toWeekly(pairs));
    if (!daily.length && !weekly.length) return null;
    return {
      head: daily.length ? daily[daily.length - 1] : null,
      weeklyHead: weekly.length ? weekly[weekly.length - 1] : null,
      days: daysIn(daily),
      weeks: daysIn(weekly),
      chg1w: changePct(pairs, 5),
      chg1m: changePct(pairs, 21),
      daily: daily,
      weekly: weekly
    };
  }

  function lastPoint(stock, bench) {
    const pairs = align(stock, bench);
    const pts = rrgPoints(pairs);
    return pts.length ? pts[pts.length - 1] : null;
  }

  const api = {
    ema: ema,
    quadrant: quadrant,
    dayKey: dayKey,
    isoWeek: isoWeek,
    align: align,
    rrgPoints: rrgPoints,
    toWeekly: toWeekly,
    daysIn: daysIn,
    changePct: changePct,
    tail: tail,
    build: build,
    lastPoint: lastPoint
  };
  global.SHNRot = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
