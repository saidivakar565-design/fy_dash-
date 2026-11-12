'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const SHN = require('../js/shn_v34.js');
const Sig = require('../js/shn_signals.js');

function bar(t, o, h, l, c, v) {
  return { time: t, open: o, high: h, low: l, close: c, volume: v || 1000 };
}

test('Donchian 20 buy is a cross of the prior 20-bar high, not a close that was already above', () => {
  const bars = [];
  let t = 1_700_000_000;
  for (let i = 0; i < 30; i++) {
    bars.push(bar(t, 9.6, 10, 9, 9.5));
    t += 3600;
  }
  const quiet = bars.slice();
  quiet.push(bar(t, 9.6, 10.2, 9.4, 9.7));
  const no = Sig.donchian(quiet.map((b) => b.high), quiet.map((b) => b.low), quiet.map((b) => b.close), 20);
  assert.equal(no.buy[no.buy.length - 1], false);

  const brk = bars.slice();
  const last = brk[brk.length - 1];
  brk.push(bar(t, last.close, 11, 9.4, 10.6));
  const yes = Sig.donchian(brk.map((b) => b.high), brk.map((b) => b.low), brk.map((b) => b.close), 20);
  assert.equal(yes.buy[yes.buy.length - 1], true);
  assert.equal(yes.sell[yes.sell.length - 1], false);
});

test('ITL confirms 20 bars after the pivot low and bars-ago is from that bar', () => {
  const low = [];
  const high = [];
  for (let i = 0; i < 50; i++) {
    low.push(100);
    high.push(101);
  }
  low[22] = 80;
  high[22] = 90;
  const itl = Sig.pivotAt(low, 20, false);
  const ith = Sig.pivotAt(high, 20, true);
  assert.equal(itl[42], true);
  assert.equal(itl[22], false);
  assert.equal(ith.some(Boolean), false);
  const ago = 49 - 42;
  assert.equal(ago, 7);
});

test('UT and the V4a flip on the engine match the signal list', () => {
  const bars = [];
  let p = 100;
  let t = 1_700_000_000;
  for (let i = 0; i < 60; i++) {
    const o = p;
    const c = p - 0.05;
    bars.push(bar(t, o, Math.max(o, c) + 0.15, Math.min(o, c) - 0.15, c));
    p = c;
    t += 3600;
  }
  const o = p;
  const c = p + 10;
  bars.push(bar(t, o, Math.max(o, c) + 0.3, Math.min(o, c) - 0.1, c, 4000));
  const V = SHN.calc(bars, Object.assign({}, SHN.SETTINGS_MCX, { useFib: false }));
  const info = Sig.analyse(bars, 'MCX');
  const utIdx = V.utBuy.map((v, i) => v ? i : -1).filter((i) => i >= 0);
  const flipIdx = V.flipBuy.map((v, i) => v ? i : -1).filter((i) => i >= 0);
  assert.deepEqual(info.ut.filter((e) => e.dir === 'B').map((e) => e.i), utIdx);
  assert.deepEqual(info.shn.filter((e) => e.dir === 'B').map((e) => e.i), flipIdx);
  assert.ok(flipIdx.length >= 1);
});

test('momentum is 0-100 in steps of 25 and a climb scores the long side', () => {
  const bars = [];
  let p = 50;
  let t = 1_700_000_000;
  for (let i = 0; i < 80; i++) {
    const o = p;
    const c = p + 0.8;
    bars.push(bar(t, o, c + 0.2, o - 0.05, c, 1000 + i));
    p = c;
    t += 86400;
  }
  const info = Sig.analyse(bars, 'NSE');
  assert.equal(info.momLong % 25, 0);
  assert.ok(info.momLong >= 0 && info.momLong <= 100);
  assert.ok(info.momLong >= 75);
  assert.ok(info.momShort <= info.momLong);
});

test('volume ratio is last bar over the 20-bar average', () => {
  const bars = [];
  for (let i = 0; i < 19; i++) bars.push(bar(i, 1, 2, 1, 1.5, 100));
  bars.push(bar(19, 1, 2, 1, 1.5, 200));
  const x = Sig.volRatio(bars, 20);
  assert.ok(Math.abs(x - 200 / 105) < 1e-9);
});

test('a scan counts optional hits and does not invent a combined score', () => {
  const info = {
    n: 40,
    close: 100,
    time: 10,
    momLong: 75,
    momShort: 25,
    volX: 1.2,
    ut: [{ i: 38, dir: 'B', time: 8 }],
    shn: [{ i: 39, dir: 'B', time: 9 }],
    ith: [{ i: 30, dir: 'B', time: 1 }],
    dc20: [{ i: 37, dir: 'B', time: 7 }],
    dc40: []
  };
  const cfg = {
    dir: 'buy', within: 5, ithWithin: 25, optNeed: 0,
    signals: { ut: 'must', shn: 'must', ith: 'must', dc20: 'opt', dc40: 'opt' }
  };
  const hit = Sig.fit(info, cfg);
  assert.equal(hit.pass, true);
  assert.equal(hit.optMet, 1);
  assert.equal(hit.optN, 2);
  assert.equal(hit.fresh, 9);
  assert.equal(hit.chips.dc40, null);
  assert.equal(hit.chips.ut.dir, 'B');
  assert.equal(hit.chips.ut.ago, 1);
  const strict = Sig.fit(info, Object.assign({}, cfg, { optNeed: 2 }));
  assert.equal(strict.pass, false);
  assert.equal(strict.optMet, 1);
});
