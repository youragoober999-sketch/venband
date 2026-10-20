-- =============================================================================
-- Reports, message requests, server icon/banner images, empty categories,
-- Founder badge.
--
-- Safe to run more than once.
-- =============================================================================

-- ------------------------------------------------------------- servers ----
alter table public.servers
  add column if not exists categories text[] not null default '{}',
  add column if not exists icon_url   text check (icon_url is null or (char_length(icon_url) <= 600 and icon_url ~ '^https?://')),
  add column if not exists banner_url text check (banner_url is null or (char_length(banner_url) <= 600 and banner_url ~ '^https?://'));
do $$ begin
  alter table public.servers add constraint servers_categories_sane
    check (cardinality(categories) <= 50 and array_to_string(categories, '') !~ '[\n\r]');
exception when duplicate_object then null; end $$;

-- Server icons and banners are public pictures (like on any chat app); they
-- live at server-assets/<server id>/<file>. Only people who can manage the
-- server may change them.
insert into storage.buckets (id, name, public, file_size_limit)
values ('server-assets', 'server-assets', true, 8388608)
on conflict (id) do update set public = true, file_size_limit = 8388608;
-- only pictures (where this Supabase version supports type limits)
do $$ begin
  update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg', 'image/gif', 'image/webp']
  where id = 'server-assets';
exception when undefined_column then null; end $$;

create or replace function public.can_manage_server_asset(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_first text := split_part(p_name, '/', 1);
begin
  if v_first !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return public.has_permission(v_first::uuid, 2);
end;
$$;

drop policy if exists venband_server_assets_read on storage.objects;
create policy venband_server_assets_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'server-assets');
drop policy if exists venband_server_assets_write on storage.objects;
create policy venband_server_assets_write on storage.objects for insert to authenticated
  with check (bucket_id = 'server-assets' and public.can_manage_server_asset(name));
drop policy if exists venband_server_assets_update on storage.objects;
create policy venband_server_assets_update on storage.objects for update to authenticated
  using (bucket_id = 'server-assets' and public.can_manage_server_asset(name));
drop policy if exists venband_server_assets_delete on storage.objects;
create policy venband_server_assets_delete on storage.objects for delete to authenticated
  using (bucket_id = 'server-assets' and public.can_manage_server_asset(name));

-- discovery shows the pictures too
drop function if exists public.discover_servers(text) cascade;
create function public.discover_servers(p_query text default '')
returns table (id uuid, name text, description text, icon_color text, banner_color text,
               tag text, verified boolean, members integer, joined boolean, icon_url text, banner_url text)
language sql stable security definer set search_path = '' as $$
  select * from (
    select s.id, s.name, s.description, s.icon_color, s.banner_color, s.tag, s.verified,
           public.member_count(s.id) as members, public.is_server_member(s.id) as joined, s.icon_url, s.banner_url
    from public.servers s
    where auth.uid() is not null and s.status = 'active' and s.discoverable
      and (coalesce(p_query, '') = '' or s.name ilike '%' || p_query || '%' or s.description ilike '%' || p_query || '%')
  ) x
  where x.verified or x.members >= 1000
  order by x.verified desc, x.members desc
  limit 60;
$$;
revoke execute on function public.discover_servers(text) from anon, public;
grant execute on function public.discover_servers(text) to authenticated;

-- ---------------------------------------------------- message requests ----
-- A DM from someone you have no friendship or server in common with lands in
-- your Message Requests until you accept it.
alter table public.channels add column if not exists request_to uuid references public.profiles (id) on delete set null;

create or replace function public.open_dm(p_other uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_channel uuid;
  v_request uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_other = v_uid then raise exception 'cannot DM yourself'; end if;
  if not exists (select 1 from public.profiles where id = p_other) then
    raise exception 'user not found';
  end if;
  select a.channel_id into v_channel
  from public.dm_participants a
  join public.dm_participants b on a.channel_id = b.channel_id
  join public.channels c on c.id = a.channel_id and not c.is_group
  where a.user_id = v_uid and b.user_id = p_other
  limit 1;
  if v_channel is not null then return v_channel; end if;
  if public.is_blocked_between(p_other, v_uid) then raise exception 'you can''t message this user'; end if;
  if not (public.account_can('dm') or public.is_staff(v_uid)
          or (public.account_can('send') and public.are_friends(p_other, v_uid))) then
    raise exception 'your account can only message friends right now';
  end if;
  -- strangers (no friendship, no shared server) start as a message request
  if not public.are_friends(p_other, v_uid) and not public.is_staff(v_uid)
     and not exists (select 1 from public.server_members a join public.server_members b on a.server_id = b.server_id
                     where a.user_id = v_uid and b.user_id = p_other) then
    v_request := p_other;
  end if;
  insert into public.channels (type, name, request_to) values ('dm', 'dm', v_request) returning id into v_channel;
  insert into public.dm_participants (channel_id, user_id) values (v_channel, v_uid), (v_channel, p_other);
  return v_channel;
end;
$$;

create or replace function public.accept_message_request(p_channel uuid)
returns void language sql security definer set search_path = '' as $$
  update public.channels set request_to = null where id = p_channel and request_to = auth.uid();
$$;

create or replace function public.decline_message_request(p_channel uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.channels where id = p_channel and request_to = auth.uid()) then
    raise exception 'no such message request';
  end if;
  delete from public.channels where id = p_channel;
end;
$$;

-- --------------------------------------------------------------- reports ----
-- Messages are end-to-end encrypted, so staff can't read them on the
-- server. A report carries the messages the reporter chose to share (their
-- app decrypts them and attaches the text as evidence).
create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid references public.profiles (id) on delete set null,
  kind         text not null check (kind in ('message', 'user')),
  target_user  uuid references public.profiles (id) on delete set null,
  message_id   uuid,
  channel_id   uuid references public.channels (id) on delete set null,
  server_id    uuid references public.servers (id) on delete set null,
  reason       text not null check (char_length(reason) between 1 and 1000),
  evidence     jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array' and pg_column_size(evidence) < 131072),
  status       text not null default 'under_review' check (status in ('under_review', 'actioned', 'dismissed')),
  handled_by   uuid references public.profiles (id) on delete set null,
  handled_note text not null default '' check (char_length(handled_note) <= 1000),
  created_at   timestamptz not null default now(),
  handled_at   timestamptz
);
create index if not exists reports_status_idx on public.reports (status, created_at desc);
alter table public.reports enable row level security;

drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated
  with check (
    reporter_id = auth.uid() and status = 'under_review' and handled_by is null
    and target_user is distinct from auth.uid()
    and (select count(*) from public.reports r where r.reporter_id = auth.uid() and r.created_at > now() - interval '1 hour') < 20
  );
-- reporters see their own reports (and their status); administrators see all
drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports for select to authenticated
  using (reporter_id = auth.uid() or public.platform_rank() >= 2);

create or replace function public.handle_report(p_report uuid, p_status text, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.platform_rank() < 2 then raise exception 'administrators only'; end if;
  if p_status not in ('under_review', 'actioned', 'dismissed') then raise exception 'unknown status'; end if;
  update public.reports
  set status = p_status, handled_by = auth.uid(), handled_note = left(coalesce(p_note, ''), 1000),
      handled_at = case when p_status = 'under_review' then null else now() end
  where id = p_report;
  insert into public.mod_actions (actor_id, target_user, action, detail, reason)
  select auth.uid(), r.target_user, 'report_' || p_status, r.kind, left(coalesce(p_note, ''), 1000)
  from public.reports r where r.id = p_report;
end;
$$;

-- ------------------------------------------------------------- badges ----
-- Founder: the person who started Venband. Different from Owner (a staff
-- role with every permission). Only an owner can hand out either.
create or replace function public.all_badges()
returns text[] language sql immutable set search_path = '' as $$
  select array['founder', 'owner', 'admin', 'moderator', 'staff', 'partner', 'verified_dev', 'bug_hunter',
               'bug_hunter_gold', 'og', 'early_supporter', 'supporter', 'translator', 'event_winner']::text[];
$$;

create or replace function public.mod_set_badges(p_user uuid, p_badges text[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_new text[];
  v_old text[];
  v_staff_badges text[] := array['admin', 'moderator', 'staff'];
  v_owner_badges text[] := array['founder', 'owner'];
begin
  if not public.mod_can_target(p_user) then raise exception 'you can''t change this account'; end if;
  select coalesce(array_agg(distinct b order by b), '{}') into v_new
  from unnest(coalesce(p_badges, '{}')) b where b = any (public.all_badges());
  select badges into v_old from public.profiles where id = p_user;
  if public.platform_rank() < 2 and (
       (select coalesce(array_agg(b order by b), '{}') from unnest(v_new) b where b = any (v_staff_badges))
       is distinct from
       (select coalesce(array_agg(b order by b), '{}') from unnest(v_old) b where b = any (v_staff_badges))) then
    raise exception 'only admins can change staff badges';
  end if;
  if public.platform_rank() < 3 and (
       (select coalesce(array_agg(b order by b), '{}') from unnest(v_new) b where b = any (v_owner_badges))
       is distinct from
       (select coalesce(array_agg(b order by b), '{}') from unnest(v_old) b where b = any (v_owner_badges))) then
    raise exception 'only an owner can change the founder and owner badges';
  end if;
  update public.profiles set badges = v_new where id = p_user;
  insert into public.mod_actions (actor_id, target_user, action, detail)
  values (auth.uid(), p_user, 'badges', array_to_string(v_new, ', '));
end;
$$;

-- One-time grants, each applied at most once (so nobody who later takes one
-- of these usernames can ever receive them):
--   "sl"   → the Founder badge
--   "halt" → Owner role (every permission) and every badge except Founder
insert into public.platform_config (key, value)
select 'granted_founder_sl', 'yes'
where exists (select 1 from public.profiles where username = 'sl')
on conflict (key) do nothing;
update public.profiles
set badges = (select array_agg(distinct b) from unnest(badges || array['founder']) b)
where username = 'sl'
  and exists (select 1 from public.platform_config where key = 'granted_founder_sl' and value = 'yes')
  and not exists (select 1 from public.platform_config where key = 'granted_founder_sl_done');
insert into public.platform_config (key, value)
select 'granted_founder_sl_done', 'yes'
where exists (select 1 from public.platform_config where key = 'granted_founder_sl')
on conflict (key) do nothing;

update public.profiles
set platform_role = 'owner', badges = array_remove(public.all_badges(), 'founder')
where username = 'halt'
  and not exists (select 1 from public.platform_config where key = 'granted_owner_halt');
insert into public.platform_config (key, value)
select 'granted_owner_halt', 'yes'
where exists (select 1 from public.profiles where username = 'halt')
on conflict (key) do nothing;

-- ------------------------------------------------------------- grants ----
grant select, insert on public.reports to authenticated;
revoke execute on function
  public.can_manage_server_asset(text), public.accept_message_request(uuid), public.decline_message_request(uuid),
  public.handle_report(uuid, text, text)
from anon, public;
grant execute on function
  public.can_manage_server_asset(text), public.accept_message_request(uuid), public.decline_message_request(uuid),
  public.handle_report(uuid, text, text), public.open_dm(uuid), public.mod_set_badges(uuid, text[]), public.all_badges()
to authenticated;
grant execute on function public.can_manage_server_asset(text) to anon;
