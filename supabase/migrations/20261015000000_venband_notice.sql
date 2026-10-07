-- =============================================================================
-- Venband bot DMs: when a moderator restricts an account (limited /
-- very_limited / banned), the Venband bot sends a plain DM to the user with
-- the reason (and the attached server, when there is one).
--
-- Bot messages are not end-to-end encrypted, so they can live in a DM channel
-- between the "Venband" profile and the user. This file:
--   1. creates the fixed "Venband" system account + profile + bot application
--   2. lets bot_messages exist outside server channels (server_id nullable)
--   3. adds venband_notice() and hooks it into the moderation choke points
-- =============================================================================

-- Fixed id for the Venband system account (a real auth.users row is required
-- because profiles.id references auth.users). It can never sign in: the
-- bcrypt hash below wraps a fresh random secret no one knows.
do $$
declare
  v_id uuid := '3fff0000-0000-4000-8000-0000000000bd';
begin
  insert into auth.users
    (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
     raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'venband@venband.com',
     crypt('venband-notice-' || gen_random_uuid()::text, gen_salt('bf')),
     now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"display_name":"Venband"}'::jsonb,
     now(), now())
  on conflict (id) do nothing;

  if not exists (select 1 from public.profiles where id = v_id or username = 'venband') then
    insert into public.profiles (id, username, display_name, avatar_color, about)
    values (v_id, 'venband', 'Venband', '#ed4245',
            'Official Venband account. This bot only sends account notices and moderation alerts.');
  end if;
end;
$$;

-- The Venband bot application is the sender shown on the notices.
insert into public.applications (owner_id, name, description, preset, color, status)
select p.id, 'Venband', 'Official Venband bot. Sends account notices.', 'venband', '#ed4245', 'active'
from public.profiles p
where p.id = '3fff0000-0000-4000-8000-0000000000bd'
  and not exists (select 1 from public.applications a where a.owner_id = p.id and a.name = 'Venband');

-- Bot messages are plain text, so they may now be posted into DMs too.
alter table public.bot_messages alter column server_id drop not null;

-- -----------------------------------------------------------------------------
-- venband_notice: find-or-create the 1:1 DM with the user and post the notice.
-- -----------------------------------------------------------------------------
create or replace function public.venband_notice(p_user uuid, p_status text,
                                                 p_reason text default '', p_server uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_venband uuid := '3fff0000-0000-4000-8000-0000000000bd';
  v_channel uuid;
  v_app     uuid;
  v_title   text;
  v_body    text;
  v_color   text;
  v_fields  jsonb := '[]'::jsonb;
  v_server  text;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  if p_user = v_venband then return; end if;
  if not exists (select 1 from public.profiles where id = p_user) then return; end if;

  select id into v_app from public.applications
  where owner_id = v_venband and name = 'Venband' limit 1;
  if v_app is null then return; end if;

  -- find an existing 1:1 DM between Venband and the user
  select a.channel_id into v_channel
  from public.dm_participants a
  join public.dm_participants b on a.channel_id = b.channel_id
  join public.channels c on c.id = a.channel_id and not c.is_group
  where a.user_id = v_venband and b.user_id = p_user
  limit 1;
  if v_channel is null then
    insert into public.channels (type, name) values ('dm', 'dm') returning id into v_channel;
    insert into public.dm_participants (channel_id, user_id)
    values (v_channel, v_venband), (v_channel, p_user);
  end if;

  if p_server is not null then
    select name into v_server from public.servers where id = p_server;
    if v_server is not null then
      v_fields := v_fields || jsonb_build_object('name', 'Server', 'value', v_server);
    end if;
  end if;

  if p_status = 'banned' then
    v_title := 'Your account was banned';
    v_color := '#ed4245';
    v_body := 'You can no longer sign in to Venband. If you think this is a mistake, contact support.';
  elsif p_status = 'very_limited' then
    v_title := 'Your account was restricted';
    v_color := '#f47b67';
    v_body := 'Your account is now read-only: no messages, calls, servers, DMs or friend requests for now.';
  elsif p_status = 'limited' then
    v_title := 'Your account was limited';
    v_color := '#faa61a';
    v_body := 'Some features are paused: no new servers, no DMs with non-friends and no friend requests for now.';
  else
    return;
  end if;

  if coalesce(btrim(p_reason), '') <> '' then
    v_fields := v_fields || jsonb_build_object('name', 'Reason', 'value', left(p_reason, 1000));
  end if;

  insert into public.bot_messages (channel_id, app_id, username, content, embed)
  values (v_channel, v_app, 'Venband', '',
          jsonb_build_object('title', v_title,
                             'description', v_body,
                             'color', v_color,
                             'fields', v_fields,
                             'footer', 'Sent automatically by the moderation team.'));
end;
$$;

revoke execute on function public.venband_notice(uuid, text, text, uuid) from public, anon;
grant execute on function public.venband_notice(uuid, text, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Hook the notices into the moderation choke points. Every path that restricts
-- an account funnels through mod_set_account_status; mod_server_action 'reject'
-- closes a server and limits its owner.
-- -----------------------------------------------------------------------------
create or replace function public.mod_set_account_status(p_user uuid, p_status text, p_reason text default '', p_server uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('active', 'limited', 'very_limited', 'banned') then raise exception 'unknown status'; end if;
  if p_user = auth.uid() or not public.mod_can_target(p_user) then raise exception 'you can''t change this account'; end if;
  update public.profiles set account_status = p_status where id = p_user;
  -- banned accounts are signed out everywhere and can't sign in again
  update auth.users set banned_until = case when p_status = 'banned' then 'infinity'::timestamptz end
  where id = p_user;
  if p_status = 'banned' then delete from auth.sessions where user_id = p_user; end if;
  insert into public.mod_actions (actor_id, target_user, action, detail, reason)
  values (auth.uid(), p_user, 'account_status', p_status, left(coalesce(p_reason, ''), 1000));
  if p_status in ('limited', 'very_limited', 'banned') then
    perform public.venband_notice(p_user, p_status, p_reason, p_server);
  end if;
end;
$$;

create or replace function public.mod_server_action(p_server uuid, p_action text, p_reason text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select owner_id into v_owner from public.servers where id = p_server;
  if v_owner is null then raise exception 'server not found'; end if;
  perform set_config('venband.mod', 'on', true);
  case p_action
    when 'review'   then update public.servers set status = 'review' where id = p_server;
    when 'approve'  then update public.servers set status = 'active' where id = p_server;
    when 'reject'   then
      update public.servers set status = 'closed', verified = false where id = p_server;
      if public.platform_rank(v_owner) < public.platform_rank() then
        update public.profiles set account_status = 'very_limited'
        where id = v_owner and account_status in ('active', 'limited');
        if found then
          perform public.venband_notice(v_owner, 'very_limited', p_reason, p_server);
        end if;
      end if;
    when 'ban'      then update public.servers set status = 'banned', verified = false where id = p_server;
    when 'unban'    then update public.servers set status = 'active' where id = p_server;
    when 'verify'   then update public.servers set verified = true where id = p_server;
    when 'unverify' then update public.servers set verified = false where id = p_server;
    else raise exception 'unknown action';
  end case;
  perform set_config('venband.mod', 'off', true);
  insert into public.mod_actions (actor_id, target_server, target_user, action, reason)
  values (auth.uid(), p_server, v_owner, 'server_' || p_action, left(coalesce(p_reason, ''), 1000));
end;
$$;