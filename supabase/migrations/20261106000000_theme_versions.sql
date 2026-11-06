-- =============================================================================
-- Theme ownership, versions, drafts and honest install counts (20261106000000)
--
-- Marketplace items (themes, CSS, nameplates, name styles) can now be edited by
-- their creator after publishing — and only by their creator:
--
--   * every publish creates an immutable row in theme_versions (history is never
--     overwritten; existing items are backfilled as version 1)
--   * unpublished changes live in theme_drafts, visible only to the owner
--   * status: draft (never published) / published / unpublished / removed
--     (removed = taken down by Venband staff, with a reason, logged)
--   * there is NO update policy on themes: all changes go through the
--     owner-checked functions below, which re-validate the data server-side with
--     the same rules the app's sanitizers use (themes are colour data only; CSS
--     may not import, load remote files or use script-like tricks)
--   * install counts come from theme_installs (one row per person), so calling
--     install_theme() repeatedly can no longer inflate them; the creator's own
--     installs don't count. Existing counts are kept as a baseline.
--   * older app versions that insert directly still work: their inserts are
--     validated and recorded as a published version 1.
--
-- Safe to run more than once.
-- =============================================================================

-- ------------------------------------------------------------------ columns --
alter table public.themes
  add column if not exists status text not null default 'published',
  add column if not exists version integer not null default 1,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists category text,
  add column if not exists removed_reason text,
  add column if not exists legacy_installs integer not null default 0;

