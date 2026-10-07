-- =============================================================================
-- Venband PENDING sync — paste into Supabase → SQL Editor → Run.
-- Safe to run any number of times. Covers:
--   1. channel_overwrites (channel / category permission overwrites)
--   2. set_vanity (custom invite links: owners/staff can claim brand links,
--      owners can change anytime)
--   3. wordle bot preset + applications.banner_url (fixes the /bots error)
--   4. schema cache reload
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
-- -----------------------------------------------------------------------------
alter table public.applications
  drop constraint if exists applications_preset_check,
  add constraint applications_preset_check check (preset in ('custom', 'verification', 'management', 'site', 'wordle'));
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
-- 4. Reload the PostgREST schema cache so new tables/functions are picked up.
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';