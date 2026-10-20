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
