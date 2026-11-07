-- =============================================================================
-- Moderating bots (20261107190000)
--
-- Staff can right-click a bot in the member list and do what they'd do to a
-- person, with the same permission for each:
--   kick     (Kick Members)          removes the bot from the server
--   ban      (Ban Members)           removes it and blocks adding it again; unban lifts it
--   timeout  (Timeout & Warn)        it can't post or answer commands
--   mute     (Mute Members)          it can't post
--   deafen   (Deafen Members)        it ignores commands
-- Durations: minutes, or null = until lifted (lift with the matching un-action).
--
-- Safe to run more than once.
-- =============================================================================
alter table public.server_bots add column if not exists timeout_until timestamptz;
alter table public.server_bots add column if not exists muted_until timestamptz;
alter table public.server_bots add column if not exists deafened_until timestamptz;

create table if not exists public.server_bot_bans (
  server_id  uuid not null references public.servers (id) on delete cascade,
  app_id     uuid not null references public.applications (id) on delete cascade,
  banned_by  uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (server_id, app_id)
);
alter table public.server_bot_bans enable row level security;
drop policy if exists server_bot_bans_select on public.server_bot_bans;
create policy server_bot_bans_select on public.server_bot_bans for select to authenticated using (public.is_server_member(server_id));

create or replace function public.moderate_bot(p_server uuid, p_app uuid, p_action text, p_minutes integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_perm bigint := case p_action
    when 'kick' then 16 when 'ban' then 32 when 'unban' then 32
    when 'timeout' then 2097152 when 'untimeout' then 2097152
    when 'mute' then 33554432 when 'unmute' then 33554432
    when 'deafen' then 67108864 when 'undeafen' then 67108864 end;
  v_until timestamptz := case when coalesce(p_minutes, 0) <= 0 then now() + interval '100 years' else now() + make_interval(mins => least(p_minutes, 525600)) end;
  v_name text := (select name from public.applications where id = p_app);
begin
  if v_perm is null then raise exception 'unknown action'; end if;
  if not public.has_permission(p_server, v_perm) then raise exception 'you don''t have permission to do that'; end if;
  if p_action = 'unban' then
    delete from public.server_bot_bans where server_id = p_server and app_id = p_app;
  elsif p_action in ('kick', 'ban') then
    if p_action = 'ban' then
      insert into public.server_bot_bans (server_id, app_id, banned_by) values (p_server, p_app, auth.uid()) on conflict do nothing;
    end if;
    delete from public.server_bots where server_id = p_server and app_id = p_app;
  else
    if not exists (select 1 from public.server_bots where server_id = p_server and app_id = p_app) then raise exception 'that bot isn''t in this server'; end if;
    update public.server_bots set
      timeout_until  = case p_action when 'timeout' then v_until when 'untimeout' then null else timeout_until end,
      muted_until    = case p_action when 'mute' then v_until when 'unmute' then null else muted_until end,
      deafened_until = case p_action when 'deafen' then v_until when 'undeafen' then null else deafened_until end
     where server_id = p_server and app_id = p_app;
  end if;
  perform public.audit(p_server, 'bot_' || p_action, null, p_app, jsonb_build_object('bot', v_name, 'minutes', p_minutes));
end;
$$;
revoke execute on function public.moderate_bot(uuid, uuid, text, integer) from public, anon;
grant execute on function public.moderate_bot(uuid, uuid, text, integer) to authenticated;

-- a banned bot can't be added back
create or replace function public.guard_bot_ban() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.server_bot_bans where server_id = new.server_id and app_id = new.app_id) then
    raise exception 'This bot is banned from this server. Unban it first (right-click it in the member list).';
  end if;
  return new;
end;
$$;
drop trigger if exists server_bots_ban_guard on public.server_bots;
create trigger server_bots_ban_guard before insert on public.server_bots for each row execute function public.guard_bot_ban();

-- muted or timed-out bots can't post (their posts are dropped quietly)
create or replace function public.guard_bot_post() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.server_bots
              where server_id = new.server_id and app_id = new.app_id
                and ((muted_until is not null and muted_until > now()) or (timeout_until is not null and timeout_until > now()))) then
    return null;
  end if;
  return new;
end;
$$;
drop trigger if exists bot_messages_mod_guard on public.bot_messages;
create trigger bot_messages_mod_guard before insert on public.bot_messages for each row execute function public.guard_bot_post();

-- deafened or timed-out bots ignore commands
create or replace function public.guard_bot_command() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  b public.server_bots;
begin
  select * into b from public.server_bots where server_id = new.server_id and app_id = new.app_id;
  if found and ((b.deafened_until is not null and b.deafened_until > now()) or (b.timeout_until is not null and b.timeout_until > now())) then
    raise exception '% isn''t taking commands right now — a moderator has % it.', (select name from public.applications where id = new.app_id),
      case when b.timeout_until is not null and b.timeout_until > now() then 'timed out' else 'deafened' end;
  end if;
  return new;
end;
$$;
drop trigger if exists bot_interactions_mod_guard on public.bot_interactions;
create trigger bot_interactions_mod_guard before insert on public.bot_interactions for each row execute function public.guard_bot_command();

notify pgrst, 'reload schema';
