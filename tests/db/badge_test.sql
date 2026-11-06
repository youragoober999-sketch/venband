-- Badges: display choices, limited/retired badges, award notifications
-- (20261106020000_badge_catalog.sql). Runs after all migrations.
create function pg_temp.bt_must_fail(p_sql text, p_expect text default null) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if p_expect is not null and position(lower(p_expect) in lower(sqlerrm)) = 0 then
      raise exception 'failed for the wrong reason: % (wanted "%") — %', sqlerrm, p_expect, p_sql;
    end if;
    return;
  end;
  raise exception 'expected failure but succeeded: %', p_sql;
end $$;
create function pg_temp.bt_as(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_id::text, false);
$$;

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('ba000000-0000-4000-8000-000000000001', 'holder@example.com', '{"username":"badgeholder"}'),
  ('ba000000-0000-4000-8000-000000000002', 'badmin@example.com', '{"username":"badgeadmin"}'),
  ('ba000000-0000-4000-8000-000000000003', 'bowner@example.com', '{"username":"badgeowner"}');
update public.profiles set platform_role = 'admin' where id = 'ba000000-0000-4000-8000-000000000002';
update public.profiles set platform_role = 'owner' where id = 'ba000000-0000-4000-8000-000000000003';

set role authenticated;
-- nobody awards themselves a badge
select pg_temp.bt_as('ba000000-0000-4000-8000-000000000001');
select pg_temp.bt_must_fail($$update public.profiles set badges = array['owner'] where id = auth.uid()$$);
select pg_temp.bt_must_fail($$update public.profiles set badge_display = array['owner'] where id = auth.uid()$$);
select pg_temp.bt_must_fail($$select public.mod_set_badges(auth.uid(), array['og'])$$);
select pg_temp.bt_must_fail($$select public.save_custom_badge('mine', 'My badge', '', 'https://x.supabase.co/storage/v1/object/public/badges/c_mine.png')$$, 'only Venband owners');

-- staff award -> notification
select pg_temp.bt_as('ba000000-0000-4000-8000-000000000002');
select public.mod_set_badges('ba000000-0000-4000-8000-000000000001', array['og', 'early_supporter', 'translator']);
reset role;
do $t$ begin
  assert (select count(*) from public.notifications where user_id = 'ba000000-0000-4000-8000-000000000001' and kind = 'badge_awarded') = 3, 'one notification per new badge';
end $t$;

-- the holder chooses what shows, in their order
set role authenticated;
select pg_temp.bt_as('ba000000-0000-4000-8000-000000000001');
do $t$ begin
  assert public.set_badge_display(array['translator', 'og', 'og', 'moderator']) = array['translator', 'og'], 'deduped; protected badges never stored';
  assert (select badge_display from public.profiles where id = auth.uid()) = array['translator', 'og'];
end $t$;
select pg_temp.bt_must_fail($$select public.set_badge_display(array['partner'])$$, 'don''t have');
select pg_temp.bt_must_fail($$select public.set_badge_display(array['og','og','og','og','og','og','og','og','og','og','og','og','og','og','og','og','og','og','og','og','og'])$$, 'up to 20');

-- removing a badge removes it from the display list too
select pg_temp.bt_as('ba000000-0000-4000-8000-000000000002');
select public.mod_set_badges('ba000000-0000-4000-8000-000000000001', array['translator', 'early_supporter']);
reset role;
do $t$ begin
  assert (select badge_display from public.profiles where id = 'ba000000-0000-4000-8000-000000000001') = array['translator'], 'removed badge left the display list';
end $t$;

-- limited-time and retired custom badges
set role authenticated;
select pg_temp.bt_as('ba000000-0000-4000-8000-000000000003');
select public.save_custom_badge('launch_party', 'Launch Party', 'Was there on day one', 'https://x.supabase.co/storage/v1/object/public/badges/c_launch.png', 'event', 'legendary', now() - interval '1 day', false);
select public.save_custom_badge('beta_tester', 'Beta Tester', 'Tested early builds', 'https://x.supabase.co/storage/v1/object/public/badges/c_beta.png', 'achievement', 'epic', null, false);
select public.mod_set_badges('ba000000-0000-4000-8000-000000000001', array['translator', 'early_supporter', 'c_beta_tester']);
select pg_temp.bt_must_fail($$select public.mod_set_badges('ba000000-0000-4000-8000-000000000001', array['translator', 'early_supporter', 'c_beta_tester', 'c_launch_party'])$$, 'can''t be awarded any more');
select public.save_custom_badge('beta_tester', 'Beta Tester', 'Tested early builds', 'https://x.supabase.co/storage/v1/object/public/badges/c_beta.png', 'achievement', 'epic', null, true);
reset role;
do $t$ begin
  assert (select 'c_beta_tester' = any (badges) from public.profiles where id = 'ba000000-0000-4000-8000-000000000001'), 'retiring keeps it for holders';
  assert (select category || '/' || rarity from public.custom_badges where id = 'c_beta_tester') = 'achievement/epic';
end $t$;
set role authenticated;
select pg_temp.bt_as('ba000000-0000-4000-8000-000000000003');
select pg_temp.bt_must_fail($$select public.mod_set_badges('ba000000-0000-4000-8000-000000000002', array['c_beta_tester'])$$, 'can''t be awarded any more');

-- back to "show everything"
select pg_temp.bt_as('ba000000-0000-4000-8000-000000000001');
do $t$ begin
  assert public.set_badge_display(null) is null;
  assert (select badge_display from public.profiles where id = auth.uid()) is null;
end $t$;
reset role;
