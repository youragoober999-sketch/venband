// VDL outbound emails: queue + list + send (top staff).
import { sql, json, preflight, readJson, ensureSchema } from './_db.js';
import { jwtVerify } from 'jose';
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
  const me = await currentUser(request);
  if (!me || !isTopStaff(me)) return json(403, { error: 'top staff only' });
  const r = await sql`select * from vdl_outbound_emails order by created_at desc limit 100`;
  return json(200, { rows: r.rows });
}
export async function POST(request) {
  await ensureSchema();
  const me = await currentUser(request);
  if (!me || !isTopStaff(me)) return json(403, { error: 'top staff only' });
  let body;
  try { body = await readJson(request); } catch (e) { return json(400, { error: e.message }); }
  if (body.action === 'queue') {
    const { to, subject, body: b } = body;
    if (!to) return json(400, { error: 'recipient required' });
    await sql`insert into vdl_outbound_emails (to_addr, subject, body, created_by) values (${to}, ${subject || ''}, ${b || ''}, ${me.sub})`;
    return json(200, { ok: true });
  }
  if (body.action === 'send') {
    // send queued via Resend if configured
    const RESEND = process.env.RESEND_API_KEY;
    const FROM = process.env.STORAGE_EMAIL_FROM || 'Venband <noreply@venband.com>';
    if (!RESEND) return json(503, { error: 'RESEND_API_KEY not configured' });
    const rows = await sql`select * from vdl_outbound_emails where status = 'queued'`;
    let sent = 0;
    for (const row of rows.rows) {
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${RESEND}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from: FROM, to: [row.to_addr], subject: row.subject, text: row.body }),
        });
        if (!r.ok) throw new Error(await r.text());
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