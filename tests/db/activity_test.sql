-- Recent activity (20261106120000_activity_history.sql). Runs after all migrations.
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('ac700000-0000-4000-8000-000000000001', 'act1@example.com', '{"username":"actone"}'),
  ('ac700000-0000-4000-8000-000000000002', 'act2@example.com', '{"username":"acttwo"}');

set role authenticated;
select set_config('request.jwt.claim.sub', 'ac700000-0000-4000-8000-000000000001', false);
-- started an hour ago (the desktop app sends when the game was first seen)
select public.set_my_activity(jsonb_build_object('name', 'Roblox', 'type', 0, 'timestamps_start', (extract(epoch from now() - interval '1 hour') * 1000)::bigint));
do $t$ begin
  assert (select sessions from public.activity_history where name = 'Roblox') = 0, 'listed as soon as you start';
end $t$;
-- switch games: Roblox's session is recorded (~1 h)
select public.set_my_activity(jsonb_build_object('name', 'Minecraft', 'type', 0, 'timestamps_start', (extract(epoch from now()) * 1000)::bigint));
select public.clear_my_activity();
-- a non-game activity (listening) isn't history
select public.set_my_activity(jsonb_build_object('name', 'Spotify', 'type', 2));
do $t$ begin
  assert (select sessions from public.activity_history where name = 'Roblox') = 1;
  assert (select total_seconds from public.activity_history where name = 'Roblox') between 3590 and 3700, 'about an hour';
  assert (select sessions from public.activity_history where name = 'Minecraft') = 1;
  assert not exists (select 1 from public.activity_history where name = 'Spotify');
  -- nobody writes history directly
  begin
    insert into public.activity_history (user_id, name, total_seconds) values (auth.uid(), 'Fake', 999999);
    raise exception 'wrote history directly';
  exception when insufficient_privilege then null;
  end;
end $t$;
-- you can clear yours
delete from public.activity_history where name = 'Minecraft';
reset role;
do $t$ begin
  assert (select count(*) from public.activity_history where user_id = 'ac700000-0000-4000-8000-000000000001') = 1;
end $t$;
