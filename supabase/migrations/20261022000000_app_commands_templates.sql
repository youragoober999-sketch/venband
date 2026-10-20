-- =============================================================================
-- App Discovery + command builder + bot templates.
--   * applications.tags: discoverable tags like #servermanagement
--   * bot_commands.response: a no-code responder (text, embed, and safe
--     moderation actions) so custom bots answer slash commands straight from
--     the dashboard, with no server to host
--   * bot_templates: ready-made command sets you can apply to any of your bots
--   * use_bot_command runs a responder whenever the bot's preset doesn't
--     already answer the command itself
--   * app_events: a bot dashboard's activity log (commands + member joins)
-- =============================================================================

-- ---------------------------------------------------------------- tags ----
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