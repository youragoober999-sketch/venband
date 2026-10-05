// Calls a Supabase database function as the anonymous (public) role. The
// functions used here check bot tokens / webhook secrets themselves, so no
// secret keys live in these Vercel functions.
const URL_ = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

export async function rpc(name, args) {
  if (!URL_ || !KEY) return { status: 503, body: { error: 'Venband API is not configured on this host' } };
  const r = await fetch(`${URL_}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (r.ok) return { status: 200, body };
  const msg = (body && body.message) || 'request failed';
  const status = /invalid token|unknown webhook/.test(msg) ? 401 : /slow down/.test(msg) ? 429 : /disabled/.test(msg) ? 403 : 400;
  return { status, body: { error: msg } };
}

/** JSON body, at most 16 KB. */
export async function readJson(request) {
  const text = await request.text();
  if (text.length > 16_384) throw new Error('body too large');
  if (!text) return {};
  const v = JSON.parse(text);
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('body must be a JSON object');
  return v;
}

export function json(status, body) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
}

export function preflight() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': '86400',
    },
  });
}
