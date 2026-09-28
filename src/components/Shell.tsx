import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { sessionStore } from '../lib/session';
import { supabase, errorMessage } from '../lib/supabase';
import { activeCallVersion, getActiveCall, joinCall, leaveCall, subscribeActiveCall } from '../lib/call';
import { displayName, getProfile, loadProfiles } from '../lib/directory';
import { has, P } from '../lib/permissions';
import type { Channel, DmChannel, Server } from '../lib/types';
import { nav, openChannel, openServer, useDirectory, useMyServers, useScopePresence, useServerData, type ServerData } from '../hooks/data';
import { Avatar, Icon, Logo, initials } from './ui';
import { ChatView } from './Chat';
import { CallAudio, VoiceView } from './Voice';
import { ChannelSettingsModal, CreateChannelModal, CreateJoinModal, InviteModal, NewDmModal, ProfileModal, UserSettingsModal } from './Modals';
import { ServerSettingsModal } from './ServerSettings';

export function useActiveCall() {
  useSyncExternalStore(subscribeActiveCall, activeCallVersion);
  return getActiveCall();
}

export function Shell() {
  const { servers, dms, loaded, reload } = useMyServers();
  const serverId = nav.use((s) => s.serverId);
  useEffect(() => {
    if (serverId && loaded && !servers.some((s) => s.id === serverId)) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);
  const [modal, setModal] = useState<null | 'create-join'>(null);
  useDirectory();

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
    <div className="shell">
      <ServerRail servers={servers} current={serverId} onAdd={() => setModal('create-join')} />
      {serverId ? <ServerView key={serverId} serverId={serverId} /> : <HomeView dms={dms} />}
      <CallAudio />
      <div className="toasts">
        {dms.slice(0, 25).map((d) => (
          <IncomingCall key={d.channel.id} dm={d} />
        ))}
      </div>
      {modal === 'create-join' && <CreateJoinModal onClose={() => setModal(null)} />}
    </div>
  );
}

function ServerRail({ servers, current, onAdd }: { servers: Server[]; current: string | null; onAdd: () => void }) {
  return (
    <nav className="rail" aria-label="Servers">
      <button className={`rail-item home${current === null ? ' active' : ''}`} onClick={() => openServer(null)} title="Direct Messages">
        <Logo size={46} />
      </button>
      <div className="rail-sep" />
      {servers.map((s) => (
        <button
          key={s.id}
          className={`rail-item${current === s.id ? ' active' : ''}`}
          onClick={() => openServer(s.id)}
          title={s.name}
          style={{ background: current === s.id ? s.icon_color : undefined }}
        >
          <span className="rail-pill" />
          <span className="rail-initials" style={{ color: current === s.id ? '#fff' : undefined }}>
            {initials(s.name)}
          </span>
        </button>
      ))}
      <button className="rail-item add" onClick={onAdd} title="Add a server">
        <Icon name="plus" size={24} />
      </button>
    </nav>
  );
}

// ------------------------------------------------------------------ home --

