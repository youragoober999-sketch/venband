-- Official notifications, security alerts and impersonation guards
-- (20261106010000_official_notifications.sql). Runs after all migrations.
create function pg_temp.nt_must_fail(p_sql text, p_expect text default null) returns void language plpgsql as $$
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
create function pg_temp.nt_as(p_id uuid, p_session uuid default null) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_id::text, false),
         set_config('request.jwt.claim.session_id', coalesce(p_session::text, ''), false),
         -- real Supabase builds auth.jwt() from the full claims
         set_config('request.jwt.claims', json_build_object('sub', p_id, 'session_id', p_session)::text, false);
$$;
create function pg_temp.nt_count(p_user uuid, p_kind text) returns integer language sql as $$
  select count(*)::int from public.notifications where user_id = p_user and kind = p_kind;
$$;
create function pg_temp.nt_dm_titles(p_user uuid) returns text[] language sql as $$
  select coalesce(array_agg(m.embed ->> 'title' order by m.created_at), '{}')
    from public.bot_messages m
    join public.applications a on a.id = m.app_id and a.owner_id = '3fff0000-0000-4000-8000-0000000000bd'
    join public.dm_participants p on p.channel_id = m.channel_id and p.user_id = p_user;
$$;

reset role;
insert into auth.users (id, email, raw_user_meta_data, encrypted_password) values
  ('a0000000-0000-4000-8000-000000000001', 'old@example.com', '{"username":"oldtimer"}', 'hash-1'),
  ('a0000000-0000-4000-8000-000000000002', 'new@example.com', '{"username":"newcomer"}', 'hash-2'),
  ('a0000000-0000-4000-8000-000000000003', 'admin@example.com', '{"username":"ntadmin"}', 'hash-3');
update public.profiles set created_at = now() - interval '30 days' where id in ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003');
update public.profiles set platform_role = 'admin' where id = 'a0000000-0000-4000-8000-000000000003';
do $t$ begin
  assert exists (select 1 from public.applications where owner_id = '3fff0000-0000-4000-8000-0000000000bd' and preset = 'venband'), 'official app exists';
end $t$;

-- -------------------------------------------------------------- new sign-in --
set role authenticated;
select pg_temp.nt_as('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001');
insert into public.device_sessions (session_id, user_id, label, city, country)
values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Firefox on Windows', 'Lisbon', 'Portugal');
-- the app re-registers the same session on every load: still one alert
insert into public.device_sessions (session_id, user_id, label) values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Firefox on Windows')
on conflict (session_id) do update set updated_at = now();
reset role;
do $t$ begin
  assert pg_temp.nt_count('a0000000-0000-4000-8000-000000000001', 'new_signin') = 1, 'one sign-in alert';
  assert (select body from public.notifications where kind = 'new_signin' and user_id = 'a0000000-0000-4000-8000-000000000001') like '%Firefox on Windows near Lisbon, Portugal%';
  assert 'New sign-in to your account' = any (pg_temp.nt_dm_titles('a0000000-0000-4000-8000-000000000001')), 'official DM sent';
end $t$;
-- a brand-new account's first device is just the signup
set role authenticated;
select pg_temp.nt_as('a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002');
insert into public.device_sessions (session_id, user_id, label) values ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'Chrome');
reset role;
do $t$ begin
  assert pg_temp.nt_count('a0000000-0000-4000-8000-000000000002', 'new_signin') = 0, 'no alert for the signup itself';
end $t$;

-- ------------------------------------------------------- device signed out --
insert into auth.sessions (id, user_id) values ('b0000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000001');
set role authenticated;
select pg_temp.nt_as('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001');
select public.revoke_device('b0000000-0000-4000-8000-000000000009');
select public.revoke_device('b0000000-0000-4000-8000-000000000009'); -- nothing left: no second alert
reset role;
do $t$ begin
  assert pg_temp.nt_count('a0000000-0000-4000-8000-000000000001', 'session_revoked') = 1;
end $t$;

