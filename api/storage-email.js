// Vercel Function: sends queued Storage Console emails through Resend.
// Only owners/founders (verified via their Supabase session) may trigger it.
// Configure RESEND_API_KEY and STORAGE_EMAIL_FROM (e.g. "Venband Storage <storage@venband.com>").
import { json, preflight, readJson } from './_lib/rpc.js';

const URL_ = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

export function OPTIONS() { return preflight(); }

export async function POST(request) {
  const auth = request.headers.get('authorization') || '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!jwt || !URL_ || !ANON) return json(401, { error: 'missing session' });

  // verify the caller with Supabase Auth
  const uRes = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, authorization: `Bearer ${jwt}` } });
  if (!uRes.ok) return json(401, { error: 'invalid session' });

  // top-staff check
  const rpcRes = await fetch(`${URL_}/rest/v1/rpc/is_top_staff`, {
    method: 'POST',
    headers: { apikey: ANON, authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: '{}',
  });
  const isTop = rpcRes.ok && (await rpcRes.json()) === true;
  if (!isTop) return json(403, { error: 'top staff only' });

  let body;
  try { body = await readJson(request); } catch (e) { return json(400, { error: e.message }); }

  const RESEND = process.env.RESEND_API_KEY;
  const FROM = process.env.STORAGE_EMAIL_FROM || 'Venband Storage <storage@venband.com>';
  if (!RESEND) return json(503, { error: 'RESEND_API_KEY not configured on this host' });

  // fetch queued rows
  let q = `${URL_}/rest/v1/outbound_emails?status=eq.queued&select=*`;
  if (body.id) q += `&id=eq.${encodeURIComponent(body.id)}`;
  const rowsRes = await fetch(q, { headers: { apikey: ANON, authorization: `Bearer ${jwt}` } });
  if (!rowsRes.ok) return json(502, { error: 'could not load queue' });
  const rows = await rowsRes.json();
  if (!Array.isArray(rows) || rows.length === 0) return json(200, { sent: 0 });

  let sent = 0;
  const results = [];
  for (const row of rows) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${RESEND}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: [row.to_addr], subject: row.subject, text: row.body }),
      });
      if (!r.ok) throw new Error(await r.text());
      // mark sent
      await fetch(`${URL_}/rest/v1/outbound_emails?id=eq.${row.id}`, {
        method: 'PATCH',
        headers: { apikey: ANON, authorization: `Bearer ${jwt}`, 'content-type': 'application/json', prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'sent', sent_at: new Date().toISOString(), error: null }),
      });
      sent++;
      results.push({ id: row.id, ok: true });
    } catch (e) {
      await fetch(`${URL_}/rest/v1/outbound_emails?id=eq.${row.id}`, {
        method: 'PATCH',
        headers: { apikey: ANON, authorization: `Bearer ${jwt}`, 'content-type': 'application/json', prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'failed', error: String(e.message || e).slice(0, 500) }),
      });
      results.push({ id: row.id, ok: false, error: String(e.message || e) });
    }
  }
  return json(200, { sent, total: rows.length, results });
}