function HomeView({ dms }: { dms: DmChannel[] }) {
  const selected = nav.use((s) => s.channelByServer['@me']);
  const [newDm, setNewDm] = useState(false);
  const current = dms.find((d) => d.channel.id === selected) ?? null;
  const call = useActiveCall();
  const presence = useScopePresence(current?.channel.id ?? null);
  const identity = sessionStore.use((s) => s.identity)!;
  const inCall = call?.channelId === current?.channel.id;
  const othersInCall = presence.filter((p) => p.voice_channel_id === current?.channel.id && p.user_id !== identity.userId);

  return (
    <>
      <aside className="sidebar">
        <header className="sidebar-header">
          <button className="search-btn" onClick={() => setNewDm(true)}>
            Find or start a conversation
          </button>
        </header>
        <div className="sidebar-scroll">
          <div className="category">
            <span>Direct messages — {dms.length}</span>
            <button className="icon-btn" onClick={() => setNewDm(true)} title="New DM">
              <Icon name="plus" size={16} />
            </button>
          </div>
          {dms.map((d) => (
            <button
              key={d.channel.id}
              className={`channel dm${selected === d.channel.id ? ' active' : ''}`}
              onClick={() => openChannel('@me', d.channel.id)}
            >
              <Avatar profile={d.other} size={32} />
              <span className="channel-name">{d.other?.display_name ?? 'Unknown user'}</span>
            </button>
          ))}
          {!dms.length && <p className="empty-hint">No conversations yet. Start one with the + button.</p>}
        </div>
        <UserPanel />
      </aside>
      <main className="main">
        {current ? (
          <>
            {inCall && (
              <div className="dm-call">
                <VoiceView compact />
              </div>
            )}
            <ChatView
              channel={current.channel}
              title={current.other?.display_name ?? 'Unknown user'}
              canSend
              canManage={false}
              headerExtra={
                !inCall && (
                  <button
                    className={`btn small ${othersInCall.length ? 'success' : 'secondary'}`}
                    onClick={() => joinCall(identity, current.channel.id, current.channel.id, current.other?.display_name ?? 'Call')}
                  >
                    <Icon name="phone" size={16} /> {othersInCall.length ? 'Join call' : 'Call'}
                  </button>
                )
              }
            />
          </>
        ) : (
          <div className="empty-state">
            <Logo size={80} />
            <h2>It’s quiet in here</h2>
            <p className="muted">Start a server with the + on the left, or send someone a message.</p>
            <div className="empty-actions">
              <button className="btn primary" onClick={() => setNewDm(true)}>
                New direct message
              </button>
            </div>
          </div>
        )}
      </main>
      {newDm && <NewDmModal onClose={() => setNewDm(false)} />}
    </>
  );
}

// ---------------------------------------------------------------- server --

