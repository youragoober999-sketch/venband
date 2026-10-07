import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { watchProfiles } from '../lib/directory';
import { MarketplaceView } from './Marketplace';
import { applyCustomCss, safeMode, setSafeMode } from '../lib/customCss';
import { startBackground } from '../lib/background';
import { DeletionBanner } from './Security';
import { useApps, useServerBots } from '../lib/bots';
import { BotTag, PresetLogo } from './Apps';
import { sessionStore, updateMyProfile } from '../lib/session';
import { supabase, errorMessage } from '../lib/supabase';
import { activeCallVersion, getActiveCall, joinCall, leaveCall, leftRecently, subscribeActiveCall } from '../lib/call';
import { displayName, getProfile, loadProfiles, putProfile } from '../lib/directory';
import { has, P } from '../lib/permissions';
import type { Channel, DmChannel, MessageRow, PresenceStatus, Profile, Server } from '../lib/types';
import {
  addUnread,
  askForNotifications,
  isViewing,
  markRead,
  notificationPermission,
  notify,
  playMessageSound,
  setUnread,
  startRing,
  stopRing,
  unreadStore,
} from '../lib/notify';
import { currentPath, go, linkTo, parseRoute, useRoute } from '../lib/router';
import { socialStore } from '../lib/social';
import { RING_MS, ringFor, subscribeRings } from '../lib/presence';
import { getSettings, updateLayout, updateSettings, useSettings, type ServerFolder } from '../lib/settings';
import { isPhone, openSearch, openSettings, setDrawer, uiStore } from '../lib/ui';
import {
  nav,
  openChannel,
  openDiscover,
  openFriends,
  openServer,
  useDirectory,
  useMyServers,
  useScopePresence,
  useServerData,
  type ServerData,
} from '../hooks/data';
import { Avatar, Icon, Logo, initials, nameplateVars, StyledName } from './ui';
import { ChatView } from './Chat';
import { CallAudio, VoiceView } from './Voice';
import { CategorySettingsModal, ChannelSettingsModal, CreateChannelModal, CreateJoinModal, createCategory, GroupSettingsModal, InviteModal, NewDmModal, NewGroupModal, startDm } from './Modals';
import { ServerSettingsModal } from './ServerSettings';
import { ContextMenuHost, copyText, openMenu, type Entry } from './ContextMenu';
import { DialogHost, askConfirm, askText } from './Dialogs';
import { ProfileHost, ServerTag, openProfile, userMenu } from './People';
import { Badges, OwnerCrown, RoleIcon, ServerBadge, VerifiedMark } from './Badges';
import { SettingsPage, STATUS_TEXT } from './Settings';
import { DiscoveryView, DonateView, FriendsView, MessageRequestsView, RequestBanner } from './Friends';
import { Resizer } from './Resizer';
import { showUndo, UndoToast } from './Undo';
import { GlobalModals, openGlobalModal } from './GlobalModals';
import { themeVars } from './ServerSettingsExtra';
import { ForumView, StageView, TimeoutBar, VoogleGate, WarningsNotice, WelcomeScreen } from './ServerViews';
import { SavedView, SearchPanel } from './Search';
import { mentionsMe } from './Markdown';

export function useActiveCall() {
  useSyncExternalStore(subscribeActiveCall, activeCallVersion);
  return getActiveCall();
}

// channel id -> where it lives, for notifications about channels not on screen
const channelMeta = new Map<string, { type: Channel['type']; name: string; server_id: string | null; is_group?: boolean; request_to?: string | null }>();

async function describeChannel(id: string) {
  const cached = channelMeta.get(id);
  if (cached) return cached;
  const { data } = await supabase.from('channels').select('type, name, server_id, is_group, request_to').eq('id', id).maybeSingle();
  if (data) channelMeta.set(id, data as { type: Channel['type']; name: string; server_id: string | null; is_group?: boolean; request_to?: string | null });
  return (data as { type: Channel['type']; name: string; server_id: string | null; is_group?: boolean; request_to?: string | null } | null) ?? null;
}

// my role ids per server, for @role mention notifications
const myRolesByServer = new Map<string, string[]>();

/** New message somewhere → unread badge, and for DMs / @mentions a sound + desktop notification. */
function useMessageAlerts(servers: Server[]) {
  const serversRef = useRef(servers);
  serversRef.current = servers;
  const seen = useRef(new Set<string>());
  return useCallback(async (row: MessageRow) => {
    const { me, keyring } = sessionStore.get();
    if (!me || !keyring || row.author_id === me.id || isViewing(row.channel_id)) return;
    // a reconnecting feed can deliver the same row twice: alert once per message
    if (seen.current.has(row.id)) return;
    seen.current.add(row.id);
    if (seen.current.size > 500) seen.current = new Set([...seen.current].slice(-200));
    const rel = socialStore.get().relations[row.author_id];
    if (rel?.blocked) return;
    const meta = await describeChannel(row.channel_id);
    if (!meta) return;
    let text = '';
    try {
      await keyring.loadChannel(row.channel_id);
      const dec = await keyring.decrypt(row);
      text = dec.payload ? dec.payload.text || (dec.payload.attachments?.length ? 'Sent a file' : '') : '';
    } catch {
      /* preview is optional */
    }
    const isDm = meta.type === 'dm';
    if (meta.server_id && !myRolesByServer.has(meta.server_id)) {
      const { data } = await supabase.from('member_roles').select('role_id').eq('server_id', meta.server_id).eq('user_id', me.id);
      myRolesByServer.set(meta.server_id, (data ?? []).map((r) => r.role_id));
    }
    const mention = !isDm && mentionsMe(text, me.id, myRolesByServer.get(meta.server_id ?? '') ?? []);
    addUnread(row.channel_id, meta.server_id, mention);
    if ((getSettings().dms.mutedUntil[row.channel_id] ?? 0) > Date.now()) return;
    if (meta.server_id && getSettings().rail.folders.some((f) => f.muted && f.servers.includes(meta.server_id!))) return;
    if ((!isDm && !mention) || rel?.muted || me.presence === 'dnd' || meta.request_to === me.id) return;
    playMessageSound();
    await loadProfiles([row.author_id]);
    const who = displayName(row.author_id);
    const server = serversRef.current.find((x) => x.id === meta.server_id);
    notify(
      isDm ? (meta.is_group ? `${who} in ${meta.name}` : who) : `${who} in #${meta.name}${server ? ` · ${server.name}` : ''}`,
      text ? text.replace(/<@&?[0-9a-f-]{36}>/g, '@someone').slice(0, 140) : 'New encrypted message',
      () => (isDm ? openChannel('@me', row.channel_id) : openChannel(meta.server_id!, row.channel_id)),
      row.channel_id,
    );
  }, []);
}

