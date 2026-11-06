-- =============================================================================
-- Schema check (20261105010000)
--
-- schema_missing(tables, functions, bodies) reports which public tables and
-- functions do NOT exist, and which rewritten functions still have an OLD body.
-- The /status page sends the list from src/lib/schemaManifest.ts (generated
-- from supabase/migrations/), so it can name exactly which migration files a
-- database is missing instead of showing "Operational" for a half-set-up one.
--
-- bodies: {"function_name": "md5 of the newest body with whitespace removed"}.
-- A function counts as current if ANY overload with that name matches.
--
-- Only reveals existence/fingerprints of objects in the public schema, which is
-- already public in the open-source repo. Callable signed out (the status page
-- works without an account). Safe to run more than once.
-- =============================================================================

drop function if exists public.schema_missing(text[], text[]);
drop function if exists public.schema_missing(text[], text[], jsonb);
create function public.schema_missing(p_tables text[] default '{}', p_functions text[] default '{}', p_bodies jsonb default '{}')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tables text[];
  v_functions text[];
  v_bodies text[];
begin
  if jsonb_typeof(coalesce(p_bodies, '{}'::jsonb)) <> 'object' then
    raise exception 'bodies must be a JSON object';
  end if;
  if coalesce(cardinality(p_tables), 0) + coalesce(cardinality(p_functions), 0)
     + (select count(*) from jsonb_object_keys(coalesce(p_bodies, '{}'::jsonb))) > 2000 then
    raise exception 'too many objects';
  end if;

  select coalesce(array_agg(t order by t), '{}') into v_tables
    from unnest(coalesce(p_tables, '{}')) t
   where t !~ '^[a-z0-9_]{1,63}$'
      or not exists (select 1 from pg_catalog.pg_class c
                     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                     where n.nspname = 'public' and c.relname = t and c.relkind in ('r', 'p', 'v', 'm'));

  select coalesce(array_agg(f order by f), '{}') into v_functions
    from unnest(coalesce(p_functions, '{}')) f
   where f !~ '^[a-z0-9_]{1,63}$'
      or not exists (select 1 from pg_catalog.pg_proc p
                     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname = f);

  select coalesce(array_agg(b.key order by b.key), '{}') into v_bodies
    from jsonb_each_text(coalesce(p_bodies, '{}'::jsonb)) b
   where b.key !~ '^[a-z0-9_]{1,63}$'
      or not exists (select 1 from pg_catalog.pg_proc p
                     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname = b.key
                       and md5(regexp_replace(p.prosrc, '[ \t\r\n\f\v]+', '', 'g')) = b.value);

  return jsonb_build_object('tables', to_jsonb(v_tables), 'functions', to_jsonb(v_functions), 'bodies', to_jsonb(v_bodies));
end;
$$;

revoke execute on function public.schema_missing(text[], text[], jsonb) from public;
grant execute on function public.schema_missing(text[], text[], jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
