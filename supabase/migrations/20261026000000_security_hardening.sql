-- =============================================================================
-- Security hardening (20261026000000)
--
-- 1. user_keys: stop handing every signed-in user the whole table (account ->
--    public-key map). Keys stay readable to people who already share a server /
--    DM / friendship with the owner, plus anyone who can read a channel the
--    owner has posted in (they need the key to verify that user's messages).
-- 2. resolve_login: add per-IP rate limiting so the sign-in form cannot be used
--    to enumerate accounts / probe usernames at high volume.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- user_keys visibility
-- -----------------------------------------------------------------------------

-- True when p_user may read a channel that p_owner has posted in. SECURITY
-- DEFINER so the nested reads run as the owner and never recurse back through
-- the messages / user_keys policies.
create or replace function public.authored_visible_message(p_owner uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.messages m
    where m.author_id = p_owner
      and public.can_view_channel(m.channel_id, p_user)
  );
$$;
revoke execute on function public.authored_visible_message(uuid, uuid) from anon, public;
grant execute on function public.authored_visible_message(uuid, uuid) to authenticated;

-- Supports the lookup above (and history-by-author queries).
create index if not exists messages_author_idx on public.messages (author_id);

-- Public keys are only readable by someone who can already see the owner:
-- yourself, a contact you share a server/DM/friendship with, or a viewer of a
-- channel the owner posted in. Every live key-distribution recipient falls into
-- one of those buckets, so message sending / decryption keeps working.
drop policy if exists user_keys_select on public.user_keys;
create policy user_keys_select on public.user_keys for select to authenticated
  using (
    user_id = auth.uid()
    or public.can_see_profile(user_id)
    or public.authored_visible_message(user_id)
  );

-- -----------------------------------------------------------------------------
-- resolve_login rate limiting
-- -----------------------------------------------------------------------------

-- Attempt log for the sign-in lookup. RLS is on with no policies, so only the
-- SECURITY DEFINER resolve_login() body (owner role) can read or write it.
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
create or replace function public.resolve_login(p_identifier text)
returns table (email text, username text, banned boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_headers text;
  v_ip text := '';
  v_attempts integer;
  v_identifier text := lower(btrim(p_identifier));
begin
  -- Best-effort client IP, used only to throttle lookups.
  begin
    v_headers := current_setting('request.headers', true);
    if v_headers is not null and v_headers <> '' then
      v_ip := coalesce(
        nullif(split_part(coalesce(v_headers::json ->> 'x-forwarded-for', ''), ',', 1), ''),
        nullif(v_headers::json ->> 'cf-connecting-ip', ''),
        ''
      );
      v_ip := btrim(v_ip);
    end if;
  exception when others then
    v_ip := '';
  end;

  -- Only throttle when we actually know the caller's address.
  if v_ip <> '' then
    delete from public.login_lookups where attempted_at < now() - interval '1 day';
    select count(*) into v_attempts
    from public.login_lookups
    where ip = v_ip and attempted_at > now() - interval '10 minutes';
    if v_attempts >= 20 then
      raise exception 'Too many login attempts. Please wait a few minutes and try again.';
    end if;
    insert into public.login_lookups (ip, identifier_hash) values (v_ip, md5(coalesce(v_identifier, '')));
  end if;

  return query
    select u.email::text, p.username::text,
           (u.banned_until is not null or p.account_status = 'banned') as banned
    from auth.users u
    join public.profiles p on p.id = u.id
    where (p.username = v_identifier and p_identifier ~ '^[a-z0-9_.]{2,32}$')
       or (lower(u.email) = v_identifier and position('@' in p_identifier) > 0);
end;
$$;

grant execute on function public.resolve_login(text) to anon, authenticated;
