// Vercel Function: free, on-site file storage backed by Vercel Blob.
// Only owners/founders (verified via Supabase session) may use it.
// Requires BLOB_READ_WRITE_TOKEN (auto-set when you add a Blob store in Vercel).
import { list, put, del } from '@vercel/blob';
import { json, preflight, readJson } from './_lib/rpc.js';

const URL_ = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

async function isTopStaff(jwt) {
  // try VDL first
  try {
    const { jwtVerify } = await import('jose');
    const SECRET = process.env.VDL_JWT_SECRET ? new TextEncoder().encode(process.env.VDL_JWT_SECRET) : null;
    const { payload } = await jwtVerify(jwt, SECRET);
    const role = payload.role || payload.platform_role;
    const badges = payload.badges || [];
    return role === 'owner' || badges.includes('owner') || badges.includes('founder');
  } catch {}
  // fall back to Supabase
  const rpcRes = await fetch(`${URL_}/rest/v1/rpc/is_top_staff`, {
    method: 'POST',
    headers: { apikey: ANON, authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: '{}',
  });
  return rpcRes.ok && (await rpcRes.json()) === true;
}

export function OPTIONS() { return preflight(); }

export async function GET(request) {
  const u = new URL(request.url);
  const auth = request.headers.get('authorization') || '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!jwt) return json(401, { error: 'missing session' });
  let ok = false;
  try {
    const { jwtVerify } = await import('jose');
    const SECRET = process.env.VDL_JWT_SECRET ? new TextEncoder().encode(process.env.VDL_JWT_SECRET) : null;
    await jwtVerify(jwt, SECRET);
    ok = true;
  } catch {
    const userRes = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, authorization: `Bearer ${jwt}` } });
    ok = userRes.ok;
  }
  if (!ok) return json(401, { error: 'invalid session' });
  if (!(await isTopStaff(jwt))) return json(403, { error: 'top staff only' });

  const prefix = u.searchParams.get('prefix') || '';
  try {
    const r = await list({ prefix, limit: 200 });
    return json(200, { blobs: r.blobs, cursor: r.cursor, hasMore: r.hasMore });
  } catch (e) {
    return json(500, { error: String(e.message || e) });
  }
}

export async function POST(request) {
  const auth = request.headers.get('authorization') || '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!jwt) return json(401, { error: 'missing session' });
  let ok = false;
  try {
    const { jwtVerify } = await import('jose');
    const SECRET = process.env.VDL_JWT_SECRET ? new TextEncoder().encode(process.env.VDL_JWT_SECRET) : null;
    await jwtVerify(jwt, SECRET);
    ok = true;
  } catch {
    const userRes = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, authorization: `Bearer ${jwt}` } });
    ok = userRes.ok;
  }
  if (!ok) return json(401, { error: 'invalid session' });
  if (!(await isTopStaff(jwt))) return json(403, { error: 'top staff only' });

  let body;
  try { body = await readJson(request); } catch (e) { return json(400, { error: e.message }); }

  if (body.action === 'upload') {
    const { pathname, data, contentType } = body;
    if (!pathname || !data) return json(400, { error: 'pathname and data required' });
    try {
      const buf = Buffer.from(data, 'base64');
      const blob = await put(pathname, buf, { access: 'public', contentType: contentType || 'application/octet-stream', addRandomSuffix: false });
      return json(200, { blob });
    } catch (e) {
      return json(500, { error: String(e.message || e) });
    }
  }
  if (body.action === 'delete') {
    if (!body.url) return json(400, { error: 'url required' });
    try {
      await del(body.url);
      return json(200, { ok: true });
    } catch (e) {
      return json(500, { error: String(e.message || e) });
    }
  }
  return json(400, { error: 'unknown action' });
}
