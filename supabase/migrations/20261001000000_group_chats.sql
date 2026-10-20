-- =============================================================================
-- Group chats: DM channels with up to 10 people, a name, add/leave/rename.
-- Messages stay end-to-end encrypted exactly like DMs (keys are shared with
-- everyone in dm_participants, and rotated when someone leaves).
--
-- Safe to run more than once.
-- =============================================================================

alter table public.channels add column if not exists is_group boolean not null default false;

-- 1-on-1 DMs must never resolve to a group that happens to contain both people.
create or replace function public.open_dm(p_other uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_channel uuid;
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
  insert into public.channels (type, name) values ('dm', 'dm') returning id into v_channel;
  insert into public.dm_participants (channel_id, user_id) values (v_channel, v_uid), (v_channel, p_other);
  return v_channel;
end;
$$;

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
  if cardinality(v_members) > 9 then raise exception 'groups can have at most 10 people'; end if;
  insert into public.channels (type, name, is_group)
  values ('dm', left(coalesce(nullif(btrim(p_name), ''), 'Group chat'), 100), true)
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
  insert into public.dm_participants (channel_id, user_id)
  select p_channel, m from unnest(coalesce(p_members, '{}')) m
  where exists (select 1 from public.profiles p where p.id = m)
  on conflict do nothing;
  if (select count(*) from public.dm_participants where channel_id = p_channel) > 10 then
    raise exception 'groups can have at most 10 people';
  end if;
end;
$$;

create or replace function public.leave_group(p_channel uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.channels c where c.id = p_channel and c.is_group) then
    raise exception 'not a group';
  end if;
  delete from public.dm_participants where channel_id = p_channel and user_id = auth.uid();
  if not exists (select 1 from public.dm_participants where channel_id = p_channel) then
    delete from public.channels where id = p_channel;
  end if;
end;
$$;

create or replace function public.rename_group(p_channel uuid, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if char_length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'name required'; end if;
  if not exists (select 1 from public.dm_participants d where d.channel_id = p_channel and d.user_id = auth.uid())
     or not exists (select 1 from public.channels c where c.id = p_channel and c.is_group) then
    raise exception 'not a member of this group';
  end if;
  update public.channels set name = left(btrim(p_name), 100) where id = p_channel;
end;
$$;

-- Someone left a group → new key before the next message (they can't read what follows).
create or replace function public.flag_dm_rotation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.channels set key_rotation_needed = true where id = old.channel_id;
  return old;
end;
$$;
drop trigger if exists dm_participants_rotation on public.dm_participants;
create trigger dm_participants_rotation after delete on public.dm_participants
  for each row execute function public.flag_dm_rotation();

revoke execute on function
  public.create_group(uuid[], text), public.add_group_members(uuid, uuid[]),
  public.leave_group(uuid), public.rename_group(uuid, text), public.flag_dm_rotation()
from anon, public;
grant execute on function
  public.open_dm(uuid), public.create_group(uuid[], text), public.add_group_members(uuid, uuid[]),
  public.leave_group(uuid), public.rename_group(uuid, text)
to authenticated;
grant select on public.dm_participants to authenticated;
