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
--   9. owner + founder powers (top staff: manage any bot, delete any server,
--      erase any account). Also drops the old 3-arg mod_set_account_status so
--      status changes aren't ambiguous.
--  10. force contact (admins/owners/founders can't be blocked out of DMs and
--      can clear a block someone placed on them)
--  11. set_username (change your username anytime)
--  12. app discovery + command builder + bot templates (discoverable tags
--      like #servermanagement, custom command replies + moderation actions,
--      ready-made templates, bot activity log)
--  13. schema cache reload
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
-- -----------------------------------------------------------------------------
-- -----------------------------------------------------------------------------
-- 7. Banned login. resolve_login() now also reports the matching account's
-- username and whether it is banned, so the sign-in form can show
-- "You are banned on @username" instead of a generic password error.
-- It still only resolves an existing account — never reveals who has an
-- account unless the typed identifier matches one.
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 8. Bot directory (Server Settings → Integrations & Bots). Server staff can
-- browse every active bot — with the official Venband bot pinned first — and
-- add one to their server directly, without pasting invite codes.
-- -----------------------------------------------------------------------------
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

-- bot_add_to_server(p_app, p_server): a server admin with Manage Integrations
-- adds an active bot to the server directly.
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

-- 9. Owner + founder powers. Top staff (platform owners or the owner/founder
--    badge) manage any bot, delete/restore any server, act on any account and
--    erase whole accounts. They can never target each other.
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
-- 10. Force contact: admins/owners/founders can't be blocked out of DMs and can
--    clear a block someone placed on them (rule-breakers can't run away).
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
-- 11. set_username: change your username anytime (same rules as signup).
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
-- -----------------------------------------------------------------------------
-- 12. App discovery + command builder + bot templates.
--     Discoverable tags (#servermanagement), custom command replies and safe
--     moderation actions, ready-made templates, and a bot activity log.
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

-- Directory now advertises each app's tags too. 20261018000000 defined the
-- return shape without tags, so drop-first (a create or replace cannot widen
-- the OUT row type).
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

-- ------------------------------------------------------------- commands ----
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

-- Save a bot's whole command list from its dashboard (same shape as the API's
-- commands.set, plus an optional response for each command).
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

-- ------------------------------------------------------------ templates ----
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
-- immutable (a bot stays the type it was created as), so only commands and
-- discoverable tags are applied.
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

-- -------------------------------------------------------------- responder ----
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

-- --------------------------------------------------------- activity log ----
-- A bot dashboard's recent activity: slash commands used and members joining
-- the servers the bot is in. Owner and team can see it.
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

-- ----------------------------------------------------------------- grants ----
revoke execute on function public.bot_set_commands(uuid, jsonb),
  public.apply_bot_template(uuid, text), public.list_bot_templates(), public.app_events(uuid, integer)
  from public, anon;
grant execute on function public.bot_set_commands(uuid, jsonb),
  public.apply_bot_template(uuid, text), public.list_bot_templates(), public.app_events(uuid, integer)
  to authenticated;

-- 13. Reload the PostgREST schema cache so new tables/functions are picked up.
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';
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
-- Rich presence: what you're doing cross-device.
--   * activities: one row per user — the current activity (nothing = offline /
--     nothing to show). Rows are pushed live so every client sees the same thing.
--   * desktop apps report here via their own Discord-IPC pipe bridge
--     (VS Code, games, YouTube, Spotify…); the web app confirms with the same
--     shape it already renders for bots.
--   * set_my_activity / clear_my_activity are the only writers (security definer).
-- =============================================================================
create table if not exists public.activities (
  user_id           uuid primary key references public.profiles (id) on delete cascade,
  platform          text not null default 'rpc'
                    check (platform in ('rpc', 'spotify', 'custom', 'connections')),
  icon              text,                                   -- emoji or provider slug
  name              text not null check (char_length(name) between 1 and 64),
  type              smallint not null default 0,            -- 0 play 1 stream 2 listen 3 watch 4 custom 5 compete
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
-- No direct writes: set_my_activity / clear_my_activity own the row.

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
-- Connections: the outside accounts you linked to your Venband profile.
--   * One row per (user, provider, external id) — a user can link several
--     accounts of the same provider.
--   * Only the owner can read/write their rows, so OAuth tokens / handles are
--     safe to keep here. Nothing here is public yet.
--   * add_connection / remove_connection are the only writers (security definer).
--   * Providers that need a server-held OAuth secret (Spotify, Twitch,
--     YouTube…) are registered here and appear in Settings → Connections;
--     Steam links fully client-side via OpenID.
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

-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';