-- ------------------------------------------------- password / email / 2FA --
update auth.users set encrypted_password = 'hash-1b' where id = 'a0000000-0000-4000-8000-000000000001';
update auth.users set email = 'old2@example.com' where id = 'a0000000-0000-4000-8000-000000000001';
update auth.users set raw_user_meta_data = raw_user_meta_data where id = 'a0000000-0000-4000-8000-000000000001'; -- unrelated change
insert into auth.mfa_factors (id, user_id, status, factor_type, created_at, updated_at) values ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'unverified', 'totp', now(), now());
update auth.mfa_factors set status = 'verified' where id = 'c0000000-0000-4000-8000-000000000001';
delete from auth.mfa_factors where id = 'c0000000-0000-4000-8000-000000000001';
do $t$ begin
  assert pg_temp.nt_count('a0000000-0000-4000-8000-000000000001', 'password_changed') = 1, 'password alert';
  assert (select severity from public.notifications where kind = 'password_changed' and user_id = 'a0000000-0000-4000-8000-000000000001') = 'critical';
  assert pg_temp.nt_count('a0000000-0000-4000-8000-000000000001', 'email_changed') = 1, 'email alert';
  assert pg_temp.nt_count('a0000000-0000-4000-8000-000000000001', 'mfa_enabled') = 1, '2FA on';
  assert pg_temp.nt_count('a0000000-0000-4000-8000-000000000001', 'mfa_disabled') = 1, '2FA off';
  assert 'Your password was changed' = any (pg_temp.nt_dm_titles('a0000000-0000-4000-8000-000000000001'));
end $t$;
-- a broken notification can never block a password change
alter table public.notifications add constraint nt_break check (kind <> 'password_changed') not valid; -- existing rows ignored; new ones rejected
update auth.users set encrypted_password = 'hash-1c' where id = 'a0000000-0000-4000-8000-000000000001';
do $t$ begin
  assert (select encrypted_password from auth.users where id = 'a0000000-0000-4000-8000-000000000001') = 'hash-1c', 'password change still succeeded';
end $t$;
alter table public.notifications drop constraint nt_break;

-- --------------------------------------------------------------- moderation --
set role authenticated;
select pg_temp.nt_as('a0000000-0000-4000-8000-000000000003');
select public.mod_set_account_status('a0000000-0000-4000-8000-000000000001', 'limited', 'Spamming invites');
select public.mod_set_account_status('a0000000-0000-4000-8000-000000000001', 'active', 'Appeal accepted');
reset role;
do $t$ begin
  assert pg_temp.nt_count('a0000000-0000-4000-8000-000000000001', 'account_limited') = 1, 'restriction notice';
  assert (select data ->> 'reason' from public.notifications where kind = 'account_limited' and user_id = 'a0000000-0000-4000-8000-000000000001') = 'Spamming invites';
  assert pg_temp.nt_count('a0000000-0000-4000-8000-000000000001', 'account_restored') = 1, 'restoration notice';
  assert 'Your account was limited' = any (pg_temp.nt_dm_titles('a0000000-0000-4000-8000-000000000001'));
end $t$;

-- ------------------------------------------------- marketplace + reports --
set role authenticated;
select pg_temp.nt_as('a0000000-0000-4000-8000-000000000001');
select set_config('nt.theme', public.theme_save(null, 'theme', 'Glow', '', '{"vars": {"bg-0": "#000", "bg-1": "#111", "bg-2": "#222", "text": "#fff"}}'::jsonb)::text, false);
select public.theme_publish(current_setting('nt.theme')::uuid, '');
select pg_temp.nt_as('a0000000-0000-4000-8000-000000000003');
select public.theme_set_status(current_setting('nt.theme')::uuid, 'removed', 'Copied another creator''s theme');
select pg_temp.nt_as('a0000000-0000-4000-8000-000000000002');
insert into public.reports (reporter_id, kind, target_user, reason)
values ('a0000000-0000-4000-8000-000000000002', 'user', 'a0000000-0000-4000-8000-000000000001', 'Rude in DMs');
select pg_temp.nt_as('a0000000-0000-4000-8000-000000000003');
select public.handle_report((select id from public.reports where reporter_id = 'a0000000-0000-4000-8000-000000000002'), 'dismissed', '');
reset role;
do $t$ begin
  assert pg_temp.nt_count('a0000000-0000-4000-8000-000000000001', 'marketplace_removed') = 1, 'creator told about the removal';
  assert (select data ->> 'reason' from public.notifications where kind = 'marketplace_removed' and user_id = 'a0000000-0000-4000-8000-000000000001') = 'Copied another creator''s theme';
  assert pg_temp.nt_count('a0000000-0000-4000-8000-000000000002', 'report_dismissed') = 1, 'reporter told the outcome';
  assert pg_temp.nt_count('a0000000-0000-4000-8000-000000000001', 'report_dismissed') = 0, 'the reported person is not told who reported';
