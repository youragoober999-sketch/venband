// The bell in the top bar + the notification center, and the "Official notices"
// list in Settings → Security (how people check an official message is real).
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CATEGORY_LABEL, markNotificationsRead, notificationStore, NOTIFICATION_ACTIONS, startNotifications, stopNotifications, timeAgo,
  type AppNotification, type NotificationCategory,
} from '../lib/notifications';
import { Avatar, Icon } from './ui';
import { markPingsRead, readAll, usePings, type Ping, type PingKind } from '../lib/mentions';
import { getProfile } from '../lib/directory';
import { openChannel } from '../hooks/data';
import { uiStore } from '../lib/ui';

const SEVERITY_ICON: Record<AppNotification['severity'], string> = { info: 'bell', warning: 'warning', critical: 'shield' };
const CATEGORY_ICON: Record<NotificationCategory, string> = { security: 'shield', moderation: 'gavel', platform: 'palette', community: 'flag' };

function NotificationItem({ n, onAction }: { n: AppNotification; onAction?: () => void }) {
  const [open, setOpen] = useState(false);
  const actions = (n.data.actions ?? []).filter((a) => NOTIFICATION_ACTIONS[a]);
  const toggle = () => {
    setOpen((o) => !o);
    if (!n.read_at) void markNotificationsRead([n.id]);
  };
  return (
    <li className={`notif-item sev-${n.severity}${n.read_at ? '' : ' unread'}${open ? ' open' : ''}`}>
      <button className="notif-head" onClick={toggle} aria-expanded={open}>
        <span className={`notif-icon cat-${n.category}`} aria-hidden="true">
          <Icon name={n.severity === 'info' ? CATEGORY_ICON[n.category] : SEVERITY_ICON[n.severity]} size={16} />
        </span>
        <span className="notif-text">
          <span className="notif-title">{n.title}</span>
          <span className="notif-meta">
            {CATEGORY_LABEL[n.category]} · {timeAgo(n.created_at)}
            {n.severity === 'critical' && <span className="notif-sev">Important</span>}
          </span>
        </span>
        {!n.read_at && <span className="notif-dot" aria-label="Unread" />}
      </button>
      {open && (
        <div className="notif-body">
          {n.body && <p>{n.body}</p>}
          {n.data.reason && (
            <p className="small">
              <b>Reason:</b> {String(n.data.reason)}
            </p>
          )}
          <p className="small muted">
            {new Date(n.created_at).toLocaleString()} · Official Venband notice
          </p>
          {actions.length > 0 && (
            <div className="notif-actions">
              {actions.map((a) => (
                <button
                  key={a}
                  className="btn secondary small"
                  onClick={() => {
                    NOTIFICATION_ACTIONS[a].run();
                    onAction?.();
                  }}
                >
                  {NOTIFICATION_ACTIONS[a].label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

type Filter = 'all' | 'unread' | NotificationCategory;
type PingFilter = 'all' | PingKind | 'everyone-here';

const PING_LABEL: Record<PingKind, string> = { you: '@you', role: '@role', everyone: '@everyone', here: '@here', dm: 'DM' };
const PING_FILTERS: [PingFilter, string][] = [
  ['all', 'All'],
  ['you', '@you'],
  ['role', '@role'],
  ['everyone-here', '@everyone / @here'],
  ['dm', 'DMs'],
];

function PingItem({ p, onOpen }: { p: Ping; onOpen: () => void }) {
  const prof = getProfile(p.authorId);
  const name = prof?.display_name || prof?.username || 'Someone';
  return (
    <li className={`ping-item${p.read ? '' : ' unread'}`}>
      <button
        onClick={() => {
          openChannel(p.serverId ?? '@me', p.channelId);
          uiStore.set({ jump: p.id });
          markPingsRead(p.channelId);
          onOpen();
        }}
      >
        {prof ? <Avatar profile={prof} size={34} /> : <span className="ping-av" />}
        <span className="ping-body">
          <span className="ping-top">
            <b>{name}</b>
            <span className={`ping-kind k-${p.kind}`}>{p.kind === 'role' && p.roleName ? `@${p.roleName}` : PING_LABEL[p.kind]}</span>
            <span className="ping-time">{timeAgo(p.at)}</span>
          </span>
          <span className="ping-where">{p.where}</span>
          <span className="ping-text">{p.text || 'New encrypted message'}</span>
        </span>
      </button>
    </li>
  );
}

function NotificationPanel({ onClose }: { onClose: () => void }) {
  const items = notificationStore.use((s) => s.items);
  const loaded = notificationStore.use((s) => s.loaded);
  const available = notificationStore.use((s) => s.available);
  const unread = notificationStore.use((s) => s.unread);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const pings = usePings();
  const [view, setView] = useState<'mentions' | 'notices'>('mentions');
  const [pf, setPf] = useState<PingFilter>('all');
  const [readingAll, setReadingAll] = useState(false);
  const [readError, setReadError] = useState(false);
  const term = q.trim().toLowerCase();
  const pingShown = pings.filter((p) => (pf === 'all' || (pf === 'everyone-here' ? p.kind === 'everyone' || p.kind === 'here' : p.kind === pf)) && (!term || `${p.text} ${p.where}`.toLowerCase().includes(term)));
  const unreadPings = pings.filter((p) => !p.read).length;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !(t instanceof Element && t.closest('.notif-bell'))) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items.filter(
      (n) =>
        (filter === 'all' || (filter === 'unread' ? !n.read_at : n.category === filter)) &&
        (!term || `${n.title} ${n.body}`.toLowerCase().includes(term)),
    );
  }, [items, filter, q]);

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'unread', label: `Unread${unread ? ` (${unread})` : ''}` },
    { id: 'security', label: 'Security' },
    { id: 'moderation', label: 'Account' },
    { id: 'platform', label: 'Platform' },
    { id: 'community', label: 'Community' },
  ];

  return (
    <div className="notif-panel" ref={ref} role="dialog" aria-label="Notifications">
      <header className="notif-panel-head">
        <h3>Notifications</h3>
        <button
          className="btn secondary small notif-readall"
          disabled={readingAll}
          onClick={async () => {
            setReadingAll(true);
            setReadError(false);
            try {
              await readAll();
              await markNotificationsRead();
            } catch {
              setReadError(true);
            } finally {
              setReadingAll(false);
            }
          }}
          title="Clear every unread dot and ping"
        >
          <Icon name="check" size={14} /> Read all
        </button>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="x" size={16} />
        </button>
      </header>
      {readError && <div className="form-error" role="alert">Couldn’t mark everything as read. Try again.</div>}
      <div className="notif-views" role="tablist">
        <button role="tab" aria-selected={view === 'mentions'} className={view === 'mentions' ? 'on' : ''} onClick={() => setView('mentions')}>
          Mentions{unreadPings ? <span className="notif-pill">{unreadPings > 9 ? '9+' : unreadPings}</span> : null}
        </button>
        <button role="tab" aria-selected={view === 'notices'} className={view === 'notices' ? 'on' : ''} onClick={() => setView('notices')}>
          Notices{unread ? <span className="notif-pill">{unread > 9 ? '9+' : unread}</span> : null}
        </button>
      </div>
      {view === 'mentions' ? (
        <>
          <div className="notif-filters" role="tablist">
            {PING_FILTERS.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={pf === id} className={`chip${pf === id ? ' on' : ''}`} onClick={() => setPf(id)}>
                {label}
              </button>
            ))}
          </div>
          <input className="search-input notif-search" placeholder="Search mentions" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search mentions" />
          <ul className="notif-list">
            {!pingShown.length && <li className="notif-empty muted small">{pings.length ? 'Nothing matches.' : 'No pings yet. When someone mentions you, your role, @everyone, or DMs you, it shows up here.'}</li>}
            {pingShown.map((p) => (
              <PingItem key={p.id} p={p} onOpen={onClose} />
            ))}
          </ul>
        </>
      ) : (
        <>
      <div className="notif-filters" role="tablist">
        {filters.map((f) => (
          <button key={f.id} role="tab" aria-selected={filter === f.id} className={`chip${filter === f.id ? ' on' : ''}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      <input className="search-input notif-search" placeholder="Search notifications" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search notifications" />
      <ul className="notif-list">
        {!loaded && <li className="notif-empty"><div className="spinner small" /></li>}
        {loaded && !available && <li className="notif-empty muted small">Notifications aren’t set up on this server yet.</li>}
        {loaded && available && !shown.length && (
          <li className="notif-empty muted small">{items.length ? 'Nothing matches.' : 'You’re all caught up. Security alerts and account notices will show up here.'}</li>
        )}
        {shown.map((n) => (
          <NotificationItem key={n.id} n={n} onAction={onClose} />
        ))}
      </ul>
        </>
      )}
      <footer className="notif-foot small muted">
        <Icon name="lock" size={12} /> Venband never asks for your password, codes or payment details in a message.
      </footer>
    </div>
  );
}

export function NotificationBell() {
  const notices = notificationStore.use((s) => s.unread);
  const unread = notices + usePings().filter((p) => !p.read).length;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    void startNotifications();
    return () => stopNotifications();
  }, []);
  return (
    <>
      <button
        className={`icon-btn notif-bell${open ? ' active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={unread ? `${unread} unread notification${unread === 1 ? '' : 's'}` : 'Notifications'}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
      >
        <Icon name="bell" size={18} />
        {unread > 0 && <span className="notif-count">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && <NotificationPanel onClose={() => setOpen(false)} />}
    </>
  );
}

/** Settings → Security: where people check whether an "official" message is real. */
export function OfficialNotices() {
  const items = notificationStore.use((s) => s.items);
  const loaded = notificationStore.use((s) => s.loaded);
  useEffect(() => {
    void startNotifications();
  }, []);
  const notices = items.filter((n) => n.category === 'security' || n.category === 'moderation').slice(0, 15);
  return (
    <section className="settings-section">
      <h3>Official notices</h3>
      <p className="muted small">
        Every real message from Venband about your account is listed here and carries the <b>Official</b> badge in your DMs. If a message claims to be
        from Venband but isn’t on this list, it’s fake — and Venband will never ask for your password or codes.
      </p>
      {!loaded && <div className="spinner small" />}
      {loaded && !notices.length && <p className="small muted">No security or account notices yet.</p>}
      <ul className="notif-list flat">
        {notices.map((n) => (
          <NotificationItem key={n.id} n={n} />
        ))}
      </ul>
    </section>
  );
}
