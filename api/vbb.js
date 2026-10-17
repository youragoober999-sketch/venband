// Venband Blob (VBB) — custom object storage API.
// Small objects: stored in Postgres (bytea) — truly on-site, deduped by SHA-256.
// Large objects: chunked (3 MB parts) uploaded in parallel, stored in Vercel Blob,
//   with a manifest in Postgres. Supports files up to 5 GB+.
// Gated to signed-in users for writes; reads honor the `public` flag.
import { sql, json, preflight, readJson, ensureSchema } from './vdl/_db.js';
import crypto from 'node:crypto';
import { jwtVerify } from 'jose';
import { put, del } from '@vercel/blob';
const SECRET = new TextEncoder().encode(process.env.VDL_JWT_SECRET || 'dev-only-insecure-secret-change-me');

const CHUNK_SIZE = 3 * 1024 * 1024; // 3 MB (safe under Vercel's 4.5 MB body limit)
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5 GB

async function currentUser(request) {
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(/vdl_session=([^;]+)/);
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const token = m ? m[1] : bearer;
  if (!token) return null;
  // 1. try VDL JWT
  try { const { payload } = await jwtVerify(token, SECRET); return payload; } catch {}
  // 2. fall back to Supabase session (verify via Supabase Auth)
  try {
    const URL_ = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
    const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
    const r = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = await r.json();
    return { sub: u.id, email: u.email, role: 'user', badges: [], platform_role: 'user' };
  } catch { return null; }
}
function isTopStaff(u) { return u && (u.role === 'owner' || (Array.isArray(u.badges) && (u.badges.includes('owner') || u.badges.includes('founder')))); }

function toBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (typeof bytes === 'string') {
    if (bytes.startsWith('\\x')) return Buffer.from(bytes.slice(2), 'hex');
    return Buffer.from(bytes, 'base64');
  }
  return Buffer.from(bytes);
}

export function OPTIONS() { return preflight(); }

export async function GET(request) {
  await ensureSchema();
  const u = new URL(request.url);
  if (u.searchParams.get('r') === 'shards') {
    const me = await currentUser(request);
    if (!me || !isTopStaff(me)) return json(403, { error: 'top staff only' });
    const r = await sql`select * from vbb_shards order by id asc`;
    return json(200, { shards: r.rows });
  }
  const id = u.searchParams.get('id');
  const action = u.searchParams.get('action') || 'list';

  if (action === 'list') {
    const me = await currentUser(request);
    if (!me) return json(401, { error: 'not signed in' });
    const prefix = u.searchParams.get('prefix') || '';
    // KV cache for list (5s TTL) for speed
    let cached = null;
    try { const { kv } = await import('@vercel/kv'); cached = await kv.get(`vbb:list:${prefix}`); } catch {}
    if (cached) return json(200, { objects: cached, cached: true });
    const r = await sql`select id, name, content_type, size, sha256, storage, public, status, created_at from vbb_objects where name like ${prefix + '%'} order by created_at desc limit 200`;
    try { const { kv } = await import('@vercel/kv'); await kv.set(`vbb:list:${prefix}`, r.rows, { ex: 5 }); } catch {}
    return json(200, { objects: r.rows });
  }
  if (action === 'meta' && id) {
    const r = await sql`select id, name, content_type, size, sha256, storage, public, status, created_at from vbb_objects where id = ${id}`;
    if (!r.rows.length) return json(404, { error: 'not found' });
    return json(200, { object: r.rows[0] });
  }
  if (action === 'download' && id) {
    const o = await sql`select id, name, content_type, size, storage, public, status from vbb_objects where id = ${id}`;
    if (!o.rows.length) return json(404, { error: 'not found' });
    const obj = o.rows[0];
    const me = await currentUser(request);
    if (!obj.public && !me) return json(401, { error: 'not public' });
    if (obj.status !== 'complete') return json(409, { error: 'upload not complete' });
    // stream chunks
    const r = await sql`select chunk_index, bytes, blob_url, size from vbb_chunks where object_id = ${id} order by chunk_index asc`;
    if (r.rows.length) {
      const rows = r.rows;
      const totalSize = rows.reduce((a, c) => a + (c.size || 0), 0);
      const stream = new ReadableStream({
        async start(controller) {
          try {
            for (const row of rows) {
              let buf;
              if (row.blob_url) {
                const res = await fetch(row.blob_url);
                buf = Buffer.from(await res.arrayBuffer());
              } else {
                buf = toBuffer(row.bytes);
              }
              controller.enqueue(new Uint8Array(buf));
            }
            controller.close();
          } catch (e) {
            controller.error(e);
          }
        },
      });
      return new Response(stream, {
        status: 200,
        headers: {
          'content-type': obj.content_type,
          'content-length': String(totalSize),
          'content-disposition': `inline; filename="${obj.name}"`,
          'cache-control': obj.public ? 'public, max-age=31536000, immutable' : 'private, no-store',
          'x-vbb-id': id,
          'transfer-encoding': 'chunked',
        },
      });
    }
    // single postgres object
    const r2 = await sql`select bytes from vbb_data where object_id = ${id}`;
    if (!r2.rows.length) return json(404, { error: 'no data' });
    const buf = toBuffer(r2.rows[0].bytes);
    return new Response(buf, {
      status: 200,
      headers: {
        'content-type': obj.content_type,
        'content-length': String(buf.length),
        'content-disposition': `inline; filename="${obj.name}"`,
        'cache-control': obj.public ? 'public, max-age=31536000, immutable' : 'private, no-store',
        'x-vbb-id': id,
      },
    });
  }
  if (action === 'chunk-status' && id) {
    const r = await sql`select chunk_index, size from vbb_chunks where object_id = ${id} order by chunk_index asc`;
    const up = await sql`select total_chunks from vbb_uploads where id = ${id}`;
    return json(200, { chunks: r.rows, total: up.rows[0]?.total_chunks ?? 0 });
  }
  return json(400, { error: 'unknown action' });
}

