-- =============================================================================
-- Comet (20261107160000)
--
-- Venband now has two bots: the official Venband bot (account notices) and
-- Comet, a server management + moderation bot anyone can add from App
-- Discovery. The older built-in bots (Greeter, Gatekeeper, Word Guess,
-- Announcer, Mod Toolkit) are retired — Comet covers what they did.
--
-- Comet's commands run here, as the person who typed them, with that
-- person's permissions and role position checked for every action.
-- Messages are end-to-end encrypted, so anything that depends on what a
-- message SAYS (purge links/images/files/embeds/mentions, the word logger, the
-- swear jar) is worked out on the user's own device; the server only ever
-- receives message ids or a count.
--
-- Safe to run more than once.
-- =============================================================================

-- ------------------------------------------------------------- the bot ----
alter table public.applications drop constraint if exists applications_preset_check;
alter table public.applications add constraint applications_preset_check
  check (preset in ('custom', 'verification', 'management', 'site', 'wordle', 'venband', 'comet'));

insert into public.applications (owner_id, name, preset, description, color, icon_url, tags)
select '3fff0000-0000-4000-8000-0000000000bd', 'Comet', 'comet',
       'Server management and moderation in one bot: bans, timeouts, voice mutes, warnings, purges, auto-roles, levels, a swear jar, birthdays, a word logger and a staff log.',
       '#7c5cff', '/bots/comet.svg', array['moderation', 'servermanagement', 'levels', 'fun']
 where exists (select 1 from public.profiles where id = '3fff0000-0000-4000-8000-0000000000bd')
   and not exists (select 1 from public.applications where owner_id = '3fff0000-0000-4000-8000-0000000000bd' and preset = 'comet');

-- (status changes are a staff action: the guard wants venband.mod on for this transaction)
select set_config('venband.mod', 'on', true);
update public.applications set status = 'disabled'
 where owner_id = '3fff0000-0000-4000-8000-0000000000bd' and status <> 'disabled'
   and name in ('Greeter', 'Gatekeeper', 'Word Guess', 'Announcer', 'Mod Toolkit');
select set_config('venband.mod', 'off', true);

-- ---------------------------------------------------------------- data ----
alter table public.server_members add column if not exists voice_muted_until timestamptz;
alter table public.server_members add column if not exists voice_deafened_until timestamptz;

create table if not exists public.comet_levels (
  server_id  uuid not null references public.servers (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  xp         integer not null default 0 check (xp >= 0),
  level      integer not null default 0 check (level >= 0),
  messages   integer not null default 0,
  streak     integer not null default 0,
  last_day   date,
  last_xp_at timestamptz,
  quests     jsonb not null default '{}'::jsonb,
  primary key (server_id, user_id)
);
alter table public.comet_levels enable row level security;
drop policy if exists comet_levels_select on public.comet_levels;
create policy comet_levels_select on public.comet_levels for select to authenticated using (public.is_server_member(server_id));

create table if not exists public.comet_swears (
  server_id uuid not null references public.servers (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  count     integer not null default 0 check (count >= 0),
  primary key (server_id, user_id)
);
alter table public.comet_swears enable row level security;

create table if not exists public.comet_birthdays (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  month   smallint not null check (month between 1 and 12),
  day     smallint not null check (day between 1 and 31)
);
alter table public.comet_birthdays enable row level security;

-- --------------------------------------------------------------- helpers --
create or replace function public.comet_app() returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.applications where owner_id = '3fff0000-0000-4000-8000-0000000000bd' and preset = 'comet' limit 1;
$$;

create or replace function public.comet_cfg(p_server uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select settings from public.server_bots where server_id = p_server and app_id = public.comet_app()), '{}'::jsonb);
$$;

create or replace function public.comet_set(p_server uuid, p_key text, p_value jsonb) returns void language sql security definer set search_path = '' as $$
  update public.server_bots set settings = case when p_value is null then settings - p_key else jsonb_set(settings, array[p_key], p_value, true) end
   where server_id = p_server and app_id = public.comet_app();
$$;

-- "quoted words" stay together; everything else splits on spaces
create or replace function public.comet_tokens(p_args text) returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(coalesce(m[1], m[2])), '{}') from regexp_matches(coalesce(p_args, ''), '"([^"]*)"|(\S+)', 'g') as m;
$$;

create or replace function public.comet_user(p_server uuid, p_tok text) returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  t text := btrim(coalesce(p_tok, ''));
  m text[];
  v uuid;
begin
  m := regexp_match(t, '^<@!?([0-9a-f-]{36})>$');
  if m is not null then return m[1]::uuid; end if;
  if t ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return t::uuid; end if;
  t := lower(ltrim(t, '@'));
  if t = '' then return null; end if;
  select id into v from public.profiles where username = t;
  if v is not null then return v; end if;
  -- a member's display name or server nickname also works
  select p.id into v from public.server_members sm join public.profiles p on p.id = sm.user_id
   where sm.server_id = p_server and (lower(coalesce(sm.nickname, '')) = t or lower(p.display_name) = t) limit 1;
  return v;
end;
$$;

create or replace function public.comet_role(p_server uuid, p_tok text) returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  t text := btrim(coalesce(p_tok, ''));
  m text[];
  v uuid;
begin
  m := regexp_match(t, '^<@&([0-9a-f-]{36})>$');
  if m is not null then select id into v from public.roles where id = m[1]::uuid and server_id = p_server; return v; end if;
  t := lower(ltrim(t, '@'));
  if t in ('everyone', '') then return null; end if;
  select id into v from public.roles where server_id = p_server and not is_default and lower(name) = t limit 1;
  return v;
end;
$$;

create or replace function public.comet_channel(p_server uuid, p_tok text) returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  t text := btrim(coalesce(p_tok, ''));
  m text[];
  v uuid;
begin
  m := regexp_match(t, '^<#([0-9a-f-]{36})>$');
  if m is not null then select id into v from public.channels where id = m[1]::uuid and server_id = p_server; return v; end if;
  t := lower(ltrim(t, '#'));
  select id into v from public.channels where server_id = p_server and lower(name) = t order by type = 'text' desc limit 1;
  return v;
end;
$$;

-- 30s · 10m · 1h/1hr · 1d · 1w/1week · 1mo/1mnth · 1y/1yr  ->  interval (null = not a duration)
create or replace function public.comet_duration(p_tok text) returns interval language plpgsql immutable set search_path = '' as $$
declare
  m text[] := regexp_match(lower(btrim(coalesce(p_tok, ''))), '^([0-9]{1,4})\s*(s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?|w|wks?|weeks?|mo|mos|mnths?|months?|y|yrs?|years?)$');
  n integer;
begin
  if m is null then return null; end if;
  n := m[1]::integer;
  return case
    when m[2] ~ '^s' then make_interval(secs => n)
    when m[2] ~ '^(m|mins?|minutes?)$' then make_interval(mins => n)
    when m[2] ~ '^h' then make_interval(hours => n)
    when m[2] ~ '^d' then make_interval(days => n)
    when m[2] ~ '^w' then make_interval(weeks => n)
    when m[2] ~ '^(mo|mos|mnths?|months?)$' then make_interval(months => n)
    else make_interval(years => n) end;
end;
$$;

create or replace function public.comet_name(p_user uuid) returns text language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(display_name, ''), username) from public.profiles where id = p_user;
$$;

create or replace function public.comet_reply(p_app uuid, p_channel uuid, p_title text, p_desc text, p_color text default '#7c5cff', p_fields jsonb default null, p_interaction uuid default null)
returns void language sql security definer set search_path = '' as $$
  select public.bot_post(p_app, p_channel, '',
    jsonb_strip_nulls(jsonb_build_object('title', left(p_title, 200), 'description', left(coalesce(p_desc, ''), 3500), 'color', p_color, 'fields', p_fields)),
    null, p_interaction);
$$;

