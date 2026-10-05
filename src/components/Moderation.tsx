// Venband staff tools: find any account or server and act on it. Every action
// is enforced by the database (staff rank checks) and written to an audit log.
import { EvidenceList, ReportFilters, reportMatches, type ReportFilter } from './ReportViews';
import { jumpTo } from './Search';
import { useCallback, useEffect, useState } from 'react';
import { supabase, errorMessage } from '../lib/supabase';
import { sessionStore } from '../lib/session';
import { displayName, getProfile, loadProfiles, putProfile } from '../lib/directory';
import { uiStore } from '../lib/ui';
import type { AccountStatus, PlatformRole, Profile, ServerStatus } from '../lib/types';
import { Avatar, Field, Icon, Modal } from './ui';
import { ImageCropper } from './ImageCropper';
import { Select } from './Select';
import { BadgeIcon, Badges, loadCustomBadges, useAllBadges, VerifiedMark } from './Badges';
import { askConfirm, askText } from './Dialogs';
import { startDm } from './Modals';
import { openProfile } from './People';
import { openGlobalModal } from './GlobalModals';

interface ModUser {
  id: string;
  username: string;
  display_name: string;
  avatar_color: string;
  badges: string[];
  platform_role: PlatformRole;
  account_status: AccountStatus;
  created_at: string;
}
interface ModServer {
  id: string;
  name: string;
  icon_color: string;
  status: ServerStatus;
  verified: boolean;
  created_at: string;
  description: string;
  members: number;
  owner_username: string;
  owner_id: string;
}
interface LogRow {
  id: string;
  actor: string | null;
  target_user: string | null;
  target_server: string | null;
  action: string;
  detail: string;
  reason: string;
  created_at: string;
}

const RANK: Record<PlatformRole, number> = { user: 0, moderator: 1, admin: 2, owner: 3 };

const STATUS_LABEL: Record<AccountStatus, string> = {
  active: 'Active',
  limited: 'Limited',
  very_limited: 'Very limited',
  banned: 'Banned',
};
const SERVER_LABEL: Record<ServerStatus, string> = {
  active: 'Active',
  review: 'In review (frozen)',
  closed: 'Closed',
  banned: 'Banned',
  deleted: 'Deleted by owner (restorable for 7 days)',
};

