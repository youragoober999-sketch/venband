-- =============================================================================
-- Shareable server templates (20261106110000)
--
-- A template is a snapshot of a server's STRUCTURE — roles (names, colours,
-- permissions, icons), categories, channels (types, topics, privacy, settings)
-- and role-based permission overrides. Never messages, members or files.
-- Share the link (venband.com/template/CODE); anyone can preview it and build a
-- new server from it. "Sync" refreshes the snapshot from the server.
--
-- Safe to run more than once.
-- =============================================================================

create table if not exists public.server_templates (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Za-z0-9]{8,16}$'),
  server_id   uuid references public.servers (id) on delete set null,
  author_id   uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 2 and 60),
  description text not null default '' check (char_length(description) <= 300),
  public      boolean not null default false,
  snapshot    jsonb not null check (pg_column_size(snapshot) < 262144),
  uses        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists server_templates_server_idx on public.server_templates (server_id);
create index if not exists server_templates_public_idx on public.server_templates (public, uses desc) where public;
alter table public.server_templates enable row level security;
drop policy if exists server_templates_select on public.server_templates;
create policy server_templates_select on public.server_templates for select to authenticated
  using (author_id = auth.uid() or public or (server_id is not null and public.has_permission(server_id, 2)));
drop policy if exists server_templates_delete on public.server_templates;
create policy server_templates_delete on public.server_templates for delete to authenticated
  using (author_id = auth.uid() or (server_id is not null and public.has_permission(server_id, 2)));
revoke insert, update on public.server_templates from authenticated, anon;
grant select, delete on public.server_templates to authenticated;

-- ------------------------------------------------------------- snapshot --
create or replace function public.server_snapshot(p_server uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'v', 1,
    'everyone', (select r.permissions from public.roles r where r.server_id = p_server and r.is_default limit 1),
    'roles', coalesce((select jsonb_agg(jsonb_build_object(
        'key', r.id, 'name', r.name, 'color', r.color, 'color2', r.color2, 'permissions', r.permissions,
        'position', r.position, 'hoist', r.hoist, 'icon', r.icon, 'description', r.description, 'mentionable', r.mentionable)
        order by r.position)
      from public.roles r where r.server_id = p_server and not r.is_default), '[]'::jsonb),
    'categories', to_jsonb(coalesce(s.categories, '{}'::text[])),
    'channels', coalesce((select jsonb_agg(jsonb_build_object(
        'key', c.id, 'name', c.name, 'type', c.type, 'topic', c.topic, 'category', c.category, 'position', c.position,
        'is_private', c.is_private, 'settings', c.settings, 'color', c.color,
        'access', coalesce((select jsonb_agg(a.role_id) from public.channel_role_access a where a.channel_id = c.id), '[]'::jsonb))
        order by c.position)
      from public.channels c where c.server_id = p_server), '[]'::jsonb),
    -- role overrides only (member overrides are about people, not structure)
    'overwrites', coalesce((select jsonb_agg(jsonb_build_object(
        'channel', o.channel_id, 'category', o.category,
        'role', case when r.is_default then 'everyone' else o.target_id::text end, 'allow', o.allow, 'deny', o.deny))
      from public.channel_overwrites o join public.roles r on r.id = o.target_id
      where o.server_id = p_server and o.target_type = 'role'), '[]'::jsonb),
    'welcome', s.welcome_channel_id,
    'rules', to_jsonb(coalesce(s.rules, '{}'::text[])),
    'description', s.description)
  from public.servers s where s.id = p_server;
$$;

create or replace function public.create_template(p_server uuid, p_name text, p_description text default '', p_public boolean default false)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.has_permission(p_server, 2) then raise exception 'you need Manage Server to make a template'; end if;
  if (select count(*) from public.server_templates where author_id = auth.uid()) >= 20 then
    raise exception 'you can have up to 20 templates';
  end if;
  loop
    v_code := translate(encode(extensions.gen_random_bytes(9), 'base64'), '+/=', 'xyz');
    v_code := left(regexp_replace(v_code, '[^A-Za-z0-9]', '', 'g'), 10);
    exit when char_length(v_code) = 10 and not exists (select 1 from public.server_templates where code = v_code);
  end loop;
  insert into public.server_templates (code, server_id, author_id, name, description, public, snapshot)
  values (v_code, p_server, auth.uid(), btrim(p_name), btrim(coalesce(p_description, '')), coalesce(p_public, false), public.server_snapshot(p_server));
  return v_code;
