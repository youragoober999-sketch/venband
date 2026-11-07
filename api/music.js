// Vercel Function: music search for Memories.
//
//   GET /api/music?q=chill%20guitar&page=1   -> { tracks: Track[], next: boolean }
//   GET /api/music?id=soundstripe:40627      -> { track: Track }   (fresh audio link)
//
// Track = { provider, id, title, artist, artwork, duration, audio, tags }
//
// The Soundstripe key is read ONLY from the SOUNDSTRIPE_API_KEY environment
// variable (Vercel → Project → Settings → Environment Variables). It never goes
// to the browser, the bundle or the repository. Only signed-in Venband users
// can search, so strangers can't burn through the key's quota.
//
// Free To Use (freetouse.com) is wired in but OFF unless FREETOUSE_ENABLED=1:
// its free licence doesn't allow use inside apps, so turn it on only once
// Venband has the paid licence that covers it. Premium tracks are always skipped.
import { userFromRequest } from './_lib/net.js';

const SS = 'https://api.soundstripe.com/v1';
const FTU = 'https://api.freetouse.com/v3';
const PAGE = 20;

const json = (status, body, cache = 'no-store') => Response.json(body, { status, headers: { 'cache-control': cache } });
const ssKey = () => (process.env.SOUNDSTRIPE_API_KEY || '').trim();
const ftuOn = () => process.env.FREETOUSE_ENABLED === '1';

// a small per-instance cache: the same searches come up again and again
const cache = new Map();
async function cached(key, ms, fn) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await fn();
  cache.set(key, { value, until: Date.now() + ms });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return value;
}

async function get(url, headers = {}) {
  const r = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error(`music service answered ${r.status}`);
  return r.json();
}

// ---------------------------------------------------------------- soundstripe

const ssHeaders = () => ({ authorization: `Token ${ssKey()}`, accept: 'application/vnd.api+json', 'content-type': 'application/vnd.api+json' });

/** JSON:API songs + included artists/audio files -> Track[] */
function fromSoundstripe(body) {
  const songs = Array.isArray(body.data) ? body.data : [body.data];
  const inc = new Map((body.included ?? []).map((x) => [`${x.type}:${x.id}`, x.attributes ?? {}]));
  return songs.filter(Boolean).map((s) => {
    const a = s.attributes ?? {};
    const artists = (s.relationships?.artists?.data ?? []).map((r) => inc.get(`artists:${r.id}`)).filter(Boolean);
    const file = (s.relationships?.audio_files?.data ?? []).map((r) => inc.get(`audio_files:${r.id}`)).find(Boolean) ?? {};
    const tags = a.tags ?? {};
    return {
      provider: 'soundstripe',
      id: String(s.id),
      title: String(a.title ?? 'Untitled').slice(0, 120),
      artist: artists.map((x) => x.name).filter(Boolean).join(', ').slice(0, 120),
      artwork: artists[0]?.image || null,
      duration: Math.round(file.duration ?? 0),
      audio: file.versions?.mp3 || null,
      tags: [...(tags.mood ?? []), ...(tags.genre ?? [])].slice(0, 4),
    };
  });
}

async function ssSearch(q, page) {
  const p = new URLSearchParams({ 'page[size]': String(PAGE), 'page[number]': String(page) });
  if (q) p.set('filter[q]', q);
  const body = await get(`${SS}/songs?${p}`, ssHeaders());
  return { tracks: fromSoundstripe(body).filter((t) => t.audio), next: Boolean(body.links?.next) };
}
async function ssTrack(id) {
  if (!/^\d{1,12}$/.test(id)) throw new Error('bad id');
  return fromSoundstripe(await get(`${SS}/songs/${id}`, ssHeaders()))[0] ?? null;
}

// ------------------------------------------------------------- free to use --

function fromFtu(t) {
  return {
    provider: 'freetouse',
    id: String(t.id),
    title: String(t.title ?? 'Untitled').slice(0, 120),
    artist: (t.artists ?? []).map((x) => (Array.isArray(x) ? x[1] : x)?.name).filter(Boolean).join(', ').slice(0, 120),
    artwork: t.thumbnails?.md || t.thumbnails?.sm || null,
    duration: Math.round(Number(t.duration) || 0),
    audio: t.files?.mp3 || null,
    tags: [t.genre, ...(t.tags ?? [])].filter((x) => typeof x === 'string').slice(0, 4),
  };
}
async function ftuSearch(q, page) {
  const p = new URLSearchParams({ limit: String(PAGE), offset: String((page - 1) * PAGE) });
  const body = q ? await get(`${FTU}/music/tracks/search?${p}&query=${encodeURIComponent(q)}`) : await get(`${FTU}/music/tracks/all?${p}&order=plays`);
  const list = (body.data ?? []).filter((t) => !t.is_premium).map(fromFtu).filter((t) => t.audio);
  return { tracks: list, next: (body.data ?? []).length >= PAGE };
}
async function ftuTrack(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('bad id');
  const body = await get(`${FTU}/music/tracks/${id}`);
  const t = body.data ?? body;
  return t && !t.is_premium ? fromFtu(t) : null;
}

// ------------------------------------------------------------------ handler --

export async function GET(request) {
  if (!(await userFromRequest(request))) return json(401, { error: 'Sign in to search music.' });
  const u = new URL(request.url);
  const sources = [ssKey() && 'soundstripe', ftuOn() && 'freetouse'].filter(Boolean);
  if (!sources.length) return json(503, { error: 'Music isn’t set up on this server yet (missing SOUNDSTRIPE_API_KEY).' });

  try {
    const id = u.searchParams.get('id');
    if (id) {
      const [provider, raw] = id.split(':');
      if (!sources.includes(provider)) return json(404, { error: 'That song isn’t available.' });
      const track = await cached(`t:${id}`, 30 * 60_000, () => (provider === 'soundstripe' ? ssTrack(raw) : ftuTrack(raw)));
      return track ? json(200, { track }) : json(404, { error: 'That song isn’t available any more.' });
    }

    const q = (u.searchParams.get('q') ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const page = Math.min(20, Math.max(1, Number(u.searchParams.get('page')) || 1));
    const results = await Promise.allSettled(sources.map((s) => cached(`s:${s}:${q.toLowerCase()}:${page}`, 10 * 60_000, () => (s === 'soundstripe' ? ssSearch(q, page) : ftuSearch(q, page)))));
    const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    if (!ok.length) return json(502, { error: 'The music service didn’t answer. Try again in a moment.' });
    // interleave the sources so neither drowns the other out
    const tracks = [];
    for (let i = 0; i < PAGE; i++) for (const r of ok) if (r.tracks[i]) tracks.push(r.tracks[i]);
    return json(200, { tracks, next: ok.some((r) => r.next) });
  } catch {
    return json(502, { error: 'Couldn’t reach the music service.' });
  }
}
