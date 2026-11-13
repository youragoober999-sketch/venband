-- Only the server can look up an address after Google has verified it.
create or replace function public.google_email_account(p_email text)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case when email_confirmed_at is null then 'unconfirmed' else 'confirmed' end
    from auth.users where email = p_email limit 1
  ), 'new');
$$;

revoke execute on function public.google_email_account(text) from public, anon, authenticated;
grant execute on function public.google_email_account(text) to service_role;
notify pgrst, 'reload schema';
