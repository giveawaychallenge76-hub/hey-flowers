-- ═══════════════════════════════════════════════════════════════════════
--  heyflowers — Supabase schema
--  Run this ONCE in your project:  Dashboard → SQL Editor → New query →
--  paste all of this → Run.  Safe to run again (it uses "if not exists").
--
--  WHY YOU CAN'T SEE YOUR SIGNUPS RIGHT NOW
--  Supabase keeps accounts in the hidden `auth.users` table — visible only
--  under  Authentication → Users  (NOT in the Table Editor, which shows the
--  `public` schema). This script mirrors every signup into a normal
--  `public.profiles` table via a trigger, so from now on you can SEE and
--  QUERY them, and the admin dashboard can count them.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. profiles: one visible, queryable row per user ────────────────────
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  plan       text    default 'free',   -- 'free' | 'monthly' | 'annual' | 'lifetime'
  is_admin   boolean default false,
  created_at timestamptz default now()
);

-- copy each NEW signup into profiles automatically
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- backfill anyone who already signed up before you ran this
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;

-- ── 2. admin check (security definer avoids RLS recursion) ──────────────
create or replace function public.is_admin()
returns boolean
language sql
security definer stable set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ── 3. gifts: sent gifts kept with the account ──────────────────────────
create table if not exists public.gifts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade,
  template   text,
  title      text,
  url        text,
  created_at timestamptz default now()
);

-- ── 4. visits: lightweight "who dropped by" analytics ───────────────────
create table if not exists public.visits (
  id   bigint generated always as identity primary key,
  path text,
  ref  text,
  ua   text,
  at   timestamptz default now()
);

-- ── 5. Row Level Security ───────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.gifts    enable row level security;
alter table public.visits   enable row level security;

-- profiles: you see & edit your own row; admins see everyone
drop policy if exists "profiles self read"   on public.profiles;
drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self read"   on public.profiles
  for select using (auth.uid() = id or public.is_admin());
create policy "profiles self update" on public.profiles
  for update using (auth.uid() = id);

-- gifts: you own yours; admins can read all
drop policy if exists "gifts read"   on public.gifts;
drop policy if exists "gifts insert" on public.gifts;
drop policy if exists "gifts delete" on public.gifts;
create policy "gifts read"   on public.gifts
  for select using (auth.uid() = user_id or public.is_admin());
create policy "gifts insert" on public.gifts
  for insert with check (auth.uid() = user_id);
create policy "gifts delete" on public.gifts
  for delete using (auth.uid() = user_id);

-- visits: anyone may log one; only admins may read them
drop policy if exists "visits insert" on public.visits;
drop policy if exists "visits read"   on public.visits;
create policy "visits insert" on public.visits
  for insert with check (true);
create policy "visits read"   on public.visits
  for select using (public.is_admin());

-- ── 6. Storage bucket for photo / music / video uploads ─────────────────
insert into storage.buckets (id, name, public)
values ('gift-media', 'gift-media', true)
on conflict (id) do nothing;

drop policy if exists "media upload" on storage.objects;
drop policy if exists "media read"   on storage.objects;
create policy "media upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'gift-media');
create policy "media read" on storage.objects
  for select using (bucket_id = 'gift-media');

-- ═══════════════════════════════════════════════════════════════════════
--  LAST STEP — make yourself the admin.
--  Sign up on the site first, then run this with YOUR email:
--
--      update public.profiles set is_admin = true
--      where email = 'you@example.com';
--
--  Now open  /admin.html , log in, and you'll see the dashboard.
-- ═══════════════════════════════════════════════════════════════════════
