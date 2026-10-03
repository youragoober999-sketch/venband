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
