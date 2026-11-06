// Client for /api/translate (api/translate.js). Sends the signed-in user's
// token (the endpoint refuses anonymous calls) and keeps code, links,
// mentions and custom emoji out of the text the translator sees — they come
// back exactly as written.
import { supabase } from './supabase';
import { latinOnly, plainEnglish, protect } from './translateText';

export interface SmartTranslateOptions {
  /** a language code, or 'auto' to let the server detect it */
  from: string;
  target: string;
}
export interface SmartResult {
  text: string;
  /** language the server detected (when it was asked to) */
  detected: string | null;
}

function endpoint(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_SMART_TRANSLATE_URL || `${env?.BASE_URL ?? '/'}api/translate`;
}

export async function smartTranslate(text: string, options: SmartTranslateOptions): Promise<SmartResult | null> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), 12000);
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    const p = protect(text);
    if (!p.text.replace(/⟦\d+⟧/g, '').trim()) return null; // nothing but code / links
    const send = options.from === 'en' ? plainEnglish(p.text) : options.from === 'auto' && latinOnly(p.text) ? plainEnglish(p.text, false) : p.text;
    const response = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      signal: controller.signal,
      body: JSON.stringify({ text: send, sourceLanguage: options.from || 'auto', targetLanguage: options.target }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { translation?: unknown; detected?: unknown };
    if (typeof body.translation !== 'string' || !body.translation.trim()) return null;
    return { text: p.restore(body.translation.trim()), detected: typeof body.detected === 'string' ? body.detected.split('-')[0] : null };
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timer);
  }
}
