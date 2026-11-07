// Music for memories: search (song names, artists, moods, genres) through
// /api/music, which holds the music service's key on the server.
import { sessionStore } from './session';

export interface Track {
  provider: 'soundstripe' | 'freetouse';
  id: string;
  title: string;
  artist: string;
  artwork: string | null;
  /** seconds */
  duration: number;
  /** a short-lived link to the audio */
  audio: string | null;
  tags: string[];
}

/** What a memory keeps: enough to show the song and look the audio up again. */
export interface MemoryMusic {
  provider: Track['provider'];
  id: string;
  title: string;
  artist: string;
  artwork: string | null;
  /** where in the song to start, in seconds */
  start: number;
}

async function call<T>(query: string): Promise<T> {
  const token = sessionStore.get().session?.access_token;
  const r = await fetch(`/api/music?${query}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error || `Music search failed (${r.status}).`);
  return body as T;
}

export const searchMusic = (q: string, page = 1) => call<{ tracks: Track[]; next: boolean }>(new URLSearchParams({ q, page: String(page) }).toString());

const audioCache = new Map<string, { url: string; at: number }>();
/** A fresh audio link for a memory's song (links expire, so ask again after a while). */
export async function audioFor(m: Pick<MemoryMusic, 'provider' | 'id'>): Promise<string | null> {
  const key = `${m.provider}:${m.id}`;
  const hit = audioCache.get(key);
  if (hit && Date.now() - hit.at < 20 * 60_000) return hit.url;
  const { track } = await call<{ track: Track }>(new URLSearchParams({ id: key }).toString());
  if (track.audio) audioCache.set(key, { url: track.audio, at: Date.now() });
  return track.audio;
}

export const toMemoryMusic = (t: Track, start = 0): MemoryMusic => ({ provider: t.provider, id: t.id, title: t.title, artist: t.artist, artwork: t.artwork?.startsWith('https://') ? t.artwork : null, start: Math.max(0, Math.round(start)) });

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
