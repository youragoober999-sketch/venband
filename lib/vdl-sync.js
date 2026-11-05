// Supabase -> VDL account sync.
//
// Pulls every auth user + profile through the service-role-only
// public.vdl_export_accounts() RPC and mirrors them into vdl_users with the
// SAME id, email, username and bcrypt password hash, so:
//   * every existing account can sign in to VDL with its current password
//   * later migration phases keep all foreign keys (messages, servers, ...) intact
//
// Runs in resumable pages: each call works for up to `budgetMs`, saves its
// cursor on the vdl_sync_runs row, and the next call (console or cron) resumes.
import { sql } from './vdl-db.js';

const PAGE = 500;
const MAX_CONFLICTS_KEPT = 200;

export function supabaseAdminConfig() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
  return url && key ? { url, key } : null;
}

async function supaRpc(fn, args) {
  const cfg = supabaseAdminConfig();
  if (!cfg) throw Object.assign(new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on Vercel to sync accounts.'), { status: 503 });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const r = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: cfg.key, authorization: `Bearer ${cfg.key}`, 'content-type': 'application/json' },
      body: JSON.stringify(args || {}),
      signal: ctrl.signal,
    });
    const text = await r.text();
    if (!r.ok) {
      let msg = text;
      try { msg = JSON.parse(text).message || text; } catch {}
      if (/could not find the function/i.test(msg)) msg = `Supabase is missing ${fn}(). Run supabase/migrations/20261104010000_vdl_account_export.sql in the Supabase SQL editor.`;
      throw Object.assign(new Error(msg), { status: 502 });
    }
    return text ? JSON.parse(text) : null;
  } finally { clearTimeout(t); }
}

