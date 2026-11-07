// Who's online, for DMs and group DMs (server member lists use the live
// presence channel instead). A heartbeat every minute while Venband is open,
// and a batched lookup for the people on screen. See 20261106180000.
import { useEffect, useState } from 'react';
import { supabase, isOldSchema } from './supabase';

const online = new Set<string>();
const watching = new Map<string, number>(); // user id -> how many components want it
const listeners = new Set<() => void>();
let unavailable = false;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let poll: ReturnType<typeof setInterval> | null = null;

async function beat() {
  if (unavailable || document.visibilityState !== 'visible') return;
  const { error } = await supabase.rpc('touch_online');
  if (error && isOldSchema(error)) unavailable = true;
}
async function refresh() {
  if (unavailable || !watching.size) return;
  const ids = [...watching.keys()].slice(0, 200);
  const { data, error } = await supabase.rpc('online_users', { p_ids: ids });
  if (error) {
    if (isOldSchema(error)) unavailable = true;
    return;
  }
  const now = new Set((data ?? []) as string[]);
  let changed = false;
  for (const id of ids) {
    const was = online.has(id), is = now.has(id);
    if (was !== is) {
      changed = true;
      if (is) online.add(id);
      else online.delete(id);
    }
  }
  if (changed) listeners.forEach((l) => l());
}

/** Start the heartbeat (once per signed-in tab). */
export function startOnlineHeartbeat() {
  if (heartbeat) return;
  void beat();
  heartbeat = setInterval(beat, 60_000);
  document.addEventListener('visibilitychange', beat);
}
export function stopOnlineHeartbeat() {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
  document.removeEventListener('visibilitychange', beat);
}

/** The subset of `ids` that are online right now (re-renders when it changes). */
export function useOnline(ids: string[]): Set<string> {
  const [, force] = useState(0);
  const key = [...new Set(ids)].sort().join(',');
  useEffect(() => {
    const list = key ? key.split(',') : [];
    list.forEach((id) => watching.set(id, (watching.get(id) ?? 0) + 1));
    const l = () => force((x) => x + 1);
    listeners.add(l);
    void refresh();
    poll ??= setInterval(refresh, 30_000);
    return () => {
      listeners.delete(l);
      list.forEach((id) => {
        const n = (watching.get(id) ?? 1) - 1;
        if (n <= 0) watching.delete(id);
        else watching.set(id, n);
      });
      if (!watching.size && poll) {
        clearInterval(poll);
        poll = null;
      }
    };
  }, [key]);
  return new Set(ids.filter((id) => online.has(id)));
}
