-- =============================================================================
-- Connections on profiles (20261107130000)
--
-- Linked accounts (Settings → Connections) now show in a "Connections"
-- section on your profile, to the people who can already see your profile —
-- unless you hide that account (the eye button next to it in Settings).
-- Others only ever get the service, the account's name and its public profile
-- handle — never avatars, tokens or other metadata.
--
-- Safe to run more than once.
-- =============================================================================
alter table public.connections add column if not exists show_on_profile boolean not null default true;

-- Settings → Connections also needs the new flag (return type changes, so drop first)
drop function if exists public.my_connections();
create function public.my_connections()
returns table (provider text, external_id text, display_name text, avatar_url text,
               metadata jsonb, created_at timestamptz, show_on_profile boolean)
language sql stable security definer set search_path = '' as $$
  select c.provider, c.external_id, c.display_name, c.avatar_url, c.metadata, c.created_at, c.show_on_profile
  from public.connections c
  where c.user_id = auth.uid()
  order by c.created_at desc;
$$;

create or replace function public.set_connection_visibility(p_provider text, p_external_id text, p_show boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update public.connections set show_on_profile = coalesce(p_show, true), updated_at = now()
  where user_id = auth.uid() and provider = p_provider and external_id = p_external_id;
end;
$$;

-- What a profile shows: only accounts the owner left visible, only to people
-- who can see that profile, never across a block.
create or replace function public.profile_connections(p_user uuid)
returns table (provider text, external_id text, display_name text, handle text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.provider, c.external_id, c.display_name, left(c.metadata ->> 'handle', 80), c.created_at
  from public.connections c
  where c.user_id = p_user
    and c.show_on_profile
    and auth.uid() is not null
    and (p_user = auth.uid()
         or (public.can_see_profile(p_user, auth.uid()) and not public.is_blocked_between(p_user, auth.uid())))
  order by c.created_at asc
  limit 20;
$$;

revoke execute on function public.my_connections(), public.set_connection_visibility(text, text, boolean),
  public.profile_connections(uuid) from public, anon;
grant execute on function public.my_connections(), public.set_connection_visibility(text, text, boolean),
  public.profile_connections(uuid) to authenticated;

notify pgrst, 'reload schema';