-- every moderation action also lands in the staff log channel, when one is set
create or replace function public.comet_log(p_server uuid, p_title text, p_desc text, p_color text default '#7c5cff') returns void language plpgsql security definer set search_path = '' as $$
declare
  v_chan uuid := nullif(public.comet_cfg(p_server) ->> 'log_channel', '')::uuid;
begin
  if v_chan is null or not exists (select 1 from public.channels where id = v_chan and server_id = p_server) then return; end if;
  perform public.bot_post(public.comet_app(), v_chan, '', jsonb_build_object('title', p_title, 'description', left(p_desc, 3500), 'color', p_color,
    'fields', jsonb_build_array(jsonb_build_object('name', 'By', 'value', coalesce('<@' || auth.uid() || '>', 'Comet')))), null, null);
end;
$$;

create or replace function public.comet_level_for(p_xp integer) returns integer language sql immutable set search_path = '' as $$
  select floor(sqrt(greatest(p_xp, 0) / 100.0))::integer;
$$;

-- ----------------------------------------------------------- triggers ----
-- joins: paused invites block new members; auto-role hands out a role
create or replace function public.comet_on_join() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_cfg jsonb := public.comet_cfg(new.server_id);
  v_role uuid;
begin
  if coalesce((v_cfg ->> 'invites_paused')::boolean, false)
     and new.user_id <> (select owner_id from public.servers where id = new.server_id) then
    raise exception 'This server has paused new joins for now. Try again later.';
  end if;
  return new;
end;
$$;
drop trigger if exists comet_join_guard on public.server_members;
create trigger comet_join_guard before insert on public.server_members for each row execute function public.comet_on_join();

create or replace function public.comet_after_join() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_role uuid := nullif(public.comet_cfg(new.server_id) ->> 'autorole', '')::uuid;
begin
  if v_role is not null and exists (select 1 from public.roles where id = v_role and server_id = new.server_id) then
    insert into public.member_roles (server_id, user_id, role_id) values (new.server_id, new.user_id, v_role) on conflict do nothing;
  end if;
  return null;
end;
$$;
drop trigger if exists comet_join_autorole on public.server_members;
create trigger comet_join_autorole after insert on public.server_members for each row execute function public.comet_after_join();

-- levels: XP for chatting (once a minute), with a daily-streak quest bonus
create or replace function public.comet_on_message() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_server uuid;
  r public.comet_levels;
  v_gain integer := 0;
  v_today date := (now() at time zone 'utc')::date;
  v_streak integer;
  v_quests jsonb;
  v_old integer;
begin
  select server_id into v_server from public.channels where id = new.channel_id;
  if v_server is null or not coalesce((public.comet_cfg(v_server) ->> 'levels')::boolean, false) then return null; end if;
  insert into public.comet_levels (server_id, user_id) values (v_server, new.author_id) on conflict do nothing;
  select * into r from public.comet_levels where server_id = v_server and user_id = new.author_id for update;
  v_old := r.level;
  if r.last_xp_at is null or r.last_xp_at < now() - interval '60 seconds' then v_gain := 15 + floor(random() * 11)::integer; end if;
  v_streak := case when r.last_day = v_today then r.streak when r.last_day = v_today - 1 then r.streak + 1 else 1 end;
  v_quests := r.quests;
  -- quests: first message of the day (+20), 2-day streak (+75), 7-day streak (+300), 100 messages (+250)
  if r.last_day is distinct from v_today then v_gain := v_gain + 20; end if;
  if v_streak >= 2 and not (v_quests ? 'streak2') then v_gain := v_gain + 75; v_quests := v_quests || '{"streak2": true}'; end if;
  if v_streak >= 7 and not (v_quests ? 'streak7') then v_gain := v_gain + 300; v_quests := v_quests || '{"streak7": true}'; end if;
  if r.messages + 1 >= 100 and not (v_quests ? 'chatty100') then v_gain := v_gain + 250; v_quests := v_quests || '{"chatty100": true}'; end if;
  update public.comet_levels
     set xp = xp + v_gain, level = public.comet_level_for(xp + v_gain), messages = messages + 1, streak = v_streak, last_day = v_today,
         last_xp_at = case when v_gain > 0 then now() else last_xp_at end, quests = v_quests
   where server_id = v_server and user_id = new.author_id;
  if public.comet_level_for(r.xp + v_gain) > v_old then
    perform public.bot_post(public.comet_app(), new.channel_id, '<@' || new.author_id || '> reached **level ' || public.comet_level_for(r.xp + v_gain) || '** ✨', null, null, null);
  end if;
  return null;
end;
$$;
drop trigger if exists comet_levels_xp on public.messages;
create trigger comet_levels_xp after insert on public.messages for each row execute function public.comet_on_message();

-- reports inside a server go to the staff log
create or replace function public.comet_on_report() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.server_id is not null then
    perform public.comet_log(new.server_id, 'New report',
      coalesce('Reported user: <@' || new.target_user || '>' || E'\n', '') || coalesce('Channel: <#' || new.channel_id || '>' || E'\n', '') || 'Reason: ' || left(new.reason, 500),
      '#ff9f0a');
  end if;
  return null;
end;
$$;
drop trigger if exists comet_report_log on public.reports;
create trigger comet_report_log after insert on public.reports for each row execute function public.comet_on_report();

