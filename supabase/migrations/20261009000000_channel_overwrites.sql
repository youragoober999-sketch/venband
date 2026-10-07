-- -----------------------------------------------------------------------------
-- Channel / category permission overwrites.
--
-- Admins (MANAGE_CHANNELS) can pin per-role or per-member allow/deny bits onto a
-- single channel or onto a whole category. Channel overwrites layer on top of
-- category overwrites, which layer on top of server-wide role permissions.
-- Visibility still follows is_private + channel_role_access (can_view_channel);
-- overwrites gate the *actions* a user can take in a channel.
-- -----------------------------------------------------------------------------

create table public.channel_overwrites (
  id           uuid primary key default gen_random_uuid(),
  server_id    uuid not null references public.servers (id) on delete cascade,
  channel_id   uuid references public.channels (id) on delete cascade,
  category     text check (category is null or char_length(category) <= 100),
  target_type  text not null check (target_type in ('role', 'member')),
  target_id    uuid not null,
  allow        bigint not null default 0,
  deny         bigint not null default 0,
  created_at   timestamptz not null default now(),
  check (channel_id is not null or category is not null)
);

create unique index channel_overwrites_uniq
  on public.channel_overwrites (coalesce(channel_id, '00000000-0000-0000-0000-000000000000'),
                                coalesce(category, ''), target_type, target_id);
create index channel_overwrites_server_idx on public.channel_overwrites (server_id);
create index channel_overwrites_channel_idx on public.channel_overwrites (channel_id, server_id);

alter table public.channel_overwrites enable row level security;

-- Members can see overwrites for channels they can view (or anything in a server
-- they belong to when the row targets a category).
create policy cow_select on public.channel_overwrites for select to authenticated
  using (
    channel_id is not null and public.can_view_channel(channel_id)
    or (channel_id is null and public.is_server_member(server_id))
  );

create policy cow_insert on public.channel_overwrites for insert to authenticated
  with check (public.has_permission(server_id, 8));

create policy cow_update on public.channel_overwrites for update to authenticated
  using (public.has_permission(server_id, 8))
  with check (public.has_permission(server_id, 8));

create policy cow_delete on public.channel_overwrites for delete to authenticated
  using (public.has_permission(server_id, 8));

-- -----------------------------------------------------------------------------
-- Effective permissions for one user in one channel.
-- Base = server-wide roles, then category overwrites, then channel overwrites.
-- Overwrites for roles apply in role.position order; the member's own overwrite
-- (if any) is applied last so it always wins for that person, like in the real
-- thing. Owners and ADMINISTRATOR still get everything.
-- -----------------------------------------------------------------------------
create or replace function public.channel_perm_for_user(p_channel uuid, p_user uuid default auth.uid())
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare
  c record;
  v_base bigint;
  v_out bigint;
  v_row record;
begin
  select id, server_id, type, category into c from public.channels where id = p_channel;
  if not found then return 0; end if;

  -- DMs are wide open for their participants.
  if c.type = 'dm' then
    if exists (select 1 from public.dm_participants where channel_id = p_channel and user_id = p_user)
      then return 2147483647; end if;
    return 0;
  end if;

  if not public.is_server_member(c.server_id, p_user) then return 0; end if;
  if (select owner_id from public.servers where id = c.server_id) = p_user then return 2147483647; end if;

  v_base := public.server_permissions(c.server_id, p_user);
  if (v_base & 1) = 1 then return 2147483647; end if;
  v_out := v_base;

  -- Overwrites never grant or strip server-wide powers (Administrator, Manage Server).
  -- Category-level overwrites.
  for v_row in
    select o.target_type, o.target_id, o.allow, o.deny,
           case when o.target_type = 'member' then 2147483647 else coalesce(r.position, 0) end as pos
      from public.channel_overwrites o
      left join public.roles r on r.id = o.target_id and o.target_type = 'role'
     where o.server_id = c.server_id and o.category = c.category
     order by pos, o.target_id
  loop
    if v_row.target_type = 'role' and not exists (select 1 from public.member_roles mr
                                                  where mr.role_id = v_row.target_id
                                                    and mr.user_id = p_user
                                                    and mr.server_id = c.server_id) then
      continue;
    end if;
    if v_row.target_type = 'member' and v_row.target_id <> p_user then continue; end if;
    v_out := (v_out & ~(v_row.deny & ~3)) | (v_row.allow & ~3);
  end loop;

  -- Channel-level overwrites.
  for v_row in
    select o.target_type, o.target_id, o.allow, o.deny,
           case when o.target_type = 'member' then 2147483647 else coalesce(r.position, 0) end as pos
      from public.channel_overwrites o
      left join public.roles r on r.id = o.target_id and o.target_type = 'role'
     where o.channel_id = c.id
     order by pos, o.target_id
  loop
    if v_row.target_type = 'role' and not exists (select 1 from public.member_roles mr
                                                  where mr.role_id = v_row.target_id
                                                    and mr.user_id = p_user
                                                    and mr.server_id = c.server_id) then
      continue;
    end if;
    if v_row.target_type = 'member' and v_row.target_id <> p_user then continue; end if;
    v_out := (v_out & ~(v_row.deny & ~3)) | (v_row.allow & ~3);
  end loop;

  return v_out;
end;
$$;

-- Redefine the existing helper so action gating accounts for overwrites while
-- keeping the "must be able to see the channel first" and "DMs are open" rules.
create or replace function public.channel_has_permission(p_channel uuid, p_perm bigint, p_user uuid default auth.uid())
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_server uuid;
begin
  if not public.can_view_channel(p_channel, p_user) then return false; end if;
  select server_id into v_server from public.channels where id = p_channel;
  if v_server is null then return true; end if;
  return (public.channel_perm_for_user(p_channel, p_user) & p_perm) = p_perm;
end;
$$;

-- ----------------------------------------------------------------- realtime ----
do $$
declare t text;
begin
  foreach t in array array['channel_overwrites'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------------ grants ----
grant select, insert, update, delete on public.channel_overwrites to authenticated;
grant execute on function public.channel_perm_for_user(uuid, uuid), public.channel_has_permission(uuid, bigint, uuid)
  to authenticated;