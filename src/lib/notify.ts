// Unread counts, desktop notifications and call ringtones.
import { createStore } from './store';

// ---------------------------------------------------------------- unread --

export const unreadStore = createStore<{ counts: Record<string, number>; mentions: Record<string, number>; serverOf: Record<string, string> }>({
  counts: {},
  mentions: {},
  serverOf: {},
});

/** Channel currently on screen (set by the chat view). */
let viewing: string | null = null;
let atBottom = false;
export function setViewingBottom(value: boolean) { atBottom = value; }
export function setViewingChannel(id: string | null) {
  viewing = id;
}
export function isViewing(id: string) {
  return atBottom && viewing === id && document.visibilityState === 'visible' && document.hasFocus();
}

export function addUnread(channelId: string, serverId: string | null, mention: boolean) {
  unreadStore.set((s) => ({
    counts: { ...s.counts, [channelId]: (s.counts[channelId] ?? 0) + 1 },
    mentions: mention ? { ...s.mentions, [channelId]: (s.mentions[channelId] ?? 0) + 1 } : s.mentions,
    serverOf: serverId ? { ...s.serverOf, [channelId]: serverId } : s.serverOf,
  }));
  updateTitle();
}

/** Set a channel's unread count (e.g. "mark unread from here"). */
export function setUnread(channelId: string, serverId: string | null, n: number) {
  unreadStore.set((s) => ({
    counts: { ...s.counts, [channelId]: n },
    serverOf: serverId ? { ...s.serverOf, [channelId]: serverId } : s.serverOf,
  }));
  updateTitle();
}

export function markRead(channelId: string) {
  const s = unreadStore.get();
  if (!s.counts[channelId] && !s.mentions[channelId]) return;
  const counts = { ...s.counts };
  const mentions = { ...s.mentions };
  delete counts[channelId];
  delete mentions[channelId];
  unreadStore.set({ counts, mentions });
  updateTitle();
}

function updateTitle() {
  const { counts, mentions, serverOf } = unreadStore.get();
  // DMs and mentions count toward the tab title, like a phone badge.
  const n =
    Object.entries(counts)
      .filter(([id]) => !serverOf[id])
      .reduce((a, [, v]) => a + v, 0) + Object.values(mentions).reduce((a, v) => a + v, 0);
  document.title = n ? `(${n}) Venband` : 'Venband';
  // the desktop app shows the same count on the taskbar / dock
  (window as unknown as { venbandDesktop?: { setBadge: (n: number) => void } }).venbandDesktop?.setBadge(n);
}

// --------------------------------------------------- desktop notifications --

export function notificationsSupported() {
  return typeof Notification !== 'undefined';
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

export async function askForNotifications() {
  if (!notificationsSupported() || Notification.permission !== 'default') return notificationPermission();
  return Notification.requestPermission();
}

/** Show a system notification when Venband isn't the tab you're looking at. */
export function notify(title: string, body: string, onClick?: () => void, tag?: string) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible' && document.hasFocus()) return;
  try {
    const n = new Notification(title, { body, tag, icon: `${import.meta.env.BASE_URL}favicon.svg`, silent: false });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}

// ----------------------------------------------------------------- sounds --


// Sounds live in sfx.ts now (one consistent, original sound set).
export { startRing, stopRing } from './sfx';
import { sfx } from './sfx';
/** Kept for older callers: the plain new-message sound. */
export function playMessageSound() {
  sfx('message');
}

/** Ping counts on badges stop at 9+ (the exact number is in the notification list). */
export const pingCount = (n: number) => (n > 9 ? '9+' : String(n));
