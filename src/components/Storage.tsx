// Venband Storage Console — a Supabase-style control plane, gated to owners/founders.
// Anyone without the owner/founder badge sees a fake browser error page so the
// existence of this console is never revealed.
import { useEffect, useState } from 'react';

import { isTopStaff } from '../lib/session';
import { go } from '../lib/router';
import { Icon, Field } from './ui';
import { vdlListUsers, vdlListServers, vdlBanUser, vdlEraseUser, vdlListAudit, vdlListLedger, vdlRebuildLedger, vdlQueueEmail, vdlSendQueuedEmails, vdlStats } from '../lib/vdl';
import { vbbList, vbbUpload, vbbDelete, vbbPublish, vbbDownloadUrl, vbbListShards } from '../lib/vbb';

function decodePayload(p: string): string {
  try {
    const bin = atob(p);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return p;
  }
}

/** Fake browser error shown to everyone who is not an owner/founder. */
export function FakeBrowserError() {
  return (
    <div className="storage-fake-error">
      <div className="storage-fe-card">
        <div className="storage-fe-icon">!</div>
        <h1>This site can&rsquo;t be reached</h1>
        <p className="storage-fe-url">venband.com/storage</p>
        <p className="muted small">
          <strong>ERR_CONNECTION_REFUSED</strong> &mdash; The server refused the connection.
        </p>
        <ul className="storage-fe-tips">
          <li>Check the connection</li>
          <li>Check the proxy and the firewall</li>
          <li>Run Windows Network Diagnostics</li>
        </ul>
        <button className="btn ghost" onClick={() => (window.location.href = '/')}>Reload</button>
      </div>
    </div>
  );
}

interface Tab { id: string; label: string; icon: string }

