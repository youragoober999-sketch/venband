-- =============================================================================
-- Recent activity (20261106120000)
--
-- What you've played lately, for your profile: kept per game — total time,
-- number of sessions, longest session, last played. Filled by a trigger on
-- `activities` (the live "Playing …" row), so set_my_activity is unchanged.
-- Only "Playing" (type 0) activities count; up to 30 games per person.
-- You can clear yours (Settings → Privacy).
--
-- Safe to run more than once.
-- =============================================================================

create table if not exists public.activity_history (
  user_id         uuid not null references public.profiles (id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 64),
  icon            text,
  first_at        timestamptz not null default now(),
  last_at         timestamptz not null default now(),
  total_seconds   integer not null default 0,
  sessions        integer not null default 0,
  longest_seconds integer not null default 0,
  primary key (user_id, name)
);
create index if not exists activity_history_recent_idx on public.activity_history (user_id, last_at desc);
alter table public.activity_history enable row level security;
drop policy if exists activity_history_select on public.activity_history;
create policy activity_history_select on public.activity_history for select to authenticated
  using (user_id = auth.uid() or public.can_see_profile(user_id));
drop policy if exists activity_history_delete on public.activity_history;
create policy activity_history_delete on public.activity_history for delete to authenticated
  using (user_id = auth.uid());
revoke insert, update on public.activity_history from authenticated, anon;
grant select, delete on public.activity_history to authenticated;

create or replace function public.track_activity_history()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_secs integer;
begin
  -- a game session ended (stopped, or switched to something else)
  if tg_op in ('UPDATE', 'DELETE') and old.type = 0
     and (tg_op = 'DELETE' or new.name is distinct from old.name or new.type <> 0) then
    v_secs := least(86400, greatest(0, extract(epoch from now() - coalesce(to_timestamp(old.timestamps_start / 1000.0), old.updated_at))::int));
    insert into public.activity_history (user_id, name, icon, total_seconds, sessions, longest_seconds, last_at)
    values (old.user_id, old.name, old.icon, v_secs, 1, v_secs, now())
    on conflict (user_id, name) do update
      set total_seconds = public.activity_history.total_seconds + v_secs,
          sessions = public.activity_history.sessions + 1,
          longest_seconds = greatest(public.activity_history.longest_seconds, v_secs),
          last_at = now();
  end if;
  -- a game session started: make sure it's in the list right away
  if tg_op in ('INSERT', 'UPDATE') and new.type = 0
     and (tg_op = 'INSERT' or new.name is distinct from old.name or old.type <> 0) then
    insert into public.activity_history (user_id, name, icon, last_at)
    values (new.user_id, new.name, new.icon, now())
    on conflict (user_id, name) do update set last_at = now(), icon = coalesce(excluded.icon, public.activity_history.icon);
    -- keep the 30 most recent games
    delete from public.activity_history h
     where h.user_id = new.user_id
       and h.name not in (select x.name from public.activity_history x where x.user_id = new.user_id order by x.last_at desc limit 30);
  end if;
  return null;
end;
$$;
drop trigger if exists activities_history on public.activities;
create trigger activities_history after insert or update or delete on public.activities
  for each row execute function public.track_activity_history();
revoke execute on function public.track_activity_history() from public, anon, authenticated;

notify pgrst, 'reload schema';
