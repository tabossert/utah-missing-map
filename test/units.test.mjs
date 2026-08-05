import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDistanceUnit, formatDistance, formatLeg, formatArea, legLabelFits } from '../src/units.js';

const M_PER_FT = 0.3048;
const M_PER_MI = 1609.344;
const M2_PER_ACRE = (M_PER_MI * M_PER_MI) / 640;

test('US distance unit flips at 1000 ft', () => {
  assert.equal(pickDistanceUnit(999 * M_PER_FT, 'us'), 'ft');
  assert.equal(pickDistanceUnit(1000 * M_PER_FT, 'us'), 'mi');
});

test('metric distance unit flips at 1000 m', () => {
  assert.equal(pickDistanceUnit(999, 'metric'), 'm');
  assert.equal(pickDistanceUnit(1000, 'metric'), 'km');
});

test('small units render whole and thousands-separated', () => {
  assert.equal(formatDistance(100 * M_PER_FT, 'ft'), '100 ft');
  assert.equal(formatDistance(1240 * M_PER_FT, 'ft'), '1,240 ft');
  assert.equal(formatDistance(850, 'm'), '850 m');
});

test('scaled units strip trailing zeros', () => {
  assert.equal(formatDistance(2.4 * M_PER_MI, 'mi'), '2.4 mi');
  assert.equal(formatDistance(3.24 * M_PER_MI, 'mi'), '3.24 mi');
  assert.equal(formatDistance(12.34 * M_PER_MI, 'mi'), '12.3 mi');
  assert.equal(formatDistance(412.6 * M_PER_MI, 'mi'), '413 mi');
  assert.equal(formatDistance(2400, 'km'), '2.4 km');
});

test('a leg too short for the path unit falls back', () => {
  assert.equal(formatLeg(140 * M_PER_FT, 'mi'), '140 ft');
  assert.equal(formatLeg(0.4 * M_PER_MI, 'mi'), '0.4 mi');
  assert.equal(formatLeg(60, 'km'), '60 m');
  assert.equal(formatLeg(400, 'km'), '0.4 km');
});

test('the fallback boundary is 0.1 of the scaled unit', () => {
  assert.equal(formatLeg(M_PER_MI / 10 - 1, 'mi'), '525 ft'); // 159.9344 m = 524.7 ft
  assert.equal(formatLeg(M_PER_MI / 10, 'mi'), '0.1 mi');
  assert.equal(formatLeg(99, 'km'), '99 m');
  assert.equal(formatLeg(100, 'km'), '0.1 km');
});

test('a leg already in a small unit is left alone', () => {
  assert.equal(formatLeg(50 * M_PER_FT, 'ft'), '50 ft');
  assert.equal(formatLeg(50, 'm'), '50 m');
});

test('US area ladder', () => {
  assert.equal(formatArea(M2_PER_ACRE * 0.5, 'us'), '21,780 sq ft');
  assert.equal(formatArea(M2_PER_ACRE, 'us'), '1 acre');
  assert.equal(formatArea(M2_PER_ACRE * 412, 'us'), '412 acres');
  assert.equal(formatArea(M2_PER_ACRE * 640, 'us'), '1 sq mi');
  assert.equal(formatArea(M2_PER_ACRE * 1600, 'us'), '2.5 sq mi');
});

test('metric area ladder', () => {
  assert.equal(formatArea(9999, 'metric'), '9,999 m²');
  assert.equal(formatArea(10000, 'metric'), '1 ha');
  assert.equal(formatArea(990000, 'metric'), '99 ha');
  assert.equal(formatArea(1000000, 'metric'), '1 km²');
  assert.equal(formatArea(2500000, 'metric'), '2.5 km²');
});

test('acre is singular only at exactly one', () => {
  assert.equal(formatArea(M2_PER_ACRE, 'us'), '1 acre');
  assert.equal(formatArea(M2_PER_ACRE * 2, 'us'), '2 acres');
});

test('legLabelFits at the threshold, just below, and just above', () => {
  // '5 ft' is 4 chars: 4*6.5 + 12 + 8 = 46
  assert.equal(legLabelFits(46, '5 ft'), true);
  assert.equal(legLabelFits(45.99, '5 ft'), false);
  assert.equal(legLabelFits(46.01, '5 ft'), true);
});

test('a longer label needs more room than a shorter one at the same width', () => {
  assert.equal(legLabelFits(46, '5 ft'), true);
  assert.equal(legLabelFits(46, '1,240 ft'), false);
});
