-- =============================================================================
-- Backfill missing profiles (20261105000000)
--
-- Accounts created while the database had no schema (or before the signup
-- trigger existed) have an auth.users row but no public.profiles row. They
-- couldn't sign in ("No account with that username or email") and couldn't
-- sign up again ("There's already an account with that email").
--
--   1. creates a profile for every auth user that lacks one, using the username
--      they picked at signup (or a safe unique one if it's taken/invalid)
--   2. resolve_login now finds an account by email even if its profile is
--      missing, so this can't lock anyone out again (my_profile() then
--      creates the profile on first sign-in)
--
-- Safe to run more than once.
-- =============================================================================

-- 1. backfill -------------------------------------------------------------------
do $$
declare
  r record;
  v_wanted text;
  v_name text;
  v_display text;
  v_count integer := 0;
begin
  for r in
    select u.id, u.email, u.raw_user_meta_data as meta
    from auth.users u
    where not exists (select 1 from public.profiles p where p.id = u.id)
    order by u.created_at nulls last
  loop
    v_wanted := lower(btrim(coalesce(r.meta ->> 'username', '')));
    if v_wanted ~ '^[a-z0-9_.]{2,32}$' and not exists (select 1 from public.profiles where username = v_wanted) then
      v_name := v_wanted;
    else
      v_name := public.unique_username(coalesce(nullif(v_wanted, ''), split_part(coalesce(r.email, ''), '@', 1)));
    end if;
    v_display := left(coalesce(nullif(btrim(r.meta ->> 'display_name'), ''), v_name), 32);
    insert into public.profiles (id, username, display_name)
    values (r.id, v_name, v_display)
    on conflict (id) do nothing;
    v_count := v_count + 1;
  end loop;
  raise notice 'created % missing profile(s)', v_count;
end $$;

-- 2. resolve_login: email lookups no longer require a profile --------------------
drop function if exists public.resolve_login(text);
create function public.resolve_login(p_identifier text)
returns table (email text, username text, banned boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_headers    text;
  v_ip         text := '';
  v_attempts   integer;
  v_identifier text := lower(btrim(coalesce(p_identifier, '')));
begin
  if v_identifier = '' then return; end if;

  begin
    v_headers := current_setting('request.headers', true);
    if v_headers is not null and v_headers <> '' then
      v_ip := btrim(coalesce(
        nullif(split_part(coalesce(v_headers::json ->> 'x-forwarded-for', ''), ',', 1), ''),
        nullif(v_headers::json ->> 'cf-connecting-ip', ''),
        ''
      ));
    end if;
  exception when others then
    v_ip := '';
  end;

  if v_ip <> '' then
    delete from public.login_lookups where attempted_at < now() - interval '1 day';
    select count(*) into v_attempts
      from public.login_lookups
     where ip = v_ip and attempted_at > now() - interval '10 minutes';
    if v_attempts >= 20 then
      raise exception 'Too many login attempts. Please wait a few minutes and try again.';
    end if;
    insert into public.login_lookups (ip, identifier_hash) values (v_ip, md5(v_identifier));
  end if;

  if position('@' in v_identifier) > 0 then
    return query
      select u.email::text,
             coalesce(p.username, split_part(u.email, '@', 1))::text,
             ((u.banned_until is not null and u.banned_until > now()) or coalesce(p.account_status, 'active') = 'banned')
        from auth.users u
        left join public.profiles p on p.id = u.id
       where lower(u.email) = v_identifier
       limit 1;
  elsif v_identifier ~ '^[a-z0-9_.]{2,32}$' then
    return query
      select u.email::text,
             p.username::text,
             ((u.banned_until is not null and u.banned_until > now()) or p.account_status = 'banned')
        from public.profiles p
        join auth.users u on u.id = p.id
       where p.username = v_identifier
       limit 1;
  end if;
end;
$$;

revoke execute on function public.resolve_login(text) from public;
grant execute on function public.resolve_login(text) to anon, authenticated;

notify pgrst, 'reload schema';
