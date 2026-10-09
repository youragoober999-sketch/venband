// Rich presence card: what someone is doing right now, live.
import { useActivity } from '../hooks/data';
import { activityEmoji, activityLine, listenAlong } from '../lib/activity';
import { Icon } from './ui';

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