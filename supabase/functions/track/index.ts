// Page-view collector. Public by design — deploy with JWT verification OFF:
//
//   supabase secrets set TRACK_SALT="$(openssl rand -base64 32)"
//   supabase functions deploy track --no-verify-jwt
//
// Visitors are never given an identifier. visitor_hash is sha256 of
// ip + user agent + a secret salt + today's date, so it groups a visitor within
// one day and cannot be linked across days or back to an IP.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SALT = Deno.env.get('TRACK_SALT') || '';
const GEO_ON = (Deno.env.get('GEO_LOOKUP') || 'on') !== 'off';
const GEO_TTL_DAYS = 30;

const BOT = /bot|crawl|spider|slurp|search|fetch|monitor|preview|scrape|headless|lighthouse|pingdom|curl|wget|python-|axios|okhttp|java\/|go-http/i;
const TABLET = /ipad|tablet|playbook|silk|kindle|android(?!.*mobile)/i;
const MOBILE = /mobile|iphone|ipod|android|blackberry|iemobile|opera mini|webos/i;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const sha256 = async (s: string) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

const rest = (path: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
      ...(init.headers as Record<string, string>),
    },
  });

// ip-api bans for an hour past 45 req/min, and every edge function shares an
// egress IP — so honour X-Rl and sit out the window it tells us about.
let geoPausedUntil = 0;

// A /24 (or /48) is enough for a country and keeps the cache key coarse.
function ipPrefix(ip: string): string {
  if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':');
  const p = ip.split('.');
  return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}` : ip;
}

async function country(ip: string): Promise<string | null> {
  if (!GEO_ON || !ip) return null;
  const key = await sha256(`${ipPrefix(ip)}|${SALT}`);
  try {
    const hit = await rest(`ip_geo_cache?ip_hash=eq.${key}&select=country,cached_at`).then((r) => r.json());
    if (Array.isArray(hit) && hit.length) {
      const age = Date.now() - Date.parse(hit[0].cached_at);
      if (age < GEO_TTL_DAYS * 86_400_000) return hit[0].country;
    }
    if (Date.now() < geoPausedUntil) return null;

    // Free tier is HTTP-only; only the IP and a country code cross the wire.
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,countryCode`, {
      signal: AbortSignal.timeout(1500),
    });
    const left = Number(res.headers.get('X-Rl') ?? '1');
    if (left <= 0) geoPausedUntil = Date.now() + (Number(res.headers.get('X-Ttl') ?? '60') + 1) * 1000;
    if (!res.ok) return null;

    const body = await res.json();
    const cc = body.status === 'success' ? String(body.countryCode || '').slice(0, 2) : null;
    await rest('ip_geo_cache?on_conflict=ip_hash', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ ip_hash: key, country: cc, cached_at: new Date().toISOString() }),
    });
    return cc;
  } catch {
    return null; // geo is decoration; never let it cost us the page view
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: CORS });

  const ua = req.headers.get('user-agent') || '';
  // Bots that run JS are rare, but the cheap check keeps the obvious ones out.
  if (!ua || BOT.test(ua)) return new Response(null, { status: 204, headers: CORS });

  const body = await req.json().catch(() => ({}));
  let path = String(body.path || '/').slice(0, 512);
  if (!path.startsWith('/')) path = `/${path}`;

  // An internal navigation isn't a referrer.
  let referrerHost: string | null = null;
  try {
    const r = new URL(String(body.referrer || ''));
    const self = req.headers.get('origin');
    if (!self || new URL(self).hostname !== r.hostname) referrerHost = r.hostname.slice(0, 253);
  } catch { /* absent or unparseable referrer */ }

  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  const day = new Date().toISOString().slice(0, 10);
  const visitorHash = (await sha256(`${ip}|${ua}|${SALT}|${day}`)).slice(0, 32);
  const device = TABLET.test(ua) ? 'tablet' : MOBILE.test(ua) ? 'mobile' : 'desktop';

  const res = await rest('page_views', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      path,
      referrer_host: referrerHost,
      visitor_hash: visitorHash,
      country: await country(ip),
      device,
    }),
  });
  if (!res.ok) console.error('insert failed', res.status, (await res.text()).slice(0, 200));

  return new Response(null, { status: 204, headers: CORS });
});
