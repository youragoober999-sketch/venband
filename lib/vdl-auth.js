// Shared auth for the VDL / VBB serverless functions.
// Tokens only prove *who* you are; role, badges and ban status are always
// re-read from the database so bans and demotions take effect immediately.
import { SignJWT, jwtVerify } from 'jose';
import { sql, COOKIE } from './vdl-db.js';

const RAW_SECRET = process.env.VDL_JWT_SECRET || '';
export const SECRET = RAW_SECRET ? new TextEncoder().encode(RAW_SECRET) : null;
export const SECRET_WEAK = RAW_SECRET.length > 0 && RAW_SECRET.length < 32;
export const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days

export const USER_COLUMNS = 'id, email, username, display_name, avatar_color, badges, platform_role, account_status, created_at, last_sign_in_at';

export function tokenFrom(request) {
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (m) return decodeURIComponent(m[1]);
  const auth = request.headers.get('authorization') || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

export async function signSession(user) {
  if (!SECRET) throw Object.assign(new Error('VDL_JWT_SECRET is not set on the server'), { status: 503 });
  return new SignJWT({ sub: user.id, v: 2 })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL}s`)
    .sign(SECRET);
}

/** Verify a VDL token and load the live user row. Returns null when not signed in or banned. */
export async function vdlUser(request) {
  const token = tokenFrom(request);
  if (!token || !SECRET) return null;
  let sub;
  try { ({ payload: { sub } } = await jwtVerify(token, SECRET, { algorithms: ['HS256'] })); } catch { return null; }
  if (!sub) return null;
  const { rows } = await sql.query(`select ${USER_COLUMNS} from vdl_users where id = $1`, [sub]);
  const user = rows[0];
  if (!user || user.account_status === 'banned') return null;
  return { ...user, sub: user.id, role: user.platform_role };
}

/** VDL user, or (for VBB) a verified Supabase session as a plain user. */
export async function anyUser(request) {
  const v = await vdlUser(request);
  if (v) return v;
  const token = tokenFrom(request);
  if (!token) return null;
  try {
    const base = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
    const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
    if (!base || !anon) return null;
    const r = await fetch(`${base}/auth/v1/user`, { headers: { apikey: anon, authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = await r.json();
    return { sub: u.id, id: u.id, email: u.email, role: 'user', platform_role: 'user', badges: [] };
  } catch { return null; }
}

export function isTopStaff(u) {
  if (!u) return false;
  const badges = Array.isArray(u.badges) ? u.badges : [];
  return u.platform_role === 'owner' || u.role === 'owner' || badges.includes('owner') || badges.includes('founder');
}

/**
 * Simple fixed-window rate limit backed by Postgres (works without KV).
 * Returns true when the caller is over the limit.
 */
export async function rateLimited(key, limit, windowSeconds) {
  try {
    const { rows } = await sql.query(
      `insert into vdl_rate_limits (key, window_start, hits) values ($1, now(), 1)
       on conflict (key) do update set
         hits = case when vdl_rate_limits.window_start < now() - make_interval(secs => $2) then 1 else vdl_rate_limits.hits + 1 end,
         window_start = case when vdl_rate_limits.window_start < now() - make_interval(secs => $2) then now() else vdl_rate_limits.window_start end
       returning hits`,
      [key, windowSeconds],
    );
    return rows[0].hits > limit;
  } catch {
    return false; // never lock people out because the limiter itself failed
  }
}

export function clientIp(request) {
  return (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
}
