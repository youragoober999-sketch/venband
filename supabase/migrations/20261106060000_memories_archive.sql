-- =============================================================================
-- Memories: 30 kept / 10 showing, archive, expiry, audience, reporting (20261106060000)
--
--   * keep up to 30 memories; up to 10 show on your profile at once, the rest
--     are archived (only you see them) and can be shown again
--   * optional expiry: after it, a memory stops showing to others (you keep it)
--   * audience per memory: everyone who can see your profile, friends only, or
--     only you
--   * memory media is only served for memories the viewer is allowed to see —
--     before, anyone who could see your profile could list every file in your
--     memories folder (archived / friends-only ones included)
--   * memories can be reported (report_item 'memory'); staff can remove them
--
-- Safe to run more than once.
-- =============================================================================

alter table public.memories add column if not exists active boolean not null default true;
alter table public.memories add column if not exists expires_at timestamptz;
alter table public.memories add column if not exists audience text not null default 'everyone';
do $$ begin
  alter table public.memories add constraint memories_audience_check check (audience in ('everyone', 'friends', 'only_me'));
exception when duplicate_object then null; end $$;

-- showing = active and not expired
create or replace function public.memory_showing(p_active boolean, p_expires timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select p_active and (p_expires is null or p_expires > now());
$$;

create or replace function public.memory_visible(p_memory uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memories m
     where m.id = p_memory
       and (m.user_id = p_user
            or (public.memory_showing(m.active, m.expires_at)
                and m.audience <> 'only_me'
                and public.can_see_memories(m.user_id, p_user)
                and (m.audience = 'everyone' or public.are_friends(m.user_id, p_user)))
            or public.staff_can('reports', p_user)));
$$;

create or replace function public.guard_memory()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if split_part(new.path, '/', 1) <> new.user_id::text then
    raise exception 'memory media must be stored in your own folder';
  end if;
  if new.expires_at is not null and (new.expires_at < now() - interval '1 minute' or new.expires_at > now() + interval '366 days') then
    raise exception 'pick an expiry within the next year';
  end if;
  perform pg_advisory_xact_lock(hashtext('memories:' || new.user_id::text));
  if tg_op = 'INSERT' and (select count(*) from public.memories where user_id = new.user_id) >= 30 then
    raise exception 'You can keep up to 30 memories. Delete one to add another.';
  end if;
  if public.memory_showing(new.active, new.expires_at)
     and (tg_op = 'INSERT' or not public.memory_showing(old.active, old.expires_at))
     and (select count(*) from public.memories
           where user_id = new.user_id and id <> new.id and public.memory_showing(active, expires_at)) >= 10 then
    raise exception 'Up to 10 memories can show at once. Archive one first.';
  end if;
  return new;
end;
$$;
drop trigger if exists memories_guard on public.memories;
create trigger memories_guard before insert or update of active, expires_at on public.memories
  for each row execute function public.guard_memory();

drop policy if exists memories_select on public.memories;
create policy memories_select on public.memories for select to authenticated
  using (public.memory_visible(id));
grant update (caption, active, expires_at, audience) on public.memories to authenticated;

-- staff remove reported memories (the file too)
drop policy if exists memories_delete on public.memories;
create policy memories_delete on public.memories for delete to authenticated
  using (user_id = auth.uid() or public.staff_can('reports'));

-- media: only files of memories you may see (the owner always sees their folder)
drop policy if exists venband_memories_read on storage.objects;
create policy venband_memories_read on storage.objects for select to authenticated
  using (bucket_id = 'memories'
         and (split_part(name, '/', 1) = auth.uid()::text
              or exists (select 1 from public.memories m where m.path = name and public.memory_visible(m.id))));
drop policy if exists venband_memories_delete on storage.objects;
create policy venband_memories_delete on storage.objects for delete to authenticated
  using (bucket_id = 'memories' and (split_part(name, '/', 1) = auth.uid()::text or public.staff_can('reports')));

-- ------------------------------------------------------------- reporting --
alter table public.reports drop constraint if exists reports_kind_check;
alter table public.reports add constraint reports_kind_check check (kind in ('message', 'user', 'theme', 'app', 'memory'));

create or replace function public.report_item(p_kind text, p_ref uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_name text;
  v_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 1000 then raise exception 'say what''s wrong (3–1000 characters)'; end if;
  if p_kind = 'theme' then
    select author_id, name into v_owner, v_name from public.themes where id = p_ref and status = 'published';
  elsif p_kind = 'app' then
    select owner_id, name into v_owner, v_name from public.applications where id = p_ref;
  elsif p_kind = 'memory' then
    -- only a memory you can actually see
    select m.user_id, coalesce(nullif(m.caption, ''), 'Memory') into v_owner, v_name
      from public.memories m where m.id = p_ref and public.memory_visible(m.id, v_uid);
  else
    raise exception 'unknown kind';
  end if;
  if v_owner is null then raise exception 'not found'; end if;
  if v_owner = v_uid then raise exception 'you can''t report your own'; end if;
  if (select count(*) from public.reports r where r.reporter_id = v_uid and r.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'too many reports — try again later';
  end if;
  if exists (select 1 from public.reports where reporter_id = v_uid and kind = p_kind and target_ref = p_ref and status = 'under_review') then
    raise exception 'you already reported this — staff will look at it';
  end if;
  insert into public.reports (reporter_id, kind, target_user, target_ref, reason, evidence)
  values (v_uid, p_kind, v_owner, p_ref, btrim(p_reason),
          jsonb_build_array(jsonb_build_object('id', p_ref, 'author_id', v_owner, 'author', coalesce(v_name, ''), 'text', coalesce(v_name, ''), 'at', now())))
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.memory_visible(uuid, uuid) from public, anon;
grant execute on function public.memory_visible(uuid, uuid) to authenticated;
revoke execute on function public.guard_memory() from public, anon, authenticated;

notify pgrst, 'reload schema';
