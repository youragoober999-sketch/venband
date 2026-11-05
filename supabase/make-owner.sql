-- =============================================================================
-- Make yourself the Venband platform owner — run ONCE, after you've signed up.
--
-- The migrations only grant the owner role to an account that already exists
-- when they run, so on a brand-new database (setup.sql runs before anyone signs
-- up) nobody becomes owner. This fixes that.
--
-- 1. Change the username on the next line if yours isn't "halt".
-- 2. Supabase → SQL Editor → paste this file → Run.
--
-- Only works while there is no owner yet, so it can't be used to take over a
-- platform that already has one.
-- =============================================================================
do $$
declare
  v_username text := 'halt';   -- <- your Venband username (without the @)
  v_id uuid;
begin
  if exists (select 1 from public.profiles where platform_role = 'owner') then
    raise exception 'There is already a platform owner (@%). Nothing was changed.',
      (select username from public.profiles where platform_role = 'owner' limit 1);
  end if;
  select id into v_id from public.profiles where username = lower(v_username);
  if v_id is null then
    raise exception 'No account with the username "%" yet. Sign up on the site first, then run this again.', v_username;
  end if;
  update public.profiles
     set platform_role = 'owner', badges = public.all_badges()
   where id = v_id;
  raise notice '@% is now the platform owner with every badge.', v_username;
end $$;

select username, platform_role, badges from public.profiles where platform_role = 'owner';
