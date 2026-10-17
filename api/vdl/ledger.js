// VDL ledger: append-only hash chain of user stats. Top staff only.
import { sql, json, preflight, readJson, ensureSchema } from './_db.js';
import crypto from 'node:crypto';
import { jwtVerify } from 'jose';
const SECRET = new TextEncoder().encode(process.env.VDL_JWT_SECRET || 'dev-only-insecure-secret-change-me');
async function currentUser(request) {
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(/vdl_session=([^;]+)/);
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const token = m ? m[1] : bearer;
  if (!token) return null;
  try { const { payload } = await jwtVerify(token, SECRET); return payload; } catch { return null; }
}
function isTopStaff(u) { return u && (u.role === 'owner' || (Array.isArray(u.badges) && (u.badges.includes('owner') || u.badges.includes('founder')))); }
export function OPTIONS() { return preflight(); }
export async function GET(request) {
  await ensureSchema();
  const me = await currentUser(request);
  if (!me || !isTopStaff(me)) return json(403, { error: 'top staff only' });
  const r = await sql`select id, seq, prev_hash, hash, payload, created_at from vdl_ledger order by seq asc`;
  return json(200, { rows: r.rows });
}
export async function POST(request) {
  await ensureSchema();
  const me = await currentUser(request);
  if (!me || !isTopStaff(me)) return json(403, { error: 'top staff only' });
  let body;
  try { body = await readJson(request); } catch (e) { return json(400, { error: e.message }); }
  if (body.action === 'rebuild') {
    // rebuild chain from current users
    await sql`delete from vdl_ledger`;
    const users = await sql`select id, email, username, created_at from vdl_users order by created_at asc`;
    let prev = '0'.repeat(64);
    let seq = 0;
    for (const u of users.rows) {
      seq++;
      const payload = Buffer.from(JSON.stringify({ userID: u.id, email: u.email, username: u.username, created_at: u.created_at })).toString('base64');
      const hash = crypto.createHash('sha256').update(prev + payload).digest('hex');
      await sql`insert into vdl_ledger (seq, prev_hash, hash, payload, created_by) values (${seq}, ${prev}, ${hash}, ${payload}, ${me.sub})`;
      prev = hash;
    }
    return json(200, { ok: true, blocks: seq });
  }
  return json(400, { error: 'unknown action' });
}