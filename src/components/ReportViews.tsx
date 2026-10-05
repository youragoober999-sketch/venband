// Report evidence (with pictures and the reported message highlighted),
// filters, and the server moderation tabs: Reports and Audit Log.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, errorMessage } from '../lib/supabase';
import { displayName, getProfile, loadProfiles } from '../lib/directory';
import { evidenceUrls, type EvidenceItem, type EvidenceKind } from '../lib/reports';
import { has, P } from '../lib/permissions';
import { closeSettings } from '../lib/ui';
import type { ServerData } from '../hooks/data';
import { askConfirm, askText } from './Dialogs';
import { Markdown } from './Markdown';
import { jumpTo } from './Search';
import { Select } from './Select';
import { Icon } from './ui';

export type ReportFilter = 'all' | EvidenceKind;
const FILTERS: { id: ReportFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'slur', label: 'Slurs' },
  { id: 'image', label: 'Images' },
  { id: 'video', label: 'Videos' },
  { id: 'gif', label: 'GIFs' },
  { id: 'file', label: 'Files' },
  { id: 'text', label: 'Text only' },
];

export function ReportFilters({ filter, setFilter, q, setQ }: { filter: ReportFilter; setFilter: (f: ReportFilter) => void; q: string; setQ: (q: string) => void }) {
  return (
    <div className="report-filters">
      <input className="search-input" placeholder="Search reasons, messages or people" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search reports" />
      <div className="chip-row">
        {FILTERS.map((f) => (
          <button key={f.id} className={`chip${filter === f.id ? ' on' : ''}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Does this report match the filter chips and search box? */
export function reportMatches(r: { reason: string; evidence: EvidenceItem[]; target_user: string | null }, filter: ReportFilter, q: string) {
  const reported = r.evidence.filter((e) => e.reported);
  const pool = reported.length ? reported : r.evidence;
  if (filter === 'text') {
    if (!pool.length || pool.some((e) => (e.kinds ?? ['text']).some((k) => k !== 'text'))) return false;
  } else if (filter !== 'all' && !pool.some((e) => e.kinds?.includes(filter) || (filter === 'image' && e.images?.length))) return false;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [r.reason, displayName(r.target_user ?? ''), getProfile(r.target_user ?? '')?.username ?? '', ...r.evidence.map((e) => `${e.author} ${e.text}`)].join(' ').toLowerCase();
  return hay.includes(needle);
}

export function EvidenceList({ evidence, targetUser }: { evidence: EvidenceItem[]; targetUser: string | null }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const reportedRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const paths = evidence.flatMap((e) => e.images ?? []);
    evidenceUrls(paths).then(setUrls);
  }, [evidence]);
  useEffect(() => {
    // bring the reported message into view inside the evidence box
    const el = reportedRef.current;
    const box = el?.parentElement;
    if (el && box) box.scrollTop = el.offsetTop - box.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
  }, []);
  if (!evidence.length) return <p className="small muted">No messages were shared with this report.</p>;
  return (
    <div className="report-evidence">
      {evidence.map((e) => (
        <div key={e.id} ref={e.reported ? reportedRef : undefined} className={`evidence-msg${e.reported ? ' reported' : ''}${e.author_id === targetUser ? ' target' : ''}`}>
          <div className="evidence-meta">
            <b>{e.author}</b> <span className="muted">{new Date(e.at).toLocaleString()}</span>
            {e.reported && <span className="pill banned">reported</span>}
            {e.kinds?.filter((k) => k !== 'text').map((k) => (
              <span key={k} className={`pill kind-${k}`}>
                {k}
              </span>
            ))}
          </div>
          <div className="evidence-text">
            <Markdown text={e.text} />
          </div>
          {e.images && e.images.length > 0 && (
            <div className="evidence-images">
              {e.images.map((p) =>
                urls[p] ? (
                  <button key={p} className="evidence-img" onClick={() => setOpen(urls[p])} aria-label="Open picture">
                    <img src={urls[p]} alt="Reported picture" loading="lazy" />
                  </button>
                ) : (
                  <span key={p} className="evidence-img loading" />
                ),
              )}
            </div>
          )}
        </div>
      ))}
      {open && (
        <div className="lightbox" role="dialog" aria-label="Picture" onClick={() => setOpen(null)}>
          <img src={open} alt="Reported picture" />
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------- server reports --

interface ServerReport {
  id: string;
  kind: 'message' | 'user';
  target_user: string | null;
  message_id: string | null;
  channel_id: string | null;
  reason: string;
  evidence: EvidenceItem[];
  server_status: 'open' | 'actioned' | 'dismissed';
  server_note: string;
  created_at: string;
}

const TIMEOUTS: [string, number][] = [
  ['60 seconds', 1],
  ['5 minutes', 5],
  ['10 minutes', 10],
  ['1 hour', 60],
  ['1 day', 1440],
  ['1 week', 10080],
];

/** Timeout / warn / kick / ban for one member, used in menus and reports. */
export async function moderate(action: 'timeout' | 'warn' | 'kick' | 'ban', serverId: string, userId: string, minutes = 60): Promise<string | null> {
  const name = displayName(userId);
  if (action === 'timeout') {
    const reason = await askText({ title: `Time out ${name}`, label: 'Reason (they’ll see it)', maxLength: 512 });
    if (reason === null) return null;
    const { error } = await supabase.rpc('timeout_member', { p_server: serverId, p_user: userId, p_minutes: minutes, p_reason: reason });
    return error ? errorMessage(error) : `${name} is timed out.`;
  }
  if (action === 'warn') {
    const reason = await askText({ title: `Warn ${name}`, label: 'What should they know?', maxLength: 1000 });
    if (!reason?.trim()) return null;
    const { error } = await supabase.rpc('warn_member', { p_server: serverId, p_user: userId, p_reason: reason });
    return error ? errorMessage(error) : `${name} was warned.`;
  }
  if (action === 'kick') {
    if (!(await askConfirm({ title: `Kick ${name}`, body: 'They can come back with a new invite.', confirm: 'Kick', danger: true }))) return null;
    const { error } = await supabase.from('server_members').delete().eq('server_id', serverId).eq('user_id', userId);
    return error ? errorMessage(error) : `${name} was kicked.`;
  }
  const reason = await askText({ title: `Ban ${name}`, label: 'Reason', maxLength: 512 });
  if (reason === null) return null;
  const { error } = await supabase.from('bans').insert({ server_id: serverId, user_id: userId, reason });
  return error ? errorMessage(error) : `${name} was banned.`;
}

export { TIMEOUTS };

export function ServerReportsTab({ data, onClose }: { data: ServerData; onClose: () => void }) {
  const server = data.server!;
  const [status, setStatus] = useState<ServerReport['server_status']>('open');
  const [rows, setRows] = useState<ServerReport[] | null>(null);
  const [filter, setFilter] = useState<ReportFilter>('all');
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    const { data: r, error } = await supabase.rpc('server_reports', { p_server: server.id, p_status: status });
    if (error) return setMsg({ ok: false, text: errorMessage(error) });
    const list = (r ?? []) as ServerReport[];
    await loadProfiles(list.map((x) => x.target_user).filter(Boolean) as string[]);
    setRows(list);
  }, [server.id, status]);
  useEffect(() => {
    setRows(null);
    load();
  }, [load]);
  const shown = useMemo(() => (rows ?? []).filter((r) => reportMatches(r, filter, q)), [rows, filter, q]);
  const can = (p: number) => has(data.myPermissions, p);

  async function resolve(r: ServerReport, next: ServerReport['server_status']) {
    const note = next === 'open' ? '' : await askText({ title: next === 'dismissed' ? 'Dismiss report' : 'Close report', label: 'Note for other moderators (optional)', maxLength: 1000 });
    if (note === null) return;
    const { error } = await supabase.rpc('handle_server_report', { p_report: r.id, p_status: next, p_note: note });
    setMsg(error ? { ok: false, text: errorMessage(error) } : { ok: true, text: next === 'open' ? 'Reopened.' : 'Done.' });
    load();
  }

  return (
    <div className="settings-section">
      <p className="small muted">Reports about messages in {server.name}. The person who reported stays anonymous. Venband staff see these too.</p>
      <div className="tabs">
        {(['open', 'actioned', 'dismissed'] as const).map((s) => (
          <button key={s} className={status === s ? 'active' : ''} onClick={() => setStatus(s)}>
            {s === 'open' ? 'Open' : s === 'actioned' ? 'Handled' : 'Dismissed'}
          </button>
        ))}
      </div>
      <ReportFilters filter={filter} setFilter={setFilter} q={q} setQ={setQ} />
      {msg && <div className={msg.ok ? 'form-notice' : 'form-error'}>{msg.text}</div>}
      {!rows && <div className="spinner" />}
      {rows && !shown.length && <p className="muted">Nothing here. 🎉</p>}
      {shown.map((r) => (
        <div key={r.id} className="mod-card report-card">
          <div className="mod-card-head">
            <span className="pill review">{r.kind === 'message' ? 'Message' : 'User'}</span>
            <div className="grow small">
              <b>{displayName(r.target_user ?? '')}</b> <span className="muted">@{getProfile(r.target_user ?? '')?.username} · {new Date(r.created_at).toLocaleString()}</span>
            </div>
          </div>
          <div className="report-reason">“{r.reason}”</div>
          <EvidenceList evidence={r.evidence} targetUser={r.target_user} />
          {r.server_note && <p className="small muted">Note: {r.server_note}</p>}
          <div className="mod-actions">
            {r.message_id && r.channel_id && (
              <button
                className="btn primary small"
                onClick={() => {
                  closeSettings();
                  onClose();
                  jumpTo({ channelId: r.channel_id!, serverId: server.id, messageId: r.message_id! });
                }}
              >
                <Icon name="external" size={14} /> Jump to message
              </button>
            )}
            {r.message_id && can(P.MANAGE_MESSAGES) && (
              <button
                className="btn secondary small"
                onClick={async () => {
                  if (!(await askConfirm({ title: 'Delete the reported message?', body: 'It’s removed for everyone.', confirm: 'Delete', danger: true }))) return;
                  const { error } = await supabase.from('messages').delete().eq('id', r.message_id!);
                  setMsg(error ? { ok: false, text: errorMessage(error) } : { ok: true, text: 'Message deleted.' });
                }}
              >
                <Icon name="trash" size={14} /> Delete message
              </button>
            )}
            {r.target_user && can(P.MODERATE_MEMBERS) && (
              <button className="btn secondary small" onClick={async () => setMsg(await moderate('timeout', server.id, r.target_user!, 60).then((t) => (t ? { ok: !/can|not|denied/i.test(t), text: t } : null)))}>
                Time out 1h
              </button>
            )}
            {r.target_user && (can(P.MODERATE_MEMBERS) || can(P.KICK_MEMBERS)) && (
              <button className="btn secondary small" onClick={async () => setMsg(await moderate('warn', server.id, r.target_user!).then((t) => (t ? { ok: !/can|not|denied/i.test(t), text: t } : null)))}>
                Warn
              </button>
            )}
            {r.target_user && can(P.BAN_MEMBERS) && (
              <button className="btn danger small" onClick={async () => setMsg(await moderate('ban', server.id, r.target_user!).then((t) => (t ? { ok: !/can|not|denied/i.test(t), text: t } : null)))}>
                Ban
              </button>
            )}
            {r.server_status === 'open' ? (
              <>
                <button className="btn secondary small" onClick={() => resolve(r, 'actioned')}>
                  Close (handled)
                </button>
                <button className="btn link small" onClick={() => resolve(r, 'dismissed')}>
                  Dismiss
                </button>
              </>
            ) : (
              <button className="btn link small" onClick={() => resolve(r, 'open')}>
                Reopen
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- audit log --

interface AuditRow {
  id: string;
  actor_id: string | null;
  action: string;
  target_user: string | null;
  target_id: string | null;
  detail: { name?: string; reason?: string; changed?: string[] | null; role?: string; code?: string; minutes?: number; note?: string };
  created_at: string;
}

const GROUPS: Record<string, string[]> = {
  members: ['kick', 'ban', 'unban', 'timeout', 'timeout_remove', 'warn'],
  roles: ['role_insert', 'role_update', 'role_delete', 'role_give', 'role_take'],
  channels: ['channel_insert', 'channel_update', 'channel_delete'],
  invites: ['invite_create', 'invite_delete'],
  server: ['server_update'],
  bots: ['bot_add', 'bot_remove'],
  reports: ['report_actioned', 'report_dismissed', 'report_open'],
  media: ['gif_remove', 'gif_restore'],
};

function describe(r: AuditRow) {
  const who = r.target_user ? displayName(r.target_user) : '';
  const d = r.detail ?? {};
  switch (r.action) {
    case 'kick':
      return `kicked ${who}`;
    case 'ban':
      return `banned ${who}${d.reason ? ` — “${d.reason}”` : ''}`;
    case 'unban':
      return `unbanned ${who}`;
    case 'timeout':
      return `timed out ${who} for ${d.minutes && d.minutes >= 1440 ? `${Math.round(d.minutes / 1440)} day(s)` : `${d.minutes} min`}${d.reason ? ` — “${d.reason}”` : ''}`;
    case 'timeout_remove':
      return `removed ${who}’s timeout`;
    case 'warn':
      return `warned ${who} — “${d.reason ?? ''}”`;
    case 'role_give':
      return `gave ${who} the role ${d.role ?? ''}`;
    case 'role_take':
      return `took the role ${d.role ?? ''} from ${who}`;
    case 'role_insert':
      return `created the role ${d.name}`;
    case 'role_update':
      return `changed the role ${d.name} (${(d.changed ?? []).join(', ')})`;
    case 'role_delete':
      return `deleted the role ${d.name}`;
    case 'channel_insert':
      return `created #${d.name}`;
    case 'channel_update':
      return `changed #${d.name} (${(d.changed ?? []).join(', ')})`;
    case 'channel_delete':
      return `deleted #${d.name}`;
    case 'invite_create':
      return `made an invite (${d.code})`;
    case 'invite_delete':
      return `deleted an invite (${d.code})`;
    case 'server_update':
      return `changed server settings (${(d.changed ?? []).filter((c) => c !== 'updated_at').join(', ')})`;
    case 'bot_add':
      return `added the bot ${d.name}`;
    case 'bot_remove':
      return `removed the bot ${d.name}`;
    case 'gif_remove':
      return 'removed a GIF';
    case 'gif_restore':
      return 'restored a GIF';
    default:
      return r.action.replace(/_/g, ' ') + (who ? ` ${who}` : '');
  }
}

export function AuditLogTab({ data }: { data: ServerData }) {
  const server = data.server!;
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [group, setGroup] = useState('');
  const [person, setPerson] = useState('');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(100);
  useEffect(() => {
    let query = supabase.from('server_audit_log').select('*').eq('server_id', server.id).order('created_at', { ascending: false }).limit(limit);
    if (group) query = query.in('action', GROUPS[group]);
    if (person) query = query.or(`actor_id.eq.${person},target_user.eq.${person}`);
    query.then(async ({ data: r }) => {
      const list = (r ?? []) as AuditRow[];
      await loadProfiles(list.flatMap((x) => [x.actor_id, x.target_user].filter(Boolean) as string[]));
      setRows(list);
    });
  }, [server.id, group, person, limit]);
  const shown = (rows ?? []).filter((r) => !q.trim() || `${displayName(r.actor_id ?? '')} ${describe(r)}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="settings-section audit-log">
      <div className="row wrap audit-filters">
        <Select
          value={group}
          onChange={setGroup}
          ariaLabel="Action"
          options={[
            { value: '', label: 'All actions' },
            { value: 'members', label: 'Kicks, bans, timeouts & warnings' },
            { value: 'roles', label: 'Roles' },
            { value: 'channels', label: 'Channels' },
            { value: 'invites', label: 'Invites' },
            { value: 'server', label: 'Server settings' },
            { value: 'bots', label: 'Bots' },
            { value: 'reports', label: 'Reports' },
            { value: 'media', label: 'Removed GIFs' },
          ]}
        />
        <Select
          value={person}
          onChange={setPerson}
          searchable
          ariaLabel="Person"
          options={[{ value: '', label: 'Anyone' }, ...data.members.map((m) => ({ value: m.user_id, label: displayName(m.user_id, m.nickname) }))]}
        />
        <input className="search-input grow" placeholder="Search the log" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the audit log" />
      </div>
      {!rows && <div className="spinner" />}
      {rows && !shown.length && <p className="muted">No matching entries.</p>}
      <ol className="audit-list">
        {shown.map((r) => (
          <li key={r.id} className={`audit-row a-${r.action.split('_')[0]}`}>
            <span className="audit-dot" />
            <div className="grow">
              <b>{r.actor_id ? displayName(r.actor_id) : 'Someone'}</b> {describe(r)}
            </div>
            <time className="small muted" dateTime={r.created_at}>
              {new Date(r.created_at).toLocaleString()}
            </time>
          </li>
        ))}
      </ol>
      {rows && rows.length >= limit && (
        <button className="btn link" onClick={() => setLimit((l) => l + 100)}>
          Load more
        </button>
      )}
    </div>
  );
}
