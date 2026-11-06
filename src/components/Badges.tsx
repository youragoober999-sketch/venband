import { useEffect } from 'react';
import { createStore } from '../lib/store';
import { supabase } from '../lib/supabase';
import { LOGO_PATH, LOGO_VIEWBOX } from './logoPath';

export type BadgeCategory = 'staff' | 'community' | 'developer' | 'creator' | 'supporter' | 'achievement' | 'event' | 'seasonal' | 'special';
export type BadgeRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface BadgeDef {
  id: string;
  label: string;
  color: string;
  path?: string;
  text?: string;
  /** custom badges made by Venband owners / founders */
  image?: string;
  description?: string;
  category?: BadgeCategory;
  rarity?: BadgeRarity;
  /** staff badges: always shown, can't be hidden by the holder */
  protected?: boolean;
  /** custom badges: no longer awarded (holders keep it) */
  retired?: boolean;
  awardableUntil?: string | null;
}

export const CATEGORY_LABEL: Record<BadgeCategory, string> = {
  staff: 'Venband team',
  community: 'Community',
  developer: 'Developer',
  creator: 'Creator',
  supporter: 'Supporter',
  achievement: 'Achievement',
  event: 'Event',
  seasonal: 'Seasonal',
  special: 'Special',
};
export const RARITY_LABEL: Record<BadgeRarity, string> = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };

