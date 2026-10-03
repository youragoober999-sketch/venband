import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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
  startRing,
  stopRing,
  unreadStore,
} from '../lib/notify';
import { go, linkTo, parseRoute, useRoute } from '../lib/router';
import { socialStore } from '../lib/social';
import { updateLayout, useSettings } from '../lib/settings';
import { isPhone, openSettings, setDrawer, uiStore } from '../lib/ui';
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
import { Avatar, Icon, Logo, initials } from './ui';
import { ChatView } from './Chat';
import { CallAudio, VoiceView } from './Voice';
import { ChannelSettingsModal, CreateChannelModal, CreateJoinModal, GroupSettingsModal, InviteModal, NewDmModal, NewGroupModal, startDm } from './Modals';
import { ServerSettingsModal } from './ServerSettings';
import { ContextMenuHost, copyText, openMenu, type Entry } from './ContextMenu';
import { DialogHost, askConfirm, askText } from './Dialogs';
import { ProfileHost, ServerTag, openProfile, userMenu } from './People';
import { Badges, VerifiedMark } from './Badges';
import { SettingsPage, STATUS_TEXT } from './Settings';
import { DiscoveryView, FriendsView } from './Friends';
import { Resizer } from './Resizer';
import { mentionsMe } from './Markdown';

export function useActiveCall() {
  useSyncExternalStore(subscribeActiveCall, activeCallVersion);
  return getActiveCall();
}

// channel id -> where it lives, for notifications about channels not on screen
const channelMeta = new Map<string, { type: Channel['type']; name: string; server_id: string | null; is_group?: boolean }>();

async function describeChannel(id: string) {
  const cached = channelMeta.get(id);
  if (cached) return cached;
  const { data } = await supabase.from('channels').select('type, name, server_id, is_group').eq('id', id).maybeSingle();
  if (data) channelMeta.set(id, data as { type: Channel['type']; name: string; server_id: string | null; is_group?: boolean });
  return (data as { type: Channel['type']; name: string; server_id: string | null; is_group?: boolean } | null) ?? null;
}

// my role ids per server, for @role mention notifications
const myRolesByServer = new Map<string, string[]>();

