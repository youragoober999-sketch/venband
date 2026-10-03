import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { sessionStore } from '../lib/session';
import { createStore } from '../lib/store';
import { directoryVersion, loadProfiles, subscribeDirectory } from '../lib/directory';
import { acquireScope, scopeState, subscribeScope, type PresenceMeta } from '../lib/presence';
import { computePermissions } from '../lib/permissions';
import type { DecryptedMessage } from '../lib/keyring';
import type { Channel, DmChannel, Member, MemberRole, MessageRow, Role, Server } from '../lib/types';
import { getProfile } from '../lib/directory';

// ------------------------------------------------------------- navigation --

export const nav = createStore<{ serverId: string | null; channelByServer: Record<string, string> }>({
  serverId: null,
  channelByServer: {},
});

export function openServer(serverId: string | null) {
  nav.set({ serverId });
}

export function openChannel(serverKey: string, channelId: string) {
  nav.set((s) => ({ serverId: serverKey === '@me' ? null : serverKey, channelByServer: { ...s.channelByServer, [serverKey]: channelId } }));
}

export function useDirectory() {
  useSyncExternalStore(subscribeDirectory, directoryVersion);
}

// ------------------------------------------------------------- db feeds ----

type Change = { table: string; filter?: string; /** deliver INSERT rows to onRow instead of reloading */ rows?: boolean };

/** Subscribe to postgres changes on a private topic and call `onChange` (debounced). */
function useDbFeed(
  topic: string | null,
  changes: Change[],
  onChange: () => void,
  onRow?: (table: string, row: Record<string, unknown>) => void,
) {
  const cb = useRef(onChange);
  cb.current = onChange;
  const rowCb = useRef(onRow);
  rowCb.current = onRow;
  const key = JSON.stringify(changes);
  useEffect(() => {
    if (!topic) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const fire = () => {
      clearTimeout(t);
      t = setTimeout(() => cb.current(), 150);
    };
    let ch: RealtimeChannel = supabase.channel(topic, { config: { private: true } });
    for (const c of JSON.parse(key) as Change[]) {
      if (c.rows) {
        ch = ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: c.table, filter: c.filter }, (p) =>
          rowCb.current?.(c.table, p.new as Record<string, unknown>),
        );
      } else {
        ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: c.table, filter: c.filter }, fire);
      }
    }
    ch.subscribe();
    return () => {
      clearTimeout(t);
      supabase.removeChannel(ch);
    };
  }, [topic, key]);
}

// ---------------------------------------------------------------- servers --

export function useMyServers(onMessage?: (row: MessageRow) => void) {
  const me = sessionStore.use((s) => s.me);
  const [servers, setServers] = useState<Server[]>([]);
  const [dms, setDms] = useState<DmChannel[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!me) return;
    const { data: memberships } = await supabase.from('server_members').select('server_id, joined_at').eq('user_id', me.id);
    const ids = (memberships ?? []).map((m) => m.server_id);
    const { data: srv } = ids.length ? await supabase.from('servers').select('*').in('id', ids) : { data: [] };
    const order = new Map((memberships ?? []).map((m) => [m.server_id, m.joined_at]));
    setServers(((srv ?? []) as Server[]).sort((a, b) => (order.get(a.id)! < order.get(b.id)! ? -1 : 1)));

    const { data: parts } = await supabase.from('dm_participants').select('channel_id, user_id');
    const byChannel = new Map<string, string[]>();
    for (const p of parts ?? []) byChannel.set(p.channel_id, [...(byChannel.get(p.channel_id) ?? []), p.user_id]);
    const chIds = [...byChannel.keys()];
    const { data: chs } = chIds.length ? await supabase.from('channels').select('*').in('id', chIds) : { data: [] };
    const others = [...byChannel.values()].flat().filter((u) => u !== me.id);
    await loadProfiles(others);
    setDms(
      ((chs ?? []) as Channel[])
        .map((c) => {
          const ids = (byChannel.get(c.id) ?? []).filter((u) => u !== me.id);
          const members = ids.map((u) => getProfile(u)).filter((p): p is NonNullable<typeof p> => Boolean(p));
          const other = c.is_group ? null : (members[0] ?? null);
          const title = c.is_group
            ? c.name
            : (other?.display_name ?? 'Unknown user');
          return { channel: c, other, members, title };
        })
        .sort((a, b) => (a.channel.created_at < b.channel.created_at ? 1 : -1)),
    );
    setLoaded(true);
  }, [me]);

  useEffect(() => {
    load();
  }, [load]);

  useDbFeed(
    me ? `dbu:${me.id}` : null,
    me
      ? [
          { table: 'server_members', filter: `user_id=eq.${me.id}` },
          { table: 'dm_participants' }, // RLS: only conversations I'm in
          { table: 'channels', filter: 'type=eq.dm' },
          { table: 'servers' },
          // every message the user is allowed to read (RLS applies) — for unread badges / notifications
          { table: 'messages', rows: true },
        ]
      : [],
    load,
    (table, row) => table === 'messages' && onMessage?.(row as unknown as MessageRow),
  );

  return { servers, dms, loaded, reload: load };
}

