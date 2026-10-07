// Server settings: invites (analytics, pause, custom link), emoji / GIFs /
// stickers / sounds, the server's look, welcome screen + rules + onboarding +
// joining rules, and Server Discovery.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, errorMessage } from '../lib/supabase';
import { displayName, loadProfiles } from '../lib/directory';
import { has, P } from '../lib/permissions';
import { inviteUrl } from '../lib/dmSend';
import type { ServerData } from '../hooks/data';
import type { Invite, Server, ServerTheme } from '../lib/types';
import { copyText } from './ContextMenu';
import { askConfirm, askText } from './Dialogs';
import { Select } from './Select';
import { ColorPicker, Field, Icon } from './ui';
import { playExpressionSound } from '../lib/soundboard';
import { loadExpressions } from '../lib/expressions';

type InviteRow = Invite & { paused?: boolean; label?: string | null; min_account_days?: number };

// --------------------------------------------------------------- invites --

export function InvitesTab({ data }: { data: ServerData }) {
  const server = data.server!;
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [uses, setUses] = useState<{ code: string; user_id: string; used_at: string }[]>([]);
  const [vanity, setVanity] = useState(server.vanity ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    const [{ data: rows }, { data: u }] = await Promise.all([
      supabase.from('invites').select('*').eq('server_id', server.id).order('created_at', { ascending: false }),
      supabase.from('invite_uses').select('code, user_id, used_at').eq('server_id', server.id).order('used_at', { ascending: false }).limit(500),
    ]);
    setInvites((rows ?? []) as InviteRow[]);
    setUses((u ?? []) as typeof uses);
    loadProfiles([...(rows ?? []).map((r) => r.created_by), ...(u ?? []).map((r) => r.user_id)]);
  }, [server.id]);
  useEffect(() => {
    load();
  }, [load]);
  const eligible = server.verified || data.members.length >= 500;
  const status = (i: InviteRow) =>
    i.paused ? 'paused' : i.expires_at && new Date(i.expires_at) < new Date() ? 'expired' : i.max_uses && i.uses >= i.max_uses ? 'used up' : 'active';
  const joinsByCode = useMemo(() => {
    const m: Record<string, number> = {};
    for (const u of uses) m[u.code] = (m[u.code] ?? 0) + 1;
    return m;
  }, [uses]);

  return (
    <div className="settings-section">
      {msg && <div className="notice">{msg}</div>}
      <h3>Custom invite link</h3>
      {eligible ? (
        <div className="copy-row">
          <span className="prefix">venband.com/invite/</span>
          <input value={vanity} maxLength={32} placeholder="your-server" onChange={(e) => setVanity(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} />
          <button
            className="btn primary"
            onClick={async () => {
              const { data: v, error } = await supabase.rpc('set_vanity', { p_server: server.id, p_vanity: vanity });
              setMsg(error ? errorMessage(error) : v ? `Your link is https://venband.gg/${v} — https://venband.com/invite/${v} also works.` : 'Custom link removed.');
              data.reload();
            }}
          >
            Save
          </button>
        </div>
      ) : (
        <p className="small muted">Verified servers and servers with 500+ members can pick a custom link like venband.com/invite/your-name.</p>
      )}
      <div className="row-between">
        <h3>Invites</h3>
        <div className="row">
          <button
            className="btn secondary small"
            onClick={async () => {
              await supabase.from('servers').update({ joins_paused: !server.joins_paused }).eq('id', server.id);
              data.reload();
            }}
          >
            {server.joins_paused ? 'Resume joins' : 'Pause all joins'}
          </button>
          <button
            className="btn danger small"
            disabled={!invites.length}
            onClick={async () => {
              if (!(await askConfirm({ title: 'Revoke all invites', body: 'Every invite link stops working right away. Members already here stay.', confirm: 'Revoke All', danger: true }))) return;
              await supabase.from('invites').delete().eq('server_id', server.id);
              load();
            }}
          >
            Revoke all
          </button>
        </div>
      </div>
      {server.joins_paused && <div className="warning-box">New members can’t join right now (invite links are kept).</div>}
      <div className="invite-table">
        <div className="invite-table-head small muted">
          <span>Invite</span>
          <span>Created by</span>
          <span>Uses</span>
          <span>Joined</span>
          <span>Expires</span>
          <span />
        </div>
        {!invites.length && <p className="muted">No invites yet.</p>}
        {invites.map((i) => (
          <div key={i.code} className={`invite-table-row status-${status(i).replace(' ', '-')}`}>
            <span>
              <button className="btn link mono" onClick={() => copyText(inviteUrl(i.code))} title="Copy link">
                {i.code}
              </button>
              {i.label && <span className="small muted"> · {i.label}</span>}
              <span className={`invite-status ${status(i).replace(' ', '-')}`}>{status(i)}</span>
            </span>
            <span className="small">{displayName(i.created_by)}</span>
            <span className="small">
              {i.uses}
              {i.max_uses ? ` / ${i.max_uses}` : ''}
            </span>
            <span className="small">{joinsByCode[i.code] ?? 0}</span>
            <span className="small muted">{i.expires_at ? new Date(i.expires_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : 'never'}</span>
            <span className="row">
              <button
                className="btn secondary small"
                onClick={async () => {
                  await supabase.from('invites').update({ paused: !i.paused }).eq('code', i.code);
                  load();
                }}
              >
                {i.paused ? 'Resume' : 'Pause'}
              </button>
              <button
                className="btn danger small"
                onClick={async () => {
                  await supabase.from('invites').delete().eq('code', i.code);
                  load();
                }}
              >
                Revoke
              </button>
            </span>
          </div>
        ))}
      </div>
      <h3>Recent joins</h3>
      <div className="member-table">
        {!uses.length && <p className="small muted">Nobody has joined through an invite yet.</p>}
        {uses.slice(0, 50).map((u, n) => (
          <div key={n} className="member-row">
            <span>{displayName(u.user_id)}</span>
            <span className="small muted">via {u.code.startsWith('vanity:') ? 'custom link' : u.code}</span>
            <span className="small muted">{new Date(u.used_at).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ----------------------------------------------------------- expressions --

type Expr = { id: string; kind: 'emoji' | 'gif' | 'sticker' | 'sound'; name: string; aliases: string[]; url: string; mime: string; size: number; duration_ms: number | null; emoji: string | null };

const LIMITS = {
  emoji: { bytes: 256 * 1024, px: 128, accept: 'image/png,image/jpeg,image/webp,image/gif', label: 'Emoji' },
  gif: { bytes: 2 * 1024 * 1024, px: 0, accept: 'image/gif,image/webp', label: 'GIFs' },
  sticker: { bytes: 512 * 1024, px: 320, accept: 'image/png,image/webp,image/gif,image/jpeg', label: 'Stickers' },
  sound: { bytes: 1024 * 1024, px: 0, accept: 'audio/mpeg,audio/ogg,audio/wav,audio/webm,audio/mp4,audio/aac,.mp3,.ogg,.wav', label: 'Soundboard' },
} as const;

async function shrinkImage(file: File, px: number): Promise<Blob> {
  if (file.type === 'image/gif' || !px) return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, px / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not read that picture.'))), 'image/webp', 0.92));
}

async function audioDuration(file: File): Promise<number> {
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    return Math.round(buf.duration * 1000);
  } finally {
    ctx.close();
  }
}

export function ExpressionsTab({ data }: { data: ServerData }) {
  const server = data.server!;
  const can = has(data.myPermissions, P.MANAGE_EXPRESSIONS);
  const [kind, setKind] = useState<Expr['kind']>('emoji');
  const [items, setItems] = useState<Expr[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data: rows } = await supabase.from('server_expressions').select('*').eq('server_id', server.id).order('created_at');
    setItems((rows ?? []) as Expr[]);
    loadExpressions(true);
  }, [server.id]);
  useEffect(() => {
    load();
  }, [load]);
  const list = items.filter((i) => i.kind === kind);
  const lim = LIMITS[kind];

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of [...files].slice(0, 10)) {
        let blob: Blob = file;
        let duration: number | null = null;
        if (kind === 'sound') {
          duration = await audioDuration(file).catch(() => {
            throw new Error(`${file.name} isn’t an audio file we can play.`);
          });
          if (duration > 10_000) throw new Error(`${file.name} is ${(duration / 1000).toFixed(1)} s long. Sounds can be up to 10 seconds.`);
        } else blob = await shrinkImage(file, lim.px);
        if (blob.size > lim.bytes) throw new Error(`${file.name} is too big (max ${Math.round(lim.bytes / 1024)} KB).`);
        const base = file.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'item';
        const name = base.length < 2 ? `${base}_1` : base;
        const ext = blob.type.split('/')[1]?.replace('mpeg', 'mp3').replace('x-wav', 'wav') || 'bin';
        const path = `${server.id}/expr/${crypto.randomUUID()}.${ext}`;
        const { error: up } = await supabase.storage.from('server-assets').upload(path, blob, { contentType: blob.type || file.type, upsert: false });
        if (up) throw up;
        const url = supabase.storage.from('server-assets').getPublicUrl(path).data.publicUrl;
        const { error: ins } = await supabase.from('server_expressions').insert({ server_id: server.id, kind, name, url, mime: blob.type || file.type, size: blob.size, duration_ms: duration, emoji: kind === 'sound' ? '🔊' : null });
        if (ins) throw ins;
      }
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-section">
      <div className="tabs">
        {(Object.keys(LIMITS) as Expr['kind'][]).map((k) => (
          <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
            {LIMITS[k].label} <span className="small muted">{items.filter((i) => i.kind === k).length}</span>
          </button>
        ))}
      </div>
      <p className="small muted">
        {kind === 'sound'
          ? 'Sounds up to 10 seconds and 1 MB. Members can play them in any call on Venband while they’re in this server.'
          : `Members can use these anywhere on Venband while they’re in this server. Max ${Math.round(lim.bytes / 1024)} KB.`}
      </p>
      {error && <div className="form-error">{error}</div>}
      {can && (
        <label className={`btn primary${busy ? ' disabled' : ''}`}>
          <Icon name="upload" size={16} /> {busy ? 'Uploading…' : `Upload ${kind === 'gif' ? 'GIF' : kind}`}
          <input type="file" hidden multiple accept={lim.accept} disabled={busy} onChange={(e) => (upload(e.target.files), (e.target.value = ''))} />
        </label>
      )}
      <div className={`expr-grid ${kind}`}>
        {list.map((x) => (
          <div key={x.id} className="expr-item">
            {x.kind === 'sound' ? (
              <button className="expr-sound" onClick={() => playExpressionSound(x.url, 1)} title="Play">
                <span>{x.emoji ?? '🔊'}</span>
              </button>
            ) : (
              <img src={x.url} alt={`:${x.name}:`} loading="lazy" />
            )}
            <div className="expr-meta">
              <code className="small">:{x.name}:</code>
              {x.aliases.length > 0 && <span className="small muted">also :{x.aliases.join(': :')}:</span>}
              {x.duration_ms && <span className="small muted">{(x.duration_ms / 1000).toFixed(1)} s</span>}
            </div>
            {can && (
              <div className="expr-actions">
                <button
                  className="icon-btn small"
                  title="Rename / add aliases"
                  onClick={async () => {
                    const v = await askText({ title: 'Names', label: 'Name, then other names separated by spaces (e.g. heart love luv)', initial: [x.name, ...x.aliases].join(' '), maxLength: 200 });
                    if (!v?.trim()) return;
                    const names = v.trim().split(/\s+/).map((n) => n.replace(/[^A-Za-z0-9_]/g, '')).filter((n) => n.length >= 2);
                    const { error: e } = await supabase.from('server_expressions').update({ name: names[0], aliases: names.slice(1, 6) }).eq('id', x.id);
                    if (e) setError(errorMessage(e));
                    load();
                  }}
                >
                  <Icon name="edit" size={14} />
                </button>
                {x.kind === 'sound' && (
                  <button
                    className="icon-btn small"
                    title="Change emoji"
                    onClick={async () => {
                      const v = await askText({ title: 'Sound emoji', label: 'An emoji shown on the soundboard button', initial: x.emoji ?? '🔊', maxLength: 8 });
                      if (v) await supabase.from('server_expressions').update({ emoji: v.trim() }).eq('id', x.id);
                      load();
                    }}
                  >
                    <Icon name="smile" size={14} />
                  </button>
                )}
                <button
                  className="icon-btn small danger-text"
                  title="Delete"
                  onClick={async () => {
                    await supabase.from('server_expressions').delete().eq('id', x.id);
                    load();
                  }}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            )}
          </div>
        ))}
        {!list.length && <p className="muted">Nothing here yet.</p>}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- theme --

const THEME_FIELDS: { key: keyof ServerTheme; label: string; hint: string }[] = [
  { key: 'accent', label: 'Accent', hint: 'buttons, highlights' },
  { key: 'bg', label: 'Background', hint: 'behind everything' },
  { key: 'surface', label: 'Panels', hint: 'sidebars and cards' },
  { key: 'text', label: 'Text', hint: 'main text color' },
  { key: 'channel', label: 'Channel names', hint: 'in the channel list' },
  { key: 'category', label: 'Category names', hint: 'in the channel list' },
];

export function ThemeTab({ data }: { data: ServerData }) {
  const server = data.server!;
  const [theme, setTheme] = useState<ServerTheme>(server.theme ?? {});
  const [msg, setMsg] = useState<string | null>(null);
  const categories = [...new Set(data.channels.map((c) => c.category).filter(Boolean))];
  const set = (k: keyof ServerTheme, v: string | undefined) => setTheme((t) => ({ ...t, [k]: v }));
  return (
    <div className="settings-section">
      <p className="muted">Give your server its own look. Members see it while they’re here, unless they turn server themes off (Settings → Appearance).</p>
      {msg && <div className="notice">{msg}</div>}
      <div className="theme-fields">
        {THEME_FIELDS.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint} aside={theme[f.key] ? <button className="btn link small" onClick={() => set(f.key, undefined)}>Reset</button> : null}>
            <ColorPicker value={(theme[f.key] as string) ?? '#5865f2'} onChange={(c) => set(f.key, c)} />
          </Field>
        ))}
      </div>
      {categories.length > 0 && (
        <>
          <h3>Category colors</h3>
          <div className="theme-fields">
            {categories.map((c) => (
              <Field key={c} label={c}>
                <ColorPicker value={theme.categories?.[c] ?? '#888888'} onChange={(v) => setTheme((t) => ({ ...t, categories: { ...(t.categories ?? {}), [c]: v } }))} />
              </Field>
            ))}
          </div>
        </>
      )}
      <div className="server-theme-preview" style={themeVars(theme)}>
        <div className="stp-side">
          <div className="stp-cat" style={{ color: theme.category }}>TEXT CHANNELS</div>
          <div className="stp-chan" style={{ color: theme.channel }}># general</div>
          <div className="stp-chan" style={{ color: theme.channel }}># memes</div>
        </div>
        <div className="stp-main">
          <b>Preview</b>
          <p>This is how your server looks.</p>
          <span className="stp-btn">Button</span>
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn secondary" onClick={() => setTheme({})}>
          Remove server theme
        </button>
        <button
          className="btn primary"
          onClick={async () => {
            const { error } = await supabase.from('servers').update({ theme }).eq('id', server.id);
            setMsg(error ? errorMessage(error) : 'Saved. Members see the new look right away.');
            data.reload();
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

/** CSS variables for a server theme (only the colors it sets). */
export function themeVars(t: ServerTheme | undefined): React.CSSProperties {
  if (!t) return {};
  const v: Record<string, string> = {};
  if (t.accent) (v['--accent'] = t.accent), (v['--accent-soft'] = `${t.accent}33`);
  if (t.bg) (v['--bg-0'] = t.bg), (v['--bg-1'] = t.bg);
  if (t.surface) (v['--bg-2'] = t.surface), (v['--bg-3'] = t.surface);
  if (t.text) v['--text'] = t.text;
  return v as React.CSSProperties;
}

// --------------------------------------------------- welcome, rules, joining --

export function JoiningTab({ data }: { data: ServerData }) {
  const server = data.server!;
  const [welcome, setWelcome] = useState(server.welcome ?? {});
  const [rules, setRules] = useState<string[]>(server.rules ?? []);
  const [onboarding, setOnboarding] = useState(server.onboarding ?? {});
  const [verification, setVerification] = useState(server.verification ?? {});
  const [joinMode, setJoinMode] = useState(server.join_mode ?? 'invite');
  const [publicPreview, setPublicPreview] = useState(server.public_preview ?? true);
  const [msg, setMsg] = useState<string | null>(null);
  const textChannels = data.channels.filter((c) => c.type !== 'voice' && c.type !== 'stage');
  const roles = data.roles.filter((r) => !r.is_default && (r.permissions & P.ADMINISTRATOR) === 0);
  const questions = onboarding.questions ?? [];

  async function save() {
    const patch: Partial<Server> = {
      welcome,
      rules: rules.map((r) => r.trim()).filter(Boolean).slice(0, 25),
      onboarding,
      verification,
      join_mode: joinMode,
      public_preview: publicPreview,
    };
    const { error } = await supabase.from('servers').update(patch).eq('id', server.id);
    setMsg(error ? errorMessage(error) : 'Saved.');
    data.reload();
  }

  return (
    <div className="settings-section">
      {msg && <div className="notice">{msg}</div>}
      <h3>Who can join</h3>
      <div className="radio-cards">
        {(
          [
            ['invite', 'Invite only', 'People join with an invite link.'],
            ['open', 'Open', 'Anyone who finds the server (server tag, profile) can join.'],
            ['private', 'Private', 'Invite links only, and the server never shows up in previews.'],
          ] as const
        ).map(([id, label, desc]) => (
          <label key={id} className={`radio-card${joinMode === id ? ' selected' : ''}`}>
            <input type="radio" name="joinmode" checked={joinMode === id} onChange={() => setJoinMode(id)} />
            <b>{label}</b>
            <span className="small muted">{desc}</span>
          </label>
        ))}
      </div>
      <label className="check-row">
        <input type="checkbox" checked={publicPreview} onChange={(e) => setPublicPreview(e.target.checked)} /> Show the invite preview to people who aren’t signed in
      </label>
      <h3>Verification</h3>
      <div className="row">
        <Field label="Minimum account age">
          <Select
            value={String(verification.min_account_days ?? 0)}
            onChange={(v) => setVerification({ ...verification, min_account_days: Number(v), level: Number(v) ? 'account_age' : 'none' })}
            options={[
              { value: '0', label: 'No requirement' },
              { value: '1', label: '1 day' },
              { value: '7', label: '1 week' },
              { value: '30', label: '1 month' },
              { value: '90', label: '3 months' },
            ]}
          />
        </Field>
      </div>
      <h3>Rules</h3>
      <p className="small muted">New members must accept these before they can talk. Until then they can only read.</p>
      {rules.map((r, i) => (
        <div key={i} className="copy-row">
          <span className="rule-num">{i + 1}.</span>
          <input maxLength={300} value={r} onChange={(e) => setRules(rules.map((x, j) => (j === i ? e.target.value : x)))} />
          <button className="icon-btn" onClick={() => setRules(rules.filter((_, j) => j !== i))} aria-label="Remove rule">
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
      {rules.length < 25 && (
        <button className="btn link small" onClick={() => setRules([...rules, ''])}>
          + Add rule
        </button>
      )}
      <h3>Welcome screen</h3>
      <Field label="Message">
        <textarea maxLength={500} rows={3} value={welcome.message ?? ''} onChange={(e) => setWelcome({ ...welcome, message: e.target.value })} placeholder="Welcome! Here’s where to start…" />
      </Field>
      {(welcome.buttons ?? []).map((b, i) => (
        <div key={i} className="copy-row">
          <input className="emoji-input" maxLength={8} value={b.emoji ?? ''} placeholder="👋" onChange={(e) => setWelcome({ ...welcome, buttons: welcome.buttons!.map((x, j) => (j === i ? { ...x, emoji: e.target.value } : x)) })} />
          <input maxLength={40} value={b.label} placeholder="Say hi" onChange={(e) => setWelcome({ ...welcome, buttons: welcome.buttons!.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
          <Select
            value={b.channel_id}
            onChange={(v) => setWelcome({ ...welcome, buttons: welcome.buttons!.map((x, j) => (j === i ? { ...x, channel_id: v } : x)) })}
            options={textChannels.map((c) => ({ value: c.id, label: `#${c.name}` }))}
          />
          <button className="icon-btn" onClick={() => setWelcome({ ...welcome, buttons: welcome.buttons!.filter((_, j) => j !== i) })} aria-label="Remove button">
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
      {(welcome.buttons ?? []).length < 5 && textChannels.length > 0 && (
        <button className="btn link small" onClick={() => setWelcome({ ...welcome, buttons: [...(welcome.buttons ?? []), { label: '', channel_id: textChannels[0].id }] })}>
          + Add a button to a channel
        </button>
      )}
      <h3>Onboarding questions</h3>
      <p className="small muted">New members pick answers and get the matching roles (and the channels those roles can see) automatically.</p>
      {questions.map((q, qi) => (
        <div key={qi} className="onboarding-q">
          <div className="copy-row">
            <input maxLength={100} value={q.title} placeholder="What brings you here?" onChange={(e) => setOnboarding({ questions: questions.map((x, j) => (j === qi ? { ...x, title: e.target.value } : x)) })} />
            <label className="check-row small">
              <input type="checkbox" checked={Boolean(q.multi)} onChange={(e) => setOnboarding({ questions: questions.map((x, j) => (j === qi ? { ...x, multi: e.target.checked } : x)) })} /> several answers
            </label>
            <button className="icon-btn" onClick={() => setOnboarding({ questions: questions.filter((_, j) => j !== qi) })} aria-label="Remove question">
              <Icon name="trash" size={14} />
            </button>
          </div>
          {q.options.map((o, oi) => (
            <div key={oi} className="copy-row onboarding-opt">
              <input className="emoji-input" maxLength={8} value={o.emoji ?? ''} placeholder="🎮" onChange={(e) => setOnboarding({ questions: questions.map((x, j) => (j === qi ? { ...x, options: x.options.map((y, k) => (k === oi ? { ...y, emoji: e.target.value } : y)) } : x)) })} />
              <input maxLength={60} value={o.label} placeholder="Gaming" onChange={(e) => setOnboarding({ questions: questions.map((x, j) => (j === qi ? { ...x, options: x.options.map((y, k) => (k === oi ? { ...y, label: e.target.value } : y)) } : x)) })} />
              <Select
                value={o.role_ids[0] ?? ''}
                placeholder="Give role…"
                onChange={(v) => setOnboarding({ questions: questions.map((x, j) => (j === qi ? { ...x, options: x.options.map((y, k) => (k === oi ? { ...y, role_ids: v ? [v] : [] } : y)) } : x)) })}
                options={[{ value: '', label: 'No role' }, ...roles.map((r) => ({ value: r.id, label: r.name }))]}
              />
              <button className="icon-btn" onClick={() => setOnboarding({ questions: questions.map((x, j) => (j === qi ? { ...x, options: x.options.filter((_, k) => k !== oi) } : x)) })} aria-label="Remove answer">
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
          {q.options.length < 10 && (
            <button className="btn link small" onClick={() => setOnboarding({ questions: questions.map((x, j) => (j === qi ? { ...x, options: [...x.options, { label: '', role_ids: [] }] } : x)) })}>
              + Add answer
            </button>
          )}
        </div>
      ))}
      {questions.length < 5 && (
        <button className="btn secondary small" onClick={() => setOnboarding({ questions: [...questions, { title: '', options: [{ label: '', role_ids: [] }] }] })}>
          + Add question
        </button>
      )}
      <div className="modal-actions sticky-actions">
        <button className="btn primary" onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- discovery --

export function DiscoveryTab({ data }: { data: ServerData }) {
  const server = data.server!;
  const [pitch, setPitch] = useState('');
  const [apps, setApps] = useState<{ id: string; status: string; created_at: string; note: string | null }[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data: rows } = await supabase.from('discovery_applications').select('id, status, created_at, note').eq('server_id', server.id).order('created_at', { ascending: false });
    setApps((rows ?? []) as typeof apps);
  }, [server.id]);
  useEffect(() => {
    load();
  }, [load]);
  const status = server.discovery_status ?? 'none';
  return (
    <div className="settings-section">
      <p className="muted">Approved servers show up on the Discover page, where anyone on Venband can find and join them.</p>
      <div className={`discovery-status ${status}`}>
        {status === 'approved' ? '✅ Listed in Server Discovery' : status === 'pending' ? '⏳ Your application is being reviewed' : status === 'rejected' ? '❌ Not approved this time — you can apply again' : 'Not listed yet'}
        {server.verified && ' · verified servers are always listed'}
      </div>
      {msg && <div className="notice">{msg}</div>}
      {status !== 'pending' && status !== 'approved' && (
        <>
          <Field label="Tell people (and our reviewers) about your server">
            <textarea maxLength={1000} rows={4} value={pitch} onChange={(e) => setPitch(e.target.value)} />
          </Field>
          <button
            className="btn primary"
            onClick={async () => {
              const { error } = await supabase.rpc('apply_for_discovery', { p_server: server.id, p_pitch: pitch, p_categories: server.category_tags ?? [], p_language: server.language ?? 'en' });
              setMsg(error ? errorMessage(error) : 'Application sent! Venband staff will review it.');
              data.reload();
              load();
            }}
          >
            Apply for Discovery
          </button>
        </>
      )}
      {status === 'approved' && (
        <label className="check-row">
          <input
            type="checkbox"
            checked={server.discoverable !== false}
            onChange={async (e) => {
              await supabase.from('servers').update({ discoverable: e.target.checked }).eq('id', server.id);
              data.reload();
            }}
          />
          Show this server on the Discover page
        </label>
      )}
      <h3>History</h3>
      {apps.map((a) => (
        <div key={a.id} className="member-row">
          <span className={`invite-status ${a.status}`}>{a.status}</span>
          <span className="small muted">{new Date(a.created_at).toLocaleDateString()}</span>
          {a.note && <span className="small">“{a.note}”</span>}
        </div>
      ))}
      {!apps.length && <p className="small muted">No applications yet.</p>}
    </div>
  );
}
