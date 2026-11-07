-- =============================================================================
-- "Use Commands" permission (20261107170000)
--
-- A new role permission, bit 31 (2147483648): staff can let a role use slash
-- commands (Comet, other bots, built-ins like /avatar) or not, and allow / deny
-- it per channel and category like every other permission.
--
--   * Permissions were 31 bits (max 2147483647); they're now 32 bits, so "every
--     permission" (owners, Administrators, DM participants) is 4294967295.
--   * Existing servers: every @everyone role gets Use Commands once, so nothing
--     changes until staff turn it off. New servers' @everyone role gets it too.
--   * Timed-out / read-only members lose it along with Send Messages.
--
--   * Fixes @everyone channel/category overrides, which were never applied (so
--     read-only channels and Comet's /lock and /lockdown didn't actually lock).
--
-- Safe to run more than once (the one-time grant only runs before the limit is widened).
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.roles'::regclass and conname = 'roles_permissions_check'
                   and pg_get_constraintdef(oid) like '%4294967295%') then
    alter table public.roles drop constraint if exists roles_permissions_check;
    alter table public.roles add constraint roles_permissions_check check (permissions >= 0 and permissions <= 4294967295);
    update public.roles set permissions = permissions | 2147483648::bigint where is_default;
  end if;
end $$;

-- a new server's @everyone role can use commands
create or replace function public.default_role_commands() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.is_default then new.permissions := new.permissions | 2147483648::bigint; end if;
  return new;
end;
$$;
drop trigger if exists roles_default_commands on public.roles;
create trigger roles_default_commands before insert on public.roles for each row execute function public.default_role_commands();

-- server-wide permissions: 32 bits now
CREATE OR REPLACE FUNCTION public.server_permissions(p_server uuid, p_user uuid DEFAULT auth.uid())
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $fn$
declare
  v_owner uuid;
  v_status text;
  v_rules text[];
  v_voogle jsonb;
  v_perms bigint;
  v_timeout timestamptz;
begin
  select owner_id, status, rules, voogle into v_owner, v_status, v_rules, v_voogle from public.servers where id = p_server;
  if v_owner is null or v_status <> 'active' then return 0; end if;
  if v_owner = p_user then return 4294967295; end if;
  select timeout_until into v_timeout from public.server_members where server_id = p_server and user_id = p_user;
  if not found then return 0; end if;

  select coalesce(bit_or(r.permissions), 0) into v_perms
  from public.roles r
  where r.server_id = p_server
    and (r.is_default or exists (select 1 from public.member_roles mr
                                 where mr.role_id = r.id and mr.user_id = p_user
                                   and mr.server_id = p_server));
  if (v_perms & 1) = 1 then return 4294967295; end if;
  if (v_timeout is not null and v_timeout > now())
     or (cardinality(v_rules) > 0 and not exists (select 1 from public.member_onboarding o where o.server_id = p_server
                                                 and o.user_id = p_user and o.rules_accepted_at is not null))
     or (coalesce((v_voogle ->> 'enabled')::boolean, false) and coalesce((v_voogle ->> 'required')::boolean, false)
         and (v_perms & (2 | 16 | 32 | 2097152)) = 0
         and not exists (select 1 from public.voogle_verifications v where v.server_id = p_server
                         and v.user_id = p_user and v.result = 'passed')) then
    -- read-only: no sending, reacting, threads, polls, files, voice talk
    v_perms := v_perms & ~(128 | 4096 | 8192 | 32768 | 65536 | 1024 | 2048 | 524288 | 2147483648::bigint);
  end if;
  return v_perms;
end;
$fn$;

-- channel permissions: 32 bits now
CREATE OR REPLACE FUNCTION public.channel_perm_for_user(p_channel uuid, p_user uuid DEFAULT auth.uid())
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $fn$
declare
  c record;
  v_base bigint;
  v_out bigint;
  v_row record;