const TABS: Tab[] = [
  { id: 'overview', label: 'Overview', icon: 'home' },
  { id: 'table', label: 'Table Editor', icon: 'file' },
  { id: 'auth', label: 'Authentication', icon: 'users' },
  { id: 'vbb', label: 'Storage', icon: 'folder' },
  { id: 'sql', label: 'SQL Editor', icon: 'code' },
  { id: 'logs', label: 'Logs', icon: 'history' },
  { id: 'blockchain', label: 'Blockchain', icon: 'shield' },
  { id: 'email', label: 'Email', icon: 'send' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export function StorageConsole() {
  const [me, setMe] = useState<any>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authErr, setAuthErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('overview');

  const checkAuth = async () => {
    try {
      const r = await fetch('/api/vdl?r=auth', { credentials: 'include' });
      if (r.ok) { const j = await r.json(); setMe(j.user); }
      else setMe(null);
    } catch { setMe(null); }
    setAuthChecked(true);
  };
  useEffect(() => { checkAuth(); }, []);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setAuthErr('');
    try {
      const r = await fetch('/api/vdl?r=auth&action=signin', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: JSON.stringify({ email, password }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'sign in failed');
      setMe(j.user);
    } catch (e) { setAuthErr(String((e as Error).message)); }
    finally { setBusy(false); }
  };

  if (!authChecked) return <div className="storage-console"><div className="storage-content"><div className="spinner" /></div></div>;
  if (!me) return (
    <div className="storage-console">
      <div className="storage-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <form onSubmit={signIn} className="storage-auth-form">
          <h2>Venband Storage</h2>
          <p className="muted small">Sign in with a VDL account (owner/founder).</p>
          <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Field label="Password"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          {authErr && <p className="error small">{authErr}</p>}
          <button className="btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </div>
    </div>
  );
  if (!isTopStaff(me)) return <FakeBrowserError />;
  return (
    <div className="storage-console">
      <aside className="storage-sidebar">
        <div className="storage-brand">
          <Icon name="shield" size={20} />
          <span>Venband Storage</span>
        </div>
        <nav>
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? 'active' : ''}
              onClick={() => setTab(t.id)}
            >
              <Icon name={t.icon} size={16} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
        <div className="storage-sidebar-foot">
          <button className="btn ghost small" onClick={() => go('')}>Exit console</button>
        </div>
      </aside>
      <main className="storage-main">
        <header className="storage-header">
          <h2>{TABS.find((t) => t.id === tab)?.label}</h2>
          <div className="storage-header-user">
            <span className="storage-avatar" style={{ width: 28, height: 28, background: me.avatar_color, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#fff' }}>{(me.display_name || me.username).slice(0, 1).toUpperCase()}</span>
            <span>{me.username}</span>
          </div>
        </header>
        <div className="storage-content">
          {tab === 'overview' && <OverviewTab />}
          {tab === 'table' && <TableTab />}
          {tab === 'auth' && <AuthTab />}
          {tab === 'vbb' && <VbbTab />}
          {tab === 'sql' && <SqlTab />}
          {tab === 'logs' && <LogsTab />}
          {tab === 'blockchain' && <BlockchainTab />}
          {tab === 'email' && <EmailTab />}
          {tab === 'settings' && <SettingsTab />}
        </div>
      </main>
    </div>
  );
}

function OverviewTab() {
  const [stats, setStats] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    (async () => {
      try {
        setStats(await vdlStats());
      } catch (e) {
        setErr(String((e as Error).message));
      }
    })();
  }, []);
  return (
    <div className="storage-overview">
      <div className="storage-card-grid">
        <StatCard label="Users" value={stats?.users ?? '—'} />
        <StatCard label="Servers" value={stats?.servers ?? '—'} />
        <StatCard label="Storage objects" value={stats?.objects ?? '—'} />
        <StatCard label="Ledger blocks" value={stats?.blocks ?? '—'} />
      </div>
      {err && <p className="error small">{err}</p>}
      <p className="muted small">
        This console is restricted to owners and founders. All actions are audited. 100% local (Vercel Postgres + KV).
      </p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: any }) {
  return (
    <div className="storage-stat-card">
      <div className="storage-stat-value">{value}</div>
      <div className="storage-stat-label">{label}</div>
    </div>
  );
}

function TableTab() {
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [servers, setServers] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = async () => {
    setBusy(true);
    try {
      const [u, s] = await Promise.all([vdlListUsers(q), vdlListServers()]);
      setUsers(u);
      setServers(s);
    } catch (e) {
      setMsg(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { load(); }, []);
  return (
    <div>
      <div className="storage-toolbar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users or servers…" />
        <button className="btn" onClick={load} disabled={busy}>Search</button>
      </div>
      {msg && <p className="error small">{msg}</p>}
      <h3>Users</h3>
      <table className="storage-table">
        <thead><tr><th>Username</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th></th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.username}</td>
              <td>{u.email}</td>
              <td>{u.platform_role}</td>
              <td>{u.account_status}</td>
              <td>{new Date(u.created_at).toLocaleString()}</td>
              <td className="storage-row-actions">
                <button className="btn ghost small" onClick={async () => {
                  if (!confirm('Ban this account?')) return;
                  try { await vdlBanUser(u.id, 'storage console'); load(); } catch (e) { alert(String((e as Error).message)); }
                }}>Ban</button>
                <button className="btn ghost small danger" onClick={async () => {
                  if (!confirm('Permanently erase this account?')) return;
                  try { await vdlEraseUser(u.id); load(); } catch (e) { alert(String((e as Error).message)); }
                }}>Erase</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Servers</h3>
      <table className="storage-table">
        <thead><tr><th>Name</th><th>Owner</th><th>Status</th><th>Members</th><th>Created</th></tr></thead>
        <tbody>
          {servers.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{s.owner_username ?? s.owner_id}</td>
              <td>{s.status}</td>
              <td>{s.members}</td>
              <td>{new Date(s.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuthTab() {
  const [users, setUsers] = useState<any[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => {
    (async () => {
      try {
        setUsers(await vdlListUsers());
      } catch (e) { setErr(String((e as Error).message)); }
    })();
  }, []);
  return (
    <div>
      <p className="muted small">Authentication users (VDL — fully local).</p>
      {err && <p className="error small">{err}</p>}
      <table className="storage-table">
        <thead><tr><th>Email</th><th>Username</th><th>User ID</th><th>Created</th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td>{u.username}</td>
              <td className="mono small">{u.id}</td>
              <td>{u.created_at ? new Date(u.created_at).toLocaleString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function SqlTab() {
  return (
    <div>
      <p className="muted small">
        Arbitrary SQL execution from the browser is disabled for security, even for owners.
        Use the Table Editor, Authentication, Storage and Blockchain tabs instead.
      </p>
      <p className="muted small">
        For ad-hoc queries, use the Vercel Postgres query runner (no service role exposed to the browser).
      </p>
    </div>
  );
}

function LogsTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => {
    (async () => {
      try {
        setRows(await vdlListAudit());
      } catch (e) { setErr(String((e as Error).message)); }
    })();
  }, []);
  return (
    <div>
      {err && <p className="error small">{err}</p>}
      <table className="storage-table">
        <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Detail</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{new Date(r.created_at).toLocaleString()}</td>
              <td>{r.actor}</td>
              <td>{r.action}</td>
              <td className="small">{r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlockchainTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try {
      setRows(await vdlListLedger());
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setBusy(false); }
  };
  const rebuild = async () => {
    if (!confirm('Rebuild the ledger from current user stats?')) return;
    setBusy(true);
    try {
      await vdlRebuildLedger();
      await load();
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []);
  return (
    <div>
      <div className="storage-toolbar">
        <button className="btn" onClick={load} disabled={busy}>Refresh</button>
        <button className="btn ghost" onClick={rebuild} disabled={busy}>Rebuild ledger</button>
      </div>
      {err && <p className="error small">{err}</p>}
      <p className="muted small">Append-only hash chain of user stats. Only owners/founders can decode.</p>
      <table className="storage-table">
        <thead><tr><th>#</th><th>Hash</th><th>Prev</th><th>Payload (decoded)</th><th>When</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i}>
              <td>{r.seq}</td>
              <td className="mono small">{String(r.hash).slice(0, 12)}…</td>
              <td className="mono small">{String(r.prev_hash).slice(0, 12)}…</td>
              <td className="small">{decodePayload(r.payload)}</td>
              <td>{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmailTab() {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState('');
  const send = async () => {
    setMsg('');
    try {
      await vdlQueueEmail(to, subject, body);
      setMsg('Queued.');
      setTo(''); setSubject(''); setBody('');
    } catch (e) { setMsg(String((e as Error).message)); }
  };
  const sendQueued = async () => {
    setMsg('');
    try {
      const r = await vdlSendQueuedEmails();
      setMsg(`Sent ${r.sent}/${r.total}.`);
    } catch (e) { setMsg(String((e as Error).message)); }
  };
  return (
    <div className="storage-email">
      <Field label="To"><input value={to} onChange={(e) => setTo(e.target.value)} placeholder="user@example.com" /></Field>
      <Field label="Subject"><input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
      <Field label="Body"><textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} /></Field>
      <div className="storage-toolbar">
        <button className="btn" onClick={send}>Queue email</button>
        <button className="btn ghost" onClick={sendQueued}>Send queued</button>
      </div>
      {msg && <p className="small">{msg}</p>}
      <p className="muted small">Sending uses Resend on the server (RESEND_API_KEY + STORAGE_EMAIL_FROM). From-address should be a subdomain of venband.com.</p>
    </div>
  );
}

function VbbTab() {
  const [files, setFiles] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true); setErr('');
    try { setFiles(await vbbList()); } catch (e) { setErr(String((e as Error).message)); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []);
  const [progress, setProgress] = useState(0);
  const upload = async (file: File) => {
    setErr(''); setProgress(0);
    try {
      await vbbUpload(file, false, (loaded, total) => setProgress(Math.round((loaded / total) * 100)));
      setProgress(100);
      load();
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setTimeout(() => setProgress(0), 1000); }
  };
  const remove = async (id: string) => {
    if (!confirm('Delete this object?')) return;
    try { await vbbDelete(id); setFiles((p) => p.filter((f) => f.id !== id)); } catch (e) { setErr(String((e as Error).message)); }
  };
  const togglePublic = async (id: string, pub: boolean) => {
    try { await vbbPublish(id, !pub); load(); } catch (e) { setErr(String((e as Error).message)); }
  };
  return (
    <div>
      <div className="storage-toolbar">
        <button className="btn ghost small" onClick={load} disabled={busy}>Refresh</button>
        <label className="btn ghost small" style={{ cursor: 'pointer' }}>
          Upload (up to 5 GB)
          <input type="file" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
        </label>
        {progress > 0 && progress < 100 && <span className="small">Uploading… {progress}%</span>}
      </div>
      {err && <p className="error small">{err}</p>}
      <p className="muted small">Venband Blob (VBB): custom object storage. Small files live in Postgres (content-addressed, deduped by SHA-256); large files are chunked. Served from your own domain.</p>
      <table className="storage-table">
        <thead><tr><th>Name</th><th>Size</th><th>Storage</th><th>SHA-256</th><th>Public</th><th></th></tr></thead>
        <tbody>
          {files.map((f) => (
            <tr key={f.id}>
              <td>{f.name}</td>
              <td>{f.size}</td>
              <td>{f.storage}</td>
              <td className="mono small">{String(f.sha256).slice(0, 12)}…</td>
              <td><button className="btn ghost small" onClick={() => togglePublic(f.id, f.public)}>{f.public ? 'yes' : 'no'}</button></td>
              <td className="storage-row-actions">
                <a className="btn ghost small" href={vbbDownloadUrl(f.id)} target="_blank" rel="noreferrer">Open</a>
                <button className="btn ghost small danger" onClick={() => remove(f.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {files.length === 0 && !busy && <p className="muted small">No objects yet.</p>}

      <h3>Registered shards</h3>
      <ShardsBlock />
    </div>
  );
}

function ShardsBlock() {
  const [shards, setShards] = useState<any[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => {
    vbbListShards().then(setShards).catch((e) => setErr(String((e as Error).message)));
  }, []);
  if (err) return <p className="error small">{err}</p>;
  if (shards.length === 0) return <p className="muted small">No shards registered yet. Use storage.venband.com, cdn.venband.com, shard-1.venband.com, …</p>;
  return (
    <table className="storage-table">
      <thead><tr><th>Subdomain</th><th>Base URL</th><th>Used</th><th>Capacity</th><th>Active</th></tr></thead>
      <tbody>
        {shards.map((s) => (
          <tr key={s.id}>
            <td>{s.subdomain}</td>
            <td className="small">{s.base_url}</td>
            <td>{s.used_bytes}</td>
            <td>{s.capacity_bytes}</td>
            <td>{s.active ? 'yes' : 'no'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SettingsTab() {
  return (
    <div>
      <p className="muted small">All data is stored locally in your Vercel Postgres + KV. No external services required. Service keys never reach the browser.</p>
    </div>
  );
}
