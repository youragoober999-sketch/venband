export const COOKIE = 'vdl_session';
export function cookieHeader(token, maxAge) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAge) parts.push(`Max-Age=${maxAge}`);
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

// Lazy schema init: creates all tables on first use (no manual setup).
// Each statement runs separately because Neon serverless executes one statement per request.
const SCHEMA_STMTS = [
  `create table if not exists vdl_users (id uuid primary key default gen_random_uuid(), email text unique not null, password_hash text not null, username text unique not null, display_name text, avatar_color text not null default '#5865f2', badges text[] not null default '{}', platform_role text not null default 'user', account_status text not null default 'active', created_at timestamptz not null default now(), last_sign_in_at timestamptz)`,
  `create table if not exists vdl_servers (id uuid primary key default gen_random_uuid(), name text not null, owner_id uuid references vdl_users(id) on delete cascade, icon_color text not null default '#5865f2', status text not null default 'active', verified boolean not null default false, description text not null default '', members integer not null default 1, created_at timestamptz not null default now())`,
  `create table if not exists vdl_channels (id uuid primary key default gen_random_uuid(), server_id uuid references vdl_servers(id) on delete cascade, name text not null, type text not null default 'text', created_at timestamptz not null default now())`,
  `create table if not exists vdl_messages (id uuid primary key default gen_random_uuid(), channel_id uuid references vdl_channels(id) on delete cascade, author_id uuid references vdl_users(id) on delete cascade, content text not null, created_at timestamptz not null default now())`,
  `create index if not exists vdl_messages_channel_idx on vdl_messages(channel_id, created_at)`,
  `create table if not exists vdl_memberships (user_id uuid references vdl_users(id) on delete cascade, server_id uuid references vdl_servers(id) on delete cascade, primary key (user_id, server_id))`,
  `create table if not exists vdl_audit_log (id uuid primary key default gen_random_uuid(), actor_id uuid, action text not null, target_user uuid, target_server uuid, detail text, reason text, created_at timestamptz not null default now())`,
  `create table if not exists vdl_outbound_emails (id uuid primary key default gen_random_uuid(), to_addr text not null, subject text not null, body text not null, status text not null default 'queued', error text, sent_at timestamptz, created_by uuid, created_at timestamptz not null default now())`,
  `create table if not exists vdl_ledger (id uuid primary key default gen_random_uuid(), seq bigint not null, prev_hash text not null, hash text not null, payload text not null, created_at timestamptz not null default now(), created_by uuid)`,
  `create unique index if not exists vdl_ledger_seq_idx on vdl_ledger(seq)`,
  `create table if not exists vbb_objects (id uuid primary key default gen_random_uuid(), name text not null, content_type text not null default 'application/octet-stream', size bigint not null default 0, sha256 text not null, storage text not null default 'postgres', public boolean not null default false, owner_id uuid, status text not null default 'complete', created_at timestamptz not null default now(), updated_at timestamptz not null default now())`,
  `create table if not exists vbb_data (object_id uuid primary key references vbb_objects(id) on delete cascade, bytes bytea not null)`,
  `create table if not exists vbb_chunks (id uuid primary key default gen_random_uuid(), object_id uuid references vbb_objects(id) on delete cascade, chunk_index integer not null, bytes bytea, blob_url text, size integer not null, unique (object_id, chunk_index))`,
  `create table if not exists vbb_uploads (id uuid primary key default gen_random_uuid(), name text not null, content_type text not null default 'application/octet-stream', size bigint not null, chunk_size integer not null default 3145728, total_chunks integer not null, public boolean not null default false, owner_id uuid, status text not null default 'uploading', sha256 text, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`,
  `create table if not exists vbb_shards (id serial primary key, subdomain text not null unique, base_url text not null, capacity_bytes bigint not null default 0, used_bytes bigint not null default 0, active boolean not null default true, created_at timestamptz not null default now())`,
  `create table if not exists vdl_qr_sessions (id uuid primary key default gen_random_uuid(), token text unique not null, status text not null default 'pending', device_info text, approver_id uuid, expires_at timestamptz not null, created_at timestamptz not null default now())`,
];

export async function ensureSchema() {
  // check KV flag
  try {
    const { kv } = await import('@vercel/kv');
    const done = await kv.get('vdl:schema:init');
    if (done) return;
  } catch {}
  const { sql } = await import('@vercel/postgres');
  for (const stmt of SCHEMA_STMTS) {
    try { await sql.query(stmt); } catch (e) { /* ignore (already exists / transient) */ }
  }
  try {
    const { kv } = await import('@vercel/kv');
    await kv.set('vdl:schema:init', '1');
  } catch {}
}

// Re-export sql for modules that import from this file
import { sql } from '@vercel/postgres';
export { sql };

export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export function preflight() {
  return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-credentials': 'true' } });
}

export async function readJson(request) {
  const text = await request.text();
  if (!text) return {};
  const v = JSON.parse(text);
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('body must be a JSON object');
  return v;
}