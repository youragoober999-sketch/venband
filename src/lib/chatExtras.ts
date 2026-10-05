// Per-channel extras that sit next to messages: reactions, pins, threads,
// polls. Loaded for the messages on screen and kept live over realtime.
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { sessionStore } from './session';
import { noteEmojiUse } from './settings';
import type { MessageRow } from './types';

export interface ReactionGroup {
  emoji: string;
  count: number;
  users: string[];
  /** my reaction row id, if I reacted with this */
  mine: string | null;
}

export interface ThreadInfo {
  root_id: string;
  channel_id: string;
  name: string;
  created_by: string;
  created_at: string;
  locked: boolean;
  archived: boolean;
  last_message_at: string;
  message_count: number;
}

export interface PollState {
  multi: boolean;
  anonymous: boolean;
  expires_at: string | null;
  option_count: number;
  counts: number[];
  mine: number[];
  voters?: Record<number, string[]>;
}

interface ReactionRow {
  id: string;
  message_id: string;
  channel_id: string;
  user_id: string;
  epoch: number;
  tag: string;
  iv: string;
  ciphertext: string;
}

const reactionAad = (messageId: string, userId: string) => `venband/reaction|${messageId}|${userId}`;

export function useChannelExtras(channelId: string, messageIds: string[], topicSuffix = '') {
  const keyring = sessionStore.use((s) => s.keyring);
  const me = sessionStore.use((s) => s.identity?.userId);
  const [reactions, setReactions] = useState<Record<string, ReactionGroup[]>>({});
  const [pins, setPins] = useState<{ message_id: string; pinned_at: string; pinned_by: string }[]>([]);
  const [threads, setThreads] = useState<Record<string, ThreadInfo>>({});
  const [polls, setPolls] = useState<Record<string, PollState>>({});
  const idsRef = useRef<string[]>([]);
  idsRef.current = messageIds;
  const decrypted = useRef(new Map<string, string | null>()); // reaction id -> emoji

  const loadReactions = useCallback(async () => {
    if (!keyring) return;
    const ids = idsRef.current;
    const rows: ReactionRow[] = [];
    for (let i = 0; i < ids.length; i += 150) {
      const { data } = await supabase.from('reactions').select('id, message_id, channel_id, user_id, epoch, tag, iv, ciphertext').eq('channel_id', channelId).in('message_id', ids.slice(i, i + 150));
      rows.push(...((data ?? []) as ReactionRow[]));
    }
    const out: Record<string, Map<string, ReactionGroup>> = {};
    for (const r of rows) {
      let emoji = decrypted.current.get(r.id);
      if (emoji === undefined) {
        emoji = await keyring.openSmall(r.channel_id, r.epoch, 'reaction', reactionAad(r.message_id, r.user_id), r.iv, r.ciphertext);
        if (emoji !== null) decrypted.current.set(r.id, emoji);
      }
      if (!emoji) continue;
      const groups = (out[r.message_id] ??= new Map());
      const g = groups.get(emoji) ?? { emoji, count: 0, users: [], mine: null };
      if (g.users.includes(r.user_id)) continue; // one per person even across key epochs
      g.count++;
      g.users.push(r.user_id);
      if (r.user_id === me) g.mine = r.id;
      groups.set(emoji, g);
    }
    setReactions(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v.values()]])));
  }, [channelId, keyring, me]);

  const loadPins = useCallback(async () => {
    const { data } = await supabase.from('pins').select('message_id, pinned_at, pinned_by').eq('channel_id', channelId).order('pinned_at', { ascending: false });
    setPins((data ?? []) as typeof pins);
  }, [channelId]);

  const loadThreads = useCallback(async () => {
    const { data } = await supabase.from('threads').select('*').eq('channel_id', channelId).order('last_message_at', { ascending: false }).limit(200);
    setThreads(Object.fromEntries(((data ?? []) as ThreadInfo[]).map((t) => [t.root_id, t])));
  }, [channelId]);

  const loadPolls = useCallback(async () => {
    const ids = idsRef.current;
    if (!ids.length) return setPolls({});
    const { data } = await supabase.from('polls').select('message_id, multi, anonymous, expires_at, option_count').eq('channel_id', channelId).in('message_id', ids.slice(-200));
    const list = (data ?? []) as { message_id: string; multi: boolean; anonymous: boolean; expires_at: string | null; option_count: number }[];
    if (!list.length) return setPolls({});
    const { data: votes } = await supabase.from('poll_votes').select('message_id, user_id, options').in('message_id', list.map((p) => p.message_id));
    const out: Record<string, PollState> = {};
    for (const p of list) {
      const { data: res } = await supabase.rpc('poll_results', { p_message: p.message_id });
      const counts = Array.from({ length: p.option_count }, () => 0);
      for (const r of (res ?? []) as { option: number; votes: number }[]) if (r.option < counts.length) counts[r.option] = Number(r.votes);
      const vs = ((votes ?? []) as { message_id: string; user_id: string; options: number[] }[]).filter((v) => v.message_id === p.message_id);
      const voters: Record<number, string[]> = {};
      if (!p.anonymous) for (const v of vs) for (const o of v.options) (voters[o] ??= []).push(v.user_id);
      out[p.message_id] = { ...p, counts, mine: vs.find((v) => v.user_id === me)?.options ?? [], voters: p.anonymous ? undefined : voters };
    }
    setPolls(out);
  }, [channelId, me]);

  const idKey = messageIds.join(',');
  useEffect(() => {
    loadReactions();
    loadPolls();
  }, [idKey, loadReactions, loadPolls]);

  useEffect(() => {
    setReactions({});
    setPins([]);
    setThreads({});
    setPolls({});
    decrypted.current = new Map();
    loadPins();
    loadThreads();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const debounce = (fn: () => void) => {
      clearTimeout(timer);
      timer = setTimeout(fn, 120);
    };
    const ch = supabase
      .channel(`dbc:${channelId}:extras${topicSuffix}`, { config: { private: true } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions', filter: `channel_id=eq.${channelId}` }, () => debounce(loadReactions))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pins', filter: `channel_id=eq.${channelId}` }, loadPins)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'threads', filter: `channel_id=eq.${channelId}` }, loadThreads)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'poll_votes', filter: `channel_id=eq.${channelId}` }, () => debounce(loadPolls))
      .subscribe();
    const onKeys = keyring?.onKeys((id) => id === channelId && loadReactions());
    return () => {
      clearTimeout(timer);
      onKeys?.();
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, keyring, topicSuffix]);

  return { reactions, pins, threads, polls, reloadReactions: loadReactions, reloadPins: loadPins, reloadThreads: loadThreads, reloadPolls: loadPolls };
}

