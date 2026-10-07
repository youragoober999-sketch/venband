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
  if not exists (select 1 from public.servers s where s.id = p_server and (s.verified or public.member_count(s.id) >= 500)) then
    raise exception 'custom links are for verified servers or servers with 500+ members';
  end if;
  if v !~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$' then raise exception 'use 3-32 letters, numbers or dashes'; end if;
  -- Impersonation words are reserved for everyone; the brand names (venband,
  -- voogle) too, but Venband staff may claim them for their own servers.
  -- Generic words match exactly, so e.g. "helpdesk" or "support-group" is fine.
  if not public.is_staff() then
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
