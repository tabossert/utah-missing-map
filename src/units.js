// Unit ladders and label formatting for the measure tool. Pure — no Leaflet, no
// DOM — so every threshold stays testable under `node --test`.

// Everything derives from the two exact definitions, so no rounded constant can
// drift a boundary comparison.
const M_PER_FT = 0.3048;
const M_PER_MI = 1609.344;
const M2_PER_FT2 = M_PER_FT ** 2;
const M2_PER_SQMI = M_PER_MI ** 2;
const M2_PER_ACRE = M2_PER_SQMI / 640;
const M2_PER_HA = 10_000;
const M2_PER_KM2 = 1_000_000;

const FT_CEILING_M = 1000 * M_PER_FT; // 304.8 m — where feet give way to miles
const LEG_FLOOR_MI_M = M_PER_MI / 10; // 160.9344 m — below this a leg drops to feet

// Three significant figures, capped at two decimals.
function decimalsFor(value) {
  if (value < 10) return 2;
  if (value < 100) return 1;
  return 0;
}

// Rounds, strips trailing zeros, and adds thousands separators.
function num(value, decimals) {
  return Number(value.toFixed(decimals)).toLocaleString('en-US', {
    maximumFractionDigits: decimals,
  });
}

function scaled(value, suffix) {
  return `${num(value, decimalsFor(value))} ${suffix}`;
}

export function pickDistanceUnit(totalMeters, system) {
  if (system === 'metric') return totalMeters < 1000 ? 'm' : 'km';
  return totalMeters < FT_CEILING_M ? 'ft' : 'mi';
}

export function formatDistance(meters, unit) {
  if (unit === 'ft') return `${num(meters / M_PER_FT, 0)} ft`;
  if (unit === 'm') return `${num(meters, 0)} m`;
  if (unit === 'mi') return scaled(meters / M_PER_MI, 'mi');
  return scaled(meters / 1000, 'km');
}

// A leg too short to read in the measurement's own unit drops to ft/m, so a
// 140 ft hop never renders as "0.01 mi".
export function formatLeg(meters, unit) {
  if (unit === 'mi' && meters < LEG_FLOOR_MI_M) return formatDistance(meters, 'ft');
  if (unit === 'km' && meters < 100) return formatDistance(meters, 'm');
  return formatDistance(meters, unit);
}

export function formatArea(m2, system) {
  if (system === 'metric') {
    if (m2 < M2_PER_HA) return `${num(m2, 0)} m²`;
    if (m2 < M2_PER_KM2) return scaled(m2 / M2_PER_HA, 'ha');
    return scaled(m2 / M2_PER_KM2, 'km²');
  }
  if (m2 < M2_PER_ACRE) return `${num(m2 / M2_PER_FT2, 0)} sq ft`;
  if (m2 < M2_PER_SQMI) {
    const acres = m2 / M2_PER_ACRE;
    const d = decimalsFor(acres);
    return `${num(acres, d)} ${Number(acres.toFixed(d)) === 1 ? 'acre' : 'acres'}`;
  }
  return scaled(m2 / M2_PER_SQMI, 'sq mi');
}
