-- =============================================================================
-- Online status for DMs and group DMs (20261106180000)
--
-- Presence channels only cover the server you have open, so a DM partner or a
-- group member's online dot couldn't be known. Each open Venband sends a cheap
-- heartbeat (touch_online, at most every 30 s per person); online_users() says
-- which of the given people were active in the last 2½ minutes.
--
-- Private by design: the heartbeat table can't be read directly, you only learn
-- about people you're friends with or share a server / DM with, and anyone set
-- to Invisible is never reported online.
--
-- Safe to run more than once.
-- =============================================================================

create table if not exists public.online_seen (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  seen_at timestamptz not null default now()
);
alter table public.online_seen enable row level security;
revoke all on public.online_seen from anon, authenticated;

create or replace function public.touch_online()
returns void language sql security definer set search_path = '' as $$
  insert into public.online_seen (user_id, seen_at) values (auth.uid(), now())
  on conflict (user_id) do update set seen_at = now()
    where public.online_seen.seen_at < now() - interval '30 seconds';
$$;

create or replace function public.online_users(p_ids uuid[])
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(s.user_id), '{}')
    from public.online_seen s
    join public.profiles p on p.id = s.user_id
   where s.user_id = any (p_ids[1:200])
     and s.seen_at > now() - interval '150 seconds'
     and coalesce(p.presence, 'online') <> 'invisible'
     and (s.user_id = auth.uid() or public.are_friends(s.user_id, auth.uid()) or public.shares_server_or_dm(s.user_id, auth.uid()));
$$;
revoke execute on function public.touch_online() from public, anon;
revoke execute on function public.online_users(uuid[]) from public, anon;
grant execute on function public.touch_online() to authenticated;
grant execute on function public.online_users(uuid[]) to authenticated;

notify pgrst, 'reload schema';
