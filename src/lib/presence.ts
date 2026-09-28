// Shared presence per "scope" (a server or a DM). Tracks who is online and
// who is in which voice channel. One Realtime channel per scope, ref-counted
// so the sidebar and the call engine can share it.
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

export interface PresenceMeta {
  user_id: string;
  session: string;
  voice_channel_id: string | null;
  muted: boolean;
  deafened: boolean;
  video: boolean;
  screen: boolean;
}

export const TAB_SESSION = crypto.randomUUID();

interface Scope {
  channel: RealtimeChannel;
  refs: number;
  state: PresenceMeta[];
  mine: PresenceMeta;
  listeners: Set<() => void>;
  joined: boolean;
}

const scopes = new Map<string, Scope>();
let myUserId = '';
let voiceState: Omit<PresenceMeta, 'user_id' | 'session'> & { scope: string | null } = {
  scope: null,
  voice_channel_id: null,
  muted: false,
  deafened: false,
  video: false,
  screen: false,
};

export function setPresenceUser(userId: string) {
  myUserId = userId;
}

function metaFor(scopeId: string): PresenceMeta {
  const inScope = voiceState.scope === scopeId;
  return {
    user_id: myUserId,
    session: TAB_SESSION,
    voice_channel_id: inScope ? voiceState.voice_channel_id : null,
    muted: inScope && voiceState.muted,
    deafened: inScope && voiceState.deafened,
    video: inScope && voiceState.video,
    screen: inScope && voiceState.screen,
  };
}

export function acquireScope(scopeId: string): () => void {
  let s = scopes.get(scopeId);
  if (!s) {
    const channel = supabase.channel(`scope:${scopeId}`, {
      config: { private: true, presence: { key: TAB_SESSION } },
    });
    const scope: Scope = { channel, refs: 0, state: [], mine: metaFor(scopeId), listeners: new Set(), joined: false };
    channel.on('presence', { event: 'sync' }, () => {
      const st = channel.presenceState<PresenceMeta>();
      scope.state = Object.values(st).flatMap((arr) => arr.map((m) => m as unknown as PresenceMeta));
      scope.listeners.forEach((l) => l());
    });
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        scope.joined = true;
        channel.track(metaFor(scopeId));
      }
    });
    scopes.set(scopeId, scope);
    s = scope;
  }
  s.refs++;
  const scope = s;
  return () => {
    scope.refs--;
    if (scope.refs <= 0) {
      scopes.delete(scopeId);
      supabase.removeChannel(scope.channel);
    }
  };
}

export function scopeState(scopeId: string): PresenceMeta[] {
  return scopes.get(scopeId)?.state ?? EMPTY;
}
const EMPTY: PresenceMeta[] = [];

export function subscribeScope(scopeId: string, l: () => void) {
  const s = scopes.get(scopeId);
  s?.listeners.add(l);
  return () => s?.listeners.delete(l);
}

/** Called by the call engine whenever local voice state changes. */
export function setVoiceState(next: Partial<typeof voiceState>) {
  const prevScope = voiceState.scope;
  voiceState = { ...voiceState, ...next };
  for (const id of new Set([prevScope, voiceState.scope])) {
    const s = id ? scopes.get(id) : undefined;
    if (s?.joined) s.channel.track(metaFor(id!));
  }
}

export function onlineUserIds(scopeId: string): Set<string> {
  return new Set(scopeState(scopeId).map((m) => m.user_id));
}