export async function POST(request) {
  await ensureSchema();
  const u = new URL(request.url);
  if (u.searchParams.get('r') === 'shards') {
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
  const action = u.searchParams.get('action') || '';
  const me = await currentUser(request);
  if (!me) return json(401, { error: 'not signed in' });

  // ---- single-shot upload (small files) ----
  if (action === 'upload') {
    let body;
    try { body = await readJson(request); } catch (e) { return json(400, { error: e.message }); }
    const { name, data, contentType, public: isPublic } = body;
    if (!name || !data) return json(400, { error: 'name and data (base64) required' });
    const buf = Buffer.from(data, 'base64');
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const existing = await sql`select id from vbb_objects where sha256 = ${sha} and storage = 'postgres' limit 1`;
    if (existing.rows.length) return json(200, { id: existing.rows[0].id, dedup: true });
    const storage = buf.length <= CHUNK_SIZE ? 'postgres' : 'chunked';
    const r = await sql`insert into vbb_objects (name, content_type, size, sha256, storage, public, owner_id, status) values (${name}, ${contentType || 'application/octet-stream'}, ${buf.length}, ${sha}, ${storage}, ${!!isPublic}, ${me.sub}, 'complete') returning id`;
    const id = r.rows[0].id;
    if (storage === 'postgres') {
      await sql`insert into vbb_data (object_id, bytes) values (${id}, ${buf})`;
    } else {
      // chunk it
      let idx = 0;
      for (let off = 0; off < buf.length; off += CHUNK_SIZE) {
        const chunk = buf.subarray(off, off + CHUNK_SIZE);
        await sql`insert into vbb_chunks (object_id, chunk_index, bytes, size) values (${id}, ${idx}, ${chunk}, ${chunk.length})`;
        idx++;
      }
    }
    try { const { kv } = await import('@vercel/kv'); await kv.del('vbb:list:'); } catch {}
    return json(200, { id, name, size: buf.length, sha256: sha, storage, public: !!isPublic, url: `/api/vbb?action=download&id=${id}` });
  }

  // ---- chunked upload: init ----
  if (action === 'init-chunked') {
    let body;
    try { body = await readJson(request); } catch (e) { return json(400, { error: e.message }); }
    const { name, size, contentType, public: isPublic } = body;
    if (!name || !size) return json(400, { error: 'name and size required' });
    if (size > MAX_FILE_SIZE) return json(413, { error: 'file too large (max 5 GB)' });
    const totalChunks = Math.ceil(size / CHUNK_SIZE);
    const r = await sql`insert into vbb_uploads (name, content_type, size, chunk_size, total_chunks, public, owner_id) values (${name}, ${contentType || 'application/octet-stream'}, ${size}, ${CHUNK_SIZE}, ${totalChunks}, ${!!isPublic}, ${me.sub}) returning id`;
    return json(200, { uploadId: r.rows[0].id, chunkSize: CHUNK_SIZE, totalChunks });
  }

  // ---- chunked upload: upload one chunk ----
  if (action === 'upload-chunk') {
    let body;
    try { body = await readJson(request); } catch (e) { return json(400, { error: e.message }); }
    const { uploadId, chunkIndex, data } = body;
    if (!uploadId || chunkIndex == null || !data) return json(400, { error: 'uploadId, chunkIndex, data required' });
    if (chunkIndex < 0) return json(400, { error: 'invalid chunkIndex' });
    const up = await sql`select * from vbb_uploads where id = ${uploadId}`;
    if (!up.rows.length) return json(404, { error: 'upload not found' });
    const u = up.rows[0];
    if (u.owner_id !== me.sub && !isTopStaff(me)) return json(403, { error: 'not owner' });
    if (u.status !== 'uploading') return json(409, { error: 'upload not active' });
    const buf = Buffer.from(data, 'base64');
    // store chunk in Vercel Blob for large-scale; fall back to postgres for small
    let blobUrl = null;
    if (buf.length > 0) {
      try {
        const blob = await put(`vbb/${uploadId}/${chunkIndex}`, buf, { access: 'public', contentType: 'application/octet-stream', addRandomSuffix: false });
        blobUrl = blob.url;
      } catch {
        // fall back: store in postgres
        blobUrl = null;
      }
    }
    await sql`insert into vbb_chunks (object_id, chunk_index, bytes, blob_url, size)
      values (${uploadId}, ${chunkIndex}, ${blobUrl ? null : buf}, ${blobUrl}, ${buf.length})
      on conflict (object_id, chunk_index) do update set bytes = excluded.bytes, blob_url = excluded.blob_url, size = excluded.size`;
    return json(200, { ok: true, chunkIndex, size: buf.length, blobUrl });
  }

  // ---- chunked upload: complete ----
  if (action === 'complete-chunked') {
    let body;
    try { body = await readJson(request); } catch (e) { return json(400, { error: e.message }); }
    const { uploadId } = body;
    if (!uploadId) return json(400, { error: 'uploadId required' });
    const up = await sql`select * from vbb_uploads where id = ${uploadId}`;
    if (!up.rows.length) return json(404, { error: 'upload not found' });
    const u = up.rows[0];
    if (u.owner_id !== me.sub && !isTopStaff(me)) return json(403, { error: 'not owner' });
    if (u.status === 'complete') {
      return json(200, { id: uploadId, name: u.name, size: u.size, sha256: u.sha256, storage: 'chunked', public: u.public, url: `/api/vbb?action=download&id=${uploadId}`, dedup: true });
    }
    const chunks = await sql`select count(*)::int as c from vbb_chunks where object_id = ${uploadId}`;
    if (chunks.rows[0].c < u.total_chunks) return json(409, { error: `missing chunks: ${chunks.rows[0].c}/${u.total_chunks}` });
    // compute sha256 over all chunks
    const all = await sql`select bytes, blob_url, size from vbb_chunks where object_id = ${uploadId} order by chunk_index asc`;
    const hash = crypto.createHash('sha256');
    for (const row of all.rows) {
      if (row.blob_url) {
        const res = await fetch(row.blob_url);
        hash.update(Buffer.from(await res.arrayBuffer()));
      } else {
        hash.update(toBuffer(row.bytes));
      }
    }
    const sha = hash.digest('hex');
    // create the final object record
    const obj = await sql`insert into vbb_objects (id, name, content_type, size, sha256, storage, public, owner_id, status) values (${uploadId}, ${u.name}, ${u.content_type}, ${u.size}, ${sha}, 'chunked', ${u.public}, ${u.owner_id}, 'complete') returning id`;
    // point chunks at the object (they already reference uploadId as object_id)
    await sql`update vbb_uploads set status = 'complete', sha256 = ${sha}, updated_at = now() where id = ${uploadId}`;
    try { const { kv } = await import('@vercel/kv'); await kv.del('vbb:list:'); } catch {}
    return json(200, { id: uploadId, name: u.name, size: u.size, sha256: sha, storage: 'chunked', public: u.public, url: `/api/vbb?action=download&id=${uploadId}` });
  }

  // ---- chunked upload: abort ----
  if (action === 'abort-chunked') {
    let body;
    try { body = await readJson(request); } catch (e) { return json(400, { error: e.message }); }
    const { uploadId } = body;
    if (!uploadId) return json(400, { error: 'uploadId required' });
    const up = await sql`select * from vbb_uploads where id = ${uploadId}`;
    if (!up.rows.length) return json(404, { error: 'upload not found' });
    const u = up.rows[0];
    if (u.owner_id !== me.sub && !isTopStaff(me)) return json(403, { error: 'not owner' });
    // delete chunk blobs
    const chunks = await sql`select blob_url from vbb_chunks where object_id = ${uploadId}`;
    for (const row of chunks.rows) {
      if (row.blob_url) { try { await del(row.blob_url); } catch {} }
    }
    await sql`delete from vbb_chunks where object_id = ${uploadId}`;
    await sql`delete from vbb_uploads where id = ${uploadId}`;
    return json(200, { ok: true });
  }

  // ---- delete ----
  if (action === 'delete') {
    let body;
    try { body = await readJson(request); } catch (e) { return json(400, { error: e.message }); }
    const { id } = body;
    if (!id) return json(400, { error: 'id required' });
    const o = await sql`select owner_id from vbb_objects where id = ${id}`;
    if (!o.rows.length) return json(404, { error: 'not found' });
    if (o.rows[0].owner_id !== me.sub && !isTopStaff(me)) return json(403, { error: 'not owner' });
    // cleanup chunks/blobs
    const chunks = await sql`select blob_url from vbb_chunks where object_id = ${id}`;
    for (const row of chunks.rows) { if (row.blob_url) { try { await del(row.blob_url); } catch {} } }
    await sql`delete from vbb_objects where id = ${id}`;
    try { const { kv } = await import('@vercel/kv'); await kv.del('vbb:list:'); } catch {}
    return json(200, { ok: true });
  }

  // ---- publish toggle ----
  if (action === 'publish') {
    let body;
    try { body = await readJson(request); } catch (e) { return json(400, { error: e.message }); }
    await sql`update vbb_objects set public = ${!!body.public} where id = ${body.id}`;
    return json(200, { ok: true });
  }

  return json(400, { error: 'unknown action' });
}
