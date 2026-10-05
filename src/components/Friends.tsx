import { useEffect, useState, type FormEvent } from 'react';
import { supabase, errorMessage } from '../lib/supabase';
import { displayName, getProfile } from '../lib/directory';
import { respondFriend, removeFriend, sendFriendRequest, setRelation, socialStore } from '../lib/social';
import { openFriends, openServer, useDirectory } from '../hooks/data';
import type { DmChannel } from '../lib/types';
import { openGlobalModal } from './GlobalModals';
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
    const name = username.trim().replace(/^@+/, '');
    if (!name) return;
    try {
      const res = await sendFriendRequest(name);
      const text =
        res === 'accepted'
          ? `You and ${name} are now friends!`
          : res === 'already_friends'
            ? `You’re already friends with ${name}.`
            : res === 'pending'
              ? `You already sent ${name} a request.`
              : `Friend request sent to ${name}.`;
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
        <input autoFocus value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} placeholder="Enter a username" />
        <button className="btn primary small" disabled={!username.trim().replace(/^@+/, '')}>
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
  icon_url?: string | null;
  banner_url?: string | null;
  tag: string | null;
  verified: boolean;
  members: number;
  joined: boolean;
  categories?: string[];
  created_at?: string;
  vanity?: string | null;
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

  const [cat, setCat] = useState<string | null>(null);
  const filtered = (items ?? []).filter((s) => !cat || (s.categories ?? []).includes(cat));
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const sections: [string, Discoverable[]][] =
    q.trim() || cat
      ? [['Results', filtered]]
      : [
          ['Verified communities', filtered.filter((s) => s.verified)],
          ['Popular right now', [...filtered].filter((s) => !s.verified).sort((a, b) => b.members - a.members).slice(0, 24)],
          ['New this month', filtered.filter((s) => (s.created_at ?? '') > monthAgo && !s.verified)],
        ];

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
        <p>Verified and approved communities. Everything inside stays end-to-end encrypted.</p>
        <div className="discovery-search">
          <Icon name="search" size={18} />
          <input placeholder="Explore communities" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="chip-row discovery-cats">
        {['All', 'Gaming', 'Music', 'Art', 'Education', 'Science & Tech', 'Entertainment', 'Community', 'Anime', 'Sports', 'Creators'].map((c) => (
          <button key={c} className={`chip${(cat ?? 'All') === c ? ' on' : ''}`} onClick={() => setCat(c === 'All' ? null : c)}>
            {c}
          </button>
        ))}
      </div>
      {error && <div className="form-error">{error}</div>}
      {!items && <div className="spinner" />}
      {sections.map(([title, list]) =>
        list.length ? (
          <section key={title} className="discovery-section">
            {sections.length > 1 && <h2>{title}</h2>}
            <div className="discovery-grid">
              {list.map((s) => (
                <button key={`${title}-${s.id}`} className="discovery-card" data-server-id={s.id} onClick={() => join(s)}>
                  <div
                    className="discovery-banner"
                    style={s.banner_url ? { backgroundImage: `url("${s.banner_url}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: s.banner_color ?? s.icon_color }}
                  />
                  <span className="discovery-icon" style={{ background: s.icon_color }}>
                    {s.icon_url ? <img src={s.icon_url} alt="" /> : s.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="discovery-info">
                    <div className="discovery-name">
                      {s.verified && <VerifiedMark size={16} />} {s.name}
                    </div>
                    <p className="small muted">{s.description || 'No description yet.'}</p>
                    <div className="small muted discovery-meta">
                      <span className="online-dot" /> {s.members.toLocaleString()} members
                      {s.joined && <span className="tag-soft accent">Joined</span>}
                      {(s.categories ?? []).slice(0, 2).map((c) => (
                        <span key={c} className="tag-soft">
                          {c}
                        </span>
                      ))}
                      <span
                        className="discovery-preview"
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          openGlobalModal({ kind: 'server-preview', serverId: s.id });
                        }}
                      >
                        Preview
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ) : null,
      )}
      {items && !items.length && (
        <div className="empty-state small">
          <Icon name="compass" size={48} />
          <p className="muted">No communities match yet. Servers show up here once they’re verified or reach 1,000 members.</p>
        </div>
      )}
    </main>
  );
}

// ------------------------------------------------------- message requests --

export function MessageRequestsView({ requests, onOpen }: { requests: DmChannel[]; onOpen: (d: DmChannel) => void }) {
  useDirectory();
  return (
    <div className="friends">
      <header className="chat-header">
        <Icon name="message" />
        <h3>Message Requests</h3>
      </header>
      <div className="friends-body">
        <p className="muted small">
          Messages from people you don’t share a server with and aren’t friends with land here. They can’t see whether you’ve read them.
        </p>
        <div className="members-title">Requests — {requests.length}</div>
        {requests.map((d) => (
          <div key={d.channel.id} className="friend-row" onClick={() => onOpen(d)}>
            <Avatar profile={d.other} size={36} />
            <div className="grow">
              <div className="friend-name">
                {d.other ? displayName(d.other.id) : d.title} <span className="muted small">@{d.other?.username}</span>
              </div>
              <div className="small muted">Wants to send you a message · {new Date(d.channel.created_at).toLocaleDateString()}</div>
            </div>
            <div className="friend-actions" onClick={(e) => e.stopPropagation()}>
              <button className="round-icon ok" title="Accept" onClick={() => acceptRequest(d.channel.id)}>
                <Icon name="check" size={18} />
              </button>
              <button className="round-icon no" title="Decline" onClick={() => declineRequest(d.channel.id)}>
                <Icon name="x" size={18} />
              </button>
            </div>
          </div>
        ))}
        {!requests.length && (
          <div className="empty-state small">
            <Icon name="message" size={48} />
            <p className="muted">No message requests.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export async function acceptRequest(channelId: string) {
  const { error } = await supabase.rpc('accept_message_request', { p_channel: channelId });
  if (error) alert(errorMessage(error));
}

export async function declineRequest(channelId: string) {
  const { error } = await supabase.rpc('decline_message_request', { p_channel: channelId });
  if (error) alert(errorMessage(error));
  else openFriends();
}

/** Banner shown on top of a DM that is still a request. */
export function RequestBanner({ dm }: { dm: DmChannel }) {
  const other = dm.other;
  return (
    <div className="request-banner">
      <Avatar profile={other} size={28} />
      <span className="grow">
        <b>{other ? displayName(other.id) : 'Someone'}</b> wants to message you. You don’t share any servers or friends.
      </span>
      <button className="btn success small" onClick={() => acceptRequest(dm.channel.id)}>
        Accept
      </button>
      <button className="btn secondary small" onClick={() => declineRequest(dm.channel.id)}>
        Decline
      </button>
      {other && (
        <button
          className="btn danger small"
          onClick={async () => {
            await setRelation(other.id, { blocked: true }).catch(() => {});
            declineRequest(dm.channel.id);
          }}
        >
          Block
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- donate --
// Donations go straight to the site owner's own PayPal / Cash App / Ko-fi /
// Buy Me a Coffee page: Venband never sees or stores card details.

const DONATE = {
  paypal: (import.meta.env.VITE_DONATE_PAYPAL as string | undefined)?.trim(),
  cashapp: (import.meta.env.VITE_DONATE_CASHAPP as string | undefined)?.trim().replace(/^\$/, ''),
  kofi: (import.meta.env.VITE_DONATE_KOFI as string | undefined)?.trim(),
  bmc: (import.meta.env.VITE_DONATE_BMC as string | undefined)?.trim(),
};

export function DonateView() {
  const [amount, setAmount] = useState('5.00');
  const n = Number(amount);
  const valid = Number.isFinite(n) && n >= 0.01 && n <= 10000;
  const fixed = valid ? n.toFixed(2) : '';
  const providers = [
    DONATE.paypal && { id: 'paypal', name: 'PayPal', sub: 'PayPal balance, Visa, Mastercard, Amex, Discover', url: `https://paypal.me/${encodeURIComponent(DONATE.paypal)}/${fixed}USD`, amount: true },
    DONATE.cashapp && { id: 'cashapp', name: 'Cash App', sub: 'Cash App balance or a linked debit card', url: `https://cash.app/$${encodeURIComponent(DONATE.cashapp)}/${fixed}`, amount: true },
    DONATE.kofi && { id: 'kofi', name: 'Ko-fi', sub: 'Cards, PayPal, Apple Pay, Google Pay (enter the amount there)', url: `https://ko-fi.com/${encodeURIComponent(DONATE.kofi)}`, amount: false },
    DONATE.bmc && { id: 'bmc', name: 'Buy Me a Coffee', sub: 'Cards, Apple Pay, Google Pay (enter the amount there)', url: `https://buymeacoffee.com/${encodeURIComponent(DONATE.bmc)}`, amount: false },
  ].filter(Boolean) as { id: string; name: string; sub: string; url: string; amount: boolean }[];

  return (
    <div className="friends">
      <header className="chat-header">
        <Icon name="star" />
        <h3>Support Venband</h3>
      </header>
      <div className="friends-body donate">
        <div className="donate-hero">
          <h2>Keep Venband free, private and ad-free</h2>
          <p className="muted">Venband is open source and run by a tiny team. Every donation helps pay for servers.</p>
        </div>
        <div className="field-label">Amount (USD)</div>
        <div className="donate-amounts">
          {['1', '5', '10', '25', '50', '100'].map((a) => (
            <button key={a} className={`donate-chip${Number(amount) === Number(a) ? ' active' : ''}`} onClick={() => setAmount(Number(a).toFixed(2))}>
              ${a}
            </button>
          ))}
          <label className="donate-custom">
            $
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} onBlur={() => valid && setAmount(fixed)} />
          </label>
        </div>
        {!valid && <div className="form-error">Pick an amount between $0.01 and $10,000.</div>}
        <div className="donate-providers">
          {providers.map((p) => (
            <a
              key={p.id}
              className={`donate-provider ${p.id}${valid ? '' : ' disabled'}`}
              href={valid ? p.url : undefined}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => !valid && e.preventDefault()}
            >
              <b>
                {p.amount && valid ? `Donate $${fixed} with ` : 'Donate with '}
                {p.name}
              </b>
              <span className="small muted">{p.sub}</span>
            </a>
          ))}
        </div>
        {!providers.length && (
          <div className="notice">
            Donations aren’t set up on this site yet. (Site owner: add <code>VITE_DONATE_PAYPAL</code>, <code>VITE_DONATE_CASHAPP</code>,{' '}
            <code>VITE_DONATE_KOFI</code> or <code>VITE_DONATE_BMC</code> in your hosting settings.)
          </div>
        )}
        <p className="small muted">
          Payments are handled by the provider you pick. Venband never sees your card or bank details. Donations aren’t refundable through
          Venband and don’t unlock anything.
        </p>
      </div>
    </div>
  );
}