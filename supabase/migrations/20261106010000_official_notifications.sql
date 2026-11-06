-- =============================================================================
-- Official notifications + security alerts (20261106010000)
--
--   * public.notifications: the notification center. Rows are created ONLY by the
--     database (SECURITY DEFINER functions/triggers below) — the API can read your
--     own and mark them read, never create, edit or delete them. Deleting the DM
--     with Venband doesn't remove a notification.
--   * public.notify(): the one way to notify someone. Optionally also sends the
--     official Venband DM. Deduplicates, and caps DMs so nobody gets spammed.
--     Not callable through the API.
--   * Real events that notify:
--       security   — new sign-in (device_sessions), device signed out, password
--                    changed/reset, email changed, two-factor on/off (auth triggers)
--       moderation — account limited / restricted / banned (venband_notice), and
--                    restrictions lifted (profile status trigger)
--       platform   — marketplace item removed / restored by staff
--       community  — your report was reviewed
--   * Official identity can't be faked: only the fixed system account may name an
--     app "Venband"/"Official" (the 'venband' moderation-toolkit preset stays open
--     to everyone), and other bots/webhooks can't post under such a display name
--     (it's dropped). The app marks official messages by the app's OWNER (server
--     data), never by a name or preset.
--
-- Safe to run more than once.
-- =============================================================================

-- ------------------------------------------------------------- the table --
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  category   text not null check (category in ('security', 'moderation', 'platform', 'community')),
  kind       text not null check (kind ~ '^[a-z_]{2,40}$'),
  severity   text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  title      text not null check (char_length(title) between 1 and 160),
  body       text not null default '' check (char_length(body) <= 2000),
  data       jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 8000),
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;
alter table public.notifications enable row level security;

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
exception when undefined_object then raise notice 'no supabase_realtime publication; live notification updates disabled';
end $$;

