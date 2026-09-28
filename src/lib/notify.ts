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
export function setViewingChannel(id: string | null) {
  viewing = id;
  if (id) markRead(id);
}
export function isViewing(id: string) {
  return viewing === id && document.visibilityState === 'visible';
}

export function addUnread(channelId: string, serverId: string | null, mention: boolean) {
  unreadStore.set((s) => ({
    counts: { ...s.counts, [channelId]: (s.counts[channelId] ?? 0) + 1 },
    mentions: mention ? { ...s.mentions, [channelId]: (s.mentions[channelId] ?? 0) + 1 } : s.mentions,
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

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && viewing) markRead(viewing);
});

function updateTitle() {
  const { counts, mentions, serverOf } = unreadStore.get();
  // DMs and mentions count toward the tab title, like a phone badge.
  const n =
    Object.entries(counts)
      .filter(([id]) => !serverOf[id])
      .reduce((a, [, v]) => a + v, 0) + Object.values(mentions).reduce((a, v) => a + v, 0);
  document.title = n ? `(${n}) Venband` : 'Venband';
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

let ctx: AudioContext | null = null;
function audio() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freqs: number[], start: number, length: number, volume = 0.12) {
  const a = audio();
  const gain = a.createGain();
  gain.gain.setValueAtTime(0, a.currentTime + start);
  gain.gain.linearRampToValueAtTime(volume, a.currentTime + start + 0.03);
  gain.gain.setValueAtTime(volume, a.currentTime + start + length - 0.05);
  gain.gain.linearRampToValueAtTime(0, a.currentTime + start + length);
  gain.connect(a.destination);
  for (const f of freqs) {
    const o = a.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    o.connect(gain);
    o.start(a.currentTime + start);
    o.stop(a.currentTime + start + length + 0.02);
  }
}

/** Short two-note blip for new messages. */
export function playMessageSound() {
  try {
    tone([880], 0, 0.09, 0.06);
    tone([1175], 0.1, 0.12, 0.06);
  } catch {
    /* audio blocked until the user interacts with the page */
  }
}

let ringTimer: ReturnType<typeof setInterval> | null = null;
let ringKind: 'incoming' | 'outgoing' | null = null;

/** Loop a ringtone: 'incoming' for the person being called, 'outgoing' ring-back for the caller. */
export function startRing(kind: 'incoming' | 'outgoing') {
  if (ringKind === kind) return;
  stopRing();
  ringKind = kind;
  const play = () => {
    try {
      if (kind === 'incoming') {
        tone([660, 880], 0, 0.35);
        tone([660, 880], 0.45, 0.35);
      } else {
        tone([440, 480], 0, 1.2, 0.07);
      }
    } catch {
      /* ignore */
    }
  };
  play();
  ringTimer = setInterval(play, kind === 'incoming' ? 2000 : 3500);
}

export function stopRing(kind?: 'incoming' | 'outgoing') {
  if (kind && ringKind !== kind) return;
  if (ringTimer) clearInterval(ringTimer);
  ringTimer = null;
  ringKind = null;
}
