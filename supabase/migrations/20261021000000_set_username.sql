-- Change your username anytime. Same rules as signup: 2-32 lowercase letters,
-- numbers, dots and underscores, and it must not already be taken (that covers
-- the official staff accounts too).
create or replace function public.set_username(p_username text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v text := lower(btrim(coalesce(p_username, '')));
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.username_available(v) then
    raise exception 'that username is taken or invalid';
  end if;
  update public.profiles set username = v where id = auth.uid();
  if not found then raise exception 'profile not found'; end if;
end;
$$;

revoke execute on function public.set_username(text) from public, anon;
grant execute on function public.set_username(text) to authenticated;