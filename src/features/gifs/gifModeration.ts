// GIFs removed by a server's owner / administrators (or by Venband staff
// everywhere). Only SHA-256 hashes of the addresses are stored.
import { useEffect, useState } from 'react';
import { createStore } from '../../lib/store';
import { supabase } from '../../lib/supabase';
import { sessionStore } from '../../lib/session';

export const REMOVED_TEXT = 'This GIF has been taken down.';

const store = createStore<{ hashes: Record<string, Set<string>> }>({ hashes: {} }); // server id or '*' -> hashes
const loading = new Map<string, Promise<void>>();

export function normalizeMediaUrl(url: string) {
  try {
    const u = new URL(url.trim());
    u.hash = '';
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname}${u.search}`;
  } catch {
    return url.trim();
  }
}

const hashCache = new Map<string, Promise<string>>();
export function mediaHash(url: string): Promise<string> {
  const n = normalizeMediaUrl(url);
  let p = hashCache.get(n);
  if (!p) {
    p = crypto.subtle.digest('SHA-256', new TextEncoder().encode(n)).then((d) => [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join(''));
    if (hashCache.size >= 2048) hashCache.delete(hashCache.keys().next().value!);
    hashCache.set(n, p);
  }
  return p;
}

// one live feed for everything this person can see (row security filters it)
let watching: string | null = null;
let subscription: ReturnType<typeof supabase.channel> | undefined;

function watch() {
  const me = sessionStore.get().identity?.userId ?? null;
  if (watching === me) return;
  watching = me;
  if (subscription) void supabase.removeChannel(subscription);
  loading.clear();
  store.set({ hashes: {} });
  if (!me) return;
  subscription = supabase
    .channel(`dbu:${me}:media`, { config: { private: true } })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'banned_media' }, () => {
      for (const key of loading.keys()) void loadMediaBans(key === '*' ? null : key, true);
    })
    .subscribe((status) => {
      if (status !== 'SUBSCRIBED' || watching !== me) return;
      for (const key of loading.keys()) void loadMediaBans(key === '*' ? null : key, true);
    });
}

export function loadMediaBans(serverId: string | null, force = false) {
  watch();
  const key = serverId ?? '*';
  if (!force && loading.has(key)) return loading.get(key)!;
  const account = watching;
  const request: Promise<void> = Promise.resolve().then(async () => {
    const hashes = new Set<string>();
    const size = 500;
    for (let offset = 0; ; offset += size) {
      let query = supabase.from('banned_media').select('hash').order('id').range(offset, offset + size - 1);
      query = serverId ? query.or(`server_id.eq.${serverId},server_id.is.null`) : query.is('server_id', null);
      const { data, error } = await query;
      if (watching !== account || loading.get(key) !== request) return;
      if (error) {
        loading.delete(key);
        return;
      }
      for (const row of data) hashes.add(row.hash);
      if (data.length < size) break;
    }
    store.set((s) => ({ hashes: { ...s.hashes, [key]: hashes } }));
  });
  loading.set(key, request);
  return request;
}

export async function assertMediaAllowed(urls: string[], serverId: string | null) {
  if (!urls.length) return;
  await loadMediaBans(serverId);
  const hashes = store.get().hashes[serverId ?? '*'];
  if (!hashes) throw new Error('GIF availability couldn’t be checked. Try again.');
  if ((await Promise.all(urls.map(mediaHash))).some((hash) => hashes.has(hash))) {
    throw new Error(REMOVED_TEXT);
  }
}

/** Check a message's GIFs together so the player and context menu agree. */
export function useMediaStatuses(urls: string[], serverId: string | null) {
  const key = serverId ?? '*';
  const hashes = store.use((s) => s.hashes[key]);
  const signature = JSON.stringify(urls);
  const [resolved, setResolved] = useState<{ signature: string; hashes: string[] }>();
  useEffect(() => {
    if (signature === '[]') return;
    let cancelled = false;
    void loadMediaBans(serverId);
    void Promise.all((JSON.parse(signature) as string[]).map(mediaHash)).then((values) => {
      if (!cancelled) setResolved({ signature, hashes: values });
    });
    return () => { cancelled = true; };
  }, [signature, serverId]);
  return (url: string): 'checking' | 'removed' | 'allowed' => {
    if (!hashes || resolved?.signature !== signature) return 'checking';
    return hashes.has(resolved.hashes[urls.indexOf(url)]) ? 'removed' : 'allowed';
  };
}
export async function setMediaRemoved(url: string, serverId: string | null, removed: boolean) {
  const { error } = await supabase.rpc('ban_media', { p_server: serverId, p_hash: await mediaHash(url), p_banned: removed });
  if (error) throw error;
  await loadMediaBans(serverId, true);
}