// Order = default display order. Staff badges first.
export const BADGES: BadgeDef[] = [
  { id: 'founder', label: 'Venband Founder', color: '#ff375f', category: 'staff', rarity: 'legendary', protected: true, description: 'Started Venband.', path: 'M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.7.7-1.9 0-2.6a1.9 1.9 0 0 0-3 .4zM12 15l-3-3a22 22 0 0 1 2-4A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2zM9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5' },
  { id: 'owner', label: 'Venband Owner', color: '#ffc400', category: 'staff', rarity: 'legendary', protected: true, description: 'Runs the Venband platform.', path: 'M3 18h18l-2-11-5 4-2-6-2 6-5-4zM5 21h14' },
  { id: 'admin', label: 'Venband Administrator', color: '#ff453a', category: 'staff', rarity: 'epic', protected: true, description: 'Venband administration team.', path: 'M12 3.8l2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.6-5.1 2.6 1-5.6-4-3.9 5.6-.8z' },
  { id: 'moderator', label: 'Venband Moderator', color: '#0a84ff', category: 'staff', rarity: 'rare', protected: true, description: 'Keeps Venband safe.', path: 'M12 3.5l7 2.8v5c0 4.4-3 7.9-7 9.2-4-1.3-7-4.8-7-9.2v-5zM9 12l2 2 4-4.5' },
  { id: 'developer', label: 'Venband Developer', color: '#f59e0b', category: 'staff', rarity: 'epic', protected: true, description: 'Builds Venband itself.', path: 'M14.7 6.3a4 4 0 0 0-5.3 5.3L4 17l3 3 5.4-5.4a4 4 0 0 0 5.3-5.3l-2.6 2.6-2.3-.6-.6-2.3z' },
  { id: 'staff', label: 'Venband Staff', color: '#8e8e99', category: 'staff', rarity: 'rare', protected: true, description: 'Works on Venband.' },
  { id: 'verified', label: 'Verified', color: '#1d9bf0', category: 'community', rarity: 'rare', description: 'Venband confirmed this is who they say they are.', path: 'M7.5 12.5l3 3 6-7' },
  { id: 'verified_bot', label: 'Verified Bot Developer', color: '#5865f2', category: 'developer', rarity: 'rare', description: 'Made a bot that Venband verified.', path: 'M8 8.5h8a3 3 0 0 1 3 3v4.5a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-4.5a3 3 0 0 1 3-3zM12 4.5v4M9.5 13.5h.01M14.5 13.5h.01' },
  { id: 'verified_server', label: 'Verified Server Owner', color: '#23a55a', category: 'community', rarity: 'rare', description: 'Owns a server Venband verified.', path: 'M5 5h14v5.5H5zM5 13.5h14V19H5zM8 7.75h.01M8 16.25h.01' },
  { id: 'partner', label: 'Venband Partner', color: '#bf5af2', category: 'community', rarity: 'epic', description: 'A partnered creator or community.', path: 'M18.2 8.2a4.2 4.2 0 0 0-6 0L12 8.4l-.2-.2a4.2 4.2 0 1 0-6 6l6.2 6.2 6.2-6.2a4.2 4.2 0 0 0 0-6zM12 3v2M5 4l1.2 1.6M19 4l-1.2 1.6' },
  { id: 'verified_dev', label: 'Verified Developer', color: '#30d158', category: 'developer', rarity: 'rare', description: 'Builds verified bots or apps.', path: 'm8 7-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16' },
  { id: 'bug_hunter_gold', label: 'Bug Bounty Hunter — Gold', color: '#ffb300', category: 'achievement', rarity: 'epic', description: 'Found serious bugs and reported them responsibly.', path: 'M8 8V6a4 4 0 0 1 8 0v2M6 8h12v6a6 6 0 0 1-12 0zM12 8v12M3 13h3M18 13h3M4 8l2 2M20 8l-2 2M4 19l2.5-2M20 19l-2.5-2' },
  { id: 'bug_hunter', label: 'Bug Bounty Hunter', color: '#32b34b', category: 'achievement', rarity: 'rare', description: 'Found bugs and reported them responsibly.', path: 'M8 8V6a4 4 0 0 1 8 0v2M6 8h12v6a6 6 0 0 1-12 0zM12 8v12M3 13h3M18 13h3M4 8l2 2M20 8l-2 2M4 19l2.5-2M20 19l-2.5-2' },
  { id: 'og', label: 'OG — here since the beginning', color: '#30b0e0', category: 'supporter', rarity: 'legendary', description: 'Joined in Venband’s earliest days.', text: 'OG' },
  { id: 'early_supporter', label: 'Early Supporter', color: '#ff4f79', category: 'supporter', rarity: 'rare', description: 'Supported Venband early on.', path: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z' },
  { id: 'supporter', label: 'Venband Supporter', color: '#3aa8e8', category: 'supporter', rarity: 'uncommon', description: 'Supports Venband.', path: 'M6 3h12l4 6-10 12L2 9zM2 9h20M12 21 8 9l4-6 4 6z' },
  { id: 'translator', label: 'Community Translator', color: '#1fb2c4', category: 'community', rarity: 'uncommon', description: 'Helps translate Venband.', path: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10A15 15 0 0 1 12 2z' },
  { id: 'contributor', label: 'Open Source Contributor', color: '#8b5cf6', category: 'developer', rarity: 'uncommon', description: 'Contributed code to Venband.', path: 'M7 4v16M7 8c6.5 0 10 2 10 8M17 16v4M14.5 18.5 17 21l2.5-2.5' },
  { id: 'beta_tester', label: 'Beta Tester', color: '#d946ef', category: 'achievement', rarity: 'uncommon', description: 'Tested Venband before everyone else.', path: 'M9.5 3.5h5M10.5 3.5v5.5L5.6 17.6A2 2 0 0 0 7.3 20.5h9.4a2 2 0 0 0 1.7-2.9L13.5 9V3.5M7.5 14.5h9' },
  { id: 'event_winner', label: 'Event Winner', color: '#ff9500', category: 'event', rarity: 'epic', description: 'Won a Venband event or competition.', path: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3' },
];
export const PROTECTED_BADGES = BADGES.filter((b) => b.protected).map((b) => b.id);

/** Badges designed in Settings → Badge Designer, loaded once. */
export const customBadgeStore = createStore<{ list: BadgeDef[]; loaded: boolean }>({ list: [], loaded: false });
let loadingCustom: Promise<void> | null = null;
export function loadCustomBadges(force = false) {
  if (loadingCustom && !force) return loadingCustom;
  loadingCustom = (async () => {
    let res = await supabase.from('custom_badges').select('id, name, description, image_url, category, rarity, awardable_until, retired').order('created_at');
    if (res.error) res = (await supabase.from('custom_badges').select('id, name, description, image_url').order('created_at')) as typeof res; // older database
    const rows = (res.data ?? []) as { id: string; name: string; description: string; image_url: string; category?: BadgeCategory; rarity?: BadgeRarity; awardable_until?: string | null; retired?: boolean }[];
    customBadgeStore.set({
      loaded: true,
      list: rows.map((b) => ({
        id: b.id, label: b.name, description: b.description, color: '#fff', image: b.image_url,
        category: b.category ?? 'special', rarity: b.rarity ?? 'rare', awardableUntil: b.awardable_until ?? null, retired: Boolean(b.retired),
      })),
    });
  })();
  return loadingCustom;
}
export function useAllBadges(): BadgeDef[] {
  const custom = customBadgeStore.use((s) => s.list);
  const loaded = customBadgeStore.use((s) => s.loaded);
  useEffect(() => {
    if (!loaded) loadCustomBadges();
  }, [loaded]);
  return [...BADGES, ...custom];
}

export const badgeDef = (id: string) => BADGES.find((b) => b.id === id) ?? customBadgeStore.get().list.find((b) => b.id === id);

// ------------------------------------------------------------------ artwork --
// Simple and readable at 14 px: every built-in badge is one flat rounded tile in
// the badge's colour with a bold white symbol. Legendary badges get a thin gold
// edge; that's the only decoration.
function Tile({ def, size }: { def: BadgeDef; size: number }) {
  return (
    <svg className={`badge-icon tile rarity-${def.rarity ?? 'common'}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect x="1" y="1" width="22" height="22" rx="6.5" fill={def.color} stroke={def.rarity === 'legendary' ? '#ffd76a' : '#0000'} strokeWidth="1.4" />
      {def.id === 'staff' ? (
        <svg x="5.2" y="6" width="13.6" height="12" viewBox={LOGO_VIEWBOX}>
          <path fill="#fff" fillRule="evenodd" d={LOGO_PATH} />
        </svg>
      ) : def.text ? (
        <text x="12" y="16" textAnchor="middle" fontSize="10" fontWeight="900" fill="#fff" fontFamily="inherit" letterSpacing="-.4">
          {def.text}
        </text>
      ) : (
        <g transform="translate(4.2 4.2) scale(0.65)">
          <path d={def.path} fill="none" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
    </svg>
  );
}

export function BadgeIcon({ def, size = 16 }: { def: BadgeDef; size?: number }) {
  if (def.image) return <img className={`badge-icon custom rarity-${def.rarity ?? 'rare'}`} src={def.image} alt="" width={size} height={size} draggable={false} />;
  return <Tile def={def} size={size} />;
}

/** Badges in the order the holder chose: staff badges first, then their pick (all when they haven't chosen). */
export function orderBadges(all: BadgeDef[], ids: string[], display?: string[] | null): BadgeDef[] {
  const held = all.filter((b) => ids.includes(b.id));
  const prot = held.filter((b) => b.protected);
  if (!display) return [...prot, ...held.filter((b) => !b.protected)];
  const chosen = display.map((id) => held.find((b) => b.id === id && !b.protected)).filter((b): b is BadgeDef => Boolean(b));
  return [...prot, ...chosen];
}

export function badgeTip(d: BadgeDef) {
  const meta = [d.rarity ? RARITY_LABEL[d.rarity] : '', d.category ? CATEGORY_LABEL[d.category] : ''].filter(Boolean).join(' · ');
  return meta ? `${d.label} — ${meta}` : d.label;
}

/** Small gold crown shown next to a server or group owner. */
export function OwnerCrown({ size = 14, label = 'Owner' }: { size?: number; label?: string }) {
  return (
    <span className="owner-crown" title={label} aria-label={label}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="#ffd60a">
        <path d="M3 18h18l-2-11-5 4-2-6-2 6-5-4z" />
      </svg>
    </span>
  );
}

/** Role icon: a line of emoji, or an image when the icon is a picture URL. */
export function RoleIcon({ icon, size = 14 }: { icon?: string | null; size?: number }) {
  if (!icon) return null;
  return /^(https?:)?\/\//i.test(icon) ? <img className="role-icon" src={icon} alt="" width={size} height={size} draggable={false} /> : <span className="role-icon">{icon}</span>;
}

/** Row of badges. `max` limits how many show inline (next to names). */
export function Badges({ ids, display, size = 15, max }: { ids?: string[] | null; display?: string[] | null; size?: number; max?: number }) {
  const all = useAllBadges();
  if (!ids?.length) return null;
  const defs = orderBadges(all, ids, display);
  const shown = max ? defs.slice(0, max) : defs;
  return (
    <span className="badges">
      {shown.map((d) => (
        <span key={d.id} className="badge-wrap" data-tip={badgeTip(d)} aria-label={badgeTip(d)}>
          <BadgeIcon def={d} size={size} />
        </span>
      ))}
      {max && defs.length > max && <span className="badge-more">+{defs.length - max}</span>}
    </span>
  );
}

/** A server's tag/badge shown next to the server's own name. */
export function ServerBadge({ tag }: { tag?: string | null }) {
  if (!tag) return null;
  return <span className="server-tag">{tag}</span>;
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
