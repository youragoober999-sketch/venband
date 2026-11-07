// VDL — Venband Data Layer. Single consolidated router (Vercel Hobby: max 12 serverless functions).
//
//   GET  /api/vdl?r=<resource>[&...]           read
//   POST /api/vdl?r=<resource>&action=<name>   write (action may also be sent in the JSON body)
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { sql, json, preflight, readJson, ensureSchema, cookieHeader } from '../lib/vdl-db.js';
import { vdlUser, isTopStaff, isBanned, signSession, rateLimited, clientIp, SECRET, SECRET_WEAK, SESSION_TTL, USER_COLUMNS } from '../lib/vdl-auth.js';
import { supabaseAdminConfig, startOrResumeRun, stepRun, writeThroughProfile, importAccountByEmail } from '../lib/vdl-sync.js';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const USERNAME_RE = /^[a-z0-9_.]{2,32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MESSAGE = 4000;
// compared against when the email doesn't exist, so sign-in timing doesn't reveal accounts
let dummyHash = null;
const getDummyHash = async () => (dummyHash ??= await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 11));

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };
const need = (cond, status, message) => { if (!cond) fail(status, message); };
const uuid = (v, name = 'id') => { need(typeof v === 'string' && UUID_RE.test(v), 400, `${name} must be a valid id`); return v; };
const clampInt = (v, def, min, max) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };

async function audit(actor, action, { user = null, server = null, detail = null, reason = null } = {}) {
  try {
    await sql`insert into vdl_audit_log (actor_id, action, target_user, target_server, detail, reason) values (${actor}, ${action}, ${user}, ${server}, ${detail}, ${reason})`;
  } catch (e) { console.warn('[vdl] audit failed', e?.message); }
}

function withSession(body, token) {
  const res = json(200, body);
  res.headers.set('set-cookie', cookieHeader(token, SESSION_TTL));
  return res;
}

function publicUser(u) {
  const { password_hash, ...rest } = u; // eslint-disable-line no-unused-vars
  return rest;
}

/* ------------------------------------------------------------------ GET -- */

