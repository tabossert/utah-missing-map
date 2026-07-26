# Utah's Missing & Unidentified

An interactive, calming map of Utah's missing and unidentified persons — built from a public
[Google My Map](https://www.google.com/maps/d/u/0/viewer?mid=1oSzJorsXgSsXs6oWVNIJh3FgU2-xgWdU).
Click any marker to open a scorecard with the person's photos, case details, links, and a cold-case
tip line. Search and filter by type, gender, and decade. An optional admin panel lets approved
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
