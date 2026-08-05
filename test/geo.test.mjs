import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EARTH_R, distanceMeters, pathLengthMeters, ringAreaM2, closeRing } from '../src/geo.js';

// One degree of arc is exactly EARTH_R * (pi/180) on a sphere — an exact check
// of the haversine rather than a fuzzy real-world comparison.
const DEG_M = (EARTH_R * Math.PI) / 180;

test('one degree of latitude along a meridian', () => {
  const d = distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  assert.ok(Math.abs(d - DEG_M) < 0.01, `expected ~${DEG_M}, got ${d}`);
});

test('one degree of longitude at the equator matches', () => {
  const d = distanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
  assert.ok(Math.abs(d - DEG_M) < 0.01, `expected ~${DEG_M}, got ${d}`);
});

test('a quarter of the way around is a quarter circumference', () => {
  const d = distanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 90 });
  const expected = (EARTH_R * Math.PI) / 2;
  assert.ok(Math.abs(d - expected) < 1, `expected ~${expected}, got ${d}`);
});

test('distance is symmetric and zero for identical points', () => {
  const a = { lat: 40.76, lng: -111.89 };
  const b = { lat: 40.23, lng: -111.66 };
  assert.equal(distanceMeters(a, a), 0);
  assert.ok(Math.abs(distanceMeters(a, b) - distanceMeters(b, a)) < 1e-9);
});

test('Salt Lake City to Provo lands in the right ballpark', () => {
  const d = distanceMeters({ lat: 40.7608, lng: -111.891 }, { lat: 40.2338, lng: -111.6585 });
  assert.ok(d > 55_000 && d < 70_000, `expected 55-70 km, got ${d}`);
});

test('path length sums its legs and is zero below two points', () => {
  assert.equal(pathLengthMeters([]), 0);
  assert.equal(pathLengthMeters([{ lat: 0, lng: 0 }]), 0);
  const pts = [{ lat: 0, lng: 0 }, { lat: 1, lng: 0 }, { lat: 2, lng: 0 }];
  assert.ok(Math.abs(pathLengthMeters(pts) - 2 * DEG_M) < 0.02);
});

test('ring area of a one-degree box at the equator', () => {
  // Exact spherical graticule area: R^2 * dLambda * (sin p2 - sin p1)
  const expected = EARTH_R ** 2 * (Math.PI / 180) * Math.sin(Math.PI / 180);
  const box = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 1 },
    { lat: 1, lng: 1 },
    { lat: 1, lng: 0 },
  ];
  const got = ringAreaM2(box);
  assert.ok(Math.abs(got - expected) / expected < 0.01, `expected ~${expected}, got ${got}`);
});

test('ring area of a small box in Utah matches the planar approximation', () => {
  // At 0.01 degrees curvature is negligible, so this is derivable by hand.
  const height = 0.01 * DEG_M;
  const width = 0.01 * DEG_M * Math.cos((40.005 * Math.PI) / 180);
  const expected = height * width;
  const box = [
    { lat: 40.0, lng: -111.0 },
    { lat: 40.0, lng: -110.99 },
    { lat: 40.01, lng: -110.99 },
    { lat: 40.01, lng: -111.0 },
  ];
  const got = ringAreaM2(box);
  assert.ok(Math.abs(got - expected) / expected < 0.01, `expected ~${expected}, got ${got}`);
});

test('winding order does not change the area', () => {
  const box = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 1 },
    { lat: 1, lng: 1 },
    { lat: 1, lng: 0 },
  ];
  const cw = ringAreaM2(box);
  const ccw = ringAreaM2([...box].reverse());
  assert.ok(cw > 0);
  assert.ok(Math.abs(cw - ccw) / cw < 1e-9);
});

test('a ring needs three points', () => {
  assert.equal(ringAreaM2([]), 0);
  assert.equal(ringAreaM2([{ lat: 0, lng: 0 }]), 0);
  assert.equal(ringAreaM2([{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }]), 0);
});

test('ring area wraps longitude across the antimeridian', () => {
  const box = (lng0, lng1) => [
    { lat: 0, lng: lng0 },
    { lat: 0, lng: lng1 },
    { lat: 1, lng: lng1 },
    { lat: 1, lng: lng0 },
  ];
  const normal = ringAreaM2(box(10, 11));
  const wrapped = ringAreaM2(box(179.5, -179.5)); // same 1-degree width, crossing 180
  assert.ok(Math.abs(wrapped - normal) / normal < 1e-9, `expected ~${normal}, got ${wrapped}`);
});

test('closeRing leaves an open path unchanged', () => {
  const pts = [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }];
  assert.equal(closeRing(pts, false), pts);
});

test('closeRing wires the last point back to the first when closed with 3+ points', () => {
  const pts = [{ lat: 0, lng: 0 }, { lat: 1, lng: 0 }, { lat: 1, lng: 1 }];
  const result = closeRing(pts, true);
  assert.equal(result.length, 4);
  assert.equal(result[3], pts[0]);
  assert.equal(pts.length, 3); // original array not mutated
});

test('closeRing leaves a too-short closed path unchanged', () => {
  const pts = [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }];
  assert.equal(closeRing(pts, true), pts);
});
