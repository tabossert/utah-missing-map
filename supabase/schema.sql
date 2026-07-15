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
-- Grant an admin by email (they become admin the moment they first sign in):
--
--   insert into public.admins (email) values ('you@example.com')
--   on conflict (email) do nothing;
--
-- Repeat with another email to add more admins.
-- ============================================================================