end;
$$;

-- refresh the snapshot from the server it came from
create or replace function public.sync_template(p_template uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  t public.server_templates%rowtype;
begin
  select * into t from public.server_templates where id = p_template;
  if not found then raise exception 'not found'; end if;
  if t.server_id is null then raise exception 'the server this template came from is gone'; end if;
  if not public.has_permission(t.server_id, 2) then raise exception 'you need Manage Server'; end if;
  update public.server_templates set snapshot = public.server_snapshot(t.server_id), updated_at = now() where id = p_template;
end;
$$;

-- what a template link shows before you use it
create or replace function public.template_preview(p_code text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'code', t.code, 'name', t.name, 'description', t.description, 'uses', t.uses, 'updated_at', t.updated_at,
    'author', (select p.username from public.profiles p where p.id = t.author_id),
    'roles', (select coalesce(jsonb_agg(jsonb_build_object('name', r ->> 'name', 'color', r ->> 'color')), '[]'::jsonb)
                from jsonb_array_elements(t.snapshot -> 'roles') r),
    'channels', (select coalesce(jsonb_agg(jsonb_build_object('name', c ->> 'name', 'type', c ->> 'type', 'category', c ->> 'category')
                                 order by (c ->> 'position')::int), '[]'::jsonb)
                   from jsonb_array_elements(t.snapshot -> 'channels') c))
  from public.server_templates t
  where t.code = p_code and auth.uid() is not null;
$$;

create or replace function public.template_gallery(p_query text default '')
returns table (code text, name text, description text, uses integer, author text, channels integer, roles integer)
language sql stable security definer set search_path = '' as $$
  select t.code, t.name, t.description, t.uses, p.username,
         jsonb_array_length(t.snapshot -> 'channels'), jsonb_array_length(t.snapshot -> 'roles')
  from public.server_templates t join public.profiles p on p.id = t.author_id
  where t.public and auth.uid() is not null
    and (coalesce(btrim(p_query), '') = '' or t.name ilike '%' || btrim(p_query) || '%' or t.description ilike '%' || btrim(p_query) || '%')
  order by t.uses desc, t.updated_at desc
  limit 60;
$$;

-- ------------------------------------------------- build a server from one --
create or replace function public.create_server_from_template(p_code text, p_name text, p_icon_color text default '#7c5cff')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  t public.server_templates%rowtype;
  v_server uuid;
  v_everyone uuid;
  v_roles jsonb := '{}'::jsonb;    -- old role id -> new role id
  v_chans jsonb := '{}'::jsonb;    -- old channel id -> new channel id
  v_id uuid;
  r jsonb;
  c jsonb;
  o jsonb;
  a jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public.account_can('create') then raise exception 'your account can''t create servers right now'; end if;
  if (select count(*) from public.servers where owner_id = v_uid) >= 100 then raise exception 'server limit reached'; end if;
  select * into t from public.server_templates where code = p_code;
  if not found then raise exception 'that template doesn''t exist (any more)'; end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'give your server a name'; end if;

  insert into public.servers (name, owner_id, icon_color, categories, rules, description)
  values (left(btrim(p_name), 100), v_uid, coalesce(p_icon_color, '#7c5cff'),
          coalesce(array(select jsonb_array_elements_text(t.snapshot -> 'categories')), '{}'),
          coalesce(array(select jsonb_array_elements_text(t.snapshot -> 'rules')), '{}'),
          left(coalesce(t.snapshot ->> 'description', ''), 500))
  returning id into v_server;
  insert into public.server_members (server_id, user_id) values (v_server, v_uid);
  insert into public.roles (server_id, name, color, permissions, position, is_default)
  values (v_server, '@everyone', '#99aab5', coalesce((t.snapshot ->> 'everyone')::bigint, 0), 0, true)
  returning id into v_everyone;

  for r in select * from jsonb_array_elements(t.snapshot -> 'roles') loop
    insert into public.roles (server_id, name, color, color2, permissions, position, hoist, icon, description, mentionable)
    values (v_server, left(r ->> 'name', 100), coalesce(r ->> 'color', '#99aab5'), r ->> 'color2',
            coalesce((r ->> 'permissions')::bigint, 0), coalesce((r ->> 'position')::int, 1),
            coalesce((r ->> 'hoist')::boolean, false), r ->> 'icon', coalesce(r ->> 'description', ''),
            coalesce((r ->> 'mentionable')::boolean, true))
    returning id into v_id;
    v_roles := v_roles || jsonb_build_object(r ->> 'key', v_id);
  end loop;
  v_roles := v_roles || jsonb_build_object('everyone', v_everyone);

  for c in select * from jsonb_array_elements(t.snapshot -> 'channels') loop
    insert into public.channels (server_id, type, name, topic, category, position, is_private, settings, color)
    values (v_server, c ->> 'type', c ->> 'name', coalesce(c ->> 'topic', ''), coalesce(c ->> 'category', ''),
            coalesce((c ->> 'position')::int, 0), coalesce((c ->> 'is_private')::boolean, false),
            coalesce(c -> 'settings', '{}'::jsonb), c ->> 'color')
    returning id into v_id;
    v_chans := v_chans || jsonb_build_object(c ->> 'key', v_id);
    for a in select * from jsonb_array_elements(coalesce(c -> 'access', '[]'::jsonb)) loop
      if v_roles ? (a #>> '{}') then
        insert into public.channel_role_access (channel_id, role_id) values (v_id, (v_roles ->> (a #>> '{}'))::uuid) on conflict do nothing;
      end if;
    end loop;
  end loop;

  for o in select * from jsonb_array_elements(coalesce(t.snapshot -> 'overwrites', '[]'::jsonb)) loop
    if not (v_roles ? (o ->> 'role')) then continue; end if;
    if o ->> 'channel' is not null and not (v_chans ? (o ->> 'channel')) then continue; end if;
    insert into public.channel_overwrites (server_id, channel_id, category, target_type, target_id, allow, deny)
    values (v_server, (v_chans ->> (o ->> 'channel'))::uuid, case when o ->> 'channel' is null then o ->> 'category' end,
            'role', (v_roles ->> (o ->> 'role'))::uuid, coalesce((o ->> 'allow')::bigint, 0), coalesce((o ->> 'deny')::bigint, 0));
  end loop;

  if t.snapshot ->> 'welcome' is not null and v_chans ? (t.snapshot ->> 'welcome') then
    perform set_config('venband.mod', 'on', true);
    update public.servers set welcome_channel_id = (v_chans ->> (t.snapshot ->> 'welcome'))::uuid where id = v_server;
    perform set_config('venband.mod', 'off', true);
  end if;
  update public.server_templates set uses = uses + 1 where id = t.id;
  return v_server;
end;
$$;

revoke execute on function public.server_snapshot(uuid) from public, anon, authenticated;
revoke execute on function public.create_template(uuid, text, text, boolean) from public, anon;
grant execute on function public.create_template(uuid, text, text, boolean) to authenticated;
revoke execute on function public.sync_template(uuid) from public, anon;
grant execute on function public.sync_template(uuid) to authenticated;
revoke execute on function public.template_preview(text) from public, anon;
grant execute on function public.template_preview(text) to authenticated;
revoke execute on function public.template_gallery(text) from public, anon;
grant execute on function public.template_gallery(text) to authenticated;
revoke execute on function public.create_server_from_template(text, text, text) from public, anon;
grant execute on function public.create_server_from_template(text, text, text) to authenticated;

notify pgrst, 'reload schema';
