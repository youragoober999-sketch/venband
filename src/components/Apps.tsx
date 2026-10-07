// Developer portal: /bots (your bots) and /bots/<id> (a bot's
// dashboard, for its owner and the people they added).
import { useCallback, useEffect, useState } from 'react';
import { supabase, errorMessage } from '../lib/supabase';
import { sessionStore } from '../lib/session';
import { go } from '../lib/router';
import { appQuery, apiBase, PRESETS, type Application, type Preset, type ServerBot } from '../lib/bots';
import { Field, Icon } from './ui';
import { askConfirm, askText } from './Dialogs';
import { Select } from './Select';
import { PublicLayout, SignInCard } from './PublicPages';

// --------------------------------------------------------------- logos ----

const PRESET_ART: Record<Preset, { from: string; to: string; path: string }> = {
  verification: { from: '#3ba55d', to: '#1f7a45', path: 'M12 3 5 6v5c0 4.4 3 8.3 7 9.5 4-1.2 7-5.1 7-9.5V6l-7-3zm-1.2 12.2-3.2-3.2 1.4-1.4 1.8 1.8 4.4-4.4 1.4 1.4-5.8 5.8z' },
  management: { from: '#5865f2', to: '#3b44b8', path: 'M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5zm8 4.6-1.9.6-.5 1.3.9 1.8-1.6 1.6-1.8-.9-1.3.5-.6 1.9h-2.4l-.6-1.9-1.3-.5-1.8.9-1.6-1.6.9-1.8-.5-1.3L4 13.1v-2.2l1.9-.6.5-1.3-.9-1.8 1.6-1.6 1.8.9 1.3-.5.6-1.9h2.4l.6 1.9 1.3.5 1.8-.9 1.6 1.6-.9 1.8.5 1.3 1.9.6v2.2z' },
  site: { from: '#eb459e', to: '#a12d6c', path: 'M10.6 13.4a1 1 0 0 0 1.4 0l3.5-3.5a3 3 0 0 0-4.2-4.2L9.9 7.1l1.4 1.4 1.4-1.4a1 1 0 0 1 1.4 1.4l-3.5 3.5a1 1 0 0 0 0 1.4zm2.8-2.8a1 1 0 0 0-1.4 0l-3.5 3.5a3 3 0 0 0 4.2 4.2l1.4-1.4-1.4-1.4-1.4 1.4a1 1 0 0 1-1.4-1.4l3.5-3.5a1 1 0 0 0 0-1.4z' },
  wordle: { from: '#6aaa64', to: '#538d4e', path: 'M5 4h14c.6 0 1 .4 1 1v14c0 .6-.4 1-1 1H5a1 1 0 0 1-1-1V5c0-.6.4-1 1-1zm2 4v2h10V8H7zm0 4v2h10v-2H7zm0 4v2h10v-2H7z' },
  custom: { from: '#7c5cff', to: '#4b2fd1', path: 'M8 7h8a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3zm1.5 4.5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zm5 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zM11 3h2v4h-2z' },
};

/** Each preset has its own logo; custom bots use their color. */
export function PresetLogo({ preset, color, size = 40 }: { preset: Preset; color?: string; size?: number }) {
  const art = PRESET_ART[preset] ?? PRESET_ART.custom;
  const id = `pl-${preset}-${(color ?? '').replace('#', '')}`;
  return (
    <svg className="preset-logo" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={preset === 'custom' && color ? color : art.from} />
          <stop offset="1" stopColor={art.to} />
        </linearGradient>
      </defs>
      <rect width="24" height="24" rx="7" fill={`url(#${id})`} />
      <path d={art.path} fill="#fff" />
    </svg>
  );
}

async function roundSquare(file: File, px: number): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const size = Math.min(bmp.width, bmp.height);
  const sx = (bmp.width - size) / 2, sy = (bmp.height - size) / 2;
  const c = document.createElement('canvas');
  c.width = px; c.height = px;
  c.getContext('2d')!.drawImage(bmp, sx, sy, size, size, 0, 0, px, px);
  bmp.close();
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not read that picture.'))), 'image/webp', 0.92));
}