const GETS = {
  async health({ me }) {
    const t = Date.now();
    await sql`select 1`;
    const base = { ok: true, db_ms: Date.now() - t };
    if (!isTopStaff(me)) return base;
    return { ...base, jwt_configured: Boolean(SECRET), jwt_weak: SECRET_WEAK, supabase_sync_configured: Boolean(supabaseAdminConfig()), email_configured: Boolean(process.env.RESEND_API_KEY), email_from: process.env.STORAGE_EMAIL_FROM || null };
  },

  async version({ request }) {
    // single source of truth: public/download.json (what the download page already uses)
    try {
      const r = await fetch(new URL('/download.json', request.url), { cache: 'no-store' });
      if (r.ok) {
        const d = await r.json();
        const v = d.latest || d.version;
        return {
          web: { version: v, url: 'https://www.venband.com/' },
          android: { version: v, apk: d.android?.name, url: d.android?.url },
          desktop: { version: v, url: d.url || 'https://github.com/youragoober999-sketch/venband/releases/latest' },
        };
      }
    } catch {}
    fail(503, 'version info unavailable');
  },

  async auth({ me }) {
    need(me, 401, 'not signed in');
    return { user: me };
  },

  async users({ me, q }) {
    need(me, 401, 'not signed in');
    if (!isTopStaff(me)) return { users: [me], total: 1, limit: 1, offset: 0 };
    const { where, params } = userFilters(q);
    const sort = USER_SORTS[q.get('sort')] || USER_SORTS.newest;
    const format = q.get('format');

    if (format === 'csv' || format === 'json') {
      // full export of everything matching the filters (never includes password hashes)
      const { rows } = await sql.query(`select ${USER_COLUMNS}, badges from vdl_users ${where} order by ${sort} limit 200000`, params);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      if (format === 'json') {
        return new Response(JSON.stringify(rows, null, 2), { status: 200, headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="venband-accounts-${stamp}.json"`, 'cache-control': 'no-store' } });
      }
      const cols = ['id', 'username', 'display_name', 'email', 'email_verified_at', 'account_status', 'platform_role', 'badges', 'source', 'is_anonymous', 'disposable', 'mfa_enabled', 'created_at', 'last_sign_in_at', 'upstream_deleted_at'];
      const cell = (v) => {
        if (v === null || v === undefined) return '';
        const s = Array.isArray(v) ? v.join(' ') : v instanceof Date ? v.toISOString() : String(v);
        return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; // also blocks CSV formula injection
      };
      const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
      return new Response('﻿' + csv, { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="venband-accounts-${stamp}.csv"`, 'cache-control': 'no-store' } });
    }

    const limit = clampInt(q.get('limit'), 50, 1, 500);
    const offset = clampInt(q.get('offset'), 0, 0, 10_000_000);
    const p = [...params, limit, offset];
    const [{ rows }, { rows: [facets] }] = await Promise.all([
      sql.query(`select ${USER_COLUMNS}, count(*) over()::int as total from vdl_users ${where} order by ${sort} limit $${p.length - 1} offset $${p.length}`, p),
      sql`select count(*)::int as all,
            count(*) filter (where account_status = 'active')::int as active,
            count(*) filter (where account_status in ('limited', 'very_limited'))::int as limited,
            count(*) filter (where account_status = 'banned' or banned_until > now())::int as banned,
            count(*) filter (where source = 'supabase')::int as supabase,
            count(*) filter (where source <> 'supabase')::int as vdl,
            count(*) filter (where email_verified_at is null and not is_anonymous)::int as unverified,
            count(*) filter (where is_anonymous or disposable)::int as anonymous,
            count(*) filter (where platform_role <> 'user' or cardinality(badges) > 0)::int as staff,
            count(*) filter (where upstream_deleted_at is not null)::int as upstream_deleted,
            count(*) filter (where last_sign_in_at > now() - interval '30 days')::int as active_30d
          from vdl_users`,
    ]);
    const total = rows[0]?.total ?? (offset ? undefined : 0);
    return { users: rows.map(({ total: _t, ...r }) => r), total: total ?? 0, limit, offset, facets };
  },

  async user({ me, q }) {
    need(isTopStaff(me), 403, 'top staff only');
    const id = uuid(q.get('id'));
    const { rows: [u] } = await sql.query(`select ${USER_COLUMNS}, password_scheme, (password_hash is not null) as has_password, phone, about, pronouns, language, providers, profile, updated_at from vdl_users where id = $1`, [id]);
    need(u, 404, 'user not found');
    const [{ rows: history }, { rows: [counts] }] = await Promise.all([
      sql`select a.id, a.action, a.detail, a.reason, a.created_at, actor.username as actor from vdl_audit_log a left join vdl_users actor on actor.id = a.actor_id where a.target_user = ${id} or a.actor_id = ${id} order by a.created_at desc limit 50`,
      sql`select (select count(*)::int from vdl_memberships where user_id = ${id}) as servers, (select count(*)::int from vdl_messages where author_id = ${id}) as messages, (select count(*)::int from vbb_objects where owner_id = ${id}) as files`,
    ]);
    return { user: u, history, counts };
  },

  async sync({ me }) {
    need(isTopStaff(me), 403, 'top staff only');
    const { rows } = await sql`select * from vdl_sync_runs order by started_at desc limit 20`;
    return { configured: Boolean(supabaseAdminConfig()), runs: rows };
  },

  async servers({ me, q }) {
    need(me, 401, 'not signed in');
    const limit = clampInt(q.get('limit'), 100, 1, 500);
    const { rows } = isTopStaff(me)
      ? await sql`select s.id, s.name, s.icon_color, s.status, s.verified, s.description, s.members, s.created_at, u.username as owner_username, s.owner_id from vdl_servers s left join vdl_users u on u.id = s.owner_id order by s.created_at desc limit ${limit}`
      : await sql`select s.id, s.name, s.icon_color, s.status, s.verified, s.description, s.members, s.created_at, u.username as owner_username, s.owner_id from vdl_servers s join vdl_memberships m on m.server_id = s.id and m.user_id = ${me.id} left join vdl_users u on u.id = s.owner_id order by s.created_at desc limit ${limit}`;
    return { servers: rows };
  },

  async messages({ me, q }) {
    need(me, 401, 'not signed in');
    const channel = uuid(q.get('channel'), 'channel');
    await assertChannelAccess(me, channel);
    const since = q.get('since');
    const before = q.get('before');
    const limit = clampInt(q.get('limit'), 100, 1, 200);
    let rows;
    if (since) {
      ({ rows } = await sql`select m.id, m.content, m.created_at, m.author_id, u.username, u.display_name, u.avatar_color from vdl_messages m left join vdl_users u on u.id = m.author_id where m.channel_id = ${channel} and m.created_at > ${since} order by m.created_at asc limit ${limit}`);
    } else if (before) {
      ({ rows } = await sql`select * from (select m.id, m.content, m.created_at, m.author_id, u.username, u.display_name, u.avatar_color from vdl_messages m left join vdl_users u on u.id = m.author_id where m.channel_id = ${channel} and m.created_at < ${before} order by m.created_at desc limit ${limit}) t order by created_at asc`);
    } else {
      // newest page, returned oldest-first (the old code returned the *oldest* 100 forever)
      ({ rows } = await sql`select * from (select m.id, m.content, m.created_at, m.author_id, u.username, u.display_name, u.avatar_color from vdl_messages m left join vdl_users u on u.id = m.author_id where m.channel_id = ${channel} order by m.created_at desc limit ${limit}) t order by created_at asc`);
    }
    return { messages: rows };
  },

  async audit({ me, q }) {
    need(isTopStaff(me), 403, 'top staff only');
    const limit = clampInt(q.get('limit'), 100, 1, 500);
    const { rows } = await sql`select a.id, u.username as actor, a.action, a.detail, a.reason, a.created_at, a.target_user, a.target_server from vdl_audit_log a left join vdl_users u on u.id = a.actor_id order by a.created_at desc limit ${limit}`;
    return { rows };
  },

  async ledger({ me, q }) {
    need(isTopStaff(me), 403, 'top staff only');
    const { rows } = await sql`select id, seq, prev_hash, hash, payload, created_at from vdl_ledger order by seq asc`;
    if (q.get('verify')) return { rows, verify: verifyChain(rows) };
    return { rows };
  },

  async emails({ me }) {
    need(isTopStaff(me), 403, 'top staff only');
    const { rows } = await sql`select * from vdl_outbound_emails order by created_at desc limit 100`;
    return { rows };
  },

  async stats({ me }) {
    need(isTopStaff(me), 403, 'top staff only');
    const { rows } = await sql`select
      (select count(*)::int from vdl_users) as users,
      (select count(*)::int from vdl_users where account_status = 'banned') as banned,
      (select count(*)::int from vdl_users where created_at > now() - interval '7 days') as new_users_7d,
      (select count(*)::int from vdl_servers) as servers,
      (select count(*)::int from vdl_messages) as messages,
      (select count(*)::int from vdl_ledger) as blocks,
      (select count(*)::int from vdl_outbound_emails where status = 'queued') as emails_queued,
      (select count(*)::int from vbb_objects) as objects,
      (select coalesce(sum(size), 0)::bigint from vbb_objects) as object_bytes`;
    return { ...rows[0], object_bytes: Number(rows[0].object_bytes) };
  },
};