/** Write a status/badge change back to Supabase so the next sync doesn't undo it. */
export async function writeThroughProfile(id, patch) {
  const cfg = supabaseAdminConfig();
  if (!cfg) return { skipped: true };
  const r = await fetch(`${cfg.url}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { apikey: cfg.key, authorization: `Bearer ${cfg.key}`, 'content-type': 'application/json', prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw Object.assign(new Error(`Saved in VDL, but Supabase rejected the change: ${(await r.text()).slice(0, 200)}`), { status: 502 });
  return { ok: true };
}

const str = (v) => (typeof v === 'string' && v.trim() ? v : null);

function toRecord(row) {
  const a = row.auth || {};
  const p = row.profile || {};
  const id = row.id;
  return {
    id,
    email: str(a.email)?.toLowerCase() ?? null,
    password_hash: str(a.encrypted_password),
    username: (str(p.username) || `user_${id.slice(0, 8)}`).toLowerCase(),
    display_name: (str(p.display_name) || str(p.username) || `user_${id.slice(0, 8)}`).slice(0, 32),
    avatar_color: /^#[0-9a-fA-F]{6}$/.test(p.avatar_color || '') ? p.avatar_color : '#5865f2',
    badges: Array.isArray(p.badges) ? p.badges.map(String) : [],
    platform_role: str(p.platform_role) || 'user',
    account_status: str(p.account_status) || 'active',
    created_at: a.created_at || p.created_at || null,
    last_sign_in_at: a.last_sign_in_at || null,
    email_verified_at: a.email_confirmed_at || null,
    phone: str(a.phone),
    is_anonymous: Boolean(a.is_anonymous),
    mfa_enabled: Boolean(row.mfa_enabled),
    avatar_url: str(p.avatar_url),
    about: typeof p.about === 'string' ? p.about : '',
    pronouns: typeof p.pronouns === 'string' ? p.pronouns : '',
    language: typeof p.language === 'string' ? p.language : '',
    disposable: Boolean(p.disposable),
    expires_at: p.expires_at || null,
    banned_until: a.banned_until || null,
    providers: Array.isArray(a.providers) ? a.providers.map(String) : [],
    profile: p,
  };
}

/** Upsert one page of records. Returns counts plus records skipped for uniqueness conflicts. */
async function upsertPage(records) {
  if (!records.length) return { inserted: 0, updated: 0, conflicts: [] };
  const ids = records.map((r) => r.id);
  const emails = records.map((r) => r.email).filter(Boolean);
  const usernames = records.map((r) => r.username);

  // A *different* VDL account already owns this email/username (e.g. a console-only account).
  const { rows: clashes } = await sql.query(
    `select id, lower(email) as email, lower(username) as username, source from vdl_users
      where id <> all($1::uuid[]) and (lower(email) = any($2::text[]) or lower(username) = any($3::text[]))`,
    [ids, emails, usernames],
  );
  const byEmail = new Map(clashes.filter((c) => c.email).map((c) => [c.email, c]));
  const byUser = new Map(clashes.map((c) => [c.username, c]));
  const conflicts = [];
  const ok = [];
  for (const r of records) {
    const e = r.email && byEmail.get(r.email);
    const u = byUser.get(r.username);
    if (e || u) conflicts.push({ id: r.id, email: r.email, username: r.username, reason: e ? 'email already used by another VDL account' : 'username already used by another VDL account', other_id: (e || u).id });
    else ok.push(r);
  }
  if (!ok.length) return { inserted: 0, updated: 0, conflicts };

  const { rows } = await sql.query(
    `insert into vdl_users as v (id, email, password_hash, password_scheme, username, display_name, avatar_color, badges, platform_role,
        account_status, created_at, last_sign_in_at, source, email_verified_at, phone, is_anonymous, mfa_enabled, avatar_url, about,
        pronouns, language, disposable, expires_at, banned_until, providers, profile, supabase_synced_at, upstream_deleted_at, updated_at)
     select r.id, r.email, r.password_hash, 'supabase', r.username, r.display_name, r.avatar_color, coalesce(r.badges, '{}'), r.platform_role,
        r.account_status, coalesce(r.created_at, now()), r.last_sign_in_at, 'supabase', r.email_verified_at, r.phone, r.is_anonymous, r.mfa_enabled,
        r.avatar_url, coalesce(r.about, ''), coalesce(r.pronouns, ''), coalesce(r.language, ''), r.disposable, r.expires_at, r.banned_until,
        coalesce(r.providers, '{}'), coalesce(r.profile, '{}'::jsonb), now(), null, now()
       from jsonb_to_recordset($1::jsonb) as r(id uuid, email text, password_hash text, username text, display_name text, avatar_color text,
            badges text[], platform_role text, account_status text, created_at timestamptz, last_sign_in_at timestamptz,
            email_verified_at timestamptz, phone text, is_anonymous boolean, mfa_enabled boolean, avatar_url text, about text,
            pronouns text, language text, disposable boolean, expires_at timestamptz, banned_until timestamptz, providers text[], profile jsonb)
     on conflict (id) do update set
        email = excluded.email, password_hash = excluded.password_hash, password_scheme = 'supabase', username = excluded.username,
        display_name = excluded.display_name, avatar_color = excluded.avatar_color, badges = excluded.badges,
        platform_role = excluded.platform_role, account_status = excluded.account_status, created_at = excluded.created_at,
        last_sign_in_at = greatest(v.last_sign_in_at, excluded.last_sign_in_at), source = 'supabase',
        email_verified_at = excluded.email_verified_at, phone = excluded.phone, is_anonymous = excluded.is_anonymous,
        mfa_enabled = excluded.mfa_enabled, avatar_url = excluded.avatar_url, about = excluded.about, pronouns = excluded.pronouns,
        language = excluded.language, disposable = excluded.disposable, expires_at = excluded.expires_at,
        banned_until = excluded.banned_until, providers = excluded.providers, profile = excluded.profile,
        supabase_synced_at = now(), upstream_deleted_at = null, updated_at = now()
     returning (xmax = 0) as inserted`,
    [JSON.stringify(ok)],
  );
  const inserted = rows.filter((r) => r.inserted).length;
  return { inserted, updated: rows.length - inserted, conflicts };
}

/** Start a new run, or resume the newest unfinished one. */
export async function startOrResumeRun({ actor = null, trigger = 'manual', fresh = false } = {}) {
  if (!fresh) {
    const { rows } = await sql`select * from vdl_sync_runs where status = 'running' and started_at > now() - interval '1 day' order by started_at desc limit 1`;
    if (rows[0]) return rows[0];
  }
  await sql`update vdl_sync_runs set status = 'abandoned', finished_at = now() where status = 'running'`;
  let total = null;
  try { total = Number(await supaRpc('vdl_export_count', {})); } catch (e) { if (e.status === 503) throw e; }
  const { rows: [run] } = await sql`insert into vdl_sync_runs (started_by, trigger, total) values (${actor}, ${trigger}, ${total}) returning *`;
  return run;
}

/** Work on a run for up to budgetMs. Returns the updated run row. */
export async function stepRun(runId, budgetMs = 40_000) {
  const started = Date.now();
  let { rows: [run] } = await sql`select * from vdl_sync_runs where id = ${runId}`;
  if (!run) throw Object.assign(new Error('sync run not found'), { status: 404 });
  if (run.status !== 'running') return run;
  let cursor = run.cursor;
  let done = false;
  let scanned = 0, inserted = 0, updated = 0;
  let conflicts = Array.isArray(run.conflicts) ? run.conflicts : [];
  try {
    while (Date.now() - started < budgetMs) {
      const page = await supaRpc('vdl_export_accounts', { p_after: cursor, p_limit: PAGE });
      if (!Array.isArray(page) || !page.length) { done = true; break; }
      const res = await upsertPage(page.map(toRecord));
      scanned += page.length; inserted += res.inserted; updated += res.updated;
      conflicts = conflicts.concat(res.conflicts).slice(0, MAX_CONFLICTS_KEPT);
      cursor = page[page.length - 1].id;
      await sql`update vdl_sync_runs set cursor = ${cursor}, scanned = scanned + ${page.length}, inserted = inserted + ${res.inserted}, updated = updated + ${res.updated}, conflicts = ${JSON.stringify(conflicts)}::jsonb where id = ${runId}`;
      scanned = inserted = updated = 0;
      if (page.length < PAGE) { done = true; break; }
    }
    if (done) {
      // accounts that were mirrored before but no longer exist in Supabase: flag, never auto-delete
      const { rowCount } = await sql`update vdl_users set upstream_deleted_at = now() where source = 'supabase' and upstream_deleted_at is null and (supabase_synced_at is null or supabase_synced_at < ${run.started_at})`;
      await sql`update vdl_sync_runs set status = 'done', finished_at = now(), upstream_deleted = ${rowCount} where id = ${runId}`;
    }
  } catch (e) {
    await sql`update vdl_sync_runs set status = 'failed', error = ${String(e?.message || e).slice(0, 500)}, finished_at = now() where id = ${runId}`;
    throw e;
  }
  ({ rows: [run] } = await sql`select * from vdl_sync_runs where id = ${runId}`);
  return run;
}
