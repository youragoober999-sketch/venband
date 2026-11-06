-- =============================================================================
-- Staff permissions, appeals, audit search, theme / bot moderation (20261106050000)
--
--   * Granular staff permissions. profiles.staff_permissions (NULL = the role's
--     defaults, which are exactly what each rank could do before, so nothing
--     changes until an owner narrows someone down). Owners / founders always
--     have every permission. Checked by staff_can() inside every moderation
--     function — the app hiding a button is never the protection.
--       accounts  limit / very-limit / restore accounts      (moderator+)
--       ban       ban and unban accounts                     (moderator+)
--       badges    award badges                               (moderator+)
--       servers   review / verify / close / ban servers      (moderator+)
--       marketplace  remove / restore themes & styles        (moderator+)
--       apps      disable / enable bots and apps             (moderator+)
--       audit     read the staff audit log                   (moderator+)
--       reports   the Report Centre                          (admin+)
--       appeals   decide appeals                             (admin+)
--   * Appeals: people can appeal an account restriction, a removed marketplace
--     item or a disabled bot, once at a time; staff accept (undoes it) or deny
--     with a reply; the person is notified either way.
--   * Reports for marketplace items and bots (report_item), shown in the
--     Report Centre next to message / user reports.
--   * mod_log_search: audit log search and filters.
--
-- Safe to run more than once.
-- =============================================================================

-- ------------------------------------------------------- staff permissions --
create or replace function public.staff_permission_keys()
returns text[] language sql immutable set search_path = '' as $$
  select array['accounts', 'ban', 'badges', 'servers', 'marketplace', 'apps', 'audit', 'reports', 'appeals']::text[];
$$;

alter table public.profiles add column if not exists staff_permissions text[];
do $$ begin
  alter table public.profiles add constraint profiles_staff_permissions_valid
    check (staff_permissions is null or staff_permissions <@ array['accounts', 'ban', 'badges', 'servers', 'marketplace', 'apps', 'audit', 'reports', 'appeals']::text[]);
exception when duplicate_object then null; end $$;

create or replace function public.staff_permissions_for(p_user uuid default auth.uid())
returns text[] language sql stable security definer set search_path = '' as $$
  select case
    when public.is_top_staff(p_user) then public.staff_permission_keys()
    when public.platform_rank(p_user) < 1 then '{}'::text[]
    else coalesce((select staff_permissions from public.profiles where id = p_user),
                  case when public.platform_rank(p_user) >= 2 then public.staff_permission_keys()
                       else array['accounts', 'ban', 'badges', 'servers', 'marketplace', 'apps', 'audit']::text[] end)
  end;
$$;

