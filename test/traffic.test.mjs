import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  avgVisitSeconds,
  bounceRate,
  bubbleRadius,
  formatCount,
  formatDuration,
  referrerLabel,
  sparklinePath,
  topRows,
} from '../src/traffic.js';

test('formatCount groups thousands and survives junk', () => {
  assert.equal(formatCount(0), '0');
  assert.equal(formatCount(15171), '15,171');
  assert.equal(formatCount(12.6), '13');
  assert.equal(formatCount(undefined), '—');
  assert.equal(formatCount('nope'), '—');
});

test('formatDuration switches units', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(45), '45s');
  assert.equal(formatDuration(134), '2m 14s');
  assert.equal(formatDuration(3780), '1h 3m');
  assert.equal(formatDuration(-5), '0s');
});

test('bounce rate and average visit guard against zero visits', () => {
  assert.equal(bounceRate({ bounces: 3567, visits: 5680 }), '63%');
  assert.equal(bounceRate({ bounces: 0, visits: 0 }), '—');
  assert.equal(bounceRate({}), '—');
  assert.equal(avgVisitSeconds({ totaltime: 800, visits: 4 }), 200);
  assert.equal(avgVisitSeconds({ totaltime: 800, visits: 0 }), 0);
});

test('referrerLabel names the empty referrer and trims noise', () => {
  assert.equal(referrerLabel(''), 'Direct / none');
  assert.equal(referrerLabel(null), 'Direct / none');
  assert.equal(referrerLabel('https://google.com/'), 'google.com');
});

test('topRows sorts, limits, and shares against the largest row', () => {
  const rows = topRows([{ x: '/a', y: 5 }, { x: '/b', y: 20 }, { x: '/c', y: 10 }], 2);
  assert.deepEqual(rows.map((r) => r.label), ['/b', '/c']);
  assert.equal(rows[0].share, 1);
  assert.equal(rows[1].share, 0.5);
  assert.deepEqual(topRows(undefined), []);
});

test('topRows tolerates an all-zero metric without dividing by zero', () => {
  const rows = topRows([{ x: '/a', y: 0 }, { x: '/b', y: 0 }]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.share === 0));
});

test('bubbleRadius scales by area, stays within bounds, and survives junk', () => {
  assert.equal(bubbleRadius(100, 100), 26); // the largest city hits the cap
  assert.equal(bubbleRadius(0, 100), 5); // nothing shrinks below the floor
  // area ∝ visitors: a quarter of the peak sits halfway up the radius range
  assert.equal(bubbleRadius(25, 100), 15.5);
  assert.equal(bubbleRadius(5, 0), 26); // max of 0 can't divide by zero
  assert.equal(bubbleRadius(999, 10), 26); // clamped, never oversized
  assert.equal(bubbleRadius(undefined, 10), 5);
});

test('sparklinePath spans the viewBox and needs two points', () => {
  assert.equal(sparklinePath([]), '');
  assert.equal(sparklinePath([{ x: 1, y: 5 }]), '');
  assert.equal(sparklinePath([{ y: 0 }, { y: 10 }], 100, 30), 'M0,30 L100,0');
  assert.equal(sparklinePath([{ y: 0 }, { y: 0 }], 100, 30), 'M0,30 L100,30');
});
