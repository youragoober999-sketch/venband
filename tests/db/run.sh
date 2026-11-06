#!/usr/bin/env bash
# Runs the schema migration + RLS tests against a throwaway PostgreSQL database.
# Usage: PGHOST=/tmp PGPORT=5432 PGUSER=postgres tests/db/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=venband_test
# Supabase's SQL editor resolves unqualified names through public then extensions
# (gen_salt, digest, ... live in extensions); match that so migrations behave the same.
export PGOPTIONS="${PGOPTIONS:-} -c search_path=public,extensions"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/db/supabase_stub.sql
psql -q -v ON_ERROR_STOP=1 -d $DB -c "create extension pgcrypto with schema extensions"
for f in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d $DB -f "$f"
done
psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/db/rls_test.sql
psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/db/schema_manifest_test.sql
psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/db/theme_test.sql
psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/db/notification_test.sql
psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/db/badge_test.sql
psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/db/dm_test.sql
psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/db/cosmetics_test.sql
psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/db/staff_test.sql
echo "database tests passed"
