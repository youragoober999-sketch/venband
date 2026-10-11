-- =============================================================================
-- Security hardening (October 2026 audit).
--
--  1. resolve_login no longer hands out email addresses: a username is turned
--     into an email only when the password is right, with a lockout after
--     repeated failures. Email sign-in needs no look-up at all.
--  2. Badge escalation: a moderator could give an alt the "founder" badge,
--     which counts as top staff. Founder/owner badges now need top staff, and
--     staff powers need two-factor sign-in plus per-hour safety limits.
--  3. delete_account: no more "null value in column reason" and it can also
--     ban the account's devices and network.
--  4. Hardware + network bans built on Voogle's peppered hashes, and a Voogle
--     check-in on every app start so alts are actually linked.
--  5. Invites can't be moved to another server; wordle answers are private;
--     servers can only be deleted through the recycle bin; reserved invite
--     links; activity follows profile privacy; message wipes are rate limited.
-- Safe to run more than once.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- helpers --

-- Has this account finished setting up two-factor authentication?
create or replace function public.has_mfa(p_user uuid default auth.uid())
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  return exists (select 1 from auth.mfa_factors where user_id = p_user and status = 'verified');
exception when undefined_table then
  return false;
end;
$$;

-- Every staff power goes through here: the session must have passed two-factor
-- (when the account has it), the most dangerous powers need two-factor to be
-- set up at all, and each action has a per-hour limit so a stolen staff
-- account can't wipe the platform in one go.
create or replace function public.staff_guard(p_action text, p_per_hour integer, p_needs_mfa boolean default false)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.mfa_ok() then
    raise exception 'finish two-factor sign-in on this device first';
  end if;
  if p_needs_mfa and not public.has_mfa() then
    raise exception 'turn on two-factor authentication (Settings → Security) before using this staff power';
  end if;
  if (select count(*) from public.mod_actions
      where actor_id = auth.uid() and action = p_action and created_at > now() - interval '1 hour') >= p_per_hour then
    raise exception 'safety limit reached: at most % of these per hour. Try again later.', p_per_hour;
  end if;
end;
$$;
revoke execute on function public.has_mfa(uuid), public.staff_guard(text, integer, boolean) from public, anon;
grant execute on function public.has_mfa(uuid) to authenticated;

-- ------------------------------------------------------- 1. resolve_login --

create table if not exists public.login_failures (
  key        text not null,
  failed_at  timestamptz not null default now()
);
create index if not exists login_failures_key_idx on public.login_failures (key, failed_at desc);
alter table public.login_failures enable row level security;
revoke all on public.login_failures from anon, authenticated;

-- Old shape (identifier only): kept so older apps can still log in by email,
-- but it never looks anything up any more.
drop function if exists public.resolve_login(text);
create function public.resolve_login(p_identifier text)
returns table (email text, username text, banned boolean)
language sql stable security definer set search_path = '' as $$
  select btrim(p_identifier), null::text, false
  where position('@' in coalesce(p_identifier, '')) > 0;
$$;

-- Username + password -> the account's email, only when the password is right.
create or replace function public.resolve_login(p_identifier text, p_password text)
returns table (email text, username text, banned boolean)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_name text := lower(btrim(coalesce(p_identifier, '')));
  v_key  text;
  v_mail text;
  v_hash text;
  v_ban  boolean;
begin
  if position('@' in v_name) > 0 then
    -- email logins go straight to Supabase Auth; nothing to look up
    return query select btrim(p_identifier), null::text, false;
    return;
  end if;
  if v_name !~ '^[a-z0-9_.]{2,32}$' or coalesce(p_password, '') = '' then return; end if;
  v_key := 'u:' || v_name;
  if (select count(*) from public.login_failures where key = v_key and failed_at > now() - interval '15 minutes') >= 8 then
    raise exception 'too many wrong passwords for this username. Wait 15 minutes or log in with your email.';
  end if;
  delete from public.login_failures where failed_at < now() - interval '1 day';
  select u.email, u.encrypted_password, (u.banned_until is not null and u.banned_until > now()) or p.account_status = 'banned'
    into v_mail, v_hash, v_ban
  from auth.users u join public.profiles p on p.id = u.id
  where p.username = v_name;
  if v_mail is null or coalesce(v_hash, '') = '' or extensions.crypt(p_password, v_hash) <> v_hash then
    insert into public.login_failures (key) values (v_key);
    return;
  end if;
  delete from public.login_failures where key = v_key;
  return query select v_mail, v_name, coalesce(v_ban, false);