-- ------------------------------------------------ device-side helpers ----
-- What members' devices need to know: is the word logger / swear jar on, and which words.
create or replace function public.comet_client_config(p_server uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select case when public.is_server_member(p_server) and public.comet_app() is not null
              and exists (select 1 from public.server_bots where server_id = p_server and app_id = public.comet_app())
         then jsonb_build_object(
           'installed', true,
           'swearjar', coalesce((public.comet_cfg(p_server) ->> 'swearjar')::boolean, false),
           'words', coalesce(public.comet_cfg(p_server) -> 'wordlog_words', '[]'::jsonb),
           'wordlog', (public.comet_cfg(p_server) ->> 'wordlog_channel') is not null)
         else jsonb_build_object('installed', false) end;
$$;

-- the sender's device noticed a logged word in a message it is about to send
create or replace function public.comet_word_hit(p_channel uuid, p_words text[], p_excerpt text) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_server uuid;
  v_log uuid;
begin
  select server_id into v_server from public.channels where id = p_channel;
  if v_server is null or not public.is_server_member(v_server) then return; end if;
  v_log := nullif(public.comet_cfg(v_server) ->> 'wordlog_channel', '')::uuid;
  if v_log is null then return; end if;
  if (select count(*) from public.bot_messages where channel_id = v_log and created_at > now() - interval '10 seconds') > 10 then return; end if;
  perform public.bot_post(public.comet_app(), v_log, '', jsonb_build_object('title', 'Word logged', 'color', '#ff9f0a',
    'description', '<@' || auth.uid() || '> used a logged word in <#' || p_channel || '>',
    'fields', jsonb_build_array(
      jsonb_build_object('name', 'Word', 'value', '||' || left(array_to_string(p_words[1:5], ', '), 200) || '||'),
      jsonb_build_object('name', 'Message', 'value', '||' || left(coalesce(p_excerpt, ''), 400) || '||'))), null, null);
end;
$$;

create or replace function public.comet_swear(p_channel uuid, p_n integer) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_server uuid;
begin
  select server_id into v_server from public.channels where id = p_channel;
  if v_server is null or not public.is_server_member(v_server) or not coalesce((public.comet_cfg(v_server) ->> 'swearjar')::boolean, false) then return; end if;
  insert into public.comet_swears (server_id, user_id, count) values (v_server, auth.uid(), least(greatest(p_n, 0), 10))
  on conflict (server_id, user_id) do update set count = public.comet_swears.count + least(greatest(p_n, 0), 10);
end;
$$;

-- purge by content: the moderator's device picked the message ids
create or replace function public.comet_purge_ids(p_channel uuid, p_ids uuid[], p_label text) returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_server uuid;
  v_n integer;
begin
  select server_id into v_server from public.channels where id = p_channel;
  if v_server is null or not public.channel_has_permission(p_channel, 256) then raise exception 'you need the Manage Messages permission to purge'; end if;
  with gone as (delete from public.messages where channel_id = p_channel and id = any(p_ids[1:500]) returning 1) select count(*) into v_n from gone;
  perform public.comet_reply(public.comet_app(), p_channel, 'Purged', 'Deleted ' || v_n || ' message' || case when v_n = 1 then '' else 's' end || ' with ' || left(coalesce(p_label, 'that filter'), 40) || '.', '#ff6b81');
  perform public.comet_log(v_server, 'Purge', v_n || ' messages with ' || left(coalesce(p_label, 'a filter'), 40) || ' in <#' || p_channel || '>', '#ff6b81');
  return v_n;
end;
$$;

-- voice: my own forced mute / deafen in a server (the call checks this)
create or replace function public.comet_my_voice(p_server uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('muted', voice_muted_until is not null and voice_muted_until > now(), 'deafened', voice_deafened_until is not null and voice_deafened_until > now())
    from public.server_members where server_id = p_server and user_id = auth.uid();
$$;

create or replace function public.comet_birthday_set(p_month integer, p_day integer) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_month is null then delete from public.comet_birthdays where user_id = auth.uid(); return; end if;
  if p_day < 1 or p_day > extract(day from (make_date(2024, p_month, 1) + interval '1 month - 1 day')) then raise exception 'that date doesn''t exist'; end if;
  insert into public.comet_birthdays (user_id, month, day) values (auth.uid(), p_month, p_day)
  on conflict (user_id) do update set month = excluded.month, day = excluded.day;
end;
$$;

-- ------------------------------------------------------------ commands ----
create or replace function public.comet_command(p_app uuid, p_channel uuid, p_server uuid, p_cmd text, p_args text, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  tok text[] := public.comet_tokens(p_args);
  cmd text := lower(p_cmd);
  sub text;
  v_u uuid;
  v_r uuid;
  v_c uuid;
  v_iv interval;
  v_until timestamptz;
  v_n integer;
  v_txt text;
  v_name text;
  v_fields jsonb;
  v_owner uuid := (select owner_id from public.servers where id = p_server);
  me uuid := auth.uid();
  my_top integer := public.member_top_position(p_server);
  ok text := '#2ed573';
  bad text := '#ff4757';
  warn text := '#ffa502';
begin
  -- two-word commands typed as one: "/swear jar enable", "/staff log set", "/server count", "/roll all", "/purge all"
  if cmd = 'swear' and lower(coalesce(tok[1], '')) = 'jar' then cmd := 'swearjar'; tok := tok[2:]; end if;
  if cmd = 'staff' and lower(coalesce(tok[1], '')) = 'log' then cmd := 'stafflog'; tok := tok[2:]; end if;
  if cmd = 'server' and lower(coalesce(tok[1], '')) = 'count' then cmd := 'servercount'; tok := tok[2:]; end if;
  if cmd = 'roll' and lower(coalesce(tok[1], '')) = 'all' then cmd := 'rollall'; tok := tok[2:]; end if;
  if cmd = 'role' and lower(coalesce(tok[1], '')) = 'all' then cmd := 'rollall'; tok := tok[2:]; end if;
  if cmd = 'untime' then cmd := 'untimeout'; end if;
  if cmd = 'timout' then cmd := 'timeout'; end if;
  sub := lower(coalesce(tok[1], ''));

  -- ------------------------------------------------ members: ban / kick ----
  if cmd in ('ban', 'kick', 'unban') then
    v_u := public.comet_user(p_server, tok[1]);
    if v_u is null then
      perform public.comet_reply(p_app, p_channel, 'Who?', 'Usage: **/' || cmd || ' @user' || case when cmd <> 'unban' then ' reason' else '' end || '** — a mention, username or user id.', warn, null, p_id); return;
    end if;
    v_txt := array_to_string(tok[2:], ' ');
    v_name := public.comet_name(v_u);
    if cmd = 'unban' then
      if not public.has_permission(p_server, 32) then raise exception 'you need the Ban Members permission'; end if;
      delete from public.bans where server_id = p_server and user_id = v_u;
      if not found then perform public.comet_reply(p_app, p_channel, 'Not banned', '**' || v_name || '** isn''t banned here.', warn, null, p_id); return; end if;
      perform public.audit(p_server, 'unban', v_u, null, '{}'::jsonb);
      perform public.comet_reply(p_app, p_channel, 'Unbanned', '**' || v_name || '** can join again.', ok, null, p_id);
      perform public.comet_log(p_server, 'Unban', '<@' || v_u || '>', ok);
      return;
    end if;
    if not public.can_moderate(p_server, v_u, case when cmd = 'ban' then 32 else 16 end) then
      raise exception using message = 'you can''t ' || cmd || ' that member (permission or role position)';
    end if;
    if cmd = 'ban' then
      insert into public.bans (server_id, user_id, banned_by, reason) values (p_server, v_u, me, left(v_txt, 512))
      on conflict (server_id, user_id) do update set reason = excluded.reason, banned_by = excluded.banned_by;
      delete from public.server_members where server_id = p_server and user_id = v_u;
    else
      delete from public.server_members where server_id = p_server and user_id = v_u;
      if not found then perform public.comet_reply(p_app, p_channel, 'Not here', '**' || v_name || '** isn''t in this server.', warn, null, p_id); return; end if;
    end if;
    perform public.audit(p_server, cmd, v_u, null, jsonb_build_object('reason', left(v_txt, 200)));
    perform public.comet_reply(p_app, p_channel, case when cmd = 'ban' then 'Banned' else 'Kicked' end, '**' || v_name || '** was ' || case when cmd = 'ban' then 'banned' else 'kicked' end || '.', bad,
      jsonb_build_array(jsonb_build_object('name', 'Reason', 'value', coalesce(nullif(v_txt, ''), 'No reason given.'))), p_id);
    perform public.comet_log(p_server, initcap(cmd), '<@' || v_u || '> · ' || coalesce(nullif(v_txt, ''), 'no reason'), bad);

  -- ------------------------------- timeouts, voice mute / deafen, warn -----
  elsif cmd in ('timeout', 'mute', 'deafen', 'untimeout', 'unmute', 'undeafen') then
    v_u := public.comet_user(p_server, tok[1]);
    if v_u is null then
      perform public.comet_reply(p_app, p_channel, 'Who?', 'Usage: **/' || cmd || ' @user' || case when cmd like 'un%' then '' else ' [30s · 1h · 1d · 1w · 1mo · 1y]' end || '**' || case when cmd like 'un%' then '' else E'\nLeave the time out and it lasts until **/un' || cmd || '**.' end, warn, null, p_id); return;
    end if;
    if not exists (select 1 from public.server_members where server_id = p_server and user_id = v_u) then raise exception 'that person isn''t in this server'; end if;
    if not public.can_moderate(p_server, v_u, case when cmd in ('timeout', 'untimeout') then 2097152 when cmd in ('mute', 'unmute') then 33554432 else 67108864 end) then
      raise exception using message = 'you can''t ' || cmd || ' that member (permission or role position)';
    end if;
    v_name := public.comet_name(v_u);
    if cmd like 'un%' then
      if cmd = 'untimeout' then update public.server_members set timeout_until = null, timeout_reason = null where server_id = p_server and user_id = v_u;
      elsif cmd = 'unmute' then update public.server_members set voice_muted_until = null where server_id = p_server and user_id = v_u;
      else update public.server_members set voice_deafened_until = null where server_id = p_server and user_id = v_u; end if;
      perform public.audit(p_server, cmd, v_u, null, '{}'::jsonb);
      perform public.comet_reply(p_app, p_channel, 'Done', '**' || v_name || '** is no longer ' || case cmd when 'untimeout' then 'timed out' when 'unmute' then 'muted' else 'deafened' end || '.', ok, null, p_id);
      perform public.comet_log(p_server, initcap(cmd), '<@' || v_u || '>', ok);
      return;
    end if;
    v_iv := public.comet_duration(tok[2]);
    v_txt := array_to_string(case when v_iv is null then tok[2:] else tok[3:] end, ' ');
    v_until := case when v_iv is null then now() + interval '100 years' else now() + v_iv end;
    if cmd = 'timeout' then
      update public.server_members set timeout_until = v_until, timeout_reason = nullif(left(v_txt, 512), '') where server_id = p_server and user_id = v_u;
    elsif cmd = 'mute' then
      update public.server_members set voice_muted_until = v_until where server_id = p_server and user_id = v_u;
    else
      update public.server_members set voice_deafened_until = v_until where server_id = p_server and user_id = v_u;
    end if;
    perform public.audit(p_server, cmd, v_u, null, jsonb_build_object('until', v_until, 'reason', left(v_txt, 200)));
    perform public.comet_reply(p_app, p_channel, case cmd when 'timeout' then 'Timed out' when 'mute' then 'Muted in voice' else 'Deafened in voice' end,
      '**' || v_name || '** ' || case when v_iv is null then 'until a moderator lifts it (**/un' || cmd || '**).' else 'until ' || to_char(v_until at time zone 'utc', 'Mon DD, YYYY HH24:MI') || ' UTC.' end, warn,
      case when v_txt <> '' then jsonb_build_array(jsonb_build_object('name', 'Reason', 'value', v_txt)) end, p_id);
    perform public.comet_log(p_server, initcap(cmd), '<@' || v_u || '> ' || case when v_iv is null then 'indefinitely' else 'for ' || tok[2] end, warn);

  elsif cmd = 'warn' then
    v_u := public.comet_user(p_server, tok[1]);
    v_txt := array_to_string(tok[2:], ' ');
    if v_u is null or btrim(v_txt) = '' then
      perform public.comet_reply(p_app, p_channel, 'Usage', '**/warn @user "reason"** — they get a pop-up: “You have been warned”, with your reason.', warn, null, p_id); return;
    end if;
    perform public.warn_member(p_server, v_u, v_txt);
    perform public.comet_reply(p_app, p_channel, 'Warned', '**' || public.comet_name(v_u) || '** was warned.', warn, jsonb_build_array(jsonb_build_object('name', 'Reason', 'value', v_txt)), p_id);
    perform public.comet_log(p_server, 'Warn', '<@' || v_u || '> · ' || v_txt, warn);

  elsif cmd in ('warnings', 'clearwarns') then
    v_u := public.comet_user(p_server, tok[1]);
    if v_u is null then perform public.comet_reply(p_app, p_channel, 'Usage', '**/' || cmd || ' @user**', warn, null, p_id); return; end if;
    if not public.has_permission(p_server, 2097152) then raise exception 'you need the Timeout & Warn Members permission'; end if;
    if cmd = 'clearwarns' then
      delete from public.member_warnings where server_id = p_server and user_id = v_u;
      get diagnostics v_n = row_count;
      perform public.comet_reply(p_app, p_channel, 'Warnings cleared', 'Removed ' || v_n || ' warning' || case when v_n = 1 then '' else 's' end || ' from **' || public.comet_name(v_u) || '**.', ok, null, p_id);
    else
      select string_agg('• ' || to_char(created_at, 'Mon DD') || ' — ' || left(reason, 120), E'\n' order by created_at desc), count(*) into v_txt, v_n
        from (select * from public.member_warnings where server_id = p_server and user_id = v_u order by created_at desc limit 15) w;
      perform public.comet_reply(p_app, p_channel, public.comet_name(v_u) || ' — ' || v_n || ' warning' || case when v_n = 1 then '' else 's' end, coalesce(v_txt, 'No warnings. 🎉'), warn, null, p_id);
    end if;

  -- ---------------------------------------------------------------- roles ----
  elsif cmd in ('role', 'unrole') then
    v_u := public.comet_user(p_server, tok[1]);
    v_r := public.comet_role(p_server, tok[2]);
    if v_u is null or v_r is null then perform public.comet_reply(p_app, p_channel, 'Usage', '**/' || cmd || ' @user @role** — ' || case when cmd = 'role' then 'adds' else 'removes' end || ' a role (other roles stay).', warn, null, p_id); return; end if;
    if not public.has_permission(p_server, 4) then raise exception 'you need the Manage Roles permission'; end if;
    if me <> v_owner and (select position from public.roles where id = v_r) >= my_top then raise exception 'that role is as high as or higher than yours'; end if;
    if cmd = 'role' then
      insert into public.member_roles (server_id, user_id, role_id) values (p_server, v_u, v_r) on conflict do nothing;
    else
      delete from public.member_roles where server_id = p_server and user_id = v_u and role_id = v_r;
    end if;
    perform public.comet_reply(p_app, p_channel, case when cmd = 'role' then 'Role added' else 'Role removed' end, '<@&' || v_r || '> ' || case when cmd = 'role' then '→' else '✕' end || ' **' || public.comet_name(v_u) || '**', ok, null, p_id);
    perform public.comet_log(p_server, initcap(cmd), '<@&' || v_r || '> · <@' || v_u || '>', ok);

  elsif cmd = 'rollall' then
    v_r := public.comet_role(p_server, tok[1]);
    if v_r is null then perform public.comet_reply(p_app, p_channel, 'Usage', '**/roll all @role** — gives every member that role.', warn, null, p_id); return; end if;
    if not public.has_permission(p_server, 4) then raise exception 'you need the Manage Roles permission'; end if;
    if me <> v_owner and (select position from public.roles where id = v_r) >= my_top then raise exception 'that role is as high as or higher than yours'; end if;
    with added as (insert into public.member_roles (server_id, user_id, role_id) select p_server, user_id, v_r from public.server_members where server_id = p_server on conflict do nothing returning 1)
    select count(*) into v_n from added;
    perform public.comet_reply(p_app, p_channel, 'Role given to everyone', '<@&' || v_r || '> → ' || v_n || ' member' || case when v_n = 1 then '' else 's' end || '.', ok, null, p_id);
    perform public.comet_log(p_server, 'Roll all', '<@&' || v_r || '> to ' || v_n || ' members', ok);

  elsif cmd = 'autorole' then
    if not public.has_permission(p_server, 4) then raise exception 'you need the Manage Roles permission'; end if;
    if sub in ('off', 'none', 'clear', '') then
      perform public.comet_set(p_server, 'autorole', null);
      perform public.comet_reply(p_app, p_channel, 'Auto-role off', 'New members won''t get a role automatically.', ok, null, p_id); return;
    end if;
    v_r := public.comet_role(p_server, tok[1]);
    if v_r is null then perform public.comet_reply(p_app, p_channel, 'Usage', '**/autorole @role** (or **/autorole off**)', warn, null, p_id); return; end if;
    if me <> v_owner and (select position from public.roles where id = v_r) >= my_top then raise exception 'that role is as high as or higher than yours'; end if;
    perform public.comet_set(p_server, 'autorole', to_jsonb(v_r::text));
    perform public.comet_reply(p_app, p_channel, 'Auto-role on', 'Everyone who joins now gets <@&' || v_r || '>.', ok, null, p_id);

  elsif cmd = 'roleinfo' then
    v_r := public.comet_role(p_server, tok[1]);
    if v_r is null then perform public.comet_reply(p_app, p_channel, 'Usage', '**/roleinfo @role**', warn, null, p_id); return; end if;
    select jsonb_build_array(jsonb_build_object('name', 'Members', 'value', (select count(*) from public.member_roles where role_id = v_r)::text),
                             jsonb_build_object('name', 'Colour', 'value', color), jsonb_build_object('name', 'Position', 'value', position::text),
                             jsonb_build_object('name', 'Created', 'value', to_char(created_at, 'Mon DD, YYYY'))), name, color
      into v_fields, v_name, v_txt from public.roles where id = v_r;
    perform public.comet_reply(p_app, p_channel, v_name, '', v_txt, v_fields, p_id);

  -- --------------------------------------------------------------- server ----
  elsif cmd = 'pauseinvites' then
    if not public.has_permission(p_server, 2) then raise exception 'you need the Manage Server permission'; end if;
    if coalesce((public.comet_cfg(p_server) ->> 'invites_paused')::boolean, false) then
      perform public.comet_set(p_server, 'invites_paused', null);
      perform public.comet_reply(p_app, p_channel, 'Invites back on', 'People can join with invites again.', ok, null, p_id);
      perform public.comet_log(p_server, 'Invites resumed', 'New joins are allowed again.', ok);
    else
      perform public.comet_set(p_server, 'invites_paused', 'true'::jsonb);
      perform public.comet_reply(p_app, p_channel, 'Invites paused', 'Nobody new can join until you run **/pauseinvites** again.', warn, null, p_id);
      perform public.comet_log(p_server, 'Invites paused', 'All invites and joins are paused.', warn);
    end if;

  elsif cmd = 'stafflog' then
    if not public.has_permission(p_server, 2) then raise exception 'you need the Manage Server permission'; end if;
    if sub in ('off', 'clear') then perform public.comet_set(p_server, 'log_channel', null); perform public.comet_reply(p_app, p_channel, 'Staff log off', 'Mod actions won''t be logged anymore.', ok, null, p_id); return; end if;
    v_c := public.comet_channel(p_server, case when sub = 'set' then tok[2] else tok[1] end);
    if v_c is null then perform public.comet_reply(p_app, p_channel, 'Usage', '**/staff log set #channel** — mod actions and reports get logged there.', warn, null, p_id); return; end if;
    perform public.comet_set(p_server, 'log_channel', to_jsonb(v_c::text));
    perform public.comet_reply(p_app, p_channel, 'Staff log set', 'Mod actions and reports will be posted in <#' || v_c || '>.', ok, null, p_id);
    perform public.comet_log(p_server, 'Staff log connected', 'This channel now receives Comet''s mod log.', ok);

  elsif cmd = 'wordlogger' then
    -- the composer opens a small panel for this; the panel calls back with: set #channel word1, word2 …  |  off
    if not public.has_permission(p_server, 2) then raise exception 'you need the Manage Server permission'; end if;
    if sub in ('off', 'clear') then
      perform public.comet_set(p_server, 'wordlog_channel', null); perform public.comet_set(p_server, 'wordlog_words', null);
      perform public.comet_reply(p_app, p_channel, 'Word logger off', 'Nothing is being logged.', ok, null, p_id); return;
    end if;
    v_c := public.comet_channel(p_server, case when sub = 'set' then tok[2] else tok[1] end);
    v_txt := array_to_string(case when sub = 'set' then tok[3:] else tok[2:] end, ' ');
    if v_c is null or btrim(v_txt) = '' then
      perform public.comet_reply(p_app, p_channel, 'Word logger', 'Usage: **/wordlogger #log-channel word1, word2, word 3**' || E'\n' || coalesce('Now logging ' || jsonb_array_length(public.comet_cfg(p_server) -> 'wordlog_words') || ' words to <#' || (public.comet_cfg(p_server) ->> 'wordlog_channel') || '>.', 'Not set up yet.'), warn, null, p_id); return;
    end if;
    perform public.comet_set(p_server, 'wordlog_channel', to_jsonb(v_c::text));
    perform public.comet_set(p_server, 'wordlog_words', (select coalesce(jsonb_agg(distinct w), '[]') from (select lower(btrim(x)) w from unnest(string_to_array(v_txt, ',')) x where btrim(x) <> '' limit 100) q));
    perform public.comet_reply(p_app, p_channel, 'Word logger on', 'Watching ' || jsonb_array_length(public.comet_cfg(p_server) -> 'wordlog_words') || ' word(s). Hits are logged in <#' || v_c || '>.', ok, null, p_id);

  elsif cmd = 'servercount' then
    if array_length(tok, 1) is null then
      perform public.comet_reply(p_app, p_channel, 'Members', public.member_count(p_server)::text || ' accounts in this server.', '#7c5cff', null, p_id); return;
    end if;
    v_fields := '[]'::jsonb; v_n := 0;
    for v_txt in select btrim(x) from unnest(string_to_array(array_to_string(tok, ' '), ',')) x where btrim(x) <> '' loop
      if lower(v_txt) in ('humans', 'human', 'people', 'members') then
        v_fields := v_fields || jsonb_build_object('name', 'Humans', 'value', public.member_count(p_server)::text); v_n := v_n + public.member_count(p_server);
      elsif lower(v_txt) in ('bots', 'bot') then
        v_fields := v_fields || jsonb_build_object('name', 'Bots', 'value', (select count(*) from public.server_bots where server_id = p_server)::text); v_n := v_n + (select count(*) from public.server_bots where server_id = p_server);
      else
        v_r := public.comet_role(p_server, v_txt);
        if v_r is not null then
          v_fields := v_fields || jsonb_build_object('name', (select '@' || name from public.roles where id = v_r), 'value', (select count(*) from public.member_roles where role_id = v_r)::text);
          v_n := v_n + (select count(*) from public.member_roles where role_id = v_r);
        end if;
      end if;
    end loop;
    perform public.comet_reply(p_app, p_channel, 'Server count', 'Total: **' || v_n || '**', '#7c5cff', v_fields, p_id);

  elsif cmd in ('serverinfo', 'membercount') then
    perform public.comet_reply(p_app, p_channel, (select name from public.servers where id = p_server), coalesce(nullif((select description from public.servers where id = p_server), ''), ''), '#7c5cff',
      jsonb_build_array(jsonb_build_object('name', 'Members', 'value', public.member_count(p_server)::text),
                        jsonb_build_object('name', 'Bots', 'value', (select count(*) from public.server_bots where server_id = p_server)::text),
                        jsonb_build_object('name', 'Channels', 'value', (select count(*) from public.channels where server_id = p_server)::text),
                        jsonb_build_object('name', 'Roles', 'value', (select count(*) from public.roles where server_id = p_server)::text),
                        jsonb_build_object('name', 'Owner', 'value', '<@' || v_owner || '>'),
                        jsonb_build_object('name', 'Created', 'value', to_char((select created_at from public.servers where id = p_server), 'Mon DD, YYYY'))), p_id);

  elsif cmd = 'userinfo' then
    v_u := coalesce(public.comet_user(p_server, tok[1]), me);
    perform public.comet_reply(p_app, p_channel, public.comet_name(v_u), '<@' || v_u || '>', (select avatar_color from public.profiles where id = v_u),
      jsonb_build_array(jsonb_build_object('name', 'Username', 'value', '@' || (select username from public.profiles where id = v_u)),
                        jsonb_build_object('name', 'Joined server', 'value', coalesce((select to_char(joined_at, 'Mon DD, YYYY') from public.server_members where server_id = p_server and user_id = v_u), 'Not a member')),
                        jsonb_build_object('name', 'Account created', 'value', (select to_char(created_at, 'Mon DD, YYYY') from public.profiles where id = v_u)),
                        jsonb_build_object('name', 'Roles', 'value', coalesce((select string_agg('<@&' || r.id || '>', ' ' order by r.position desc) from public.member_roles mr join public.roles r on r.id = mr.role_id where mr.server_id = p_server and mr.user_id = v_u), 'None')),
                        jsonb_build_object('name', 'Level', 'value', coalesce((select level || ' (' || xp || ' XP)' from public.comet_levels where server_id = p_server and user_id = v_u), '—'))), p_id);

  -- -------------------------------------------------------------- channels ----
  elsif cmd in ('delete', 'rename', 'slowmode', 'lock', 'unlock', 'topic') then
    if not public.has_permission(p_server, 8) then raise exception 'you need the Manage Channels permission'; end if;
    v_c := coalesce(case when cmd in ('lock', 'unlock') and array_length(tok, 1) is null then p_channel end, public.comet_channel(p_server, tok[1]),
                    case when cmd in ('slowmode', 'topic') then p_channel end);
    if v_c is null then perform public.comet_reply(p_app, p_channel, 'Which channel?', 'Usage: **/' || cmd || ' #channel' || case cmd when 'rename' then ' "new name"' when 'slowmode' then ' 10s' when 'topic' then ' "new topic"' else '' end || '**', warn, null, p_id); return; end if;
    v_name := (select name from public.channels where id = v_c);
    if cmd = 'delete' then
      if v_c = p_channel then raise exception 'run /delete from a different channel'; end if;
      delete from public.channels where id = v_c and server_id = p_server;
      perform public.comet_reply(p_app, p_channel, 'Channel deleted', '#' || v_name || ' is gone.', bad, null, p_id);
      perform public.comet_log(p_server, 'Channel deleted', '#' || v_name, bad);
    elsif cmd = 'rename' then
      v_txt := btrim(array_to_string(tok[2:], ' '));
      if (select type from public.channels where id = v_c) = 'text' then v_txt := left(regexp_replace(regexp_replace(lower(v_txt), '\s+', '-', 'g'), '[^a-z0-9_\- -￿]', '', 'g'), 100); end if;
      if v_txt = '' then perform public.comet_reply(p_app, p_channel, 'Usage', '**/rename #channel "new name"**', warn, null, p_id); return; end if;
      update public.channels set name = left(v_txt, 100) where id = v_c;
      perform public.comet_reply(p_app, p_channel, 'Renamed', '#' || v_name || ' → <#' || v_c || '>', ok, null, p_id);
      perform public.comet_log(p_server, 'Channel renamed', '#' || v_name || ' → #' || v_txt, ok);
    elsif cmd = 'topic' then
      v_txt := btrim(array_to_string(case when public.comet_channel(p_server, tok[1]) is not null then tok[2:] else tok end, ' '));
      update public.channels set topic = left(v_txt, 1024) where id = v_c;
      perform public.comet_reply(p_app, p_channel, 'Topic updated', coalesce(nullif(v_txt, ''), '(cleared)'), ok, null, p_id);
    elsif cmd = 'slowmode' then
      v_iv := coalesce(public.comet_duration(case when public.comet_channel(p_server, tok[1]) is not null then tok[2] else tok[1] end), '0 seconds'::interval);
      v_n := least(21600, extract(epoch from v_iv)::integer);
      update public.channels set settings = jsonb_set(settings, '{slowmode}', to_jsonb(v_n)) where id = v_c;
      perform public.comet_reply(p_app, p_channel, 'Slowmode', case when v_n = 0 then 'Off in <#' || v_c || '>.' else 'One message every ' || v_n || 's in <#' || v_c || '>.' end, ok, null, p_id);
    else
      v_r := (select id from public.roles where server_id = p_server and is_default);
      if cmd = 'lock' then
        delete from public.channel_overwrites where channel_id = v_c and category is null and target_type = 'role' and target_id = v_r;
        insert into public.channel_overwrites (server_id, channel_id, target_type, target_id, allow, deny) values (p_server, v_c, 'role', v_r, 0, 128);
        perform public.comet_reply(p_app, p_channel, '🔒 Locked', '<#' || v_c || '> — only roles above @everyone can talk.', warn, null, p_id);
      else
        delete from public.channel_overwrites where channel_id = v_c and category is null and target_type = 'role' and target_id = v_r;
        perform public.comet_reply(p_app, p_channel, '🔓 Unlocked', 'Everyone can talk in <#' || v_c || '> again.', ok, null, p_id);
      end if;
      perform public.comet_log(p_server, initcap(cmd), '<#' || v_c || '>', warn);
    end if;

  elsif cmd in ('lockdown', 'unlockdown') then
    if not public.has_permission(p_server, 8) then raise exception 'you need the Manage Channels permission'; end if;
    v_r := (select id from public.roles where server_id = p_server and is_default);
    delete from public.channel_overwrites where server_id = p_server and category is null and target_type = 'role' and target_id = v_r
       and channel_id in (select id from public.channels where server_id = p_server and type = 'text');
    if cmd = 'lockdown' then
      insert into public.channel_overwrites (server_id, channel_id, target_type, target_id, allow, deny)
      select p_server, id, 'role', v_r, 0, 128 from public.channels where server_id = p_server and type = 'text';
    end if;
    perform public.comet_reply(p_app, p_channel, case when cmd = 'lockdown' then '🚨 Server locked down' else 'Lockdown lifted' end,
      case when cmd = 'lockdown' then 'Every text channel is read-only for @everyone. Run **/unlockdown** to undo.' else 'Everyone can talk again.' end, case when cmd = 'lockdown' then bad else ok end, null, p_id);
    perform public.comet_log(p_server, initcap(cmd), 'All text channels', bad);

  -- ---------------------------------------------------------------- purge ----
  elsif cmd = 'purge' then
    if not public.channel_has_permission(p_channel, 256) then raise exception 'you need the Manage Messages permission to purge'; end if;
    v_u := case when sub ~ '^[0-9]+$' or sub in ('all', 'human', 'humans', 'bots', 'reactions', '') then null else public.comet_user(p_server, tok[1]) end;
    if v_u is not null then
      with gone as (delete from public.messages where author_id = v_u and channel_id in (select id from public.channels where server_id = p_server) returning 1) select count(*) into v_n from gone;
      perform public.comet_reply(p_app, p_channel, 'Purged', 'Deleted ' || v_n || ' messages from **' || public.comet_name(v_u) || '** across the server.', '#ff6b81', null, p_id);
      perform public.comet_log(p_server, 'Purge user', '<@' || v_u || '> · ' || v_n || ' messages', '#ff6b81'); return;
    end if;
    if sub = 'all' then
      with gone as (delete from public.messages where channel_id = p_channel returning 1) select count(*) into v_n from gone;
      delete from public.bot_messages where channel_id = p_channel and (interaction_id is distinct from p_id);
    elsif sub in ('human', 'humans', 'bots', 'reactions') then
      v_n := case when coalesce(tok[2], '') = 'all' then 100000 else least(greatest(coalesce(nullif(regexp_replace(coalesce(tok[2], ''), '\D', '', 'g'), '')::integer, 50), 1), 500) end;
      if sub in ('human', 'humans') then
        with gone as (delete from public.messages where id in (select id from public.messages where channel_id = p_channel order by created_at desc limit v_n) returning 1) select count(*) into v_n from gone;
      elsif sub = 'bots' then
        with gone as (delete from public.bot_messages where id in (select id from public.bot_messages where channel_id = p_channel order by created_at desc limit v_n) returning 1) select count(*) into v_n from gone;
      else
        with gone as (delete from public.messages where id in (select m.id from public.messages m where m.channel_id = p_channel and exists (select 1 from public.reactions r where r.message_id = m.id) order by m.created_at desc limit v_n) returning 1) select count(*) into v_n from gone;
      end if;
    elsif sub ~ '^[0-9]+$' then
      v_n := least(greatest(sub::integer, 1), 50);
      with gone as (delete from public.messages where id in (select id from public.messages where channel_id = p_channel order by created_at desc limit v_n) returning 1) select count(*) into v_n from gone;
    else
      perform public.comet_reply(p_app, p_channel, 'Purge', E'**/purge 10** · **/purge all** · **/purge @user**\n**/purge human 100** · **/purge bots 20** · **/purge reactions 50**\n**/purge links|images|files|embeds|mentions 100** (checked on your device — messages are encrypted)', warn, null, p_id); return;
    end if;
    perform public.comet_reply(p_app, p_channel, 'Purged', 'Deleted ' || v_n || ' message' || case when v_n = 1 then '' else 's' end || '.', '#ff6b81', null, p_id);
    perform public.comet_log(p_server, 'Purge', v_n || ' messages in <#' || p_channel || '>', '#ff6b81');

  elsif cmd = 'cleanup' then
    if not public.channel_has_permission(p_channel, 256) then raise exception 'you need the Manage Messages permission'; end if;
    delete from public.bot_messages where channel_id = p_channel and app_id = p_app;
    get diagnostics v_n = row_count;
    perform public.comet_reply(p_app, p_channel, 'Cleaned up', 'Removed ' || v_n || ' of my messages here.', ok, null, p_id);

  elsif cmd in ('say', 'announce') then
    if not public.channel_has_permission(p_channel, 256) then raise exception 'you need the Manage Messages permission'; end if;
    v_txt := array_to_string(tok, ' ');
    if btrim(v_txt) = '' then perform public.comet_reply(p_app, p_channel, 'Usage', '**/' || cmd || ' "text"**', warn, null, p_id); return; end if;
    if cmd = 'say' then perform public.bot_post(p_app, p_channel, left(v_txt, 2000), null, null, p_id);
    else perform public.comet_reply(p_app, p_channel, '📣 Announcement', v_txt, '#7c5cff', null, p_id); end if;

  -- --------------------------------------------------------------- levels ----
  elsif cmd = 'levels' then
    if sub in ('enable', 'on', 'disable', 'off') then
      if not public.has_permission(p_server, 2) then raise exception 'you need the Manage Server permission'; end if;
      perform public.comet_set(p_server, 'levels', case when sub in ('enable', 'on') then 'true'::jsonb end);
      perform public.comet_reply(p_app, p_channel, case when sub in ('enable', 'on') then 'Levels on ✨' else 'Levels off' end,
        case when sub in ('enable', 'on') then E'Members earn XP for chatting and finishing quests:\n• First message of the day — 20 XP\n• Chat 2 days in a row — 75 XP\n• Chat 7 days in a row — 300 XP\n• Send 100 messages — 250 XP' else 'XP stops counting (it''s kept if you turn it back on).' end, ok, null, p_id);
    else
      select coalesce(string_agg((rn)::text || '. <@' || user_id || '> — level ' || level || ' · ' || xp || ' XP', E'\n' order by rn), 'Nobody has XP yet.') into v_txt
        from (select *, row_number() over (order by xp desc) rn from public.comet_levels where server_id = p_server order by xp desc limit 10) q;
      perform public.comet_reply(p_app, p_channel, '🏆 Level leaderboard', v_txt, '#7c5cff', null, p_id);
    end if;

  elsif cmd in ('rank', 'quests') then
    v_u := coalesce(public.comet_user(p_server, tok[1]), me);
    select jsonb_build_array(jsonb_build_object('name', 'Level', 'value', level::text), jsonb_build_object('name', 'XP', 'value', xp || ' / ' || (power(level + 1, 2) * 100)::int),
                             jsonb_build_object('name', 'Streak', 'value', streak || ' day' || case when streak = 1 then '' else 's' end),
                             jsonb_build_object('name', 'Quests', 'value',
                               case when quests ? 'streak2' then '✅' else '⬜' end || ' 2-day streak  ' || case when quests ? 'streak7' then '✅' else '⬜' end || ' 7-day streak  ' || case when quests ? 'chatty100' then '✅' else '⬜' end || ' 100 messages'))
      into v_fields from public.comet_levels where server_id = p_server and user_id = v_u;
    perform public.comet_reply(p_app, p_channel, public.comet_name(v_u), case when v_fields is null then 'No XP yet — start chatting!' else '' end, '#7c5cff', v_fields, p_id);

  elsif cmd in ('level', 'xp') then
    if not public.has_permission(p_server, 2) then raise exception 'you need the Manage Server permission'; end if;
    v_u := public.comet_user(p_server, case when sub = 'set' then tok[2] else tok[1] end);
    v_n := nullif(regexp_replace(coalesce(case when sub = 'set' then tok[3] else tok[2] end, ''), '\D', '', 'g'), '')::integer;
    if v_u is null or v_n is null then perform public.comet_reply(p_app, p_channel, 'Usage', '**/' || cmd || ' set @user 100**', warn, null, p_id); return; end if;
    v_n := least(v_n, case when cmd = 'level' then 1000 else 100000000 end);
    insert into public.comet_levels (server_id, user_id) values (p_server, v_u) on conflict do nothing;
    if cmd = 'level' then update public.comet_levels set level = v_n, xp = (v_n * v_n * 100) where server_id = p_server and user_id = v_u;
    else update public.comet_levels set xp = v_n, level = public.comet_level_for(v_n) where server_id = p_server and user_id = v_u; end if;
    perform public.comet_reply(p_app, p_channel, 'Updated', '**' || public.comet_name(v_u) || '** is now ' || case when cmd = 'level' then 'level ' || v_n else v_n || ' XP (level ' || public.comet_level_for(v_n) || ')' end || '.', ok, null, p_id);

  -- ------------------------------------------------------------ swear jar ----
  elsif cmd = 'swearjar' then
    if sub in ('enable', 'on', 'disable', 'off') then
      if not public.has_permission(p_server, 2) then raise exception 'you need the Manage Server permission'; end if;
      perform public.comet_set(p_server, 'swearjar', case when sub in ('enable', 'on') then 'true'::jsonb end);
      perform public.comet_reply(p_app, p_channel, case when sub in ('enable', 'on') then '🫙 Swear jar on' else 'Swear jar off' end, case when sub in ('enable', 'on') then 'Every curse costs a coin. Counted on each person''s own device — messages stay encrypted.' else 'No more counting.' end, ok, null, p_id);
    elsif sub = 'global' or (sub = 'leaderboard' and lower(coalesce(tok[2], '')) = 'global') then
      select coalesce(string_agg(rn || '. ' || public.comet_name(user_id) || ' — ' || total, E'\n' order by rn), 'The world is clean. For now.') into v_txt
        from (select user_id, sum(count) total, row_number() over (order by sum(count) desc) rn from public.comet_swears group by user_id order by total desc limit 10) q;
      perform public.comet_reply(p_app, p_channel, '🌍 Global swear jar', v_txt, '#ffa502', null, p_id);
    else
      select coalesce(string_agg(rn || '. <@' || user_id || '> — ' || count, E'\n' order by rn), 'Squeaky clean so far.') into v_txt
        from (select *, row_number() over (order by count desc) rn from public.comet_swears where server_id = p_server and count > 0 order by count desc limit 10) q;
      perform public.comet_reply(p_app, p_channel, '🫙 Server swear jar', v_txt, '#ffa502', null, p_id);
    end if;

  -- ------------------------------------------------------------- birthdays ----
  elsif cmd = 'birthday' then
    if sub = 'set' then
      v_txt := coalesce(tok[2], '');
      if v_txt ~ '^[0-9]{1,2}[/-][0-9]{1,2}$' then
        perform public.comet_birthday_set(split_part(replace(v_txt, '-', '/'), '/', 1)::int, split_part(replace(v_txt, '-', '/'), '/', 2)::int);
        perform public.comet_reply(p_app, p_channel, '🎂 Saved', 'Your birthday is ' || to_char(make_date(2024, split_part(replace(v_txt, '-', '/'), '/', 1)::int, split_part(replace(v_txt, '-', '/'), '/', 2)::int), 'FMMonth FMDD') || ' (only the day and month — never the year).', ok, null, p_id);
      else perform public.comet_reply(p_app, p_channel, 'Usage', '**/birthday set MM/DD** — e.g. /birthday set 07/14 · **/birthday remove**', warn, null, p_id); end if;
    elsif sub in ('remove', 'clear') then
      perform public.comet_birthday_set(null, null);
      perform public.comet_reply(p_app, p_channel, 'Removed', 'Your birthday is no longer shared.', ok, null, p_id);
    else
      select string_agg('🎉 <@' || b.user_id || '>', E'\n') into v_txt
        from public.comet_birthdays b join public.server_members sm on sm.user_id = b.user_id and sm.server_id = p_server
       where b.month = extract(month from now() at time zone 'utc') and b.day = extract(day from now() at time zone 'utc');
      perform public.comet_reply(p_app, p_channel, '🎂 Birthdays today', coalesce(v_txt, 'No birthdays today. Add yours with **/birthday set MM/DD**.'), '#ff5a7a', null, p_id);
    end if;

  elsif cmd in ('help', 'commands') then
    perform public.comet_reply(p_app, p_channel, '☄️ Comet', E'**Moderation** /ban /unban /kick /timeout /untimeout /mute /unmute /deafen /undeafen /warn /warnings /clearwarns\n**Messages** /purge /cleanup /say /announce\n**Roles** /role /unrole /roll all /autorole /roleinfo\n**Channels** /lock /unlock /lockdown /unlockdown /slowmode /topic /rename /delete\n**Server** /pauseinvites /staff log set /wordlogger /server count /serverinfo /userinfo\n**Fun** /levels /rank /level set /xp set /swear jar /birthday', '#7c5cff', null, p_id);
  else
    perform public.comet_reply(p_app, p_channel, 'Unknown command', 'Try **/help** to see everything Comet can do.', warn, null, p_id);
  end if;
end;
$$;

-- ------------------------------------------- route Comet's commands -------
-- Keep the existing handler for every other bot; Comet's commands go to comet_command.
do $$
begin
  if coalesce(obj_description('public.use_bot_command(uuid, uuid, text, text)'::regprocedure, 'pg_proc'), '') <> 'comet-dispatch' then
    drop function if exists public.use_bot_command_base(uuid, uuid, text, text);
    alter function public.use_bot_command(uuid, uuid, text, text) rename to use_bot_command_base;
  end if;
end $$;

create or replace function public.use_bot_command(p_channel uuid, p_app uuid, p_command text, p_args text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_server uuid;
  v_id uuid;
begin
  if (select preset from public.applications where id = p_app) is distinct from 'comet' then
    return public.use_bot_command_base(p_channel, p_app, p_command, p_args);
  end if;
  select server_id into v_server from public.channels where id = p_channel;
  if v_server is null or not public.channel_has_permission(p_channel, 128) then raise exception 'you can''t use commands here'; end if;
  if (select status from public.applications where id = p_app) <> 'active'
     or not exists (select 1 from public.server_bots where server_id = v_server and app_id = p_app) then
    raise exception 'Comet isn''t in this server — add it from App Discovery';
  end if;
  if (select count(*) from public.bot_interactions where user_id = auth.uid() and created_at > now() - interval '10 seconds') >= 6 then
    raise exception 'slow down a little';
  end if;
  insert into public.bot_interactions (app_id, server_id, channel_id, user_id, command, args)
  values (p_app, v_server, p_channel, auth.uid(), lower(btrim(p_command)), left(coalesce(p_args, ''), 1000)) returning id into v_id;
  perform public.comet_command(p_app, p_channel, v_server, lower(btrim(p_command)), coalesce(p_args, ''), v_id);
  update public.bot_interactions set handled = true where id = v_id;
  return jsonb_build_object('status', 'handled', 'id', v_id);
end;
$$;
comment on function public.use_bot_command(uuid, uuid, text, text) is 'comet-dispatch';

-- Comet's commands, for the / menu
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
                        ('venband', 'unlock', 'Unlock this channel again'),
                        ('comet', 'ban', 'Ban a member · /ban @user reason'),
                        ('comet', 'unban', 'Let someone join again · /unban @user'),
                        ('comet', 'kick', 'Remove a member · /kick @user reason'),
                        ('comet', 'timeout', 'Time someone out · /timeout @user 1h (blank = until /untimeout)'),
                        ('comet', 'untimeout', 'End a timeout · /untimeout @user'),
                        ('comet', 'mute', 'Mute someone in voice · /mute @user 30m'),
                        ('comet', 'unmute', 'Unmute someone in voice · /unmute @user'),
                        ('comet', 'deafen', 'Deafen someone in voice · /deafen @user 1d'),
                        ('comet', 'undeafen', 'Undeafen someone · /undeafen @user'),
                        ('comet', 'warn', 'Warn a member — they get a pop-up · /warn @user "reason"'),
                        ('comet', 'warnings', 'See someone''s warnings · /warnings @user'),
                        ('comet', 'clearwarns', 'Clear someone''s warnings · /clearwarns @user'),
                        ('comet', 'purge', 'Delete messages · /purge 10 · all · @user · links · images …'),
                        ('comet', 'cleanup', 'Delete Comet''s messages in this channel'),
                        ('comet', 'role', 'Give someone a role · /role @user @role'),
                        ('comet', 'unrole', 'Take a role away · /unrole @user @role'),
                        ('comet', 'roll', 'Give everyone a role · /roll all @role'),
                        ('comet', 'autorole', 'Role for everyone who joins · /autorole @role (or off)'),
                        ('comet', 'roleinfo', 'About a role · /roleinfo @role'),
                        ('comet', 'pauseinvites', 'Pause (or resume) all invites and joins'),
                        ('comet', 'wordlogger', 'Log when people use certain words · opens a panel'),
                        ('comet', 'staff', 'Set the mod log · /staff log set #channel'),
                        ('comet', 'server', 'Count members · /server count humans, bots, @role'),
                        ('comet', 'serverinfo', 'About this server'),
                        ('comet', 'userinfo', 'About a member · /userinfo @user'),
                        ('comet', 'lock', 'Lock a channel · /lock #channel'),
                        ('comet', 'unlock', 'Unlock a channel · /unlock #channel'),
                        ('comet', 'lockdown', 'Make every text channel read-only'),
                        ('comet', 'unlockdown', 'Lift a lockdown'),
                        ('comet', 'slowmode', 'Slowmode · /slowmode #channel 10s (0 = off)'),
                        ('comet', 'topic', 'Set the topic · /topic #channel "text"'),
                        ('comet', 'rename', 'Rename a channel · /rename #channel "new name"'),
                        ('comet', 'delete', 'Delete a channel · /delete #channel'),
                        ('comet', 'say', 'Comet says something · /say "text"'),
                        ('comet', 'announce', 'Post an announcement card · /announce "text"'),
                        ('comet', 'levels', 'Leaderboard · /levels enable (or disable)'),
                        ('comet', 'rank', 'Your level, XP, streak and quests · /rank @user'),
                        ('comet', 'level', 'Set a level · /level set @user 10'),
                        ('comet', 'xp', 'Set XP · /xp set @user 500'),
                        ('comet', 'swear', 'Swear jar · /swear jar enable · leaderboard · global'),
                        ('comet', 'birthday', 'Birthdays · /birthday list · /birthday set MM/DD'),
                        ('comet', 'help', 'Everything Comet can do')) v(p, n, d)
  where v.p = p_preset;
$$;

revoke execute on function public.comet_app(), public.comet_cfg(uuid), public.comet_set(uuid, text, jsonb), public.comet_user(uuid, text),
  public.comet_role(uuid, text), public.comet_channel(uuid, text), public.comet_name(uuid),
  public.comet_reply(uuid, uuid, text, text, text, jsonb, uuid), public.comet_log(uuid, text, text, text),
  public.comet_command(uuid, uuid, uuid, text, text, uuid), public.use_bot_command_base(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.comet_client_config(uuid), public.comet_word_hit(uuid, text[], text), public.comet_swear(uuid, integer),
  public.comet_purge_ids(uuid, uuid[], text), public.comet_my_voice(uuid), public.comet_birthday_set(integer, integer) from public, anon;
grant execute on function public.comet_client_config(uuid), public.comet_word_hit(uuid, text[], text), public.comet_swear(uuid, integer),
  public.comet_purge_ids(uuid, uuid[], text), public.comet_my_voice(uuid), public.comet_birthday_set(integer, integer),
  public.use_bot_command(uuid, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