async function fitBanner(file: File, w: number, h: number): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const r = Math.min(w / bmp.width, h / bmp.height);
  const dw = Math.max(1, Math.round(bmp.width * r)), dh = Math.max(1, Math.round(bmp.height * r));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.drawImage(bmp, Math.round((w - dw) / 2), Math.round((h - dh) / 2), dw, dh);
  bmp.close();
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not read that picture.'))), 'image/webp', 0.92));
}

export function BotTag() {
  return (
    <span className="bot-tag" title="Bot · what bots post is not end-to-end encrypted">
      <Icon name="check" size={10} /> BOT
    </span>
  );
}

// ------------------------------------------------------------ app list ----

export function ApplicationsPage({ id }: { id?: string }) {
  const signedIn = sessionStore.use((s) => s.status === 'ready' && Boolean(s.me));
  const loading = sessionStore.use((s) => s.status === 'loading');
  if (id)
    return (
      <PublicLayout page="bots" title="Application" wide>
        {loading ? <div className="spinner" /> : signedIn ? <AppDashboard id={id} /> : <SignInCard what="manage this application" />}
      </PublicLayout>
    );
  return (
    <PublicLayout page="bots" title="Developers" wide>
      <div className="dev-hero">
        <div>
          <h1>Build for Venband</h1>
          <p className="muted">Make a bot in a minute from a preset, or write your own with the bot API. Bots can’t read end-to-end encrypted messages — by design.</p>
        </div>
      </div>
      {loading ? <div className="spinner" /> : signedIn ? <AppList /> : <SignInCard what="make applications" />}
      <ApiDocs />
    </PublicLayout>
  );
}

function AppList() {
  const me = sessionStore.use((s) => s.me)!;
  const [apps, setApps] = useState<Application[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<Preset | null>(null);
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    const { data: team } = await supabase.from('application_team').select('app_id').eq('user_id', me.id);
    const ids = (team ?? []).map((t) => t.app_id as string);
    const { data, error } = await appQuery((cols) => supabase.from('applications').select(cols).or(`owner_id.eq.${me.id}${ids.length ? `,id.in.(${ids.join(',')})` : ''}`).order('created_at'));
    setError(error ? errorMessage(error) : null);
    setApps(((data ?? []) as unknown as Application[]));
  }, [me.id]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <h2>Start from a preset</h2>
      <div className="preset-grid">
        {PRESETS.map((p) => (
          <button key={p.id} className={`preset-card${creating === p.id ? ' selected' : ''}`} onClick={() => (setCreating(p.id), setName(name || defaultName(p.id)))}>
            <PresetLogo preset={p.id} size={44} />
            <b>{p.name}</b>
            <span className="small muted">{p.blurb}</span>
            <ul className="small">
              {p.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </button>
        ))}
      </div>
      {creating && (
        <div className="public-card create-app">
          {error && <div className="form-error">{error}</div>}
          <Field label="Bot name" hint="2–32 characters. You can change it later.">
            <input autoFocus maxLength={32} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="modal-actions">
            <button className="btn secondary" onClick={() => setCreating(null)}>
              Cancel
            </button>
            <button
              className="btn primary"
              disabled={name.trim().length < 2}
              onClick={async () => {
                setError(null);
                const { data, error } = await supabase.rpc('create_application', { p_name: name.trim(), p_preset: creating });
                if (error) return setError(errorMessage(error));
                go(`bots/${data as string}`);
              }}
            >
              Create bot
            </button>
          </div>
        </div>
      )}
      <h2>Your applications</h2>
      {apps === null && !error && <div className="spinner" />}
      {error && <div className="form-error">{error}</div>}
      {!error && apps?.length === 0 && <p className="muted">Nothing yet — pick a preset above.</p>}
      <div className="app-list">
        {apps?.map((a) => (
          <a
            key={a.id}
            className="app-row"
            href={`${import.meta.env.BASE_URL}bots/${a.id}`}
            onClick={(e) => {
              e.preventDefault();
              go(`bots/${a.id}`);
            }}
          >
            <PresetLogo preset={a.preset} color={a.color} />
            <div className="grow">
              <b>{a.name}</b>
              <div className="small muted">{PRESETS.find((p) => p.id === a.preset)?.name}</div>
            </div>
            {a.status === 'disabled' && <span className="pill">Disabled by staff</span>}
            {a.owner_id !== me.id && <span className="pill">Team</span>}
            <Icon name="chevronRight" size={16} />
          </a>
        ))}
      </div>
    </>
  );
}

