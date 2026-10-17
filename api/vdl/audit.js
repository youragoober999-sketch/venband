// VDL audit log: list (top staff).
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
  const r = await sql`select a.id, u.username as actor, a.action, a.detail, a.reason, a.created_at, a.target_user, a.target_server from vdl_audit_log a left join vdl_users u on u.id = a.actor_id order by a.created_at desc limit 100`;
  return json(200, { rows: r.rows });
}