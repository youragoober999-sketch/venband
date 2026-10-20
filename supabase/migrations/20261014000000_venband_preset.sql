-- Venband bot preset: an official moderation toolkit for server staff.
-- Discoverable as its own card in /bots. Answers /serverinfo, /info, /purge,
-- /ban, /kick, /lock and /unlock with embed responses.

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

-- Only used inside security-definer functions; not a surface for end users.
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