function defaultName(p: Preset) {
  return { verification: 'Gatekeeper', management: 'Helper', site: 'Site Updates', wordle: 'Wordle', custom: 'My Bot' }[p];
}

// ----------------------------------------------------------- dashboard ----

type Tab = 'general' | 'servers' | 'bot' | 'team';

function AppDashboard({ id }: { id: string }) {
  const me = sessionStore.use((s) => s.me)!;
  const [app, setApp] = useState<Application | null | undefined>(undefined);
  const [role, setRole] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('servers');
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const [q, r] = await Promise.all([appQuery((cols) => supabase.from('applications').select(cols).eq('id', id).maybeSingle()), supabase.rpc('app_role', { p_app: id, p_user: me.id })]);
    const role = (r.data as string | null) ?? null;
    setRole(role);
    if (q.error) return setError(errorMessage(q.error));
    setApp(role ? ((q.data as Application | null) ?? null) : null);
  }, [id, me.id]);
  useEffect(() => {
    load();
  }, [load]);
  if (app === undefined && !error) return <div className="spinner" />;
  if (error)
    return (
      <div className="public-card center">
        <Icon name="warning" size={28} />
        <h2>Couldn’t load this application</h2>
        <p className="muted">{error}</p>
        <button className="btn primary" onClick={() => go('bots')}>
          Your applications
        </button>
      </div>
    );
  if (!app)
    return (
      <div className="public-card center">
        <Icon name="lock" size={28} />
        <h2>You can’t open this application</h2>
        <p className="muted">Only its owner and the people they added can see it.</p>
        <button className="btn primary" onClick={() => go('bots')}>
          Your applications
        </button>
      </div>
    );
  const canEdit = role === 'owner' || role === 'admin';
  const preset = PRESETS.find((p) => p.id === app.preset)!;
  const dashTabs: [Tab, string][] = [
    ['general', 'Basic'],
    ['servers', 'Manage Servers'],
    ['bot', app.preset === 'custom' ? 'Token & API' : 'Token'],
    ['team', 'Team'],
  ];
  return (
    <div className="app-dash">
      <aside className="dash-side">
        <button className="btn link small" onClick={() => go('bots')}>
          ← All applications
        </button>
        <div className="dash-side-bot">
          <PresetLogo preset={app.preset} color={app.color} size={44} />
          <div className="grow">
            <b className="ellipsis">{app.name}</b>
            <div className="small muted">{preset.name}</div>
          </div>
        </div>
        <nav className="dash-nav">
          {dashTabs.map(([t, l]) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {l}
            </button>
          ))}
        </nav>
      </aside>
      <div className="dash-main">
        {app.status === 'disabled' && <div className="warning-box">This bot is disabled by Venband staff. It can’t post until that’s lifted.</div>}
        {tab === 'general' && <GeneralTab app={app} canEdit={canEdit} onSaved={load} isOwner={role === 'owner'} />}
        {tab === 'servers' && <ServersTab app={app} canEdit={canEdit} />}
        {tab === 'bot' && <TokenTab app={app} canEdit={canEdit} onChanged={load} />}
        {tab === 'team' && <TeamTab app={app} canEdit={canEdit} />}
      </div>
    </div>
  );
}

