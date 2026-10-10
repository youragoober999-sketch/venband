// Vercel Function: on-device-friendly translation proxy.
// Expects POST { text, sourceLanguage, targetLanguage }.
// Returns { translation: string } or appropriate errors.
// Signed-in users only; uses server-side translator (e.g. Google Cloud Translate
// or DeepL) via environment variables. No API key is sent to the browser.
import { rateLimited, userFromRequest } from './_lib/net.js';

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
  let user;
  try {
    user = await userFromRequest(request);
  } catch {}
  if (!user) return Response.json({ error: 'sign in first' }, { status: 401 });
  if (rateLimited(key(user.id, 'global'), 60)) return Response.json({ error: 'slow down' }, { status: 429 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
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
    if (!t) return Response.json({ error: 'translation failed' }, { status: 503 });
    return Response.json({ translation: t }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return Response.json({ error: e?.message || 'translation failed' }, { status: 500 });
  }
}

export function GET() {
  return Response.json({ error: 'POST {text,sourceLanguage,targetLanguage}' }, { status: 405 });
}

export function OPTIONS() {
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
