-- =============================================================================
-- Venband REPAIR script: safe to run any number of times.
-- Re-applies all API permissions, the profile self-heal functions, group
-- chats and the platform features (badges, moderation, discovery, friends,
-- devices, themes, signup limit), reports, message requests, reactions, threads,
-- pins, polls and scheduled messages, then prints a checklist. Paste into Supabase → SQL Editor → Run.
-- (Requires the main schema: supabase/migrations/20260928000000_venband_schema.sql)
-- =============================================================================

-- anon (not signed in) gets nothing except the username check on signup.
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant usage on schema public to anon, authenticated;
grant execute on function public.username_available(text) to anon, authenticated;

-- ------------------------------------------------------------- tables ----
grant select                         on public.profiles            to authenticated;
grant update (display_name, avatar_color, about)
                                     on public.profiles            to authenticated;

grant select, insert                 on public.user_keys           to authenticated;
grant select, insert, update         on public.user_private_keys   to authenticated;

grant select, update, delete         on public.servers             to authenticated;

grant select, delete                 on public.server_members      to authenticated;
grant update (nickname)              on public.server_members      to authenticated;

grant select, insert, update, delete on public.roles               to authenticated;
grant select, insert, delete         on public.member_roles        to authenticated;

grant select, insert, delete         on public.channels            to authenticated;
grant update (name, topic, category, position, is_private)
                                     on public.channels            to authenticated;

grant select, insert, delete         on public.channel_role_access to authenticated;
grant select                         on public.dm_participants     to authenticated;
grant select, delete                 on public.invites             to authenticated;
grant select, insert, delete         on public.bans                to authenticated;
grant select, insert                 on public.channel_epochs      to authenticated;
grant select, insert                 on public.channel_keys        to authenticated;

grant select, insert, delete         on public.messages            to authenticated;
grant update (epoch, iv, ciphertext, signature, author_key_id)
                                     on public.messages            to authenticated;

-- service_role (dashboard / admin scripts) keeps full access
grant all on all tables in schema public to service_role;

-- ---------------------------------------------------------- functions ----
grant execute on function
  public.is_server_member(uuid, uuid),
  public.server_permissions(uuid, uuid),
  public.has_permission(uuid, bigint, uuid),
  public.member_top_position(uuid, uuid),
  public.can_view_channel(uuid, uuid),
  public.channel_has_permission(uuid, bigint, uuid),
  public.shares_server_or_dm(uuid, uuid),
  public.create_server(text, text),
  public.create_invite(uuid, integer, integer),
  public.join_server(text),
  public.open_dm(uuid),
  public.find_user(text),
  public.channel_key_recipients(uuid),
  public.channel_missing_keys(uuid),
  public.realtime_topic_allowed(text),
  public.storage_channel_allowed(text)
to authenticated;

create or replace function public.unique_username(p_base text)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_base text := left(regexp_replace(lower(coalesce(p_base, '')), '[^a-z0-9_.]', '', 'g'), 26);
  v_name text;
  i integer := 1;
begin
  if char_length(v_base) < 2 then v_base := 'user'; end if;
  v_name := v_base;
  while exists (select 1 from public.profiles where username = v_name) loop
    i := i + 1;
    v_name := v_base || i::text;
  end loop;
  return v_name;
end;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_wanted   text := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  v_username text;
  v_display  text;
begin
  if v_wanted ~ '^[a-z0-9_.]{2,32}$' and not exists (select 1 from public.profiles where username = v_wanted) then
    v_username := v_wanted;
  else
    v_username := public.unique_username(coalesce(nullif(v_wanted, ''), split_part(coalesce(new.email, ''), '@', 1)));
  end if;
  v_display := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), v_username);
  insert into public.profiles (id, username, display_name, avatar_color)
  values (new.id, v_username, left(v_display, 32),
          (array['#e0795b','#6aa2d8','#8fbf6a','#d8a14a','#b88ad8','#d86a8f','#5fb8a8','#c9b458'])
            [1 + floor(random() * 8)::int])
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.my_profile()
returns public.profiles language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_row  public.profiles;
  v_meta jsonb;
  v_mail text;
  v_name text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into v_row from public.profiles where id = v_uid;
  if found then return v_row; end if;

  select raw_user_meta_data, email into v_meta, v_mail from auth.users where id = v_uid;
  v_name := public.unique_username(coalesce(nullif(v_meta ->> 'username', ''), split_part(coalesce(v_mail, ''), '@', 1)));
  insert into public.profiles (id, username, display_name)
  values (v_uid, v_name, left(coalesce(nullif(btrim(v_meta ->> 'display_name'), ''), v_name), 32))
  returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function public.unique_username(text) from anon, public, authenticated;
revoke execute on function public.my_profile() from anon, public;
grant execute on function public.my_profile() to authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;

-- ------------------------------------------------------- group chats ----

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


-- =========================== platform features (20261002000000_platform.sql)
-- =============================================================================
-- Platform features
--
--   * staff roles (moderator / admin / owner), badges, account status
--     (active / limited / very_limited / banned) enforced in RLS
--   * moderation: search, badges, account status, server review / verify /
--     close / ban, audit log
--   * server discovery (verified, or 1,000+ members), server tags,
--     descriptions, welcome channel + join messages, automod setting
--   * friends, blocks and private per-user preferences (nickname, pin, mute)
--   * richer profiles (pronouns, status, banner, nameplate, server tag)
--   * synced settings, theme marketplace, devices (sessions) list + log out
--   * signup limit: at most 6 accounts per IP address (Auth hook)
--
-- Safe to run more than once.
-- =============================================================================

-- ------------------------------------------------------------ profiles ----
alter table public.profiles
  add column if not exists pronouns       text not null default '' check (char_length(pronouns) <= 40),
  add column if not exists status_text    text not null default '' check (char_length(status_text) <= 128),
  add column if not exists status_emoji   text not null default '' check (char_length(status_emoji) <= 16),
  add column if not exists presence       text not null default 'online'
                                          check (presence in ('online', 'idle', 'dnd', 'invisible')),
  add column if not exists banner_color   text check (banner_color ~ '^#[0-9a-fA-F]{6}$'),
  add column if not exists banner_color2  text check (banner_color2 ~ '^#[0-9a-fA-F]{6}$'),
  add column if not exists accent_color   text check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  add column if not exists nameplate      text not null default 'none'
                                          check (nameplate in ('none', 'aurora', 'ember', 'ocean', 'sakura', 'circuit', 'noir', 'gold')),
  add column if not exists tag_server_id  uuid,
  add column if not exists server_tag     text,
  add column if not exists badges         text[] not null default '{}',
  add column if not exists platform_role  text not null default 'user'
                                          check (platform_role in ('user', 'moderator', 'admin', 'owner')),
  add column if not exists account_status text not null default 'active'
                                          check (account_status in ('active', 'limited', 'very_limited', 'banned')),
  add column if not exists language       text not null default '' check (char_length(language) <= 16),
  add column if not exists onboarded      boolean not null default false;

-- every badge must be a known one
create or replace function public.all_badges()
returns text[] language sql immutable set search_path = '' as $$
  select array['owner', 'admin', 'moderator', 'staff', 'partner', 'verified_dev', 'bug_hunter',
               'bug_hunter_gold', 'og', 'early_supporter', 'supporter', 'translator', 'event_winner']::text[];
$$;
do $$ begin
  alter table public.profiles add constraint profiles_badges_known check (badges <@ public.all_badges());
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------- servers ----
alter table public.servers
  add column if not exists description        text not null default '' check (char_length(description) <= 300),
  add column if not exists tag                text check (tag ~ '^[A-Za-z0-9]{2,4}$'),
  add column if not exists banner_color       text check (banner_color ~ '^#[0-9a-fA-F]{6}$'),
  add column if not exists verified           boolean not null default false,
  add column if not exists status             text not null default 'active'
                                              check (status in ('active', 'review', 'closed', 'banned')),
  add column if not exists discoverable       boolean not null default true,
  add column if not exists welcome_channel_id uuid references public.channels (id) on delete set null,
  add column if not exists automod            jsonb not null default '{"slurs": false}'::jsonb
                                              check (pg_column_size(automod) < 2000);

do $$ begin
  alter table public.profiles add constraint profiles_tag_server_fk
    foreign key (tag_server_id) references public.servers (id) on delete set null;
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------- helpers ----
create or replace function public.platform_rank(p_user uuid default auth.uid())
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce((select case p.platform_role when 'owner' then 3 when 'admin' then 2
                                               when 'moderator' then 1 else 0 end
                   from public.profiles p where p.id = p_user), 0);
$$;

