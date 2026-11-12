'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const SHN = require('../js/shn_v34.js');

function reference() {
  const src = fs.readFileSync(path.join(__dirname, '../js/shn_matrix_v34_reference.js'), 'utf8')
    .replace('export default function (lib)', 'function shnRef(lib)');
  const factory = new Function(src + '\nreturn shnRef;')();
  let ind = null;
  factory({ registerIndicator(def) { ind = def; } });
  return ind;
}
const REF = reference();

function warmup(dir) {
  const bars = [];
  let p = 100, t = 1700000000;
  const step = dir === 'up' ? -0.05 : 0.05;
  for (let i = 0; i < 60; i++) {
    const o = p, c = p + step;
    bars.push({ time: t, open: o, high: Math.max(o, c) + 0.15, low: Math.min(o, c) - 0.15, close: c, volume: 1000 });
    p = c; t += 3600;
  }
  return { bars, p, t };
}
function push(st, d, ex) {
  ex = ex || {};
  const o = ex.open != null ? ex.open : st.p;
  const c = ex.close != null ? ex.close : st.p + d;
  const h = ex.high != null ? ex.high : Math.max(o, c) + (ex.wh == null ? 0.2 : ex.wh);
  const l = ex.low != null ? ex.low : Math.min(o, c) - (ex.wl == null ? 0.2 : ex.wl);
  st.bars.push({ time: st.t, open: o, high: h, low: l, close: c, volume: 4000 });
  st.p = c; st.t += 3600;
}
const OFF = Object.assign({}, SHN.SETTINGS_MCX, { useFib: false });

function longBook() {
  const st = warmup('up');
  push(st, 10); push(st, 6);
  return st;
}
function shortBook() {
  const st = warmup('dn');
  push(st, -10); push(st, -6);
  return st;
}

test('calc matches the reference engine on entries, stops and trade-state codes', () => {
  const samples = [];
  samples.push(longBook().bars);
  const weak = longBook(); push(weak, -2, { wh: 0.05, wl: 0.05 }); samples.push(weak.bars);
  samples.push(shortBook().bars);
  const s4 = shortBook(); push(s4, 2, { wh: 0.05, wl: 0.05 }); samples.push(s4.bars);
  const flat = warmup('up'); samples.push(flat.bars);
  for (const bars of samples) {
    for (const settings of [OFF, SHN.SETTINGS_MCX, SHN.SETTINGS_NSE]) {
      const a = SHN.calc(bars, settings);
      const b = REF.calc(bars, settings, {}, {});
      assert.deepEqual(a.tsCode, b.tsCode);
      assert.deepEqual(a.entryBuy, b.entryBuy);
      assert.deepEqual(a.entrySell, b.entrySell);
      assert.deepEqual(a.slHit, b.slHit);
      assert.deepEqual(a.utPos, b.utPos);
      const as = a.stats[bars.length - 1], bs = b.stats[bars.length - 1];
      assert.equal(as.openDir, bs.openDir);
      assert.equal(as.openStop, bs.openStop);
      assert.equal(as.openEntry, bs.openEntry);
    }
  }
});

test('trade-loop source is the reference, plus flip bookkeeping only', () => {
  const port = fs.readFileSync(path.join(__dirname, '../js/shn_v34.js'), 'utf8');
  const ref = fs.readFileSync(path.join(__dirname, '../js/shn_matrix_v34_reference.js'), 'utf8');
  const slice = (s) => {
    const a = s.indexOf('calc(bars, settings, store, ctx)');
    const b = s.indexOf('if (!showSMC) for');
    assert.ok(a > 0 && b > a);
    return s.slice(a, b);
  };
  assert.equal(slice(port), slice(ref));
  assert.match(port, /V\.flipAge/);
  assert.doesNotMatch(ref, /flipAge/);
});

