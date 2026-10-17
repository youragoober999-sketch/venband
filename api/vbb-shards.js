// Venband Blob Shards — registry of storage subdomains (shard-1.venband.com, ...).
// Top-staff only. Shards are registered here; uploads can be routed to them.
import { sql, json, preflight, readJson } from './vdl/_db.js';
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
  const me = await currentUser(request);
  if (!me || !isTopStaff(me)) return json(403, { error: 'top staff only' });
  const r = await sql`select * from vbb_shards order by id asc`;
  return json(200, { shards: r.rows });
}

export async function POST(request) {
  const me = await currentUser(request);
  if (!me || !isTopStaff(me)) return json(403, { error: 'top staff only' });
  let body;
  try { body = await readJson(request); } catch (e) { return json(400, { error: e.message }); }
  if (body.action === 'register') {
    const { subdomain, base_url, capacity_bytes } = body;
    if (!subdomain || !base_url) return json(400, { error: 'subdomain and base_url required' });
    await sql`insert into vbb_shards (subdomain, base_url, capacity_bytes) values (${subdomain}, ${base_url}, ${capacity_bytes || 0}) on conflict (subdomain) do update set base_url = excluded.base_url, capacity_bytes = excluded.capacity_bytes, active = true`;
    return json(200, { ok: true });
  }
  if (body.action === 'deactivate') {
    await sql`update vbb_shards set active = false where subdomain = ${body.subdomain}`;
    return json(200, { ok: true });
  }
  if (body.action === 'usage') {
    await sql`update vbb_shards set used_bytes = ${body.used_bytes} where subdomain = ${body.subdomain}`;
    return json(200, { ok: true });
  }
  return json(400, { error: 'unknown action' });
}
