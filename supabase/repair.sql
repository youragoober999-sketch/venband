-- =============================================================================
-- Venband REPAIR script: safe to run any number of times.
-- Re-applies all API permissions and the profile self-heal functions, then
-- prints a checklist. Paste into Supabase → SQL Editor → Run.
-- (Requires the main schema: supabase/migrations/20260928000000_venband_schema.sql)
-- =============================================================================

-- anon (not signed in) gets nothing except the username check on signup.
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant usage on schema public to anon, authenticated;
grant execute on function public.username_available(text) to anon, authenticated;

-- ------------------------------------------------------------- tables ----
grant select                         on public.profiles            to authenticated;
grant update (display_name, avatar_color, about)
                                     on public.profiles            to authenticated;

grant select, insert                 on public.user_keys           to authenticated;
grant select, insert, update         on public.user_private_keys   to authenticated;

grant select, update, delete         on public.servers             to authenticated;

grant select, delete                 on public.server_members      to authenticated;
grant update (nickname)              on public.server_members      to authenticated;

grant select, insert, update, delete on public.roles               to authenticated;
grant select, insert, delete         on public.member_roles        to authenticated;

grant select, insert, delete         on public.channels            to authenticated;
grant update (name, topic, category, position, is_private)
                                     on public.channels            to authenticated;

grant select, insert, delete         on public.channel_role_access to authenticated;
grant select                         on public.dm_participants     to authenticated;
grant select, delete                 on public.invites             to authenticated;
grant select, insert, delete         on public.bans                to authenticated;
grant select, insert                 on public.channel_epochs      to authenticated;
grant select, insert                 on public.channel_keys        to authenticated;

grant select, insert, delete         on public.messages            to authenticated;
grant update (epoch, iv, ciphertext, signature, author_key_id)
                                     on public.messages            to authenticated;

-- service_role (dashboard / admin scripts) keeps full access
grant all on all tables in schema public to service_role;

-- ---------------------------------------------------------- functions ----
grant execute on function
  public.is_server_member(uuid, uuid),
  public.server_permissions(uuid, uuid),
  public.has_permission(uuid, bigint, uuid),
  public.member_top_position(uuid, uuid),
  public.can_view_channel(uuid, uuid),
  public.channel_has_permission(uuid, bigint, uuid),
  public.shares_server_or_dm(uuid, uuid),
  public.create_server(text, text),
  public.create_invite(uuid, integer, integer),
  public.join_server(text),
  public.open_dm(uuid),
  public.find_user(text),
  public.channel_key_recipients(uuid),
  public.channel_missing_keys(uuid),
  public.realtime_topic_allowed(text),
  public.storage_channel_allowed(text)
to authenticated;

create or replace function public.unique_username(p_base text)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_base text := left(regexp_replace(lower(coalesce(p_base, '')), '[^a-z0-9_.]', '', 'g'), 26);
  v_name text;
  i integer := 1;
begin
  if char_length(v_base) < 2 then v_base := 'user'; end if;
  v_name := v_base;
  while exists (select 1 from public.profiles where username = v_name) loop
    i := i + 1;
    v_name := v_base || i::text;
  end loop;
  return v_name;
end;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_wanted   text := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  v_username text;
  v_display  text;
begin
  if v_wanted ~ '^[a-z0-9_.]{2,32}$' and not exists (select 1 from public.profiles where username = v_wanted) then
    v_username := v_wanted;
  else
    v_username := public.unique_username(coalesce(nullif(v_wanted, ''), split_part(coalesce(new.email, ''), '@', 1)));
  end if;
  v_display := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), v_username);
  insert into public.profiles (id, username, display_name, avatar_color)
  values (new.id, v_username, left(v_display, 32),
          (array['#e0795b','#6aa2d8','#8fbf6a','#d8a14a','#b88ad8','#d86a8f','#5fb8a8','#c9b458'])
            [1 + floor(random() * 8)::int])
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.my_profile()
returns public.profiles language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_row  public.profiles;
  v_meta jsonb;
  v_mail text;
  v_name text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into v_row from public.profiles where id = v_uid;
  if found then return v_row; end if;

  select raw_user_meta_data, email into v_meta, v_mail from auth.users where id = v_uid;
  v_name := public.unique_username(coalesce(nullif(v_meta ->> 'username', ''), split_part(coalesce(v_mail, ''), '@', 1)));
  insert into public.profiles (id, username, display_name)
  values (v_uid, v_name, left(coalesce(nullif(btrim(v_meta ->> 'display_name'), ''), v_name), 32))
  returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function public.unique_username(text) from anon, public, authenticated;
revoke execute on function public.my_profile() from anon, public;
grant execute on function public.my_profile() to authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;

-- ------------------------------------------------------- group chats ----

alter table public.channels add column if not exists is_group boolean not null default false;

