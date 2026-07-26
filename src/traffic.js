// Pure shaping helpers for the admin traffic panel. No DOM, so they unit-test.

export const RANGES = [
  { key: '24h', label: '24 hours' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '12mo', label: '12 months' },
];

const counter = new Intl.NumberFormat('en-US');

export function formatCount(n) {
  return Number.isFinite(Number(n)) ? counter.format(Math.round(Number(n))) : '—';
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function bounceRate(stats = {}) {
  const visits = Number(stats.visits) || 0;
  if (!visits) return '—';
  return `${Math.round((Number(stats.bounces) || 0) / visits * 100)}%`;
}

export function avgVisitSeconds(stats = {}) {
  const visits = Number(stats.visits) || 0;
  return visits ? (Number(stats.totaltime) || 0) / visits : 0;
}

// '' is how Umami reports a visit with no referrer.
export function referrerLabel(x) {
  if (!x) return 'Direct / none';
  return String(x).replace(/^https?:\/\//, '').replace(/\/$/, '');
}

// Rows for a horizontal bar list: share is relative to the biggest row.
export function topRows(metrics, limit = 8, label = (x) => String(x ?? '')) {
  const rows = (Array.isArray(metrics) ? metrics : [])
    .map((m) => ({ label: label(m.x), value: Number(m.y) || 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
  const max = rows.length ? rows[0].value : 0;
  return rows.map((r) => ({ ...r, share: max ? r.value / max : 0 }));
}

// Bubble radius in px. Area (not radius) tracks the count, so a city with 4x
// the visitors looks 4x bigger rather than 16x; sqrt keeps big cities readable.
export function bubbleRadius(visitors, max, min = 5, cap = 26) {
  const v = Math.max(0, Number(visitors) || 0);
  const m = Math.max(1, Number(max) || 1);
  return +(min + (cap - min) * Math.sqrt(Math.min(v, m) / m)).toFixed(1);
}

// Polyline through the series, scaled to fill a width x height viewBox.
// Returns '' when there is nothing to draw.
export function sparklinePath(series, width = 100, height = 30) {
  const pts = (Array.isArray(series) ? series : []).map((p) => Number(p.y) || 0);
  if (pts.length < 2) return '';
  const max = Math.max(...pts);
  const step = width / (pts.length - 1);
  return pts
    .map((y, i) => {
      const px = +(i * step).toFixed(2);
      const py = +(height - (max ? (y / max) * height : 0)).toFixed(2);
      return `${i ? 'L' : 'M'}${px},${py}`;
    })
    .join(' ');
}
