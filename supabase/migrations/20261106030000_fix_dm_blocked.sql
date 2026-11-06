-- =============================================================================
-- Fix: owners / admins / founders couldn't send any DM (20261106030000)
--
-- dm_blocked() is meant to say "this DM is read-only because one side blocked
-- the other — except for people with force-contact powers". It was written as
-- `can_force_contact(p_user) OR blocked`, so for exactly those people it was
-- ALWAYS true, and messages_insert (`not dm_blocked(channel_id)`) refused every
-- DM they sent — including to friends ("one of you has blocked the other").
--
-- That bug also hid a second one, fixed here too: channel_perm_for_user() gave a
-- server's owner every permission even while the server was in review, closed or
-- banned, so the owner could keep posting in a frozen server.
--
-- Safe to run more than once.
-- =============================================================================

create or replace function public.dm_blocked(p_channel uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select not public.can_force_contact(p_user)
     and exists (
       select 1 from public.channels c
       join public.dm_participants o on o.channel_id = c.id and o.user_id <> p_user
       where c.id = p_channel and c.type = 'dm' and not c.is_group
         and public.is_blocked_between(o.user_id, p_user));
$$;

create or replace function public.channel_perm_for_user(p_channel uuid, p_user uuid default auth.uid())
returns bigint language plpgsql stable security definer set search_path = '' as $$
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
      then return 2147483647; end if;
    return 0;
  end if;

  if not public.is_server_member(c.server_id, p_user) then return 0; end if;
  -- a server in review / closed / banned is frozen for everyone, its owner included
  -- (server_permissions already returns 0 then; the owner shortcut below skipped it)
  if (select status from public.servers where id = c.server_id) is distinct from 'active' then return 0; end if;
  if (select owner_id from public.servers where id = c.server_id) = p_user then return 2147483647; end if;

  v_base := public.server_permissions(c.server_id, p_user);
  if (v_base & 1) = 1 then return 2147483647; end if;
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
                                                    and mr.server_id = c.server_id) then
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
                                                    and mr.server_id = c.server_id) then
      continue;
    end if;
    if v_row.target_type = 'member' and v_row.target_id <> p_user then continue; end if;
    v_out := (v_out & ~(v_row.deny & ~3)) | (v_row.allow & ~3);
  end loop;

  return v_out;
end;
$$;

notify pgrst, 'reload schema';
