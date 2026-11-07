import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { LooksPanel } from './LooksSettings';
import { supabase, errorMessage, isOldSchema } from '../lib/supabase';
import { changePassword, sessionStore, signOut, updateMyProfile, type ProfilePatch } from '../lib/session';
import { fingerprint, passwordStrength } from '../lib/crypto';
import { displayName, getProfile, loadProfiles, putProfile } from '../lib/directory';
import { closeSettings, uiStore, type SettingsTab } from '../lib/ui';
import { inventoryStore, loadInventory, ownedOptions } from '../lib/inventory';
import { createMicChain, isolationSupported, type MicChain } from '../lib/micChain';
import { SpecialTab } from './Special';
import { openFriends } from '../hooks/data';
import { DEFAULT_SETTINGS, updateChat, updateSettings, updateVoice, useSettings } from '../lib/settings';
import { BUILT_IN_THEMES } from '../lib/themes';
import { ThemeCreator, ThemeSwatch, MyThemes, InstalledThemeUpdates, type EditingTheme } from './ThemeStudio';
import { categoryLabel, recordInstall, THEME_CATEGORIES, themeFrom, type MarketItem } from '../lib/themeMarket';
import { describeAgent, listDevices, revokeDevice, type Device } from '../lib/devices';
import { setRelation, socialStore } from '../lib/social';
import { LANGUAGES, deviceTranslationSupported } from '../lib/translate';
import { CODE_THEMES } from '../lib/codeLanguages';
import { PHRASEBOOK_LANGS, PHRASEBOOK_SIZE } from '../lib/phrasebook';
import type { AvatarFrame, NameEffect, NameFont, PresenceStatus, Profile, Server } from '../lib/types';
import { Avatar, ColorPicker, Field, Icon, nameplateVars, StyledName, Slider } from './ui';
import { ImageCropper } from './ImageCropper';
import { askText, showAlert } from './Dialogs';
import { Select } from './Select';
import { go } from '../lib/router';
import { VERSION } from '../lib/version';
import { connectBot, deleteApp as deleteAppRpc, disconnectBot, listMyBots, type MyBotRow } from '../lib/bots';
import { ServerUpdateCard } from './Apps';
import { Badges } from './Badges';
import { BadgeDisplayPicker } from './BadgePicker';
import { accountAge, bannerStyle, NAMEPLATES, ServerTag } from './People';
import { EFFECT_LIST, FRAME_LIST, NameplateArt, ProfileEffect } from './Cosmetics';
import { askConfirm } from './Dialogs';
import { BadgeDesigner, DiscoveryQueue, ModerationCenter, ReportCentre } from './Moderation';
import { AppealsQueue } from './Appeals';
import { setShareGames, shareGames } from '../lib/activity';
import { SoundSettings } from './SoundSettings';
import { showToast } from './Undo';
import { useStaffPerms, type StaffPerm } from '../lib/staff';
import { Markdown } from './Markdown';
import { SecurityTab } from './Security';
import {
  connectionsVersion,
  myConnections,
  PROVIDERS,
  reloadConnections,
  removeConnection,
  spotifyLogin,
  steamLogin,
  tiktokLogin,
  youtubeLogin,
  subscribeConnections,
  type ConnectionProvider,
  type ConnectionRow,
} from '../lib/connections';

const TABS: { id: SettingsTab; label: string; icon: string; group: string; staff?: boolean; perm?: StaffPerm; designer?: boolean; owner?: boolean }[] = [
  { id: 'account', label: 'My Account', icon: 'user', group: 'User Settings' },
  { id: 'profile', label: 'Profiles', icon: 'edit', group: 'User Settings' },
  { id: 'special', label: 'Special', icon: 'sparkles', group: 'User Settings', owner: true },
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
  { id: 'reports', label: 'Report Centre', icon: 'flag', group: 'Venband Staff', staff: true, perm: 'reports' },
  { id: 'appeals-queue', label: 'Appeals', icon: 'gavel', group: 'Venband Staff', staff: true, perm: 'appeals' },
  { id: 'badges', label: 'Badge Designer', icon: 'star', group: 'Venband Staff', designer: true },
];

