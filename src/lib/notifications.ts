// The notification center: official notices created only by the database
// (supabase/migrations/20261106010000_official_notifications.sql). The app can
// read its own and mark them read — it can't create, edit or delete them.
import { createStore } from './store';
import { supabase } from './supabase';
import { sessionStore } from './session';
import { openSettings } from './ui';
import { go } from './router';

export type NotificationCategory = 'security' | 'moderation' | 'platform' | 'community';
export type NotificationSeverity = 'info' | 'warning' | 'critical';

export interface AppNotification {
  id: string;
  user_id: string;
  category: NotificationCategory;
  kind: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  data: { actions?: string[]; reason?: string | null; device?: string; location?: string | null; [k: string]: unknown };
  created_at: string;
  read_at: string | null;
}

export const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  security: 'Security',
  moderation: 'Account',
  platform: 'Platform',
  community: 'Community',
};

/**
 * What a notification's buttons may do. Only these fixed, in-app destinations —
 * a notification can never carry its own link, so it can't send anyone to a
 * look-alike site.
 */
export const NOTIFICATION_ACTIONS: Record<string, { label: string; run: () => void }> = {
  review_devices: { label: 'Review devices', run: () => openSettings('devices') },
  secure_account: { label: 'Secure my account', run: () => openSettings('security') },
  view_guidelines: { label: 'Community guidelines', run: () => go('guidelines') },
  open_theme_studio: { label: 'Open Theme Studio', run: () => openSettings('appearance') },
  open_appeals: { label: 'Appeals', run: () => openSettings('security') },
};

export const notificationStore = createStore<{ items: AppNotification[]; loaded: boolean; unread: number; available: boolean }>({
  items: [],
  loaded: false,
  unread: 0,
  available: true,
});

const recount = (items: AppNotification[]) => items.filter((n) => !n.read_at).length;
const setItems = (items: AppNotification[]) => notificationStore.set({ items, unread: recount(items), loaded: true });

let channel: ReturnType<typeof supabase.channel> | null = null;
let startedFor: string | null = null;

export async function loadNotifications(limit = 100) {
  const { data, error } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) {
    // database not migrated yet: keep the bell quiet instead of erroring
    if (/schema cache|does not exist/i.test(error.message)) return notificationStore.set({ loaded: true, available: false, items: [], unread: 0 });
    throw error;
  }
  setItems((data ?? []) as AppNotification[]);
}

/** Load and keep up to date while signed in. Safe to call more than once. */
export async function startNotifications() {
  const uid = sessionStore.get().session?.user.id;
  if (!uid || startedFor === uid) return;
  stopNotifications();
  startedFor = uid;
  try {
    await loadNotifications();
  } catch {
    notificationStore.set({ loaded: true });
  }
  if (!notificationStore.get().available || startedFor !== uid) return;
  channel = supabase
    .channel(`notifications:${uid}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` }, (payload) => {
      const n = payload.new as AppNotification;
      const items = [n, ...notificationStore.get().items.filter((x) => x.id !== n.id)].slice(0, 200);
      setItems(items);
    })
    .subscribe();
}

export function stopNotifications() {
  if (channel) void supabase.removeChannel(channel);
  channel = null;
  startedFor = null;
}

/** Mark some (or all) as read. Updates the UI immediately. */
export async function markNotificationsRead(ids?: string[]) {
  const now = new Date().toISOString();
  setItems(notificationStore.get().items.map((n) => (!n.read_at && (!ids || ids.includes(n.id)) ? { ...n, read_at: now } : n)));
  const { error } = await supabase.rpc('mark_notifications_read', { p_ids: ids ?? null });
  if (error) await loadNotifications().catch(() => {});
}

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}