const USER_SORTS = {
  newest: 'created_at desc, id',
  oldest: 'created_at asc, id',
  recent_sign_in: 'last_sign_in_at desc nulls last, id',
  username: 'username asc',
  email: 'email asc nulls last, id',
};

/** Build a parameterised WHERE clause from the explorer's filters. */
function userFilters(q) {
  const params = [];
  const where = [];
  const add = (v) => { params.push(v); return `$${params.length}`; };
  const term = (q.get('q') || '').trim().slice(0, 100);
  if (term) {
    if (UUID_RE.test(term)) where.push(`id = ${add(term)}::uuid`);
    else {
      const t = add(`%${term.replace(/[\\%_]/g, (c) => '\\' + c)}%`);
      where.push(`(username ilike ${t} or display_name ilike ${t} or email ilike ${t} or id::text ilike ${t})`);
    }
  }
  const status = q.get('status');
  if (status === 'banned') where.push(`(account_status = 'banned' or banned_until > now())`);
  else if (status === 'limited') where.push(`account_status in ('limited', 'very_limited')`);
  else if (status === 'active') where.push(`account_status = 'active'`);
  const source = q.get('source');
  if (source === 'supabase') where.push(`source = 'supabase'`);
  else if (source === 'vdl') where.push(`source <> 'supabase'`);
  const kind = q.get('kind');
  if (kind === 'unverified') where.push(`email_verified_at is null and not is_anonymous`);
  else if (kind === 'verified') where.push(`email_verified_at is not null`);
  else if (kind === 'anonymous') where.push(`(is_anonymous or disposable)`);
  else if (kind === 'staff') where.push(`(platform_role <> 'user' or cardinality(badges) > 0)`);
  else if (kind === 'mfa') where.push(`mfa_enabled`);
  else if (kind === 'upstream_deleted') where.push(`upstream_deleted_at is not null`);
  else if (kind === 'active_30d') where.push(`last_sign_in_at > now() - interval '30 days'`);
  const since = q.get('created_after');
  if (since && !Number.isNaN(Date.parse(since))) where.push(`created_at >= ${add(since)}::timestamptz`);
  return { where: where.length ? 'where ' + where.join(' and ') : '', params };
}

