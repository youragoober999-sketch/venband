import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase, errorMessage } from '../lib/supabase';
import { sessionStore } from '../lib/session';
import {
  displayName,
  getProfile,
  loadProfiles,
  putProfile,
} from '../lib/directory';
import { socialStore } from '../lib/social';
import type { Channel, DmChannel, Profile } from '../lib/types';
import { openChannel, openServer, type ServerData } from '../hooks/data';
import {
  Avatar,
  ColorPicker,
  Field,
  Icon,
  Modal,
  randomColor,
} from './ui';
import { Select } from './Select';
import { ImageCropper } from './ImageCropper';
import { askConfirm, showAlert } from './Dialogs';
import { InviteFriendsList } from './Invite';
import { inviteCodeFrom, inviteUrl } from '../lib/dmSend';
import { OwnerCrown } from './Badges';
import { PERMISSION_GROUPS, PERMISSION_INFO } from '../lib/permissions';
import { CommunityTemplatePicker } from './ServerTemplates';

// ------------------------------------------------------ create/join server --

const DEFAULT_SERVER_TEMPLATE = 'default';

export const SERVER_TEMPLATES = [
  { id: 'default', emoji: '✨', name: 'Start from scratch', desc: 'A welcome channel, a chat and a voice channel.' },
  { id: 'gaming', emoji: '🎮', name: 'Gaming', desc: 'LFG, clips, guides forum, voice lobbies and a tournament stage.' },
  { id: 'friends', emoji: '🫶', name: 'Friends', desc: 'General, memes, photos, plans and a hangout call.' },
  { id: 'hangout', emoji: '🛋️', name: 'Hangout Server', desc: 'Introductions, music, pets, food and chill voice rooms.' },
  { id: 'school', emoji: '🎒', name: 'School Club', desc: 'Announcements, homework help, resources, Q&A forum, meeting stage.' },
  { id: 'community', emoji: '🏘️', name: 'Local Community', desc: 'Local news, events, marketplace, suggestions and a town hall.' },
  { id: 'creators', emoji: '🎨', name: 'Artists & Creators', desc: 'Showcase, work-in-progress, feedback forum, commissions, live workshop.' },
] as const;

const DISCOVERY_CATEGORIES = [
  'Gaming',
  'Music',
  'Art',
  'Education',
  'Science & Tech',
  'Entertainment',
  'Community',
  'Anime',
  'Sports',
  'Creators',
];

type ServerPicture = {
  blob: Blob;
  url: string;
};

