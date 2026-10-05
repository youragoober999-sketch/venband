-- Profiles: pictures, frames, name styles, longer statuses, custom
-- nameplates. Marketplace: nameplates, name styles and custom CSS next to
-- themes. Group chats: up to 15 people, an owner who can remove members,
-- and invite links.

-- ---------------------------------------------------------------- profiles ----
alter table public.profiles
  add column if not exists avatar_url      text check (avatar_url is null or char_length(avatar_url) <= 500),
  add column if not exists banner_url      text check (banner_url is null or char_length(banner_url) <= 500),
  add column if not exists avatar_frame    text not null default 'none'
                                           check (avatar_frame in ('none', 'neon', 'flame', 'frost', 'rainbow', 'gold', 'sakura', 'pixel', 'orbit', 'hearts', 'glitch')),
  add column if not exists name_style      jsonb not null default '{}'::jsonb check (pg_column_size(name_style) < 600),
  add column if not exists nameplate_style jsonb not null default '{}'::jsonb check (pg_column_size(nameplate_style) < 600);

-- longer statuses (shown as a speech bubble)
alter table public.profiles drop constraint if exists profiles_status_text_check;
alter table public.profiles add constraint profiles_status_text_check check (char_length(status_text) <= 300);
-- custom nameplates from the marketplace
alter table public.profiles drop constraint if exists profiles_nameplate_check;
alter table public.profiles add constraint profiles_nameplate_check
  check (nameplate in ('none', 'aurora', 'ember', 'ocean', 'sakura', 'circuit', 'noir', 'gold', 'custom'));

-- Pictures must live in Venband's own storage (nobody's IP leaks to other sites).
create or replace function public.guard_profile_pictures()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.avatar_url is distinct from old.avatar_url and new.avatar_url is not null
     and new.avatar_url !~ ('/storage/v1/object/public/avatars/' || new.id::text || '/') then
    raise exception 'upload the picture to Venband first';
  end if;
  if new.banner_url is distinct from old.banner_url and new.banner_url is not null
     and new.banner_url !~ ('/storage/v1/object/public/avatars/' || new.id::text || '/') then
    raise exception 'upload the picture to Venband first';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_pictures_guard on public.profiles;
create trigger profiles_pictures_guard before update on public.profiles
  for each row execute function public.guard_profile_pictures();

insert into storage.buckets (id, name, public, file_size_limit)
values ('avatars', 'avatars', true, 4194304)
on conflict (id) do update set public = true, file_size_limit = 4194304;
do $$ begin
  update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg', 'image/gif', 'image/webp'] where id = 'avatars';
exception when undefined_column then null; end $$;
drop policy if exists venband_avatars_read on storage.objects;
create policy venband_avatars_read on storage.objects for select to anon, authenticated using (bucket_id = 'avatars');
drop policy if exists venband_avatars_write on storage.objects;
create policy venband_avatars_write on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text);
drop policy if exists venband_avatars_delete on storage.objects;
create policy venband_avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text);

grant update (avatar_url, banner_url, avatar_frame, name_style, nameplate_style) on public.profiles to authenticated;

-- -------------------------------------------------------------- marketplace ----
alter table public.themes add column if not exists kind text not null default 'theme'
  check (kind in ('theme', 'nameplate', 'name_style', 'css'));
alter table public.themes drop constraint if exists themes_data_check;
alter table public.themes add constraint themes_data_check check (pg_column_size(data) < 20000);
create index if not exists themes_kind_idx on public.themes (kind, installs desc);

-- ------------------------------------------------------------------- groups ----
alter table public.channels add column if not exists owner_id uuid references public.profiles (id) on delete set null;
-- groups made before owners existed: the earliest member becomes the owner
update public.channels c set owner_id = (select d.user_id from public.dm_participants d where d.channel_id = c.id limit 1)
where c.is_group and c.owner_id is null;

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
  if (select count(*) from public.dm_participants where channel_id = p_channel) > 15 then
    raise exception 'groups can have at most 15 people';
  end if;
