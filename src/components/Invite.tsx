// Server invites: the invite page (works before signing up), invite cards in
// messages with a green Join button, and inviting friends straight from lists.
import { useEffect, useMemo, useState } from 'react';
import { supabase, errorMessage } from '../lib/supabase';
import { sessionStore } from '../lib/session';
import { socialStore } from '../lib/social';
import { displayName, getProfile, loadProfiles } from '../lib/directory';
import { go } from '../lib/router';
import { inviteUrl, sendToUser } from '../lib/dmSend';
import { openServer } from '../hooks/data';
import type { Server } from '../lib/types';
import { Avatar, initials, Logo, Modal } from './ui';
import { VerifiedMark } from './Badges';

interface Preview {
  server_id: string;
  name: string;
  description: string;
  icon_url: string | null;
  banner_url: string | null;
  icon_color: string;
  banner_color: string | null;
  verified: boolean;
  members: number;
  channels: string[];
  rules: string[];
  vanity: string | null;
  expires_at: string | null;
  joined: boolean;
}

const cache = new Map<string, Promise<Preview | null>>();
function loadPreview(code: string): Promise<Preview | null> {
  let p = cache.get(code);
  if (!p) {
    p = Promise.resolve(supabase.rpc('invite_preview', { p_code: code })).then(({ data }) => ((data as Preview[] | null)?.[0] ?? null));
    cache.set(code, p);
  }
  return p;
}

async function joinWith(code: string): Promise<string> {
  const { data, error } = await supabase.rpc('join_server', { p_code: code });
  if (error) throw error;
  cache.delete(code);
  return data as string;
}

function ServerBadge({ p, size = 56 }: { p: { icon_url?: string | null; icon_color: string; name: string }; size?: number }) {
  return p.icon_url ? (
    <img className="invite-icon" src={p.icon_url} alt="" style={{ width: size, height: size }} />
  ) : (
    <span className="invite-icon" style={{ width: size, height: size, background: p.icon_color, fontSize: size * 0.36 }}>
      {initials(p.name)}
    </span>
  );
}