export function SettingsPage() {
  const tab = uiStore.use((s) => s.settings);
  const [search, setSearch] = useState('');
  const allSettings = useSettings((s) => s);
  const me = sessionStore.use((s) => s.me)!;
  const staff = (me.platform_role ?? 'user') !== 'user';
  const perms = useStaffPerms();
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
          <div className="sp-search">
            <Icon name="search" size={14} />
            <input placeholder="Search settings…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {groups.map((g) => {
            const items = TABS.filter((t) => t.group === g && (!t.staff || staff) && (!t.perm || perms.includes(t.perm)) && (!t.designer || designer) && (!t.owner || me.platform_role === 'owner') && (!search || t.label.toLowerCase().includes(search.toLowerCase())));
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
        <div className={`sp-inner${tab === 'moderation' || tab === 'reports' || tab === 'appeals-queue' || tab === 'discovery-queue' || tab === 'badges' ? ' wide' : ''}`}>
          {search.trim() ? (
            <div className="settings-search-results">
              <h2>Search results</h2>
              <p className="muted small">Matching settings — toggle them right here.</p>
              <div className="settings-search-list">
                {(() => {
                  const s = allSettings;
                  const voice = s.voice;
                  const chat = s.chat;
                  const entries: { key: string; label: string; tab: string; tabLabel: string; control: ReactNode }[] = [
                    { key: 'noise', label: 'Noise Suppression', tab: 'voice', tabLabel: 'Voice & Video', control: <Toggle label="Noise Suppression" checked={voice.noiseSuppression} onChange={(v) => updateVoice({ noiseSuppression: v })} /> },
                    { key: 'echo', label: 'Echo Cancellation', tab: 'voice', tabLabel: 'Voice & Video', control: <Toggle label="Echo Cancellation" checked={voice.echoCancellation} onChange={(v) => updateVoice({ echoCancellation: v })} /> },
                    { key: 'agc', label: 'Auto Gain Control', tab: 'voice', tabLabel: 'Voice & Video', control: <Toggle label="Auto Gain Control" checked={voice.autoGain} onChange={(v) => updateVoice({ autoGain: v })} /> },
                    { key: 'joinmuted', label: 'Join Muted', tab: 'voice', tabLabel: 'Voice & Video', control: <Toggle label="Join Muted" checked={voice.joinMuted} onChange={(v) => updateVoice({ joinMuted: v })} /> },
                    { key: 'ptt', label: 'Push to Talk', tab: 'voice', tabLabel: 'Voice & Video', control: <Toggle label="Push to Talk" checked={voice.pushToTalk} onChange={(v) => updateVoice({ pushToTalk: v })} /> },
                    { key: 'gifauto', label: 'GIF Autoplay', tab: 'chat', tabLabel: 'Chat', control: <Toggle label="GIF Autoplay" checked={chat.gifAutoplay} onChange={(v) => updateChat({ gifAutoplay: v })} /> },
                    { key: 'autoembed', label: 'Auto Embeds', tab: 'chat', tabLabel: 'Chat', control: <Toggle label="Auto Embeds" checked={chat.autoEmbeds} onChange={(v) => updateChat({ autoEmbeds: v })} /> },
                    { key: 'reduce', label: 'Reduce Motion', tab: 'chat', tabLabel: 'Chat', control: <Toggle label="Reduce Motion" checked={chat.reduceMotion} onChange={(v) => updateChat({ reduceMotion: v })} /> },
                    { key: 'autocorrect', label: 'Autocorrect', tab: 'chat', tabLabel: 'Chat', control: <Toggle label="Autocorrect" checked={chat.autocorrect !== 'off'} onChange={(v) => updateChat({ autocorrect: v ? 'suggest' : 'off' })} /> },
                    { key: 'dock', label: 'Dock Style', tab: 'appearance', tabLabel: 'Appearance', control: <Select value={s.dockStyle} onChange={(v) => updateSettings({ dockStyle: v as 'default' | 'macos' })} options={[{ value: 'default', label: 'Default taskbar' }, { value: 'macos', label: 'macOS dock' }]} /> },
                  ];
                  const q = search.toLowerCase();
                  const matches = entries.filter((e) => e.label.toLowerCase().includes(q));
                  if (!matches.length) {
                    // fall back to tab matches
                    const tabMatches = TABS.filter((t) => (!t.staff || staff) && (!t.perm || perms.includes(t.perm)) && (!t.designer || designer) && (!t.owner || me.platform_role === 'owner') && t.label.toLowerCase().includes(q));
                    if (!tabMatches.length) return <p className="muted small">No settings match "{search}".</p>;
                    return tabMatches.map((t) => (
                      <button key={t.id} className="settings-search-item" onClick={() => { uiStore.set({ settings: t.id }); setSearch(''); }}>
                        <Icon name={t.icon} size={16} />
                        <span>{t.label}</span>
                        <span className="small muted">{t.group}</span>
                      </button>
                    ));
                  }
                  return matches.map((e) => (
                    <div key={e.key} className="settings-search-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600 }}>{e.label}</span>
                        <span className="small muted">in {e.tabLabel}</span>
                      </div>
                      {e.control}
                    </div>
                  ));
                })()}
              </div>
            </div>
          ) : (
            <>
              {tab === 'account' && <AccountTab />}
              {tab === 'profile' && <ProfileTab />}
              {tab === 'special' && me.platform_role === 'owner' && <SpecialTab />}
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
              {tab === 'reports' && perms.includes('reports') && <ReportCentre />}
              {tab === 'appeals-queue' && perms.includes('appeals') && <AppealsQueue />}
              {tab === 'discovery-queue' && staff && <DiscoveryQueue />}
              {tab === 'badges' && designer && <BadgeDesigner />}
            </>
          )}
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
              {info.kind === 'oauth' && (info.provider === 'spotify' || info.provider === 'youtube' || info.provider === 'tiktok') && (
                <button
                  className="btn secondary small"
                  disabled={busy === info.provider}
                  onClick={async () => {
                    setBusy(info.provider);
                    setError(null);
                    try {
                      if (info.provider === 'spotify') await spotifyLogin();
                      else if (info.provider === 'youtube') await youtubeLogin();
                      else if (info.provider === 'tiktok') await tiktokLogin();
                    } catch (e) {
                      setError(errorMessage(e));
                      setBusy(null);
                    }
                  }}
                >
                  <Icon name="link" size={14} /> Connect
                </button>
              )}
              {info.kind === 'oauth' && !(info.provider === 'spotify' || info.provider === 'youtube' || info.provider === 'tiktok') && (
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
  const desktop = Boolean(window.venbandDesktop?.isDesktop);
  const [fp, setFp] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showEmail, setShowEmail] = useState(false);
  const [delPhrase, setDelPhrase] = useState('');
  const [disposableEmail, setDisposableEmail] = useState('');
  useEffect(() => {
    fingerprint(identity.encPublic, identity.signPublic).then(setFp);
  }, [identity]);
  const email = session?.user.email ?? '';
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrStatus, setQrStatus] = useState<string>('pending');
  const [qrDevice, setQrDevice] = useState<string>('');
  const [qrBusy, setQrBusy] = useState(false);

  async function startQrLogin() {
    setQrBusy(true);
    try {
      const deviceInfo = navigator.userAgent.slice(0, 80);
      const r = await fetch('/api/vdl?r=qr&action=create', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: JSON.stringify({ device_info: deviceInfo }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setQrToken(j.token);
      setQrStatus('pending');
      // poll for scan
      const poll = setInterval(async () => {
        const r2 = await fetch(`/api/vdl?r=qr&action=status&token=${encodeURIComponent(j.token)}`, { credentials: 'include' });
        const j2 = await r2.json();
        if (j2.status === 'scanned') {
          setQrStatus('scanned');
          setQrDevice(j2.device_info || 'Unknown device');
          clearInterval(poll);
        } else if (j2.status === 'approved' || j2.status === 'denied') {
          clearInterval(poll);
          setQrStatus(j2.status);
        }
      }, 2000);
      // stop polling after 5 min
      setTimeout(() => clearInterval(poll), 5 * 60 * 1000);
    } catch (e) { showAlert(String((e as Error).message)); }
    finally { setQrBusy(false); }
  }

  async function approveQr() {
    if (!qrToken) return;
    await fetch('/api/vdl?r=qr&action=approve', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: JSON.stringify({ token: qrToken }) });
    setQrStatus('approved');
    setQrToken(null);
  }
  async function denyQr() {
    if (!qrToken) return;
    await fetch('/api/vdl?r=qr&action=deny', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: JSON.stringify({ token: qrToken }) });
    setQrStatus('denied');
    setQrToken(null);
  }
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
              {me.display_name} <Badges ids={me.badges} display={me.badge_display} size={18} />
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
          <div className="account-row">
            <div>
              <div className="field-label">Venband version</div>
              <div>
                {VERSION}
                {desktop && (
                  <span className="tag-soft">Desktop — updates itself in the app</span>
                )}
              </div>
            </div>
            <a className="btn link" href="download" onClick={(e) => { e.preventDefault(); go('download'); }}>
              Downloads
            </a>
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
      <Section title="Login on another device" desc="Show a QR code to sign in on a phone or computer without typing your password.">
        {!qrToken && qrStatus === 'pending' && (
          <button className="btn" onClick={startQrLogin} disabled={qrBusy}>{qrBusy ? 'Starting…' : 'Show QR code'}</button>
        )}
        {qrToken && (
          <div style={{ textAlign: 'center' }}>
            <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrToken)}`} alt="QR code" style={{ borderRadius: 8 }} />
            <p className="small muted" style={{ marginTop: 8 }}>Scan with Venband on another device. Expires in 5 minutes.</p>
            {qrStatus === 'scanned' && (
              <div className="qr-popup">
                <p><b>{qrDevice}</b> is trying to log in.</p>
                <p className="small muted">Allow if this is you.</p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 8 }}>
                  <button className="btn primary small" onClick={approveQr}>Allow</button>
                  <button className="btn ghost small" onClick={denyQr}>Deny</button>
                </div>
              </div>
            )}
          </div>
        )}
        {qrStatus === 'approved' && <p className="small good">Approved. The other device is now signed in.</p>}
        {qrStatus === 'denied' && <p className="small danger-text">Denied.</p>}
      </Section>
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
      {me.disposable && (
        <Section title="Disposable account" desc={`This account expires on ${me.expires_at ? new Date(me.expires_at).toLocaleString() : 'soon'}. Add an email to make it permanent.`}>
          <div className="row">
            <Field label="Email">
              <input type="email" value={disposableEmail} onChange={(e) => setDisposableEmail(e.target.value)} placeholder="you@example.com" />
            </Field>
            <button
              className="btn primary"
              disabled={!disposableEmail || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const { error } = await supabase.auth.updateUser({ email: disposableEmail.trim() });
                  if (error) throw error;
                  setMsg('Check your inbox to verify the email. Once verified, your account becomes permanent.');
                } catch (err) {
                  setMsg(errorMessage(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Sending…' : 'Add email'}
            </button>
          </div>
        </Section>
      )}
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
  const owned = inventoryStore.use((s) => s.owned);
  useEffect(() => {
    loadInventory().catch(() => {});
  }, []);
  const toShop = (
    <button type="button" className="btn link small" onClick={() => (closeSettings(), uiStore.set({ homeTab: 'market' } as never), openFriends())}>
      Get more in the Marketplace →
    </button>
  );
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
          <Field label="Clear status after">
            <Select value="0" onChange={(v) => {
              const mins = Number(v);
              if (mins > 0 && preview.status_text) {
                setTimeout(() => { updateMyProfile({ status_text: '' }).catch(() => {}); }, mins * 60 * 1000);
              }
            }} options={[{ value: '0', label: 'Never' }, { value: '30', label: '30 minutes' }, { value: '60', label: '1 hour' }, { value: '240', label: '4 hours' }, { value: '1440', label: 'Today' }]} />
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
          <Field label="Avatar decoration" group hint="Art around your picture. Collect more for free in the Marketplace." aside={toShop}>
            <div className="frame-grid">
              {[...FRAME_LIST, ...ownedOptions('decoration', owned)].map((f) => (
                <button key={f.id} type="button" className={`frame-option${(preview.avatar_frame ?? 'none') === f.id ? ' selected' : ''}`} onClick={() => set({ avatar_frame: f.id as AvatarFrame })} aria-label={f.label} title={f.label}>
                  <Avatar profile={{ ...preview, avatar_frame: f.id as AvatarFrame }} size={44} />
                  <span>{f.label}</span>
                </button>
              ))}
            </div>
          </Field>
          <Field label="Profile effect" group hint="Animated particles over your whole profile card." aside={toShop}>
            <div className="effect-grid">
              {[...EFFECT_LIST, ...ownedOptions('effect', owned)].map((f) => (
                <button key={f.id} type="button" className={`effect-option${(preview.profile_effect ?? 'none') === f.id ? ' selected' : ''}`} onClick={() => set({ profile_effect: f.id })} aria-label={f.label} title={f.label}>
                  <ProfileEffect id={f.id} />
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
                options={[...NAME_EFFECTS, ...(me.platform_role === 'owner' ? [{ id: 'sovereign' as NameEffect, label: 'Sovereign (owners only)' }] : [])].map((f) => ({ value: f.id, label: f.label }))}
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
              {[...NAMEPLATES, ...ownedOptions('nameplate', owned), { id: 'custom', label: 'Custom' }].map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={`nameplate-option nameplate-${n.id}${(preview.nameplate ?? 'none') === n.id ? ' selected' : ''}`}
                  style={n.id === 'custom' ? nameplateVars({ nameplate: 'custom', nameplate_style: preview.nameplate_style?.colors?.length ? preview.nameplate_style : { colors: ['#ff6ec4', '#7873f5'] } }) : undefined}
                  onClick={() => set(n.id === 'custom' && !preview.nameplate_style?.colors?.length ? { nameplate: 'custom', nameplate_style: { colors: ['#ff6ec4', '#7873f5'], pattern: 'sweep' } } : { nameplate: n.id })}
                >
                  <NameplateArt id={n.id} />
                  <span className="np-label">{n.label}</span>
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
          <BadgeDisplayPicker />
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
            <ProfileEffect id={preview.profile_effect} />
            <div className="profile-banner" style={bannerStyle(preview)} />
            <div className="profile-head">
              <div className="profile-avatar">
                <Avatar profile={preview} size={72} online />
              </div>
            </div>
            <div className="profile-body">
              <h2>
                <StyledName style={preview.name_style}>{preview.display_name}</StyledName> <Badges ids={me.badges} display={me.badge_display} size={16} />
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
            <NameplateArt id={preview.nameplate} />
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
  { id: 'wave', label: 'Wave' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'fire', label: 'Fire' },
  { id: 'ice', label: 'Ice' },
  { id: 'holographic', label: 'Holographic' },
  { id: 'sparkle', label: 'Sparkle' },
];

// --------------------------------------------------------------- privacy --

function ShareGamesSection() {
  const [on, setOn] = useState(shareGames());
  return (
    <Section title="Activity" desc="In the Venband desktop app, the game you’re playing shows on your profile (“Playing Minecraft · 1:20:05”) and in your recent activity. Only the game’s name is shared — never the other programs you have open.">
      <Toggle
        label="Share what I’m playing"
        checked={on}
        onChange={(v) => {
          setShareGames(v);
          setOn(v);
        }}
      />
      <button
        className="btn link small"
        onClick={async () => {
          if (!(await askConfirm({ title: 'Clear your activity history?', body: 'Removes the games listed under Recent activity on your profile.', confirm: 'Clear', danger: true }))) return;
          const uid = sessionStore.get().me?.id;
          if (uid) await supabase.from('activity_history').delete().eq('user_id', uid);
          showToast('Activity history cleared.');
        }}
      >
        Clear my activity history
      </button>
    </Section>
  );
}

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
      <ShareGamesSection />
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

function AppearanceTab() {
  const themeId = useSettings((s) => s.themeId);
  const installed = useSettings((s) => s.installedThemes);
  const reduceMotion = useSettings((s) => s.chat.reduceMotion);
  const serverThemes = useSettings((s) => s.serverThemes);
  const me = sessionStore.use((s) => s.me)!;
  const [view, setView] = useState<'themes' | 'market' | 'studio' | 'looks'>('themes');
  const [studio, setStudio] = useState<'create' | 'mine'>('create');
  const [editing, setEditing] = useState<EditingTheme | null>(null);
  const [market, setMarket] = useState<MarketItem[] | null>(null);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<'popular' | 'new' | 'updated'>('popular');
  const [msg, setMsg] = useState<string | null>(null);

  const loadMarket = async () => {
    setMarket(null);
    const run = (current: boolean) => {
      let query = supabase.from('themes').select('*').eq('kind', 'theme').limit(100);
      // older databases (before the theme-versions migration) have no status/category/updated_at
      if (current) query = query.eq('status', 'published');
      if (current && category) query = query.eq('category', category);
      return sort === 'popular'
        ? query.order('installs', { ascending: false }).order('created_at', { ascending: false })
        : query.order(sort === 'new' || !current ? 'created_at' : 'updated_at', { ascending: false });
    };
    let { data, error } = await run(true);
    if (error && isOldSchema(error)) ({ data, error } = await run(false));
    if (error) setMsg(errorMessage(error));
    const list = (data ?? []) as MarketItem[];
    await loadProfiles(list.map((x) => x.author_id));
    setMarket(list);
  };
  useEffect(() => {
    if (view === 'market') loadMarket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, category, sort]);

  const install = async (mt: MarketItem) => {
    const t = themeFrom(mt, mt.id, mt.version, displayName(mt.author_id));
    if (!t) return setMsg('That theme is invalid.');
    updateSettings((s) => ({ installedThemes: [...s.installedThemes.filter((x) => x.id !== t.id), t], themeId: t.id }));
    await recordInstall(mt.id).catch(() => {});
    setMsg(`Installed ${t.name}.`);
  };

  const filtered = (market ?? []).filter((t) => !q || `${t.name} ${t.description} ${displayName(t.author_id)}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <h2>Appearance</h2>
      <Section title="Dock style">
        <Select value={useSettings((s) => s.dockStyle)} onChange={(v) => updateSettings({ dockStyle: v as 'default' | 'macos' })} options={[{ value: 'default', label: 'Default taskbar' }, { value: 'macos', label: 'macOS dock (hover magnification)' }]} />
      </Section>
      <Section title="Dock position">
        <Select value={useSettings((s) => s.dockPosition)} onChange={(v) => updateSettings({ dockPosition: v as any })} options={[{ value: 'bottom', label: 'Bottom' }, { value: 'top', label: 'Top' }, { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]} />
      </Section>
      <div className="tabs">
        <button className={view === 'themes' ? 'active' : ''} onClick={() => setView('themes')}>
          My Themes
        </button>
        <button className={view === 'market' ? 'active' : ''} onClick={() => setView('market')}>
          <Icon name="sparkles" size={14} /> Theme Marketplace
        </button>
        <button className={view === 'studio' ? 'active' : ''} onClick={() => setView('studio')}>
          <Icon name="palette" size={14} /> Theme Studio
        </button>
        <button className={view === 'looks' ? 'active' : ''} onClick={() => setView('looks')}>
          <Icon name="image" size={14} /> Background & CSS
        </button>
      </div>
      {view === 'looks' && <LooksPanel />}
      {msg && <div className="notice">{msg}</div>}
      {view === 'themes' && (
        <>
          <InstalledThemeUpdates />
          <div className="theme-grid">
            {[...BUILT_IN_THEMES, ...installed].map((t) => (
              <div key={t.id} className={`theme-card${themeId === t.id ? ' selected' : ''}`}>
                <button className="theme-pick" onClick={() => updateSettings({ themeId: t.id })}>
                  <ThemeSwatch t={t} />
                  <div className="theme-name">
                    {t.name}
                    {themeId === t.id && <Icon name="check" size={14} />}
                  </div>
                  <div className="small muted">
                    {t.author ? `by ${t.author}` : t.description}
                    {t.sourceId ? ` · v${t.version ?? 1}` : ''}
                  </div>
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
          <div className="market-filters">
            <input className="search-input" placeholder="Search themes or creators" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="chip-row">
              {(['popular', 'new', 'updated'] as const).map((s) => (
                <button key={s} className={`chip${sort === s ? ' on' : ''}`} onClick={() => setSort(s)}>
                  {s === 'popular' ? 'Popular' : s === 'new' ? 'New' : 'Recently updated'}
                </button>
              ))}
            </div>
            <div className="chip-row">
              <button className={`chip${!category ? ' on' : ''}`} onClick={() => setCategory('')}>
                All
              </button>
              {THEME_CATEGORIES.map((c) => (
                <button key={c.id} className={`chip${category === c.id ? ' on' : ''}`} onClick={() => setCategory(c.id)}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          {!market && <div className="spinner" />}
          <div className="theme-grid">
            {filtered.map((mt) => {
              const t = themeFrom(mt, mt.id, mt.version);
              if (!t) return null;
              const mine = installed.find((x) => x.id === `market-${mt.id}`);
              const have = Boolean(mine) && (mine!.version ?? 1) >= mt.version;
              return (
                <div key={mt.id} className="theme-card">
                  <ThemeSwatch t={t} />
                  <div className="theme-name">{mt.name}</div>
                  <div className="small muted">
                    by {displayName(mt.author_id) === 'Unknown user' ? 'a Venband user' : displayName(mt.author_id)} · {mt.installs.toLocaleString()} install{mt.installs === 1 ? '' : 's'}
                  </div>
                  <div className="small muted">
                    v{mt.version}
                    {mt.category ? ` · ${categoryLabel(mt.category)}` : ''}
                    {mt.version > 1 ? ` · updated ${new Date(mt.updated_at).toLocaleDateString()}` : ''}
                  </div>
                  {mt.description && <div className="small">{mt.description}</div>}
                  <div className="theme-actions">
                    <button className="btn primary small" disabled={have} onClick={() => install(mt)}>
                      {have ? 'Installed' : mine ? `Update to v${mt.version}` : 'Install'}
                    </button>
                    {mt.author_id === me.id && (
                      <button className="btn secondary small" onClick={() => (setView('studio'), setStudio('mine'))}>
                        Manage
                      </button>
                    )}
                    {mt.author_id !== me.id && me.platform_role !== 'user' && (
                      <button
                        className="btn danger small"
                        onClick={async () => {
                          const reason = await askText({ title: `Remove “${mt.name}”?`, label: 'Reason (the creator sees this; it’s logged)', maxLength: 500 });
                          if (!reason?.trim()) return;
                          const { error } = await supabase.rpc('theme_set_status', { p_theme: mt.id, p_status: 'removed', p_reason: reason.trim() });
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
      {view === 'studio' && (
        <>
          <div className="tabs small">
            <button className={studio === 'create' && !editing ? 'active' : ''} onClick={() => (setEditing(null), setStudio('create'))}>
              <Icon name="plus" size={13} /> Create
            </button>
            <button className={studio === 'mine' || editing ? 'active' : ''} onClick={() => (setEditing(null), setStudio('mine'))}>
              <Icon name="palette" size={13} /> My published themes
            </button>
          </div>
          {editing ? (
            <ThemeCreator
              key={editing.id}
              editing={editing}
              onCancel={() => setEditing(null)}
              onDone={(m) => (setMsg(m), setEditing(null), setStudio('mine'))}
            />
          ) : studio === 'create' ? (
            <ThemeCreator onDone={(m) => (setMsg(m), setStudio('mine'))} />
          ) : (
            <MyThemes onEdit={(e) => (setMsg(null), setEditing(e))} />
          )}
        </>
      )}
    </>
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

  // mic test: the same chain calls use (isolation + input volume), optionally played back to you
  const [hearSelf, setHearSelf] = useState(false);
  const chainRef = useRef<MicChain | null>(null);
  useEffect(() => {
    if (!testing) return;
    let stop = false;
    let chain: MicChain | null = null;
    let el: (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null = null;
    (async () => {
      const raw = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: v.inputId ? { ideal: v.inputId } : undefined,
          noiseSuppression: v.voiceIsolation ? false : v.noiseSuppression,
          echoCancellation: v.echoCancellation,
          autoGainControl: v.autoGain,
          channelCount: 1,
        },
      });
      list();
      chain = await createMicChain(raw, { volume: v.inputVolume, isolation: v.voiceIsolation, strength: v.isolationStrength });
      if (stop) return chain.close();
      chainRef.current = chain;
      if (hearSelf) {
        el = new Audio();
        el.srcObject = chain.stream;
        el.volume = Math.min(1, (v.outputVolume ?? 100) / 100);
        if (v.outputId && el.setSinkId) await el.setSinkId(v.outputId).catch(() => {});
        await el.play().catch(() => {});
      }
      const loop = () => {
        if (stop || !chain) return;
        setLevel(chain.level());
        requestAnimationFrame(loop);
      };
      loop();
    })().catch(() => setTesting(false));
    return () => {
      stop = true;
      chainRef.current = null;
      el?.pause();
      chain?.close();
      setLevel(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testing, hearSelf, v.inputId, v.echoCancellation, v.autoGain]);
  // live: volume and isolation change without restarting the test
  useEffect(() => chainRef.current?.setVolume(v.inputVolume), [v.inputVolume]);
  useEffect(() => {
    void chainRef.current?.setIsolation(v.voiceIsolation, v.isolationStrength);
  }, [v.voiceIsolation, v.isolationStrength]);

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
      <SoundSettings />
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
          <Slider min={0} max={200} step={5} value={v.inputVolume} onChange={(e) => updateVoice({ inputVolume: Number(e.target.value) })} />
        </Field>
        <Field label={`Output volume (booster) - ${v.outputVolume ?? 100}%`}>
          <Slider min={0} max={200} step={5} value={v.outputVolume ?? 100} onChange={(e) => updateVoice({ outputVolume: Number(e.target.value) })} />
        </Field>
        <div className="mic-test">
          <button className="btn secondary small" onClick={() => setTesting((t) => !t)}>
            {testing ? 'Stop test' : 'Let’s check'}
          </button>
          <div className="mic-meter">
            <span style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
          <label className="mic-hear">
            <input type="checkbox" checked={hearSelf} onChange={(e) => setHearSelf(e.target.checked)} /> Hear yourself
          </label>
        </div>
        <p className="small muted">The meter shows what others hear. Volume and voice isolation change instantly, even mid-call; a new device applies the next time you join.</p>
      </Section>
      <Section title="Voice isolation" desc="Only your voice gets through: a speech-trained neural network (RNNoise) removes fans, keyboards, music, traffic, pets and room noise, and a gate closes between your words so quieter voices and sounds around you stay out.">
        <Toggle label="Voice isolation" desc={isolationSupported() ? 'Recommended. Uses a little CPU while you talk.' : 'Your browser can’t run it (no AudioWorklet).'} checked={v.voiceIsolation && isolationSupported()} onChange={(x) => updateVoice({ voiceIsolation: x })} />
        {v.voiceIsolation && (
          <Field label="Strength">
            <div className="seg">
              {(['standard', 'strong'] as const).map((k) => (
                <button key={k} className={v.isolationStrength === k ? 'active' : ''} onClick={() => updateVoice({ isolationStrength: k })}>
                  {k === 'standard' ? 'Standard' : 'Strong — drops quieter voices too'}
                </button>
              ))}
            </div>
          </Field>
        )}
      </Section>
      <Section title="Voice processing">
        {!v.voiceIsolation && <Toggle label="Noise suppression" desc="Your browser’s basic noise filter (voice isolation replaces it)." checked={v.noiseSuppression} onChange={(x) => updateVoice({ noiseSuppression: x })} />}
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
          Venband translates messages from and into {LANGUAGES.length} languages, with nothing to download. It works out which language a message is in by itself, understands chat slang (ngl, idk, rn…), and never touches code, links, mentions or emoji. If you’re offline, a built-in phrasebook ({PHRASEBOOK_SIZE} common phrases in {PHRASEBOOK_LANGS.length} languages) covers the basics.
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
