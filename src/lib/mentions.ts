// The "Mentions" inbox in the notification panel. Messages are end-to-end
// encrypted, so pings are worked out on this device as messages arrive
// (Shell's message alerts) and kept here, per account, in local storage.
import { createStore } from './store';
import { supabase } from './supabase';
import { sessionStore } from './session';
import { markRead, unreadStore } from './notify';

export type PingKind = 'you' | 'role' | 'everyone' | 'here' | 'dm';
export interface Ping {
  id: string; // message id
  channelId: string;
  serverId: string | null;
  authorId: string;
  kind: PingKind;
  where: string; // "#general · Night Shift" or "Jordan"
  roleName?: string;
  text: string;
  at: string;
  read?: boolean;
}

const key = () => `venband:pings:${sessionStore.get().identity?.userId ?? 'anon'}`;
const load = (): Ping[] => {
  try {
    return JSON.parse(localStorage.getItem(key()) || '[]');
  } catch {
    return [];
  }
};
export const pingStore = createStore<{ items: Ping[]; loadedFor: string | null }>({ items: [], loadedFor: null });
function ensure() {
  const who = sessionStore.get().identity?.userId ?? null;
  if (pingStore.get().loadedFor !== who) pingStore.set({ items: load(), loadedFor: who });
}
function save(items: Ping[]) {
  pingStore.set({ items });
  try {
    localStorage.setItem(key(), JSON.stringify(items.slice(0, 200)));
  } catch {
    /* storage full or blocked */
  }
}
export function usePings() {
  ensure();
  return pingStore.use((s) => s.items);
}

/** What kind of ping a message is for me (strongest first), or null. */
export function pingKind(text: string, myId: string, myRoles: string[]): { kind: PingKind; roleId?: string } | null {
  if (text.includes(`<@${myId}>`) || text.includes(`<@!${myId}>`)) return { kind: 'you' };
  for (const m of text.matchAll(/<@&([0-9a-f-]{36})>/gi)) if (myRoles.includes(m[1])) return { kind: 'role', roleId: m[1] };
  if (/(^|\s)@everyone\b/.test(text)) return { kind: 'everyone' };
  if (/(^|\s)@here\b/.test(text)) return { kind: 'here' };
  return null;
}

const roleNames = new Map<string, string>();
export async function recordPing(p: Omit<Ping, 'roleName'> & { roleId?: string }) {
  ensure();
  let roleName: string | undefined;
  if (p.roleId) {
    roleName = roleNames.get(p.roleId);
    if (!roleName) {
      const { data } = await supabase.from('roles').select('name').eq('id', p.roleId).maybeSingle();
      roleName = (data?.name as string | undefined) ?? 'a role';
      roleNames.set(p.roleId, roleName);
    }
  }
  const { roleId: _drop, ...rest } = p;
  void _drop;
  const items = pingStore.get().items.filter((x) => x.id !== p.id);
  save([{ ...rest, roleName, text: p.text.slice(0, 200) }, ...items]);
}

export function markPingsRead(channelId?: string) {
  ensure();
  save(pingStore.get().items.map((x) => (!channelId || x.channelId === channelId ? { ...x, read: true } : x)));
}
export function clearPings() {
  save([]);
}

/** Read all: every red dot and ping badge goes away (on every device, via read states). */
export async function readAll() {
  const { counts, mentions } = unreadStore.get();
  const { error } = await supabase.rpc('mark_all_channels_read');
  if (error) throw error;
  const current = unreadStore.get();
  for (const id of new Set([...Object.keys(counts), ...Object.keys(mentions)])) {
    if (counts[id] === current.counts[id] && mentions[id] === current.mentions[id]) markRead(id);
  }
  markPingsRead();
  window.dispatchEvent(new Event('venband:read-all'));
}
