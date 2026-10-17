// Venband Storage Console — a Supabase-style control plane, gated to owners/founders.
// Anyone without the owner/founder badge sees a fake browser error page so the
// existence of this console is never revealed.
import { useEffect, useState } from 'react';
import { supabase, errorMessage } from '../lib/supabase';
import { sessionStore, isTopStaff } from '../lib/session';
import { go } from '../lib/router';
import { Icon, Field } from './ui';

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
  { id: 'storage', label: 'Storage', icon: 'folder' },
  { id: 'sql', label: 'SQL Editor', icon: 'code' },
  { id: 'logs', label: 'Logs', icon: 'history' },
  { id: 'blockchain', label: 'Blockchain', icon: 'shield' },
  { id: 'email', label: 'Email', icon: 'send' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export function StorageConsole() {
  const me = sessionStore.use((s) => s.me);
  const [tab, setTab] = useState('overview');
  if (!me || !isTopStaff(me)) return <FakeBrowserError />;
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
          {tab === 'storage' && <StorageTab />}
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
        const { data, error } = await supabase.rpc('storage_console_stats');
        if (error) throw error;
        setStats(data);
      } catch (e) {
        setErr(errorMessage(e));
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
        This console is restricted to owners and founders. All actions are audited.
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
      const { data, error } = await supabase.rpc('mod_search', { p_query: q });
      if (error) throw error;
      setUsers(data?.users ?? []);
      setServers(data?.servers ?? []);
    } catch (e) {
      setMsg(errorMessage(e));
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
        <thead><tr><th>Username</th><th>Display name</th><th>Role</th><th>Status</th><th>Created</th><th></th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.username}</td>
              <td>{u.display_name}</td>
              <td>{u.platform_role}</td>
              <td>{u.account_status}</td>
              <td>{new Date(u.created_at).toLocaleString()}</td>
              <td className="storage-row-actions">
                <button className="btn ghost small" onClick={async () => {
                  if (!confirm('Ban this account?')) return;
                  try {
                    await supabase.rpc('mod_set_account_status', { p_user: u.id, p_status: 'banned', p_reason: 'storage console' });
                    load();
                  } catch (e) { alert(errorMessage(e)); }
                }}>Ban</button>
                <button className="btn ghost small danger" onClick={async () => {
                  if (!confirm('Permanently erase this account?')) return;
                  try {
                    await supabase.rpc('delete_account', { p_user: u.id });
                    load();
                  } catch (e) { alert(errorMessage(e)); }
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
              <td>{s.owner_username}</td>
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
        const { data, error } = await supabase.rpc('storage_list_auth_users');
        if (error) throw error;
        setUsers(data ?? []);
      } catch (e) { setErr(errorMessage(e)); }
    })();
  }, []);
  return (
    <div>
      <p className="muted small">Authentication users (owner-only view).</p>
      {err && <p className="error small">{err}</p>}
      <table className="storage-table">
        <thead><tr><th>Email</th><th>Username</th><th>User ID</th><th>Created</th><th>Last sign in</th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td>{u.username}</td>
              <td className="mono small">{u.id}</td>
              <td>{u.created_at ? new Date(u.created_at).toLocaleString() : '—'}</td>
              <td>{u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StorageTab() {
  const [files, setFiles] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [prefix, setPrefix] = useState('');
  const load = async () => {
    setBusy(true); setErr('');
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch(`/api/storage-blob?prefix=${encodeURIComponent(prefix)}`, { headers: { authorization: `Bearer ${token}` } });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'load failed');
      setFiles(j.blobs ?? []);
    } catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []);
  const upload = async (file: File) => {
    setErr('');
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const buf = await file.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    const res = await fetch('/api/storage-blob', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'upload', pathname: file.name, data: b64, contentType: file.type }),
    });
    const j = await res.json();
    if (!res.ok) { setErr(j.error || 'upload failed'); return; }
    load();
  };
  const remove = async (url: string, name: string) => {
    if (!confirm('Delete this file?')) return;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const res = await fetch('/api/storage-blob', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'delete', url }),
    });
    const j = await res.json();
    if (!res.ok) { setErr(j.error || 'delete failed'); return; }
    setFiles((prev) => prev.filter((f) => f.url !== url && f.pathname !== name));
  };
  return (
    <div>
      <div className="storage-toolbar">
        <input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="prefix (optional)" />
        <button className="btn ghost small" onClick={load} disabled={busy}>Refresh</button>
        <label className="btn ghost small" style={{ cursor: 'pointer' }}>
          Upload
          <input type="file" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
        </label>
      </div>
      {err && <p className="error small">{err}</p>}
      <p className="muted small">Free, on-site storage via Vercel Blob (requires BLOB_READ_WRITE_TOKEN). No Supabase needed for files.</p>
      <table className="storage-table">
        <thead><tr><th>Name</th><th>Size</th><th>URL</th><th></th></tr></thead>
        <tbody>
          {files.map((f) => (
            <tr key={f.url}>
              <td>{f.pathname}</td>
              <td>{f.size ?? '—'}</td>
              <td className="small"><a href={f.url} target="_blank" rel="noreferrer">open</a></td>
              <td><button className="btn ghost small danger" onClick={() => remove(f.url, f.pathname)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {files.length === 0 && !busy && <p className="muted small">No files yet.</p>}
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
        For ad-hoc queries, run them in the Supabase SQL editor with the service role.
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
        const { data, error } = await supabase.rpc('mod_log', { p_limit: 100 });
        if (error) throw error;
        setRows(data ?? []);
      } catch (e) { setErr(errorMessage(e)); }
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
      const { data, error } = await supabase.rpc('storage_ledger_list');
      if (error) throw error;
      setRows(data ?? []);
    } catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const rebuild = async () => {
    if (!confirm('Rebuild the ledger from current user stats?')) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('storage_ledger_rebuild');
      if (error) throw error;
      await load();
    } catch (e) { setErr(errorMessage(e)); }
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
      const { error } = await supabase.rpc('storage_queue_email', { p_to: to, p_subject: subject, p_body: body });
      if (error) throw error;
      setMsg('Queued.');
      setTo(''); setSubject(''); setBody('');
    } catch (e) { setMsg(errorMessage(e)); }
  };
  const sendQueued = async () => {
    setMsg('');
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Not signed in');
      const res = await fetch('/api/storage-email', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'send failed');
      setMsg(`Sent ${j.sent}/${j.total}.`);
    } catch (e) { setMsg(errorMessage(e)); }
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

function SettingsTab() {
  return (
    <div>
      <p className="muted small">Project settings, API keys and webhooks are managed in Supabase. This console never exposes service-role keys.</p>
    </div>
  );
}