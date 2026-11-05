-- =============================================================================
-- Memories (20261104020000)
--
-- Story-style photos / short videos pinned to your profile.
--   * up to 10 memories per account at a time (enforced here, not just in the UI)
--   * videos up to 30 seconds
--   * visible to the same people who can see your profile (shared server / DM,
--     friends, staff) and never to anyone either side has blocked
--   * the owner can see who viewed each memory
--   * media lives in a PRIVATE bucket and is read through short-lived signed URLs
--
-- Safe to run more than once.
-- =============================================================================

create table if not exists public.memories (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  path         text not null check (char_length(path) between 10 and 300),
  media_type   text not null check (media_type in ('image', 'video')),
  duration_ms  integer not null default 6000 check (duration_ms between 1000 and 30000),
  caption      text not null default '' check (char_length(caption) <= 200),
  width        integer check (width between 1 and 8192),
  height       integer check (height between 1 and 8192),
  created_at   timestamptz not null default now()
);
create index if not exists memories_user_idx on public.memories (user_id, created_at);
alter table public.memories enable row level security;

create table if not exists public.memory_views (
  memory_id  uuid not null references public.memories (id) on delete cascade,
  viewer_id  uuid not null references public.profiles (id) on delete cascade,
  seen_at    timestamptz not null default now(),
  primary key (memory_id, viewer_id)
);
alter table public.memory_views enable row level security;

-- media path must live in the owner's own folder: <user_id>/<file>
create or replace function public.guard_memory()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if split_part(new.path, '/', 1) <> new.user_id::text then
    raise exception 'memory media must be stored in your own folder';
  end if;
  perform pg_advisory_xact_lock(hashtext('memories:' || new.user_id::text));
  if (select count(*) from public.memories where user_id = new.user_id) >= 10 then
    raise exception 'You can have up to 10 memories at a time. Delete one to add another.';
  end if;
  return new;
end;
$$;
drop trigger if exists memories_guard on public.memories;
create trigger memories_guard before insert on public.memories
  for each row execute function public.guard_memory();

create or replace function public.can_see_memories(p_owner uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user is not null and (
    p_owner = p_user
    or (public.can_see_profile(p_owner, p_user) and not public.is_blocked_between(p_owner, p_user))
  );
$$;
revoke execute on function public.can_see_memories(uuid, uuid) from public, anon;
grant execute on function public.can_see_memories(uuid, uuid) to authenticated;

drop policy if exists memories_select on public.memories;
create policy memories_select on public.memories for select to authenticated
  using (public.can_see_memories(user_id));
drop policy if exists memories_insert on public.memories;
create policy memories_insert on public.memories for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists memories_delete on public.memories;
create policy memories_delete on public.memories for delete to authenticated
  using (user_id = auth.uid() or public.is_staff());
drop policy if exists memories_update on public.memories;
create policy memories_update on public.memories for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, delete on public.memories to authenticated;
grant update (caption) on public.memories to authenticated;

drop policy if exists memory_views_insert on public.memory_views;
create policy memory_views_insert on public.memory_views for insert to authenticated
  with check (viewer_id = auth.uid()
              and exists (select 1 from public.memories m where m.id = memory_id and m.user_id <> auth.uid() and public.can_see_memories(m.user_id)));
drop policy if exists memory_views_select on public.memory_views;
create policy memory_views_select on public.memory_views for select to authenticated
  using (viewer_id = auth.uid()
         or exists (select 1 from public.memories m where m.id = memory_id and m.user_id = auth.uid()));
grant select, insert on public.memory_views to authenticated;

-- ----------------------------------------------------------------- storage --
insert into storage.buckets (id, name, public, file_size_limit)
values ('memories', 'memories', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;
do $$ begin
  update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'] where id = 'memories';
exception when undefined_column then null; end $$;

drop policy if exists venband_memories_read on storage.objects;
create policy venband_memories_read on storage.objects for select to authenticated
  using (bucket_id = 'memories' and public.can_see_memories(nullif(split_part(name, '/', 1), '')::uuid));
drop policy if exists venband_memories_write on storage.objects;
create policy venband_memories_write on storage.objects for insert to authenticated
  with check (bucket_id = 'memories' and split_part(name, '/', 1) = auth.uid()::text);
drop policy if exists venband_memories_delete on storage.objects;
create policy venband_memories_delete on storage.objects for delete to authenticated
  using (bucket_id = 'memories' and split_part(name, '/', 1) = auth.uid()::text);

notify pgrst, 'reload schema';