end;
$$;

-- the owner can remove people; removing rotates the group's key like leaving does
create or replace function public.remove_group_member(p_channel uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select owner_id from public.channels where id = p_channel and is_group) is distinct from auth.uid() then
    raise exception 'only the group owner can remove people';
  end if;
  if p_user = auth.uid() then raise exception 'use Leave Group instead'; end if;
  delete from public.dm_participants where channel_id = p_channel and user_id = p_user;
end;
$$;

create or replace function public.transfer_group(p_channel uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select owner_id from public.channels where id = p_channel and is_group) is distinct from auth.uid() then
    raise exception 'only the group owner can do that';
  end if;
  if not exists (select 1 from public.dm_participants where channel_id = p_channel and user_id = p_user) then
    raise exception 'they aren''t in the group';
  end if;
  update public.channels set owner_id = p_user where id = p_channel;
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
  elsif (select owner_id from public.channels where id = p_channel) = auth.uid() then
    -- the owner left: whoever has been there longest takes over
    update public.channels set owner_id = (select user_id from public.dm_participants where channel_id = p_channel limit 1)
    where id = p_channel;
  end if;
end;
$$;

create table if not exists public.group_invites (
  code       text primary key check (code ~ '^[A-Za-z0-9]{10}$'),
  channel_id uuid not null references public.channels (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  uses       integer not null default 0,
  max_uses   integer check (max_uses is null or max_uses between 1 and 14),
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);
alter table public.group_invites enable row level security;
drop policy if exists group_invites_select on public.group_invites;
create policy group_invites_select on public.group_invites for select to authenticated
  using (exists (select 1 from public.dm_participants d where d.channel_id = group_invites.channel_id and d.user_id = auth.uid()));
drop policy if exists group_invites_delete on public.group_invites;
create policy group_invites_delete on public.group_invites for delete to authenticated
  using (created_by = auth.uid() or (select owner_id from public.channels where id = channel_id) = auth.uid());

create or replace function public.create_group_invite(p_channel uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_code text := left(translate(encode(extensions.gen_random_bytes(12), 'base64'), '+/=', 'abc'), 10);
begin
  if not exists (select 1 from public.dm_participants where channel_id = p_channel and user_id = auth.uid())
     or not exists (select 1 from public.channels where id = p_channel and is_group) then
    raise exception 'not a member of this group';
  end if;
  insert into public.group_invites (code, channel_id, created_by) values (v_code, p_channel, auth.uid());
  return v_code;
end;
$$;

create or replace function public.group_invite_preview(p_code text)
returns table (channel_id uuid, name text, members integer, joined boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, (select count(*)::int from public.dm_participants d where d.channel_id = c.id),
         exists (select 1 from public.dm_participants d where d.channel_id = c.id and d.user_id = auth.uid())
  from public.group_invites i join public.channels c on c.id = i.channel_id
  where i.code = p_code and i.expires_at > now() and (i.max_uses is null or i.uses < i.max_uses) and auth.uid() is not null;
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
  if (select count(*) from public.dm_participants where channel_id = i.channel_id) >= 15 then
    raise exception 'this group is full (15 people)';
  end if;
  insert into public.dm_participants (channel_id, user_id) values (i.channel_id, auth.uid());
  update public.group_invites set uses = uses + 1 where code = p_code;
  return i.channel_id;
end;
$$;

-- --------------------------------------------------------------- grants ----
grant select, delete on public.group_invites to authenticated;
revoke execute on function
  public.guard_profile_pictures(), public.remove_group_member(uuid, uuid), public.transfer_group(uuid, uuid),
  public.create_group_invite(uuid), public.group_invite_preview(text), public.join_group(text)
from public, anon, authenticated;
grant execute on function
  public.remove_group_member(uuid, uuid), public.transfer_group(uuid, uuid),
  public.create_group_invite(uuid), public.group_invite_preview(text), public.join_group(text)
to authenticated;
