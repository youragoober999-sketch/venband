-- Moderation and security: reports for server moderators (with pictures),
-- removed GIFs, custom badges, timeouts, warnings, a server audit log, a
-- recycle bin for deleted servers, account deletion, two-factor enforcement
-- and data export.

-- ------------------------------------------------- reports: server mods ----
alter table public.reports add column if not exists server_status text not null default 'open'
  check (server_status in ('open', 'actioned', 'dismissed'));
alter table public.reports add column if not exists server_note text not null default '' check (char_length(server_note) <= 1000);

create or replace function public.is_server_moderator(p_server uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_permission(p_server, 2097152, p_user) or public.has_permission(p_server, 256, p_user)
      or public.has_permission(p_server, 16, p_user);
$$;

-- Reports about messages in a server, for that server's moderators. The
-- reporter stays anonymous to them.
create or replace function public.server_reports(p_server uuid, p_status text default 'open')
returns table (id uuid, kind text, target_user uuid, message_id uuid, channel_id uuid, reason text, evidence jsonb,
               server_status text, server_note text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, r.kind, r.target_user, r.message_id, r.channel_id, r.reason, r.evidence, r.server_status, r.server_note, r.created_at
  from public.reports r
  where r.server_id = p_server and public.is_server_moderator(p_server)
    and (p_status is null or r.server_status = p_status)
  order by r.created_at desc
  limit 200;
$$;

create or replace function public.handle_server_report(p_report uuid, p_status text, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_server uuid;
begin
  select server_id into v_server from public.reports where id = p_report;
  if v_server is null or not public.is_server_moderator(v_server) then raise exception 'not allowed'; end if;
  if p_status not in ('open', 'actioned', 'dismissed') then raise exception 'unknown status'; end if;
  update public.reports set server_status = p_status, server_note = left(coalesce(p_note, ''), 1000) where id = p_report;
  perform public.audit(v_server, 'report_' || p_status, (select target_user from public.reports where id = p_report), p_report, jsonb_build_object('note', left(coalesce(p_note, ''), 200)));
end;
$$;

-- Pictures attached to reports: report-evidence/<reporter>/<report id>/<n>.webp
insert into storage.buckets (id, name, public, file_size_limit)
values ('report-evidence', 'report-evidence', false, 3145728)
on conflict (id) do update set public = false, file_size_limit = 3145728;
do $$ begin
  update storage.buckets set allowed_mime_types = array['image/webp', 'image/png', 'image/jpeg'] where id = 'report-evidence';
exception when undefined_column then null; end $$;

create or replace function public.can_read_evidence(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_report text := split_part(p_name, '/', 2);
  v_server uuid;
begin
  if split_part(p_name, '/', 1) = auth.uid()::text or public.platform_rank() >= 2 then return true; end if;
  if v_report !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  select server_id into v_server from public.reports where id = v_report::uuid;
  return v_server is not null and public.is_server_moderator(v_server);
end;
$$;

drop policy if exists venband_evidence_read on storage.objects;
create policy venband_evidence_read on storage.objects for select to authenticated
  using (bucket_id = 'report-evidence' and public.can_read_evidence(name));
drop policy if exists venband_evidence_write on storage.objects;
create policy venband_evidence_write on storage.objects for insert to authenticated
  with check (bucket_id = 'report-evidence' and split_part(name, '/', 1) = auth.uid()::text);

-- --------------------------------------------------------- removed GIFs ----
-- Server owners and administrators (and Venband staff, everywhere) can remove
-- a GIF. Only a hash of its address is stored, so the list reveals nothing.
create table if not exists public.banned_media (
  id         uuid primary key default gen_random_uuid(),
  server_id  uuid references public.servers (id) on delete cascade,   -- null = everywhere (staff)
  hash       text not null check (hash ~ '^[0-9a-f]{64}$'),
  banned_by  uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists banned_media_unique on public.banned_media (coalesce(server_id, '00000000-0000-0000-0000-000000000000'::uuid), hash);
alter table public.banned_media enable row level security;
drop policy if exists banned_media_select on public.banned_media;
create policy banned_media_select on public.banned_media for select to authenticated
  using (server_id is null or public.is_server_member(server_id));

create or replace function public.can_ban_media(p_server uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when p_server is null then public.is_staff()
              else (select owner_id from public.servers where id = p_server) = auth.uid()
                   or public.has_permission(p_server, 1) or public.is_staff() end;
$$;

create or replace function public.ban_media(p_server uuid, p_hash text, p_banned boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_ban_media(p_server) then raise exception 'only the server owner or administrators can remove GIFs'; end if;
  if p_banned then
    insert into public.banned_media (server_id, hash, banned_by) values (p_server, p_hash, auth.uid()) on conflict do nothing;
  else
    delete from public.banned_media where server_id is not distinct from p_server and hash = p_hash;
  end if;
  if p_server is not null then perform public.audit(p_server, case when p_banned then 'gif_remove' else 'gif_restore' end, null, null, '{}'::jsonb); end if;
end;
$$;

-- ---------------------------------------------------------- custom badges ----
create table if not exists public.custom_badges (
  id          text primary key check (id ~ '^c_[a-z0-9_]{2,30}$'),
  name        text not null check (char_length(btrim(name)) between 2 and 40),
  description text not null default '' check (char_length(description) <= 200),
  image_url   text not null check (char_length(image_url) <= 500),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.custom_badges enable row level security;
drop policy if exists custom_badges_read on public.custom_badges;
create policy custom_badges_read on public.custom_badges for select to anon, authenticated using (true);

-- Venband owners and founders design badges.
create or replace function public.can_design_badges()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.platform_rank() >= 3 or exists (select 1 from public.profiles where id = auth.uid() and 'founder' = any (badges));
$$;

insert into storage.buckets (id, name, public, file_size_limit)
values ('badges', 'badges', true, 524288)
on conflict (id) do update set public = true, file_size_limit = 524288;
do $$ begin
  update storage.buckets set allowed_mime_types = array['image/png', 'image/webp', 'image/gif'] where id = 'badges';
exception when undefined_column then null; end $$;
drop policy if exists venband_badges_read on storage.objects;
create policy venband_badges_read on storage.objects for select to anon, authenticated using (bucket_id = 'badges');
drop policy if exists venband_badges_write on storage.objects;
create policy venband_badges_write on storage.objects for insert to authenticated
  with check (bucket_id = 'badges' and public.can_design_badges());
drop policy if exists venband_badges_delete on storage.objects;
create policy venband_badges_delete on storage.objects for delete to authenticated
  using (bucket_id = 'badges' and public.can_design_badges());

create or replace function public.save_custom_badge(p_id text, p_name text, p_description text, p_image_url text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_id text := 'c_' || regexp_replace(lower(btrim(coalesce(p_id, ''))), '^c_', '');
begin
  if not public.can_design_badges() then raise exception 'only Venband owners and founders can make badges'; end if;
  if p_image_url !~ '/storage/v1/object/public/badges/' then raise exception 'upload the badge picture first'; end if;
  insert into public.custom_badges (id, name, description, image_url, created_by)
  values (v_id, btrim(p_name), btrim(coalesce(p_description, '')), p_image_url, auth.uid())
  on conflict (id) do update set name = excluded.name, description = excluded.description, image_url = excluded.image_url;
  insert into public.mod_actions (actor_id, action, detail) values (auth.uid(), 'badge_design', v_id);
  return v_id;
end;
$$;

create or replace function public.delete_custom_badge(p_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_design_badges() then raise exception 'only Venband owners and founders can do that'; end if;
  update public.profiles set badges = array_remove(badges, p_id) where p_id = any (badges);
  delete from public.custom_badges where id = p_id;
end;
$$;

-- Custom badges can be handed out like the built-in ones.
create or replace function public.all_badges()
returns text[] language sql stable security definer set search_path = '' as $$
  select array['founder', 'owner', 'admin', 'moderator', 'staff', 'partner', 'verified_dev', 'bug_hunter',
               'bug_hunter_gold', 'og', 'early_supporter', 'supporter', 'translator', 'event_winner']::text[]
         || coalesce((select array_agg(id order by created_at) from public.custom_badges), '{}');
$$;

-- --------------------------------------------------- timeouts & warnings ----
alter table public.server_members add column if not exists timeout_until timestamptz;
alter table public.server_members add column if not exists timeout_reason text check (char_length(timeout_reason) <= 512);

create or replace function public.can_moderate(p_server uuid, p_target uuid, p_perm bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_target <> auth.uid()
     and (select owner_id from public.servers where id = p_server) <> p_target
     and public.has_permission(p_server, p_perm)
     and ((select owner_id from public.servers where id = p_server) = auth.uid()
          or public.member_top_position(p_server, p_target) < public.member_top_position(p_server));
$$;

create or replace function public.timeout_member(p_server uuid, p_user uuid, p_minutes integer, p_reason text default '')
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_until timestamptz := case when coalesce(p_minutes, 0) <= 0 then null else now() + make_interval(mins => least(p_minutes, 40320)) end;
begin
  if not public.can_moderate(p_server, p_user, 2097152) then raise exception 'you can''t time out this member'; end if;
  update public.server_members set timeout_until = v_until, timeout_reason = nullif(left(btrim(coalesce(p_reason, '')), 512), '')
  where server_id = p_server and user_id = p_user;
  if not found then raise exception 'not a member'; end if;
  perform public.audit(p_server, case when v_until is null then 'timeout_remove' else 'timeout' end, p_user, null,
                       jsonb_build_object('minutes', p_minutes, 'reason', left(coalesce(p_reason, ''), 200)));
  return v_until;
end;
$$;

create table if not exists public.member_warnings (
  id              uuid primary key default gen_random_uuid(),
  server_id       uuid not null references public.servers (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  moderator_id    uuid references public.profiles (id) on delete set null,
  reason          text not null check (char_length(btrim(reason)) between 1 and 1000),
  acknowledged_at timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists member_warnings_user_idx on public.member_warnings (user_id, created_at desc);
create index if not exists member_warnings_server_idx on public.member_warnings (server_id, created_at desc);
alter table public.member_warnings enable row level security;
drop policy if exists member_warnings_select on public.member_warnings;
create policy member_warnings_select on public.member_warnings for select to authenticated
  using (user_id = auth.uid() or public.is_server_moderator(server_id));

create or replace function public.warn_member(p_server uuid, p_user uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not (public.can_moderate(p_server, p_user, 2097152) or public.can_moderate(p_server, p_user, 16)) then
    raise exception 'you can''t warn this member';
  end if;
  insert into public.member_warnings (server_id, user_id, moderator_id, reason)
  values (p_server, p_user, auth.uid(), btrim(p_reason)) returning id into v_id;
  perform public.audit(p_server, 'warn', p_user, v_id, jsonb_build_object('reason', left(p_reason, 200)));
  return v_id;
end;
$$;

create or replace function public.ack_warning(p_warning uuid)
returns void language sql security definer set search_path = '' as $$
  update public.member_warnings set acknowledged_at = now() where id = p_warning and user_id = auth.uid();
$$;

-- --------------------------------------------------------- audit log ----
create table if not exists public.server_audit_log (
  id         uuid primary key default gen_random_uuid(),
  server_id  uuid not null references public.servers (id) on delete cascade,
  actor_id   uuid references public.profiles (id) on delete set null,
  action     text not null,
  target_user uuid references public.profiles (id) on delete set null,
  target_id  uuid,
  detail     jsonb not null default '{}'::jsonb check (pg_column_size(detail) < 4000),
  created_at timestamptz not null default now()
);
create index if not exists server_audit_log_idx on public.server_audit_log (server_id, created_at desc);
alter table public.server_audit_log enable row level security;
drop policy if exists server_audit_log_select on public.server_audit_log;
create policy server_audit_log_select on public.server_audit_log for select to authenticated
  using (public.has_permission(server_id, 4194304));

create or replace function public.audit(p_server uuid, p_action text, p_target_user uuid, p_target_id uuid, p_detail jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_server is null or not exists (select 1 from public.servers where id = p_server) then return; end if;
  insert into public.server_audit_log (server_id, actor_id, action, target_user, target_id, detail)
  values (p_server, auth.uid(), p_action, p_target_user, p_target_id, coalesce(p_detail, '{}'::jsonb));
exception when others then
  null; -- the log must never block the action itself
end;
$$;

create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r record := coalesce(new, old);
  v_server uuid;
  v_changed text[];
begin
  if pg_trigger_depth() > 1 then return null; end if;   -- cascades (e.g. a server being deleted)
  case tg_table_name
  when 'bans' then
    perform public.audit(r.server_id, case when tg_op = 'INSERT' then 'ban' else 'unban' end, r.user_id, null,
                         jsonb_build_object('reason', left(coalesce(r.reason, ''), 200)));
  when 'server_members' then
    if tg_op = 'DELETE' and old.user_id <> auth.uid() then perform public.audit(old.server_id, 'kick', old.user_id, null, '{}'::jsonb); end if;
  when 'member_roles' then
    perform public.audit(r.server_id, case when tg_op = 'INSERT' then 'role_give' else 'role_take' end, r.user_id, r.role_id,
                         jsonb_build_object('role', (select name from public.roles where id = r.role_id)));
  when 'roles' then
    if tg_op = 'UPDATE' then
      select array_agg(k) into v_changed from jsonb_each(to_jsonb(new)) n(k, v) where to_jsonb(old) -> k is distinct from v and k <> 'position';
      if v_changed is null then return null; end if;
    end if;
    perform public.audit(r.server_id, 'role_' || lower(tg_op), null, r.id, jsonb_build_object('name', r.name, 'changed', v_changed));
  when 'channels' then
    if r.server_id is null then return null; end if;
    if tg_op = 'UPDATE' then
      select array_agg(k) into v_changed from jsonb_each(to_jsonb(new)) n(k, v)
      where to_jsonb(old) -> k is distinct from v and k not in ('position', 'key_rotation_needed', 'category');
      if v_changed is null then return null; end if;
    end if;
    perform public.audit(r.server_id, 'channel_' || lower(tg_op), null, r.id, jsonb_build_object('name', r.name, 'changed', v_changed));
  when 'invites' then
    perform public.audit(r.server_id, case when tg_op = 'INSERT' then 'invite_create' else 'invite_delete' end, null, null,
                         jsonb_build_object('code', left(r.code, 4) || '…'));
  when 'servers' then
    select array_agg(k) into v_changed from jsonb_each(to_jsonb(new)) n(k, v) where to_jsonb(old) -> k is distinct from v;
    if v_changed is not null then perform public.audit(new.id, 'server_update', null, null, jsonb_build_object('changed', v_changed)); end if;
  when 'server_bots' then
    perform public.audit(r.server_id, case when tg_op = 'INSERT' then 'bot_add' else 'bot_remove' end, null, r.app_id,
                         jsonb_build_object('name', (select name from public.applications where id = r.app_id)));
  else
    null;
  end case;
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['bans', 'server_members', 'member_roles', 'roles', 'channels', 'invites', 'server_bots'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or delete on public.%I for each row execute function public.audit_trigger()', t || '_audit', t);
  end loop;
  foreach t in array array['roles', 'channels', 'servers'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit_upd', t);
    execute format('create trigger %I after update on public.%I for each row execute function public.audit_trigger()', t || '_audit_upd', t);
  end loop;
end $$;
-- joins are already listed under invite analytics; the server_members trigger only logs kicks
drop trigger if exists server_members_audit on public.server_members;
create trigger server_members_audit after delete on public.server_members for each row execute function public.audit_trigger();

-- -------------------------------------------------- server recycle bin ----
alter table public.servers drop constraint if exists servers_status_check;
alter table public.servers add constraint servers_status_check check (status in ('active', 'review', 'closed', 'banned', 'deleted'));
alter table public.servers add column if not exists deleted_at timestamptz;

create or replace function public.delete_server(p_server uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
begin
  if (select owner_id from public.servers where id = p_server) is distinct from auth.uid() then
    raise exception 'only the owner can delete the server';
  end if;
  if (select status from public.servers where id = p_server) <> 'active' then raise exception 'this server can''t be deleted right now'; end if;
  perform set_config('venband.mod', 'on', true);
  update public.servers set status = 'deleted', deleted_at = now() where id = p_server;
  perform set_config('venband.mod', 'off', true);
  return now() + interval '7 days';
end;
$$;

create or replace function public.restore_server(p_server uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select owner_id from public.servers where id = p_server) is distinct from auth.uid() then
    raise exception 'only the owner can restore the server';
  end if;
  if (select status from public.servers where id = p_server) <> 'deleted' then raise exception 'nothing to restore'; end if;
  perform set_config('venband.mod', 'on', true);
  update public.servers set status = 'active', deleted_at = null where id = p_server;
  perform set_config('venband.mod', 'off', true);
end;
$$;

-- --------------------------------------------------------- account deletion ----
alter table public.profiles add column if not exists deletion_requested_at timestamptz;

create or replace function public.request_account_deletion()
returns timestamptz language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from public.servers where owner_id = auth.uid() and status <> 'deleted') then
    raise exception 'transfer or delete the servers you own first';
  end if;
  update public.profiles set deletion_requested_at = now() where id = auth.uid();
  return now() + interval '14 days';
end;
$$;

create or replace function public.cancel_account_deletion()
returns void language sql security definer set search_path = '' as $$
  update public.profiles set deletion_requested_at = null where id = auth.uid();
$$;

-- Deleted servers after 7 days, accounts 14 days after the request.
create or replace function public.purge_deleted()
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.servers where status = 'deleted' and deleted_at < now() - interval '7 days';
  delete from auth.users u using public.profiles p
  where p.id = u.id and p.deletion_requested_at < now() - interval '14 days';
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'venband-purge-deleted';
    perform cron.schedule('venband-purge-deleted', '17 * * * *', 'select public.purge_deleted()');
  end if;
exception when others then
  raise notice 'pg_cron not available: deleted servers and accounts will be purged once it is turned on';
end $$;

-- ------------------------------------------------------ two-factor auth ----
-- With an authenticator app turned on, your private key (and so your
-- messages) only unlock in a session that passed the second step.
create or replace function public.mfa_ok()
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2' then return true; end if;
  return not exists (select 1 from auth.mfa_factors where user_id = auth.uid() and status = 'verified');
exception when undefined_table then
  return true;
end;
$$;

drop policy if exists private_keys_mfa on public.user_private_keys;
create policy private_keys_mfa on public.user_private_keys as restrictive for all to authenticated
  using (public.mfa_ok()) with check (public.mfa_ok());
drop policy if exists messages_mfa on public.messages;
create policy messages_mfa on public.messages as restrictive for all to authenticated
  using (public.mfa_ok()) with check (public.mfa_ok());

-- ------------------------------------------------------------ data export ----
create or replace function public.export_my_data()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'exported_at', now(),
    'note', 'Messages are end-to-end encrypted; export a conversation from its menu to get readable copies.',
    'profile', (select to_jsonb(p) - 'deletion_requested_at' from public.profiles p where p.id = auth.uid()),
    'email', (select email from auth.users where id = auth.uid()),
    'settings', (select to_jsonb(s) from public.user_settings s where s.user_id = auth.uid()),
    'friends', (select coalesce(jsonb_agg(jsonb_build_object('user', case when f.user_a = auth.uid() then f.user_b else f.user_a end,
                                                            'accepted', f.accepted, 'since', f.created_at)), '[]')
                from public.friendships f where auth.uid() in (f.user_a, f.user_b)),
    'servers', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'joined_at', m.joined_at, 'owner', s.owner_id = auth.uid())), '[]')
                from public.server_members m join public.servers s on s.id = m.server_id where m.user_id = auth.uid()),
    'reports_filed', (select coalesce(jsonb_agg(jsonb_build_object('kind', r.kind, 'reason', r.reason, 'status', r.status, 'at', r.created_at)), '[]')
                      from public.reports r where r.reporter_id = auth.uid()),
    'warnings', (select coalesce(jsonb_agg(jsonb_build_object('server', w.server_id, 'reason', w.reason, 'at', w.created_at)), '[]')
                 from public.member_warnings w where w.user_id = auth.uid()),
    'applications', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'preset', a.preset, 'created_at', a.created_at)), '[]')
                     from public.applications a where a.owner_id = auth.uid()),
    'voogle', (select coalesce(jsonb_agg(jsonb_build_object('server', v.server_id, 'result', v.result, 'at', v.updated_at)), '[]')
               from public.voogle_verifications v where v.user_id = auth.uid()),
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('signed_in', s.created_at, 'last_active', coalesce(s.refreshed_at::timestamptz, s.updated_at))), '[]')
                from auth.sessions s where s.user_id = auth.uid())
  );
$$;

-- Server permissions: timeouts are read-only, like unaccepted rules.
create or replace function public.server_permissions(p_server uuid, p_user uuid default auth.uid())
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_status text;
  v_rules text[];
  v_voogle jsonb;
  v_perms bigint;
  v_timeout timestamptz;
begin
  select owner_id, status, rules, voogle into v_owner, v_status, v_rules, v_voogle from public.servers where id = p_server;
  if v_owner is null or v_status <> 'active' then return 0; end if;
  if v_owner = p_user then return 2147483647; end if;
  select timeout_until into v_timeout from public.server_members where server_id = p_server and user_id = p_user;
  if not found then return 0; end if;

  select coalesce(bit_or(r.permissions), 0) into v_perms
  from public.roles r
  where r.server_id = p_server
    and (r.is_default or exists (select 1 from public.member_roles mr
                                 where mr.role_id = r.id and mr.user_id = p_user
                                   and mr.server_id = p_server));
  if (v_perms & 1) = 1 then return 2147483647; end if;
  if (v_timeout is not null and v_timeout > now())
     or (cardinality(v_rules) > 0 and not exists (select 1 from public.member_onboarding o where o.server_id = p_server
                                                 and o.user_id = p_user and o.rules_accepted_at is not null))
     or (coalesce((v_voogle ->> 'enabled')::boolean, false) and coalesce((v_voogle ->> 'required')::boolean, false)
         and (v_perms & (2 | 16 | 32 | 2097152)) = 0
         and not exists (select 1 from public.voogle_verifications v where v.server_id = p_server
                         and v.user_id = p_user and v.result = 'passed')) then
    -- read-only: no sending, reacting, threads, polls, files, voice talk
    v_perms := v_perms & ~(128 | 4096 | 8192 | 32768 | 65536 | 1024 | 2048 | 524288);
  end if;
  return v_perms;
end;
$$;

-- --------------------------------------------------------------- realtime ----
do $$
declare t text;
begin
  foreach t in array array['member_warnings', 'banned_media', 'custom_badges'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------- grants ----
grant select on public.banned_media, public.member_warnings, public.server_audit_log to authenticated;
grant select on public.custom_badges to anon, authenticated;
revoke execute on function
  public.is_server_moderator(uuid, uuid), public.server_reports(uuid, text), public.handle_server_report(uuid, text, text),
  public.can_read_evidence(text), public.can_ban_media(uuid), public.ban_media(uuid, text, boolean),
  public.can_design_badges(), public.save_custom_badge(text, text, text, text), public.delete_custom_badge(text),
  public.can_moderate(uuid, uuid, bigint), public.timeout_member(uuid, uuid, integer, text),
  public.warn_member(uuid, uuid, text), public.ack_warning(uuid), public.audit(uuid, text, uuid, uuid, jsonb),
  public.audit_trigger(), public.delete_server(uuid), public.restore_server(uuid),
  public.request_account_deletion(), public.cancel_account_deletion(), public.purge_deleted(),
  public.mfa_ok(), public.export_my_data()
from public, anon, authenticated;
grant execute on function
  public.is_server_moderator(uuid, uuid), public.server_reports(uuid, text), public.handle_server_report(uuid, text, text),
  public.can_read_evidence(text), public.can_ban_media(uuid), public.ban_media(uuid, text, boolean),
  public.can_design_badges(), public.save_custom_badge(text, text, text, text), public.delete_custom_badge(text),
  public.timeout_member(uuid, uuid, integer, text), public.warn_member(uuid, uuid, text), public.ack_warning(uuid),
  public.delete_server(uuid), public.restore_server(uuid),
  public.request_account_deletion(), public.cancel_account_deletion(), public.mfa_ok(), public.export_my_data()
to authenticated;
