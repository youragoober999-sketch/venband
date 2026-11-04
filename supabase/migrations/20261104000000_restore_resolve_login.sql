-- =============================================================================
-- Restore resolve_login() (20261104000000)
--
-- Fixes: "Could not find the function public.resolve_login(p_identifier) in
-- the schema cache". Self-contained and safe to run more than once, so it also
-- works on a database where earlier migrations were skipped or half-applied.
--
-- Also fixes two bugs in the previous version:
--   * usernames typed with capitals ("Alice") never resolved
--   * an account unbanned in Supabase Auth (banned_until in the past) was
--     still reported as banned
-- =============================================================================

-- column the ban check reads (added by 20261002000000_platform.sql)
alter table public.profiles
  add column if not exists account_status text not null default 'active';

-- per-IP throttle log; RLS on with no policies = only this function touches it
create table if not exists public.login_lookups (
  id              bigserial primary key,
  ip              text not null default '',
  identifier_hash text not null default '',
  attempted_at    timestamptz not null default now()
);
create index if not exists login_lookups_ip_time_idx on public.login_lookups (ip, attempted_at desc);
create index if not exists login_lookups_time_idx on public.login_lookups (attempted_at);
alter table public.login_lookups enable row level security;

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

  -- best-effort client IP, used only to throttle lookups
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

  return query
    select u.email::text,
           p.username::text,
           ((u.banned_until is not null and u.banned_until > now()) or p.account_status = 'banned') as banned
      from auth.users u
      join public.profiles p on p.id = u.id
     where (position('@' in v_identifier) = 0 and v_identifier ~ '^[a-z0-9_.]{2,32}$' and p.username = v_identifier)
        or (position('@' in v_identifier) > 0 and lower(u.email) = v_identifier)
     limit 1;
end;
$$;

revoke execute on function public.resolve_login(text) from public;
grant execute on function public.resolve_login(text) to anon, authenticated;

-- make the API see the new function immediately (fixes the "schema cache" error)
notify pgrst, 'reload schema';
