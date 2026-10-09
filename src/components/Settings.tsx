import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { LooksPanel } from './LooksSettings';
import { supabase, errorMessage } from '../lib/supabase';
import { changePassword, sessionStore, signOut, updateMyProfile, type ProfilePatch } from '../lib/session';
import { fingerprint, passwordStrength } from '../lib/crypto';
import { displayName, getProfile, putProfile } from '../lib/directory';
import { closeSettings, uiStore, type SettingsTab } from '../lib/ui';
import { DEFAULT_SETTINGS, updateChat, updateSettings, updateVoice, useSettings } from '../lib/settings';
import { BUILT_IN_THEMES, sanitizeTheme, THEME_KEYS, type Theme } from '../lib/themes';
import { describeAgent, listDevices, revokeDevice, type Device } from '../lib/devices';
import { setRelation, socialStore } from '../lib/social';
import { LANGUAGES, deviceTranslationSupported } from '../lib/translate';
import { CODE_THEMES } from '../lib/highlight';
import { PHRASEBOOK_LANGS, PHRASEBOOK_SIZE } from '../lib/phrasebook';
import type { AvatarFrame, NameEffect, NameFont, PresenceStatus, Profile, Server } from '../lib/types';
import { Avatar, ColorPicker, Field, Icon, nameplateVars, StyledName } from './ui';
import { ImageCropper } from './ImageCropper';
import { askText } from './Dialogs';
import { Select } from './Select';
import { go } from '../lib/router';
import { connectBot, deleteApp as deleteAppRpc, disconnectBot, listMyBots, type MyBotRow } from '../lib/bots';
import { ServerUpdateCard } from './Apps';
import { Badges } from './Badges';
import { accountAge, bannerStyle, NAMEPLATES, ServerTag } from './People';
import { askConfirm } from './Dialogs';
import { BadgeDesigner, DiscoveryQueue, ModerationCenter, ReportCentre } from './Moderation';
import { Markdown } from './Markdown';
import { SecurityTab } from './Security';
import {
  connectionsVersion,
  myConnections,
  PROVIDERS,
  reloadConnections,
  removeConnection,
  steamLogin,
  subscribeConnections,
  type ConnectionProvider,
  type ConnectionRow,
} from '../lib/connections';

const TABS: { id: SettingsTab; label: string; icon: string; group: string; staff?: boolean; admin?: boolean; designer?: boolean }[] = [
  { id: 'account', label: 'My Account', icon: 'user', group: 'User Settings' },
  { id: 'profile', label: 'Profiles', icon: 'edit', group: 'User Settings' },
  { id: 'privacy', label: 'Privacy & Safety', icon: 'eye', group: 'User Settings' },
  { id: 'security', label: 'Security', icon: 'shield', group: 'User Settings' },
  { id: 'devices', label: 'Devices', icon: 'monitor', group: 'User Settings' },
  { id: 'appearance', label: 'Appearance', icon: 'palette', group: 'App Settings' },
  { id: 'voice', label: 'Voice & Video', icon: 'mic', group: 'App Settings' },
  { id: 'chat', label: 'Chat', icon: 'message', group: 'App Settings' },
  { id: 'language', label: 'Language', icon: 'globe', group: 'App Settings' },
  { id: 'my-apps', label: 'My Apps', icon: 'bot', group: 'App Settings' },
  { id: 'connections', label: 'Connections', icon: 'link', group: 'App Settings' },
  { id: 'moderation', label: 'Moderation', icon: 'gavel', group: 'Venband Staff', staff: true },
  { id: 'discovery-queue', label: 'Discovery Applications', icon: 'compass', group: 'Venband Staff', staff: true },
  { id: 'reports', label: 'Report Centre', icon: 'flag', group: 'Venband Staff', staff: true, admin: true },
  { id: 'badges', label: 'Badge Designer', icon: 'star', group: 'Venband Staff', designer: true },
];

export function SettingsPage() {
  const tab = uiStore.use((s) => s.settings);
  const me = sessionStore.use((s) => s.me)!;
  const staff = (me.platform_role ?? 'user') !== 'user';
  const admin = me.platform_role === 'admin' || me.platform_role === 'owner';
  // Venband owners and founders design badges
  const designer = me.platform_role === 'owner' || (me.badges ?? []).includes('founder');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.modal-backdrop') && closeSettings();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!tab) return null;
  const groups = [...new Set(TABS.map((t) => t.group))];
  return (
    <div className="settings-page" role="dialog" aria-modal aria-label="Settings">
      <nav className="sp-nav">
        <div className="sp-nav-inner">
          {groups.map((g) => {
            const items = TABS.filter((t) => t.group === g && (!t.staff || staff) && (!t.admin || admin) && (!t.designer || designer));
            if (!items.length) return null;
            return (
              <div key={g}>
                <div className="sp-group">{g}</div>
                {items.map((t) => (
                  <button key={t.id} className={`sp-tab${tab === t.id ? ' active' : ''}`} onClick={() => uiStore.set({ settings: t.id })}>
                    <Icon name={t.icon} size={16} /> {t.label}
                  </button>
                ))}
              </div>
            );
          })}
          <div className="sp-sep" />
          <button className="sp-tab danger" onClick={() => (closeSettings(), signOut())}>
            <Icon name="logout" size={16} /> Log Out
          </button>
        </div>
      </nav>
      <main className="sp-content">
        <div className={`sp-inner${tab === 'moderation' || tab === 'reports' || tab === 'discovery-queue' || tab === 'badges' ? ' wide' : ''}`}>
          {tab === 'account' && <AccountTab />}
          {tab === 'profile' && <ProfileTab />}
          {tab === 'privacy' && <PrivacyTab />}
          {tab === 'security' && <SecurityTab />}
          {tab === 'devices' && <DevicesTab />}
          {tab === 'appearance' && <AppearanceTab />}
          {tab === 'voice' && <VoiceTab />}
          {tab === 'chat' && <ChatTab />}
          {tab === 'language' && <LanguageTab />}
          {tab === 'my-apps' && <MyAppsTab />}
          {tab === 'connections' && <ConnectionsTab />}
          {tab === 'moderation' && staff && <ModerationCenter />}
          {tab === 'reports' && admin && <ReportCentre />}
          {tab === 'discovery-queue' && staff && <DiscoveryQueue />}
          {tab === 'badges' && designer && <BadgeDesigner />}
        </div>
        <button className="sp-close" onClick={closeSettings} title="Close (Esc)">
          <Icon name="x" size={18} />
          <span>ESC</span>
        </button>
      </main>
    </div>
  );
}

function Section({ title, children, desc }: { title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h3>{title}</h3>
      {desc && <p className="muted small">{desc}</p>}
      {children}
    </section>
  );
}

