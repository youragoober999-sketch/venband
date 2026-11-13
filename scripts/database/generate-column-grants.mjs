// Prints the SQL that makes the column-level grants in supabase/migrations/
// authoritative: for every (table, privilege) the migrations grant only on some
// columns, revoke the table-wide privilege from `authenticated` (which some
// Supabase projects grant by default) and re-grant exactly those columns.
// Used to write supabase/migrations/20261106080000_column_grants.sql.
import fs from 'node:fs';
import path from 'node:path';

const dir = 'supabase/migrations';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const cols = new Map(); // "table|priv" -> Set(columns)
const whole = new Set(); // "table|priv" granted on the whole table somewhere
const stmt = /(grant|revoke)\s+([^;]*?)\s+on\s+(?:table\s+)?public\.(\w+)\s+(?:to|from)\s+([^;]+);/gi;
for (const f of files) {
  const sql = fs.readFileSync(path.join(dir, f), 'utf8').replace(/--[^\n]*/g, '');
  for (const m of sql.matchAll(stmt)) {
    const [, verb, privs, table, who] = m;
    if (!/\bauthenticated\b/i.test(who)) continue;
    // split "select (a, b), update (c)" / "select, insert" into privilege [+ columns]
    for (const part of privs.match(/(select|insert|update|delete|all)(\s*\([^)]*\))?/gi) ?? []) {
      const [, p, c] = /^(\w+)\s*(?:\(([^)]*)\))?/.exec(part.trim());
      const priv = p.toLowerCase();
      const key = `${table}|${priv}`;
      if (!c) {
        if (verb.toLowerCase() === 'grant') whole.add(key);
        else whole.delete(key);
        continue;
      }
      const set = cols.get(key) ?? new Set();
      for (const col of c.split(',').map((x) => x.trim()).filter(Boolean)) {
        if (verb.toLowerCase() === 'grant') set.add(col);
        else set.delete(col);
      }
      cols.set(key, set);
    }
  }
}
const out = [];
for (const [key, set] of [...cols].sort()) {
  if (whole.has(key) || !set.size) continue; // the whole table is meant to be granted
  const [table, priv] = key.split('|');
  out.push(`revoke ${priv} on public.${table} from authenticated;\ngrant ${priv} (${[...set].join(', ')}) on public.${table} to authenticated;`);
}
console.log(out.join('\n'));
