-- Security regression tests for the October 2026 audit. Run via tests/db/run.sh
-- (after rls_test.sql, on the same throwaway database).
\pset tuples_only on
\o /dev/null
\set ON_ERROR_STOP 1

create function pg_temp.must_fail(p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    return;
  end;
  raise exception 'expected failure but succeeded: %', p_sql;
end $$;

create function pg_temp.fails_with(p_sql text, p_text text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_text in sqlerrm) = 0 then
      raise exception 'failed with "%" but expected "%"', sqlerrm, p_text;
    end if;
    return;
  end;
  raise exception 'expected failure but succeeded: %', p_sql;
end $$;

reset role;
select set_config('request.jwt.claim.aal', '', false);
insert into auth.users (id, email, raw_user_meta_data, encrypted_password) values
  ('00000000-0000-0000-0000-00000000f001', 'mod@example.com',   '{"username":"sec_mod"}', null),
  ('00000000-0000-0000-0000-00000000f002', 'alt@example.com',   '{"username":"sec_alt"}', null),
  ('00000000-0000-0000-0000-00000000f003', 'boss@example.com',  '{"username":"sec_boss"}', null),
  ('00000000-0000-0000-0000-00000000f004', 'vic@example.com',   '{"username":"sec_victim"}',
     extensions.crypt('correct horse battery', extensions.gen_salt('bf'))),
  ('00000000-0000-0000-0000-00000000f005', 'evader@example.com', '{"username":"sec_evader"}', null);
update public.profiles set platform_role = 'moderator' where id = '00000000-0000-0000-0000-00000000f001';
update public.profiles set platform_role = 'owner' where id = '00000000-0000-0000-0000-00000000f003';

-- 1. resolve_login never hands out an email without the password --------------
-- the victim turns on username login (the app does this after an email login)
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f004', false);
do $t$ begin
  assert (public.my_login_salt() ->> 'ready')::boolean = false;
  assert (public.my_login_salt() ->> 'salt') ~ '^[0-9a-f]{64}$';
end $t$;
select public.set_login_verifier(repeat('ab', 32));
reset role;
set role anon;
do $t$ begin
  assert (select count(*) from public.resolve_login('sec_victim')) = 0, 'username alone resolves nothing';
  assert (select email from public.resolve_login('someone@example.com')) = 'someone@example.com', 'email is echoed, not looked up';
  assert (select username from public.resolve_login('vic@example.com')) is null, 'email never reveals the username';
  assert (select count(*) from public.resolve_login('sec_victim', repeat('cd', 32))) = 0, 'wrong proof: nothing';
  assert (select email from public.resolve_login('sec_victim', repeat('ab', 32))) = 'vic@example.com', 'right proof: email';
  -- the salt is real for set-up accounts and made-up (but stable) for anyone else
  assert public.login_salt('sec_victim') ~ '^[0-9a-f]{64}$';
  assert public.login_salt('nobody_here') = public.login_salt('nobody_here');
  assert public.login_salt('nobody_here') <> public.login_salt('sec_victim');
end $t$;
-- accounts that never set it up are told to use their email once
select pg_temp.fails_with($$select public.resolve_login('sec_boss', repeat('ab', 32))$$, 'log in with your email');
-- nobody else can set it up for you, or read the table
select pg_temp.must_fail($$select public.set_login_verifier(repeat('ab', 32))$$);
select pg_temp.must_fail($$select * from public.login_verifiers$$);
-- lockout after 8 wrong proofs
do $t$ begin
  for i in 1..8 loop perform public.resolve_login('sec_victim', repeat('0' || i, 32)); end loop;
end $t$;
select pg_temp.fails_with($$select public.resolve_login('sec_victim', repeat('ab', 32))$$, 'too many wrong passwords');
reset role;
delete from public.login_failures;

-- 2. a moderator can't mint a founder (or owner) badge ---------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f001', false);
select pg_temp.fails_with($$select public.mod_set_badges('00000000-0000-0000-0000-00000000f002', array['founder'])$$, 'founder');
select pg_temp.fails_with($$select public.mod_set_badges('00000000-0000-0000-0000-00000000f002', array['owner'])$$, 'founder or owner');
select pg_temp.fails_with($$select public.mod_set_badges('00000000-0000-0000-0000-00000000f002', array['admin'])$$, 'only admins');
select public.mod_set_badges('00000000-0000-0000-0000-00000000f002', array['og']);  -- normal badges still fine
do $t$ begin
  assert not public.is_top_staff('00000000-0000-0000-0000-00000000f002'), 'alt is still not top staff';
end $t$;
-- staff powers need a finished two-factor sign-in when the account has 2FA
reset role;
insert into auth.mfa_factors (user_id, status) values ('00000000-0000-0000-0000-00000000f001', 'verified');
set role authenticated;
select pg_temp.fails_with($$select public.mod_set_account_status('00000000-0000-0000-0000-00000000f002', 'limited')$$, 'two-factor');
select set_config('request.jwt.claim.aal', 'aal2', false);
select public.mod_set_account_status('00000000-0000-0000-0000-00000000f002', 'active');
select set_config('request.jwt.claim.aal', '', false);

