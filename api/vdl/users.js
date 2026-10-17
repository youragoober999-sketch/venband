// VDL users: list/search profiles. Top-staff gated for full list.
import { sql, json, preflight, readJson, ensureSchema } from './_db.js';
import { SignJWT, jwtVerify } from 'jose';
const SECRET = new TextEncoder().encode(process.env.VDL_JWT_SECRET || 'dev-only-insecure-secret-change-me');

async function currentUser(request) {
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(/vdl_session=([^;]+)/);
  if (!m) return null;
  try { const { payload } = await jwtVerify(m[1], SECRET); return payload; } catch { return null; }
}

function isTopStaff(u) {
  return u && (u.role === 'owner' || (Array.isArray(u.badges) && (u.badges.includes('owner') || u.badges.includes('founder'))));
}

export function OPTIONS() { return preflight(); }

export async function GET(request) {
  await ensureSchema();
  const u = new URL(request.url);
  const q = (u.searchParams.get('q') || '').trim();
  const me = await currentUser(request);
  if (!me) return json(401, { error: 'not signed in' });
  // non-top-staff can only see themselves
  let rows;
  if (isTopStaff(me)) {
    if (q) {
      const r = await sql`select id, email, username, display_name, avatar_color, badges, platform_role, account_status, created_at from vdl_users where username ilike ${'%' + q + '%'} or display_name ilike ${'%' + q + '%'} or id::text = ${q} order by created_at desc limit 50`;
      rows = r.rows;
    } else {
      const r = await sql`select id, email, username, display_name, avatar_color, badges, platform_role, account_status, created_at from vdl_users order by created_at desc limit 100`;
      rows = r.rows;
    }
  } else {
    const r = await sql`select id, email, username, display_name, avatar_color, badges, platform_role, account_status, created_at from vdl_users where id = ${me.sub}`;
    rows = r.rows;
  }
  return json(200, { users: rows });
}

export async function POST(request) {
  await ensureSchema();
  // admin actions: ban/erase require top staff
  const me = await currentUser(request);
  if (!me || !isTopStaff(me)) return json(403, { error: 'top staff only' });
  let body;
  try { body = await readJson(request); } catch (e) { return json(400, { error: e.message }); }
  if (body.action === 'ban') {
    await sql`update vdl_users set account_status = 'banned' where id = ${body.id}`;
    await sql`insert into vdl_audit_log (actor_id, action, target_user, reason) values (${me.sub}, 'ban', ${body.id}, ${body.reason || 'storage console'})`;
    return json(200, { ok: true });
  }
  if (body.action === 'erase') {
    await sql`insert into vdl_audit_log (actor_id, action, target_user, reason) values (${me.sub}, 'erase', ${body.id}, 'storage console')`;
    await sql`delete from vdl_users where id = ${body.id}`;
    return json(200, { ok: true });
  }
  return json(400, { error: 'unknown action' });
}