begin
  select id, server_id, type, category into c from public.channels where id = p_channel;
  if not found then return 0; end if;

  -- DMs are wide open for their participants.
  if c.type = 'dm' then
    if exists (select 1 from public.dm_participants where channel_id = p_channel and user_id = p_user)
      then return 4294967295; end if;
    return 0;
  end if;

  if not public.is_server_member(c.server_id, p_user) then return 0; end if;
  -- a server in review / closed / banned is frozen for everyone, its owner included
  -- (server_permissions already returns 0 then; the owner shortcut below skipped it)
  if (select status from public.servers where id = c.server_id) is distinct from 'active' then return 0; end if;
  if (select owner_id from public.servers where id = c.server_id) = p_user then return 4294967295; end if;

  v_base := public.server_permissions(c.server_id, p_user);
  if (v_base & 1) = 1 then return 4294967295; end if;
  v_out := v_base;

  -- Overwrites never grant or strip server-wide powers (Administrator, Manage Server).
  -- Category-level overwrites.
  for v_row in
    select o.target_type, o.target_id, o.allow, o.deny,
           case when o.target_type = 'member' then 2147483647 else coalesce(r.position, 0) end as pos
      from public.channel_overwrites o
      left join public.roles r on r.id = o.target_id and o.target_type = 'role'
     where o.server_id = c.server_id and o.category = c.category
     order by pos, o.target_id
  loop
    if v_row.target_type = 'role' and not exists (select 1 from public.member_roles mr
                                                  where mr.role_id = v_row.target_id
                                                    and mr.user_id = p_user
                                                    and mr.server_id = c.server_id)
       and not exists (select 1 from public.roles dr where dr.id = v_row.target_id and dr.is_default) then
      continue;
    end if;
    if v_row.target_type = 'member' and v_row.target_id <> p_user then continue; end if;
    v_out := (v_out & ~(v_row.deny & ~3)) | (v_row.allow & ~3);
  end loop;

  -- Channel-level overwrites.
  for v_row in
    select o.target_type, o.target_id, o.allow, o.deny,
           case when o.target_type = 'member' then 2147483647 else coalesce(r.position, 0) end as pos
      from public.channel_overwrites o
      left join public.roles r on r.id = o.target_id and o.target_type = 'role'
     where o.channel_id = c.id
     order by pos, o.target_id
  loop
    if v_row.target_type = 'role' and not exists (select 1 from public.member_roles mr
                                                  where mr.role_id = v_row.target_id
                                                    and mr.user_id = p_user
                                                    and mr.server_id = c.server_id)
       and not exists (select 1 from public.roles dr where dr.id = v_row.target_id and dr.is_default) then
      continue;
    end if;
    if v_row.target_type = 'member' and v_row.target_id <> p_user then continue; end if;
    v_out := (v_out & ~(v_row.deny & ~3)) | (v_row.allow & ~3);
  end loop;

  return v_out;
end;
$fn$;

-- every bot command now needs Use Commands in that channel (not just Send Messages)
create or replace function public.use_bot_command(p_channel uuid, p_app uuid, p_command text, p_args text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_server uuid;
  v_id uuid;
begin
  if not public.channel_has_permission(p_channel, 2147483648::bigint) then
    raise exception 'your roles can''t use commands in this channel';
  end if;
  if (select preset from public.applications where id = p_app) is distinct from 'comet' then
    return public.use_bot_command_base(p_channel, p_app, p_command, p_args);
  end if;
  select server_id into v_server from public.channels where id = p_channel;
  if v_server is null or not public.channel_has_permission(p_channel, 128) then raise exception 'you can''t use commands here'; end if;
  if (select status from public.applications where id = p_app) <> 'active'
     or not exists (select 1 from public.server_bots where server_id = v_server and app_id = p_app) then
    raise exception 'Comet isn''t in this server — add it from App Discovery';
  end if;
  if (select count(*) from public.bot_interactions where user_id = auth.uid() and created_at > now() - interval '10 seconds') >= 6 then
    raise exception 'slow down a little';
  end if;
  insert into public.bot_interactions (app_id, server_id, channel_id, user_id, command, args)
  values (p_app, v_server, p_channel, auth.uid(), lower(btrim(p_command)), left(coalesce(p_args, ''), 1000)) returning id into v_id;
  perform public.comet_command(p_app, p_channel, v_server, lower(btrim(p_command)), coalesce(p_args, ''), v_id);
  update public.bot_interactions set handled = true where id = v_id;
  return jsonb_build_object('status', 'handled', 'id', v_id);
end;
$$;
comment on function public.use_bot_command(uuid, uuid, text, text) is 'comet-dispatch';

notify pgrst, 'reload schema';
