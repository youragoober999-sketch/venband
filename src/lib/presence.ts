// Shared presence per "scope" (a server or a DM / group). Tells the UI who is
// online and who is in which voice channel. One Realtime channel per scope,
// ref-counted so the sidebar and the call engine can share it.
//
// Supabase Realtime only allows a handful of Presence updates per client per
// 30 seconds and shuts the channel down when that's exceeded. So:
//   * Presence carries only slow-changing state: who is here, and which voice
//     channel they're in (changes when you join/leave a call).
//   * Fast-changing call flags (muted / deafened / camera / screen) travel over
//     Broadcast, which has no such limit, plus a heartbeat for late joiners.
//   * Every Presence write goes through a small budget, and a reconcile loop
//     compares what the server shows for this tab with what it should be, so a
//     dropped update heals itself instead of leaving you "in the call" forever.
//   * A channel the server closed is reopened with backoff.
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

export interface PresenceMeta {
  user_id: string;
  session: string;
  voice_channel_id: string | null;
  /** when they joined that voice channel (ms) — calls only ring for a short while after this */
  voice_since: number | null;
  muted: boolean;
  deafened: boolean;
  video: boolean;
  screen: boolean;
}

interface PresenceRow {
  user_id: string;
  session: string;
  voice_channel_id: string | null;
  voice_since?: number | null;
}

interface Flags {
  muted: boolean;
  deafened: boolean;
  video: boolean;
  screen: boolean;
}

export const TAB_SESSION = crypto.randomUUID();

const BUDGET = 4; // presence writes …
const WINDOW_MS = 30_000; // … per this window (the server allows 5)
const HEARTBEAT_MS = 8_000;

