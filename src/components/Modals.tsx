import { useEffect, useState, type FormEvent } from 'react';
import { supabase, appUrl, errorMessage } from '../lib/supabase';
import { changePassword, sessionStore, signOut, updateMyProfile } from '../lib/session';
import { fingerprint, passwordStrength } from '../lib/crypto';
import { acceptKeyChange, getCurrentKey, getProfile, loadProfiles, markVerified, putProfile, trustState } from '../lib/directory';
import { has, P } from '../lib/permissions';
import type { Channel, DmChannel, Profile } from '../lib/types';
import { openChannel, openServer, useDirectory, type ServerData } from '../hooks/data';
import { Avatar, ColorPicker, Field, Icon, Modal, randomColor } from './ui';

// ------------------------------------------------------ create/join server --

export function CreateJoinModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [color, setColor] = useState(randomColor());
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const me = sessionStore.use((s) => s.me)!;

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc('create_server', { p_name: name || `${me.display_name}'s server`, p_icon_color: color });
    setBusy(false);
    if (error) return setError(errorMessage(error));
    openServer(data as string);
    onClose();
  }

  async function join(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const raw = code.trim();
    const parsed = raw.includes('invite=') ? new URL(raw).searchParams.get('invite') ?? raw : raw.split('/').pop() ?? raw;
    const { data, error } = await supabase.rpc('join_server', { p_code: parsed });
    setBusy(false);
    if (error) return setError(errorMessage(error));
    openServer(data as string);
    onClose();
  }

  return (
    <Modal title={tab === 'create' ? 'Create a server' : 'Join a server'} onClose={onClose}>
      <div className="tabs">
        <button className={tab === 'create' ? 'active' : ''} onClick={() => setTab('create')}>
          Create
        </button>
        <button className={tab === 'join' ? 'active' : ''} onClick={() => setTab('join')}>
          Join
        </button>
      </div>
      {error && <div className="form-error">{error}</div>}
      {tab === 'create' ? (
        <form onSubmit={create}>
          <p className="muted">Your server is where you and your friends hang out. Everything in it is end-to-end encrypted.</p>
          <Field label="Server name">
            <input maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder={`${me.display_name}'s server`} />
          </Field>
          <Field label="Icon color">
            <ColorPicker value={color} onChange={setColor} />
          </Field>
          <button className="btn primary full" disabled={busy}>
            Create
          </button>
        </form>
      ) : (
        <form onSubmit={join}>
          <p className="muted">Enter an invite code or link.</p>
          <Field label="Invite">
            <input required value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. Ab3dEf9hIjKl" />
          </Field>
          <button className="btn primary full" disabled={busy}>
            Join Server
          </button>
        </form>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- invites --

export function InviteModal({ serverId, serverName, onClose }: { serverId: string; serverName: string; onClose: () => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [hours, setHours] = useState<number | null>(24 * 7);
  const [maxUses, setMaxUses] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCode(null);
    supabase.rpc('create_invite', { p_server: serverId, p_max_uses: maxUses, p_expires_in_hours: hours }).then(({ data, error }) => {
      if (error) setError(errorMessage(error));
      else setCode(data as string);
    });
  }, [serverId, hours, maxUses]);

  const link = code ? appUrl(`?invite=${code}`) : '';
  return (
    <Modal title={`Invite friends to ${serverName}`} onClose={onClose}>
      {error && <div className="form-error">{error}</div>}
      <Field label="Invite link">
        <div className="copy-row">
          <input readOnly value={link || 'Generating…'} onFocus={(e) => e.target.select()} />
          <button
            className="btn primary"
            disabled={!code}
            onClick={() => {
              navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </Field>
      <p className="small muted">
        Code: <code>{code}</code>
      </p>
      <div className="row">
        <Field label="Expire after">
          <select value={hours ?? ''} onChange={(e) => setHours(e.target.value ? Number(e.target.value) : null)}>
            <option value={1}>1 hour</option>
            <option value={24}>1 day</option>
            <option value={24 * 7}>7 days</option>
            <option value="">Never</option>
          </select>
        </Field>
        <Field label="Max uses">
          <select value={maxUses ?? ''} onChange={(e) => setMaxUses(e.target.value ? Number(e.target.value) : null)}>
            <option value="">No limit</option>
            <option value={1}>1 use</option>
            <option value={5}>5 uses</option>
            <option value={25}>25 uses</option>
            <option value={100}>100 uses</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------- channels --

export function CreateChannelModal({ data, onClose }: { data: ServerData; onClose: () => void }) {
  const [type, setType] = useState<'text' | 'voice'>('text');
  const [name, setName] = useState('');
  const [category, setCategory] = useState(type === 'text' ? 'Text Channels' : 'Voice Channels');
  const [isPrivate, setPrivate] = useState(false);
  const [roles, setRoles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const categories = [...new Set(data.channels.map((c) => c.category))];

  async function submit(e: FormEvent) {
    e.preventDefault();
    const clean = type === 'text' ? name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '') : name.trim();
    if (!clean) return setError('Name required');
    const { data: ch, error } = await supabase
      .from('channels')
      .insert({
        server_id: data.server!.id,
        type,
        name: clean,
        category,
        is_private: isPrivate,
        position: data.channels.length,
      })
      .select()
      .single();
    if (error) return setError(errorMessage(error));
    if (isPrivate && roles.length) {
      await supabase.from('channel_role_access').insert(roles.map((role_id) => ({ channel_id: ch.id, role_id })));
    }
    if (type === 'text') await sessionStore.get().keyring!.ensure(ch.id);
    openChannel(data.server!.id, ch.id);
    onClose();
  }

  return (
    <Modal title="Create Channel" onClose={onClose}>
      <form onSubmit={submit}>
        {error && <div className="form-error">{error}</div>}
        <div className="type-picker">
          {(['text', 'voice'] as const).map((t) => (
            <label key={t} className={`type-option${type === t ? ' selected' : ''}`}>
              <input
                type="radio"
                checked={type === t}
                onChange={() => {
                  setType(t);
                  setCategory(t === 'text' ? 'Text Channels' : 'Voice Channels');
                }}
              />
              <Icon name={t === 'text' ? 'hash' : 'speaker'} />
              <div>
                <b>{t === 'text' ? 'Text' : 'Voice'}</b>
                <div className="small muted">{t === 'text' ? 'Encrypted messages, files and replies' : 'Encrypted voice, video and screen share'}</div>
              </div>
            </label>
          ))}
        </div>
        <Field label="Channel name">
          <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder={type === 'text' ? 'new-channel' : 'Lounge'} />
        </Field>
        <Field label="Category">
          <input list="categories" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={100} />
          <datalist id="categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <PrivateToggle data={data} isPrivate={isPrivate} setPrivate={setPrivate} roles={roles} setRoles={setRoles} />
        <button className="btn primary full">Create Channel</button>
      </form>
    </Modal>
  );
}

function PrivateToggle({
  data,
  isPrivate,
  setPrivate,
  roles,
  setRoles,
}: {
  data: ServerData;
  isPrivate: boolean;
  setPrivate: (v: boolean) => void;
  roles: string[];
  setRoles: (r: string[]) => void;
}) {
  return (
    <>
      <label className="checkbox">
        <input type="checkbox" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} />
        <Icon name="lock" size={14} /> Private channel — only selected roles (and admins) can see it
      </label>
      {isPrivate && (
        <div className="role-checks">
          {data.roles
            .filter((r) => !r.is_default)
            .map((r) => (
              <label key={r.id} className="checkbox">
                <input
                  type="checkbox"
                  checked={roles.includes(r.id)}
                  onChange={(e) => setRoles(e.target.checked ? [...roles, r.id] : roles.filter((x) => x !== r.id))}
                />
                <span className="role-dot" style={{ background: r.color }} /> {r.name}
              </label>
            ))}
          {data.roles.length <= 1 && <p className="small muted">Create roles in Server Settings first.</p>}
        </div>
      )}
    </>
  );
}

export function ChannelSettingsModal({ channel, data, onClose }: { channel: Channel; data: ServerData; onClose: () => void }) {
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic);
  const [category, setCategory] = useState(channel.category);
  const [position, setPosition] = useState(channel.position);
  const [isPrivate, setPrivate] = useState(channel.is_private);
  const initialRoles = data.channelAccess.filter((a) => a.channel_id === channel.id).map((a) => a.role_id);
  const [roles, setRoles] = useState<string[]>(initialRoles);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase
      .from('channels')
      .update({ name: name.trim(), topic, category, position, is_private: isPrivate })
      .eq('id', channel.id);
    if (error) return setError(errorMessage(error));
    const removed = initialRoles.filter((r) => !roles.includes(r));
    const added = roles.filter((r) => !initialRoles.includes(r));
    if (removed.length) await supabase.from('channel_role_access').delete().eq('channel_id', channel.id).in('role_id', removed);
    if (added.length) await supabase.from('channel_role_access').insert(added.map((role_id) => ({ channel_id: channel.id, role_id })));
    data.reload();
    onClose();
  }

  async function remove() {
    if (!confirm(`Delete #${channel.name}? All its encrypted messages are deleted too.`)) return;
    const { error } = await supabase.from('channels').delete().eq('id', channel.id);
    if (error) return setError(errorMessage(error));
    onClose();
  }

  return (
    <Modal title={`Edit ${channel.type === 'voice' ? '🔊' : '#'} ${channel.name}`} onClose={onClose}>
      <form onSubmit={save}>
        {error && <div className="form-error">{error}</div>}
        <Field label="Name">
          <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {channel.type === 'text' && (
          <Field label="Topic">
            <textarea maxLength={1024} value={topic} onChange={(e) => setTopic(e.target.value)} />
          </Field>
        )}
        <div className="row">
          <Field label="Category">
            <input maxLength={100} value={category} onChange={(e) => setCategory(e.target.value)} />
          </Field>
          <Field label="Position">
            <input type="number" value={position} onChange={(e) => setPosition(Number(e.target.value))} />
          </Field>
        </div>
        <PrivateToggle data={data} isPrivate={isPrivate} setPrivate={setPrivate} roles={roles} setRoles={setRoles} />
        <p className="small muted">Removing access automatically rotates the channel’s encryption key.</p>
        <div className="modal-actions">
          <button type="button" className="btn danger" onClick={remove}>
            Delete Channel
          </button>
          <button className="btn primary">Save Changes</button>
        </div>
      </form>
    </Modal>
  );
}

// -------------------------------------------------------------------- DMs --

export function NewDmModal({ onClose }: { onClose: () => void }) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="New direct message" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          const { data } = await supabase.rpc('find_user', { p_username: username.replace(/^@/, '').trim() });
          const user = (data as Profile[] | null)?.[0];
          if (!user)
            return setError(
              `Nobody has the username “${username.replace(/^@/, '').trim()}”. Use their @username (shown under their name), not their display name.`,
            );
          await startDm(user.id).catch((err) => setError(errorMessage(err)));
          onClose();
        }}
      >
        <Field label="Username" error={error}>
          <input required value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} placeholder="@username" />
        </Field>
        <button className="btn primary full">Open DM</button>
      </form>
    </Modal>
  );
}

