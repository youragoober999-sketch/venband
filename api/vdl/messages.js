// VDL messages: list (poll) + send, with KV hot-cache for speed.
import { sql, json, preflight, readJson } from './_db.js';
import { kv } from '@vercel/kv';
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
  const u = new URL(request.url);
  const channel = u.searchParams.get('channel');
  const since = u.searchParams.get('since');
  if (!channel) return json(400, { error: 'channel required' });
  const cacheKey = `vdl:msgs:${channel}`;
  // try KV cache first
  let cached = null;
  try { cached = await kv.get(cacheKey); } catch {}
  let rows;
  if (cached && Array.isArray(cached) && cached.length) {
    rows = since ? cached.filter((m) => new Date(m.created_at) > new Date(since)) : cached;
  } else {
    const r = since
      ? await sql`select m.id, m.content, m.created_at, m.author_id, u.username, u.display_name, u.avatar_color from vdl_messages m left join vdl_users u on u.id = m.author_id where m.channel_id = ${channel} and m.created_at > ${since} order by m.created_at asc limit 100`
      : await sql`select m.id, m.content, m.created_at, m.author_id, u.username, u.display_name, u.avatar_color from vdl_messages m left join vdl_users u on u.id = m.author_id where m.channel_id = ${channel} order by m.created_at asc limit 100`;
    rows = r.rows;
    try { await kv.set(cacheKey, rows, { ex: 30 }); } catch {}
  }
  return json(200, { messages: rows });
}

export async function POST(request) {
  const me = await currentUser(request);
  if (!me) return json(401, { error: 'not signed in' });
  let body;
  try { body = await readJson(request); } catch (e) { return json(400, { error: e.message }); }
  const { channel_id, content } = body;
  if (!channel_id || !content) return json(400, { error: 'channel_id and content required' });
  const r = await sql`insert into vdl_messages (channel_id, author_id, content) values (${channel_id}, ${me.sub}, ${content}) returning id, content, created_at`;
  // invalidate cache
  try { await kv.del(`vdl:msgs:${channel_id}`); } catch {}
  return json(200, { message: { ...r.rows[0], author_id: me.sub } });
}
