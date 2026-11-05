// Storage console: the accounts explorer + Supabase sync.
// Every account, with its user id, username and email linked together, searchable,
// filterable, sortable, exportable, and kept in step with Supabase.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Icon } from './ui';
import {
  vdlQueryUsers, vdlGetUser, vdlSetStatus, vdlEraseUser, vdlExportUrl, vdlSyncStatus, vdlSyncFromSupabase,
  type VdlUser, type VdlUserDetail, type VdlUserFacets, type VdlUserQuery, type VdlSyncRun,
} from '../lib/vdl';

const PAGE_SIZES = [25, 50, 100, 250];

const when = (v?: string | null) => (v ? new Date(v).toLocaleString() : '—');
function ago(v?: string | null) {
  if (!v) return 'never';
  const s = (Date.now() - new Date(v).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(v).toLocaleDateString();
}
const statusOf = (u: VdlUser) => (u.banned_until && new Date(u.banned_until) > new Date() ? 'banned' : u.account_status);

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback(async (text: string, key = text) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200); } catch { /* clipboard blocked */ }
  }, []);
  return { copied, copy };
}

function CopyChip({ value, label, mono, copy, copied }: { value: string | null | undefined; label?: string; mono?: boolean; copy: (t: string, k?: string) => void; copied: string | null }) {
  if (!value) return <span className="muted">—</span>;
  return (
    <button type="button" className={`su-copy${mono ? ' mono' : ''}`} title={`Copy ${label || ''}`.trim()} onClick={(e) => { e.stopPropagation(); copy(value); }}>
      <span className="su-copy-text">{value}</span>
      <Icon name={copied === value ? 'check' : 'copy'} size={12} />
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  return <span className={`su-pill su-${status}`}>{status.replace('_', ' ')}</span>;
}

function Avatar({ u, size = 28 }: { u: Pick<VdlUser, 'avatar_url' | 'avatar_color' | 'display_name' | 'username'>; size?: number }) {
  const letter = (u.display_name || u.username || '?').slice(0, 1).toUpperCase();
  return u.avatar_url
    ? <img className="su-avatar" src={u.avatar_url} alt="" width={size} height={size} style={{ width: size, height: size }} referrerPolicy="no-referrer" />
    : <span className="su-avatar" style={{ width: size, height: size, background: u.avatar_color || '#5865f2', fontSize: size * 0.42 }}>{letter}</span>;
}

/* ------------------------------------------------------------------ sync -- */

export function SyncPanel({ onSynced, compact }: { onSynced?: () => void; compact?: boolean }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [runs, setRuns] = useState<VdlSyncRun[]>([]);
  const [live, setLive] = useState<VdlSyncRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showConflicts, setShowConflicts] = useState(false);

  const load = useCallback(async () => {
    try { const s = await vdlSyncStatus(); setConfigured(s.configured); setRuns(s.runs); } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (fresh = false) => {
    setBusy(true); setErr('');
    try {
      const done = await vdlSyncFromSupabase(setLive, fresh);
      setLive(done);
      if (done.status === 'failed') setErr(done.error || 'Sync failed.');
      onSynced?.();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); load(); }
  };

  const last = live || runs[0] || null;
  const pct = last?.total ? Math.min(100, Math.round((last.scanned / last.total) * 100)) : last?.status === 'done' ? 100 : null;

  return (
    <section className={`su-sync${compact ? ' compact' : ''}`}>
      <div className="su-sync-head">
        <div>
          <h3><Icon name="refresh" size={16} /> Supabase → VDL account sync</h3>
          <p className="muted small">
            Mirrors every account with the <b>same user id, email, username and password</b>. Runs automatically every night; bans and status changes made here are written back to Supabase.
          </p>
        </div>
        <div className="su-sync-actions">
          <button className="btn" disabled={busy || configured === false} onClick={() => run(false)}>
            {busy ? 'Syncing…' : last?.status === 'running' ? 'Resume sync' : 'Sync now'}
          </button>
          {!compact && <button className="btn ghost" disabled={busy || configured === false} onClick={() => run(true)} title="Start over from the first account">Full re-sync</button>}
        </div>
      </div>
      {configured === false && (
        <p className="su-warn small">
          Not connected. In Vercel → Settings → Environment Variables add <code>SUPABASE_URL</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code> (Supabase → Project Settings → API → service_role), and run <code>supabase/migrations/20261104010000_vdl_account_export.sql</code> in the Supabase SQL editor. Then redeploy.
        </p>
      )}
      {last && (
        <div className="su-sync-status">
          <div className="su-progress"><div style={{ width: `${pct ?? 0}%` }} className={last.status} /></div>
          <div className="su-sync-nums small">
            <span><StatusPill status={last.status === 'done' ? 'active' : last.status === 'failed' ? 'banned' : 'limited'} /> {last.status}</span>
            <span>{last.scanned.toLocaleString()}{last.total ? ` / ${last.total.toLocaleString()}` : ''} scanned</span>
            <span className="good">+{last.inserted.toLocaleString()} new</span>
            <span>{last.updated.toLocaleString()} updated</span>
            {last.conflicts?.length > 0 && <button className="linklike bad" onClick={() => setShowConflicts((v) => !v)}>{last.conflicts.length} conflict{last.conflicts.length === 1 ? '' : 's'}</button>}
            {last.upstream_deleted > 0 && <span className="bad">{last.upstream_deleted} deleted in Supabase</span>}
            <span className="muted">{last.trigger} · {ago(last.finished_at || last.started_at)}</span>
          </div>
          {showConflicts && last.conflicts?.length > 0 && (
            <table className="storage-table su-conflicts">
              <thead><tr><th>Supabase account</th><th>Problem</th><th>Clashes with VDL id</th></tr></thead>
              <tbody>
                {last.conflicts.map((c) => (
                  <tr key={c.id}><td><b>@{c.username}</b> <span className="muted">{c.email}</span><div className="mono tiny muted">{c.id}</div></td><td>{c.reason}</td><td className="mono tiny">{c.other_id}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          {last.error && <p className="error small">{last.error}</p>}
        </div>
      )}
      {err && <p className="error small">{err}</p>}
    </section>
  );
}

/* -------------------------------------------------------------- explorer -- */

export function UsersExplorer() {
  const [query, setQuery] = useState<VdlUserQuery>({ sort: 'newest', limit: 50, offset: 0 });
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<VdlUser[]>([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<VdlUserFacets | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const { copy, copied } = useCopy();
  const reqId = useRef(0);

  // debounce the search box
  useEffect(() => {
    const t = setTimeout(() => setQuery((q) => (q.q === search ? q : { ...q, q: search, offset: 0 })), 250);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setBusy(true); setErr('');
    try {
      const r = await vdlQueryUsers(query);
      if (id !== reqId.current) return; // a newer query already started
      setUsers(r.users); setTotal(r.total); setFacets(r.facets);
    } catch (e) { if (id === reqId.current) setErr((e as Error).message); }
    finally { if (id === reqId.current) setBusy(false); }
  }, [query]);
  useEffect(() => { load(); }, [load]);

  const set = (patch: Partial<VdlUserQuery>) => { setSelected(new Set()); setQuery((q) => ({ ...q, offset: 0, ...patch })); };
  const page = Math.floor((query.offset || 0) / (query.limit || 50)) + 1;
  const pages = Math.max(1, Math.ceil(total / (query.limit || 50)));
  const allOnPage = users.length > 0 && users.every((u) => selected.has(u.id));

  const bulk = async (status: 'active' | 'banned' | 'limited') => {
    const ids = [...selected];
    if (!ids.length) return;
    const reason = prompt(`Set ${ids.length} account${ids.length === 1 ? '' : 's'} to “${status}”. Reason (saved to the audit log):`, 'storage console');
    if (reason === null) return;
    try {
      const r = await vdlSetStatus(ids, status, reason);
      setNotice(`Updated ${r.updated} account${r.updated === 1 ? '' : 's'}.${r.warnings.length ? ` ${r.warnings[0]}` : ''}`);
      setSelected(new Set());
      load();
    } catch (e) { alert((e as Error).message); }
  };

  const copySelected = (field: 'id' | 'email' | 'username') => {
    const rows = users.filter((u) => selected.has(u.id)).map((u) => (field === 'username' ? `@${u.username}` : u[field]) || '').filter(Boolean);
    copy(rows.join('\n'), `sel-${field}`);
    setNotice(`Copied ${rows.length} ${field}${rows.length === 1 ? '' : 's'}.`);
  };

  const chips: { key: string; label: string; count?: number; patch: Partial<VdlUserQuery>; on: boolean }[] = useMemo(() => [
    { key: 'all', label: 'All', count: facets?.all, patch: { status: '', kind: '', source: '' }, on: !query.status && !query.kind && !query.source },
    { key: 'active30', label: 'Active 30d', count: facets?.active_30d, patch: { kind: 'active_30d', status: '' }, on: query.kind === 'active_30d' },
    { key: 'staff', label: 'Staff & badges', count: facets?.staff, patch: { kind: 'staff', status: '' }, on: query.kind === 'staff' },
    { key: 'unverified', label: 'Unverified email', count: facets?.unverified, patch: { kind: 'unverified', status: '' }, on: query.kind === 'unverified' },
    { key: 'anon', label: 'Disposable', count: facets?.anonymous, patch: { kind: 'anonymous', status: '' }, on: query.kind === 'anonymous' },
    { key: 'limited', label: 'Limited', count: facets?.limited, patch: { status: 'limited', kind: '' }, on: query.status === 'limited' },
    { key: 'banned', label: 'Banned', count: facets?.banned, patch: { status: 'banned', kind: '' }, on: query.status === 'banned' },
    { key: 'gone', label: 'Deleted upstream', count: facets?.upstream_deleted, patch: { kind: 'upstream_deleted', status: '' }, on: query.kind === 'upstream_deleted' },
  ], [facets, query.status, query.kind, query.source]);

  return (
    <div className="su">
      <SyncPanel onSynced={load} />

      <div className="su-chips">
        {chips.filter((c) => c.key === 'all' || (c.count ?? 0) > 0 || c.on).map((c) => (
          <button key={c.key} className={`su-chip${c.on ? ' on' : ''}`} onClick={() => set(c.patch)}>
            {c.label}{c.count !== undefined && <span>{c.count.toLocaleString()}</span>}
          </button>
        ))}
      </div>

      <div className="storage-toolbar su-toolbar">
        <div className="su-search">
          <Icon name="search" size={14} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by username, display name, email or user id…" autoFocus />
          {search && <button className="su-x" onClick={() => setSearch('')} aria-label="Clear"><Icon name="x" size={12} /></button>}
        </div>
        <select value={query.source || ''} onChange={(e) => set({ source: e.target.value as VdlUserQuery['source'] })}>
          <option value="">All sources</option>
          <option value="supabase">From Supabase ({facets?.supabase ?? 0})</option>
          <option value="vdl">VDL-only ({facets?.vdl ?? 0})</option>
        </select>
        <select value={query.sort} onChange={(e) => set({ sort: e.target.value as VdlUserQuery['sort'] })}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="recent_sign_in">Recently signed in</option>
          <option value="username">Username A–Z</option>
          <option value="email">Email A–Z</option>
        </select>
        <div className="su-spacer" />
        <a className="btn ghost small" href={vdlExportUrl('csv', query)} download><Icon name="download" size={14} /> CSV</a>
        <a className="btn ghost small" href={vdlExportUrl('json', query)} download><Icon name="download" size={14} /> JSON</a>
        <button className="btn ghost small" onClick={load} disabled={busy} title="Refresh"><Icon name="refresh" size={14} /></button>
      </div>

      {selected.size > 0 && (
        <div className="su-bulk">
          <b>{selected.size} selected</b>
          <button className="btn ghost small" onClick={() => copySelected('id')}>Copy IDs</button>
          <button className="btn ghost small" onClick={() => copySelected('email')}>Copy emails</button>
          <button className="btn ghost small" onClick={() => copySelected('username')}>Copy usernames</button>
          <span className="su-spacer" />
          <button className="btn ghost small" onClick={() => bulk('active')}>Set active</button>
          <button className="btn ghost small" onClick={() => bulk('limited')}>Limit</button>
          <button className="btn ghost small danger" onClick={() => bulk('banned')}>Ban</button>
          <button className="btn ghost small" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      {notice && <p className="small su-notice" onClick={() => setNotice('')}>{notice}</p>}
      {err && <p className="error small">{err}</p>}

      <div className={`su-table-wrap${busy ? ' busy' : ''}`}>
        <table className="storage-table su-table">
          <thead>
            <tr>
              <th className="su-check"><input type="checkbox" checked={allOnPage} onChange={() => setSelected(allOnPage ? new Set() : new Set(users.map((u) => u.id)))} aria-label="Select page" /></th>
              <th>User</th>
              <th>Email</th>
              <th>User ID</th>
              <th>Status</th>
              <th>Joined</th>
              <th>Last sign-in</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={openId === u.id ? 'open' : ''} onClick={() => setOpenId(u.id)}>
                <td className="su-check" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(u.id)} onChange={() => setSelected((s) => { const n = new Set(s); n.has(u.id) ? n.delete(u.id) : n.add(u.id); return n; })} aria-label={`Select ${u.username}`} />
                </td>
                <td>
                  <div className="su-user">
                    <Avatar u={u} />
                    <div>
                      <div className="su-name">{u.display_name || u.username}{(u.platform_role !== 'user' || u.badges?.length > 0) && <span className="su-role">{u.platform_role !== 'user' ? u.platform_role : u.badges[0]}</span>}</div>
                      <div className="muted tiny">@{u.username}{u.source === 'supabase' ? '' : ' · VDL-only'}{u.mfa_enabled ? ' · 2FA' : ''}</div>
                    </div>
                  </div>
                </td>
                <td>
                  {u.email ? <CopyChip value={u.email} label="email" copy={copy} copied={copied} /> : <span className="muted small">{u.is_anonymous || u.disposable ? 'disposable · no email' : '—'}</span>}
                  {u.email && !u.email_verified_at && !u.is_anonymous && <span className="su-flag">unverified</span>}
                </td>
                <td><CopyChip value={u.id} label="user id" mono copy={copy} copied={copied} /></td>
                <td><StatusPill status={u.upstream_deleted_at ? 'deleted' : statusOf(u)} /></td>
                <td className="small" title={when(u.created_at)}>{ago(u.created_at)}</td>
                <td className="small" title={when(u.last_sign_in_at)}>{ago(u.last_sign_in_at)}</td>
              </tr>
            ))}
            {!busy && users.length === 0 && (
              <tr><td colSpan={7} className="su-empty">{facets?.all === 0 ? 'No accounts in VDL yet — click “Sync now” above to pull them from Supabase.' : 'No accounts match these filters.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="su-pager">
        <span className="muted small">{total ? `${(query.offset || 0) + 1}–${Math.min(total, (query.offset || 0) + users.length)} of ${total.toLocaleString()}` : '0 accounts'}</span>
        <span className="su-spacer" />
        <select value={query.limit} onChange={(e) => set({ limit: Number(e.target.value) })}>
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} / page</option>)}
        </select>
        <button className="btn ghost small" disabled={page <= 1} onClick={() => setQuery((q) => ({ ...q, offset: Math.max(0, (q.offset || 0) - (q.limit || 50)) }))}>‹ Prev</button>
        <span className="small">Page {page} / {pages}</span>
        <button className="btn ghost small" disabled={page >= pages} onClick={() => setQuery((q) => ({ ...q, offset: (q.offset || 0) + (q.limit || 50) }))}>Next ›</button>
      </div>

      {openId && <UserDrawer id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

/* ---------------------------------------------------------------- drawer -- */

function UserDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof vdlGetUser>> | null>(null);
  const [err, setErr] = useState('');
  const [raw, setRaw] = useState(false);
  const { copy, copied } = useCopy();

  const load = useCallback(async () => {
    setErr('');
    try { setData(await vdlGetUser(id)); } catch (e) { setErr((e as Error).message); }
  }, [id]);
  useEffect(() => { setData(null); load(); }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const u: VdlUserDetail | undefined = data?.user;
  const setStatus = async (status: 'active' | 'limited' | 'very_limited' | 'banned') => {
    if (!u) return;
    const reason = prompt(`Set @${u.username} to “${status.replace('_', ' ')}”. Reason:`, 'storage console');
    if (reason === null) return;
    try {
      const r = await vdlSetStatus(u.id, status, reason);
      if (r.warnings.length) alert(r.warnings[0]);
      await load(); onChanged();
    } catch (e) { alert((e as Error).message); }
  };
  const erase = async () => {
    if (!u) return;
    if (prompt(`Type ${u.username} to permanently erase this VDL account.`) !== u.username) return;
    try { await vdlEraseUser(u.id); onChanged(); onClose(); } catch (e) { alert((e as Error).message); }
  };

  const linked = u ? `id: ${u.id}\nusername: @${u.username}\nemail: ${u.email ?? '(none)'}` : '';

  return (
    <div className="su-drawer-bg" onClick={onClose}>
      <aside className="su-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Account details">
        <button className="su-drawer-close" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        {err && <p className="error small">{err}</p>}
        {!u && !err && <div className="spinner" />}
        {u && (
          <>
            <header className="su-drawer-head">
              <Avatar u={u} size={56} />
              <div>
                <h3>{u.display_name || u.username}</h3>
                <div className="muted small">@{u.username}{u.pronouns ? ` · ${u.pronouns}` : ''}</div>
                <div className="su-drawer-tags">
                  <StatusPill status={u.upstream_deleted_at ? 'deleted' : statusOf(u)} />
                  {u.platform_role !== 'user' && <span className="su-role">{u.platform_role}</span>}
                  {u.badges?.map((b) => <span key={b} className="su-badge">{b}</span>)}
                </div>
              </div>
            </header>

            <div className="su-linked">
              <div className="su-linked-title"><Icon name="link" size={13} /> Linked identity <button className="linklike small" onClick={() => copy(linked, 'linked')}>{copied === 'linked' ? 'Copied' : 'Copy all'}</button></div>
              <dl>
                <dt>User ID</dt><dd><CopyChip value={u.id} mono copy={copy} copied={copied} /></dd>
                <dt>Username</dt><dd><CopyChip value={`@${u.username}`} copy={copy} copied={copied} /></dd>
                <dt>Email</dt><dd><CopyChip value={u.email} copy={copy} copied={copied} /> {u.email && (u.email_verified_at ? <span className="su-ok">verified {ago(u.email_verified_at)}</span> : <span className="su-flag">unverified</span>)}</dd>
                {u.phone && (<><dt>Phone</dt><dd><CopyChip value={u.phone} copy={copy} copied={copied} /></dd></>)}
              </dl>
            </div>

            <div className="su-grid">
              <div><span>Joined</span><b>{when(u.created_at)}</b></div>
              <div><span>Last sign-in</span><b>{when(u.last_sign_in_at)}</b></div>
              <div><span>Source</span><b>{u.source === 'supabase' ? `Supabase · synced ${ago(u.supabase_synced_at)}` : 'VDL-only'}</b></div>
              <div><span>Sign-in</span><b>{u.has_password ? (u.password_scheme === 'raw' ? 'password (legacy)' : 'password') : 'none'}{u.mfa_enabled ? ' + 2FA' : ''}{u.providers?.length ? ` · ${u.providers.join(', ')}` : ''}</b></div>
              <div><span>Servers</span><b>{data!.counts.servers}</b></div>
              <div><span>Messages / files</span><b>{data!.counts.messages} / {data!.counts.files}</b></div>
              {u.language && <div><span>Language</span><b>{u.language}</b></div>}
              {(u.disposable || u.is_anonymous) && <div><span>Disposable</span><b>expires {when(u.expires_at)}</b></div>}
              {u.banned_until && <div><span>Auth ban until</span><b>{when(u.banned_until)}</b></div>}
              {u.upstream_deleted_at && <div><span>Deleted in Supabase</span><b>{when(u.upstream_deleted_at)}</b></div>}
            </div>
            {u.about && <p className="su-about small">{u.about}</p>}

            <div className="su-drawer-actions">
              {statusOf(u) !== 'active' && <button className="btn small" onClick={() => setStatus('active')}>Restore to active</button>}
              {statusOf(u) !== 'limited' && <button className="btn ghost small" onClick={() => setStatus('limited')}>Limit</button>}
              {statusOf(u) !== 'very_limited' && <button className="btn ghost small" onClick={() => setStatus('very_limited')}>Very limited</button>}
              {statusOf(u) !== 'banned' && <button className="btn ghost small danger" onClick={() => setStatus('banned')}>Ban</button>}
              <button className="btn ghost small danger" onClick={erase} disabled={u.source === 'supabase' && !u.upstream_deleted_at} title={u.source === 'supabase' && !u.upstream_deleted_at ? 'Still exists in Supabase — ban instead' : ''}>Erase</button>
            </div>

            <h4>Activity</h4>
            {data!.history.length === 0 ? <p className="muted small">No audit entries yet.</p> : (
              <ul className="su-history">
                {data!.history.map((h) => (
                  <li key={h.id}><span className="mono tiny muted">{when(h.created_at)}</span> <b>{h.action}</b>{h.actor ? <> by @{h.actor}</> : null}{h.reason ? <span className="muted"> — {h.reason}</span> : null}{h.detail ? <span className="muted"> · {h.detail}</span> : null}</li>
                ))}
              </ul>
            )}

            <h4><button className="linklike" onClick={() => setRaw((v) => !v)}>{raw ? '▾' : '▸'} Raw profile JSON</button></h4>
            {raw && <pre className="storage-pre">{JSON.stringify(u.profile, null, 2)}</pre>}
          </>
        )}
      </aside>
    </div>
  );
}