function verifyChain(rows) {
  let prev = '0'.repeat(64);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const expected = crypto.createHash('sha256').update(prev + r.payload).digest('hex');
    if (Number(r.seq) !== i + 1 || r.prev_hash !== prev || r.hash !== expected) return { ok: false, broken_at: Number(r.seq), blocks: rows.length };
    prev = r.hash;
  }
  return { ok: true, blocks: rows.length, head: prev };
}

async function assertChannelAccess(me, channelId) {
  if (isTopStaff(me)) return;
  const { rows } = await sql`select 1 from vdl_channels c join vdl_memberships m on m.server_id = c.server_id and m.user_id = ${me.id} where c.id = ${channelId}`;
  need(rows.length, 403, 'you are not in this channel’s server');
}

/* ----------------------------------------------------------------- POST -- */

const POSTS = {
  auth: {
    async signup({ body, request }) {
      need(SECRET, 503, 'VDL_JWT_SECRET is not set on the server');
      if (await rateLimited(`signup:${clientIp(request)}`, 5, 3600)) fail(429, 'Too many accounts from this network. Try again later.');
      const email = String(body.email || '').trim().toLowerCase();
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');
      const display = String(body.display_name || body.username || '').trim().slice(0, 32) || username;
      need(EMAIL_RE.test(email), 400, 'Enter a valid email address.');
      need(USERNAME_RE.test(username), 400, 'Usernames are 2–32 characters: lowercase letters, numbers, _ and .');
      need(password.length >= 10, 400, 'Password must be at least 10 characters.');
      need(password.length <= 200, 400, 'Password is too long.');

      // say exactly which field is taken instead of a vague "email or username taken"
      const { rows: clash } = await sql`select lower(email) = ${email} as email_taken, lower(username) = ${username} as username_taken from vdl_users where lower(email) = ${email} or lower(username) = ${username}`;
      if (clash.some((c) => c.email_taken)) fail(409, 'There’s already an account with that email. Try signing in instead.', { field: 'email' });
      if (clash.some((c) => c.username_taken)) fail(409, 'That username is taken. Try another.', { field: 'username', suggestion: await suggestUsername(username) });

      const hash = await bcrypt.hash(password, 11);
      let user;
      try {
        ({ rows: [user] } = await sql.query(`insert into vdl_users (email, password_hash, password_scheme, username, display_name) values ($1, $2, 'derived', $3, $4) returning ${USER_COLUMNS}`, [email, hash, username, display]));
      } catch (e) {
        if (e?.code === '23505') { // raced with another signup
          const field = /email/i.test(e.constraint || e.detail || '') ? 'email' : 'username';
          fail(409, field === 'email' ? 'There’s already an account with that email.' : 'That username was just taken. Try another.', { field });
        }
        throw e;
      }
      await audit(user.id, 'signup', { user: user.id });
      return withSession({ user }, await signSession(user));
    },

    // `password` is the key the client derives on-device (deriveMasterKeys().authPassword) —
    // exactly what Supabase Auth stored, so imported accounts keep working unchanged.
    // `legacy_password` is only accepted for old console-only accounts made with a raw password.
    async signin({ body, request }) {
      need(SECRET, 503, 'VDL_JWT_SECRET is not set on the server');
      const ident = String(body.email || body.identifier || '').trim().toLowerCase();
      const password = String(body.password || '');
      need(ident && password, 400, 'Email (or username) and password required.');
      if (await rateLimited(`signin:${clientIp(request)}:${ident}`, 10, 900)) fail(429, 'Too many attempts. Wait 15 minutes and try again.');
      const lookup = () => (ident.includes('@')
        ? sql`select * from vdl_users where lower(email) = ${ident}`
        : sql`select * from vdl_users where lower(username) = ${ident}`);
      let { rows } = await lookup();
      // not mirrored yet: pull just this account from Supabase, then retry
      if (!rows[0] && ident.includes('@') && (await importAccountByEmail(ident))) ({ rows } = await lookup());
      const user = rows[0];
      let ok = await bcrypt.compare(password, user?.password_hash || (await getDummyHash()));
      if (!ok && user?.password_scheme === 'raw' && typeof body.legacy_password === 'string' && user.password_hash) {
        ok = await bcrypt.compare(body.legacy_password, user.password_hash);
        if (ok) await sql`update vdl_users set password_hash = ${await bcrypt.hash(password, 11)}, password_scheme = 'derived' where id = ${user.id}`; // upgrade
      }
      if (!user || !ok) fail(401, 'That email and password don’t match an account.', user?.password_scheme === 'raw' ? { retry_legacy: true } : undefined);
      if (isBanned(user)) fail(403, 'This account has been banned.', { banned: true, username: user.username });
      if (user.upstream_deleted_at) fail(403, 'This account was deleted.');
      if (user.source === 'supabase' && !user.email_verified_at && !user.is_anonymous) fail(403, 'Confirm your email first — check your inbox for the link.', { unverified: true });
      await sql`update vdl_users set last_sign_in_at = now() where id = ${user.id}`;
      await audit(user.id, 'signin', { user: user.id });
      return withSession({ user: publicUser(user) }, await signSession(user));
    },

    // VDL replacement for Supabase's resolve_login(): username -> email (needed because the
    // client derives the password key from the email), plus a ban flag for a friendly message.
    async resolve({ body, request }) {
      const ident = String(body.identifier || '').trim().toLowerCase();
      need(ident, 400, 'identifier required');
      if (await rateLimited(`resolve:${clientIp(request)}`, 20, 600)) fail(429, 'Too many login attempts. Please wait a few minutes and try again.');
      const { rows } = ident.includes('@')
        ? await sql`select email, username, account_status, banned_until from vdl_users where lower(email) = ${ident}`
        : USERNAME_RE.test(ident) ? await sql`select email, username, account_status, banned_until from vdl_users where lower(username) = ${ident}` : { rows: [] };
      const u = rows[0];
      if (!u) return { found: false };
      return { found: true, email: u.email, username: u.username, banned: Boolean(isBanned(u)) };
    },

    async signout() {
      const res = json(200, { ok: true });
      res.headers.set('set-cookie', cookieHeader('', 0));
      return res;
    },

    async check({ body }) {
      // live availability for signup forms: { username?, email? } -> { username: bool, email: bool }
      const out = {};
      if (body.username !== undefined) {
        const n = String(body.username).trim().toLowerCase();
        out.username = USERNAME_RE.test(n) && !(await sql`select 1 from vdl_users where lower(username) = ${n}`).rows.length;
        if (!out.username && USERNAME_RE.test(n)) out.suggestion = await suggestUsername(n);
      }
      if (body.email !== undefined) {
        const e = String(body.email).trim().toLowerCase();
        out.email = EMAIL_RE.test(e) && !(await sql`select 1 from vdl_users where lower(email) = ${e}`).rows.length;
      }
      return out;
    },
  },

  users: {
    // active | limited | very_limited | banned. Mirrored to Supabase so the next sync keeps it.
    async set_status({ me, body }) {
      need(isTopStaff(me), 403, 'top staff only');
      const ids = (Array.isArray(body.ids) ? body.ids : [body.id]).slice(0, 500).map((v) => uuid(v));
      const status = String(body.status || '');
      need(['active', 'limited', 'very_limited', 'banned'].includes(status), 400, 'status must be active, limited, very_limited or banned');
      need(!ids.includes(me.id), 400, 'You can’t change your own account status.');
      const { rows: targets } = await sql.query(`select id, source, platform_role, badges from vdl_users where id = any($1::uuid[])`, [ids]);
      need(targets.length === ids.length, 404, 'one or more users were not found');
      need(!targets.some(isTopStaff), 403, 'Owners and founders can’t be changed from the console.');
      await sql.query(`update vdl_users set account_status = $2, updated_at = now() where id = any($1::uuid[])`, [ids, status]);
      const warnings = [];
      for (const t of targets.filter((x) => x.source === 'supabase')) {
        try { await writeThroughProfile(t.id, { account_status: status }); } catch (e) { warnings.push(e.message); }
      }
      for (const id of ids) await audit(me.id, `status:${status}`, { user: id, reason: body.reason || 'storage console' });
      return { ok: true, updated: ids.length, warnings: warnings.slice(0, 3) };
    },
    async ban(ctx) { return POSTS.users.set_status({ ...ctx, body: { ...ctx.body, status: 'banned' } }); },
    async unban(ctx) { return POSTS.users.set_status({ ...ctx, body: { ...ctx.body, status: 'active' } }); },
    async erase({ me, body }) {
      need(isTopStaff(me), 403, 'top staff only');
      const id = uuid(body.id);
      need(id !== me.id, 400, 'You can’t erase your own account from here.');
      const { rows } = await sql`select username, platform_role, badges, source, upstream_deleted_at from vdl_users where id = ${id}`;
      need(rows.length, 404, 'user not found');
      need(!isTopStaff(rows[0]), 403, 'Owners and founders can’t be erased from the console.');
      need(rows[0].source !== 'supabase' || rows[0].upstream_deleted_at, 409, 'This account still exists in Supabase, so the next sync would bring it back. Ban it instead, or delete it in Supabase first.');
      await audit(me.id, 'erase', { user: id, detail: rows[0].username, reason: body.reason || 'storage console' });
      await sql`delete from vdl_users where id = ${id}`;
      return { ok: true };
    },
  },

  sync: {
    // console-driven: start (or resume) a run, then call `step` until status is 'done'
    async start({ me, body }) {
      need(isTopStaff(me), 403, 'top staff only');
      const run = await startOrResumeRun({ actor: me.id, trigger: 'manual', fresh: Boolean(body.fresh) });
      await audit(me.id, 'sync_start', { detail: `run ${run.id}` });
      return { run: await stepRun(run.id, 25_000) };
    },
    async step({ me, body }) {
      need(isTopStaff(me), 403, 'top staff only');
      return { run: await stepRun(uuid(body.run_id, 'run_id'), 25_000) };
    },
  },

  servers: {
    async create({ me, body }) {
      const name = String(body.name || '').trim().slice(0, 100);
      need(name, 400, 'name required');
      const { rows: [{ c }] } = await sql`select count(*)::int as c from vdl_servers where owner_id = ${me.id}`;
      need(c < 100, 400, 'server limit reached');
      const { rows: [server] } = await sql`insert into vdl_servers (name, owner_id) values (${name}, ${me.id}) returning id, name, icon_color, status, verified, description, members, created_at`;
      await sql`insert into vdl_memberships (user_id, server_id) values (${me.id}, ${server.id}) on conflict do nothing`;
      const { rows: [channel] } = await sql`insert into vdl_channels (server_id, name) values (${server.id}, 'chat') returning id, name, type`;
      return { server: { ...server, channels: [channel] } };
    },
  },

  messages: {
    async send({ me, body }) {
      const channel = uuid(body.channel_id, 'channel_id');
      const content = String(body.content || '').trim();
      need(content, 400, 'content required');
      need(content.length <= MAX_MESSAGE, 400, `messages are limited to ${MAX_MESSAGE} characters`);
      await assertChannelAccess(me, channel);
      const { rows: [m] } = await sql`insert into vdl_messages (channel_id, author_id, content) values (${channel}, ${me.id}, ${content}) returning id, content, created_at`;
      return { message: { ...m, author_id: me.id, username: me.username, display_name: me.display_name, avatar_color: me.avatar_color } };
    },
  },

  ledger: {
    async rebuild({ me }) {
      need(isTopStaff(me), 403, 'top staff only');
      const { rows: users } = await sql`select id, email, username, created_at from vdl_users order by created_at asc, id asc`;
      let prev = '0'.repeat(64);
      const seqs = [], prevs = [], hashes = [], payloads = [];
      users.forEach((u, i) => {
        const payload = Buffer.from(JSON.stringify({ userID: u.id, email: u.email, username: u.username, created_at: u.created_at })).toString('base64');
        const hash = crypto.createHash('sha256').update(prev + payload).digest('hex');
        seqs.push(i + 1); prevs.push(prev); hashes.push(hash); payloads.push(payload);
        prev = hash;
      });
      // one bulk insert instead of one round trip per user
      await sql`delete from vdl_ledger`;
      if (users.length) {
        await sql.query(
          `insert into vdl_ledger (seq, prev_hash, hash, payload, created_by)
           select s, p, h, d, $5 from unnest($1::bigint[], $2::text[], $3::text[], $4::text[]) as t(s, p, h, d)`,
          [seqs, prevs, hashes, payloads, me.id],
        );
      }
      await audit(me.id, 'ledger_rebuild', { detail: `${users.length} blocks` });
      return { ok: true, blocks: users.length, head: prev };
    },
  },

  emails: {
    async queue({ me, body }) {
      need(isTopStaff(me), 403, 'top staff only');
      const recipients = String(body.to || '').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
      need(recipients.length, 400, 'recipient required');
      need(recipients.length <= 50, 400, 'at most 50 recipients at once');
      const bad = recipients.find((r) => !EMAIL_RE.test(r));
      need(!bad, 400, `“${bad}” isn’t a valid email address`);
      const subject = String(body.subject || '').slice(0, 200);
      const text = String(body.body || '').slice(0, 50_000);
      need(subject || text, 400, 'add a subject or a message');
      for (const to of recipients) await sql`insert into vdl_outbound_emails (to_addr, subject, body, created_by) values (${to}, ${subject}, ${text}, ${me.id})`;
      await audit(me.id, 'email_queue', { detail: `${recipients.length} recipient(s): ${subject}` });
      return { ok: true, queued: recipients.length };
    },
    async send({ me }) {
      need(isTopStaff(me), 403, 'top staff only');
      const key = process.env.RESEND_API_KEY;
      const from = process.env.STORAGE_EMAIL_FROM || 'Venband <noreply@venband.com>';
      need(key, 503, 'RESEND_API_KEY is not configured on the server');
      // claim a batch first so two clicks can't send the same email twice
      const { rows } = await sql`update vdl_outbound_emails set status = 'sending' where id in (select id from vdl_outbound_emails where status = 'queued' order by created_at limit 50 for update skip locked) returning *`;
      let sent = 0;
      const errors = [];
      for (const row of rows) {
        try {
          const r = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'idempotency-key': row.id },
            body: JSON.stringify({ from, to: [row.to_addr], subject: row.subject || '(no subject)', text: row.body || ' ' }),
          });
          if (!r.ok) {
            const t = await r.text();
            let msg = t;
            try { msg = JSON.parse(t).message || t; } catch {}
            throw new Error(r.status === 403 && /domain/i.test(msg) ? `${msg} — verify your domain in Resend (DNS records) first.` : msg);
          }
          await sql`update vdl_outbound_emails set status = 'sent', sent_at = now(), error = null where id = ${row.id}`;
          sent++;
        } catch (e) {
          const msg = String(e?.message || e).slice(0, 500);
          errors.push({ to: row.to_addr, error: msg });
          await sql`update vdl_outbound_emails set status = 'failed', error = ${msg} where id = ${row.id}`;
        }
      }
      return { sent, total: rows.length, failed: errors.length, errors: errors.slice(0, 5) };
    },
    async retry({ me }) {
      need(isTopStaff(me), 403, 'top staff only');
      const { rowCount } = await sql`update vdl_outbound_emails set status = 'queued', error = null where status = 'failed'`;
      return { ok: true, requeued: rowCount };
    },
  },
};

