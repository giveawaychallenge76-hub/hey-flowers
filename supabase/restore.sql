-- ═══════════════════════════════════════════════════════════════════════
--  heyflowers — rebuild after the restore
--
--  The project came back but its public schema did not: profiles, gifts
--  and visits were all missing, and the open_gift function with them. The
--  signup trigger on auth.users DID survive, so every signup was failing
--  with "Database error finding user" — it was trying to write a row into
--  a profiles table that no longer existed.
--
--  This is schema.sql followed by security.sql, in that order (the second
--  tightens a policy the first one opens). Every statement is guarded with
--  "if exists" / "if not exists", so running it twice is harmless.
--
--  WHERE: Supabase dashboard → SQL Editor → New query → paste → Run.
-- ═══════════════════════════════════════════════════════════════════════

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

-- ═══════════════════════════════════════════════════════════════════════
--  SHORT LINKS  (run this to make gift links short)
--  Without it the whole gift is crammed into the URL, which makes links
--  thousands of characters long — too long for Instagram, and far too big
--  to fit in a QR code.
-- ═══════════════════════════════════════════════════════════════════════

-- the gift's contents, so the URL only has to carry a short id
alter table public.gifts add column if not exists payload text;
alter table public.gifts add column if not exists slug   text;
create unique index if not exists gifts_slug_idx on public.gifts(slug);

-- anyone holding the link may read that one gift (that's the point of a
-- share link); listing them all still requires being the owner or admin
drop policy if exists "gifts read"        on public.gifts;
drop policy if exists "gifts read by slug" on public.gifts;
create policy "gifts read by slug" on public.gifts
  for select using (true);

-- signed-in people can save their own; keep insert owner-checked
drop policy if exists "gifts insert" on public.gifts;
create policy "gifts insert" on public.gifts
  for insert with check (auth.uid() = user_id);


-- ═══════════════════════════════════════════════════════════════════════
--  SECURITY FIX — stop anyone dumping every gift
--  Run this in Supabase → SQL Editor → New query → Run.
--
--  THE PROBLEM
--  Short links needed strangers to open ONE gift without an account, and
--  the policy that allowed it was "using (true)" — which also let anyone
--  list EVERY gift, payloads included. Those payloads hold people's
--  private messages and photos.
--
--  THE FIX
--  Reading the table now requires being the owner or an admin. Opening a
--  gift by its exact slug goes through a function instead, which returns
--  that one row and nothing else — you can't enumerate with it.
-- ═══════════════════════════════════════════════════════════════════════

-- 1. table reads: owner or admin only
drop policy if exists "gifts read by slug" on public.gifts;
drop policy if exists "gifts read"         on public.gifts;
create policy "gifts read" on public.gifts
  for select using (auth.uid() = user_id or public.is_admin());

-- 2. one gift, by exact slug. SECURITY DEFINER so it can see past RLS,
--    but it only ever returns the single matching row.
create or replace function public.open_gift(p_slug text)
returns table (template text, payload text)
language sql
security definer
stable
set search_path = public
as $$
  select g.template, g.payload
  from public.gifts g
  where g.slug = p_slug
  limit 1;
$$;

revoke all on function public.open_gift(text) from public;
grant execute on function public.open_gift(text) to anon, authenticated;

-- 3. senders may still delete their own
drop policy if exists "gifts delete" on public.gifts;
create policy "gifts delete" on public.gifts
  for delete using (auth.uid() = user_id);
