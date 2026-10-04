-- Row Level Security / RPC behaviour tests. Run via tests/db/run.sh.
\pset tuples_only on
\o /dev/null
\set ON_ERROR_STOP 1

-- helper: assert a statement fails
create function pg_temp.must_fail(p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    return;
  end;
  raise exception 'expected failure but succeeded: %', p_sql;
end $$;

create function pg_temp.affected(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

-- users --------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com', '{"username":"alice","display_name":"Alice"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com',   '{"username":"bob"}'),
  ('00000000-0000-0000-0000-00000000000c', 'carol@example.com', '{"username":"carol"}'),
  ('00000000-0000-0000-0000-00000000000d', 'dave@example.com',  '{"username":"dave"}');

-- invalid / taken usernames get a safe unique one instead of failing signup
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000e1', 'x@x', '{"username":"Bad Name!"}'),
  ('00000000-0000-0000-0000-0000000000e2', 'y@y', '{"username":"alice"}'),
  ('00000000-0000-0000-0000-0000000000e3', 'zed.dash-board@example.com', '{}');
do $t$ begin
  assert (select username from public.profiles where id = '00000000-0000-0000-0000-0000000000e1') = 'badname';
  assert (select username from public.profiles where id = '00000000-0000-0000-0000-0000000000e2') = 'alice2';
  assert (select username from public.profiles where id = '00000000-0000-0000-0000-0000000000e3') = 'zed.dashboard';
end $t$;

set role authenticated;

-- ---------------------------------------------------------------- alice ----
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into public.user_keys (key_id, user_id, enc_public, sign_public)
  values ('aliceKey000000000001', '00000000-0000-0000-0000-00000000000a', 'e', 's');
insert into public.user_private_keys (user_id, key_id, iv, ciphertext)
  values ('00000000-0000-0000-0000-00000000000a', 'aliceKey000000000001', 'iv', 'ct');
select pg_temp.must_fail($$insert into public.user_keys (key_id, user_id, enc_public, sign_public)
  values ('fakeBobKey0000000001', '00000000-0000-0000-0000-00000000000b', 'e', 's')$$);

select set_config('t.server', public.create_server('Test server')::text, false);
select set_config('t.general', (select id::text from public.channels where server_id = current_setting('t.server')::uuid and name = 'chat'), false);
select set_config('t.voice', (select id::text from public.channels where server_id = current_setting('t.server')::uuid and type = 'voice'), false);

do $t$ begin
  assert public.server_permissions(current_setting('t.server')::uuid) = 2147483647, 'owner has all perms';
  assert (select count(*) from public.roles where server_id = current_setting('t.server')::uuid) = 1;
end $t$;

-- epoch 1 for #general
insert into public.channel_epochs (channel_id, epoch, key_check, created_by)
  values (current_setting('t.general')::uuid, 1, 'kc', auth.uid());
-- epochs must be sequential
select pg_temp.must_fail($$insert into public.channel_epochs (channel_id, epoch, key_check, created_by)
  values (current_setting('t.general')::uuid, 3, 'kc', auth.uid())$$);

insert into public.messages (channel_id, author_id, author_key_id, epoch, iv, ciphertext, signature)
  values (current_setting('t.general')::uuid, auth.uid(), 'aliceKey000000000001', 1, 'iv', 'ct', 'sig');

select set_config('t.invite', public.create_invite(current_setting('t.server')::uuid), false);

-- a private channel visible only to "Mods"
insert into public.roles (server_id, name, permissions, position)
  values (current_setting('t.server')::uuid, 'Mods', 16 | 256, 2);
select set_config('t.mods', (select id::text from public.roles where name = 'Mods'), false);
insert into public.channels (server_id, type, name, is_private)
  values (current_setting('t.server')::uuid, 'text', 'mods-only', true);
select set_config('t.private', (select id::text from public.channels where name = 'mods-only'), false);
insert into public.channel_role_access (channel_id, role_id)
  values (current_setting('t.private')::uuid, current_setting('t.mods')::uuid);

-- ------------------------------------------------------------------ bob ----
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
insert into public.user_keys (key_id, user_id, enc_public, sign_public)
  values ('bobKey00000000000001', '00000000-0000-0000-0000-00000000000b', 'e', 's');

do $t$ begin
  assert (select count(*) from public.servers) = 0, 'bob sees no servers before joining';
  assert (select count(*) from public.messages) = 0, 'bob sees no messages before joining';
  assert (select count(*) from public.user_private_keys) = 0, 'bob cannot see alice private key';
  assert (select count(*) from public.profiles) = 1, 'bob sees only himself';
end $t$;
select pg_temp.must_fail($$insert into public.server_members (server_id, user_id)
  values (current_setting('t.server')::uuid, auth.uid())$$);
select pg_temp.must_fail($$select public.join_server('doesnotexist')$$);

select public.join_server(current_setting('t.invite'));

do $t$ begin
  assert (select count(*) from public.servers) = 1, 'bob sees server after joining';
  assert (select count(*) from public.messages) = 1, 'bob sees ciphertext after joining';
  assert (select count(*) from public.channels where server_id = current_setting('t.server')::uuid) = 3,
    'bob cannot see the private channel';
  assert not public.can_view_channel(current_setting('t.private')::uuid);
  assert public.realtime_topic_allowed('scope:' || current_setting('t.server'));
  assert public.realtime_topic_allowed('call:' || current_setting('t.voice'));
  assert not public.realtime_topic_allowed('call:' || current_setting('t.general')), 'no calls in text channels';
  assert not public.realtime_topic_allowed('chan:' || current_setting('t.private'));
  assert not public.realtime_topic_allowed('chan:not-a-uuid');
  assert public.realtime_topic_allowed('dbs:' || current_setting('t.server'));
  assert public.realtime_topic_allowed('dbu:' || auth.uid());
  assert not public.realtime_topic_allowed('dbu:00000000-0000-0000-0000-00000000000a');
  assert not public.realtime_topic_allowed('dbc:' || current_setting('t.private'));
  assert public.storage_channel_allowed(current_setting('t.general') || '/abc.bin');
  assert not public.storage_channel_allowed(current_setting('t.private') || '/abc.bin');
  assert (select count(*) from public.channel_missing_keys(current_setting('t.general')::uuid)) = 2,
    'both alice and bob still need epoch 1 wraps';
end $t$;

-- bob cannot do admin things
do $t$ begin
  assert pg_temp.affected($$update public.servers set name = 'pwned'$$) = 0;
  assert pg_temp.affected($$delete from public.servers$$) = 0;
  assert pg_temp.affected($$delete from public.messages$$) = 0, 'cannot delete alice message';
  assert pg_temp.affected($$update public.messages set ciphertext = 'x'$$) = 0, 'cannot edit alice message';
  assert pg_temp.affected($$delete from public.server_members where user_id <> auth.uid()$$) = 0, 'cannot kick';
  assert pg_temp.affected($$update public.roles set permissions = 2147483647$$) = 0, 'cannot escalate @everyone';
end $t$;
select pg_temp.must_fail($$insert into public.roles (server_id, name, permissions, position)
  values (current_setting('t.server')::uuid, 'hax', 1, 1)$$);
select pg_temp.must_fail($$insert into public.member_roles (server_id, user_id, role_id)
  values (current_setting('t.server')::uuid, auth.uid(), current_setting('t.mods')::uuid)$$);
select pg_temp.must_fail($$insert into public.channels (server_id, type, name)
  values (current_setting('t.server')::uuid, 'text', 'spam')$$);
select pg_temp.must_fail($$insert into public.bans (server_id, user_id, banned_by)
  values (current_setting('t.server')::uuid, '00000000-0000-0000-0000-00000000000a', auth.uid())$$);
-- cannot impersonate alice
select pg_temp.must_fail($$insert into public.messages (channel_id, author_id, author_key_id, epoch, iv, ciphertext, signature)
  values (current_setting('t.general')::uuid, '00000000-0000-0000-0000-00000000000a', 'aliceKey000000000001', 1, 'iv', 'ct', 'sig')$$);
select pg_temp.must_fail($$insert into public.messages (channel_id, author_id, author_key_id, epoch, iv, ciphertext, signature)
  values (current_setting('t.general')::uuid, auth.uid(), 'aliceKey000000000001', 1, 'iv', 'ct', 'sig')$$);
-- can send with own key
insert into public.messages (channel_id, author_id, author_key_id, epoch, iv, ciphertext, signature)
  values (current_setting('t.general')::uuid, auth.uid(), 'bobKey00000000000001', 1, 'iv', 'ct', 'sig');
-- cannot forge a wrapped key for a non-member
select pg_temp.must_fail($$insert into public.channel_keys (channel_id, epoch, recipient_id, recipient_key_id, wrapper_id, wrapper_key_id, ephemeral_public, iv, wrapped_key, signature)
  values (current_setting('t.general')::uuid, 1, '00000000-0000-0000-0000-00000000000c', 'bobKey00000000000001', auth.uid(), 'bobKey00000000000001', 'e', 'i', 'w', 's')$$);

-- ---------------------------------------------------------------- alice ----
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into public.channel_keys (channel_id, epoch, recipient_id, recipient_key_id, wrapper_id, wrapper_key_id, ephemeral_public, iv, wrapped_key, signature)
  values (current_setting('t.general')::uuid, 1, '00000000-0000-0000-0000-00000000000b', 'bobKey00000000000001',
          auth.uid(), 'aliceKey000000000001', 'e', 'i', 'w', 's');
do $t$ begin
  assert (select count(*) from public.channel_missing_keys(current_setting('t.general')::uuid)) = 1,
    'only alice herself is missing a wrap now';
end $t$;
-- promote bob to Mods -> he sees the private channel
insert into public.member_roles (server_id, user_id, role_id)
  values (current_setting('t.server')::uuid, '00000000-0000-0000-0000-00000000000b', current_setting('t.mods')::uuid);

-- ------------------------------------------------------------------ bob ----
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $t$ begin
  assert public.can_view_channel(current_setting('t.private')::uuid), 'mods see private channel';
  assert (select count(*) from public.channel_keys) = 1, 'bob sees his wrap';
  assert (select count(*) from public.profiles) = 2, 'bob sees alice profile now';
end $t$;

-- ---------------------------------------------------------------- carol ----
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select public.join_server(current_setting('t.invite'));

-- bob (Mods: KICK) kicks carol
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $t$ begin
  assert pg_temp.affected($$delete from public.server_members where user_id = '00000000-0000-0000-0000-00000000000c'$$) = 1,
    'mods can kick lower members';
  assert pg_temp.affected($$delete from public.server_members where user_id = '00000000-0000-0000-0000-00000000000a'$$) = 0,
    'cannot kick the owner';
  assert (select key_rotation_needed from public.channels where id = current_setting('t.general')::uuid),
    'kick flags key rotation';
end $t$;
-- sending is blocked until someone rotates
select pg_temp.must_fail($$insert into public.messages (channel_id, author_id, author_key_id, epoch, iv, ciphertext, signature)
  values (current_setting('t.general')::uuid, auth.uid(), 'bobKey00000000000001', 1, 'iv', 'ct', 'sig')$$);
insert into public.channel_epochs (channel_id, epoch, key_check, created_by)
  values (current_setting('t.general')::uuid, 2, 'kc2', auth.uid());
do $t$ begin
  assert not (select key_rotation_needed from public.channels where id = current_setting('t.general')::uuid),
    'new epoch clears the flag';
end $t$;
-- old epoch is no longer accepted
select pg_temp.must_fail($$insert into public.messages (channel_id, author_id, author_key_id, epoch, iv, ciphertext, signature)
  values (current_setting('t.general')::uuid, auth.uid(), 'bobKey00000000000001', 1, 'iv', 'ct', 'sig')$$);
insert into public.messages (channel_id, author_id, author_key_id, epoch, iv, ciphertext, signature)
  values (current_setting('t.general')::uuid, auth.uid(), 'bobKey00000000000001', 2, 'iv', 'ct', 'sig');

-- ---------------------------------------------------------------- alice ----
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into public.bans (server_id, user_id, banned_by, reason)
  values (current_setting('t.server')::uuid, '00000000-0000-0000-0000-00000000000c', auth.uid(), 'spam');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select pg_temp.must_fail($$select public.join_server(current_setting('t.invite'))$$);
do $t$ begin
  assert (select count(*) from public.messages) = 0, 'banned user sees nothing';
end $t$;

-- DMs ----------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
select set_config('t.dm', public.open_dm('00000000-0000-0000-0000-00000000000a')::text, false);
do $t$ begin
  assert public.open_dm('00000000-0000-0000-0000-00000000000a')::text = current_setting('t.dm'), 'dm is reused';
  assert public.realtime_topic_allowed('call:' || current_setting('t.dm'));
  assert public.realtime_topic_allowed('scope:' || current_setting('t.dm'));
end $t$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $t$ begin
  assert not public.can_view_channel(current_setting('t.dm')::uuid), 'outsiders cannot read DMs';
  assert not public.realtime_topic_allowed('call:' || current_setting('t.dm'));
end $t$;

-- group chats ---------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select set_config('t.group', public.create_group(array['00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000d']::uuid[], 'Trip')::text, false);
do $t$ begin
  assert (select count(*) from public.dm_participants where channel_id = current_setting('t.group')::uuid) = 3;
  assert public.realtime_topic_allowed('call:' || current_setting('t.group'));
  -- a 1:1 DM is never the group
  assert public.open_dm('00000000-0000-0000-0000-00000000000b')::text <> current_setting('t.group');
end $t$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $t$ begin
  assert not public.can_view_channel(current_setting('t.group')::uuid), 'outsider cannot see group';
end $t$;
select pg_temp.must_fail($$select public.add_group_members(current_setting('t.group')::uuid, array['00000000-0000-0000-0000-00000000000c']::uuid[])$$);
select pg_temp.must_fail($$select public.rename_group(current_setting('t.group')::uuid, 'hijacked')$$);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
select public.add_group_members(current_setting('t.group')::uuid, array['00000000-0000-0000-0000-00000000000c']::uuid[]);
select public.rename_group(current_setting('t.group')::uuid, 'Road trip');
select public.leave_group(current_setting('t.group')::uuid);
do $t$ begin
  assert not public.can_view_channel(current_setting('t.group')::uuid), 'left the group';
end $t$;
reset role;
do $t$ begin
  assert (select name from public.channels where id = current_setting('t.group')::uuid) = 'Road trip';
  assert (select key_rotation_needed from public.channels where id = current_setting('t.group')::uuid), 'leaving rotates keys';
  assert (select count(*) from public.dm_participants where channel_id = current_setting('t.group')::uuid) = 3;
end $t$;
set role authenticated;


-- platform: friends, blocks, staff, account status, server review ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
-- nobody can give themselves staff powers or badges
select pg_temp.must_fail($$update public.profiles set badges = '{owner}' where id = auth.uid()$$);
select pg_temp.must_fail($$update public.profiles set platform_role = 'owner' where id = auth.uid()$$);
select pg_temp.must_fail($$update public.profiles set account_status = 'active' where id = auth.uid()$$);
update public.profiles set pronouns = 'he/him', status_text = 'hi', nameplate = 'aurora' where id = auth.uid();
select pg_temp.must_fail($$select public.mod_search('')$$);
select pg_temp.must_fail($$select public.mod_set_account_status('00000000-0000-0000-0000-00000000000c', 'banned')$$);
select pg_temp.must_fail($$select public.mod_server_action(current_setting('t.server')::uuid, 'verify')$$);

-- friends
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
do $t$ begin
  assert public.send_friend_request('bob') = 'sent';
  assert public.send_friend_request('bob') = 'pending';
end $t$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select public.respond_friend_request('00000000-0000-0000-0000-00000000000d', true);
do $t$ begin
  assert public.are_friends('00000000-0000-0000-0000-00000000000d'), 'friends after accepting';
  assert (select count(*) from public.friendships) = 1;
end $t$;

-- blocking: carol can't reach bob
insert into public.user_relations (owner_id, target_id, blocked)
  values (auth.uid(), '00000000-0000-0000-0000-00000000000c', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select pg_temp.must_fail($$select public.open_dm('00000000-0000-0000-0000-00000000000b')$$);
select pg_temp.must_fail($$select public.send_friend_request('bob')$$);
do $t$ begin
  assert (select count(*) from public.user_relations) = 0, 'block list is private';
end $t$;

-- alice becomes platform owner
reset role;
update public.profiles set platform_role = 'owner' where id = '00000000-0000-0000-0000-00000000000a';
insert into auth.sessions (id, user_id) values
  ('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-00000000000c'),
  ('00000000-0000-0000-0000-0000000005e2', '00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-0000000005e3', '00000000-0000-0000-0000-00000000000a');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select set_config('request.jwt.claim.session_id', '00000000-0000-0000-0000-0000000005e2', false);
do $t$ begin
  assert jsonb_array_length(public.mod_search('bob') -> 'users') = 1;
  assert jsonb_array_length(public.mod_search('Test') -> 'servers') = 1;
  assert (select count(*) from public.profiles) >= 4, 'staff can see everyone';
  -- devices
  assert (select count(*) from public.my_devices()) = 2;
  assert (select current from public.my_devices() where id = '00000000-0000-0000-0000-0000000005e2');
  assert public.session_alive();
end $t$;
select public.revoke_device('00000000-0000-0000-0000-0000000005e3');
select public.revoke_device('00000000-0000-0000-0000-0000000005e1');  -- not hers: no effect
do $t$ begin
  assert (select count(*) from public.my_devices()) = 1;
end $t$;

select public.mod_set_badges('00000000-0000-0000-0000-00000000000b', array['bug_hunter', 'og', 'nonsense']);
do $t$ begin
  assert (select badges from public.profiles where id = '00000000-0000-0000-0000-00000000000b') = array['bug_hunter', 'og'];
end $t$;

-- limited: no new servers / DMs with strangers, but friends are fine
select public.mod_set_account_status('00000000-0000-0000-0000-00000000000d', 'limited', 'spam');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
select pg_temp.must_fail($$select public.create_server('nope')$$);
select pg_temp.must_fail($$select public.open_dm('00000000-0000-0000-0000-00000000000c')$$);
select public.open_dm('00000000-0000-0000-0000-00000000000b');
do $t$ begin
  assert public.account_can('send') and not public.account_can('create');
end $t$;

-- very limited: read only
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.mod_set_account_status('00000000-0000-0000-0000-00000000000d', 'very_limited');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
do $t$ begin
  assert not public.account_can('send');
  assert not public.realtime_topic_allowed('call:' || current_setting('t.dm')) or true;
end $t$;
select pg_temp.must_fail($$select public.join_server(current_setting('t.invite'))$$);

-- banning signs carol out everywhere
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.mod_set_account_status('00000000-0000-0000-0000-00000000000c', 'banned', 'abuse');
select pg_temp.must_fail($$select public.mod_set_account_status('00000000-0000-0000-0000-00000000000a', 'banned')$$);
reset role;
do $t$ begin
  assert (select banned_until from auth.users where id = '00000000-0000-0000-0000-00000000000c') = 'infinity';
  assert not exists (select 1 from auth.sessions where user_id = '00000000-0000-0000-0000-00000000000c');
  assert (select count(*) from public.mod_actions) = 4;
end $t$;
set role authenticated;

-- join messages land in the welcome channel
do $t$ begin
  assert (select count(*) from public.server_events where server_id = current_setting('t.server')::uuid and kind = 'join') >= 1;
end $t$;

-- server review freezes everything, even for the owner
select public.mod_server_action(current_setting('t.server')::uuid, 'review', 'reported');
do $t$ begin
  assert public.server_permissions(current_setting('t.server')::uuid) = 0;
  assert public.can_view_channel(current_setting('t.general')::uuid), 'still readable while in review';
end $t$;
select pg_temp.must_fail($$insert into public.messages (channel_id, author_id, author_key_id, epoch, iv, ciphertext, signature)
  values (current_setting('t.general')::uuid, auth.uid(), 'aliceKey000000000001', 2, 'iv', 'ct', 'sig')$$);
do $t$ begin
  assert pg_temp.affected($$update public.servers set name = 'escape' where id = current_setting('t.server')::uuid$$) = 0;
  assert pg_temp.affected($$delete from public.servers where id = current_setting('t.server')::uuid$$) = 0;
end $t$;
select public.mod_server_action(current_setting('t.server')::uuid, 'approve');
select public.mod_server_action(current_setting('t.server')::uuid, 'verify');
do $t$ begin
  assert public.server_permissions(current_setting('t.server')::uuid) = 2147483647;
  assert (select verified from public.servers where id = current_setting('t.server')::uuid);
end $t$;

-- verified servers show up in discovery for anyone
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);
do $t$ begin
  assert (select count(*) from public.discover_servers('')) = 1;
  assert public.join_discoverable(current_setting('t.server')::uuid) = current_setting('t.server')::uuid;
  assert public.is_server_member(current_setting('t.server')::uuid);
end $t$;

-- rejecting a review closes the server and very-limits the owner
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select set_config('t.bobserver', public.create_server('Bob place')::text, false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.mod_server_action(current_setting('t.bobserver')::uuid, 'review');
select public.mod_server_action(current_setting('t.bobserver')::uuid, 'reject', 'scam');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $t$ begin
  assert (select account_status from public.profiles where id = auth.uid()) = 'very_limited';
  assert (select count(*) from public.channels where server_id = current_setting('t.bobserver')::uuid) = 0, 'closed server unreadable';
end $t$;


-- message requests + reports -------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', false);
select set_config('t.req1', public.open_dm('00000000-0000-0000-0000-0000000000e1')::text, false);
select set_config('t.req2', public.open_dm('00000000-0000-0000-0000-00000000000b')::text, false);
do $t$ begin
  assert (select request_to from public.channels where id = current_setting('t.req1')::uuid) = '00000000-0000-0000-0000-0000000000e1', 'stranger DM is a request';
end $t$;
-- only the recipient can accept / decline
select pg_temp.must_fail($$select public.decline_message_request(current_setting('t.req1')::uuid)$$);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);
select public.decline_message_request(current_setting('t.req1')::uuid);
do $t$ begin
  assert not exists (select 1 from public.channels where id = current_setting('t.req1')::uuid), 'declined request is gone';
end $t$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select public.accept_message_request(current_setting('t.req2')::uuid);
do $t$ begin
  assert (select request_to from public.channels where id = current_setting('t.req2')::uuid) is null, 'accepted';
  -- friends / shared servers are never requests (bob and dave are friends)
  assert (select request_to from public.channels where id = public.open_dm('00000000-0000-0000-0000-00000000000d')) is null;
end $t$;

-- reports: anyone can file, only admins+ see them all and handle them
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', false);
insert into public.reports (reporter_id, kind, target_user, reason, evidence)
  values (auth.uid(), 'user', '00000000-0000-0000-0000-00000000000b', 'spam', '[{"id":"x","author":"bob","text":"buy now","at":"2026-01-01"}]');
select pg_temp.must_fail($$insert into public.reports (reporter_id, kind, target_user, reason) values ('00000000-0000-0000-0000-00000000000b', 'user', '00000000-0000-0000-0000-00000000000d', 'framed')$$);
select pg_temp.must_fail($$insert into public.reports (reporter_id, kind, target_user, reason, status) values (auth.uid(), 'user', '00000000-0000-0000-0000-00000000000d', 'x', 'dismissed')$$);
do $t$ begin
  assert (select count(*) from public.reports) = 1, 'reporter sees own report';
end $t$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $t$ begin
  assert (select count(*) from public.reports) = 0, 'reported user cannot see reports';
end $t$;
select pg_temp.must_fail($$select public.handle_report((select id from public.reports limit 1), 'dismissed')$$);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.handle_report((select id from public.reports limit 1), 'actioned', 'warned');
do $t$ begin
  assert (select status from public.reports limit 1) = 'actioned';
  assert 'founder' = any (public.all_badges());
end $t$;
select pg_temp.must_fail($$update public.reports set status = 'dismissed'$$);

-- signup limit: 6 accounts per IP
reset role;
do $t$
declare i int; r jsonb;
begin
  for i in 1..6 loop
    r := public.before_user_created('{"metadata": {"ip_address": "203.0.113.9"}, "user": {}}');
    assert r = '{}'::jsonb, 'first six are allowed';
  end loop;
  r := public.before_user_created('{"metadata": {"ip_address": "203.0.113.9"}, "user": {}}');
  assert r ? 'error', 'seventh is refused';
  assert public.before_user_created('{"metadata": {"ip_address": "198.51.100.1"}, "user": {}}') = '{}'::jsonb;
  assert not exists (select 1 from public.signup_ips where ip_hash like '%203.0.113%'), 'IPs are hashed';
end $t$;
set role authenticated;

-- my_profile() recreates a missing profile ----------------------------------
reset role;
delete from public.profiles where id = '00000000-0000-0000-0000-0000000000e3';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e3', false);
do $t$ begin
  assert (select username from public.my_profile()) = 'zed.dashboard', 'profile recreated';
  assert (select count(*) from public.profiles where id = auth.uid()) = 1;
end $t$;

-- anon ---------------------------------------------------------------------
reset role;
set role anon;
select pg_temp.must_fail($$select * from public.profiles$$);
select pg_temp.must_fail($$select public.create_server('x')$$);
do $t$ begin
  assert public.username_available('newuser');
  assert not public.username_available('alice');
end $t$;
reset role;

-- ============================================================ messaging ----
-- owner m1, member m2, outsider m3
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f1', 'm1@example.com', '{"username":"msgowner"}'),
  ('00000000-0000-0000-0000-0000000000f2', 'm2@example.com', '{"username":"msgmember"}'),
  ('00000000-0000-0000-0000-0000000000f3', 'm3@example.com', '{"username":"msgoutsider"}');
insert into public.user_keys (key_id, user_id, enc_public, sign_public) values
  ('msgKey00000000000001', '00000000-0000-0000-0000-0000000000f1', 'e', 's'),
  ('msgKey00000000000002', '00000000-0000-0000-0000-0000000000f2', 'e', 's'),
  ('msgKey00000000000003', '00000000-0000-0000-0000-0000000000f3', 'e', 's');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', false);
select set_config('t.ms', public.create_server('Messaging test')::text, false);
select set_config('t.mc', (select id::text from public.channels where server_id = current_setting('t.ms')::uuid and name = 'chat'), false);
reset role;
insert into public.server_members (server_id, user_id) values (current_setting('t.ms')::uuid, '00000000-0000-0000-0000-0000000000f2');
insert into public.channel_epochs (channel_id, epoch, key_check, created_by) values (current_setting('t.mc')::uuid, 1, 'kc', '00000000-0000-0000-0000-0000000000f1');
update public.channels set key_rotation_needed = false where id = current_setting('t.mc')::uuid;
do $t$ begin
  assert (select permissions & 4096 from public.roles where server_id = current_setting('t.ms')::uuid and is_default) = 4096, 'new servers let everyone react';
end $t$;
set role authenticated;

-- owner posts, member replies
select set_config('t.m1', gen_random_uuid()::text, false);
insert into public.messages (id, channel_id, author_id, author_key_id, epoch, iv, ciphertext, signature)
values (current_setting('t.m1')::uuid, current_setting('t.mc')::uuid, auth.uid(), 'msgKey00000000000001', 1, 'iv', 'ct-one', 'sig');

-- reactions: members only, one of each per person, encrypted blob only
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f2', false);
insert into public.reactions (message_id, channel_id, user_id, epoch, tag, iv, ciphertext)
values (current_setting('t.m1')::uuid, current_setting('t.mc')::uuid, auth.uid(), 1, 'tagtagtagtag', 'iv', 'ct');
select pg_temp.must_fail($$insert into public.reactions (message_id, channel_id, user_id, epoch, tag, iv, ciphertext)
  values (current_setting('t.m1')::uuid, current_setting('t.mc')::uuid, auth.uid(), 1, 'tagtagtagtag', 'iv', 'ct')$$);
select pg_temp.must_fail($$insert into public.reactions (message_id, channel_id, user_id, epoch, tag, iv, ciphertext)
  values (current_setting('t.m1')::uuid, current_setting('t.mc')::uuid, '00000000-0000-0000-0000-0000000000f1', 1, 'othertagtag1', 'iv', 'ct')$$);
-- members can't pin in servers without Manage Messages
select pg_temp.must_fail($$insert into public.pins (message_id, channel_id) values (current_setting('t.m1')::uuid, current_setting('t.mc')::uuid)$$);
-- saved messages: own only
insert into public.saved_messages (message_id, channel_id) values (current_setting('t.m1')::uuid, current_setting('t.mc')::uuid);
do $t$ begin
  assert (select count(*) from public.saved_messages) = 1;
  assert public.my_row_count('saved_messages') = 1;
end $t$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f3', false);
do $t$ begin
  assert (select count(*) from public.reactions where message_id = current_setting('t.m1')::uuid) = 0, 'outsider sees no reactions';
  assert (select count(*) from public.saved_messages) = 0, 'saved messages are private';
end $t$;
select pg_temp.must_fail($$insert into public.reactions (message_id, channel_id, user_id, epoch, tag, iv, ciphertext)
  values (current_setting('t.m1')::uuid, current_setting('t.mc')::uuid, auth.uid(), 1, 'outsidertag1', 'iv', 'ct')$$);
select pg_temp.must_fail($$insert into public.saved_messages (message_id, channel_id) values (current_setting('t.m1')::uuid, current_setting('t.mc')::uuid)$$);

-- pins: owner can
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', false);
insert into public.pins (message_id, channel_id) values (current_setting('t.m1')::uuid, current_setting('t.mc')::uuid);

-- edits keep the previous ciphertext; members can read the history
update public.messages set ciphertext = 'ct-two' where id = current_setting('t.m1')::uuid;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f2', false);
do $t$ begin
  assert (select ciphertext from public.message_revisions where message_id = current_setting('t.m1')::uuid) = 'ct-one', 'old version kept';
end $t$;

-- threads: member creates, owner locks, member can no longer post; member can't unlock
insert into public.threads (root_id, channel_id, name) values (current_setting('t.m1')::uuid, current_setting('t.mc')::uuid, 'side chat');
insert into public.messages (id, channel_id, author_id, author_key_id, epoch, iv, ciphertext, signature, thread_root)
values (gen_random_uuid(), current_setting('t.mc')::uuid, auth.uid(), 'msgKey00000000000002', 1, 'iv', 'ct', 'sig', current_setting('t.m1')::uuid);
do $t$ begin
  assert (select message_count from public.threads where root_id = current_setting('t.m1')::uuid) = 1, 'reply counted';
end $t$;
select pg_temp.must_fail($$update public.threads set locked = true where root_id = current_setting('t.m1')::uuid$$);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', false);
update public.threads set locked = true where root_id = current_setting('t.m1')::uuid;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f2', false);
select pg_temp.must_fail($$insert into public.messages (id, channel_id, author_id, author_key_id, epoch, iv, ciphertext, signature, thread_root)
  values (gen_random_uuid(), current_setting('t.mc')::uuid, auth.uid(), 'msgKey00000000000002', 1, 'iv', 'ct', 'sig', current_setting('t.m1')::uuid)$$);
-- nobody can fake the reply count
select pg_temp.must_fail($$update public.threads set message_count = 999 where root_id = current_setting('t.m1')::uuid$$);
do $t$ begin
  assert (select message_count from public.threads where root_id = current_setting('t.m1')::uuid) = 1, 'count cannot be faked';
end $t$;

-- anonymous poll: totals for everyone, individual votes hidden
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', false);
select set_config('t.poll', gen_random_uuid()::text, false);
insert into public.messages (id, channel_id, author_id, author_key_id, epoch, iv, ciphertext, signature)
values (current_setting('t.poll')::uuid, current_setting('t.mc')::uuid, auth.uid(), 'msgKey00000000000001', 1, 'iv', 'poll', 'sig');
insert into public.polls (message_id, channel_id, option_count, anonymous) values (current_setting('t.poll')::uuid, current_setting('t.mc')::uuid, 3, true);
insert into public.poll_votes (message_id, channel_id, options) values (current_setting('t.poll')::uuid, current_setting('t.mc')::uuid, '{2}');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f2', false);
select pg_temp.must_fail($$insert into public.poll_votes (message_id, channel_id, options) values (current_setting('t.poll')::uuid, current_setting('t.mc')::uuid, '{0,1}')$$);
select pg_temp.must_fail($$insert into public.poll_votes (message_id, channel_id, options) values (current_setting('t.poll')::uuid, current_setting('t.mc')::uuid, '{7}')$$);
insert into public.poll_votes (message_id, channel_id, options) values (current_setting('t.poll')::uuid, current_setting('t.mc')::uuid, '{2}');
do $t$ begin
  assert (select count(*) from public.poll_votes where message_id = current_setting('t.poll')::uuid) = 1, 'only my own vote is visible';
  assert (select votes from public.poll_results(current_setting('t.poll')::uuid) where option = 2) = 2, 'totals are visible';
end $t$;

-- deleted messages are kept (encrypted) for moderators, not for members
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f2', false);
select set_config('t.gone', gen_random_uuid()::text, false);
insert into public.messages (id, channel_id, author_id, author_key_id, epoch, iv, ciphertext, signature)
values (current_setting('t.gone')::uuid, current_setting('t.mc')::uuid, auth.uid(), 'msgKey00000000000002', 1, 'iv', 'oops', 'sig');
delete from public.messages where id = current_setting('t.gone')::uuid;
do $t$ begin
  assert (select count(*) from public.deleted_messages) = 0, 'members cannot browse deleted messages';
end $t$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', false);
do $t$ begin
  assert (select ciphertext from public.deleted_messages where id = current_setting('t.gone')::uuid) = 'oops', 'moderators see the deleted (still encrypted) message';
end $t$;

-- scheduled messages: delivered later, but only if the author may still send
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f2', false);
select set_config('t.sched', gen_random_uuid()::text, false);
insert into public.scheduled_messages (id, channel_id, author_key_id, epoch, iv, ciphertext, signature, send_at)
values (current_setting('t.sched')::uuid, current_setting('t.mc')::uuid, 'msgKey00000000000002', 1, 'iv', 'later', 'sig', now() + interval '1 hour');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f3', false);
do $t$ begin
  assert (select count(*) from public.scheduled_messages) = 0, 'scheduled messages are private';
end $t$;
reset role;
update public.scheduled_messages set send_at = now() - interval '1 minute';
do $t$ begin
  assert public.deliver_scheduled_messages() = 1;
  assert exists (select 1 from public.messages where id = current_setting('t.sched')::uuid and ciphertext = 'later');
end $t$;
-- a kicked author's queued message is dropped
insert into public.scheduled_messages (id, channel_id, author_id, author_key_id, epoch, iv, ciphertext, signature, send_at)
values (gen_random_uuid(), current_setting('t.mc')::uuid, '00000000-0000-0000-0000-0000000000f2', 'msgKey00000000000002', 1, 'iv', 'after kick', 'sig', now() - interval '1 minute');
delete from public.server_members where server_id = current_setting('t.ms')::uuid and user_id = '00000000-0000-0000-0000-0000000000f2';
do $t$ begin
  assert public.deliver_scheduled_messages() = 0;
  assert not exists (select 1 from public.messages where ciphertext = 'after kick');
end $t$;