/** Add or remove my reaction. */
export async function toggleReaction(m: MessageRow, emoji: string, mine: string | null) {
  const { keyring, identity } = sessionStore.get();
  if (!keyring || !identity) return;
  if (mine) {
    const { error } = await supabase.from('reactions').delete().eq('id', mine);
    if (error) throw error;
    return;
  }
  // encrypt with the newest key we hold (the message's own epoch may be older)
  await keyring.ensure(m.channel_id);
  const epoch = keyring.hasKey(m.channel_id, m.epoch) ? m.epoch : keyring.latestEpoch(m.channel_id);
  const env = await keyring.sealSmall(m.channel_id, epoch, 'reaction', reactionAad(m.id, identity.userId), emoji);
  const tag = await keyring.tag(m.channel_id, epoch, 'reaction', `${m.id}|${emoji}`);
  const { error } = await supabase.from('reactions').insert({ message_id: m.id, channel_id: m.channel_id, user_id: identity.userId, epoch, tag, ...env });
  if (error && !/duplicate key/i.test(error.message)) throw error;
  noteEmojiUse(emoji, true);
}

export async function setPinned(m: MessageRow, pinned: boolean) {
  const { error } = pinned
    ? await supabase.from('pins').insert({ message_id: m.id, channel_id: m.channel_id })
    : await supabase.from('pins').delete().eq('message_id', m.id);
  if (error && !/duplicate key/i.test(error.message)) throw error;
}

export async function votePoll(messageId: string, channelId: string, options: number[]) {
  const me = sessionStore.get().identity?.userId;
  if (!options.length) {
    const { error } = await supabase.from('poll_votes').delete().eq('message_id', messageId).eq('user_id', me!);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from('poll_votes').upsert({ message_id: messageId, channel_id: channelId, user_id: me, options, voted_at: new Date().toISOString() });
  if (error) throw error;
}

// ------------------------------------------------------------ saved messages --

export async function setSaved(m: MessageRow, saved: boolean) {
  const { error } = saved
    ? await supabase.from('saved_messages').insert({ message_id: m.id, channel_id: m.channel_id })
    : await supabase.from('saved_messages').delete().eq('message_id', m.id);
  if (error && !/duplicate key/i.test(error.message)) throw error;
  savedIds.add(m.id);
  if (!saved) savedIds.delete(m.id);
}

const savedIds = new Set<string>();
let savedLoaded: Promise<void> | null = null;
export function loadSavedIds() {
  savedLoaded ??= (async () => {
    const { data } = await supabase.from('saved_messages').select('message_id');
    for (const r of data ?? []) savedIds.add(r.message_id);
  })();
  return savedLoaded;
}
export const isSaved = (id: string) => savedIds.has(id);
export function resetSaved() {
  savedIds.clear();
  savedLoaded = null;
}