test('seven trade states and the ACTION lines', () => {
  const strong = SHN.snapshot(longBook().bars, OFF);
  assert.equal(strong.code, 1);
  assert.equal(strong.label, 'STRONG LONG ▲');
  assert.match(strong.action, /^HOLD · trail stop /);
  assert.equal(strong.utText, 'agree');
  assert.equal(strong.pos, 1);
  assert.ok(strong.stop < strong.close);

  const weak = longBook(); push(weak, -2, { wh: 0.05, wl: 0.05 });
  const w = SHN.snapshot(weak.bars, OFF);
  assert.equal(w.code, 2);
  assert.equal(w.label, 'LONG · WEAKENING');
  assert.match(w.action, /^HOLD · no adds · exit only if price < /);
  assert.equal(w.utWeak, true);

  const sh = SHN.snapshot(shortBook().bars, OFF);
  assert.equal(sh.code, 3);
  assert.equal(sh.label, 'STRONG SHORT ▼');
  assert.match(sh.action, /^HOLD · trail stop /);
  assert.equal(sh.pos, -1);
  assert.ok(sh.stop > sh.close);

  const bounce = shortBook(); push(bounce, 2, { wh: 0.05, wl: 0.05 });
  const s4 = SHN.snapshot(bounce.bars, OFF);
  assert.equal(s4.code, 4);
  assert.equal(s4.label, 'SHORT · WEAKENING');
  assert.match(s4.action, /^HOLD · no adds · exit only if price > /);

  const wait = longBook();
  const disabled = SHN.snapshot(wait.bars, Object.assign({}, OFF, { allowLong: false }));
  assert.equal(disabled.code, 5);
  assert.equal(disabled.action, 'WAIT · longs disabled');

  const grind = longBook();
  const stop = SHN.snapshot(grind.bars, OFF).stop;
  push(grind, 0, { open: grind.p, close: stop - 0.5, high: grind.p, low: stop - 0.8 });
  for (let i = 0; i < 14; i++) push(grind, 0.15, { wh: 0.02, wl: 0.02 });
  const buy = SHN.snapshot(grind.bars, OFF);
  assert.equal(buy.code, 5);
  assert.equal(buy.label, 'BULLISH · WAIT FOR BUY');
  assert.equal(buy.action, 'WAIT · next BUY needs a V4a flip');

  const aside = SHN.snapshot(shortBook().bars, Object.assign({}, OFF, { allowShort: false }));
  assert.equal(aside.code, 6);
  assert.equal(aside.label, 'BEARISH · NO LONG');
  assert.equal(aside.action, 'STAND ASIDE · no long');

  const bearFlat = SHN.snapshot(warmup('up').bars, OFF);
  assert.equal(bearFlat.code, 6);
  assert.equal(bearFlat.pos, 0);
  assert.equal(bearFlat.label, 'BEARISH · WAIT FOR SELL');
  assert.equal(bearFlat.action, 'WAIT · next SELL needs a V4a flip');

  const drift = [];
  let px = 100, tt = 1700000000;
  for (let i = 0; i < 80; i++) {
    const o = px, c = px + (i % 5 === 0 ? -0.4 : 0.15);
    drift.push({ time: tt, open: o, high: Math.max(o, c) + 0.2, low: Math.min(o, c) - 0.2, close: c, volume: 1000 });
    px = c; tt += 86400;
  }
  const mixed = SHN.snapshot(drift, OFF);
  assert.equal(mixed.code, 7);
  assert.equal(mixed.label, 'WAIT · MIXED');
  assert.equal(mixed.action, 'WAIT · mixed, no new trade');
  assert.equal(mixed.barsSinceFlip, null);
});

test('wick touch stops a long even when the close is back above the stop', () => {
  const st = longBook();
  const open = SHN.snapshot(st.bars, OFF);
  const stop = open.stop;
  push(st, 0, { open: open.close, close: stop + 1.2, high: open.close, low: stop - 0.4 });
  const hit = SHN.snapshot(st.bars, OFF);
  const bar = st.bars[st.bars.length - 1];
  assert.ok(bar.low < stop && bar.close > stop);
  assert.equal(hit.pos, 0);
  assert.match(hit.action, /^EXIT HIT · /);
  const V = SHN.calc(st.bars, OFF);
  assert.equal(V.slHit[st.bars.length - 1], true);
});

test('a still-forming bar does not close the trade', () => {
  const st = longBook();
  const open = SHN.snapshot(st.bars, OFF);
  push(st, 0, { open: open.close - 0.2, close: open.stop - 1, high: open.close, low: open.stop - 1.5 });
  const forming = SHN.snapshot(st.bars, OFF, { barState: { isConfirmed: false } });
  const closed = SHN.snapshot(st.bars, OFF);
  assert.equal(forming.pos, 1);
  assert.equal(closed.pos, 0);
  assert.match(closed.action, /^EXIT HIT · /);
});

test('the ATR trail only tightens, and a gap through fills at the open', () => {
  const st = longBook();
  const V0 = SHN.calc(st.bars, OFF);
  let prev = null, dir = 0;
  for (let i = 0; i < st.bars.length; i++) {
    if (V0.entryBuy[i]) dir = 1;
    if (V0.entrySell[i]) dir = -1;
    if (V0.stop[i] != null && prev != null) {
      if (dir > 0) assert.ok(V0.stop[i] >= prev - 1e-9);
      if (dir < 0) assert.ok(V0.stop[i] <= prev + 1e-9);
    }
    if (V0.stop[i] != null) prev = V0.stop[i];
    if (V0.anyExit[i]) { prev = null; dir = 0; }
  }
  const stop = V0.stats[st.bars.length - 1].openStop;
  const gapOpen = stop - 3;
  push(st, 0, { open: gapOpen, close: gapOpen - 0.2, high: stop - 0.5, low: gapOpen - 0.5 });
  const V = SHN.calc(st.bars, OFF);
  const i = st.bars.length - 1;
  assert.equal(V.slHit[i], true);
  assert.ok(Math.abs(V.exitPx[i] - gapOpen) < 1e-6);
});

test('app defaults: ATR mult 2, UT 1 / 10, fib on, shorts on for MCX and off for NSE', () => {
  assert.equal(SHN.SETTINGS_MCX.atrMult, 2);
  assert.equal(SHN.SETTINGS_MCX.bodyMul, 0.3);
  assert.equal(SHN.SETTINGS_MCX.utKey, 1);
  assert.equal(SHN.SETTINGS_MCX.utAtr, 10);
  assert.equal(SHN.SETTINGS_MCX.allowShort, true);
  assert.equal(SHN.SETTINGS_MCX.useFib, true);
  assert.equal(SHN.SETTINGS_NSE.allowShort, false);
  const up = longBook();
  const mcx = SHN.snapshot(up.bars, SHN.SETTINGS_MCX);
  const ref = REF.calc(up.bars, SHN.SETTINGS_MCX, {}, {});
  assert.equal(mcx.code, ref.tsCode[up.bars.length - 1]);
  assert.equal(mcx.pos, ref.stats[up.bars.length - 1].openDir);
});
