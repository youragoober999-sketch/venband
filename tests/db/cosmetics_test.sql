-- Cosmetics + new badges (20261106040000_cosmetics_badges.sql). Runs after all migrations.
create function pg_temp.ct_must_fail(p_sql text, p_expect text default null) returns void language plpgsql as $$
declare n bigint;
begin
  begin
    execute p_sql;
    -- real Supabase: row-level security filters the rows instead of raising
    get diagnostics n = row_count;
    if n = 0 and p_expect is null and p_sql ~* '^\s*(update|delete)\s' then return; end if;
  exception when others then
    if p_expect is not null and position(lower(p_expect) in lower(sqlerrm)) = 0 then
      raise exception 'failed for the wrong reason: % (wanted "%") — %', sqlerrm, p_expect, p_sql;
    end if;
    return;
  end;
  raise exception 'expected failure but succeeded: %', p_sql;
end $$;

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('c0500000-0000-4000-8000-000000000001', 'cos1@example.com', '{"username":"cosone"}'),
  ('c0500000-0000-4000-8000-000000000002', 'cosmod@example.com', '{"username":"cosmod"}'),
  ('c0500000-0000-4000-8000-000000000003', 'cosadmin@example.com', '{"username":"cosadmin"}');
update public.profiles set platform_role = 'moderator' where id = 'c0500000-0000-4000-8000-000000000002';
update public.profiles set platform_role = 'admin' where id = 'c0500000-0000-4000-8000-000000000003';

set role authenticated;
select set_config('request.jwt.claim.sub', 'c0500000-0000-4000-8000-000000000001', false);
-- anyone can pick the new nameplates, frames and a profile effect for themselves
update public.profiles set nameplate = 'synthwave', avatar_frame = 'galaxy', profile_effect = 'sakura' where id = auth.uid();
do $t$ begin
  assert (select nameplate || '/' || avatar_frame || '/' || profile_effect from public.profiles where id = auth.uid()) = 'synthwave/galaxy/sakura';
end $t$;
select pg_temp.ct_must_fail($$update public.profiles set profile_effect = 'javascript:alert(1)' where id = auth.uid()$$, 'profile_effect');
select pg_temp.ct_must_fail($$update public.profiles set avatar_frame = 'nope' where id = auth.uid()$$, 'avatar_frame');
-- …but nobody sets another person's
update public.profiles set profile_effect = 'hearts' where id = 'c0500000-0000-4000-8000-000000000002';
reset role;
do $t$ begin
  assert (select profile_effect from public.profiles where id = 'c0500000-0000-4000-8000-000000000002') = 'none', 'RLS keeps other profiles unchanged';
end $t$;

-- new badges exist; developer + verified ones are admin-only, like staff badges
set role authenticated;
select set_config('request.jwt.claim.sub', 'c0500000-0000-4000-8000-000000000002', false);
select public.mod_set_badges('c0500000-0000-4000-8000-000000000001', array['contributor', 'beta_tester']);
select pg_temp.ct_must_fail($$select public.mod_set_badges('c0500000-0000-4000-8000-000000000001', array['contributor', 'verified'])$$, 'only admins');
select pg_temp.ct_must_fail($$select public.mod_set_badges('c0500000-0000-4000-8000-000000000001', array['developer'])$$, 'only admins');
select set_config('request.jwt.claim.sub', 'c0500000-0000-4000-8000-000000000003', false);
select public.mod_set_badges('c0500000-0000-4000-8000-000000000001', array['developer', 'verified', 'verified_bot', 'verified_server', 'contributor']);
reset role;
do $t$ begin
  assert (select badges from public.profiles where id = 'c0500000-0000-4000-8000-000000000001')
         = array['contributor', 'developer', 'verified', 'verified_bot', 'verified_server'], 'admin can award them';
  assert 'developer' = any (public.protected_badges()), 'developer always shows';
end $t$;
-- the holder can't hide the developer badge (it's never stored in the display list)
set role authenticated;
select set_config('request.jwt.claim.sub', 'c0500000-0000-4000-8000-000000000001', false);
do $t$ begin
  assert public.set_badge_display(array['developer', 'verified']) = array['verified'];
end $t$;
reset role;
