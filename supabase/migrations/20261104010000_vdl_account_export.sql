-- =============================================================================
-- VDL account export (20261104010000)
--
-- Lets the VDL backend pull every account (auth user + profile) so accounts
-- keep the SAME user id, email, username and password in VDL.
--
-- * service_role ONLY: never callable from the browser (anon/authenticated).
-- * keyset-paginated by id so it works for any number of accounts.
-- * profile comes back as jsonb, so it works even if some profile columns
--   were never migrated on this database.
-- * encrypted_password is the bcrypt hash Supabase Auth already stores; the
--   plaintext password is never available (and Venband only ever sends a
--   key derived on the user's device anyway).
--
-- Safe to run more than once.
-- =============================================================================

drop function if exists public.vdl_export_accounts(uuid, integer);
create function public.vdl_export_accounts(p_after uuid default null, p_limit integer default 500)
returns table (id uuid, auth jsonb, profile jsonb, mfa_enabled boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
    select
      u.id,
      jsonb_build_object(
        'email',              u.email,
        'phone',              u.phone,
        'encrypted_password', u.encrypted_password,
        'email_confirmed_at', u.email_confirmed_at,
        'last_sign_in_at',    u.last_sign_in_at,
        'banned_until',       u.banned_until,
        'created_at',         u.created_at,
        'updated_at',         u.updated_at,
        'is_anonymous',       coalesce((to_jsonb(u) ->> 'is_anonymous')::boolean, false),
        'providers',          coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb),
        'deleted_at',         to_jsonb(u) -> 'deleted_at'
      ),
      to_jsonb(p) - 'id',
      exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified')
    from auth.users u
    left join public.profiles p on p.id = u.id
    where p_after is null or u.id > p_after
    order by u.id
    limit greatest(1, least(coalesce(p_limit, 500), 1000));
end;
$$;

revoke execute on function public.vdl_export_accounts(uuid, integer) from public, anon, authenticated;
grant execute on function public.vdl_export_accounts(uuid, integer) to service_role;

-- quick count so the console can show progress
create or replace function public.vdl_export_count()
returns bigint language sql stable security definer set search_path = '' as $$
  select count(*) from auth.users;
$$;
revoke execute on function public.vdl_export_count() from public, anon, authenticated;
grant execute on function public.vdl_export_count() to service_role;

notify pgrst, 'reload schema';
