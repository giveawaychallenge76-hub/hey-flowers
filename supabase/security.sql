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
