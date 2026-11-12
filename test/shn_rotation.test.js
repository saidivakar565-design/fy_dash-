'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Rot = require('../js/shn_rotation.js');

function istClose(y, m, d) {
  return Date.UTC(y, m - 1, d, 10, 0, 0) / 1000;
}

function geometric(n, step, start) {
  const stock = [];
  const bench = [];
  let px = start == null ? 100 : start;
  for (let i = 0; i < n; i++) {
    const t = istClose(2024, 1, 1) + i * 86400;
    px *= step;
    stock.push([t, px]);
    bench.push([t, 100]);
  }
  return { stock: stock, bench: bench };
}

test('EMA seeds with the simple average, then uses alpha 2/(len+1)', () => {
  const o = Rot.ema([1, 2, 3, 4, 5], 3);
  assert.equal(o[0], null);
  assert.equal(o[1], null);
  assert.equal(o[2], 2);
  assert.equal(o[3], 3);
  assert.equal(o[4], 4);
});

test('quadrant axes belong to Leading, and a non-number is blank', () => {
  assert.equal(Rot.quadrant(100, 100), 'Leading');
  assert.equal(Rot.quadrant(100, 99.9), 'Weakening');
  assert.equal(Rot.quadrant(99.9, 100), 'Improving');
  assert.equal(Rot.quadrant(99.9, 99.9), 'Lagging');
  assert.equal(Rot.quadrant(NaN, 100), null);
  assert.equal(Rot.quadrant(100, Infinity), null);
});

test('a flat RS sits on 100 / 100 and is Leading', () => {
  const pairs = [];
  for (let i = 0; i < 40; i++) pairs.push({ t: i * 86400, rs: 1, px: 100 });
  const pts = Rot.rrgPoints(pairs);
  const last = pts[pts.length - 1];
  assert.ok(Math.abs(last.x - 100) < 1e-9);
  assert.ok(Math.abs(last.y - 100) < 1e-9);
  assert.equal(last.q, 'Leading');
  assert.ok(pts.length < 40);
});

function stepped(parts) {
  const stock = [];
  const bench = [];
  let px = 100;
  let i = 0;
  parts.forEach(function (part) {
    for (let k = 0; k < part[0]; k++, i++) {
      px *= part[1];
      const t = istClose(2024, 1, 1) + i * 86400;
      stock.push([t, px]);
      bench.push([t, 100]);
    }
  });
  return { stock: stock, bench: bench };
}

test('a rising RS finishes Leading and a falling RS finishes Lagging', () => {
  const up = stepped([[80, 1.001], [40, 1.01]]);
  const built = Rot.build(up.stock, up.bench);
  assert.equal(built.head.q, 'Leading');
  assert.ok(built.head.x > 100);
  assert.ok(built.head.y > 100);
  assert.ok(built.days >= 1);
  assert.ok(built.chg1m > 0);

  const down = stepped([[120, 0.996]]);
  const lag = Rot.build(down.stock, down.bench);
  assert.equal(lag.head.q, 'Lagging');
  assert.ok(lag.head.x < 100);
  assert.ok(lag.head.y < 100);
  assert.ok(lag.chg1w < 0);

  const turn = stepped([[100, 0.994], [10, 1.008]]);
  const imp = Rot.build(turn.stock, turn.bench);
  assert.equal(imp.head.q, 'Improving');
  assert.ok(imp.head.x < 100);
  assert.ok(imp.head.y >= 100);
});

test('days in quadrant stops at the previous quadrant', () => {
  const pts = [
    { q: 'Lagging' },
    { q: 'Leading' },
    { q: 'Leading' },
    { q: 'Leading' }
  ];
  assert.equal(Rot.daysIn(pts), 3);
  assert.equal(Rot.daysIn([]), null);
});

test('bars on the same IST day align, and a missing day stays out', () => {
  const stock = [[istClose(2026, 1, 5) - 3600, 20], [istClose(2026, 1, 6), 30], [istClose(2026, 1, 8), 40]];
  const bench = [[istClose(2026, 1, 5), 10], [istClose(2026, 1, 7), 10], [istClose(2026, 1, 8), 10]];
  const pairs = Rot.align(stock, bench);
  assert.deepEqual(pairs.map(function (p) { return p.rs; }), [2, 4]);
  assert.equal(Rot.changePct(pairs, 1), 100);
  assert.equal(Rot.changePct(pairs, 5), null);
});

test('weekly rotation uses the last aligned close of each IST week', () => {
  const pairs = [
    { t: istClose(2026, 1, 5), rs: 1, px: 10 },
    { t: istClose(2026, 1, 6), rs: 1.1, px: 11 },
    { t: istClose(2026, 1, 9), rs: 1.2, px: 12 },
    { t: istClose(2026, 1, 12), rs: 1.3, px: 13 }
  ];
  assert.equal(Rot.isoWeek(pairs[0].t), Rot.isoWeek(pairs[2].t));
  assert.notEqual(Rot.isoWeek(pairs[2].t), Rot.isoWeek(pairs[3].t));
  const weeks = Rot.toWeekly(pairs);
  assert.equal(weeks.length, 2);
  assert.equal(weeks[0].px, 12);
  assert.equal(weeks[1].rs, 1.3);

  const series = stepped([[250, 1.001], [70, 1.008]]);
  const built = Rot.build(series.stock, series.bench);
  assert.ok(built.weeklyHead);
  assert.equal(built.weeklyHead.q, 'Leading');
  assert.ok(built.weekly.length < built.daily.length);
  assert.equal(Rot.tail(built.daily, 5).length, 5);
});