-- ------------------------------------------------------------ official DM --
-- Posts an embed from the official Venband account into its DM with the user.
-- Internal only: no staff check because the database calls it for system events.
create or replace function public.official_dm(p_user uuid, p_title text, p_body text, p_color text default '#5865f2',
                                              p_fields jsonb default '[]'::jsonb, p_footer text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_venband constant uuid := '3fff0000-0000-4000-8000-0000000000bd';
  v_channel uuid;
  v_app uuid;
begin
  if p_user is null or p_user = v_venband then return; end if;
  if not exists (select 1 from public.profiles where id = p_user) then return; end if;
  select id into v_app from public.applications where owner_id = v_venband and preset = 'venband' order by created_at limit 1;
  if v_app is null then return; end if;
  select a.channel_id into v_channel
    from public.dm_participants a
    join public.dm_participants b on a.channel_id = b.channel_id
    join public.channels c on c.id = a.channel_id and not c.is_group
   where a.user_id = v_venband and b.user_id = p_user
   limit 1;
  if v_channel is null then
    insert into public.channels (type, name) values ('dm', 'dm') returning id into v_channel;
    insert into public.dm_participants (channel_id, user_id) values (v_channel, v_venband), (v_channel, p_user);
  end if;
  insert into public.bot_messages (channel_id, app_id, username, content, embed)
  values (v_channel, v_app, 'Venband', '',
          jsonb_build_object('title', left(p_title, 256), 'description', left(coalesce(p_body, ''), 2000),
                             'color', coalesce(p_color, '#5865f2'), 'fields', coalesce(p_fields, '[]'::jsonb),
                             'footer', coalesce(p_footer, 'Official Venband notice · verify it in Settings → Security → Official notices')));
end;
$$;

-- ----------------------------------------------------------------- notify --
create or replace function public.notify(
  p_user uuid, p_category text, p_kind text, p_title text, p_body text default '',
  p_severity text default 'info', p_actions text[] default '{}', p_data jsonb default '{}'::jsonb,
  p_dm boolean default false, p_dm_fields jsonb default '[]'::jsonb, p_dedupe text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  a text;
begin
  if p_user is null or p_user = '3fff0000-0000-4000-8000-0000000000bd' then return null; end if;
  if not exists (select 1 from public.profiles where id = p_user) then return null; end if;
  foreach a in array coalesce(p_actions, '{}') loop
    if a !~ '^[a-z_]{2,32}$' then raise exception 'bad notification action %', a; end if;
  end loop;
  -- the same event (e.g. one sign-in) never notifies twice
  if p_dedupe is not null and exists (
       select 1 from public.notifications
        where user_id = p_user and data ->> 'dedupe' = p_dedupe and created_at > now() - interval '1 day') then
    return null;
  end if;
  insert into public.notifications (user_id, category, kind, severity, title, body, data)
  values (p_user, p_category, p_kind, coalesce(p_severity, 'info'), left(p_title, 160), left(coalesce(p_body, ''), 2000),
          coalesce(p_data, '{}'::jsonb)
            || jsonb_build_object('actions', to_jsonb(coalesce(p_actions, '{}')))
            || case when p_dedupe is null then '{}'::jsonb else jsonb_build_object('dedupe', p_dedupe) end)
  returning id into v_id;
  -- official DMs: at most 10 an hour per person (the notification itself is always kept)
  if p_dm and (select count(*) from public.notifications
                where user_id = p_user and created_at > now() - interval '1 hour' and data ? 'dm') < 10 then
    update public.notifications set data = data || '{"dm": true}'::jsonb where id = v_id;
    perform public.official_dm(p_user, p_title, p_body,
      case p_severity when 'critical' then '#ed4245' when 'warning' then '#faa61a' else '#5865f2' end,
      coalesce(p_dm_fields, '[]'::jsonb));
  end if;
  return v_id;
end;
$$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------- moderation notices --
-- Same messages as before, now also in the notification center.
create or replace function public.venband_notice(p_user uuid, p_status text, p_reason text default '', p_server uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_title text;
  v_body text;
  v_sev text;
  v_fields jsonb := '[]'::jsonb;
  v_server text;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  if p_server is not null then
    select name into v_server from public.servers where id = p_server;
    if v_server is not null then v_fields := v_fields || jsonb_build_object('name', 'Server', 'value', v_server); end if;
  end if;
  if p_status = 'banned' then
    v_title := 'Your account was banned';
    v_sev := 'critical';
    v_body := 'You can no longer sign in to Venband. If you think this is a mistake, contact support.';
  elsif p_status = 'very_limited' then
    v_title := 'Your account was restricted';
    v_sev := 'critical';
    v_body := 'Your account is now read-only: no messages, calls, servers, DMs or friend requests for now.';
  elsif p_status = 'limited' then
    v_title := 'Your account was limited';
    v_sev := 'warning';
    v_body := 'Some features are paused: no new servers, no DMs with non-friends and no friend requests for now.';
  else
    return;
  end if;
  if coalesce(btrim(p_reason), '') <> '' then
    v_fields := v_fields || jsonb_build_object('name', 'Reason', 'value', left(p_reason, 1000));
  end if;
  perform public.notify(p_user, 'moderation', 'account_' || p_status, v_title, v_body, v_sev, array['view_guidelines'],
    jsonb_build_object('status', p_status, 'reason', nullif(btrim(coalesce(p_reason, '')), ''), 'server', v_server),
    true, v_fields, null);
end;
$$;

create or replace function public.notify_account_restored()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.account_status = 'active' and old.account_status in ('limited', 'very_limited', 'banned') then
    perform public.notify(new.id, 'moderation', 'account_restored', 'Your account restrictions were lifted',
      'Everything works normally again. Thanks for your patience.', 'info', array['view_guidelines'],
      jsonb_build_object('previous', old.account_status), true, '[]'::jsonb, null);
  end if;
  return null;
end;
$$;
drop trigger if exists profiles_status_notify on public.profiles;
create trigger profiles_status_notify after update of account_status on public.profiles
  for each row execute function public.notify_account_restored();

-- --------------------------------------------------------- security events --
-- A new device signed in (the app registers every session in device_sessions).
create or replace function public.notify_new_signin()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_where text;
  v_device text := coalesce(nullif(btrim(new.label), ''), 'a new device');
  v_fields jsonb;
begin
  -- the very first device of a brand-new account is just the signup
  if exists (select 1 from public.profiles where id = new.user_id and created_at > now() - interval '30 minutes')
     and not exists (select 1 from public.device_sessions where user_id = new.user_id and session_id <> new.session_id) then
    return null;
  end if;
  v_where := nullif(concat_ws(', ', nullif(btrim(new.city), ''), nullif(btrim(new.region), ''), nullif(btrim(new.country), '')), '');
  v_fields := jsonb_build_array(jsonb_build_object('name', 'Device', 'value', v_device))
              || case when v_where is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('name', 'Approximate location', 'value', v_where)) end;
  perform public.notify(new.user_id, 'security', 'new_signin', 'New sign-in to your account',
    'Your account was just signed in on ' || v_device || coalesce(' near ' || v_where, '') ||
    '. If this was you, there''s nothing to do. If not, sign that device out and change your password.',
    'warning', array['review_devices', 'secure_account'],
    jsonb_build_object('device', v_device, 'location', v_where), true, v_fields, 'signin:' || new.session_id);
  return null;
end;
$$;
drop trigger if exists device_sessions_notify on public.device_sessions;
create trigger device_sessions_notify after insert on public.device_sessions
  for each row execute function public.notify_new_signin();

-- Signing a device out (Settings → Devices) is recorded too.
create or replace function public.revoke_device(p_session uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from auth.sessions where id = p_session and user_id = auth.uid();
  get diagnostics n = row_count;
  delete from public.device_sessions where session_id = p_session and user_id = auth.uid();
  if n > 0 then
    perform public.notify(auth.uid(), 'security', 'session_revoked', 'A device was signed out',
      'A device was signed out of your account from Settings → Devices.', 'info', array['review_devices'],
      jsonb_build_object('session', p_session), false, '[]'::jsonb, null);
  end if;
end;
$$;

-- Password / email changes (auth.users). Never blocks the change itself.
create or replace function public.notify_auth_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    if new.encrypted_password is distinct from old.encrypted_password and coalesce(old.encrypted_password, '') <> '' then
      perform public.notify(new.id, 'security', 'password_changed', 'Your password was changed',
        'The password for your account was just changed or reset. If you didn''t do this, reset your password now and check your devices.',
        'critical', array['secure_account', 'review_devices'], '{}'::jsonb, true, '[]'::jsonb,
        'password:' || to_char(now(), 'YYYYMMDDHH24MISS'));
    end if;
    if new.email is distinct from old.email and old.email is not null then
      perform public.notify(new.id, 'security', 'email_changed', 'Your email address was changed',
        'Your account’s email is now ' || coalesce(new.email, '(none)') || '. If you didn''t make this change, secure your account now.',
        'critical', array['secure_account'], jsonb_build_object('email', new.email), true, '[]'::jsonb, null);
    end if;
  exception when others then
    raise warning 'notify_auth_change: %', sqlerrm;
  end;
  return null;
end;
$$;

-- Two-factor sign-in turned on / off (auth.mfa_factors).
create or replace function public.notify_mfa_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    if tg_op <> 'DELETE' and new.status = 'verified' and (tg_op = 'INSERT' or old.status is distinct from 'verified') then
      perform public.notify(new.user_id, 'security', 'mfa_enabled', 'Two-factor sign-in was turned on',
        'Signing in now also needs a code from your authenticator app.', 'info', array['secure_account'],
        '{}'::jsonb, true, '[]'::jsonb, 'mfa_on:' || new.id);
    elsif tg_op = 'DELETE' and old.status = 'verified' then
      perform public.notify(old.user_id, 'security', 'mfa_disabled', 'Two-factor sign-in was turned off',
        'Your account no longer asks for an authenticator code. If you didn''t do this, secure your account now.',
        'critical', array['secure_account'], '{}'::jsonb, true, '[]'::jsonb, 'mfa_off:' || old.id);
    end if;
  exception when others then
    raise warning 'notify_mfa_change: %', sqlerrm;
  end;
  return null;
end;
$$;

-- Triggers on Supabase's auth schema: skipped (with a notice) if this project
-- doesn't allow them — everything else keeps working.
do $$ begin
  drop trigger if exists auth_users_security_notify on auth.users;
  create trigger auth_users_security_notify after update of encrypted_password, email on auth.users
    for each row execute function public.notify_auth_change();
exception when insufficient_privilege then
  raise notice 'skipped the auth.users trigger (no permission): password/email alerts disabled';
end $$;
do $$ begin
  drop trigger if exists auth_mfa_notify on auth.mfa_factors;
  create trigger auth_mfa_notify after insert or update of status or delete on auth.mfa_factors
    for each row execute function public.notify_mfa_change();
exception when insufficient_privilege or undefined_table then
  raise notice 'skipped the auth.mfa_factors trigger: two-factor alerts disabled';
end $$;
do $$ begin
  grant execute on function public.notify_auth_change(), public.notify_mfa_change() to supabase_auth_admin;
exception when undefined_object then null; end $$;

-- ------------------------------------------------ platform / community --
create or replace function public.notify_marketplace_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'removed' and old.status <> 'removed' then
    perform public.notify(new.author_id, 'platform', 'marketplace_removed',
      '“' || new.name || '” was removed from the marketplace',
      'Venband moderators removed it. People who installed it keep their copy.', 'warning',
      array['view_guidelines', 'open_theme_studio'],
      jsonb_build_object('item', new.id, 'kind', new.kind, 'reason', new.removed_reason), true,
      jsonb_build_array(jsonb_build_object('name', 'Item', 'value', new.name),
                        jsonb_build_object('name', 'Reason', 'value', coalesce(new.removed_reason, '—'))), null);
  elsif old.status = 'removed' and new.status <> 'removed' then
    perform public.notify(new.author_id, 'platform', 'marketplace_restored',
      '“' || new.name || '” is back in the marketplace', 'Venband moderators restored it.', 'info',
      array['open_theme_studio'], jsonb_build_object('item', new.id), false, '[]'::jsonb, null);
  end if;
  return null;
end;
$$;
drop trigger if exists themes_status_notify on public.themes;
create trigger themes_status_notify after update of status on public.themes
  for each row execute function public.notify_marketplace_status();

create or replace function public.notify_report_handled()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.reporter_id is not null and old.status = 'under_review' and new.status in ('actioned', 'dismissed') then
    perform public.notify(new.reporter_id, 'community', 'report_' || new.status,
      case when new.status = 'actioned' then 'We acted on your report' else 'We reviewed your report' end,
      case when new.status = 'actioned'
           then 'Thanks — what you reported broke Venband’s guidelines, and our moderators took action.'
           else 'Thanks — our moderators reviewed it and didn’t find a rule violation this time.' end,
      'info', array['view_guidelines'], jsonb_build_object('report', new.id, 'kind', new.kind), false, '[]'::jsonb,
      'report:' || new.id || ':' || new.status);
  end if;
  return null;
end;
$$;
drop trigger if exists reports_status_notify on public.reports;
create trigger reports_status_notify after update of status on public.reports
  for each row execute function public.notify_report_handled();

-- --------------------------------------------- official identity guards --
-- The 'venband' preset is the moderation toolkit anyone may add to their server;
-- what makes a bot OFFICIAL is being owned by the system account. So the preset
-- stays open, but the names "Venband" / "Official" are reserved.
create or replace function public.guard_official_app()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.owner_id = '3fff0000-0000-4000-8000-0000000000bd' then return new; end if;
  if tg_op = 'INSERT' or new.name is distinct from old.name then
    if new.name ~* '(venband|official)' then raise exception 'names containing “Venband” or “Official” are reserved'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists applications_official_guard on public.applications;
create trigger applications_official_guard before insert or update on public.applications
  for each row execute function public.guard_official_app();

create or replace function public.guard_bot_display_name()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.username is not null and new.username ~* '(venband|official|moderator|staff|admin|system)'
     and not exists (select 1 from public.applications a
                      where a.id = new.app_id and a.owner_id = '3fff0000-0000-4000-8000-0000000000bd') then
    new.username := null; -- fall back to the bot's own (non-reserved) name
  end if;
  return new;
end;
$$;
drop trigger if exists bot_messages_name_guard on public.bot_messages;
create trigger bot_messages_name_guard before insert or update of username on public.bot_messages
  for each row execute function public.guard_bot_display_name();

-- ------------------------------------------------------------------ grants --
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.official_dm(uuid, text, text, text, jsonb, text)',
    'public.notify(uuid, text, text, text, text, text, text[], jsonb, boolean, jsonb, text)',
    'public.notify_account_restored()', 'public.notify_new_signin()', 'public.notify_auth_change()',
    'public.notify_mfa_change()', 'public.notify_marketplace_status()', 'public.notify_report_handled()',
    'public.guard_official_app()', 'public.guard_bot_display_name()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
  end loop;
end $$;
revoke execute on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
revoke execute on function public.revoke_device(uuid) from public, anon;
grant execute on function public.revoke_device(uuid) to authenticated;

notify pgrst, 'reload schema';