create or replace function public.staff_can(p_perm text, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select p_perm = any (public.staff_permissions_for(p_user));
$$;

create or replace function public.my_staff_permissions()
returns text[] language sql stable security definer set search_path = '' as $$
  select public.staff_permissions_for(auth.uid());
$$;

-- Owners / founders set what a staff member may do. NULL = back to the role's defaults.
create or replace function public.mod_set_staff_permissions(p_user uuid, p_perms text[])
returns text[] language plpgsql security definer set search_path = '' as $$
declare
  v_clean text[];
begin
  if not public.is_top_staff() then raise exception 'only Venband owners can change staff permissions'; end if;
  if p_user = auth.uid() then raise exception 'you can''t change your own permissions'; end if;
  if public.platform_rank(p_user) < 1 then raise exception 'they aren''t Venband staff'; end if;
  if public.is_top_staff(p_user) then raise exception 'owners always have every permission'; end if;
  if p_perms is not null then
    if not (p_perms <@ public.staff_permission_keys()) then raise exception 'unknown permission'; end if;
    select coalesce(array_agg(distinct x order by x), '{}') into v_clean from unnest(p_perms) x;
  end if;
  update public.profiles set staff_permissions = v_clean where id = p_user;
  insert into public.mod_actions (actor_id, target_user, action, detail)
  values (auth.uid(), p_user, 'staff_permissions', coalesce(array_to_string(v_clean, ', '), 'role defaults'));
  return public.staff_permissions_for(p_user);
end;
$$;

-- ----------------------------------------- existing tools, now permission-checked --
create or replace function public.mod_set_account_status(p_user uuid, p_status text, p_reason text default '', p_server uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('active', 'limited', 'very_limited', 'banned') then raise exception 'unknown status'; end if;
  if p_user = auth.uid() or not public.mod_can_target(p_user) then raise exception 'you can''t change this account'; end if;
  -- banning / unbanning needs the "ban" permission, other restrictions "accounts"
  if not public.staff_can(case when p_status = 'banned' or (select account_status from public.profiles where id = p_user) = 'banned'
                               then 'ban' else 'accounts' end) then
    raise exception 'your staff permissions don''t include this';
  end if;
  update public.profiles set account_status = p_status where id = p_user;
  -- banned accounts are signed out everywhere and can't sign in again
  update auth.users set banned_until = case when p_status = 'banned' then 'infinity'::timestamptz end
  where id = p_user;
  if p_status = 'banned' then delete from auth.sessions where user_id = p_user; end if;
  insert into public.mod_actions (actor_id, target_user, action, detail, reason)
  values (auth.uid(), p_user, 'account_status', p_status, left(coalesce(p_reason, ''), 1000));
  if p_status in ('limited', 'very_limited', 'banned') then
    perform public.venband_notice(p_user, p_status, p_reason, p_server);
  end if;
end;
$$;

create or replace function public.mod_set_badges(p_user uuid, p_badges text[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_new text[];
  v_old text[];
  v_staff_badges text[] := array['owner', 'admin', 'moderator', 'staff', 'developer', 'verified', 'verified_bot', 'verified_server'];
begin
  if not public.mod_can_target(p_user) then raise exception 'you can''t change this account'; end if;
  if not public.staff_can('badges') then raise exception 'your staff permissions don''t include badges'; end if;
  select coalesce(array_agg(distinct b order by b), '{}') into v_new
  from unnest(coalesce(p_badges, '{}')) b where b = any (public.all_badges());
  select badges into v_old from public.profiles where id = p_user;
  if not public.is_top_staff() then
    if public.platform_rank() < 2 and (
         (select coalesce(array_agg(b), '{}') from unnest(v_new) b where b = any (v_staff_badges))
         is distinct from
         (select coalesce(array_agg(b order by b), '{}') from unnest(v_old) b where b = any (v_staff_badges))) then
      raise exception 'only admins can change staff and verification badges';
    end if;
    if public.platform_rank() < 3 and (('owner' = any (v_new)) <> ('owner' = any (v_old))) then
      raise exception 'only the owner can change the owner badge';
    end if;
  end if;
  update public.profiles set badges = v_new where id = p_user;
  insert into public.mod_actions (actor_id, target_user, action, detail)
  values (auth.uid(), p_user, 'badges', array_to_string(v_new, ', '));
end;
$$;

create or replace function public.mod_server_action(p_server uuid, p_action text, p_reason text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  if not public.staff_can('servers') then raise exception 'your staff permissions don''t include servers'; end if;
  select owner_id into v_owner from public.servers where id = p_server;
  if v_owner is null then raise exception 'server not found'; end if;
  perform set_config('venband.mod', 'on', true);
  case p_action
    when 'review'   then update public.servers set status = 'review' where id = p_server;
    when 'approve'  then update public.servers set status = 'active' where id = p_server;
    when 'reject'   then
      update public.servers set status = 'closed', verified = false where id = p_server;
      if public.platform_rank(v_owner) < public.platform_rank() then
        update public.profiles set account_status = 'very_limited'
        where id = v_owner and account_status in ('active', 'limited');
        if found then
          perform public.venband_notice(v_owner, 'very_limited', p_reason, p_server);
        end if;
      end if;
    when 'ban'      then update public.servers set status = 'banned', verified = false where id = p_server;
    when 'unban'    then update public.servers set status = 'active' where id = p_server;
    when 'verify'   then update public.servers set verified = true where id = p_server;
    when 'unverify' then update public.servers set verified = false where id = p_server;
    else raise exception 'unknown action';
  end case;
  perform set_config('venband.mod', 'off', true);
  insert into public.mod_actions (actor_id, target_server, target_user, action, reason)
  values (auth.uid(), p_server, v_owner, 'server_' || p_action, left(coalesce(p_reason, ''), 1000));
end;
$$;

create or replace function public.handle_report(p_report uuid, p_status text, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.staff_can('reports') then raise exception 'your staff permissions don''t include reports'; end if;
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

create or replace function public.mod_log(p_limit integer default 50)
returns table (id uuid, actor text, target_user text, target_server text, action text, detail text,
               reason text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.id, a.username, u.username, s.name, m.action, m.detail, m.reason, m.created_at
  from public.mod_actions m
  left join public.profiles a on a.id = m.actor_id
  left join public.profiles u on u.id = m.target_user
  left join public.servers s on s.id = m.target_server
  where public.is_staff() and public.staff_can('audit')
  order by m.created_at desc
  limit least(coalesce(p_limit, 50), 200);
$$;

create or replace function public.theme_set_status(p_theme uuid, p_status text, p_reason text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  t public.themes%rowtype;
  v_staff boolean := public.is_staff() and public.staff_can('marketplace');
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_status not in ('published', 'unpublished', 'removed') then raise exception 'unknown status'; end if;
  select * into t from public.themes where id = p_theme for update;
  if not found then raise exception 'not found'; end if;

  if p_status = 'removed' or t.status = 'removed' then
    if not v_staff then raise exception 'only Venband staff can remove or restore marketplace items'; end if;
    if p_status = 'removed' and char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'give a reason for removing it'; end if;
    if p_status <> 'removed' and t.version < 1 then raise exception 'it was never published'; end if;
    update public.themes
       set status = p_status, updated_at = now(),
           removed_reason = case when p_status = 'removed' then left(btrim(p_reason), 500) else null end
     where id = p_theme;
    insert into public.mod_actions (actor_id, target_user, action, detail, reason)
    values (v_uid, t.author_id, 'marketplace_' || case when p_status = 'removed' then 'remove' else 'restore' end,
            t.kind || ' “' || t.name || '” (' || t.id || ')', left(coalesce(p_reason, ''), 1000));
    return;
  end if;

  if t.author_id <> v_uid then raise exception 'only the creator can change this'; end if;
  if p_status = 'published' and t.version < 1 then raise exception 'publish it first'; end if;
  update public.themes set status = p_status, updated_at = now() where id = p_theme;
end;
$$;

-- ------------------------------------------------------------ audit search --
create or replace function public.mod_log_search(
  p_query text default '', p_action text default '', p_from timestamptz default null, p_to timestamptz default null,
  p_before timestamptz default null, p_limit integer default 100)
returns table (id uuid, actor text, actor_id uuid, target_user text, target_user_id uuid, target_server text,
               target_server_id uuid, action text, detail text, reason text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.id, a.username, m.actor_id, u.username, m.target_user, s.name, m.target_server, m.action, m.detail, m.reason, m.created_at
  from public.mod_actions m
  left join public.profiles a on a.id = m.actor_id
  left join public.profiles u on u.id = m.target_user
  left join public.servers s on s.id = m.target_server
  where public.is_staff() and public.staff_can('audit')
    and (coalesce(p_action, '') = '' or m.action like replace(replace(p_action, '%', ''), '_', '\_') || '%')
    and (p_from is null or m.created_at >= p_from)
    and (p_to is null or m.created_at < p_to)
    and (p_before is null or m.created_at < p_before)
    and (coalesce(btrim(p_query), '') = ''
         or a.username ilike '%' || btrim(p_query) || '%' or u.username ilike '%' || btrim(p_query) || '%'
         or s.name ilike '%' || btrim(p_query) || '%' or m.detail ilike '%' || btrim(p_query) || '%'
         or m.reason ilike '%' || btrim(p_query) || '%' or m.target_user::text = btrim(p_query)
         or m.target_server::text = btrim(p_query) or m.actor_id::text = btrim(p_query))
  order by m.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

-- ------------------------------------------------- bots: disable / enable --
create or replace function public.mod_app_action(p_app uuid, p_action text, p_reason text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare
  a public.applications%rowtype;
begin
  if not public.staff_can('apps') then raise exception 'your staff permissions don''t include bots and apps'; end if;
  if p_action not in ('disable', 'enable') then raise exception 'unknown action'; end if;
  select * into a from public.applications where id = p_app;
  if not found then raise exception 'not found'; end if;
  if a.owner_id = '3fff0000-0000-4000-8000-0000000000bd' and not public.is_top_staff() then
    raise exception 'only owners can change Venband''s own apps';
  end if;
  if p_action = 'disable' and char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'give a reason'; end if;
  perform set_config('venband.mod', 'on', true);
  update public.applications set status = case when p_action = 'disable' then 'disabled' else 'active' end where id = p_app;
  perform set_config('venband.mod', 'off', true);
  insert into public.mod_actions (actor_id, target_user, action, detail, reason)
  values (auth.uid(), a.owner_id, 'app_' || p_action, a.name || ' (' || a.id || ')', left(coalesce(p_reason, ''), 1000));
  perform public.notify(a.owner_id, 'platform', 'app_' || p_action,
    case when p_action = 'disable' then 'Your bot “' || a.name || '” was disabled' else 'Your bot “' || a.name || '” is active again' end,
    case when p_action = 'disable' then 'Venband staff disabled it: ' || left(btrim(p_reason), 400) || E'\nYou can appeal in Settings → Security → Appeals.'
         else 'Venband staff lifted the restriction. It can post again.' end,
    case when p_action = 'disable' then 'warning' else 'info' end,
    case when p_action = 'disable' then array['open_appeals'] else '{}'::text[] end,
    jsonb_build_object('app', a.id));
end;
$$;

-- --------------------------------------------- reports for themes and bots --
alter table public.reports add column if not exists target_ref uuid;
alter table public.reports drop constraint if exists reports_kind_check;
alter table public.reports add constraint reports_kind_check check (kind in ('message', 'user', 'theme', 'app'));

-- message / user reports are inserted directly (they carry evidence decrypted on
-- the reporter's device); theme / bot reports only through report_item()
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated
  with check (
    reporter_id = auth.uid() and status = 'under_review' and handled_by is null
    and kind in ('message', 'user')
    and target_user is distinct from auth.uid()
    and (select count(*) from public.reports r where r.reporter_id = auth.uid() and r.created_at > now() - interval '1 hour') < 20
  );
drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports for select to authenticated
  using (reporter_id = auth.uid() or public.staff_can('reports'));

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

-- ----------------------------------------------------------------- appeals --
create table if not exists public.appeals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('account', 'theme', 'app')),
  target_ref  uuid,
  subject     text not null default '' check (char_length(subject) <= 200),
  message     text not null check (char_length(btrim(message)) between 10 and 2000),
  status      text not null default 'open' check (status in ('open', 'accepted', 'denied')),
  handled_by  uuid references public.profiles (id) on delete set null,
  response    text not null default '' check (char_length(response) <= 1000),
  created_at  timestamptz not null default now(),
  handled_at  timestamptz
);
create unique index if not exists appeals_one_open on public.appeals (user_id, kind, coalesce(target_ref, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'open';
create index if not exists appeals_status_idx on public.appeals (status, created_at);
alter table public.appeals enable row level security;
drop policy if exists appeals_select on public.appeals;
create policy appeals_select on public.appeals for select to authenticated
  using (user_id = auth.uid() or public.staff_can('appeals'));
revoke insert, update, delete on public.appeals from authenticated, anon;
grant select on public.appeals to authenticated;

create or replace function public.submit_appeal(p_kind text, p_ref uuid, p_message text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_subject text;
  v_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if char_length(btrim(coalesce(p_message, ''))) not between 10 and 2000 then raise exception 'explain in 10–2000 characters'; end if;
  if p_kind = 'account' then
    select account_status into v_subject from public.profiles where id = v_uid;
    if v_subject is null or v_subject = 'active' then raise exception 'your account isn''t restricted'; end if;
    p_ref := null;
  elsif p_kind = 'theme' then
    select name into v_subject from public.themes where id = p_ref and author_id = v_uid and status = 'removed';
    if v_subject is null then raise exception 'that item wasn''t removed by staff'; end if;
  elsif p_kind = 'app' then
    select name into v_subject from public.applications where id = p_ref and owner_id = v_uid and status = 'disabled';
    if v_subject is null then raise exception 'that bot isn''t disabled'; end if;
  else
    raise exception 'unknown kind';
  end if;
  if exists (select 1 from public.appeals where user_id = v_uid and kind = p_kind and target_ref is not distinct from p_ref and status = 'open') then
    raise exception 'you already have an open appeal for this';
  end if;
  if exists (select 1 from public.appeals where user_id = v_uid and kind = p_kind and target_ref is not distinct from p_ref
             and status = 'denied' and handled_at > now() - interval '7 days') then
    raise exception 'this appeal was denied recently — you can appeal again 7 days after the decision';
  end if;
  if (select count(*) from public.appeals where user_id = v_uid and created_at > now() - interval '1 day') >= 5 then
    raise exception 'too many appeals today';
  end if;
  insert into public.appeals (user_id, kind, target_ref, subject, message)
  values (v_uid, p_kind, p_ref, left(v_subject, 200), btrim(p_message))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.handle_appeal(p_appeal uuid, p_accept boolean, p_response text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare
  a public.appeals%rowtype;
begin
  if not public.staff_can('appeals') then raise exception 'your staff permissions don''t include appeals'; end if;
  select * into a from public.appeals where id = p_appeal for update;
  if not found then raise exception 'not found'; end if;
  if a.status <> 'open' then raise exception 'already decided'; end if;
  if a.user_id = auth.uid() then raise exception 'you can''t decide your own appeal'; end if;
  if not p_accept and char_length(btrim(coalesce(p_response, ''))) < 3 then raise exception 'tell them why it was denied'; end if;

  if p_accept then
    if a.kind = 'account' then
      if not public.mod_can_target(a.user_id) then raise exception 'you can''t change this account'; end if;
      update public.profiles set account_status = 'active' where id = a.user_id;
      update auth.users set banned_until = null where id = a.user_id;
    elsif a.kind = 'theme' then
      update public.themes set status = 'published', removed_reason = null, updated_at = now()
       where id = a.target_ref and status = 'removed' and version >= 1;
    elsif a.kind = 'app' then
      perform set_config('venband.mod', 'on', true);
      update public.applications set status = 'active' where id = a.target_ref;
      perform set_config('venband.mod', 'off', true);
    end if;
  end if;

  update public.appeals set status = case when p_accept then 'accepted' else 'denied' end,
         handled_by = auth.uid(), response = left(btrim(coalesce(p_response, '')), 1000), handled_at = now()
   where id = p_appeal;
  insert into public.mod_actions (actor_id, target_user, action, detail, reason)
  values (auth.uid(), a.user_id, 'appeal_' || case when p_accept then 'accepted' else 'denied' end,
          a.kind || ': ' || a.subject, left(coalesce(p_response, ''), 1000));
  perform public.notify(a.user_id, 'platform', 'appeal_result',
    case when p_accept then 'Your appeal was accepted' else 'Your appeal was denied' end,
    case when p_accept then 'Venband staff reviewed your appeal about ' || a.subject || ' and lifted it.'
         else 'Venband staff reviewed your appeal about ' || a.subject || '. Their reply: ' || left(btrim(p_response), 600) end,
    case when p_accept then 'info' else 'warning' end, array['open_appeals'], jsonb_build_object('appeal', a.id));
end;
$$;

-- ------------------------------------------------------------------ grants --
revoke execute on function public.staff_permissions_for(uuid) from public, anon, authenticated;
revoke execute on function public.staff_can(text, uuid) from public, anon;
grant execute on function public.staff_can(text, uuid) to authenticated;
revoke execute on function public.my_staff_permissions() from public, anon;
grant execute on function public.my_staff_permissions() to authenticated;
revoke execute on function public.mod_set_staff_permissions(uuid, text[]) from public, anon;
grant execute on function public.mod_set_staff_permissions(uuid, text[]) to authenticated;
revoke execute on function public.mod_log_search(text, text, timestamptz, timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.mod_log_search(text, text, timestamptz, timestamptz, timestamptz, integer) to authenticated;
revoke execute on function public.mod_app_action(uuid, text, text) from public, anon;
grant execute on function public.mod_app_action(uuid, text, text) to authenticated;
revoke execute on function public.report_item(text, uuid, text) from public, anon;
grant execute on function public.report_item(text, uuid, text) to authenticated;
revoke execute on function public.submit_appeal(text, uuid, text) from public, anon;
grant execute on function public.submit_appeal(text, uuid, text) to authenticated;
revoke execute on function public.handle_appeal(uuid, boolean, text) from public, anon;
grant execute on function public.handle_appeal(uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';
