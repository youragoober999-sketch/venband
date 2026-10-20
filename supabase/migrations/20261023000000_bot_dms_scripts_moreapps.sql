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
