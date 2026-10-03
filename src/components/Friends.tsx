import { useEffect, useState, type FormEvent } from 'react';
import { supabase, errorMessage } from '../lib/supabase';
import { displayName, getProfile } from '../lib/directory';
import { respondFriend, removeFriend, sendFriendRequest, socialStore } from '../lib/social';
import { openServer, useDirectory } from '../hooks/data';
import { Avatar, Icon } from './ui';
import { Badges, VerifiedMark } from './Badges';
import { openMenu } from './ContextMenu';
import { openProfile, userMenu } from './People';
import { startDm } from './Modals';

type Tab = 'all' | 'pending' | 'blocked' | 'add';

export function FriendsView() {
  useDirectory();
  const friends = socialStore.use((s) => s.friends);
  const relations = socialStore.use((s) => s.relations);
  const [tab, setTab] = useState<Tab>('all');
  const all = Object.values(friends);
  const accepted = all.filter((f) => f.accepted);
  const pending = all.filter((f) => !f.accepted);
  const blocked = Object.values(relations).filter((r) => r.blocked);
  const pinned = (id: string) => Boolean(relations[id]?.pinned);
  const sorted = [...accepted].sort((a, b) => Number(pinned(b.other)) - Number(pinned(a.other)) || displayName(a.other).localeCompare(displayName(b.other)));
  const shown = sorted;

  return (
    <div className="friends">
      <header className="chat-header friends-header">
        <Icon name="users" />
        <h3>Friends</h3>
        <div className="friends-tabs">
          {(
            [
              ['all', 'All'],
              ['pending', `Pending${pending.filter((p) => p.incoming).length ? ` · ${pending.filter((p) => p.incoming).length}` : ''}`],
              ['blocked', 'Blocked'],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
          <button className={`add${tab === 'add' ? ' active' : ''}`} onClick={() => setTab('add')}>
            Add Friend
          </button>
        </div>
      </header>
      <div className="friends-body">
        {tab === 'add' && <AddFriend />}
        {tab === 'all' && (
          <>
            <div className="members-title">All friends — {shown.length}</div>
            {shown.map((f) => (
              <FriendRow key={f.other} id={f.other} pinned={pinned(f.other)}>
                <button className="round-icon" title="Message" onClick={() => startDm(f.other).catch((e) => alert(errorMessage(e)))}>
                  <Icon name="message" size={18} />
                </button>
                <button className="round-icon" title="More" onClick={(e) => openMenu(e, userMenu(f.other))}>
                  <Icon name="more" size={18} />
                </button>
              </FriendRow>
            ))}
            {!shown.length && (
              <div className="empty-state small">
                <Icon name="users" size={48} />
                <p className="muted">No friends here yet. Add someone with their username.</p>
                <button className="btn primary" onClick={() => setTab('add')}>
                  Add Friend
                </button>
              </div>
            )}
          </>
        )}
        {tab === 'pending' && (
          <>
            <div className="members-title">Pending — {pending.length}</div>
            {pending.map((f) => (
              <FriendRow key={f.other} id={f.other} sub={f.incoming ? 'Incoming friend request' : 'Outgoing friend request'}>
                {f.incoming && (
                  <button className="round-icon ok" title="Accept" onClick={() => respondFriend(f.other, true)}>
                    <Icon name="check" size={18} />
                  </button>
                )}
                <button className="round-icon no" title={f.incoming ? 'Ignore' : 'Cancel'} onClick={() => (f.incoming ? respondFriend(f.other, false) : removeFriend(f.other))}>
                  <Icon name="x" size={18} />
                </button>
              </FriendRow>
            ))}
            {!pending.length && <p className="muted">No pending requests.</p>}
          </>
        )}
        {tab === 'blocked' && (
          <>
            <div className="members-title">Blocked — {blocked.length}</div>
            {blocked.map((r) => (
              <FriendRow key={r.target_id} id={r.target_id} sub="Blocked">
                <button className="round-icon" title="More" onClick={(e) => openMenu(e, userMenu(r.target_id))}>
                  <Icon name="more" size={18} />
                </button>
              </FriendRow>
            ))}
            {!blocked.length && <p className="muted">You haven’t blocked anyone.</p>}
          </>
        )}
      </div>
    </div>
  );
}

function FriendRow({ id, sub, pinned, children }: { id: string; sub?: string; pinned?: boolean; children: React.ReactNode }) {
  const p = getProfile(id);
  return (
    <div className="friend-row" onClick={() => openProfile(id)} onContextMenu={(e) => openMenu(e, userMenu(id))}>
      <Avatar profile={p} size={36} />
      <div className="grow">
        <div className="friend-name">
          {displayName(id)} <span className="muted small">@{p?.username}</span> <Badges ids={p?.badges} max={3} size={14} />
          {pinned && <Icon name="pin" size={13} />}
        </div>
        <div className="small muted">{sub ?? (p?.status_text ? `${p.status_emoji ?? ''} ${p.status_text}` : p?.pronouns || '')}</div>
      </div>
      <div className="friend-actions" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function AddFriend() {
  const [username, setUsername] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      const res = await sendFriendRequest(username);
      const text =
        res === 'accepted'
          ? `You and ${username} are now friends!`
          : res === 'already_friends'
            ? `You’re already friends with ${username}.`
            : res === 'pending'
              ? `You already sent ${username} a request.`
              : `Friend request sent to ${username}.`;
      setMsg({ ok: true, text });
      setUsername('');
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    }
  }
  return (
    <div className="add-friend">
      <h3>Add Friend</h3>
      <p className="muted">You can add friends with their Venband username.</p>
      <form className={`add-friend-box${msg ? (msg.ok ? ' ok' : ' bad') : ''}`} onSubmit={submit}>
        <input autoFocus value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} placeholder="You can add friends with their Venband username." />
        <button className="btn primary small" disabled={!username.trim()}>
          Send Friend Request
        </button>
      </form>
      {msg && <div className={msg.ok ? 'success-text small' : 'danger-text small'}>{msg.text}</div>}
    </div>
  );
}

// -------------------------------------------------------------- discovery --

interface Discoverable {
  id: string;
  name: string;
  description: string;
  icon_color: string;
  banner_color: string | null;
  tag: string | null;
  verified: boolean;
  members: number;
  joined: boolean;
}

export function DiscoveryView() {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Discoverable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('discover_servers', { p_query: q.trim() });
      if (error) setError(errorMessage(error));
      setItems((data ?? []) as Discoverable[]);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function join(s: Discoverable) {
    if (s.joined) return openServer(s.id);
    const { error } = await supabase.rpc('join_discoverable', { p_server: s.id });
    if (error) return setError(errorMessage(error));
    openServer(s.id);
  }

  return (
    <main className="main discovery">
      <div className="discovery-hero">
        <h1>Find your community on Venband</h1>
        <p>Verified servers and communities with 1,000+ members. Everything inside stays end-to-end encrypted.</p>
        <div className="discovery-search">
          <Icon name="search" size={18} />
          <input placeholder="Explore communities" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {error && <div className="form-error">{error}</div>}
      {!items && <div className="spinner" />}
      <div className="discovery-grid">
        {(items ?? []).map((s) => (
          <button key={s.id} className="discovery-card" data-server-id={s.id} onClick={() => join(s)}>
            <div className="discovery-banner" style={{ background: s.banner_color ?? s.icon_color }} />
            <span className="discovery-icon" style={{ background: s.icon_color }}>
              {s.name.slice(0, 2).toUpperCase()}
            </span>
            <div className="discovery-info">
              <div className="discovery-name">
                {s.verified && <VerifiedMark size={16} />} {s.name}
              </div>
              <p className="small muted">{s.description || 'No description yet.'}</p>
              <div className="small muted discovery-meta">
                <span className="online-dot" /> {s.members.toLocaleString()} members
                {s.joined && <span className="tag-soft accent">Joined</span>}
              </div>
            </div>
          </button>
        ))}
      </div>
      {items && !items.length && (
        <div className="empty-state small">
          <Icon name="compass" size={48} />
          <p className="muted">No communities match yet. Servers show up here once they’re verified or reach 1,000 members.</p>
        </div>
      )}
    </main>
  );
}