end;
$$;
revoke execute on function public.resolve_login(text), public.resolve_login(text, text) from public;
grant execute on function public.resolve_login(text), public.resolve_login(text, text) to anon, authenticated;

-- ---------------------------------------------------- 2. badges & roles ----

create or replace function public.mod_set_badges(p_user uuid, p_badges text[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_new text[];
  v_old text[];
  v_staff_badges text[] := array['founder', 'owner', 'admin', 'moderator', 'staff'];
  v_staff_changed boolean;
begin
  if not public.mod_can_target(p_user) then raise exception 'you can''t change this account'; end if;
  select coalesce(array_agg(distinct b order by b), '{}') into v_new
  from unnest(coalesce(p_badges, '{}')) b where b = any (public.all_badges());
  select coalesce(badges, '{}') into v_old from public.profiles where id = p_user;
  v_staff_changed :=
    (select coalesce(array_agg(b order by b), '{}') from unnest(v_new) b where b = any (v_staff_badges))
    is distinct from
    (select coalesce(array_agg(b order by b), '{}') from unnest(v_old) b where b = any (v_staff_badges));
  -- founder and owner badges are the keys to the whole platform
  if (('founder' = any (v_new)) <> ('founder' = any (v_old)) or ('owner' = any (v_new)) <> ('owner' = any (v_old)))
     and not public.is_top_staff() then
    raise exception 'only Venband owners and founders can change founder or owner badges';
  end if;
  if v_staff_changed and not public.is_top_staff() and public.platform_rank() < 2 then
    raise exception 'only admins can change staff badges';
  end if;
  perform public.staff_guard('badges', 120, v_staff_changed);
  update public.profiles set badges = v_new where id = p_user;
  insert into public.mod_actions (actor_id, target_user, action, detail)
  values (auth.uid(), p_user, 'badges', array_to_string(v_new, ', '));
end;
$$;

create or replace function public.mod_set_platform_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_role not in ('user', 'moderator', 'admin', 'owner') then raise exception 'unknown role'; end if;
  if not public.is_top_staff() and public.platform_rank() < 3 then raise exception 'only top staff can change staff roles'; end if;
  if not public.mod_can_target(p_user) then raise exception 'you can''t change this account'; end if;
  perform public.staff_guard('platform_role', 10, true);
  update public.profiles set platform_role = p_role where id = p_user;
  insert into public.mod_actions (actor_id, target_user, action, detail)
  values (auth.uid(), p_user, 'platform_role', p_role);
end;
$$;

-- (the old 3-argument version made calls ambiguous)
drop function if exists public.mod_set_account_status(uuid, text, text);
create or replace function public.mod_set_account_status(p_user uuid, p_status text, p_reason text default '', p_server uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('active', 'limited', 'very_limited', 'banned') then raise exception 'unknown status'; end if;
  if p_user = auth.uid() or not public.mod_can_target(p_user) then raise exception 'you can''t change this account'; end if;
  perform public.staff_guard('account_status', 60);
  update public.profiles set account_status = p_status where id = p_user;
  -- banned accounts are signed out everywhere and can't sign in again
  update auth.users set banned_until = case when p_status = 'banned' then 'infinity'::timestamptz end
  where id = p_user;
  if p_status = 'banned' then delete from auth.sessions where user_id = p_user; end if;
  insert into public.mod_actions (actor_id, target_user, action, detail, reason)
  values (auth.uid(), p_user, 'account_status', p_status, left(coalesce(p_reason, ''), 1000));
  if p_status in ('limited', 'very_limited', 'banned') then
    perform public.venband_notice(p_user, p_status, coalesce(p_reason, ''), p_server);
  end if;
end;
$$;

-- server moderation keeps its behaviour, plus the guard
do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.mod_server_action(uuid,text,text)'::regprocedure) into v_def;
  if v_def is not null and position('staff_guard' in v_def) = 0 then
    v_def := replace(v_def,
      'if not public.is_staff() then raise exception ''staff only''; end if;',
      'if not public.is_staff() then raise exception ''staff only''; end if;
  perform public.staff_guard(''server_'' || p_action, case when p_action in (''ban'', ''reject'') then 30 else 120 end);');
    execute v_def;
  end if;
end $$;

-- -------------------------------------- 4. hardware & network bans (Voogle) --

-- Bans keyed on Voogle's peppered hashes: nobody (staff included) ever sees a
-- raw IP address or device id. Device / hardware bans are permanent until
-- lifted; network bans expire (home IP addresses change hands).
create table if not exists public.platform_bans (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('device', 'hw', 'ip')),
  hash        text not null,
  source_user uuid,
  reason      text not null default '',
  banned_by   uuid,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  unique (kind, hash)
);
alter table public.platform_bans enable row level security;
revoke all on public.platform_bans from anon, authenticated;

-- voogle_signals may hold 'hw' (a hashed machine id from the desktop and phone apps)
alter table public.voogle_signals drop constraint if exists voogle_signals_kind_check;
alter table public.voogle_signals add constraint voogle_signals_kind_check
  check (kind in ('device', 'fp', 'ip', 'net', 'signup', 'hw'));

-- The earliest active ban matching one of this account's signals.
create or replace function public.platform_ban_match(p_user uuid)
returns table (kind text, banned_at timestamptz) language sql stable security definer set search_path = '' as $$
  select b.kind, b.created_at from public.platform_bans b
  join public.voogle_signals s on s.kind = b.kind and s.hash = b.hash and s.user_id = p_user
  where (b.expires_at is null or b.expires_at > now())
    and b.source_user is distinct from p_user
  order by case b.kind when 'hw' then 0 when 'device' then 1 else 2 end, b.created_at
  limit 1;
$$;
revoke execute on function public.platform_ban_match(uuid) from public, anon, authenticated;

-- Called by the app when it starts and after every sign-in. Records hashed
-- signals (so Voogle links alts even without a server check) and enforces
-- device / hardware / network bans.
create or replace function public.voogle_checkin(p_device text, p_fp text, p_hw text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_ip inet;
  v_signup text;
  v_match text;
  v_banned_at timestamptz;
  v_created timestamptz;
  v_status text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_device !~ '^[A-Za-z0-9_-]{16,64}$' or p_fp !~ '^[0-9a-f]{64}$'
     or (p_hw is not null and p_hw !~ '^[0-9a-f]{64}$') then
    raise exception 'check-in data is malformed';
  end if;
  insert into public.voogle_signals (user_id, kind, hash) values
    (v_uid, 'device', public.voogle_hash('d|' || p_device)),
    (v_uid, 'fp', public.voogle_hash('f|' || p_fp))
  on conflict (user_id, kind, hash) do update set last_seen = now();
  if p_hw is not null then
    insert into public.voogle_signals (user_id, kind, hash) values (v_uid, 'hw', public.voogle_hash('h|' || p_hw))
    on conflict (user_id, kind, hash) do update set last_seen = now();
  end if;
  select ip into v_ip from auth.sessions where id = nullif(auth.jwt() ->> 'session_id', '')::uuid and user_id = v_uid;
  if v_ip is not null then
    insert into public.voogle_signals (user_id, kind, hash) values
      (v_uid, 'ip', public.voogle_hash('i|' || host(v_ip))),
      (v_uid, 'net', public.voogle_hash('n|' || host(network(set_masklen(v_ip, case when family(v_ip) = 4 then 24 else 48 end)))))
    on conflict (user_id, kind, hash) do update set last_seen = now();
  end if;
  select ip_hash into v_signup from public.signup_ips where user_id = v_uid order by created_at limit 1;
  if v_signup is not null then
    insert into public.voogle_signals (user_id, kind, hash) values (v_uid, 'signup', public.voogle_hash('s|' || v_signup))
    on conflict (user_id, kind, hash) do update set last_seen = now();
  end if;

  if public.is_staff(v_uid) then return jsonb_build_object('ok', true); end if;
  select m.kind, m.banned_at into v_match, v_banned_at from public.platform_ban_match(v_uid) m;
  if v_match is null then return jsonb_build_object('ok', true); end if;
  select created_at, account_status into v_created, v_status from public.profiles where id = v_uid;
  if v_created > v_banned_at and v_match in ('hw', 'device') then
    -- a new account on the device of a banned account: ban evasion
    update public.profiles set account_status = 'banned' where id = v_uid;
    update auth.users set banned_until = 'infinity'::timestamptz where id = v_uid;
    delete from auth.sessions where user_id = v_uid;
    insert into public.mod_actions (actor_id, target_user, action, detail, reason)
    values (null, v_uid, 'account_status', 'banned', 'Automatic: new account on a banned device (ban evasion)');
    return jsonb_build_object('ok', false, 'banned', true);
  elsif v_created > v_banned_at and v_status = 'active' then
    -- a new account on a banned network: read-only until staff look at it
    update public.profiles set account_status = 'very_limited' where id = v_uid;
    insert into public.mod_actions (actor_id, target_user, action, detail, reason)
    values (null, v_uid, 'account_status', 'very_limited', 'Automatic: new account on a banned network, waiting for review');
  elsif not exists (select 1 from public.mod_actions where target_user = v_uid and action = 'voogle_flag'
                    and created_at > now() - interval '7 days') then
    -- an older account sharing a banned device or network: flag it for staff, change nothing
    insert into public.mod_actions (actor_id, target_user, action, detail, reason)
    values (null, v_uid, 'voogle_flag', 'shares a ' || case v_match when 'ip' then 'network' else 'device' end
            || ' with a banned account', '');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.voogle_checkin(text, text, text) from public, anon;
grant execute on function public.voogle_checkin(text, text, text) to authenticated;

-- Staff: ban (or lift) the devices and network of an account.
create or replace function public.mod_ban_devices(p_user uuid, p_reason text default '', p_network_days integer default 30)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  if p_user = auth.uid() or not public.mod_can_target(p_user) then raise exception 'you can''t change this account'; end if;
  perform public.staff_guard('device_ban', 30);
  insert into public.platform_bans (kind, hash, source_user, reason, banned_by, expires_at)
  select s.kind, s.hash, p_user, left(coalesce(p_reason, ''), 500), auth.uid(),
         case when s.kind = 'ip' then now() + make_interval(days => greatest(1, least(coalesce(p_network_days, 30), 365))) end
  from public.voogle_signals s
  where s.user_id = p_user and s.kind in ('device', 'hw', 'ip')
    and (s.kind <> 'ip' or coalesce(p_network_days, 30) > 0)
  on conflict (kind, hash) do update set expires_at = excluded.expires_at, reason = excluded.reason;
  get diagnostics n = row_count;
  insert into public.mod_actions (actor_id, target_user, action, detail, reason)
  values (auth.uid(), p_user, 'device_ban', n || ' device/network signals', left(coalesce(p_reason, ''), 1000));
  return n;
end;
$$;

create or replace function public.mod_unban_devices(p_user uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  perform public.staff_guard('device_unban', 60);
  delete from public.platform_bans where source_user = p_user;
  get diagnostics n = row_count;
  insert into public.mod_actions (actor_id, target_user, action, detail, reason)
  values (auth.uid(), p_user, 'device_unban', n || ' signals lifted', '');
  return n;
end;
$$;

create or replace function public.mod_device_bans(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when public.is_staff() then jsonb_build_object(
    'device', count(*) filter (where kind in ('device', 'hw')),
    'network', count(*) filter (where kind = 'ip' and (expires_at is null or expires_at > now())),
    'since', min(created_at))
  else null end
  from public.platform_bans where source_user = p_user;
$$;
revoke execute on function public.mod_ban_devices(uuid, text, integer), public.mod_unban_devices(uuid),
  public.mod_device_bans(uuid) from public, anon;
grant execute on function public.mod_ban_devices(uuid, text, integer), public.mod_unban_devices(uuid),
  public.mod_device_bans(uuid) to authenticated;

-- Sign-ups from a banned network are refused (plus the 6-accounts-per-network rule).
create or replace function public.before_user_created(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ip   text := nullif(event -> 'metadata' ->> 'ip_address', '');
  v_hash text;
  v_used integer;
begin
  if v_ip is null then return '{}'::jsonb; end if;
  if exists (select 1 from public.platform_bans b
             where b.kind = 'ip' and b.hash = public.voogle_hash('i|' || v_ip)
               and (b.expires_at is null or b.expires_at > now())) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'New accounts can''t be made from this network right now.'));
  end if;
  v_hash := encode(extensions.digest(
    (select value from public.platform_config where key = 'ip_pepper') || '|' || v_ip, 'sha256'), 'hex');
  select count(*) into v_used from public.signup_ips s
  where s.ip_hash = v_hash and (s.user_id is null or exists (select 1 from auth.users u where u.id = s.user_id));
  if v_used >= 6 then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'Too many accounts have been created from this network.'));
  end if;
  insert into public.signup_ips (ip_hash, user_id)
  values (v_hash, nullif(event -> 'user' ->> 'id', '')::uuid);
  return '{}'::jsonb;
end;
$$;
-- Only Supabase Auth may run the sign-up hook. Anyone else calling it could
-- fill up a network's sign-up allowance or probe for network bans.
revoke execute on function public.before_user_created(jsonb) from public, anon, authenticated;
do $$ begin
  grant execute on function public.before_user_created(jsonb) to supabase_auth_admin;
exception when undefined_object then null;
end $$;

-- ------------------------------------------------------ 3. erase accounts --

drop function if exists public.delete_account(uuid);
create or replace function public.delete_account(p_user uuid, p_reason text default '', p_ban_devices boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_user is null then raise exception 'no user given'; end if;
  if p_user = auth.uid() then raise exception 'use delete_my_account for your own account'; end if;
  if not public.is_top_staff() then raise exception 'only owner and founder badges can erase accounts'; end if;
  if public.is_top_staff(p_user) then raise exception 'that account holds top staff badges'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'no account with that id'; end if;
  perform public.staff_guard('account_deleted', 10, true);

  if p_ban_devices then
    insert into public.platform_bans (kind, hash, source_user, reason, banned_by, expires_at)
    select s.kind, s.hash, p_user, left(coalesce(p_reason, ''), 500), auth.uid(),
           case when s.kind = 'ip' then now() + interval '30 days' end
    from public.voogle_signals s where s.user_id = p_user and s.kind in ('device', 'hw', 'ip')
    on conflict (kind, hash) do nothing;
  end if;

  select username into v_name from public.profiles where id = p_user;
  insert into public.mod_actions (actor_id, target_user, action, detail, reason)
  values (auth.uid(), p_user, 'account_deleted',
          'erased @' || coalesce(v_name, '?') || case when p_ban_devices then ' (devices banned)' else '' end,
          left(coalesce(p_reason, ''), 1000));

  delete from public.servers where owner_id = p_user;
  delete from public.channels c
  where c.type = 'dm' and c.server_id is null and not c.is_group
    and exists (select 1 from public.dm_participants d where d.channel_id = c.id and d.user_id = p_user);
  delete from public.dm_participants where user_id = p_user;
  delete from storage.objects where owner = p_user;
  delete from auth.users where id = p_user;
end;
$$;
revoke execute on function public.delete_account(uuid, text, boolean) from public, anon;
grant execute on function public.delete_account(uuid, text, boolean) to authenticated;

-- Deleting your own account needs your password (a stolen session alone
-- can't do it). Accounts without a password (none today) skip the check.
drop function if exists public.delete_my_account(text);
create or replace function public.delete_my_account(p_confirm text, p_password text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hash text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if btrim(coalesce(p_confirm, '')) <> 'I want to delete my account' then
    raise exception using message = 'type the exact phrase to confirm';
  end if;
  if not public.mfa_ok() then raise exception 'finish two-factor sign-in first'; end if;
  select encrypted_password into v_hash from auth.users where id = v_uid;
  if coalesce(v_hash, '') <> '' and (coalesce(p_password, '') = '' or extensions.crypt(p_password, v_hash) <> v_hash) then
    raise exception using message = 'that password isn''t right';
  end if;

  delete from public.servers where owner_id = v_uid and status = 'deleted';
  if exists (select 1 from public.servers where owner_id = v_uid) then
    raise exception using message = 'transfer or delete the servers you own first';
  end if;
  delete from public.channels c
  where c.type = 'dm' and c.server_id is null and not c.is_group
    and exists (select 1 from public.dm_participants d where d.channel_id = c.id and d.user_id = v_uid);
  delete from public.dm_participants where user_id = v_uid;
  delete from storage.objects where owner = v_uid;
  delete from auth.users where id = v_uid;
end;
$$;
revoke execute on function public.delete_my_account(text, text) from public, anon;
grant execute on function public.delete_my_account(text, text) to authenticated;

-- ---------------------------------------------------------- 5. the rest ----

-- Invites: only these settings can change; the server/code/uses never move.
revoke update on public.invites from authenticated;
grant update (paused, label, max_uses, expires_at) on public.invites to authenticated;

-- Wordle: the hidden word is only ever read through the bot functions.
alter table public.wordle_words enable row level security;
alter table public.wordle_games enable row level security;
revoke all on public.wordle_words, public.wordle_games from anon, authenticated;

-- Servers are deleted through delete_server (7-day recycle bin), never directly.
drop policy if exists servers_delete on public.servers;
revoke delete on public.servers from authenticated;

create or replace function public.guard_server_deleted_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.deleted_at is distinct from old.deleted_at
     and current_setting('venband.mod', true) is distinct from 'on' then
    raise exception 'use Delete Server (it can be undone for 7 days)';
  end if;
  return new;
end;
$$;
drop trigger if exists servers_deleted_at_guard on public.servers;
create trigger servers_deleted_at_guard before update on public.servers
  for each row execute function public.guard_server_deleted_at();

-- Server channels can't pretend to be group DMs.
drop policy if exists channels_insert on public.channels;
create policy channels_insert on public.channels for insert to authenticated
  with check (server_id is not null and not is_group and owner_id is null and request_to is null
              and type in ('text', 'voice', 'forum', 'announcement', 'stage')
              and public.has_permission(server_id, 8));

-- Activity (games, music) follows the same privacy as the profile.
drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities for select to authenticated
  using (user_id = auth.uid() or public.can_see_profile(user_id));

-- Connections: a "verified" mark can't be claimed from the browser.
create or replace function public.strip_connection_verified()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_setting('venband.connections', true) is distinct from 'on' then
    new.metadata := coalesce(new.metadata, '{}'::jsonb) - 'verified';
  end if;
  return new;
end;
$$;
drop trigger if exists connections_strip_verified on public.connections;
create trigger connections_strip_verified before insert or update on public.connections
  for each row execute function public.strip_connection_verified();

-- Reserved invite links apply to every server, not just ones without an owner check.
create or replace function public.set_vanity(p_server uuid, p_vanity text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v text := lower(btrim(coalesce(p_vanity, '')));
begin
  if not public.has_permission(p_server, 2) then raise exception 'you need Manage Server'; end if;
  if v = '' then
    perform set_config('venband.vanity', 'on', true);
    update public.servers set vanity = null where id = p_server;
    perform set_config('venband.vanity', 'off', true);
    return null;
  end if;
  if not (public.is_staff() or (select owner_id from public.servers where id = p_server) = auth.uid())
     and not exists (select 1 from public.servers s where s.id = p_server and (s.verified or public.member_count(s.id) >= 500)) then
    raise exception 'custom links are for verified servers or servers with 500+ members';
  end if;
  if v !~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$' then raise exception 'use 3-32 letters, numbers or dashes'; end if;
  if not public.is_staff()
     and (v ~ '(venband|voogle|vnbnd|staff|support|official|admin|moderator|security|system|helpdesk|trust-?safety)'
          or v in ('help', 'mod', 'mods', 'team', 'login', 'signin', 'verify', 'gift', 'nitro', 'free', 'billing')) then
    raise exception 'that link is reserved';
  end if;
  if exists (select 1 from public.servers where vanity = v and id <> p_server) then raise exception 'that link is taken'; end if;
  perform set_config('venband.vanity', 'on', true);
  update public.servers set vanity = v where id = p_server;
  perform set_config('venband.vanity', 'off', true);
  return v;
end;
$$;

-- Groups: you can only put friends (or people you already DM with) into a
-- group, and never someone who blocked you or whom you blocked.
create or replace function public.can_add_to_group(p_actor uuid, p_other uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not public.is_blocked_between(p_actor, p_other)
     and (public.are_friends(p_actor, p_other) or public.is_staff(p_actor)
          or exists (select 1 from public.dm_participants a
                     join public.dm_participants b on b.channel_id = a.channel_id and b.user_id = p_other
                     join public.channels c on c.id = a.channel_id and c.type = 'dm' and not c.is_group
                     where a.user_id = p_actor));
$$;
revoke execute on function public.can_add_to_group(uuid, uuid) from public, anon, authenticated;

create or replace function public.create_group(p_members uuid[], p_name text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_members uuid[];
  v_channel uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select coalesce(array_agg(distinct m), '{}') into v_members
  from unnest(coalesce(p_members, '{}')) m
  where m <> v_uid and exists (select 1 from public.profiles p where p.id = m);
  if cardinality(v_members) < 1 then raise exception 'add at least one other person'; end if;
  if cardinality(v_members) > 14 then raise exception 'groups can have at most 15 people'; end if;
  if exists (select 1 from unnest(v_members) m where not public.can_add_to_group(v_uid, m)) then
    raise exception 'you can only add friends or people you already message';
  end if;
  insert into public.channels (type, name, is_group, owner_id)
  values ('dm', left(coalesce(nullif(btrim(p_name), ''), 'Group chat'), 100), true, v_uid)
  returning id into v_channel;
  insert into public.dm_participants (channel_id, user_id)
  select v_channel, u from unnest(v_members || v_uid) u;
  return v_channel;
end;
$$;

create or replace function public.add_group_members(p_channel uuid, p_members uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.channels c where c.id = p_channel and c.is_group)
     or not exists (select 1 from public.dm_participants d where d.channel_id = p_channel and d.user_id = v_uid) then
    raise exception 'not a member of this group';
  end if;
  if exists (select 1 from unnest(coalesce(p_members, '{}')) m
             where not exists (select 1 from public.dm_participants d where d.channel_id = p_channel and d.user_id = m)
               and not public.can_add_to_group(v_uid, m)) then
    raise exception 'you can only add friends or people you already message';
  end if;
  insert into public.dm_participants (channel_id, user_id)
  select p_channel, m from unnest(coalesce(p_members, '{}')) m
  where exists (select 1 from public.profiles p where p.id = m)
  on conflict do nothing;
  if (select count(*) from public.dm_participants where channel_id = p_channel) > 15 then
    raise exception 'groups can have at most 15 people';
  end if;
end;
$$;

-- "Snap of the fingers" protection: removing other people's things is capped
-- per person (a stolen moderator account can't wipe a server in seconds).
-- Your own messages, leaving a server and cascades are never limited.
create table if not exists public.delete_ledger (
  actor_id   uuid not null,
  kind       text not null default 'message',
  deleted_at timestamptz not null default now()
);
alter table public.delete_ledger add column if not exists kind text not null default 'message';
drop index if exists public.delete_ledger_actor_idx;
create index if not exists delete_ledger_actor_kind_idx on public.delete_ledger (actor_id, kind, deleted_at desc);
alter table public.delete_ledger enable row level security;
revoke all on public.delete_ledger from anon, authenticated;

-- trigger args: kind, limit, window
create or replace function public.limit_destructive()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_kind text := tg_argv[0];
  v_limit integer := tg_argv[1]::integer;
  v_window interval := tg_argv[2]::interval;
begin
  if auth.uid() is null or pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if v_kind = 'message' then
    if old.author_id = auth.uid() then return old; end if;
  elsif v_kind = 'kick' then
    if old.user_id = auth.uid() then return old; end if;
  end if;
  if (select count(*) from public.delete_ledger
      where actor_id = auth.uid() and kind = v_kind and deleted_at > now() - v_window) >= v_limit then
    raise exception 'safety limit: at most % % actions every %. Try again shortly.', v_limit, v_kind, v_window;
  end if;
  insert into public.delete_ledger (actor_id, kind) values (auth.uid(), v_kind);
  delete from public.delete_ledger where deleted_at < now() - interval '1 day';
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop function if exists public.limit_message_wipes() cascade;
drop trigger if exists messages_wipe_limit on public.messages;
create trigger messages_wipe_limit before delete on public.messages
  for each row execute function public.limit_destructive('message', '250', '5 minutes');
drop trigger if exists channels_delete_limit on public.channels;
create trigger channels_delete_limit before delete on public.channels
  for each row when (old.server_id is not null)
  execute function public.limit_destructive('channel', '15', '10 minutes');
drop trigger if exists members_kick_limit on public.server_members;
create trigger members_kick_limit before delete on public.server_members
  for each row execute function public.limit_destructive('kick', '40', '5 minutes');
drop trigger if exists bans_limit on public.bans;
create trigger bans_limit before insert on public.bans
  for each row execute function public.limit_destructive('ban', '40', '5 minutes');
drop trigger if exists roles_delete_limit on public.roles;
create trigger roles_delete_limit before delete on public.roles
  for each row execute function public.limit_destructive('role', '15', '10 minutes');

-- Nothing that signed-out visitors don't need.
revoke execute on function public.create_invite(uuid, integer, numeric, integer, text) from anon, public;
revoke execute on function public.create_server(text, text, text) from anon, public;
do $$ begin
  revoke execute on function public.create_invite(uuid, integer, integer) from anon, public;
  revoke execute on function public.create_server(text, text) from anon, public;
exception when undefined_function then null;
end $$;

-- open_dm: the force-contact version (staff can't be walled off by a block)
-- had lost message requests. Strangers' DMs land in Message Requests again.
create or replace function public.open_dm(p_other uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_channel uuid;
  v_request uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_other = v_uid then raise exception 'cannot DM yourself'; end if;
  if not exists (select 1 from public.profiles where id = p_other) then
    raise exception 'user not found';
  end if;
  select a.channel_id into v_channel
  from public.dm_participants a
  join public.dm_participants b on a.channel_id = b.channel_id
  join public.channels c on c.id = a.channel_id and not c.is_group
  where a.user_id = v_uid and b.user_id = p_other
  limit 1;
  if v_channel is not null then return v_channel; end if;
  if public.is_blocked_between(p_other, v_uid) and not public.can_force_contact(v_uid) then
    raise exception 'you can''t message this user';
  end if;
  if not (public.account_can('dm') or public.is_staff(v_uid)
          or (public.account_can('send') and public.are_friends(p_other, v_uid))) then
    raise exception 'your account can only message friends right now';
  end if;
  -- strangers (no friendship, no shared server) start as a message request
  if not public.are_friends(p_other, v_uid) and not public.is_staff(v_uid)
     and not exists (select 1 from public.server_members a join public.server_members b on a.server_id = b.server_id
                     where a.user_id = v_uid and b.user_id = p_other) then
    v_request := p_other;
  end if;
  insert into public.channels (type, name, request_to) values ('dm', 'dm', v_request) returning id into v_channel;
  insert into public.dm_participants (channel_id, user_id) values (v_channel, v_uid), (v_channel, p_other);
  return v_channel;
end;
$$;