/** New message somewhere → unread badge, and for DMs / @mentions a sound + desktop notification. */
function useMessageAlerts(servers: Server[]) {
  const serversRef = useRef(servers);
  serversRef.current = servers;
  return useCallback(async (row: MessageRow) => {
    const { me, keyring } = sessionStore.get();
    if (!me || !keyring || row.author_id === me.id || isViewing(row.channel_id)) return;
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
    if ((!isDm && !mention) || rel?.muted || me.presence === 'dnd') return;
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

  // URL -> view (reads the live URL: an earlier effect may just have changed it)
  useEffect(() => {
    const r = parseRoute();
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
    } else {
      go('channels/@me', { replace: true, keepQuery: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, loaded, dms]);

  // view -> URL
  useEffect(() => {
    if (pending.current && !pending.current.startsWith('tried:')) return;
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
  const serverId = nav.use((s) => s.serverId);
  const discover = nav.use((s) => s.discover);
  useEffect(() => {
    if (serverId && loaded && !servers.some((s) => s.id === serverId)) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);
  const [modal, setModal] = useState<null | 'create-join'>(null);
  const drawer = uiStore.use((s) => s.drawer);
  const switcher = uiStore.use((s) => s.switcher);
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
      {switcher && <QuickSwitcher servers={servers} dms={dms} onClose={() => uiStore.set({ switcher: false })} />}
      <CallAudio />
      <div className="toasts">
        {dms.slice(0, 25).map((d) => (
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

  return (
    <nav className="rail" aria-label="Servers">
      <button className={`rail-item home${current === null && !discover ? ' active' : ''}`} onClick={() => openServer(null)} title="Direct messages">
        <Logo size={46} />
        {dmUnread > 0 && <span className="badge">{dmUnread > 99 ? '99+' : dmUnread}</span>}
      </button>
      <div className="rail-sep" />
      {servers.map((s) => {
        const st = serverState(s.id);
        return (
          <button
            key={s.id}
            className={`rail-item${current === s.id ? ' active' : ''}${s.status && s.status !== 'active' ? ' frozen' : ''}`}
            onClick={() => openServer(s.id)}
            onContextMenu={(e) => serverMenu(e, s)}
            data-tip={s.name}
            aria-label={s.name}
            style={{ background: current === s.id ? s.icon_color : undefined }}
          >
            <span className={`rail-pill${st.any ? ' unread' : ''}`} />
            <span className="rail-initials" style={{ color: current === s.id ? '#fff' : undefined }}>
              {initials(s.name)}
            </span>
            {st.mentions > 0 && <span className="badge">{st.mentions}</span>}
            {s.verified && (
              <span className="rail-verified">
                <VerifiedMark size={14} />
              </span>
            )}
          </button>
        );
      })}
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
  const current = dms.find((d) => d.channel.id === selected) ?? null;
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

  const pinnedFirst = useMemo(() => {
    const pin = (d: DmChannel) => Boolean(d.other && relations[d.other.id]?.pinned);
    return [...dms]
      .filter((d) => !filter || d.title.toLowerCase().includes(filter.toLowerCase()))
      .sort((a, b) => Number(pin(b)) - Number(pin(a)));
  }, [dms, relations, filter]);

  function convoMenu(e: React.MouseEvent, d: DmChannel) {
    const unreadCount = unread.counts[d.channel.id] ?? 0;
    if (d.other) {
      openMenu(e, [unreadCount > 0 && { label: 'Mark As Read', icon: 'check', onClick: () => markRead(d.channel.id) }, ...userMenu(d.other.id)]);
      return;
    }
    openMenu(e, [
      { type: 'header', label: d.title },
      unreadCount > 0 && { label: 'Mark As Read', icon: 'check', onClick: () => markRead(d.channel.id) },
      { label: 'Group Settings', icon: 'users', onClick: () => (openChannel('@me', d.channel.id), setGroupSettings(true)) },
      { label: 'Copy Link', icon: 'link', onClick: () => copyText(linkTo(`channels/@me/${d.channel.id}`)) },
      { type: 'sep' },
      { label: 'Copy Channel ID', icon: 'copy', onClick: () => copyText(d.channel.id) },
    ]);
  }

  return (
    <>
      <Sidebar>
        <header className="sidebar-header">
          <input className="search-btn" placeholder="Find a conversation" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </header>
        <div className="sidebar-scroll">
          <button className={`channel nav-item${!current ? ' active' : ''}`} onClick={openFriends}>
            <Icon name="users" size={20} />
            <span className="channel-name">Friends</span>
            {incoming > 0 && <span className="badge inline">{incoming}</span>}
          </button>
          <button className="channel nav-item" onClick={openDiscover}>
            <Icon name="compass" size={20} />
            <span className="channel-name">Discover</span>
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
          {pinnedFirst.map((d) => {
            const p = d.other ? getProfile(d.other.id) : null;
            return (
              <button
                key={d.channel.id}
                className={`channel dm${selected === d.channel.id ? ' active' : ''}`}
                onClick={() => openChannel('@me', d.channel.id)}
                onContextMenu={(e) => convoMenu(e, d)}
              >
                <ConvoAvatar dm={d} size={32} />
                <span className="channel-name">
                  {d.other ? displayName(d.other.id) : d.title}
                  {d.channel.is_group ? (
                    <small className="convo-sub">{d.members.length + 1} members</small>
                  ) : p?.status_text ? (
                    <small className="convo-sub">
                      {p.status_emoji} {p.status_text}
                    </small>
                  ) : null}
                </span>
                {d.other && relations[d.other.id]?.pinned && <Icon name="pin" size={12} />}
                {(unread.counts[d.channel.id] ?? 0) > 0 && <span className="badge inline">{unread.counts[d.channel.id]}</span>}
              </button>
            );
          })}
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
            <ChatView
              channel={current.channel}
              title={current.other ? displayName(current.other.id) : current.title}
              canSend
              canManage={false}
              dmMembers={current.members}
              headerExtra={
                <>
                  {!inCall && (
                    <button
                      className={`btn small ${othersInCall.length ? 'success' : 'secondary'}`}
                      onClick={() => joinCall(identity, current.channel.id, current.channel.id, current.title)}
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
        {channel?.type === 'voice' ? (
          <VoiceChannelView channel={channel} data={data} />
        ) : channel ? (
          <ChatView
            channel={channel}
            title={channel.name}
            canSend={has(data.myPermissions, P.SEND_MESSAGES)}
            canManage={has(data.myPermissions, P.MANAGE_MESSAGES)}
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
      <header className="sidebar-header server-header" onClick={() => setOpen((o) => !o)} style={server.banner_color ? { ['--server-banner' as string]: server.banner_color } : undefined}>
        <span className="server-name">
          {server.verified && <VerifiedMark size={16} />}
          {server.name}
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
  const [creating, setCreating] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const unread = unreadStore.use((s) => s);
  const identity = sessionStore.use((s) => s.identity)!;
  const call = useActiveCall();
  const canManage = has(data.myPermissions, P.MANAGE_CHANNELS);
  const canConnect = has(data.myPermissions, P.CONNECT);

  const groups = useMemo(() => {
    const m = new Map<string, Channel[]>();
    for (const c of data.channels) m.set(c.category, [...(m.get(c.category) ?? []), c]);
    return [...m.entries()];
  }, [data.channels]);

  const voiceUsers = (channelId: string) => {
    const seen = new Set<string>();
    return presence.filter((p) => p.voice_channel_id === channelId && !seen.has(p.user_id) && seen.add(p.user_id));
  };

  function channelMenu(e: React.MouseEvent, c: Channel) {
    openMenu(e, [
      { type: 'header', label: c.type === 'voice' ? c.name : `#${c.name}` },
      (unread.counts[c.id] ?? 0) > 0 && { label: 'Mark As Read', icon: 'check', onClick: () => markRead(c.id) },
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
    <div className="sidebar-scroll">
      {groups.map(([category, channels]) => (
        <div key={category || '_'}>
          {category && (
            <div className="category" onClick={() => setCollapsed((c) => ({ ...c, [category]: !c[category] }))}>
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
                    setCreating(true);
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
                  className={`channel${selected === c.id ? ' active' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    openChannel(data.server!.id, c.id);
                    if (c.type === 'voice' && canConnect && call?.channelId !== c.id) {
                      joinCall(identity, c.id, data.server!.id, c.name);
                    }
                  }}
                  onContextMenu={(e) => channelMenu(e, c)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLElement).click()}
                >
                  <Icon name={c.type === 'voice' ? 'speaker' : c.id === data.server?.welcome_channel_id ? 'hand' : 'hash'} size={18} />
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
                {c.type === 'voice' &&
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
      {creating && <CreateChannelModal data={data} onClose={() => setCreating(false)} />}
    </div>
  );
}

function VoiceChannelView({ channel, data }: { channel: Channel; data: ServerData }) {
  const call = useActiveCall();
  const identity = sessionStore.use((s) => s.identity)!;
  const inThis = call?.channelId === channel.id;
  if (inThis) return <VoiceView data={data} />;
  return (
    <div className="empty-state">
      <Icon name="speaker" size={64} />
      <h2>{channel.name}</h2>
      <p className="muted">Talk, turn on your camera, or share your screen.</p>
      <button className="btn primary" disabled={!has(data.myPermissions, P.CONNECT)} onClick={() => joinCall(identity, channel.id, data.server!.id, channel.name)}>
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
            const p = getProfile(m.user_id);
            const on = isOnline(m.user_id);
            return (
              <button
                key={m.user_id}
                className={`member nameplate-row nameplate-${p?.nameplate ?? 'none'}${on ? '' : ' offline'}`}
                onClick={() => openProfile(m.user_id, data.server!.id)}
                onContextMenu={(e) => openMenu(e, userMenu(m.user_id, { data }))}
              >
                <Avatar profile={p} size={32} online={on} />
                <span className="member-text">
                  <span className="member-name" style={{ color: top?.color }}>
                    {displayName(m.user_id, m.nickname)}
                    <Badges ids={p?.badges} max={2} size={13} />
                    <ServerTag tag={p?.server_tag} />
                  </span>
                  {p?.status_text && (
                    <span className="member-status">
                      {p.status_emoji} {p.status_text}
                    </span>
                  )}
                </span>
                {data.server?.owner_id === m.user_id && (
                  <span className="owner-crown" title="Server owner">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="#ffd60a">
                      <path d="M3 18h18l-2-11-5 4-2-6-2 6-5-4z" />
                    </svg>
                  </span>
                )}
                {m.user_id === myId && <span className="tag-soft accent">you</span>}
              </button>
            );
          })}
        </div>
      ))}
    </aside>
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
            <span className="tag">{me.status_text ? `${me.status_emoji ?? ''} ${me.status_text}` : PRESENCE_LABEL[me.presence ?? 'online']}</span>
          </span>
        </button>
      </div>
    </header>
  );
}

/** Ctrl+K: jump to any conversation, server or friend. */
function QuickSwitcher({ servers, dms, onClose }: { servers: Server[]; dms: DmChannel[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const friends = socialStore.use((s) => s.friends);
  const items = useMemo(() => {
    const out: { key: string; label: string; sub: string; icon: React.ReactNode; go: () => void }[] = [];
    for (const d of dms)
      out.push({
        key: d.channel.id,
        label: d.other ? displayName(d.other.id) : d.title,
        sub: d.channel.is_group ? 'Group' : 'Direct message',
        icon: <ConvoAvatar dm={d} size={24} />,
        go: () => openChannel('@me', d.channel.id),
      });
    for (const sv of servers)
      out.push({
        key: sv.id,
        label: sv.name,
        sub: 'Server',
        icon: (
          <span className="server-icon-sm" style={{ background: sv.icon_color, width: 24, height: 24 }}>
            {initials(sv.name)}
          </span>
        ),
        go: () => openServer(sv.id),
      });
    for (const f of Object.values(friends).filter((x) => x.accepted && !dms.some((d) => d.other?.id === x.other)))
      out.push({
        key: f.other,
        label: displayName(f.other),
        sub: 'Friend',
        icon: <Avatar profile={getProfile(f.other)} size={24} />,
        go: () => startDm(f.other).catch((e) => alert(errorMessage(e))),
      });
    const needle = q.trim().toLowerCase();
    return needle ? out.filter((i) => i.label.toLowerCase().includes(needle) || getProfile(i.key)?.username?.includes(needle)) : out;
  }, [dms, servers, friends, q]);
  useEffect(() => setSel(0), [q]);
  const pick = (i: number) => {
    items[i]?.go();
    onClose();
  };
  return (
    <div className="modal-backdrop switcher-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="switcher" role="dialog" aria-label="Quick switcher">
        <input
          autoFocus
          placeholder="Where would you like to go?"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') (e.preventDefault(), setSel((v) => Math.min(items.length - 1, v + 1)));
            if (e.key === 'ArrowUp') (e.preventDefault(), setSel((v) => Math.max(0, v - 1)));
            if (e.key === 'Enter') pick(sel);
          }}
        />
        <div className="switcher-list">
          {items.slice(0, 30).map((it, i) => (
            <button key={it.key} className={`switcher-item${i === sel ? ' active' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => pick(i)}>
              {it.icon}
              <span className="grow">{it.label}</span>
              <span className="small muted">{it.sub}</span>
            </button>
          ))}
          {!items.length && <p className="muted small switcher-empty">Nothing matches “{q}”.</p>}
        </div>
        <div className="switcher-hint small muted">↑↓ to move · Enter to go · Esc to close</div>
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
function IncomingCall({ dm }: { dm: DmChannel }) {
  const presence = useScopePresence(dm.channel.id);
  const identity = sessionStore.use((s) => s.identity)!;
  const me = sessionStore.use((s) => s.me)!;
  const relations = socialStore.use((s) => s.relations);
  const call = useActiveCall();
  const [dismissedAt, setDismissedAt] = useState(0);
  const caller = presence.find((p) => p.voice_channel_id === dm.channel.id && p.user_id !== identity.userId && !relations[p.user_id]?.blocked);
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
  if (!active) return null;
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
        onClick={() => {
          openChannel('@me', dm.channel.id);
          joinCall(identity, dm.channel.id, dm.channel.id, name);
        }}
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
