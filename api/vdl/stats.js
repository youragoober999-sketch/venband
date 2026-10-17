// VDL stats: counts for the console overview.
import { sql, json, preflight, ensureSchema } from './_db.js';
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
  const users = await sql`select count(*)::int as c from vdl_users`;
  const servers = await sql`select count(*)::int as c from vdl_servers`;
  const blocks = await sql`select count(*)::int as c from vdl_ledger`;
  const objs = await sql`select count(*)::int as c from vbb_objects`;
  return json(200, { users: users.rows[0].c, servers: servers.rows[0].c, objects: objs.rows[0].c, blocks: blocks.rows[0].c });
}