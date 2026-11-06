-- Staff permissions, appeals, theme / bot reports, audit search
-- (20261106050000_staff_permissions_appeals.sql). Runs after all migrations.
create function pg_temp.st_must_fail(p_sql text, p_expect text default null) returns void language plpgsql as $$
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
create function pg_temp.st_as(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_id::text, false);
$$;

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('5f000000-0000-4000-8000-000000000001', 'st-owner@example.com', '{"username":"stowner"}'),
  ('5f000000-0000-4000-8000-000000000002', 'st-admin@example.com', '{"username":"stadmin"}'),
  ('5f000000-0000-4000-8000-000000000003', 'st-mod@example.com', '{"username":"stmod"}'),
  ('5f000000-0000-4000-8000-000000000004', 'st-user@example.com', '{"username":"stuser"}'),
  ('5f000000-0000-4000-8000-000000000005', 'st-other@example.com', '{"username":"stother"}');
update public.profiles set platform_role = 'owner' where id = '5f000000-0000-4000-8000-000000000001';
update public.profiles set platform_role = 'admin' where id = '5f000000-0000-4000-8000-000000000002';
update public.profiles set platform_role = 'moderator' where id = '5f000000-0000-4000-8000-000000000003';

-- role defaults = what each rank could do before
do $t$ begin
  assert public.staff_permissions_for('5f000000-0000-4000-8000-000000000001') = public.staff_permission_keys(), 'owner: everything';
  assert public.staff_permissions_for('5f000000-0000-4000-8000-000000000002') = public.staff_permission_keys(), 'admin: everything';
  assert not ('reports' = any (public.staff_permissions_for('5f000000-0000-4000-8000-000000000003'))), 'moderators: no Report Centre (as before)';
  assert 'ban' = any (public.staff_permissions_for('5f000000-0000-4000-8000-000000000003'));
  assert public.staff_permissions_for('5f000000-0000-4000-8000-000000000004') = '{}', 'users: nothing';
end $t$;

set role authenticated;
-- users and non-owners can't hand out permissions; nobody writes the column directly
select pg_temp.st_as('5f000000-0000-4000-8000-000000000002');
select pg_temp.st_must_fail($$select public.mod_set_staff_permissions('5f000000-0000-4000-8000-000000000003', array['audit'])$$, 'only Venband owners');
select pg_temp.st_must_fail($$update public.profiles set staff_permissions = array['reports'] where id = auth.uid()$$);
select pg_temp.st_as('5f000000-0000-4000-8000-000000000001');
select pg_temp.st_must_fail($$select public.mod_set_staff_permissions('5f000000-0000-4000-8000-000000000004', array['audit'])$$, 'aren''t Venband staff');
select pg_temp.st_must_fail($$select public.mod_set_staff_permissions('5f000000-0000-4000-8000-000000000003', array['everything'])$$, 'unknown permission');

-- the owner narrows the moderator to restricting accounts + the audit log
do $t$ begin
  assert public.mod_set_staff_permissions('5f000000-0000-4000-8000-000000000003', array['audit', 'accounts', 'audit']) = array['accounts', 'audit'];
end $t$;
select pg_temp.st_as('5f000000-0000-4000-8000-000000000003');
select public.mod_set_account_status('5f000000-0000-4000-8000-000000000004', 'limited', 'spam');
select pg_temp.st_must_fail($$select public.mod_set_account_status('5f000000-0000-4000-8000-000000000004', 'banned', 'x')$$, 'permissions');
select pg_temp.st_must_fail($$select public.mod_set_badges('5f000000-0000-4000-8000-000000000004', array['og'])$$, 'permissions');
do $t$ begin
  assert public.my_staff_permissions() = array['accounts', 'audit'];
  assert (select count(*) from public.mod_log_search('stuser')) >= 1, 'audit search by username';
  assert (select count(*) from public.mod_log_search('stuser', 'account_status')) >= 1, 'filter by action';
  assert (select count(*) from public.mod_log_search('stuser', 'badges')) = 0, 'action filter';
end $t$;

-- …and grants them back: NULL = role defaults again
select pg_temp.st_as('5f000000-0000-4000-8000-000000000001');
select public.mod_set_staff_permissions('5f000000-0000-4000-8000-000000000003', null);
select pg_temp.st_as('5f000000-0000-4000-8000-000000000003');
do $t$ begin
  assert 'badges' = any (public.my_staff_permissions());
end $t$;

