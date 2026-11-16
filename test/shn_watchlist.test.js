'use strict';
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const WL = require('../js/shn_watchlist.js');

test('the on-phone watchlist stops at 50 symbols', () => {
  assert.equal(WL.CAP, 50);
  const many = [];
  for (let i = 0; i < 60; i++) many.push('SYM' + i);
  const out = WL.parseWatchlist(many.join(' '));
  assert.equal(out.length, 50);
  assert.equal(out[0], 'SYM0');
  assert.equal(out[49], 'SYM49');
  assert.equal(out.indexOf('SYM50'), -1);
});

test('parsing uppercases, drops duplicates, and keeps M&M and BAJAJ-AUTO', () => {
  const out = WL.parseWatchlist('sbin, SBIN m&m bajaj-auto\ninfy');
  assert.deepEqual(out, ['SBIN', 'M&M', 'BAJAJ-AUTO', 'INFY']);
});

test('scan progress reads Scanning 23/50 and hides when the scan is finished', () => {
  assert.equal(WL.scanProgress(23, 50), 'Scanning 23/50');
  assert.equal(WL.scanProgress(0, 50), 'Scanning 0/50');
  assert.equal(WL.scanProgress(50, 50), '');
  assert.equal(WL.scanProgress(51, 50), '');
});

test('the phone still spaces history requests by 1.6s, under 40 a minute', () => {
  const src = fs.readFileSync(path.join(__dirname, '../js/shn_app.js'), 'utf8');
  assert.match(src, /var gap = 1600/);
  assert.equal(WL.GAP_MS, 1600);
  const perMin = 60000 / WL.GAP_MS;
  assert.ok(perMin < 40);
  const seconds = (WL.CAP * WL.GAP_MS) / 1000;
  assert.equal(seconds, 80);
});