/** Keeps the address bar and the open view in sync, both ways. */
function useRouterSync(servers: Server[], dms: DmChannel[], loaded: boolean) {
  // came here from a link while logged out: go where the link pointed
  useEffect(() => {
    try {
      const back = sessionStorage.getItem('venband:return-to');
      if (back) {
        sessionStorage.removeItem('venband:return-to');
        go(back, { replace: true, keepQuery: true });
      }
    } catch {
      /* ignore */
    }
  }, []);
  const route = useRoute();
  const pending = useRef<string | null>(null);
  const navState = nav.use((s) => s);

  // URL -> view (reads the live URL: an earlier effect may just have changed it).
  // Only acts when the address actually changed (or a link target is still
  // waiting for the DM list), so a list refresh can't undo a click.
  const lastRoute = useRef<string | null>(null);
  useEffect(() => {
    const path = currentPath();
    const waiting = pending.current !== null && !pending.current.startsWith('tried:');
    if (waiting && path === lastRoute.current) {
      // still waiting to open a link, but the person already clicked somewhere else: their click wins
      const n = nav.get();
      if (n.serverId || n.discover || (n.channelByServer['@me'] && n.channelByServer['@me'] !== pending.current)) {
        pending.current = null;
        return;
      }
    }
    if (path === lastRoute.current && !waiting) return;
    lastRoute.current = path;
    const r = parseRoute();
    if ((r.kind === 'home' || r.kind === 'server') && r.messageId) uiStore.set({ jump: r.messageId });
    const cur = nav.get();
    if (r.kind === 'discover') {
      if (!cur.discover) openDiscover();
    } else if (r.kind === 'server') {
      if (cur.serverId !== r.serverId || cur.discover || (r.channelId && cur.channelByServer[r.serverId] !== r.channelId)) {
        nav.set((s) => ({
          serverId: r.serverId,
          discover: false,
          channelByServer: r.channelId ? { ...s.channelByServer, [r.serverId]: r.channelId } : s.channelByServer,
        }));
      }
    } else if (r.kind === 'home') {
      if (!r.target) {
        if (cur.serverId || cur.discover || cur.channelByServer['@me']) openFriends();
        pending.current = null;
      } else {
        const dm = dms.find((d) => d.channel.id === r.target || (!d.channel.is_group && d.other?.id === r.target));
        if (!dm && cur.channelByServer['@me'] === r.target && !cur.serverId && !cur.discover) {
          // just opened (e.g. a brand-new DM): the list catches up in a moment
          pending.current = null;
        } else if (dm) {
          pending.current = null;
          if (cur.serverId || cur.discover || cur.channelByServer['@me'] !== dm.channel.id) openChannel('@me', dm.channel.id);
        } else if (!loaded) {
          pending.current = r.target;
        } else if (pending.current !== `tried:${r.target}`) {
          // a user id we have no DM with yet: open one
          pending.current = `tried:${r.target}`;
          startDm(r.target).catch(() => go('channels/@me', { replace: true }));
        }
      }
    } else if (r.kind === 'group-invite') {
      const code = r.code;
      go('channels/@me', { replace: true });
      supabase.rpc('join_group', { p_code: code }).then(({ data, error }) => {
        if (error) return alert(errorMessage(error));
        openChannel('@me', data as string);
      });
    } else {
      go('channels/@me', { replace: true, keepQuery: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, loaded, dms]);

  // view -> URL
  useEffect(() => {
    if (pending.current && !pending.current.startsWith('tried:')) {
      // still waiting for the DM list to open a link — unless the person has
      // already clicked somewhere else, which wins
      const n = nav.get();
      const moved = Boolean(n.serverId || n.discover || (n.channelByServer['@me'] && n.channelByServer['@me'] !== pending.current));
      if (!moved) return;
      pending.current = null;
      lastRoute.current = null;
    }
    const s = nav.get();
    let path: string;
    if (s.discover) path = 'discover';
    else if (s.serverId) path = `channels/${s.serverId}${s.channelByServer[s.serverId] ? `/${s.channelByServer[s.serverId]}` : ''}`;
    else {
      const id = s.channelByServer['@me'];
      const dm = id ? dms.find((d) => d.channel.id === id) : null;
      path = dm ? `channels/@me/${dm.channel.is_group ? dm.channel.id : (dm.other?.id ?? dm.channel.id)}` : id ? `channels/@me/${id}` : 'channels/@me';
    }
    const r = parseRoute();
    if (r.kind === 'root' || r.kind === 'sign-in' || r.kind === 'register') go(path, { replace: true, keepQuery: true });
    else go(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navState, dms]);

  // a server link we're not a member of: go home
  useEffect(() => {
    if (!loaded || !navState.serverId || servers.some((s) => s.id === navState.serverId)) return;
    const t = setTimeout(() => {
      if (nav.get().serverId === navState.serverId) openServer(null);
    }, 4000);
    return () => clearTimeout(t);
  }, [loaded, servers, navState.serverId]);
}

/** Keep my own profile fresh (staff can change badges / account status). */
function useMyProfileFeed(myId: string) {
  useEffect(() => {
    const ch = supabase
      .channel(`dbu:${myId}:profile`, { config: { private: true } })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${myId}` }, async () => {
        const { data } = await supabase.rpc('my_profile');
        if (data) {
          putProfile(data as Profile);
          sessionStore.set({ me: data as Profile });
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [myId]);
}

export function Shell() {
  const [serversForAlerts, setServersForAlerts] = useState<Server[]>([]);
  const onMessage = useMessageAlerts(serversForAlerts);
  const { servers, dms, loaded, reload } = useMyServers(onMessage);
  const me = sessionStore.use((s) => s.me)!;
  useEffect(() => setServersForAlerts(servers), [servers]);
  useLooks();
  useEffect(() => watchProfiles(me.id), [me.id]);
  const serverId = nav.use((s) => s.serverId);
  const discover = nav.use((s) => s.discover);
  useEffect(() => {
    if (serverId && loaded && !servers.some((s) => s.id === serverId)) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);
  const [modal, setModal] = useState<null | 'create-join'>(null);
  const drawer = uiStore.use((s) => s.drawer);
  const switcher = uiStore.use((s) => s.switcher);
  const search = uiStore.use((s) => s.search);
  useDirectory();
  // phone layout: going somewhere closes the slide-in panels
  const navState = nav.use((s) => s);
  useEffect(() => setDrawer(null), [navState]);
  // Ctrl/Cmd+K: jump anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        uiStore.set((s) => ({ switcher: !s.switcher }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useRouterSync(servers, dms, loaded);
  useMyProfileFeed(me.id);

  // leave the view if we were removed from the server we're looking at
  const knownServers = useRef(new Set<string>());
  useEffect(() => {
    const now = new Set(servers.map((s) => s.id));
    if (loaded && serverId && knownServers.current.has(serverId) && !now.has(serverId)) openServer(null);
    const call = getActiveCall();
    if (loaded && call && knownServers.current.has(call.scopeId) && !now.has(call.scopeId)) leaveCall();
    knownServers.current = now;
  }, [loaded, servers, serverId]);

  // came from a voice invite: jump into that voice channel once we're in the server
  useEffect(() => {
    let pending: { server: string; channel: string } | null = null;
    try {
      pending = JSON.parse(sessionStorage.getItem('venband:join-voice') ?? 'null');
    } catch {
      /* ignore */
    }
    if (!pending || !servers.some((x) => x.id === pending!.server)) return;
    sessionStorage.removeItem('venband:join-voice');
    const { server, channel } = pending;
    supabase
      .from('channels')
      .select('id, name, type')
      .eq('id', channel)
      .maybeSingle()
      .then(({ data: ch }) => {
        if (!ch) return openServer(server);
        openChannel(server, ch.id);
        const id = sessionStore.get().identity;
        if (id && (ch.type === 'voice' || ch.type === 'stage')) joinCall(id, ch.id, server, ch.name);
      });
  }, [servers]);

  // accept ?invite=CODE links
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('invite');
    if (!code) return;
    window.history.replaceState(null, '', window.location.pathname);
    supabase.rpc('join_server', { p_code: code }).then(({ data, error }) => {
      if (error) alert(`Could not join: ${errorMessage(error)}`);
      else if (data) openServer(data as string);
    });
  }, []);

  return (
    <div className={`shell${drawer ? ` drawer-${drawer}` : ''}`}>
      <AppBanner />
      <SafeModeBanner />
      <DeletionBanner />
      <WarningsNotice />
      <TopBar servers={servers} dms={dms} />
      <div className="shell-body">
        <ServerRail servers={servers} dms={dms} current={serverId} discover={discover} onAdd={() => setModal('create-join')} reload={reload} />
        {discover ? (
          <>
            <DiscoverySidebar />
            <DiscoveryView />
          </>
        ) : serverId ? (
          <ServerView key={serverId} serverId={serverId} />
        ) : (
          <HomeView dms={dms} />
        )}
        <div className="drawer-scrim" onClick={() => setDrawer(null)} />
      </div>
      {switcher && <QuickSwitcher servers={servers} dms={dms} onClose={() => uiStore.set({ switcher: false })} onCreateServer={() => setModal('create-join')} />}
      {search && <SearchPanel servers={servers} />}
      <UndoToast />
      <GlobalModals />
      <CallAudio />
      <div className="toasts">
        {dms
          .filter((d) => d.channel.request_to !== me.id)
          .slice(0, 25)
          .map((d) => (
            <IncomingCall key={d.channel.id} dm={d} />
          ))}
      </div>
      {modal === 'create-join' && <CreateJoinModal onClose={() => setModal(null)} />}
      <SettingsPage />
      <ContextMenuHost />
      <DialogHost />
    </div>
  );
}

function ServerRail({
  servers,
  dms,
  current,
  discover,
  onAdd,
  reload,
}: {
  servers: Server[];
  dms: DmChannel[];
  current: string | null;
  discover: boolean;
  onAdd: () => void;
  reload: () => void;
}) {
  const unread = unreadStore.use((s) => s);
  const me = sessionStore.use((s) => s.me)!;
  const dmUnread = dms.reduce((n, d) => n + (unread.counts[d.channel.id] ?? 0), 0);
  const serverState = (id: string) => {
    const chans = Object.keys(unread.counts).filter((c) => unread.serverOf[c] === id);
    return { chans, any: chans.length > 0, mentions: chans.reduce((n, c) => n + (unread.mentions[c] ?? 0), 0) };
  };

  function serverMenu(e: React.MouseEvent, s: Server) {
    const st = serverState(s.id);
    const items: Entry[] = [
      { type: 'header', label: s.name },
      st.any && { label: 'Mark As Read', icon: 'check', onClick: () => st.chans.forEach(markRead) },
      { label: 'Copy Link', icon: 'link', onClick: () => copyText(linkTo(`channels/${s.id}`)) },
      { type: 'sep' },
      s.owner_id !== me.id && {
        label: 'Leave Server',
        icon: 'logout',
        danger: true,
        onClick: async () => {
          if (!(await askConfirm({ title: `Leave ${s.name}`, body: 'You won’t be able to rejoin unless you’re invited again.', confirm: 'Leave Server', danger: true }))) return;
          const { error } = await supabase.from('server_members').delete().eq('server_id', s.id).eq('user_id', me.id);
          if (error) alert(errorMessage(error));
          else {
            if (current === s.id) openServer(null);
            reload();
          }
        },
      },
      { type: 'sep' },
      me.platform_role !== 'user' && { label: 'Open in Moderation', icon: 'shield', onClick: () => openSettings('moderation', s.id) },
      { label: 'Copy Server ID', icon: 'copy', hint: 'ID', onClick: () => copyText(s.id) },
    ];
    openMenu(e, items);
  }

  // ---- order + folders (saved in your synced settings)
  const rail = useSettings((s) => s.rail);
  const railFolders = rail.folders;
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const [railDnd, setRailDnd] = useState<{ drag: string | null; over: string | null; where: 'before' | 'after' | 'into' }>({ drag: null, over: null, where: 'into' });
  const inFolder = new Set(railFolders.flatMap((f) => f.servers));
  type RailItem = { kind: 'server'; key: string; server: Server } | { kind: 'folder'; key: string; folder: ServerFolder };
  const railItems: RailItem[] = useMemo(() => {
    const all: RailItem[] = [
      ...railFolders.map((f) => ({ kind: 'folder' as const, key: `f:${f.id}`, folder: { ...f, servers: f.servers.filter((id) => servers.some((x) => x.id === id)) } })),
      ...servers.filter((x) => !inFolder.has(x.id)).map((x) => ({ kind: 'server' as const, key: x.id, server: x })),
    ].filter((i) => i.kind === 'server' || i.folder.servers.length > 0);
    const rank = (k: string) => {
      const i = rail.order.indexOf(k);
      return i === -1 ? 10_000 : i;
    };
    return all.sort((x, y) => {
      const px = x.kind === 'folder' && x.folder.pinned ? 0 : 1;
      const py = y.kind === 'folder' && y.folder.pinned ? 0 : 1;
      return px - py || rank(x.key) - rank(y.key);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers, rail]);

  const saveRail = (order: string[], folders: ServerFolder[]) => {
    const prev = getSettings().rail;
    updateSettings({ rail: { order, folders } });
    return prev;
  };

  function railDragStart(e: React.DragEvent, key: string) {
    e.dataTransfer.setData('application/x-venband-server', key);
    e.dataTransfer.effectAllowed = 'move';
    setRailDnd({ drag: key, over: null, where: 'into' });
  }
  function railDragOver(e: React.DragEvent, key: string) {
    if (!railDnd.drag || railDnd.drag === key) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    // folders can't go inside folders: only before / after
    const where = y < 0.28 ? 'before' : y > 0.72 ? 'after' : railDnd.drag.startsWith('f:') ? (y < 0.5 ? 'before' : 'after') : 'into';
    setRailDnd((d) => ({ ...d, over: key, where }));
  }
  function railDrop(e: React.DragEvent, target: string) {
    e.preventDefault();
    const { drag, where } = railDnd;
    setRailDnd({ drag: null, over: null, where: 'into' });
    if (!drag || drag === target) return;
    let folders = railFolders.map((f) => ({ ...f, servers: f.servers.filter((id) => id !== drag) })).filter((f) => f.servers.length > 0 || `f:${f.id}` === drag);
    let order = railItems.map((i) => i.key).filter((k) => k !== drag);
    let undoText = 'Moved server';
    if (where === 'into') {
      if (target.startsWith('f:')) {
        folders = folders.map((f) => (`f:${f.id}` === target ? { ...f, servers: [...f.servers, drag] } : f));
        undoText = 'Added to folder';
      } else {
        // dropping a server on a server makes a folder of both
        const f: ServerFolder = { id: crypto.randomUUID(), name: 'New folder', color: '#5865f2', servers: [target, drag] };
        folders = [...folders.map((x) => ({ ...x, servers: x.servers.filter((id) => id !== target) })), f];
        order = order.map((k) => (k === target ? `f:${f.id}` : k));
        undoText = 'Folder created';
      }
    } else {
      const i = order.indexOf(target);
      order.splice(where === 'before' ? i : i + 1, 0, drag);
    }
    const prev = saveRail(order, folders);
    showUndo(undoText, () => updateSettings({ rail: prev }));
  }

  function folderMenu(e: React.MouseEvent, f: ServerFolder) {
    const set = (patch: Partial<ServerFolder>) => updateSettings((st) => ({ rail: { ...st.rail, folders: st.rail.folders.map((x) => (x.id === f.id ? { ...x, ...patch } : x)) } }));
    openMenu(e, [
      { type: 'header', label: f.name },
      {
        label: 'Rename Folder',
        icon: 'edit',
        onClick: async () => {
          const name = await askText({ title: 'Rename folder', label: 'Folder name', initial: f.name, maxLength: 40 });
          if (name?.trim()) set({ name: name.trim() });
        },
      },
      { label: f.pinned ? 'Unpin Folder' : 'Pin to Top', icon: 'pin', onClick: () => set({ pinned: !f.pinned }) },
      { label: f.muted ? 'Unmute Folder' : 'Mute Folder', icon: f.muted ? 'bell' : 'bellOff', hint: f.muted ? '' : 'no sounds or pings', onClick: () => set({ muted: !f.muted }) },
      {
        type: 'custom',
        render: (close) => (
          <div className="ctx-colors">
            {['#5865f2', '#eb459e', '#57f287', '#fee75c', '#ed4245', '#ffffff', '#9b59b6', '#1abc9c'].map((c) => (
              <button key={c} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => (set({ color: c }), close())} />
            ))}
          </div>
        ),
      },
      { type: 'sep' },
      { label: 'Remove Folder', icon: 'folder', danger: true, hint: 'servers stay', onClick: () => updateSettings((st) => ({ rail: { ...st.rail, folders: st.rail.folders.filter((x) => x.id !== f.id) } })) },
    ]);
  }

  const serverButton = (s: Server, inPanel = false) => {
    const st = serverState(s.id);
    const folder = railFolders.find((f) => f.servers.includes(s.id));
    return (
      <button
        key={s.id}
        className={`rail-item${current === s.id ? ' active' : ''}${s.status && s.status !== 'active' ? ' frozen' : ''}${railDnd.over === s.id ? ` drop-${railDnd.where}` : ''}${railDnd.drag === s.id ? ' dragging' : ''}`}
        onClick={() => {
          openServer(s.id);
          if (inPanel) setOpenFolder(null);
        }}
        onContextMenu={(e) => serverMenu(e, s)}
        data-tip={s.name}
        aria-label={s.name}
        style={{ background: current === s.id ? s.icon_color : undefined }}
        draggable
        onDragStart={(e) => railDragStart(e, s.id)}
        onDragOver={(e) => railDragOver(e, s.id)}
        onDrop={(e) => railDrop(e, s.id)}
        onDragEnd={() => setRailDnd({ drag: null, over: null, where: 'into' })}
      >
        <span className={`rail-pill${st.any ? ' unread' : ''}`} />
        {s.icon_url ? (
          <img className="rail-icon" src={s.icon_url} alt="" />
        ) : (
          <span className="rail-initials" style={{ color: current === s.id ? '#fff' : undefined }}>
            {initials(s.name)}
          </span>
        )}
        {st.mentions > 0 && !folder?.muted && <span className="badge">{st.mentions}</span>}
        {s.verified && (
          <span className="rail-verified">
            <VerifiedMark size={14} />
          </span>
        )}
      </button>
    );
  };

  return (
    <nav className="rail" aria-label="Servers">
      <button className={`rail-item home${current === null && !discover ? ' active' : ''}`} onClick={() => openServer(null)} title="Direct messages">
        <Logo size={46} />
        {dmUnread > 0 && <span className="badge">{dmUnread > 99 ? '99+' : dmUnread}</span>}
      </button>
      <div className="rail-sep" />
      {railItems.map((it) =>
        it.kind === 'server' ? (
          serverButton(it.server)
        ) : (
          <div
            key={it.folder.id}
            className={`rail-folder${openFolder === it.folder.id ? ' open' : ''}${railDnd.over === `f:${it.folder.id}` ? ` drop-${railDnd.where}` : ''}`}
            style={{ ['--folder' as string]: it.folder.color }}
          >
            <button
              className="rail-item folder"
              data-tip={it.folder.name}
              aria-label={`Folder ${it.folder.name}`}
              aria-expanded={openFolder === it.folder.id}
              draggable
              onDragStart={(e) => railDragStart(e, `f:${it.folder.id}`)}
              onDragOver={(e) => railDragOver(e, `f:${it.folder.id}`)}
              onDrop={(e) => railDrop(e, `f:${it.folder.id}`)}
              onDragEnd={() => setRailDnd({ drag: null, over: null, where: 'into' })}
              onClick={() => setOpenFolder(openFolder === it.folder.id ? null : it.folder.id)}
              onContextMenu={(e) => folderMenu(e, it.folder)}
            >
              <span className={`rail-pill${it.folder.servers.some((id) => serverState(id).any) ? ' unread' : ''}`} />
              <span className="folder-grid">
                {it.folder.servers.slice(0, 4).map((id) => {
                  const sv = servers.find((x) => x.id === id);
                  return sv ? (
                    sv.icon_url ? <img key={id} src={sv.icon_url} alt="" /> : <span key={id} style={{ background: sv.icon_color }}>{initials(sv.name)[0]}</span>
                  ) : null;
                })}
              </span>
              {it.folder.pinned && <span className="folder-pin"><Icon name="pin" size={10} /></span>}
              {!it.folder.muted && it.folder.servers.reduce((n, id) => n + serverState(id).mentions, 0) > 0 && (
                <span className="badge">{it.folder.servers.reduce((n, id) => n + serverState(id).mentions, 0)}</span>
              )}
            </button>
          </div>
        ),
      )}
      {openFolder && railFolders.find((f) => f.id === openFolder) && (
        <div className="folder-panel" role="dialog" aria-label="Folder">
          {(() => {
            const f = railFolders.find((x) => x.id === openFolder)!;
            return (
              <>
                <div className="folder-panel-head">
                  <span className="folder-dot" style={{ background: f.color }} />
                  <b className="grow ellipsis">{f.name}</b>
                  {f.muted && <Icon name="bellOff" size={14} />}
                  <button className="icon-btn small" onClick={() => setOpenFolder(null)} aria-label="Close folder">
                    <Icon name="x" size={14} />
                  </button>
                </div>
                <div className="folder-panel-list">
                  {f.servers.map((id) => servers.find((x) => x.id === id)).filter(Boolean).map((sv) => serverButton(sv!, true))}
                </div>
              </>
            );
          })()}
        </div>
      )}
      <div className="rail-bottom">
        <div className="rail-sep" />
        <button className="rail-item add" onClick={onAdd} data-tip="Add a server" aria-label="Add a server">
          <Icon name="plus" size={24} />
        </button>
        <button className={`rail-item add${discover ? ' active' : ''}`} onClick={openDiscover} data-tip="Discover" aria-label="Discover servers">
          <Icon name="compass" size={24} />
        </button>
      </div>
    </nav>
  );
}

function Sidebar({ children }: { children: React.ReactNode }) {
  const width = useSettings((s) => s.layout.sidebar);
  return (
    <aside className="sidebar" style={{ width }}>
      {children}
      <Resizer axis="x" value={width} min={200} max={420} onChange={(v) => updateLayout({ sidebar: v })} />
    </aside>
  );
}

function DiscoverySidebar() {
  return (
    <Sidebar>
      <header className="sidebar-header">
        <span className="server-name">Discover</span>
      </header>
      <div className="sidebar-scroll">
        <div className="channel active">
          <Icon name="compass" size={18} /> <span className="channel-name">Servers</span>
        </div>
      </div>
      <CallDock />
    </Sidebar>
  );
}

// ------------------------------------------------------------------ home --

function HomeView({ dms }: { dms: DmChannel[] }) {
  const selected = nav.use((s) => s.channelByServer['@me']);
  const unread = unreadStore.use((s) => s);
  const relations = socialStore.use((s) => s.relations);
  const friends = socialStore.use((s) => s.friends);
  const [newDm, setNewDm] = useState(false);
  const [newGroup, setNewGroup] = useState(false);
  const [groupSettings, setGroupSettings] = useState(false);
  const [filter, setFilter] = useState('');
  const homeTab = uiStore.use((s) => s.homeTab);
  const setHomeTab = (t: typeof homeTab) => uiStore.set({ homeTab: t });
  const dmPrefs = useSettings((s) => s.dms);
  const [showArchived, setShowArchived] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const myId = sessionStore.use((s) => s.me?.id);
  const requests = dms.filter((d) => d.channel.request_to === myId);
  const current = dms.find((d) => d.channel.id === selected) ?? null;
  const isRequest = current?.channel.request_to === myId;
  const call = useActiveCall();
  const presence = useScopePresence(current?.channel.id ?? null);
  const identity = sessionStore.use((s) => s.identity)!;
  const inCall = call?.channelId === current?.channel.id;
  const othersInCall = presence.filter((p) => p.voice_channel_id === current?.channel.id && p.user_id !== identity.userId);
  const alone = Boolean(inCall && call && call.remotePeers.length === 0);
  // Ring-back only while nobody else is in the call. Someone answering a call
  // that's already going (or joining before the media connects) hears nothing.
  const waiting = alone && !call?.everJoined && othersInCall.length === 0;
  const [noAnswer, setNoAnswer] = useState(false);
  const incoming = Object.values(friends).filter((f) => !f.accepted && f.incoming).length;
  useEffect(() => {
    setNoAnswer(false);
    if (!waiting) return;
    startRing('outgoing');
    const t = setTimeout(() => {
      stopRing('outgoing');
      setNoAnswer(true);
    }, 45_000);
    return () => {
      clearTimeout(t);
      stopRing('outgoing');
    };
  }, [waiting]);

  const visibleDms = useMemo(
    () =>
      dms
        .filter((d) => d.channel.request_to !== myId)
        .filter((d) => !filter || d.title.toLowerCase().includes(filter.toLowerCase()) || (d.other && displayName(d.other.id).toLowerCase().includes(filter.toLowerCase()))),
    [dms, filter, myId],
  );
  const isPinned = (d: DmChannel) => dmPrefs.pinned.includes(d.channel.id) || Boolean(d.other && relations[d.other.id]?.pinned);
  const isArchived = (d: DmChannel) => dmPrefs.archived.includes(d.channel.id) && !(unread.counts[d.channel.id] > 0);
  const inFolder = (d: DmChannel) => dmPrefs.folders.find((f) => f.channels.includes(d.channel.id));
  const pinnedDms = visibleDms.filter((d) => isPinned(d) && !isArchived(d));
  const archivedDms = visibleDms.filter(isArchived);
  const looseDms = visibleDms.filter((d) => !isPinned(d) && !isArchived(d) && !inFolder(d));

  function setDmPrefs(patch: (p: typeof dmPrefs) => Partial<typeof dmPrefs>) {
    updateSettings((st) => ({ dms: { ...st.dms, ...patch(st.dms) } }));
  }
  const toggleIn = (list: string[], id: string, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id));
  const mutedUntil = (id: string) => dmPrefs.mutedUntil[id] ?? 0;
  const muteFor = (id: string, ms: number | null) =>
    setDmPrefs((p) => ({ mutedUntil: { ...p.mutedUntil, [id]: ms === null ? Number.MAX_SAFE_INTEGER : ms === 0 ? 0 : Date.now() + ms } }));

  function organiseMenu(d: DmChannel): Entry[] {
    const id = d.channel.id;
    const muted = mutedUntil(id) > Date.now();
    const folder = inFolder(d);
    return [
      { label: isPinned(d) ? 'Unpin Conversation' : 'Pin to Top', icon: 'pin', onClick: () => setDmPrefs((p) => ({ pinned: toggleIn(p.pinned, id, !p.pinned.includes(id)) })) },
      muted
        ? { label: `Unmute (muted ${mutedUntil(id) === Number.MAX_SAFE_INTEGER ? 'until you unmute' : `until ${new Date(mutedUntil(id)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`})`, icon: 'bell', onClick: () => muteFor(id, 0) }
        : { type: 'header', label: 'Mute conversation' },
      !muted && { label: 'For 15 minutes', icon: 'bellOff', onClick: () => muteFor(id, 15 * 60_000) },
      !muted && { label: 'For 1 hour', icon: 'bellOff', onClick: () => muteFor(id, 3_600_000) },
      !muted && { label: 'For 8 hours', icon: 'bellOff', onClick: () => muteFor(id, 8 * 3_600_000) },
      !muted && { label: 'For 24 hours', icon: 'bellOff', onClick: () => muteFor(id, 24 * 3_600_000) },
      !muted && { label: 'Until I turn it back on', icon: 'bellOff', onClick: () => muteFor(id, null) },
      { type: 'sep' },
      { label: 'Mark Unread', icon: 'unread', onClick: () => setUnread(id, null, Math.max(1, unread.counts[id] ?? 1)) },
      { label: dmPrefs.archived.includes(id) ? 'Unarchive' : 'Archive', icon: 'archive', onClick: () => setDmPrefs((p) => ({ archived: toggleIn(p.archived, id, !p.archived.includes(id)) })) },
      { type: 'header', label: 'Folder' },
      ...dmPrefs.folders
        .filter((f) => f.id !== folder?.id)
        .map((f) => ({ label: `Move to ${f.name}`, icon: 'folder', onClick: () => setDmPrefs((p) => ({ folders: p.folders.map((x) => ({ ...x, channels: x.id === f.id ? [...new Set([...x.channels, id])] : x.channels.filter((c) => c !== id) })) })) })),
      folder && { label: `Remove from ${folder.name}`, icon: 'folder', onClick: () => setDmPrefs((p) => ({ folders: p.folders.map((x) => ({ ...x, channels: x.channels.filter((c) => c !== id) })) })) },
      {
        label: 'New folder…',
        icon: 'plus',
        onClick: async () => {
          const name = await askText({ title: 'New folder', label: 'Folder name', placeholder: 'Close friends', maxLength: 40 });
          if (!name?.trim()) return;
          setDmPrefs((p) => ({ folders: [...p.folders.map((x) => ({ ...x, channels: x.channels.filter((c) => c !== id) })), { id: crypto.randomUUID(), name: name.trim(), channels: [id] }] }));
        },
      },
      { type: 'sep' },
    ];
  }

  function convoMenu(e: React.MouseEvent, d: DmChannel) {
    const unreadCount = unread.counts[d.channel.id] ?? 0;
    if (d.other) {
      openMenu(e, [unreadCount > 0 && { label: 'Mark As Read', icon: 'check', onClick: () => markRead(d.channel.id) }, ...organiseMenu(d), ...userMenu(d.other.id)]);
      return;
    }
    openMenu(e, [
      { type: 'header', label: d.title },
      unreadCount > 0 && { label: 'Mark As Read', icon: 'check', onClick: () => markRead(d.channel.id) },
      ...organiseMenu(d),
      { label: 'Group Settings', icon: 'users', onClick: () => (openChannel('@me', d.channel.id), setGroupSettings(true)) },
      { label: 'Copy Link', icon: 'link', onClick: () => copyText(linkTo(`channels/@me/${d.channel.id}`)) },
      { type: 'sep' },
      { label: 'Copy Channel ID', icon: 'copy', onClick: () => copyText(d.channel.id) },
    ]);
  }

  const dmRow = (d: DmChannel) => {
    const p = d.other ? getProfile(d.other.id) : null;
    const muted = mutedUntil(d.channel.id) > Date.now();
    return (
      <button
        key={d.channel.id}
        className={`channel dm${selected === d.channel.id ? ' active' : ''}${muted ? ' muted-convo' : ''}`}
        onClick={() => openChannel('@me', d.channel.id)}
        onContextMenu={(e) => convoMenu(e, d)}
      >
        <ConvoAvatar dm={d} size={32} />
        <span className="channel-name">
          {d.other ? displayName(d.other.id) : d.title}
          {d.channel.is_group ? (
            <small className="convo-sub">{d.members.length + 1} members</small>
          ) : p?.status_text ? (
            <small className="convo-sub">{p.status_text}</small>
          ) : null}
        </span>
        {muted && <Icon name="bellOff" size={12} />}
        {isPinned(d) && <Icon name="pin" size={12} />}
        {(unread.counts[d.channel.id] ?? 0) > 0 && !muted && <span className="badge inline">{unread.counts[d.channel.id]}</span>}
      </button>
    );
  };

  return (
    <>
      <Sidebar>
        <header className="sidebar-header">
          <input className="search-btn" placeholder="Find a conversation" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </header>
        <div className="sidebar-scroll">
          <button className={`channel nav-item${!current && homeTab === 'friends' ? ' active' : ''}`} onClick={() => (setHomeTab('friends'), openFriends())}>
            <Icon name="users" size={20} />
            <span className="channel-name">Friends</span>
            {incoming > 0 && <span className="badge inline">{incoming}</span>}
          </button>
          <button
            className={`channel nav-item${(!current && homeTab === 'requests') || isRequest ? ' active' : ''}`}
            onClick={() => (setHomeTab('requests'), openFriends())}
          >
            <Icon name="message" size={20} />
            <span className="channel-name">Message Requests</span>
            {requests.length > 0 && <span className="badge inline">{requests.length}</span>}
          </button>
          <button className="channel nav-item" onClick={openDiscover}>
            <Icon name="compass" size={20} />
            <span className="channel-name">Discover</span>
          </button>
          <button className={`channel nav-item${!current && homeTab === 'saved' ? ' active' : ''}`} onClick={() => (setHomeTab('saved'), openFriends())}>
            <Icon name="bookmark" size={20} />
            <span className="channel-name">Saved Messages</span>
          </button>
          <button className={`channel nav-item${!current && homeTab === 'market' ? ' active' : ''}`} onClick={() => (setHomeTab('market'), openFriends())}>
            <Icon name="sparkles" size={20} />
            <span className="channel-name">Marketplace</span>
          </button>
          <button className={`channel nav-item${!current && homeTab === 'donate' ? ' active' : ''}`} onClick={() => (setHomeTab('donate'), openFriends())}>
            <Icon name="star" size={20} />
            <span className="channel-name">Donate</span>
          </button>
          <div className="category">
            <span>Direct messages — {dms.length}</span>
            <span className="category-actions">
              <button className="icon-btn" onClick={() => setNewGroup(true)} title="New group chat">
                <Icon name="users" size={16} />
              </button>
              <button className="icon-btn" onClick={() => setNewDm(true)} title="New direct message">
                <Icon name="plus" size={16} />
              </button>
            </span>
          </div>
          {pinnedDms.length > 0 && <div className="dm-section-label">Pinned</div>}
          {pinnedDms.map(dmRow)}
          {dmPrefs.folders.map((f) => {
            const list = visibleDms.filter((d) => f.channels.includes(d.channel.id) && !isPinned(d) && !isArchived(d));
            const open = !collapsedFolders[f.id];
            const unreadIn = list.reduce((n, d) => n + (unread.counts[d.channel.id] ?? 0), 0);
            return (
              <div key={f.id} className="dm-folder">
                <button
                  className="dm-folder-head"
                  onClick={() => setCollapsedFolders((c) => ({ ...c, [f.id]: open }))}
                  onContextMenu={(e) =>
                    openMenu(e, [
                      { type: 'header', label: f.name },
                      {
                        label: 'Rename Folder',
                        icon: 'edit',
                        onClick: async () => {
                          const name = await askText({ title: 'Rename folder', label: 'Name', initial: f.name, maxLength: 40 });
                          if (name?.trim()) setDmPrefs((p) => ({ folders: p.folders.map((x) => (x.id === f.id ? { ...x, name: name.trim() } : x)) }));
                        },
                      },
                      { label: 'Delete Folder', icon: 'trash', danger: true, onClick: () => setDmPrefs((p) => ({ folders: p.folders.filter((x) => x.id !== f.id) })) },
                    ])
                  }
                  aria-expanded={open}
                >
                  <Icon name="chevron" size={12} />
                  <Icon name="folder" size={14} />
                  <span className="grow">{f.name}</span>
                  {!open && unreadIn > 0 && <span className="badge inline">{unreadIn}</span>}
                </button>
                {open && list.map(dmRow)}
                {open && !list.length && <p className="empty-hint small">Right-click a conversation → Move to {f.name}</p>}
              </div>
            );
          })}
          {(pinnedDms.length > 0 || dmPrefs.folders.length > 0) && looseDms.length > 0 && <div className="dm-section-label">Conversations</div>}
          {looseDms.map(dmRow)}
          {archivedDms.length > 0 && (
            <button className="dm-folder-head archived-toggle" onClick={() => setShowArchived((v) => !v)} aria-expanded={showArchived}>
              <Icon name="archive" size={14} />
              <span className="grow">Archived ({archivedDms.length})</span>
              <Icon name="chevron" size={12} />
            </button>
          )}
          {showArchived && archivedDms.map(dmRow)}
          {!dms.length && <p className="empty-hint">No conversations yet. Start one with the + button.</p>}
        </div>
        <CallDock />
      </Sidebar>
      <main className="main">
        {current ? (
          <>
            {inCall && (
              <div className="dm-call">
                {alone && !waiting && (
                  <div className="calling-banner">
                    <ConvoAvatar dm={current} size={28} />
                    {current.channel.is_group ? 'Everyone left the call.' : `${current.title} left the call.`}
                    <button className="btn small secondary" onClick={() => leaveCall()}>
                      Hang up
                    </button>
                  </div>
                )}
                {waiting && (
                  <div className="calling-banner">
                    <ConvoAvatar dm={current} size={28} />
                    {noAnswer ? 'Nobody picked up yet. They’ll see you’re in the call when they open Venband.' : `Calling ${current.title}…`}
                  </div>
                )}
                <VoiceView compact />
              </div>
            )}
            {isRequest && <RequestBanner dm={current} />}
            <ChatView
              channel={current.channel}
              title={current.other ? displayName(current.other.id) : current.title}
              canSend={!isRequest}
              canManage={false}
              dmMembers={current.members}
              headerExtra={
                <>
                  {!inCall && (
                    <button
                      className={`btn small ${othersInCall.length ? 'success' : 'secondary'}`}
                      onClick={() => joinCall(identity, current.channel.id, current.channel.id, current.title, { ring: !othersInCall.length })}
                    >
                      <Icon name="phone" size={16} /> {othersInCall.length ? 'Join call' : 'Call'}
                    </button>
                  )}
                  {current.channel.is_group && (
                    <button className="icon-btn" title="Group settings — add people, rename, leave" onClick={() => setGroupSettings(true)}>
                      <Icon name="users" />
                    </button>
                  )}
                  {current.other && (
                    <button className="icon-btn" title="Profile" onClick={() => openProfile(current.other!.id)}>
                      <Icon name="user" />
                    </button>
                  )}
                </>
              }
            />
          </>
        ) : homeTab === 'requests' ? (
          <MessageRequestsView requests={requests} onOpen={(d) => openChannel('@me', d.channel.id)} />
        ) : homeTab === 'donate' ? (
          <DonateView />
        ) : homeTab === 'market' ? (
          <MarketplaceView />
        ) : homeTab === 'saved' ? (
          <SavedView
            header={
              <header className="chat-header">
                <Icon name="bookmark" />
                <h3>Saved Messages</h3>
                <span className="topic small muted">Only you can see these</span>
              </header>
            }
          />
        ) : (
          <FriendsView />
        )}
      </main>
      {newDm && <NewDmModal onClose={() => setNewDm(false)} />}
      {newGroup && <NewGroupModal onClose={() => setNewGroup(false)} />}
      {groupSettings && current?.channel.is_group && <GroupSettingsModal dm={current} onClose={() => setGroupSettings(false)} />}
      <ProfileHost />
    </>
  );
}

// ---------------------------------------------------------------- server --

function ServerView({ serverId }: { serverId: string }) {
  const data = useServerData(serverId);
  const keyring = sessionStore.use((s) => s.keyring)!;
  const selected = nav.use((s) => s.channelByServer[serverId]);
  const presence = useScopePresence(serverId, { online: true }); // shows you as online in this server
  const [showMembers, setShowMembers] = useState(true);
  const [vcChat, setVcChat] = useState(false);
  const membersWidth = useSettings((s) => s.layout.members);
  const channel = data.channels.find((c) => c.id === selected) ?? data.channels.find((c) => c.type === 'text') ?? null;
  const me = sessionStore.use((s) => s.me)!;

  // Only current members may stay connected to this server's calls.
  const memberKey = data.members.map((m) => m.user_id).join(',');
  const activeCall = useActiveCall();
  useEffect(() => {
    if (activeCall?.scopeId === serverId && data.members.length) {
      activeCall.setAllowedUsers(new Set(data.members.map((m) => m.user_id)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberKey, activeCall, serverId]);

  useEffect(() => {
    if (data.server) myRolesByServer.set(serverId, data.rolesOf(me.id).map((r) => r.id));
  }, [data, serverId, me.id]);

  // Share channel keys with members who don't have them yet (e.g. new joiners).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const c of data.channels.filter((c) => c.type === 'text')) {
        if (cancelled) return;
        try {
          await keyring.ensure(c.id, c.key_rotation_needed);
        } catch {
          /* channel may have been deleted */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberKey, data.channels.length, keyring]);

  // the server's own look, unless you turned server themes off
  const themeMode = useSettings((s) => s.serverThemes);
  const theme = data.server?.theme;
  useEffect(() => {
    if (!theme || themeMode === 'never') return;
    const vars = themeVars(themeMode === 'merge' ? { accent: theme.accent } : theme) as Record<string, string>;
    const root = document.documentElement;
    const before = Object.fromEntries(Object.keys(vars).map((k) => [k, root.style.getPropertyValue(k)]));
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    root.dataset.serverTheme = 'on';
    return () => {
      for (const [k, v] of Object.entries(before)) (v ? root.style.setProperty(k, v) : root.style.removeProperty(k));
      delete root.dataset.serverTheme;
    };
  }, [theme, themeMode]);

  // rules / welcome screen / onboarding for members who haven't been through it
  const [welcome, setWelcome] = useState<'checking' | 'show' | 'done'>('checking');
  const needsWelcome = Boolean(data.server && data.server.owner_id !== me.id && ((data.server.rules?.length ?? 0) > 0 || data.server.welcome?.message || (data.server.onboarding?.questions?.length ?? 0) > 0));
  useEffect(() => {
    if (!data.server) return;
    if (!needsWelcome) return setWelcome('done');
    supabase
      .from('member_onboarding')
      .select('completed_at, rules_accepted_at')
      .eq('server_id', serverId)
      .eq('user_id', me.id)
      .maybeSingle()
      .then(({ data: row }) => setWelcome(row?.completed_at && (row.rules_accepted_at || !(data.server!.rules?.length ?? 0)) ? 'done' : 'show'));
  }, [serverId, needsWelcome, me.id, data.server]);

  if (!data.server) return <div className="main loading-main"><div className="spinner" /></div>;
  const status = data.server.status ?? 'active';

  return (
    <>
      <Sidebar>
        <ServerHeader data={data} />
        <ChannelList data={data} selected={channel?.id ?? null} presence={presence} />
        <CallDock />
      </Sidebar>
      <main className="main">
        {status !== 'active' && (
          <div className={`server-status-banner ${status}`}>
            <Icon name={status === 'review' ? 'eye' : 'block'} size={16} />
            {status === 'review'
              ? 'This server is being reviewed by Venband staff. It’s read-only until the review is done.'
              : status === 'closed'
                ? 'This server was closed by Venband staff.'
                : 'This server was banned by Venband staff.'}
          </div>
        )}
        {data.server.voogle?.enabled && data.server.voogle.required && <VoogleGate data={data} />}
        <TimeoutBar data={data} />
        {welcome === 'show' && (
          <WelcomeScreen
            data={data}
            onDone={() => {
              setWelcome('done');
              data.reload();
            }}
            onLater={() => setWelcome('done')}
          />
        )}
        {channel?.type === 'forum' ? (
          <ForumView channel={channel} data={data} />
        ) : channel?.type === 'stage' ? (
          <StageView channel={channel} data={data} />
        ) : channel?.type === 'voice' ? (
          <VoiceChannelView
            channel={channel}
            data={data}
            chatButton={
              <button className={`icon-btn${vcChat ? ' on' : ''}`} onClick={() => setVcChat((v) => !v)} title={vcChat ? 'Hide chat' : 'Show voice channel chat'}>
                <Icon name="message" />
              </button>
            }
          />
        ) : channel ? (
          <ChatView
            channel={channel}
            title={channel.name}
            canSend={has(data.permsFor(channel.id), P.SEND_MESSAGES) && (channel.type !== 'announcement' || has(data.permsFor(channel.id), P.MANAGE_MESSAGES))}
            canManage={has(data.permsFor(channel.id), P.MANAGE_MESSAGES)}
            data={data}
            headerExtra={
              <button
                className={`icon-btn${showMembers ? ' on' : ''}`}
                onClick={() => (isPhone() ? setDrawer('members') : setShowMembers((v) => !v))}
                title="Member list"
              >
                <Icon name="users" />
              </button>
            }
          />
        ) : (
          <div className="empty-state">
            <h2>No channels</h2>
            <p className="muted">This server has no channels you can see.</p>
          </div>
        )}
      </main>
      {vcChat && channel?.type === 'voice' && (
        <aside className="vc-chat">
          <ChatView
            channel={channel}
            title={channel.name}
            canSend={has(data.permsFor(channel.id), P.SEND_MESSAGES)}
            canManage={has(data.permsFor(channel.id), P.MANAGE_MESSAGES)}
            data={data}
            headerExtra={
              <button className="icon-btn" onClick={() => setVcChat(false)} title="Close chat">
                <Icon name="x" />
              </button>
            }
          />
        </aside>
      )}
      {(showMembers || isPhone()) && channel?.type === 'text' && (
        <MemberList data={data} online={new Set(presence.map((p) => p.user_id))} width={membersWidth} />
      )}
      <ProfileHost data={data} />
    </>
  );
}

function ServerHeader({ data }: { data: ServerData }) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<null | 'invite' | 'settings' | 'channel'>(null);
  const me = sessionStore.use((s) => s.me)!;
  const server = data.server!;
  const p = data.myPermissions;
  const isOwner = server.owner_id === me.id;

  async function leave() {
    if (!(await askConfirm({ title: `Leave ${server.name}`, body: 'You won’t be able to rejoin unless you’re invited again.', confirm: 'Leave Server', danger: true }))) return;
    const { error } = await supabase.from('server_members').delete().eq('server_id', server.id).eq('user_id', me.id);
    if (error) alert(errorMessage(error));
    else openServer(null);
  }

  return (
    <>
      {server.banner_url && <div className="server-banner-img" style={{ backgroundImage: `url("${server.banner_url}")` }} onClick={() => setOpen((o) => !o)} />}
      <header
        className={`sidebar-header server-header${server.banner_url ? ' over-banner' : ''}`}
        onClick={() => setOpen((o) => !o)}
        style={server.banner_color ? { ['--server-banner' as string]: server.banner_color } : undefined}
      >
        <span className="server-name">
          {server.verified && <VerifiedMark size={16} />}
          {server.name}
          <ServerBadge tag={server.tag} />
        </span>
        <Icon name={open ? 'x' : 'chevron'} size={18} />
      </header>
      {open && (
        <div className="dropdown" onMouseLeave={() => setOpen(false)}>
          {has(p, P.CREATE_INVITE) && (
            <button className="accent" onClick={() => (setModal('invite'), setOpen(false))}>
              Invite People <Icon name="userPlus" size={16} />
            </button>
          )}
          {(has(p, P.MANAGE_SERVER) || has(p, P.MANAGE_ROLES) || has(p, P.KICK_MEMBERS) || has(p, P.BAN_MEMBERS)) && (
            <button onClick={() => (setModal('settings'), setOpen(false))}>
              Server Settings <Icon name="settings" size={16} />
            </button>
          )}
          {has(p, P.MANAGE_CHANNELS) && (
            <button onClick={() => (setModal('channel'), setOpen(false))}>
              Create Channel <Icon name="plus" size={16} />
            </button>
          )}
          {has(p, P.MANAGE_CHANNELS) && (
            <button
              onClick={async () => {
                setOpen(false);
                const name = await askText({ title: 'Create Category', label: 'Category name', placeholder: 'Gaming', maxLength: 100 });
                if (name?.trim()) createCategory(data, name).catch((e) => alert(errorMessage(e)));
              }}
            >
              Create Category <Icon name="plus" size={16} />
            </button>
          )}
          <button onClick={() => (openProfile(me.id, server.id), setOpen(false))}>
            Edit Server Profile <Icon name="edit" size={16} />
          </button>
          <button onClick={() => (copyText(server.id), setOpen(false))}>
            Copy Server ID <Icon name="copy" size={16} />
          </button>
          {!isOwner && (
            <button className="danger" onClick={leave}>
              Leave Server <Icon name="logout" size={16} />
            </button>
          )}
        </div>
      )}
      {modal === 'invite' && <InviteModal serverId={server.id} serverName={server.name} onClose={() => setModal(null)} />}
      {modal === 'settings' && <ServerSettingsModal data={data} onClose={() => setModal(null)} />}
      {modal === 'channel' && <CreateChannelModal data={data} onClose={() => setModal(null)} />}
    </>
  );
}

function ChannelList({ data, selected, presence }: { data: ServerData; selected: string | null; presence: ReturnType<typeof useScopePresence> }) {
  const [editing, setEditing] = useState<Channel | null>(null);
  const [creating, setCreating] = useState<null | { category?: string }>(null);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const unread = unreadStore.use((s) => s);
  const identity = sessionStore.use((s) => s.identity)!;
  const call = useActiveCall();
  const canManage = has(data.myPermissions, P.MANAGE_CHANNELS);
  const canConnect = has(data.myPermissions, P.CONNECT);

  const groups = useMemo(() => {
    const m = new Map<string, Channel[]>();
    for (const c of data.channels) m.set(c.category, [...(m.get(c.category) ?? []), c]);
    // categories with no channels yet still show (so you can fill them)
    for (const cat of data.server?.categories ?? []) if (!m.has(cat)) m.set(cat, []);
    return [...m.entries()];
  }, [data.channels, data.server?.categories]);

  async function newCategory() {
    const name = await askText({ title: 'Create Category', label: 'Category name', placeholder: 'Gaming', maxLength: 100 });
    if (name?.trim()) createCategory(data, name).catch((e) => alert(errorMessage(e)));
  }

  function listMenu(e: React.MouseEvent, category?: string) {
    if (!canManage) return openMenu(e, [{ label: 'Copy Server ID', icon: 'copy', onClick: () => copyText(data.server!.id) }]);
    const custom = category !== undefined && (data.server?.categories ?? []).includes(category);
    const empty = category !== undefined && !data.channels.some((c) => c.category === category);
    openMenu(e, [
      category ? { type: 'header', label: category } : false,
      { label: 'Create Channel', icon: 'plus', onClick: () => setCreating({ category }) },
      { label: 'Create Category', icon: 'plus', onClick: newCategory },
      category && {
        label: 'Rename Category',
        icon: 'edit',
        onClick: async () => {
          const name = (await askText({ title: 'Rename Category', label: 'Category name', initial: category, maxLength: 100 }))?.trim();
          if (!name || name === category) return;
          await supabase.from('channels').update({ category: name }).eq('server_id', data.server!.id).eq('category', category);
          const cats = (data.server?.categories ?? []).map((c) => (c === category ? name : c));
          await supabase.from('servers').update({ categories: cats }).eq('id', data.server!.id);
          data.reload();
        },
      },
custom &&
          empty && {
            label: 'Delete Category',
            icon: 'trash',
            danger: true,
            onClick: async () => {
              await supabase.from('servers').update({ categories: (data.server?.categories ?? []).filter((c) => c !== category) }).eq('id', data.server!.id);
              data.reload();
            },
          },
      { label: 'Category Settings', icon: 'settings', onClick: () => setEditingCategory(category ?? '') },
    ]);
  }

  // ---- drag & drop
  const [dnd, setDnd] = useState<{ drag: string | null; over: { id: string; where: 'before' | 'after' } | null; overCategory?: string }>({ drag: null, over: null });
  const themeColors = data.server?.theme ?? {};

  async function moveChannel(id: string, to: { beforeId: string | null; afterId: string | null; category: string }) {
    const moving = data.channels.find((c) => c.id === id);
    if (!moving) return;
    const before = data.channels.map((c) => ({ id: c.id, position: c.position, category: c.category }));
    // the order as shown, with the moved channel taken out and dropped in its new place
    const ordered = groups.flatMap(([, list]) => list).filter((c) => c.id !== id);
    let at = ordered.length;
    if (to.beforeId) at = ordered.findIndex((c) => c.id === to.beforeId);
    else if (to.afterId) at = ordered.findIndex((c) => c.id === to.afterId) + 1;
    else {
      const lastInCat = ordered.map((c) => c.category).lastIndexOf(to.category);
      at = lastInCat === -1 ? ordered.length : lastInCat + 1;
    }
    ordered.splice(Math.max(0, at), 0, { ...moving, category: to.category });
    const items = ordered.map((c, i) => ({ id: c.id, position: i, category: c.id === id ? to.category : c.category }));
    const changedCategory = moving.category !== to.category;
    let sync = false;
    if (changedCategory) {
      const sibling = data.channels.find((c) => c.category === to.category && c.id !== id);
      if (sibling && sibling.is_private !== moving.is_private) {
        sync = await askConfirm({
          title: `Move #${moving.name} to ${to.category || 'no category'}`,
          body: `Keep this channel’s current permissions, or sync them with the ${to.category} category (${sibling.is_private ? 'private' : 'visible to everyone'})?`,
          confirm: 'Sync with category',
        });
        if (sync) {
          await supabase.from('channels').update({ is_private: sibling.is_private }).eq('id', id);
          if (sibling.is_private) {
            const access = data.channelAccess.filter((a) => a.channel_id === sibling.id).map((a) => ({ channel_id: id, role_id: a.role_id }));
            await supabase.from('channel_role_access').delete().eq('channel_id', id);
            if (access.length) await supabase.from('channel_role_access').insert(access);
          }
        }
      }
    }
    const { error } = await supabase.rpc('reorder_channels', { p_server: data.server!.id, p_items: items });
    if (error) return alert(errorMessage(error));
    data.reload();
    showUndo(`Moved #${moving.name}`, async () => {
      await supabase.rpc('reorder_channels', { p_server: data.server!.id, p_items: before });
      data.reload();
    });
  }

  const voiceUsers = (channelId: string) => {
    const seen = new Set<string>();
    return presence.filter((p) => p.voice_channel_id === channelId && !seen.has(p.user_id) && seen.add(p.user_id));
  };

  function channelMenu(e: React.MouseEvent, c: Channel) {
    openMenu(e, [
      { type: 'header', label: c.type === 'voice' ? c.name : `#${c.name}` },
      (unread.counts[c.id] ?? 0) > 0 && { label: 'Mark As Read', icon: 'check', onClick: () => markRead(c.id) },
      (c.type === 'voice' || c.type === 'stage') &&
        has(data.myPermissions, P.CREATE_INVITE) && {
          label: call?.channelId === c.id ? 'Invite Friends to This Call' : 'Invite Friends to Voice',
          icon: 'userPlus',
          onClick: () => openGlobalModal({ kind: 'invite-to-voice', serverId: data.server!.id, serverName: data.server!.name, channelId: c.id, channelName: c.name }),
        },
      { label: 'Copy Link', icon: 'link', onClick: () => copyText(linkTo(`channels/${data.server!.id}/${c.id}`)) },
      canManage && { label: 'Edit Channel', icon: 'settings', onClick: () => setEditing(c) },
      canManage && {
        label: 'Delete Channel',
        icon: 'trash',
        danger: true,
        onClick: async () => {
          if (!(await askConfirm({ title: `Delete #${c.name}`, body: 'All of its encrypted messages are deleted too. This can’t be undone.', confirm: 'Delete Channel', danger: true }))) return;
          const { error } = await supabase.from('channels').delete().eq('id', c.id);
          if (error) alert(errorMessage(error));
        },
      },
      { type: 'sep' },
      { label: 'Copy Channel ID', icon: 'copy', onClick: () => copyText(c.id) },
    ]);
  }

  return (
    <div className="sidebar-scroll" onContextMenu={(e) => listMenu(e)}>
      {groups.map(([category, channels]) => (
        <div key={category || '_'}>
          {category && (
            <div
              className={`category${dnd.overCategory === category ? ' drop-into' : ''}`}
              style={themeColors.categories?.[category] || themeColors.category ? { color: themeColors.categories?.[category] ?? themeColors.category } : undefined}
              onClick={() => setCollapsed((c) => ({ ...c, [category]: !c[category] }))}
              onContextMenu={(e) => listMenu(e, category)}
              onDragOver={(e) => {
                if (!dnd.drag) return;
                e.preventDefault();
                setDnd((d) => ({ ...d, over: null, overCategory: category }));
              }}
              onDragLeave={() => setDnd((d) => ({ ...d, overCategory: undefined }))}
              onDrop={(e) => {
                e.preventDefault();
                if (dnd.drag) moveChannel(dnd.drag, { beforeId: null, afterId: null, category });
                setDnd({ drag: null, over: null });
              }}
            >
              <span>
                <span className={`caret${collapsed[category] ? ' closed' : ''}`}>
                  <Icon name="chevron" size={12} />
                </span>
                {category}
              </span>
              {canManage && (
                <button
                  className="icon-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCreating({ category });
                  }}
                  title="Create channel"
                >
                  <Icon name="plus" size={16} />
                </button>
              )}
            </div>
          )}
          {channels
            .filter((c) => !collapsed[category] || c.id === selected)
            .map((c) => (
              <div key={c.id}>
                <div
                  className={`channel${selected === c.id ? ' active' : ''}${dnd.over?.id === c.id ? ` drop-${dnd.over.where}` : ''}${dnd.drag === c.id ? ' dragging' : ''}`}
                  role="button"
                  tabIndex={0}
                  style={c.color || themeColors.channel ? { color: c.color ?? themeColors.channel } : undefined}
                  draggable={canManage}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-venband-channel', c.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDnd({ drag: c.id, over: null });
                  }}
                  onDragEnd={() => setDnd({ drag: null, over: null })}
                  onDragOver={(e) => {
                    if (!dnd.drag || dnd.drag === c.id) return;
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    setDnd((d) => ({ ...d, over: { id: c.id, where: e.clientY < r.top + r.height / 2 ? 'before' : 'after' } }));
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dnd.drag && dnd.over) moveChannel(dnd.drag, { beforeId: dnd.over.where === 'before' ? c.id : null, afterId: dnd.over.where === 'after' ? c.id : null, category: c.category });
                    setDnd({ drag: null, over: null });
                  }}
                  onClick={() => {
                    openChannel(data.server!.id, c.id);
                    if ((c.type === 'voice' || c.type === 'stage') && canConnect && call?.channelId !== c.id) {
                      joinCall(identity, c.id, data.server!.id, c.name);
                    }
                  }}
                  onContextMenu={(e) => channelMenu(e, c)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLElement).click()}
                >
                  <Icon name={channelIcon(c, data.server?.welcome_channel_id)} size={18} />
                  <span className={`channel-name${unread.counts[c.id] && selected !== c.id ? ' unread' : ''}`}>{c.name}</span>
                  {c.is_private && <Icon name="lock" size={12} />}
                  {(unread.mentions[c.id] ?? 0) > 0 && selected !== c.id && <span className="badge inline">{unread.mentions[c.id]}</span>}
                  {canManage && (
                    <button
                      className="icon-btn channel-gear"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(c);
                      }}
                      title="Edit channel"
                    >
                      <Icon name="settings" size={14} />
                    </button>
                  )}
                </div>
                {(c.type === 'voice' || c.type === 'stage') &&
                  voiceUsers(c.id).map((p) => (
                    <div key={p.user_id} className="voice-user" onContextMenu={(e) => openMenu(e, userMenu(p.user_id, { data }))} onClick={() => openProfile(p.user_id, data.server!.id)}>
                      <Avatar profile={getProfile(p.user_id)} size={22} />
                      <span>{displayName(p.user_id, data.members.find((m) => m.user_id === p.user_id)?.nickname)}</span>
                      {p.screen && <span className="live-badge">LIVE</span>}
                      {p.video && <Icon name="video" size={14} />}
                      {p.deafened ? <Icon name="headphonesOff" size={14} /> : p.muted ? <Icon name="micOff" size={14} /> : null}
                    </div>
                  ))}
              </div>
            ))}
        </div>
      ))}
      {editing && <ChannelSettingsModal channel={editing} data={data} onClose={() => setEditing(null)} />}
      {creating && <CreateChannelModal data={data} initialCategory={creating.category} onClose={() => setCreating(null)} />}
      {editingCategory !== null && <CategorySettingsModal category={editingCategory} data={data} onClose={() => setEditingCategory(null)} />}
    </div>
  );
}

