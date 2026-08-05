# Utah's Missing & Unidentified

An interactive, calming map of Utah's missing and unidentified persons — built from a public
[Google My Map](https://www.google.com/maps/d/u/0/viewer?mid=1oSzJorsXgSsXs6oWVNIJh3FgU2-xgWdU).
Click any marker to open a scorecard with the person's photos, case details, links, and a cold-case
tip line. Search and filter by type, gender, and decade. A measure tool draws distances and
areas on the map in US or metric units — drawing requires a pointer, with no keyboard
path to place a vertex. An optional admin panel lets approved
editors attach extra notes, links, images, videos, and files to any case.

Static site — no server required. Hosted on GitHub Pages; the admin layer uses Supabase.

## How the data works

- The **base dataset** (240 people, all photos) is a self-hosted snapshot: `npm run build` fetches the
  live KML, parses it, downloads and resizes every photo into `images/`, and writes `data/data.json`.
  This loads instantly and keeps working even if Google's image URLs change.
- **Live refresh:** the page can re-fetch the Google KML directly (their endpoint sends
  `access-control-allow-origin: *`) — a **Refresh** button and an hourly in-page poll update markers
  in place. Brand-new photos hotlink from Google until the next rebuild folds them into `images/`.
- **Hourly rebuild:** a GitHub Action re-runs the build and redeploys, so the self-hosted snapshot
  stays current automatically.

## Local development

```bash
npm install          # installs @xmldom/xmldom + sharp (build only)
npm run build        # fetch KML, download photos, write data/data.json  (~90s first run)
npm run serve        # serve at http://localhost:8080
npm test             # parser + filter unit tests
```

The site is plain ES modules — no bundler. `src/kml-parser.js` is shared by the Node build and the
browser (live refresh).

## Admin panel (optional — Supabase)

The admin panel at `/admin.html` lets allow-listed editors augment any case. It's dormant until you
configure Supabase; the public map works without it.

1. Create a free project at [supabase.com](https://supabase.com).
2. In the Supabase **SQL editor**, run [`supabase/schema.sql`](supabase/schema.sql) (creates tables,
   Row Level Security, and the `marker-media` storage bucket).
3. In **Project Settings → API**, copy the **Project URL** and **anon public key** into
   [`src/config.js`](src/config.js). The anon key is safe to commit — RLS is what protects writes.
4. In **Authentication → URL Configuration**, add your site URL (e.g.
   `https://tabossert.github.io/utah-missing-unidentified/`) and `http://localhost:8080` to the
   redirect allowlist so magic-link sign-in works.
5. Open `/admin.html`, sign in once with your email (this creates your `auth.users` row), then grant
   yourself admin in the SQL editor:
   ```sql
   insert into public.admins (user_id, email)
   select id, email from auth.users where email = 'you@example.com'
   on conflict (user_id) do nothing;
   ```
   Reload — you now have the editor. Repeat step 5 with another email to add more admins.

Admin additions are stored in Supabase and merged into each scorecard by marker id; they never modify
the base Google My Map data.

## Contact form

**Know something? Contact Us** appears in the header and under the tip line in every case panel.
Opened from a case, the form records which case it's about; opened from the header, it's a general
message. Submissions land in the admin panel's **Messages** tab, newest first, with unread ones
flagged — and, if you set up email below, a copy arrives in your inbox.

The form is explicit that it reaches the map's volunteers and **not** law enforcement, and points at
the Utah Cold Case Tip Line and 911 alongside it.

Setup, once `supabase/schema.sql` has been re-run (it adds `contact_messages`):

```bash
supabase secrets set CONTACT_SALT="$(openssl rand -base64 32)"
supabase functions deploy contact --no-verify-jwt   # public endpoint: senders aren't signed in
```

Writes go through that function using the service-role key, and `contact_messages` has **no insert
policy and no anon read policy** — so the public anon key can neither forge a message nor read one.
A tip carries a name, an email, and a phone number; only allow-listed admins can see it.

### Email notifications (optional)

Add a mail key and each submission is also emailed out. Leave it unset and the form still works —
messages just wait in the admin panel.

```bash
supabase secrets set RESEND_API_KEY="re_..." \
                     CONTACT_EMAIL_FROM="Tips <tips@your-domain>"   # domain must be verified in Resend
supabase secrets set CONTACT_ADMIN_URL="https://…/admin.html"       # optional link in the email
```

**Who gets the email** is the `contact_recipients` table, not a secret — so the list is editable from
the admin panel (Messages tab → *Email notifications*) without redeploying the function. Addresses can
be paused instead of removed. The table ships empty on purpose, so that no real address lives in this
public repo: add the first recipient from the admin panel after signing in. Until one exists, messages
are stored and simply not emailed.

The database row is written first and the email is best effort, so a mail outage can't lose a tip.
`reply_to` is set to the sender **only when they answered "yes"** to being contacted.

Note that [Resend](https://resend.com) is a third party: the notification carries the sender's name,
email, phone, and message through their infrastructure, and they disclosed a breach in January 2024
that exposed customer metadata (not email content). If that trade isn't worth it, leave the mail
secrets unset and read messages in the admin panel only.

### Spam and duplicate submissions

Five layers, all in the edge function except the last two:

- a honeypot field that's off-screen and out of the tab order (deliberately *not* named `website`,
  which password managers autofill);
- a bot user-agent check, the same list the traffic collector uses;
- a time trap — the real form reports how long it was open, and an instant fill is dropped;
- a cap of five messages per sender per day, keyed on the same daily-rotating hash as `visitor_hash`;
- an idempotency window: the same text from the same sender within ten minutes is treated as the
  double submit it is, not a second tip. The submit button also disables while a send is in flight
  and only re-arms on failure.

Every bot rejection returns the same `204` a real send gets, so a probe can't tell which gate it
tripped. Thresholds lean permissive on purpose — losing a real tip costs far more than a spam row.

## Traffic stats

The admin panel's **Traffic** tab shows visitors, views, visits, average visit, bounce rate, who's
online, a map of where visitors are, and top pages / referrers / countries / devices. There's no
third-party analytics service — views are recorded straight into this project's own Supabase, so the
data never leaves it and the requests aren't on any tracker blocklist.

**No cookies, no consent banner.** Nothing is written to a visitor's browser. Instead the collector
hashes ip + user agent + a secret salt + today's date into a `visitor_hash`, which groups a visitor
within a day and cannot be linked across days or back to an IP.

**About the map.** Rows carry an approximate `city`, `lat`, and `lon`. Those coordinates are the geo
provider's *city centroid*, not a visitor's position — everyone in a city resolves to the same point
— and the panel plots one bubble per city, never one per view, so a dot is always a group. It is
still the most identifying thing stored here; `GEO_LOOKUP=off` drops city, coordinates, and country
in one go, and the rest of the panel is unaffected.

Setup, once `supabase/schema.sql` has been re-run (it creates `page_views`, the geo cache, and the
`traffic_stats` aggregate):

```bash
supabase link --project-ref <your-project-ref>
supabase secrets set TRACK_SALT="$(openssl rand -base64 32)"
supabase functions deploy track --no-verify-jwt   # public endpoint: visitors aren't signed in
```

No Supabase CLI? Paste [`supabase/functions/track/index.ts`](supabase/functions/track/index.ts) into
**Edge Functions → Deploy a new function**, turn **Verify JWT** off for it, and add `TRACK_SALT` under
**Edge Functions → Secrets**.

Writes go through that function using the service-role key and `page_views` has no insert policy, so
the public anon key can't forge rows. Reads go through `traffic_stats`, which re-checks the `admins`
allowlist in SQL — raw rows never reach the browser.

### Country lookups

Countries come from [ip-api.com](https://ip-api.com)'s free tier, which is **non-commercial only,
HTTP-only (visitor IPs cross the network unencrypted), and bans callers over 45 requests/minute**.
Results are cached per /24 for 30 days so the API sees a trickle, and the collector honours the
`X-Rl` header. Set `GEO_LOOKUP=off` to skip it entirely — every other panel keeps working and the
country column just stays empty.

### Retention

One row per view; the free tier's 500 MB holds a few million. Worth adding a scheduled
`delete from page_views where created_at < now() - interval '24 months'` before that matters.

## Deployment

Hosted on **GitHub Pages under the personal `tabossert` account only** (never an organization).

- Push to `main` → the `Build & Deploy` workflow publishes the site.
- The same workflow runs hourly to refresh the data snapshot and redeploy.
- Enable Pages once under **Settings → Pages → Source: GitHub Actions**.

## Credits

Data from the community-maintained "Utah's Missing and Unidentified" Google map. Map tiles ©
OpenStreetMap contributors, © CARTO. The forget-me-not is the traditional flower of remembrance for
missing persons.
