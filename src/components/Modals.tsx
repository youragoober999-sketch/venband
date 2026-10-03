import { useEffect, useState, type FormEvent } from 'react';
import { supabase, appUrl, errorMessage } from '../lib/supabase';
import { sessionStore } from '../lib/session';
import { loadProfiles, putProfile } from '../lib/directory';
import type { Channel, DmChannel, Profile } from '../lib/types';
import { openChannel, openServer, type ServerData } from '../hooks/data';
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