-- 1-on-1 DMs must never resolve to a group that happens to contain both people.
create or replace function public.open_dm(p_other uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_channel uuid;
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
  insert into public.channels (type, name) values ('dm', 'dm') returning id into v_channel;
  insert into public.dm_participants (channel_id, user_id) values (v_channel, v_uid), (v_channel, p_other);
  return v_channel;
end;
$$;

create or replace function public.create_group(p_members uuid[], p_name text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_members uuid[];
  v_channel uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select coalesce(array_agg(distinct m), '{}') into v_members
  from unnest(coalesce(p_members, '{}')) m
  where m <> v_uid and exists (select 1 from public.profiles p where p.id = m);
  if cardinality(v_members) < 1 then raise exception 'add at least one other person'; end if;
  if cardinality(v_members) > 9 then raise exception 'groups can have at most 10 people'; end if;
  insert into public.channels (type, name, is_group)
  values ('dm', left(coalesce(nullif(btrim(p_name), ''), 'Group chat'), 100), true)
  returning id into v_channel;
  insert into public.dm_participants (channel_id, user_id)
  select v_channel, u from unnest(v_members || v_uid) u;
  return v_channel;
end;
$$;

create or replace function public.add_group_members(p_channel uuid, p_members uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.channels c where c.id = p_channel and c.is_group)
     or not exists (select 1 from public.dm_participants d where d.channel_id = p_channel and d.user_id = v_uid) then
    raise exception 'not a member of this group';
  end if;
  insert into public.dm_participants (channel_id, user_id)
  select p_channel, m from unnest(coalesce(p_members, '{}')) m
  where exists (select 1 from public.profiles p where p.id = m)
  on conflict do nothing;
  if (select count(*) from public.dm_participants where channel_id = p_channel) > 10 then
    raise exception 'groups can have at most 10 people';
  end if;
end;
$$;

create or replace function public.leave_group(p_channel uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.channels c where c.id = p_channel and c.is_group) then
    raise exception 'not a group';
  end if;
  delete from public.dm_participants where channel_id = p_channel and user_id = auth.uid();
  if not exists (select 1 from public.dm_participants where channel_id = p_channel) then
    delete from public.channels where id = p_channel;
  end if;
end;
$$;

create or replace function public.rename_group(p_channel uuid, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if char_length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'name required'; end if;
  if not exists (select 1 from public.dm_participants d where d.channel_id = p_channel and d.user_id = auth.uid())
     or not exists (select 1 from public.channels c where c.id = p_channel and c.is_group) then
    raise exception 'not a member of this group';
  end if;
  update public.channels set name = left(btrim(p_name), 100) where id = p_channel;
end;
$$;

-- Someone left a group → new key before the next message (they can't read what follows).
create or replace function public.flag_dm_rotation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.channels set key_rotation_needed = true where id = old.channel_id;
  return old;
end;
$$;
drop trigger if exists dm_participants_rotation on public.dm_participants;
create trigger dm_participants_rotation after delete on public.dm_participants
  for each row execute function public.flag_dm_rotation();

revoke execute on function
  public.create_group(uuid[], text), public.add_group_members(uuid, uuid[]),
  public.leave_group(uuid), public.rename_group(uuid, text), public.flag_dm_rotation()
from anon, public;
grant execute on function
  public.open_dm(uuid), public.create_group(uuid[], text), public.add_group_members(uuid, uuid[]),
  public.leave_group(uuid), public.rename_group(uuid, text)
to authenticated;
grant select on public.dm_participants to authenticated;

-- ------------------------------------------------------------ checklist ----
-- Every row should say "ok". Screenshot this table if something says MISSING.
select item, case when ok then 'ok' else 'MISSING' end as status
from (values
  ('read profiles',            has_table_privilege('authenticated', 'public.profiles', 'select')),
  ('read public keys',         has_table_privilege('authenticated', 'public.user_keys', 'select')),
  ('save public key',          has_table_privilege('authenticated', 'public.user_keys', 'insert')),
  ('read private key',         has_table_privilege('authenticated', 'public.user_private_keys', 'select')),
  ('save private key',         has_table_privilege('authenticated', 'public.user_private_keys', 'insert')),
  ('read servers',             has_table_privilege('authenticated', 'public.servers', 'select')),
  ('read channels',            has_table_privilege('authenticated', 'public.channels', 'select')),
  ('send messages',            has_table_privilege('authenticated', 'public.messages', 'insert')),
  ('channel keys',             has_table_privilege('authenticated', 'public.channel_keys', 'insert')),
  ('key epochs',               has_table_privilege('authenticated', 'public.channel_epochs', 'insert')),
  ('function my_profile',      has_function_privilege('authenticated', 'public.my_profile()', 'execute')),
  ('function create_server',   has_function_privilege('authenticated', 'public.create_server(text,text)', 'execute')),
  ('function open_dm',         has_function_privilege('authenticated', 'public.open_dm(uuid)', 'execute')),
  ('function create_group',    has_function_privilege('authenticated', 'public.create_group(uuid[],text)', 'execute')),
  ('function realtime access', has_function_privilege('authenticated', 'public.realtime_topic_allowed(text)', 'execute')),
  ('signup username check',    has_function_privilege('anon', 'public.username_available(text)', 'execute')),
  ('schema usage',             has_schema_privilege('authenticated', 'public', 'usage'))
) as t(item, ok);
