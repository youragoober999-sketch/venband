// Cross-device rich presence: what someone is doing right now, live.
//
//   * Rows live in the `activities` table, written only through the
//     set_my_activity / clear_my_activity RPCs (see
//     supabase/migrations/20261024000000_activities.sql).
//   * Desktop builds report their local Discord-IPC activity (VS Code, games,
//     YouTube, Spotify's local poller…) through the `venbandDesktop` bridge;
//     this module forwards it to the server exactly like the web clients do.
//   * Everyone who can see a profile can see its activity; realtime pushes new
//     rows the same way profile updates do.
import { supabase } from './supabase';

export type ActivityPlatform = 'rpc' | 'spotify' | 'custom' | 'connections';

export interface ActivityButton {
  label: string;
  url?: string;
}

/** The row from `activities` — one per user, null means "nothing going on". */
export interface Activity {
  user_id: string;
  platform: ActivityPlatform;
  icon: string | null;
  name: string;
  type: number;
  details: string | null;
  state: string | null;
  url: string | null;
  uri: string | null;
  client_id: string | null;
  assets_large_key: string | null;
  assets_large_text: string | null;
  assets_small_key: string | null;
  assets_small_text: string | null;
  party_id: string | null;
  party_cur: number | null;
  party_max: number | null;
  timestamps_start: number | null;
  timestamps_end: number | null;
  buttons: ActivityButton[];
  updated_at: string;
}

/** The shape desktop RPC / other input arrives in (superset, buttons as labels). */
export interface ActivityInput {
  platform?: ActivityPlatform;
  icon?: string | null;
  name: string;
  type?: number;
  details?: string | null;
  state?: string | null;
  url?: string | null;
  uri?: string | null;
  client_id?: string | null;
  assets_large_key?: string | null;
  assets_large_text?: string | null;
  assets_small_key?: string | null;
  assets_small_text?: string | null;
  party_id?: string | null;
  party_cur?: number | null;
  party_max?: number | null;
  timestamps_start?: number | null;
  timestamps_end?: number | null;
  buttons?: (ActivityButton | string)[] | null;
}

// ------------------------------------------------------------- tiny store ----

type Listener = () => void;
const listeners = new Set<Listener>();
let version = 0;
function emit() {
  version++;
  listeners.forEach((l) => l());
}
export function subscribeActivity(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function activityVersion() {
  return version;
}

const activities = new Map<string, Activity>();
const fetching = new Set<string>();

export function getActivity(userId: string): Activity | undefined {
  return activities.get(userId);
}

export function prettyActivity(a: Activity): string {
  switch (a.type) {
    case 1:
      return `Streaming ${a.name}`;
    case 2:
      return `Listening to ${a.name}`;
    case 3:
      return `Watching ${a.name}`;
    case 4:
      return a.name;
    case 5:
      return `Playing ${a.name}`;
    default:
      return `Playing ${a.name}`;
  }
}

/** Short line shown under a name in member lists. */
export function activityLine(a: Activity): string {
  const desc = [a.details, a.state].filter(Boolean).join(' · ');
  const head = prettyActivity(a);
  return desc ? `${head} — ${desc}` : head;
}

/** A per-type emoji / icon for chips. */
export function activityEmoji(a: Activity): string {
  if (a.icon) return a.icon;
  switch (a.platform) {
    case 'spotify':
      return '🎵';
    case 'connections':
      return '🔗';
    default:
      break;
  }
  switch (a.type) {
    case 1:
      return '🔴';
    case 2:
      return '🎧';
    case 3:
      return '📺';
    case 4:
      return '⭐';
    default:
      return '▶️';
  }
}

function fromRow(row: Record<string, unknown>): Activity {
  const buttons = (Array.isArray(row.buttons) ? row.buttons : []).map((b) => {
    if (typeof b === 'string') return { label: b };
    const x = b as { label?: unknown; url?: unknown };
    return { label: String(x?.label ?? ''), url: typeof x?.url === 'string' ? x.url : undefined };
  });
  return {
    user_id: String(row.user_id),
    platform: (row.platform ?? 'rpc') as ActivityPlatform,
    icon: (row.icon as string | null) ?? null,
    name: String(row.name ?? ''),
    type: Number(row.type ?? 0),
    details: (row.details as string | null) ?? null,
    state: (row.state as string | null) ?? null,
    url: (row.url as string | null) ?? null,
    uri: (row.uri as string | null) ?? null,
    client_id: (row.client_id as string | null) ?? null,
    assets_large_key: (row.assets_large_key as string | null) ?? null,
    assets_large_text: (row.assets_large_text as string | null) ?? null,
    assets_small_key: (row.assets_small_key as string | null) ?? null,
    assets_small_text: (row.assets_small_text as string | null) ?? null,
    party_id: (row.party_id as string | null) ?? null,
    party_cur: (row.party_cur as number | null) ?? null,
    party_max: (row.party_max as number | null) ?? null,
    timestamps_start: (row.timestamps_start as number | null) ?? null,
    timestamps_end: (row.timestamps_end as number | null) ?? null,
    buttons,
    updated_at: String(row.updated_at ?? ''),
  };
}

export async function loadActivity(userId: string): Promise<void> {
  if (activities.has(userId) || fetching.has(userId)) return;
  fetching.add(userId);
  try {
    const { data } = await supabase.from('activities').select('*').eq('user_id', userId).maybeSingle();
    if (data) activities.set(userId, fromRow(data as Record<string, unknown>));
  } finally {
    fetching.delete(userId);
    emit();
  }
}

// --------------------------------------------------------------- realtime ----

let watching = false;
export function watchActivities() {
  if (watching) return;
  watching = true;
  supabase
    .channel('activities:all')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'activities' }, (payload) => {
      const { eventType, new: n, old: o } = payload as {
        eventType: 'INSERT' | 'UPDATE' | 'DELETE';
        new: Record<string, unknown>;
        old: Record<string, unknown>;
      };
      const id = eventType === 'DELETE' ? String(o.user_id) : String(n.user_id);
      if (eventType === 'DELETE') activities.delete(id);
      else activities.set(id, fromRow(n));
      emit();
    })
    .subscribe();
}

