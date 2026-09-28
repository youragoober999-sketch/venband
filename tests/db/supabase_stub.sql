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

create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
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

-- Supabase grants table access to API roles by default; RLS does the rest.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
