// VDL servers: list + create.
import { sql, json, preflight, readJson } from './_db.js';
import { jwtVerify } from 'jose';
const SECRET = new TextEncoder().encode(process.env.VDL_JWT_SECRET || 'dev-only-insecure-secret-change-me');

async function currentUser(request) {
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(/vdl_session=([^;]+)/);
  if (!m) return null;
  try { const { payload } = await jwtVerify(m[1], SECRET); return payload; } catch { return null; }
}

export function OPTIONS() { return preflight(); }

export async function GET(request) {
  const me = await currentUser(request);
  if (!me) return json(401, { error: 'not signed in' });
  const r = await sql`select s.id, s.name, s.icon_color, s.status, s.verified, s.description, s.members, s.created_at, u.username as owner_username, s.owner_id from vdl_servers s left join vdl_users u on u.id = s.owner_id order by s.created_at desc limit 100`;
  return json(200, { servers: r.rows });
}

export async function POST(request) {
  const me = await currentUser(request);
  if (!me) return json(401, { error: 'not signed in' });
  let body;
  try { body = await readJson(request); } catch (e) { return json(400, { error: e.message }); }
  if (body.action === 'create') {
    const { name } = body;
    if (!name) return json(400, { error: 'name required' });
    const r = await sql`insert into vdl_servers (name, owner_id) values (${name}, ${me.sub}) returning id, name, icon_color, status, verified, description, members, created_at`;
    await sql`insert into vdl_memberships (user_id, server_id) values (${me.sub}, ${r.rows[0].id}) on conflict do nothing`;
    return json(200, { server: r.rows[0] });
  }
  return json(400, { error: 'unknown action' });
}