-- 3. erasing an account: needs 2FA set up, logs the reason, never null ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f003', false);
select pg_temp.fails_with($$select public.delete_account('00000000-0000-0000-0000-00000000f002')$$, 'two-factor');
reset role;
insert into auth.mfa_factors (user_id, status) values ('00000000-0000-0000-0000-00000000f003', 'verified');
-- the account to erase leaves device signals behind
insert into public.voogle_signals (user_id, kind, hash) values
  ('00000000-0000-0000-0000-00000000f002', 'device', public.voogle_hash('d|alt-device-token-123456')),
  ('00000000-0000-0000-0000-00000000f002', 'ip', public.voogle_hash('i|203.0.113.7'));
set role authenticated;
select set_config('request.jwt.claim.aal', 'aal2', false);
select public.delete_account('00000000-0000-0000-0000-00000000f002', null, true);
reset role;
do $t$ begin
  assert not exists (select 1 from auth.users where id = '00000000-0000-0000-0000-00000000f002'), 'erased';
  assert (select reason from public.mod_actions where action = 'account_deleted' order by created_at desc limit 1) = '', 'null reason becomes empty';
  assert (select count(*) from public.platform_bans where source_user = '00000000-0000-0000-0000-00000000f002') = 2, 'device + network banned';
end $t$;

-- 4. a new account on that banned device is caught at check-in -------------------
set role authenticated;
select set_config('request.jwt.claim.aal', '', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f005', false);
reset role;
update public.profiles set created_at = now() + interval '1 second' where id = '00000000-0000-0000-0000-00000000f005';
set role authenticated;
do $t$ begin
  assert (public.voogle_checkin('alt-device-token-123456', repeat('a', 64)) ->> 'banned')::boolean, 'ban evasion detected';
end $t$;
reset role;
do $t$ begin
  assert (select account_status from public.profiles where id = '00000000-0000-0000-0000-00000000f005') = 'banned';
  assert (select banned_until from auth.users where id = '00000000-0000-0000-0000-00000000f005') = 'infinity';
end $t$;
-- sign-ups from the banned network are refused by the auth hook
do $t$ begin
  assert (public.before_user_created('{"metadata": {"ip_address": "203.0.113.7"}}') -> 'error' ->> 'http_code') = '403';
  assert (public.before_user_created('{"metadata": {"ip_address": "198.51.100.1"}}') -> 'error') is null;
end $t$;
-- ...and nobody can call the hook from the app
set role authenticated;
select pg_temp.must_fail($$select public.before_user_created('{"metadata": {"ip_address": "1.2.3.4"}}')$$);
set role anon;
select pg_temp.must_fail($$select public.before_user_created('{"metadata": {"ip_address": "1.2.3.4"}}')$$);
select pg_temp.must_fail($$select public.voogle_checkin('alt-device-token-123456', repeat('a', 64))$$);
select pg_temp.must_fail($$select * from public.platform_bans$$);

-- 5. invites stay in their server; wordle answers stay hidden ------------------
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f004', false);
select set_config('t.mine', public.create_server('Mine')::text, false);
select set_config('t.code', public.create_invite(current_setting('t.mine')::uuid, 5, 1.0, 0, 'x'), false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f003', false);
select set_config('t.theirs', public.create_server('Private')::text, false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f004', false);
select pg_temp.must_fail($$update public.invites set server_id = current_setting('t.theirs')::uuid where code = current_setting('t.code')$$);
select pg_temp.must_fail($$update public.invites set uses = 0 where code = current_setting('t.code')$$);
update public.invites set paused = true where code = current_setting('t.code');
select pg_temp.must_fail($$select * from public.wordle_words$$);
select pg_temp.must_fail($$select * from public.wordle_games$$);

-- 6. servers only go through the recycle bin -----------------------------------
select pg_temp.must_fail($$update public.servers set deleted_at = now() where id = current_setting('t.mine')::uuid$$);
select pg_temp.must_fail($$delete from public.servers where id = current_setting('t.mine')::uuid$$);
select public.delete_server(current_setting('t.mine')::uuid);
select public.restore_server(current_setting('t.mine')::uuid);

-- 7. "snap of the fingers": channel wipes are capped ---------------------------
do $t$
declare
  i integer;
  v uuid;
begin
  for i in 1..15 loop
    insert into public.channels (server_id, name, type) values (current_setting('t.mine')::uuid, 'wipe' || i, 'text');
    select id into v from public.channels where server_id = current_setting('t.mine')::uuid and name = 'wipe' || i;
    delete from public.channels where id = v;
  end loop;
end $t$;
select set_config('t.c16', (select id::text from public.channels where server_id = current_setting('t.mine')::uuid limit 1), false);
select pg_temp.fails_with($$delete from public.channels where id = current_setting('t.c16')::uuid$$, 'safety limit');
-- server channels can't impersonate group DMs
select pg_temp.must_fail($$insert into public.channels (server_id, name, type, is_group) values (current_setting('t.mine')::uuid, 'g', 'text', true)$$);

-- 8. connections can't self-certify; account deletion needs the password --------
select public.add_connection('steam', '76561198000000000', 'Gabe', null, '{"verified": true}');
do $t$ begin
  assert not ((select metadata from public.my_connections() limit 1) ? 'verified'), 'verified mark stripped';
end $t$;
select pg_temp.fails_with($$select public.delete_my_account('I want to delete my account', 'nope')$$, 'password');

reset role;
