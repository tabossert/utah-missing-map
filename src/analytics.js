// Sends a page view to the `track` edge function. Dormant until Supabase is
// configured, and silent on failure — analytics must never affect the page.
import { CONFIG } from './config.js';
import { isConfigured } from './supabase.js';

const endpoint = isConfigured() ? `${CONFIG.supabaseUrl}/functions/v1/track` : null;
let last = null;

export function trackView(path = location.pathname + location.hash) {
  if (!endpoint || path === last) return;
  last = path;
  fetch(endpoint, {
    method: 'POST',
    keepalive: true, // survives the page being closed mid-flight
    headers: { 'content-type': 'application/json', apikey: CONFIG.supabaseAnonKey },
    body: JSON.stringify({ path, referrer: document.referrer }),
  }).catch(() => {});
}

trackView();
// Covers back/forward between cases; opening one goes through replaceState,
// which fires nothing, so scorecard.js calls trackView() directly.
addEventListener('hashchange', () => trackView());
