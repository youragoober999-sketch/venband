// VDL — Venband Data Layer. Single consolidated router (Vercel Hobby: max 12 serverless functions).
//
//   GET  /api/vdl?r=<resource>[&...]           read
//   POST /api/vdl?r=<resource>&action=<name>   write (action may also be sent in the JSON body)
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { sql, json, preflight, readJson, ensureSchema, cookieHeader } from '../lib/vdl-db.js';
import { vdlUser, isTopStaff, signSession, rateLimited, clientIp, SECRET, SECRET_WEAK, SESSION_TTL, USER_COLUMNS } from '../lib/vdl-auth.js';

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
    return { ...base, jwt_configured: Boolean(SECRET), jwt_weak: SECRET_WEAK,email_configured: Boolean(process.env.RESEND_API_KEY), email_from: process.env.STORAGE_EMAIL_FROM || null };
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

  async qr({ q }) {
    const token = q.get('token');
    need(token, 400, 'token required');
    const { rows } = await sql`select status, device_info, approver_id, issued_token from vdl_qr_sessions where token = ${token} and expires_at > now()`;
    need(rows.length, 404, 'session expired or not found');
    const s = rows[0];
    // hand the issued session to the waiting device exactly once
    if (s.status === 'approved' && s.issued_token) {
      await sql`update vdl_qr_sessions set issued_token = null, status = 'consumed' where token = ${token}`;
    }
    return { status: s.status, device_info: s.device_info, approver_id: s.approver_id, issued_token: s.issued_token };
  },

  async auth({ me }) {
    need(me, 401, 'not signed in');
    return { user: me };
  },

  async users({ me, q }) {
    need(me, 401, 'not signed in');
    if (!isTopStaff(me)) return { users: [me] };
    const term = (q.get('q') || '').trim().slice(0, 100);
    const limit = clampInt(q.get('limit'), 100, 1, 500);
    const offset = clampInt(q.get('offset'), 0, 0, 1_000_000);
    const status = q.get('status');
    const params = [];
    const where = [];
    if (term) {
      params.push(`%${term}%`);
      const n = params.length;
      if (UUID_RE.test(term)) params.push(term);
      where.push(`(username ilike $${n} or display_name ilike $${n} or email ilike $${n}${UUID_RE.test(term) ? ` or id = $${n + 1}::uuid` : ''})`);
    }
    if (status) { params.push(status); where.push(`account_status = $${params.length}`); }
    params.push(limit, offset);
    const { rows } = await sql.query(
      `select ${USER_COLUMNS}, count(*) over()::int as total from vdl_users ${where.length ? 'where ' + where.join(' and ') : ''} order by created_at desc limit $${params.length - 1} offset $${params.length}`,
      params,
    );
    const total = rows[0]?.total ?? 0;
    return { users: rows.map(({ total: _t, ...r }) => r), total, limit, offset };
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
        ({ rows: [user] } = await sql.query(`insert into vdl_users (email, password_hash, username, display_name) values ($1, $2, $3, $4) returning ${USER_COLUMNS}`, [email, hash, username, display]));
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

    async signin({ body, request }) {
      need(SECRET, 503, 'VDL_JWT_SECRET is not set on the server');
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      need(email && password, 400, 'Email and password required.');
      if (await rateLimited(`signin:${clientIp(request)}:${email}`, 10, 900)) fail(429, 'Too many attempts. Wait 15 minutes and try again.');
      const { rows } = await sql`select * from vdl_users where lower(email) = ${email}`;
      const user = rows[0];
      const ok = await bcrypt.compare(password, user?.password_hash || (await getDummyHash()));
      if (!user || !ok) fail(401, 'That email and password don’t match an account.');
      if (user.account_status === 'banned') fail(403, 'This account has been banned.');
      await sql`update vdl_users set last_sign_in_at = now() where id = ${user.id}`;
      return withSession({ user: publicUser(user) }, await signSession(user));
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
    async ban({ me, body }) {
      need(isTopStaff(me), 403, 'top staff only');
      const id = uuid(body.id);
      need(id !== me.id, 400, 'You can’t ban yourself.');
      const { rows } = await sql`select platform_role, badges from vdl_users where id = ${id}`;
      need(rows.length, 404, 'user not found');
      need(!isTopStaff(rows[0]), 403, 'Owners and founders can’t be banned from the console.');
      await sql`update vdl_users set account_status = 'banned' where id = ${id}`;
      await audit(me.id, 'ban', { user: id, reason: body.reason || 'storage console' });
      return { ok: true };
    },
    async unban({ me, body }) {
      need(isTopStaff(me), 403, 'top staff only');
      const id = uuid(body.id);
      await sql`update vdl_users set account_status = 'active' where id = ${id}`;
      await audit(me.id, 'unban', { user: id, reason: body.reason || 'storage console' });
      return { ok: true };
    },
    async erase({ me, body }) {
      need(isTopStaff(me), 403, 'top staff only');
      const id = uuid(body.id);
      need(id !== me.id, 400, 'You can’t erase your own account from here.');
      const { rows } = await sql`select username, platform_role, badges from vdl_users where id = ${id}`;
      need(rows.length, 404, 'user not found');
      need(!isTopStaff(rows[0]), 403, 'Owners and founders can’t be erased from the console.');
      await audit(me.id, 'erase', { user: id, detail: rows[0].username, reason: body.reason || 'storage console' });
      await sql`delete from vdl_users where id = ${id}`;
      return { ok: true };
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

  qr: {
    async create({ body, request }) {
      if (await rateLimited(`qr:${clientIp(request)}`, 30, 600)) fail(429, 'Too many QR codes. Wait a few minutes.');
      const token = crypto.randomBytes(24).toString('base64url');
      await sql`insert into vdl_qr_sessions (token, device_info, expires_at) values (${token}, ${String(body.device_info || 'Unknown device').slice(0, 200)}, now() + interval '5 minutes')`;
      await sql`delete from vdl_qr_sessions where expires_at < now() - interval '1 day'`;
      return { token, expires_in: 300 };
    },
    async scan({ body, q }) {
      const token = body.token || q.get('token');
      need(token, 400, 'token required');
      const { rowCount } = await sql`update vdl_qr_sessions set status = 'scanned', device_info = ${String(body.device_info || 'Unknown device').slice(0, 200)} where token = ${token} and status = 'pending' and expires_at > now()`;
      need(rowCount, 404, 'This QR code expired or was already used.');
      return { ok: true };
    },
    async approve({ me, body, q }) {
      need(me, 401, 'not signed in');
      const token = body.token || q.get('token');
      need(token, 400, 'token required');
      const issued = await signSession(me);
      const { rowCount } = await sql`update vdl_qr_sessions set status = 'approved', approver_id = ${me.id}, issued_token = ${issued} where token = ${token} and status in ('pending', 'scanned') and expires_at > now()`;
      need(rowCount, 404, 'This QR code expired or was already used.');
      await audit(me.id, 'qr_login_approved', { user: me.id });
      return { ok: true };
    },
    async deny({ body, q }) {
      const token = body.token || q.get('token');
      need(token, 400, 'token required');
      await sql`update vdl_qr_sessions set status = 'denied', issued_token = null where token = ${token} and status in ('pending', 'scanned')`;
      return { ok: true };
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
  console.error('[vdl]', e);
  return json(500, { error: 'Something went wrong on our side. Try again in a moment.' });
}

export function OPTIONS() { return preflight(); }

export async function GET(request) {
  try {
    await ensureSchema();
    const q = new URL(request.url).searchParams;
    const r = q.get('r') || 'auth';
    const handler = Object.hasOwn(GETS, r) ? GETS[r] : null;
    if (!handler) return json(400, { error: `unknown resource “${r}”` });
    const me = await vdlUser(request);
    return json(200, await handler({ request, q, me }));
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
    const isPublic = r === 'auth' || (r === 'qr' && action !== 'approve');
    if (!isPublic && !me) return json(401, { error: 'not signed in' });
    const out = await handler({ request, q, body, me });
    return out instanceof Response ? out : json(200, out);
  } catch (e) { return errorResponse(e); }
}