export function ModerationCenter() {
  const me = sessionStore.use((s) => s.me)!;
  const initial = uiStore.use((s) => s.modQuery);
  const [q, setQ] = useState(initial);
  const [view, setView] = useState<'users' | 'servers' | 'log'>('users');
  const [users, setUsers] = useState<ModUser[]>([]);
  const [servers, setServers] = useState<ModServer[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [badgesFor, setBadgesFor] = useState<ModUser | null>(null);
  const myRank = RANK[me.platform_role ?? 'user'];

  async function search(query = q) {
    setBusy(true);
    const { data, error } = await supabase.rpc('mod_search', { p_query: query.trim() });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: errorMessage(error) });
    setUsers((data?.users ?? []) as ModUser[]);
    setServers((data?.servers ?? []) as ModServer[]);
  }
  async function loadLog() {
    const { data, error } = await supabase.rpc('mod_log', { p_limit: 100 });
    if (error) return setMsg({ ok: false, text: errorMessage(error) });
    setLog((data ?? []) as LogRow[]);
  }

  useEffect(() => {
    const t = setTimeout(() => search(q), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  useEffect(() => {
    if (view === 'log') loadLog();
  }, [view]);

  async function run(label: string, fn: () => PromiseLike<{ error: unknown }>) {
    const { error } = await fn();
    if (error) setMsg({ ok: false, text: errorMessage(error) });
    else {
      setMsg({ ok: true, text: label });
      search();
    }
  }

  async function setStatus(u: ModUser, status: AccountStatus) {
    const verbs: Record<AccountStatus, string> = {
      active: 'Restore',
      limited: 'Make Limited',
      very_limited: 'Make Very Limited',
      banned: 'Ban Account',
    };
    const reason = await askText({
      title: `${verbs[status]}: @${u.username}`,
      label: 'Reason (kept in the staff audit log)',
      hint:
        status === 'banned'
          ? 'Signs them out everywhere and blocks sign-in.'
          : status === 'very_limited'
            ? 'Read-only: no messages, calls, joins, DMs or friend requests.'
            : status === 'limited'
              ? 'No new servers, no DMs with non-friends, no friend requests.'
              : 'Lifts every restriction.',
      maxLength: 1000,
    });
    if (reason === null) return;
    run(`@${u.username} is now ${STATUS_LABEL[status].toLowerCase()}.`, () =>
      supabase.rpc('mod_set_account_status', { p_user: u.id, p_status: status, p_reason: reason }),
    );
  }

  async function serverAction(s: ModServer, action: string, label: string, danger = false) {
    const reason = await askText({ title: `${label}: ${s.name}`, label: 'Reason (kept in the staff audit log)', maxLength: 1000 });
    if (reason === null) return;
    if (danger && !(await askConfirm({ title: label, body: `Are you sure? This affects all ${s.members} members of ${s.name}.`, confirm: label, danger: true }))) return;
    run(`${label}: done.`, () => supabase.rpc('mod_server_action', { p_server: s.id, p_action: action, p_reason: reason }));
  }

  return (
    <div className="mod-center">
      <div className="mod-head">
        <h2>
          <Icon name="gavel" /> Moderation Center
        </h2>
        <span className="tag-soft">{me.platform_role}</span>
      </div>
      <div className="mod-search">
        <Icon name="search" size={18} />
        <input autoFocus placeholder="Search users and servers by name, username or ID" value={q} onChange={(e) => setQ(e.target.value)} />
        {busy && <div className="spinner small" />}
      </div>
      <div className="tabs">
        <button className={view === 'users' ? 'active' : ''} onClick={() => setView('users')}>
          Users · {users.length}
        </button>
        <button className={view === 'servers' ? 'active' : ''} onClick={() => setView('servers')}>
          Servers · {servers.length}
        </button>
        <button className={view === 'log' ? 'active' : ''} onClick={() => setView('log')}>
          Audit Log
        </button>
      </div>
      {msg && <div className={msg.ok ? 'notice' : 'form-error'}>{msg.text}</div>}

      {view === 'users' && (
        <div className="mod-list">
          {users.map((u) => {
            const canAct = myRank > RANK[u.platform_role] || (u.id === me.id && myRank === 3);
            return (
              <div key={u.id} className={`mod-card status-${u.account_status}`}>
                <div className="mod-card-head">
                  <Avatar profile={u} size={44} />
                  <div className="grow">
                    <div className="mod-name">
                      {u.display_name} <Badges ids={u.badges} size={15} />
                    </div>
                    <div className="small muted">
                      @{u.username} · joined {new Date(u.created_at).toLocaleDateString()} · <code className="id">{u.id}</code>
                    </div>
                  </div>
                  <div className="mod-pills">
                    {u.platform_role !== 'user' && <span className="pill staff">{u.platform_role}</span>}
                    <span className={`pill ${u.account_status}`}>{STATUS_LABEL[u.account_status]}</span>
                  </div>
                </div>
                <div className="mod-actions">
                  <button className="btn secondary small" onClick={() => (putProfile(u as unknown as Profile), openProfile(u.id))}>
                    <Icon name="user" size={14} /> Profile
                  </button>
                  {u.id !== me.id && (
                    <button className="btn secondary small" onClick={() => startDm(u.id).then(() => uiStore.set({ settings: null })).catch((e) => setMsg({ ok: false, text: errorMessage(e) }))}>
                      <Icon name="message" size={14} /> DM
                    </button>
                  )}
                  {canAct && (
                    <button className="btn secondary small" onClick={() => setBadgesFor(u)}>
                      <Icon name="star" size={14} /> Apply Badges
                    </button>
                  )}
                  {canAct && u.id !== me.id && (
                    <>
                      {u.account_status !== 'active' && (
                        <button className="btn success small" onClick={() => setStatus(u, 'active')}>
                          Restore
                        </button>
                      )}
                      {u.account_status !== 'limited' && (
                        <button className="btn secondary small" onClick={() => setStatus(u, 'limited')}>
                          Make Limited
                        </button>
                      )}
                      {u.account_status !== 'very_limited' && (
                        <button className="btn secondary small" onClick={() => setStatus(u, 'very_limited')}>
                          Make Very Limited
                        </button>
                      )}
                      {u.account_status !== 'banned' && (
                        <button className="btn danger small" onClick={() => setStatus(u, 'banned')}>
                          <Icon name="gavel" size={14} /> Ban Account
                        </button>
                      )}
                    </>
                  )}
                  {myRank === 3 && u.id !== me.id && (
                    <Select
                      className="mod-role"
                      value={u.platform_role}
                      ariaLabel="Staff role"
                      onChange={(v) => run(`@${u.username} is now ${v}.`, () => supabase.rpc('mod_set_platform_role', { p_user: u.id, p_role: v }))}
                      options={[
                        { value: 'user', label: 'Staff role: none' },
                        { value: 'moderator', label: 'Moderator' },
                        { value: 'admin', label: 'Administrator' },
                        { value: 'owner', label: 'Owner' },
                      ]}
                    />
                  )}
                </div>
              </div>
            );
          })}
          {!users.length && !busy && <p className="muted">No users match.</p>}
        </div>
      )}

      {view === 'servers' && (
        <div className="mod-list">
          {servers.map((s) => (
            <div key={s.id} className={`mod-card server-status-${s.status}`}>
              <div className="mod-card-head">
                <span className="server-icon-sm big" style={{ background: s.icon_color }}>
                  {s.name.slice(0, 2).toUpperCase()}
                </span>
                <div className="grow">
                  <div className="mod-name">
                    {s.name} {s.verified && <VerifiedMark />}
                  </div>
                  <div className="small muted">
                    {s.members.toLocaleString()} members · owner @{s.owner_username} · created {new Date(s.created_at).toLocaleDateString()} ·{' '}
                    <code className="id">{s.id}</code>
                  </div>
                  {s.description && <div className="small">{s.description}</div>}
                </div>
                <span className={`pill ${s.status}`}>{SERVER_LABEL[s.status]}</span>
              </div>
              <div className="mod-actions">
                {s.status === 'active' && (
                  <>
                    <button className="btn secondary small" onClick={() => serverAction(s, s.verified ? 'unverify' : 'verify', s.verified ? 'Remove verification' : 'Verify server')}>
                      <Icon name="check" size={14} /> {s.verified ? 'Unverify' : 'Verify'}
                    </button>
                    <button className="btn secondary small" onClick={() => serverAction(s, 'review', 'Put in review', true)}>
                      <Icon name="eye" size={14} /> Put In Review
                    </button>
                  </>
                )}
                {s.status === 'review' && (
                  <>
                    <button className="btn success small" onClick={() => serverAction(s, 'approve', 'Pass review')}>
                      Pass Review
                    </button>
                    <button className="btn danger small" onClick={() => serverAction(s, 'reject', 'Fail review (close server, very-limit owner)', true)}>
                      Fail Review
                    </button>
                  </>
                )}
                {s.status !== 'banned' ? (
                  <button className="btn danger small" onClick={() => serverAction(s, 'ban', 'Permanently ban server', true)}>
                    <Icon name="gavel" size={14} /> Perma Ban
                  </button>
                ) : (
                  <button className="btn secondary small" onClick={() => serverAction(s, 'unban', 'Unban server')}>
                    Unban
                  </button>
                )}
                {s.status === 'closed' && (
                  <button className="btn secondary small" onClick={() => serverAction(s, 'unban', 'Reopen server')}>
                    Reopen
                  </button>
                )}
              </div>
            </div>
          ))}
          {!servers.length && !busy && <p className="muted">No servers match.</p>}
        </div>
      )}

      {view === 'log' && (
        <div className="mod-log">
          {log.map((l) => (
            <div key={l.id} className="mod-log-row">
              <time>{new Date(l.created_at).toLocaleString()}</time>
              <span>
                <b>@{l.actor ?? 'deleted'}</b> {l.action.replace(/_/g, ' ')} {l.target_user && <b>@{l.target_user}</b>}
                {l.target_server && <b> {l.target_server}</b>}
                {l.detail && <span className="muted"> → {l.detail}</span>}
              </span>
              {l.reason && <span className="small muted mod-reason">“{l.reason}”</span>}
            </div>
          ))}
          {!log.length && <p className="muted">Nothing yet.</p>}
        </div>
      )}

      {badgesFor && (
        <BadgeEditor
          user={badgesFor}
          myRank={myRank}
          onClose={() => setBadgesFor(null)}
          onSave={(ids) =>
            run(`Badges updated for @${badgesFor.username}.`, () => supabase.rpc('mod_set_badges', { p_user: badgesFor.id, p_badges: ids })).then(async () => {
              setBadgesFor(null);
              if (badgesFor.id === me.id) {
                const { data } = await supabase.rpc('my_profile');
                if (data) sessionStore.set({ me: data as Profile });
              }
            })
          }
        />
      )}
    </div>
  );
}

function BadgeEditor({ user, myRank, onClose, onSave }: { user: ModUser; myRank: number; onClose: () => void; onSave: (ids: string[]) => void }) {
  const [ids, setIds] = useState<string[]>(user.badges);
  const BADGES = useAllBadges();
  const locked = (id: string) => (id === 'owner' || id === 'founder' ? myRank < 3 : ['admin', 'moderator', 'staff'].includes(id) ? myRank < 2 : false);
  return (
    <Modal title={`Badges for @${user.username}`} onClose={onClose}>
      <div className="badge-editor">
        {BADGES.map((b) => (
          <label key={b.id} className={`badge-choice${ids.includes(b.id) ? ' on' : ''}${locked(b.id) ? ' locked' : ''}`}>
            <input
              type="checkbox"
              disabled={locked(b.id)}
              checked={ids.includes(b.id)}
              onChange={(e) => setIds(e.target.checked ? [...ids, b.id] : ids.filter((x) => x !== b.id))}
            />
            <BadgeIcon def={b} size={20} />
            <span>{b.label}</span>
          </label>
        ))}
      </div>
      <div className="modal-actions">
        <button className="btn secondary" onClick={() => setIds([...new Set([...ids.filter(locked), ...BADGES.filter((b) => !locked(b.id)).map((b) => b.id)])])}>
          Select all
        </button>
        <button className="btn primary" onClick={() => onSave(ids)}>
          Save badges
        </button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ report centre --

interface ReportRow {
  id: string;
  reporter_id: string | null;
  kind: 'message' | 'user';
  target_user: string | null;
  message_id: string | null;
  channel_id: string | null;
  server_id: string | null;
  reason: string;
  evidence: { id: string; author_id: string; author: string; text: string; at: string; reported?: boolean }[];
  status: 'under_review' | 'actioned' | 'dismissed';
  handled_by: string | null;
  handled_note: string;
  created_at: string;
}

export function ReportCentre() {
  const [status, setStatus] = useState<ReportRow['status']>('under_review');
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<ReportFilter>('all');
  const [q, setQ] = useState('');

  async function load() {
    const { data, error } = await supabase.from('reports').select('*').eq('status', status).order('created_at', { ascending: status !== 'under_review' }).limit(100);
    if (error) return setMsg({ ok: false, text: errorMessage(error) });
    const list = (data ?? []) as ReportRow[];
    await loadProfiles(list.flatMap((r) => [r.reporter_id, r.target_user, r.handled_by].filter(Boolean) as string[]));
    setRows(list);
    const { count } = await supabase.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'under_review');
    setCounts({ under_review: count ?? 0 });
  }
  useEffect(() => {
    setRows(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function resolve(r: ReportRow, next: ReportRow['status'], accountAction?: 'banned' | 'limited' | 'very_limited') {
    const note = await askText({
      title: accountAction ? `${accountAction === 'banned' ? 'Ban' : 'Restrict'} ${displayName(r.target_user ?? '')}` : next === 'dismissed' ? 'Dismiss report' : 'Close report',
      label: 'Note for the staff log (optional)',
      maxLength: 1000,
    });
    if (note === null) return;
    if (accountAction && r.target_user) {
      const { error } = await supabase.rpc('mod_set_account_status', { p_user: r.target_user, p_status: accountAction, p_reason: `Report: ${r.reason}\n${note}` });
      if (error) return setMsg({ ok: false, text: errorMessage(error) });
    }
    const { error } = await supabase.rpc('handle_report', { p_report: r.id, p_status: next, p_note: note });
    if (error) return setMsg({ ok: false, text: errorMessage(error) });
    setMsg({ ok: true, text: next === 'dismissed' ? 'Report dismissed.' : accountAction ? 'Done: account updated and report closed.' : 'Report closed.' });
    load();
  }

  return (
    <div className="mod-center">
      <div className="mod-head">
        <h2>
          <Icon name="flag" /> Report Centre
        </h2>
      </div>
      <p className="muted small">
        Messages are end-to-end encrypted, so you only see what the reporter shared: the reported message with a few around it, or their recent DMs
        with the person they reported.
      </p>
      <div className="tabs">
        <button className={status === 'under_review' ? 'active' : ''} onClick={() => setStatus('under_review')}>
          Under review{counts.under_review ? ` · ${counts.under_review}` : ''}
        </button>
        <button className={status === 'actioned' ? 'active' : ''} onClick={() => setStatus('actioned')}>
          Actioned
        </button>
        <button className={status === 'dismissed' ? 'active' : ''} onClick={() => setStatus('dismissed')}>
          Dismissed
        </button>
      </div>
      <ReportFilters filter={filter} setFilter={setFilter} q={q} setQ={setQ} />
      {msg && <div className={msg.ok ? 'notice' : 'form-error'}>{msg.text}</div>}
      {!rows && <div className="spinner" />}
      <div className="mod-list">
        {(rows ?? []).filter((r) => reportMatches(r, filter, q)).map((r) => (
          <div key={r.id} className="mod-card report-card">
            <div className="mod-card-head">
              <span className={`pill ${r.kind === 'message' ? 'review' : 'limited'}`}>{r.kind === 'message' ? 'Message' : 'User'}</span>
              <div className="grow small">
                <b>{displayName(r.reporter_id ?? '')}</b> reported <b className="link-like" onClick={() => r.target_user && openProfile(r.target_user)}>{displayName(r.target_user ?? '')}</b>
                <span className="muted"> · @{getProfile(r.target_user ?? '')?.username} · {new Date(r.created_at).toLocaleString()}</span>
              </div>
            </div>
            <div className="report-reason">“{r.reason}”</div>
            <EvidenceList evidence={r.evidence} targetUser={r.target_user} />
            {r.status !== 'under_review' && (
              <p className="small muted">
                {r.status === 'actioned' ? 'Actioned' : 'Dismissed'} by @{getProfile(r.handled_by ?? '')?.username ?? 'staff'}
                {r.handled_note ? ` — “${r.handled_note}”` : ''}
              </p>
            )}
            <div className="mod-actions">
              {r.message_id && r.channel_id && (
                <button
                  className="btn primary small"
                  title="Opens the conversation if you can see it"
                  onClick={() => {
                    uiStore.set({ settings: null });
                    jumpTo({ channelId: r.channel_id!, serverId: r.server_id, messageId: r.message_id! });
                  }}
                >
                  <Icon name="external" size={14} /> Jump to message
                </button>
              )}
              {r.target_user && (
                <button className="btn secondary small" onClick={() => startDm(r.target_user!).then(() => uiStore.set({ settings: null })).catch((e) => setMsg({ ok: false, text: errorMessage(e) }))}>
                  <Icon name="message" size={14} /> DM them
                </button>
              )}
              {r.status === 'under_review' ? (
                <>
                  <button className="btn danger small" onClick={() => resolve(r, 'actioned', 'banned')}>
                    <Icon name="gavel" size={14} /> Ban Account
                  </button>
                  <button className="btn secondary small" onClick={() => resolve(r, 'actioned', 'very_limited')}>
                    Make Very Limited
                  </button>
                  <button className="btn secondary small" onClick={() => resolve(r, 'actioned', 'limited')}>
                    Make Limited
                  </button>
                  <button className="btn secondary small" onClick={() => resolve(r, 'actioned')}>
                    Close (handled)
                  </button>
                  <button className="btn link small" onClick={() => resolve(r, 'dismissed')}>
                    Dismiss
                  </button>
                </>
              ) : (
                <button className="btn link small" onClick={() => resolve(r, 'under_review')}>
                  Reopen
                </button>
              )}
            </div>
          </div>
        ))}
        {rows && !rows.length && <p className="muted">Nothing here. 🎉</p>}
      </div>
    </div>
  );
}

// ------------------------------------------------- discovery applications --

interface QueueRow {
  id: string;
  server_id: string;
  name: string;
  description: string;
  icon_url: string | null;
  icon_color: string;
  verified: boolean;
  members: number;
  pitch: string;
  categories: string[];
  language: string;
  status: string;
  created_at: string;
  note: string | null;
}

export function DiscoveryQueue() {
  const [status, setStatus] = useState('pending');
  const [size, setSize] = useState<'' | 'big' | 'small'>('');
  const [verified, setVerified] = useState<'' | 'yes' | 'no'>('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    const { data, error: e } = await supabase.rpc('discovery_queue', {
      p_status: status,
      p_min_members: size === 'big' ? 500 : null,
      p_max_members: size === 'small' ? 500 : null,
      p_query: q,
    });
    if (e) return setError(errorMessage(e));
    setRows(((data ?? []) as QueueRow[]).filter((r) => !verified || (verified === 'yes') === r.verified));
  }, [status, size, verified, q]);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  async function review(r: QueueRow, approve: boolean) {
    const note = await askText({ title: approve ? `Approve ${r.name}` : `Reject ${r.name}`, label: 'Note for the server owner (optional)', maxLength: 500 });
    if (note === null) return;
    const { error: e } = await supabase.rpc('review_discovery', { p_application: r.id, p_approve: approve, p_note: note.trim() || null });
    if (e) return alert(errorMessage(e));
    load();
  }

  return (
    <>
      <h2>Discovery Applications</h2>
      <p className="muted">Servers asking to be listed on the Discover page. Preview a server before deciding.</p>
      <div className="mod-filters">
        <input className="search-input" placeholder="Search name or pitch" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={status} onChange={setStatus} options={[{ value: 'pending', label: 'Waiting' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }, { value: '', label: 'All' }]} />
        <Select value={size} onChange={(v) => setSize(v as typeof size)} options={[{ value: '', label: 'Any size' }, { value: 'big', label: '500+ members' }, { value: 'small', label: 'Under 500' }]} />
        <Select value={verified} onChange={(v) => setVerified(v as typeof verified)} options={[{ value: '', label: 'Verified or not' }, { value: 'yes', label: 'Verified' }, { value: 'no', label: 'Not verified' }]} />
      </div>
      {error && <div className="form-error">{error}</div>}
      {!rows && <div className="spinner" />}
      {rows?.length === 0 && <p className="muted">Nothing here.</p>}
      <div className="queue-list">
        {rows?.map((r) => (
          <div key={r.id} className="queue-card">
            <div className="queue-head">
              {r.icon_url ? <img className="queue-icon" src={r.icon_url} alt="" /> : <span className="queue-icon" style={{ background: r.icon_color }}>{r.name.slice(0, 2).toUpperCase()}</span>}
              <div className="grow">
                <b>
                  {r.name} {r.verified && <VerifiedMark size={14} />}
                </b>
                <div className="small muted">
                  {r.members.toLocaleString()} members · {r.language} · applied {new Date(r.created_at).toLocaleDateString()}
                  {r.categories.length ? ` · ${r.categories.join(', ')}` : ''}
                </div>
              </div>
              <span className={`invite-status ${r.status}`}>{r.status}</span>
            </div>
            {r.description && <p className="small">{r.description}</p>}
            {r.pitch && <blockquote className="queue-pitch">{r.pitch}</blockquote>}
            {r.note && <div className="small muted">Reviewer note: {r.note}</div>}
            <div className="row">
              <button className="btn secondary small" onClick={() => openGlobalModal({ kind: 'server-preview', serverId: r.server_id })}>
                <Icon name="eye" size={14} /> Preview & join
              </button>
              {r.status !== 'approved' && (
                <button className="btn success small" onClick={() => review(r, true)}>
                  Approve
                </button>
              )}
              {r.status !== 'rejected' && (
                <button className="btn danger small" onClick={() => review(r, false)}>
                  Reject
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------- badge designer --

/** Venband owners and founders design new badges with their own picture. */
export function BadgeDesigner() {
  const all = useAllBadges();
  const custom = all.filter((b) => b.image);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [picture, setPicture] = useState<{ blob: Blob; url: string } | null>(null);
  const [cropping, setCropping] = useState<File | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mod-center">
      <div className="mod-head">
        <h2>
          <Icon name="star" /> Badge Designer
        </h2>
      </div>
      <p className="muted small">Make a new badge with its own picture. Moderators can then hand it out from the Moderation tab like any other badge.</p>
      {msg && <div className={msg.ok ? 'notice' : 'form-error'}>{msg.text}</div>}
      {cropping && (
        <ImageCropper
          file={cropping}
          opts={{ aspect: 1, size: 128, title: 'Badge picture' }}
          onCancel={() => setCropping(null)}
          onDone={(blob) => {
            setPicture({ blob, url: URL.createObjectURL(blob) });
            setCropping(null);
          }}
        />
      )}
      <div className="badge-designer">
        <button
          className="badge-drop"
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/png,image/webp,image/gif,image/jpeg';
            input.onchange = () => input.files?.[0] && setCropping(input.files[0]);
            input.click();
          }}
          aria-label="Upload badge picture"
        >
          {picture ? <img src={picture.url} alt="" /> : <Icon name="upload" size={22} />}
        </button>
        <div className="grow">
          <div className="row">
            <Field label="Badge ID" hint="letters, numbers and _ (can’t change later)">
              <input value={id} maxLength={30} onChange={(e) => setId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} placeholder="summer_event" />
            </Field>
            <Field label="Name">
              <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Summer Event 2026" />
            </Field>
          </div>
          <Field label="Description">
            <input value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} placeholder="Took part in the summer event" />
          </Field>
          <button
            className="btn primary"
            disabled={busy || !picture || id.length < 2 || name.trim().length < 2}
            onClick={async () => {
              setBusy(true);
              setMsg(null);
              try {
                const path = `${id}-${crypto.randomUUID().slice(0, 8)}.webp`;
                const { error: up } = await supabase.storage.from('badges').upload(path, picture!.blob, { contentType: 'image/webp' });
                if (up) throw up;
                const url = supabase.storage.from('badges').getPublicUrl(path).data.publicUrl;
                const { error } = await supabase.rpc('save_custom_badge', { p_id: id, p_name: name.trim(), p_description: description.trim(), p_image_url: url });
                if (error) throw error;
                await loadCustomBadges(true);
                setMsg({ ok: true, text: `“${name}” is ready to hand out.` });
                setId('');
                setName('');
                setDescription('');
                setPicture(null);
              } catch (e) {
                setMsg({ ok: false, text: errorMessage(e) });
              } finally {
                setBusy(false);
              }
            }}
          >
            Save badge
          </button>
        </div>
      </div>
      <h3>Custom badges</h3>
      {custom.length === 0 && <p className="muted small">None yet.</p>}
      <div className="badge-editor">
        {custom.map((b) => (
          <div key={b.id} className="badge-choice">
            <BadgeIcon def={b} size={24} />
            <span className="grow">
              <b>{b.label}</b> <span className="muted small">{b.id}</span>
              {b.description && <div className="small muted">{b.description}</div>}
            </span>
            <button
              className="btn link small danger-text"
              onClick={async () => {
                if (!(await askConfirm({ title: `Delete ${b.label}?`, body: 'Everyone who has it loses it.', confirm: 'Delete', danger: true }))) return;
                const { error } = await supabase.rpc('delete_custom_badge', { p_id: b.id });
                if (error) return setMsg({ ok: false, text: errorMessage(error) });
                loadCustomBadges(true);
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