function channelIcon(c: Channel, welcomeId?: string | null): string {
  if (c.type === 'voice') return 'speaker';
  if (c.type === 'stage') return 'stage';
  if (c.type === 'forum') return 'thread';
  if (c.type === 'announcement') return 'megaphone';
  return c.id === welcomeId ? 'hand' : 'hash';
}

function VoiceChannelView({ channel, data, chatButton }: { channel: Channel; data: ServerData; chatButton: React.ReactNode }) {
  const call = useActiveCall();
  const identity = sessionStore.use((s) => s.identity)!;
  const inThis = call?.channelId === channel.id;
  if (inThis) return <VoiceView data={data} headerExtra={chatButton} />;
  return (
    <div className="empty-state voice-lobby">
      <div className="voice-lobby-actions">{chatButton}</div>
      <Icon name="speaker" size={64} />
      <h2>{channel.name}</h2>
      <p className="muted">Talk, turn on your camera, or share your screen.</p>
      <button className="btn primary" disabled={!has(data.permsFor(channel.id), P.CONNECT)} onClick={() => joinCall(identity, channel.id, data.server!.id, channel.name)}>
        Join voice
      </button>
    </div>
  );
}

function MemberList({ data, online, width }: { data: ServerData; online: Set<string>; width: number }) {
  const myId = sessionStore.use((s) => s.identity?.userId);
  useDirectory();
  useEffect(() => {
    loadProfiles(data.members.map((m) => m.user_id));
  }, [data.members]);

  const isOnline = (id: string) => online.has(id) && getProfile(id)?.presence !== 'invisible';
  const groups = useMemo(() => {
    const hoisted = data.roles.filter((r) => r.hoist && !r.is_default);
    const out: { title: string; members: typeof data.members }[] = [];
    const placed = new Set<string>();
    for (const role of hoisted) {
      const ms = data.members.filter((m) => isOnline(m.user_id) && !placed.has(m.user_id) && data.rolesOf(m.user_id).some((r) => r.id === role.id));
      ms.forEach((m) => placed.add(m.user_id));
      if (ms.length) out.push({ title: role.name, members: ms });
    }
    const rest = data.members.filter((m) => isOnline(m.user_id) && !placed.has(m.user_id));
    if (rest.length) out.push({ title: 'Online', members: rest });
    const off = data.members.filter((m) => !isOnline(m.user_id));
    if (off.length) out.push({ title: 'Offline', members: off });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, online]);

  return (
    <aside className="members" style={{ width }}>
      <Resizer axis="x" invert value={width} min={200} max={400} onChange={(v) => updateLayout({ members: v })} />
      {groups.map((g) => (
        <div key={g.title}>
          <div className="members-title">
            {g.title} — {g.members.length}
          </div>
          {g.members.map((m) => {
            const top = data.rolesOf(m.user_id).find((r) => r.color !== '#99aab5') ?? null;
            const iconRole = data.rolesOf(m.user_id).find((r) => r.icon) ?? null;
            const p = getProfile(m.user_id);
            const on = isOnline(m.user_id);
            return (
              <button
                key={m.user_id}
                className={`member nameplate-row nameplate-${p?.nameplate ?? 'none'}${on ? '' : ' offline'}`}
                style={nameplateVars(p)}
                onClick={() => openProfile(m.user_id, data.server!.id)}
                onContextMenu={(e) => openMenu(e, userMenu(m.user_id, { data }))}
              >
                <Avatar profile={p} size={32} online={on} />
                <span className="member-text">
                  <span className="member-name" style={{ color: top?.color }}>
                    {iconRole && <RoleIcon icon={iconRole.icon} size={13} />}
                    <StyledName style={p?.name_style} fallbackColor={top?.color}>
                      {displayName(m.user_id, m.nickname)}
                    </StyledName>
                    <Badges ids={p?.badges} max={2} size={13} />
                    <ServerTag tag={p?.server_tag} serverId={p?.tag_server_id} />
                  </span>
                  {p?.status_text && (
                    <span className="member-status" title={p.status_text}>
                      {p.status_text}
                    </span>
                  )}
                </span>
                {data.server?.owner_id === m.user_id && <OwnerCrown size={14} label="Server owner" />}
                {m.user_id === myId && <span className="tag-soft accent">you</span>}
              </button>
            );
          })}
        </div>
      ))}
      <BotMembers serverId={data.server!.id} />
    </aside>
  );
}

