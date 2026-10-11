-- =============================================================================
-- Sign-up: blocked names, date of birth (13+), pronouns + bio, and a record of
-- which Terms / Privacy Policy version each person accepted.
--
--  * name_is_blocked(): the same check as src/lib/nameFilter.ts, applied to
--    usernames, display names, server nicknames and server / group names.
--  * user_private_info: date of birth + terms acceptance. Only you can read
--    yours; nobody (staff included) sees your birthday.
-- Safe to run more than once.
-- =============================================================================

-- ---------------------------------------------------------- name filter ----

create or replace function public.name_skeleton(p_name text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(
    translate(
      lower(regexp_replace(normalize(coalesce(p_name, ''), NFKD), '[̀-ͯ]', '', 'g')),
      '01!|34@5$7896аеіїосркухѕԁɡɢոսαειοκνυτ',
      'oiiieaasstbggaeiiocpkyxsdggnuaeiokvut'),
    '[^a-z]', '', 'g');
$$;

create or replace function public.name_is_blocked(p_name text)
returns boolean language sql immutable set search_path = '' as $$
  select s ~ 'n+[iy]+g{2,}(a+|e+r+|u+h+)'
      or s ~ 'f+a+g+o+t+'
      or s ~ 'c+u+n+t+'
      or s ~ 'c+u+c+k+'
  from (select replace(replace(public.name_skeleton(p_name), 'scunthorpe', ''), 'cuckoo', '') as s) x;
$$;
grant execute on function public.name_skeleton(text), public.name_is_blocked(text) to anon, authenticated;

create or replace function public.username_available(p_username text)
returns boolean language sql stable security definer set search_path = '' as $$
  select lower(p_username) ~ '^[a-z0-9_.]{2,32}$'
     and not public.name_is_blocked(p_username)
     and not exists (select 1 from public.profiles where username = lower(p_username));
$$;
grant execute on function public.username_available(text) to anon, authenticated;

create or replace function public.set_username(p_username text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v text := lower(btrim(coalesce(p_username, '')));
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if public.name_is_blocked(v) then raise exception 'that username is not allowed, try again'; end if;
  if not public.username_available(v) then
    raise exception 'that username is taken or invalid';
  end if;
  update public.profiles set username = v where id = auth.uid();
  if not found then raise exception 'profile not found'; end if;
end;
$$;

-- Usernames and display names, however they're changed.
create or replace function public.guard_profile_names()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (tg_op = 'INSERT' or new.username is distinct from old.username) and public.name_is_blocked(new.username) then
    raise exception 'that username is not allowed, try again';
  end if;
  if (tg_op = 'INSERT' or new.display_name is distinct from old.display_name) and public.name_is_blocked(new.display_name) then
    raise exception 'that name is not allowed, try again';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_names_guard on public.profiles;
create trigger profiles_names_guard before insert or update of username, display_name on public.profiles
  for each row execute function public.guard_profile_names();

create or replace function public.guard_member_nickname()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.nickname is distinct from old.nickname and public.name_is_blocked(new.nickname) then
    raise exception 'that name is not allowed, try again';
  end if;
  return new;
end;
$$;
drop trigger if exists server_members_nickname_guard on public.server_members;
create trigger server_members_nickname_guard before update of nickname on public.server_members
  for each row execute function public.guard_member_nickname();

create or replace function public.guard_named_thing()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (tg_op = 'INSERT' or new.name is distinct from old.name) and public.name_is_blocked(new.name) then
    raise exception 'that name is not allowed, try again';
  end if;
  return new;
end;
$$;
drop trigger if exists servers_name_guard on public.servers;
create trigger servers_name_guard before insert or update of name on public.servers
  for each row execute function public.guard_named_thing();
drop trigger if exists channels_name_guard on public.channels;
create trigger channels_name_guard before insert or update of name on public.channels
  for each row execute function public.guard_named_thing();

-- ------------------------------------------------- private sign-up info ----

create table if not exists public.user_private_info (
  user_id           uuid primary key references public.profiles (id) on delete cascade,
  birth_date        date check (birth_date is null or birth_date between date '1900-01-01' and current_date),
  terms_version     text,
  terms_accepted_at timestamptz,
  updated_at        timestamptz not null default now()
);
alter table public.user_private_info enable row level security;
revoke all on public.user_private_info from anon, authenticated;
grant select on public.user_private_info to authenticated;
drop policy if exists user_private_info_own on public.user_private_info;
create policy user_private_info_own on public.user_private_info for select to authenticated using (user_id = auth.uid());

-- The Terms / Privacy Policy version the app currently asks people to accept.
create or replace function public.current_terms_version()
returns text language sql immutable as $$ select '2026-10-11'::text $$;
grant execute on function public.current_terms_version() to anon, authenticated;

create or replace function public.is_old_enough(p_birth date)
returns boolean language sql stable set search_path = '' as $$
  select p_birth is not null and p_birth <= (current_date - interval '13 years')::date;
$$;

-- What the app needs to know: have you accepted the current terms, and do we
-- have your date of birth (to confirm you're 13 or older).
create or replace function public.my_legal_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'terms_version', i.terms_version,
    'current', public.current_terms_version(),
    'needs_terms', coalesce(i.terms_version, '') <> public.current_terms_version(),
    'needs_birth_date', i.birth_date is null)
  from (select auth.uid() as uid) me
  left join public.user_private_info i on i.user_id = me.uid;
$$;

-- Accept the current terms (and give your date of birth if we don't have it).
create or replace function public.accept_terms(p_version text, p_birth_date date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_birth date;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_version is distinct from public.current_terms_version() then
    raise exception 'please reload: the terms were updated';
  end if;
  select birth_date into v_birth from public.user_private_info where user_id = auth.uid();
  v_birth := coalesce(v_birth, p_birth_date);
  if v_birth is null then raise exception 'enter your date of birth'; end if;
  if not public.is_old_enough(v_birth) then
    raise exception 'you must be at least 13 years old to use Venband';
  end if;
  insert into public.user_private_info (user_id, birth_date, terms_version, terms_accepted_at, updated_at)
  values (auth.uid(), v_birth, p_version, now(), now())
  on conflict (user_id) do update
    set birth_date = coalesce(public.user_private_info.birth_date, excluded.birth_date),
        terms_version = excluded.terms_version,
        terms_accepted_at = excluded.terms_accepted_at,
        updated_at = now();
end;
$$;
revoke execute on function public.my_legal_status(), public.accept_terms(text, date) from public, anon;
grant execute on function public.my_legal_status(), public.accept_terms(text, date) to authenticated;

-- New accounts: keep the username/display name clean, copy pronouns + bio onto
-- the profile, and record the date of birth + accepted terms from sign-up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_meta     jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_wanted   text := lower(coalesce(v_meta ->> 'username', ''));
  v_username text;
  v_display  text;
  v_birth    date;
begin
  begin
    v_birth := nullif(v_meta ->> 'birth_date', '')::date;
  exception when others then
    v_birth := null;
  end;
  if v_birth is not null and not public.is_old_enough(v_birth) then
    raise exception 'you must be at least 13 years old to use Venband';
  end if;
  if v_wanted ~ '^[a-z0-9_.]{2,32}$' and not public.name_is_blocked(v_wanted)
     and not exists (select 1 from public.profiles where username = v_wanted) then
    v_username := v_wanted;
  else
    v_username := public.unique_username(
      case when public.name_is_blocked(v_wanted) then 'user'
           else coalesce(nullif(v_wanted, ''), split_part(coalesce(new.email, ''), '@', 1)) end);
    if public.name_is_blocked(v_username) then v_username := public.unique_username('user'); end if;
  end if;
  v_display := coalesce(nullif(btrim(v_meta ->> 'display_name'), ''), v_username);
  if public.name_is_blocked(v_display) then v_display := v_username; end if;
  insert into public.profiles (id, username, display_name, avatar_color, pronouns, about)
  values (new.id, v_username, left(v_display, 32),
          (array['#e0795b','#6aa2d8','#8fbf6a','#d8a14a','#b88ad8','#d86a8f','#5fb8a8','#c9b458'])
            [1 + floor(random() * 8)::int],
          left(btrim(coalesce(v_meta ->> 'pronouns', '')), 40),
          left(coalesce(v_meta ->> 'about', ''), 190))
  on conflict (id) do nothing;
  if v_birth is not null or (v_meta ->> 'terms_version') is not null then
    insert into public.user_private_info (user_id, birth_date, terms_version, terms_accepted_at)
    values (new.id, v_birth, nullif(v_meta ->> 'terms_version', ''),
            case when nullif(v_meta ->> 'terms_version', '') is not null then now() end)
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

-- Friendlier errors when the sign-up hook is switched on (Authentication →
-- Hooks → "Before User Created"); the trigger above still enforces both.
create or replace function public.before_user_created(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ip   text := nullif(event -> 'metadata' ->> 'ip_address', '');
  v_meta jsonb := coalesce(event -> 'user' -> 'user_metadata', '{}'::jsonb);
  v_hash text;
  v_used integer;
  v_birth date;
begin
  if public.name_is_blocked(v_meta ->> 'username') or public.name_is_blocked(v_meta ->> 'display_name') then
    return jsonb_build_object('error', jsonb_build_object('http_code', 400, 'message', 'that username is not allowed, try again'));
  end if;
  begin
    v_birth := nullif(v_meta ->> 'birth_date', '')::date;
  exception when others then
    v_birth := null;
  end;
  if v_birth is not null and not public.is_old_enough(v_birth) then
    return jsonb_build_object('error', jsonb_build_object('http_code', 400, 'message', 'You must be at least 13 years old to use Venband.'));
  end if;
  if v_ip is null then return '{}'::jsonb; end if;
  if exists (select 1 from public.platform_bans b
             where b.kind = 'ip' and b.hash = public.voogle_hash('i|' || v_ip)
               and (b.expires_at is null or b.expires_at > now())) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'New accounts can''t be made from this network right now.'));
  end if;
  v_hash := encode(extensions.digest(
    (select value from public.platform_config where key = 'ip_pepper') || '|' || v_ip, 'sha256'), 'hex');
  select count(*) into v_used from public.signup_ips s
  where s.ip_hash = v_hash and (s.user_id is null or exists (select 1 from auth.users u where u.id = s.user_id));
  if v_used >= 6 then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'Too many accounts have been created from this network.'));
  end if;
  insert into public.signup_ips (ip_hash, user_id)
  values (v_hash, nullif(event -> 'user' ->> 'id', '')::uuid);
  return '{}'::jsonb;
end;
$$;
revoke execute on function public.before_user_created(jsonb) from public, anon, authenticated;
do $$ begin
  grant execute on function public.before_user_created(jsonb) to supabase_auth_admin;
exception when undefined_object then null;
end $$;

-- Generated usernames (profile self-repair, clashes) never land on a blocked name.
create or replace function public.unique_username(p_base text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_base text := left(regexp_replace(lower(coalesce(p_base, '')), '[^a-z0-9_.]', '', 'g'), 26);
  v_name text;
  i integer := 1;
begin
  if char_length(v_base) < 2 or public.name_is_blocked(v_base) then v_base := 'user'; end if;
  v_name := v_base;
  while exists (select 1 from public.profiles where username = v_name) loop
    i := i + 1;
    v_name := v_base || i::text;
  end loop;
  return v_name;
end;
$$;
