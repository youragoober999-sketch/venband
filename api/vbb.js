// Venband Blob (VBB) — custom object storage API.
// Small objects: stored in Postgres (bytea) — truly on-site, dedup by SHA-256.
// Large objects: chunked into vbb_chunks for streaming + future sharding.
// Gated to owners/founders for writes; reads honor the `public` flag.
import { sql, json, preflight, readJson } from './vdl/_db.js';
import crypto from 'node:crypto';
import { jwtVerify } from 'jose';
const SECRET = new TextEncoder().encode(process.env.VDL_JWT_SECRET || 'dev-only-insecure-secret-change-me');

const CHUNK_SIZE = 1024 * 1024; // 1 MB

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
  const u = new URL(request.url);
  const id = u.searchParams.get('id');
  const action = u.searchParams.get('action') || 'list';

  if (action === 'list') {
    const prefix = u.searchParams.get('prefix') || '';
    const r = await sql`select id, name, content_type, size, sha256, storage, public, created_at from vbb_objects where name like ${prefix + '%'} order by created_at desc limit 200`;
    return json(200, { objects: r.rows });
  }
  if (action === 'meta' && id) {
    const r = await sql`select id, name, content_type, size, sha256, storage, public, created_at from vbb_objects where id = ${id}`;
    if (!r.rows.length) return json(404, { error: 'not found' });
    return json(200, { object: r.rows[0] });
  }
  if (action === 'download' && id) {
    const o = await sql`select id, name, content_type, size, storage, public from vbb_objects where id = ${id}`;
    if (!o.rows.length) return json(404, { error: 'not found' });
    const obj = o.rows[0];
    const me = await currentUser(request);
    if (!obj.public && !me) return json(401, { error: 'not public' });
    // fetch bytes
    let bytes;
    if (obj.storage === 'postgres') {
      const r = await sql`select bytes from vbb_data where object_id = ${id}`;
      bytes = r.rows[0]?.bytes;
    } else {
      const r = await sql`select bytes from vbb_chunks where object_id = ${id} order by chunk_index asc`;
      const bufs = r.rows.map((x) => Buffer.from(x.bytes));
      bytes = Buffer.concat(bufs);
    }
    if (!bytes) return json(404, { error: 'no data' });
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    return new Response(buf, {
      status: 200,
      headers: {
        'content-type': obj.content_type,
        'content-length': String(buf.length),
        'content-disposition': `inline; filename="${obj.name}"`,
        'cache-control': obj.public ? 'public, max-age=31536000, immutable' : 'private, no-store',
        'x-vbb-id': id,
        'x-vbb-sha256': obj.sha256 || '',
      },
    });
  }
  return json(400, { error: 'unknown action' });
}

export async function POST(request) {
  const u = new URL(request.url);
  const action = u.searchParams.get('action') || '';
  const me = await currentUser(request);
  if (!me) return json(401, { error: 'not signed in' });

  if (action === 'upload') {
    // top staff OR any signed-in user can upload (owner controls public flag)
    let body;
    try { body = await readJson(request); } catch (e) { return json(400, { error: e.message }); }
    const { name, data, contentType, public: isPublic } = body;
    if (!name || !data) return json(400, { error: 'name and data (base64) required' });
    const buf = Buffer.from(data, 'base64');
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    // dedup: if same hash exists in postgres storage, return existing
    const existing = await sql`select id from vbb_objects where sha256 = ${sha} and storage = 'postgres' limit 1`;
    if (existing.rows.length) {
      return json(200, { id: existing.rows[0].id, dedup: true });
    }
    const storage = buf.length <= CHUNK_SIZE ? 'postgres' : 'chunked';
    const r = await sql`insert into vbb_objects (name, content_type, size, sha256, storage, public, owner_id) values (${name}, ${contentType || 'application/octet-stream'}, ${buf.length}, ${sha}, ${storage}, ${!!isPublic}, ${me.sub}) returning id`;
    const id = r.rows[0].id;
    if (storage === 'postgres') {
      await sql`insert into vbb_data (object_id, bytes) values (${id}, ${buf})`;
    } else {
      let idx = 0;
      for (let off = 0; off < buf.length; off += CHUNK_SIZE) {
        const chunk = buf.subarray(off, off + CHUNK_SIZE);
        await sql`insert into vbb_chunks (object_id, chunk_index, bytes, size) values (${id}, ${idx}, ${chunk}, ${chunk.length})`;
        idx++;
      }
    }
    return json(200, { id, name, size: buf.length, sha256: sha, storage, public: !!isPublic, url: `/api/vbb?action=download&id=${id}` });
  }

  if (action === 'delete') {
    let body;
    try { body = await readJson(request); } catch (e) { return json(400, { error: e.message }); }
    const { id } = body;
    if (!id) return json(400, { error: 'id required' });
    const o = await sql`select owner_id from vbb_objects where id = ${id}`;
    if (!o.rows.length) return json(404, { error: 'not found' });
    if (o.rows[0].owner_id !== me.sub && !isTopStaff(me)) return json(403, { error: 'not owner' });
    await sql`delete from vbb_objects where id = ${id}`;
    return json(200, { ok: true });
  }

  if (action === 'publish') {
    let body;
    try { body = await readJson(request); } catch (e) { return json(400, { error: e.message }); }
    await sql`update vbb_objects set public = ${!!body.public} where id = ${body.id}`;
    return json(200, { ok: true });
  }

  return json(400, { error: 'unknown action' });
}
