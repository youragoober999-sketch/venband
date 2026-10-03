// GIF search via Klipy (https://klipy.com). The API key is a public,
// per-platform key supplied at build time (VITE_KLIPY_API_KEY); it is never
// committed to the repository.
import type { GifFavorite } from './settings';

const KEY = (import.meta.env.VITE_KLIPY_API_KEY as string | undefined)?.trim();
const BASE = 'https://api.klipy.com/api/v1';

export const gifsEnabled = Boolean(KEY);

interface KlipyFormat {
  url: string;
  width: number;
  height: number;
}
interface KlipyItem {
  id: number | string;
  slug?: string;
  title?: string;
  type?: string;
  file?: Record<'hd' | 'md' | 'sm' | 'xs', { gif?: KlipyFormat; webp?: KlipyFormat; mp4?: KlipyFormat } | undefined>;
}

// Klipy asks for a stable per-user id for personalisation; use a random one
// that can't be linked back to the Venband account.
function customerId(): string {
  try {
    let id = localStorage.getItem('venband:klipy-id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('venband:klipy-id', id);
    }
    return id;
  } catch {
    return 'anonymous';
  }
}

function toGif(item: KlipyItem): GifFavorite | null {
  const f = item.file;
  const send = f?.md?.gif ?? f?.hd?.gif ?? f?.sm?.gif;
  const preview = f?.sm?.webp ?? f?.sm?.gif ?? send;
  if (!send || !preview) return null;
  return { id: String(item.id), url: send.url, preview: preview.url, width: send.width, height: send.height };
}

export interface GifPage {
  items: GifFavorite[];
  hasNext: boolean;
}

async function call(path: string, params: Record<string, string | number>): Promise<GifPage> {
  if (!KEY) return { items: [], hasNext: false };
  const qs = new URLSearchParams({ per_page: '24', customer_id: customerId(), ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  const res = await fetch(`${BASE}/${encodeURIComponent(KEY)}/gifs/${path}?${qs}`, { referrerPolicy: 'no-referrer' });
  if (!res.ok) throw new Error(`GIF search failed (${res.status})`);
  const body = (await res.json()) as { data?: { data?: KlipyItem[]; has_next?: boolean } };
  const items = (body.data?.data ?? []).filter((x) => !x.type || x.type === 'gif').map(toGif).filter(Boolean) as GifFavorite[];
  return { items, hasNext: Boolean(body.data?.has_next) };
}

export const searchGifs = (q: string, page = 1) => call('search', { q, page });
export const trendingGifs = (page = 1) => call('trending', { page });

/** Let Klipy know a GIF was shared (improves their trending). Best-effort. */
export function reportGifShare(id: string) {
  if (!KEY || !/^\w+$/.test(id)) return;
  fetch(`${BASE}/${encodeURIComponent(KEY)}/gifs/${id}/share`, { method: 'POST', referrerPolicy: 'no-referrer' }).catch(() => {});
}
