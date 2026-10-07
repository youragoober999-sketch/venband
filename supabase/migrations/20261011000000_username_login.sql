-- Let people sign in with their username instead of typing their email.
-- The look-up is security definer so it can read auth.users, and only ever
-- resolves a syntactically-valid username (never an email).

create or replace function public.resolve_login(p_identifier text)
returns table (email text)
language sql
security definer
stable
set search_path = ''
as $$
  select u.email
  from auth.users u
  join public.profiles p on p.id = u.id
  where p.username = lower(btrim(p_identifier))
    and p_identifier ~ '^[a-z0-9_.]{2,32}$'
$$;

grant execute on function public.resolve_login(text) to anon, authenticated;