import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertLegible } from './geometry.js';

// The legibility check once passed everything because of a sign error.
// These make sure it still fails when it should.
const word = (text, x, y, extra = {}) => ({ t: 'text', text, x, y, uid: text, kind: 'word', ...extra });

test('a clean picture passes', () => {
  assertLegible([word('fox', 0, 0), { t: 'line', x1: -5, y1: 6, x2: 60, y2: 6, kind: 'base' }]);
});

test('catches a line through a word', () => {
  assert.throws(() => assertLegible([word('Impeachment', 0, 0), { t: 'line', x1: 40, y1: -30, x2: 40, y2: 30, kind: 'conn' }]), /crosses/);
});

test('catches a line through a slanted word', () => {
  const slanted = word('quick', 0, 0, { angle: 60 });
  assert.throws(() => assertLegible([slanted, { t: 'line', x1: -20, y1: 20, x2: 40, y2: 20, kind: 'base' }]), /crosses/);
});

test('catches overlapping words', () => {
  assert.throws(() => assertLegible([word('Office', 0, 0), word('honor', 30, 4)]), /overlaps/);
});

test('catches a word drawn twice', () => {
  assert.throws(() => assertLegible([word('enjoy', 0, 0), word('enjoy', 300, 0)]), /drawn twice/);
});
