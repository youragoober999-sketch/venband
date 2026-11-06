// Vercel Function: on-device-friendly translation proxy.
// Expects POST { text, sourceLanguage, targetLanguage }.
// Returns { translation: string } or appropriate errors.
// Signed-in users only; uses server-side translator (e.g. Google Cloud Translate
// or DeepL) via environment variables. No API key is sent to the browser.
import { rateLimited, userFromRequest } from './_lib/net.js';

// Browsers send Origin on cross-site requests. Only Venband itself (and the
// Capacitor mobile app) may call this from a browser; other sites get no CORS
// grant and a 403. Extra origins: VENBAND_ALLOWED_ORIGINS="https://a.com,https://b.com".
const DEFAULT_ORIGINS = ['https://www.venband.com', 'https://venband.com', 'https://localhost', 'capacitor://localhost', 'venband://localhost'];
const ALLOWED_ORIGINS = new Set([
  ...DEFAULT_ORIGINS,
  ...(process.env.VENBAND_ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean),
]);
function originOk(request) {
  const origin = request.headers.get('origin');
  if (!origin) return { ok: true, origin: null }; // same-origin GET/POST from old browsers, or server-to-server
  if (ALLOWED_ORIGINS.has(origin)) return { ok: true, origin };
  // same-origin requests also send Origin: allow the deployment's own host (previews, custom domains)
  try {
    if (new URL(origin).host === new URL(request.url).host) return { ok: true, origin };
  } catch {}
  return { ok: false, origin };
}
function corsHeaders(origin) {
  return origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : { vary: 'Origin' };
}

function cleanInput(s) {
  if (typeof s !== 'string') throw new Error('text must be a string');
  const t = s.trim();
  if (!t || t.length > 10000) throw new Error('text length out of range');
  return t;
}

function key(id, key) {
  return `tr:${id}:${key}`;
}

const PROVIDERS = {
  google: async (text, from, to, key) => {
    if (!key) throw new Error('GOOGLE_TRANSLATE_API_KEY missing');
    const q = new URLSearchParams({ key, q: text, source: from || '', target: to });
    const res = await fetch('https://translation.googleapis.com/language/translate/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: q,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.data?.translations?.[0]?.translatedText ?? null;
  },
  deepl: async (text, from, to, key) => {
    if (!key) throw new Error('DEEPL_API_KEY missing');
    const body = new URLSearchParams({
      auth_key: key,
      text: text,
      target_lang: to,
      ...(from ? { source_lang: from } : {}),
    });
    const res = await fetch('https://api-free.deepl.com/v2/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.translations?.[0]?.text ?? null;
  },
};

export async function POST(request) {
  const o = originOk(request);
  if (!o.ok) return Response.json({ error: 'not allowed from this site' }, { status: 403, headers: { vary: 'Origin' } });
  const cors = corsHeaders(o.origin);
  let user;
  try {
    user = await userFromRequest(request);
  } catch {}
  if (!user) return Response.json({ error: 'sign in first' }, { status: 401, headers: cors });
  if (rateLimited(key(user.id, 'global'), 60)) return Response.json({ error: 'slow down' }, { status: 429, headers: cors });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400, headers: cors });
  }
  const { text, sourceLanguage, targetLanguage } = body;
  const provider = (process.env.TRANSLATE_PROVIDER || 'deepl').toLowerCase();
  const keyEnv =
    provider === 'google'
      ? process.env.GOOGLE_TRANSLATE_API_KEY
      : process.env.DEEPL_API_KEY;
  const translator = PROVIDERS[provider] ?? PROVIDERS.deepl;
  try {
    const t = await translator(cleanInput(text), sourceLanguage, targetLanguage, keyEnv);
    if (!t) return Response.json({ error: 'translation failed' }, { status: 503, headers: cors });
    return Response.json({ translation: t }, { headers: { ...cors, 'cache-control': 'no-store' } });
  } catch (e) {
    return Response.json({ error: e?.message || 'translation failed' }, { status: 500, headers: cors });
  }
}

export function GET() {
  return Response.json({ error: 'POST {text,sourceLanguage,targetLanguage}' }, { status: 405 });
}

export function OPTIONS(request) {
  const o = originOk(request);
  if (!o.ok) return new Response(null, { status: 403, headers: { vary: 'Origin' } });
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(o.origin),
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': '86400',
    },
  });
}
