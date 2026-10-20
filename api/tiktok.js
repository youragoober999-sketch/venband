// Vercel Function: completes TikTok OAuth token exchange server-side so the
// client secret never ships to the browser.
import { json, preflight, readJson } from './_lib/rpc.js';

const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY || process.env.VITE_TIKTOK_CLIENT_KEY || 'aw3rf61cawh6b01a';
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET || '';

export function OPTIONS() { return preflight(); }

export async function GET(request) {
  const u = new URL(request.url);
  const code = u.searchParams.get('code');
  const redirectUri = u.searchParams.get('redirect_uri');
  if (!code || !redirectUri) return json(400, { error: 'code and redirect_uri required' });
  return exchange(code, redirectUri);
}

export async function POST(request) {
  let body;
  try { body = await readJson(request); } catch (e) { return json(400, { error: e.message }); }
  const { code, redirect_uri: redirectUri } = body || {};
  if (!code || !redirectUri) return json(400, { error: 'code and redirect_uri required' });
  return exchange(code, redirectUri);
}

async function exchange(code, redirectUri) {
  if (!CLIENT_KEY || !CLIENT_SECRET) return json(500, { error: 'TikTok not configured' });
  try {
    const body = new URLSearchParams({
      client_key: CLIENT_KEY,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });
    const tokRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const tokText = await tokRes.text();
    let tok;
    try { tok = JSON.parse(tokText); } catch { tok = null; }
    if (!tokRes.ok || !tok?.access_token) {
      return json(400, { error: 'TikTok token exchange failed', detail: tok || tokText });
    }
    const userRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name', {
      headers: { authorization: `Bearer ${tok.access_token}` },
    });
    const userText = await userRes.text();
    let user;
    try { user = JSON.parse(userText); } catch { user = null; }
    const data = user?.data?.user || {};
    return json(200, {
      open_id: data.open_id || tok.open_id,
      display_name: data.display_name || 'TikTok',
      avatar_url: data.avatar_url || null,
      access_token: tok.access_token,
      expires_in: tok.expires_in || null,
    });
  } catch (e) {
    return json(500, { error: String(e?.message || e) });
  }
}