// ------------------------------------------------------------------ bridge ----

let myUserId = '';

/** Tell this module who the signed-in user is (from the session). */
export function setActivityUser(userId: string) {
  if (myUserId === userId) return;
  myUserId = userId;
  watchActivities();
  if (window.venbandDesktop) {
    // the bridge handshake carries who we are so the READY payload looks right
    window.venbandDesktop.setRpcUser({ id: userId });
    window.venbandDesktop.onActivity((a) => {
      if (myUserId) pushMyActivity(a as ActivityInput | null);
    });
  }
}

function toServerShape(input: ActivityInput) {
  return {
    platform: input.platform ?? 'rpc',
    icon: input.icon ?? null,
    name: input.name,
    type: input.type ?? 0,
    details: input.details ?? null,
    state: input.state ?? null,
    url: input.url ?? null,
    uri: input.uri ?? null,
    client_id: input.client_id ?? null,
    assets_large_key: input.assets_large_key ?? null,
    assets_large_text: input.assets_large_text ?? null,
    assets_small_key: input.assets_small_key ?? null,
    assets_small_text: input.assets_small_text ?? null,
    party_id: input.party_id ?? null,
    party_cur: input.party_cur ?? null,
    party_max: input.party_max ?? null,
    timestamps_start: input.timestamps_start ?? null,
    timestamps_end: input.timestamps_end ?? null,
    buttons: (input.buttons ?? []).map((b) => (typeof b === 'string' ? { label: b } : b)),
  };
}

/**
 * Report your current activity (desktop RPC, Spotify, or a custom status).
 * Pass null (or an empty name) to clear it. The server applies writes in
 * order, so the newest report always wins.
 */
export function pushMyActivity(input: ActivityInput | null) {
  if (!myUserId) return;
  const payload = !input || !input.name?.trim() ? null : toServerShape(input);
  const rpc = payload ? supabase.rpc('set_my_activity', { p_activity: payload }) : supabase.rpc('clear_my_activity');
  void rpc.then(({ error }) => {
    if (error) console.warn('activity:', error.message);
  });
}

export async function clearMyActivity(): Promise<void> {
  if (!myUserId) return;
  await supabase.rpc('clear_my_activity');
}

/** Play along with someone's Spotify activity (desktop opens the local player). */
export function listenAlong(a: Activity) {
  const target = a.uri && a.uri.startsWith('spotify:') ? `spotify:${a.uri.split('spotify:')[1]}` : a.url ?? '';
  if (window.venbandDesktop) {
    void window.venbandDesktop.openExternal(target || 'https://open.spotify.com').catch(() => {});
  } else if (target) {
    window.open(target, '_blank', 'noopener');
  }
}

declare global {
  interface Window {
    venbandDesktop?: {
      isDesktop: boolean;
      setBadge: (n: number) => void;
      flash: () => void;
      info: () => Promise<unknown>;
      onActivity: (cb: (a: unknown) => void) => () => void;
      rpcState: () => Promise<{ up: boolean; index: number | null; spotify: boolean }>;
      setRpcUser: (u: { id: string }) => void;
      openExternal: (url: string) => Promise<unknown>;
    };
  }
}