do $$ begin
  alter table public.themes add constraint themes_status_check check (status in ('draft', 'published', 'unpublished', 'removed'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.themes add constraint themes_version_check check (version >= 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.themes add constraint themes_category_check
    check (category is null or category in ('dark', 'light', 'colorful', 'minimal', 'glass', 'high-contrast', 'seasonal', 'other'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.themes add constraint themes_removed_reason_check check (removed_reason is null or char_length(removed_reason) <= 500);
exception when duplicate_object then null; end $$;

create index if not exists themes_status_kind_idx on public.themes (status, kind, installs desc);
create index if not exists themes_author_idx on public.themes (author_id, updated_at desc);

-- ------------------------------------------------------------------- tables --
create table if not exists public.theme_versions (
  theme_id     uuid not null references public.themes (id) on delete cascade,
  version      integer not null check (version >= 1),
  name         text not null check (char_length(btrim(name)) between 1 and 40),
  description  text not null default '' check (char_length(description) <= 140),
  category     text,
  data         jsonb not null check (pg_column_size(data) < 20000),
  changelog    text not null default '' check (char_length(changelog) <= 500),
  published_by uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (theme_id, version)
);
alter table public.theme_versions enable row level security;

create table if not exists public.theme_drafts (
  theme_id    uuid primary key references public.themes (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  description text not null default '' check (char_length(description) <= 140),
  category    text,
  data        jsonb not null check (pg_column_size(data) < 20000),
  updated_at  timestamptz not null default now()
);
alter table public.theme_drafts enable row level security;

create table if not exists public.theme_installs (
  theme_id     uuid not null references public.themes (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  version      integer not null default 1,
  installed_at timestamptz not null default now(),
  primary key (theme_id, user_id)
);
create index if not exists theme_installs_user_idx on public.theme_installs (user_id);
alter table public.theme_installs enable row level security;

-- ----------------------------------------------------------------- backfill --
insert into public.theme_versions (theme_id, version, name, description, category, data, changelog, published_by, created_at)
select t.id, 1, t.name, t.description, t.category, t.data, '', t.author_id, t.created_at
  from public.themes t
 where t.status <> 'draft'
on conflict do nothing;

-- keep the install counts people already earned (they can't be re-derived)
update public.themes t set legacy_installs = t.installs
 where t.legacy_installs = 0 and t.installs > 0
   and not exists (select 1 from public.theme_installs i where i.theme_id = t.id);

-- ---------------------------------------------------------------- validation --
-- Returns NULL when the data is acceptable, otherwise a human-readable reason.
-- Mirrors sanitizeTheme() (src/lib/themes.ts) and sanitizeCss() (src/lib/customCss.ts).
create or replace function public.theme_data_problem(p_kind text, p_data jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare
  k text;
  v jsonb;
  css text;
  color_re constant text := '^(#[0-9a-fA-F]{3,8}|rgba?\([0-9\s.,%]+\)|hsla?\([0-9\s.,%deg]+\))$';
  grad_re  constant text := '^((radial|linear|conic)-gradient\([#\w\s.,%()-]+\)\s*,?\s*)+$';
  theme_keys constant text[] := array['bg-0', 'bg-1', 'bg-2', 'bg-3', 'bg-4', 'bg-hover', 'line', 'line-2', 'text', 'text-2',
    'muted', 'accent', 'accent-hover', 'accent-soft', 'accent-text', 'on-accent', 'link', 'success', 'danger', 'warning', 'mention-bg'];
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then return 'data must be a JSON object'; end if;
  if pg_column_size(p_data) >= 20000 then return 'that is too big to publish'; end if;

  if p_kind = 'theme' then
    for k in select jsonb_object_keys(p_data) loop
      if k <> all (array['id', 'name', 'description', 'vars', 'glass', 'wallpaper', 'author', 'version', 'sourceId']) then
        return 'unknown theme field: ' || k;
      end if;
    end loop;
    if jsonb_typeof(p_data -> 'vars') is distinct from 'object' then return 'a theme needs colour variables'; end if;
    for k, v in select e.key, e.value from jsonb_each(p_data -> 'vars') e loop
      if k <> all (theme_keys) then return 'unknown colour variable: ' || k; end if;
      if jsonb_typeof(v) <> 'string' or btrim(v #>> '{}') !~ color_re then return 'invalid colour for ' || k; end if;
    end loop;
    if p_data ? 'wallpaper' and jsonb_typeof(p_data -> 'wallpaper') <> 'null'
       and (jsonb_typeof(p_data -> 'wallpaper') <> 'string' or btrim(p_data ->> 'wallpaper') !~ grad_re) then
      return 'the wallpaper must be a CSS gradient';
    end if;
    if p_data ? 'glass' and jsonb_typeof(p_data -> 'glass') not in ('boolean', 'null') then return 'glass must be true or false'; end if;

  elsif p_kind = 'css' then
    for k in select jsonb_object_keys(p_data) loop
      if k <> 'css' then return 'unknown CSS field: ' || k; end if;
    end loop;
    if jsonb_typeof(p_data -> 'css') is distinct from 'string' then return 'the CSS must be text'; end if;
    css := p_data ->> 'css';
    if char_length(css) > 16000 then return 'CSS is limited to 16,000 characters'; end if;
    css := regexp_replace(css, '/\*.*?\*/', '', 'g'); -- comments can't do anything
    if css ~* '@import|@charset|expression\s*\(|behavior\s*:|-moz-binding|javascript\s*:|image-set\(|<\s*/?\s*style' then
      return 'the CSS contains blocked code (imports, scripts or remote files)';
    end if;
    if css ~* 'url\(\s*[''"]?\s*(?!data:image/(png|jpe?g|gif|webp|svg\+xml);)' then
      return 'CSS may only use pictures embedded as data:image URLs';
    end if;

  elsif p_kind in ('nameplate', 'name_style') then
    for k in select jsonb_object_keys(p_data) loop
      if (p_kind = 'nameplate' and k <> all (array['colors', 'pattern']))
         or (p_kind = 'name_style' and k <> all (array['colors', 'font', 'effect'])) then
        return 'unknown field: ' || k;
      end if;
    end loop;
    if p_data ? 'colors' and jsonb_typeof(p_data -> 'colors') <> 'null' then
      if jsonb_typeof(p_data -> 'colors') <> 'array' or jsonb_array_length(p_data -> 'colors') > 3 then return 'up to 3 colours'; end if;
      if exists (select 1 from jsonb_array_elements(p_data -> 'colors') c
                 where jsonb_typeof(c) <> 'string' or (c #>> '{}') !~ '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$') then
        return 'colours must be hex, like #rrggbb';
      end if;
    end if;
    foreach k in array array['pattern', 'font', 'effect'] loop
      if p_data ? k and jsonb_typeof(p_data -> k) <> 'null'
         and (jsonb_typeof(p_data -> k) <> 'string' or (p_data ->> k) !~ '^[a-z0-9_-]{1,24}$') then
        return 'invalid ' || k;
      end if;
    end loop;

  else
    return 'unknown kind of item';
  end if;
  return null;
end;
$$;

-- --------------------------------------------------------- insert guard/history --
-- Direct inserts (older app versions) are always a validated, published version 1.
create or replace function public.guard_theme_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_problem text;
begin
  if coalesce(current_setting('venband.theme_fn', true), '') <> 'on' then
    new.status := 'published';
    new.version := 1;
    new.installs := 0;
    new.legacy_installs := 0;
    new.removed_reason := null;
    v_problem := public.theme_data_problem(new.kind, new.data);
    if v_problem is not null then raise exception '%', v_problem; end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists themes_guard_insert on public.themes;
create trigger themes_guard_insert before insert on public.themes
  for each row execute function public.guard_theme_insert();

create or replace function public.theme_first_version()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'published' and new.version = 1 then
    insert into public.theme_versions (theme_id, version, name, description, category, data, changelog, published_by, created_at)
    values (new.id, 1, new.name, new.description, new.category, new.data, '', new.author_id, new.created_at)
    on conflict do nothing;
  end if;
  return null;
end;
$$;
drop trigger if exists themes_first_version on public.themes;
create trigger themes_first_version after insert on public.themes
  for each row execute function public.theme_first_version();

-- ------------------------------------------------------------------ helpers --
create or replace function public.theme_categories()
returns text[] language sql immutable set search_path = '' as $$
  select array['dark', 'light', 'colorful', 'minimal', 'glass', 'high-contrast', 'seasonal', 'other']::text[];
$$;

-- -------------------------------------------------------------- theme_save --
-- Create a new draft item (p_theme null) or save changes to your own item as a
-- draft. Nothing is visible to anyone else until theme_publish().
create or replace function public.theme_save(
  p_theme uuid, p_kind text, p_name text, p_description text, p_data jsonb, p_category text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid := p_theme;
  v_kind text := p_kind;
  v_problem text;
  t public.themes%rowtype;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 40 then raise exception 'the name must be 1–40 characters'; end if;
  if char_length(coalesce(p_description, '')) > 140 then raise exception 'the description is limited to 140 characters'; end if;
  if p_category is not null and p_category <> all (public.theme_categories()) then raise exception 'unknown category'; end if;

  if v_id is null then
    if not public.account_can('publish') then raise exception 'your account can''t publish right now'; end if;
    if (select count(*) from public.themes where author_id = v_uid) >= 25 then
      raise exception 'you can have up to 25 items (published or drafts) — delete one first';
    end if;
    v_problem := public.theme_data_problem(v_kind, p_data);
    if v_problem is not null then raise exception '%', v_problem; end if;
    perform set_config('venband.theme_fn', 'on', true);
    insert into public.themes (author_id, kind, name, description, data, status, version, category, installs)
    values (v_uid, v_kind, btrim(p_name), coalesce(p_description, ''), p_data, 'draft', 0, p_category, 0)
    returning id into v_id;
    perform set_config('venband.theme_fn', 'off', true);
  else
    select * into t from public.themes where id = v_id for update;
    if not found then raise exception 'not found'; end if;
    if t.author_id <> v_uid then raise exception 'only the creator can edit this'; end if;
    if t.status = 'removed' then raise exception 'this was removed by Venband moderators and can''t be edited'; end if;
    if v_kind is not null and v_kind <> t.kind then raise exception 'you can''t change what kind of item this is'; end if;
    v_kind := t.kind;
    v_problem := public.theme_data_problem(v_kind, p_data);
    if v_problem is not null then raise exception '%', v_problem; end if;
  end if;

  insert into public.theme_drafts (theme_id, name, description, category, data, updated_at)
  values (v_id, btrim(p_name), coalesce(p_description, ''), p_category, p_data, now())
  on conflict (theme_id) do update
    set name = excluded.name, description = excluded.description, category = excluded.category,
        data = excluded.data, updated_at = now();
  return v_id;
end;
$$;

-- ----------------------------------------------------------- theme_publish --
-- Publish your draft as a new version. The previous versions stay in history.
create or replace function public.theme_publish(p_theme uuid, p_changelog text default '')
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  t public.themes%rowtype;
  d public.theme_drafts%rowtype;
  v_next integer;
  v_problem text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into t from public.themes where id = p_theme for update;
  if not found then raise exception 'not found'; end if;
  if t.author_id <> v_uid then raise exception 'only the creator can publish this'; end if;
  if t.status = 'removed' then raise exception 'this was removed by Venband moderators'; end if;
  if not public.account_can('publish') then raise exception 'your account can''t publish right now'; end if;
  select * into d from public.theme_drafts where theme_id = p_theme;
  if not found then raise exception 'there are no unpublished changes'; end if;
  if exists (select 1 from public.theme_versions where theme_id = p_theme and created_at > now() - interval '15 seconds') then
    raise exception 'you just published this — wait a few seconds';
  end if;
  v_problem := public.theme_data_problem(t.kind, d.data);
  if v_problem is not null then raise exception '%', v_problem; end if;

  v_next := t.version + 1;
  insert into public.theme_versions (theme_id, version, name, description, category, data, changelog, published_by)
  values (p_theme, v_next, d.name, d.description, d.category, d.data, left(btrim(coalesce(p_changelog, '')), 500), v_uid);
  update public.themes
     set name = d.name, description = d.description, category = d.category, data = d.data,
         version = v_next, status = 'published', updated_at = now()
   where id = p_theme;
  delete from public.theme_drafts where theme_id = p_theme;
  return v_next;
end;
$$;

-- ---------------------------------------------------------- theme_rollback --
-- Make an older version current again. History stays linear: the old version is
-- republished as a NEW version, so people who installed it see a normal update.
create or replace function public.theme_rollback(p_theme uuid, p_version integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  t public.themes%rowtype;
  v public.theme_versions%rowtype;
  v_next integer;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into t from public.themes where id = p_theme for update;
  if not found then raise exception 'not found'; end if;
  if t.author_id <> v_uid then raise exception 'only the creator can restore versions'; end if;
  if t.status = 'removed' then raise exception 'this was removed by Venband moderators'; end if;
  select * into v from public.theme_versions where theme_id = p_theme and version = p_version;
  if not found then raise exception 'that version doesn''t exist'; end if;
  if p_version = t.version then raise exception 'that is already the current version'; end if;
  if exists (select 1 from public.theme_versions where theme_id = p_theme and created_at > now() - interval '15 seconds') then
    raise exception 'you just published this — wait a few seconds';
  end if;
  v_next := t.version + 1;
  insert into public.theme_versions (theme_id, version, name, description, category, data, changelog, published_by)
  values (p_theme, v_next, v.name, v.description, v.category, v.data, 'Restored version ' || p_version, v_uid);
  update public.themes
     set name = v.name, description = v.description, category = v.category, data = v.data,
         version = v_next, updated_at = now()
   where id = p_theme;
  return v_next;
end;
$$;

-- -------------------------------------------------------- theme_set_status --
-- Owner: publish / unpublish their own item. Staff: remove (with a reason) or
-- restore anyone's item; every staff action is written to mod_actions.
create or replace function public.theme_set_status(p_theme uuid, p_status text, p_reason text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  t public.themes%rowtype;
  v_staff boolean := public.is_staff();
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

-- -------------------------------------------------------- installs (honest) --
create or replace function public.install_theme(p_theme uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.themes%rowtype;
begin
  if auth.uid() is null then return; end if;
  select * into t from public.themes where id = p_theme and status = 'published';
  if not found then raise exception 'that item isn''t available any more'; end if;
  if t.author_id = auth.uid() then return; end if; -- your own installs don't count
  insert into public.theme_installs (theme_id, user_id, version) values (p_theme, auth.uid(), greatest(t.version, 1))
  on conflict (theme_id, user_id) do update set version = excluded.version, installed_at = now();
  update public.themes
     set installs = legacy_installs + (select count(*) from public.theme_installs where theme_id = p_theme)
   where id = p_theme;
end;
$$;

create or replace function public.uninstall_theme(p_theme uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return; end if;
  delete from public.theme_installs where theme_id = p_theme and user_id = auth.uid();
  if found then
    update public.themes
       set installs = legacy_installs + (select count(*) from public.theme_installs where theme_id = p_theme)
     where id = p_theme;
  end if;
end;
$$;

-- -------------------------------------------------------------- RLS policies --
drop policy if exists themes_select on public.themes;
create policy themes_select on public.themes for select to authenticated
  using (status = 'published' or author_id = auth.uid() or public.is_staff());

drop policy if exists theme_versions_select on public.theme_versions;
create policy theme_versions_select on public.theme_versions for select to authenticated
  using (exists (select 1 from public.themes t where t.id = theme_id
                 and (t.status = 'published' or t.author_id = auth.uid() or public.is_staff())));

drop policy if exists theme_drafts_select on public.theme_drafts;
create policy theme_drafts_select on public.theme_drafts for select to authenticated
  using (exists (select 1 from public.themes t where t.id = theme_id and t.author_id = auth.uid()));

drop policy if exists theme_installs_select on public.theme_installs;
create policy theme_installs_select on public.theme_installs for select to authenticated
  using (user_id = auth.uid());

-- ------------------------------------------------------------------- grants --
-- Reads only: every write goes through the functions above.
revoke all on public.theme_versions, public.theme_drafts, public.theme_installs from anon, authenticated;
grant select on public.theme_versions, public.theme_drafts, public.theme_installs to authenticated;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.theme_save(uuid, text, text, text, jsonb, text)',
    'public.theme_publish(uuid, text)',
    'public.theme_rollback(uuid, integer)',
    'public.theme_set_status(uuid, text, text)',
    'public.install_theme(uuid)',
    'public.uninstall_theme(uuid)',
    'public.theme_categories()'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
  foreach fn in array array['public.guard_theme_insert()', 'public.theme_first_version()'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
  end loop;
end $$;

notify pgrst, 'reload schema';