-- appeals: the limited user appeals; only once at a time; no self-handling
select pg_temp.st_as('5f000000-0000-4000-8000-000000000005');
select pg_temp.st_must_fail($$select public.submit_appeal('account', null, 'please let me back in, it was a mistake')$$, 'isn''t restricted');
select pg_temp.st_as('5f000000-0000-4000-8000-000000000004');
select pg_temp.st_must_fail($$select public.submit_appeal('account', null, 'short')$$, '10–2000');
select public.submit_appeal('account', null, 'I was not spamming, those were invites my friends asked for.');
select pg_temp.st_must_fail($$select public.submit_appeal('account', null, 'second appeal for the same thing')$$, 'already have an open appeal');
select pg_temp.st_must_fail($$insert into public.appeals (user_id, kind, message) values (auth.uid(), 'account', 'direct insert attempt here')$$);
do $t$ begin
  assert (select count(*) from public.appeals) = 1, 'the appellant sees their own appeal';
end $t$;
select pg_temp.st_as('5f000000-0000-4000-8000-000000000005');
do $t$ begin
  assert (select count(*) from public.appeals) = 0, 'others don''t';
end $t$;

-- moderators can't decide appeals by default; admins can
select pg_temp.st_as('5f000000-0000-4000-8000-000000000003');
select pg_temp.st_must_fail($$select public.handle_appeal((select id from public.appeals limit 1), true, '')$$);
select pg_temp.st_as('5f000000-0000-4000-8000-000000000002');
select pg_temp.st_must_fail($$select public.handle_appeal((select id from public.appeals limit 1), false, '')$$, 'tell them why');
select public.handle_appeal((select id from public.appeals limit 1), true, 'Looked at it — you are right.');
reset role;
do $t$ begin
  assert (select account_status from public.profiles where id = '5f000000-0000-4000-8000-000000000004') = 'active', 'accepted appeal restores the account';
  assert (select status from public.appeals limit 1) = 'accepted';
  assert exists (select 1 from public.notifications where user_id = '5f000000-0000-4000-8000-000000000004' and kind = 'appeal_result');
end $t$;

-- themes and bots can be reported (not your own, not twice), and disabled bots appealed
insert into public.applications (id, owner_id, name) values ('5fa00000-0000-4000-8000-000000000001', '5f000000-0000-4000-8000-000000000005', 'Spammy Bot');
set role authenticated;
select pg_temp.st_as('5f000000-0000-4000-8000-000000000004');
select public.report_item('app', '5fa00000-0000-4000-8000-000000000001', 'It DMs everyone ads');
select pg_temp.st_must_fail($$select public.report_item('app', '5fa00000-0000-4000-8000-000000000001', 'again')$$, 'already reported');
select pg_temp.st_must_fail($$insert into public.reports (reporter_id, kind, target_ref, reason) values (auth.uid(), 'theme', gen_random_uuid(), 'x')$$);
select pg_temp.st_as('5f000000-0000-4000-8000-000000000005');
select pg_temp.st_must_fail($$select public.report_item('app', '5fa00000-0000-4000-8000-000000000001', 'my own bot')$$, 'your own');
-- the Report Centre (admins) sees it; a moderator doesn't by default
select pg_temp.st_as('5f000000-0000-4000-8000-000000000003');
do $t$ begin assert (select count(*) from public.reports where kind = 'app') = 0; end $t$;
select public.mod_app_action('5fa00000-0000-4000-8000-000000000001', 'disable', 'Spam bot');
select pg_temp.st_as('5f000000-0000-4000-8000-000000000002');
do $t$ begin assert (select count(*) from public.reports where kind = 'app') = 1; end $t$;
select pg_temp.st_as('5f000000-0000-4000-8000-000000000005');
select pg_temp.st_must_fail($$update public.applications set status = 'active' where id = '5fa00000-0000-4000-8000-000000000001'$$);
select public.submit_appeal('app', '5fa00000-0000-4000-8000-000000000001', 'It only sends one welcome message, nothing else.');
select pg_temp.st_as('5f000000-0000-4000-8000-000000000002');
select public.handle_appeal((select id from public.appeals where kind = 'app'), false, 'Reports show it sends ads.');
select pg_temp.st_as('5f000000-0000-4000-8000-000000000005');
select pg_temp.st_must_fail($$select public.submit_appeal('app', '5fa00000-0000-4000-8000-000000000001', 'Please look again, it really is fine.')$$, 'denied recently');
reset role;
do $t$ begin
  assert (select status from public.applications where id = '5fa00000-0000-4000-8000-000000000001') = 'disabled', 'denied appeal keeps it disabled';
  assert exists (select 1 from public.notifications where user_id = '5f000000-0000-4000-8000-000000000005' and kind = 'app_disable');
end $t$;
