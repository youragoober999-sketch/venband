// VDL — single consolidated router (Vercel Hobby: max 12 serverless functions).
import { sql, json, preflight, readJson, ensureSchema, COOKIE, cookieHeader } from '../lib/vdl-db.js';
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const SECRET = new TextEncoder().encode(process.env.VDL_JWT_SECRET || 'dev-only-insecure-secret-change-me');

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
  await ensureSchema();
  const u = new URL(request.url);
  const r = u.searchParams.get('r') || 'auth';
  const me = await currentUser(request);

  if (r === 'auth') {
    if (!me) return json(401, { error: 'not signed in' });
    const { rows } = await sql`select id, email, username, display_name, avatar_color, badges, platform_role, account_status, created_at from vdl_users where id = ${me.sub}`;
    return json(200, { user: rows[0] || null });
  }
  if (!me) return json(401, { error: 'not signed in' });

  if (r === 'users') {
    const q = (u.searchParams.get('q') || '').trim();
    let rows;
    if (isTopStaff(me)) {
      if (q) {
        const res = await sql`select id, email, username, display_name, avatar_color, badges, platform_role, account_status, created_at from vdl_users where username ilike ${'%' + q + '%'} or display_name ilike ${'%' + q + '%'} or id::text = ${q} order by created_at desc limit 50`;
        rows = res.rows;
      } else {
        const res = await sql`select id, email, username, display_name, avatar_color, badges, platform_role, account_status, created_at from vdl_users order by created_at desc limit 100`;
        rows = res.rows;
      }
    } else {
      const res = await sql`select id, email, username, display_name, avatar_color, badges, platform_role, account_status, created_at from vdl_users where id = ${me.sub}`;
      rows = res.rows;
    }
    return json(200, { users: rows });
  }
  if (r === 'servers') {
    const res = await sql`select s.id, s.name, s.icon_color, s.status, s.verified, s.description, s.members, s.created_at, u.username as owner_username, s.owner_id from vdl_servers s left join vdl_users u on u.id = s.owner_id order by s.created_at desc limit 100`;
    return json(200, { servers: res.rows });
  }
  if (r === 'messages') {
    const channel = u.searchParams.get('channel');
    const since = u.searchParams.get('since');
    if (!channel) return json(400, { error: 'channel required' });
    let rows;
    if (since) {
      const res = await sql`select m.id, m.content, m.created_at, m.author_id, u.username, u.display_name, u.avatar_color from vdl_messages m left join vdl_users u on u.id = m.author_id where m.channel_id = ${channel} and m.created_at > ${since} order by m.created_at asc limit 100`;
      rows = res.rows;
    } else {
      const res = await sql`select m.id, m.content, m.created_at, m.author_id, u.username, u.display_name, u.avatar_color from vdl_messages m left join vdl_users u on u.id = m.author_id where m.channel_id = ${channel} order by m.created_at asc limit 100`;
      rows = res.rows;
    }
    return json(200, { messages: rows });
  }
  if (r === 'audit') {
    if (!isTopStaff(me)) return json(403, { error: 'top staff only' });
    const res = await sql`select a.id, u.username as actor, a.action, a.detail, a.reason, a.created_at, a.target_user, a.target_server from vdl_audit_log a left join vdl_users u on u.id = a.actor_id order by a.created_at desc limit 100`;
    return json(200, { rows: res.rows });
  }
  if (r === 'ledger') {
    if (!isTopStaff(me)) return json(403, { error: 'top staff only' });
    const res = await sql`select id, seq, prev_hash, hash, payload, created_at from vdl_ledger order by seq asc`;
    return json(200, { rows: res.rows });
  }
  if (r === 'emails') {
    if (!isTopStaff(me)) return json(403, { error: 'top staff only' });
    const res = await sql`select * from vdl_outbound_emails order by created_at desc limit 100`;
    return json(200, { rows: res.rows });
  }
  if (r === 'version') {
    return json(200, { web: { version: '1.0.5', url: 'https://www.venband.com/' }, android: { version: '1.0.5', apk: 'Venband-1.0.5-debug.apk', url: 'https://github.com/youragoober999-sketch/venband/releases/download/v1.0.5/Venband-1.0.5-debug.apk' }, desktop: { version: '1.0.5', url: 'https://github.com/youragoober999-sketch/venband/releases/latest' } });
  }
  if (r === 'stats') {
    if (!isTopStaff(me)) return json(403, { error: 'top staff only' });
    const users = await sql`select count(*)::int as c from vdl_users`;
    const servers = await sql`select count(*)::int as c from vdl_servers`;
    const blocks = await sql`select count(*)::int as c from vdl_ledger`;
    const objs = await sql`select count(*)::int as c from vbb_objects`;
    return json(200, { users: users.rows[0].c, servers: servers.rows[0].c, objects: objs.rows[0].c, blocks: blocks.rows[0].c });
  }
  return json(400, { error: 'unknown resource' });
}

