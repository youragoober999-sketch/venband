// Friends, friend requests and private per-user preferences (nickname, pin,
// mute, block). Rows are protected by RLS: you only ever see your own.
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { createStore } from './store';
import { loadProfiles, setPersonalNicknames } from './directory';

export interface Friendship {
  other: string;
  accepted: boolean;
  incoming: boolean;
  since: string;
}

export interface Relation {
  target_id: string;
  nickname: string | null;
  note: string;
  pinned: boolean;
  muted: boolean;
  blocked: boolean;
}

export const socialStore = createStore<{ friends: Record<string, Friendship>; relations: Record<string, Relation>; loaded: boolean }>({
  friends: {},
  relations: {},
  loaded: false,
});

let me: string | null = null;
setPersonalNicknames((id) => socialStore.get().relations[id]?.nickname ?? null);
let channel: RealtimeChannel | null = null;

export async function loadSocial() {
  if (!me) return;
  const [f, r] = await Promise.all([
    supabase.from('friendships').select('*'),
    supabase.from('user_relations').select('target_id, nickname, note, pinned, muted, blocked'),
  ]);
  const friends: Record<string, Friendship> = {};
  for (const row of (f.data ?? []) as { user_a: string; user_b: string; requester: string; accepted: boolean; created_at: string }[]) {
    const other = row.user_a === me ? row.user_b : row.user_a;
    friends[other] = { other, accepted: row.accepted, incoming: row.requester !== me, since: row.created_at };
  }
  const relations: Record<string, Relation> = {};
  for (const row of (r.data ?? []) as Relation[]) relations[row.target_id] = row;
  await loadProfiles([...Object.keys(friends), ...Object.keys(relations)]);
  socialStore.set({ friends, relations, loaded: true });
}

export function startSocial(userId: string) {
  stopSocial();
  me = userId;
  loadSocial();
  let t: ReturnType<typeof setTimeout> | undefined;
  const fire = () => {
    clearTimeout(t);
    t = setTimeout(loadSocial, 200);
  };
  channel = supabase
    .channel(`dbu:${userId}:social`, { config: { private: true } })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, fire)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'user_relations' }, fire)
    .subscribe();
}

export function stopSocial() {
  if (channel) supabase.removeChannel(channel);
  channel = null;
  me = null;
  socialStore.set({ friends: {}, relations: {}, loaded: false });
}

// ---------------------------------------------------------------- queries --

export const isFriend = (id: string) => Boolean(socialStore.get().friends[id]?.accepted);
export const isBlocked = (id: string) => Boolean(socialStore.get().relations[id]?.blocked);
export const isMuted = (id: string) => Boolean(socialStore.get().relations[id]?.muted);
export const friendNickname = (id: string) => socialStore.get().relations[id]?.nickname ?? null;

// ---------------------------------------------------------------- actions --

export async function sendFriendRequest(username: string): Promise<string> {
  const { data, error } = await supabase.rpc('send_friend_request', { p_username: username.replace(/^@/, '').trim().toLowerCase() });
  if (error) throw error;
  await loadSocial();
  return data as string;
}

export async function respondFriend(other: string, accept: boolean) {
  const { error } = await supabase.rpc('respond_friend_request', { p_other: other, p_accept: accept });
  if (error) throw error;
  await loadSocial();
}

export async function removeFriend(other: string) {
  const { error } = await supabase.rpc('remove_friend', { p_other: other });
  if (error) throw error;
  await loadSocial();
}

export async function setRelation(target: string, patch: Partial<Omit<Relation, 'target_id'>>) {
  if (!me) return;
  const cur = socialStore.get().relations[target];
  const row = {
    owner_id: me,
    target_id: target,
    nickname: cur?.nickname ?? null,
    note: cur?.note ?? '',
    pinned: cur?.pinned ?? false,
    muted: cur?.muted ?? false,
    blocked: cur?.blocked ?? false,
    ...patch,
  };
  // optimistic
  socialStore.set((s) => ({ relations: { ...s.relations, [target]: { ...row } } }));
  const { error } = await supabase.from('user_relations').upsert(row);
  if (error) {
    await loadSocial();
    throw error;
  }
  if (patch.blocked) await loadSocial(); // blocking also removes the friendship
}
