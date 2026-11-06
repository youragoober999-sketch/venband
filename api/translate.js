// Vercel Function: message translation for signed-in Venband users.
// POST { text, sourceLanguage ('auto' or a code), targetLanguage }
//  -> { translation, detected, provider }
//
// Works with no setup: it uses Google's free web endpoint (130+ languages,
// automatic language detection). Add DEEPL_API_KEY (best quality for the
// languages DeepL supports) or GOOGLE_TRANSLATE_API_KEY (official Google Cloud)
// and those are tried first. MyMemory is the last fallback for short texts.
// No API key ever reaches the browser.
import { rateLimited, userFromRequest } from './_lib/net.js';

const DEFAULT_ORIGINS = ['https://www.venband.com', 'https://venband.com', 'https://localhost', 'capacitor://localhost', 'venband://localhost'];
const ALLOWED_ORIGINS = new Set([
  ...DEFAULT_ORIGINS,
  ...(process.env.VENBAND_ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean),
]);
function originOk(request) {
  const origin = request.headers.get('origin');
  if (!origin) return { ok: true, origin: null };
  if (ALLOWED_ORIGINS.has(origin)) return { ok: true, origin };
  try {
    if (new URL(origin).host === new URL(request.url).host) return { ok: true, origin };
  } catch {}
  return { ok: false, origin };
}
const corsHeaders = (origin) => (origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : { vary: 'Origin' });

const CODE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;
function cleanText(s) {
  if (typeof s !== 'string') throw new Error('text must be a string');
  const t = s.trim();
  if (!t || t.length > 10000) throw new Error('text length out of range');
  return t;
}

// Google's codes differ from ours for a few languages.
const GOOGLE_CODE = { zh: 'zh-CN', fil: 'tl', he: 'iw', jv: 'jw', mni: 'mni-Mtei', nb: 'no' };
const fromGoogle = (c) => ({ 'zh-CN': 'zh', 'zh-TW': 'zh-TW', iw: 'he', tl: 'fil', jw: 'jv', 'mni-Mtei': 'mni' })[c] ?? c;

// DeepL: uppercase codes, regional variants for some targets, a smaller language set.
const DEEPL = new Set(['ar', 'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'hu', 'id', 'it', 'ja', 'ko', 'lt', 'lv', 'nb', 'no', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'zh']);
const deeplTarget = (c) => ({ en: 'EN-US', pt: 'PT-BR', zh: 'ZH-HANS', no: 'NB', nb: 'NB' })[c] ?? c.toUpperCase();
const deeplSource = (c) => ({ no: 'NB' })[c] ?? c.toUpperCase();

const PROVIDERS = {
  async deepl(text, from, to) {
    const key = process.env.DEEPL_API_KEY;
    const base = to.split('-')[0];
    if (!key || !DEEPL.has(base) || (from !== 'auto' && !DEEPL.has(from))) return null;
    const host = key.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
    const body = new URLSearchParams({ text, target_lang: deeplTarget(base), ...(from !== 'auto' ? { source_lang: deeplSource(from) } : {}) });
    const res = await fetch(`https://${host}/v2/translate`, { method: 'POST', headers: { authorization: `DeepL-Auth-Key ${key}`, 'content-type': 'application/x-www-form-urlencoded' }, body });
    if (!res.ok) return null;
    const t = (await res.json())?.translations?.[0];
    return t?.text ? { text: t.text, detected: (t.detected_source_language || '').toLowerCase() || null } : null;
  },
  async google(text, from, to) {
    const key = process.env.GOOGLE_TRANSLATE_API_KEY;
    if (!key) return null;
    const q = new URLSearchParams({ key, q: text, target: GOOGLE_CODE[to] ?? to, format: 'text', ...(from !== 'auto' ? { source: GOOGLE_CODE[from] ?? from } : {}) });
    const res = await fetch('https://translation.googleapis.com/language/translate/v2', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: q });
    if (!res.ok) return null;
    const t = (await res.json())?.data?.translations?.[0];
    return t?.translatedText ? { text: t.translatedText, detected: t.detectedSourceLanguage ? fromGoogle(t.detectedSourceLanguage) : null } : null;
  },
  async googleFree(text, from, to) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=${encodeURIComponent(from === 'auto' ? 'auto' : GOOGLE_CODE[from] ?? from)}&tl=${encodeURIComponent(GOOGLE_CODE[to] ?? to)}`;
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: new URLSearchParams({ q: text }) });
    if (!res.ok) return null;
    const data = await res.json();
    const out = Array.isArray(data?.[0]) ? data[0].map((seg) => (Array.isArray(seg) ? seg[0] ?? '' : '')).join('') : '';
    return out ? { text: out, detected: typeof data?.[2] === 'string' ? fromGoogle(data[2]) : null } : null;
  },
  async myMemory(text, from, to) {
    if (text.length > 480) return null;
    const pair = `${from === 'auto' ? 'Autodetect' : from}|${to}`;
    const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(pair)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const out = data?.responseData?.translatedText;
    if (!out || data?.responseStatus !== 200 || /MYMEMORY WARNING|INVALID/i.test(out)) return null;
    return { text: out, detected: null };
  },
};
const ORDER = ['deepl', 'google', 'googleFree', 'myMemory'];

// Small in-memory cache: the same message is often translated by many people.
const cache = new Map();
function cached(k) {
  const hit = cache.get(k);
  if (!hit) return null;
  cache.delete(k);
  cache.set(k, hit);
  return hit;
}
function remember(k, v) {
  cache.set(k, v);
  if (cache.size > 3000) cache.delete(cache.keys().next().value);
}

export async function POST(request) {
  const o = originOk(request);
  if (!o.ok) return Response.json({ error: 'not allowed from this site' }, { status: 403, headers: { vary: 'Origin' } });
  const cors = corsHeaders(o.origin);
  let user;
  try {
    user = await userFromRequest(request);
  } catch {}
  if (!user) return Response.json({ error: 'sign in first' }, { status: 401, headers: cors });
  if (rateLimited(`tr:${user.id}`, 90)) return Response.json({ error: 'slow down' }, { status: 429, headers: cors });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400, headers: cors });
  }
  let text;
  try {
    text = cleanText(body?.text);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 400, headers: cors });
  }
  const to = String(body?.targetLanguage ?? '');
  const from = body?.sourceLanguage && body.sourceLanguage !== 'auto' ? String(body.sourceLanguage) : 'auto';
  if (!CODE.test(to) || (from !== 'auto' && !CODE.test(from))) return Response.json({ error: 'bad language code' }, { status: 400, headers: cors });

  const k = `${from}>${to}:${text}`;
  const hit = cached(k);
  if (hit) return Response.json(hit, { headers: { ...cors, 'cache-control': 'no-store' } });

  for (const name of ORDER) {
    try {
      const r = await PROVIDERS[name](text, from, to);
      if (r?.text) {
        const out = { translation: r.text, detected: r.detected ?? (from === 'auto' ? null : from), provider: name };
        remember(k, out);
        return Response.json(out, { headers: { ...cors, 'cache-control': 'no-store' } });
      }
    } catch {
      // try the next provider
    }
  }
  return Response.json({ error: 'all translators are unavailable right now' }, { status: 503, headers: cors });
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