export async function POST(request) {
  await ensureSchema();
  const u = new URL(request.url);
  const r = u.searchParams.get('r') || 'auth';
  const action = u.searchParams.get('action') || '';
  let body = {};
  try { body = await readJson(request); } catch (e) { return json(400, { error: e.message }); }

  // ---- auth ----
  if (r === 'auth') {
    if (action === 'signup') {
      const { email, password, username } = body;
      if (!email || !password || !username) return json(400, { error: 'email, password, username required' });
      if (password.length < 8) return json(400, { error: 'password too short' });
      const hash = await bcrypt.hash(password, 10);
      try {
        const { rows } = await sql`insert into vdl_users (email, password_hash, username, display_name) values (${email.toLowerCase()}, ${hash}, ${username}, ${username}) returning id, email, username, display_name, avatar_color, badges, platform_role, account_status, created_at`;
        const user = rows[0];
        const token = await new SignJWT({ sub: user.id, email: user.email, role: user.platform_role, badges: user.badges }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('30d').sign(SECRET);
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
      const token = await new SignJWT({ sub: user.id, email: user.email, role: user.platform_role, badges: user.badges }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('30d').sign(SECRET);
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

  const me = await currentUser(request);
  if (!me) return json(401, { error: 'not signed in' });

  // ---- users ----
  if (r === 'users') {
    if (action === 'ban') {
      if (!isTopStaff(me)) return json(403, { error: 'top staff only' });
      await sql`update vdl_users set account_status = 'banned' where id = ${body.id}`;
      await sql`insert into vdl_audit_log (actor_id, action, target_user, reason) values (${me.sub}, 'ban', ${body.id}, ${body.reason || 'storage console'})`;
      return json(200, { ok: true });
    }
    if (action === 'erase') {
      if (!isTopStaff(me)) return json(403, { error: 'top staff only' });
      await sql`insert into vdl_audit_log (actor_id, action, target_user, reason) values (${me.sub}, 'erase', ${body.id}, 'storage console')`;
      await sql`delete from vdl_users where id = ${body.id}`;
      return json(200, { ok: true });
    }
    return json(400, { error: 'unknown action' });
  }

  // ---- servers ----
  if (r === 'servers') {
    if (action === 'create') {
      const { name } = body;
      if (!name) return json(400, { error: 'name required' });
      const res = await sql`insert into vdl_servers (name, owner_id) values (${name}, ${me.sub}) returning id, name, icon_color, status, verified, description, members, created_at`;
      await sql`insert into vdl_memberships (user_id, server_id) values (${me.sub}, ${res.rows[0].id}) on conflict do nothing`;
      return json(200, { server: res.rows[0] });
    }
    return json(400, { error: 'unknown action' });
  }

  // ---- messages ----
  if (r === 'messages') {
    if (action !== 'send') return json(400, { error: 'unknown action' });
    const { channel_id, content } = body;
    if (!channel_id || !content) return json(400, { error: 'channel_id and content required' });
    const res = await sql`insert into vdl_messages (channel_id, author_id, content) values (${channel_id}, ${me.sub}, ${content}) returning id, content, created_at`;
    return json(200, { message: { ...res.rows[0], author_id: me.sub } });
  }

  // ---- ledger ----
  if (r === 'ledger') {
    if (!isTopStaff(me)) return json(403, { error: 'top staff only' });
    if (action !== 'rebuild') return json(400, { error: 'unknown action' });
    await sql`delete from vdl_ledger`;
    const users = await sql`select id, email, username, created_at from vdl_users order by created_at asc`;
    let prev = '0'.repeat(64);
    let seq = 0;
    for (const u of users.rows) {
      seq++;
      const payload = Buffer.from(JSON.stringify({ userID: u.id, email: u.email, username: u.username, created_at: u.created_at })).toString('base64');
      const hash = crypto.createHash('sha256').update(prev + payload).digest('hex');
      await sql`insert into vdl_ledger (seq, prev_hash, hash, payload, created_by) values (${seq}, ${prev}, ${hash}, ${payload}, ${me.sub})`;
      prev = hash;
    }
    return json(200, { ok: true, blocks: seq });
  }

  // ---- emails ----
  if (r === 'emails') {
    if (!isTopStaff(me)) return json(403, { error: 'top staff only' });
    if (action === 'queue') {
      const { to, subject, body: b } = body;
      if (!to) return json(400, { error: 'recipient required' });
      await sql`insert into vdl_outbound_emails (to_addr, subject, body, created_by) values (${to}, ${subject || ''}, ${b || ''}, ${me.sub})`;
      return json(200, { ok: true });
    }
    if (action === 'send') {
      const RESEND = process.env.RESEND_API_KEY;
      const FROM = process.env.STORAGE_EMAIL_FROM || 'Venband <noreply@venband.com>';
      if (!RESEND) return json(503, { error: 'RESEND_API_KEY not configured' });
      const rows = await sql`select * from vdl_outbound_emails where status = 'queued'`;
      let sent = 0;
      for (const row of rows.rows) {
        try {
          const r2 = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${RESEND}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: FROM, to: [row.to_addr], subject: row.subject, text: row.body }) });
          if (!r2.ok) throw new Error(await r2.text());
          await sql`update vdl_outbound_emails set status = 'sent', sent_at = now() where id = ${row.id}`;
          sent++;
        } catch (e) {
          await sql`update vdl_outbound_emails set status = 'failed', error = ${String(e.message || e).slice(0, 500)} where id = ${row.id}`;
        }
      }
      return json(200, { sent, total: rows.rows.length });
    }
    return json(400, { error: 'unknown action' });
  }

  return json(400, { error: 'unknown resource/action' });
}
