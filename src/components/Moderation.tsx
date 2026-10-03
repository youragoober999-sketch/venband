// Venband staff tools: find any account or server and act on it. Every action
// is enforced by the database (staff rank checks) and written to an audit log.
import { useEffect, useState } from 'react';
import { supabase, errorMessage } from '../lib/supabase';
import { sessionStore } from '../lib/session';
import { putProfile } from '../lib/directory';
import { uiStore } from '../lib/ui';
import type { AccountStatus, PlatformRole, Profile, ServerStatus } from '../lib/types';
import { Avatar, Icon, Modal } from './ui';
import { BADGES, BadgeIcon, Badges, VerifiedMark } from './Badges';
import { askConfirm, askText } from './Dialogs';
import { startDm } from './Modals';
import { openProfile } from './People';

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
                    <select
                      className="mod-role"
                      value={u.platform_role}
                      onChange={(e) =>
                        run(`@${u.username} is now ${e.target.value}.`, () => supabase.rpc('mod_set_platform_role', { p_user: u.id, p_role: e.target.value }))
                      }
                    >
                      <option value="user">Staff role: none</option>
                      <option value="moderator">Moderator</option>
                      <option value="admin">Administrator</option>
                      <option value="owner">Owner</option>
                    </select>
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
  const locked = (id: string) => (id === 'owner' ? myRank < 3 : ['admin', 'moderator', 'staff'].includes(id) ? myRank < 2 : false);
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
