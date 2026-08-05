// Spherical geodesy for the measure tool. Pure — no Leaflet, no DOM — so the
// math stays testable under `node --test`.

// Mean Earth radius, the value Leaflet's own distanceTo uses.
export const EARTH_R = 6371008.8;

const rad = (deg) => (deg * Math.PI) / 180;

export function distanceMeters(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pathLengthMeters(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceMeters(points[i - 1], points[i]);
  return total;
}

// Spherical excess over the ring implied by `points` (last wired back to the
// first). The sign follows the winding direction, so take the magnitude.
export function ringAreaM2(points) {
  const n = points.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    sum += rad(p2.lng - p1.lng) * (2 + Math.sin(rad(p1.lat)) + Math.sin(rad(p2.lat)));
  }
  return Math.abs((sum * EARTH_R * EARTH_R) / 2);
}
