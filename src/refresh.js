// Live refresh: fetch the Google KML directly (CORS-enabled) and merge it over
// the current dataset. Known people keep their self-hosted photos + admin extras;
// brand-new people hotlink their Google photos until the next server rebuild.
import { parseKml } from './kml-parser.js';
import { CONFIG } from './config.js';

const sizedUrl = (url) => url.replace(/fife=s\d+/, 'fife=s1400');

export async function refreshLive(currentPeople) {
  const res = await fetch(CONFIG.kmlUrl, { cache: 'no-store' });
  if (!res.ok) throw new Error(`KML ${res.status}`);
  const kml = await res.text();
  const fresh = parseKml(kml); // browser native DOMParser

  const byId = new Map(currentPeople.map((p) => [p.id, p]));
  for (const p of fresh) {
    const prev = byId.get(p.id);
    p.photos = p.photos.map((ph, i) => ({
      src: sizedUrl(ph.src),
      // reuse the self-hosted file from the snapshot when this person already existed
      local: prev && prev.photos[i] ? prev.photos[i].local : null,
    }));
    p.extras = prev ? prev.extras || [] : [];
  }
  return fresh;
}

// "Updated 4m ago" style relative label.
export function relativeTime(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}