create or replace function public.is_staff(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select public.platform_rank(p_user) >= 1;
$$;

-- What a restricted account may still do.
--   limited:      chat, call and join servers by invite. No new servers, new
--                 DMs/groups with non-friends, friend requests or publishing.
--   very_limited: read only.
--   banned:       nothing (Auth also refuses to sign them in).
create or replace function public.account_can(p_action text, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select case coalesce((select account_status from public.profiles where id = p_user), 'active')
    when 'active' then true
    when 'limited' then p_action in ('send', 'call', 'join')
    else false
  end;
$$;

create or replace function public.member_count(p_server uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.server_members where server_id = p_server;
$$;

-- ------------------------------------------------- friends / relations ----
create table if not exists public.friendships (
  user_a     uuid not null references public.profiles (id) on delete cascade,
  user_b     uuid not null references public.profiles (id) on delete cascade,
  requester  uuid not null references public.profiles (id) on delete cascade,
  accepted   boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b),
  check (requester in (user_a, user_b))
);
create index if not exists friendships_b_idx on public.friendships (user_b);

create or replace function public.are_friends(p_a uuid, p_b uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.friendships f
                 where f.user_a = least(p_a, p_b) and f.user_b = greatest(p_a, p_b) and f.accepted);
$$;

-- Private, per-viewer settings about another user. Only the owner sees them.
create table if not exists public.user_relations (
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  target_id  uuid not null references public.profiles (id) on delete cascade,
  nickname   text check (nickname is null or char_length(nickname) between 1 and 32),
  note       text not null default '' check (char_length(note) <= 256),
  pinned     boolean not null default false,
  muted      boolean not null default false,
  blocked    boolean not null default false,
  primary key (owner_id, target_id),
  check (owner_id <> target_id)
);
create index if not exists user_relations_blocked_idx on public.user_relations (target_id) where blocked;

create or replace function public.is_blocked_between(p_a uuid, p_b uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_relations r where r.blocked
                 and ((r.owner_id = p_a and r.target_id = p_b) or (r.owner_id = p_b and r.target_id = p_a)));
$$;

-- blocking someone also unfriends them
create or replace function public.on_block()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.blocked then
    delete from public.friendships
    where user_a = least(new.owner_id, new.target_id) and user_b = greatest(new.owner_id, new.target_id);
  end if;
  return new;
end;
$$;
drop trigger if exists user_relations_block on public.user_relations;
create trigger user_relations_block after insert or update of blocked on public.user_relations
  for each row execute function public.on_block();

-- Who may see a profile: people you share a server / DM with, friends and
-- pending requests, and platform staff.
create or replace function public.can_see_profile(p_other uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select public.shares_server_or_dm(p_other, p_user)
      or exists (select 1 from public.friendships f
                 where f.user_a = least(p_other, p_user) and f.user_b = greatest(p_other, p_user))
      or public.is_staff(p_user);
$$;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (public.can_see_profile(id));

alter table public.friendships enable row level security;
alter table public.user_relations enable row level security;

drop policy if exists friendships_select on public.friendships;
create policy friendships_select on public.friendships for select to authenticated
  using (auth.uid() in (user_a, user_b));

drop policy if exists relations_all on public.user_relations;
create policy relations_all on public.user_relations for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create or replace function public.send_friend_request(p_username text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_other uuid;
  f public.friendships%rowtype;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public.account_can('friend') then raise exception 'your account can''t send friend requests right now'; end if;
  select id into v_other from public.profiles where username = lower(btrim(p_username));
  if v_other is null or v_other = v_uid or public.is_blocked_between(v_other, v_uid) then
    raise exception 'no user with that username';
  end if;
  select * into f from public.friendships where user_a = least(v_uid, v_other) and user_b = greatest(v_uid, v_other);
  if found then
    if f.accepted then return 'already_friends'; end if;
    if f.requester = v_other then
      update public.friendships set accepted = true where user_a = f.user_a and user_b = f.user_b;
      return 'accepted';
    end if;
    return 'pending';
  end if;
  insert into public.friendships (user_a, user_b, requester) values (least(v_uid, v_other), greatest(v_uid, v_other), v_uid);
  return 'sent';
end;
$$;

create or replace function public.respond_friend_request(p_other uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if p_accept then
    update public.friendships set accepted = true
    where user_a = least(v_uid, p_other) and user_b = greatest(v_uid, p_other) and requester = p_other;
  else
    delete from public.friendships
    where user_a = least(v_uid, p_other) and user_b = greatest(v_uid, p_other) and not accepted;
  end if;
end;
$$;

create or replace function public.remove_friend(p_other uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.friendships
  where user_a = least(auth.uid(), p_other) and user_b = greatest(auth.uid(), p_other);
$$;

create or replace function public.mutual_servers(p_other uuid)
returns table (id uuid, name text, icon_color text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.name, s.icon_color from public.servers s
  where public.can_see_profile(p_other)
    and exists (select 1 from public.server_members m where m.server_id = s.id and m.user_id = auth.uid())
    and exists (select 1 from public.server_members m where m.server_id = s.id and m.user_id = p_other)
  order by s.name;
$$;

create or replace function public.mutual_friends(p_other uuid)
returns table (id uuid)
language sql stable security definer set search_path = '' as $$
  select x.id from (
    select case when f.user_a = auth.uid() then f.user_b else f.user_a end as id
    from public.friendships f where f.accepted and auth.uid() in (f.user_a, f.user_b)
  ) x
  where public.can_see_profile(p_other) and public.are_friends(x.id, p_other);
$$;

-- --------------------------------------------- server permission gates ----
-- A server under review is frozen (nobody, not even the owner, can change
-- anything or chat). Closed / banned servers can't be read either.
create or replace function public.server_permissions(p_server uuid, p_user uuid default auth.uid())
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_status text;
  v_perms bigint;
begin
  select owner_id, status into v_owner, v_status from public.servers where id = p_server;
  if v_owner is null or v_status <> 'active' then return 0; end if;
  if v_owner = p_user then return 4095; end if;
  if not public.is_server_member(p_server, p_user) then return 0; end if;

  select coalesce(bit_or(r.permissions), 0) into v_perms
  from public.roles r
  where r.server_id = p_server
    and (r.is_default or exists (select 1 from public.member_roles mr
                                 where mr.role_id = r.id and mr.user_id = p_user
                                   and mr.server_id = p_server));
  if (v_perms & 1) = 1 then return 4095; end if;
  return v_perms;
end;
$$;

create or replace function public.can_view_channel(p_channel uuid, p_user uuid default auth.uid())
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  c record;
begin
  select id, server_id, type, is_private into c from public.channels where id = p_channel;
  if not found then return false; end if;

  if c.type = 'dm' then
    return exists (select 1 from public.dm_participants
                   where channel_id = p_channel and user_id = p_user);
  end if;

  if not public.is_server_member(c.server_id, p_user) then return false; end if;
  if exists (select 1 from public.servers s where s.id = c.server_id and s.status in ('closed', 'banned')) then
    return false;
  end if;
  if not c.is_private then return true; end if;
  if (select owner_id from public.servers where id = c.server_id) = p_user then return true; end if;
  if public.has_permission(c.server_id, 8, p_user) then return true; end if;
  return exists (select 1 from public.channel_role_access a
                 join public.member_roles mr on mr.role_id = a.role_id
                 where a.channel_id = p_channel and mr.user_id = p_user
                   and mr.server_id = c.server_id);
end;
$$;

-- A non-group DM where one side blocked the other is read-only.
create or replace function public.dm_blocked(p_channel uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.channels c
    join public.dm_participants o on o.channel_id = c.id and o.user_id <> p_user
    where c.id = p_channel and c.type = 'dm' and not c.is_group
      and public.is_blocked_between(o.user_id, p_user));
$$;

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.account_can('send')
    and public.channel_has_permission(channel_id, 128)
    and not public.dm_blocked(channel_id)
    and exists (select 1 from public.user_keys k where k.key_id = author_key_id
                and k.user_id = auth.uid() and k.revoked_at is null)
    and not (select c.key_rotation_needed from public.channels c where c.id = channel_id)
    and epoch = (select max(e.epoch) from public.channel_epochs e where e.channel_id = messages.channel_id)
  );

drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages for update to authenticated
  using (author_id = auth.uid() and public.can_view_channel(channel_id))
  with check (author_id = auth.uid()
              and public.account_can('send')
              and exists (select 1 from public.user_keys k where k.key_id = author_key_id
                          and k.user_id = auth.uid() and k.revoked_at is null)
              and not (select c.key_rotation_needed from public.channels c where c.id = channel_id)
    and epoch = (select max(e.epoch) from public.channel_epochs e where e.channel_id = messages.channel_id));

-- owners can't delete a server to dodge a review
drop policy if exists servers_delete on public.servers;
create policy servers_delete on public.servers for delete to authenticated
  using (owner_id = auth.uid() and status = 'active');

-- staff-only columns can only change through the moderation functions
create or replace function public.guard_server_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id or new.created_at <> old.created_at then
    raise exception 'immutable column';
  end if;
  if current_setting('venband.mod', true) is distinct from 'on' then
    if new.verified <> old.verified or new.status <> old.status then
      raise exception 'only Venband staff can change this';
    end if;
    if old.status <> 'active' then raise exception 'this server is under review'; end if;
  end if;
  if new.owner_id <> old.owner_id then
    if old.owner_id <> auth.uid() and current_setting('venband.mod', true) is distinct from 'on' then
      raise exception 'only the owner can transfer ownership';
    end if;
    if not public.is_server_member(new.id, new.owner_id) then raise exception 'new owner must be a member'; end if;
  end if;
  if new.welcome_channel_id is not null
     and not exists (select 1 from public.channels c where c.id = new.welcome_channel_id
                     and c.server_id = new.id and c.type = 'text') then
    raise exception 'welcome channel must be a text channel in this server';
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------- join messages ----
create table if not exists public.server_events (
  id         uuid primary key default gen_random_uuid(),
  server_id  uuid not null references public.servers (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('join')),
  created_at timestamptz not null default now()
);
create index if not exists server_events_server_idx on public.server_events (server_id, created_at desc);
alter table public.server_events enable row level security;
drop policy if exists server_events_select on public.server_events;
create policy server_events_select on public.server_events for select to authenticated
  using (public.is_server_member(server_id));

create or replace function public.on_member_joined()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.servers s where s.id = new.server_id
             and s.welcome_channel_id is not null and s.owner_id <> new.user_id) then
    insert into public.server_events (server_id, user_id, kind) values (new.server_id, new.user_id, 'join');
  end if;
  return new;
end;
$$;
drop trigger if exists server_members_joined on public.server_members;
create trigger server_members_joined after insert on public.server_members
  for each row execute function public.on_member_joined();

create or replace function public.create_server(p_name text, p_icon_color text default '#7c5cff')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_server uuid;
  v_welcome uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public.account_can('create') then raise exception 'your account can''t create servers right now'; end if;
  if (select count(*) from public.servers where owner_id = v_uid) >= 100 then
    raise exception 'server limit reached';
  end if;
  insert into public.servers (name, owner_id, icon_color)
  values (btrim(p_name), v_uid, p_icon_color) returning id into v_server;
  insert into public.server_members (server_id, user_id) values (v_server, v_uid);
  -- @everyone: SEND_MESSAGES | CREATE_INVITE | CONNECT | SPEAK | VIDEO
  insert into public.roles (server_id, name, color, permissions, position, is_default)
  values (v_server, '@everyone', '#99aab5', 128 | 64 | 512 | 1024 | 2048, 0, true);
  insert into public.channels (server_id, type, name, category, position, topic)
  values (v_server, 'text', 'welcome', 'Information', 0, 'Say hi to new members!')
  returning id into v_welcome;
  insert into public.channels (server_id, type, name, category, position)
  values (v_server, 'text', 'chat', 'Text Channels', 1),
         (v_server, 'voice', 'General', 'Voice Channels', 2);
  perform set_config('venband.mod', 'on', true);
  update public.servers set welcome_channel_id = v_welcome where id = v_server;
  perform set_config('venband.mod', 'off', true);
  return v_server;
end;
$$;

create or replace function public.join_server(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  inv public.invites%rowtype;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public.account_can('join') then raise exception 'your account can''t join servers right now'; end if;
  select * into inv from public.invites where code = p_code for update;
  if not found
     or (inv.expires_at is not null and inv.expires_at < now())
     or (inv.max_uses is not null and inv.uses >= inv.max_uses) then
    raise exception 'invalid or expired invite';
  end if;
  if exists (select 1 from public.servers s where s.id = inv.server_id and s.status <> 'active') then
    raise exception 'this server is not available right now';
  end if;
  if exists (select 1 from public.bans where server_id = inv.server_id and user_id = v_uid) then
    raise exception 'you are banned from this server';
  end if;
  if public.is_server_member(inv.server_id, v_uid) then return inv.server_id; end if;
  insert into public.server_members (server_id, user_id) values (inv.server_id, v_uid);
  update public.invites set uses = uses + 1 where code = p_code;
  return inv.server_id;
end;
$$;

-- -------------------------------------------------------- server tags ----
-- Wear a server's tag next to your name. The tag text is copied onto the
-- profile so anyone can see it, and kept in sync by the triggers below.
create or replace function public.set_server_tag(p_server uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_server is null then
    update public.profiles set tag_server_id = null, server_tag = null where id = auth.uid();
    return;
  end if;
  if not public.is_server_member(p_server) then raise exception 'you are not in that server'; end if;
  if not exists (select 1 from public.servers where id = p_server and tag is not null and status = 'active') then
    raise exception 'that server has no tag';
  end if;
  update public.profiles set tag_server_id = p_server,
    server_tag = (select tag from public.servers where id = p_server)
  where id = auth.uid();
end;
$$;

create or replace function public.sync_server_tag()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.tag is distinct from old.tag or new.status <> 'active' then
    update public.profiles
    set server_tag = case when new.status = 'active' then new.tag end,
        tag_server_id = case when new.tag is null or new.status <> 'active' then null else tag_server_id end
    where tag_server_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists servers_tag_sync on public.servers;
create trigger servers_tag_sync after update of tag, status on public.servers
  for each row execute function public.sync_server_tag();

create or replace function public.clear_server_tag_on_leave()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set tag_server_id = null, server_tag = null
  where id = old.user_id and tag_server_id = old.server_id;
  return old;
end;
$$;
drop trigger if exists server_members_tag_clear on public.server_members;
create trigger server_members_tag_clear after delete on public.server_members
  for each row execute function public.clear_server_tag_on_leave();

-- ---------------------------------------------------------- discovery ----
drop function if exists public.discover_servers(text);
create or replace function public.discover_servers(p_query text default '')
returns table (id uuid, name text, description text, icon_color text, banner_color text,
               tag text, verified boolean, members integer, joined boolean)
language sql stable security definer set search_path = '' as $$
  select * from (
    select s.id, s.name, s.description, s.icon_color, s.banner_color, s.tag, s.verified,
           public.member_count(s.id) as members, public.is_server_member(s.id) as joined
    from public.servers s
    where auth.uid() is not null and s.status = 'active' and s.discoverable
      and (coalesce(p_query, '') = '' or s.name ilike '%' || p_query || '%' or s.description ilike '%' || p_query || '%')
  ) x
  where x.verified or x.members >= 1000
  order by x.verified desc, x.members desc
  limit 60;
$$;

create or replace function public.join_discoverable(p_server uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public.account_can('discover') then raise exception 'your account can''t join servers right now'; end if;
  if not exists (select 1 from public.discover_servers('') d where d.id = p_server) then
    raise exception 'this server is not in discovery';
  end if;
  if exists (select 1 from public.bans where server_id = p_server and user_id = v_uid) then
    raise exception 'you are banned from this server';
  end if;
  insert into public.server_members (server_id, user_id) values (p_server, v_uid) on conflict do nothing;
  return p_server;
end;
$$;

-- -------------------------------------------------- DMs and groups ----
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
  if public.is_blocked_between(p_other, v_uid) then raise exception 'you can''t message this user'; end if;
  if not (public.account_can('dm') or public.is_staff(v_uid)
          or (public.account_can('send') and public.are_friends(p_other, v_uid))) then
    raise exception 'your account can only message friends right now';
  end if;
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
  if not public.account_can('dm') then raise exception 'your account can''t create groups right now'; end if;
  select coalesce(array_agg(distinct m), '{}') into v_members
  from unnest(coalesce(p_members, '{}')) m
  where m <> v_uid and exists (select 1 from public.profiles p where p.id = m)
    and not public.is_blocked_between(m, v_uid);
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

-- --------------------------------------------------------- moderation ----
create table if not exists public.mod_actions (
  id            uuid primary key default gen_random_uuid(),
  actor_id      uuid references public.profiles (id) on delete set null,
  target_user   uuid references public.profiles (id) on delete set null,
  target_server uuid references public.servers (id) on delete set null,
  action        text not null,
  detail        text not null default '',
  reason        text not null default '' check (char_length(reason) <= 1000),
  created_at    timestamptz not null default now()
);
create index if not exists mod_actions_created_idx on public.mod_actions (created_at desc);
alter table public.mod_actions enable row level security;
drop policy if exists mod_actions_select on public.mod_actions;
create policy mod_actions_select on public.mod_actions for select to authenticated
  using (public.is_staff());

create or replace function public.mod_search(p_query text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  q text := btrim(coalesce(p_query, ''));
  v_users jsonb;
  v_servers jsonb;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select coalesce(jsonb_agg(u), '[]') into v_users from (
    select p.id, p.username, p.display_name, p.avatar_color, p.badges, p.platform_role,
           p.account_status, p.created_at
    from public.profiles p
    where q = '' or p.id::text = q or p.username ilike '%' || q || '%' or p.display_name ilike '%' || q || '%'
    order by (p.username = lower(q)) desc, p.created_at desc
    limit 25) u;
  select coalesce(jsonb_agg(s), '[]') into v_servers from (
    select s.id, s.name, s.icon_color, s.status, s.verified, s.created_at, s.description,
           public.member_count(s.id) as members, p.username as owner_username, s.owner_id
    from public.servers s join public.profiles p on p.id = s.owner_id
    where q = '' or s.id::text = q or s.name ilike '%' || q || '%'
    order by (s.status = 'review') desc, s.created_at desc
    limit 25) s;
  return jsonb_build_object('users', v_users, 'servers', v_servers);
end;
$$;

create or replace function public.mod_log(p_limit integer default 50)
returns table (id uuid, actor text, target_user text, target_server text, action text, detail text,
               reason text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.id, a.username, u.username, s.name, m.action, m.detail, m.reason, m.created_at
  from public.mod_actions m
  left join public.profiles a on a.id = m.actor_id
  left join public.profiles u on u.id = m.target_user
  left join public.servers s on s.id = m.target_server
  where public.is_staff()
  order by m.created_at desc
  limit least(coalesce(p_limit, 50), 200);
$$;

-- you can only act on people ranked below you (the owner may edit themself)
create or replace function public.mod_can_target(p_target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_staff()
     and (public.platform_rank() > public.platform_rank(p_target)
          or (p_target = auth.uid() and public.platform_rank() = 3));
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
  -- staff badges need admin; the owner badge needs the owner
  if public.platform_rank() < 2 and (
       (select coalesce(array_agg(b), '{}') from unnest(v_new) b where b = any (v_staff_badges))
       is distinct from
       (select coalesce(array_agg(b order by b), '{}') from unnest(v_old) b where b = any (v_staff_badges))) then
    raise exception 'only admins can change staff badges';
  end if;
  if public.platform_rank() < 3 and (('owner' = any (v_new)) <> ('owner' = any (v_old))) then
    raise exception 'only the owner can change the owner badge';
  end if;
  update public.profiles set badges = v_new where id = p_user;
  insert into public.mod_actions (actor_id, target_user, action, detail)
  values (auth.uid(), p_user, 'badges', array_to_string(v_new, ', '));
end;
$$;

create or replace function public.mod_set_account_status(p_user uuid, p_status text, p_reason text default '')
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
end;
$$;

create or replace function public.mod_set_platform_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_role not in ('user', 'moderator', 'admin', 'owner') then raise exception 'unknown role'; end if;
  if public.platform_rank() < 3 then raise exception 'only the owner can change staff roles'; end if;
  if p_user = auth.uid() then raise exception 'you can''t change your own role'; end if;
  update public.profiles set platform_role = p_role where id = p_user;
  insert into public.mod_actions (actor_id, target_user, action, detail)
  values (auth.uid(), p_user, 'platform_role', p_role);
end;
$$;

-- review: freeze while staff look at it   approve: unfreeze
-- reject: close it and make the owner very limited
-- ban:    close it permanently            unban: reopen
-- verify / unverify: check mark + discovery
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

-- ----------------------------------------------- settings and themes ----
create table if not exists public.user_settings (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb check (pg_column_size(data) < 32768),
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
drop policy if exists user_settings_all on public.user_settings;
create policy user_settings_all on public.user_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.themes (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  description text not null default '' check (char_length(description) <= 140),
  data        jsonb not null check (pg_column_size(data) < 8192),
  installs    integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists themes_installs_idx on public.themes (installs desc, created_at desc);
alter table public.themes enable row level security;
drop policy if exists themes_select on public.themes;
create policy themes_select on public.themes for select to authenticated using (true);
drop policy if exists themes_insert on public.themes;
create policy themes_insert on public.themes for insert to authenticated
  with check (author_id = auth.uid() and installs = 0 and public.account_can('publish')
              and (select count(*) from public.themes t where t.author_id = auth.uid()) < 25);
drop policy if exists themes_delete on public.themes;
create policy themes_delete on public.themes for delete to authenticated
  using (author_id = auth.uid() or public.is_staff());

create or replace function public.install_theme(p_theme uuid)
returns void language sql security definer set search_path = '' as $$
  update public.themes set installs = installs + 1 where id = p_theme and auth.uid() is not null;
$$;

-- ------------------------------------------------------------ devices ----
create table if not exists public.device_sessions (
  session_id uuid primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  label      text not null default '' check (char_length(label) <= 80),
  city       text not null default '' check (char_length(city) <= 80),
  region     text not null default '' check (char_length(region) <= 80),
  country    text not null default '' check (char_length(country) <= 80),
  updated_at timestamptz not null default now()
);
alter table public.device_sessions enable row level security;
drop policy if exists device_sessions_all on public.device_sessions;
create policy device_sessions_all on public.device_sessions for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and session_id = (auth.jwt() ->> 'session_id')::uuid);

create or replace function public.my_devices()
returns table (id uuid, created_at timestamptz, last_active timestamptz, user_agent text, ip text,
               label text, city text, region text, country text, current boolean)
language sql stable security definer set search_path = '' as $$
  select s.id, s.created_at, coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at),
         s.user_agent, host(s.ip), coalesce(d.label, ''), coalesce(d.city, ''), coalesce(d.region, ''),
         coalesce(d.country, ''), s.id = (auth.jwt() ->> 'session_id')::uuid
  from auth.sessions s
  left join public.device_sessions d on d.session_id = s.id
  where s.user_id = auth.uid()
  order by 10 desc, 3 desc;
$$;

create or replace function public.revoke_device(p_session uuid)
returns void language sql security definer set search_path = '' as $$
  delete from auth.sessions where id = p_session and user_id = auth.uid();
  delete from public.device_sessions where session_id = p_session and user_id = auth.uid();
$$;

-- false once this device was logged out from another device
create or replace function public.session_alive()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.sessions where id = (auth.jwt() ->> 'session_id')::uuid);
$$;

-- --------------------------------------- signup limit: 6 accounts / IP ----
create table if not exists public.platform_config (key text primary key, value text not null);
alter table public.platform_config enable row level security;
insert into public.platform_config (key, value)
values ('ip_pepper', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

create table if not exists public.signup_ips (
  ip_hash    text not null,
  user_id    uuid,
  created_at timestamptz not null default now()
);
create index if not exists signup_ips_hash_idx on public.signup_ips (ip_hash);
alter table public.signup_ips enable row level security;

-- Supabase Auth "Before User Created" hook.
-- Dashboard: Authentication → Hooks → Before User Created → Postgres → public.before_user_created
create or replace function public.before_user_created(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ip   text := nullif(event -> 'metadata' ->> 'ip_address', '');
  v_hash text;
  v_used integer;
begin
  if v_ip is null then return '{}'::jsonb; end if;
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

-- --------------------------------------------- the first platform owner ----
-- Gives the account that currently holds the username "sl" the owner role and
-- every badge, but only while nobody is owner yet, so a later account that
-- takes that name can never become owner.
update public.profiles
set platform_role = 'owner', badges = public.all_badges()
where username = 'sl' and not exists (select 1 from public.profiles where platform_role = 'owner');

-- ------------------------------------------------------------ realtime ----
do $$
declare t text;
begin
  foreach t in array array['friendships', 'server_events', 'user_relations', 'profiles'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
alter table public.friendships replica identity full;

-- -------------------------------------------------------------- grants ----
grant update (display_name, avatar_color, about, pronouns, status_text, status_emoji, presence,
              banner_color, banner_color2, accent_color, nameplate, language, onboarded)
  on public.profiles to authenticated;
revoke update (badges, platform_role, account_status, tag_server_id, server_tag) on public.profiles from authenticated;
grant select on public.friendships, public.server_events, public.mod_actions to authenticated;
grant select, insert, update, delete on public.user_relations, public.user_settings, public.device_sessions to authenticated;
grant select, insert, delete on public.themes to authenticated;
revoke all on public.platform_config, public.signup_ips from anon, authenticated;

revoke execute on function
  public.all_badges(), public.platform_rank(uuid), public.is_staff(uuid), public.account_can(text, uuid),
  public.are_friends(uuid, uuid), public.member_count(uuid), public.is_blocked_between(uuid, uuid),
  public.on_block(), public.can_see_profile(uuid, uuid), public.send_friend_request(text),
  public.respond_friend_request(uuid, boolean), public.remove_friend(uuid), public.mutual_servers(uuid),
  public.mutual_friends(uuid), public.dm_blocked(uuid, uuid), public.on_member_joined(),
  public.discover_servers(text), public.join_discoverable(uuid), public.mod_search(text),
  public.mod_log(integer), public.mod_can_target(uuid), public.mod_set_badges(uuid, text[]),
  public.mod_set_account_status(uuid, text, text), public.mod_set_platform_role(uuid, text),
  public.mod_server_action(uuid, text, text), public.install_theme(uuid), public.my_devices(),
  public.revoke_device(uuid), public.session_alive(), public.before_user_created(jsonb),
  public.set_server_tag(uuid), public.sync_server_tag(), public.clear_server_tag_on_leave()
from anon, public;

grant execute on function
  public.all_badges(), public.platform_rank(uuid), public.is_staff(uuid), public.account_can(text, uuid),
  public.are_friends(uuid, uuid), public.member_count(uuid), public.is_blocked_between(uuid, uuid),
  public.can_see_profile(uuid, uuid), public.send_friend_request(text),
  public.respond_friend_request(uuid, boolean), public.remove_friend(uuid), public.mutual_servers(uuid),
  public.mutual_friends(uuid), public.dm_blocked(uuid, uuid), public.discover_servers(text),
  public.join_discoverable(uuid), public.mod_search(text), public.mod_log(integer),
  public.mod_can_target(uuid), public.mod_set_badges(uuid, text[]),
  public.mod_set_account_status(uuid, text, text), public.mod_set_platform_role(uuid, text),
  public.mod_server_action(uuid, text, text), public.install_theme(uuid), public.my_devices(),
  public.revoke_device(uuid), public.session_alive(), public.set_server_tag(uuid),
  public.create_server(text, text), public.join_server(text), public.open_dm(uuid),
  public.create_group(uuid[], text), public.server_permissions(uuid, uuid), public.can_view_channel(uuid, uuid)
to authenticated;

grant execute on function public.before_user_created(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;


-- ================ reports, message requests, server pictures (20261003000000)
-- =============================================================================
-- Reports, message requests, server icon/banner images, empty categories,
-- Founder badge.
--
-- Safe to run more than once.
-- =============================================================================

-- ------------------------------------------------------------- servers ----
alter table public.servers
  add column if not exists categories text[] not null default '{}',
  add column if not exists icon_url   text check (icon_url is null or (char_length(icon_url) <= 600 and icon_url ~ '^https?://')),
  add column if not exists banner_url text check (banner_url is null or (char_length(banner_url) <= 600 and banner_url ~ '^https?://'));
do $$ begin
  alter table public.servers add constraint servers_categories_sane
    check (cardinality(categories) <= 50 and array_to_string(categories, '') !~ '[\n\r]');
exception when duplicate_object then null; end $$;

-- Server icons and banners are public pictures (like on any chat app); they
-- live at server-assets/<server id>/<file>. Only people who can manage the
-- server may change them.
insert into storage.buckets (id, name, public, file_size_limit)
values ('server-assets', 'server-assets', true, 8388608)
on conflict (id) do update set public = true, file_size_limit = 8388608;
-- only pictures (where this Supabase version supports type limits)
do $$ begin
  update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg', 'image/gif', 'image/webp']
  where id = 'server-assets';
exception when undefined_column then null; end $$;

create or replace function public.can_manage_server_asset(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_first text := split_part(p_name, '/', 1);
begin
  if v_first !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return public.has_permission(v_first::uuid, 2);
end;
$$;

drop policy if exists venband_server_assets_read on storage.objects;
create policy venband_server_assets_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'server-assets');
drop policy if exists venband_server_assets_write on storage.objects;
create policy venband_server_assets_write on storage.objects for insert to authenticated
  with check (bucket_id = 'server-assets' and public.can_manage_server_asset(name));
drop policy if exists venband_server_assets_update on storage.objects;
create policy venband_server_assets_update on storage.objects for update to authenticated
  using (bucket_id = 'server-assets' and public.can_manage_server_asset(name));
drop policy if exists venband_server_assets_delete on storage.objects;
create policy venband_server_assets_delete on storage.objects for delete to authenticated
  using (bucket_id = 'server-assets' and public.can_manage_server_asset(name));

-- discovery shows the pictures too
drop function if exists public.discover_servers(text) cascade;
create function public.discover_servers(p_query text default '')
returns table (id uuid, name text, description text, icon_color text, banner_color text,
               tag text, verified boolean, members integer, joined boolean, icon_url text, banner_url text)
language sql stable security definer set search_path = '' as $$
  select * from (
    select s.id, s.name, s.description, s.icon_color, s.banner_color, s.tag, s.verified,
           public.member_count(s.id) as members, public.is_server_member(s.id) as joined, s.icon_url, s.banner_url
    from public.servers s
    where auth.uid() is not null and s.status = 'active' and s.discoverable
      and (coalesce(p_query, '') = '' or s.name ilike '%' || p_query || '%' or s.description ilike '%' || p_query || '%')
  ) x
  where x.verified or x.members >= 1000
  order by x.verified desc, x.members desc
  limit 60;
$$;
revoke execute on function public.discover_servers(text) from anon, public;
grant execute on function public.discover_servers(text) to authenticated;

-- ---------------------------------------------------- message requests ----
-- A DM from someone you have no friendship or server in common with lands in
-- your Message Requests until you accept it.
alter table public.channels add column if not exists request_to uuid references public.profiles (id) on delete set null;

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
  if public.is_blocked_between(p_other, v_uid) then raise exception 'you can''t message this user'; end if;
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

create or replace function public.accept_message_request(p_channel uuid)
returns void language sql security definer set search_path = '' as $$
  update public.channels set request_to = null where id = p_channel and request_to = auth.uid();
$$;

create or replace function public.decline_message_request(p_channel uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.channels where id = p_channel and request_to = auth.uid()) then
    raise exception 'no such message request';
  end if;
  delete from public.channels where id = p_channel;
end;
$$;

-- --------------------------------------------------------------- reports ----
-- Messages are end-to-end encrypted, so staff can't read them on the
-- server. A report carries the messages the reporter chose to share (their
-- app decrypts them and attaches the text as evidence).
create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid references public.profiles (id) on delete set null,
  kind         text not null check (kind in ('message', 'user')),
  target_user  uuid references public.profiles (id) on delete set null,
  message_id   uuid,
  channel_id   uuid references public.channels (id) on delete set null,
  server_id    uuid references public.servers (id) on delete set null,
  reason       text not null check (char_length(reason) between 1 and 1000),
  evidence     jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array' and pg_column_size(evidence) < 131072),
  status       text not null default 'under_review' check (status in ('under_review', 'actioned', 'dismissed')),
  handled_by   uuid references public.profiles (id) on delete set null,
  handled_note text not null default '' check (char_length(handled_note) <= 1000),
  created_at   timestamptz not null default now(),
  handled_at   timestamptz
);
create index if not exists reports_status_idx on public.reports (status, created_at desc);
alter table public.reports enable row level security;

drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated
  with check (
    reporter_id = auth.uid() and status = 'under_review' and handled_by is null
    and target_user is distinct from auth.uid()
    and (select count(*) from public.reports r where r.reporter_id = auth.uid() and r.created_at > now() - interval '1 hour') < 20
  );
-- reporters see their own reports (and their status); administrators see all
drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports for select to authenticated
  using (reporter_id = auth.uid() or public.platform_rank() >= 2);

create or replace function public.handle_report(p_report uuid, p_status text, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.platform_rank() < 2 then raise exception 'administrators only'; end if;
  if p_status not in ('under_review', 'actioned', 'dismissed') then raise exception 'unknown status'; end if;
  update public.reports
  set status = p_status, handled_by = auth.uid(), handled_note = left(coalesce(p_note, ''), 1000),
      handled_at = case when p_status = 'under_review' then null else now() end
  where id = p_report;
  insert into public.mod_actions (actor_id, target_user, action, detail, reason)
  select auth.uid(), r.target_user, 'report_' || p_status, r.kind, left(coalesce(p_note, ''), 1000)
  from public.reports r where r.id = p_report;
end;
$$;

-- ------------------------------------------------------------- badges ----
-- Founder: the person who started Venband. Different from Owner (a staff
-- role with every permission). Only an owner can hand out either.
create or replace function public.all_badges()
returns text[] language sql immutable set search_path = '' as $$
  select array['founder', 'owner', 'admin', 'moderator', 'staff', 'partner', 'verified_dev', 'bug_hunter',
               'bug_hunter_gold', 'og', 'early_supporter', 'supporter', 'translator', 'event_winner']::text[];
$$;

create or replace function public.mod_set_badges(p_user uuid, p_badges text[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_new text[];
  v_old text[];
  v_staff_badges text[] := array['admin', 'moderator', 'staff'];
  v_owner_badges text[] := array['founder', 'owner'];
begin
  if not public.mod_can_target(p_user) then raise exception 'you can''t change this account'; end if;
  select coalesce(array_agg(distinct b order by b), '{}') into v_new
  from unnest(coalesce(p_badges, '{}')) b where b = any (public.all_badges());
  select badges into v_old from public.profiles where id = p_user;
  if public.platform_rank() < 2 and (
       (select coalesce(array_agg(b order by b), '{}') from unnest(v_new) b where b = any (v_staff_badges))
       is distinct from
       (select coalesce(array_agg(b order by b), '{}') from unnest(v_old) b where b = any (v_staff_badges))) then
    raise exception 'only admins can change staff badges';
  end if;
  if public.platform_rank() < 3 and (
       (select coalesce(array_agg(b order by b), '{}') from unnest(v_new) b where b = any (v_owner_badges))
       is distinct from
       (select coalesce(array_agg(b order by b), '{}') from unnest(v_old) b where b = any (v_owner_badges))) then
    raise exception 'only an owner can change the founder and owner badges';
  end if;
  update public.profiles set badges = v_new where id = p_user;
  insert into public.mod_actions (actor_id, target_user, action, detail)
  values (auth.uid(), p_user, 'badges', array_to_string(v_new, ', '));
end;
$$;

-- One-time grants, each applied at most once (so nobody who later takes one
-- of these usernames can ever receive them):
--   "sl"   → the Founder badge
--   "halt" → Owner role (every permission) and every badge except Founder
insert into public.platform_config (key, value)
select 'granted_founder_sl', 'yes'
where exists (select 1 from public.profiles where username = 'sl')
on conflict (key) do nothing;
update public.profiles
set badges = (select array_agg(distinct b) from unnest(badges || array['founder']) b)
where username = 'sl'
  and exists (select 1 from public.platform_config where key = 'granted_founder_sl' and value = 'yes')
  and not exists (select 1 from public.platform_config where key = 'granted_founder_sl_done');
insert into public.platform_config (key, value)
select 'granted_founder_sl_done', 'yes'
where exists (select 1 from public.platform_config where key = 'granted_founder_sl')
on conflict (key) do nothing;

update public.profiles
set platform_role = 'owner', badges = array_remove(public.all_badges(), 'founder')
where username = 'halt'
  and not exists (select 1 from public.platform_config where key = 'granted_owner_halt');
insert into public.platform_config (key, value)
select 'granted_owner_halt', 'yes'
where exists (select 1 from public.profiles where username = 'halt')
on conflict (key) do nothing;

-- ------------------------------------------------------------- grants ----
grant select, insert on public.reports to authenticated;
revoke execute on function
  public.can_manage_server_asset(text), public.accept_message_request(uuid), public.decline_message_request(uuid),
  public.handle_report(uuid, text, text)
from anon, public;
grant execute on function
  public.can_manage_server_asset(text), public.accept_message_request(uuid), public.decline_message_request(uuid),
  public.handle_report(uuid, text, text), public.open_dm(uuid), public.mod_set_badges(uuid, text[]), public.all_badges()
to authenticated;
grant execute on function public.can_manage_server_asset(text) to anon;

-- ======================= messaging features (20261004000000_messaging.sql)
-- =============================================================================
-- Messaging: reactions, edit history, deleted-message log, pins, saved
-- messages, read markers, threads, polls, scheduled messages, more permission
-- bits. Safe to run more than once (it is also part of supabase/repair.sql).
--
-- Everything that carries words stays end-to-end encrypted:
--   * reactions are encrypted with the reacted message's channel key; the
--     server only sees an opaque tag (HMAC) used to group identical reactions
--   * edit history keeps the old ciphertext, not plaintext
--   * polls: the question and options live in the encrypted message; the
--     server only stores option numbers
-- =============================================================================

-- ------------------------------------------------------- permission bits ----
--   ADD_REACTIONS      4096        CREATE_THREADS   8192
--   MANAGE_THREADS     16384       CREATE_POLLS     32768
--   ATTACH_FILES       65536       EMBED_LINKS      131072
--   MENTION_EVERYONE   262144      USE_SOUNDBOARD   524288
--   MANAGE_EXPRESSIONS 1048576     MODERATE_MEMBERS 2097152
--   VIEW_AUDIT_LOG     4194304     MANAGE_EVENTS    8388608
--   MANAGE_INTEGRATIONS 16777216   MUTE_MEMBERS     33554432
--   DEAFEN_MEMBERS     67108864    MOVE_MEMBERS     134217728
--   MANAGE_NICKNAMES   268435456   CHANGE_NICKNAME  536870912
--   REQUEST_TO_SPEAK   1073741824
--   ALL                2147483647
alter table public.roles drop constraint if exists roles_permissions_check;
alter table public.roles add constraint roles_permissions_check check (permissions >= 0 and permissions <= 2147483647);

-- Give existing @everyone roles the new everyday permissions once.
do $$
begin
  if not exists (select 1 from public.platform_config where key = 'perm_bits_v2') then
    update public.roles
       set permissions = permissions | 4096 | 8192 | 32768 | 65536 | 131072 | 524288 | 536870912 | 1073741824
     where is_default;
    -- roles that could manage messages can now also manage threads
    update public.roles set permissions = permissions | 16384 where (permissions & 256) = 256;
    insert into public.platform_config (key, value) values ('perm_bits_v2', 'true'::jsonb);
  end if;
end $$;

create or replace function public.server_permissions(p_server uuid, p_user uuid default auth.uid())
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_status text;
  v_perms bigint;
begin
  select owner_id, status into v_owner, v_status from public.servers where id = p_server;
  if v_owner is null or v_status <> 'active' then return 0; end if;
  if v_owner = p_user then return 2147483647; end if;
  if not public.is_server_member(p_server, p_user) then return 0; end if;

  select coalesce(bit_or(r.permissions), 0) into v_perms
  from public.roles r
  where r.server_id = p_server
    and (r.is_default or exists (select 1 from public.member_roles mr
                                 where mr.role_id = r.id and mr.user_id = p_user
                                   and mr.server_id = p_server));
  if (v_perms & 1) = 1 then return 2147483647; end if;
  return v_perms;
end;
$$;

-- New servers start with the new everyday permissions too.
create or replace function public.create_server(p_name text, p_icon_color text default '#7c5cff')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_server uuid;
  v_welcome uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public.account_can('create') then raise exception 'your account can''t create servers right now'; end if;
  if (select count(*) from public.servers where owner_id = v_uid) >= 100 then
    raise exception 'server limit reached';
  end if;
  insert into public.servers (name, owner_id, icon_color)
  values (btrim(p_name), v_uid, p_icon_color) returning id into v_server;
  insert into public.server_members (server_id, user_id) values (v_server, v_uid);
  -- @everyone: the everyday permissions (see the bit list at the top of this file)
  insert into public.roles (server_id, name, color, permissions, position, is_default)
  values (v_server, '@everyone', '#99aab5', 128 | 64 | 512 | 1024 | 2048 | 4096 | 8192 | 32768 | 65536 | 131072 | 524288 | 536870912 | 1073741824, 0, true);
  insert into public.channels (server_id, type, name, category, position, topic)
  values (v_server, 'text', 'welcome', 'Information', 0, 'Say hi to new members!')
  returning id into v_welcome;
  insert into public.channels (server_id, type, name, category, position)
  values (v_server, 'text', 'chat', 'Text Channels', 1),
         (v_server, 'voice', 'General', 'Voice Channels', 2);
  perform set_config('venband.mod', 'on', true);
  update public.servers set welcome_channel_id = v_welcome where id = v_server;
  perform set_config('venband.mod', 'off', true);
  return v_server;
end;
$$;

-- ------------------------------------------------------------- threads ----
alter table public.messages add column if not exists thread_root uuid references public.messages (id) on delete cascade;
create index if not exists messages_thread_idx on public.messages (thread_root, created_at) where thread_root is not null;

create table if not exists public.threads (
  root_id         uuid primary key references public.messages (id) on delete cascade,
  channel_id      uuid not null references public.channels (id) on delete cascade,
  name            text not null check (char_length(btrim(name)) between 1 and 100),
  created_by      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at      timestamptz not null default now(),
  locked          boolean not null default false,
  archived        boolean not null default false,
  last_message_at timestamptz not null default now(),
  message_count   integer not null default 0
);
create index if not exists threads_channel_idx on public.threads (channel_id, last_message_at desc);
alter table public.threads enable row level security;

drop policy if exists threads_select on public.threads;
create policy threads_select on public.threads for select to authenticated
  using (public.can_view_channel(channel_id));
drop policy if exists threads_insert on public.threads;
create policy threads_insert on public.threads for insert to authenticated
  with check (created_by = auth.uid()
              and public.channel_has_permission(channel_id, 8192)
              and exists (select 1 from public.messages m where m.id = root_id and m.channel_id = threads.channel_id and m.thread_root is null));
drop policy if exists threads_update on public.threads;
create policy threads_update on public.threads for update to authenticated
  using (created_by = auth.uid() or public.channel_has_permission(channel_id, 16384))
  with check (created_by = auth.uid() or public.channel_has_permission(channel_id, 16384));
drop policy if exists threads_delete on public.threads;
create policy threads_delete on public.threads for delete to authenticated
  using (public.channel_has_permission(channel_id, 16384));

-- Only managers can lock or unlock; renaming/archiving is allowed for the creator.
create or replace function public.guard_thread_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.root_id <> old.root_id or new.channel_id <> old.channel_id or new.created_by <> old.created_by
     or new.created_at <> old.created_at then
    raise exception 'immutable column';
  end if;
  if new.locked <> old.locked and not public.channel_has_permission(new.channel_id, 16384) then
    raise exception 'you need Manage Threads to lock a thread';
  end if;
  if old.locked and not public.channel_has_permission(new.channel_id, 16384) then
    raise exception 'this thread is locked';
  end if;
  if current_setting('venband.thread_bump', true) is distinct from 'on' then
    new.message_count := old.message_count;
    new.last_message_at := old.last_message_at;
  end if;
  return new;
end;
$$;
drop trigger if exists threads_guard on public.threads;
create trigger threads_guard before update on public.threads
  for each row execute function public.guard_thread_update();

-- Thread replies: same channel as the root, thread must exist and be open.
create or replace function public.check_thread_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  t public.threads%rowtype;
begin
  if new.thread_root is null then return new; end if;
  select * into t from public.threads where root_id = new.thread_root;
  if not found or t.channel_id <> new.channel_id then raise exception 'thread not found'; end if;
  if t.locked and not public.channel_has_permission(new.channel_id, 16384, new.author_id) then
    raise exception 'this thread is locked';
  end if;
  perform set_config('venband.thread_bump', 'on', true);
  update public.threads set message_count = message_count + 1, last_message_at = now(), archived = false
   where root_id = new.thread_root;
  perform set_config('venband.thread_bump', 'off', true);
  return new;
end;
$$;
drop trigger if exists messages_thread_check on public.messages;
create trigger messages_thread_check before insert on public.messages
  for each row execute function public.check_thread_message();

-- thread_root can't change after sending
create or replace function public.guard_message_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id or new.channel_id <> old.channel_id or new.author_id <> old.author_id
     or new.created_at <> old.created_at or new.reply_to is distinct from old.reply_to
     or new.thread_root is distinct from old.thread_root then
    raise exception 'immutable column';
  end if;
  new.edited_at := now();
  return new;
end;
$$;

-- --------------------------------------------------------- edit history ----
create table if not exists public.message_revisions (
  id            bigint generated always as identity primary key,
  message_id    uuid not null references public.messages (id) on delete cascade,
  channel_id    uuid not null references public.channels (id) on delete cascade,
  author_id     uuid not null,
  author_key_id text not null,
  epoch         integer not null,
  iv            text not null,
  ciphertext    text not null,
  signature     text not null,
  written_at    timestamptz not null,
  replaced_at   timestamptz not null default now()
);
create index if not exists message_revisions_msg_idx on public.message_revisions (message_id, replaced_at);
alter table public.message_revisions enable row level security;
drop policy if exists message_revisions_select on public.message_revisions;
create policy message_revisions_select on public.message_revisions for select to authenticated
  using (public.can_view_channel(channel_id));

create or replace function public.keep_message_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.ciphertext is distinct from old.ciphertext then
    insert into public.message_revisions (message_id, channel_id, author_id, author_key_id, epoch, iv, ciphertext, signature, written_at)
    values (old.id, old.channel_id, old.author_id, old.author_key_id, old.epoch, old.iv, old.ciphertext, old.signature,
            coalesce(old.edited_at, old.created_at));
  end if;
  return new;
end;
$$;
drop trigger if exists messages_keep_revision on public.messages;
create trigger messages_keep_revision after update on public.messages
  for each row execute function public.keep_message_revision();

-- ------------------------------------------------- deleted message log ----
-- Server messages that get deleted are kept (still encrypted) for moderators
-- with Manage Messages, for the server's retention period (default 30 days,
-- 0 = don't keep). DMs and groups are never kept.
alter table public.servers add column if not exists log_retention_days integer not null default 30
  check (log_retention_days between 0 and 365);

create table if not exists public.deleted_messages (
  id            uuid primary key,
  server_id     uuid not null references public.servers (id) on delete cascade,
  channel_id    uuid not null references public.channels (id) on delete cascade,
  author_id     uuid not null,
  author_key_id text not null,
  epoch         integer not null,
  iv            text not null,
  ciphertext    text not null,
  signature     text not null,
  created_at    timestamptz not null,
  deleted_at    timestamptz not null default now(),
  deleted_by    uuid,
  purge_after   timestamptz not null
);
create index if not exists deleted_messages_server_idx on public.deleted_messages (server_id, deleted_at desc);
alter table public.deleted_messages enable row level security;
drop policy if exists deleted_messages_select on public.deleted_messages;
create policy deleted_messages_select on public.deleted_messages for select to authenticated
  using (purge_after > now() and public.channel_has_permission(channel_id, 256));

create or replace function public.log_deleted_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_server uuid;
  v_days integer;
begin
  -- only direct deletes: when a whole channel or server is deleted, the
  -- messages cascade away with it (pg_trigger_depth() > 1 inside cascades)
  if pg_trigger_depth() > 1 then return old; end if;
  select c.server_id, s.log_retention_days into v_server, v_days
    from public.channels c left join public.servers s on s.id = c.server_id
   where c.id = old.channel_id;
  if v_server is not null and coalesce(v_days, 0) > 0 then
    insert into public.deleted_messages (id, server_id, channel_id, author_id, author_key_id, epoch, iv, ciphertext,
                                         signature, created_at, deleted_by, purge_after)
    values (old.id, v_server, old.channel_id, old.author_id, old.author_key_id, old.epoch, old.iv, old.ciphertext,
            old.signature, old.created_at, auth.uid(), now() + make_interval(days => v_days))
    on conflict (id) do nothing;
  end if;
  delete from public.deleted_messages where purge_after < now();
  return old;
end;
$$;
drop trigger if exists messages_log_delete on public.messages;
create trigger messages_log_delete before delete on public.messages
  for each row execute function public.log_deleted_message();

-- ------------------------------------------------------------ reactions ----
create table if not exists public.reactions (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  epoch      integer not null,
  tag        text not null check (char_length(tag) between 8 and 64),
  iv         text not null check (char_length(iv) < 64),
  ciphertext text not null check (char_length(ciphertext) < 600),
  created_at timestamptz not null default now(),
  unique (message_id, user_id, tag)
);
create index if not exists reactions_channel_idx on public.reactions (channel_id, message_id);
alter table public.reactions enable row level security;
drop policy if exists reactions_select on public.reactions;
create policy reactions_select on public.reactions for select to authenticated
  using (public.can_view_channel(channel_id));
drop policy if exists reactions_insert on public.reactions;
create policy reactions_insert on public.reactions for insert to authenticated
  with check (user_id = auth.uid()
              and public.account_can('send')
              and public.channel_has_permission(channel_id, 4096)
              and not public.dm_blocked(channel_id)
              and exists (select 1 from public.messages m where m.id = message_id and m.channel_id = reactions.channel_id)
              and (select count(*) from public.reactions r where r.message_id = reactions.message_id) < 200);
drop policy if exists reactions_delete on public.reactions;
create policy reactions_delete on public.reactions for delete to authenticated
  using (user_id = auth.uid() or public.channel_has_permission(channel_id, 256));

-- ----------------------------------------------------------------- pins ----
create table if not exists public.pins (
  message_id uuid primary key references public.messages (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  pinned_by  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  pinned_at  timestamptz not null default now()
);
create index if not exists pins_channel_idx on public.pins (channel_id, pinned_at desc);
alter table public.pins enable row level security;
drop policy if exists pins_select on public.pins;
create policy pins_select on public.pins for select to authenticated
  using (public.can_view_channel(channel_id));
-- DMs and groups: anyone in the conversation. Servers: Manage Messages.
drop policy if exists pins_insert on public.pins;
create policy pins_insert on public.pins for insert to authenticated
  with check (pinned_by = auth.uid()
              and public.channel_has_permission(channel_id, 256)
              and exists (select 1 from public.messages m where m.id = message_id and m.channel_id = pins.channel_id)
              and (select count(*) from public.pins p where p.channel_id = pins.channel_id) < 250);
drop policy if exists pins_delete on public.pins;
create policy pins_delete on public.pins for delete to authenticated
  using (public.channel_has_permission(channel_id, 256));

-- Row counts for per-user limits (a policy can't query its own table).
create or replace function public.my_row_count(p_table text)
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare n bigint;
begin
  if p_table = 'saved_messages' then select count(*) into n from public.saved_messages where user_id = auth.uid();
  elsif p_table = 'scheduled_messages' then select count(*) into n from public.scheduled_messages where author_id = auth.uid();
  else raise exception 'unknown table';
  end if;
  return n;
end;
$$;
grant execute on function public.my_row_count(text) to authenticated;

-- ------------------------------------------------------- saved messages ----
create table if not exists public.saved_messages (
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);
alter table public.saved_messages enable row level security;
drop policy if exists saved_messages_own on public.saved_messages;
create policy saved_messages_own on public.saved_messages for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.can_view_channel(channel_id)
              and exists (select 1 from public.messages m where m.id = message_id and m.channel_id = saved_messages.channel_id)
              and public.my_row_count('saved_messages') < 1000);

-- ---------------------------------------------------------- read states ----
-- Synced across devices: where you stopped reading in each conversation.
create table if not exists public.read_states (
  user_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  channel_id   uuid not null references public.channels (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  manual_unread boolean not null default false,
  updated_at   timestamptz not null default now(),
  primary key (user_id, channel_id)
);
alter table public.read_states enable row level security;
drop policy if exists read_states_own on public.read_states;
create policy read_states_own on public.read_states for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.can_view_channel(channel_id));

-- ---------------------------------------------------------------- polls ----
create table if not exists public.polls (
  message_id   uuid primary key references public.messages (id) on delete cascade,
  channel_id   uuid not null references public.channels (id) on delete cascade,
  created_by   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  option_count smallint not null check (option_count between 2 and 10),
  multi        boolean not null default false,
  anonymous    boolean not null default false,
  expires_at   timestamptz
);
alter table public.polls enable row level security;
drop policy if exists polls_select on public.polls;
create policy polls_select on public.polls for select to authenticated using (public.can_view_channel(channel_id));
drop policy if exists polls_insert on public.polls;
create policy polls_insert on public.polls for insert to authenticated
  with check (created_by = auth.uid() and public.channel_has_permission(channel_id, 32768)
              and exists (select 1 from public.messages m where m.id = message_id and m.channel_id = polls.channel_id
                          and m.author_id = auth.uid()));
drop policy if exists polls_update on public.polls;
create policy polls_update on public.polls for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());

create table if not exists public.poll_votes (
  message_id uuid not null references public.polls (message_id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  options    smallint[] not null check (cardinality(options) between 1 and 10),
  voted_at   timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.poll_votes enable row level security;
-- you always see your own vote; others' votes only on non-anonymous polls
drop policy if exists poll_votes_select on public.poll_votes;
create policy poll_votes_select on public.poll_votes for select to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.polls p where p.message_id = poll_votes.message_id
                    and not p.anonymous and public.can_view_channel(p.channel_id)));
drop policy if exists poll_votes_write on public.poll_votes;
create policy poll_votes_write on public.poll_votes for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (
    select 1 from public.polls p
     where p.message_id = poll_votes.message_id
       and p.channel_id = poll_votes.channel_id
       and public.can_view_channel(p.channel_id)
       and (p.expires_at is null or p.expires_at > now())
       and (p.multi or cardinality(poll_votes.options) = 1)
       and poll_votes.options <@ (select array_agg(i::smallint) from generate_series(0, p.option_count - 1) i)));

-- Live counts without revealing who voted (works for anonymous polls).
create or replace function public.poll_results(p_message uuid)
returns table (option smallint, votes bigint) language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.polls p where p.message_id = p_message and public.can_view_channel(p.channel_id)) then
    raise exception 'forbidden';
  end if;
  return query select o::smallint, count(*) from public.poll_votes v, unnest(v.options) o
               where v.message_id = p_message group by o order by o;
end;
$$;

-- ---------------------------------------------------- scheduled messages ----
-- Already encrypted on the sender's device; delivered at send_at.
create table if not exists public.scheduled_messages (
  id            uuid primary key,
  channel_id    uuid not null references public.channels (id) on delete cascade,
  author_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  author_key_id text not null references public.user_keys (key_id),
  epoch         integer not null,
  iv            text not null check (char_length(iv) < 64),
  ciphertext    text not null check (char_length(ciphertext) <= 20000),
  signature     text not null check (char_length(signature) < 200),
  reply_to      uuid references public.messages (id) on delete set null,
  send_at       timestamptz not null check (send_at < now() + interval '366 days'),
  created_at    timestamptz not null default now(),
  foreign key (channel_id, epoch) references public.channel_epochs (channel_id, epoch)
);
create index if not exists scheduled_messages_due_idx on public.scheduled_messages (send_at);
alter table public.scheduled_messages enable row level security;
drop policy if exists scheduled_messages_own on public.scheduled_messages;
create policy scheduled_messages_own on public.scheduled_messages for all to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid() and public.channel_has_permission(channel_id, 128)
              and public.my_row_count('scheduled_messages') < 100);

-- Move due messages into the channel. Re-checks that the author may still send.
create or replace function public.deliver_scheduled_messages()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  s public.scheduled_messages%rowtype;
  n integer := 0;
begin
  for s in select * from public.scheduled_messages where send_at <= now() order by send_at limit 500 for update skip locked loop
    delete from public.scheduled_messages where id = s.id;
    if public.channel_has_permission(s.channel_id, 128, s.author_id)
       and public.account_can('send', s.author_id)
       and not public.dm_blocked(s.channel_id, s.author_id)
       and exists (select 1 from public.user_keys k where k.key_id = s.author_key_id and k.revoked_at is null) then
      insert into public.messages (id, channel_id, author_id, author_key_id, epoch, iv, ciphertext, signature, reply_to)
      values (s.id, s.channel_id, s.author_id, s.author_key_id, s.epoch, s.iv, s.ciphertext, s.signature, s.reply_to)
      on conflict (id) do nothing;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- Run every minute with pg_cron (turned on here when the database allows it;
-- otherwise: Supabase → Database → Extensions → pg_cron, then run this again).
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then null;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'venband-scheduled-messages';
    perform cron.schedule('venband-scheduled-messages', '* * * * *', 'select public.deliver_scheduled_messages()');
  end if;
exception when others then null;
end $$;

-- ------------------------------------------------------------- realtime ----
do $$
declare t text;
begin
  foreach t in array array['reactions', 'pins', 'threads', 'poll_votes', 'read_states'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception when undefined_object then null; -- no realtime publication (plain Postgres tests)
end $$;

-- ---------------------------------------------------------------- grants ----
grant select, insert, delete         on public.reactions          to authenticated;
grant select, insert, delete         on public.pins               to authenticated;
grant select, insert, delete         on public.saved_messages     to authenticated;
grant select, insert, update, delete on public.read_states        to authenticated;
grant select, insert                 on public.threads            to authenticated;
grant update (name, locked, archived) on public.threads           to authenticated;
grant delete                         on public.threads            to authenticated;
grant select                         on public.message_revisions  to authenticated;
grant select                         on public.deleted_messages   to authenticated;
grant select, insert                 on public.polls              to authenticated;
grant update (expires_at)            on public.polls              to authenticated;
grant select, insert, update, delete on public.poll_votes         to authenticated;
grant select, insert, delete         on public.scheduled_messages to authenticated;
grant update (log_retention_days)    on public.servers            to authenticated;
grant execute on function public.poll_results(uuid) to authenticated;
grant execute on function public.deliver_scheduled_messages() to authenticated;


-- ------------------------------------------------------------ checklist ----
-- Every row should say "ok". Screenshot this table if something says MISSING.
select item, case when ok then 'ok' else 'MISSING' end as status
from (values
  ('read profiles',            has_table_privilege('authenticated', 'public.profiles', 'select')),
  ('read public keys',         has_table_privilege('authenticated', 'public.user_keys', 'select')),
  ('save public key',          has_table_privilege('authenticated', 'public.user_keys', 'insert')),
  ('read private key',         has_table_privilege('authenticated', 'public.user_private_keys', 'select')),
  ('save private key',         has_table_privilege('authenticated', 'public.user_private_keys', 'insert')),
  ('read servers',             has_table_privilege('authenticated', 'public.servers', 'select')),
  ('read channels',            has_table_privilege('authenticated', 'public.channels', 'select')),
  ('send messages',            has_table_privilege('authenticated', 'public.messages', 'insert')),
  ('channel keys',             has_table_privilege('authenticated', 'public.channel_keys', 'insert')),
  ('key epochs',               has_table_privilege('authenticated', 'public.channel_epochs', 'insert')),
  ('function my_profile',      has_function_privilege('authenticated', 'public.my_profile()', 'execute')),
  ('function create_server',   has_function_privilege('authenticated', 'public.create_server(text,text)', 'execute')),
  ('function open_dm',         has_function_privilege('authenticated', 'public.open_dm(uuid)', 'execute')),
  ('function create_group',    has_function_privilege('authenticated', 'public.create_group(uuid[],text)', 'execute')),
  ('function realtime access', has_function_privilege('authenticated', 'public.realtime_topic_allowed(text)', 'execute')),
  ('signup username check',    has_function_privilege('anon', 'public.username_available(text)', 'execute')),
  ('schema usage',             has_schema_privilege('authenticated', 'public', 'usage')),
  ('friends',                  has_table_privilege('authenticated', 'public.friendships', 'select')),
  ('synced settings',          has_table_privilege('authenticated', 'public.user_settings', 'insert')),
  ('theme marketplace',        has_table_privilege('authenticated', 'public.themes', 'insert')),
  ('function discovery',       has_function_privilege('authenticated', 'public.discover_servers(text)', 'execute')),
  ('function moderation',      has_function_privilege('authenticated', 'public.mod_search(text)', 'execute')),
  ('function devices',         has_function_privilege('authenticated', 'public.my_devices()', 'execute')),
  ('signup limit hook',        has_function_privilege('supabase_auth_admin', 'public.before_user_created(jsonb)', 'execute')),
  ('staff columns locked',     not has_column_privilege('authenticated', 'public.profiles', 'badges', 'update')),
  ('reports',                  has_table_privilege('authenticated', 'public.reports', 'insert')),
  ('message requests',         has_function_privilege('authenticated', 'public.accept_message_request(uuid)', 'execute')),
  ('server pictures bucket',   exists (select 1 from storage.buckets where id = 'server-assets' and public)),
  ('owner = account "sl"',     exists (select 1 from public.profiles where platform_role = 'owner')),
  ('reactions',                has_table_privilege('authenticated', 'public.reactions', 'insert')),
  ('threads',                  has_table_privilege('authenticated', 'public.threads', 'insert')),
  ('pins',                     has_table_privilege('authenticated', 'public.pins', 'insert')),
  ('saved messages',           has_table_privilege('authenticated', 'public.saved_messages', 'insert')),
  ('polls',                    has_function_privilege('authenticated', 'public.poll_results(uuid)', 'execute')),
  ('scheduled messages',       has_table_privilege('authenticated', 'public.scheduled_messages', 'insert')),
  ('scheduled delivery job',   exists (select 1 from pg_extension where extname = 'pg_cron'))
) as t(item, ok);
