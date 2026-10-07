-- Wordle bot preset: a shared word game played with /wordle and /guess.
-- Also adds a banner_url to applications for the bot profile.

alter table public.applications
  drop constraint if exists applications_preset_check,
  add constraint applications_preset_check check (preset in ('custom', 'verification', 'management', 'site', 'wordle'));
alter table public.applications
  add column if not exists banner_url text check (banner_url is null or char_length(banner_url) <= 500);
alter table public.applications
  add column if not exists updated_at timestamptz not null default now();

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

-- Word list for the game.
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

-- One live game per channel. state.guesses holds the posted feedback rows.
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

-- Commands that preset bots answer themselves.
create or replace function public.preset_commands(p_preset text)
returns table (name text, description text) language sql immutable set search_path = '' as $$
  select v.n, v.d from (values ('management', 'serverinfo', 'Show information about this server'),
                        ('management', 'rules', 'Post the server rules'),
                        ('verification', 'verify', 'Get your Voogle verification link'),
                        ('wordle', 'wordle', 'Start a shared Wordle game in this channel'),
                        ('wordle', 'guess', 'Guess a 5-letter word, like /guess table')) v(p, n, d)
  where v.p = p_preset;
$$;

-- Route wordsle commands inside use_bot_command.
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