-- =============================================================================
-- Connections: the outside accounts you linked to your Venband profile.
--   * One row per (user, provider, external id) — a user can link several
--     accounts of the same provider.
--   * Only the owner can read/write their rows, so OAuth tokens / handles are
--     safe to keep here. Nothing here is public yet.
--   * add_connection / remove_connection are the only writers (security definer).
--   * Providers that need a server-held OAuth secret (Spotify, Twitch,
--     YouTube…) are registered here and appear in Settings → Connections;
--     Steam links fully client-side via OpenID.
-- =============================================================================
create table if not exists public.connections (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  provider     text not null
               check (provider in ('steam', 'spotify', 'twitch', 'discord', 'github',
                                   'youtube', 'xbox', 'instagram', 'tiktok', 'epic')),
  external_id  text not null check (char_length(external_id) between 1 and 128),
  display_name text not null default '' check (char_length(display_name) <= 80),
  avatar_url   text check (avatar_url is null or char_length(avatar_url) <= 500),
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, provider, external_id)
);
create index connections_user_idx on public.connections (user_id, created_at desc);

alter table public.connections enable row level security;
-- Only you can see and edit the accounts you linked.
drop policy if exists connections_select on public.connections;
create policy connections_select on public.connections
  for select to authenticated using (user_id = auth.uid());
drop policy if exists connections_insert on public.connections;
create policy connections_insert on public.connections
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists connections_update on public.connections;
create policy connections_update on public.connections
  for update to authenticated using (user_id = auth.uid());
drop policy if exists connections_delete on public.connections;
create policy connections_delete on public.connections
  for delete to authenticated using (user_id = auth.uid());

-- ------------------------------------------------------------ write (RPC) ----
-- Link (or refresh) an account you just authorised. Providers we can verify
-- entirely in the browser (Steam) are upserted directly here.
create or replace function public.add_connection(
  p_provider    text,
  p_external_id text,
  p_display_name text default '',
  p_avatar_url  text default null,
  p_metadata    jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_provider not in ('steam', 'spotify', 'twitch', 'discord', 'github',
                        'youtube', 'xbox', 'instagram', 'tiktok', 'epic') then
    raise exception 'unknown provider';
  end if;
  if btrim(coalesce(p_external_id, '')) = '' then raise exception 'provider gave no account id'; end if;
  insert into public.connections (user_id, provider, external_id, display_name, avatar_url, metadata, updated_at)
  values (v_uid, p_provider, left(p_external_id, 128), left(coalesce(p_display_name, ''), 80),
          nullif(p_avatar_url, ''), coalesce(p_metadata, '{}'::jsonb), now())
  on conflict (user_id, provider, external_id) do update set
    display_name = excluded.display_name,
    avatar_url   = excluded.avatar_url,
    metadata     = excluded.metadata,
    updated_at   = now();
end;
$$;

-- Unlink an account. Without p_external_id every account of that provider
-- (e.g. "disconnect all my Twitch accounts") is removed.
create or replace function public.remove_connection(
  p_provider    text,
  p_external_id text default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_external_id is null then
    delete from public.connections where user_id = auth.uid() and provider = p_provider;
  else
    delete from public.connections where user_id = auth.uid() and provider = p_provider and external_id = p_external_id;
  end if;
end;
$$;

-- The accounts YOU linked, newest first (Settings → Connections).
create or replace function public.my_connections()
returns table (provider text, external_id text, display_name text, avatar_url text,
               metadata jsonb, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.provider, c.external_id, c.display_name, c.avatar_url, c.metadata, c.created_at
  from public.connections c
  where c.user_id = auth.uid()
  order by c.created_at desc;
$$;

-- ----------------------------------------------------------------- grants ----
revoke execute on function public.add_connection(text, text, text, text, jsonb),
  public.remove_connection(text, text), public.my_connections()
  from public, anon;
grant execute on function public.add_connection(text, text, text, text, jsonb),
  public.remove_connection(text, text), public.my_connections()
  to authenticated;