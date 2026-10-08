-- =============================================================================
-- Owner + founder powers.
--
-- Anyone holding the 'owner' platform role or the 'owner'/'founder' badge is
-- "top staff". Top staff can manage and remove any bot, delete or restore any
-- server, act on any account, and permanently erase a whole account (servers,
-- DMs, files, auth user — everything). Their powers are checked on the
-- database side in every destructive path; they can never target each other.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- is_staff: founders are full staff everywhere (moderation, reports, statuses).
-- -----------------------------------------------------------------------------
create or replace function public.is_staff(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select public.platform_rank(p_user) >= 1
      or exists (select 1 from public.profiles where id = p_user
                 and badges && array['owner', 'founder']);
$$;

-- -----------------------------------------------------------------------------
-- is_top_staff: platform owners and owner/founder badge holders.
-- -----------------------------------------------------------------------------
create or replace function public.is_top_staff(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select public.platform_rank(p_user) >= 3
      or exists (select 1 from public.profiles where id = p_user
                 and badges && array['owner', 'founder']);
$$;

revoke execute on function public.is_top_staff(uuid) from public, anon;
grant execute on function public.is_top_staff(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- mod_can_target: top staff can act on anyone who is not themselves and not
-- another top-staff account. (Moderators/admins still follow the rank ladder.)
-- -----------------------------------------------------------------------------
create or replace function public.mod_can_target(p_target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (public.is_staff() and public.platform_rank() > public.platform_rank(p_target))
      or (p_target = auth.uid() and public.platform_rank() = 3)
      or (public.is_top_staff() and p_target <> auth.uid() and not public.is_top_staff(p_target));
$$;

-- Administrators can hand out staff badges; only top staff can change staff
-- roles or hand out the owner/founder badges.
create or replace function public.mod_set_platform_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_role not in ('user', 'moderator', 'admin', 'owner') then raise exception 'unknown role'; end if;
  if not public.is_top_staff() and public.platform_rank() < 3 then raise exception 'only top staff can change staff roles'; end if;
  if not public.mod_can_target(p_user) then raise exception 'you can''t change this account'; end if;
  update public.profiles set platform_role = p_role where id = p_user;
  insert into public.mod_actions (actor_id, target_user, action, detail)
  values (auth.uid(), p_user, 'platform_role', p_role);
end;
$$;

create or replace function public.mod_set_badges(p_user uuid, p_badges text[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_new text[];
  v_old text[];
  v_staff_badges text[] := array['owner', 'admin', 'moderator', 'staff'];
begin
  if not public.mod_can_target(p_user) then raise exception 'you can''t change this account'; end if;
  select coalesce(array_agg(distinct b order by b), '{}') into v_new
  from unnest(coalesce(p_badges, '{}')) b where b = any (public.all_badges());
  select badges into v_old from public.profiles where id = p_user;
  if not public.is_top_staff() then
    if public.platform_rank() < 2 and (
         (select coalesce(array_agg(b), '{}') from unnest(v_new) b where b = any (v_staff_badges))
         is distinct from
         (select coalesce(array_agg(b order by b), '{}') from unnest(v_old) b where b = any (v_staff_badges))) then
      raise exception 'only admins can change staff badges';
    end if;
    if public.platform_rank() < 3 and (('owner' = any (v_new)) <> ('owner' = any (v_old))) then
      raise exception 'only the owner can change the owner badge';
    end if;
  end if;
  update public.profiles set badges = v_new where id = p_user;
  insert into public.mod_actions (actor_id, target_user, action, detail)
  values (auth.uid(), p_user, 'badges', array_to_string(v_new, ', '));
end;
$$;

-- -----------------------------------------------------------------------------
-- Bots: top staff see every app and own everything, so they can manage and
-- remove any bot from anywhere.
-- -----------------------------------------------------------------------------
create or replace function public.app_role(p_app uuid, p_user uuid default auth.uid())
returns text language sql stable security definer set search_path = '' as $$
  select case when public.is_top_staff(p_user) then 'owner'
              else coalesce(
                (select 'owner' from public.applications where id = p_app and owner_id = p_user),
                (select role from public.application_team where app_id = p_app and user_id = p_user)) end;
$$;

create or replace function public.can_see_app(p_app uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select public.app_role(p_app, p_user) is not null
      or exists (select 1 from public.server_bots b where b.app_id = p_app and public.is_server_member(b.server_id, p_user))
      or public.is_staff(p_user);
$$;

-- Server-side bot management: top staff may add, approve and configure any bot
-- in any server.
create or replace function public.bot_add_to_server(p_app uuid, p_server uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if (select status from public.servers where id = p_server) <> 'active' then raise exception 'this server is not available right now'; end if;
  if not (public.has_permission(p_server, 16777216) or public.is_top_staff()) then raise exception 'you need Manage Integrations here'; end if;
  if (select status from public.applications where id = p_app) <> 'active' then raise exception 'this application is disabled'; end if;
  if exists (select 1 from public.server_bots where server_id = p_server and app_id = p_app) then
    return jsonb_build_object('status', 'already');
  end if;
  perform public.install_bot(p_server, p_app, auth.uid());
  return jsonb_build_object('status', 'joined');
end;
$$;

create or replace function public.review_bot_request(p_request uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.bot_join_requests%rowtype;
begin
  select * into r from public.bot_join_requests where id = p_request;
  if not found then raise exception 'request not found'; end if;
  if not (public.has_permission(r.server_id, 16777216) or public.is_top_staff()) then raise exception 'you need Manage Integrations'; end if;
  if p_approve then perform public.install_bot(r.server_id, r.app_id, auth.uid()); end if;
  delete from public.bot_join_requests where id = p_request;
end;
$$;

create or replace function public.update_bot_settings(p_install uuid, p_settings jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.server_bots%rowtype;
  v jsonb := '{}'::jsonb;
  r text;
  roles jsonb := '[]'::jsonb;
  k text;
begin
  select * into b from public.server_bots where id = p_install;
  if not found then raise exception 'bot not found'; end if;
  if not (public.has_permission(b.server_id, 16777216) or public.is_top_staff()) then raise exception 'you need Manage Integrations in this server'; end if;
  foreach k in array array['welcome_channel', 'log_channel'] loop
    if nullif(p_settings ->> k, '') is not null then
      if not exists (select 1 from public.channels c where c.id = (p_settings ->> k)::uuid and c.server_id = b.server_id
                     and c.type in ('text', 'announcement')) then
        raise exception 'pick a text channel in this server';
      end if;
      v := v || jsonb_build_object(k, p_settings ->> k);
    end if;
  end loop;
  if p_settings ? 'welcome_text' then v := v || jsonb_build_object('welcome_text', left(coalesce(p_settings ->> 'welcome_text', ''), 1000)); end if;
  for r in select jsonb_array_elements_text(coalesce(p_settings -> 'auto_roles', '[]'::jsonb)) limit 5 loop
    if not exists (select 1 from public.roles x where x.id = r::uuid and x.server_id = b.server_id and not x.is_default
                   and ((x.permissions & 1) = 0 or (select owner_id from public.servers where id = b.server_id) = auth.uid())
                   and (x.position < public.member_top_position(b.server_id)
                        or (select owner_id from public.servers where id = b.server_id) = auth.uid()
                        or public.is_top_staff())) then
      raise exception 'you can''t hand out one of those roles';
    end if;
    roles := roles || to_jsonb(r);
  end loop;
  v := v || jsonb_build_object('auto_roles', roles);
  update public.server_bots set settings = v where id = p_install;
  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- Servers: top staff can delete (7-day restore) or restore any server.
-- -----------------------------------------------------------------------------
create or replace function public.delete_server(p_server uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
begin
  if (select owner_id from public.servers where id = p_server) is distinct from auth.uid()
     and not public.is_top_staff() then
    raise exception 'only the owner can delete the server';
  end if;
  if (select status from public.servers where id = p_server) <> 'active' then raise exception 'this server can''t be deleted right now'; end if;
  perform set_config('venband.mod', 'on', true);
  update public.servers set status = 'deleted', deleted_at = now() where id = p_server;
  perform set_config('venband.mod', 'off', true);
  return now() + interval '7 days';
end;
$$;

create or replace function public.restore_server(p_server uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select owner_id from public.servers where id = p_server) is distinct from auth.uid()
     and not public.is_top_staff() then
    raise exception 'only the owner can restore the server';
  end if;
  if (select status from public.servers where id = p_server) <> 'deleted' then raise exception 'nothing to restore'; end if;
  perform set_config('venband.mod', 'on', true);
  update public.servers set status = 'active', deleted_at = null where id = p_server;
  perform set_config('venband.mod', 'off', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- delete_account(p_user): top staff permanently erase an account — their
-- servers, 1:1 DMs, files, and the auth user itself (cascading through the
-- profile to everything else). The erased account's session dies with it.
-- -----------------------------------------------------------------------------
create or replace function public.delete_account(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_user is null then raise exception 'no user given'; end if;
  if p_user = auth.uid() then raise exception 'use delete_my_account for your own account'; end if;
  if not public.is_top_staff() then raise exception 'only owner and founder badges can erase accounts'; end if;
  if public.is_top_staff(p_user) then raise exception 'that account holds top staff badges'; end if;

  insert into public.mod_actions (actor_id, target_user, action, detail, reason)
  values (auth.uid(), p_user, 'account_deleted',
          'erased by ' || (select username from public.profiles where id = auth.uid()), null);

  -- Their servers go with them, permanently.
  delete from public.servers where owner_id = p_user;

  -- 1:1 DMs: gone, for both sides.
  delete from public.channels c
  where c.type = 'dm' and c.server_id is null and not c.is_group
    and exists (select 1 from public.dm_participants d
                where d.channel_id = c.id and d.user_id = p_user);

  -- Group chats just lose them (their messages and keys cascade with the profile).
  delete from public.dm_participants where user_id = p_user;

  -- Files, avatars and banners uploaded to object storage.
  delete from storage.objects where owner = p_user;

  -- The account itself. Everything else cascades from auth.users -> profiles.
  delete from auth.users where id = p_user;
  if not found then raise exception 'no account with that id'; end if;
end;
$$;

revoke execute on function public.delete_account(uuid) from public, anon;
grant execute on function public.delete_account(uuid) to authenticated;