export async function startDm(userId: string) {
  const { data, error } = await supabase.rpc('open_dm', { p_other: userId });
  if (error) throw error;
  await loadProfiles([userId], true);
  openChannel('@me', data as string);
}

// ---------------------------------------------------------------- profile --

export function ProfileModal({ userId, data, onClose }: { userId: string; data?: ServerData; onClose: () => void }) {
  useDirectory();
  const profile = getProfile(userId);
  const me = sessionStore.use((s) => s.me)!;
  const [fp, setFp] = useState<string | null>(null);
  const [keyId, setKeyId] = useState<string | null>(null);
  const trust = trustState(userId);
  const roles = data?.rolesOf(userId) ?? [];
  const member = data?.members.find((m) => m.user_id === userId);
  const [nick, setNick] = useState(member?.nickname ?? '');

  useEffect(() => {
    getCurrentKey(userId, true).then(async (k) => {
      if (!k) return;
      setKeyId(k.key_id);
      setFp(await fingerprint(k.enc_public, k.sign_public));
    });
  }, [userId]);

  return (
    <Modal title="Profile" onClose={onClose}>
      <div className="profile-card">
        <div className="profile-banner" style={{ background: profile?.avatar_color }} />
        <div className="profile-avatar">
          <Avatar profile={profile} size={80} />
        </div>
        <h2>{member?.nickname || profile?.display_name || 'Unknown user'}</h2>
        <div className="muted">@{profile?.username}</div>
        {profile?.about && <p>{profile.about}</p>}
        {roles.length > 0 && (
          <div className="role-pills">
            {roles.map((r) => (
              <span key={r.id} className="role-pill">
                <span className="role-dot" style={{ background: r.color }} />
                {r.name}
              </span>
            ))}
          </div>
        )}
        {userId === me.id && data && (
          <Field label="Server nickname">
            <div className="copy-row">
              <input maxLength={32} value={nick} onChange={(e) => setNick(e.target.value)} />
              <button
                className="btn secondary"
                onClick={async () => {
                  await supabase.from('server_members').update({ nickname: nick.trim() || null }).eq('server_id', data.server!.id).eq('user_id', me.id);
                  data.reload();
                }}
              >
                Save
              </button>
            </div>
          </Field>
        )}
        <div className="security-box">
          <div className="security-title">
            <Icon name="shield" size={16} /> Security fingerprint
            {trust === 'verified' && <span className="trust-ok"> · Verified</span>}
            {trust === 'changed' && <span className="trust-warn"> · Key changed!</span>}
          </div>
          <code className="fingerprint">{fp ?? 'Loading…'}</code>
          {userId !== me.id && (
            <>
              <p className="small muted">
                Compare this number with {profile?.display_name ?? 'them'} in person or over another trusted channel. If it
                matches their “My fingerprint” in settings, nobody is intercepting your conversation.
              </p>
              {keyId && trust !== 'verified' && (
                <button
                  className="btn secondary small"
                  onClick={() => (trust === 'changed' ? acceptKeyChange(userId, keyId) : markVerified(userId, keyId))}
                >
                  {trust === 'changed' ? 'Accept new key' : 'Mark as verified'}
                </button>
              )}
            </>
          )}
        </div>
        {userId !== me.id && (
          <button className="btn primary full" onClick={() => startDm(userId).then(onClose).catch((e) => alert(errorMessage(e)))}>
            <Icon name="message" size={16} /> Message
          </button>
        )}
        {data && userId !== me.id && <ModerationActions userId={userId} data={data} onDone={onClose} />}
      </div>
    </Modal>
  );
}