async function suggestUsername(base) {
  const stem = base.replace(/[^a-z0-9_.]/g, '').slice(0, 28) || 'user';
  for (let i = 0; i < 8; i++) {
    const candidate = `${stem}${i < 4 ? i + 2 : crypto.randomInt(10, 9999)}`;
    const { rows } = await sql`select 1 from vdl_users where lower(username) = ${candidate}`;
    if (!rows.length) return candidate;
  }
  return null;
}

/* -------------------------------------------------------------- routing -- */

function errorResponse(e) {
  if (e instanceof HttpError) return json(e.status, { error: e.message, ...(e.extra || {}) });
  if (e?.status && e.message) return json(e.status, { error: e.message });
  const msg = String(e?.message || e);
  if (/missing_connection_string|POSTGRES_URL|connection string|invalid_connection_string/i.test(msg) || e?.code === 'missing_connection_string') {
    console.error('[vdl] database not configured', msg);
    return json(503, { error: 'The VDL database isn’t connected. In Vercel → Storage, create/connect a Postgres (Neon) database to this project so POSTGRES_URL is set, then redeploy.', code: 'db_not_configured' });
  }
  if (/ECONNREFUSED|ENOTFOUND|getaddrinfo|terminating connection|password authentication failed|endpoint .* (?:is disabled|not found)/i.test(msg)) {
    console.error('[vdl] database unreachable', msg);
    return json(503, { error: 'The VDL database can’t be reached right now (check the Postgres connection in Vercel → Storage).', code: 'db_unreachable' });
  }
  console.error('[vdl]', e);
  return json(500, { error: 'Something went wrong on our side. Try again in a moment.' });
}

