// Vercel Cron: removes expired disposable accounts and all of their data.
import { json } from './_lib/rpc.js';

const URL_ = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export async function GET(request) {
  // Allow Vercel Cron or a shared secret.
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') || '';
  const isCron = request.headers.get('x-vercel-cron') === '1';
  if (!isCron && (!secret || auth !== `Bearer ${secret}`)) {
    return json(401, { error: 'unauthorized' });
  }
  if (!URL_ || !SERVICE_KEY) return json(500, { error: 'service role not configured' });

  try {
    const now = new Date().toISOString();
    const r = await fetch(`${URL_}/rest/v1/profiles?disposable=eq.true&expires_at=lt.${encodeURIComponent(now)}&select=id`, {
      headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
    });
    const rows = r.ok ? await r.json() : [];
    let removed = 0;
    for (const row of rows) {
      const del = await fetch(`${URL_}/auth/v1/admin/users/${row.id}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
      });
      if (del.ok) removed++;
    }
    return json(200, { removed });
  } catch (e) {
    return json(500, { error: String(e?.message || e) });
  }
}
