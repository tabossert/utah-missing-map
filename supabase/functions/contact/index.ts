// Contact / tip form receiver. Public by design — deploy with JWT verification OFF:
//
//   supabase secrets set CONTACT_SALT="$(openssl rand -base64 32)"
//   supabase secrets set RESEND_API_KEY="re_..." \
//                        CONTACT_EMAIL_FROM="Tips <tips@your-domain>"
//   supabase functions deploy contact --no-verify-jwt
//
// Who gets notified is the public.contact_recipients table, not a secret, so
// the list is editable from the admin panel. The contact_messages row is the
// source of truth; the email is best effort and never costs us a submission.
// Leave RESEND_API_KEY unset and the form still works — messages just wait in
// the admin panel.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SALT = Deno.env.get('CONTACT_SALT') || Deno.env.get('TRACK_SALT') || '';
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') || '';
const MAIL_FROM = Deno.env.get('CONTACT_EMAIL_FROM') || 'onboarding@resend.dev';
const ADMIN_URL = Deno.env.get('CONTACT_ADMIN_URL') || '';

// One sender (hashed ip + ua, rotating daily) may file this many per day.
const MAX_PER_DAY = 5;
// Nobody types a name, an email, and a message in under this. Bots do. Kept
// low deliberately: a dropped tip is far costlier here than a spam row.
const MIN_FILL_MS = 2000;
// A resend of the same text this soon is a double submit, not a second tip.
const DUPE_WINDOW_MIN = 10;

const BOT = /bot|crawl|spider|slurp|search|fetch|monitor|preview|scrape|headless|lighthouse|pingdom|curl|wget|python-|axios|okhttp|java\/|go-http/i;

const MAX = {
  first_name: 80,
  last_name: 80,
  email: 254,
  phone: 40,
  message: 5000,
  marker_id: 200,
  marker_name: 200,
};
const EMAIL_RE = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });

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

const clean = (v: unknown, limit: number) => String(v ?? '').trim().slice(0, limit);

// Notification only — the row is already saved by the time this runs.
async function notify(row: Record<string, unknown>) {
  if (!RESEND_KEY) return;

  // Recipients live in the database, not in a secret, so the list can be
  // edited from the admin panel without redeploying the function.
  const list = await rest('contact_recipients?active=is.true&select=email')
    .then((r) => r.json())
    .catch(() => []);
  const to = Array.isArray(list) ? list.map((r: { email: string }) => r.email).filter(Boolean) : [];
  if (!to.length) return;

  const who = [row.first_name, row.last_name].filter(Boolean).join(' ');
  const about = row.marker_name ? `about ${row.marker_name}` : '(general enquiry)';
  const lines = [
    `From:    ${who} <${row.email}>`,
    row.phone ? `Phone:   ${row.phone}` : null,
    `May contact: ${row.may_contact ? 'yes' : 'NO — they asked not to be contacted'}`,
    `Case:    ${row.marker_name || '—'}`,
    '',
    String(row.message),
    '',
    ADMIN_URL ? `Manage: ${ADMIN_URL}` : null,
  ].filter(Boolean);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: MAIL_FROM,
      to,
      subject: `New message from ${who} ${about}`,
      text: lines.join('\n'),
      // Replying must not be a way to ignore the sender's own answer.
      ...(row.may_contact ? { reply_to: row.email } : {}),
    }),
  });
  if (!res.ok) console.error('notify failed', res.status, (await res.text()).slice(0, 200));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const ua = req.headers.get('user-agent') || '';
  const body = await req.json().catch(() => ({}));

  // Bot checks all answer 204 — the same reply a real send gets — so a probe
  // can't tell which gate it tripped, or that a gate exists at all.
  const drop = new Response(null, { status: 204, headers: CORS });
  if (!ua || BOT.test(ua)) return drop;
  if (clean(body.website, 200)) return drop; // honeypot: a field no human sees
  // Absent counts as failed: the real form always sends it, so a payload
  // without one was assembled by something that never opened the form.
  const elapsed = Number(body.elapsed_ms);
  if (!Number.isFinite(elapsed) || elapsed < MIN_FILL_MS) return drop;

  const row = {
    first_name: clean(body.first_name, MAX.first_name),
    last_name: clean(body.last_name, MAX.last_name) || null,
    email: clean(body.email, MAX.email),
    phone: clean(body.phone, MAX.phone) || null,
    may_contact: body.may_contact !== false,
    message: clean(body.message, MAX.message),
    marker_id: clean(body.marker_id, MAX.marker_id) || null,
    marker_name: clean(body.marker_name, MAX.marker_name) || null,
    submitter_hash: null as string | null,
  };

  if (!row.first_name) return json({ error: 'Please enter your first name.' }, 400);
  if (!EMAIL_RE.test(row.email)) return json({ error: 'Please enter a valid email address.' }, 400);
  if (!row.message) return json({ error: 'Please enter a message.' }, 400);

  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  const day = new Date().toISOString().slice(0, 10);
  row.submitter_hash = (await sha256(`${ip}|${ua}|${SALT}|${day}`)).slice(0, 32);

  // The hash already scopes to today, so these rows are today's submissions.
  const seen: Array<{ created_at: string; message: string }> = await rest(
    `contact_messages?submitter_hash=eq.${row.submitter_hash}` +
      `&select=created_at,message&order=created_at.desc&limit=${MAX_PER_DAY}`,
  )
    .then((r) => r.json())
    .catch(() => []);

  if (Array.isArray(seen)) {
    // Idempotency: a retried or double-posted send (network blip, back button,
    // impatient tap) must not become a second copy of the same tip. Report the
    // success the sender already earned rather than an error they can't act on.
    const cutoff = Date.now() - DUPE_WINDOW_MIN * 60_000;
    if (seen.some((r) => r.message === row.message && Date.parse(r.created_at) > cutoff)) return drop;

    if (seen.length >= MAX_PER_DAY) {
      return json({ error: "You've sent several messages today. Please try again tomorrow." }, 429);
    }
  }

  const res = await rest('contact_messages', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    console.error('insert failed', res.status, (await res.text()).slice(0, 200));
    return json({ error: "Sorry — we couldn't save your message. Please try again." }, 500);
  }

  try {
    await notify(row);
  } catch (err) {
    console.error('notify threw', err); // the message is saved; delivery is extra
  }

  return new Response(null, { status: 204, headers: CORS });
});
