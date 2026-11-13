// Run tests/db/*_test.sql (in run.sh order) against the LOCAL Supabase stack
// (`npx supabase start`) — real Supabase, not the PGlite stub. Resets the local
// database first, so seeded test accounts are wiped (`npm run seed:local` again).
//   node scripts/database/test-local.mjs
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const order = [...fs.readFileSync('tests/db/run.sh', 'utf8').matchAll(/-f (tests\/db\/\w+_test\.sql)/g)].map((m) => m[1]);
console.log('resetting the local database…');
execSync('npx supabase db reset', { stdio: 'ignore' });
let failed = 0;
for (const f of order) {
  const sql = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');
  const r = spawnSync('docker', ['exec', '-i', 'supabase_db_venband', 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { input: sql, encoding: 'utf8' });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${f} (${sql.split('\n').length} lines)${ok ? '' : `\n     ${(r.stderr || '').split('\n').slice(0, 3).join('\n     ')}`}`);
}
// The tests left real-looking rows everywhere (Shop items equipped, memory
// reports, …). Re-running the live update file over them must still work:
// people run it more than once, and older steps must not reject newer data.
for (const run of [1, 2]) {
  const sql = fs.readFileSync('supabase/update-2026-11.sql', 'utf8');
  const r = spawnSync('docker', ['exec', '-i', 'supabase_db_venband', 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { input: sql, encoding: 'utf8' });
  const ok = r.status === 0;
  if (!ok) failed++;
  const why = (r.stderr || '').split(/\r?\n/).filter((l) => /ERROR/.test(l)).slice(0, 2).join('\n     ');
  console.log(`${ok ? 'OK  ' : 'FAIL'} supabase/update-2026-11.sql re-run #${run} over test data${ok ? '' : `\n     ${why}`}`);
}
process.exit(failed ? 1 : 0);