/** The card inside a message that contains an invite link. */
export function InviteEmbed({ code, voice }: { code: string; voice?: string | null }) {
  const [p, setP] = useState<Preview | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadPreview(code).then(setP);
  }, [code]);
  if (p === undefined) return <div className="invite-embed loading">Loading invite…</div>;
  if (!p)
    return (
      <div className="invite-embed">
        <div className="invite-embed-label">You’ve been invited to join a server</div>
        <div className="invite-embed-row">
          <span className="invite-icon dead">?</span>
          <div className="grow">
            <b>Invalid invite</b>
            <div className="small muted">This invite may be expired, paused, or you might not have permission to join.</div>
          </div>
        </div>
      </div>
    );
  return (
    <div className="invite-embed">
      <div className="invite-embed-label">You’ve been invited to join a server</div>
      <div className="invite-embed-row">
        <ServerBadge p={p} size={50} />
        <div className="grow invite-embed-text">
          <b className="ellipsis">
            {p.name} {p.verified && <VerifiedMark size={14} />}
          </b>
          {p.description && <div className="small muted ellipsis">{p.description}</div>}
          <div className="small muted">
            <span className="dot online" /> {p.members.toLocaleString()} member{p.members === 1 ? '' : 's'}
          </div>
        </div>
        <button
          className={`btn ${p.joined ? 'secondary' : 'success'}`}
          disabled={busy}
          onClick={async () => {
            setError(null);
            if (p.joined) return openServer(p.server_id);
            setBusy(true);
            try {
              const id = await joinWith(code);
              if (voice) sessionStorage.setItem('venband:join-voice', JSON.stringify({ server: id, channel: voice }));
              openServer(id);
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {p.joined ? 'Joined' : busy ? 'Joining…' : 'Join'}
        </button>
      </div>
      {error && <div className="small danger-text">{error}</div>}
    </div>
  );
}

/** venband.com/invite/CODE — full page, signed in or not. */
export function InvitePage({ code }: { code: string }) {
  const status = sessionStore.use((s) => s.status);
  const [p, setP] = useState<Preview | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    loadPreview(code).then(setP);
  }, [code, status]);
  const signedIn = status === 'ready';
  return (
    <div className="invite-page">
      <div className="invite-card">
        {p?.banner_url ? <div className="invite-banner" style={{ backgroundImage: `url(${p.banner_url})` }} /> : <div className="invite-banner" style={{ background: p?.banner_color ?? p?.icon_color ?? 'var(--bg-3)' }} />}
        <div className="invite-card-body">
          {p === undefined && <div className="spinner" />}
          {p === null && (
            <>
              <Logo size={48} />
              <h1>This invite isn’t valid</h1>
              <p className="muted">It may have expired, been paused, or the server may have turned off previews for people who aren’t signed in.</p>
              <button className="btn primary" onClick={() => go(signedIn ? 'channels/@me' : 'sign-in')}>
                {signedIn ? 'Back to Venband' : 'Sign in'}
              </button>
            </>
          )}
          {p && (
            <>
              <ServerBadge p={p} size={84} />
              <div className="small muted">You’ve been invited to join</div>
              <h1>
                {p.name} {p.verified && <VerifiedMark size={20} />}
              </h1>
              {p.description && <p className="muted">{p.description}</p>}
              <div className="invite-stats">
                <span>
                  <span className="dot online" /> {p.members.toLocaleString()} members
                </span>
                {p.expires_at && <span className="muted small">Invite expires {new Date(p.expires_at).toLocaleDateString()}</span>}
              </div>
              {p.channels.length > 0 && (
                <div className="invite-channels">
                  {p.channels.slice(0, 8).map((c) => (
                    <span key={c} className="chip">
                      # {c}
                    </span>
                  ))}
                </div>
              )}
              {p.rules.length > 0 && (
                <div className="invite-rules">
                  <b>Rules</b>
                  <ol>
                    {p.rules.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ol>
                </div>
              )}
              {error && <div className="form-error">{error}</div>}
              {signedIn ? (
                <button
                  className="btn success big full"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      const id = p.joined ? p.server_id : await joinWith(code);
                      const voice = new URLSearchParams(window.location.search).get('voice');
                      if (voice) sessionStorage.setItem('venband:join-voice', JSON.stringify({ server: id, channel: voice }));
                      go(`channels/${id}`);
                      openServer(id);
                    } catch (e) {
                      setError(errorMessage(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {p.joined ? 'Open server' : busy ? 'Joining…' : 'Join server'}
                </button>
              ) : (
                <>
                  <button
                    className="btn success big full"
                    onClick={() => {
                      try {
                        sessionStorage.setItem('venband:return-to', `invite/${code}`);
                      } catch {
                        /* ignore */
                      }
                      go('register');
                    }}
                  >
                    Create an account to join
                  </button>
                  <button
                    className="btn link"
                    onClick={() => {
                      try {
                        sessionStorage.setItem('venband:return-to', `invite/${code}`);
                      } catch {
                        /* ignore */
                      }
                      go('sign-in');
                    }}
                  >
                    I already have an account
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
      <p className="small muted invite-foot">
        Venband · end-to-end encrypted chat · <a href={`${import.meta.env.BASE_URL}tos`}>Terms</a>
      </p>
    </div>
  );
}

/** Make (or reuse) a 7-day invite for a server. */
async function makeInvite(serverId: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_invite', { p_server: serverId, p_max_uses: null, p_expires_in_hours: 24 * 7, p_min_account_days: 0, p_label: null });
  if (error) throw error;
  return data as string;
}

/** List of your friends with an Invite button next to each one. */
export function InviteFriendsList({ serverId, serverName, voiceChannel }: { serverId: string; serverName: string; voiceChannel?: { id: string; name: string } }) {
  const friends = socialStore.use((s) => s.friends);
  const [q, setQ] = useState('');
  const [sent, setSent] = useState<Record<string, 'sending' | 'sent' | string>>({});
  const [code, setCode] = useState<string | null>(null);
  const list = useMemo(
    () =>
      Object.values(friends)
        .filter((f) => f.accepted)
        .map((f) => f.other)
        .filter((id) => !q || displayName(id).toLowerCase().includes(q.toLowerCase()) || getProfile(id)?.username.includes(q.toLowerCase())),
    [friends, q],
  );
  useEffect(() => {
    loadProfiles(list);
  }, [list]);

  async function invite(userId: string) {
    setSent((s) => ({ ...s, [userId]: 'sending' }));
    try {
      const c = code ?? (await makeInvite(serverId));
      setCode(c);
      const link = inviteUrl(c);
      const text = voiceChannel
        ? `🔊 Come join me in **${voiceChannel.name}** on **${serverName}**! ${link}?voice=${voiceChannel.id}`
        : `Join me on **${serverName}**! ${link}`;
      await sendToUser(userId, text);
      setSent((s) => ({ ...s, [userId]: 'sent' }));
    } catch (e) {
      setSent((s) => ({ ...s, [userId]: errorMessage(e) }));
    }
  }

  return (
    <div className="invite-friends">
      <input className="search-input" placeholder="Search for friends" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="invite-friends-list">
        {!list.length && <p className="small muted">No friends to invite yet — share the link below instead.</p>}
        {list.map((id) => {
          const st = sent[id];
          return (
            <div key={id} className="invite-friend">
              <Avatar profile={getProfile(id)} size={32} />
              <div className="grow">
                <div>{displayName(id)}</div>
                <div className="small muted">{getProfile(id)?.username}</div>
                {st && st !== 'sending' && st !== 'sent' && <div className="small danger-text">{st}</div>}
              </div>
              <button className={`btn small ${st === 'sent' ? 'secondary' : 'success'}`} disabled={st === 'sending' || st === 'sent'} onClick={() => invite(id)}>
                {st === 'sent' ? 'Sent' : st === 'sending' ? 'Sending…' : 'Invite'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Right-click a friend → Invite to Server: every server you can invite to, with Invite buttons. */
export function InviteToServersModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const me = sessionStore.use((s) => s.me)!;
  const [servers, setServers] = useState<Server[] | null>(null);
  const [state, setState] = useState<Record<string, string>>({});
  useEffect(() => {
    (async () => {
      const { data: mem } = await supabase.from('server_members').select('server_id').eq('user_id', me.id);
      const ids = (mem ?? []).map((m) => m.server_id);
      if (!ids.length) return setServers([]);
      const [{ data: sv }, { data: theirs }] = await Promise.all([
        supabase.from('servers').select('*').in('id', ids).eq('status', 'active'),
        supabase.rpc('mutual_servers', { p_other: userId }),
      ]);
      const mutual = new Set(((theirs ?? []) as { id: string }[]).map((x) => x.id));
      const out = ((sv ?? []) as Server[]).sort((a, b) => a.name.localeCompare(b.name));
      setState(Object.fromEntries(out.filter((x) => mutual.has(x.id)).map((x) => [x.id, 'member'])));
      setServers(out);
    })();
  }, [me.id, userId]);

  async function invite(sv: Server) {
    setState((s) => ({ ...s, [sv.id]: 'sending' }));
    try {
      const code = await makeInvite(sv.id);
      await sendToUser(userId, `Join me on **${sv.name}**! ${inviteUrl(code)}`);
      setState((s) => ({ ...s, [sv.id]: 'sent' }));
    } catch (e) {
      setState((s) => ({ ...s, [sv.id]: errorMessage(e) }));
    }
  }

  return (
    <Modal title={`Invite ${displayName(userId)} to a server`} onClose={onClose}>
      <div className="invite-friends-list tall">
        {!servers && <div className="spinner small" />}
        {servers?.length === 0 && <p className="muted">You’re not in any servers yet.</p>}
        {servers?.map((sv) => {
          const st = state[sv.id];
          return (
            <div key={sv.id} className="invite-friend">
              <ServerBadge p={sv} size={36} />
              <div className="grow">
                <div>{sv.name}</div>
                {st && !['sending', 'sent', 'member'].includes(st) && <div className="small danger-text">{st}</div>}
              </div>
              <button className={`btn small ${st === 'sent' || st === 'member' ? 'secondary' : 'success'}`} disabled={Boolean(st && st !== 'sending' ? ['sent', 'member'].includes(st) : st === 'sending')} onClick={() => invite(sv)}>
                {st === 'member' ? 'Already there' : st === 'sent' ? 'Sent' : st === 'sending' ? 'Sending…' : 'Invite'}
              </button>
            </div>
          );
        })}
      </div>
      <p className="small muted">Each invite is sent as an encrypted DM with a link they can tap to join.</p>
    </Modal>
  );
}

export { joinWith };

interface ServerPreviewRow {
  id: string;
  name: string;
  description: string;
  icon_url: string | null;
  banner_url: string | null;
  icon_color: string;
  banner_color: string | null;
  verified: boolean;
  members: number;
  channels: { name: string; type: string; category: string; topic: string }[];
  rules: string[];
  tag: string | null;
  discovery_status: string;
}

/** Look at a server before joining (from a server tag, discovery or the review queue). */
export function ServerPreviewModal({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const [p, setP] = useState<ServerPreviewRow | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [member, setMember] = useState(false);
  useEffect(() => {
    supabase.rpc('server_preview', { p_server: serverId }).then(({ data }) => setP(((data as ServerPreviewRow[] | null) ?? [])[0] ?? null));
    const me = sessionStore.get().me?.id;
    if (me) supabase.from('server_members').select('server_id').eq('server_id', serverId).eq('user_id', me).maybeSingle().then(({ data }) => setMember(Boolean(data)));
  }, [serverId]);
  const groups = useMemo(() => {
    const m = new Map<string, ServerPreviewRow['channels']>();
    for (const c of p?.channels ?? []) m.set(c.category, [...(m.get(c.category) ?? []), c]);
    return [...m.entries()];
  }, [p]);
  return (
    <Modal title={p?.name ?? 'Server'} onClose={onClose} wide>
      {p === undefined && <div className="spinner" />}
      {p === null && <p className="muted">This server is invite-only, so its details are private. Ask a member for an invite.</p>}
      {p && (
        <div className="server-preview">
          <div className="invite-banner" style={p.banner_url ? { backgroundImage: `url(${p.banner_url})` } : { background: p.banner_color ?? p.icon_color }} />
          <div className="server-preview-head">
            <ServerBadge p={p} size={72} />
            <div className="grow">
              <h2>
                {p.name} {p.verified && <VerifiedMark size={18} />} {p.tag && <span className="server-tag">{p.tag}</span>}
              </h2>
              <div className="small muted">
                <span className="dot online" /> {p.members.toLocaleString()} members
              </div>
            </div>
            {member ? (
              <button className="btn secondary" onClick={() => (openServer(p.id), onClose())}>
                Open
              </button>
            ) : (
              <button
                className="btn success"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  const { error: e } = await supabase.rpc('join_open_server', { p_server: p.id });
                  setBusy(false);
                  if (e) return setError(errorMessage(e));
                  openServer(p.id);
                  onClose();
                }}
              >
                {busy ? 'Joining…' : 'Join'}
              </button>
            )}
          </div>
          {error && <div className="form-error">{error}</div>}
          {p.description && <p>{p.description}</p>}
          <div className="server-preview-cols">
            <div>
              <h4>Channels</h4>
              {groups.map(([cat, list]) => (
                <div key={cat} className="server-preview-cat">
                  {cat && <div className="small muted upper">{cat}</div>}
                  {list.map((c) => (
                    <div key={c.name} className="server-preview-channel">
                      {c.type === 'voice' || c.type === 'stage' ? '🔊' : c.type === 'forum' ? '💬' : c.type === 'announcement' ? '📣' : '#'} {c.name}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {p.rules.length > 0 && (
              <div>
                <h4>Rules</h4>
                <ol className="server-preview-rules">
                  {p.rules.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ol>
              </div>
            )}
          </div>
          <p className="small muted">Messages are end-to-end encrypted, so you can read them after you join.</p>
        </div>
      )}
    </Modal>
  );
}
