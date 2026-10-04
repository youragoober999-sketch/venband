// Link previews are made by the sender: Venband's server fetches the page
// (never the people receiving the message), and the result is encrypted into
// the message like everything else.
import { supabase } from './supabase';
import { embedFor } from '../components/Markdown';

export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;
  themeColor?: string;
}

const URL_RE = /https?:\/\/[^\s<>()]+[^\s<>().,!?;:'"]/g;

/** The first link worth previewing (not one we already embed as a player). */
export function previewableLink(text: string): string | null {
  const scrubbed = text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ').replace(/<https?:\/\/[^\s>]+>/g, ' ').replace(/\|\|[\s\S]*?\|\|/g, ' ');
  for (const u of scrubbed.match(URL_RE) ?? []) {
    if (embedFor(u)) continue;
    try {
      const host = new URL(u).hostname;
      // never send private / intranet links to the preview service
      if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || !host.includes('.')) continue;
    } catch {
      continue;
    }
    return u;
  }
  return null;
}

export async function fetchPreview(url: string, timeoutMs = 2500): Promise<LinkPreview | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}api/link-preview?url=${encodeURIComponent(url)}`, { headers: { authorization: `Bearer ${token}` }, signal: ctrl.signal });
    if (!res.ok) return null;
    const p = (await res.json()) as LinkPreview;
    if (!p.title && !p.description) return null;
    return {
      url,
      title: p.title?.slice(0, 200),
      description: p.description?.slice(0, 400),
      siteName: p.siteName?.slice(0, 80),
      image: p.image && p.image.startsWith('/api/media?') ? p.image : undefined,
      themeColor: p.themeColor,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
