-- =============================================================================
-- Venband database schema
--
-- Security model:
--   * The server NEVER sees plaintext messages, attachments, channel keys or
--     private keys. It only stores ciphertext, public keys and wrapped keys.
--   * Every table has Row Level Security enabled. Access is granted only via
--     the policies below, which are all expressed through a small set of
--     SECURITY DEFINER helper functions (membership / permission checks).
--   * Mutations that must be atomic or need elevated rights (creating a
--     server, joining through an invite, opening a DM ...) go through RPC
--     functions that re-check authorization themselves.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- Permission bits (keep in sync with src/lib/permissions.ts)
-- -----------------------------------------------------------------------------
--   ADMINISTRATOR    1
--   MANAGE_SERVER    2
--   MANAGE_ROLES     4
--   MANAGE_CHANNELS  8
--   KICK_MEMBERS     16
--   BAN_MEMBERS      32
--   CREATE_INVITE    64
--   SEND_MESSAGES    128
--   MANAGE_MESSAGES  256
--   CONNECT          512
--   SPEAK            1024
--   VIDEO            2048   (camera + screen share)
--   ALL              4095

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  username      text not null unique
                check (username ~ '^[a-z0-9_.]{2,32}$'),
  display_name  text not null check (char_length(display_name) between 1 and 32),
  avatar_color  text not null default '#7c5cff' check (avatar_color ~ '^#[0-9a-fA-F]{6}$'),
  about         text not null default '' check (char_length(about) <= 190),
  created_at    timestamptz not null default now()
);

-- Public identity keys. A user may have several over time (e.g. after a
-- password reset); the newest non-revoked one is the current key.
create table public.user_keys (
  key_id        text primary key check (key_id ~ '^[A-Za-z0-9_-]{16,64}$'),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  enc_public    text not null check (char_length(enc_public) < 400),   -- ECDH P-256, SPKI base64
  sign_public   text not null check (char_length(sign_public) < 400),  -- ECDSA P-256, SPKI base64
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz
);
create index user_keys_user_idx on public.user_keys (user_id, created_at desc);

-- Private identity keys, encrypted client-side with a key derived from the
-- user's password (Argon2id). The server cannot decrypt these.
create table public.user_private_keys (
  user_id       uuid primary key references public.profiles (id) on delete cascade,
  key_id        text not null references public.user_keys (key_id) on delete cascade,
  iv            text not null,
  ciphertext    text not null check (char_length(ciphertext) < 4000),
  updated_at    timestamptz not null default now()
);

create table public.servers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(btrim(name)) between 1 and 100),
  owner_id      uuid not null references public.profiles (id),
  icon_color    text not null default '#7c5cff' check (icon_color ~ '^#[0-9a-fA-F]{6}$'),
  created_at    timestamptz not null default now()
);

