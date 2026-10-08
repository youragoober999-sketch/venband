-- Force contact: platform admins, owners and founders can't be kept out by a
-- block. They can message anyone, and can clear a block someone placed on them,
-- so a rule-breaker can't run away by blocking staff.

-- "administrator, owner and founder": platform role admin (rank >= 2) or the
-- owner/founder badge. Moderators are one rung below admins and don't get this.
create or replace function public.can_force_contact(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select public.platform_rank(p_user) >= 2
      or (select badges && array['owner', 'founder'] from public.profiles where id = p_user);
$$;

revoke execute on function public.can_force_contact(uuid) from public, anon;
grant execute on function public.can_force_contact(uuid) to authenticated;

-- open_dm: let admins/owners/founders open a DM even when the other side blocked them.
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
  if public.is_blocked_between(p_other, v_uid) and not public.can_force_contact(v_uid) then
    raise exception 'you can''t message this user';
  end if;
  if not (public.account_can('dm') or public.is_staff(v_uid)
          or (public.account_can('send') and public.are_friends(p_other, v_uid))) then
    raise exception 'your account can only message friends right now';
  end if;
  insert into public.channels (type, name) values ('dm', 'dm') returning id into v_channel;
  insert into public.dm_participants (channel_id, user_id) values (v_channel, v_uid), (v_channel, p_other);
  return v_channel;
end;
$$;

-- A DM is read-only while the two sides block each other. For someone with force
-- contact powers the block never applies, so they can still read and send.
create or replace function public.dm_blocked(p_channel uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_force_contact(p_user)
     or exists (
       select 1 from public.channels c
       join public.dm_participants o on o.channel_id = c.id and o.user_id <> p_user
       where c.id = p_channel and c.type = 'dm' and not c.is_group
         and public.is_blocked_between(o.user_id, p_user));
$$;

-- Remove the block p_user placed on you.
create or replace function public.force_unblock(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.can_force_contact() then raise exception 'admins, owners and founders only'; end if;
  delete from public.user_relations where owner_id = p_user and target_id = auth.uid() and blocked;
  if not found then raise exception 'they have not blocked you'; end if;
  insert into public.mod_actions (actor_id, target_user, action, detail)
  values (auth.uid(), p_user, 'force_unblock', 'removed a block placed on a staff member');
end;
$$;

revoke execute on function public.force_unblock(uuid) from public, anon;
grant execute on function public.force_unblock(uuid) to authenticated;