export interface ServerData {
  server: Server | null;
  channels: Channel[];
  roles: Role[];
  members: Member[];
  memberRoles: MemberRole[];
  channelAccess: { channel_id: string; role_id: string }[];
  myPermissions: number;
  rolesOf: (userId: string) => Role[];
  topRole: (userId: string) => Role | null;
  reload: () => void;
}

export function useServerData(serverId: string | null): ServerData {
  const me = sessionStore.use((s) => s.me);
  const [state, setState] = useState({
    server: null as Server | null,
    channels: [] as Channel[],
    roles: [] as Role[],
    members: [] as Member[],
    memberRoles: [] as MemberRole[],
    channelAccess: [] as { channel_id: string; role_id: string }[],
  });

  const load = useCallback(async () => {
    if (!serverId) return;
    const [s, c, r, m, mr] = await Promise.all([
      supabase.from('servers').select('*').eq('id', serverId).maybeSingle(),
      supabase.from('channels').select('*').eq('server_id', serverId).order('position').order('created_at'),
      supabase.from('roles').select('*').eq('server_id', serverId).order('position', { ascending: false }),
      supabase.from('server_members').select('*').eq('server_id', serverId),
      supabase.from('member_roles').select('*').eq('server_id', serverId),
    ]);
    const channels = (c.data ?? []) as Channel[];
    const ca = channels.length
      ? await supabase.from('channel_role_access').select('*').in('channel_id', channels.map((x) => x.id))
      : { data: [] };
    await loadProfiles(((m.data ?? []) as Member[]).map((x) => x.user_id));
    setState({
      server: (s.data as Server) ?? null,
      channels,
      roles: (r.data ?? []) as Role[],
      members: (m.data ?? []) as Member[],
      memberRoles: (mr.data ?? []) as MemberRole[],
      channelAccess: (ca.data ?? []) as { channel_id: string; role_id: string }[],
    });
  }, [serverId]);

  useEffect(() => {
    setState({ server: null, channels: [], roles: [], members: [], memberRoles: [], channelAccess: [] });
    load();
  }, [load]);

  useDbFeed(
    serverId ? `dbs:${serverId}` : null,
    serverId
      ? [
          { table: 'servers', filter: `id=eq.${serverId}` },
          { table: 'channels', filter: `server_id=eq.${serverId}` },
          { table: 'roles', filter: `server_id=eq.${serverId}` },
          { table: 'server_members', filter: `server_id=eq.${serverId}` },
          { table: 'member_roles', filter: `server_id=eq.${serverId}` },
          { table: 'channel_role_access' },
        ]
      : [],
    load,
  );

  return useMemo(() => {
    const roleById = new Map(state.roles.map((r) => [r.id, r]));
    const rolesOf = (userId: string) =>
      state.memberRoles
        .filter((x) => x.user_id === userId)
        .map((x) => roleById.get(x.role_id))
        .filter((r): r is Role => Boolean(r))
        .sort((a, b) => b.position - a.position);
    const myPermissions =
      me && state.server
        ? computePermissions(me.id, state.server.owner_id, state.roles, new Set(rolesOf(me.id).map((r) => r.id)))
        : 0;
    return {
      ...state,
      myPermissions,
      rolesOf,
      topRole: (u: string) => rolesOf(u)[0] ?? null,
      reload: load,
    };
  }, [state, me, load]);
}

// --------------------------------------------------------------- presence --

