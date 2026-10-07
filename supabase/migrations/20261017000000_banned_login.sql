-- =============================================================================
-- Banned login: resolve_login() now also reports the matching account's
-- username and whether it is banned, so the sign-in form can show
-- "You are banned on @username" instead of a generic password error.
-- It still only resolves an existing account — never reveals who has an
-- account unless the typed identifier matches one.
-- =============================================================================

create or replace function public.resolve_login(p_identifier text)
returns table (email text, username text, banned boolean)
language sql
security definer
stable
set search_path = ''
as $$
  select u.email, p.username,
         (u.banned_until is not null or p.account_status = 'banned') as banned
  from auth.users u
  join public.profiles p on p.id = u.id
  where (p.username = lower(btrim(p_identifier)) and p_identifier ~ '^[a-z0-9_.]{2,32}$')
     or (lower(u.email) = lower(btrim(p_identifier)) and position('@' in p_identifier) > 0)
$$;

grant execute on function public.resolve_login(text) to anon, authenticated;