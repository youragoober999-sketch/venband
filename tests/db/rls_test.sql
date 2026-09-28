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
select set_config('t.general', (select id::text from public.channels where server_id = current_setting('t.server')::uuid and type = 'text'), false);
select set_config('t.voice', (select id::text from public.channels where server_id = current_setting('t.server')::uuid and type = 'voice'), false);

do $t$ begin
  assert public.server_permissions(current_setting('t.server')::uuid) = 4095, 'owner has all perms';
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
  assert (select count(*) from public.channels where server_id = current_setting('t.server')::uuid) = 2,
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
  assert pg_temp.affected($$update public.roles set permissions = 4095$$) = 0, 'cannot escalate @everyone';
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
