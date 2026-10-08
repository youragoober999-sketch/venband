-- =============================================================================
-- Venband PENDING sync — paste into Supabase → SQL Editor → Run.
-- Safe to run any number of times. Covers:
--   1. channel_overwrites (channel / category permission overwrites)
--   2. set_vanity (custom invite links: owners/staff can claim brand links,
--      owners can change anytime)
--   3. wordle bot preset + applications.banner_url (fixes the /bots error)
--   4. venband bot preset (official moderation toolkit)
--   5. venband bot DMs (real notices when a moderator restricts an account)
--   6. account deletion (Settings → My Account, replaces the 14-day grace flow)
--   7. banned login (resolve_login reports username + banned for the login form)
--   8. bot directory (Server Settings → Integrations: browse + add bots)
--   9. schema cache reload
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Channel / category permission overwrites.
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

grant select, insert, update, delete on public.channel_overwrites to authenticated;
grant execute on function public.channel_perm_for_user(uuid, uuid), public.channel_has_permission(uuid, bigint, uuid)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 2. set_vanity — custom invite links.
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 3. Wordle bot preset + applications.banner_url (fixes /bots banner_url error).
--    The preset list already includes 'venband' so databases that applied the
--    Venband bot earlier don't break; stray presets from older versions get
--    straightened out first, so this file stays safe to re-run.
-- -----------------------------------------------------------------------------
do $$
begin
  update public.applications
    set preset = 'custom'
    where preset not in ('custom', 'verification', 'management', 'site', 'wordle', 'venband');
end $$;
alter table public.applications
  drop constraint if exists applications_preset_check,
  add constraint applications_preset_check check (preset in ('custom', 'verification', 'management', 'site', 'wordle', 'venband'));
alter table public.applications
  add column if not exists banner_url text check (banner_url is null or char_length(banner_url) <= 500);
alter table public.applications
  add column if not exists updated_at timestamptz not null default now();

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
            else '' end,
          case p_preset when 'verification' then '#3ba55d' when 'management' then '#5865f2'
                        when 'site' then '#eb459e' when 'wordle' then '#6aaa64' else '#7c5cff' end)
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
                        ('wordle', 'guess', 'Guess a 5-letter word, like /guess table')) v(p, n, d)
  where v.p = p_preset;
$$;

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
  else
    return jsonb_build_object('status', 'queued', 'id', v_id);
  end if;
  update public.bot_interactions set handled = true where id = v_id;
  return jsonb_build_object('status', 'handled', 'id', v_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Venband bot preset — an official moderation toolkit. Discoverable in
--    /bots like the other presets. Answers /serverinfo /info /purge /ban
--    /kick /lock /unlock with embeds.
-- -----------------------------------------------------------------------------

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

-- Resolves a leading @mention or <@id> in command args to a user id.
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

-- -----------------------------------------------------------------------------
-- 5. Venband bot DMs: when a moderator restricts an account (limited /
--    very_limited / banned), the Venband bot sends a plain DM to the user with
--    the reason (and the attached server, when there is one).
--    NOTE: needs block 4 (venband preset) to have run so the application can
--    be created with preset 'venband'.
-- -----------------------------------------------------------------------------

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

-- -----------------------------------------------------------------------------
-- 6. Account deletion (Settings → My Account).
-- Typing the exact phrase "I want to delete my account" permanently deletes
-- the account and everything tied to it: 1:1 DMs, files in object storage,
-- and — cascading from auth.users → profiles — profile, username, email,
-- messages, keys, friends and memberships. The old 14-day grace path
-- (request/cancel_account_deletion, deletion_requested_at) is removed.
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 7. Banned login. resolve_login() now also reports the matching account's
-- username and whether it is banned, so the sign-in form can show
-- "You are banned on @username" instead of a generic password error.
-- It still only resolves an existing account — never reveals who has an
-- account unless the typed identifier matches one.
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 8. Bot directory (Server Settings → Integrations & Bots). Server staff can
-- browse every active bot — with the official Venband bot pinned first — and
-- add one to their server directly, without pasting invite codes.
-- -----------------------------------------------------------------------------
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
-- 9. Reload the PostgREST schema cache so new tables/functions are picked up.
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';