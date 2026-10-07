import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase, errorMessage } from '../lib/supabase';
import { sessionStore } from '../lib/session';
import { displayName, getProfile, loadProfiles, putProfile } from '../lib/directory';
import { socialStore } from '../lib/social';
import type { Channel, DmChannel, Profile } from '../lib/types';
import { openChannel, openServer, type ServerData } from '../hooks/data';
import { Avatar, ColorPicker, Field, Icon, Modal, randomColor } from './ui';
import { Select } from './Select';
import { ImageCropper } from './ImageCropper';
import { askConfirm } from './Dialogs';
import { InviteFriendsList } from './Invite';
import { inviteCodeFrom, inviteUrl } from '../lib/dmSend';
import { PERMISSION_GROUPS, PERMISSION_INFO } from '../lib/permissions';

// ------------------------------------------------------ create/join server --

export const SERVER_TEMPLATES = [
  { id: 'default', emoji: '✨', name: 'Start from scratch', desc: 'A welcome channel, a chat and a voice channel.' },
  { id: 'gaming', emoji: '🎮', name: 'Gaming', desc: 'LFG, clips, guides forum, voice lobbies and a tournament stage.' },
  { id: 'friends', emoji: '🫶', name: 'Friends', desc: 'General, memes, photos, plans and a hangout call.' },
  { id: 'hangout', emoji: '🛋️', name: 'Hangout Server', desc: 'Introductions, music, pets, food and chill voice rooms.' },
  { id: 'school', emoji: '🎒', name: 'School Club', desc: 'Announcements, homework help, resources, Q&A forum, meeting stage.' },
  { id: 'community', emoji: '🏘️', name: 'Local Community', desc: 'Local news, events, marketplace, suggestions and a town hall.' },
  { id: 'creators', emoji: '🎨', name: 'Artists & Creators', desc: 'Showcase, work-in-progress, feedback forum, commissions, live workshop.' },
] as const;

const DISCOVERY_CATEGORIES = ['Gaming', 'Music', 'Art', 'Education', 'Science & Tech', 'Entertainment', 'Community', 'Anime', 'Sports', 'Creators'];

async function uploadServerPicture(serverId: string, kind: 'icon' | 'banner', blob: Blob) {
  const path = `${serverId}/${kind}-${crypto.randomUUID()}.webp`;
  const { error } = await supabase.storage.from('server-assets').upload(path, blob, { contentType: blob.type || 'image/webp', upsert: true });
  if (error) throw error;
  const url = supabase.storage.from('server-assets').getPublicUrl(path).data.publicUrl;
  const { error: e2 } = await supabase.from('servers').update(kind === 'icon' ? { icon_url: url } : { banner_url: url }).eq('id', serverId);
  if (e2) throw e2;
}

