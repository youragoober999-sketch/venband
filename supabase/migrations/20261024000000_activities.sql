-- =============================================================================
-- Rich presence: what you're doing cross-device.
--   * activities: one row per user — the current activity (nothing = offline /
--     nothing to show). Rows are pushed live so every client sees the same thing.
--   * desktop apps report here via their own Discord-IPC pipe bridge
--     (VS Code, games, YouTube, Spotify…); the web app confirms with the same
--     shape it already renders for bots.
--   * set_my_activity / clear_my_activity are the only writers (security definer).
-- =============================================================================

create table if not exists public.activities (
  user_id           uuid primary key references public.profiles (id) on delete cascade,
  platform          text not null default 'rpc'
                    check (platform in ('rpc', 'spotify', 'custom', 'connections')),
  icon              text,                                   -- emoji or provider slug
  name              text not null check (char_length(name) between 1 and 64),
  type              smallint not null default 0,            -- 0 play 1 stream 2 listen 3 watch 4 custom 5 compete
  details           text check (details is null or char_length(details) <= 200),
  state             text check (state is null or char_length(state) <= 200),
  url               text check (url is null or char_length(url) <= 500),
  uri               text check (uri is null or char_length(uri) <= 300),
  client_id         text check (client_id is null or char_length(client_id) <= 64),
  assets_large_key  text check (assets_large_key is null or char_length(assets_large_key) <= 128),
  assets_large_text text check (assets_large_text is null or char_length(assets_large_text) <= 128),
  assets_small_key  text check (assets_small_key is null or char_length(assets_small_key) <= 128),
  assets_small_text text check (assets_small_text is null or char_length(assets_small_text) <= 128),
  party_id          text check (party_id is null or char_length(party_id) <= 128),
  party_cur         int,
  party_max         int,
  timestamps_start  bigint,
  timestamps_end    bigint,
  buttons           jsonb not null default '[]'::jsonb
                    check (jsonb_typeof(buttons) = 'array' and jsonb_array_length(buttons) <= 2),
  updated_at        timestamptz not null default now()
);

alter table public.activities enable row level security;
-- Everyone signed in can read anyone's activity (it is public, like presence).
drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities
  for select to authenticated using (true);
-- No direct writes: set_my_activity / clear_my_activity own the row.

-- ----------------------------------------------------------- write (RPC) ----
-- Set (or with an empty/no-name payload, clear) your current activity.
-- p_activity mirrors the shape browsers already build for bot presence.
create or replace function public.set_my_activity(p_activity jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  a     jsonb := p_activity;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  -- clearing: null, 'null', {}, or a name that's blank
  if a is null or a = 'null'::jsonb
     or a ->> 'name' is null or btrim(coalesce(a ->> 'name', '')) = '' then
    delete from public.activities where user_id = v_uid;
    return;
  end if;

  insert into public.activities
    (user_id, platform, icon, name, type, details, state, url, uri, client_id,
     assets_large_key, assets_large_text, assets_small_key, assets_small_text,
     party_id, party_cur, party_max, timestamps_start, timestamps_end,
     buttons, updated_at)
  values (
    v_uid,
    case when a ->> 'platform' in ('rpc', 'spotify', 'custom', 'connections')
         then a ->> 'platform' else 'rpc' end,
    nullif(coalesce(a ->> 'icon', ''), ''),
    left(btrim(coalesce(a ->> 'name', '')), 64),
    coalesce(nullif(a ->> 'type', '')::int, 0),
    left(a ->> 'details', 200),
    left(a ->> 'state', 200),
    left(a ->> 'url', 500),
    left(a ->> 'uri', 300),
    left(a ->> 'client_id', 64),
    left(a ->> 'assets_large_key', 128),
    left(a ->> 'assets_large_text', 128),
    left(a ->> 'assets_small_key', 128),
    left(a ->> 'assets_small_text', 128),
    left(a ->> 'party_id', 128),
    nullif((a ->> 'party_cur')::int, 0),
    nullif((a ->> 'party_max')::int, 0),
    nullif((a ->> 'timestamps_start')::bigint, 0),
    nullif((a ->> 'timestamps_end')::bigint, 0),
    case when jsonb_typeof(a -> 'buttons') = 'array'
         then (select jsonb_agg(x)
               from (select left(b.value ->> 'label', 64) x
                     from jsonb_array_elements(a -> 'buttons') b
                     where b.value ->> 'label' is not null limit 2) s)
         else '[]'::jsonb end,
    now()
  )
  on conflict (user_id) do update set
    platform          = excluded.platform,
    icon              = excluded.icon,
    name              = excluded.name,
    type              = excluded.type,
    details           = excluded.details,
    state             = excluded.state,
    url               = excluded.url,
    uri               = excluded.uri,
    client_id         = excluded.client_id,
    assets_large_key  = excluded.assets_large_key,
    assets_large_text = excluded.assets_large_text,
    assets_small_key  = excluded.assets_small_key,
    assets_small_text = excluded.assets_small_text,
    party_id          = excluded.party_id,
    party_cur         = excluded.party_cur,
    party_max         = excluded.party_max,
    timestamps_start  = excluded.timestamps_start,
    timestamps_end    = excluded.timestamps_end,
    buttons           = excluded.buttons,
    updated_at        = now();
end;
$$;

-- Stop showing anything.
create or replace function public.clear_my_activity()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.activities where user_id = auth.uid();
end;
$$;

-- ----------------------------------------------------------------- grants ----
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                 and schemaname = 'public' and tablename = 'activities') then
    alter publication supabase_realtime add table public.activities;
  end if;
end $$;
grant select on public.activities to authenticated;
revoke execute on function public.set_my_activity(jsonb), public.clear_my_activity()
  from public, anon;
grant execute on function public.set_my_activity(jsonb), public.clear_my_activity()
  to authenticated;