export function useScopePresence(scopeId: string | null): PresenceMeta[] {
  const [, force] = useState(0);
  useEffect(() => {
    if (!scopeId) return;
    const release = acquireScope(scopeId);
    const unsub = subscribeScope(scopeId, () => force((x) => x + 1));
    force((x) => x + 1);
    return () => {
      unsub();
      release();
    };
  }, [scopeId]);
  return scopeId ? scopeState(scopeId) : [];
}

// --------------------------------------------------------------- messages --

const PAGE = 50;

export function useMessages(channel: Channel | null) {
  const keyring = sessionStore.use((s) => s.keyring);
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [keyStatus, setKeyStatus] = useState<'loading' | 'ready' | 'waiting'>('loading');
  const channelId = channel?.id ?? null;
  const rowsRef = useRef<Map<string, MessageRow>>(new Map());
  const decCache = useRef<Map<string, DecryptedMessage>>(new Map());

  const decryptAll = useCallback(async () => {
    if (!keyring) return;
    const rows = [...rowsRef.current.values()].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    await loadProfiles(rows.map((r) => r.author_id));
    const cache = decCache.current;
    const out = await Promise.all(
      rows.map(async (r) => {
        const k = `${r.id}|${r.signature}`;
        const hit = cache.get(k);
        if (hit && !hit.error) return hit;
        const d = await keyring.decrypt(r);
        cache.set(k, d);
        return d;
      }),
    );
    setMessages(out);
  }, [keyring]);

  const fetchPage = useCallback(
    async (before?: string) => {
      if (!channelId) return;
      let q = supabase.from('messages').select('*').eq('channel_id', channelId).order('created_at', { ascending: false }).limit(PAGE);
      if (before) q = q.lt('created_at', before);
      const { data } = await q;
      for (const r of (data ?? []) as MessageRow[]) rowsRef.current.set(r.id, r);
      setHasMore((data ?? []).length === PAGE);
      await decryptAll();
    },
    [channelId, decryptAll],
  );

  useEffect(() => {
    rowsRef.current = new Map();
    decCache.current = new Map();
    setMessages([]);
    setKeyStatus('loading');
    if (!channelId || !keyring) return;
    let cancelled = false;
    (async () => {
      try {
        await keyring.ensure(channelId, channel?.key_rotation_needed);
      } catch (e) {
        console.warn(e);
      }
      if (cancelled) return;
      setKeyStatus(keyring.latestEpoch(channelId) && keyring.hasKey(channelId, keyring.latestEpoch(channelId)) ? 'ready' : 'waiting');
      await fetchPage();
    })();
    const offKeys = keyring.onKeys((id) => {
      if (id !== channelId) return;
      setKeyStatus(keyring.hasKey(channelId, keyring.latestEpoch(channelId)) ? 'ready' : 'waiting');
      decryptAll();
    });
    return () => {
      cancelled = true;
      offKeys();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, keyring]);

  // live updates
  useEffect(() => {
    if (!channelId || !keyring) return;
    const me = sessionStore.get().identity?.userId;
    const ch = supabase
      .channel(`dbc:${channelId}`, { config: { private: true } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` }, (p) => {
        if (p.eventType === 'DELETE') rowsRef.current.delete((p.old as MessageRow).id);
        else rowsRef.current.set((p.new as MessageRow).id, p.new as MessageRow);
        decryptAll();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'channel_epochs', filter: `channel_id=eq.${channelId}` }, () => {
        keyring.loadChannel(channelId).then(() => keyring.distribute(channelId));
      })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'channel_keys', filter: `channel_id=eq.${channelId}` },
        (p) => {
          if ((p.new as { recipient_id: string }).recipient_id === me) keyring.loadChannel(channelId);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [channelId, keyring, decryptAll]);

  const loadOlder = useCallback(() => {
    const oldest = messages[0]?.row.created_at;
    return fetchPage(oldest);
  }, [messages, fetchPage]);

  const upsertLocal = useCallback(
    (row: MessageRow) => {
      rowsRef.current.set(row.id, row);
      decryptAll();
    },
    [decryptAll],
  );

  const removeLocal = useCallback(
    (id: string) => {
      rowsRef.current.delete(id);
      decryptAll();
    },
    [decryptAll],
  );

  return { messages, hasMore, loadOlder, keyStatus, upsertLocal, removeLocal };
}