function GeneralTab({ app, canEdit, onSaved, isOwner }: { app: Application; canEdit: boolean; onSaved: () => void; isOwner: boolean }) {
  const [name, setName] = useState(app.name);
  const [description, setDescription] = useState(app.description);
  const [color, setColor] = useState(app.color);
  const [banner, setBanner] = useState(app.banner_url ?? '');
  const [srvCount, setSrvCount] = useState<number | null>(null);
  const [busyImg, setBusyImg] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    supabase.from('server_bots').select('id', { count: 'exact', head: true }).eq('app_id', app.id).then(({ count }) => setSrvCount(count ?? 0));
  }, [app.id]);
  async function uploadPic(file: File, kind: 'avatar' | 'banner') {
    setBusyImg(true);
    setMsg(null);
    try {
      const blob = kind === 'avatar' ? await roundSquare(file, 128) : await fitBanner(file, 1500, 500);
      const path = `${app.id}/${kind}-${crypto.randomUUID().slice(0, 8)}.webp`;
      const { error: up } = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/webp' });
      if (up) throw up;
      const url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      const { error } = await supabase.from('applications').update(kind === 'avatar' ? { icon_url: url } : { banner_url: url }).eq('id', app.id);
      if (error) throw error;
      if (kind === 'banner') setBanner(url);
      setMsg('Saved.');
      onSaved();
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusyImg(false);
    }
  }
  return (
    <div className="public-card">
      {msg && <div className="form-notice">{msg}</div>}
      <div className="bot-profile">
        <div
          className="bot-profile-banner"
          style={banner ? { backgroundImage: `url("${banner}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: 'var(--bg-3)' }}
        >
          {canEdit && (
            <label className="btn secondary small" style={{ cursor: 'pointer' }}>
              {busyImg ? '…' : 'Banner'}
              <input type="file" accept="image/*" hidden onChange={(e) => (e.target.files?.[0] && uploadPic(e.target.files[0], 'banner'), (e.target.value = ''))} />
            </label>
          )}
        </div>
        <div className="bot-profile-body">
          <div className="bot-pfp-wrap">
            {app.icon_url ? (
              <img className="bot-pfp" src={app.icon_url} alt="" />
            ) : (
              <div className="bot-pfp">
                <PresetLogo preset={app.preset} color={color} size={64} />
              </div>
            )}
            {canEdit && (
              <label className="btn secondary small" style={{ cursor: 'pointer' }}>
                {busyImg ? '…' : 'Change photo'}
                <input type="file" accept="image/*" hidden onChange={(e) => (e.target.files?.[0] && uploadPic(e.target.files[0], 'avatar'), (e.target.value = ''))} />
              </label>
            )}
            {app.icon_url && canEdit && (
              <button
                className="btn link small"
                onClick={async () => {
                  await supabase.from('applications').update({ icon_url: null }).eq('id', app.id);
                  onSaved();
                }}
              >
                Remove
              </button>
            )}
          </div>
          <div className="grow">
            <div className="row-between">
              <h2 style={{ margin: 0 }}>{app.name}</h2>
              <span className={`pill ${app.status === 'disabled' ? 'danger' : ''}`}>{app.status === 'disabled' ? 'Disabled by staff' : 'Active'}</span>
            </div>
            <div className="small muted">
              {srvCount === null ? '…' : `In ${srvCount} server${srvCount === 1 ? '' : 's'}`} · Application ID <code>{app.id}</code>
            </div>
          </div>
        </div>
      </div>
      <Field label="Name">
        <input disabled={!canEdit} maxLength={32} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="About" hint="Shown on the bot’s profile in servers and on the Bot Directory.">
        <textarea disabled={!canEdit} rows={3} maxLength={400} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What your bot does…" />
      </Field>
      {app.preset === 'custom' && (
        <Field label="Logo color">
          <input type="color" disabled={!canEdit} value={color} onChange={(e) => setColor(e.target.value)} />
        </Field>
      )}
      {canEdit && (
        <div className="modal-actions">
          {isOwner && (
            <button
              className="btn danger"
              onClick={async () => {
                if (!(await askConfirm({ title: `Delete ${app.name}`, body: 'The bot leaves every server and its token stops working. This can’t be undone.', confirm: 'Delete', danger: true }))) return;
                await supabase.from('applications').delete().eq('id', app.id);
                go('bots');
              }}
            >
              Delete application
            </button>
          )}
          <span className="grow" />
          <button
            className="btn primary"
            onClick={async () => {
              const { error } = await supabase.from('applications').update({ name: name.trim(), description: description.trim(), color }).eq('id', app.id);
              setMsg(error ? errorMessage(error) : 'Saved');
              onSaved();
            }}
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}

interface InstallRow extends ServerBot {
  server_name?: string;
}

function ServersTab({ app, canEdit }: { app: Application; canEdit: boolean }) {
  const [installs, setInstalls] = useState<InstallRow[] | null>(null);
  const [requests, setRequests] = useState<{ id: string; server_id: string; created_at: string }[]>([]);
  const [invite, setInvite] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const { data } = await supabase.from('server_bots').select('id, server_id, app_id, added_by, settings, webhook_channel, created_at').eq('app_id', app.id);
    const rows = (data ?? []) as InstallRow[];
    const { data: reqs } = await supabase.from('bot_join_requests').select('id, server_id, created_at').eq('app_id', app.id);
    const ids = [...new Set([...rows.map((r) => r.server_id), ...(reqs ?? []).map((r) => r.server_id as string)])];
    const { data: servers } = ids.length ? await supabase.from('servers').select('id, name').in('id', ids) : { data: [] };
    const names = new Map((servers ?? []).map((s) => [s.id as string, s.name as string]));
    setInstalls(rows.map((r) => ({ ...r, server_name: names.get(r.server_id) })));
    setRequests(((reqs ?? []) as { id: string; server_id: string; created_at: string }[]).map((r) => ({ ...r, server_name: names.get(r.server_id) })));
  }, [app.id]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      {canEdit && (
        <div className="public-card">
          <h3>Add {app.name} to a server</h3>
          <p className="small muted">Paste an invite link. If you can manage integrations there the bot joins right away; otherwise the server’s admins get a request to approve.</p>
          {msg && <div className={msg.ok ? 'form-notice' : 'form-error'}>{msg.text}</div>}
          <div className="row">
            <input className="grow" value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="venband.com/invite/abc123" aria-label="Server invite" />
            <button
              className="btn primary"
              disabled={busy || !invite.trim()}
              onClick={async () => {
                setBusy(true);
                setMsg(null);
                const { data, error } = await supabase.rpc('bot_join_server', { p_app: app.id, p_code: invite.trim().replace(/[?#].*$/, '').replace(/\/+$/, '') });
                setBusy(false);
                if (error) return setMsg({ ok: false, text: errorMessage(error) });
                const st = (data as { status: string }).status;
                setMsg({ ok: true, text: st === 'joined' ? `${app.name} joined the server.` : st === 'already' ? `${app.name} is already in that server.` : 'Request sent — a server admin needs to approve it in Server Settings → Integrations.' });
                setInvite('');
                load();
              }}
            >
              {busy ? 'Adding…' : 'Add bot'}
            </button>
          </div>
        </div>
      )}
      {requests.length > 0 && (
        <div className="public-card">
          <h3>Waiting for approval</h3>
          {requests.map((r) => (
            <div key={r.id} className="app-row static">
              <Icon name="clock" size={18} />
              <span className="grow">{(r as { server_name?: string }).server_name ?? 'A server'}</span>
              <span className="small muted">{new Date(r.created_at).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}
      <h3>In {installs?.length ?? 0} server{installs?.length === 1 ? '' : 's'}</h3>
      {installs === null && <div className="spinner" />}
      {installs?.map((i) => (
        <div key={i.id} className="public-card">
          <div className="row">
            <b className="grow">{i.server_name ?? 'A server you’re not in'}</b>
            {i.server_name && (
              <button className="btn link small" onClick={() => go(`channels/${i.server_id}`)}>
                Open
              </button>
            )}
          </div>
          {i.server_name && <BotInstallSettings install={i} app={app} onChanged={load} />}
        </div>
      ))}
    </>
  );
}

/** A bot's settings for one server (also used in Server Settings → Integrations). */
export function BotInstallSettings({ install, app, onChanged }: { install: ServerBot; app: Application; onChanged: () => void }) {
  const [channels, setChannels] = useState<{ id: string; name: string; type: string }[]>([]);
  const [roles, setRoles] = useState<{ id: string; name: string; is_default: boolean }[]>([]);
  const [s, setS] = useState(install.settings);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [hookChannel, setHookChannel] = useState(install.webhook_channel ?? '');
  const [hookUrl, setHookUrl] = useState<string | null>(null);
  useEffect(() => {
    supabase.from('channels').select('id, name, type').eq('server_id', install.server_id).in('type', ['text', 'announcement']).order('position').then(({ data }) => setChannels((data ?? []) as typeof channels));
    supabase.from('roles').select('id, name, is_default').eq('server_id', install.server_id).order('position', { ascending: false }).then(({ data }) => setRoles((data ?? []) as typeof roles));
  }, [install.server_id]);
  const chOpts = [{ value: '', label: 'Off' }, ...channels.map((c) => ({ value: c.id, label: `#${c.name}` }))];

  const remove = (
    <button
      className="btn danger small"
      onClick={async () => {
        if (!(await askConfirm({ title: `Remove ${app.name}`, body: 'The bot leaves this server.', confirm: 'Remove', danger: true }))) return;
        const { error } = await supabase.rpc('remove_bot', { p_install: install.id });
        if (error) return setMsg({ ok: false, text: errorMessage(error) });
        onChanged();
      }}
    >
      Remove from server
    </button>
  );

  return (
    <div className="bot-settings">
      {msg && <div className={msg.ok ? 'form-notice' : 'form-error'}>{msg.text}</div>}
      {app.preset === 'management' && (
        <>
          <Field label="Welcome channel">
            <Select value={s.welcome_channel ?? ''} onChange={(v) => setS({ ...s, welcome_channel: v || undefined })} options={chOpts} />
          </Field>
          <Field label="Welcome message" hint="{user} mentions the new member, {server} is the server name.">
            <textarea rows={2} maxLength={1000} value={s.welcome_text ?? ''} onChange={(e) => setS({ ...s, welcome_text: e.target.value })} />
          </Field>
          <Field label="Give new members these roles" hint="Up to 5. Only roles below your highest role.">
            <div className="chip-row">
              {roles
                .filter((r) => !r.is_default)
                .map((r) => {
                  const on = (s.auto_roles ?? []).includes(r.id);
                  return (
                    <button key={r.id} type="button" className={`chip${on ? ' on' : ''}`} onClick={() => setS({ ...s, auto_roles: on ? (s.auto_roles ?? []).filter((x) => x !== r.id) : [...(s.auto_roles ?? []), r.id].slice(0, 5) })}>
                      {r.name}
                    </button>
                  );
                })}
            </div>
          </Field>
          <Field label="Join / leave log">
            <Select value={s.log_channel ?? ''} onChange={(v) => setS({ ...s, log_channel: v || undefined })} options={chOpts} />
          </Field>
          <div className="modal-actions">
            {remove}
            <span className="grow" />
            <button
              className="btn primary"
              onClick={async () => {
                const { data, error } = await supabase.rpc('update_bot_settings', { p_install: install.id, p_settings: s });
                if (error) return setMsg({ ok: false, text: errorMessage(error) });
                setS(data as ServerBot['settings']);
                setMsg({ ok: true, text: 'Saved' });
              }}
            >
              Save settings
            </button>
          </div>
        </>
      )}
      {app.preset === 'site' && (
        <>
          <p className="small muted">Your site sends a POST request to a secret URL and the bot posts it in the channel. Anyone with the URL can post, so keep it secret.</p>
          <Field label="Post into">
            <Select value={hookChannel} onChange={setHookChannel} options={chOpts.slice(1)} placeholder="Pick a channel" />
          </Field>
          {hookUrl && (
            <div className="secret-box">
              <div className="small">Copy it now — it won’t be shown again.</div>
              <div className="copy-row">
                <input readOnly value={hookUrl} onFocus={(e) => e.target.select()} />
                <button className="btn primary small" onClick={() => navigator.clipboard.writeText(hookUrl)}>
                  <Icon name="copy" size={14} /> Copy
                </button>
              </div>
              <pre className="code-sample">{`curl -X POST '${hookUrl}' \\\n  -H 'content-type: application/json' \\\n  -d '{"content": "New order #1042 🎉", "embed": {"title": "Order", "url": "https://example.com/orders/1042"}}'`}</pre>
            </div>
          )}
          <div className="modal-actions">
            {remove}
            <span className="grow" />
            <button
              className="btn primary"
              disabled={!hookChannel}
              onClick={async () => {
                const { data, error } = await supabase.rpc('reset_bot_webhook', { p_install: install.id, p_channel: hookChannel });
                if (error) return setMsg({ ok: false, text: errorMessage(error) });
                setHookUrl(`${apiBase()}/hooks?id=${install.id}&token=${data as string}`);
                onChanged();
              }}
            >
              {install.webhook_channel ? 'Make a new URL' : 'Create webhook URL'}
            </button>
          </div>
        </>
      )}
      {app.preset === 'verification' && (
        <>
          <p className="small muted">
            Turn on Voogle and choose the verified role in Server Settings → Voogle. Members type <code>/verify</code> or open the link on the welcome screen.
          </p>
          <div className="modal-actions">
            {remove}
            <span className="grow" />
            <button className="btn secondary" onClick={() => go(`voogle?server=${install.server_id}`)}>
              Open Voogle
            </button>
          </div>
        </>
      )}
      {app.preset === 'wordle' && (
        <>
          <p className="small muted">
            Anyone in the server can play. Type <code>/wordle</code> to start a game, then <code>/guess WORD</code> to play — all matching the answer gives the round. One game runs per channel at a time.
          </p>
          <div className="modal-actions">{remove}</div>
        </>
      )}
      {app.preset === 'custom' && <div className="modal-actions">{remove}</div>}
    </div>
  );
}

function TokenTab({ app, canEdit, onChanged }: { app: Application; canEdit: boolean; onChanged: () => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [commands, setCommands] = useState<{ name: string; description: string }[]>([]);
  useEffect(() => {
    supabase.from('bot_commands').select('name, description').eq('app_id', app.id).then(({ data }) => setCommands((data ?? []) as typeof commands));
  }, [app.id]);
  return (
    <>
      <div className="public-card">
        <h3>Bot token</h3>
        <p className="small muted">
          The token lets code act as {app.name}. Never share it or put it in a website’s code. {app.token_hint ? `Current token ends in …${app.token_hint}.` : 'No token yet.'}
        </p>
        {token && (
          <div className="secret-box">
            <div className="small">Copy it now — it won’t be shown again.</div>
            <div className="copy-row">
              <input readOnly value={token} onFocus={(e) => e.target.select()} aria-label="Bot token" />
              <button className="btn primary small" onClick={() => navigator.clipboard.writeText(token)}>
                <Icon name="copy" size={14} /> Copy
              </button>
            </div>
          </div>
        )}
        {canEdit && (
          <button
            className="btn primary"
            onClick={async () => {
              if (app.token_hint && !(await askConfirm({ title: 'Reset token', body: 'The old token stops working right away.', confirm: 'Reset' }))) return;
              const { data, error } = await supabase.rpc('reset_bot_token', { p_app: app.id });
              if (!error) setToken(data as string);
              onChanged();
            }}
          >
            {app.token_hint ? 'Reset token' : 'Make a token'}
          </button>
        )}
      </div>
      <div className="public-card">
        <h3>Slash commands</h3>
        {commands.length === 0 ? (
          <p className="small muted">None registered. Use the <code>commands.set</code> API call below.</p>
        ) : (
          <ul className="cmd-list">
            {commands.map((c) => (
              <li key={c.name}>
                <code>/{c.name}</code> <span className="muted small">{c.description}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function TeamTab({ app, canEdit }: { app: Application; canEdit: boolean }) {
  const [rows, setRows] = useState<{ user_id: string; role: string; profiles?: { username: string; display_name: string | null } }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase.from('application_team').select('user_id, role').eq('app_id', app.id);
    const ids = (data ?? []).map((r) => r.user_id as string);
    const { data: profs } = ids.length ? await supabase.from('profiles').select('id, username, display_name').in('id', ids) : { data: [] };
    const byId = new Map((profs ?? []).map((p) => [p.id as string, p]));
    setRows(((data ?? []) as { user_id: string; role: string }[]).map((r) => ({ ...r, profiles: byId.get(r.user_id) as { username: string; display_name: string | null } | undefined })));
  }, [app.id]);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <div className="public-card">
      <h3>Team</h3>
      <p className="small muted">People you add can open this dashboard. Admins can change settings, add the bot to servers and reset the token; viewers can only look.</p>
      {error && <div className="form-error">{error}</div>}
      {rows.length === 0 && <p className="muted small">Just you for now.</p>}
      {rows.map((r) => (
        <div key={r.user_id} className="app-row static">
          <span className="grow">
            <b>{r.profiles?.display_name ?? r.profiles?.username ?? 'Someone'}</b> <span className="muted small">@{r.profiles?.username}</span>
          </span>
          <span className="pill">{r.role}</span>
          {canEdit && (
            <button className="btn link small danger-text" onClick={() => supabase.rpc('app_remove_member', { p_app: app.id, p_user: r.user_id }).then(load)}>
              Remove
            </button>
          )}
        </div>
      ))}
      {canEdit && (
        <div className="row">
          <button
            className="btn secondary"
            onClick={async () => {
              const u = await askText({ title: 'Add a teammate', label: 'Username', maxLength: 32 });
              if (!u?.trim()) return;
              const admin = await askConfirm({ title: 'Make them an admin?', body: 'Admins can change settings and reset the token. Choose “Viewer only” to let them look without changing anything.', confirm: 'Admin' });
              const { error } = await supabase.rpc('app_add_member', { p_app: app.id, p_username: u.trim().replace(/^@/, ''), p_role: admin ? 'admin' : 'viewer' });
              setError(error ? errorMessage(error) : null);
              load();
            }}
          >
            <Icon name="userPlus" size={14} /> Add someone
          </button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------- API docs ----

function ApiDocs() {
  const base = apiBase();
  return (
    <section className="public-doc api-docs" id="api">
      <h2>Bot API</h2>
      <p>
        Send requests to <code>{base}/bot</code> with your token in the <code>Authorization</code> header. Every call is a POST with a JSON body:{' '}
        <code>{'{"action": "...", ...arguments}'}</code>. Bots can post at most 10 messages every 10 seconds.
      </p>
      <pre className="code-sample">{`curl -X POST ${base}/bot \\
  -H 'authorization: Bot vb_YOUR_TOKEN' \\
  -H 'content-type: application/json' \\
  -d '{"action": "send", "channel": "CHANNEL_ID", "content": "Hello from my bot 👋"}'`}</pre>
      <table className="api-table">
        <thead>
          <tr>
            <th>action</th>
            <th>arguments</th>
            <th>returns</th>
          </tr>
        </thead>
        <tbody>
          <tr><td><code>me</code></td><td>—</td><td>the bot and the servers it’s in</td></tr>
          <tr><td><code>channels</code></td><td><code>server</code></td><td>public channels in a server</td></tr>
          <tr><td><code>members</code></td><td><code>server</code></td><td>up to 1,000 members (id, username, joined_at)</td></tr>
          <tr><td><code>send</code></td><td><code>channel</code>, <code>content</code>, <code>embed?</code></td><td>the new message id</td></tr>
          <tr><td><code>commands.set</code></td><td><code>commands: [{'{'}name, description{'}'}]</code></td><td>registers slash commands</td></tr>
          <tr><td><code>events</code></td><td><code>after?</code> (ISO time)</td><td>slash commands used and members joining</td></tr>
          <tr><td><code>reply</code></td><td><code>interaction</code>, <code>content</code>, <code>embed?</code></td><td>answers a slash command</td></tr>
          <tr><td><code>voogle.check</code></td><td><code>server</code>, <code>user</code></td><td>a risk score — never IPs or device data</td></tr>
        </tbody>
      </table>
      <p className="small muted">
        Embeds: <code>{'{"title", "description", "url" (https only), "color" ("#rrggbb"), "footer", "fields": [{"name", "value"}]}'}</code>. What bots post is not end-to-end
        encrypted, and Venband shows a BOT tag on it.
      </p>
    </section>
  );
}