async function uploadServerPicture(
  serverId: string,
  kind: 'icon' | 'banner',
  blob: Blob,
): Promise<void> {
  if (blob.size > 8 * 1024 * 1024) {
    throw new Error('Images must be smaller than 8 MB.');
  }

  const extension =
    blob.type === 'image/png'
      ? 'png'
      : blob.type === 'image/jpeg'
        ? 'jpg'
        : 'webp';

  const path = `${serverId}/${kind}-${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from('server-assets')
    .upload(path, blob, {
      contentType: blob.type || 'image/webp',
      upsert: false,
    });

  if (uploadError) throw uploadError;

  const publicUrl = supabase.storage
    .from('server-assets')
    .getPublicUrl(path).data.publicUrl;

  const update =
    kind === 'icon'
      ? { icon_url: publicUrl }
      : { banner_url: publicUrl };

  const { error: updateError } = await supabase
    .from('servers')
    .update(update)
    .eq('id', serverId);

  if (updateError) throw updateError;
}

export function CreateJoinModal({
  onClose,
  initialTemplate,
}: {
  onClose: () => void;
  /** a shared template's code (venband.com/template/CODE) */
  initialTemplate?: string;
}) {
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [step, setStep] = useState(0);
  // built-in layout, or a shared template's code instead
  const [template, setTemplate] = useState<string>(DEFAULT_SERVER_TEMPLATE);
  const [communityCode, setCommunityCode] = useState<string | null>(initialTemplate ?? null);
  const [showCommunity, setShowCommunity] = useState(Boolean(initialTemplate));

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(randomColor());

  const [icon, setIcon] = useState<ServerPicture | null>(null);
  const [banner, setBanner] = useState<ServerPicture | null>(null);

  const [cropping, setCropping] = useState<{
    file: File;
    kind: 'icon' | 'banner';
  } | null>(null);

  const [apply, setApply] = useState(false);
  const [pitch, setPitch] = useState('');
  const [cats, setCats] = useState<string[]>([]);

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const me = sessionStore.use((s) => s.me)!;

  useEffect(() => {
    return () => {
      if (icon?.url) URL.revokeObjectURL(icon.url);
      if (banner?.url) URL.revokeObjectURL(banner.url);
    };
  }, [icon?.url, banner?.url]);

  function choosePicture(kind: 'icon' | 'banner') {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;

      if (!file.type.startsWith('image/')) {
        setError('Please choose an image file.');
        return;
      }

      if (file.size > 8 * 1024 * 1024) {
        setError('Choose an image smaller than 8 MB.');
        return;
      }

      setError(null);
      setCropping({ file, kind });
    };

    input.click();
  }

  function finishCrop(blob: Blob) {
    if (!cropping) return;

    const picture: ServerPicture = {
      blob,
      url: URL.createObjectURL(blob),
    };

    if (cropping.kind === 'icon') {
      setIcon(picture);
    } else {
      setBanner(picture);
    }

    setCropping(null);
  }

  function toggleCategory(category: string) {
    setCats((current) => {
      if (current.includes(category)) {
        return current.filter((item) => item !== category);
      }

      if (current.length >= 3) return current;

      return [...current, category];
    });
  }

  async function create() {
    const serverName = name.trim() || `${me.display_name}'s server`;

    if (serverName.length < 2) {
      setError('Your server name must contain at least 2 characters.');
      setStep(0);
      return;
    }

    if (apply && pitch.trim().length < 10) {
      setError(
        'Write at least 10 characters explaining why people should join.',
      );
      return;
    }

    if (apply && cats.length === 0) {
      setError('Choose at least one discovery category.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const result = communityCode
        ? await supabase.rpc('create_server_from_template', {
            p_code: communityCode,
            p_name: serverName,
            p_icon_color: color,
          })
        : await supabase.rpc('create_server', {
            p_name: serverName,
            p_icon_color: color,
            p_template: template,
          });

      if (result.error) throw result.error;

      const serverId = result.data as string;

      if (!serverId) {
        throw new Error('The database did not return the new server ID.');
      }

      const warnings: string[] = [];

      if (icon) {
        try {
          await uploadServerPicture(serverId, 'icon', icon.blob);
        } catch (pictureError) {
          warnings.push(
            `Icon upload failed: ${errorMessage(pictureError)}`,
          );
        }
      }

      if (banner) {
        try {
          await uploadServerPicture(serverId, 'banner', banner.blob);
        } catch (pictureError) {
          warnings.push(
            `Banner upload failed: ${errorMessage(pictureError)}`,
          );
        }
      }

      if (description.trim()) {
        const { error: descriptionError } = await supabase
          .from('servers')
          .update({
            description: description.trim().slice(0, 300),
          })
          .eq('id', serverId);

        if (descriptionError) {
          warnings.push(
            `Description was not saved: ${errorMessage(descriptionError)}`,
          );
        }
      }

      if (apply) {
        const { error: discoveryError } = await supabase.rpc(
          'apply_for_discovery',
          {
            p_server: serverId,
            p_pitch: pitch.trim(),
            p_categories: cats,
            p_language: navigator.language.split('-')[0] || 'en',
          },
        );

        if (discoveryError) {
          warnings.push(
            `Discovery application failed: ${errorMessage(discoveryError)}`,
          );
        }
      }

      openServer(serverId);

      if (warnings.length > 0) {
        showAlert(
          `Your server was created, but some optional steps failed:\n\n${warnings.join('\n')}`,
        );
      }

      onClose();
    } catch (creationError) {
      setError(errorMessage(creationError));
    } finally {
      setBusy(false);
    }
  }

  async function join(e: FormEvent) {
    e.preventDefault();

    const raw = code.trim();

    if (!raw) {
      setError('Enter an invite code or link.');
      return;
    }

    const parsed =
      inviteCodeFrom(raw) ??
      raw.replace(/\/+$/, '').split('/').pop() ??
      raw;

    if (!parsed) {
      setError('That invite code does not look valid.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const { data, error: joinError } = await supabase.rpc('join_server', {
        p_code: parsed,
      });

      if (joinError) throw joinError;
      if (!data) throw new Error('The server could not be opened.');

      openServer(data as string);
      onClose();
    } catch (joinError) {
      setError(errorMessage(joinError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={tab === 'create' ? 'Create a server' : 'Join a server'}
      onClose={onClose}
      wide={tab === 'create'}
    >
      {cropping && (
        <ImageCropper
          file={cropping.file}
          opts={
            cropping.kind === 'icon'
              ? {
                  aspect: 1,
                  size: 512,
                  round: true,
                  title: 'Server icon',
                }
              : {
                  aspect: 16 / 9,
                  size: 1280,
                  title: 'Server banner',
                }
          }
          onCancel={() => setCropping(null)}
          onDone={finishCrop}
        />
      )}

      <div className="tabs">
        <button
          type="button"
          className={tab === 'create' ? 'active' : ''}
          onClick={() => {
            setTab('create');
            setError(null);
          }}
        >
          Create
        </button>

        <button
          type="button"
          className={tab === 'join' ? 'active' : ''}
          onClick={() => {
            setTab('join');
            setError(null);
          }}
        >
          Join
        </button>
      </div>

      {error && <div className="form-error">{error}</div>}

      {tab === 'create' ? (
        <>
          <div className="steps" aria-label={`Step ${step + 1} of 2`}>
            {[0, 1].map((index) => (
              <span
                key={index}
                className={index <= step ? 'on' : ''}
              />
            ))}
          </div>

          {step === 0 && (
            <>
              <div className="field-label">Start from</div>
              <div className="template-chips" role="radiogroup" aria-label="Template">
                {SERVER_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={!communityCode && template === t.id}
                    className={`template-chip${!communityCode && template === t.id ? ' selected' : ''}`}
                    title={t.desc}
                    onClick={() => {
                      setTemplate(t.id);
                      setCommunityCode(null);
                    }}
                  >
                    <span aria-hidden>{t.emoji}</span> {t.name}
                  </button>
                ))}
                <button
                  type="button"
                  className={`template-chip${communityCode ? ' selected' : ''}`}
                  aria-expanded={showCommunity}
                  onClick={() => setShowCommunity((v) => !v)}
                >
                  <Icon name="link" size={13} /> Shared template…
                </button>
              </div>
              {showCommunity && (
                <CommunityTemplatePicker selected={communityCode} onSelect={setCommunityCode} initialCode={initialTemplate} />
              )}

              <h2>Personalize your server</h2>

              <p className="muted">
                Give your server an identity. Customize its appearance
                and description before inviting your community.
              </p>

              <div className="create-pictures">
                <button
                  type="button"
                  className={`pic-slot icon${icon ? ' has' : ''}`}
                  style={
                    icon
                      ? { backgroundImage: `url(${icon.url})` }
                      : { background: color }
                  }
                  onClick={() => choosePicture('icon')}
                  aria-label="Upload server icon"
                >
                  {!icon && <Icon name="upload" size={20} />}
                  {!icon && 'Icon'}
                  {icon && 'Change icon'}
                </button>

                <button
                  type="button"
                  className={`pic-slot${banner ? ' has' : ''}`}
                  style={
                    banner
                      ? { backgroundImage: `url(${banner.url})` }
                      : undefined
                  }
                  onClick={() => choosePicture('banner')}
                  aria-label="Upload server banner"
                >
                  <Icon name="image" size={20} />
                  {banner ? 'Change banner' : 'Banner (optional)'}
                </button>
              </div>

              <Field label="Server name">
                <input
                  autoFocus
                  required
                  minLength={2}
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={`${me.display_name}'s server`}
                />
              </Field>

              <Field
                label="Description"
                hint="Shown on invites and in discovery. Maximum 300 characters."
              >
                <textarea
                  maxLength={300}
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What's this server about?"
                />
              </Field>

              {!icon && (
                <Field label="Icon color">
                  <ColorPicker value={color} onChange={setColor} />
                </Field>
              )}

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    if (name.trim() && name.trim().length < 2) {
                      setError(
                        'Server names must contain at least 2 characters.',
                      );
                      return;
                    }

                    setError(null);
                    setStep(1);
                  }}
                >
                  Next
                </button>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h2>Server discovery</h2>

              <label className="check-row">
                <input
                  type="checkbox"
                  checked={apply}
                  onChange={(e) => setApply(e.target.checked)}
                />
                <b>Apply for Server Discovery</b>
              </label>

              <p className="small muted">
                Apply to have your server reviewed. Approved servers can
                appear on Venband's Discover page.
              </p>

              {apply && (
                <>
                  <Field
                    label="Why should people join?"
                    hint="Tell people what makes your server worth joining."
                  >
                    <textarea
                      maxLength={1000}
                      rows={4}
                      value={pitch}
                      onChange={(e) => setPitch(e.target.value)}
                      placeholder="A friendly place for people who..."
                    />
                  </Field>

                  <Field
                    label="Categories"
                    hint={`Choose up to 3 categories (${cats.length}/3 selected).`}
                  >
                    <div className="chip-row">
                      {DISCOVERY_CATEGORIES.map((category) => {
                        const selected = cats.includes(category);

                        return (
                          <button
                            key={category}
                            type="button"
                            className={`chip${selected ? ' on' : ''}`}
                            aria-pressed={selected}
                            onClick={() => toggleCategory(category)}
                          >
                            {category}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                </>
              )}

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => {
                    setError(null);
                    setStep(0);
                  }}
                >
                  Back
                </button>

                <button
                  type="button"
                  className="btn primary"
                  disabled={busy}
                  onClick={create}
                >
                  {busy ? 'Creating server…' : 'Create server'}
                </button>
              </div>
            </>
          )}
        </>
      ) : (
        <form onSubmit={join}>
          <p className="muted">
            Enter an invite code or link, such as
            {' '}venband.com/invite/abc123.
          </p>

          <Field label="Invite">
            <input
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Invite code or link"
            />
          </Field>

          <button
            type="submit"
            className="btn primary full"
            disabled={busy}
          >
            {busy ? 'Joining…' : 'Join server'}
          </button>
        </form>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- invites --

export function InviteModal({
  serverId,
  serverName,
  onClose,
}: {
  serverId: string;
  serverName: string;
  onClose: () => void;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [hours, setHours] = useState<number | null>(24 * 7);
  const [maxUses, setMaxUses] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCode(null);

    supabase
      .rpc('create_invite', {
        p_server: serverId,
        p_max_uses: maxUses,
        p_expires_in_hours: hours,
        p_min_account_days: 0,
        p_label: null,
      })
      .then(({ data, error }) => {
        if (error) setError(errorMessage(error));
        else setCode(data as string);
      });
  }, [serverId, hours, maxUses]);

  const link = code ? inviteUrl(code) : '';

  return (
    <Modal
      title={`Invite friends to ${serverName}`}
      onClose={onClose}
    >
      {error && <div className="form-error">{error}</div>}

      <InviteFriendsList
        serverId={serverId}
        serverName={serverName}
      />

      <Field label="Invite link">
        <div className="copy-row">
          <input
            readOnly
            value={link || 'Generating…'}
            onFocus={(e) => e.target.select()}
          />

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

  for (const channel of data.channels) {
    if (channel.category && !out.includes(channel.category)) {
      out.push(channel.category);
    }
  }

  for (const category of data.server?.categories ?? []) {
    if (!out.includes(category)) out.push(category);
  }

  return out;
}

export async function createCategory(
  data: ServerData,
  name: string,
) {
  const clean = name.trim().slice(0, 100);
  if (!clean) return;

  const current = data.server?.categories ?? [];

  if (serverCategories(data).includes(clean)) return;

  const { error } = await supabase
    .from('servers')
    .update({ categories: [...current, clean] })
    .eq('id', data.server!.id);

  if (error) throw error;

  data.reload();
}

export type NewChannelType =
  | 'text'
  | 'voice'
  | 'forum'
  | 'announcement'
  | 'stage';

export const CHANNEL_TYPES: {
  id: NewChannelType;
  label: string;
  icon: string;
  desc: string;
}[] = [
  {
    id: 'text',
    label: 'Text',
    icon: 'hash',
    desc: 'Encrypted messages, files, threads and polls',
  },
  {
    id: 'voice',
    label: 'Voice',
    icon: 'speaker',
    desc: 'Encrypted voice, video, screen share and a side chat',
  },
  {
    id: 'forum',
    label: 'Forum',
    icon: 'thread',
    desc: 'Posts with tags; each post is its own discussion',
  },
  {
    id: 'announcement',
    label: 'Announcement',
    icon: 'megaphone',
    desc: 'Everyone reads, only moderators post',
  },
  {
    id: 'stage',
    label: 'Stage',
    icon: 'stage',
    desc: 'Speakers talk, the audience listens and raises hands',
  },
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
  const [category, setCategory] = useState(
    initialCategory ??
      categories.find((c) => /text/i.test(c)) ??
      categories[0] ??
      '',
  );
  const [newCategory, setNewCategory] = useState('');
  const [isPrivate, setPrivate] = useState(false);
  const [roles, setRoles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const NEW = '__new__';

  async function submit(e: FormEvent) {
    e.preventDefault();

    const clean =
      type === 'text' ||
      type === 'forum' ||
      type === 'announcement'
        ? name
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9_-]/g, '')
        : name.trim();

    if (!clean) return setError('Name required');

    const cat =
      category === NEW
        ? newCategory.trim().slice(0, 100)
        : category;

    if (category === NEW && !cat) {
      return setError('Name the new category');
    }

    setBusy(true);
    setError(null);

    const id = crypto.randomUUID();

    const { error: insertError } = await supabase
      .from('channels')
      .insert({
        id,
        server_id: data.server!.id,
        type,
        name: clean,
        category: cat,
        is_private: isPrivate,
        position: data.channels.length,
      });

    if (insertError) {
      setBusy(false);
      return setError(errorMessage(insertError));
    }

    if (isPrivate && roles.length) {
      const { error: accessError } = await supabase
        .from('channel_role_access')
        .insert(
          roles.map((role_id) => ({
            channel_id: id,
            role_id,
          })),
        );

      if (accessError) {
        setBusy(false);
        return setError(errorMessage(accessError));
      }
    }

    if (
      category === NEW &&
      cat &&
      !(data.server?.categories ?? []).includes(cat)
    ) {
      const { error: categoryError } = await supabase
        .from('servers')
        .update({
          categories: [...(data.server?.categories ?? []), cat],
        })
        .eq('id', data.server!.id);

      if (categoryError) {
        setBusy(false);
        return setError(errorMessage(categoryError));
      }
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
          {CHANNEL_TYPES.map((channelType) => (
            <label
              key={channelType.id}
              className={`type-option${type === channelType.id ? ' selected' : ''}`}
            >
              <input
                type="radio"
                checked={type === channelType.id}
                onChange={() => setType(channelType.id)}
              />

              <Icon name={channelType.icon} />

              <div>
                <b>{channelType.label}</b>
                <div className="small muted">
                  {channelType.desc}
                </div>
              </div>
            </label>
          ))}
        </div>

        <Field label="Channel name">
          <input
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={type === 'text' ? 'new-channel' : 'Lounge'}
          />
        </Field>

        <Field label="Category">
          <Select
            value={category}
            onChange={setCategory}
            options={[
              { value: '', label: 'No category' },
              ...categories.map((c) => ({
                value: c,
                label: c,
              })),
              { value: NEW, label: '+ New category…' },
            ]}
          />
        </Field>

        {category === NEW && (
          <Field label="New category name">
            <input
              autoFocus
              maxLength={100}
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="Gaming"
            />
          </Field>
        )}

        <PrivateToggle
          data={data}
          isPrivate={isPrivate}
          setPrivate={setPrivate}
          roles={roles}
          setRoles={setRoles}
        />

        <button
          className="btn primary full"
          disabled={busy}
        >
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
        <input
          type="checkbox"
          checked={isPrivate}
          onChange={(e) => setPrivate(e.target.checked)}
        />

        <Icon name="lock" size={14} />

        Private channel — only selected roles (and admins) can see it
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
                  onChange={(e) =>
                    setRoles(
                      e.target.checked
                        ? [...roles, r.id]
                        : roles.filter((x) => x !== r.id),
                    )
                  }
                />

                <span
                  className="role-dot"
                  style={{ background: r.color }}
                />

                {r.name}
              </label>
            ))}

          {data.roles.length <= 1 && (
            <p className="small muted">
              Create roles in Server Settings first.
            </p>
          )}
        </div>
      )}
    </>
  );
}