export function CreateJoinModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [step, setStep] = useState(0);
  const [template, setTemplate] = useState<string>('default');
  const [name, setName] = useState('');
  const [color, setColor] = useState(randomColor());
  const [icon, setIcon] = useState<{ blob: Blob; url: string } | null>(null);
  const [banner, setBanner] = useState<{ blob: Blob; url: string } | null>(null);
  const [cropping, setCropping] = useState<{ file: File; kind: 'icon' | 'banner' } | null>(null);
  const [description, setDescription] = useState('');
  const [apply, setApply] = useState(false);
  const [pitch, setPitch] = useState('');
  const [cats, setCats] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const me = sessionStore.use((s) => s.me)!;

  async function create() {
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc('create_server', { p_name: name.trim() || `${me.display_name}'s server`, p_icon_color: color, p_template: template });
    if (error) {
      setBusy(false);
      return setError(errorMessage(error));
    }
    const id = data as string;
    const problems: string[] = [];
    try {
      if (icon) await uploadServerPicture(id, 'icon', icon.blob);
      if (banner) await uploadServerPicture(id, 'banner', banner.blob);
    } catch (e) {
      problems.push(`pictures: ${errorMessage(e)}`);
    }
    if (description.trim()) await supabase.from('servers').update({ description: description.trim().slice(0, 300) }).eq('id', id);
    if (apply) {
      const { error: ae } = await supabase.rpc('apply_for_discovery', { p_server: id, p_pitch: pitch.trim(), p_categories: cats, p_language: navigator.language.split('-')[0] });
      if (ae) problems.push(`discovery: ${errorMessage(ae)}`);
    }
    setBusy(false);
    openServer(id);
    if (problems.length) alert(`Your server was created, but: ${problems.join('; ')}`);
    onClose();
  }

  async function join(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const raw = code.trim();
    const parsed = inviteCodeFrom(raw) ?? raw.replace(/\/+$/, '').split('/').pop() ?? raw;
    const { data, error } = await supabase.rpc('join_server', { p_code: parsed });
    setBusy(false);
    if (error) return setError(errorMessage(error));
    openServer(data as string);
    onClose();
  }

  const pick = (kind: 'icon' | 'banner') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => input.files?.[0] && setCropping({ file: input.files[0], kind });
    input.click();
  };

  return (
    <Modal title={tab === 'create' ? 'Create a server' : 'Join a server'} onClose={onClose} wide={tab === 'create' && step === 0}>
      {cropping && (
        <ImageCropper
          file={cropping.file}
          opts={cropping.kind === 'icon' ? { aspect: 1, size: 512, round: true, title: 'Server icon' } : { aspect: 16 / 9, size: 1280, title: 'Server banner' }}
          onCancel={() => setCropping(null)}
          onDone={(blob) => {
            const v = { blob, url: URL.createObjectURL(blob) };
            if (cropping.kind === 'icon') setIcon(v);
            else setBanner(v);
            setCropping(null);
          }}
        />
      )}
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
        <>
          <div className="steps" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span key={i} className={i <= step ? 'on' : ''} />
            ))}
          </div>
          {step === 0 && (
            <>
              <p className="muted">Pick a starting point. You can change every channel later.</p>
              <div className="template-grid" role="radiogroup" aria-label="Template">
                {SERVER_TEMPLATES.map((t) => (
                  <button key={t.id} type="button" role="radio" aria-checked={template === t.id} className={`template-card${template === t.id ? ' selected' : ''}`} onClick={() => setTemplate(t.id)}>
                    <span className="tpl-emoji">{t.emoji}</span>
                    <b>{t.name}</b>
                    <span className="tpl-desc">{t.desc}</span>
                  </button>
                ))}
              </div>
              <div className="modal-actions">
                <button className="btn primary" onClick={() => setStep(1)}>
                  Next
                </button>
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <div className="create-pictures">
                <button type="button" className={`pic-slot icon${icon ? ' has' : ''}`} style={icon ? { backgroundImage: `url(${icon.url})` } : { background: color }} onClick={() => pick('icon')} aria-label="Upload server icon">
                  <Icon name="upload" size={20} /> Icon
                </button>
                <button type="button" className={`pic-slot${banner ? ' has' : ''}`} style={banner ? { backgroundImage: `url(${banner.url})` } : undefined} onClick={() => pick('banner')} aria-label="Upload server banner">
                  <Icon name="image" size={20} /> Banner (optional)
                </button>
              </div>
              <Field label="Server name">
                <input autoFocus maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder={`${me.display_name}'s server`} />
              </Field>
              <Field label="Description" hint="Shown on invites and in discovery">
                <textarea maxLength={300} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's this server about?" />
              </Field>
              {!icon && (
                <Field label="Icon color">
                  <ColorPicker value={color} onChange={setColor} />
                </Field>
              )}
              <div className="modal-actions">
                <button className="btn secondary" onClick={() => setStep(0)}>
                  Back
                </button>
                <button className="btn primary" onClick={() => setStep(2)}>
                  Next
                </button>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <label className="check-row">
                <input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} /> <b>Apply for Server Discovery</b>
              </label>
              <p className="small muted">Venband staff review applications. Approved servers appear on the Discover page where anyone can find and join them.</p>
              {apply && (
                <>
                  <Field label="Why should people join?">
                    <textarea maxLength={1000} rows={3} value={pitch} onChange={(e) => setPitch(e.target.value)} placeholder="A friendly place for…" />
                  </Field>
                  <Field label="Categories" hint="up to 3">
                    <div className="chip-row">
                      {DISCOVERY_CATEGORIES.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className={`chip${cats.includes(c) ? ' on' : ''}`}
                          aria-pressed={cats.includes(c)}
                          onClick={() => setCats((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c].slice(0, 3)))}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  </Field>
                </>
              )}
              <div className="modal-actions">
                <button className="btn secondary" onClick={() => setStep(1)}>
                  Back
                </button>
                <button className="btn primary" disabled={busy} onClick={create}>
                  {busy ? 'Creating…' : 'Create server'}
                </button>
              </div>
            </>
          )}
        </>
      ) : (
        <form onSubmit={join}>
          <p className="muted">Enter an invite code or link, like venband.com/invite/abc123 or a custom link.</p>
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
    supabase.rpc('create_invite', { p_server: serverId, p_max_uses: maxUses, p_expires_in_hours: hours, p_min_account_days: 0, p_label: null }).then(({ data, error }) => {
      if (error) setError(errorMessage(error));
      else setCode(data as string);
    });
  }, [serverId, hours, maxUses]);

  const link = code ? inviteUrl(code) : '';
  return (
    <Modal title={`Invite friends to ${serverName}`} onClose={onClose}>
      {error && <div className="form-error">{error}</div>}
      <InviteFriendsList serverId={serverId} serverName={serverName} />
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
          <Select
            value={hours == null ? '' : String(hours)}
            onChange={(v) => setHours(v ? Number(v) : null)}
            options={[
              { value: '0.5', label: '30 minutes' },
              { value: '1', label: '1 hour' },
              { value: '6', label: '6 hours' },
              { value: '12', label: '12 hours' },
              { value: '24', label: '1 day' },
              { value: String(24 * 7), label: '7 days' },
              { value: '', label: 'Never' },
            ]}
          />
        </Field>
        <Field label="Max uses">
          <Select
            value={maxUses == null ? '' : String(maxUses)}
            onChange={(v) => setMaxUses(v ? Number(v) : null)}
            options={[
              { value: '', label: 'No limit' },
              { value: '1', label: '1 use' },
              { value: '5', label: '5 uses' },
              { value: '10', label: '10 uses' },
              { value: '25', label: '25 uses' },
              { value: '50', label: '50 uses' },
              { value: '100', label: '100 uses' },
            ]}
          />
        </Field>
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------- channels --

/** Every category in a server: ones that hold channels plus empty ones the server saved. */
export function serverCategories(data: ServerData): string[] {
  const out: string[] = [];
  for (const c of data.channels) if (c.category && !out.includes(c.category)) out.push(c.category);
  for (const c of data.server?.categories ?? []) if (!out.includes(c)) out.push(c);
  return out;
}

export async function createCategory(data: ServerData, name: string) {
  const clean = name.trim().slice(0, 100);
  if (!clean) return;
  const current = data.server?.categories ?? [];
  if (serverCategories(data).includes(clean)) return;
  const { error } = await supabase.from('servers').update({ categories: [...current, clean] }).eq('id', data.server!.id);
  if (error) throw error;
  data.reload();
}

export type NewChannelType = 'text' | 'voice' | 'forum' | 'announcement' | 'stage';

export const CHANNEL_TYPES: { id: NewChannelType; label: string; icon: string; desc: string }[] = [
  { id: 'text', label: 'Text', icon: 'hash', desc: 'Encrypted messages, files, threads and polls' },
  { id: 'voice', label: 'Voice', icon: 'speaker', desc: 'Encrypted voice, video, screen share and a side chat' },
  { id: 'forum', label: 'Forum', icon: 'thread', desc: 'Posts with tags; each post is its own discussion' },
  { id: 'announcement', label: 'Announcement', icon: 'megaphone', desc: 'Everyone reads, only moderators post' },
  { id: 'stage', label: 'Stage', icon: 'stage', desc: 'Speakers talk, the audience listens and raises hands' },
];

export function CreateChannelModal({
  data,
  onClose,
  initialCategory,
  initialType = 'text',
}: {
  data: ServerData;
  onClose: () => void;
  initialCategory?: string;
  initialType?: NewChannelType;
}) {
  const categories = serverCategories(data);
  const [type, setType] = useState<NewChannelType>(initialType);
  const [name, setName] = useState('');
  const [category, setCategory] = useState(initialCategory ?? categories.find((c) => /text/i.test(c)) ?? categories[0] ?? '');
  const [newCategory, setNewCategory] = useState('');
  const [isPrivate, setPrivate] = useState(false);
  const [roles, setRoles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const NEW = '__new__';

  async function submit(e: FormEvent) {
    e.preventDefault();
    const clean = type === 'text' || type === 'forum' || type === 'announcement' ? name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '') : name.trim();
    if (!clean) return setError('Name required');
    const cat = category === NEW ? newCategory.trim().slice(0, 100) : category;
    if (category === NEW && !cat) return setError('Name the new category');
    setBusy(true);
    // choose the id here and don't ask for the row back: the "can you see this
    // channel" check can't see a row inserted by the same statement yet
    const id = crypto.randomUUID();
    const { error } = await supabase.from('channels').insert({
      id,
      server_id: data.server!.id,
      type,
      name: clean,
      category: cat,
      is_private: isPrivate,
      position: data.channels.length,
    });
    if (error) {
      setBusy(false);
      return setError(errorMessage(error));
    }
    if (isPrivate && roles.length) {
      await supabase.from('channel_role_access').insert(roles.map((role_id) => ({ channel_id: id, role_id })));
    }
    if (category === NEW && cat && !(data.server?.categories ?? []).includes(cat)) {
      await supabase.from('servers').update({ categories: [...(data.server?.categories ?? []), cat] }).eq('id', data.server!.id);
    }
    await sessionStore.get().keyring!.ensure(id).catch(() => {});
    data.reload();
    openChannel(data.server!.id, id);
    onClose();
  }

  return (
    <Modal title="Create Channel" onClose={onClose}>
      <form onSubmit={submit}>
        {error && <div className="form-error">{error}</div>}
        <div className="type-picker">
          {CHANNEL_TYPES.map((t) => (
            <label key={t.id} className={`type-option${type === t.id ? ' selected' : ''}`}>
              <input type="radio" checked={type === t.id} onChange={() => setType(t.id)} />
              <Icon name={t.icon} />
              <div>
                <b>{t.label}</b>
                <div className="small muted">{t.desc}</div>
              </div>
            </label>
          ))}
        </div>
        <Field label="Channel name">
          <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder={type === 'text' ? 'new-channel' : 'Lounge'} />
        </Field>
        <Field label="Category">
          <Select
            value={category}
            onChange={setCategory}
            options={[{ value: '', label: 'No category' }, ...categories.map((c) => ({ value: c, label: c })), { value: NEW, label: '+ New category…' }]}
          />
        </Field>
        {category === NEW && (
          <Field label="New category name">
            <input autoFocus maxLength={100} value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Gaming" />
          </Field>
        )}
        <PrivateToggle data={data} isPrivate={isPrivate} setPrivate={setPrivate} roles={roles} setRoles={setRoles} />
        <button className="btn primary full" disabled={busy}>
          {busy ? 'Creating…' : 'Create Channel'}
        </button>
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

type OverwriteTri = 0 | 1 | 2;

/** Allow / Deny / Unset tri-state for one permission bit in a channel overwrite. */
function OverTri({ value, onChange }: { value: OverwriteTri; onChange: (v: OverwriteTri) => void }) {
  const opts: { v: OverwriteTri; label: string; title: string }[] = [
    { v: 0, label: 'Unset', title: 'Unset (inherit from roles)' },
    { v: 1, label: 'Allow', title: 'Allow this permission here' },
    { v: 2, label: 'Deny', title: 'Deny this permission here' },
  ];
  return (
    <span className="over-tri">
      {opts.map((o) => (
        <button key={o.v} type="button" title={o.title} className={value === o.v ? 'on' : ''} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </span>
  );
}

/**
 * Per-role / per-member allow & deny matrix for one scope (a channel or a whole
 * category). Saves into `channel_overwrites` and reloads the server data.
 */
function ChannelPermissionsEditor({
  data,
  scope,
  onDone,
}: {
  data: ServerData;
  scope: { channelId?: string; category?: string };
  onDone?: () => void;
}) {
  const serverId = data.server!.id;
  const existing = useMemo(() => data.overwritesFor({ channelId: scope.channelId ?? '', category: scope.category }), [data, scope.channelId, scope.category]);
  const [targets, setTargets] = useState<Record<string, { role: boolean; tri: Record<number, OverwriteTri> }>>(() => {
    const init: Record<string, { role: boolean; tri: Record<number, OverwriteTri> }> = {};
    for (const o of existing) {
      const tri: Record<number, OverwriteTri> = {};
      for (const p of PERMISSION_INFO) tri[p.bit] = (o.allow & p.bit) > 0 ? 1 : (o.deny & p.bit) > 0 ? 2 : 0;
      init[`${o.target_type}:${o.target_id}`] = { role: o.target_type === 'role', tri };
    }
    return init;
  });
  const [addRole, setAddRole] = useState('');
  const [memberQuery, setMemberQuery] = useState('');
  const [memberResults, setMemberResults] = useState<Profile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roleById = useMemo(() => new Map(data.roles.map((r) => [r.id, r])), [data.roles]);

  const setTri = (key: string, bit: number, v: OverwriteTri) =>
    setTargets((t) => ({ ...t, [key]: { ...t[key], tri: { ...t[key].tri, [bit]: v } } }));

  const removeTarget = (key: string) =>
    setTargets((t) => {
      const next = { ...t };
      delete next[key];
      return next;
    });

  async function searchMember(q: string) {
    setMemberQuery(q);
    if (!q.trim()) return setMemberResults([]);
    const { data: found } = await supabase.rpc('find_user', { p_username: q.trim() });
    const memberIds = new Set(data.members.map((m) => m.user_id));
    setMemberResults(((found as Profile[] | null) ?? []).filter((p) => memberIds.has(p.id)).slice(0, 8));
  }

  function addMember(id: string) {
    const key = `member:${id}`;
    setTargets((t) => (t[key] ? t : { ...t, [key]: { role: false, tri: {} } }));
    setMemberQuery('');
    setMemberResults([]);
  }

  function addRoleTarget() {
    if (!addRole) return;
    const key = `role:${addRole}`;
    setTargets((t) => (t[key] ? t : { ...t, [key]: { role: true, tri: {} } }));
    setAddRole('');
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const toWrite: {
        server_id: string;
        channel_id: string | null;
        category: string | null;
        target_type: 'role' | 'member';
        target_id: string;
        allow: number;
        deny: number;
      }[] = [];
      for (const [key, t] of Object.entries(targets)) {
        const [type, id] = key.split(':');
        let allow = 0;
        let deny = 0;
        for (const p of PERMISSION_INFO) {
          const v = t.tri[p.bit];
          if (v === 1) allow |= p.bit;
          else if (v === 2) deny |= p.bit;
        }
        if (allow | deny) {
          toWrite.push({
            server_id: serverId,
            channel_id: scope.channelId ?? null,
            category: scope.channelId ? null : (scope.category ?? ''),
            target_type: type === 'member' ? 'member' : 'role',
            target_id: id,
            allow,
            deny,
          });
        }
      }
      const writeKeys = new Set(toWrite.map((w) => `${w.target_type}:${w.target_id}`));
      const delIds = existing.filter((o) => !writeKeys.has(`${o.target_type}:${o.target_id}`)).map((o) => o.id);
      if (delIds.length) await supabase.from('channel_overwrites').delete().in('id', delIds);
      if (toWrite.length) {
        const { error: e } = await supabase.from('channel_overwrites').insert(toWrite);
        if (e) throw e;
      }
      data.reload();
      onDone?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="over-editor">
      {error && <div className="form-error">{error}</div>}
      {Object.keys(targets).length === 0 && (
        <p className="muted">No overrides here yet — everyone uses the server-wide permissions. Add a role or member to customize.</p>
      )}
      <div className="over-add">
        <Select
          value={addRole}
          onChange={setAddRole}
          options={data.roles
            .filter((r) => !r.is_default && !targets[`role:${r.id}`])
            .map((r) => ({ value: r.id, label: r.name }))}
        />
        <button type="button" className="btn" disabled={!addRole} onClick={addRoleTarget}>
          Add role override
        </button>
      </div>
      <div className="over-member-add">
        <input value={memberQuery} onChange={(e) => searchMember(e.target.value)} placeholder="Add a member by username…" />
      </div>
      {memberResults.length > 0 && (
        <div className="over-member-results">
          {memberResults
            .filter((p) => !targets[`member:${p.id}`])
            .map((p) => (
              <button type="button" key={p.id} onClick={() => addMember(p.id)}>
                <Avatar profile={p} size={24} /> {displayName(p.id)}
              </button>
            ))}
        </div>
      )}
      <div className="over-targets">
        {Object.entries(targets).map(([key, t]) => {
          const [type, id] = key.split(':');
          const role = type === 'role' ? roleById.get(id) : null;
          const profile = type === 'member' ? getProfile(id) : null;
          return (
            <section className="over-target" key={key}>
              <div className="over-target-head">
                {role ? <span className="role-dot" style={{ background: role.color }} /> : <Avatar profile={profile} size={22} />}
                <b>{role ? role.name : (profile?.display_name ?? 'Member')}</b>
                <span className="muted small">{type === 'role' ? 'role override' : 'member override'}</span>
                <button type="button" className="icon-btn" title="Remove this override" onClick={() => removeTarget(key)} style={{ marginLeft: 'auto' }}>
                  <Icon name="x" />
                </button>
              </div>
              <div className="over-list">
                {PERMISSION_GROUPS.map((g) => {
                  const bits = PERMISSION_INFO.filter((p) => p.group === g);
                  if (!bits.length) return null;
                  return (
                    <div key={g} className="over-group">
                      <div className="over-group-title">{g}</div>
                      {bits.map((p) => (
                        <label key={p.bit} className="over-row">
                          <div className="over-name">
                            {p.name}
                            <span className="muted small">{p.description}</span>
                          </div>
                          <OverTri value={t.tri[p.bit] ?? 0} onChange={(v) => setTri(key, p.bit, v)} />
                        </label>
                      ))}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <div className="modal-actions">
        <button type="button" className="btn primary" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save Permissions'}
        </button>
      </div>
    </div>
  );
}

export function ChannelSettingsModal({ channel, data, onClose }: { channel: Channel; data: ServerData; onClose: () => void }) {
  const isVoice = channel.type === 'voice' || channel.type === 'stage';
  const [tab, setTab] = useState<'overview' | 'permissions'>('overview');
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic);
  const [category, setCategory] = useState(channel.category);
  const [position, setPosition] = useState(channel.position);
  const [isPrivate, setPrivate] = useState(channel.is_private);
  const initialRoles = data.channelAccess.filter((a) => a.channel_id === channel.id).map((a) => a.role_id);
  const [roles, setRoles] = useState<string[]>(initialRoles);
  const [settings, setSettings] = useState(channel.settings ?? {});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    const update: Record<string, unknown> = { name: name.trim(), topic, category, position, is_private: isPrivate };
    if (isVoice) update.settings = { ...(channel.settings ?? {}), user_limit: Math.max(0, settings.user_limit ?? 0) || null, bitrate: Math.min(384, Math.max(8, settings.bitrate ?? 64)) || null };
    const { error } = await supabase.from('channels').update(update).eq('id', channel.id);
    if (error) return setError(errorMessage(error));
    const removed = initialRoles.filter((r) => !roles.includes(r));
    const added = roles.filter((r) => !initialRoles.includes(r));
    if (removed.length) await supabase.from('channel_role_access').delete().eq('channel_id', channel.id).in('role_id', removed);
    if (added.length) await supabase.from('channel_role_access').insert(added.map((role_id) => ({ channel_id: channel.id, role_id })));
    data.reload();
    setSaved(true);
    setTimeout(onClose, 700);
  }

  async function remove() {
    if (!(await askConfirm({ title: `Delete #${channel.name}`, body: 'All of its encrypted messages are deleted too.', confirm: 'Delete Channel', danger: true }))) return;
    const { error } = await supabase.from('channels').delete().eq('id', channel.id);
    if (error) return setError(errorMessage(error));
    onClose();
  }

  return (
    <Modal wide title={`Edit ${channel.type === 'voice' || channel.type === 'stage' ? 'channel' : '#'} ${channel.name}`} onClose={onClose}>
      <div className="tabs">
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>
          Overview
        </button>
        <button className={tab === 'permissions' ? 'active' : ''} onClick={() => setTab('permissions')}>
          Permissions
        </button>
      </div>
      {saved ? (
        <p className="muted center">Saved.</p>
      ) : tab === 'overview' ? (
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
          {isVoice && (
            <div className="row">
              <Field label="User limit (0 = no limit)">
                <input
                  type="number"
                  min={0}
                  max={250}
                  value={settings.user_limit ?? 0}
                  onChange={(e) => setSettings((s) => ({ ...s, user_limit: Number(e.target.value) }))}
                />
              </Field>
              <Field label="Bitrate (kbps)">
                <input
                  type="number"
                  min={8}
                  max={384}
                  value={settings.bitrate ?? 64}
                  onChange={(e) => setSettings((s) => ({ ...s, bitrate: Number(e.target.value) }))}
                />
              </Field>
            </div>
          )}
          <div className="row">
            <Field label="Category">
              <Select value={category} onChange={setCategory} options={[{ value: '', label: 'No category' }, ...serverCategories(data).map((c) => ({ value: c, label: c }))]} />
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
      ) : (
        <ChannelPermissionsEditor data={data} scope={{ channelId: channel.id }} />
      )}
    </Modal>
  );
}

export function CategorySettingsModal({ category, data, onClose }: { category: string; data: ServerData; onClose: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(category);
  const [error, setError] = useState<string | null>(null);
  const affected = data.channels.filter((c) => c.category === category).length;

  async function rename(e: FormEvent) {
    e.preventDefault();
    const next = name.trim();
    if (!next || next === category) return onClose();
    const { error: e1 } = await supabase.from('channels').update({ category: next }).eq('server_id', data.server!.id).eq('category', category);
    if (e1) return setError(errorMessage(e1));
    const { error: e2 } = await supabase
      .from('servers')
      .update({ categories: (data.server?.categories ?? []).map((c) => (c === category ? next : c)) })
      .eq('id', data.server!.id);
    if (e2) return setError(errorMessage(e2));
    data.reload();
    onClose();
  }

  async function remove() {
    if (!(await askConfirm({ title: `Delete category ${category}`, body: 'Channels stay but become uncategorized. Permissions for this category are removed.', confirm: 'Delete Category', danger: true }))) return;
    const { error } = await supabase.from('servers').update({ categories: (data.server?.categories ?? []).filter((c) => c !== category) }).eq('id', data.server!.id);
    if (error) return setError(errorMessage(error));
    data.reload();
    onClose();
  }

  return (
    <Modal wide title={`Category — ${category}`} onClose={onClose}>
      <div className="tabs">
        <button className={renaming ? '' : 'active'} onClick={() => setRenaming(false)}>
          Permissions
        </button>
        <button className={renaming ? 'active' : ''} onClick={() => setRenaming(true)}>
          Rename
        </button>
      </div>
      {error && <div className="form-error">{error}</div>}
      {renaming ? (
        <form className="row" onSubmit={rename}>
          <Field label="Category name">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </Field>
          <button className="btn primary">Save</button>
        </form>
      ) : (
        <>
          <p className="muted">Changes apply to the {affected} channel{affected === 1 ? '' : 's'} in this category, unless a channel has its own override.</p>
          <ChannelPermissionsEditor data={data} scope={{ category }} onDone={() => setRenaming(false)} />
          <div className="modal-actions">
            <button type="button" className="btn danger" onClick={remove}>
              Delete Category
            </button>
          </div>
        </>
      )}
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

/** Friends and people you have a DM with, for the add list. */
function useKnownPeople(): Profile[] {
  const friends = socialStore.use((s) => s.friends);
  const meId = sessionStore.use((s) => s.me?.id);
  const friendIds = useMemo(
    () => Object.values(friends).filter((f) => f.accepted).map((f) => f.other).sort().join(','),
    [friends],
  );
  const [people, setPeople] = useState<Profile[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: parts } = await supabase.from('dm_participants').select('channel_id, user_id');
      const byChannel = new Map<string, string[]>();
      for (const p of parts ?? []) byChannel.set(p.channel_id, [...(byChannel.get(p.channel_id) ?? []), p.user_id]);
      const channelIds = [...byChannel.keys()];
      const { data: chans } = channelIds.length ? await supabase.from('channels').select('id, is_group').in('id', channelIds) : { data: [] };
      const direct = ((chans ?? []) as { id: string; is_group: boolean }[]).filter((c) => !c.is_group).map((c) => c.id);
      const fromDms = direct.flatMap((id) => byChannel.get(id) ?? []);
      const ids = [...new Set([...friendIds.split(',').filter(Boolean), ...fromDms])].filter((id) => id !== meId);
      await loadProfiles(ids);
      if (cancelled) return;
      const list = ids.map((id) => getProfile(id)).filter(Boolean) as Profile[];
      list.sort((a, b) => displayName(a.id).localeCompare(displayName(b.id)));
      setPeople(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [friendIds, meId]);

  return people;
}

/** Pick people from your friends and DMs, or add someone by username. Used for creating a group and adding to one. */
function PeoplePicker({ picked, setPicked, exclude = [] }: { picked: Profile[]; setPicked: (p: Profile[]) => void; exclude?: string[] }) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const known = useKnownPeople();
  const query = username.replace(/^@+/, '').trim().toLowerCase();
  const rows = known.filter((p) => !query || displayName(p.id).toLowerCase().includes(query) || p.username.toLowerCase().includes(query));

  function pick(user: Profile) {
    putProfile(user);
    setPicked([...picked, user]);
  }

  function toggle(user: Profile) {
    if (picked.some((p) => p.id === user.id)) setPicked(picked.filter((p) => p.id !== user.id));
    else pick(user);
  }

  async function add() {
    const name = username.replace(/^@+/, '').trim().toLowerCase();
    if (!name) return;
    setError(null);
    const { data } = await supabase.rpc('find_user', { p_username: name });
    const user = (data as Profile[] | null)?.[0];
    if (!user) return setError(`Nobody has the username “${name}”.`);
    if (user.id === sessionStore.get().me?.id || exclude.includes(user.id)) return setError('They’re already in here.');
    if (!picked.some((p) => p.id === user.id)) pick(user as Profile);
    setUsername('');
  }

  return (
    <>
      <Field label="Add people" error={error}>
        <div className="copy-row">
          <input
            value={username}
            placeholder="Search friends or type a username"
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
      <div style={{ maxHeight: 240, overflowY: 'auto', marginBottom: 12 }}>
        {rows.map((p) => {
          const isPicked = picked.some((x) => x.id === p.id);
          const locked = exclude.includes(p.id);
          return (
            <div key={p.id} className="member">
              <Avatar profile={p} size={32} />
              <div className="member-text">
                <span className="member-name">{displayName(p.id)}</span>
                <span className="member-status">@{p.username}</span>
              </div>
              <button
                type="button"
                className={`btn small ${isPicked ? 'secondary' : 'primary'}`}
                disabled={locked}
                title={isPicked ? 'Click to remove' : undefined}
                onClick={() => toggle(p)}
              >
                {locked ? 'In group' : isPicked ? 'Added' : 'Add'}
              </button>
            </div>
          );
        })}
        {!rows.length && (
          <p className="muted small">{query ? 'No matches. Press Enter to add by exact username.' : 'No friends or chats yet. Type a username above.'}</p>
        )}
      </div>
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
      <p className="muted small">Up to 15 people. Everything in the group is end-to-end encrypted.</p>
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
  const [link, setLink] = useState<string | null>(null);
  const me = sessionStore.use((s) => s.me)!;
  const friends = socialStore.use((s) => s.friends);
  const owner = dm.channel.owner_id ?? null;
  const isOwner = owner === me.id;
  const inGroup = new Set([me.id, ...dm.members.map((m) => m.id)]);
  const full = inGroup.size >= 15;
  const addable = Object.values(friends)
    .filter((f) => f.accepted && !inGroup.has(f.other))
    .map((f) => getProfile(f.other))
    .filter((p): p is Profile => Boolean(p));
  const add = async (ids: string[]) => {
    const { error } = await supabase.rpc('add_group_members', { p_channel: dm.channel.id, p_members: ids });
    if (error) return setError(errorMessage(error));
    await sessionStore.get().keyring?.distribute(dm.channel.id);
    setError(null);
  };
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
      <div className="field-label">Members — {dm.members.length + 1} / 15</div>
      <div className="group-members">
        {[me, ...dm.members].map((p) => (
          <div key={p.id} className="member">
            <Avatar profile={p} size={28} />
            <span className="member-name grow">
              {p.display_name}
              {p.id === owner && (
                <span className="owner-crown" title="Group owner">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="#ffd60a">
                    <path d="M3 18h18l-2-11-5 4-2-6-2 6-5-4z" />
                  </svg>
                </span>
              )}
            </span>
            {p.id === me.id && <span className="tag-soft accent">you</span>}
            {isOwner && p.id !== me.id && (
              <>
                <button
                  className="btn link small"
                  onClick={async () => {
                    if (!(await askConfirm({ title: `Make ${p.display_name} the owner?`, body: 'They’ll be able to remove people. You stay in the group.', confirm: 'Make owner' }))) return;
                    const { error } = await supabase.rpc('transfer_group', { p_channel: dm.channel.id, p_user: p.id });
                    setError(error ? errorMessage(error) : null);
                    if (!error) onClose();
                  }}
                >
                  Make owner
                </button>
                <button
                  className="btn link small danger-text"
                  onClick={async () => {
                    if (!(await askConfirm({ title: `Remove ${p.display_name}?`, body: 'They stop getting new messages. The group’s key is changed so they can’t read anything new.', confirm: 'Remove', danger: true }))) return;
                    const { error } = await supabase.rpc('remove_group_member', { p_channel: dm.channel.id, p_user: p.id });
                    setError(error ? errorMessage(error) : null);
                    if (!error) onClose();
                  }}
                >
                  Remove
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      {addable.length > 0 && !full && (
        <>
          <div className="field-label">Add friends</div>
          <div className="group-members add-friends">
            {addable.slice(0, 50).map((p) => (
              <div key={p.id} className="member">
                <Avatar profile={p} size={28} />
                <span className="member-name grow">{p.display_name}</span>
                <button className="btn secondary small" onClick={() => add([p.id])}>
                  Add to {dm.title.length > 18 ? 'group' : dm.title}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      <PeoplePicker picked={picked} setPicked={setPicked} exclude={dm.members.map((m) => m.id)} />
      {picked.length > 0 && (
        <button className="btn primary full" onClick={() => add(picked.map((p) => p.id)).then(() => setPicked([]))}>
          Add {picked.length} {picked.length === 1 ? 'person' : 'people'}
        </button>
      )}
      <Field label="Invite link" hint="For people who aren’t your friends yet. Works for 7 days.">
        {link ? (
          <div className="copy-row">
            <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Group invite link" />
            <button className="btn primary" onClick={() => navigator.clipboard.writeText(link)}>
              Copy
            </button>
          </div>
        ) : (
          <button
            className="btn secondary"
            disabled={full}
            onClick={async () => {
              const { data, error } = await supabase.rpc('create_group_invite', { p_channel: dm.channel.id });
              if (error) return setError(errorMessage(error));
              setLink(`${window.location.origin}${import.meta.env.BASE_URL}join-group/${data as string}`);
            }}
          >
            {full ? 'The group is full' : 'Create invite link'}
          </button>
        )}
      </Field>
      <hr />
      <button
        className="btn danger"
        onClick={async () => {
          if (!(await askConfirm({ title: `Leave ${dm.title}`, body: 'You won’t see new messages unless someone adds you back.', confirm: 'Leave Group', danger: true }))) return;
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