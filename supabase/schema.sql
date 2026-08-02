-- ============================================================================
-- Utah's Missing & Unidentified — Supabase schema
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query) once.
-- Safe to re-run (idempotent). Passes the Supabase security advisor clean.
-- ============================================================================

-- ---- admins allowlist (by email, so it can be seeded before first login) ----
create table if not exists public.admins (
  email      text primary key,
  created_at timestamptz not null default now()
);

-- ---- admin-added content, merged into a marker's scorecard by marker_id -----
create table if not exists public.marker_extras (
  id           uuid primary key default gen_random_uuid(),
  marker_id    text not null,
  kind         text not null check (kind in ('note', 'link', 'image', 'video', 'file')),
  title        text,
  body         text,
  url          text,
  storage_path text,
  sort         int  not null default 0,
  created_by   uuid references auth.users (id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists marker_extras_marker_id_idx on public.marker_extras (marker_id);

-- keep updated_at fresh (search_path pinned per security advisor)
create or replace function public.set_updated_at() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists marker_extras_updated on public.marker_extras;
create trigger marker_extras_updated
  before update on public.marker_extras
  for each row execute function public.set_updated_at();

-- ---- admin check ------------------------------------------------------------
-- Lives in a `private` schema (NOT exposed by PostgREST, so it can't be called
-- as an RPC) and is SECURITY DEFINER so it reads public.admins without tripping
-- that table's RLS. Returns whether the signed-in user's email is allow-listed.
create schema if not exists private;
grant usage on schema private to anon, authenticated;

create or replace function private.is_admin() returns boolean
  language sql security definer stable
  set search_path = ''
as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
grant execute on function private.is_admin() to anon, authenticated;

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.marker_extras enable row level security;
alter table public.admins        enable row level security;

-- everyone (including anonymous visitors) may READ extras (public case content)
drop policy if exists "extras public read" on public.marker_extras;
create policy "extras public read" on public.marker_extras
  for select using (true);

-- only admins may write extras
drop policy if exists "extras admin insert" on public.marker_extras;
create policy "extras admin insert" on public.marker_extras
  for insert with check (private.is_admin());

drop policy if exists "extras admin update" on public.marker_extras;
create policy "extras admin update" on public.marker_extras
  for update using (private.is_admin());

drop policy if exists "extras admin delete" on public.marker_extras;
create policy "extras admin delete" on public.marker_extras
  for delete using (private.is_admin());

-- a signed-in user may read their own allowlist row (to learn they are an admin)
drop policy if exists "admins self read" on public.admins;
create policy "admins self read" on public.admins
  for select using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) or private.is_admin());

-- ============================================================================
-- Storage bucket for uploaded images / videos / files
-- Public bucket → objects are readable via their public URL with NO select
-- policy (adding one would let clients list/enumerate the whole bucket).
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('marker-media', 'marker-media', true)
on conflict (id) do nothing;

drop policy if exists "media admin insert" on storage.objects;
create policy "media admin insert" on storage.objects
  for insert with check (bucket_id = 'marker-media' and private.is_admin());

drop policy if exists "media admin update" on storage.objects;
create policy "media admin update" on storage.objects
  for update using (bucket_id = 'marker-media' and private.is_admin());

drop policy if exists "media admin delete" on storage.objects;
create policy "media admin delete" on storage.objects
  for delete using (bucket_id = 'marker-media' and private.is_admin());

-- ============================================================================
-- Site traffic
-- One row per page view, written only by the `track` edge function (which holds
-- the service-role key). No visitor identifier is stored: visitor_hash is a
-- daily-rotating hash of ip + user agent, so it groups a visitor within a day
-- and is unlinkable across days. Nothing is written to visitors' browsers, so
-- no consent banner is needed.
-- ============================================================================
-- lat/lon are the geo provider's *city centroid*, not a visitor's position —
-- everyone in a city shares one coordinate, and the panel aggregates by city.
create table if not exists public.page_views (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  path          text not null,
  referrer_host text,
  visitor_hash  text not null,
  country       text,
  device        text,
  city          text,
  lat           double precision,
  lon           double precision
);
alter table public.page_views add column if not exists city text;
alter table public.page_views add column if not exists lat  double precision;
alter table public.page_views add column if not exists lon  double precision;
create index if not exists page_views_created_at_idx on public.page_views (created_at desc);
create index if not exists page_views_visitor_idx on public.page_views (visitor_hash, created_at);