function ServerView({ serverId }: { serverId: string }) {
  const data = useServerData(serverId);
  const keyring = sessionStore.use((s) => s.keyring)!;
  const selected = nav.use((s) => s.channelByServer[serverId]);
  const presence = useScopePresence(serverId);
  const [showMembers, setShowMembers] = useState(true);
  const channel = data.channels.find((c) => c.id === selected) ?? data.channels.find((c) => c.type === 'text') ?? null;

  // Only current members may stay connected to this server's calls.
  const memberKey = data.members.map((m) => m.user_id).join(',');
  const activeCall = useActiveCall();
  useEffect(() => {
    if (activeCall?.scopeId === serverId && data.members.length) {
      activeCall.setAllowedUsers(new Set(data.members.map((m) => m.user_id)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberKey, activeCall, serverId]);

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

  return (
    <>
      <aside className="sidebar">
        <ServerHeader data={data} />
        <ChannelList data={data} selected={channel?.id ?? null} presence={presence} />
        <UserPanel />
      </aside>
      <main className="main">
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
              <button className={`icon-btn${showMembers ? ' on' : ''}`} onClick={() => setShowMembers((v) => !v)} title="Member list">
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
      {showMembers && channel?.type === 'text' && <MemberList data={data} online={new Set(presence.map((p) => p.user_id))} />}
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
    if (!confirm(`Leave ${server.name}?`)) return;
    const { error } = await supabase.from('server_members').delete().eq('server_id', server.id).eq('user_id', me.id);
    if (error) alert(errorMessage(error));
    else openServer(null);
  }

  return (
    <>
      <header className="sidebar-header server-header" onClick={() => setOpen((o) => !o)}>
        <span className="server-name">{server.name}</span>
        <Icon name={open ? 'x' : 'chevron'} size={18} />
      </header>
      {open && (
        <div className="dropdown" onMouseLeave={() => setOpen(false)}>
          {has(p, P.CREATE_INVITE) && (
            <button className="accent" onClick={() => (setModal('invite'), setOpen(false))}>
              Invite People <Icon name="users" size={16} />
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

function ChannelList({
  data,
  selected,
  presence,
}: {
  data: ServerData;
  selected: string | null;
  presence: ReturnType<typeof useScopePresence>;
}) {
  const [editing, setEditing] = useState<Channel | null>(null);
  const [creating, setCreating] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
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
                  onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLElement).click()}
                >
                  <Icon name={c.type === 'voice' ? 'speaker' : 'hash'} size={18} />
                  <span className="channel-name">{c.name}</span>
                  {c.is_private && <Icon name="lock" size={12} />}
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
                    <div key={p.user_id} className="voice-user">
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
      <button
        className="btn primary"
        disabled={!has(data.myPermissions, P.CONNECT)}
        onClick={() => joinCall(identity, channel.id, data.server!.id, channel.name)}
      >
        Join voice
      </button>
    </div>
  );
}

function MemberList({ data, online }: { data: ServerData; online: Set<string> }) {
  const [profileOf, setProfileOf] = useState<string | null>(null);
  const myId = sessionStore.use((s) => s.identity?.userId);
  useEffect(() => {
    loadProfiles(data.members.map((m) => m.user_id));
  }, [data.members]);

  const groups = useMemo(() => {
    const hoisted = data.roles.filter((r) => r.hoist && !r.is_default);
    const out: { title: string; members: typeof data.members }[] = [];
    const placed = new Set<string>();
    for (const role of hoisted) {
      const ms = data.members.filter((m) => online.has(m.user_id) && !placed.has(m.user_id) && data.rolesOf(m.user_id).some((r) => r.id === role.id));
      ms.forEach((m) => placed.add(m.user_id));
      if (ms.length) out.push({ title: role.name, members: ms });
    }
    const rest = data.members.filter((m) => online.has(m.user_id) && !placed.has(m.user_id));
    if (rest.length) out.push({ title: 'Online', members: rest });
    const off = data.members.filter((m) => !online.has(m.user_id));
    if (off.length) out.push({ title: 'Offline', members: off });
    return out;
  }, [data, online]);

  return (
    <aside className="members">
      {groups.map((g) => (
        <div key={g.title}>
          <div className="members-title">
            {g.title} — {g.members.length}
          </div>
          {g.members.map((m) => {
            const top = data.rolesOf(m.user_id).find((r) => r.color !== '#99aab5') ?? null;
            const isOnline = online.has(m.user_id);
            return (
              <button key={m.user_id} className={`member${isOnline ? '' : ' offline'}`} onClick={() => setProfileOf(m.user_id)}>
                <Avatar profile={getProfile(m.user_id)} size={32} online={isOnline} />
                <span className="member-name" style={{ color: top?.color }}>
                  {displayName(m.user_id, m.nickname)}
                </span>
                {data.server?.owner_id === m.user_id && <span className="tag-soft">owner</span>}
                {m.user_id === myId && <span className="tag-soft accent">you</span>}
              </button>
            );
          })}
        </div>
      ))}
      {profileOf && <ProfileModal userId={profileOf} data={data} onClose={() => setProfileOf(null)} />}
    </aside>
  );
}

// ------------------------------------------------------------ user panel --

export function UserPanel() {
  const me = sessionStore.use((s) => s.me)!;
  const call = useActiveCall();
  const [settings, setSettings] = useState(false);
  return (
    <div className="user-panel-wrap">
      {call && (
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
      )}
      <div className="user-panel">
        <Avatar profile={me} size={34} online />
        <div className="user-panel-names">
          <span className="name">{me.display_name}</span>
          <span className="tag">@{me.username}</span>
        </div>
        <button
          className={`icon-btn${call?.muted ? ' danger-text' : ''}`}
          onClick={() => call?.toggleMute()}
          disabled={!call}
          title={call?.muted ? 'Unmute' : 'Mute'}
        >
          <Icon name={call?.muted ? 'micOff' : 'mic'} size={18} />
        </button>
        <button
          className={`icon-btn${call?.deafened ? ' danger-text' : ''}`}
          onClick={() => call?.toggleDeafen()}
          disabled={!call}
          title={call?.deafened ? 'Undeafen' : 'Deafen'}
        >
          <Icon name={call?.deafened ? 'headphonesOff' : 'headphones'} size={18} />
        </button>
        <button className="icon-btn" onClick={() => setSettings(true)} title="User settings">
          <Icon name="settings" size={18} />
        </button>
      </div>
      {settings && <UserSettingsModal onClose={() => setSettings(false)} />}
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
  const call = useActiveCall();
  const [dismissedAt, setDismissedAt] = useState(0);
  const caller = presence.find((p) => p.voice_channel_id === dm.channel.id && p.user_id !== identity.userId);
  const ringing = caller && call?.channelId !== dm.channel.id;
  useEffect(() => {
    if (!caller) setDismissedAt(0);
  }, [caller]);
  if (!ringing || dismissedAt) return null;
  const name = dm.other?.display_name ?? 'Someone';
  return (
    <div className="toast" role="alert">
      <Avatar profile={dm.other} size={40} />
      <div className="toast-text">
        <b>{name}</b>
        <span className="small muted">is calling you…</span>
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