/** Settings → My Apps — every bot connected to your account, plus the ones you own. */
function MyAppsTab() {
  const me = sessionStore.use((s) => s.me)!;
  const [rows, setRows] = useState<MyBotRow[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    setRows(null);
    try {
      const { rows, missing } = await listMyBots();
      setMissing(Boolean(missing));
      setRows(rows);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  async function openBot(row: MyBotRow) {
    if (!row.channel_id) return;
    closeSettings();
    go(`channels/@me/${row.channel_id}`);
  }
  async function disconnect(row: MyBotRow) {
    setBusy(row.id);
    setError(null);
    try {
      await disconnectBot(row.id);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  async function remove(row: MyBotRow) {
    if (!(await askConfirm({ title: `Delete “${row.name}”?`, body: `This deletes the bot for good — every server loses it and its commands are gone. The official Venband bot is protected.`, confirm: 'Delete forever', danger: true }))) return;
    setBusy(row.id);
    setError(null);
    try {
      await deleteAppRpc(row.id);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <Section title="My Apps" desc="Bots you connected to your account answer your slash commands in a DM. Everything you own is listed too, so you can drop it anywhere.">
      {error && <div className="form-error">{error}</div>}
      {missing && <ServerUpdateCard what="my apps" />}
      {rows === null && !missing && <div className="spinner" />}
      {rows?.length === 0 && !missing && <p className="muted small">No connected apps yet. Open a bot’s dashboard and hit “Message this bot” — or make one on the <button className="btn link small" onClick={() => (closeSettings(), go('bots'))}>Developers</button> page.</p>}
      <div className="my-apps-list">
        {rows?.map((row) => (
          <div key={row.id} className="app-row static">
            <span className="my-app-avatar" style={{ background: row.color || '#5865f2' }}>
              <Icon name="bot" size={18} />
            </span>
            <span className="grow">
              <b>{row.name}</b>
              <div className="small muted">{row.description || 'No description'}</div>
            </span>
            {row.channel_id ? (
              <button className="btn secondary small" onClick={() => openBot(row)}>
                <Icon name="message" size={14} /> Open DM
              </button>
            ) : (
              <button
                className="btn secondary small"
                disabled={busy === row.id}
                onClick={async () => {
                  setBusy(row.id);
                  setError(null);
                  try {
                    const channel = await connectBot(row.id);
                    setBusy(null);
                    closeSettings();
                    go(`channels/@me/${channel}`);
                  } catch (e) {
                    setError(errorMessage(e));
                    setBusy(null);
                  }
                }}
              >
                Connect to chat
              </button>
            )}
            <button className="btn link small danger-text" disabled={busy === row.id} onClick={() => disconnect(row)}>
              Disconnect
            </button>
            {row.owner_id === me.id && (
              <button className="btn link small danger-text" disabled={busy === row.id} onClick={() => remove(row)}>
                Delete
              </button>
            )}
            {row.id && <span title={`App id: ${row.id}`} className="small muted mono hide-sm">{row.id.slice(0, 8)}</span>}
          </div>
        ))}
      </div>
    </Section>
  );
}

// ------------------------------------------------------------- connections --

function ConnectionsTab() {
  const links = useConnections();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byProvider = (p: string) => links.filter((c) => c.provider === p);

  async function disconnect(provider: ConnectionProvider, externalId: string) {
    setBusy(`${provider}-${externalId}`);
    setError(null);
    try {
      await removeConnection(provider, externalId);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section
      title="Connections"
      desc="Link the accounts you use most and Venband can show that activity on your profile — and, on the desktop app, mirror it to the Discord-compatible presence your other apps already read."
    >
      {error && <div className="form-error">{error}</div>}
      <div className="connections-grid">
        {PROVIDERS.map((info) => {
          const linked = byProvider(info.provider);
          return (
            <div key={info.provider} className="connection-card">
              <span className="connection-logo" style={{ background: info.color }}>
                <span className="connection-logo-inner">{info.slug[0].toUpperCase()}</span>
              </span>
              <span className="grow">
                <b>{info.name}</b>
                <div className="small muted">{info.desc}</div>
                {linked.map((c) => (
                  <div key={c.external_id} className="connection-account" title={`Linked ${new Date(c.created_at).toLocaleDateString()}`}>
                    {c.avatar_url && <img className="connection-avatar" src={c.avatar_url} alt="" referrerPolicy="no-referrer" />}
                    <span>
                      <b>{c.display_name || `${info.name} account`}</b>
                      <span className="small muted"> • linked</span>
                    </span>
                    <button
                      className="btn link small danger-text"
                      disabled={busy === `${info.provider}-${c.external_id}`}
                      onClick={() => disconnect(info.provider, c.external_id)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </span>
              {info.kind === 'openid' && linked.length === 0 && (
                <button className="btn secondary small" onClick={() => (window.location.href = steamLogin())}>
                  <Icon name="link" size={14} /> Connect
                </button>
              )}
              {info.kind === 'openid' && linked.length > 0 && <span className="tag-soft success">Connected</span>}
              {info.kind === 'oauth' && (
                <button className="btn secondary small" disabled title="Needs a Venband-run OAuth server for the client secret — on the roadmap.">
                  <Icon name="link" size={14} /> Connect
                </button>
              )}
              {info.kind === 'planned' && (
                <button className="btn secondary small" disabled title="Coming soon.">
                  <Icon name="lock" size={14} /> Soon
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function useConnections(): ConnectionRow[] {
  useSyncExternalStore(subscribeConnections, connectionsVersion);
  useEffect(() => {
    void reloadConnections();
  }, []);
  return myConnections();
}

export function Toggle({ label, desc, checked, onChange }: { label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span>
        <b>{label}</b>
        {desc && <span className="small muted">{desc}</span>}
      </span>
      <input type="checkbox" className="toggle-switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

// ---------------------------------------------------------------- account --

function AccountTab() {
  const me = sessionStore.use((s) => s.me)!;
  const session = sessionStore.use((s) => s.session);
  const identity = sessionStore.use((s) => s.identity)!;
  const [fp, setFp] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showEmail, setShowEmail] = useState(false);
  const [delPhrase, setDelPhrase] = useState('');
  useEffect(() => {
    fingerprint(identity.encPublic, identity.signPublic).then(setFp);
  }, [identity]);
  const email = session?.user.email ?? '';
  const deletePhrase = 'I want to delete my account';
  async function deleteAccount() {
    if (!(await askConfirm({ title: 'Delete your account?', body: 'Your DMs, files, messages, username and email are erased right now, and this device signs out. This cannot be undone.', confirm: 'Delete my account', danger: true }))) return;
    setBusy(true);
    setMsg(null);
    try {
      const { error } = await supabase.rpc('delete_my_account', { p_confirm: delPhrase });
      if (error) throw error;
      await signOut('Your account and everything on it was deleted. See you around.');
    } catch (err) {
      setMsg(errorMessage(err));
      setBusy(false);
    }
  }
  return (
    <>
      <h2>My Account</h2>
      <div className="account-card">
        <div className="account-banner" style={bannerStyle(me)} />
        <div className="account-head">
          <Avatar profile={me} size={80} />
          <div>
            <h3>
              {me.display_name} <Badges ids={me.badges} size={18} />
            </h3>
            <span className="muted">@{me.username}</span>
          </div>
        </div>
        <div className="account-rows">
          <div className="account-row">
            <div>
              <div className="field-label">Username</div>
              <div>{me.username}</div>
            </div>
          </div>
          <div className="account-row">
            <div>
              <div className="field-label">Email</div>
              <div>{showEmail ? email : email.replace(/^(.).*(@.*)$/, (_m, a: string, b: string) => `${a}${'•'.repeat(8)}${b}`)}</div>
            </div>
            <button className="btn link" onClick={() => setShowEmail((v) => !v)}>
              {showEmail ? 'Hide' : 'Reveal'}
            </button>
          </div>
          <div className="account-row">
            <div>
              <div className="field-label">Member since</div>
              <div>{accountAge(me.created_at)}</div>
            </div>
          </div>
          {me.account_status && me.account_status !== 'active' && (
            <div className="account-row warn">
              <div>
                <div className="field-label">Account standing</div>
                <div>{STATUS_TEXT[me.account_status]}</div>
              </div>
            </div>
          )}
        </div>
      </div>
      {msg && <div className="notice">{msg}</div>}
      <Section title="Password" desc="Changing it re-encrypts your keys on this device. Your messages stay readable.">
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
          <div className="row">
            <Field label="Current password">
              <input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <Field label="New password" hint={next ? `Strength: ${passwordStrength(next).label}` : undefined}>
              <input type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
          </div>
          <button className="btn primary" disabled={busy}>
            {busy ? 'Re-encrypting keys…' : 'Change password'}
          </button>
        </form>
      </Section>
      <Section title="Encryption" desc="Friends can compare this with the fingerprint they see on your profile to be sure nobody is intercepting your messages.">
        <code className="fingerprint">{fp}</code>
        <ul className="security-list">
          <li>Messages: every message is encrypted with its own AES-256-GCM key, never reused (derived with HKDF-SHA256 from the channel key and a fresh random salt), and signed with ECDSA P-256.</li>
          <li>Files: each file gets its own random AES-256-GCM key.</li>
          <li>Channel keys are replaced whenever someone leaves or is removed, so they can’t read anything new.</li>
          <li>Key exchange: ECDH P-256 (ECIES). The server only ever stores wrapped keys.</li>
          <li>Password: Argon2id (64 MiB) on your device; only a derived login key is sent to the server.</li>
          <li>Calls: peer-to-peer WebRTC (DTLS-SRTP) with signed session descriptions.</li>
          <li>Translation runs on your device, so decrypted messages never leave it.</li>
        </ul>
      </Section>
      <Section title="Delete account" desc="Wipes your account off Venband for good.">
        <div className="warning-box">
          This permanently deletes your account and everything tied to it: your 1:1 DMs, files, pictures, messages,
          username, email, profile and keys. It can’t be undone.
          <div className="row" style={{ marginTop: 10 }}>
            <input
              className="grow"
              type="text"
              placeholder="Type “I want to delete my account”"
              value={delPhrase}
              onChange={(e) => setDelPhrase(e.target.value)}
              aria-label="Confirmation phrase"
            />
            <button className="btn danger" disabled={busy || delPhrase.trim() !== deletePhrase} onClick={deleteAccount}>
              {busy ? 'Deleting…' : 'Delete account'}
            </button>
          </div>
        </div>
      </Section>
    </>
  );
}

export const STATUS_TEXT: Record<string, string> = {
  active: 'Good standing',
  limited: 'Limited: you can chat and call, but can’t create servers, message people who aren’t your friends, or send friend requests.',
  very_limited: 'Very limited: your account is read-only until Venband staff review it.',
  banned: 'Banned',
};

// --------------------------------------------------------------- profile --

const PRESENCE: { id: PresenceStatus; label: string }[] = [
  { id: 'online', label: 'Online' },
  { id: 'idle', label: 'Idle' },
  { id: 'dnd', label: 'Do Not Disturb' },
  { id: 'invisible', label: 'Invisible' },
];

function ProfileTab() {
  const me = sessionStore.use((s) => s.me)!;
  const [draft, setDraft] = useState<ProfilePatch>({});
  const [usernameDraft, setUsernameDraft] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tagServers, setTagServers] = useState<Server[]>([]);
  const [cropping, setCropping] = useState<{ file: File; kind: 'avatar' | 'banner' } | null>(null);
  const preview: Profile = { ...me, ...draft, username: usernameDraft ?? me.username } as Profile;
  const pickPicture = (kind: 'avatar' | 'banner') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.onchange = () => input.files?.[0] && setCropping({ file: input.files[0], kind });
    input.click();
  };
  async function publishCosmetic(kind: 'nameplate' | 'name_style') {
    const name = await askText({ title: kind === 'nameplate' ? 'Publish your nameplate' : 'Publish your name style', label: 'Name it', maxLength: 40 });
    if (!name?.trim()) return;
    const data = kind === 'nameplate' ? preview.nameplate_style ?? {} : preview.name_style ?? {};
    const { error } = await supabase.from('themes').insert({ author_id: me.id, name: name.trim(), description: '', data, kind });
    setMsg(error ? errorMessage(error) : 'Published! Find it in the Marketplace.');
  }
  const set = (p: ProfilePatch) => setDraft((d) => ({ ...d, ...p }));
  const dirty = Object.keys(draft).length > 0 || usernameDraft !== null;

  useEffect(() => {
    (async () => {
      const { data: mem } = await supabase.from('server_members').select('server_id').eq('user_id', me.id);
      const ids = (mem ?? []).map((m) => m.server_id);
      if (!ids.length) return;
      const { data } = await supabase.from('servers').select('*').in('id', ids).not('tag', 'is', null);
      setTagServers((data ?? []) as Server[]);
    })();
  }, [me.id]);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const newName = usernameDraft?.trim().toLowerCase();
      if (newName && newName !== me.username) {
        const { error } = await supabase.rpc('set_username', { p_username: newName });
        if (error) throw error;
      }
      if (Object.keys(draft).length > 0) {
        await updateMyProfile({
          ...draft,
          ...(draft.display_name !== undefined ? { display_name: draft.display_name.trim() || newName || me.username } : {}),
        });
      }
      const { data } = await supabase.rpc('my_profile');
      if (data) {
        putProfile(data as Profile);
        sessionStore.set({ me: data as Profile });
      }
      setDraft({});
      setUsernameDraft(null);
      setMsg('Profile saved.');
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function setTag(serverId: string | null) {
    const { error } = await supabase.rpc('set_server_tag', { p_server: serverId });
    if (error) return setMsg(errorMessage(error));
    const { data } = await supabase.rpc('my_profile');
    if (data) {
      putProfile(data as Profile);
      sessionStore.set({ me: data as Profile });
    }
  }

  return (
    <>
      <h2>Profiles</h2>
      <div className="profile-editor">
        <div className="profile-editor-form">
          {msg && <div className="notice">{msg}</div>}
          {cropping && (
            <ImageCropper
              file={cropping.file}
              opts={cropping.kind === 'avatar' ? { aspect: 1, size: 512, round: true, title: 'Profile picture' } : { aspect: 3, size: 1500, title: 'Profile banner' }}
              onCancel={() => setCropping(null)}
              onDone={async (blob) => {
                const kind = cropping.kind;
                setCropping(null);
                try {
                  const path = `${me.id}/${kind}-${crypto.randomUUID().slice(0, 8)}.webp`;
                  const { error } = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/webp' });
                  if (error) throw error;
                  const url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
                  set(kind === 'avatar' ? { avatar_url: url } : { banner_url: url });
                } catch (e) {
                  setMsg(errorMessage(e));
                }
              }}
            />
          )}
          <div className="field">
            <div className="field-label">Pictures</div>
            <div className="picture-buttons">
              <button type="button" className="btn secondary small" onClick={() => pickPicture('avatar')}>
                <Icon name="upload" size={14} /> Profile picture
              </button>
              {preview.avatar_url && (
                <button type="button" className="btn link small" onClick={() => set({ avatar_url: null })}>
                  Remove
                </button>
              )}
              <button type="button" className="btn secondary small" onClick={() => pickPicture('banner')}>
                <Icon name="image" size={14} /> Banner
              </button>
              {preview.banner_url && (
                <button type="button" className="btn link small" onClick={() => set({ banner_url: null })}>
                  Remove
                </button>
              )}
            </div>
            <span className="field-hint">Cropped on your device. Saved as WebP, which also drops hidden photo data.</span>
          </div>
          <Field label="Display name">
            <input maxLength={32} value={preview.display_name} onChange={(e) => set({ display_name: e.target.value })} />
          </Field>
          <Field label="Username" hint="2-32 lowercase letters, numbers, dots and underscores. You can change it anytime — old links to @you keep working.">
            <div className="username-input">
              <span className="username-at">@</span>
              <input maxLength={32} value={preview.username} autoComplete="off" spellCheck={false} onChange={(e) => setUsernameDraft(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ''))} />
            </div>
          </Field>
          <Field label="Pronouns">
            <input maxLength={40} value={preview.pronouns ?? ''} placeholder="they/them" onChange={(e) => set({ pronouns: e.target.value })} />
          </Field>
          <Field label="Custom status" hint={`${(preview.status_text ?? '').length}/300 · shown as a bubble on your profile`}>
            <textarea rows={2} maxLength={300} value={preview.status_text ?? ''} placeholder="Listening to the new album" onChange={(e) => set({ status_text: e.target.value })} />
          </Field>
          <Field label="Online status">
            <Select value={preview.presence ?? 'online'} onChange={(v) => set({ presence: v as PresenceStatus })} options={PRESENCE.map((p) => ({ value: p.id, label: p.label, icon: <span className={`status-dot inline ${p.id}`} /> }))} />
          </Field>
          <Field label="About me" hint={`${(preview.about ?? '').length}/190 · markdown works`}>
            <textarea maxLength={190} rows={4} value={preview.about ?? ''} onChange={(e) => set({ about: e.target.value })} />
          </Field>
          <Field label="Avatar color" group>
            <ColorPicker value={preview.avatar_color} onChange={(c) => set({ avatar_color: c })} />
          </Field>
          <Field label="Banner" group aside={preview.banner_color2 ? <button className="btn link small" onClick={() => set({ banner_color2: null })}>Solid color</button> : <button className="btn link small" onClick={() => set({ banner_color2: '#000000' })}>Gradient</button>}>
            <div className="banner-pickers">
              <ColorPicker value={preview.banner_color ?? preview.avatar_color} onChange={(c) => set({ banner_color: c })} />
              {preview.banner_color2 && <ColorPicker value={preview.banner_color2} onChange={(c) => set({ banner_color2: c })} />}
            </div>
          </Field>
          <Field label="Profile frame" group hint="An animated ring around your picture.">
            <div className="frame-grid">
              {FRAMES.map((f) => (
                <button key={f.id} type="button" className={`frame-option${(preview.avatar_frame ?? 'none') === f.id ? ' selected' : ''}`} onClick={() => set({ avatar_frame: f.id })} aria-label={f.label} title={f.label}>
                  <Avatar profile={{ ...preview, avatar_frame: f.id }} size={44} />
                  <span>{f.label}</span>
                </button>
              ))}
            </div>
          </Field>
          <Field label="Name style" group hint="Font, colours (two or three make a gradient) and an animation.">
            <div className="name-style-editor">
              <Select
                value={preview.name_style?.font ?? 'default'}
                onChange={(v) => set({ name_style: { ...(preview.name_style ?? {}), font: v as NameFont } })}
                options={NAME_FONTS.map((f) => ({ value: f.id, label: f.label }))}
                ariaLabel="Font"
              />
              <Select
                value={preview.name_style?.effect ?? 'none'}
                onChange={(v) => set({ name_style: { ...(preview.name_style ?? {}), effect: v as NameEffect } })}
                options={NAME_EFFECTS.map((f) => ({ value: f.id, label: f.label }))}
                ariaLabel="Animation"
              />
              <div className="name-colors">
                {(preview.name_style?.colors ?? []).map((c, i) => (
                  <span key={i} className="name-color">
                    <input type="color" value={c} aria-label={`Colour ${i + 1}`} onChange={(e) => set({ name_style: { ...(preview.name_style ?? {}), colors: (preview.name_style?.colors ?? []).map((x, j) => (j === i ? e.target.value : x)) } })} />
                    <button type="button" className="pill-x" aria-label="Remove colour" onClick={() => set({ name_style: { ...(preview.name_style ?? {}), colors: (preview.name_style?.colors ?? []).filter((_, j) => j !== i) } })}>
                      ×
                    </button>
                  </span>
                ))}
                {(preview.name_style?.colors ?? []).length < 3 && (
                  <button type="button" className="btn secondary small" onClick={() => set({ name_style: { ...(preview.name_style ?? {}), colors: [...(preview.name_style?.colors ?? []), ['#ff6ec4', '#7873f5', '#4ade80'][(preview.name_style?.colors ?? []).length]] } })}>
                    + Colour
                  </button>
                )}
              </div>
              <div className="name-style-preview">
                <StyledName style={preview.name_style}>{preview.display_name}</StyledName>
              </div>
              <button type="button" className="btn link small" onClick={() => publishCosmetic('name_style')}>
                Publish to the Marketplace
              </button>
            </div>
          </Field>
          <Field label="Nameplate" group hint="An animated backdrop behind your name in member lists.">
            <div className="nameplate-grid">
              {[...NAMEPLATES, { id: 'custom', label: 'Custom' }].map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={`nameplate-option nameplate-${n.id}${(preview.nameplate ?? 'none') === n.id ? ' selected' : ''}`}
                  style={n.id === 'custom' ? nameplateVars({ nameplate: 'custom', nameplate_style: preview.nameplate_style?.colors?.length ? preview.nameplate_style : { colors: ['#ff6ec4', '#7873f5'] } }) : undefined}
                  onClick={() => set(n.id === 'custom' && !preview.nameplate_style?.colors?.length ? { nameplate: 'custom', nameplate_style: { colors: ['#ff6ec4', '#7873f5'], pattern: 'sweep' } } : { nameplate: n.id })}
                >
                  {n.label}
                </button>
              ))}
            </div>
            {preview.nameplate === 'custom' && (
              <div className="name-style-editor">
                <div className="name-colors">
                  {(preview.nameplate_style?.colors ?? []).map((c, i) => (
                    <input key={i} type="color" value={c} aria-label={`Nameplate colour ${i + 1}`} onChange={(e) => set({ nameplate_style: { ...(preview.nameplate_style ?? {}), colors: (preview.nameplate_style?.colors ?? []).map((x, j) => (j === i ? e.target.value : x)) } })} />
                  ))}
                  {(preview.nameplate_style?.colors ?? []).length < 3 && (
                    <button type="button" className="btn secondary small" onClick={() => set({ nameplate_style: { ...(preview.nameplate_style ?? {}), colors: [...(preview.nameplate_style?.colors ?? []), '#4ade80'] } })}>
                      + Colour
                    </button>
                  )}
                </div>
                <Select
                  value={preview.nameplate_style?.pattern ?? 'sweep'}
                  onChange={(v) => set({ nameplate_style: { ...(preview.nameplate_style ?? {}), pattern: v as 'sweep' } })}
                  options={[
                    { value: 'sweep', label: 'Sweep' },
                    { value: 'stripes', label: 'Stripes' },
                    { value: 'dots', label: 'Dots' },
                    { value: 'waves', label: 'Waves' },
                  ]}
                  ariaLabel="Pattern"
                />
                <button type="button" className="btn link small" onClick={() => publishCosmetic('nameplate')}>
                  Publish to the Marketplace
                </button>
              </div>
            )}
          </Field>
          <Field label="Server tag" group hint="Wear a tag from a server you’re in. Server owners set tags in Server Settings.">
            <div className="tag-options">
              <button type="button" className={`tag-option${!me.tag_server_id ? ' selected' : ''}`} onClick={() => setTag(null)}>
                None
              </button>
              {tagServers.map((s) => (
                <button key={s.id} type="button" className={`tag-option${me.tag_server_id === s.id ? ' selected' : ''}`} onClick={() => setTag(s.id)}>
                  <ServerTag tag={s.tag} /> {s.name}
                </button>
              ))}
            </div>
          </Field>
          <div className={`save-bar${dirty ? ' show' : ''}`}>
            <span>You have unsaved changes</span>
            <button className="btn link" onClick={() => { setDraft({}); setUsernameDraft(null); }}>
              Reset
            </button>
            <button className="btn primary small" disabled={busy} onClick={save}>
              Save Changes
            </button>
          </div>
        </div>
        <div className="profile-editor-preview">
          <div className="field-label">Preview</div>
          <div className={`profile-card mini nameplate-${preview.nameplate ?? 'none'}`} style={nameplateVars(preview)}>
            <div className="profile-banner" style={bannerStyle(preview)} />
            <div className="profile-head">
              <div className="profile-avatar">
                <Avatar profile={preview} size={72} online />
              </div>
            </div>
            <div className="profile-body">
              <h2>
                <StyledName style={preview.name_style}>{preview.display_name}</StyledName> <Badges ids={me.badges} size={16} />
              </h2>
              <div className="muted">
                @{me.username}
                {preview.pronouns ? ` · ${preview.pronouns}` : ''} <ServerTag tag={me.server_tag} />
              </div>
              {!!preview.status_text && <div className="status-bubble">{preview.status_text}</div>}
              {preview.about && (
                <div className="profile-bio">
                  <Markdown text={preview.about} />
                </div>
              )}
            </div>
          </div>
          <div className="preview-caption">In member lists, your nameplate looks like:</div>
          <div className={`member nameplate-preview nameplate-row nameplate-${preview.nameplate ?? 'none'}`} style={nameplateVars(preview)}>
            <Avatar profile={preview} size={32} online />
            <span className="member-text">
              <span className="member-name">
                <StyledName style={preview.name_style}>{preview.display_name}</StyledName>
              </span>
              {!!preview.status_text && (
                <span className="status-bubble mini" title={preview.status_text}>
                  {preview.status_text}
                </span>
              )}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

const FRAMES: { id: AvatarFrame; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'neon', label: 'Neon' },
  { id: 'flame', label: 'Flame' },
  { id: 'frost', label: 'Frost' },
  { id: 'rainbow', label: 'Rainbow' },
  { id: 'gold', label: 'Gold' },
  { id: 'sakura', label: 'Sakura' },
  { id: 'pixel', label: 'Pixel' },
  { id: 'orbit', label: 'Orbit' },
  { id: 'hearts', label: 'Hearts' },
  { id: 'glitch', label: 'Glitch' },
];
const NAME_FONTS: { id: NameFont; label: string }[] = [
  { id: 'default', label: 'Default font' },
  { id: 'serif', label: 'Serif' },
  { id: 'mono', label: 'Code' },
  { id: 'rounded', label: 'Rounded' },
  { id: 'handwritten', label: 'Handwritten' },
  { id: 'display', label: 'Bold display' },
  { id: 'pixel', label: 'Retro' },
];
const NAME_EFFECTS: { id: NameEffect; label: string }[] = [
  { id: 'none', label: 'No animation' },
  { id: 'shimmer', label: 'Shimmer' },
  { id: 'glow', label: 'Glow' },
  { id: 'rainbow', label: 'Rainbow' },
  { id: 'pulse', label: 'Pulse' },
];

// --------------------------------------------------------------- privacy --

function PrivacyTab() {
  const relations = socialStore.use((s) => s.relations);
  const blocked = Object.values(relations).filter((r) => r.blocked);
  return (
    <>
      <h2>Privacy & Safety</h2>
      <Section title={`Blocked users — ${blocked.length}`} desc="Blocked people can’t message you, call you or send friend requests, and their messages are hidden.">
        {blocked.map((r) => (
          <div key={r.target_id} className="list-row">
            <Avatar profile={getProfile(r.target_id)} size={32} />
            <span className="grow">
              {displayName(r.target_id)} <span className="muted small">@{getProfile(r.target_id)?.username}</span>
            </span>
            <button className="btn secondary small" onClick={() => setRelation(r.target_id, { blocked: false })}>
              Unblock
            </button>
          </div>
        ))}
        {!blocked.length && <p className="muted small">You haven’t blocked anyone.</p>}
      </Section>
      <Section title="What the server can see">
        <ul className="security-list">
          <li>Your messages, files, calls and translations are end-to-end encrypted. Venband’s server can’t read them.</li>
          <li>The server does know who is in which server or DM, and when messages were sent.</li>
          <li>Links to YouTube, Spotify, Instagram and TikTok only load when you click them (unless you turn on auto-load in Chat), because loading them shows those sites your IP address.</li>
        </ul>
      </Section>
    </>
  );
}

// --------------------------------------------------------------- devices --

function DevicesTab() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    listDevices()
      .then(setDevices)
      .catch((e) => setError(errorMessage(e)));
  useEffect(() => {
    load();
  }, []);
  const others = (devices ?? []).filter((d) => !d.current);

  async function revoke(d: Device) {
    try {
      await revokeDevice(d.id);
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <>
      <h2>Devices</h2>
      <p className="muted">Here are all the devices currently logged in to your account. Log out any you don’t recognise, then change your password.</p>
      {error && <div className="form-error">{error}</div>}
      {!devices && !error && <div className="spinner" />}
      {devices && (
        <>
          <Section title="Current device">
            {devices.filter((d) => d.current).map((d) => (
              <DeviceRow key={d.id} d={d} />
            ))}
          </Section>
          <Section title={`Other devices — ${others.length}`}>
            {others.map((d) => (
              <DeviceRow key={d.id} d={d} onRevoke={() => revoke(d)} />
            ))}
            {!others.length && <p className="muted small">You’re not logged in anywhere else.</p>}
            {others.length > 1 && (
              <button
                className="btn danger small"
                onClick={async () => {
                  if (!(await askConfirm({ title: 'Log out all known devices', body: 'Every other device will be logged out.', confirm: 'Log Out All', danger: true }))) return;
                  for (const d of others) await revokeDevice(d.id).catch(() => {});
                  load();
                }}
              >
                Log out all other devices
              </button>
            )}
          </Section>
        </>
      )}
    </>
  );
}

function DeviceRow({ d, onRevoke }: { d: Device; onRevoke?: () => void }) {
  const ua = describeAgent(d.user_agent);
  const place = [d.city, d.region, d.city || d.region ? '' : d.country].filter(Boolean).join(', ');
  return (
    <div className="device-row">
      <span className="device-icon">
        <Icon name={ua.mobile ? 'phoneDevice' : 'monitor'} size={22} />
      </span>
      <div className="grow">
        <div className="device-title">
          {ua.os} · {ua.browser}
          {d.current && <span className="tag-soft accent">This device</span>}
        </div>
        <div className="small muted">
          {place || 'Unknown location'}
          {' · '}
          {d.current ? 'Active now' : `Last active ${relative(d.last_active)}`}
          {' · '}signed in {new Date(d.created_at).toLocaleDateString()}
        </div>
      </div>
      {onRevoke && (
        <button className="icon-btn" title="Log out this device" onClick={onRevoke}>
          <Icon name="x" size={18} />
        </button>
      )}
    </div>
  );
}

function relative(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

// ------------------------------------------------------------ appearance --

interface MarketTheme {
  id: string;
  author_id: string;
  name: string;
  description: string;
  data: Theme;
  installs: number;
  created_at: string;
}

export function ThemeSwatch({ t }: { t: Theme }) {
  const v = t.vars;
  return (
    <div className="theme-swatch" style={{ background: t.wallpaper && t.wallpaper !== 'none' ? t.wallpaper : v['bg-0'] }}>
      <div className="ts-rail" style={{ background: v['bg-1'] }} />
      <div className="ts-side" style={{ background: v['bg-2'] }}>
        <span style={{ background: v['bg-4'] }} />
        <span style={{ background: v['bg-3'] }} />
      </div>
      <div className="ts-main" style={{ background: v['bg-3'] }}>
        <span style={{ background: v.text }} />
        <span style={{ background: v['text-2'] }} />
        <span className="ts-accent" style={{ background: v.accent }} />
      </div>
    </div>
  );
}

function AppearanceTab() {
  const themeId = useSettings((s) => s.themeId);
  const installed = useSettings((s) => s.installedThemes);
  const reduceMotion = useSettings((s) => s.chat.reduceMotion);
  const serverThemes = useSettings((s) => s.serverThemes);
  const me = sessionStore.use((s) => s.me)!;
  const [view, setView] = useState<'themes' | 'market' | 'create' | 'looks'>('themes');
  const [market, setMarket] = useState<MarketTheme[] | null>(null);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const loadMarket = async () => {
    const { data, error } = await supabase.from('themes').select('*').eq('kind', 'theme').order('installs', { ascending: false }).order('created_at', { ascending: false }).limit(100);
    if (error) setMsg(errorMessage(error));
    setMarket((data ?? []) as MarketTheme[]);
  };
  useEffect(() => {
    if (view === 'market') loadMarket();
  }, [view]);

  const install = async (mt: MarketTheme) => {
    const t = sanitizeTheme({ ...mt.data, id: `market-${mt.id}`, name: mt.name, description: mt.description, author: displayName(mt.author_id) });
    if (!t) return setMsg('That theme is invalid.');
    updateSettings((s) => ({ installedThemes: [...s.installedThemes.filter((x) => x.id !== t.id), t], themeId: t.id }));
    await supabase.rpc('install_theme', { p_theme: mt.id });
    setMsg(`Installed ${t.name}.`);
  };

  const filtered = (market ?? []).filter((t) => !q || `${t.name} ${t.description}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <h2>Appearance</h2>
      <div className="tabs">
        <button className={view === 'themes' ? 'active' : ''} onClick={() => setView('themes')}>
          My Themes
        </button>
        <button className={view === 'market' ? 'active' : ''} onClick={() => setView('market')}>
          <Icon name="sparkles" size={14} /> Theme Marketplace
        </button>
        <button className={view === 'create' ? 'active' : ''} onClick={() => setView('create')}>
          <Icon name="plus" size={14} /> Create a Theme
        </button>
        <button className={view === 'looks' ? 'active' : ''} onClick={() => setView('looks')}>
          <Icon name="image" size={14} /> Background & CSS
        </button>
      </div>
      {view === 'looks' && <LooksPanel />}
      {msg && <div className="notice">{msg}</div>}
      {view === 'themes' && (
        <>
          <div className="theme-grid">
            {[...BUILT_IN_THEMES, ...installed].map((t) => (
              <div key={t.id} className={`theme-card${themeId === t.id ? ' selected' : ''}`}>
                <button className="theme-pick" onClick={() => updateSettings({ themeId: t.id })}>
                  <ThemeSwatch t={t} />
                  <div className="theme-name">
                    {t.name}
                    {themeId === t.id && <Icon name="check" size={14} />}
                  </div>
                  <div className="small muted">{t.author ? `by ${t.author}` : t.description}</div>
                </button>
                {!BUILT_IN_THEMES.some((b) => b.id === t.id) && (
                  <button
                    className="icon-btn theme-remove"
                    title="Uninstall"
                    onClick={() =>
                      updateSettings((s) => ({ installedThemes: s.installedThemes.filter((x) => x.id !== t.id), themeId: s.themeId === t.id ? 'default' : s.themeId }))
                    }
                  >
                    <Icon name="trash" size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <Section title="Server themes" desc="Servers can have their own colors. Choose how they apply to you.">
            <div className="radio-cards">
              {(
                [
                  ['override', 'Use the server’s look', 'While you’re in a server, its colors replace yours.'],
                  ['merge', 'Just the accent color', 'Keep your theme, take only the server’s accent color.'],
                  ['never', 'Always my theme', 'Ignore server themes.'],
                ] as const
              ).map(([id, label, desc]) => (
                <label key={id} className={`radio-card${serverThemes === id ? ' selected' : ''}`}>
                  <input type="radio" name="serverthemes" checked={serverThemes === id} onChange={() => updateSettings({ serverThemes: id })} />
                  <b>{label}</b>
                  <span className="small muted">{desc}</span>
                </label>
              ))}
            </div>
          </Section>
          <Section title="Motion">
            <Toggle label="Reduce motion" desc="Turn off animations and transitions." checked={reduceMotion} onChange={(v) => updateChat({ reduceMotion: v })} />
          </Section>
        </>
      )}
      {view === 'market' && (
        <>
          <input className="search-input" placeholder="Search themes" value={q} onChange={(e) => setQ(e.target.value)} />
          {!market && <div className="spinner" />}
          <div className="theme-grid">
            {filtered.map((mt) => {
              const t = sanitizeTheme(mt.data);
              if (!t) return null;
              const have = installed.some((x) => x.id === `market-${mt.id}`);
              return (
                <div key={mt.id} className="theme-card">
                  <ThemeSwatch t={t} />
                  <div className="theme-name">{mt.name}</div>
                  <div className="small muted">
                    by {displayName(mt.author_id) === 'Unknown user' ? 'a Venband user' : displayName(mt.author_id)} · {mt.installs} installs
                  </div>
                  {mt.description && <div className="small">{mt.description}</div>}
                  <div className="theme-actions">
                    <button className="btn primary small" disabled={have} onClick={() => install(mt)}>
                      {have ? 'Installed' : 'Install'}
                    </button>
                    {(mt.author_id === me.id || me.platform_role !== 'user') && (
                      <button
                        className="btn danger small"
                        onClick={async () => {
                          if (!(await askConfirm({ title: 'Remove theme', body: `Remove “${mt.name}” from the marketplace?`, confirm: 'Remove', danger: true }))) return;
                          const { error } = await supabase.from('themes').delete().eq('id', mt.id);
                          if (error) setMsg(errorMessage(error));
                          loadMarket();
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {market && !filtered.length && <p className="muted">No themes yet. Be the first: create one and publish it.</p>}
        </>
      )}
      {view === 'create' && <ThemeCreator onDone={(m) => (setMsg(m), setView('themes'))} />}
    </>
  );
}

const EDITABLE: { key: (typeof THEME_KEYS)[number]; label: string }[] = [
  { key: 'bg-0', label: 'Background' },
  { key: 'bg-1', label: 'Server rail' },
  { key: 'bg-2', label: 'Sidebars' },
  { key: 'bg-3', label: 'Chat' },
  { key: 'bg-4', label: 'Inputs & hover' },
  { key: 'text', label: 'Text' },
  { key: 'text-2', label: 'Secondary text' },
  { key: 'muted', label: 'Muted text' },
  { key: 'accent', label: 'Accent' },
  { key: 'on-accent', label: 'Text on accent' },
  { key: 'link', label: 'Links' },
  { key: 'danger', label: 'Danger' },
];

const WALLPAPERS = [
  'none',
  'radial-gradient(1200px 800px at 15% 10%, #3b3f58 0%, transparent 60%), radial-gradient(900px 700px at 85% 90%, #2a3d44 0%, transparent 60%), linear-gradient(160deg, #07070a, #0d0e14)',
  'linear-gradient(135deg, #1f1c2c, #3a2f5b, #12101a)',
  'linear-gradient(160deg, #0f2027, #203a43, #2c5364)',
  'radial-gradient(900px 600px at 80% 10%, #5b2a3d 0%, transparent 60%), linear-gradient(180deg, #0a0608, #120a10)',
  'linear-gradient(135deg, #0b3a2c, #06221a 60%, #000000)',
];

function ThemeCreator({ onDone }: { onDone: (msg: string) => void }) {
  const me = sessionStore.use((s) => s.me)!;
  const [name, setName] = useState('My theme');
  const [description, setDescription] = useState('');
  const [vars, setVars] = useState<Record<string, string>>({ ...BUILT_IN_THEMES[0].vars });
  const [glass, setGlass] = useState(false);
  const [wallpaper, setWallpaper] = useState('none');
  const [error, setError] = useState<string | null>(null);
  const theme = useMemo(
    () => sanitizeTheme({ id: `custom-${Date.now()}`, name, description, vars, glass, wallpaper: wallpaper === 'none' ? undefined : wallpaper, author: me.display_name }),
    [name, description, vars, glass, wallpaper, me.display_name],
  );
  const preview = useRef<Theme | null>(null);
  preview.current = theme;

  const startFrom = (t: Theme) => {
    setVars({ ...t.vars });
    setGlass(Boolean(t.glass));
    setWallpaper(t.wallpaper ?? 'none');
  };

  return (
    <div className="theme-creator">
      <div className="theme-creator-form">
        {error && <div className="form-error">{error}</div>}
        <Field label="Start from">
          <div className="tag-options">
            {BUILT_IN_THEMES.map((t) => (
              <button key={t.id} type="button" className="tag-option" onClick={() => startFrom(t)}>
                {t.name}
              </button>
            ))}
          </div>
        </Field>
        <div className="row">
          <Field label="Name">
            <input maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Description">
            <input maxLength={140} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        <div className="color-grid">
          {EDITABLE.map((e) => (
            <label key={e.key} className="color-cell">
              <input type="color" value={(vars[e.key] ?? '#000000').slice(0, 7)} onChange={(ev) => setVars((v) => ({ ...v, [e.key]: ev.target.value }))} />
              <span>{e.label}</span>
            </label>
          ))}
        </div>
        <Toggle label="Frosted glass" desc="See-through panels over the wallpaper." checked={glass} onChange={setGlass} />
        <Field label="Wallpaper">
          <div className="wallpaper-grid">
            {WALLPAPERS.map((w) => (
              <button key={w} type="button" className={`wallpaper-option${wallpaper === w ? ' selected' : ''}`} style={{ background: w === 'none' ? vars['bg-0'] : w }} onClick={() => setWallpaper(w)}>
                {w === 'none' && 'None'}
              </button>
            ))}
          </div>
        </Field>
        <div className="modal-actions">
          <button
            className="btn secondary"
            onClick={() => {
              if (!theme) return setError('Pick valid colors.');
              updateSettings((s) => ({ installedThemes: [...s.installedThemes, theme], themeId: theme.id }));
              onDone(`Saved “${theme.name}” to My Themes.`);
            }}
          >
            Save to my themes
          </button>
          <button
            className="btn primary"
            onClick={async () => {
              if (!theme) return setError('Pick valid colors.');
              const { error } = await supabase.from('themes').insert({ author_id: me.id, name: theme.name, description: theme.description, data: theme });
              if (error) return setError(errorMessage(error));
              updateSettings((s) => ({ installedThemes: [...s.installedThemes, theme], themeId: theme.id }));
              onDone(`Published “${theme.name}” to the marketplace.`);
            }}
          >
            Publish to marketplace
          </button>
        </div>
      </div>
      <div className="theme-creator-preview">
        <div className="field-label">Preview</div>
        {theme && <ThemeSwatch t={theme} />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ voice/video --

function VoiceTab() {
  const v = useSettings((s) => s.voice);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const list = () => navigator.mediaDevices?.enumerateDevices().then(setDevices).catch(() => {});
  useEffect(() => {
    list();
    navigator.mediaDevices?.addEventListener('devicechange', list);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', list);
  }, []);
  const named = devices.some((d) => d.label);

  // mic test meter
  useEffect(() => {
    if (!testing) return;
    let stop = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    (async () => {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: v.inputId ? { ideal: v.inputId } : undefined, noiseSuppression: v.noiseSuppression, echoCancellation: v.echoCancellation, autoGainControl: v.autoGain },
      });
      list();
      ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      const g = ctx.createGain();
      g.gain.value = v.inputVolume / 100;
      ctx.createMediaStreamSource(stream).connect(g).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const loop = () => {
        if (stop) return;
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (const x of buf) peak = Math.max(peak, Math.abs(x - 128));
        setLevel(Math.min(1, peak / 100));
        requestAnimationFrame(loop);
      };
      loop();
    })().catch(() => setTesting(false));
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close();
      setLevel(0);
    };
  }, [testing, v.inputId, v.inputVolume, v.noiseSuppression, v.echoCancellation, v.autoGain]);

  const select = (kind: MediaDeviceKind, value: string, onChange: (id: string) => void) => (
    <Select
      value={value}
      onChange={onChange}
      options={[
        { value: '', label: 'Default' },
        ...devices
          .filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'default')
          .map((d, i) => ({ value: d.deviceId, label: d.label || `${kind === 'audioinput' ? 'Microphone' : kind === 'audiooutput' ? 'Speaker' : 'Camera'} ${i + 1}` })),
      ]}
    />
  );

  return (
    <>
      <h2>Voice & Video</h2>
      {!named && (
        <div className="notice">
          Your browser hides device names until you allow microphone access.{' '}
          <button className="btn link" onClick={() => setTesting(true)}>
            Allow and show names
          </button>
        </div>
      )}
      <Section title="Devices">
        <div className="row">
          <Field label="Input device">{select('audioinput', v.inputId, (id) => updateVoice({ inputId: id }))}</Field>
          <Field label="Output device" hint={'setSinkId' in AudioContext.prototype ? undefined : 'Your browser always uses the system output.'}>
            {select('audiooutput', v.outputId, (id) => updateVoice({ outputId: id }))}
          </Field>
        </div>
        <Field label="Camera">{select('videoinput', v.cameraId, (id) => updateVoice({ cameraId: id }))}</Field>
        <Field label={`Input volume — ${v.inputVolume}%`}>
          <input type="range" min={0} max={200} step={5} value={v.inputVolume} onChange={(e) => updateVoice({ inputVolume: Number(e.target.value) })} />
        </Field>
        <div className="mic-test">
          <button className="btn secondary small" onClick={() => setTesting((t) => !t)}>
            {testing ? 'Stop test' : 'Let’s check'}
          </button>
          <div className="mic-meter">
            <span style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
        </div>
        <p className="small muted">Changes apply the next time you join a call.</p>
      </Section>
      <Section title="Voice processing">
        <Toggle label="Noise suppression" desc="Filters out background noise like fans and keyboards." checked={v.noiseSuppression} onChange={(x) => updateVoice({ noiseSuppression: x })} />
        <Toggle label="Echo cancellation" desc="Stops others hearing themselves through your speakers." checked={v.echoCancellation} onChange={(x) => updateVoice({ echoCancellation: x })} />
        <Toggle label="Automatic gain control" desc="Keeps your volume steady." checked={v.autoGain} onChange={(x) => updateVoice({ autoGain: x })} />
      </Section>
      <Section title="When you join a call">
        <Toggle label="Join muted" desc="Starts with your microphone off every time you join a call. You can unmute any time." checked={v.joinMuted} onChange={(x) => updateVoice({ joinMuted: x })} />
      </Section>
      <Section title="Screen share quality" desc="Higher quality needs a faster connection, for you and for everyone watching.">
        <div className="row">
          <Field label="Resolution">
            <div className="seg">
              {([720, 1080, 1440] as const).map((r) => (
                <button key={r} className={v.streamRes === r ? 'active' : ''} onClick={() => updateVoice({ streamRes: r })}>
                  {r}p
                </button>
              ))}
            </div>
          </Field>
          <Field label="Frame rate">
            <div className="seg">
              {([15, 30, 60] as const).map((f) => (
                <button key={f} className={v.streamFps === f ? 'active' : ''} onClick={() => updateVoice({ streamFps: f })}>
                  {f} fps
                </button>
              ))}
            </div>
          </Field>
        </div>
      </Section>
      <button className="btn link" onClick={() => updateSettings({ voice: DEFAULT_SETTINGS.voice })}>
        Reset voice settings
      </button>
    </>
  );
}

// ------------------------------------------------------------------ chat --

function ChatTab() {
  const c = useSettings((s) => s.chat);
  return (
    <>
      <h2>Chat</h2>
      <Section title="Embeds and media">
        <Toggle
          label="Load embeds automatically"
          desc="Show YouTube, Spotify, Instagram and TikTok players right away. Off means you click to load each one (more private)."
          checked={c.autoEmbeds}
          onChange={(v) => updateChat({ autoEmbeds: v })}
        />
        <Toggle label="Autoplay GIFs" checked={c.gifAutoplay} onChange={(v) => updateChat({ gifAutoplay: v })} />
        <Toggle
          label="Add previews to links I send"
          desc="Shows the site name, title and description under your links. Venband’s server fetches the page for you (people you chat with never contact the site), and the preview is encrypted with your message."
          checked={c.linkPreviews}
          onChange={(v) => updateChat({ linkPreviews: v })}
        />
      </Section>
      <Section title="Images & videos" desc="Attachments in messages. Very large files always wait for a click, whatever you choose here.">
        <Select
          value={c.mediaAutoload}
          onChange={(v) => updateChat({ mediaAutoload: v as 'always' | 'wifi' | 'click' })}
          options={[
            { value: 'always', label: 'Load automatically (recommended)' },
            { value: 'wifi', label: 'Only on Wi-Fi or broadband' },
            { value: 'click', label: 'Only when I click them' },
          ]}
        />
      </Section>
      <Section title="Link safety" desc="Venband checks links for look-alike letters, fake brand names, hidden destinations and short links before they open.">
        <Field label="Ask before opening links">
          <Select
            value={c.linkWarnings}
            onChange={(v) => updateChat({ linkWarnings: v as 'always' | 'risky' | 'off' })}
            options={[
              { value: 'always', label: 'For every site I haven’t trusted (recommended)' },
              { value: 'risky', label: 'Only when a link looks risky' },
              { value: 'off', label: 'Only for dangerous links' },
            ]}
          />
        </Field>
        <TrustedSites />
      </Section>
      <Section title="Servers">
        <Toggle label="Show join messages" desc="“Someone just joined” notices in welcome channels." checked={c.showJoins} onChange={(v) => updateChat({ showJoins: v })} />
      </Section>
      <Section title="Spelling" desc="Checked on this device with a built-in English dictionary — your text is never sent anywhere.">
        <div className="radio-cards">
          {(
            [
              ['off', 'Off', 'No spell checking.'],
              ['suggest', 'Underline mistakes', 'Wavy underline under misspelled words. Right-click (or long-press) a word, or highlight it, for corrections.'],
              ['auto', 'Fix automatically', 'Common typos are corrected hands-free as you type (teh → the, dont → don’t).'],
            ] as const
          ).map(([id, label, desc]) => (
            <label key={id} className={`radio-card${c.autocorrect === id ? ' selected' : ''}`}>
              <input type="radio" name="autocorrect" checked={c.autocorrect === id} onChange={() => updateChat({ autocorrect: id })} />
              <b>{label}</b>
              <span className="small muted">{desc}</span>
            </label>
          ))}
        </div>
      </Section>
      <Section title="Code blocks" desc="Colours for ```code``` in messages, like your code editor.">
        <Select value={c.codeTheme} onChange={(v) => updateChat({ codeTheme: v as typeof c.codeTheme })} options={CODE_THEMES.map((t) => ({ value: t.id, label: t.label }))} />
        <div className="md-codeblock-preview">
          <Markdown text={'```js\n// greet everyone\nconst names = ["Sam", "Ari"];\nfor (const n of names) console.log(`Hi ${n}!`, 42);\n```'} />
        </div>
      </Section>
      <Section title="Messages">
        <Toggle
          label="Send long messages as a file"
          desc="Messages over 2,000 characters are sent as message.txt instead of a giant wall of text."
          checked={c.longTextAsFile}
          onChange={(v) => updateChat({ longTextAsFile: v })}
        />
        <Toggle label="Keep unsent drafts" desc="If you leave a conversation (or close Venband) while typing, your text is still there when you come back. Stored on this device only." checked={c.saveDrafts} onChange={(v) => updateChat({ saveDrafts: v })} />
        <Toggle
          label="Press Enter to send"
          desc="On: Enter sends the message and Shift+Enter adds a new line. Off: Enter adds a new line and you send with Ctrl+Enter (or Cmd+Enter on Mac)."
          checked={c.enterToSend}
          onChange={(v) => updateChat({ enterToSend: v })}
        />
        <Toggle label="24-hour clock" checked={c.clock24} onChange={(v) => updateChat({ clock24: v })} />
      </Section>
      <Section title="Formatting cheat sheet">
        <div className="md-cheats">
          {['**bold**', '*italic*', '__underline__', '~~strike~~', '||spoiler||', '`code`', '# Big heading', '-# small text', '> quote', '- list item', '[link](https://venband.com)', '@everyone'].map((x) => (
            <div key={x} className="md-cheat">
              <code>{x}</code>
              <span>
                <Markdown text={x} />
              </span>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

// -------------------------------------------------------------- language --

function LanguageTab() {
  const language = useSettings((s) => s.language);
  const mode = useSettings((s) => s.translateMode);
  const me = sessionStore.use((s) => s.me)!;
  const device = deviceTranslationSupported();
  return (
    <>
      <h2>Language</h2>
      <Section title="Your language" desc="Messages in other languages can be translated into this one.">
        <Select
          value={language || navigator.language.split('-')[0]}
          searchable
          onChange={(v) => {
            updateSettings({ language: v });
            updateMyProfile({ language: v }).catch(() => {});
            void me;
          }}
          options={LANGUAGES.map((l) => ({ value: l.code, label: `${l.native} — ${l.name}` }))}
        />
      </Section>
      <Section title="Translation" desc="Translation happens on your device, so encrypted messages stay private.">
        <div className="notice small">
          Venband translates into {LANGUAGES.length} languages with nothing to download: a built-in phrasebook ({PHRASEBOOK_SIZE} common phrases and words in {PHRASEBOOK_LANGS.length} languages), a letter-by-letter writer that spells any unknown word in your language's alphabet, and a server-backed translator for full sentences.
          {device ? ' Your browser also has on-device translation, which Venband uses first when its language model is ready.' : ''}
        </div>
        <div className="radio-cards">
          {(
            [
              ['auto', 'Automatic', 'Translate messages in other languages as they arrive.'],
              ['manual', 'Manual', 'Right-click a message and choose Translate.'],
              ['off', 'Off', 'Never translate.'],
            ] as const
          ).map(([id, label, desc]) => (
            <label key={id} className={`radio-card${mode === id ? ' selected' : ''}`}>
              <input type="radio" checked={mode === id} onChange={() => updateSettings({ translateMode: id })} />
              <b>{label}</b>
              <span className="small muted">{desc}</span>
            </label>
          ))}
        </div>
      </Section>
    </>
  );
}

function TrustedSites() {
  const trusted = useSettings((s) => s.trustedDomains);
  if (!trusted.length) return <p className="small muted">You haven’t trusted any sites yet.</p>;
  return (
    <div className="chip-row">
      {trusted.map((d) => (
        <span key={d} className="chip">
          {d}{' '}
          <button className="pill-x" aria-label={`Stop trusting ${d}`} onClick={() => updateSettings((s) => ({ trustedDomains: s.trustedDomains.filter((x) => x !== d) }))}>
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