-- Country lookups are cached per /24 (hashed) so the geo API sees a trickle of
-- requests rather than one per page view — it bans over 45/min.
create table if not exists public.ip_geo_cache (
  ip_hash   text primary key,
  country   text,
  city      text,
  lat       double precision,
  lon       double precision,
  cached_at timestamptz not null default now()
);
alter table public.ip_geo_cache add column if not exists city text;
alter table public.ip_geo_cache add column if not exists lat  double precision;
alter table public.ip_geo_cache add column if not exists lon  double precision;

alter table public.page_views  enable row level security;
alter table public.ip_geo_cache enable row level security;

-- No insert/update policy at all: writes are service-role only, so the public
-- anon key cannot forge or alter traffic. Admins may read the raw rows.
-- ip_geo_cache deliberately gets no policy either — nothing outside the
-- collector has any reason to read it, and service-role bypasses RLS.
drop policy if exists "page_views admin read" on public.page_views;
create policy "page_views admin read" on public.page_views
  for select using (private.is_admin());

-- ---- aggregate for the admin panel -----------------------------------------
-- Sessions are derived at query time (a >30 min gap starts a new one) rather
-- than stamped on the row, so the definition can change without a backfill.
create or replace function public.traffic_stats(range_key text default '30d', tz text default 'UTC')
  returns jsonb
  language plpgsql security definer stable
  set search_path = ''
as $$
declare
  _start  timestamptz;
  _bucket text;
  _out    jsonb;
begin
  if not private.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  _start := now() - case range_key
    when '24h'  then interval '24 hours'
    when '7d'   then interval '7 days'
    when '12mo' then interval '365 days'
    else             interval '30 days'
  end;
  _bucket := case range_key when '24h' then 'hour' when '12mo' then 'month' else 'day' end;

  with ev as (
    select visitor_hash, created_at, path,
           coalesce(referrer_host, '') as referrer_host,
           coalesce(country, '')       as country,
           coalesce(device, '')        as device,
           case
             when lag(created_at) over w is null
               or created_at - lag(created_at) over w > interval '30 minutes'
             then 1 else 0
           end as new_session
    from public.page_views
    where created_at >= _start
    window w as (partition by visitor_hash order by created_at)
  ),
  marked as (
    select *, sum(new_session) over (
      partition by visitor_hash order by created_at rows unbounded preceding
    ) as session_no
    from ev
  ),
  sessions as (
    select visitor_hash, session_no, count(*) as views,
           extract(epoch from max(created_at) - min(created_at)) as secs
    from marked group by visitor_hash, session_no
  )
  select jsonb_build_object(
    'range', range_key,
    'stats', jsonb_build_object(
      'pageviews', (select count(*) from ev),
      'visitors',  (select count(distinct visitor_hash) from ev),
      'visits',    (select count(*) from sessions),
      'bounces',   (select count(*) from sessions where views = 1),
      'totaltime', (select coalesce(sum(secs), 0) from sessions)
    ),
    'active', (
      select count(distinct visitor_hash) from public.page_views
      where created_at >= now() - interval '5 minutes'
    ),
    'series', (
      select coalesce(jsonb_agg(jsonb_build_object('x', b, 'y', c) order by b), '[]'::jsonb)
      from (
        select date_trunc(_bucket, created_at at time zone tz) as b, count(*) as c
        from ev group by 1
      ) t
    ),
    'pages',     (select public.traffic_top('path', _start)),
    'referrers', (select public.traffic_top('referrer_host', _start)),
    'countries', (select public.traffic_top('country', _start)),
    'devices',   (select public.traffic_top('device', _start)),
    -- One point per city, never per view, so a dot is always a group.
    'cities', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'city', city, 'country', country, 'lat', lat, 'lon', lon,
               'visitors', visitors, 'views', views) order by visitors desc), '[]'::jsonb)
      from (
        select city, min(country) as country, lat, lon,
               count(distinct visitor_hash) as visitors, count(*) as views
        from public.page_views
        where created_at >= _start and lat is not null and lon is not null
        group by city, lat, lon
        order by visitors desc
        limit 200
      ) c
    )
  ) into _out;

  return _out;
