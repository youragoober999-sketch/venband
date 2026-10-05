// GIFs removed by a server's owner / administrators (or by Venband staff
// everywhere). Only SHA-256 hashes of the addresses are stored.
import { useEffect, useState } from 'react';
import { createStore } from './store';
import { supabase } from './supabase';
import { sessionStore } from './session';

export const REMOVED_TEXT = 'This GIF has been removed, probably because it didn’t follow https://www.venband.com/tos';

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
    hashCache.set(n, p);
  }
  return p;
}

// one live feed for everything this person can see (row security filters it)
let watching: string | null = null;
function watch() {
  const me = sessionStore.get().identity?.userId;
  if (!me || watching === me) return;
  watching = me;
  supabase
    .channel(`dbu:${me}:media`, { config: { private: true } })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'banned_media' }, () => {
      for (const key of loading.keys()) loadMediaBans(key === '*' ? null : key, true);
    })
    .subscribe();
}

export function loadMediaBans(serverId: string | null, force = false) {
  watch();
  const key = serverId ?? '*';
  if (!force && loading.has(key)) return loading.get(key)!;
  const p = (async () => {
    let q = supabase.from('banned_media').select('hash, server_id');
    q = serverId ? q.or(`server_id.eq.${serverId},server_id.is.null`) : q.is('server_id', null);
    const { data } = await q;
    store.set((s) => ({ hashes: { ...s.hashes, [key]: new Set((data ?? []).map((r) => r.hash as string)) } }));
  })();
  loading.set(key, p);
  return p;
}

/** Is this GIF removed where it's being shown? */
export function useMediaRemoved(url: string, serverId: string | null): boolean {
  const key = serverId ?? '*';
  const set = store.use((s) => s.hashes[key]);
  const [hash, setHash] = useState<string | null>(null);
  useEffect(() => {
    loadMediaBans(serverId);
    mediaHash(url).then(setHash);
  }, [url, serverId]);
  return Boolean(hash && set?.has(hash));
}

export async function setMediaRemoved(url: string, serverId: string | null, removed: boolean) {
  const { error } = await supabase.rpc('ban_media', { p_server: serverId, p_hash: await mediaHash(url), p_banned: removed });
  if (error) throw error;
  await loadMediaBans(serverId, true);
}