// Daily Vercel cron (vercel.json). Vercel sends `Authorization: Bearer $CRON_SECRET`.
async function cronSync(request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get('authorization') || '';
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return json(401, { error: 'unauthorized' });
  if (!supabaseAdminConfig()) return json(200, { skipped: 'supabase sync not configured' });
  const run = await startOrResumeRun({ trigger: 'cron' });
  const done = await stepRun(run.id, 50_000); // a later cron resumes if a huge user base doesn't finish
  return json(200, { run: done });
}

export function OPTIONS() { return preflight(); }

export async function GET(request) {
  try {
    await ensureSchema();
    const q = new URL(request.url).searchParams;
    const r = q.get('r') || 'auth';
    if (r === 'cron') return cronSync(request);
    const handler = Object.hasOwn(GETS, r) ? GETS[r] : null;
    if (!handler) return json(400, { error: `unknown resource “${r}”` });
    const me = await vdlUser(request);
    const out = await handler({ request, q, me });
    return out instanceof Response ? out : json(200, out);
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    await ensureSchema();
    const q = new URL(request.url).searchParams;
    const r = q.get('r') || 'auth';
    let body;
    try { body = await readJson(request); } catch (e) { return json(400, { error: e.message }); }
    // accept the action from the query string *or* the body (the client used both)
    const action = q.get('action') || (typeof body.action === 'string' ? body.action : '');
    const group = Object.hasOwn(POSTS, r) ? POSTS[r] : null;
    const handler = group && Object.hasOwn(group, action) ? group[action] : null;
    if (!handler) return json(400, { error: `unknown action “${action || '(none)'}” for “${r}”` });
    const me = await vdlUser(request);
    const isPublic = r === 'auth';
    if (!isPublic && !me) return json(401, { error: 'not signed in' });
    const out = await handler({ request, q, body, me });
    return out instanceof Response ? out : json(200, out);
  } catch (e) { return errorResponse(e); }
}