type OverwriteTri = 0 | 1 | 2;

/** Allow / Deny / Unset tri-state for one permission bit in a channel overwrite. */
function OverTri({
  value,
  onChange,
}: {
  value: OverwriteTri;
  onChange: (v: OverwriteTri) => void;
}) {
  const opts: {
    v: OverwriteTri;
    label: string;
    title: string;
  }[] = [
    {
      v: 0,
      label: 'Unset',
      title: 'Unset (inherit from roles)',
    },
    {
      v: 1,
      label: 'Allow',
      title: 'Allow this permission here',
    },
    {
      v: 2,
      label: 'Deny',
      title: 'Deny this permission here',
    },
  ];

  return (
    <span className="over-tri">
      {opts.map((option) => (
        <button
          key={option.v}
          type="button"
          title={option.title}
          className={value === option.v ? 'on' : ''}
          onClick={() => onChange(option.v)}
        >
          {option.label}
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

  const existing = useMemo(
    () =>
      data.overwritesFor({
        channelId: scope.channelId ?? '',
        category: scope.category,
      }),
    [data, scope.channelId, scope.category],
  );

  const [targets, setTargets] = useState<
    Record<
      string,
      {
        role: boolean;
        tri: Record<number, OverwriteTri>;
      }
    >
  >(() => {
    const init: Record<
      string,
      {
        role: boolean;
        tri: Record<number, OverwriteTri>;
      }
    > = {};

    for (const overwrite of existing) {
      const tri: Record<number, OverwriteTri> = {};

      for (const permission of PERMISSION_INFO) {
        tri[permission.bit] =
          (overwrite.allow & permission.bit) > 0
            ? 1
            : (overwrite.deny & permission.bit) > 0
              ? 2
              : 0;
      }

      init[`${overwrite.target_type}:${overwrite.target_id}`] = {
        role: overwrite.target_type === 'role',
        tri,
      };
    }

    return init;
  });

  const [addRole, setAddRole] = useState('');
  const [memberQuery, setMemberQuery] = useState('');
  const [memberResults, setMemberResults] = useState<Profile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roleById = useMemo(
    () => new Map(data.roles.map((r) => [r.id, r])),
    [data.roles],
  );

  const setTri = (
    key: string,
    bit: number,
    value: OverwriteTri,
  ) => {
    setTargets((current) => ({
      ...current,
      [key]: {
        ...current[key],
        tri: {
          ...current[key].tri,
          [bit]: value,
        },
      },
    }));
  };

  const removeTarget = (key: string) => {
    setTargets((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  async function searchMember(query: string) {
    setMemberQuery(query);

    if (!query.trim()) {
      setMemberResults([]);
      return;
    }

    const { data: found } = await supabase.rpc('find_user', {
      p_username: query.trim(),
    });

    const memberIds = new Set(
      data.members.map((member) => member.user_id),
    );

    setMemberResults(
      ((found as Profile[] | null) ?? [])
        .filter((profile) => memberIds.has(profile.id))
        .slice(0, 8),
    );
  }

  function addMember(id: string) {
    const key = `member:${id}`;

    setTargets((current) =>
      current[key]
        ? current
        : {
            ...current,
            [key]: {
              role: false,
              tri: {},
            },
          },
    );

    setMemberQuery('');
    setMemberResults([]);
  }

  function addRoleTarget() {
    if (!addRole) return;

    const key = `role:${addRole}`;

    setTargets((current) =>
      current[key]
        ? current
        : {
            ...current,
            [key]: {
              role: true,
              tri: {},
            },
          },
    );

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

      for (const [key, target] of Object.entries(targets)) {
        const [type, id] = key.split(':');

        let allow = 0;
        let deny = 0;

        for (const permission of PERMISSION_INFO) {
          const value = target.tri[permission.bit];

          if (value === 1) {
            allow |= permission.bit;
          } else if (value === 2) {
            deny |= permission.bit;
          }
        }

        if (allow | deny) {
          toWrite.push({
            server_id: serverId,
            channel_id: scope.channelId ?? null,
            category: scope.channelId
              ? null
              : (scope.category ?? ''),
            target_type: type === 'member' ? 'member' : 'role',
            target_id: id,
            allow,
            deny,
          });
        }
      }

      const writeKeys = new Set(
        toWrite.map(
          (write) => `${write.target_type}:${write.target_id}`,
        ),
      );

      const delIds = existing
        .filter(
          (overwrite) =>
            !writeKeys.has(
              `${overwrite.target_type}:${overwrite.target_id}`,
            ),
        )
        .map((overwrite) => overwrite.id);

      if (delIds.length) {
        const { error: deleteError } = await supabase
          .from('channel_overwrites')
          .delete()
          .in('id', delIds);

        if (deleteError) throw deleteError;
      }

      // Update existing rows in place and insert new ones to avoid duplicate keys.
      for (const write of toWrite) {
        const previous = existing.find(
          (overwrite) =>
            overwrite.target_type === write.target_type &&
            overwrite.target_id === write.target_id,
        );

        if (previous) {
          const { error: updateError } = await supabase
            .from('channel_overwrites')
            .update({
              allow: write.allow,
              deny: write.deny,
            })
            .eq('id', previous.id);

          if (updateError) throw updateError;
        } else {
          const { error: insertError } = await supabase
            .from('channel_overwrites')
            .insert(write);

          if (insertError) throw insertError;
        }
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
        <p className="muted">
          No overrides here yet — everyone uses the server-wide
          permissions. Add a role or member to customize.
        </p>
      )}

      <div className="over-add">
        <Select
          value={addRole}
          onChange={setAddRole}
          options={data.roles
            .filter(
              (role) =>
                !role.is_default &&
                !targets[`role:${role.id}`],
            )
            .map((role) => ({
              value: role.id,
              label: role.name,
            }))}
        />

        <button
          type="button"
          className="btn"
          disabled={!addRole}
          onClick={addRoleTarget}
        >
          Add role override
        </button>
      </div>

      <div className="over-member-add">
        <input
          value={memberQuery}
          onChange={(e) => searchMember(e.target.value)}
          placeholder="Add a member by username…"
        />
      </div>

      {memberResults.length > 0 && (
        <div className="over-member-results">
          {memberResults
            .filter(
              (profile) => !targets[`member:${profile.id}`],
            )
            .map((profile) => (
              <button
                type="button"
                key={profile.id}
                onClick={() => addMember(profile.id)}
              >
                <Avatar profile={profile} size={24} />
                {displayName(profile.id)}
              </button>
            ))}
        </div>
      )}

      <div className="over-targets">
        {Object.entries(targets).map(([key, target]) => {
          const [type, id] = key.split(':');
          const role = type === 'role' ? roleById.get(id) : null;
          const profile = type === 'member' ? getProfile(id) : null;

          return (
            <section className="over-target" key={key}>
              <div className="over-target-head">
                {role ? (
                  <span
                    className="role-dot"
                    style={{ background: role.color }}
                  />
                ) : (
                  <Avatar profile={profile} size={22} />
                )}

                <b>
                  {role
                    ? role.name
                    : (profile?.display_name ?? 'Member')}
                </b>

                <span className="muted small">
                  {type === 'role'
                    ? 'role override'
                    : 'member override'}
                </span>

                <button
                  type="button"
                  className="icon-btn"
                  title="Remove this override"
                  onClick={() => removeTarget(key)}
                  style={{ marginLeft: 'auto' }}
                >
                  <Icon name="x" />
                </button>
              </div>

              <div className="over-list">
                {PERMISSION_GROUPS.map((group) => {
                  const bits = PERMISSION_INFO.filter(
                    (permission) => permission.group === group,
                  );

                  if (!bits.length) return null;

                  return (
                    <div key={group} className="over-group">
                      <div className="over-group-title">
                        {group}
                      </div>

                      {bits.map((permission) => (
                        <label
                          key={permission.bit}
                          className="over-row"
                        >
                          <div className="over-name">
                            {permission.name}
                            <span className="muted small">
                              {permission.description}
                            </span>
                          </div>

                          <OverTri
                            value={target.tri[permission.bit] ?? 0}
                            onChange={(value) =>
                              setTri(
                                key,
                                permission.bit,
                                value,
                              )
                            }
                          />
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
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={save}
        >
          {busy ? 'Saving…' : 'Save Permissions'}
        </button>
      </div>
    </div>
  );
}

const SLOWMODE_STEPS = [0, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600];
export function slowmodeLabel(s: number) {
  if (!s) return 'Off';
  if (s < 60) return `${s} seconds`;
  if (s < 3600) return `${s / 60} minute${s === 60 ? '' : 's'}`;
  return `${s / 3600} hour${s === 3600 ? '' : 's'}`;
}

export function ChannelSettingsModal({
  channel,
  data,
  onClose,
}: {
  channel: Channel;
  data: ServerData;
  onClose: () => void;
}) {
  const isVoice =
    channel.type === 'voice' || channel.type === 'stage';

  const [tab, setTab] = useState<'overview' | 'permissions'>(
    'overview',
  );
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic);
  const [category, setCategory] = useState(channel.category);
  const [isPrivate, setPrivate] = useState(channel.is_private);

  const initialRoles = data.channelAccess
    .filter((access) => access.channel_id === channel.id)
    .map((access) => access.role_id);

  const [roles, setRoles] = useState<string[]>(initialRoles);
  const [settings, setSettings] = useState(channel.settings ?? {});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();

    const update: Record<string, unknown> = {
      name: name.trim(),
      topic,
      category,
      is_private: isPrivate,
    };

    if (channel.type === 'text' || channel.type === 'forum') {
      update.settings = { ...(channel.settings ?? {}), slowmode: Math.max(0, Math.min(21600, settings.slowmode ?? 0)) };
    }
    if (isVoice) {
      update.settings = {
        ...(channel.settings ?? {}),
        user_limit:
          Math.max(0, settings.user_limit ?? 0) || null,
        bitrate:
          Math.min(
            384,
            Math.max(8, settings.bitrate ?? 64),
          ) || null,
      };
    }

    const { error: updateError } = await supabase
      .from('channels')
      .update(update)
      .eq('id', channel.id);

    if (updateError) {
      return setError(errorMessage(updateError));
    }

    const removed = initialRoles.filter(
      (role) => !roles.includes(role),
    );

    const added = roles.filter(
      (role) => !initialRoles.includes(role),
    );

    if (removed.length) {
      const { error: removeError } = await supabase
        .from('channel_role_access')
        .delete()
        .eq('channel_id', channel.id)
        .in('role_id', removed);

      if (removeError) {
        return setError(errorMessage(removeError));
      }
    }

    if (added.length) {
      const { error: addError } = await supabase
        .from('channel_role_access')
        .insert(
          added.map((role_id) => ({
            channel_id: channel.id,
            role_id,
          })),
        );

      if (addError) {
        return setError(errorMessage(addError));
      }
    }

    data.reload();
    setSaved(true);
    setTimeout(onClose, 700);
  }

  async function remove() {
    if (
      !(await askConfirm({
        title: `Delete #${channel.name}`,
        body: 'All of its encrypted messages are deleted too.',
        confirm: 'Delete Channel',
        danger: true,
      }))
    ) {
      return;
    }

    const { error: deleteError } = await supabase
      .from('channels')
      .delete()
      .eq('id', channel.id);

    if (deleteError) {
      return setError(errorMessage(deleteError));
    }

    onClose();
  }

  return (
    <Modal
      wide
      title={`Edit ${
        channel.type === 'voice' || channel.type === 'stage'
          ? 'channel'
          : '#'
      } ${channel.name}`}
      onClose={onClose}
    >
      <div className="tabs">
        <button
          className={tab === 'overview' ? 'active' : ''}
          onClick={() => setTab('overview')}
        >
          Overview
        </button>

        <button
          className={tab === 'permissions' ? 'active' : ''}
          onClick={() => setTab('permissions')}
        >
          Permissions
        </button>
      </div>

      {saved ? (
        <p className="muted center">Saved.</p>
      ) : tab === 'overview' ? (
        <form onSubmit={save}>
          {error && <div className="form-error">{error}</div>}

          <Field label="Name">
            <input
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          {channel.type === 'text' && (
            <Field label="Topic">
              <textarea
                maxLength={1024}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
            </Field>
          )}

          {(channel.type === 'text' || channel.type === 'forum') && (
            <Field label="Slowmode">
              <Select
                value={String(settings.slowmode ?? 0)}
                onChange={(v) => setSettings((current) => ({ ...current, slowmode: Number(v) }))}
                options={SLOWMODE_STEPS.map((s) => ({ value: String(s), label: slowmodeLabel(s) }))}
              />
              <p className="small muted">How often each member can send a message here. Moderators are exempt.</p>
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
                  onChange={(e) =>
                    setSettings((current) => ({
                      ...current,
                      user_limit: Number(e.target.value),
                    }))
                  }
                />
              </Field>

              <Field label="Bitrate (kbps)">
                <input
                  type="number"
                  min={8}
                  max={384}
                  value={settings.bitrate ?? 64}
                  onChange={(e) =>
                    setSettings((current) => ({
                      ...current,
                      bitrate: Number(e.target.value),
                    }))
                  }
                />
              </Field>
            </div>
          )}

          <Field label="Category">
            <Select
              value={category}
              onChange={setCategory}
              options={[
                { value: '', label: 'No category' },
                ...serverCategories(data).map((item) => ({
                  value: item,
                  label: item,
                })),
              ]}
            />
          </Field>

          <p className="small muted">
            Position is set by dragging channels up and down in
            the server list.
          </p>

          <PrivateToggle
            data={data}
            isPrivate={isPrivate}
            setPrivate={setPrivate}
            roles={roles}
            setRoles={setRoles}
          />

          <p className="small muted">
            Removing access automatically rotates the channel’s
            encryption key.
          </p>

          <div className="modal-actions">
            <button
              type="button"
              className="btn danger"
              onClick={remove}
            >
              Delete Channel
            </button>

            <button className="btn primary">
              Save Changes
            </button>
          </div>
        </form>
      ) : (
        <ChannelPermissionsEditor
          data={data}
          scope={{ channelId: channel.id }}
        />
      )}
    </Modal>
  );
}

export function CategorySettingsModal({
  category,
  data,
  onClose,
}: {
  category: string;
  data: ServerData;
  onClose: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(category);
  const [error, setError] = useState<string | null>(null);

  const affected = data.channels.filter(
    (channel) => channel.category === category,
  ).length;

  async function rename(e: FormEvent) {
    e.preventDefault();

    const next = name.trim();

    if (!next || next === category) {
      return onClose();
    }

    const { error: channelError } = await supabase
      .from('channels')
      .update({ category: next })
      .eq('server_id', data.server!.id)
      .eq('category', category);

    if (channelError) {
      return setError(errorMessage(channelError));
    }

    const { error: serverError } = await supabase
      .from('servers')
      .update({
        categories: (data.server?.categories ?? []).map(
          (item) => (item === category ? next : item),
        ),
      })
      .eq('id', data.server!.id);

    if (serverError) {
      return setError(errorMessage(serverError));
    }

    data.reload();
    onClose();
  }

  async function remove() {
    if (
      !(await askConfirm({
        title: `Delete category ${category}`,
        body: 'Channels stay but become uncategorized. Permissions for this category are removed.',
        confirm: 'Delete Category',
        danger: true,
      }))
    ) {
      return;
    }

    const { error: deleteError } = await supabase
      .from('servers')
      .update({
        categories: (data.server?.categories ?? []).filter(
          (item) => item !== category,
        ),
      })
      .eq('id', data.server!.id);

    if (deleteError) {
      return setError(errorMessage(deleteError));
    }

    data.reload();
    onClose();
  }

  return (
    <Modal
      wide
      title={`Category — ${category}`}
      onClose={onClose}
    >
      <div className="tabs">
        <button
          className={renaming ? '' : 'active'}
          onClick={() => setRenaming(false)}
        >
          Permissions
        </button>

        <button
          className={renaming ? 'active' : ''}
          onClick={() => setRenaming(true)}
        >
          Rename
        </button>
      </div>

      {error && <div className="form-error">{error}</div>}

      {renaming ? (
        <form className="row" onSubmit={rename}>
          <Field label="Category name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          </Field>

          <button className="btn primary">Save</button>
        </form>
      ) : (
        <>
          <p className="muted">
            Changes apply to the {affected} channel
            {affected === 1 ? '' : 's'} in this category,
            unless a channel has its own override.
          </p>

          <ChannelPermissionsEditor
            data={data}
            scope={{ category }}
            onDone={() => setRenaming(false)}
          />

          <div className="modal-actions">
            <button
              type="button"
              className="btn danger"
              onClick={remove}
            >
              Delete Category
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

// -------------------------------------------------------------------- DMs --

export function NewDmModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal
      title="New direct message"
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);

          const cleanUsername = username
            .replace(/^@/, '')
            .trim();

          const { data } = await supabase.rpc('find_user', {
            p_username: cleanUsername,
          });

          const user = (data as Profile[] | null)?.[0];

          if (!user) {
            return setError(
              `Nobody has the username “${cleanUsername}”. Use their @username (shown under their name), not their display name.`,
            );
          }

          await startDm(user.id).catch((err) =>
            setError(errorMessage(err)),
          );

          onClose();
        }}
      >
        <Field label="Username" error={error}>
          <input
            required
            value={username}
            onChange={(e) =>
              setUsername(e.target.value.toLowerCase())
            }
            placeholder="@username"
          />
        </Field>

        <button className="btn primary full">
          Open DM
        </button>
      </form>
    </Modal>
  );
}

export async function startDm(userId: string) {
  const { data, error } = await supabase.rpc('open_dm', {
    p_other: userId,
  });

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
    () =>
      Object.values(friends)
        .filter((friend) => friend.accepted)
        .map((friend) => friend.other)
        .sort()
        .join(','),
    [friends],
  );

  const [people, setPeople] = useState<Profile[]>([]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: parts } = await supabase
        .from('dm_participants')
        .select('channel_id, user_id');

      const byChannel = new Map<string, string[]>();

      for (const participant of parts ?? []) {
        byChannel.set(
          participant.channel_id,
          [
            ...(byChannel.get(participant.channel_id) ?? []),
            participant.user_id,
          ],
        );
      }

      const channelIds = [...byChannel.keys()];

      const { data: chans } = channelIds.length
        ? await supabase
            .from('channels')
            .select('id, is_group')
            .in('id', channelIds)
        : { data: [] };

      const direct = (
        (chans ?? []) as {
          id: string;
          is_group: boolean;
        }[]
      )
        .filter((channel) => !channel.is_group)
        .map((channel) => channel.id);

      const fromDms = direct.flatMap(
        (id) => byChannel.get(id) ?? [],
      );

      const ids = [
        ...new Set([
          ...friendIds.split(',').filter(Boolean),
          ...fromDms,
        ]),
      ].filter((id) => id !== meId);

      await loadProfiles(ids);

      if (cancelled) return;

      const list = ids
        .map((id) => getProfile(id))
        .filter(Boolean) as Profile[];

      list.sort((a, b) =>
        displayName(a.id).localeCompare(displayName(b.id)),
      );

      setPeople(list);
    })();

    return () => {
      cancelled = true;
    };
  }, [friendIds, meId]);

  return people;
}

/** Pick people from your friends and DMs, or add someone by username. */
function PeoplePicker({
  picked,
  setPicked,
  exclude = [],
}: {
  picked: Profile[];
  setPicked: (p: Profile[]) => void;
  exclude?: string[];
}) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);

  const known = useKnownPeople();

  const query = username
    .replace(/^@+/, '')
    .trim()
    .toLowerCase();

  const rows = known.filter(
    (profile) =>
      !query ||
      displayName(profile.id).toLowerCase().includes(query) ||
      profile.username.toLowerCase().includes(query),
  );

  function pick(user: Profile) {
    putProfile(user);
    setPicked([...picked, user]);
  }

  function toggle(user: Profile) {
    if (picked.some((profile) => profile.id === user.id)) {
      setPicked(
        picked.filter((profile) => profile.id !== user.id),
      );
    } else {
      pick(user);
    }
  }

  async function add() {
    const name = username
      .replace(/^@+/, '')
      .trim()
      .toLowerCase();

    if (!name) return;

    setError(null);

    const { data } = await supabase.rpc('find_user', {
      p_username: name,
    });

    const user = (data as Profile[] | null)?.[0];

    if (!user) {
      return setError(`Nobody has the username “${name}”.`);
    }

    if (
      user.id === sessionStore.get().me?.id ||
      exclude.includes(user.id)
    ) {
      return setError('They’re already in here.');
    }

    if (!picked.some((profile) => profile.id === user.id)) {
      pick(user as Profile);
    }

    setUsername('');
  }

  return (
    <>
      <Field label="Add people" error={error}>
        <div className="copy-row">
          <input
            value={username}
            placeholder="Search friends or type a username"
            onChange={(e) =>
              setUsername(e.target.value.toLowerCase())
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />

          <button
            type="button"
            className="btn secondary"
            onClick={add}
          >
            Add
          </button>
        </div>
      </Field>

      <div
        style={{
          maxHeight: 240,
          overflowY: 'auto',
          marginBottom: 12,
        }}
      >
        {rows.map((profile) => {
          const isPicked = picked.some(
            (item) => item.id === profile.id,
          );

          const locked = exclude.includes(profile.id);

          return (
            <div key={profile.id} className="member">
              <Avatar profile={profile} size={32} />

              <div className="member-text">
                <span className="member-name">
                  {displayName(profile.id)}
                </span>

                <span className="member-sub">
                  @{profile.username}
                </span>
              </div>

              <button
                type="button"
                className={`btn small ${
                  isPicked ? 'secondary' : 'primary'
                }`}
                disabled={locked}
                title={isPicked ? 'Click to remove' : undefined}
                onClick={() => toggle(profile)}
              >
                {locked
                  ? 'In group'
                  : isPicked
                    ? 'Added'
                    : 'Add'}
              </button>
            </div>
          );
        })}

        {!rows.length && (
          <p className="muted small">
            {query
              ? 'No matches. Press Enter to add by exact username.'
              : 'No friends or chats yet. Type a username above.'}
          </p>
        )}
      </div>

      {picked.length > 0 && (
        <div className="role-pills">
          {picked.map((profile) => (
            <span key={profile.id} className="role-pill">
              <Avatar profile={profile} size={18} />
              {profile.display_name}

              <button
                type="button"
                className="pill-x"
                onClick={() =>
                  setPicked(
                    picked.filter(
                      (item) => item.id !== profile.id,
                    ),
                  )
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </>
  );
}

export const GROUP_MAX = 20;

export function NewGroupModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Profile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Modal title="New group chat" onClose={onClose}>
      <p className="muted small">
        Up to {GROUP_MAX} people. Everything in the group is
        end-to-end encrypted.
      </p>

      {error && <div className="form-error">{error}</div>}

      <Field label="Group name (optional)">
        <input
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Weekend plans"
        />
      </Field>

      <PeoplePicker
        picked={picked}
        setPicked={setPicked}
      />

      <button
        className="btn primary full"
        disabled={!picked.length || busy}
        onClick={async () => {
          setBusy(true);

          const fallback = [
            sessionStore.get().me?.display_name,
            ...picked.map((profile) => profile.display_name),
          ]
            .filter(Boolean)
            .join(', ');

          const { data, error: createError } =
            await supabase.rpc('create_group', {
              p_members: picked.map((profile) => profile.id),
              p_name:
                name.trim() || fallback.slice(0, 100),
            });

          setBusy(false);

          if (createError) {
            return setError(errorMessage(createError));
          }

          openChannel('@me', data as string);
          onClose();
        }}
      >
        Create group
        {picked.length
          ? ` with ${picked.length + 1} people`
          : ''}
      </button>
    </Modal>
  );
}

export function GroupSettingsModal({
  dm,
  onClose,
}: {
  dm: DmChannel;
  onClose: () => void;
}) {
  const [name, setName] = useState(dm.channel.name);
  const [picked, setPicked] = useState<Profile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  const me = sessionStore.use((s) => s.me)!;
  const friends = socialStore.use((s) => s.friends);

  const owner = dm.channel.owner_id ?? null;
  const isOwner = owner === me.id;

  const inGroup = new Set([
    me.id,
    ...dm.members.map((member) => member.id),
  ]);

  const full = inGroup.size >= GROUP_MAX;

  const addable = Object.values(friends)
    .filter(
      (friend) =>
        friend.accepted && !inGroup.has(friend.other),
    )
    .map((friend) => getProfile(friend.other))
    .filter((profile): profile is Profile =>
      Boolean(profile),
    );

  const add = async (ids: string[]) => {
    const { error: addError } = await supabase.rpc(
      'add_group_members',
      {
        p_channel: dm.channel.id,
        p_members: ids,
      },
    );

    if (addError) {
      return setError(errorMessage(addError));
    }

    await sessionStore
      .get()
      .keyring?.distribute(dm.channel.id);

    setError(null);
  };

  return (
    <Modal title="Group settings" onClose={onClose}>
      {error && <div className="form-error">{error}</div>}

      <Field label="Group name">
        <div className="copy-row">
          <input
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <button
            className="btn secondary"
            onClick={async () => {
              const { error: renameError } = await supabase.rpc(
                'rename_group',
                {
                  p_channel: dm.channel.id,
                  p_name: name,
                },
              );

              setError(
                renameError
                  ? errorMessage(renameError)
                  : null,
              );

              if (!renameError) onClose();
            }}
          >
            Save
          </button>
        </div>
      </Field>

      <div className="field-label">
        Members — {dm.members.length + 1} / {GROUP_MAX}
      </div>

      <div className="group-members">
        {[me, ...dm.members].map((profile) => (
          <div key={profile.id} className="member">
            <Avatar profile={profile} size={28} />

            <span className="member-name grow">
              {profile.display_name}

              {profile.id === owner && (
                <OwnerCrown
                  size={13}
                  label="Group owner"
                />
              )}
            </span>

            {profile.id === me.id && (
              <span className="tag-soft accent">you</span>
            )}

            {isOwner && profile.id !== me.id && (
              <>
                <button
                  className="btn link small"
                  onClick={async () => {
                    if (
                      !(await askConfirm({
                        title: `Make ${profile.display_name} the owner?`,
                        body: 'They’ll be able to remove people. You stay in the group.',
                        confirm: 'Make owner',
                      }))
                    ) {
                      return;
                    }

                    const { error: transferError } =
                      await supabase.rpc('transfer_group', {
                        p_channel: dm.channel.id,
                        p_user: profile.id,
                      });

                    setError(
                      transferError
                        ? errorMessage(transferError)
                        : null,
                    );

                    if (!transferError) onClose();
                  }}
                >
                  Make owner
                </button>

                <button
                  className="btn link small danger-text"
                  onClick={async () => {
                    if (
                      !(await askConfirm({
                        title: `Remove ${profile.display_name}?`,
                        body: 'They stop getting new messages. The group’s key is changed so they can’t read anything new.',
                        confirm: 'Remove',
                        danger: true,
                      }))
                    ) {
                      return;
                    }

                    const { error: removeError } =
                      await supabase.rpc(
                        'remove_group_member',
                        {
                          p_channel: dm.channel.id,
                          p_user: profile.id,
                        },
                      );

                    setError(
                      removeError
                        ? errorMessage(removeError)
                        : null,
                    );

                    if (!removeError) onClose();
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
            {addable.slice(0, 50).map((profile) => (
              <div key={profile.id} className="member">
                <Avatar profile={profile} size={28} />

                <span className="member-name grow">
                  {profile.display_name}
                </span>

                <button
                  className="btn secondary small"
                  onClick={() => add([profile.id])}
                >
                  Add to{' '}
                  {dm.title.length > 18
                    ? 'group'
                    : dm.title}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <PeoplePicker
        picked={picked}
        setPicked={setPicked}
        exclude={dm.members.map((member) => member.id)}
      />

      {picked.length > 0 && (
        <button
          className="btn primary full"
          onClick={() =>
            add(picked.map((profile) => profile.id)).then(
              () => setPicked([]),
            )
          }
        >
          Add {picked.length}{' '}
          {picked.length === 1 ? 'person' : 'people'}
        </button>
      )}

      <Field
        label="Invite link"
        hint="For people who aren’t your friends yet. Works for 7 days."
      >
        {link ? (
          <div className="copy-row">
            <input
              readOnly
              value={link}
              onFocus={(e) => e.target.select()}
              aria-label="Group invite link"
            />

            <button
              className="btn primary"
              onClick={() =>
                navigator.clipboard.writeText(link)
              }
            >
              Copy
            </button>
          </div>
        ) : (
          <button
            className="btn secondary"
            disabled={full}
            onClick={async () => {
              const { data, error: inviteError } =
                await supabase.rpc('create_group_invite', {
                  p_channel: dm.channel.id,
                });

              if (inviteError) {
                return setError(errorMessage(inviteError));
              }

              setLink(
                `${window.location.origin}${import.meta.env.BASE_URL}join-group/${data as string}`,
              );
            }}
          >
            {full
              ? 'The group is full'
              : 'Create invite link'}
          </button>
        )}
      </Field>

      <hr />

      <button
        className="btn danger"
        onClick={async () => {
          if (
            !(await askConfirm({
              title: `Leave ${dm.title}`,
              body: 'You won’t see new messages unless someone adds you back.',
              confirm: 'Leave Group',
              danger: true,
            }))
          ) {
            return;
          }

          const { error: leaveError } = await supabase.rpc(
            'leave_group',
            {
              p_channel: dm.channel.id,
            },
          );

          if (leaveError) {
            return setError(errorMessage(leaveError));
          }

          openChannel('@me', '');
          onClose();
        }}
      >
        Leave group
      </button>
    </Modal>
  );
}