interface Scope {
  id: string;
  channel: RealtimeChannel | null;
  refs: number;
  /** wants to show this tab as online (servers); DMs only show you while in a call */
  onlineRefs: number;
  rows: PresenceRow[];
  flags: Map<string, Flags>;
  merged: PresenceMeta[];
  listeners: Set<() => void>;
  joined: boolean;
  sentAt: number[];
  lastSentKey: string | null;
  lastSentAt: number;
  retry: ReturnType<typeof setTimeout> | null;
  reconnectDelay: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

const scopes = new Map<string, Scope>();
let myUserId = '';
let voiceState: Flags & { scope: string | null; voice_channel_id: string | null; since: number | null } = {
  scope: null,
  voice_channel_id: null,
  since: null,
  muted: false,
  deafened: false,
  video: false,
  screen: false,
};

export function setPresenceUser(userId: string) {
  myUserId = userId;
}

const NO_FLAGS: Flags = { muted: false, deafened: false, video: false, screen: false };

function myFlags(): Flags {
  return { muted: voiceState.muted, deafened: voiceState.deafened, video: voiceState.video, screen: voiceState.screen };
}

function inCallHere(s: Scope) {
  return voiceState.scope === s.id && voiceState.voice_channel_id ? voiceState.voice_channel_id : null;
}

function desiredRow(s: Scope): PresenceRow | null {
  const vc = inCallHere(s);
  if (!vc && s.onlineRefs <= 0) return null; // listen-only scope
  return { user_id: myUserId, session: TAB_SESSION, voice_channel_id: vc, voice_since: vc ? voiceState.since : null };
}

const rowKey = (r: PresenceRow | null | undefined) => (r ? `${r.user_id}|${r.session}|${r.voice_channel_id ?? ''}` : 'none');

function recompute(s: Scope) {
  const live = new Set(s.rows.map((r) => r.session));
  for (const k of s.flags.keys()) if (!live.has(k)) s.flags.delete(k);
  s.merged = s.rows.map((r) => ({
    ...r,
    voice_channel_id: r.voice_channel_id ?? null,
    voice_since: r.voice_channel_id ? (r.voice_since ?? null) : null,
    ...(r.session === TAB_SESSION ? (inCallHere(s) ? myFlags() : NO_FLAGS) : (s.flags.get(r.session) ?? NO_FLAGS)),
  }));
  s.listeners.forEach((l) => l());
}

/** Bring the server's presence for this tab in line with reality (rate-limited). */
function syncPresence(s: Scope) {
  if (!s.joined || !s.channel) return;
  const want = desiredRow(s);
  const wantKey = rowKey(want);
  const seenKey = rowKey(s.rows.find((r) => r.session === TAB_SESSION));
  const now = Date.now();
  if (seenKey === wantKey) return;
  // already sent this and waiting for the server to echo it back
  if (s.lastSentKey === wantKey && now - s.lastSentAt < 6_000) return;
  s.sentAt = s.sentAt.filter((t) => now - t < WINDOW_MS);
  if (s.sentAt.length >= BUDGET) {
    const wait = s.sentAt[0] + WINDOW_MS - now + 200;
    if (s.retry) clearTimeout(s.retry);
    s.retry = setTimeout(() => ((s.retry = null), syncPresence(s)), wait);
    return;
  }
  s.sentAt.push(now);
  s.lastSentKey = wantKey;
  s.lastSentAt = now;
  const ch = s.channel;
  (want ? ch.track(want) : ch.untrack()).then((res) => {
    if (res !== 'ok' && s.channel === ch) {
      s.lastSentKey = null;
      // the server stopped answering: reopen the channel
      if (res === 'timed out') reconnect(s);
    }
  });
}

function sendFlags(s: Scope) {
  if (!s.joined || !s.channel || !inCallHere(s)) return;
  s.channel.send({ type: 'broadcast', event: 'voice', payload: { session: TAB_SESSION, ...myFlags() } });
}

function open(s: Scope) {
  const channel = supabase.channel(`scope:${s.id}`, {
    config: { private: true, presence: { key: TAB_SESSION }, broadcast: { self: false } },
  });
  s.channel = channel;
  s.joined = false;
  channel.on('presence', { event: 'sync' }, () => {
    if (s.channel !== channel) return;
    const st = channel.presenceState<PresenceRow>();
    s.rows = Object.values(st).flatMap((arr) => {
      const m = arr[arr.length - 1] as unknown as PresenceRow;
      return m ? [{ user_id: m.user_id, session: m.session, voice_channel_id: m.voice_channel_id ?? null, voice_since: m.voice_since ?? null }] : [];
    });
    recompute(s);
    syncPresence(s);
  });
  channel.on('presence', { event: 'join' }, () => sendFlags(s)); // tell newcomers our call flags
  // Someone (usually a new member) can't read older messages yet: if we hold
  // the channel's keys, wrap them for everyone who is missing them. The keys
  // are encrypted to each member's own public key, so this reveals nothing.
  channel.on('broadcast', { event: 'need-keys' }, ({ payload }) => {
    const id = (payload as { channel_id?: string })?.channel_id;
    if (!id || !/^[0-9a-f-]{36}$/.test(id)) return;
    import('./session').then(({ sessionStore }) => {
      const kr = sessionStore.get().keyring;
      if (!kr) return;
      setTimeout(() => {
        kr.loadChannel(id)
          .then(() => (kr.hasAnyKey(id) ? kr.distribute(id) : undefined))
          .catch(() => {});
      }, Math.random() * 1500);
    });
  });
  // someone pressed "Call": ring the others for a little while
  channel.on('broadcast', { event: 'ring' }, ({ payload }) => {
    const p = payload as { channel_id?: string; from?: string };
    if (!p?.channel_id || !p.from || p.from === myUserId) return;
    rings.set(p.channel_id, { from: p.from, at: Date.now() });
    ringListeners.forEach((l) => l());
  });
  channel.on('broadcast', { event: 'voice' }, ({ payload }) => {
    const p = payload as Flags & { session: string };
    if (!p?.session) return;
    s.flags.set(p.session, { muted: !!p.muted, deafened: !!p.deafened, video: !!p.video, screen: !!p.screen });
    recompute(s);
  });
  channel.subscribe((status) => {
    if (s.channel !== channel) return;
    if (status === 'SUBSCRIBED') {
      s.joined = true;
      s.reconnectDelay = 3_000;
      s.lastSentKey = null;
      syncPresence(s);
      sendFlags(s);
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      s.joined = false;
      reconnect(s);
    }
  });
}

function reconnect(s: Scope) {
  if (s.reconnectTimer || s.refs <= 0) return;
  const old = s.channel;
  s.channel = null;
  s.joined = false;
  if (old) supabase.removeChannel(old);
  s.reconnectTimer = setTimeout(() => {
    s.reconnectTimer = null;
    if (s.refs > 0) open(s);
  }, s.reconnectDelay);
  s.reconnectDelay = Math.min(s.reconnectDelay * 2, 30_000);
}

/**
 * Subscribe to a scope. `online: true` (servers) shows this tab as online;
 * DM/group scopes only show you while you're in a call there.
 */
export function acquireScope(scopeId: string, opts: { online?: boolean } = {}): () => void {
  let s = scopes.get(scopeId);
  if (!s) {
    s = {
      id: scopeId,
      channel: null,
      refs: 0,
      onlineRefs: 0,
      rows: [],
      flags: new Map(),
      merged: [],
      listeners: new Set(),
      joined: false,
      sentAt: [],
      lastSentKey: null,
      lastSentAt: 0,
      retry: null,
      reconnectDelay: 3_000,
      reconnectTimer: null,
    };
    scopes.set(scopeId, s);
    open(s);
  }
  const scope = s;
  scope.refs++;
  if (opts.online) {
    scope.onlineRefs++;
    syncPresence(scope);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    scope.refs--;
    if (opts.online) scope.onlineRefs--;
    if (scope.refs <= 0) {
      scopes.delete(scopeId);
      if (scope.retry) clearTimeout(scope.retry);
      if (scope.reconnectTimer) clearTimeout(scope.reconnectTimer);
      if (scope.channel) supabase.removeChannel(scope.channel);
    } else {
      syncPresence(scope);
    }
  };
}

export function scopeState(scopeId: string): PresenceMeta[] {
  return scopes.get(scopeId)?.merged ?? EMPTY;
}
const EMPTY: PresenceMeta[] = [];

export function subscribeScope(scopeId: string, l: () => void) {
  const s = scopes.get(scopeId);
  s?.listeners.add(l);
  return () => s?.listeners.delete(l);
}

const pending = new Map<string, ReturnType<typeof setTimeout>>();

/** Called by the call engine whenever local voice state changes. */
export function setVoiceState(next: Partial<typeof voiceState>) {
  const prev = voiceState;
  voiceState = { ...voiceState, ...next };
  if (voiceState.voice_channel_id !== prev.voice_channel_id) voiceState.since = voiceState.voice_channel_id ? Date.now() : null;
  for (const id of new Set([prev.scope, voiceState.scope])) {
    const s = id ? scopes.get(id) : undefined;
    if (!s) continue;
    recompute(s); // our own row reflects new flags immediately
    clearTimeout(pending.get(s.id));
    pending.set(
      s.id,
      setTimeout(() => {
        pending.delete(s.id);
        syncPresence(s); // only writes presence if the voice channel changed
        sendFlags(s);
      }, 250),
    );
  }
}

// Heartbeat: re-announce call flags for late joiners and heal presence drift.
setInterval(() => {
  for (const s of scopes.values()) {
    syncPresence(s);
    sendFlags(s);
  }
}, HEARTBEAT_MS);

export function onlineUserIds(scopeId: string): Set<string> {
  return new Set(scopeState(scopeId).map((m) => m.user_id));
}

/** Ask online members of a server / conversation to share keys for a channel. */
export function requestKeys(scopeId: string, channelId: string) {
  const s = scopes.get(scopeId);
  if (s?.channel && s.joined) {
    s.channel.send({ type: 'broadcast', event: 'need-keys', payload: { channel_id: channelId } });
    return;
  }
  const release = acquireScope(scopeId);
  let sent = false;
  const send = () => {
    if (sent) return;
    const cur = scopes.get(scopeId);
    if (!cur?.channel || !cur.joined) return;
    sent = true;
    clearInterval(t);
    cur.channel.send({ type: 'broadcast', event: 'need-keys', payload: { channel_id: channelId } });
    setTimeout(release, 4_000);
  };
  // send as soon as the scope finishes joining, so the broadcast isn't lost
  // because we fired before subscribing (the old fixed 2s delay did that).
  const t = setInterval(send, 250);
  setTimeout(() => {
    clearInterval(t);
    if (!sent) send();
    setTimeout(release, 4_000);
  }, 4_000);
}

// ------------------------------------------------------------------ rings --
// A call only rings when someone presses "Call", not when they rejoin, refresh
// or are simply sitting in a call.
const rings = new Map<string, { from: string; at: number }>();
const ringListeners = new Set<() => void>();
export const RING_MS = 45_000;

export function ringFor(channelId: string): { from: string; at: number } | null {
  const r = rings.get(channelId);
  return r && Date.now() - r.at < RING_MS ? r : null;
}
export function subscribeRings(l: () => void) {
  ringListeners.add(l);
  return () => {
    ringListeners.delete(l);
  };
}
export function clearRing(channelId: string) {
  rings.delete(channelId);
  ringListeners.forEach((l) => l());
}
/** Tell the other people in a DM / group that you're calling them. */
export function sendRing(scopeId: string, channelId: string) {
  const send = () => scopes.get(scopeId)?.channel?.send({ type: 'broadcast', event: 'ring', payload: { channel_id: channelId, from: myUserId } });
  // the scope may still be connecting: send now and once more shortly after
  send();
  setTimeout(send, 2_000);
}