function BotMembers({ serverId }: { serverId: string }) {
  const bots = useServerBots(serverId);
  const apps = useApps(bots.map((b) => b.app_id));
  if (!bots.length) return null;
  return (
    <div>
      <div className="members-title">Bots — {bots.length}</div>
      {bots.map((b) => {
        const a = apps[b.app_id];
        return (
          <div key={b.id} className="member bot-member" title={a?.description || undefined}>
            {a ? <PresetLogo preset={a.preset} color={a.color} size={32} /> : <Icon name="bot" size={22} />}
            <span className="member-text">
              <span className="member-name">
                {a?.name ?? 'Bot'} <BotTag />
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------ user panel --

const PRESENCE_LABEL: Record<PresenceStatus, string> = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', invisible: 'Invisible' };

/** In-call controls at the bottom of the channel list. */
function CallDock() {
  const call = useActiveCall();
  if (!call) return null;
  return (
    <div className="call-dock">
      <div className="voice-bar">
        <div className="voice-bar-info">
          <span className={`voice-status ${call.status}`}>
            <span className="live-dot" /> {call.status === 'connected' ? 'In a call' : 'Connecting…'}
          </span>
          <button className="voice-channel-link" onClick={() => openCallChannel(call.scopeId, call.channelId)}>
            {call.channelName}
          </button>
        </div>
        <button className="icon-btn" onClick={() => call.toggleCamera()} title={call.cam ? 'Turn off camera' : 'Turn on camera'}>
          <Icon name={call.cam ? 'video' : 'videoOff'} size={18} />
        </button>
        <button className={`icon-btn${call.screen ? ' on' : ''}`} onClick={() => call.toggleScreen()} title="Share screen">
          <Icon name="screen" size={18} />
        </button>
        <button className="icon-btn danger" onClick={() => leaveCall()} title="Disconnect">
          <Icon name="phoneOff" size={18} />
        </button>
      </div>
    </div>
  );
}

/** Top bar: menu (phones), where you are, quick switcher, and you. */
function TopBar({ servers, dms }: { servers: Server[]; dms: DmChannel[] }) {
  const me = sessionStore.use((s) => s.me)!;
  const call = useActiveCall();
  const serverId = nav.use((s) => s.serverId);
  const discover = nav.use((s) => s.discover);
  const dmId = nav.use((s) => s.channelByServer['@me']);
  const server = servers.find((x) => x.id === serverId);
  const dm = !serverId && !discover ? dms.find((d) => d.channel.id === dmId) : null;
  const where = discover ? 'Discover' : server ? server.name : dm ? (dm.other ? displayName(dm.other.id) : dm.title) : 'Friends';

  function statusMenu(e: React.MouseEvent) {
    openMenu(e, [
      { type: 'header', label: me.display_name },
      ...(['online', 'idle', 'dnd', 'invisible'] as PresenceStatus[]).map((p) => ({
        type: 'check' as const,
        label: PRESENCE_LABEL[p],
        checked: (me.presence ?? 'online') === p,
        onChange: () => updateMyProfile({ presence: p }).catch((err) => alert(errorMessage(err))),
      })),
      { type: 'sep' },
      {
        label: me.status_text ? 'Edit Custom Status' : 'Set Custom Status',
        icon: 'smile',
        onClick: async () => {
          const v = await askText({ title: 'Custom status', label: 'What’s up?', initial: me.status_text ?? '', maxLength: 128 });
          if (v === null) return;
          updateMyProfile({ status_text: v.trim() }).catch((err) => alert(errorMessage(err)));
        },
      },
      { label: 'View Profile', icon: 'user', onClick: () => openProfile(me.id) },
      { label: 'Settings', icon: 'settings', onClick: () => openSettings('account') },
      { label: 'Copy User ID', icon: 'copy', onClick: () => copyText(me.id) },
    ]);
  }

  return (
    <header className="topbar">
      <button className="icon-btn topbar-menu" onClick={() => setDrawer(uiStore.get().drawer === 'nav' ? null : 'nav')} aria-label="Open menu">
        <Icon name="menu" size={22} />
      </button>
      <div className="topbar-where">
        {server?.verified && <VerifiedMark size={14} />}
        <span>{where}</span>
        {server?.tag && <ServerBadge tag={server.tag} />}
      </div>
      <button className="topbar-search" onClick={() => uiStore.set({ switcher: true })}>
        <Icon name="search" size={15} />
        <span>Search or jump to…</span>
        <kbd>Ctrl K</kbd>
      </button>
      <div className="user-panel">
        <button className={`icon-btn${call?.muted ? ' danger-text' : ''}`} onClick={() => call?.toggleMute()} disabled={!call} title={call?.muted ? 'Unmute' : 'Mute'}>
          <Icon name={call?.muted ? 'micOff' : 'mic'} size={18} />
        </button>
        <button className={`icon-btn${call?.deafened ? ' danger-text' : ''}`} onClick={() => call?.toggleDeafen()} disabled={!call} title={call?.deafened ? 'Undeafen' : 'Deafen'}>
          <Icon name={call?.deafened ? 'headphonesOff' : 'headphones'} size={18} />
        </button>
        <button className="icon-btn" onClick={() => openSettings('account')} title="User settings">
          <Icon name="settings" size={18} />
        </button>
        <button className="user-chip" onClick={statusMenu} onContextMenu={statusMenu} title="Set status">
          <Avatar profile={me} size={28} online />
          <span className="user-chip-names">
            <span className="name">{me.display_name}</span>
            <span className="tag">{me.status_text || PRESENCE_LABEL[me.presence ?? 'online']}</span>
          </span>
        </button>
      </div>
    </header>
  );
}

/** Ctrl+K: jump to any conversation, server or friend. */
type PaletteItem = { key: string; label: string; sub: string; icon: React.ReactNode; go: () => void; kind: 'place' | 'command' | 'search' };

/** Ctrl+K: jump anywhere or run a command. Prefixes: > commands, # channels, @ people, * servers. */
function QuickSwitcher({ servers, dms, onClose, onCreateServer }: { servers: Server[]; dms: DmChannel[]; onClose: () => void; onCreateServer: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const friends = socialStore.use((s) => s.friends);
  const [channels, setChannels] = useState<{ id: string; name: string; server_id: string; type: string }[]>([]);
  const call = useActiveCall();
  useEffect(() => {
    const ids = servers.map((x) => x.id);
    if (!ids.length) return;
    supabase
      .from('channels')
      .select('id, name, server_id, type')
      .in('server_id', ids)
      .then(({ data }) => setChannels((data ?? []) as typeof channels));
  }, [servers]);
  const commands: PaletteItem[] = useMemo(() => {
    const c = (key: string, label: string, icon: string, go: () => void, sub = 'Command'): PaletteItem => ({ key: `cmd:${key}`, label, sub, icon: <Icon name={icon} size={18} />, go, kind: 'command' });
    return [
      c('settings', 'Open settings', 'settings', () => openSettings('account')),
      c('appearance', 'Change theme', 'palette', () => openSettings('appearance')),
      c('notifications', 'Notification settings', 'bell', () => openSettings('notifications')),
      c('voice', 'Voice & video settings', 'mic', () => openSettings('voice')),
      c('privacy', 'Privacy & safety', 'shield', () => openSettings('privacy')),
      c('saved', 'Open saved messages', 'bookmark', () => (uiStore.set({ homeTab: 'saved' }), openFriends())),
      c('search', 'Search messages', 'search', () => openSearch('', null)),
      c('discover', 'Discover servers', 'compass', openDiscover),
      c('friends', 'Open friends', 'users', openFriends),
      c('create-server', 'Create or join a server', 'plus', onCreateServer),
      c('readall', 'Mark everything as read', 'check', () => Object.keys(unreadStore.get().counts).forEach(markRead)),
      call && c('mute', call.muted ? 'Unmute microphone' : 'Mute microphone', call.muted ? 'mic' : 'micOff', () => call.toggleMute(), 'Call'),
      call && c('deafen', call.deafened ? 'Undeafen' : 'Deafen', 'headphones', () => call.toggleDeafen(), 'Call'),
      call && c('leave', 'Leave call', 'phoneOff', leaveCall, 'Call'),
      c('reduce-motion', 'Toggle reduced motion', 'sparkles', () => updateSettings((st) => ({ chat: { ...st.chat, reduceMotion: !st.chat.reduceMotion } }))),
    ].filter(Boolean) as PaletteItem[];
  }, [call, onCreateServer]);
  const items = useMemo(() => {
    const out: PaletteItem[] = [];
    let needle = q.trim().toLowerCase();
    let only: null | 'command' | 'channel' | 'person' | 'server' = null;
    if (needle.startsWith('>')) (only = 'command'), (needle = needle.slice(1).trim());
    else if (needle.startsWith('#')) (only = 'channel'), (needle = needle.slice(1).trim());
    else if (needle.startsWith('@')) (only = 'person'), (needle = needle.slice(1).trim());
    else if (needle.startsWith('*')) (only = 'server'), (needle = needle.slice(1).trim());
    if (!only || only === 'person') {
      for (const d of dms)
        out.push({ key: d.channel.id, label: d.other ? displayName(d.other.id) : d.title, sub: d.channel.is_group ? 'Group' : 'Direct message', icon: <ConvoAvatar dm={d} size={24} />, go: () => openChannel('@me', d.channel.id), kind: 'place' });
      for (const f of Object.values(friends).filter((x) => x.accepted && !dms.some((d) => d.other?.id === x.other)))
        out.push({ key: f.other, label: displayName(f.other), sub: 'Friend', icon: <Avatar profile={getProfile(f.other)} size={24} />, go: () => startDm(f.other).catch((e) => alert(errorMessage(e))), kind: 'place' });
    }
    if (!only || only === 'server')
      for (const sv of servers)
        out.push({
          key: sv.id,
          label: sv.name,
          sub: 'Server',
          icon: <span className="server-icon-sm" style={{ background: sv.icon_color, width: 24, height: 24 }}>{initials(sv.name)}</span>,
          go: () => openServer(sv.id),
          kind: 'place',
        });
    if (!only || only === 'channel')
      for (const ch of channels)
        out.push({
          key: ch.id,
          label: ch.name,
          sub: servers.find((x) => x.id === ch.server_id)?.name ?? 'Channel',
          icon: <Icon name={ch.type === 'voice' ? 'speaker' : 'hash'} size={18} />,
          go: () => openChannel(ch.server_id, ch.id),
          kind: 'place',
        });
    if (!only || only === 'command') out.push(...commands);
    const filtered = needle
      ? out.filter((i) => i.label.toLowerCase().includes(needle) || i.sub.toLowerCase().includes(needle) || getProfile(i.key)?.username?.includes(needle))
      : only
        ? out
        : out.filter((i) => i.kind === 'place').slice(0, 12).concat(commands.slice(0, 6));
    if (q.trim() && !only)
      filtered.push({ key: 'search', label: `Search messages for “${q.trim()}”`, sub: 'Enter', icon: <Icon name="search" size={18} />, go: () => openSearch(q.trim(), null), kind: 'search' });
    return filtered;
  }, [dms, servers, friends, channels, commands, q]);
  useEffect(() => setSel(0), [q]);
  const pick = (i: number) => {
    const it = items[i];
    if (!it) return;
    it.go();
    if (it.kind !== 'search') onClose();
    else uiStore.set({ switcher: false });
  };
  let lastKind: string | null = null;
  return (
    <div className="modal-backdrop switcher-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="switcher" role="dialog" aria-label="Command palette">
        <input
          autoFocus
          placeholder="Go to a conversation, channel or server, or type > for commands"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search or run a command"
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') (e.preventDefault(), setSel((v) => Math.min(items.length - 1, v + 1)));
            if (e.key === 'ArrowUp') (e.preventDefault(), setSel((v) => Math.max(0, v - 1)));
            if (e.key === 'Enter') pick(sel);
          }}
        />
        <div className="switcher-list" role="listbox">
          {items.slice(0, 40).map((it, i) => {
            const head = it.kind !== lastKind ? (it.kind === 'command' ? 'Commands' : it.kind === 'search' ? 'Search' : null) : null;
            lastKind = it.kind;
            return (
              <Fragment key={it.key}>
                {head && <div className="switcher-group">{head}</div>}
                <button role="option" aria-selected={i === sel} className={`switcher-item${i === sel ? ' active' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => pick(i)}>
                  {it.icon}
                  <span className="grow">{it.label}</span>
                  <span className="small muted">{it.sub}</span>
                </button>
              </Fragment>
            );
          })}
          {!items.length && <p className="muted small switcher-empty">Nothing matches “{q}”.</p>}
        </div>
        <div className="switcher-hint small muted">↑↓ move · Enter go · <b>&gt;</b> commands · <b>#</b> channels · <b>@</b> people · <b>*</b> servers · Esc close</div>
      </div>
    </div>
  );
}

function openCallChannel(scopeId: string, channelId: string) {
  // DMs use the channel id as scope
  if (scopeId === channelId) openChannel('@me', channelId);
  else openChannel(scopeId, channelId);
}

/** Shows a "is calling you" toast when the other DM participant is in a call we're not in. */
function usePhone() {
  const [phone, setPhone] = useState(() => window.matchMedia('(max-width: 700px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 700px)');
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

function IncomingCall({ dm }: { dm: DmChannel }) {
  const phone = usePhone();
  const presence = useScopePresence(dm.channel.id);
  const identity = sessionStore.use((s) => s.identity)!;
  const me = sessionStore.use((s) => s.me)!;
  const relations = socialStore.use((s) => s.relations);
  const call = useActiveCall();
  const [dismissedAt, setDismissedAt] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => subscribeRings(() => tick((x) => x + 1)), []);
  // A call rings for a short while after someone presses "Call", like a phone.
  // Rejoining, refreshing or sitting in a call never rings anyone: the DM
  // shows "Join call" instead.
  const ring = ringFor(dm.channel.id);
  const caller = ring
    ? presence.find((p) => p.voice_channel_id === dm.channel.id && p.user_id === ring.from && !relations[p.user_id]?.blocked)
    : undefined;
  const ringEndsIn = ring ? RING_MS - (Date.now() - ring.at) : null;
  useEffect(() => {
    if (ringEndsIn === null || ringEndsIn <= 0) return;
    const t = setTimeout(() => tick((x) => x + 1), ringEndsIn + 50);
    return () => clearTimeout(t);
  }, [ringEndsIn]);
  // already in this call — here, or in another tab / on another device → don't ring
  const meAlreadyIn = presence.some((p) => p.voice_channel_id === dm.channel.id && p.user_id === identity.userId);
  const ringing = caller && call?.channelId !== dm.channel.id && !meAlreadyIn;
  const callerProfile = caller ? getProfile(caller.user_id) : null;
  const name = dm.channel.is_group ? `${callerProfile?.display_name ?? 'Someone'} · ${dm.title}` : dm.title;
  const callerId = caller?.user_id;
  useEffect(() => {
    if (!callerId) setDismissedAt(0);
  }, [callerId]);
  const active = Boolean(ringing && !dismissedAt);
  // we just hung up and they stayed (or muted / do not disturb): don't ring, just offer to rejoin
  const quiet = leftRecently(dm.channel.id) || Boolean(callerId && relations[callerId]?.muted) || me.presence === 'dnd';
  useEffect(() => {
    if (!active || quiet) return;
    startRing('incoming');
    notify(`${name} is calling you`, 'Click to open Venband and join the call.', () => openChannel('@me', dm.channel.id), `call-${dm.channel.id}`);
    return () => stopRing('incoming');
  }, [active, quiet, name, dm.channel.id]);
  // you just hung up and they stayed: no pop-up (it looked like they were
  // calling you again). The DM header's "Join call" button rejoins.
  if (!active || leftRecently(dm.channel.id)) return null;
  const accept = () => {
    openChannel('@me', dm.channel.id);
    joinCall(identity, dm.channel.id, dm.channel.id, name);
  };
  if (phone)
    return (
      <div className="phone-call-screen" role="alertdialog" aria-label={`${name} is calling you`}>
        <div className="pcs-top">
          <span className="pcs-label">
            <Icon name="lock" size={12} /> Venband {dm.channel.is_group ? 'group call' : 'call'} · end-to-end encrypted
          </span>
          <ConvoAvatar dm={dm} size={112} />
          <h2>{name}</h2>
          <span className="pcs-status">{quiet ? 'is in a call' : 'is calling you…'}</span>
        </div>
        <div className="pcs-actions">
          <div className="pcs-action">
            <button className="round-btn hangup big" aria-label="Decline" onClick={() => setDismissedAt(Date.now())}>
              <Icon name="phoneOff" size={30} />
            </button>
            <span>Decline</span>
          </div>
          <div className="pcs-action">
            <button className="round-btn accept big" aria-label="Accept" onClick={accept}>
              <Icon name="phone" size={30} />
            </button>
            <span>Accept</span>
          </div>
        </div>
      </div>
    );
  return (
    <div className="toast incoming-call" role="alert">
      <ConvoAvatar dm={dm} size={40} />
      <div className="toast-text">
        <b>{name}</b>
        <span className="small muted">{quiet ? 'is in a call' : 'is calling you…'}</span>
      </div>
      <button className="round-btn hangup small" title="Dismiss" onClick={() => setDismissedAt(Date.now())}>
        <Icon name="phoneOff" size={18} />
      </button>
      <button
        className="round-btn accept small"
        title="Join call"
        onClick={accept}
      >
        <Icon name="phone" size={18} />
      </button>
    </div>
  );
}

/** Slim banner at the top: account standing, session notices, notification prompt. */
function AppBanner() {
  const notice = sessionStore.use((s) => s.notice);
  const status = sessionStore.use((s) => s.me?.account_status ?? 'active');
  const [perm, setPerm] = useState(notificationPermission());
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('venband:notif-prompt') === 'dismissed';
    } catch {
      return false;
    }
  });
  if (status === 'limited' || status === 'very_limited') {
    return (
      <div className="app-banner warn">
        <Icon name="warning" size={16} />
        <span>{STATUS_TEXT[status]}</span>
      </div>
    );
  }
  if (notice && !/logged out|session ended/i.test(notice)) {
    return (
      <div className="app-banner">
        <span>{notice}</span>
        <button className="icon-btn" onClick={() => sessionStore.set({ notice: null })} title="Dismiss">
          <Icon name="x" size={16} />
        </button>
      </div>
    );
  }
  if (perm !== 'default' || hidden) return null;
  return (
    <div className="app-banner">
      <span>Get notified when someone messages or calls you, even when this tab is in the background.</span>
      <button className="btn primary small" onClick={async () => setPerm(await askForNotifications())}>
        Turn on notifications
      </button>
      <button
        className="icon-btn"
        title="Not now"
        onClick={() => {
          setHidden(true);
          try {
            localStorage.setItem('venband:notif-prompt', 'dismissed');
          } catch {
            /* ignore */
          }
        }}
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

/** Avatar for a conversation: the person for DMs, a stacked pair for groups. */
function ConvoAvatar({ dm, size }: { dm: DmChannel; size: number }) {
  if (!dm.channel.is_group) return <Avatar profile={dm.other ? (getProfile(dm.other.id) ?? dm.other) : null} size={size} />;
  const [a, b] = dm.members;
  return (
    <span className="group-avatar" style={{ width: size, height: size }}>
      <Avatar profile={a} size={size * 0.68} />
      {b && <Avatar profile={b} size={size * 0.68} />}
    </span>
  );
}

/** Custom CSS and your background picture (both off in safe mode). */
function useLooks() {
  const css = useSettings((s) => s.customCss);
  useEffect(() => applyCustomCss(css.enabled, css.code), [css.enabled, css.code]);
  useEffect(() => {
    startBackground();
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+Shift+Alt+S: safe mode, in case your own CSS hides everything
      if (e.ctrlKey && e.shiftKey && e.altKey && e.key.toLowerCase() === 's') {
        setSafeMode(!safeMode());
        window.location.reload();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function SafeModeBanner() {
  if (!safeMode()) return null;
  return (
    <div className="app-banner">
      <Icon name="shield" size={16} />
      <span>Safe mode: your custom CSS and background picture are switched off for this tab.</span>
      <button
        className="btn small secondary"
        onClick={() => {
          setSafeMode(false);
          const u = new URL(window.location.href);
          u.searchParams.delete('safe');
          window.location.replace(u.toString());
        }}
      >
        Turn off safe mode
      </button>
    </div>
  );
}
