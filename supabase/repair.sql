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

-- -----------------------------------------------------------------------------
-- Channel / category permission overwrites. Admins (MANAGE_CHANNELS = 8) can pin
-- per-role or per-member allow/deny bits onto a single channel or onto a whole
-- category. Channel overwrites layer on top of category overwrites, which layer
-- on top of server-wide role permissions. Visibility still follows is_private +
-- channel_role_access (can_view_channel); overwrites gate the *actions* a user
-- can take in a channel.
-- -----------------------------------------------------------------------------
create table if not exists public.channel_overwrites (
  id           uuid primary key default gen_random_uuid(),
  server_id    uuid not null references public.servers (id) on delete cascade,
  channel_id   uuid references public.channels (id) on delete cascade,
  category     text check (category is null or char_length(category) <= 100),
  target_type  text not null check (target_type in ('role', 'member')),
  target_id    uuid not null,
  allow        bigint not null default 0,
  deny         bigint not null default 0,
  created_at   timestamptz not null default now(),
  check (channel_id is not null or category is not null)
);

create unique index if not exists channel_overwrites_uniq
  on public.channel_overwrites (coalesce(channel_id, '00000000-0000-0000-0000-000000000000'),
                                coalesce(category, ''), target_type, target_id);
create index if not exists channel_overwrites_server_idx on public.channel_overwrites (server_id);
create index if not exists channel_overwrites_channel_idx on public.channel_overwrites (channel_id, server_id);

alter table public.channel_overwrites enable row level security;

-- Members can see overwrites for channels they can view (or anything in a server
-- they belong to when the row targets a category).
drop policy if exists cow_select on public.channel_overwrites;
create policy cow_select on public.channel_overwrites for select to authenticated
  using (
    channel_id is not null and public.can_view_channel(channel_id)
    or (channel_id is null and public.is_server_member(server_id))
  );

drop policy if exists cow_insert on public.channel_overwrites;
create policy cow_insert on public.channel_overwrites for insert to authenticated
  with check (public.has_permission(server_id, 8));

drop policy if exists cow_update on public.channel_overwrites;
create policy cow_update on public.channel_overwrites for update to authenticated
  using (public.has_permission(server_id, 8))
  with check (public.has_permission(server_id, 8));

drop policy if exists cow_delete on public.channel_overwrites;
create policy cow_delete on public.channel_overwrites for delete to authenticated
  using (public.has_permission(server_id, 8));

-- Effective permissions for one user in one channel. Base = server-wide roles,
-- then category overwrites, then channel overwrites. Overwrites for roles apply
-- in role.position order; the member's own overwrite (if any) is applied last so
-- it always wins for that person, like in the real thing. Owners and
-- ADMINISTRATOR still get everything.
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

-- Redefine the existing helper so action gating accounts for overwrites while
-- keeping the "must be able to see the channel first" and "DMs are open" rules.
create or replace function public.channel_has_permission(p_channel uuid, p_perm bigint, p_user uuid default auth.uid())
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_server uuid;
begin
  if not public.can_view_channel(p_channel, p_user) then return false; end if;
  select server_id into v_server from public.channels where id = p_channel;
  if v_server is null then return true; end if;
  return (public.channel_perm_for_user(p_channel, p_user) & p_perm) = p_perm;
end;
$$;