end;
$$;

-- Top 8 values of one column. Column name is whitelisted, never interpolated raw.
create or replace function public.traffic_top(col text, since timestamptz)
  returns jsonb
  language plpgsql security definer stable
  set search_path = ''
as $$
declare _out jsonb;
begin
  if col not in ('path', 'referrer_host', 'country', 'device') then
    raise exception 'bad column %', col;
  end if;
  execute format(
    'select coalesce(jsonb_agg(jsonb_build_object(''x'', v, ''y'', c) order by c desc), ''[]''::jsonb)
       from (select coalesce(%I, '''') as v, count(*) as c from public.page_views
             where created_at >= $1 group by 1 order by c desc limit 8) t', col)
  into _out using since;
  return _out;
end;
$$;

revoke all on function public.traffic_stats(text, text) from public, anon;
revoke all on function public.traffic_top(text, timestamptz) from public, anon, authenticated;
grant execute on function public.traffic_stats(text, text) to authenticated;

-- ============================================================================
-- Contact / tip messages
-- Written only by the `contact` edge function (which holds the service-role
-- key), so the public anon key can neither forge a submission nor read one.
-- submitter_hash is the same daily-rotating construction as visitor_hash — it
-- only exists to cap how many messages one sender can file in a day.
-- ============================================================================
create table if not exists public.contact_messages (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  first_name     text not null,
  last_name      text,
  email          text not null,
  phone          text,
  may_contact    boolean not null default true,
  message        text not null,
  marker_id      text,   -- set when the form was opened from a case panel
  marker_name    text,   -- denormalised: the case may later leave the map
  submitter_hash text,
  read_at        timestamptz
);
create index if not exists contact_messages_created_at_idx on public.contact_messages (created_at desc);
create index if not exists contact_messages_submitter_idx on public.contact_messages (submitter_hash);

alter table public.contact_messages enable row level security;

-- No insert policy at all: writes are service-role only. Admins read, mark
-- read, and delete. Anonymous visitors can do none of the three — a tip
-- carries a name, an email, and a phone number, so it must never be public.
drop policy if exists "contact admin read" on public.contact_messages;
create policy "contact admin read" on public.contact_messages
  for select using (private.is_admin());

drop policy if exists "contact admin update" on public.contact_messages;
create policy "contact admin update" on public.contact_messages
  for update using (private.is_admin());

drop policy if exists "contact admin delete" on public.contact_messages;
create policy "contact admin delete" on public.contact_messages
  for delete using (private.is_admin());

-- ---- who gets notified of a new message -------------------------------------
-- The `contact` edge function reads this list with the service-role key and
-- emails every active address. Manage it from the admin panel's Messages tab.
create table if not exists public.contact_recipients (
  email      text primary key,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Deliberately unseeded — an address committed here would be a public one. Add
-- recipients from the admin panel (Messages tab → Email notifications), or:
--   insert into public.contact_recipients (email) values ('you@example.com')
--   on conflict (email) do nothing;
-- With nobody listed, messages are still stored; they just aren't emailed.

alter table public.contact_recipients enable row level security;

-- Admins only, in both directions: this list is who to reach, not public info.
drop policy if exists "recipients admin read" on public.contact_recipients;
create policy "recipients admin read" on public.contact_recipients
  for select using (private.is_admin());

drop policy if exists "recipients admin insert" on public.contact_recipients;
create policy "recipients admin insert" on public.contact_recipients
  for insert with check (private.is_admin());

drop policy if exists "recipients admin update" on public.contact_recipients;
create policy "recipients admin update" on public.contact_recipients
  for update using (private.is_admin());

drop policy if exists "recipients admin delete" on public.contact_recipients;
create policy "recipients admin delete" on public.contact_recipients
  for delete using (private.is_admin());

-- ============================================================================
-- Grant an admin by email (they become admin the moment they first sign in):
--
--   insert into public.admins (email) values ('you@example.com')
--   on conflict (email) do nothing;
--
-- Repeat with another email to add more admins.
-- ============================================================================
