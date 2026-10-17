// VDL auth: signup / signin / signout / me, backed by Vercel Postgres.
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { sql, json, preflight, readJson, cookieHeader, COOKIE, ensureSchema } from './_db.js';

const SECRET = new TextEncoder().encode(process.env.VDL_JWT_SECRET || 'dev-only-insecure-secret-change-me');

async function issueToken(user) {
  return new SignJWT({ sub: user.id, email: user.email, role: user.platform_role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(SECRET);
}

async function currentUser(request) {
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(new RegExp(`${COOKIE}=([^;]+)`));
  if (!m) return null;
  try {
    const { payload } = await jwtVerify(m[1], SECRET);
    const { rows } = await sql`select id, email, username, display_name, avatar_color, badges, platform_role, account_status, created_at from vdl_users where id = ${payload.sub}`;
    return rows[0] || null;
  } catch {
    return null;
  }
}

export function OPTIONS() { return preflight(); }

export async function GET(request) {
  await ensureSchema();
  const u = await currentUser(request);
  if (!u) return json(401, { error: 'not signed in' });
  return json(200, { user: u });
}

export async function POST(request) {
  await ensureSchema();
  const u = new URL(request.url);
  const action = u.searchParams.get('action') || '';
  let body;
  try { body = await readJson(request); } catch (e) { return json(400, { error: e.message }); }

  if (action === 'signup') {
    const { email, password, username } = body;
    if (!email || !password || !username) return json(400, { error: 'email, password, username required' });
    if (password.length < 8) return json(400, { error: 'password too short' });
    const hash = await bcrypt.hash(password, 10);
    try {
      const { rows } = await sql`
        insert into vdl_users (email, password_hash, username, display_name)
        values (${email.toLowerCase()}, ${hash}, ${username}, ${username})
        returning id, email, username, display_name, avatar_color, badges, platform_role, account_status, created_at`;
      const user = rows[0];
      const token = await issueToken(user);
      const res = json(200, { user });
      res.headers.set('set-cookie', cookieHeader(token, 60 * 60 * 24 * 30));
      return res;
    } catch (e) {
      return json(400, { error: String(e.message || e).includes('unique') ? 'email or username taken' : String(e.message || e) });
    }
  }

  if (action === 'signin') {
    const { email, password } = body;
    if (!email || !password) return json(400, { error: 'email and password required' });
    const { rows } = await sql`select * from vdl_users where email = ${email.toLowerCase()}`;
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return json(401, { error: 'invalid credentials' });
    await sql`update vdl_users set last_sign_in_at = now() where id = ${user.id}`;
    const safe = { id: user.id, email: user.email, username: user.username, display_name: user.display_name, avatar_color: user.avatar_color, badges: user.badges, platform_role: user.platform_role, account_status: user.account_status, created_at: user.created_at };
    const token = await issueToken(safe);
    const res = json(200, { user: safe });
    res.headers.set('set-cookie', cookieHeader(token, 60 * 60 * 24 * 30));
    return res;
  }

  if (action === 'signout') {
    const res = json(200, { ok: true });
    res.headers.set('set-cookie', cookieHeader('', 0));
    return res;
  }

  return json(400, { error: 'unknown action' });
}