-- ------------------------------------------------------------- realtime ----
do $$
declare t text;
begin
  foreach t in array array['channel_overwrites'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- --------------------------------------------------------------- grants ----
grant select, insert, update, delete on public.channel_overwrites to authenticated;
grant execute on function public.channel_perm_for_user(uuid, uuid), public.channel_has_permission(uuid, bigint, uuid)
  to authenticated;

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


-- ========================== server features (20261005000000_servers.sql)
-- =============================================================================
-- Servers: templates, more channel types (forum, announcement, stage),
-- reordering, invites (pause, account-age, analytics), vanity links, invite
-- previews, discovery applications, custom emoji / GIFs / stickers / sounds,
-- server themes, welcome screen, rules and onboarding, role looks.
-- Safe to run more than once (it is also part of supabase/repair.sql).
-- =============================================================================

-- ------------------------------------------------------------- channels ----
alter table public.channels drop constraint if exists channels_type_check;
alter table public.channels add constraint channels_type_check
  check (type in ('text', 'voice', 'dm', 'forum', 'announcement', 'stage'));
-- type-specific options: voice/stage { bitrate, user_limit, video }, forum { tags, sort, guidelines }
alter table public.channels add column if not exists settings jsonb not null default '{}'::jsonb;
alter table public.channels add column if not exists color text;
do $$ begin
  alter table public.channels add constraint channels_settings_size check (pg_column_size(settings) < 4000);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.channels add constraint channels_color_hex check (color is null or color ~ '^#[0-9a-fA-F]{6}$');
exception when duplicate_object then null; end $$;

drop policy if exists channels_insert on public.channels;
create policy channels_insert on public.channels for insert to authenticated
  with check (server_id is not null and type in ('text', 'voice', 'forum', 'announcement', 'stage')
              and public.has_permission(server_id, 8));

-- Announcement channels: everyone reads, only people with Manage Messages post.
create or replace function public.check_announcement_post()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.thread_root is null
     and exists (select 1 from public.channels c where c.id = new.channel_id and c.type = 'announcement')
     and not public.channel_has_permission(new.channel_id, 256, new.author_id) then
    raise exception 'only moderators can post in announcement channels';
  end if;
  return new;
end;
$$;
drop trigger if exists messages_announcement_check on public.messages;
create trigger messages_announcement_check before insert on public.messages
  for each row execute function public.check_announcement_post();

-- Forum posts are threads with tags / pins / solved.
alter table public.threads add column if not exists tags text[] not null default '{}';
alter table public.threads add column if not exists pinned boolean not null default false;
alter table public.threads add column if not exists solved boolean not null default false;
do $$ begin
  alter table public.threads add constraint threads_tags_sane check (cardinality(tags) <= 5);
exception when duplicate_object then null; end $$;

-- Stage channels: who's on stage, who raised a hand.
create table if not exists public.stage_members (
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  state      text not null check (state in ('speaker', 'requested', 'invited')),
  updated_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);
alter table public.stage_members enable row level security;
drop policy if exists stage_members_select on public.stage_members;
create policy stage_members_select on public.stage_members for select to authenticated
  using (public.can_view_channel(channel_id));
-- raise your hand (Request to Speak) or accept an invitation; moderators manage everyone
drop policy if exists stage_members_insert on public.stage_members;
create policy stage_members_insert on public.stage_members for insert to authenticated
  with check (
    (user_id = auth.uid() and state = 'requested' and public.channel_has_permission(channel_id, 1073741824))
    or public.channel_has_permission(channel_id, 33554432)  -- Mute Members = stage moderator
  );
drop policy if exists stage_members_update on public.stage_members;
create policy stage_members_update on public.stage_members for update to authenticated
  using (user_id = auth.uid() or public.channel_has_permission(channel_id, 33554432))
  with check (public.channel_has_permission(channel_id, 33554432)
              or (user_id = auth.uid() and state = 'speaker'
                  and exists (select 1 from public.stage_members s where s.channel_id = stage_members.channel_id
                              and s.user_id = auth.uid() and s.state = 'invited')));
drop policy if exists stage_members_delete on public.stage_members;
create policy stage_members_delete on public.stage_members for delete to authenticated
  using (user_id = auth.uid() or public.channel_has_permission(channel_id, 33554432));

-- Reorder channels (and move them between categories) in one go.
create or replace function public.reorder_channels(p_server uuid, p_items jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare it jsonb;
begin
  if not public.has_permission(p_server, 8) then raise exception 'you need Manage Channels'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'too many'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    update public.channels
       set position = (it ->> 'position')::int,
           category = left(coalesce(it ->> 'category', category), 100)
     where id = (it ->> 'id')::uuid and server_id = p_server;
  end loop;
end;
$$;

-- --------------------------------------------------------------- roles ----
alter table public.roles add column if not exists icon text;          -- emoji or image URL
alter table public.roles add column if not exists color2 text;        -- gradient end
alter table public.roles add column if not exists description text not null default '';
alter table public.roles add column if not exists mentionable boolean not null default true;
do $$ begin
  alter table public.roles add constraint roles_color2_hex check (color2 is null or color2 ~ '^#[0-9a-fA-F]{6}$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.roles add constraint roles_extras_sane check (char_length(description) <= 300 and (icon is null or char_length(icon) <= 300));
exception when duplicate_object then null; end $$;

-- Drag roles into a new order. Only roles below your own top role can move,
-- and they stay below it.
create or replace function public.reorder_roles(p_server uuid, p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_top integer := public.member_top_position(p_server);
  v_n integer := cardinality(p_ids);
  i integer;
begin
  if not public.has_permission(p_server, 4) then raise exception 'you need Manage Roles'; end if;
  if exists (select 1 from public.roles r where r.id = any (p_ids) and (r.server_id <> p_server or r.is_default or r.position >= v_top)) then
    raise exception 'you can only move roles below your highest role';
  end if;
  -- p_ids is top-to-bottom; give them positions under v_top
  for i in 1..v_n loop
    update public.roles set position = least(v_top - 1, v_n - i + 1) where id = p_ids[i];
  end loop;
end;
$$;

-- -------------------------------------------------------------- servers ----
alter table public.servers
  add column if not exists vanity          text unique check (vanity ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'),
  add column if not exists theme           jsonb not null default '{}'::jsonb,
  add column if not exists welcome         jsonb not null default '{}'::jsonb,   -- { message, buttons: [{label, channel_id, emoji}] }
  add column if not exists rules           text[] not null default '{}',
  add column if not exists onboarding      jsonb not null default '{}'::jsonb,   -- { questions: [{title, options: [{label, role_ids}]}] }
  add column if not exists verification    jsonb not null default '{}'::jsonb,   -- { level: none|email|account_age|voogle, min_account_days }
  add column if not exists join_mode       text not null default 'invite'
                                           check (join_mode in ('open', 'invite', 'discovery', 'private')),
  add column if not exists joins_paused    boolean not null default false,
  add column if not exists public_preview  boolean not null default true,
  add column if not exists language        text not null default 'en' check (char_length(language) <= 10),
  add column if not exists category_tags   text[] not null default '{}',
  add column if not exists discovery_status text not null default 'none'
                                           check (discovery_status in ('none', 'pending', 'approved', 'rejected'));
do $$ begin
  alter table public.servers add constraint servers_jsonb_sizes check (
    pg_column_size(theme) < 6000 and pg_column_size(welcome) < 6000 and pg_column_size(onboarding) < 12000
    and pg_column_size(verification) < 1000 and cardinality(rules) <= 25 and cardinality(category_tags) <= 8);
exception when duplicate_object then null; end $$;

-- vanity links and discovery decisions only change through the functions below
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
    if new.discovery_status is distinct from old.discovery_status
       and not (new.discovery_status = 'pending' and old.discovery_status in ('none', 'rejected')) then
      raise exception 'only Venband staff can approve discovery';
    end if;
    if new.vanity is distinct from old.vanity and current_setting('venband.vanity', true) is distinct from 'on' then
      raise exception 'use set_vanity to change the custom link';
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
                     and c.server_id = new.id and c.type in ('text', 'announcement')) then
    raise exception 'welcome channel must be a text channel in this server';
  end if;
  return new;
end;
$$;

-- Custom link (venband.com/invite/NAME): verified servers or 500+ members.
-- Words that could impersonate Venband are reserved.
create or replace function public.set_vanity(p_server uuid, p_vanity text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v text := lower(btrim(coalesce(p_vanity, '')));
begin
  if not public.has_permission(p_server, 2) then raise exception 'you need Manage Server'; end if;
  if v = '' then
    perform set_config('venband.vanity', 'on', true);
    update public.servers set vanity = null where id = p_server;
    perform set_config('venband.vanity', 'off', true);
    return null;
  end if;
  if not (public.is_staff() or (select owner_id from public.servers where id = p_server) = auth.uid())
     and not exists (select 1 from public.servers s where s.id = p_server and (s.verified or public.member_count(s.id) >= 500)) then
    raise exception 'custom links are for verified servers or servers with 500+ members';
  end if;
  if v !~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$' then raise exception 'use 3-32 letters, numbers or dashes'; end if;
  -- Impersonation guard. Generic words are reserved for everyone. Brand names
  -- (venband, voogle) are reserved too, unless you're Venband staff, you own the
  -- server you manage, or its name starts with the word, so the real Venband
  -- server can claim venband.gg/venband.
  if not (public.is_staff()
          or (select owner_id from public.servers where id = p_server) = auth.uid()
          or (select lower(name) from public.servers where id = p_server) like v || '%') then
    if v ~ '(venband|voogle)' or v in ('admin', 'staff', 'support', 'official', 'moderator', 'security', 'system', 'help') then
      raise exception 'that link is reserved';
    end if;
  end if;
  if exists (select 1 from public.servers where vanity = v and id <> p_server) then raise exception 'that link is taken'; end if;
  perform set_config('venband.vanity', 'on', true);
  update public.servers set vanity = v where id = p_server;
  perform set_config('venband.vanity', 'off', true);
  return v;
end;
$$;

-- ------------------------------------------------------------- invites ----
alter table public.invites add column if not exists paused boolean not null default false;
alter table public.invites add column if not exists min_account_days integer not null default 0 check (min_account_days between 0 and 3650);
alter table public.invites add column if not exists require_verified_email boolean not null default false;
alter table public.invites add column if not exists label text check (char_length(label) <= 60);

create table if not exists public.invite_uses (
  code      text not null,
  server_id uuid not null references public.servers (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  used_at   timestamptz not null default now()
);
create index if not exists invite_uses_server_idx on public.invite_uses (server_id, used_at desc);
alter table public.invite_uses enable row level security;
drop policy if exists invite_uses_select on public.invite_uses;
create policy invite_uses_select on public.invite_uses for select to authenticated
  using (public.has_permission(server_id, 2));

drop policy if exists invites_update on public.invites;
create policy invites_update on public.invites for update to authenticated
  using (public.has_permission(server_id, 2) or created_by = auth.uid())
  with check (public.has_permission(server_id, 2) or created_by = auth.uid());

drop function if exists public.create_invite(uuid, integer, numeric, integer, text);
create function public.create_invite(p_server uuid, p_max_uses integer, p_expires_in_hours numeric,
                                                p_min_account_days integer, p_label text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
begin
  if not public.has_permission(p_server, 64) then raise exception 'missing permission'; end if;
  if (select count(*) from public.invites where server_id = p_server) >= 1000 then raise exception 'too many invites'; end if;
  v_code := translate(encode(extensions.gen_random_bytes(9), 'base64'), '+/=', 'xyz');
  insert into public.invites (code, server_id, created_by, max_uses, expires_at, min_account_days, label)
  values (v_code, p_server, auth.uid(), p_max_uses,
          case when p_expires_in_hours is null then null else now() + make_interval(secs => p_expires_in_hours * 3600) end,
          greatest(0, coalesce(p_min_account_days, 0)), nullif(btrim(coalesce(p_label, '')), ''));
  return v_code;
end;
$$;

-- Join by invite code or custom link.
create or replace function public.join_server(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  inv public.invites%rowtype;
  v_server uuid;
  s public.servers%rowtype;
  v_age interval;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public.account_can('join') then raise exception 'your account can''t join servers right now'; end if;
  select * into inv from public.invites where code = p_code for update;
  if found then
    if (inv.expires_at is not null and inv.expires_at < now()) or (inv.max_uses is not null and inv.uses >= inv.max_uses) then
      raise exception 'this invite has expired';
    end if;
    if inv.paused then raise exception 'this invite is paused right now'; end if;
    v_server := inv.server_id;
  else
    select id into v_server from public.servers where vanity = lower(p_code);
    if v_server is null then raise exception 'invalid or expired invite'; end if;
  end if;
  select * into s from public.servers where id = v_server;
  if s.status <> 'active' then raise exception 'this server is not available right now'; end if;
  if exists (select 1 from public.bans where server_id = v_server and user_id = v_uid) then
    raise exception 'you are banned from this server';
  end if;
  if public.is_server_member(v_server, v_uid) then return v_server; end if;
  if s.joins_paused then raise exception 'this server isn''t accepting new members right now'; end if;
  select now() - created_at into v_age from public.profiles where id = v_uid;
  if inv.code is not null and inv.min_account_days > 0 and v_age < make_interval(days => inv.min_account_days) then
    raise exception 'your account must be at least % days old to use this invite', inv.min_account_days;
  end if;
  if coalesce((s.verification ->> 'min_account_days')::int, 0) > 0
     and v_age < make_interval(days => (s.verification ->> 'min_account_days')::int) then
    raise exception 'this server requires accounts at least % days old', (s.verification ->> 'min_account_days');
  end if;
  insert into public.server_members (server_id, user_id) values (v_server, v_uid);
  if inv.code is not null then update public.invites set uses = uses + 1 where code = inv.code; end if;
  insert into public.invite_uses (code, server_id, user_id) values (coalesce(inv.code, 'vanity:' || s.vanity), v_server, v_uid);
  return v_server;
end;
$$;

-- What an invite link shows before you join (works when signed out unless the
-- server turned previews off). Never reveals private channels or members.
create or replace function public.invite_preview(p_code text)
returns table (server_id uuid, name text, description text, icon_url text, banner_url text, icon_color text, banner_color text,
               verified boolean, members integer, channels text[], rules text[], vanity text, expires_at timestamptz, joined boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_server uuid;
  v_exp timestamptz;
begin
  select i.server_id, i.expires_at into v_server, v_exp from public.invites i
   where i.code = p_code and (i.expires_at is null or i.expires_at > now()) and (i.max_uses is null or i.uses < i.max_uses) and not i.paused;
  if v_server is null then select s.id into v_server from public.servers s where s.vanity = lower(p_code); end if;
  if v_server is null then return; end if;
  return query
    select s.id, s.name, s.description, s.icon_url, s.banner_url, s.icon_color, s.banner_color, s.verified,
           public.member_count(s.id),
           array(select c.name from public.channels c where c.server_id = s.id and not c.is_private and c.type <> 'dm'
                 order by c.position limit 12),
           case when auth.uid() is null then s.rules[1:3] else s.rules end,
           s.vanity, v_exp, coalesce(public.is_server_member(s.id), false)
      from public.servers s
     where s.id = v_server and s.status = 'active' and (s.public_preview or auth.uid() is not null);
end;
$$;

-- Preview a discoverable / applying server without joining (staff can preview any).
create or replace function public.server_preview(p_server uuid)
returns table (id uuid, name text, description text, icon_url text, banner_url text, icon_color text, banner_color text,
               verified boolean, members integer, channels jsonb, rules text[], tag text, discovery_status text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  return query
    select s.id, s.name, s.description, s.icon_url, s.banner_url, s.icon_color, s.banner_color, s.verified,
           public.member_count(s.id),
           coalesce((select jsonb_agg(jsonb_build_object('name', c.name, 'type', c.type, 'category', c.category, 'topic', c.topic) order by c.position)
                     from public.channels c where c.server_id = s.id and not c.is_private), '[]'::jsonb),
           s.rules, s.tag, s.discovery_status
      from public.servers s
     where s.id = p_server and s.status = 'active'
       and (s.discoverable and (s.verified or s.discovery_status = 'approved' or public.member_count(s.id) >= 1000)
            or s.join_mode = 'open' or public.is_server_member(s.id) or public.platform_rank() >= 1
            or exists (select 1 from public.profiles p where p.id = auth.uid() and p.tag_server_id = s.id));
end;
$$;

-- Join from a server tag you saw on someone's profile, if the server allows it.
create or replace function public.join_open_server(p_server uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.servers%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.account_can('join') then raise exception 'your account can''t join servers right now'; end if;
  select * into s from public.servers where id = p_server;
  if not found or s.status <> 'active' then raise exception 'server not found'; end if;
  if public.is_server_member(p_server) then return p_server; end if;
  if s.joins_paused then raise exception 'this server isn''t accepting new members right now'; end if;
  if not (s.join_mode = 'open' or (s.discoverable and (s.verified or s.discovery_status = 'approved'))) then
    raise exception 'this server is invite-only';
  end if;
  if exists (select 1 from public.bans where server_id = p_server and user_id = auth.uid()) then raise exception 'you are banned from this server'; end if;
  insert into public.server_members (server_id, user_id) values (p_server, auth.uid());
  return p_server;
end;
$$;

-- ------------------------------------------------- discovery applications --
create table if not exists public.discovery_applications (
  id          uuid primary key default gen_random_uuid(),
  server_id   uuid not null references public.servers (id) on delete cascade,
  applicant   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  pitch       text not null default '' check (char_length(pitch) <= 1000),
  categories  text[] not null default '{}' check (cardinality(categories) <= 5),
  language    text not null default 'en',
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewer    uuid references public.profiles (id) on delete set null,
  note        text check (char_length(note) <= 500),
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists discovery_applications_status_idx on public.discovery_applications (status, created_at desc);
alter table public.discovery_applications enable row level security;
drop policy if exists discovery_apps_select on public.discovery_applications;
create policy discovery_apps_select on public.discovery_applications for select to authenticated
  using (public.has_permission(server_id, 2) or public.platform_rank() >= 1);

create or replace function public.apply_for_discovery(p_server uuid, p_pitch text, p_categories text[] default '{}', p_language text default 'en')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.has_permission(p_server, 2) then raise exception 'you need Manage Server'; end if;
  if exists (select 1 from public.discovery_applications where server_id = p_server and status = 'pending') then
    raise exception 'this server already has an application waiting';
  end if;
  if (select count(*) from public.discovery_applications where server_id = p_server and created_at > now() - interval '7 days') >= 3 then
    raise exception 'please wait a few days before applying again';
  end if;
  insert into public.discovery_applications (server_id, pitch, categories, language)
  values (p_server, left(coalesce(p_pitch, ''), 1000), coalesce(p_categories[1:5], '{}'), left(coalesce(p_language, 'en'), 10))
  returning id into v_id;
  update public.servers set discovery_status = 'pending', category_tags = coalesce(p_categories[1:5], '{}'), language = left(coalesce(p_language, 'en'), 10)
   where id = p_server;
  return v_id;
end;
$$;

-- Staff review queue with filters (size, verified, status, search).
create or replace function public.discovery_queue(p_status text default 'pending', p_min_members integer default null,
                                                  p_max_members integer default null, p_query text default '')
returns table (id uuid, server_id uuid, name text, description text, icon_url text, icon_color text, verified boolean,
               members integer, pitch text, categories text[], language text, status text, created_at timestamptz, note text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.platform_rank() < 1 then raise exception 'staff only'; end if;
  return query
    select * from (
      select a.id, s.id, s.name, s.description, s.icon_url, s.icon_color, s.verified, public.member_count(s.id) as members,
             a.pitch, a.categories, a.language, a.status, a.created_at, a.note
        from public.discovery_applications a join public.servers s on s.id = a.server_id
       where (p_status is null or p_status = '' or a.status = p_status)
         and (coalesce(p_query, '') = '' or s.name ilike '%' || p_query || '%' or a.pitch ilike '%' || p_query || '%')
    ) x
    where (p_min_members is null or x.members >= p_min_members)
      and (p_max_members is null or x.members < p_max_members)
    order by x.created_at desc
    limit 200;
end;
$$;

create or replace function public.review_discovery(p_application uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.discovery_applications%rowtype;
begin
  if public.platform_rank() < 1 then raise exception 'staff only'; end if;
  select * into a from public.discovery_applications where id = p_application for update;
  if not found then raise exception 'application not found'; end if;
  update public.discovery_applications
     set status = case when p_approve then 'approved' else 'rejected' end, reviewer = auth.uid(),
         note = left(p_note, 500), reviewed_at = now()
   where id = p_application;
  perform set_config('venband.mod', 'on', true);
  update public.servers set discovery_status = case when p_approve then 'approved' else 'rejected' end,
                            discoverable = case when p_approve then true else discoverable end
   where id = a.server_id;
  perform set_config('venband.mod', 'off', true);
  insert into public.mod_actions (actor_id, action, target_server, reason)
  values (auth.uid(), case when p_approve then 'discovery_approved' else 'discovery_rejected' end, a.server_id, coalesce(left(p_note, 500), ''));
end;
$$;

-- Discovery lists approved and verified servers (and big ones), newest sections too.
drop function if exists public.discover_servers(text);
create function public.discover_servers(p_query text default '')
returns table (id uuid, name text, description text, icon_color text, banner_color text,
               tag text, verified boolean, members integer, joined boolean, icon_url text, banner_url text,
               categories text[], language text, created_at timestamptz, vanity text)
language sql stable security definer set search_path = '' as $$
  select * from (
    select s.id, s.name, s.description, s.icon_color, s.banner_color, s.tag, s.verified,
           public.member_count(s.id) as members, public.is_server_member(s.id) as joined, s.icon_url, s.banner_url,
           s.category_tags, s.language, s.created_at, s.vanity
    from public.servers s
    where auth.uid() is not null and s.status = 'active' and s.discoverable
      and (coalesce(p_query, '') = '' or s.name ilike '%' || p_query || '%' or s.description ilike '%' || p_query || '%'
           or exists (select 1 from unnest(s.category_tags) t where t ilike p_query))
      and (s.verified or s.discovery_status = 'approved' or public.member_count(s.id) >= 1000)
  ) x
  order by x.verified desc, x.members desc
  limit 100;
$$;

-- ------------------------------------------------ server emoji, GIFs, sounds --
create table if not exists public.server_expressions (
  id          uuid primary key default gen_random_uuid(),
  server_id   uuid not null references public.servers (id) on delete cascade,
  kind        text not null check (kind in ('emoji', 'gif', 'sticker', 'sound')),
  name        text not null check (name ~ '^[A-Za-z0-9_]{2,32}$'),
  aliases     text[] not null default '{}' check (cardinality(aliases) <= 5),
  url         text not null check (char_length(url) <= 500),
  mime        text not null check (char_length(mime) <= 60),
  size        integer not null check (size > 0 and size <= 2097152),
  duration_ms integer check (duration_ms is null or duration_ms between 1 and 10000),
  emoji       text check (char_length(emoji) <= 16),               -- sounds: an emoji label
  volume      real not null default 1 check (volume between 0 and 1),
  created_by  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (server_id, kind, name)
);
create index if not exists server_expressions_server_idx on public.server_expressions (server_id, kind);
alter table public.server_expressions enable row level security;
create or replace function public.expression_count(p_server uuid, p_kind text)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.server_expressions where server_id = p_server and kind = p_kind;
$$;


-- members can use them anywhere on Venband while they're in the server
drop policy if exists expressions_select on public.server_expressions;
create policy expressions_select on public.server_expressions for select to authenticated
  using (public.is_server_member(server_id));
drop policy if exists expressions_write on public.server_expressions;
create policy expressions_write on public.server_expressions for insert to authenticated
  with check (created_by = auth.uid() and public.has_permission(server_id, 1048576)
              and (kind <> 'sound' or duration_ms is not null)
              and public.expression_count(server_id, kind) < case kind when 'emoji' then 250 when 'sound' then 48 else 100 end);
drop policy if exists expressions_update on public.server_expressions;
create policy expressions_update on public.server_expressions for update to authenticated
  using (public.has_permission(server_id, 1048576)) with check (public.has_permission(server_id, 1048576));
drop policy if exists expressions_delete on public.server_expressions;
create policy expressions_delete on public.server_expressions for delete to authenticated
  using (public.has_permission(server_id, 1048576));

-- Emoji / GIFs / stickers / sounds from every server I'm in (for pickers).
create or replace function public.my_expressions()
returns table (id uuid, server_id uuid, server_name text, kind text, name text, aliases text[], url text, mime text,
               duration_ms integer, emoji text, volume real)
language sql stable security definer set search_path = '' as $$
  select e.id, e.server_id, s.name, e.kind, e.name, e.aliases, e.url, e.mime, e.duration_ms, e.emoji, e.volume
    from public.server_expressions e
    join public.server_members m on m.server_id = e.server_id and m.user_id = auth.uid()
    join public.servers s on s.id = e.server_id and s.status = 'active'
   order by s.name, e.kind, e.name
   limit 2000;
$$;

-- Images go into the public server-assets bucket under <server>/expr/.
create or replace function public.can_manage_server_asset(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_first text := split_part(p_name, '/', 1);
begin
  if v_first !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  if split_part(p_name, '/', 2) = 'expr' then return public.has_permission(v_first::uuid, 1048576); end if;
  return public.has_permission(v_first::uuid, 2);
end;
$$;
do $$ begin
  update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif',
    'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/mp4', 'audio/aac'], file_size_limit = 8388608
   where id = 'server-assets';
exception when undefined_column then null;
end $$;

-- ------------------------------------------------- rules + onboarding ----
create table if not exists public.member_onboarding (
  server_id         uuid not null references public.servers (id) on delete cascade,
  user_id           uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  rules_accepted_at timestamptz,
  answers           jsonb not null default '{}'::jsonb check (pg_column_size(answers) < 2000),
  completed_at      timestamptz,
  primary key (server_id, user_id)
);
alter table public.member_onboarding enable row level security;
drop policy if exists member_onboarding_own on public.member_onboarding;
create policy member_onboarding_own on public.member_onboarding for select to authenticated
  using (user_id = auth.uid() or public.has_permission(server_id, 2));

-- Accept the rules and finish onboarding: picked answers grant their roles.
create or replace function public.complete_onboarding(p_server uuid, p_accept_rules boolean, p_answers jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  q jsonb;
  opt jsonb;
  r text;
  v_pick jsonb;
  qi integer := 0;
begin
  if not public.is_server_member(p_server) then raise exception 'join the server first'; end if;
  insert into public.member_onboarding (server_id, user_id, rules_accepted_at, answers, completed_at)
  values (p_server, auth.uid(), case when p_accept_rules then now() end, coalesce(p_answers, '{}'::jsonb), now())
  on conflict (server_id, user_id) do update
    set rules_accepted_at = coalesce(public.member_onboarding.rules_accepted_at, excluded.rules_accepted_at),
        answers = excluded.answers, completed_at = now();
  -- grant roles from the options the member picked (only roles the server owner set up here)
  for q in select * from jsonb_array_elements(coalesce((select onboarding -> 'questions' from public.servers where id = p_server), '[]'::jsonb)) loop
    v_pick := coalesce(p_answers -> qi::text, '[]'::jsonb);
    for opt in select o.v from jsonb_array_elements(coalesce(q -> 'options', '[]'::jsonb)) with ordinality as o(v, n)
               where (o.n - 1)::text in (select jsonb_array_elements_text(v_pick)) loop
      for r in select jsonb_array_elements_text(coalesce(opt -> 'role_ids', '[]'::jsonb)) loop
        if exists (select 1 from public.roles where id = r::uuid and server_id = p_server and not is_default and (permissions & 1) = 0) then
          insert into public.member_roles (server_id, user_id, role_id) values (p_server, auth.uid(), r::uuid) on conflict do nothing;
        end if;
      end loop;
    end loop;
    qi := qi + 1;
  end loop;
end;
$$;

-- Servers with rules: members who haven't accepted them can read but not post.
create or replace function public.server_permissions(p_server uuid, p_user uuid default auth.uid())
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_status text;
  v_rules text[];
  v_perms bigint;
begin
  select owner_id, status, rules into v_owner, v_status, v_rules from public.servers where id = p_server;
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
  if cardinality(v_rules) > 0 and not exists (select 1 from public.member_onboarding o where o.server_id = p_server
                                              and o.user_id = p_user and o.rules_accepted_at is not null) then
    -- read-only until the rules are accepted: no sending, reacting, threads, polls, files, voice talk
    v_perms := v_perms & ~(128 | 4096 | 8192 | 32768 | 65536 | 1024 | 2048 | 524288);
  end if;
  return v_perms;
end;
$$;

-- ------------------------------------------------------------ templates ----
drop function if exists public.create_server(text, text, text);
create function public.create_server(p_name text, p_icon_color text, p_template text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_server uuid;
  v_welcome uuid;
  v_layout jsonb;
  c jsonb;
  i integer := 0;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public.account_can('create') then raise exception 'your account can''t create servers right now'; end if;
  if (select count(*) from public.servers where owner_id = v_uid) >= 100 then
    raise exception 'server limit reached';
  end if;
  insert into public.servers (name, owner_id, icon_color)
  values (btrim(p_name), v_uid, p_icon_color) returning id into v_server;
  insert into public.server_members (server_id, user_id) values (v_server, v_uid);
  insert into public.roles (server_id, name, color, permissions, position, is_default)
  values (v_server, '@everyone', '#99aab5', 128 | 64 | 512 | 1024 | 2048 | 4096 | 8192 | 32768 | 65536 | 131072 | 524288 | 536870912 | 1073741824, 0, true);

  v_layout := case coalesce(p_template, 'default')
    when 'gaming' then '[["Information","text","welcome"],["Information","announcement","announcements"],["Information","text","rules"],
                        ["Text Channels","text","general"],["Text Channels","text","looking-for-group"],["Text Channels","text","clips-and-highlights"],
                        ["Text Channels","forum","game-guides"],["Voice Channels","voice","Lobby"],["Voice Channels","voice","Gaming 1"],
                        ["Voice Channels","voice","Gaming 2"],["Voice Channels","stage","Tournament Stage"]]'
    when 'friends' then '[["Text Channels","text","welcome"],["Text Channels","text","general"],["Text Channels","text","memes"],
                         ["Text Channels","text","photos"],["Text Channels","text","plans"],["Voice Channels","voice","Hangout"],["Voice Channels","voice","Movie Night"]]'
    when 'hangout' then '[["Start Here","text","welcome"],["Start Here","text","introductions"],["Hang Out","text","general"],
                         ["Hang Out","text","music"],["Hang Out","text","pets"],["Hang Out","text","food"],["Voice","voice","Chill Lounge"],
                         ["Voice","voice","Music Room"],["Voice","voice","Study Room"]]'
    when 'school' then '[["Information","text","welcome"],["Information","announcement","announcements"],["Information","text","rules"],
                        ["Club","text","general"],["Club","text","homework-help"],["Club","text","resources"],["Club","forum","questions"],
                        ["Club","text","events"],["Voice","voice","Study Hall"],["Voice","stage","Club Meeting"]]'
    when 'community' then '[["Information","text","welcome"],["Information","announcement","announcements"],["Information","text","rules"],
                           ["Community","text","general"],["Community","text","local-news"],["Community","text","events"],
                           ["Community","text","marketplace"],["Community","forum","suggestions"],["Voice","voice","Town Square"],["Voice","stage","Town Hall"]]'
    when 'creators' then '[["Information","text","welcome"],["Information","announcement","announcements"],["Information","text","rules"],
                          ["Show & Tell","text","showcase"],["Show & Tell","text","work-in-progress"],["Show & Tell","forum","feedback"],
                          ["Show & Tell","text","commissions"],["Community","text","general"],["Community","text","resources"],
                          ["Voice","voice","Studio"],["Voice","stage","Live Workshop"]]'
    else '[["Information","text","welcome"],["Text Channels","text","chat"],["Voice Channels","voice","General"]]'
  end;
  for c in select * from jsonb_array_elements(v_layout) loop
    insert into public.channels (server_id, category, type, name, position, topic)
    values (v_server, c ->> 0, c ->> 1, c ->> 2, i,
            case when c ->> 2 = 'welcome' then 'Say hi to new members!' when c ->> 2 = 'rules' then 'Read these before chatting.' else '' end);
    i := i + 1;
  end loop;
  select id into v_welcome from public.channels where server_id = v_server and name = 'welcome' limit 1;
  if v_welcome is not null then
    perform set_config('venband.mod', 'on', true);
    update public.servers set welcome_channel_id = v_welcome where id = v_server;
    perform set_config('venband.mod', 'off', true);
  end if;
  return v_server;
end;
$$;

-- ------------------------------------------------------------- realtime ----
do $$
declare t text;
begin
  foreach t in array array['stage_members', 'server_expressions'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception when undefined_object then null;
end $$;

-- ---------------------------------------------------------------- grants ----
grant update (name, topic, category, position, is_private, settings, color) on public.channels to authenticated;
grant update (tags, pinned, solved) on public.threads to authenticated;
grant select, insert, update, delete on public.stage_members to authenticated;
grant select on public.invite_uses to authenticated;
grant update (paused, label) on public.invites to authenticated;
grant select on public.discovery_applications to authenticated;
grant select, insert, update, delete on public.server_expressions to authenticated;
grant select on public.member_onboarding to authenticated;
-- the older two/three-argument versions stay as wrappers (older apps call them)
create or replace function public.create_server(p_name text, p_icon_color text default '#7c5cff')
returns uuid language sql security definer set search_path = '' as $$
  select public.create_server(p_name, p_icon_color, 'default');
$$;
create or replace function public.create_invite(p_server uuid, p_max_uses integer default null, p_expires_in_hours integer default 24 * 7)
returns text language sql security definer set search_path = '' as $$
  select public.create_invite(p_server, p_max_uses, p_expires_in_hours::numeric, 0, null);
$$;
grant execute on function public.create_server(text, text), public.create_invite(uuid, integer, integer) to authenticated;
grant execute on function
  public.reorder_channels(uuid, jsonb), public.reorder_roles(uuid, uuid[]), public.set_vanity(uuid, text),
  public.create_invite(uuid, integer, numeric, integer, text), public.join_server(text), public.server_preview(uuid),
  public.join_open_server(uuid), public.apply_for_discovery(uuid, text, text[], text), public.discovery_queue(text, integer, integer, text),
  public.review_discovery(uuid, boolean, text), public.discover_servers(text), public.my_expressions(), public.expression_count(uuid, text),
  public.complete_onboarding(uuid, boolean, jsonb), public.create_server(text, text, text)
to authenticated;
grant execute on function public.invite_preview(text) to anon, authenticated;


-- =============================================================================
-- ============ apps, status page, Voogle (20261006000000_apps_status_voogle.sql)
-- =============================================================================
-- Status page incidents, applications (bots) with presets, bot messages,
-- webhooks ("connect a site"), the token-based bot API and Voogle
-- verification.
--
-- Privacy: bots never get message keys, so they can't read end-to-end
-- encrypted messages. What bots post is NOT end-to-end encrypted and the app
-- says so. Voogle keeps only peppered hashes of device / network signals;
-- raw IP addresses are never stored or shown, and lookups only return
-- "99% sure" / "likely" confidence labels.

-- ------------------------------------------------------------ status page ----
create table if not exists public.status_incidents (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(btrim(title)) between 3 and 140),
  severity    text not null default 'minor' check (severity in ('minor', 'major', 'maintenance')),
  status      text not null default 'investigating'
              check (status in ('investigating', 'identified', 'monitoring', 'resolved', 'scheduled')),
  components  text[] not null default '{}' check (cardinality(components) <= 10),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists status_incidents_created_idx on public.status_incidents (created_at desc);

create table if not exists public.status_updates (
  id          uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.status_incidents (id) on delete cascade,
  status      text not null check (status in ('investigating', 'identified', 'monitoring', 'resolved', 'scheduled')),
  body        text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index if not exists status_updates_incident_idx on public.status_updates (incident_id, created_at);

alter table public.status_incidents enable row level security;
alter table public.status_updates enable row level security;
drop policy if exists status_incidents_read on public.status_incidents;
create policy status_incidents_read on public.status_incidents for select to anon, authenticated using (true);
drop policy if exists status_updates_read on public.status_updates;
create policy status_updates_read on public.status_updates for select to anon, authenticated using (true);

-- Staff post incidents and updates; the incident follows its latest update.
create or replace function public.post_status_update(p_incident uuid, p_title text, p_severity text,
                                                     p_status text, p_body text, p_components text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_incident;
begin
  if not public.is_staff() then raise exception 'only Venband staff can post status updates'; end if;
  if v_id is null then
    insert into public.status_incidents (title, severity, status, components)
    values (btrim(p_title), coalesce(p_severity, 'minor'), p_status, coalesce(p_components, '{}'))
    returning id into v_id;
  else
    update public.status_incidents
    set status = p_status, updated_at = now(),
        title = coalesce(nullif(btrim(coalesce(p_title, '')), ''), title),
        severity = coalesce(p_severity, severity),
        components = coalesce(p_components, components),
        resolved_at = case when p_status = 'resolved' then now() else null end
    where id = v_id;
    if not found then raise exception 'incident not found'; end if;
  end if;
  insert into public.status_updates (incident_id, status, body) values (v_id, p_status, btrim(p_body));
  return v_id;
end;
$$;

create or replace function public.delete_status_incident(p_incident uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'only Venband staff can do that'; end if;
  delete from public.status_incidents where id = p_incident;
end;
$$;

-- A cheap call the status page uses to see that the database answers.
create or replace function public.status_ping()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'time', now());
$$;

-- Discovery that works signed out (public page at /discovery).
create or replace function public.public_discover(p_query text default '', p_category text default null)
returns table (id uuid, name text, description text, icon_color text, icon_url text, banner_url text, banner_color text,
               verified boolean, members integer, categories text[], vanity text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.id, s.name, s.description, s.icon_color, s.icon_url, s.banner_url, s.banner_color, s.verified,
         public.member_count(s.id), s.category_tags, s.vanity, s.created_at
  from public.servers s
  where s.status = 'active' and s.public_preview and s.discoverable
    and (s.verified or s.discovery_status = 'approved' or public.member_count(s.id) >= 1000)
    and (coalesce(p_query, '') = '' or s.name ilike '%' || p_query || '%' or s.description ilike '%' || p_query || '%')
    and (p_category is null or p_category = any (s.category_tags))
  order by s.verified desc, public.member_count(s.id) desc
  limit 60;
$$;

-- ----------------------------------------------------------- applications ----
create table if not exists public.applications (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 2 and 32),
  description text not null default '' check (char_length(description) <= 400),
  preset      text not null default 'custom' check (preset in ('custom', 'verification', 'management', 'site')),
  icon_url    text check (icon_url is null or char_length(icon_url) <= 500),
  color       text not null default '#5865f2' check (color ~ '^#[0-9a-fA-F]{6}$'),
  token_hash  text,
  token_hint  text,
  status      text not null default 'active' check (status in ('active', 'disabled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists applications_owner_idx on public.applications (owner_id);

create table if not exists public.application_team (
  app_id   uuid not null references public.applications (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  role     text not null default 'viewer' check (role in ('admin', 'viewer')),
  added_at timestamptz not null default now(),
  primary key (app_id, user_id)
);
create index if not exists application_team_user_idx on public.application_team (user_id);

create table if not exists public.server_bots (
  id              uuid primary key default gen_random_uuid(),
  server_id       uuid not null references public.servers (id) on delete cascade,
  app_id          uuid not null references public.applications (id) on delete cascade,
  added_by        uuid references public.profiles (id) on delete set null,
  settings        jsonb not null default '{}'::jsonb check (pg_column_size(settings) < 6000),
  webhook_hash    text,
  webhook_channel uuid references public.channels (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (server_id, app_id)
);
create index if not exists server_bots_app_idx on public.server_bots (app_id);

create table if not exists public.bot_join_requests (
  id           uuid primary key default gen_random_uuid(),
  server_id    uuid not null references public.servers (id) on delete cascade,
  app_id       uuid not null references public.applications (id) on delete cascade,
  requested_by uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (server_id, app_id)
);

create table if not exists public.bot_messages (
  id             uuid primary key default gen_random_uuid(),
  server_id      uuid not null references public.servers (id) on delete cascade,
  channel_id     uuid not null references public.channels (id) on delete cascade,
  app_id         uuid not null references public.applications (id) on delete cascade,
  username       text check (username is null or char_length(username) between 1 and 32),
  content        text not null default '' check (char_length(content) <= 4000),
  embed          jsonb check (embed is null or pg_column_size(embed) < 6000),
  interaction_id uuid,
  created_at     timestamptz not null default now()
);
create index if not exists bot_messages_channel_idx on public.bot_messages (channel_id, created_at desc);
create index if not exists bot_messages_app_idx on public.bot_messages (app_id, created_at desc);

create table if not exists public.bot_commands (
  app_id      uuid not null references public.applications (id) on delete cascade,
  name        text not null check (name ~ '^[a-z0-9_-]{1,32}$'),
  description text not null default '' check (char_length(description) <= 100),
  primary key (app_id, name)
);

create table if not exists public.bot_interactions (
  id         uuid primary key default gen_random_uuid(),
  app_id     uuid not null references public.applications (id) on delete cascade,
  server_id  uuid not null references public.servers (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  command    text not null,
  args       text not null default '' check (char_length(args) <= 1000),
  handled    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists bot_interactions_app_idx on public.bot_interactions (app_id, created_at);

-- 'owner', 'admin', 'viewer' or null
create or replace function public.app_role(p_app uuid, p_user uuid default auth.uid())
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select 'owner' from public.applications where id = p_app and owner_id = p_user),
    (select role from public.application_team where app_id = p_app and user_id = p_user));
$$;

-- Bots you can see: your own / your team's, and bots in servers you're in.
create or replace function public.can_see_app(p_app uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select public.app_role(p_app, p_user) is not null
      or exists (select 1 from public.server_bots b where b.app_id = p_app and public.is_server_member(b.server_id, p_user))
      or public.is_staff(p_user);
$$;

alter table public.applications enable row level security;
alter table public.application_team enable row level security;
alter table public.server_bots enable row level security;
alter table public.bot_join_requests enable row level security;
alter table public.bot_messages enable row level security;
alter table public.bot_commands enable row level security;
alter table public.bot_interactions enable row level security;

drop policy if exists applications_select on public.applications;
create policy applications_select on public.applications for select to authenticated using (public.can_see_app(id));
drop policy if exists applications_update on public.applications;
create policy applications_update on public.applications for update to authenticated
  using (public.app_role(id) in ('owner', 'admin')) with check (public.app_role(id) in ('owner', 'admin'));
drop policy if exists applications_delete on public.applications;
create policy applications_delete on public.applications for delete to authenticated using (owner_id = auth.uid());

drop policy if exists application_team_select on public.application_team;
create policy application_team_select on public.application_team for select to authenticated
  using (public.app_role(app_id) is not null);

drop policy if exists server_bots_select on public.server_bots;
create policy server_bots_select on public.server_bots for select to authenticated
  using (public.is_server_member(server_id) or public.app_role(app_id) is not null);

drop policy if exists bot_join_requests_select on public.bot_join_requests;
create policy bot_join_requests_select on public.bot_join_requests for select to authenticated
  using (public.has_permission(server_id, 16777216) or requested_by = auth.uid() or public.app_role(app_id) is not null);

drop policy if exists bot_messages_select on public.bot_messages;
create policy bot_messages_select on public.bot_messages for select to authenticated using (public.can_view_channel(channel_id));
drop policy if exists bot_messages_delete on public.bot_messages;
create policy bot_messages_delete on public.bot_messages for delete to authenticated
  using (public.channel_has_permission(channel_id, 256));

drop policy if exists bot_commands_select on public.bot_commands;
create policy bot_commands_select on public.bot_commands for select to authenticated using (public.can_see_app(app_id));

drop policy if exists bot_interactions_select on public.bot_interactions;
create policy bot_interactions_select on public.bot_interactions for select to authenticated using (user_id = auth.uid());

create or replace function public.guard_application_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id or new.owner_id <> old.owner_id or new.created_at <> old.created_at
     or new.preset <> old.preset or new.token_hash is distinct from old.token_hash
     or new.token_hint is distinct from old.token_hint then
    if current_setting('venband.app', true) is distinct from 'on' then raise exception 'immutable column'; end if;
  end if;
  if new.status <> old.status and current_setting('venband.mod', true) is distinct from 'on' then
    raise exception 'only Venband staff can change this';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists applications_guard on public.applications;
create trigger applications_guard before update on public.applications
  for each row execute function public.guard_application_update();

create or replace function public.preset_settings(p_preset text)
returns jsonb language sql immutable set search_path = '' as $$
  select case p_preset
    when 'management' then '{"welcome_text": "Welcome {user} to **{server}**! 👋", "auto_roles": []}'::jsonb
    when 'verification' then '{"required": true, "max_accounts": 3, "block_ban_evasion": true, "min_account_days": 0}'::jsonb
    else '{}'::jsonb end;
$$;

create or replace function public.create_application(p_name text, p_preset text default 'custom')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.account_can('create') then raise exception 'your account can''t create applications right now'; end if;
  if (select count(*) from public.applications where owner_id = auth.uid()) >= 25 then
    raise exception 'you can have up to 25 applications';
  end if;
  insert into public.applications (owner_id, name, preset, description, color)
  values (auth.uid(), btrim(p_name), coalesce(p_preset, 'custom'),
          case p_preset
            when 'verification' then 'Keeps alt accounts and raiders out with Voogle verification.'
            when 'management' then 'Welcomes new members, gives them roles and logs joins and leaves.'
            when 'site' then 'Posts updates from your website or service into a channel.'
            else '' end,
          case p_preset when 'verification' then '#3ba55d' when 'management' then '#5865f2' when 'site' then '#eb459e' else '#7c5cff' end)
  returning id into v_id;
  return v_id;
end;
$$;

-- New bot token, shown once: vb_<app id>_<secret>. Only a hash is kept.
create or replace function public.reset_bot_token(p_app uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_secret text := translate(encode(extensions.gen_random_bytes(30), 'base64'), '+/=', '-_');
begin
  if coalesce(public.app_role(p_app), '') not in ('owner', 'admin') then raise exception 'only the owner or an admin can do that'; end if;
  perform set_config('venband.app', 'on', true);
  update public.applications
  set token_hash = encode(extensions.digest(v_secret, 'sha256'), 'hex'), token_hint = right(v_secret, 4)
  where id = p_app;
  perform set_config('venband.app', 'off', true);
  return 'vb_' || replace(p_app::text, '-', '') || '_' || v_secret;
end;
$$;

create or replace function public.app_add_member(p_app uuid, p_username text, p_role text default 'viewer')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  if coalesce(public.app_role(p_app), '') not in ('owner', 'admin') then raise exception 'only the owner or an admin can add people'; end if;
  if p_role not in ('admin', 'viewer') then raise exception 'unknown role'; end if;
  select id into v_user from public.profiles where username = lower(btrim(p_username));
  if v_user is null then raise exception 'no one has that username'; end if;
  if v_user = (select owner_id from public.applications where id = p_app) then raise exception 'that''s the owner'; end if;
  if (select count(*) from public.application_team where app_id = p_app) >= 25 then raise exception 'team is full'; end if;
  insert into public.application_team (app_id, user_id, role) values (p_app, v_user, p_role)
  on conflict (app_id, user_id) do update set role = excluded.role;
  return v_user;
end;
$$;

create or replace function public.app_remove_member(p_app uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user <> auth.uid() and coalesce(public.app_role(p_app), '') not in ('owner', 'admin') then raise exception 'not allowed'; end if;
  delete from public.application_team where app_id = p_app and user_id = p_user;
end;
$$;

create or replace function public.install_bot(p_server uuid, p_app uuid, p_by uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if (select count(*) from public.server_bots where server_id = p_server) >= 50 then raise exception 'this server has too many bots'; end if;
  insert into public.server_bots (server_id, app_id, added_by, settings)
  values (p_server, p_app, p_by, public.preset_settings((select preset from public.applications where id = p_app)))
  on conflict (server_id, app_id) do nothing
  returning id into v_id;
  delete from public.bot_join_requests where server_id = p_server and app_id = p_app;
  return v_id;
end;
$$;

-- Paste an invite in the bot's dashboard: the bot joins if you can manage
-- integrations there, otherwise the server's admins get a request.
create or replace function public.bot_join_server(p_app uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_server uuid;
  v_code text := btrim(coalesce(p_code, ''));
  inv public.invites%rowtype;
begin
  if coalesce(public.app_role(p_app), '') not in ('owner', 'admin') then raise exception 'only the owner or an admin can add this bot'; end if;
  if (select status from public.applications where id = p_app) <> 'active' then raise exception 'this application is disabled'; end if;
  v_code := regexp_replace(v_code, '^.*/', '');
  select * into inv from public.invites where code = v_code;
  if found then
    if (inv.expires_at is not null and inv.expires_at < now()) or (inv.max_uses is not null and inv.uses >= inv.max_uses) or inv.paused then
      raise exception 'this invite has expired';
    end if;
    v_server := inv.server_id;
  else
    select id into v_server from public.servers where vanity = lower(v_code);
  end if;
  if v_server is null then raise exception 'invalid or expired invite'; end if;
  if (select status from public.servers where id = v_server) <> 'active' then raise exception 'this server is not available right now'; end if;
  if exists (select 1 from public.server_bots where server_id = v_server and app_id = p_app) then
    return jsonb_build_object('status', 'already', 'server_id', v_server);
  end if;
  if public.has_permission(v_server, 16777216) then
    perform public.install_bot(v_server, p_app, auth.uid());
    return jsonb_build_object('status', 'joined', 'server_id', v_server);
  end if;
  insert into public.bot_join_requests (server_id, app_id, requested_by) values (v_server, p_app, auth.uid())
  on conflict (server_id, app_id) do nothing;
  return jsonb_build_object('status', 'requested', 'server_id', v_server);
end;
$$;

create or replace function public.review_bot_request(p_request uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.bot_join_requests%rowtype;
begin
  select * into r from public.bot_join_requests where id = p_request;
  if not found then raise exception 'request not found'; end if;
  if not public.has_permission(r.server_id, 16777216) then raise exception 'you need Manage Integrations'; end if;
  if p_approve then perform public.install_bot(r.server_id, r.app_id, auth.uid()); end if;
  delete from public.bot_join_requests where id = p_request;
end;
$$;

create or replace function public.remove_bot(p_install uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  b public.server_bots%rowtype;
begin
  select * into b from public.server_bots where id = p_install;
  if not found then return; end if;
  if not (public.has_permission(b.server_id, 16777216) or public.app_role(b.app_id) in ('owner', 'admin')) then
    raise exception 'not allowed';
  end if;
  delete from public.server_bots where id = p_install;
end;
$$;

-- Settings a server's admins choose for a bot (welcome text, auto roles, ...).
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
  if not public.has_permission(b.server_id, 16777216) then raise exception 'you need Manage Integrations in this server'; end if;
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
    -- only roles you could give yourself: below your top role and never Administrator
    if not exists (select 1 from public.roles x where x.id = r::uuid and x.server_id = b.server_id and not x.is_default
                   and ((x.permissions & 1) = 0 or (select owner_id from public.servers where id = b.server_id) = auth.uid())
                   and (x.position < public.member_top_position(b.server_id)
                        or (select owner_id from public.servers where id = b.server_id) = auth.uid())) then
      raise exception 'you can''t hand out one of those roles';
    end if;
    roles := roles || to_jsonb(r);
  end loop;
  v := v || jsonb_build_object('auto_roles', roles);
  update public.server_bots set settings = v where id = p_install;
  return v;
end;
$$;

-- "Connect a site": a secret webhook URL that posts into one channel.
create or replace function public.reset_bot_webhook(p_install uuid, p_channel uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  b public.server_bots%rowtype;
  v_secret text := translate(encode(extensions.gen_random_bytes(30), 'base64'), '+/=', '-_');
begin
  select * into b from public.server_bots where id = p_install;
  if not found then raise exception 'bot not found'; end if;
  if not public.has_permission(b.server_id, 16777216) then raise exception 'you need Manage Integrations in this server'; end if;
  if not exists (select 1 from public.channels c where c.id = p_channel and c.server_id = b.server_id
                 and c.type in ('text', 'announcement')) then
    raise exception 'pick a text channel in this server';
  end if;
  update public.server_bots set webhook_hash = encode(extensions.digest(v_secret, 'sha256'), 'hex'), webhook_channel = p_channel
  where id = p_install;
  return v_secret;
end;
$$;

-- Only https links, plain text everywhere else.
create or replace function public.clean_embed(p jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select case when p is null or jsonb_typeof(p) <> 'object' then null else jsonb_strip_nulls(jsonb_build_object(
    'title', left(p ->> 'title', 256),
    'description', left(p ->> 'description', 2000),
    'url', case when p ->> 'url' ~ '^https://[^\s<>"]+$' and char_length(p ->> 'url') <= 500 then p ->> 'url' end,
    'color', case when p ->> 'color' ~ '^#[0-9a-fA-F]{6}$' then p ->> 'color' end,
    'footer', left(p ->> 'footer', 200),
    'fields', (select jsonb_agg(jsonb_build_object('name', left(f ->> 'name', 100), 'value', left(f ->> 'value', 500)))
               from (select f from jsonb_array_elements(case when jsonb_typeof(p -> 'fields') = 'array' then p -> 'fields' else '[]'::jsonb end) f limit 10) x)
  )) end;
$$;

create or replace function public.bot_post(p_app uuid, p_channel uuid, p_content text, p_embed jsonb,
                                           p_username text default null, p_interaction uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_server uuid;
  v_id uuid;
begin
  select server_id into v_server from public.channels where id = p_channel and type in ('text', 'announcement', 'voice');
  if v_server is null then raise exception 'unknown channel'; end if;
  if not exists (select 1 from public.server_bots where server_id = v_server and app_id = p_app) then
    raise exception 'the bot isn''t in that server';
  end if;
  if (select status from public.servers where id = v_server) <> 'active' then raise exception 'server unavailable'; end if;
  if (select count(*) from public.bot_messages where app_id = p_app and created_at > now() - interval '10 seconds') >= 10 then
    raise exception 'slow down: bots can post 10 messages every 10 seconds';
  end if;
  if coalesce(btrim(p_content), '') = '' and public.clean_embed(p_embed) is null then raise exception 'empty message'; end if;
  insert into public.bot_messages (server_id, channel_id, app_id, username, content, embed, interaction_id)
  values (v_server, p_channel, p_app, nullif(left(btrim(coalesce(p_username, '')), 32), ''),
          left(coalesce(p_content, ''), 2000), public.clean_embed(p_embed), p_interaction)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.post_webhook(p_hook uuid, p_secret text, p_content text,
                                               p_username text default null, p_embed jsonb default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  b public.server_bots%rowtype;
begin
  select * into b from public.server_bots where id = p_hook;
  if not found or b.webhook_hash is null or b.webhook_channel is null
     or b.webhook_hash <> encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex') then
    raise exception 'unknown webhook';
  end if;
  if (select status from public.applications where id = b.app_id) <> 'active' then raise exception 'application disabled'; end if;
  return public.bot_post(b.app_id, b.webhook_channel, p_content, p_embed, p_username);
end;
$$;

-- Bots asking to join a server (they aren't members yet, so RLS hides them).
create or replace function public.pending_bot_apps(p_server uuid)
returns table (id uuid, owner_id uuid, name text, description text, preset text, icon_url text, color text,
               token_hint text, status text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.id, a.owner_id, a.name, a.description, a.preset, a.icon_url, a.color, null::text, a.status, a.created_at
  from public.applications a join public.bot_join_requests r on r.app_id = a.id
  where r.server_id = p_server and public.has_permission(p_server, 16777216);
$$;

-- Built-in replies for preset bots; custom bots get the command as an event.
create or replace function public.use_bot_command(p_channel uuid, p_app uuid, p_command text, p_args text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_server uuid;
  a public.applications%rowtype;
  s public.servers%rowtype;
  v_id uuid;
  v_cmd text := lower(btrim(p_command));
begin
  select server_id into v_server from public.channels where id = p_channel;
  if v_server is null or not public.channel_has_permission(p_channel, 128) then raise exception 'you can''t use commands here'; end if;
  select * into a from public.applications where id = p_app;
  if not found or a.status <> 'active' or not exists (select 1 from public.server_bots where server_id = v_server and app_id = p_app) then
    raise exception 'that bot isn''t in this server';
  end if;
  if (select count(*) from public.bot_interactions where user_id = auth.uid() and created_at > now() - interval '10 seconds') >= 5 then
    raise exception 'slow down a little';
  end if;
  insert into public.bot_interactions (app_id, server_id, channel_id, user_id, command, args)
  values (p_app, v_server, p_channel, auth.uid(), v_cmd, left(coalesce(p_args, ''), 1000))
  returning id into v_id;
  select * into s from public.servers where id = v_server;
  if a.preset = 'management' and v_cmd = 'serverinfo' then
    perform public.bot_post(p_app, p_channel, '', jsonb_build_object('title', s.name, 'description', coalesce(nullif(s.description, ''), 'No description yet.'),
      'fields', jsonb_build_array(jsonb_build_object('name', 'Members', 'value', public.member_count(v_server)::text),
                                  jsonb_build_object('name', 'Created', 'value', to_char(s.created_at, 'Mon DD, YYYY')),
                                  jsonb_build_object('name', 'Channels', 'value', (select count(*) from public.channels where server_id = v_server)::text))),
      null, v_id);
  elsif a.preset = 'management' and v_cmd = 'rules' then
    perform public.bot_post(p_app, p_channel, case when cardinality(s.rules) = 0 then 'This server has no rules set yet.'
      else (select string_agg(i || '. ' || r, E'\n') from unnest(s.rules) with ordinality as t(r, i)) end, null, null, v_id);
  elsif a.preset = 'verification' and v_cmd = 'verify' then
    perform public.bot_post(p_app, p_channel, '<@' || auth.uid() || '> verify here: https://www.venband.com/voogle?server=' || v_server, null, null, v_id);
  else
    return jsonb_build_object('status', 'queued', 'id', v_id);
  end if;
  update public.bot_interactions set handled = true where id = v_id;
  return jsonb_build_object('status', 'handled', 'id', v_id);
end;
$$;

-- Commands that preset bots answer themselves.
create or replace function public.preset_commands(p_preset text)
returns table (name text, description text) language sql immutable set search_path = '' as $$
  select v.n, v.d from (values ('management', 'serverinfo', 'Show information about this server'),
                        ('management', 'rules', 'Post the server rules'),
                        ('verification', 'verify', 'Get your Voogle verification link')) v(p, n, d)
  where v.p = p_preset;
$$;

-- Commands you can use in a server (from its bots).
create or replace function public.server_commands(p_server uuid)
returns table (app_id uuid, app_name text, name text, description text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.name, c.name, c.description
  from public.server_bots b join public.applications a on a.id = b.app_id and a.status = 'active'
  cross join lateral (select bc.name, bc.description from public.bot_commands bc where bc.app_id = a.id
                      union select pc.name, pc.description from public.preset_commands(a.preset) pc) c
  where b.server_id = p_server and public.is_server_member(p_server)
  order by c.name;
$$;

-- Management preset: welcome messages, auto roles, join / leave log.
create or replace function public.bots_on_member_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  b record;
  v_server uuid := coalesce(new.server_id, old.server_id);
  v_user uuid := coalesce(new.user_id, old.user_id);
  v_name text;
  r text;
begin
  if pg_trigger_depth() > 1 or not exists (select 1 from public.servers where id = v_server) then return null; end if;
  select coalesce(display_name, username) into v_name from public.profiles where id = v_user;
  for b in select sb.*, a.preset from public.server_bots sb join public.applications a on a.id = sb.app_id
           where sb.server_id = v_server and a.status = 'active' and a.preset = 'management' loop
    begin
      if tg_op = 'INSERT' then
        if b.settings ->> 'welcome_channel' is not null then
          perform public.bot_post(b.app_id, (b.settings ->> 'welcome_channel')::uuid,
            replace(replace(coalesce(nullif(b.settings ->> 'welcome_text', ''), 'Welcome {user}!'), '{user}', '<@' || v_user || '>'),
                    '{server}', (select name from public.servers where id = v_server)), null);
        end if;
        for r in select jsonb_array_elements_text(coalesce(b.settings -> 'auto_roles', '[]'::jsonb)) loop
          insert into public.member_roles (server_id, user_id, role_id)
          select v_server, v_user, x.id from public.roles x where x.id = r::uuid and x.server_id = v_server and not x.is_default
          on conflict do nothing;
        end loop;
        if b.settings ->> 'log_channel' is not null then
          perform public.bot_post(b.app_id, (b.settings ->> 'log_channel')::uuid, '📥 **' || v_name || '** joined', null);
        end if;
      elsif b.settings ->> 'log_channel' is not null then
        perform public.bot_post(b.app_id, (b.settings ->> 'log_channel')::uuid, '📤 **' || v_name || '** left', null);
      end if;
    exception when others then
      null; -- a bot misconfiguration must never stop someone joining or leaving
    end;
  end loop;
  return null;
end;
$$;
drop trigger if exists server_members_bots on public.server_members;
create trigger server_members_bots after insert or delete on public.server_members
  for each row execute function public.bots_on_member_change();

-- ---------------------------------------------------------------- bot API ----
-- Called by /api/bot with "Authorization: Bot vb_<app>_<secret>".
create or replace function public.bot_api(p_token text, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.applications%rowtype;
  v_app uuid;
  m text[];
  v_server uuid;
  v_out jsonb;
  c jsonb;
  i public.bot_interactions%rowtype;
begin
  m := regexp_match(coalesce(p_token, ''), '^vb_([0-9a-f]{32})_([A-Za-z0-9_-]{20,80})$');
  if m is null then raise exception 'invalid token'; end if;
  v_app := (substr(m[1], 1, 8) || '-' || substr(m[1], 9, 4) || '-' || substr(m[1], 13, 4) || '-' || substr(m[1], 17, 4) || '-' || substr(m[1], 21))::uuid;
  select * into a from public.applications where id = v_app;
  if not found or a.token_hash is null or a.token_hash <> encode(extensions.digest(m[2], 'sha256'), 'hex') then
    raise exception 'invalid token';
  end if;
  if a.status <> 'active' then raise exception 'this application is disabled'; end if;
  p_args := coalesce(p_args, '{}'::jsonb);

  case p_action
  when 'me' then
    return jsonb_build_object('id', a.id, 'name', a.name, 'preset', a.preset,
      'servers', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'members', public.member_count(s.id)))
                           from public.server_bots b join public.servers s on s.id = b.server_id where b.app_id = a.id), '[]'::jsonb));
  when 'channels' then
    v_server := (p_args ->> 'server')::uuid;
    if not exists (select 1 from public.server_bots where server_id = v_server and app_id = a.id) then raise exception 'the bot isn''t in that server'; end if;
    return coalesce((select jsonb_agg(jsonb_build_object('id', c2.id, 'name', c2.name, 'type', c2.type, 'category', c2.category) order by c2.position)
                     from public.channels c2 where c2.server_id = v_server and not c2.is_private), '[]'::jsonb);
  when 'members' then
    v_server := (p_args ->> 'server')::uuid;
    if not exists (select 1 from public.server_bots where server_id = v_server and app_id = a.id) then raise exception 'the bot isn''t in that server'; end if;
    return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name, 'joined_at', sm.joined_at))
                     from (select * from public.server_members where server_id = v_server order by joined_at limit 1000) sm
                     join public.profiles p on p.id = sm.user_id), '[]'::jsonb);
  when 'send' then
    if (select is_private from public.channels where id = (p_args ->> 'channel')::uuid) then
      raise exception 'bots can''t post in private channels';
    end if;
    return jsonb_build_object('id', public.bot_post(a.id, (p_args ->> 'channel')::uuid, p_args ->> 'content', p_args -> 'embed'));
  when 'commands.set' then
    if jsonb_typeof(p_args -> 'commands') <> 'array' or jsonb_array_length(p_args -> 'commands') > 50 then
      raise exception 'commands must be a list of up to 50';
    end if;
    delete from public.bot_commands where app_id = a.id;
    for c in select * from jsonb_array_elements(p_args -> 'commands') loop
      insert into public.bot_commands (app_id, name, description)
      values (a.id, lower(c ->> 'name'), left(coalesce(c ->> 'description', ''), 100));
    end loop;
    return jsonb_build_object('count', jsonb_array_length(p_args -> 'commands'));
  when 'events' then
    -- commands people used and members joining, oldest first
    return jsonb_build_object('events', coalesce((select jsonb_agg(q.e order by q.e ->> 'at') from (
      select u.e from (
        select jsonb_build_object('type', 'command', 'id', x.id, 'server', x.server_id, 'channel', x.channel_id,
                                  'user', x.user_id, 'command', x.command, 'args', x.args, 'at', x.created_at) e
        from public.bot_interactions x
        where x.app_id = a.id and not x.handled and x.created_at > coalesce((p_args ->> 'after')::timestamptz, now() - interval '1 day')
        union all
        select jsonb_build_object('type', 'member_join', 'server', ev.server_id, 'user', ev.user_id, 'at', ev.created_at)
        from public.server_events ev join public.server_bots b on b.server_id = ev.server_id and b.app_id = a.id
        where ev.kind = 'join' and ev.created_at > coalesce((p_args ->> 'after')::timestamptz, now() - interval '1 day')
      ) u order by u.e ->> 'at' limit 100) q), '[]'::jsonb));
  when 'reply' then
    select * into i from public.bot_interactions where id = (p_args ->> 'interaction')::uuid and app_id = a.id;
    if not found then raise exception 'unknown interaction'; end if;
    v_out := jsonb_build_object('id', public.bot_post(a.id, i.channel_id, p_args ->> 'content', p_args -> 'embed', null, i.id));
    update public.bot_interactions set handled = true where id = i.id;
    return v_out;
  when 'voogle.check' then
    v_server := (p_args ->> 'server')::uuid;
    if not exists (select 1 from public.server_bots where server_id = v_server and app_id = a.id) then raise exception 'the bot isn''t in that server'; end if;
    if not public.is_server_member(v_server, (p_args ->> 'user')::uuid) then raise exception 'that person isn''t in the server'; end if;
    return public.voogle_risk((p_args ->> 'user')::uuid, v_server);
  else
    raise exception 'unknown action %', p_action;
  end case;
end;
$$;

-- ----------------------------------------------------------------- Voogle ----
insert into public.platform_config (key, value)
values ('voogle_pepper', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

alter table public.servers add column if not exists voogle jsonb not null default '{"enabled": false}'::jsonb
  check (pg_column_size(voogle) < 1000);

create table if not exists public.voogle_signals (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('device', 'fp', 'ip', 'net', 'signup')),
  hash       text not null,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  primary key (user_id, kind, hash)
);
create index if not exists voogle_signals_hash_idx on public.voogle_signals (kind, hash);
alter table public.voogle_signals enable row level security;  -- no policies: nobody reads these directly

create table if not exists public.voogle_verifications (
  server_id  uuid not null references public.servers (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  result     text not null check (result in ('passed', 'blocked', 'review')),
  score      integer not null default 0,
  reason     text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (server_id, user_id)
);
alter table public.voogle_verifications enable row level security;
drop policy if exists voogle_verifications_select on public.voogle_verifications;
create policy voogle_verifications_select on public.voogle_verifications for select to authenticated
  using (user_id = auth.uid() or public.has_permission(server_id, 16) or public.has_permission(server_id, 2097152));

create or replace function public.voogle_hash(p_value text)
returns text language sql stable security definer set search_path = '' as $$
  select encode(extensions.hmac(p_value, (select value from public.platform_config where key = 'voogle_pepper'), 'sha256'), 'hex');
$$;

-- Other accounts that share signals with p_user, strongest first.
--   99%: same device token (only one browser profile has it)
--   likely: same browser fingerprint AND same network
--   possible: same network only (schools, families, cafés share these)
create or replace function public.voogle_links(p_user uuid)
returns table (other uuid, level text, score integer)
language sql stable security definer set search_path = '' as $$
  with mine as (select kind, hash from public.voogle_signals where user_id = p_user),
  hits as (
    select s.user_id, s.kind from public.voogle_signals s join mine m on m.kind = s.kind and m.hash = s.hash
    where s.user_id <> p_user
  ),
  agg as (
    select user_id, bool_or(kind = 'device') dev, bool_or(kind = 'fp') fp, bool_or(kind in ('ip', 'net', 'signup')) net
    from hits group by user_id
  )
  select user_id,
         case when dev then '99' when fp and net then 'likely' else 'possible' end,
         case when dev then 99 when fp and net then 80 when fp then 45 else 25 end
  from agg
  order by 3 desc
  limit 200;
$$;

-- A risk summary that never says why: no IPs, devices or matches.
create or replace function public.voogle_risk(p_user uuid, p_server uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_strong integer;
  v_possible integer;
  v_banned boolean;
  v_age interval;
  v_score integer;
begin
  select count(*) filter (where level in ('99', 'likely')), count(*) filter (where level = 'possible')
  into v_strong, v_possible from public.voogle_links(p_user);
  select exists (select 1 from public.voogle_links(p_user) l
                 join public.profiles p on p.id = l.other
                 where l.level in ('99', 'likely')
                   and (p.account_status = 'banned'
                        or (p_server is not null and exists (select 1 from public.bans b where b.server_id = p_server and b.user_id = l.other))))
  into v_banned;
  select now() - created_at into v_age from public.profiles where id = p_user;
  v_score := least(100, case when v_strong > 0 then 50 + 10 * least(v_strong, 3) else 0 end
                         + 5 * least(v_possible, 4)
                         + case when v_age < interval '1 day' then 20 when v_age < interval '7 days' then 10 else 0 end
                         + case when v_banned then 30 else 0 end);
  return jsonb_build_object('user', p_user, 'score', v_score,
    'risk', case when v_score >= 70 then 'high' when v_score >= 35 then 'medium' else 'low' end,
    'likely_alts', v_strong, 'linked_to_banned', v_banned);
end;
$$;

-- Verify for a server. The device token and fingerprint come from the
-- browser; the network comes from your login session (never from the
-- browser, so it can't be faked) and is stored only as a peppered hash.
create or replace function public.voogle_verify(p_server uuid, p_device text, p_fp text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  s public.servers%rowtype;
  v_ip inet;
  v_signup text;
  v_max integer;
  v_accounts integer;
  v_risk jsonb;
  v_result text := 'passed';
  v_reason text := '';
  v_role uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into s from public.servers where id = p_server;
  if not found or not coalesce((s.voogle ->> 'enabled')::boolean, false) then raise exception 'this server doesn''t use Voogle'; end if;
  if not public.is_server_member(p_server, v_uid) then raise exception 'join the server first'; end if;
  if p_device !~ '^[A-Za-z0-9_-]{16,64}$' or p_fp !~ '^[0-9a-f]{64}$' then raise exception 'verification data is malformed'; end if;
  if exists (select 1 from public.voogle_verifications where server_id = p_server and user_id = v_uid
             and updated_at > now() - interval '20 seconds') then
    raise exception 'please wait a few seconds and try again';
  end if;

  insert into public.voogle_signals (user_id, kind, hash) values
    (v_uid, 'device', public.voogle_hash('d|' || p_device)),
    (v_uid, 'fp', public.voogle_hash('f|' || p_fp))
  on conflict (user_id, kind, hash) do update set last_seen = now();
  select ip into v_ip from auth.sessions where id = nullif(auth.jwt() ->> 'session_id', '')::uuid and user_id = v_uid;
  if v_ip is not null then
    insert into public.voogle_signals (user_id, kind, hash) values
      (v_uid, 'ip', public.voogle_hash('i|' || host(v_ip))),
      (v_uid, 'net', public.voogle_hash('n|' || host(network(set_masklen(v_ip, case when family(v_ip) = 4 then 24 else 48 end)))))
    on conflict (user_id, kind, hash) do update set last_seen = now();
  end if;
  select ip_hash into v_signup from public.signup_ips where user_id = v_uid order by created_at limit 1;
  if v_signup is not null then
    insert into public.voogle_signals (user_id, kind, hash) values (v_uid, 'signup', public.voogle_hash('s|' || v_signup))
    on conflict (user_id, kind, hash) do update set last_seen = now();
  end if;

  v_risk := public.voogle_risk(v_uid, p_server);
  v_max := greatest(1, coalesce((s.voogle ->> 'max_accounts')::int, 3));
  -- accounts already verified (anywhere) from the same device or network
  select count(distinct l.other) into v_accounts from public.voogle_links(v_uid) l
  where exists (select 1 from public.voogle_verifications vv where vv.user_id = l.other and vv.result = 'passed');
  if v_accounts + 1 > v_max then
    v_result := 'blocked';
    v_reason := 'Too many accounts have been verified from this device or network.';
  elsif coalesce((s.voogle ->> 'block_ban_evasion')::boolean, true) and (v_risk ->> 'linked_to_banned')::boolean then
    v_result := 'blocked';
    v_reason := 'This account looks linked to an account that was banned.';
  elsif coalesce((s.voogle ->> 'min_account_days')::int, 0) > 0
        and (select created_at from public.profiles where id = v_uid) > now() - make_interval(days => (s.voogle ->> 'min_account_days')::int) then
    v_result := 'blocked';
    v_reason := format('Your account must be at least %s days old.', s.voogle ->> 'min_account_days');
  elsif (v_risk ->> 'score')::int >= coalesce((s.voogle ->> 'review_at')::int, 70) then
    v_result := 'review';
    v_reason := 'A moderator will take a quick look.';
  end if;

  insert into public.voogle_verifications as vv (server_id, user_id, result, score, reason)
  values (p_server, v_uid, v_result, (v_risk ->> 'score')::int, v_reason)
  on conflict (server_id, user_id) do update
    set result = case when vv.result = 'passed' then 'passed' else excluded.result end,
        score = excluded.score, reason = excluded.reason, updated_at = now();
  select result into v_result from public.voogle_verifications where server_id = p_server and user_id = v_uid;
  if v_result = 'passed' then
    v_role := nullif(s.voogle ->> 'role_id', '')::uuid;
    if v_role is not null then
      insert into public.member_roles (server_id, user_id, role_id)
      select p_server, v_uid, r.id from public.roles r where r.id = v_role and r.server_id = p_server and not r.is_default
      on conflict do nothing;
    end if;
  end if;
  return jsonb_build_object('result', v_result, 'reason', case when v_result = 'passed' then '' else v_reason end);
end;
$$;

create or replace function public.voogle_review(p_server uuid, p_user uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_role uuid;
begin
  if not (public.has_permission(p_server, 16) or public.has_permission(p_server, 2097152)) then raise exception 'not allowed'; end if;
  update public.voogle_verifications set result = case when p_approve then 'passed' else 'blocked' end,
         reason = case when p_approve then '' else 'A moderator didn''t approve this verification.' end, updated_at = now()
  where server_id = p_server and user_id = p_user;
  if not found then raise exception 'no verification to review'; end if;
  v_role := nullif((select voogle ->> 'role_id' from public.servers where id = p_server), '')::uuid;
  if p_approve and v_role is not null and public.is_server_member(p_server, p_user) then
    insert into public.member_roles (server_id, user_id, role_id)
    select p_server, p_user, r.id from public.roles r where r.id = v_role and r.server_id = p_server and not r.is_default
    on conflict do nothing;
  end if;
end;
$$;

-- Likely alts of a user. Staff see everything; a server's moderators (with
-- Voogle on) only see accounts connected to their own server plus how many
-- others exist. Never returns why two accounts are linked.
create or replace function public.voogle_lookup(p_user uuid, p_server uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_staff boolean := public.is_staff();
  v_rows jsonb;
  v_hidden integer;
begin
  if not v_staff then
    if p_server is null then raise exception 'pick one of your servers'; end if;
    if not (public.has_permission(p_server, 16) or public.has_permission(p_server, 2097152)) then
      raise exception 'you need Kick Members or Moderate Members in that server';
    end if;
    if not coalesce((select (voogle ->> 'enabled')::boolean from public.servers where id = p_server), false) then
      raise exception 'turn on Voogle for that server first';
    end if;
    if not (public.is_server_member(p_server, p_user)
            or exists (select 1 from public.bans where server_id = p_server and user_id = p_user)
            or exists (select 1 from public.voogle_verifications where server_id = p_server and user_id = p_user)) then
      raise exception 'that person isn''t connected to your server';
    end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_color', p.avatar_color,
           'confidence', case l.level when '99' then '99% sure alt' when 'likely' then 'Likely alt' else 'Possible link' end,
           'level', l.level, 'banned', p.account_status = 'banned',
           'banned_here', p_server is not null and exists (select 1 from public.bans b where b.server_id = p_server and b.user_id = p.id),
           'in_server', p_server is not null and public.is_server_member(p_server, p.id)) order by l.score desc), '[]'::jsonb)
  into v_rows
  from public.voogle_links(p_user) l join public.profiles p on p.id = l.other
  where (v_staff or l.level <> 'possible')
    and (v_staff or public.is_server_member(p_server, p.id)
         or exists (select 1 from public.bans b where b.server_id = p_server and b.user_id = p.id)
         or exists (select 1 from public.voogle_verifications vv where vv.server_id = p_server and vv.user_id = p.id));
  if not v_staff then
    select count(*) into v_hidden from public.voogle_links(p_user) l
    where l.level <> 'possible' and not (public.is_server_member(p_server, l.other)
         or exists (select 1 from public.bans b where b.server_id = p_server and b.user_id = l.other)
         or exists (select 1 from public.voogle_verifications vv where vv.server_id = p_server and vv.user_id = l.other));
  end if;
  return jsonb_build_object('risk', public.voogle_risk(p_user, p_server), 'alts', v_rows, 'hidden', coalesce(v_hidden, 0),
    'verification', (select to_jsonb(v) - 'server_id' from public.voogle_verifications v where v.server_id = p_server and v.user_id = p_user));
end;
$$;

create or replace function public.set_voogle_settings(p_server uuid, p_settings jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v jsonb;
  v_role uuid := nullif(p_settings ->> 'role_id', '')::uuid;
begin
  if not public.has_permission(p_server, 2) then raise exception 'you need Manage Server'; end if;
  if v_role is not null and not exists (select 1 from public.roles r where r.id = v_role and r.server_id = p_server
       and not r.is_default and (r.permissions & 1) = 0
       and (r.position < public.member_top_position(p_server) or (select owner_id from public.servers where id = p_server) = auth.uid())) then
    raise exception 'pick a role below your highest role (not an Administrator role)';
  end if;
  v := jsonb_strip_nulls(jsonb_build_object(
    'enabled', coalesce((p_settings ->> 'enabled')::boolean, false),
    'required', coalesce((p_settings ->> 'required')::boolean, false),
    'role_id', v_role,
    'max_accounts', least(10, greatest(1, coalesce((p_settings ->> 'max_accounts')::int, 3))),
    'block_ban_evasion', coalesce((p_settings ->> 'block_ban_evasion')::boolean, true),
    'min_account_days', least(365, greatest(0, coalesce((p_settings ->> 'min_account_days')::int, 0))),
    'review_at', least(100, greatest(10, coalesce((p_settings ->> 'review_at')::int, 70)))));
  update public.servers set voogle = v where id = p_server;
  return v;
end;
$$;

-- Read-only until verified, like unaccepted rules.
create or replace function public.server_permissions(p_server uuid, p_user uuid default auth.uid())
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_status text;
  v_rules text[];
  v_voogle jsonb;
  v_perms bigint;
begin
  select owner_id, status, rules, voogle into v_owner, v_status, v_rules, v_voogle from public.servers where id = p_server;
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
  if (cardinality(v_rules) > 0 and not exists (select 1 from public.member_onboarding o where o.server_id = p_server
                                               and o.user_id = p_user and o.rules_accepted_at is not null))
     or (coalesce((v_voogle ->> 'enabled')::boolean, false) and coalesce((v_voogle ->> 'required')::boolean, false)
         and (v_perms & (2 | 16 | 32 | 2097152)) = 0
         and not exists (select 1 from public.voogle_verifications v where v.server_id = p_server
                         and v.user_id = p_user and v.result = 'passed')) then
    -- read-only: no sending, reacting, threads, polls, files, voice talk
    v_perms := v_perms & ~(128 | 4096 | 8192 | 32768 | 65536 | 1024 | 2048 | 524288);
  end if;
  return v_perms;
end;
$$;

-- --------------------------------------------------------------- realtime ----
do $$
declare t text;
begin
  foreach t in array array['bot_messages', 'server_bots', 'status_incidents', 'status_updates', 'voogle_verifications', 'bot_join_requests'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------- grants ----
grant select on public.status_incidents, public.status_updates to anon, authenticated;
grant select (id, owner_id, name, description, preset, icon_url, color, token_hint, status, created_at, updated_at)
  on public.applications to authenticated;
grant update (name, description, icon_url, color) on public.applications to authenticated;
grant delete on public.applications to authenticated;
grant select on public.application_team, public.bot_join_requests, public.bot_commands, public.bot_interactions,
  public.voogle_verifications to authenticated;
grant select (id, server_id, app_id, added_by, settings, webhook_channel, created_at) on public.server_bots to authenticated;
grant select, delete on public.bot_messages to authenticated;
revoke all on public.voogle_signals from anon, authenticated;

revoke execute on function
  public.post_status_update(uuid, text, text, text, text, text[]), public.delete_status_incident(uuid),
  public.status_ping(), public.public_discover(text, text),
  public.app_role(uuid, uuid), public.can_see_app(uuid, uuid), public.guard_application_update(),
  public.preset_settings(text), public.create_application(text, text), public.reset_bot_token(uuid),
  public.app_add_member(uuid, text, text), public.app_remove_member(uuid, uuid), public.install_bot(uuid, uuid, uuid),
  public.bot_join_server(uuid, text), public.review_bot_request(uuid, boolean), public.remove_bot(uuid),
  public.update_bot_settings(uuid, jsonb), public.reset_bot_webhook(uuid, uuid), public.clean_embed(jsonb),
  public.pending_bot_apps(uuid),
  public.bot_post(uuid, uuid, text, jsonb, text, uuid), public.post_webhook(uuid, text, text, text, jsonb),
  public.use_bot_command(uuid, uuid, text, text), public.preset_commands(text), public.server_commands(uuid),
  public.bots_on_member_change(), public.bot_api(text, text, jsonb),
  public.voogle_hash(text), public.voogle_links(uuid), public.voogle_risk(uuid, uuid),
  public.voogle_verify(uuid, text, text), public.voogle_review(uuid, uuid, boolean), public.voogle_lookup(uuid, uuid),
  public.set_voogle_settings(uuid, jsonb)
from public, anon, authenticated;

grant execute on function public.status_ping(), public.public_discover(text, text),
  public.post_webhook(uuid, text, text, text, jsonb), public.bot_api(text, text, jsonb) to anon, authenticated;
grant execute on function
  public.post_status_update(uuid, text, text, text, text, text[]), public.delete_status_incident(uuid),
  public.app_role(uuid, uuid), public.can_see_app(uuid, uuid),
  public.create_application(text, text), public.reset_bot_token(uuid),
  public.app_add_member(uuid, text, text), public.app_remove_member(uuid, uuid),
  public.bot_join_server(uuid, text), public.review_bot_request(uuid, boolean), public.remove_bot(uuid),
  public.update_bot_settings(uuid, jsonb), public.reset_bot_webhook(uuid, uuid), public.pending_bot_apps(uuid),
  public.use_bot_command(uuid, uuid, text, text), public.server_commands(uuid),
  public.voogle_verify(uuid, text, text), public.voogle_review(uuid, uuid, boolean), public.voogle_lookup(uuid, uuid),
  public.set_voogle_settings(uuid, jsonb)
to authenticated;


-- =============================================================================
-- ============ moderation & security (20261007000000_moderation_security.sql)
-- =============================================================================
-- Moderation and security: reports for server moderators (with pictures),
-- removed GIFs, custom badges, timeouts, warnings, a server audit log, a
-- recycle bin for deleted servers, account deletion, two-factor enforcement
-- and data export.

-- ------------------------------------------------- reports: server mods ----
alter table public.reports add column if not exists server_status text not null default 'open'
  check (server_status in ('open', 'actioned', 'dismissed'));
alter table public.reports add column if not exists server_note text not null default '' check (char_length(server_note) <= 1000);

create or replace function public.is_server_moderator(p_server uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_permission(p_server, 2097152, p_user) or public.has_permission(p_server, 256, p_user)
      or public.has_permission(p_server, 16, p_user);
$$;

-- Reports about messages in a server, for that server's moderators. The
-- reporter stays anonymous to them.
create or replace function public.server_reports(p_server uuid, p_status text default 'open')
returns table (id uuid, kind text, target_user uuid, message_id uuid, channel_id uuid, reason text, evidence jsonb,
               server_status text, server_note text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, r.kind, r.target_user, r.message_id, r.channel_id, r.reason, r.evidence, r.server_status, r.server_note, r.created_at
  from public.reports r
  where r.server_id = p_server and public.is_server_moderator(p_server)
    and (p_status is null or r.server_status = p_status)
  order by r.created_at desc
  limit 200;
$$;

create or replace function public.handle_server_report(p_report uuid, p_status text, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_server uuid;
begin
  select server_id into v_server from public.reports where id = p_report;
  if v_server is null or not public.is_server_moderator(v_server) then raise exception 'not allowed'; end if;
  if p_status not in ('open', 'actioned', 'dismissed') then raise exception 'unknown status'; end if;
  update public.reports set server_status = p_status, server_note = left(coalesce(p_note, ''), 1000) where id = p_report;
  perform public.audit(v_server, 'report_' || p_status, (select target_user from public.reports where id = p_report), p_report, jsonb_build_object('note', left(coalesce(p_note, ''), 200)));
end;
$$;

-- Pictures attached to reports: report-evidence/<reporter>/<report id>/<n>.webp
insert into storage.buckets (id, name, public, file_size_limit)
values ('report-evidence', 'report-evidence', false, 3145728)
on conflict (id) do update set public = false, file_size_limit = 3145728;
do $$ begin
  update storage.buckets set allowed_mime_types = array['image/webp', 'image/png', 'image/jpeg'] where id = 'report-evidence';
exception when undefined_column then null; end $$;

create or replace function public.can_read_evidence(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_report text := split_part(p_name, '/', 2);
  v_server uuid;
begin
  if split_part(p_name, '/', 1) = auth.uid()::text or public.platform_rank() >= 2 then return true; end if;
  if v_report !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  select server_id into v_server from public.reports where id = v_report::uuid;
  return v_server is not null and public.is_server_moderator(v_server);
end;
$$;

drop policy if exists venband_evidence_read on storage.objects;
create policy venband_evidence_read on storage.objects for select to authenticated
  using (bucket_id = 'report-evidence' and public.can_read_evidence(name));
drop policy if exists venband_evidence_write on storage.objects;
create policy venband_evidence_write on storage.objects for insert to authenticated
  with check (bucket_id = 'report-evidence' and split_part(name, '/', 1) = auth.uid()::text);

-- --------------------------------------------------------- removed GIFs ----
-- Server owners and administrators (and Venband staff, everywhere) can remove
-- a GIF. Only a hash of its address is stored, so the list reveals nothing.
create table if not exists public.banned_media (
  id         uuid primary key default gen_random_uuid(),
  server_id  uuid references public.servers (id) on delete cascade,   -- null = everywhere (staff)
  hash       text not null check (hash ~ '^[0-9a-f]{64}$'),
  banned_by  uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists banned_media_unique on public.banned_media (coalesce(server_id, '00000000-0000-0000-0000-000000000000'::uuid), hash);
alter table public.banned_media enable row level security;
drop policy if exists banned_media_select on public.banned_media;
create policy banned_media_select on public.banned_media for select to authenticated
  using (server_id is null or public.is_server_member(server_id));

create or replace function public.can_ban_media(p_server uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when p_server is null then public.is_staff()
              else (select owner_id from public.servers where id = p_server) = auth.uid()
                   or public.has_permission(p_server, 1) or public.is_staff() end;
$$;

create or replace function public.ban_media(p_server uuid, p_hash text, p_banned boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_ban_media(p_server) then raise exception 'only the server owner or administrators can remove GIFs'; end if;
  if p_banned then
    insert into public.banned_media (server_id, hash, banned_by) values (p_server, p_hash, auth.uid()) on conflict do nothing;
  else
    delete from public.banned_media where server_id is not distinct from p_server and hash = p_hash;
  end if;
  if p_server is not null then perform public.audit(p_server, case when p_banned then 'gif_remove' else 'gif_restore' end, null, null, '{}'::jsonb); end if;
end;
$$;

-- ---------------------------------------------------------- custom badges ----
create table if not exists public.custom_badges (
  id          text primary key check (id ~ '^c_[a-z0-9_]{2,30}$'),
  name        text not null check (char_length(btrim(name)) between 2 and 40),
  description text not null default '' check (char_length(description) <= 200),
  image_url   text not null check (char_length(image_url) <= 500),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.custom_badges enable row level security;
drop policy if exists custom_badges_read on public.custom_badges;
create policy custom_badges_read on public.custom_badges for select to anon, authenticated using (true);

-- Venband owners and founders design badges.
create or replace function public.can_design_badges()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.platform_rank() >= 3 or exists (select 1 from public.profiles where id = auth.uid() and 'founder' = any (badges));
$$;

insert into storage.buckets (id, name, public, file_size_limit)
values ('badges', 'badges', true, 524288)
on conflict (id) do update set public = true, file_size_limit = 524288;
do $$ begin
  update storage.buckets set allowed_mime_types = array['image/png', 'image/webp', 'image/gif'] where id = 'badges';
exception when undefined_column then null; end $$;
drop policy if exists venband_badges_read on storage.objects;
create policy venband_badges_read on storage.objects for select to anon, authenticated using (bucket_id = 'badges');
drop policy if exists venband_badges_write on storage.objects;
create policy venband_badges_write on storage.objects for insert to authenticated
  with check (bucket_id = 'badges' and public.can_design_badges());
drop policy if exists venband_badges_delete on storage.objects;
create policy venband_badges_delete on storage.objects for delete to authenticated
  using (bucket_id = 'badges' and public.can_design_badges());

create or replace function public.save_custom_badge(p_id text, p_name text, p_description text, p_image_url text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_id text := 'c_' || regexp_replace(lower(btrim(coalesce(p_id, ''))), '^c_', '');
begin
  if not public.can_design_badges() then raise exception 'only Venband owners and founders can make badges'; end if;
  if p_image_url !~ '/storage/v1/object/public/badges/' then raise exception 'upload the badge picture first'; end if;
  insert into public.custom_badges (id, name, description, image_url, created_by)
  values (v_id, btrim(p_name), btrim(coalesce(p_description, '')), p_image_url, auth.uid())
  on conflict (id) do update set name = excluded.name, description = excluded.description, image_url = excluded.image_url;
  insert into public.mod_actions (actor_id, action, detail) values (auth.uid(), 'badge_design', v_id);
  return v_id;
end;
$$;

create or replace function public.delete_custom_badge(p_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_design_badges() then raise exception 'only Venband owners and founders can do that'; end if;
  update public.profiles set badges = array_remove(badges, p_id) where p_id = any (badges);
  delete from public.custom_badges where id = p_id;
end;
$$;

-- Custom badges can be handed out like the built-in ones.
create or replace function public.all_badges()
returns text[] language sql stable security definer set search_path = '' as $$
  select array['founder', 'owner', 'admin', 'moderator', 'staff', 'partner', 'verified_dev', 'bug_hunter',
               'bug_hunter_gold', 'og', 'early_supporter', 'supporter', 'translator', 'event_winner']::text[]
         || coalesce((select array_agg(id order by created_at) from public.custom_badges), '{}');
$$;

-- --------------------------------------------------- timeouts & warnings ----
alter table public.server_members add column if not exists timeout_until timestamptz;
alter table public.server_members add column if not exists timeout_reason text check (char_length(timeout_reason) <= 512);

create or replace function public.can_moderate(p_server uuid, p_target uuid, p_perm bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_target <> auth.uid()
     and (select owner_id from public.servers where id = p_server) <> p_target
     and public.has_permission(p_server, p_perm)
     and ((select owner_id from public.servers where id = p_server) = auth.uid()
          or public.member_top_position(p_server, p_target) < public.member_top_position(p_server));
$$;

create or replace function public.timeout_member(p_server uuid, p_user uuid, p_minutes integer, p_reason text default '')
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_until timestamptz := case when coalesce(p_minutes, 0) <= 0 then null else now() + make_interval(mins => least(p_minutes, 40320)) end;
begin
  if not public.can_moderate(p_server, p_user, 2097152) then raise exception 'you can''t time out this member'; end if;
  update public.server_members set timeout_until = v_until, timeout_reason = nullif(left(btrim(coalesce(p_reason, '')), 512), '')
  where server_id = p_server and user_id = p_user;
  if not found then raise exception 'not a member'; end if;
  perform public.audit(p_server, case when v_until is null then 'timeout_remove' else 'timeout' end, p_user, null,
                       jsonb_build_object('minutes', p_minutes, 'reason', left(coalesce(p_reason, ''), 200)));
  return v_until;
end;
$$;

create table if not exists public.member_warnings (
  id              uuid primary key default gen_random_uuid(),
  server_id       uuid not null references public.servers (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  moderator_id    uuid references public.profiles (id) on delete set null,
  reason          text not null check (char_length(btrim(reason)) between 1 and 1000),
  acknowledged_at timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists member_warnings_user_idx on public.member_warnings (user_id, created_at desc);
create index if not exists member_warnings_server_idx on public.member_warnings (server_id, created_at desc);
alter table public.member_warnings enable row level security;
drop policy if exists member_warnings_select on public.member_warnings;
create policy member_warnings_select on public.member_warnings for select to authenticated
  using (user_id = auth.uid() or public.is_server_moderator(server_id));

create or replace function public.warn_member(p_server uuid, p_user uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not (public.can_moderate(p_server, p_user, 2097152) or public.can_moderate(p_server, p_user, 16)) then
    raise exception 'you can''t warn this member';
  end if;
  insert into public.member_warnings (server_id, user_id, moderator_id, reason)
  values (p_server, p_user, auth.uid(), btrim(p_reason)) returning id into v_id;
  perform public.audit(p_server, 'warn', p_user, v_id, jsonb_build_object('reason', left(p_reason, 200)));
  return v_id;
end;
$$;

create or replace function public.ack_warning(p_warning uuid)
returns void language sql security definer set search_path = '' as $$
  update public.member_warnings set acknowledged_at = now() where id = p_warning and user_id = auth.uid();
$$;

-- --------------------------------------------------------- audit log ----
create table if not exists public.server_audit_log (
  id         uuid primary key default gen_random_uuid(),
  server_id  uuid not null references public.servers (id) on delete cascade,
  actor_id   uuid references public.profiles (id) on delete set null,
  action     text not null,
  target_user uuid references public.profiles (id) on delete set null,
  target_id  uuid,
  detail     jsonb not null default '{}'::jsonb check (pg_column_size(detail) < 4000),
  created_at timestamptz not null default now()
);
create index if not exists server_audit_log_idx on public.server_audit_log (server_id, created_at desc);
alter table public.server_audit_log enable row level security;
drop policy if exists server_audit_log_select on public.server_audit_log;
create policy server_audit_log_select on public.server_audit_log for select to authenticated
  using (public.has_permission(server_id, 4194304));

create or replace function public.audit(p_server uuid, p_action text, p_target_user uuid, p_target_id uuid, p_detail jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_server is null or not exists (select 1 from public.servers where id = p_server) then return; end if;
  insert into public.server_audit_log (server_id, actor_id, action, target_user, target_id, detail)
  values (p_server, auth.uid(), p_action, p_target_user, p_target_id, coalesce(p_detail, '{}'::jsonb));
exception when others then
  null; -- the log must never block the action itself
end;
$$;

create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r record := coalesce(new, old);
  v_server uuid;
  v_changed text[];
begin
  if pg_trigger_depth() > 1 then return null; end if;   -- cascades (e.g. a server being deleted)
  case tg_table_name
  when 'bans' then
    perform public.audit(r.server_id, case when tg_op = 'INSERT' then 'ban' else 'unban' end, r.user_id, null,
                         jsonb_build_object('reason', left(coalesce(r.reason, ''), 200)));
  when 'server_members' then
    if tg_op = 'DELETE' and old.user_id <> auth.uid() then perform public.audit(old.server_id, 'kick', old.user_id, null, '{}'::jsonb); end if;
  when 'member_roles' then
    perform public.audit(r.server_id, case when tg_op = 'INSERT' then 'role_give' else 'role_take' end, r.user_id, r.role_id,
                         jsonb_build_object('role', (select name from public.roles where id = r.role_id)));
  when 'roles' then
    if tg_op = 'UPDATE' then
      select array_agg(k) into v_changed from jsonb_each(to_jsonb(new)) n(k, v) where to_jsonb(old) -> k is distinct from v and k <> 'position';
      if v_changed is null then return null; end if;
    end if;
    perform public.audit(r.server_id, 'role_' || lower(tg_op), null, r.id, jsonb_build_object('name', r.name, 'changed', v_changed));
  when 'channels' then
    if r.server_id is null then return null; end if;
    if tg_op = 'UPDATE' then
      select array_agg(k) into v_changed from jsonb_each(to_jsonb(new)) n(k, v)
      where to_jsonb(old) -> k is distinct from v and k not in ('position', 'key_rotation_needed', 'category');
      if v_changed is null then return null; end if;
    end if;
    perform public.audit(r.server_id, 'channel_' || lower(tg_op), null, r.id, jsonb_build_object('name', r.name, 'changed', v_changed));
  when 'invites' then
    perform public.audit(r.server_id, case when tg_op = 'INSERT' then 'invite_create' else 'invite_delete' end, null, null,
                         jsonb_build_object('code', left(r.code, 4) || '…'));
  when 'servers' then
    select array_agg(k) into v_changed from jsonb_each(to_jsonb(new)) n(k, v) where to_jsonb(old) -> k is distinct from v;
    if v_changed is not null then perform public.audit(new.id, 'server_update', null, null, jsonb_build_object('changed', v_changed)); end if;
  when 'server_bots' then
    perform public.audit(r.server_id, case when tg_op = 'INSERT' then 'bot_add' else 'bot_remove' end, null, r.app_id,
                         jsonb_build_object('name', (select name from public.applications where id = r.app_id)));
  else
    null;
  end case;
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['bans', 'server_members', 'member_roles', 'roles', 'channels', 'invites', 'server_bots'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or delete on public.%I for each row execute function public.audit_trigger()', t || '_audit', t);
  end loop;
  foreach t in array array['roles', 'channels', 'servers'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit_upd', t);
    execute format('create trigger %I after update on public.%I for each row execute function public.audit_trigger()', t || '_audit_upd', t);
  end loop;
end $$;
-- joins are already listed under invite analytics; the server_members trigger only logs kicks
drop trigger if exists server_members_audit on public.server_members;
create trigger server_members_audit after delete on public.server_members for each row execute function public.audit_trigger();

-- -------------------------------------------------- server recycle bin ----
alter table public.servers drop constraint if exists servers_status_check;
alter table public.servers add constraint servers_status_check check (status in ('active', 'review', 'closed', 'banned', 'deleted'));
alter table public.servers add column if not exists deleted_at timestamptz;

create or replace function public.delete_server(p_server uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
begin
  if (select owner_id from public.servers where id = p_server) is distinct from auth.uid() then
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
  if (select owner_id from public.servers where id = p_server) is distinct from auth.uid() then
    raise exception 'only the owner can restore the server';
  end if;
  if (select status from public.servers where id = p_server) <> 'deleted' then raise exception 'nothing to restore'; end if;
  perform set_config('venband.mod', 'on', true);
  update public.servers set status = 'active', deleted_at = null where id = p_server;
  perform set_config('venband.mod', 'off', true);
end;
$$;

-- --------------------------------------------------------- account deletion ----
alter table public.profiles add column if not exists deletion_requested_at timestamptz;

create or replace function public.request_account_deletion()
returns timestamptz language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from public.servers where owner_id = auth.uid() and status <> 'deleted') then
    raise exception 'transfer or delete the servers you own first';
  end if;
  update public.profiles set deletion_requested_at = now() where id = auth.uid();
  return now() + interval '14 days';
end;
$$;

create or replace function public.cancel_account_deletion()
returns void language sql security definer set search_path = '' as $$
  update public.profiles set deletion_requested_at = null where id = auth.uid();
$$;

-- Deleted servers after 7 days, accounts 14 days after the request.
create or replace function public.purge_deleted()
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.servers where status = 'deleted' and deleted_at < now() - interval '7 days';
  delete from auth.users u using public.profiles p
  where p.id = u.id and p.deletion_requested_at < now() - interval '14 days';
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'venband-purge-deleted';
    perform cron.schedule('venband-purge-deleted', '17 * * * *', 'select public.purge_deleted()');
  end if;
exception when others then
  raise notice 'pg_cron not available: deleted servers and accounts will be purged once it is turned on';
end $$;

-- ------------------------------------------------------ two-factor auth ----
-- With an authenticator app turned on, your private key (and so your
-- messages) only unlock in a session that passed the second step.
create or replace function public.mfa_ok()
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2' then return true; end if;
  return not exists (select 1 from auth.mfa_factors where user_id = auth.uid() and status = 'verified');
exception when undefined_table then
  return true;
end;
$$;

drop policy if exists private_keys_mfa on public.user_private_keys;
create policy private_keys_mfa on public.user_private_keys as restrictive for all to authenticated
  using (public.mfa_ok()) with check (public.mfa_ok());
drop policy if exists messages_mfa on public.messages;
create policy messages_mfa on public.messages as restrictive for all to authenticated
  using (public.mfa_ok()) with check (public.mfa_ok());

-- ------------------------------------------------------------ data export ----
create or replace function public.export_my_data()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'exported_at', now(),
    'note', 'Messages are end-to-end encrypted; export a conversation from its menu to get readable copies.',
    'profile', (select to_jsonb(p) - 'deletion_requested_at' from public.profiles p where p.id = auth.uid()),
    'email', (select email from auth.users where id = auth.uid()),
    'settings', (select to_jsonb(s) from public.user_settings s where s.user_id = auth.uid()),
    'friends', (select coalesce(jsonb_agg(jsonb_build_object('user', case when f.user_a = auth.uid() then f.user_b else f.user_a end,
                                                            'accepted', f.accepted, 'since', f.created_at)), '[]')
                from public.friendships f where auth.uid() in (f.user_a, f.user_b)),
    'servers', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'joined_at', m.joined_at, 'owner', s.owner_id = auth.uid())), '[]')
                from public.server_members m join public.servers s on s.id = m.server_id where m.user_id = auth.uid()),
    'reports_filed', (select coalesce(jsonb_agg(jsonb_build_object('kind', r.kind, 'reason', r.reason, 'status', r.status, 'at', r.created_at)), '[]')
                      from public.reports r where r.reporter_id = auth.uid()),
    'warnings', (select coalesce(jsonb_agg(jsonb_build_object('server', w.server_id, 'reason', w.reason, 'at', w.created_at)), '[]')
                 from public.member_warnings w where w.user_id = auth.uid()),
    'applications', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'preset', a.preset, 'created_at', a.created_at)), '[]')
                     from public.applications a where a.owner_id = auth.uid()),
    'voogle', (select coalesce(jsonb_agg(jsonb_build_object('server', v.server_id, 'result', v.result, 'at', v.updated_at)), '[]')
               from public.voogle_verifications v where v.user_id = auth.uid()),
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('signed_in', s.created_at, 'last_active', coalesce(s.refreshed_at::timestamptz, s.updated_at))), '[]')
                from auth.sessions s where s.user_id = auth.uid())
  );
$$;

-- Server permissions: timeouts are read-only, like unaccepted rules.
create or replace function public.server_permissions(p_server uuid, p_user uuid default auth.uid())
returns bigint language plpgsql stable security definer set search_path = '' as $$
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
  if v_owner = p_user then return 2147483647; end if;
  select timeout_until into v_timeout from public.server_members where server_id = p_server and user_id = p_user;
  if not found then return 0; end if;

  select coalesce(bit_or(r.permissions), 0) into v_perms
  from public.roles r
  where r.server_id = p_server
    and (r.is_default or exists (select 1 from public.member_roles mr
                                 where mr.role_id = r.id and mr.user_id = p_user
                                   and mr.server_id = p_server));
  if (v_perms & 1) = 1 then return 2147483647; end if;
  if (v_timeout is not null and v_timeout > now())
     or (cardinality(v_rules) > 0 and not exists (select 1 from public.member_onboarding o where o.server_id = p_server
                                                 and o.user_id = p_user and o.rules_accepted_at is not null))
     or (coalesce((v_voogle ->> 'enabled')::boolean, false) and coalesce((v_voogle ->> 'required')::boolean, false)
         and (v_perms & (2 | 16 | 32 | 2097152)) = 0
         and not exists (select 1 from public.voogle_verifications v where v.server_id = p_server
                         and v.user_id = p_user and v.result = 'passed')) then
    -- read-only: no sending, reacting, threads, polls, files, voice talk
    v_perms := v_perms & ~(128 | 4096 | 8192 | 32768 | 65536 | 1024 | 2048 | 524288);
  end if;
  return v_perms;
end;
$$;

-- --------------------------------------------------------------- realtime ----
do $$
declare t text;
begin
  foreach t in array array['member_warnings', 'banned_media', 'custom_badges'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------- grants ----
grant select on public.banned_media, public.member_warnings, public.server_audit_log to authenticated;
grant select on public.custom_badges to anon, authenticated;
revoke execute on function
  public.is_server_moderator(uuid, uuid), public.server_reports(uuid, text), public.handle_server_report(uuid, text, text),
  public.can_read_evidence(text), public.can_ban_media(uuid), public.ban_media(uuid, text, boolean),
  public.can_design_badges(), public.save_custom_badge(text, text, text, text), public.delete_custom_badge(text),
  public.can_moderate(uuid, uuid, bigint), public.timeout_member(uuid, uuid, integer, text),
  public.warn_member(uuid, uuid, text), public.ack_warning(uuid), public.audit(uuid, text, uuid, uuid, jsonb),
  public.audit_trigger(), public.delete_server(uuid), public.restore_server(uuid),
  public.request_account_deletion(), public.cancel_account_deletion(), public.purge_deleted(),
  public.mfa_ok(), public.export_my_data()
from public, anon, authenticated;
grant execute on function
  public.is_server_moderator(uuid, uuid), public.server_reports(uuid, text), public.handle_server_report(uuid, text, text),
  public.can_read_evidence(text), public.can_ban_media(uuid), public.ban_media(uuid, text, boolean),
  public.can_design_badges(), public.save_custom_badge(text, text, text, text), public.delete_custom_badge(text),
  public.timeout_member(uuid, uuid, integer, text), public.warn_member(uuid, uuid, text), public.ack_warning(uuid),
  public.delete_server(uuid), public.restore_server(uuid),
  public.request_account_deletion(), public.cancel_account_deletion(), public.mfa_ok(), public.export_my_data()
to authenticated;


-- =============================================================================
-- ============ profiles & groups (20261008000000_profiles_groups.sql)
-- =============================================================================
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
  ('scheduled delivery job',   exists (select 1 from pg_extension where extname = 'pg_cron')),
  ('server templates',         has_function_privilege('authenticated', 'public.create_server(text,text,text)', 'execute')),
  ('invite page',              has_function_privilege('anon', 'public.invite_preview(text)', 'execute')),
  ('custom emoji & sounds',    has_table_privilege('authenticated', 'public.server_expressions', 'insert')),
  ('discovery applications',   has_function_privilege('authenticated', 'public.apply_for_discovery(uuid,text,text[],text)', 'execute')),
  ('forums, stages, news',     exists (select 1 from pg_constraint where conname = 'channels_type_check' and pg_get_constraintdef(oid) like '%stage%')),
  ('status page',              has_function_privilege('anon', 'public.status_ping()', 'execute')),
  ('bots & applications',      has_function_privilege('authenticated', 'public.create_application(text,text)', 'execute')),
  ('bot API',                  has_function_privilege('anon', 'public.bot_api(text,text,jsonb)', 'execute')),
  ('Voogle verification',      has_function_privilege('authenticated', 'public.voogle_verify(uuid,text,text)', 'execute')),
  ('Voogle data locked',       not has_table_privilege('authenticated', 'public.voogle_signals', 'select')),
  ('timeouts & warnings',      has_function_privilege('authenticated', 'public.timeout_member(uuid,uuid,integer,text)', 'execute')),
  ('server audit log',         has_table_privilege('authenticated', 'public.server_audit_log', 'select')),
  ('report pictures bucket',   exists (select 1 from storage.buckets where id = 'report-evidence' and not public)),
  ('custom badges bucket',     exists (select 1 from storage.buckets where id = 'badges' and public)),
  ('server recycle bin',       has_function_privilege('authenticated', 'public.restore_server(uuid)', 'execute')),
  ('purge job (pg_cron)',      exists (select 1 from pg_extension where extname = 'pg_cron')),
  ('profile pictures bucket',  exists (select 1 from storage.buckets where id = 'avatars' and public)),
  ('groups of 15 + invites',   has_function_privilege('authenticated', 'public.join_group(text)', 'execute'))
) as t(item, ok);

-- -----------------------------------------------------------------------------
-- -----------------------------------------------------------------------------
-- Wordle + Venband bot presets (mirrors 20261013000000 + 20261014000000).
-- Preset bots surface their commands in the / autocomplete and answer them
-- inside use_bot_command below.
-- -----------------------------------------------------------------------------

alter table public.applications
  add column if not exists banner_url text check (banner_url is null or char_length(banner_url) <= 500);

alter table public.applications
  drop constraint if exists applications_preset_check,
  add constraint applications_preset_check check (preset in ('custom', 'verification', 'management', 'site', 'wordle', 'venband'));

alter function public.create_application(text, text) set search_path = '';
create or replace function public.create_application(p_name text, p_preset text default 'custom')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.account_can('create') then raise exception 'your account can''t create applications right now'; end if;
  if (select count(*) from public.applications where owner_id = auth.uid()) >= 25 then
    raise exception 'you can have up to 25 applications';
  end if;
  insert into public.applications (owner_id, name, preset, description, color)
  values (auth.uid(), btrim(p_name), coalesce(p_preset, 'custom'),
          case p_preset
            when 'verification' then 'Keeps alt accounts and raiders out with Voogle verification.'
            when 'management' then 'Welcomes new members, gives them roles and logs joins and leaves.'
            when 'site' then 'Posts updates from your website or service into a channel.'
            when 'wordle' then 'A shared Wordle game for your channel — six guesses at a five-letter word.'
            when 'venband' then 'A moderation toolkit for staff — purge, ban, kick, lock channels and profile members.'
            else '' end,
          case p_preset when 'verification' then '#3ba55d' when 'management' then '#5865f2'
                        when 'site' then '#eb459e' when 'wordle' then '#6aaa64'
                        when 'venband' then '#ed4245' else '#7c5cff' end)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.preset_settings(p_preset text)
returns jsonb language sql immutable set search_path = '' as $$
  select case p_preset
    when 'management' then '{"welcome_text": "Welcome {user} to **{server}**! 👋", "auto_roles": []}'::jsonb
    when 'verification' then '{"required": true, "max_accounts": 3, "block_ban_evasion": true, "min_account_days": 0}'::jsonb
    when 'wordle' then '{}'::jsonb
    when 'venband' then '{}'::jsonb
    else '{}'::jsonb end;
$$;

create table if not exists public.wordle_words (
  word text primary key check (word ~ '^[a-z]{5}$')
);
insert into public.wordle_words (word) values
  ('table'), ('crane'), ('slate'), ('other'), ('stone'), ('given'), ('water'), ('woman'),
  ('those'), ('there'), ('while'), ('world'), ('house'), ('place'), ('point'), ('group'),
  ('money'), ('music'), ('night'), ('light'), ('great'), ('paper'), ('watch'), ('think'),
  ('wrong'), ('whole'), ('again'), ('board'), ('early'), ('force'), ('learn'), ('clear'),
  ('plant'), ('power'), ('small'), ('sound'), ('total'), ('carry'), ('dream'), ('grass'),
  ('party'), ('juice'), ('cloud'), ('green'), ('queen'), ('quick'), ('plane'), ('fresh'),
  ('tiger'), ('honey'), ('youth'), ('chair'), ('drama'), ('grain'), ('ivory'), ('mango'),
  ('noble'), ('olive'), ('paint'), ('quiet'), ('radar'), ('sauce'), ('towel'), ('vague'),
  ('whale'), ('zebra'), ('globe'), ('flame'), ('pizza'), ('beach'), ('storm'), ('frost'),
  ('sugar'), ('bread'), ('grape'), ('camel'), ('donut'), ('eagle'), ('fable'), ('giant'),
  ('hound'), ('irony'), ('jolly'), ('knots'), ('lunar'), ('marsh'), ('novel'), ('orbit'),
  ('piano'), ('raven'), ('swift'), ('toast'), ('unite'), ('valor'), ('weary'), ('yield')
on conflict (word) do nothing;

create table if not exists public.wordle_games (
  channel_id uuid primary key references public.channels (id) on delete cascade,
  word text not null,
  state jsonb not null default '{"guesses": []}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.wordle_feedback(p_guess text, p_word text)
returns text language sql immutable strict set search_path = '' as $$
  select string_agg(case when substr(p_guess, i, 1) = substr(p_word, i, 1) then '🟩'
                         when position(substr(p_guess, i, 1) in p_word) > 0 then '🟨'
                         else '⬛' end, '' order by i)
  from generate_series(1, 5) i;
$$;

create or replace function public.wordle_command(p_app uuid, p_channel uuid, p_cmd text, p_args text default '')
returns text language plpgsql security definer set search_path = '' as $$
declare
  g public.wordle_games%rowtype;
  v_guess text;
  v_fb text;
  v_hist text;
  v_n int;
begin
  if p_cmd in ('wordle', 'start') then
    if exists (select 1 from public.wordle_games where channel_id = p_channel) then
      return 'There’s already a Wordle running in this channel. Type **/guess WORD** to play!';
    end if;
    select w.word into v_guess from public.wordle_words w order by random() limit 1;
    if v_guess is null then raise exception 'no words loaded'; end if;
    insert into public.wordle_games (channel_id, word) values (p_channel, v_guess);
    perform public.bot_post(p_app, p_channel, '', jsonb_build_object('title', '🎯 Wordle started!',
      'description', 'Guess the 5-letter word with **/guess WORD**. Six guesses total.',
      'color', '#6aaa64'));
    return 'posted';
  end if;
  if p_cmd = 'guess' then
    select * into g from public.wordle_games where channel_id = p_channel for update;
    if not found then return 'No game running here — start one with **/wordle**.'; end if;
    v_guess := lower(btrim(p_args));
    if not v_guess ~ '^[a-z]{5}$' then return 'A guess is exactly 5 letters, like **/guess table**.'; end if;
    v_fb := public.wordle_feedback(v_guess, g.word);
    v_hist := (select string_agg(x, E'\n') from jsonb_array_elements_text(g.state -> 'guesses') x);
    v_hist := case when v_hist is null then v_fb else v_hist || E'\n' || v_fb end;
    update public.wordle_games
      set state = jsonb_set(
        jsonb_set(g.state, '{guesses}', (g.state -> 'guesses') || jsonb_build_array(v_fb), true),
        '{won}', to_jsonb(v_guess = g.word), true)
      where channel_id = p_channel;
    select jsonb_array_length(state -> 'guesses') into v_n from public.wordle_games where channel_id = p_channel;
    if v_guess = g.word then
      delete from public.wordle_games where channel_id = p_channel;
      return v_hist || E'\n🎉 Solved in ' || v_n::text || ' ' || case when v_n = 1 then 'guess' else 'guesses' end || '!';
    end if;
    if v_n >= 6 then
      delete from public.wordle_games where channel_id = p_channel;
      return v_hist || E'\n😵 Out of guesses — the word was **' || g.word || '**. Start a new one with **/wordle**.';
    end if;
    return v_hist || E'\n' || (6 - v_n)::text || ' guess' || case when (6 - v_n) = 1 then '' else 'es' end || ' left.';
  end if;
  return 'unknown command';
end;
$$;

create or replace function public.preset_commands(p_preset text)
returns table (name text, description text) language sql immutable set search_path = '' as $$
  select v.n, v.d from (values ('management', 'serverinfo', 'Show information about this server'),
                        ('management', 'rules', 'Post the server rules'),
                        ('verification', 'verify', 'Get your Voogle verification link'),
                        ('wordle', 'wordle', 'Start a shared Wordle game in this channel'),
                        ('wordle', 'guess', 'Guess a 5-letter word, like /guess table'),
                        ('venband', 'serverinfo', 'Show information about this server'),
                        ('venband', 'info', 'Show someone''s profile card, like /info @user (defaults to you)'),
                        ('venband', 'purge', 'Delete the last N messages, like /purge 10'),
                        ('venband', 'ban', 'Ban a member, like /ban @user reason'),
                        ('venband', 'kick', 'Kick a member, like /kick @user reason'),
                        ('venband', 'lock', 'Lock this channel — only roles above @everyone can talk'),
                        ('venband', 'unlock', 'Unlock this channel again')) v(p, n, d)
  where v.p = p_preset;
$$;

create or replace function public.venband_target(p_args text)
returns uuid language sql immutable set search_path = '' as $$
  select case
    when m[1] is not null then m[1]::uuid
    when m[2] is not null then (select id from public.profiles where username = lower(m[2]))
    else null end
  from (select regexp_match(coalesce(p_args, ''),
        '^[[:space:]]*(?:<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>|@([a-z0-9_.]{2,32}))') m) x;
$$;

revoke execute on function public.venband_target(text) from public, anon, authenticated;

create or replace function public.use_bot_command(p_channel uuid, p_app uuid, p_command text, p_args text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_server uuid;
  a public.applications%rowtype;
  s public.servers%rowtype;
  v_id uuid;
  v_cmd text := lower(btrim(p_command));
begin
  select server_id into v_server from public.channels where id = p_channel;
  if v_server is null or not public.channel_has_permission(p_channel, 128) then raise exception 'you can''t use commands here'; end if;
  select * into a from public.applications where id = p_app;
  if not found or a.status <> 'active' or not exists (select 1 from public.server_bots where server_id = v_server and app_id = p_app) then
    raise exception 'that bot isn''t in this server';
  end if;
  if (select count(*) from public.bot_interactions where user_id = auth.uid() and created_at > now() - interval '10 seconds') >= 5 then
    raise exception 'slow down a little';
  end if;
  insert into public.bot_interactions (app_id, server_id, channel_id, user_id, command, args)
  values (p_app, v_server, p_channel, auth.uid(), v_cmd, left(coalesce(p_args, ''), 1000))
  returning id into v_id;
  select * into s from public.servers where id = v_server;
  if a.preset = 'management' and v_cmd = 'serverinfo' then
    perform public.bot_post(p_app, p_channel, '', jsonb_build_object('title', s.name, 'description', coalesce(nullif(s.description, ''), 'No description yet.'),
      'fields', jsonb_build_array(jsonb_build_object('name', 'Members', 'value', public.member_count(v_server)::text),
                                  jsonb_build_object('name', 'Created', 'value', to_char(s.created_at, 'Mon DD, YYYY')),
                                  jsonb_build_object('name', 'Channels', 'value', (select count(*) from public.channels where server_id = v_server)::text))),
      null, v_id);
  elsif a.preset = 'management' and v_cmd = 'rules' then
    perform public.bot_post(p_app, p_channel, case when cardinality(s.rules) = 0 then 'This server has no rules set yet.'
      else (select string_agg(i || '. ' || r, E'\n') from unnest(s.rules) with ordinality as t(r, i)) end, null, null, v_id);
  elsif a.preset = 'verification' and v_cmd = 'verify' then
    perform public.bot_post(p_app, p_channel, '<@' || auth.uid() || '> verify here: https://www.venband.com/voogle?server=' || v_server, null, null, v_id);
  elsif a.preset = 'wordle' and v_cmd in ('wordle', 'start', 'guess') then
    perform public.bot_post(p_app, p_channel, public.wordle_command(p_app, p_channel, v_cmd, coalesce(p_args, '')), null, null, v_id);
  elsif a.preset = 'venband' then
    <<vb>> declare
      v_u uuid;
      v_name text;
      v_reason text;
      v_match text[];
      v_n integer;
      v_role uuid;
      v_display text;
      v_username text;
      v_about text;
      v_color text;
      v_joined text;
      v_roles text;
      v_created text;
    begin
      if v_cmd = 'serverinfo' then
        perform public.bot_post(p_app, p_channel, '',
          jsonb_build_object('title', s.name, 'description', coalesce(nullif(s.description, ''), 'No description yet.'),
            'color', s.icon_color,
            'fields', jsonb_build_array(
              jsonb_build_object('name', 'Members', 'value', public.member_count(v_server)::text),
              jsonb_build_object('name', 'Channels', 'value', (select count(*) from public.channels where server_id = v_server)::text),
              jsonb_build_object('name', 'Created', 'value', to_char(s.created_at, 'Mon DD, YYYY')),
              jsonb_build_object('name', 'Owner', 'value', coalesce((select '@' || username from public.profiles where id = s.owner_id), '—')))), null, v_id);
      elsif v_cmd = 'info' then
        v_u := coalesce(public.venband_target(p_args), auth.uid());
        select p.display_name, p.username, p.about, p.avatar_color,
               (select to_char(m.joined_at, 'Mon DD, YYYY') from public.server_members m where m.server_id = v_server and m.user_id = p.id),
               (select string_agg(r.name, ', ' order by r.position desc) from public.member_roles mr join public.roles r on r.id = mr.role_id where mr.server_id = v_server and mr.user_id = p.id),
               to_char(p.created_at, 'Mon DD, YYYY')
          into v_display, v_username, v_about, v_color, v_joined, v_roles, v_created
          from public.profiles p where p.id = v_u;
        if not found then raise exception 'user not found'; end if;
        perform public.bot_post(p_app, p_channel, '',
          jsonb_build_object('title', v_display, 'color', v_color,
            'fields', jsonb_build_array(
              jsonb_build_object('name', 'Username', 'value', '@' || v_username),
              jsonb_build_object('name', 'About', 'value', case when coalesce(v_about, '') = '' then '—' else v_about end),
              jsonb_build_object('name', 'Joined this server', 'value', coalesce(v_joined, 'Not a member')),
              jsonb_build_object('name', 'Roles', 'value', coalesce(v_roles, 'None')),
              jsonb_build_object('name', 'Profile created', 'value', v_created))), null, v_id);
      elsif v_cmd = 'purge' then
        v_match := regexp_match(coalesce(p_args, ''), '^[[:space:]]*([0-9]{1,3})[[:space:]]*$');
        if v_match is null then
          perform public.bot_post(p_app, p_channel, '', jsonb_build_object('title', 'Usage', 'color', '#99aab5',
            'description', '**/purge N** — deletes the last N messages in this channel (up to 50).'), null, v_id);
        else
          v_n := least(greatest(v_match[1]::int, 1), 50);
          if not public.channel_has_permission(p_channel, 256) then
            raise exception 'you need the Manage Messages permission to purge messages';
          end if;
          delete from public.messages where id in (
            select id from public.messages where channel_id = p_channel order by created_at desc limit v_n);
          perform public.bot_post(p_app, p_channel, '', jsonb_build_object('title', 'Purged', 'color', '#ff6b81',
            'description', 'Deleted ' || v_n || ' message' || case when v_n = 1 then '' else 's' end || ' in this channel.'), null, v_id);
        end if;
      elsif v_cmd in ('ban', 'kick') then
        v_match := regexp_match(coalesce(p_args, ''),
          '^[[:space:]]*(?:<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>|@([a-z0-9_.]{2,32}))(?:[[:space:]]+(.*))?$');
        v_u := case when v_match is null then null
                    when v_match[1] is not null then v_match[1]::uuid
                    else (select id from public.profiles where username = v_match[2]) end;
        v_reason := coalesce(v_match[3], '');
        if v_u is null then
          perform public.bot_post(p_app, p_channel, '', jsonb_build_object('title', 'Usage', 'color', '#99aab5', 'description',
            case when v_cmd = 'ban' then '**/ban @user reason** — bans a member and stops them rejoining.'
                 else '**/kick @user reason** — removes a member from the server.' end), null, v_id);
        else
          if v_u = auth.uid() then raise exception using message = 'you can''t ' || v_cmd || ' yourself'; end if;
          if v_u = s.owner_id then raise exception using message = 'you can''t ' || v_cmd || ' the server owner'; end if;
          if v_cmd = 'ban' and not public.has_permission(v_server, 32) then
            raise exception 'you need the Ban Members permission to use /ban';
          end if;
          if v_cmd = 'kick' and not public.has_permission(v_server, 16) then
            raise exception 'you need the Kick Members permission to use /kick';
          end if;
          if exists (select 1 from public.server_members where server_id = v_server and user_id = v_u)
             and public.member_top_position(v_server, v_u) >= public.member_top_position(v_server) then
            raise exception 'that member has a role as high as or higher than yours';
          end if;
          select coalesce(display_name, username) into v_name from public.profiles where id = v_u;
          if v_cmd = 'ban' then
            insert into public.bans (server_id, user_id, banned_by, reason)
            values (v_server, v_u, auth.uid(), left(v_reason, 512))
            on conflict (server_id, user_id) do update set reason = excluded.reason, banned_by = excluded.banned_by;
          else
            delete from public.server_members where server_id = v_server and user_id = v_u;
          end if;
          perform public.bot_post(p_app, p_channel, '', jsonb_build_object(
            'title', case when v_cmd = 'ban' then 'Banned' else 'Kicked' end,
            'description', '**' || v_name || '** was ' || v_cmd || '.',
            'color', case when v_cmd = 'ban' then '#ff4757' else '#ffa502' end,
            'fields', jsonb_build_array(jsonb_build_object('name', 'Reason', 'value',
              case when v_reason = '' then 'No reason provided.' else v_reason end))), null, v_id);
        end if;
      elsif v_cmd in ('lock', 'unlock') then
        if not public.has_permission(v_server, 8) then raise exception 'you need the Manage Channels permission to lock channels'; end if;
        select id into v_role from public.roles where server_id = v_server and is_default;
        if v_role is null then raise exception 'this server has no @everyone role'; end if;
        if v_cmd = 'lock' then
          if exists (select 1 from public.channel_overwrites where channel_id = p_channel and category is null and target_type = 'role' and target_id = v_role) then
            update public.channel_overwrites set deny = 128, allow = 0, server_id = v_server
            where channel_id = p_channel and category is null and target_type = 'role' and target_id = v_role;
          else
            insert into public.channel_overwrites (server_id, channel_id, target_type, target_id, allow, deny)
            values (v_server, p_channel, 'role', v_role, 0, 128);
          end if;
          perform public.bot_post(p_app, p_channel, '', jsonb_build_object('title', 'Channel locked', 'color', '#ffa502',
            'description', 'Only members with roles above @everyone can talk in this channel now.'), null, v_id);
        else
          delete from public.channel_overwrites where channel_id = p_channel and category is null and target_type = 'role' and target_id = v_role;
          perform public.bot_post(p_app, p_channel, '', jsonb_build_object('title', 'Channel unlocked', 'color', '#2ed573',
            'description', 'Everyone can talk in this channel again.'), null, v_id);
        end if;
      else
        return jsonb_build_object('status', 'queued', 'id', v_id);
      end if;
    end;
  else
    return jsonb_build_object('status', 'queued', 'id', v_id);
  end if;
  update public.bot_interactions set handled = true where id = v_id;
  return jsonb_build_object('status', 'handled', 'id', v_id);
end;
$$;

-- Execution surface: preset-command functions follow the same posture as the
-- other bot functions (authenticated only).
revoke execute on function public.use_bot_command(uuid, uuid, text, text), public.preset_commands(text) from public, anon;
grant execute on function public.use_bot_command(uuid, uuid, text, text), public.preset_commands(text) to authenticated;

-- =============================================================================
-- ================= Venband bot DMs (20261015000000_venband_notice.sql)
-- =============================================================================
-- When a moderator restricts an account (limited / very_limited / banned), the
-- Venband bot sends a plain DM to the user with the reason (and the attached
-- server, when there is one). Bot messages are not end-to-end encrypted, so
-- they can live in a DM channel between the "Venband" profile and the user.

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
-- Drop the old 3-arg overload so named calls resolve to this one without error.
drop function if exists public.mod_set_account_status(uuid, text, text);
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

-- =============================================================================
-- ============ account deletion (20261016000000_account_deletion.sql)
-- =============================================================================
-- Typing the exact phrase "I want to delete my account" permanently deletes
-- the account and everything tied to it: 1:1 DMs, files in object storage,
-- and — cascading from auth.users → profiles — profile, username, email,
-- messages, keys, friends and memberships. The old 14-day grace path
-- (request/cancel_account_deletion, deletion_requested_at) is removed.
create or replace function public.delete_my_account(p_confirm text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if btrim(coalesce(p_confirm, '')) <> 'I want to delete my account' then
    raise exception using message = 'type the exact phrase to confirm';
  end if;

  -- Deleted servers are already on their way out; let the account go with them.
  delete from public.servers where owner_id = v_uid and status = 'deleted';
  if exists (select 1 from public.servers where owner_id = v_uid) then
    raise exception using message = 'transfer or delete the servers you own first';
  end if;

  -- 1:1 DMs: gone, for both people.
  delete from public.channels c
  where c.type = 'dm' and c.server_id is null and not c.is_group
    and exists (select 1 from public.dm_participants d
                where d.channel_id = c.id and d.user_id = v_uid);

  -- Group chats: the user no longer participates (their messages and channel
  -- keys are cleaned up when the profile cascades away).
  delete from public.dm_participants where user_id = v_uid;

  -- Files, avatars and banners uploaded to object storage.
  delete from storage.objects where owner = v_uid;

  -- Everything else cascades from auth.users -> profiles.
  delete from auth.users where id = v_uid;
end;
$$;

revoke execute on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;

drop function if exists public.cancel_account_deletion();
drop function if exists public.request_account_deletion();
alter table public.profiles drop column if exists deletion_requested_at;

-- purge_deleted() now only reclaims deleted servers (it used to fire the
-- 14-day account purge too).
create or replace function public.purge_deleted()
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.servers where status = 'deleted' and deleted_at < now() - interval '7 days';
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'venband-purge-deleted';
    perform cron.schedule('venband-purge-deleted', '17 * * * *', 'select public.purge_deleted()');
  end if;
exception when others then
  raise notice 'pg_cron not available: deleted servers will be purged once it is turned on';
end $$;

-- export_my_data() referenced the dropped column; include the full profile row.
create or replace function public.export_my_data()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'exported_at', now(),
    'note', 'Messages are end-to-end encrypted; export a conversation from its menu to get readable copies.',
    'profile', (select to_jsonb(p) from public.profiles p where p.id = auth.uid()),
    'email', (select email from auth.users where id = auth.uid()),
    'settings', (select to_jsonb(s) from public.user_settings s where s.user_id = auth.uid()),
    'friends', (select coalesce(jsonb_agg(jsonb_build_object('user', case when f.user_a = auth.uid() then f.user_b else f.user_a end,
                                                            'accepted', f.accepted, 'since', f.created_at)), '[]')
                from public.friendships f where auth.uid() in (f.user_a, f.user_b)),
    'servers', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'joined_at', m.joined_at, 'owner', s.owner_id = auth.uid())), '[]')
                from public.server_members m join public.servers s on s.id = m.server_id where m.user_id = auth.uid()),
    'reports_filed', (select coalesce(jsonb_agg(jsonb_build_object('kind', r.kind, 'reason', r.reason, 'status', r.status, 'at', r.created_at)), '[]')
                      from public.reports r where r.reporter_id = auth.uid()),
    'warnings', (select coalesce(jsonb_agg(jsonb_build_object('server', w.server_id, 'reason', w.reason, 'at', w.created_at)), '[]')
                 from public.member_warnings w where w.user_id = auth.uid()),
    'applications', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'preset', a.preset, 'created_at', a.created_at)), '[]')
                     from public.applications a where a.owner_id = auth.uid()),
    'voogle', (select coalesce(jsonb_agg(jsonb_build_object('server', v.server_id, 'result', v.result, 'at', v.updated_at)), '[]')
               from public.voogle_verifications v where v.user_id = auth.uid()),
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('signed_in', s.created_at, 'last_active', coalesce(s.refreshed_at::timestamptz, s.updated_at))), '[]')
                from auth.sessions s where s.user_id = auth.uid())
  );
$$;

-- =============================================================================
-- ============ banned login (20261017000000_banned_login.sql)
-- =============================================================================
-- resolve_login() now also reports the matching account's username and whether
-- it is banned, so the sign-in form can show "You are banned on @username"
-- instead of a generic password error. It still only resolves an existing
-- account — never reveals who has an account unless the identifier matches.
drop function if exists public.resolve_login(text);
create or replace function public.resolve_login(p_identifier text)
returns table (email text, username text, banned boolean)
language sql
security definer
stable
set search_path = ''
as $$
  select u.email, p.username,
         (u.banned_until is not null or p.account_status = 'banned') as banned
  from auth.users u
  join public.profiles p on p.id = u.id
  where (p.username = lower(btrim(p_identifier)) and p_identifier ~ '^[a-z0-9_.]{2,32}$')
     or (lower(u.email) = lower(btrim(p_identifier)) and position('@' in p_identifier) > 0)
$$;

grant execute on function public.resolve_login(text) to anon, authenticated;

-- =============================================================================
-- ============ bot directory (20261018000000_bot_directory.sql)
-- =============================================================================
-- Server Settings → Integrations & Bots: staff browse every active bot — with
-- the official Venband bot pinned first — and add one to their server directly,
-- without pasting invite codes.
drop function if exists public.bot_directory(uuid);
create or replace function public.bot_directory(p_server uuid)
returns table (id uuid, owner_id uuid, name text, description text, preset text,
               icon_url text, banner_url text, color text, token_hint text,
               status text, created_at timestamptz,
               installs bigint, installed boolean, requested boolean)
language sql stable security definer set search_path = '' as $$
  select a.id, a.owner_id, a.name, a.description, a.preset, a.icon_url, a.banner_url,
         a.color, null::text, a.status, a.created_at,
         count(sb.server_id)::bigint,
         exists (select 1 from public.server_bots x where x.server_id = p_server and x.app_id = a.id),
         exists (select 1 from public.bot_join_requests r where r.server_id = p_server and r.app_id = a.id)
  from public.applications a
  left join public.server_bots sb on sb.app_id = a.id
  where a.status = 'active' and public.is_server_member(p_server)
  group by a.id
  order by (a.preset = 'venband') desc, count(sb.server_id) desc, a.created_at
$$;

revoke execute on function public.bot_directory(uuid) from public, anon;
grant execute on function public.bot_directory(uuid) to authenticated;

create or replace function public.bot_add_to_server(p_app uuid, p_server uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if (select status from public.servers where id = p_server) <> 'active' then raise exception 'this server is not available right now'; end if;
  if not public.has_permission(p_server, 16777216) then raise exception 'you need Manage Integrations here'; end if;
  if (select status from public.applications where id = p_app) <> 'active' then raise exception 'this application is disabled'; end if;
  if exists (select 1 from public.server_bots where server_id = p_server and app_id = p_app) then
    return jsonb_build_object('status', 'already');
  end if;
  perform public.install_bot(p_server, p_app, auth.uid());
  return jsonb_build_object('status', 'joined');
end;
$$;

revoke execute on function public.bot_add_to_server(uuid, uuid) from public, anon;
grant execute on function public.bot_add_to_server(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Owner + founder powers. Top staff (platform owners or the owner/founder
-- badge) manage any bot, delete/restore any server, act on any account and
-- erase whole accounts. They can never target each other.
-- -----------------------------------------------------------------------------
create or replace function public.is_staff(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select public.platform_rank(p_user) >= 1
      or exists (select 1 from public.profiles where id = p_user
                 and badges && array['owner', 'founder']);
$$;

create or replace function public.is_top_staff(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select public.platform_rank(p_user) >= 3
      or exists (select 1 from public.profiles where id = p_user
                 and badges && array['owner', 'founder']);
$$;

revoke execute on function public.is_top_staff(uuid) from public, anon;
grant execute on function public.is_top_staff(uuid) to authenticated;

create or replace function public.mod_can_target(p_target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (public.is_staff() and public.platform_rank() > public.platform_rank(p_target))
      or (p_target = auth.uid() and public.platform_rank() = 3)
      or (public.is_top_staff() and p_target <> auth.uid() and not public.is_top_staff(p_target));
$$;

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

  delete from public.servers where owner_id = p_user;

  delete from public.channels c
  where c.type = 'dm' and c.server_id is null and not c.is_group
    and exists (select 1 from public.dm_participants d
                where d.channel_id = c.id and d.user_id = p_user);

  delete from public.dm_participants where user_id = p_user;

  delete from storage.objects where owner = p_user;

  delete from auth.users where id = p_user;
  if not found then raise exception 'no account with that id'; end if;
end;
$$;

revoke execute on function public.delete_account(uuid) from public, anon;
grant execute on function public.delete_account(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Force contact: admins/owners/founders can't be blocked out of DMs and can
-- clear a block someone placed on them (rule-breakers can't run away).
-- -----------------------------------------------------------------------------
create or replace function public.can_force_contact(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select public.platform_rank(p_user) >= 2
      or (select badges && array['owner', 'founder'] from public.profiles where id = p_user);
$$;

revoke execute on function public.can_force_contact(uuid) from public, anon;
grant execute on function public.can_force_contact(uuid) to authenticated;

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

create or replace function public.dm_blocked(p_channel uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_force_contact(p_user)
     or exists (
       select 1 from public.channels c
       join public.dm_participants o on o.channel_id = c.id and o.user_id <> p_user
       where c.id = p_channel and c.type = 'dm' and not c.is_group
         and public.is_blocked_between(o.user_id, p_user));
$$;

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

-- -----------------------------------------------------------------------------
-- set_username: change your username anytime (same rules as signup).
-- -----------------------------------------------------------------------------
create or replace function public.set_username(p_username text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v text := lower(btrim(coalesce(p_username, '')));
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.username_available(v) then
    raise exception 'that username is taken or invalid';
  end if;
  update public.profiles set username = v where id = auth.uid();
  if not found then raise exception 'profile not found'; end if;
end;
$$;

revoke execute on function public.set_username(text) from public, anon;
grant execute on function public.set_username(text) to authenticated;

-- -----------------------------------------------------------------------------
-- App discovery + command builder + bot templates.
-- -----------------------------------------------------------------------------
alter table public.applications add column if not exists tags text[]
  not null default '{}' check (cardinality(tags) <= 12);
grant select (tags) on public.applications to authenticated;
grant update (tags) on public.applications to authenticated;

-- The tags people actually discover (preset defaults when none are set).
create or replace function public.app_tags(p_app uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select case when cardinality(nullif(a.tags, '{}')) > 0 then a.tags
              else case a.preset
                when 'management' then array['servermanagement', 'welcome', 'roles', 'logging']
                when 'verification' then array['verification', 'voogle', 'antiraid']
                when 'site' then array['webhooks', 'announcements']
                when 'wordle' then array['games', 'wordle']
                when 'venband' then array['moderation', 'staff', 'utility']
                else array[]::text[] end end
  from public.applications a where a.id = p_app;
$$;
revoke execute on function public.app_tags(uuid) from public, anon, authenticated;

-- New apps come pre-tagged, but owners can change their tags anytime.
create or replace function public.create_application(p_name text, p_preset text default 'custom')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.account_can('create') then raise exception 'your account can''t create applications right now'; end if;
  if (select count(*) from public.applications where owner_id = auth.uid()) >= 25 then
    raise exception 'you can have up to 25 applications';
  end if;
  insert into public.applications (owner_id, name, preset, description, color, tags)
  values (auth.uid(), btrim(p_name), coalesce(p_preset, 'custom'),
          case p_preset
            when 'verification' then 'Keeps alt accounts and raiders out with Voogle verification.'
            when 'management' then 'Welcomes new members, gives them roles and logs joins and leaves.'
            when 'site' then 'Posts updates from your website or service into a channel.'
            when 'wordle' then 'A shared Wordle game for your channel — six guesses at a five-letter word.'
            when 'venband' then 'A moderation toolkit for staff — purge, ban, kick, lock channels and profile members.'
            else '' end,
          case p_preset when 'verification' then '#3ba55d' when 'management' then '#5865f2'
                        when 'site' then '#eb459e' when 'wordle' then '#6aaa64'
                        when 'venband' then '#ed4245' else '#7c5cff' end,
          case p_preset when 'management' then array['servermanagement', 'welcome']
                        when 'verification' then array['verification', 'voogle']
                        when 'site' then array['webhooks']
                        when 'wordle' then array['games', 'wordle']
                        when 'venband' then array['moderation', 'staff']
                        else array[]::text[] end)
  returning id into v_id;
  return v_id;
end;
$$;

-- Directory now advertises each app's tags too.
drop function if exists public.bot_directory(uuid);
create or replace function public.bot_directory(p_server uuid)
returns table (id uuid, owner_id uuid, name text, description text, preset text,
               icon_url text, banner_url text, color text, token_hint text,
               status text, created_at timestamptz, tags text[],
               installs bigint, installed boolean, requested boolean)
language sql stable security definer set search_path = '' as $$
  select a.id, a.owner_id, a.name, a.description, a.preset, a.icon_url, a.banner_url,
         a.color, null::text, a.status, a.created_at, public.app_tags(a.id),
         count(sb.server_id)::bigint,
         exists (select 1 from public.server_bots x where x.server_id = p_server and x.app_id = a.id),
         exists (select 1 from public.bot_join_requests r where r.server_id = p_server and r.app_id = a.id)
  from public.applications a
  left join public.server_bots sb on sb.app_id = a.id
  where a.status = 'active' and public.is_server_member(p_server)
  group by a.id
  order by (a.preset = 'venband') desc, count(sb.server_id) desc, a.created_at
$$;

-- A responder: what a command posts back and which actions it runs.
--   { "content": "...", "embed": {...}, "actions": ["kick"|"ban"|"purge"] }
-- {user}, {username}, {server}, {channel} and {args} are filled in per run.
alter table public.bot_commands add column if not exists response jsonb
  check (response is null or pg_column_size(response) < 6000);
grant select (app_id, name, description, response) on public.bot_commands to authenticated;

create or replace function public.clean_response(p jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select case when p is null or jsonb_typeof(p) <> 'object' then null else
    jsonb_build_object(
      'content', nullif(left(p ->> 'content', 2000), ''),
      'embed', public.clean_embed(p -> 'embed'),
      'actions', (select coalesce(jsonb_agg(x), '[]'::jsonb)
                  from (select x from jsonb_array_elements_text(
                          case when jsonb_typeof(p -> 'actions') = 'array' then p -> 'actions' else '[]'::jsonb end) x
                        where x in ('kick', 'ban', 'purge') limit 6) t)
    ) end;
$$;
revoke execute on function public.clean_response(jsonb) from public, anon, authenticated;

-- Save a bot's whole command list from its dashboard.
create or replace function public.bot_set_commands(p_app uuid, p_commands jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  c jsonb;
  v_name text;
  v_n integer := 0;
begin
  if coalesce(public.app_role(p_app), '') not in ('owner', 'admin') then
    raise exception 'only the owner or an admin can edit commands';
  end if;
  if jsonb_typeof(p_commands) <> 'array' or jsonb_array_length(p_commands) > 50 then
    raise exception 'commands must be a list of up to 50';
  end if;
  delete from public.bot_commands where app_id = p_app;
  for c in select * from jsonb_array_elements(p_commands) loop
    v_name := lower(btrim(coalesce(c ->> 'name', '')));
    if v_name !~ '^[a-z0-9_-]{1,32}$' then
      raise exception 'command names use a-z, 0-9, _ and - (1–32 characters)';
    end if;
    insert into public.bot_commands (app_id, name, description, response)
    values (p_app, v_name, left(coalesce(c ->> 'description', ''), 100),
            public.clean_response(c -> 'response'));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create table if not exists public.bot_templates (
  slug       text primary key,
  name       text not null,
  blurb      text not null default '',
  preset     text not null default 'custom',
  tags       text[] not null default '{}',
  commands   jsonb not null default '[]',
  created_at timestamptz not null default now()
);
alter table public.bot_templates enable row level security;
drop policy if exists bot_templates_read on public.bot_templates;
create policy bot_templates_read on public.bot_templates for select to anon, authenticated using (true);
grant select on public.bot_templates to anon, authenticated;

insert into public.bot_templates (slug, name, blurb, preset, tags, commands) values
('server-assistant', 'Server Assistant',
 'Welcomes members, answers ping and shows the rules.',
 'management', array['servermanagement', 'welcome', 'utility'],
 '[{"name":"ping","description":"Is the bot alive?","response":{"content":"Pong! 🏓"}},
   {"name":"serverinfo","description":"Show info about this server","response":{"embed":{"title":"{server}","color":"#5865f2","description":"A lovely server on Venband."}}},
   {"name":"rules","description":"Post the server rules","response":{"content":"The rules of **{server}**? Ask the staff or check Server Settings → Rules."}}]'::jsonb),
('gatekeeper', 'Gatekeeper',
 'A friendly verification wall using Voogle.',
 'verification', array['verification', 'voogle', 'antiraid'],
 '[{"name":"verify","description":"Get your Voogle verification link","response":{"content":"Type **/verify** or open the link on the welcome screen to get into {server}, {user}."}}]'::jsonb),
('moderator', 'Moderator',
 'Quick staff commands: clean chat, kick and ban.',
 'custom', array['moderation', 'staff', 'utility'],
 '[{"name":"ping","description":"Is the bot alive?","response":{"content":"Pong! 🏓"}},
   {"name":"cleanup","description":"Delete the last N messages, like /cleanup 10","response":{"content":"Cleaned up in {channel}.","actions":["purge"]}},
   {"name":"kick","description":"Kick a member, like /kick @user reason","response":{"content":"Done.","actions":["kick"]}},
   {"name":"ban","description":"Ban a member, like /ban @user reason","response":{"content":"Done.","actions":["ban"]}}]'::jsonb),
('page-herald', 'Page Herald',
 'Posts news from your website or store into a channel.',
 'site', array['webhooks', 'announcements', 'sites'],
 '[{"name":"help","description":"What this bot does","response":{"content":"I post updates from a website into {server}. A server admin sets the channel in Server Settings → Integrations."}},
   {"name":"status","description":"Is the feed healthy?","response":{"content":"All systems reporting in ✅."}}]'::jsonb)
on conflict (slug) do nothing;

create or replace function public.list_bot_templates()
returns table (slug text, name text, blurb text, preset text, tags text[], commands jsonb)
language sql stable security definer set search_path = '' as $$
  select t.slug, t.name, t.blurb, t.preset, t.tags, t.commands
  from public.bot_templates t order by t.created_at, t.slug;
$$;
revoke execute on function public.list_bot_templates() from public, anon;
grant execute on function public.list_bot_templates() to authenticated;

-- Copies a template's commands and tags onto one of your bots. Presets are
-- immutable, so only commands and discoverable tags are applied.
create or replace function public.apply_bot_template(p_app uuid, p_slug text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  t public.bot_templates%rowtype;
  c jsonb;
  v_n integer := 0;
begin
  if coalesce(public.app_role(p_app), '') not in ('owner', 'admin') then
    raise exception 'only the owner or an admin can do that';
  end if;
  select * into t from public.bot_templates where slug = p_slug;
  if not found then raise exception 'unknown template'; end if;
  delete from public.bot_commands where app_id = p_app;
  for c in select * from jsonb_array_elements(t.commands) loop
    insert into public.bot_commands (app_id, name, description, response)
    values (p_app, lower(btrim(coalesce(c ->> 'name', ''))),
            left(coalesce(c ->> 'description', ''), 100), public.clean_response(c -> 'response'));
    v_n := v_n + 1;
  end loop;
  update public.applications a
  set tags = (select array(select distinct x from unnest(coalesce(a.tags, '{}') || t.tags) x where x <> '' limit 12))
  where a.id = p_app;
  return v_n;
end;
$$;

-- Custom commands: when no preset already answers v_cmd, a stored responder
-- (reply + optional kick / ban / purge actions) runs instead. Actions check
-- the permissions of the person using the command, not the bot's.
create or replace function public.use_bot_command(p_channel uuid, p_app uuid, p_command text, p_args text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_server uuid;
  a public.applications%rowtype;
  s public.servers%rowtype;
  v_id uuid;
  v_cmd text := lower(btrim(p_command));
begin
  select server_id into v_server from public.channels where id = p_channel;
  if v_server is null or not public.channel_has_permission(p_channel, 128) then raise exception 'you can''t use commands here'; end if;
  select * into a from public.applications where id = p_app;
  if not found or a.status <> 'active' or not exists (select 1 from public.server_bots where server_id = v_server and app_id = p_app) then
    raise exception 'that bot isn''t in this server';
  end if;
  if (select count(*) from public.bot_interactions where user_id = auth.uid() and created_at > now() - interval '10 seconds') >= 5 then
    raise exception 'slow down a little';
  end if;
  insert into public.bot_interactions (app_id, server_id, channel_id, user_id, command, args)
  values (p_app, v_server, p_channel, auth.uid(), v_cmd, left(coalesce(p_args, ''), 1000))
  returning id into v_id;
  select * into s from public.servers where id = v_server;
  if a.preset = 'management' and v_cmd = 'serverinfo' then
    perform public.bot_post(p_app, p_channel, '', jsonb_build_object('title', s.name, 'description', coalesce(nullif(s.description, ''), 'No description yet.'),
      'fields', jsonb_build_array(jsonb_build_object('name', 'Members', 'value', public.member_count(v_server)::text),
                                  jsonb_build_object('name', 'Created', 'value', to_char(s.created_at, 'Mon DD, YYYY')),
                                  jsonb_build_object('name', 'Channels', 'value', (select count(*) from public.channels where server_id = v_server)::text))),
      null, v_id);
  elsif a.preset = 'management' and v_cmd = 'rules' then
    perform public.bot_post(p_app, p_channel, case when cardinality(s.rules) = 0 then 'This server has no rules set yet.'
      else (select string_agg(i || '. ' || r, E'\n') from unnest(s.rules) with ordinality as t(r, i)) end, null, null, v_id);
  elsif a.preset = 'verification' and v_cmd = 'verify' then
    perform public.bot_post(p_app, p_channel, '<@' || auth.uid() || '> verify here: https://www.venband.com/voogle?server=' || v_server, null, null, v_id);
  elsif a.preset = 'wordle' and v_cmd in ('wordle', 'start', 'guess') then
    perform public.bot_post(p_app, p_channel, public.wordle_command(p_app, p_channel, v_cmd, coalesce(p_args, '')), null, null, v_id);
  elsif exists (select 1 from public.bot_commands bc where bc.app_id = p_app and bc.name = v_cmd and bc.response is not null)
        and not exists (select 1 from public.preset_commands(a.preset) pc where pc.name = v_cmd) then
    <<custom>> declare
      r jsonb;
      v_content text;
      v_embed jsonb;
      v_u uuid;
      v_n integer;
      v_name text;
      v_target text;
      v_match text[];
    begin
      select response into r from public.bot_commands where app_id = p_app and name = v_cmd;
      v_content := replace(replace(replace(replace(replace(coalesce(r ->> 'content', ''),
                          '{user}', '<@' || auth.uid() || '>'), '{username}',
                          coalesce((select username from public.profiles where id = auth.uid()), '')),
                          '{server}', s.name), '{channel}',
                          (select name from public.channels where id = p_channel)), '{args}', coalesce(p_args, ''));
      v_embed := public.clean_embed(case when r -> 'embed' is null then null else
            jsonb_build_object('title', replace(coalesce((r -> 'embed') ->> 'title', ''), '{server}', s.name),
                               'description', replace(coalesce((r -> 'embed') ->> 'description', ''), '{args}', coalesce(p_args, '')),
                               'color', (r -> 'embed') ->> 'color',
                               'fields', (r -> 'embed') -> 'fields') end);
      for v_target in select jsonb_array_elements_text(coalesce(r -> 'actions', '[]'::jsonb)) loop
        if v_target = 'purge' then
          if not public.channel_has_permission(p_channel, 256) then
            raise exception 'you need the Manage Messages permission for that action';
          end if;
          v_match := regexp_match(coalesce(p_args, ''), '^[[:space:]]*([0-9]{1,3})');
          v_n := least(greatest(coalesce(nullif(v_match[1], ''), '1')::int, 1), 50);
          delete from public.messages where id in (
            select id from public.messages where channel_id = p_channel order by created_at desc limit v_n);
        elsif v_target in ('kick', 'ban') then
          v_u := public.venband_target(p_args);
          if v_u is null then raise exception 'mention a member, like @user or <@id>'; end if;
          if v_u = auth.uid() then raise exception 'you can''t do that to yourself'; end if;
          if v_u = s.owner_id then raise exception 'you can''t do that to the server owner'; end if;
          if v_target = 'ban' and not public.has_permission(v_server, 32) then
            raise exception 'you need the Ban Members permission for that action';
          end if;
          if v_target = 'kick' and not public.has_permission(v_server, 16) then
            raise exception 'you need the Kick Members permission for that action';
          end if;
          if public.is_server_member(v_server, v_u)
             and public.member_top_position(v_server, v_u) >= public.member_top_position(v_server) then
            raise exception 'that member has a role as high as or higher than yours';
          end if;
          select coalesce(display_name, username) into v_name from public.profiles where id = v_u;
          if v_target = 'ban' then
            insert into public.bans (server_id, user_id, banned_by, reason)
            values (v_server, v_u, auth.uid(), left(btrim(coalesce(p_args, '')), 512))
            on conflict (server_id, user_id) do update set reason = excluded.reason, banned_by = excluded.banned_by;
          else
            delete from public.server_members where server_id = v_server and user_id = v_u;
          end if;
          if nullif(btrim(v_content), '') is null then
            v_content := '**' || v_name || '** was ' || v_target || '.';
          end if;
        end if;
      end loop;
      if nullif(btrim(v_content), '') is null and v_embed is null then
        raise exception 'that command posts nothing';
      end if;
      perform public.bot_post(p_app, p_channel, nullif(btrim(v_content), ''), v_embed, null, v_id);
    end;
  elsif a.preset = 'venband' then
    <<vb>> declare
      v_u uuid;
      v_name text;
      v_reason text;
      v_match text[];
      v_n integer;
      v_role uuid;
      v_display text;
      v_username text;
      v_about text;
      v_color text;
      v_joined text;
      v_roles text;
      v_created text;
    begin
      if v_cmd = 'serverinfo' then
        perform public.bot_post(p_app, p_channel, '',
          jsonb_build_object('title', s.name, 'description', coalesce(nullif(s.description, ''), 'No description yet.'),
            'color', s.icon_color,
            'fields', jsonb_build_array(
              jsonb_build_object('name', 'Members', 'value', public.member_count(v_server)::text),
              jsonb_build_object('name', 'Channels', 'value', (select count(*) from public.channels where server_id = v_server)::text),
              jsonb_build_object('name', 'Created', 'value', to_char(s.created_at, 'Mon DD, YYYY')),
              jsonb_build_object('name', 'Owner', 'value', coalesce((select '@' || username from public.profiles where id = s.owner_id), '—')))), null, v_id);
      elsif v_cmd = 'info' then
        v_u := coalesce(public.venband_target(p_args), auth.uid());
        select p.display_name, p.username, p.about, p.avatar_color,
               (select to_char(m.joined_at, 'Mon DD, YYYY') from public.server_members m where m.server_id = v_server and m.user_id = p.id),
               (select string_agg(r.name, ', ' order by r.position desc) from public.member_roles mr join public.roles r on r.id = mr.role_id where mr.server_id = v_server and mr.user_id = p.id),
               to_char(p.created_at, 'Mon DD, YYYY')
          into v_display, v_username, v_about, v_color, v_joined, v_roles, v_created
          from public.profiles p where p.id = v_u;
        if not found then raise exception 'user not found'; end if;
        perform public.bot_post(p_app, p_channel, '',
          jsonb_build_object('title', v_display, 'color', v_color,
            'fields', jsonb_build_array(
              jsonb_build_object('name', 'Username', 'value', '@' || v_username),
              jsonb_build_object('name', 'About', 'value', case when coalesce(v_about, '') = '' then '—' else v_about end),
              jsonb_build_object('name', 'Joined this server', 'value', coalesce(v_joined, 'Not a member')),
              jsonb_build_object('name', 'Roles', 'value', coalesce(v_roles, 'None')),
              jsonb_build_object('name', 'Profile created', 'value', v_created))), null, v_id);
      elsif v_cmd = 'purge' then
        v_match := regexp_match(coalesce(p_args, ''), '^[[:space:]]*([0-9]{1,3})[[:space:]]*$');
        if v_match is null then
          perform public.bot_post(p_app, p_channel, '', jsonb_build_object('title', 'Usage', 'color', '#99aab5',
            'description', '**/purge N** — deletes the last N messages in this channel (up to 50).'), null, v_id);
        else
          v_n := least(greatest(v_match[1]::int, 1), 50);
          if not public.channel_has_permission(p_channel, 256) then
            raise exception 'you need the Manage Messages permission to purge messages';
          end if;
          delete from public.messages where id in (
            select id from public.messages where channel_id = p_channel order by created_at desc limit v_n);
          perform public.bot_post(p_app, p_channel, '', jsonb_build_object('title', 'Purged', 'color', '#ff6b81',
            'description', 'Deleted ' || v_n || ' message' || case when v_n = 1 then '' else 's' end || ' in this channel.'), null, v_id);
        end if;
      elsif v_cmd in ('ban', 'kick') then
        v_match := regexp_match(coalesce(p_args, ''),
          '^[[:space:]]*(?:<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>|@([a-z0-9_.]{2,32}))(?:[[:space:]]+(.*))?$');
        v_u := case when v_match is null then null
                    when v_match[1] is not null then v_match[1]::uuid
                    else (select id from public.profiles where username = v_match[2]) end;
        v_reason := coalesce(v_match[3], '');
        if v_u is null then
          perform public.bot_post(p_app, p_channel, '', jsonb_build_object('title', 'Usage', 'color', '#99aab5', 'description',
            case when v_cmd = 'ban' then '**/ban @user reason** — bans a member and stops them rejoining.'
                 else '**/kick @user reason** — removes a member from the server.' end), null, v_id);
        else
          if v_u = auth.uid() then raise exception using message = 'you can''t ' || v_cmd || ' yourself'; end if;
          if v_u = s.owner_id then raise exception using message = 'you can''t ' || v_cmd || ' the server owner'; end if;
          if v_cmd = 'ban' and not public.has_permission(v_server, 32) then
            raise exception 'you need the Ban Members permission to use /ban';
          end if;
          if v_cmd = 'kick' and not public.has_permission(v_server, 16) then
            raise exception 'you need the Kick Members permission to use /kick';
          end if;
          if exists (select 1 from public.server_members where server_id = v_server and user_id = v_u)
             and public.member_top_position(v_server, v_u) >= public.member_top_position(v_server) then
            raise exception 'that member has a role as high as or higher than yours';
          end if;
          select coalesce(display_name, username) into v_name from public.profiles where id = v_u;
          if v_cmd = 'ban' then
            insert into public.bans (server_id, user_id, banned_by, reason)
            values (v_server, v_u, auth.uid(), left(v_reason, 512))
            on conflict (server_id, user_id) do update set reason = excluded.reason, banned_by = excluded.banned_by;
          else
            delete from public.server_members where server_id = v_server and user_id = v_u;
          end if;
          perform public.bot_post(p_app, p_channel, '', jsonb_build_object(
            'title', case when v_cmd = 'ban' then 'Banned' else 'Kicked' end,
            'description', '**' || v_name || '** was ' || v_cmd || '.',
            'color', case when v_cmd = 'ban' then '#ff4757' else '#ffa502' end,
            'fields', jsonb_build_array(jsonb_build_object('name', 'Reason', 'value',
              case when v_reason = '' then 'No reason provided.' else v_reason end))), null, v_id);
        end if;
      elsif v_cmd in ('lock', 'unlock') then
        if not public.has_permission(v_server, 8) then raise exception 'you need the Manage Channels permission to lock channels'; end if;
        select id into v_role from public.roles where server_id = v_server and is_default;
        if v_role is null then raise exception 'this server has no @everyone role'; end if;
        if v_cmd = 'lock' then
          if exists (select 1 from public.channel_overwrites where channel_id = p_channel and category is null and target_type = 'role' and target_id = v_role) then
            update public.channel_overwrites set deny = 128, allow = 0, server_id = v_server
            where channel_id = p_channel and category is null and target_type = 'role' and target_id = v_role;
          else
            insert into public.channel_overwrites (server_id, channel_id, target_type, target_id, allow, deny)
            values (v_server, p_channel, 'role', v_role, 0, 128);
          end if;
          perform public.bot_post(p_app, p_channel, '', jsonb_build_object('title', 'Channel locked', 'color', '#ffa502',
            'description', 'Only members with roles above @everyone can talk in this channel now.'), null, v_id);
        else
          delete from public.channel_overwrites where channel_id = p_channel and category is null and target_type = 'role' and target_id = v_role;
          perform public.bot_post(p_app, p_channel, '', jsonb_build_object('title', 'Channel unlocked', 'color', '#2ed573',
            'description', 'Everyone can talk in this channel again.'), null, v_id);
        end if;
      else
        return jsonb_build_object('status', 'queued', 'id', v_id);
      end if;
    end;
  else
    return jsonb_build_object('status', 'queued', 'id', v_id);
  end if;
  update public.bot_interactions set handled = true where id = v_id;
  return jsonb_build_object('status', 'handled', 'id', v_id);
end;
$$;

-- A bot dashboard's recent activity: slash commands used and members joining
-- the servers the bot is in.
create or replace function public.app_events(p_app uuid, p_limit integer default 50)
returns table (kind text, created_at timestamptz, user_id uuid, server_id uuid,
               command text, args text, handled boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.app_role(p_app) is null then raise exception 'you can''t see this app''s activity'; end if;
  return query
    select * from (
      select 'command'::text, x.created_at, x.user_id, x.server_id, x.command, x.args, x.handled
      from public.bot_interactions x where x.app_id = p_app
      union all
      select 'join'::text, ev.created_at, ev.user_id, ev.server_id, null::text, null::text, true
      from public.server_events ev
      where ev.kind = 'join'
        and exists (select 1 from public.server_bots b where b.server_id = ev.server_id and b.app_id = p_app)
    ) t
    order by t.created_at desc
    limit greatest(1, least(p_limit, 200));
end;
$$;

revoke execute on function public.bot_set_commands(uuid, jsonb),
  public.apply_bot_template(uuid, text), public.list_bot_templates(), public.app_events(uuid, integer)
  from public, anon;
grant execute on function public.bot_set_commands(uuid, jsonb),
  public.apply_bot_template(uuid, text), public.list_bot_templates(), public.app_events(uuid, integer)
  to authenticated;

-- -----------------------------------------------------------------------------
--

-- -----------------------------------------------------------------------------
--

-- -----------------------------------------------------------------------------
--

-- -----------------------------------------------------------------------------
--

-- -----------------------------------------------------------------------------
-- 14. Bot DMs + My Apps + scripts (connect bots to your account, slash
--     commands in DMs, the Scripts tab, delete an app, and animations).
-- -----------------------------------------------------------------------------
-- =============================================================================
-- Bot DMs + "My Apps" + script authoring for the bot dashboard.
--   * bot_links: apps "connected to your account" (Settings → My Apps)
--   * dm_bots: a DM channel bound to a bot — slash commands work there
--   * connect_bot / disconnect_bot / list_my_bots / delete_app RPCs
--   * use_bot_command_dm: run a bot's commands inside a DM with no server
--   * applications.script: the code you author in the dashboard Scripts tab
-- =============================================================================

-- ------------------------------------------------------------ my apps ----
-- Apps someone connected to their account (to chat with them in DMs).
create table if not exists public.bot_links (
  app_id     uuid not null references public.applications (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (app_id, user_id)
);
alter table public.bot_links enable row level security;
drop policy if exists bot_links_select on public.bot_links;
create policy bot_links_select on public.bot_links for select to authenticated using (user_id = auth.uid());
drop policy if exists bot_links_insert on public.bot_links;
create policy bot_links_insert on public.bot_links for insert to authenticated with check (user_id = auth.uid());
drop policy if exists bot_links_delete on public.bot_links;
create policy bot_links_delete on public.bot_links for delete to authenticated using (user_id = auth.uid());

-- A DM channel that is a conversation with a bot. A single participant channel
-- is the "chat with your bot" DM; the official Venband app reuses the DM you
-- already have with the Venband account.
create table if not exists public.dm_bots (
  channel_id uuid primary key references public.channels (id) on delete cascade,
  app_id     uuid not null references public.applications (id) on delete cascade
);
alter table public.dm_bots enable row level security;
drop policy if exists dm_bots_select on public.dm_bots;
create policy dm_bots_select on public.dm_bots for select to authenticated using (public.can_view_channel(channel_id));

-- The official Venband account (owner of the seeded Venband bot).
create or replace function public.venband_official()
returns uuid language sql immutable set search_path = '' as $$
  select '3fff0000-0000-4000-8000-0000000000bd'::uuid;
$$;
revoke execute on function public.venband_official() from public, anon, authenticated;

-- Open (find or create) the DM where you chat with a bot, and connect it to
-- your account. Anyone can connect to the official Venband bot; other bots are
-- connectable by their owner or an admin of them.
create or replace function public.connect_bot(p_app uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_ven  uuid := public.venband_official();
  a      public.applications%rowtype;
  v_channel uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into a from public.applications where id = p_app;
  if not found or a.status <> 'active' then raise exception 'that bot isn''t available'; end if;
  if a.owner_id <> v_ven then
    if coalesce(public.app_role(p_app), '') not in ('owner', 'admin') then
      raise exception 'only the bot''s team can connect it to an account';
    end if;
    -- the bot's own DM: a single-participant channel, branded with the bot
    select db.channel_id into v_channel
    from public.dm_bots db
    join public.dm_participants p on p.channel_id = db.channel_id
    where db.app_id = p_app and p.user_id = v_uid limit 1;
    if v_channel is null then
      insert into public.channels (type, name) values ('dm', 'dm') returning id into v_channel;
      insert into public.dm_participants (channel_id, user_id) values (v_channel, v_uid);
      insert into public.dm_bots (channel_id, app_id) values (v_channel, p_app);
    end if;
  else
    -- the official Venband bot: reuse the 1:1 DM with the Venband account
    select a.channel_id into v_channel
    from public.dm_participants a
    join public.dm_participants b on a.channel_id = b.channel_id
    join public.channels c on c.id = a.channel_id and not c.is_group and c.type = 'dm'
    where a.user_id = v_ven and b.user_id = v_uid limit 1;
    if v_channel is null then
      insert into public.channels (type, name) values ('dm', 'dm') returning id into v_channel;
      insert into public.dm_participants (channel_id, user_id) values (v_channel, v_ven), (v_channel, v_uid);
    end if;
    insert into public.dm_bots (channel_id, app_id) values (v_channel, p_app) on conflict do nothing;
  end if;
  insert into public.bot_links (app_id, user_id) values (p_app, v_uid)
  on conflict do nothing;
  return v_channel;
end;
$$;

create or replace function public.disconnect_bot(p_app uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select db.channel_id into v_ch
  from public.dm_bots db
  join public.dm_participants p on p.channel_id = db.channel_id
  where db.app_id = p_app and p.user_id = auth.uid()
  limit 1;
  delete from public.dm_bots where app_id = p_app and channel_id = v_ch;
  delete from public.bot_links where app_id = p_app and user_id = auth.uid();
  -- an own-bot DM has nobody else in it: remove it entirely (reconnecting makes a fresh one)
  if v_ch is not null and (select count(*) from public.dm_participants q where q.channel_id = v_ch) <= 1 then
    delete from public.channels where id = v_ch;
  end if;
end;
$$;

-- Every bot connected to your account, with its DM, for Settings → My Apps.
create or replace function public.list_my_bots()
returns table (app_id uuid, owner_id uuid, name text, description text, preset text,
               color text, icon_url text, channel_id uuid, connected timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.id, a.owner_id, a.name, a.description, a.preset, a.color, a.icon_url,
         (select db.channel_id from public.dm_bots db
          join public.dm_participants p on p.channel_id = db.channel_id
          where db.app_id = a.id and p.user_id = auth.uid() limit 1),
         l.created_at
  from public.bot_links l join public.applications a on a.id = l.app_id
  where l.user_id = auth.uid()
  order by l.created_at desc;
$$;

-- Permanently remove one of your applications (bots leave servers too).
create or replace function public.delete_app(p_app uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if (select owner_id from public.applications where id = p_app) <> auth.uid() then
    raise exception 'only the owner can delete an application';
  end if;
  if (select owner_id from public.applications where id = p_app) = public.venband_official() then
    raise exception 'you can''t delete the official Venband bot';
  end if;
  delete from public.applications where id = p_app;
end;
$$;

-- ------------------------------------------------------------ dm commands ----
-- Commands a bot answers inside its DM (custom responders + DM-safe presets).
create or replace function public.dm_commands(p_channel uuid)
returns table (app_id uuid, app_name text, name text, description text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.name, c.name, c.description
  from public.dm_bots db
  join public.applications a on a.id = db.app_id and a.status = 'active'
  cross join lateral (
    select bc.name, bc.description from public.bot_commands bc where bc.app_id = a.id
    union
    select pc.name, pc.description from public.preset_commands(a.preset) pc
    where (a.preset = 'venband' and pc.name in ('info', 'help'))
       or (a.preset = 'wordle' and pc.name in ('wordle', 'guess'))
  ) c
  where db.channel_id = p_channel and public.can_view_channel(p_channel)
  order by c.name;
$$;

-- Posting into a bot DM (bot_post needs a server; DM replies use this).
create or replace function public.bot_dm_post(p_app uuid, p_channel uuid, p_content text,
                                              p_embed jsonb, p_interaction uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.dm_bots where channel_id = p_channel and app_id = p_app) then
    raise exception 'that DM isn''t connected to this bot';
  end if;
  if (select count(*) from public.bot_messages where app_id = p_app and created_at > now() - interval '10 seconds') >= 10 then
    raise exception 'slow down: bots can post 10 messages every 10 seconds';
  end if;
  if coalesce(btrim(p_content), '') = '' and public.clean_embed(p_embed) is null then raise exception 'empty message'; end if;
  insert into public.bot_messages (server_id, channel_id, app_id, content, embed, interaction_id)
  values (null, p_channel, p_app, left(coalesce(p_content, ''), 2000), public.clean_embed(p_embed), p_interaction)
  returning id into v_id;
  return v_id;
end;
$$;

-- Slash commands in a DM with a bot. No server involved: preset commands that
-- need one explain that, and custom responders run with their moderation
-- actions disabled (those need a server).
create or replace function public.use_bot_command_dm(p_channel uuid, p_command text, p_args text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ven uuid := public.venband_official();
  v_cmd text := lower(btrim(p_command));
  a     public.applications%rowtype;
  v_id  uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.channels c
                 where c.id = p_channel and c.type = 'dm' and c.server_id is null)
     or not public.can_view_channel(p_channel) then raise exception 'you can''t use commands here'; end if;
  select x.* into a from public.dm_bots db
  join public.applications x on x.id = db.app_id
  where db.channel_id = p_channel and x.status = 'active' limit 1;
  if not found then raise exception 'no bot is connected to this DM'; end if;
  if a.owner_id <> v_ven
     and not exists (select 1 from public.bot_links where app_id = a.id and user_id = auth.uid()) then
    raise exception 'connect this bot to your account first';
  end if;
  if (select count(*) from public.bot_interactions where user_id = auth.uid() and created_at > now() - interval '10 seconds') >= 5 then
    raise exception 'slow down a little';
  end if;
  insert into public.bot_interactions (app_id, server_id, channel_id, user_id, command, args)
  values (a.id, null, p_channel, auth.uid(), v_cmd, left(coalesce(p_args, ''), 1000))
  returning id into v_id;

  if a.preset = 'venband' and v_cmd = 'info' then
    <<info>> declare
      v_u uuid;
      v_name text;
      v_username text;
      v_about text;
      v_color text;
      v_created text;
    begin
      v_u := coalesce(public.venband_target(p_args), auth.uid());
      select coalesce(p.display_name, p.username), p.username, p.about, p.avatar_color,
             to_char(p.created_at, 'Mon DD, YYYY')
        into v_name, v_username, v_about, v_color, v_created from public.profiles p where p.id = v_u;
      if not found then raise exception 'user not found'; end if;
      perform public.bot_dm_post(a.id, p_channel, '',
        jsonb_build_object('title', v_name, 'color', v_color,
          'fields', jsonb_build_array(
            jsonb_build_object('name', 'Username', 'value', '@' || v_username),
            jsonb_build_object('name', 'About', 'value', case when coalesce(v_about, '') = '' then '—' else v_about end),
            jsonb_build_object('name', 'Profile created', 'value', v_created),
            jsonb_build_object('name', 'Where it works', 'value', '…and in any server that has the Venband bot, /info shows the server too.'))),
        null, v_id);
    end;
  elsif v_cmd in ('help', 'commands') and a.preset = 'venband' then
    perform public.bot_dm_post(a.id, p_channel, '',
      jsonb_build_object('title', 'Venband · DM commands', 'color', '#ed4245',
        'description', '**/info @user** — a profile card (defaults to you).\n**/serverinfo, /purge, /ban, /kick, /lock, /unlock** — add the bot in a server and run them there.'),
      null, v_id);
  elsif a.preset = 'wordle' and v_cmd in ('wordle', 'guess') then
    perform public.bot_dm_post(a.id, p_channel, public.wordle_command(a.id, p_channel, v_cmd, coalesce(p_args, '')), null, null, v_id);
  elsif exists (select 1 from public.bot_commands bc where bc.app_id = a.id and bc.name = v_cmd and bc.response is not null)
        and not exists (select 1 from public.preset_commands(a.preset) pc where pc.name = v_cmd) then
    <<custom>> declare
      r jsonb;
      v_content text;
      v_embed jsonb;
    begin
      select response into r from public.bot_commands where app_id = a.id and name = v_cmd;
      if jsonb_array_length(coalesce(r -> 'actions', '[]'::jsonb)) > 0 then
        raise exception 'that action needs a server — add the bot in Server Settings → Integrations first';
      end if;
      v_content := replace(replace(replace(replace(replace(coalesce(r ->> 'content', ''),
                      '{user}', '<@' || auth.uid() || '>'), '{username}',
                      coalesce((select username from public.profiles where id = auth.uid()), '')),
                      '{server}', ''), '{channel}', 'DM'), '{args}', coalesce(p_args, ''));
      v_embed := public.clean_embed(case when r -> 'embed' is null then null else
            jsonb_build_object('title', replace(coalesce((r -> 'embed') ->> 'title', ''), '{server}', ''),
                               'description', replace(coalesce((r -> 'embed') ->> 'description', ''), '{args}', coalesce(p_args, '')),
                               'color', (r -> 'embed') ->> 'color',
                               'fields', (r -> 'embed') -> 'fields') end);
      if nullif(btrim(v_content), '') is null and v_embed is null then
        raise exception 'that command posts nothing';
      end if;
      perform public.bot_dm_post(a.id, p_channel, nullif(btrim(v_content), ''), v_embed, null, v_id);
    end;
  elsif exists (select 1 from public.preset_commands(a.preset) pc where pc.name = v_cmd) then
    raise exception 'that command needs a server — add the bot in a server first';
  else
    return jsonb_build_object('status', 'queued', 'id', v_id);
  end if;

  update public.bot_interactions set handled = true where id = v_id;
  return jsonb_build_object('status', 'handled', 'id', v_id);
end;
$$;

-- ------------------------------------------------------------- scripts ----
-- The code you author in the dashboard Scripts tab (runs on any Node host).
alter table public.applications add column if not exists script text not null default ''
  check (char_length(script) < 60000);
grant select (script) on public.applications to authenticated;
grant update (script) on public.applications to authenticated;

-- DM commands recorded without a server fit the activity log too.
alter table public.bot_interactions alter column server_id drop not null;
-- Bot posts inside DMs have no server.
alter table public.bot_messages alter column server_id drop not null;

-- dm_bots drives DMs listing and the "… is typing" bot cursor; watch it live.
do $$
declare t text;
begin
  foreach t in array array['dm_bots', 'bot_links'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
grant select on public.dm_bots, public.bot_links to authenticated;

-- ----------------------------------------------------------------- grants ----
revoke execute on function public.connect_bot(uuid), public.disconnect_bot(uuid),
  public.list_my_bots(), public.delete_app(uuid), public.dm_commands(uuid),
  public.use_bot_command_dm(uuid, text, text)
  from public, anon;
-- internal helper: bots post into their DMs through use_bot_command_dm only
revoke execute on function public.bot_dm_post(uuid, uuid, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.connect_bot(uuid), public.disconnect_bot(uuid),
  public.list_my_bots(), public.delete_app(uuid), public.dm_commands(uuid),
  public.use_bot_command_dm(uuid, text, text)
  to authenticated;

-- =============================================================================
-- Rich presence: what you're doing cross-device. Same block as block 15 of
-- sql_editor_pending.sql — dropped and re-created freely here.
-- =============================================================================
create table if not exists public.activities (
  user_id           uuid primary key references public.profiles (id) on delete cascade,
  platform          text not null default 'rpc'
                    check (platform in ('rpc', 'spotify', 'custom', 'connections')),
  icon              text,
  name              text not null check (char_length(name) between 1 and 64),
  type              smallint not null default 0,
  details           text check (details is null or char_length(details) <= 200),
  state             text check (state is null or char_length(state) <= 200),
  url               text check (url is null or char_length(url) <= 500),
  uri               text check (uri is null or char_length(uri) <= 300),
  client_id         text check (client_id is null or char_length(client_id) <= 64),
  assets_large_key  text check (assets_large_key is null or char_length(assets_large_key) <= 128),
  assets_large_text text check (assets_large_text is null or char_length(assets_large_text) <= 128),
  assets_small_key  text check (assets_small_key is null or char_length(assets_small_key) <= 128),
  assets_small_text text check (assets_small_text is null or char_length(assets_small_text) <= 128),
  party_id          text check (party_id is null or char_length(party_id) <= 128),
  party_cur         int,
  party_max         int,
  timestamps_start  bigint,
  timestamps_end    bigint,
  buttons           jsonb not null default '[]'::jsonb
                    check (jsonb_typeof(buttons) = 'array' and jsonb_array_length(buttons) <= 2),
  updated_at        timestamptz not null default now()
);
alter table public.activities enable row level security;
drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities
  for select to authenticated using (true);

create or replace function public.set_my_activity(p_activity jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  a     jsonb := p_activity;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if a is null or a = 'null'::jsonb
     or a ->> 'name' is null or btrim(coalesce(a ->> 'name', '')) = '' then
    delete from public.activities where user_id = v_uid;
    return;
  end if;
  insert into public.activities
    (user_id, platform, icon, name, type, details, state, url, uri, client_id,
     assets_large_key, assets_large_text, assets_small_key, assets_small_text,
     party_id, party_cur, party_max, timestamps_start, timestamps_end,
     buttons, updated_at)
  values (
    v_uid,
    case when a ->> 'platform' in ('rpc', 'spotify', 'custom', 'connections')
         then a ->> 'platform' else 'rpc' end,
    nullif(coalesce(a ->> 'icon', ''), ''),
    left(btrim(coalesce(a ->> 'name', '')), 64),
    coalesce(nullif(a ->> 'type', '')::int, 0),
    left(a ->> 'details', 200),
    left(a ->> 'state', 200),
    left(a ->> 'url', 500),
    left(a ->> 'uri', 300),
    left(a ->> 'client_id', 64),
    left(a ->> 'assets_large_key', 128),
    left(a ->> 'assets_large_text', 128),
    left(a ->> 'assets_small_key', 128),
    left(a ->> 'assets_small_text', 128),
    left(a ->> 'party_id', 128),
    nullif((a ->> 'party_cur')::int, 0),
    nullif((a ->> 'party_max')::int, 0),
    nullif((a ->> 'timestamps_start')::bigint, 0),
    nullif((a ->> 'timestamps_end')::bigint, 0),
    case when jsonb_typeof(a -> 'buttons') = 'array'
         then (select jsonb_agg(x)
               from (select left(b.value ->> 'label', 64) x
                     from jsonb_array_elements(a -> 'buttons') b
                     where b.value ->> 'label' is not null limit 2) s)
         else '[]'::jsonb end,
    now()
  )
  on conflict (user_id) do update set
    platform          = excluded.platform,
    icon              = excluded.icon,
    name              = excluded.name,
    type              = excluded.type,
    details           = excluded.details,
    state             = excluded.state,
    url               = excluded.url,
    uri               = excluded.uri,
    client_id         = excluded.client_id,
    assets_large_key  = excluded.assets_large_key,
    assets_large_text = excluded.assets_large_text,
    assets_small_key  = excluded.assets_small_key,
    assets_small_text = excluded.assets_small_text,
    party_id          = excluded.party_id,
    party_cur         = excluded.party_cur,
    party_max         = excluded.party_max,
    timestamps_start  = excluded.timestamps_start,
    timestamps_end    = excluded.timestamps_end,
    buttons           = excluded.buttons,
    updated_at        = now();
end;
$$;

create or replace function public.clear_my_activity()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.activities where user_id = auth.uid();
end;
$$;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                 and schemaname = 'public' and tablename = 'activities') then
    alter publication supabase_realtime add table public.activities;
  end if;
end $$;
grant select on public.activities to authenticated;
revoke execute on function public.set_my_activity(jsonb), public.clear_my_activity()
  from public, anon;
grant execute on function public.set_my_activity(jsonb), public.clear_my_activity()
  to authenticated;

-- =============================================================================
-- Connections: outside accounts linked to a Venband profile. Same block as
-- block 16 of sql_editor_pending.sql.
-- =============================================================================
create table if not exists public.connections (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  provider     text not null
               check (provider in ('steam', 'spotify', 'twitch', 'discord', 'github',
                                   'youtube', 'xbox', 'instagram', 'tiktok', 'epic')),
  external_id  text not null check (char_length(external_id) between 1 and 128),
  display_name text not null default '' check (char_length(display_name) <= 80),
  avatar_url   text check (avatar_url is null or char_length(avatar_url) <= 500),
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, provider, external_id)
);
create index connections_user_idx on public.connections (user_id, created_at desc);
alter table public.connections enable row level security;
drop policy if exists connections_select on public.connections;
create policy connections_select on public.connections
  for select to authenticated using (user_id = auth.uid());
drop policy if exists connections_insert on public.connections;
create policy connections_insert on public.connections
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists connections_update on public.connections;
create policy connections_update on public.connections
  for update to authenticated using (user_id = auth.uid());
drop policy if exists connections_delete on public.connections;
create policy connections_delete on public.connections
  for delete to authenticated using (user_id = auth.uid());

create or replace function public.add_connection(
  p_provider    text,
  p_external_id text,
  p_display_name text default '',
  p_avatar_url  text default null,
  p_metadata    jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_provider not in ('steam', 'spotify', 'twitch', 'discord', 'github',
                        'youtube', 'xbox', 'instagram', 'tiktok', 'epic') then
    raise exception 'unknown provider';
  end if;
  if btrim(coalesce(p_external_id, '')) = '' then raise exception 'provider gave no account id'; end if;
  insert into public.connections (user_id, provider, external_id, display_name, avatar_url, metadata, updated_at)
  values (v_uid, p_provider, left(p_external_id, 128), left(coalesce(p_display_name, ''), 80),
          nullif(p_avatar_url, ''), coalesce(p_metadata, '{}'::jsonb), now())
  on conflict (user_id, provider, external_id) do update set
    display_name = excluded.display_name,
    avatar_url   = excluded.avatar_url,
    metadata     = excluded.metadata,
    updated_at   = now();
end;
$$;

create or replace function public.remove_connection(
  p_provider    text,
  p_external_id text default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_external_id is null then
    delete from public.connections where user_id = auth.uid() and provider = p_provider;
  else
    delete from public.connections where user_id = auth.uid() and provider = p_provider and external_id = p_external_id;
  end if;
end;
$$;

create or replace function public.my_connections()
returns table (provider text, external_id text, display_name text, avatar_url text,
               metadata jsonb, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.provider, c.external_id, c.display_name, c.avatar_url, c.metadata, c.created_at
  from public.connections c
  where c.user_id = auth.uid()
  order by c.created_at desc;
$$;

revoke execute on function public.add_connection(text, text, text, text, jsonb),
  public.remove_connection(text, text), public.my_connections()
  from public, anon;
grant execute on function public.add_connection(text, text, text, text, jsonb),
  public.remove_connection(text, text), public.my_connections()
  to authenticated;

