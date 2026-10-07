-- Group chats: raise the member limit from 15 to 20.
--
-- Safe to run more than once. `create or replace function` keeps existing
-- grants, but we re-issue them so fresh databases restrict execution to
-- authenticated users too.

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
	  if cardinality(v_members) > 19 then raise exception 'groups can have at most 20 people'; end if;
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
	  insert into public.dm_participants (channel_id, user_id)
	  select p_channel, m from unnest(coalesce(p_members, '{}')) m
	  where exists (select 1 from public.profiles p where p.id = m)
	    and not public.is_blocked_between(v_uid, m)
	  on conflict do nothing;
	  if (select count(*) from public.dm_participants where channel_id = p_channel) > 20 then
	    raise exception 'groups can have at most 20 people';
	  end if;
	end;
	$$;

	create or replace function public.join_group(p_code text)
	returns uuid language plpgsql security definer set search_path = '' as $$
	declare
	  i public.group_invites%rowtype;
	begin
	  if auth.uid() is null then raise exception 'not authenticated'; end if;
	  if not public.account_can('join') then raise exception 'your account can''t join groups right now'; end if;
	  select * into i from public.group_invites where code = p_code for update;
	  if not found or i.expires_at < now() or (i.max_uses is not null and i.uses >= i.max_uses) then
	    raise exception 'this invite has expired';
	  end if;
	  if exists (select 1 from public.dm_participants where channel_id = i.channel_id and user_id = auth.uid()) then return i.channel_id; end if;
	  if exists (select 1 from public.dm_participants d where d.channel_id = i.channel_id and public.is_blocked_between(auth.uid(), d.user_id)) then
	    raise exception 'you can''t join this group';
	  end if;
	  if (select count(*) from public.dm_participants where channel_id = i.channel_id) >= 20 then
	    raise exception 'this group is full (20 people)';
	  end if;
	  insert into public.dm_participants (channel_id, user_id) values (i.channel_id, auth.uid());
	  update public.group_invites set uses = uses + 1 where code = p_code;
	  return i.channel_id;
	end;
	$$;

	revoke execute on function
	  public.create_group(uuid[], text), public.add_group_members(uuid, uuid[]), public.join_group(text)
	from public, anon;
	grant execute on function
	  public.create_group(uuid[], text), public.add_group_members(uuid, uuid[]), public.join_group(text)
	to authenticated;