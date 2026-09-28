#!/usr/bin/env bash
# Runs the schema migration + RLS tests against a throwaway PostgreSQL database.
# Usage: PGHOST=/tmp PGPORT=5432 PGUSER=postgres tests/db/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=venband_test
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/db/supabase_stub.sql
psql -q -v ON_ERROR_STOP=1 -d $DB -c "create extension pgcrypto with schema extensions"
for f in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d $DB -f "$f"
done
psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/db/rls_test.sql
echo "database tests passed"
