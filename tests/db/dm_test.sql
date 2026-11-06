-- DMs: blocks make a DM read-only, except for people with force-contact powers
-- (20261106030000_fix_dm_blocked.sql). Runs after all migrations.
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('d0000000-0000-4000-8000-000000000001', 'dm1@example.com', '{"username":"dmone"}'),
  ('d0000000-0000-4000-8000-000000000002', 'dm2@example.com', '{"username":"dmtwo"}'),
  ('d0000000-0000-4000-8000-000000000003', 'dmowner@example.com', '{"username":"dmowner"}');
update public.profiles set platform_role = 'owner' where id = 'd0000000-0000-4000-8000-000000000003';
insert into public.channels (id, type, name) values
  ('dc000000-0000-4000-8000-000000000001', 'dm', 'dm'),
  ('dc000000-0000-4000-8000-000000000002', 'dm', 'dm');
insert into public.dm_participants (channel_id, user_id) values
  ('dc000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001'),
  ('dc000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002'),
  ('dc000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000003'),
  ('dc000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001');

do $t$ begin
  -- nobody blocked anybody: nobody's DM is blocked — staff included (this was the bug)
  assert not public.dm_blocked('dc000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001'), 'plain DM not blocked';
  assert not public.dm_blocked('dc000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000003'), 'owner can DM when nobody blocked';
end $t$;

insert into public.user_relations (owner_id, target_id, blocked) values
  ('d0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', true),
  ('d0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000003', true);

do $t$ begin
  -- a block makes the DM read-only for both sides…
  assert public.dm_blocked('dc000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001'), 'blocked side';
  assert public.dm_blocked('dc000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002'), 'blocking side';
  -- …except for someone with force-contact powers
  assert not public.dm_blocked('dc000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000003'), 'owner overrides block';
  assert public.dm_blocked('dc000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001'), 'the regular user is still blocked';
end $t$;
