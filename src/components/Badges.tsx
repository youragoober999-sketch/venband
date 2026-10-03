import { LogoGlyph } from './ui';

export interface BadgeDef {
  id: string;
  label: string;
  color: string;
  path?: string;
  text?: string;
}

// Order = display order.
export const BADGES: BadgeDef[] = [
  { id: 'owner', label: 'Venband Owner', color: '#ffd60a', path: 'M3 18h18l-2-11-5 4-2-6-2 6-5-4zM5 21h14' },
  { id: 'admin', label: 'Venband Administrator', color: '#ff453a', path: 'M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5zM12 7l1.4 3 3.1.3-2.4 2 .8 3.1L12 13.8 9.1 15.4l.8-3.1-2.4-2 3.1-.3z' },
  { id: 'moderator', label: 'Venband Moderator', color: '#0a84ff', path: 'M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5zM8.5 12l2.5 2.5 4.5-5' },
  { id: 'staff', label: 'Venband Staff', color: '#f5f5f7' },
  { id: 'partner', label: 'Venband Partner', color: '#bf5af2', path: 'M18.2 8.2a4.2 4.2 0 0 0-6 0L12 8.4l-.2-.2a4.2 4.2 0 1 0-6 6l6.2 6.2 6.2-6.2a4.2 4.2 0 0 0 0-6zM12 3v2M5 4l1.2 1.6M19 4l-1.2 1.6' },
  { id: 'verified_dev', label: 'Verified Developer', color: '#30d158', path: 'm8 7-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16' },
  { id: 'bug_hunter_gold', label: 'Bug Bounty Hunter — Gold', color: '#ffcc00', path: 'M8 8V6a4 4 0 0 1 8 0v2M6 8h12v6a6 6 0 0 1-12 0zM12 8v12M3 13h3M18 13h3M4 8l2 2M20 8l-2 2M4 19l2.5-2M20 19l-2.5-2' },
  { id: 'bug_hunter', label: 'Bug Bounty Hunter', color: '#32d74b', path: 'M8 8V6a4 4 0 0 1 8 0v2M6 8h12v6a6 6 0 0 1-12 0zM12 8v12M3 13h3M18 13h3M4 8l2 2M20 8l-2 2M4 19l2.5-2M20 19l-2.5-2' },
  { id: 'og', label: 'OG — here since the beginning', color: '#64d2ff', text: 'OG' },
  { id: 'early_supporter', label: 'Early Supporter', color: '#ff6482', path: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z' },
  { id: 'supporter', label: 'Venband Supporter', color: '#5ac8fa', path: 'M6 3h12l4 6-10 12L2 9zM2 9h20M12 21 8 9l4-6 4 6z' },
  { id: 'translator', label: 'Community Translator', color: '#40c8e0', path: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10A15 15 0 0 1 12 2z' },
  { id: 'event_winner', label: 'Event Winner', color: '#ff9f0a', path: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3' },
];

export const badgeDef = (id: string) => BADGES.find((b) => b.id === id);

export function BadgeIcon({ def, size = 16 }: { def: BadgeDef; size?: number }) {
  if (def.id === 'staff')
    return (
      <span className="badge-icon" style={{ color: def.color, width: size, height: size }}>
        <LogoGlyph size={size} />
      </span>
    );
  if (def.text)
    return (
      <span className="badge-icon text" style={{ color: def.color, height: size, fontSize: size * 0.62 }}>
        {def.text}
      </span>
    );
  return (
    <svg className="badge-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={def.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={def.path} />
    </svg>
  );
}

/** Row of badges. `max` limits how many show inline (next to names). */
export function Badges({ ids, size = 15, max }: { ids?: string[] | null; size?: number; max?: number }) {
  if (!ids?.length) return null;
  const defs = BADGES.filter((b) => ids.includes(b.id));
  const shown = max ? defs.slice(0, max) : defs;
  return (
    <span className="badges">
      {shown.map((d) => (
        <span key={d.id} className="badge-wrap" data-tip={d.label} aria-label={d.label}>
          <BadgeIcon def={d} size={size} />
        </span>
      ))}
      {max && defs.length > max && <span className="badge-more">+{defs.length - max}</span>}
    </span>
  );
}

/** Small check mark for verified servers. */
export function VerifiedMark({ size = 16 }: { size?: number }) {
  return (
    <span className="verified-mark" data-tip="Verified server" aria-label="Verified">
      <svg width={size} height={size} viewBox="0 0 24 24">
        <path
          fill="currentColor"
          d="M12 1.5 14.6 3.4l3.2-.2.9 3.1 2.7 1.8-1 3 1 3-2.7 1.8-.9 3.1-3.2-.2L12 22.5l-2.6-1.9-3.2.2-.9-3.1-2.7-1.8 1-3-1-3 2.7-1.8.9-3.1 3.2.2z"
        />
        <path d="m8 12.2 2.7 2.7L16.2 9.4" fill="none" stroke="var(--on-accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
