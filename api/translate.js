// Vercel Function: translation for signed-in users.
// POST { text, sourceLanguage, targetLanguage } -> { translation, provider }
//
// Providers, best first; the first one that's set up and answers wins:
//   1. DeepL          (DEEPL_API_KEY; free or pro key)
//   2. Google Cloud   (GOOGLE_TRANSLATE_API_KEY)
//   3. MyMemory       (free, no key; MYMEMORY_EMAIL raises the daily limit
//                      from ~5,000 to ~50,000 characters)
// Keys stay on the server. The person's IP address never reaches the provider.
import { rateLimited, userFromRequest } from './_lib/net.js';

const MAX_TEXT = 5000;
const LANG = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

/** Split text into pieces of at most `max` bytes, on sentence then word boundaries. */
export function chunkText(text, max = 450) {
  const bytes = (s) => Buffer.byteLength(s, 'utf8');
  if (bytes(text) <= max) return [text];
  const out = [];
  let cur = '';
  const push = (piece) => {
    if (!piece) return;
    if (bytes(cur + piece) <= max) {
      cur += piece;
      return;
    }
    if (cur) out.push(cur);
    cur = '';
    if (bytes(piece) <= max) {
      cur = piece;
      return;
    }
    // one very long sentence: split by words, then by characters
    for (const word of piece.split(/(\s+)/)) {
      if (bytes(cur + word) <= max) cur += word;
      else {
        if (cur) out.push(cur);
        cur = '';
        let w = word;
        while (bytes(w) > max) {
          let n = max;
          while (bytes(w.slice(0, n)) > max) n--;
          out.push(w.slice(0, n));
          w = w.slice(n);
        }
        cur = w;
      }
    }
  };
  for (const sentence of text.match(/[^.!?。！？\n]+[.!?。！？]*\s*|\n+/g) ?? [text]) push(sentence);
  if (cur) out.push(cur);
  return out;
}

const deeplLang = (code, target) => {
  const c = code.toLowerCase().split('-')[0];
  if (!target) return c.toUpperCase();
  if (c === 'en') return 'EN-US';
  if (c === 'pt') return 'PT-BR';
  if (c === 'zh') return 'ZH-HANS';
  return c.toUpperCase();
};

export const PROVIDERS = {
  async deepl(text, from, to) {
    const key = process.env.DEEPL_API_KEY;
    if (!key) return null;
    const host = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
    const body = new URLSearchParams({ text, target_lang: deeplLang(to, true) });
    if (from) body.set('source_lang', deeplLang(from, false));
    const res = await fetch(`${host}/v2/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `DeepL-Auth-Key ${key}` },
      body,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.translations?.[0]?.text ?? null;
  },
  async google(text, from, to) {
    const key = process.env.GOOGLE_TRANSLATE_API_KEY;
    if (!key) return null;
    const body = new URLSearchParams({ key, q: text, target: to, format: 'text' });
    if (from) body.set('source', from);
    const res = await fetch('https://translation.googleapis.com/language/translate/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.data?.translations?.[0]?.translatedText ?? null;
  },
  async mymemory(text, from, to) {
    if (!from) return null; // MyMemory needs the source language
    const parts = chunkText(text);
    const out = [];
    for (const part of parts) {
      if (!part.trim()) {
        out.push(part);
        continue;
      }
      const q = new URLSearchParams({ q: part.trim(), langpair: `${from}|${to}` });
      if (process.env.MYMEMORY_EMAIL) q.set('de', process.env.MYMEMORY_EMAIL);
      const res = await fetch(`https://api.mymemory.translated.net/get?${q}`);
      if (!res.ok) return null;
      const data = await res.json();
      const t = data?.responseData?.translatedText;
      if (Number(data?.responseStatus) !== 200 || typeof t !== 'string' || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(t)) return null;
      // keep the spacing around each piece
      const lead = part.match(/^\s*/)[0];
      const trail = part.match(/\s*$/)[0];
      out.push(lead + decodeEntities(t) + trail);
    }
    return out.join('');
  },
};

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Try each provider in order; the preferred one (TRANSLATE_PROVIDER) first. */
export async function translateText(text, from, to) {
  const order = ['deepl', 'google', 'mymemory'];
  const preferred = (process.env.TRANSLATE_PROVIDER || '').toLowerCase();
  if (order.includes(preferred)) order.unshift(...order.splice(order.indexOf(preferred), 1));
  for (const name of order) {
    try {
      const t = await PROVIDERS[name](text, from, to);
      if (t && t.trim()) return { translation: t, provider: name };
    } catch {
      /* try the next one */
    }
  }
  return null;
}

export async function POST(request) {
  let user = null;
  try {
    user = await userFromRequest(request);
  } catch {
    /* treated as signed out */
  }
  if (!user) return Response.json({ error: 'sign in first' }, { status: 401 });
  if (rateLimited(`tr:${user.id}`, 60)) return Response.json({ error: 'slow down' }, { status: 429 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const from = typeof body?.sourceLanguage === 'string' && LANG.test(body.sourceLanguage) ? body.sourceLanguage : '';
  const to = typeof body?.targetLanguage === 'string' && LANG.test(body.targetLanguage) ? body.targetLanguage : '';
  if (!text || text.length > MAX_TEXT) return Response.json({ error: 'text length out of range' }, { status: 400 });
  if (!to) return Response.json({ error: 'targetLanguage is required' }, { status: 400 });

  const result = await translateText(text, from, to);
  if (!result) return Response.json({ error: 'translation failed' }, { status: 503 });
  return Response.json(result, { headers: { 'cache-control': 'no-store' } });
}

export function GET() {
  return Response.json({ error: 'POST {text,sourceLanguage,targetLanguage}' }, { status: 405 });
}