end $t$;

-- ----------------------------------------- notifications are read-only data --
set role authenticated;
select pg_temp.nt_as('a0000000-0000-4000-8000-000000000002');
do $t$ begin
  assert (select count(*) from public.notifications where user_id <> auth.uid()) = 0, 'only your own notifications';
end $t$;
select pg_temp.nt_must_fail($$insert into public.notifications (user_id, category, kind, title) values (auth.uid(), 'security', 'fake', 'Fake alert')$$);
select pg_temp.nt_must_fail($$insert into public.notifications (user_id, category, kind, title) values ('a0000000-0000-4000-8000-000000000001', 'security', 'fake', 'Your account will be deleted')$$);
select pg_temp.nt_must_fail($$select public.notify('a0000000-0000-4000-8000-000000000001', 'security', 'fake', 'Phish', '')$$, 'permission denied');
select pg_temp.nt_must_fail($$select public.official_dm('a0000000-0000-4000-8000-000000000001', 'Venband support', 'Send us your password')$$, 'permission denied');
select pg_temp.nt_must_fail($$update public.notifications set title = 'Edited' where user_id = auth.uid()$$);
select pg_temp.nt_must_fail($$delete from public.notifications where user_id = auth.uid()$$);
do $t$ begin
  assert public.mark_notifications_read() = 1, 'mark all read';
  assert (select count(*) from public.notifications where user_id = auth.uid() and read_at is null) = 0;
end $t$;

-- ------------------------------------------------- impersonation guards --
select pg_temp.nt_must_fail($$select public.create_application('Venband', 'venband')$$, 'reserved');
select pg_temp.nt_must_fail($$select public.create_application('Official Support', 'custom')$$, 'reserved');
select set_config('nt.app', public.create_application('Mod Toolkit', 'venband')::text, false); -- the toolkit preset stays open
select set_config('nt.server', public.create_server('Guard test')::text, false);
reset role;
insert into public.server_bots (server_id, app_id) values (current_setting('nt.server')::uuid, current_setting('nt.app')::uuid);
insert into public.bot_messages (server_id, channel_id, app_id, username, content)
select current_setting('nt.server')::uuid, c.id, current_setting('nt.app')::uuid, 'Venband Official', 'Your account is suspended, verify here'
  from public.channels c where c.server_id = current_setting('nt.server')::uuid and c.type = 'text' limit 1;
do $t$ begin
  assert (select username from public.bot_messages where content like 'Your account is suspended%') is null, 'reserved display name dropped';
end $t$;

-- ----------------------------------------------------- dedupe and DM cap --
do $t$
declare i int;
begin
  perform public.notify('a0000000-0000-4000-8000-000000000002', 'platform', 'test_dedupe', 'Once', '', 'info', '{}', '{}', false, '[]', 'same-key');
  perform public.notify('a0000000-0000-4000-8000-000000000002', 'platform', 'test_dedupe', 'Once', '', 'info', '{}', '{}', false, '[]', 'same-key');
  assert pg_temp.nt_count('a0000000-0000-4000-8000-000000000002', 'test_dedupe') = 1, 'deduplicated';
  for i in 1..15 loop
    perform public.notify('a0000000-0000-4000-8000-000000000002', 'platform', 'test_flood', 'Flood ' || i, '', 'info', '{}', '{}', true, '[]', null);
  end loop;
  assert pg_temp.nt_count('a0000000-0000-4000-8000-000000000002', 'test_flood') = 15, 'every notification is kept';
  assert (select count(*) from public.notifications where user_id = 'a0000000-0000-4000-8000-000000000002' and data ? 'dm') <= 10, 'but DMs are capped at 10 an hour';
  perform public.notify('a0000000-0000-4000-8000-000000000002', 'platform', 'test_bad', 'x', '', 'info', array['javascript:alert(1)']);
exception when others then
  if sqlerrm not like 'bad notification action%' then raise; end if;
end $t$;
reset role;
