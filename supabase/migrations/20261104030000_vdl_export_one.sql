-- =============================================================================
-- VDL: export ONE account by email (20261104030000)
--
-- Used for "just-in-time" import: the first time someone signs in to the VDL
-- storage console, their account is pulled from Supabase on the spot, so owners
-- can get in before the first full sync has run. service_role only.
-- Safe to run more than once.
-- =============================================================================

drop function if exists public.vdl_export_account(text);
create function public.vdl_export_account(p_email text)
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
    where lower(u.email) = lower(btrim(p_email))
    limit 1;
end;
$$;

revoke execute on function public.vdl_export_account(text) from public, anon, authenticated;
grant execute on function public.vdl_export_account(text) to service_role;

notify pgrst, 'reload schema';