create table public.server_members (
  server_id     uuid not null references public.servers (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  nickname      text check (nickname is null or char_length(nickname) between 1 and 32),
  joined_at     timestamptz not null default now(),
  primary key (server_id, user_id)
);
create index server_members_user_idx on public.server_members (user_id);

create table public.roles (
  id            uuid primary key default gen_random_uuid(),
  server_id     uuid not null references public.servers (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 100),
  color         text not null default '#99aab5' check (color ~ '^#[0-9a-fA-F]{6}$'),
  permissions   bigint not null default 0 check (permissions >= 0 and permissions <= 4095),
  position      integer not null default 1 check (position >= 0),
  is_default    boolean not null default false,   -- the @everyone role
  hoist         boolean not null default false,   -- show separately in member list
  created_at    timestamptz not null default now()
);
create index roles_server_idx on public.roles (server_id);
create unique index roles_one_default on public.roles (server_id) where is_default;

create table public.member_roles (
  server_id     uuid not null,
  user_id       uuid not null,
  role_id       uuid not null references public.roles (id) on delete cascade,
  primary key (server_id, user_id, role_id),
  foreign key (server_id, user_id) references public.server_members (server_id, user_id) on delete cascade
);
create index member_roles_role_idx on public.member_roles (role_id);

create table public.channels (
  id            uuid primary key default gen_random_uuid(),
  server_id     uuid references public.servers (id) on delete cascade,   -- null for DMs
  type          text not null check (type in ('text', 'voice', 'dm')),
  name          text not null check (char_length(name) between 1 and 100),
  topic         text not null default '' check (char_length(topic) <= 1024),
  category      text not null default '' check (char_length(category) <= 100),
  position      integer not null default 0,
  is_private    boolean not null default false,
  key_rotation_needed boolean not null default false,
  created_at    timestamptz not null default now(),
  check ((type = 'dm') = (server_id is null))
);
create index channels_server_idx on public.channels (server_id);

-- Which roles may see a private channel.
create table public.channel_role_access (
  channel_id    uuid not null references public.channels (id) on delete cascade,
  role_id       uuid not null references public.roles (id) on delete cascade,
  primary key (channel_id, role_id)
);

create table public.dm_participants (
  channel_id    uuid not null references public.channels (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  primary key (channel_id, user_id)
);
create index dm_participants_user_idx on public.dm_participants (user_id);

create table public.invites (
  code          text primary key check (code ~ '^[A-Za-z0-9]{8,32}$'),
  server_id     uuid not null references public.servers (id) on delete cascade,
  created_by    uuid not null references public.profiles (id) on delete cascade,
  uses          integer not null default 0,
  max_uses      integer check (max_uses is null or max_uses > 0),
  expires_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index invites_server_idx on public.invites (server_id);

create table public.bans (
  server_id     uuid not null references public.servers (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  banned_by     uuid references public.profiles (id) on delete set null,
  reason        text not null default '' check (char_length(reason) <= 512),
  created_at    timestamptz not null default now(),
  primary key (server_id, user_id)
);

-- Channel key epochs. Every epoch has its own random AES-256 key that only
-- exists on clients. `key_check` is an HMAC commitment to the key so that a
-- recipient can verify a wrapped key belongs to this epoch.
create table public.channel_epochs (
  channel_id    uuid not null references public.channels (id) on delete cascade,
  epoch         integer not null check (epoch >= 1),
  key_check     text not null check (char_length(key_check) < 100),
  created_by    uuid not null references public.profiles (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (channel_id, epoch)
);

-- An epoch key encrypted (ECIES: ephemeral ECDH P-256 + HKDF + AES-GCM) for
-- one recipient identity key, and signed by the wrapping member.
create table public.channel_keys (
  channel_id        uuid not null,
  epoch             integer not null,
  recipient_id      uuid not null references public.profiles (id) on delete cascade,
  recipient_key_id  text not null references public.user_keys (key_id) on delete cascade,
  wrapper_id        uuid not null references public.profiles (id) on delete cascade,
  wrapper_key_id    text not null references public.user_keys (key_id) on delete cascade,
  ephemeral_public  text not null check (char_length(ephemeral_public) < 400),
  iv                text not null check (char_length(iv) < 64),
  wrapped_key       text not null check (char_length(wrapped_key) < 200),
  signature         text not null check (char_length(signature) < 200),
  created_at        timestamptz not null default now(),
  primary key (channel_id, epoch, recipient_key_id, wrapper_id),
  foreign key (channel_id, epoch) references public.channel_epochs (channel_id, epoch) on delete cascade
);
create index channel_keys_recipient_idx on public.channel_keys (recipient_id, channel_id);

create table public.messages (
  id            uuid primary key default gen_random_uuid(),
  channel_id    uuid not null references public.channels (id) on delete cascade,
  author_id     uuid not null references public.profiles (id) on delete cascade,
  author_key_id text not null references public.user_keys (key_id),
  epoch         integer not null,
  iv            text not null check (char_length(iv) < 64),
  ciphertext    text not null check (char_length(ciphertext) <= 20000),
  signature     text not null check (char_length(signature) < 200),
  reply_to      uuid references public.messages (id) on delete set null,
  created_at    timestamptz not null default now(),
  edited_at     timestamptz,
  foreign key (channel_id, epoch) references public.channel_epochs (channel_id, epoch)
);
create index messages_channel_idx on public.messages (channel_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER, fixed search_path)
-- -----------------------------------------------------------------------------

create or replace function public.is_server_member(p_server uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.server_members m
                 where m.server_id = p_server and m.user_id = p_user);
$$;

create or replace function public.server_permissions(p_server uuid, p_user uuid default auth.uid())
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_perms bigint;
begin
  select owner_id into v_owner from public.servers where id = p_server;
  if v_owner is null then return 0; end if;
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

create or replace function public.has_permission(p_server uuid, p_perm bigint, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select (public.server_permissions(p_server, p_user) & p_perm) = p_perm;
$$;

-- Highest role position of a member (owner = "infinite").
create or replace function public.member_top_position(p_server uuid, p_user uuid default auth.uid())
returns integer language sql stable security definer set search_path = '' as $$
  select case
    when (select owner_id from public.servers where id = p_server) = p_user then 2147483647
    else coalesce((select max(r.position) from public.roles r
                   join public.member_roles mr on mr.role_id = r.id
                   where mr.server_id = p_server and mr.user_id = p_user), 0)
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
  if not c.is_private then return true; end if;
  -- administrators, the owner and MANAGE_CHANNELS can see every channel
  if public.has_permission(c.server_id, 8, p_user) then return true; end if;
  return exists (select 1 from public.channel_role_access a
                 join public.member_roles mr on mr.role_id = a.role_id
                 where a.channel_id = p_channel and mr.user_id = p_user
                   and mr.server_id = c.server_id);
end;
$$;

create or replace function public.channel_has_permission(p_channel uuid, p_perm bigint, p_user uuid default auth.uid())
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_server uuid;
begin
  if not public.can_view_channel(p_channel, p_user) then return false; end if;
  select server_id into v_server from public.channels where id = p_channel;
  if v_server is null then return true; end if; -- DM participants can do everything in their DM
  return public.has_permission(v_server, p_perm, p_user);
end;
$$;

create or replace function public.shares_server_or_dm(p_other uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select p_other = p_user
      or exists (select 1 from public.server_members a
                 join public.server_members b on a.server_id = b.server_id
                 where a.user_id = p_user and b.user_id = p_other)
      or exists (select 1 from public.dm_participants a
                 join public.dm_participants b on a.channel_id = b.channel_id
                 where a.user_id = p_user and b.user_id = p_other);
$$;

-- -----------------------------------------------------------------------------
-- New user bootstrap: create a profile from the signup metadata.
-- -----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_username text := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  v_display  text := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), v_username);
begin
  if v_username !~ '^[a-z0-9_.]{2,32}$' then
    raise exception 'invalid username';
  end if;
  insert into public.profiles (id, username, display_name, avatar_color)
  values (new.id, v_username, left(v_display, 32),
          (array['#7c5cff','#e5484d','#30a46c','#f76b15','#0090ff','#d6409f','#ffb224','#12a594'])
            [1 + floor(random() * 8)::int]);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.username_available(p_username text)
returns boolean language sql stable security definer set search_path = '' as $$
  select lower(p_username) ~ '^[a-z0-9_.]{2,32}$'
     and not exists (select 1 from public.profiles where username = lower(p_username));
$$;

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------

create or replace function public.create_server(p_name text, p_icon_color text default '#7c5cff')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_server uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if (select count(*) from public.servers where owner_id = v_uid) >= 100 then
    raise exception 'server limit reached';
  end if;
  insert into public.servers (name, owner_id, icon_color)
  values (btrim(p_name), v_uid, p_icon_color) returning id into v_server;
  insert into public.server_members (server_id, user_id) values (v_server, v_uid);
  -- @everyone: SEND_MESSAGES | CREATE_INVITE | CONNECT | SPEAK | VIDEO
  insert into public.roles (server_id, name, color, permissions, position, is_default)
  values (v_server, '@everyone', '#99aab5', 128 | 64 | 512 | 1024 | 2048, 0, true);
  insert into public.channels (server_id, type, name, category, position)
  values (v_server, 'text', 'general', 'Text Channels', 0),
         (v_server, 'voice', 'General', 'Voice Channels', 1);
  return v_server;
end;
$$;

create or replace function public.create_invite(p_server uuid, p_max_uses integer default null, p_expires_in_hours integer default 24 * 7)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
begin
  if not public.has_permission(p_server, 64) then raise exception 'missing permission'; end if;
  v_code := translate(encode(extensions.gen_random_bytes(9), 'base64'), '+/=', 'xyz');
  insert into public.invites (code, server_id, created_by, max_uses, expires_at)
  values (v_code, p_server, auth.uid(), p_max_uses,
          case when p_expires_in_hours is null then null
               else now() + make_interval(hours => p_expires_in_hours) end);
  return v_code;
end;
$$;

create or replace function public.join_server(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  inv public.invites%rowtype;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into inv from public.invites where code = p_code for update;
  if not found
     or (inv.expires_at is not null and inv.expires_at < now())
     or (inv.max_uses is not null and inv.uses >= inv.max_uses) then
    raise exception 'invalid or expired invite';
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
  where a.user_id = v_uid and b.user_id = p_other
  limit 1;
  if v_channel is not null then return v_channel; end if;
  insert into public.channels (type, name) values ('dm', 'dm') returning id into v_channel;
  insert into public.dm_participants (channel_id, user_id) values (v_channel, v_uid), (v_channel, p_other);
  return v_channel;
end;
$$;

create or replace function public.find_user(p_username text)
returns table (id uuid, username text, display_name text, avatar_color text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.username, p.display_name, p.avatar_color
  from public.profiles p
  where auth.uid() is not null and p.username = lower(p_username);
$$;

-- Current identity keys of everybody who can view a channel. Only callable by
-- someone who can view the channel. Used by clients to distribute channel keys.
create or replace function public.channel_key_recipients(p_channel uuid)
returns table (user_id uuid, key_id text, enc_public text, sign_public text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_server uuid;
begin
  if not public.can_view_channel(p_channel) then raise exception 'forbidden'; end if;
  select server_id into v_server from public.channels where id = p_channel;
  return query
    with viewers as (
      select m.user_id from public.server_members m
      where v_server is not null and m.server_id = v_server
        and public.can_view_channel(p_channel, m.user_id)
      union
      select d.user_id from public.dm_participants d
      where v_server is null and d.channel_id = p_channel
    )
    select distinct on (k.user_id) k.user_id, k.key_id, k.enc_public, k.sign_public
    from viewers v
    join public.user_keys k on k.user_id = v.user_id and k.revoked_at is null
    order by k.user_id, k.created_at desc;
end;
$$;

-- Which (epoch, recipient key) pairs are still missing a wrapped key.
create or replace function public.channel_missing_keys(p_channel uuid)
returns table (epoch integer, user_id uuid, key_id text, enc_public text, sign_public text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_view_channel(p_channel) then raise exception 'forbidden'; end if;
  return query
    select e.epoch, r.user_id, r.key_id, r.enc_public, r.sign_public
    from public.channel_epochs e
    cross join public.channel_key_recipients(p_channel) r
    where e.channel_id = p_channel
      and not exists (select 1 from public.channel_keys k
                      where k.channel_id = p_channel and k.epoch = e.epoch
                        and k.recipient_key_id = r.key_id)
    order by e.epoch;
end;
$$;

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

-- Keep immutable columns immutable.
create or replace function public.guard_server_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id or new.created_at <> old.created_at then
    raise exception 'immutable column';
  end if;
  if new.owner_id <> old.owner_id then
    if old.owner_id <> auth.uid() then raise exception 'only the owner can transfer ownership'; end if;
    if not public.is_server_member(new.id, new.owner_id) then raise exception 'new owner must be a member'; end if;
  end if;
  return new;
end;
$$;
create trigger servers_guard before update on public.servers
  for each row execute function public.guard_server_update();

create or replace function public.guard_role_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.server_id <> old.server_id or new.is_default <> old.is_default then
    raise exception 'immutable column';
  end if;
  if new.is_default and new.position <> 0 then raise exception '@everyone must stay at position 0'; end if;
  if new.is_default and new.name <> '@everyone' then raise exception 'cannot rename @everyone'; end if;
  return new;
end;
$$;
create trigger roles_guard before update on public.roles
  for each row execute function public.guard_role_update();

create or replace function public.guard_channel_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.server_id is distinct from old.server_id or new.type <> old.type then
    raise exception 'immutable column';
  end if;
  -- only the epoch-creation trigger (running as definer) may clear the flag
  if old.key_rotation_needed and not new.key_rotation_needed
     and current_setting('venband.rotating', true) is distinct from 'on' then
    new.key_rotation_needed := true;
  end if;
  -- making a channel private / changing visibility requires re-keying
  if new.is_private <> old.is_private then
    new.key_rotation_needed := true;
  end if;
  return new;
end;
$$;
create trigger channels_guard before update on public.channels
  for each row execute function public.guard_channel_update();

create or replace function public.guard_message_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id or new.channel_id <> old.channel_id or new.author_id <> old.author_id
     or new.created_at <> old.created_at or new.reply_to is distinct from old.reply_to then
    raise exception 'immutable column';
  end if;
  new.edited_at := now();
  return new;
end;
$$;
create trigger messages_guard before update on public.messages
  for each row execute function public.guard_message_update();

create or replace function public.guard_member_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.server_id <> old.server_id or new.user_id <> old.user_id or new.joined_at <> old.joined_at then
    raise exception 'immutable column';
  end if;
  return new;
end;
$$;
create trigger server_members_guard before update on public.server_members
  for each row execute function public.guard_member_update();

-- Somebody lost access -> every channel they could see must get a new key
-- before the next message is sent (forward secrecy against removed members).
create or replace function public.flag_server_rotation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.channels set key_rotation_needed = true where server_id = old.server_id;
  return old;
end;
$$;
create trigger server_members_rotation after delete on public.server_members
  for each row execute function public.flag_server_rotation();

create or replace function public.flag_private_channel_rotation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_role uuid := coalesce(old.role_id, new.role_id);
begin
  update public.channels c set key_rotation_needed = true
  where c.is_private and exists (select 1 from public.channel_role_access a
                                 where a.channel_id = c.id and a.role_id = v_role);
  return null;
end;
$$;
create trigger member_roles_rotation after delete on public.member_roles
  for each row execute function public.flag_private_channel_rotation();

create or replace function public.flag_channel_access_rotation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.channels set key_rotation_needed = true where id = old.channel_id;
  return old;
end;
$$;
create trigger channel_role_access_rotation after delete on public.channel_role_access
  for each row execute function public.flag_channel_access_rotation();

create or replace function public.flag_role_perm_rotation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (old.permissions & ~new.permissions) <> 0 then
    update public.channels set key_rotation_needed = true
    where server_id = new.server_id and is_private;
  end if;
  return new;
end;
$$;
create trigger roles_perm_rotation after update of permissions on public.roles
  for each row execute function public.flag_role_perm_rotation();

-- A new epoch was published -> rotation done.
create or replace function public.on_epoch_created()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('venband.rotating', 'on', true);
  update public.channels set key_rotation_needed = false where id = new.channel_id;
  perform set_config('venband.rotating', 'off', true);
  return new;
end;
$$;
create trigger channel_epochs_created after insert on public.channel_epochs
  for each row execute function public.on_epoch_created();

-- Banning removes the membership.
create or replace function public.on_ban()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.server_members where server_id = new.server_id and user_id = new.user_id;
  return new;
end;
$$;
create trigger bans_remove_member after insert on public.bans
  for each row execute function public.on_ban();

-- Only one current key: publishing a new key revokes older ones.
create or replace function public.on_user_key_created()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.user_keys set revoked_at = now()
  where user_id = new.user_id and key_id <> new.key_id and revoked_at is null;
  return new;
end;
$$;
create trigger user_keys_created after insert on public.user_keys
  for each row execute function public.on_user_key_created();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.profiles            enable row level security;
alter table public.user_keys           enable row level security;
alter table public.user_private_keys   enable row level security;
alter table public.servers             enable row level security;
alter table public.server_members      enable row level security;
alter table public.roles               enable row level security;
alter table public.member_roles        enable row level security;
alter table public.channels            enable row level security;
alter table public.channel_role_access enable row level security;
alter table public.dm_participants     enable row level security;
alter table public.invites             enable row level security;
alter table public.bans                enable row level security;
alter table public.channel_epochs      enable row level security;
alter table public.channel_keys        enable row level security;
alter table public.messages            enable row level security;

-- profiles: visible to people you share a server/DM with; editable by yourself.
create policy profiles_select on public.profiles for select to authenticated
  using (public.shares_server_or_dm(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- user_keys: public keys are readable by any signed-in user; only you add yours.
create policy user_keys_select on public.user_keys for select to authenticated using (true);
create policy user_keys_insert on public.user_keys for insert to authenticated
  with check (user_id = auth.uid() and revoked_at is null);

-- user_private_keys: only yourself.
create policy upk_select on public.user_private_keys for select to authenticated using (user_id = auth.uid());
create policy upk_insert on public.user_private_keys for insert to authenticated with check (user_id = auth.uid());
create policy upk_update on public.user_private_keys for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- servers
create policy servers_select on public.servers for select to authenticated
  using (public.is_server_member(id));
create policy servers_update on public.servers for update to authenticated
  using (public.has_permission(id, 2)) with check (public.has_permission(id, 2));
create policy servers_delete on public.servers for delete to authenticated
  using (owner_id = auth.uid());

-- server_members
create policy members_select on public.server_members for select to authenticated
  using (public.is_server_member(server_id));
create policy members_update_self on public.server_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy members_delete on public.server_members for delete to authenticated
  using (
    user_id <> (select owner_id from public.servers s where s.id = server_id)
    and (
      user_id = auth.uid()
      or (public.has_permission(server_id, 16)
          and public.member_top_position(server_id, user_id) < public.member_top_position(server_id))
    )
  );

-- roles
create policy roles_select on public.roles for select to authenticated
  using (public.is_server_member(server_id));
create policy roles_insert on public.roles for insert to authenticated
  with check (
    public.has_permission(server_id, 4) and not is_default
    and position < public.member_top_position(server_id)
    and (permissions & ~public.server_permissions(server_id)) = 0
  );
create policy roles_update on public.roles for update to authenticated
  using (public.has_permission(server_id, 4)
         and (is_default or position < public.member_top_position(server_id)))
  with check (
    (is_default or position < public.member_top_position(server_id))
    and (permissions & ~public.server_permissions(server_id)) = 0
  );
create policy roles_delete on public.roles for delete to authenticated
  using (public.has_permission(server_id, 4) and not is_default
         and position < public.member_top_position(server_id));

-- member_roles
create policy member_roles_select on public.member_roles for select to authenticated
  using (public.is_server_member(server_id));
create policy member_roles_insert on public.member_roles for insert to authenticated
  with check (
    public.has_permission(server_id, 4)
    and exists (select 1 from public.roles r where r.id = role_id and r.server_id = member_roles.server_id
                and not r.is_default and r.position < public.member_top_position(member_roles.server_id))
  );
create policy member_roles_delete on public.member_roles for delete to authenticated
  using (
    public.has_permission(server_id, 4)
    and exists (select 1 from public.roles r where r.id = role_id
                and r.position < public.member_top_position(member_roles.server_id))
  );

-- channels
create policy channels_select on public.channels for select to authenticated
  using (public.can_view_channel(id));
create policy channels_insert on public.channels for insert to authenticated
  with check (server_id is not null and type in ('text', 'voice')
              and public.has_permission(server_id, 8));
create policy channels_update on public.channels for update to authenticated
  using (server_id is not null and public.has_permission(server_id, 8))
  with check (server_id is not null and public.has_permission(server_id, 8));
create policy channels_delete on public.channels for delete to authenticated
  using (server_id is not null and public.has_permission(server_id, 8));

-- channel_role_access
create policy cra_select on public.channel_role_access for select to authenticated
  using (public.can_view_channel(channel_id));
create policy cra_insert on public.channel_role_access for insert to authenticated
  with check (exists (select 1 from public.channels c join public.roles r on r.server_id = c.server_id
                      where c.id = channel_id and r.id = role_id
                        and public.has_permission(c.server_id, 8)));
create policy cra_delete on public.channel_role_access for delete to authenticated
  using (exists (select 1 from public.channels c where c.id = channel_id
                 and public.has_permission(c.server_id, 8)));

-- dm_participants (created via open_dm only)
create policy dmp_select on public.dm_participants for select to authenticated
  using (public.can_view_channel(channel_id));

-- invites
create policy invites_select on public.invites for select to authenticated
  using (public.has_permission(server_id, 64));
create policy invites_delete on public.invites for delete to authenticated
  using (created_by = auth.uid() or public.has_permission(server_id, 2));

-- bans
create policy bans_select on public.bans for select to authenticated
  using (public.has_permission(server_id, 32));
create policy bans_insert on public.bans for insert to authenticated
  with check (
    public.has_permission(server_id, 32)
    and banned_by = auth.uid()
    and user_id <> auth.uid()
    and user_id <> (select owner_id from public.servers s where s.id = server_id)
    and public.member_top_position(server_id, user_id) < public.member_top_position(server_id)
  );
create policy bans_delete on public.bans for delete to authenticated
  using (public.has_permission(server_id, 32));

-- channel_epochs
create policy epochs_select on public.channel_epochs for select to authenticated
  using (public.can_view_channel(channel_id));
create policy epochs_insert on public.channel_epochs for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.can_view_channel(channel_id)
    and epoch = coalesce((select max(e.epoch) from public.channel_epochs e
                          where e.channel_id = channel_epochs.channel_id), 0) + 1
  );

-- channel_keys: you see the wraps addressed to you (and the ones you made).
create policy ckeys_select on public.channel_keys for select to authenticated
  using (recipient_id = auth.uid() or wrapper_id = auth.uid());
create policy ckeys_insert on public.channel_keys for insert to authenticated
  with check (
    wrapper_id = auth.uid()
    and public.can_view_channel(channel_id)
    and public.can_view_channel(channel_id, recipient_id)
    and exists (select 1 from public.user_keys k where k.key_id = recipient_key_id
                and k.user_id = recipient_id)
    and exists (select 1 from public.user_keys k where k.key_id = wrapper_key_id
                and k.user_id = auth.uid())
  );

-- messages
create policy messages_select on public.messages for select to authenticated
  using (public.can_view_channel(channel_id));
create policy messages_insert on public.messages for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.channel_has_permission(channel_id, 128)
    and exists (select 1 from public.user_keys k where k.key_id = author_key_id
                and k.user_id = auth.uid() and k.revoked_at is null)
    and not (select c.key_rotation_needed from public.channels c where c.id = channel_id)
    and epoch = (select max(e.epoch) from public.channel_epochs e where e.channel_id = messages.channel_id)
  );
create policy messages_update on public.messages for update to authenticated
  using (author_id = auth.uid() and public.can_view_channel(channel_id))
  with check (author_id = auth.uid()
              and exists (select 1 from public.user_keys k where k.key_id = author_key_id
                          and k.user_id = auth.uid() and k.revoked_at is null)
              and not (select c.key_rotation_needed from public.channels c where c.id = channel_id)
    and epoch = (select max(e.epoch) from public.channel_epochs e where e.channel_id = messages.channel_id));
create policy messages_delete on public.messages for delete to authenticated
  using (author_id = auth.uid() or public.channel_has_permission(channel_id, 256));

-- -----------------------------------------------------------------------------
-- Realtime
-- -----------------------------------------------------------------------------

alter publication supabase_realtime add table
  public.messages, public.channels, public.server_members, public.roles,
  public.member_roles, public.channel_epochs, public.channel_keys,
  public.servers, public.channel_role_access, public.dm_participants;

-- Old row needed on DELETE events for filters.
alter table public.messages replica identity full;
alter table public.server_members replica identity full;
alter table public.member_roles replica identity full;
alter table public.channels replica identity full;

-- Authorization for private Realtime channels (broadcast + presence).
--   scope:<server-or-dm-id>  presence: who is online / in which voice channel
--   chan:<channel-id>        typing indicators
--   call:<channel-id>        WebRTC signaling for voice/video/screen share
--   dbs:/dbc:/dbu:<id>       postgres_changes feeds (server / channel / user)
--   dmb:/dmc:<id>            bot DM feeds (presence + commands)
create or replace function public.realtime_topic_allowed(p_topic text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_kind text := split_part(p_topic, ':', 1);
  v_id_text text := split_part(p_topic, ':', 2);
  v_id uuid;
begin
  if v_id_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_id := v_id_text::uuid;
  if v_kind = 'scope' then
    return public.is_server_member(v_id)
        or exists (select 1 from public.dm_participants where channel_id = v_id and user_id = auth.uid());
  elsif v_kind = 'chan' then
    return public.can_view_channel(v_id);
  elsif v_kind in ('dmb', 'dmc') then  -- bot DM feeds (presence / commands)
    return public.can_view_channel(v_id);
  elsif v_kind = 'dbs' then   -- database change feed for a server
    return public.is_server_member(v_id);
  elsif v_kind = 'dbc' then   -- database change feed for a channel
    return public.can_view_channel(v_id);
  elsif v_kind = 'dbu' then   -- database change feed for the user themself
    return v_id = auth.uid();
  elsif v_kind = 'call' then
    return public.channel_has_permission(v_id, 512)
       and exists (select 1 from public.channels c where c.id = v_id and c.type in ('voice', 'dm'));
  end if;
  return false;
end;
$$;

create policy venband_realtime_select on realtime.messages for select to authenticated
  using (public.realtime_topic_allowed(realtime.topic()));
create policy venband_realtime_insert on realtime.messages for insert to authenticated
  with check (public.realtime_topic_allowed(realtime.topic()));

-- -----------------------------------------------------------------------------
-- Storage: encrypted attachments. Path = <channel_id>/<random>.bin
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 26214400)
on conflict (id) do nothing;

create or replace function public.storage_channel_allowed(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_first text := split_part(p_name, '/', 1);
begin
  if v_first !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.can_view_channel(v_first::uuid);
end;
$$;

create policy venband_attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.storage_channel_allowed(name));
create policy venband_attachments_write on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.storage_channel_allowed(name));
create policy venband_attachments_delete on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and owner_id = auth.uid()::text);

-- -----------------------------------------------------------------------------
-- Grants: remove anything not needed from anon; RPC access for authenticated.
-- -----------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on function public.username_available(text) to anon, authenticated;
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
-- the auth trigger runs as supabase_auth_admin
grant execute on function public.handle_new_user() to supabase_auth_admin;

-- Protected columns: clients may only change what they should.
revoke update on public.messages from authenticated;
grant update (epoch, iv, ciphertext, signature, author_key_id) on public.messages to authenticated;
revoke update on public.profiles from authenticated;
grant update (display_name, avatar_color, about) on public.profiles to authenticated;
revoke update on public.server_members from authenticated;
grant update (nickname) on public.server_members to authenticated;
revoke update on public.channels from authenticated;
grant update (name, topic, category, position, is_private) on public.channels to authenticated;
revoke update on public.user_keys from authenticated;
revoke insert on public.servers, public.server_members, public.invites, public.dm_participants from authenticated;

