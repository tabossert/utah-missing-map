-- ============================================================================
-- Utah's Missing & Unidentified — Supabase schema
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query) once.
-- Safe to re-run (idempotent).
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

-- keep updated_at fresh
create or replace function public.set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists marker_extras_updated on public.marker_extras;
create trigger marker_extras_updated
  before update on public.marker_extras
  for each row execute function public.set_updated_at();

-- ---- admin check: is the signed-in user's email on the allowlist? ----------
-- SECURITY DEFINER so it can read public.admins without tripping that table's RLS.
create or replace function public.is_admin() returns boolean
  language sql security definer stable
  set search_path = public
as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

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
  for insert with check (public.is_admin());

drop policy if exists "extras admin update" on public.marker_extras;
create policy "extras admin update" on public.marker_extras
  for update using (public.is_admin());

drop policy if exists "extras admin delete" on public.marker_extras;
create policy "extras admin delete" on public.marker_extras
  for delete using (public.is_admin());

-- a signed-in user may read their own allowlist row (to learn they are an admin)
drop policy if exists "admins self read" on public.admins;
create policy "admins self read" on public.admins
  for select using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) or public.is_admin());

-- ============================================================================
-- Storage bucket for uploaded images / videos / files
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('marker-media', 'marker-media', true)
on conflict (id) do nothing;

drop policy if exists "media public read" on storage.objects;
create policy "media public read" on storage.objects
  for select using (bucket_id = 'marker-media');

drop policy if exists "media admin insert" on storage.objects;
create policy "media admin insert" on storage.objects
  for insert with check (bucket_id = 'marker-media' and public.is_admin());

drop policy if exists "media admin update" on storage.objects;
create policy "media admin update" on storage.objects
  for update using (bucket_id = 'marker-media' and public.is_admin());

drop policy if exists "media admin delete" on storage.objects;
create policy "media admin delete" on storage.objects
  for delete using (bucket_id = 'marker-media' and public.is_admin());

-- ============================================================================
-- Grant an admin by email (they become admin the moment they first sign in):
--
--   insert into public.admins (email) values ('you@example.com')
--   on conflict (email) do nothing;
--
-- Repeat with another email to add more admins.
-- ============================================================================
