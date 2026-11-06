// Rich presence card: what someone is doing right now, live — plus the games
// they've played lately (activity_history).
import { useEffect, useState } from 'react';
import { useActivity } from '../hooks/data';
import { activityEmoji, activityLine, listenAlong } from '../lib/activity';
import { supabase } from '../lib/supabase';
import { Icon } from './ui';

/** A tile for a game: its own colours from its name (no game logos — those belong to their makers). */
export function GameTile({ name, size = 56 }: { name: string; size?: number }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  const letters = name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]).join('').toUpperCase() || '🎮';
  return (
    <span
      className="game-tile"
      style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(145deg, hsl(${hue} 70% 58%), hsl(${(hue + 40) % 360} 65% 38%))` }}
      aria-hidden
    >
      {letters}
    </span>
  );
}

/** 1:31:56 since `start` (ms), ticking every second. */
function Elapsed({ start }: { start: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - start) / 1000));
  const hms = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  return <>{hms[0] ? `${hms[0]}:${String(hms[1]).padStart(2, '0')}` : hms[1]}:{String(hms[2]).padStart(2, '0')}</>;
}

const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 14) return `${Math.round(s / 86400)}d ago`;
  return `${Math.round(s / (86400 * 7))}w ago`;
};
const hours = (secs: number) => (secs >= 3600 ? `${Math.round(secs / 360) / 10}h` : `${Math.max(1, Math.round(secs / 60))}m`);

function progress(a: { timestamps_start: number | null; timestamps_end: number | null }) {
  if (!a.timestamps_start || !a.timestamps_end) return null;
  const now = Date.now();
  const total = a.timestamps_end - a.timestamps_start;
  if (total <= 0) return null;
  const pct = Math.max(0, Math.min(100, ((now - a.timestamps_start) / total) * 100));
  return pct;
}

/** Compact single-line activity under a name (member lists, DM rows). */
export function ActivityMini({ userId, className = '' }: { userId: string; className?: string }) {
  const a = useActivity(userId);
  if (!a) return null;
  return (
    <span className={`activity-mini ${className}`} role="note" aria-label="Activity">
      <span className="activity-emoji" aria-hidden>
        {activityEmoji(a)}
      </span>
      {activityLine(a)}
    </span>
  );
}

/** Block card for a profile / user modal. */
export function ActivityCard({ userId }: { userId: string }) {
  const a = useActivity(userId);
  if (!a) return null;
  const listenable = a.platform === 'spotify' || (a.uri ?? '').startsWith('spotify:');
  const pct = progress(a);
  // a game: "Playing" with a live timer
  if (a.type === 0 && a.platform !== 'spotify') {
    return (
      <div className="activity-card playing">
        <div className="activity-card-head">Playing</div>
        <div className="activity-card-row">
          <GameTile name={a.name} />
          <div className="activity-card-body">
            <div className="activity-card-name">{a.name}</div>
            {!!a.details && <div className="activity-card-line">{a.details}</div>}
            {!!a.state && <div className="activity-card-line muted">{a.state}</div>}
            {a.timestamps_start && (
              <div className="activity-elapsed">
                <Icon name="gamepad" size={13} /> <Elapsed start={a.timestamps_start} />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="activity-card">
      <div className="activity-card-icon" aria-hidden>
        {activityEmoji(a)}
      </div>
      <div className="activity-card-body">
        <div className="activity-card-name">{a.name}</div>
        {!!a.details && <div className="activity-card-line">{a.details}</div>}
        {!!a.state && <div className="activity-card-line muted">{a.state}</div>}
        {pct !== null && (
          <div className="activity-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="activity-track-fill" style={{ width: `${pct}%` }} />
          </div>
        )}
        {listenable && (
          <button className="btn secondary small" onClick={() => listenAlong(a)} title="Let your player pick this up too">
            <Icon name="play" size={14} /> Listen Along
          </button>
        )}
      </div>
    </div>
  );
}
interface HistoryRow {
  name: string;
  last_at: string;
  total_seconds: number;
  sessions: number;
  longest_seconds: number;
}

/** The games someone played lately, newest first. */
export function RecentActivity({ userId }: { userId: string }) {
  const live = useActivity(userId);
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    supabase
      .from('activity_history')
      .select('name, last_at, total_seconds, sessions, longest_seconds')
      .eq('user_id', userId)
      .order('last_at', { ascending: false })
      .limit(8)
      .then(({ data }) => !cancelled && setRows((data ?? []) as HistoryRow[]));
    return () => {
      cancelled = true;
    };
  }, [userId, live?.name]);
  const list = (rows ?? []).filter((r) => !(live && live.type === 0 && live.name === r.name));
  if (!list.length) return null;
  return (
    <div className="recent-activity">
      <div className="activity-card-head">Recent activity</div>
      {list.slice(0, 6).map((r) => (
        <div key={r.name} className="recent-row">
          <GameTile name={r.name} size={44} />
          <div className="grow">
            <b>{r.name}</b>
            <div className="recent-meta">
              <span>
                <Icon name="gamepad" size={12} /> {ago(r.last_at)}
              </span>
              {r.total_seconds > 0 && <span>{hours(r.total_seconds)} total</span>}
              {r.longest_seconds >= 4 * 3600 && <span>⏱ {hours(r.longest_seconds)} marathon</span>}
              {r.sessions >= 10 && <span>🔥 {r.sessions} sessions</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