function ModerationActions({ userId, data, onDone }: { userId: string; data: ServerData; onDone: () => void }) {
  const p = data.myPermissions;
  const me = sessionStore.use((s) => s.me)!;
  if (userId === data.server?.owner_id) return null;
  const myTop = data.server?.owner_id === me.id ? Infinity : (data.topRole(me.id)?.position ?? 0);
  const theirTop = data.topRole(userId)?.position ?? 0;
  if (theirTop >= myTop) return null;
  const canKick = has(p, P.KICK_MEMBERS);
  const canBan = has(p, P.BAN_MEMBERS);
  if (!canKick && !canBan) return null;
  const name = getProfile(userId)?.display_name ?? 'this user';
  return (
    <div className="modal-actions">
      {canKick && (
        <button
          className="btn danger small"
          onClick={async () => {
            if (!confirm(`Kick ${name}?`)) return;
            const { error } = await supabase.from('server_members').delete().eq('server_id', data.server!.id).eq('user_id', userId);
            if (error) alert(errorMessage(error));
            else onDone();
          }}
        >
          Kick
        </button>
      )}
      {canBan && (
        <button
          className="btn danger small"
          onClick={async () => {
            const reason = prompt(`Ban ${name}? Optional reason:`);
            if (reason === null) return;
            const { error } = await supabase
              .from('bans')
              .insert({ server_id: data.server!.id, user_id: userId, banned_by: me.id, reason: reason.slice(0, 512) });
            if (error) alert(errorMessage(error));
            else onDone();
          }}
        >
          Ban
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------- user settings --

export function UserSettingsModal({ onClose }: { onClose: () => void }) {
  const me = sessionStore.use((s) => s.me)!;
  const identity = sessionStore.use((s) => s.identity)!;
  const [tab, setTab] = useState<'profile' | 'security'>('profile');
  const [displayName, setDisplayName] = useState(me.display_name);
  const [about, setAbout] = useState(me.about);
  const [color, setColor] = useState(me.avatar_color);
  const [fp, setFp] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fingerprint(identity.encPublic, identity.signPublic).then(setFp);
  }, [identity]);

  return (
    <Modal title="User Settings" onClose={onClose} wide>
      <div className="tabs">
        <button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}>
          My Profile
        </button>
        <button className={tab === 'security' ? 'active' : ''} onClick={() => setTab('security')}>
          Privacy & Security
        </button>
      </div>
      {msg && <div className="notice">{msg}</div>}
      {tab === 'profile' ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await updateMyProfile({ display_name: displayName.trim() || me.username, about, avatar_color: color });
              putProfile({ ...me, display_name: displayName, about, avatar_color: color });
              setMsg('Saved.');
            } catch (err) {
              setMsg(errorMessage(err));
            }
          }}
        >
          <div className="profile-preview">
            <Avatar profile={{ display_name: displayName, avatar_color: color }} size={64} />
            <div>
              <b>{displayName}</b>
              <div className="muted">@{me.username}</div>
            </div>
          </div>
          <Field label="Display name">
            <input maxLength={32} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </Field>
          <Field label="About me">
            <textarea maxLength={190} value={about} onChange={(e) => setAbout(e.target.value)} />
          </Field>
          <Field label="Avatar color">
            <ColorPicker value={color} onChange={setColor} />
          </Field>
          <div className="modal-actions">
            <button type="button" className="btn danger" onClick={() => signOut()}>
              <Icon name="logout" size={16} /> Log Out
            </button>
            <button className="btn primary">Save</button>
          </div>
        </form>
      ) : (
        <div>
          <div className="security-box">
            <div className="security-title">
              <Icon name="shield" size={16} /> My fingerprint
            </div>
            <code className="fingerprint">{fp}</code>
            <p className="small muted">
              Friends can compare this with the fingerprint they see on your profile to be sure nobody is intercepting
              your messages.
            </p>
          </div>
          <ul className="security-list">
            <li>Messages & files: AES-256-GCM, signed with ECDSA P-256, per-channel keys rotated when members leave.</li>
            <li>Key exchange: ECDH P-256 (ECIES) — the server only ever stores wrapped keys.</li>
            <li>Password: Argon2id (64 MiB) on your device; only a derived login key is sent to the server.</li>
            <li>Calls: peer-to-peer WebRTC (DTLS-SRTP) with signed session descriptions.</li>
          </ul>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!passwordStrength(next).ok) return setMsg('New password is too weak.');
              setBusy(true);
              try {
                await changePassword(current, next);
                setMsg('Password changed. Your keys were re-encrypted with the new password.');
                setCurrent('');
                setNext('');
              } catch (err) {
                setMsg(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <h3>Change password</h3>
            <Field label="Current password">
              <input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <Field label="New password" hint={next ? `Strength: ${passwordStrength(next).label}` : undefined}>
              <input type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
            <button className="btn primary" disabled={busy}>
              {busy ? 'Re-encrypting keys…' : 'Change password'}
            </button>
          </form>
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------ group chats --

/** Pick people by @username. Used for creating a group and adding to one. */
function PeoplePicker({ picked, setPicked, exclude = [] }: { picked: Profile[]; setPicked: (p: Profile[]) => void; exclude?: string[] }) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function add() {
    const name = username.replace(/^@/, '').trim().toLowerCase();
    if (!name) return;
    setError(null);
    const { data } = await supabase.rpc('find_user', { p_username: name });
    const user = (data as Profile[] | null)?.[0];
    if (!user) return setError(`Nobody has the username “${name}”.`);
    if (user.id === sessionStore.get().me?.id || exclude.includes(user.id)) return setError('They’re already in here.');
    if (!picked.some((p) => p.id === user.id)) {
      putProfile(user as Profile);
      setPicked([...picked, user as Profile]);
    }
    setUsername('');
  }
  return (
    <>
      <Field label="Add people by username" error={error}>
        <div className="copy-row">
          <input
            value={username}
            placeholder="@username"
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <button type="button" className="btn secondary" onClick={add}>
            Add
          </button>
        </div>
      </Field>
      {picked.length > 0 && (
        <div className="role-pills">
          {picked.map((p) => (
            <span key={p.id} className="role-pill">
              <Avatar profile={p} size={18} /> {p.display_name}
              <button type="button" className="pill-x" onClick={() => setPicked(picked.filter((x) => x.id !== p.id))}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </>
  );
}

export function NewGroupModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Profile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="New group chat" onClose={onClose}>
      <p className="muted small">Up to 10 people. Everything in the group is end-to-end encrypted.</p>
      {error && <div className="form-error">{error}</div>}
      <Field label="Group name (optional)">
        <input maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekend plans" />
      </Field>
      <PeoplePicker picked={picked} setPicked={setPicked} />
      <button
        className="btn primary full"
        disabled={!picked.length || busy}
        onClick={async () => {
          setBusy(true);
          const fallback = [sessionStore.get().me?.display_name, ...picked.map((p) => p.display_name)].filter(Boolean).join(', ');
          const { data, error } = await supabase.rpc('create_group', {
            p_members: picked.map((p) => p.id),
            p_name: name.trim() || fallback.slice(0, 100),
          });
          setBusy(false);
          if (error) return setError(errorMessage(error));
          openChannel('@me', data as string);
          onClose();
        }}
      >
        Create group{picked.length ? ` with ${picked.length + 1} people` : ''}
      </button>
    </Modal>
  );
}

export function GroupSettingsModal({ dm, onClose }: { dm: DmChannel; onClose: () => void }) {
  const [name, setName] = useState(dm.channel.name);
  const [picked, setPicked] = useState<Profile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const me = sessionStore.use((s) => s.me)!;
  return (
    <Modal title="Group settings" onClose={onClose}>
      {error && <div className="form-error">{error}</div>}
      <Field label="Group name">
        <div className="copy-row">
          <input maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          <button
            className="btn secondary"
            onClick={async () => {
              const { error } = await supabase.rpc('rename_group', { p_channel: dm.channel.id, p_name: name });
              setError(error ? errorMessage(error) : null);
              if (!error) onClose();
            }}
          >
            Save
          </button>
        </div>
      </Field>
      <div className="field-label">Members — {dm.members.length + 1}</div>
      <div className="group-members">
        {[me, ...dm.members].map((p) => (
          <div key={p.id} className="member">
            <Avatar profile={p} size={28} />
            <span className="member-name">{p.display_name}</span>
            {p.id === me.id && <span className="tag-soft accent">you</span>}
          </div>
        ))}
      </div>
      <PeoplePicker picked={picked} setPicked={setPicked} exclude={dm.members.map((m) => m.id)} />
      {picked.length > 0 && (
        <button
          className="btn primary full"
          onClick={async () => {
            const { error } = await supabase.rpc('add_group_members', { p_channel: dm.channel.id, p_members: picked.map((p) => p.id) });
            if (error) return setError(errorMessage(error));
            await sessionStore.get().keyring?.distribute(dm.channel.id);
            onClose();
          }}
        >
          Add {picked.length} {picked.length === 1 ? 'person' : 'people'}
        </button>
      )}
      <hr />
      <button
        className="btn danger"
        onClick={async () => {
          if (!confirm(`Leave “${dm.title}”? You won’t see new messages unless someone adds you back.`)) return;
          const { error } = await supabase.rpc('leave_group', { p_channel: dm.channel.id });
          if (error) return setError(errorMessage(error));
          openChannel('@me', '');
          onClose();
        }}
      >
        Leave group
      </button>
    </Modal>
  );
}
