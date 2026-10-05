-- Minimal stand-ins for the Supabase platform objects so the migration can be
-- tested against a vanilla PostgreSQL (see tests/db/run.sh).
do $$ begin
  -- roles are cluster-wide, so only create them once
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
end $$;
create schema extensions;
create schema auth;
create schema realtime;
create schema storage;
grant usage on schema public, auth, realtime, storage, extensions to anon, authenticated;

create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb,
                         banned_until timestamptz);
create table auth.sessions (id uuid primary key, user_id uuid not null references auth.users (id) on delete cascade,
                            created_at timestamptz default now(), updated_at timestamptz, refreshed_at timestamp,
                            user_agent text, ip inet);
create function auth.jwt() returns jsonb language sql stable as
  $$ select jsonb_build_object('sub', current_setting('request.jwt.claim.sub', true),
                               'session_id', nullif(current_setting('request.jwt.claim.session_id', true), ''),
                               'aal', coalesce(nullif(current_setting('request.jwt.claim.aal', true), ''), 'aal1')) $$;
grant execute on function auth.jwt() to anon, authenticated;
create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id) on delete cascade,
                               factor_type text not null default 'totp', status text not null default 'unverified');
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;

create table realtime.messages (id bigserial primary key, topic text, payload jsonb);
create function realtime.topic() returns text language sql stable as
  $$ select current_setting('realtime.topic', true) $$;
alter table realtime.messages enable row level security;
grant select, insert on realtime.messages to authenticated;

create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner_id text);
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

create publication supabase_realtime;

-- Like new hosted Supabase projects, nothing in `public` is exposed to the
-- API roles by default: the migrations must grant everything explicitly.
