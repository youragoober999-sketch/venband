// Run tests/db/*_test.sql (in run.sh order) against the LOCAL Supabase stack
// (`npx supabase start`) — real Supabase, not the PGlite stub. Resets the local
// database first, so seeded test accounts are wiped (`npm run seed:local` again).
//   node scripts/test-db-local.mjs
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
process.exit(failed ? 1 : 0);
