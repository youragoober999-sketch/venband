-- Vix Api database schema.
-- Paste this whole file into Supabase Dashboard -> SQL Editor -> New query -> Run.
-- It is safe to run more than once.
--
-- Security model: every table has Row Level Security turned on with NO policies,
-- and the anon/authenticated roles have no grants. That means the public
-- (publishable) key can read nothing. Only the Vercel serverless functions,
-- which hold the secret key, can touch the data, and they enforce accounts,
-- sharing and API keys themselves.

create extension if not exists pgcrypto;

create table if not exists public.vix_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username ~ '^[a-z0-9_.-]{3,24}$'),
  display_name text not null default '',
  bio text not null default '',
  avatar_color text not null default '#8b5cf6',
  password_hash text not null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.vix_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.vix_users(id) on delete cascade,
  token_hash text not null unique,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists vix_sessions_user on public.vix_sessions(user_id);

create table if not exists public.vix_friends (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.vix_users(id) on delete cascade,
  addressee_id uuid not null references public.vix_users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester_id <> addressee_id)
);
create unique index if not exists vix_friends_pair on public.vix_friends (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

create table if not exists public.vix_apis (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.vix_users(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,47}$'),
  name text not null,
  description text not null default '',
  icon text not null default '⚡',
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  require_key boolean not null default true,
  status text not null default 'live' check (status in ('live', 'paused')),
  extensions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, slug)
);

create table if not exists public.vix_api_members (
  api_id uuid not null references public.vix_apis(id) on delete cascade,
  user_id uuid not null references public.vix_users(id) on delete cascade,
  role text not null default 'editor' check (role in ('viewer', 'editor')),
  added_at timestamptz not null default now(),
  primary key (api_id, user_id)
);
create index if not exists vix_api_members_user on public.vix_api_members(user_id);

create table if not exists public.vix_files (
  id uuid primary key default gen_random_uuid(),
  api_id uuid not null references public.vix_apis(id) on delete cascade,
  path text not null check (length(path) between 1 and 300),
  is_folder boolean not null default false,
  content text not null default '' check (length(content) <= 1000000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.vix_users(id) on delete set null,
  unique (api_id, path)
);

create table if not exists public.vix_endpoints (
  id uuid primary key default gen_random_uuid(),
  api_id uuid not null references public.vix_apis(id) on delete cascade,
  method text not null default 'GET' check (method in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ANY')),
  route text not null check (route ~ '^/'),
  file_path text not null,
  description text not null default '',
  enabled boolean not null default true,
  public boolean not null default false,
  created_at timestamptz not null default now(),
  unique (api_id, method, route)
);

create table if not exists public.vix_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.vix_users(id) on delete cascade,
  api_id uuid references public.vix_apis(id) on delete cascade,
  name text not null,
  prefix text not null,
  key_hash text not null unique,
  scopes text[] not null default array['invoke', 'manage'],
  requests bigint not null default 0,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);
create index if not exists vix_keys_user on public.vix_keys(user_id);

create table if not exists public.vix_logs (
  id bigint generated always as identity primary key,
  api_id uuid not null references public.vix_apis(id) on delete cascade,
  method text not null,
  path text not null,
  status int not null,
  duration_ms int not null default 0,
  key_id uuid,
  ip text not null default '',
  error text not null default '',
  console text not null default '',
  body text not null default '',
  cached boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists vix_logs_api_time on public.vix_logs(api_id, created_at desc);

create table if not exists public.vix_kv (
  api_id uuid not null references public.vix_apis(id) on delete cascade,
  key text not null check (length(key) between 1 and 256),
  value jsonb,
  updated_at timestamptz not null default now(),
  primary key (api_id, key)
);

create table if not exists public.vix_versions (
  id uuid primary key default gen_random_uuid(),
  api_id uuid not null references public.vix_apis(id) on delete cascade,
  label text not null default '',
  snapshot jsonb not null,
  created_by uuid references public.vix_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists vix_versions_api on public.vix_versions(api_id, created_at desc);

create table if not exists public.vix_cache (
  api_id uuid not null references public.vix_apis(id) on delete cascade,
  cache_key text not null,
  response jsonb not null,
  expires_at timestamptz not null,
  primary key (api_id, cache_key)
);

create table if not exists public.vix_rate (
  bucket text primary key,
  window_start timestamptz not null default now(),
  hits int not null default 0
);

-- Atomic fixed-window rate limiter. Returns true while the bucket is under the limit.
create or replace function public.vix_hit(p_bucket text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits int;
begin
  insert into vix_rate as r (bucket, window_start, hits)
  values (p_bucket, now(), 1)
  on conflict (bucket) do update
    set hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
        window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into v_hits;
  return v_hits <= p_limit;
end;
$$;

-- Bumps usage counters for an API key without a read-modify-write race.
create or replace function public.vix_key_used(p_key uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update vix_keys set requests = requests + 1, last_used_at = now() where id = p_key;
$$;

-- Housekeeping, called by the daily cron: keeps logs, sessions and caches small.
create or replace function public.vix_cleanup()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from vix_sessions where expires_at < now();
  delete from vix_cache where expires_at < now();
  delete from vix_rate where window_start < now() - interval '1 day';
  delete from vix_logs where created_at < now() - interval '14 days';
  delete from vix_logs l using (
    select id from (
      select id, row_number() over (partition by api_id order by created_at desc) as rn from vix_logs
    ) t where t.rn > 2000
  ) old where l.id = old.id;
end;
$$;

-- Lock everything down to the secret (service_role) key.
do $$
declare t text;
begin
  foreach t in array array['vix_users','vix_sessions','vix_friends','vix_apis','vix_api_members','vix_files','vix_endpoints','vix_keys','vix_logs','vix_kv','vix_versions','vix_cache','vix_rate'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

revoke all on function public.vix_hit(text, int, int) from public, anon, authenticated;
revoke all on function public.vix_key_used(uuid) from public, anon, authenticated;
revoke all on function public.vix_cleanup() from public, anon, authenticated;
grant execute on function public.vix_hit(text, int, int) to service_role;
grant execute on function public.vix_key_used(uuid) to service_role;
grant execute on function public.vix_cleanup() to service_role;
grant usage, select on all sequences in schema public to service_role;
