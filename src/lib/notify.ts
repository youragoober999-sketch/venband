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

/** Short two-note blip for new messages. */
export function playMessageSound() {
  try {
    pluck(1046.5, 0, 0.35, 0.07);
    pluck(1568, 0.09, 0.45, 0.06);
  } catch {
    /* audio blocked until the user interacts with the page */
  }
}

/** A soft mallet-like note: quick attack, natural decay. */
function pluck(freq: number, start: number, length: number, volume: number) {
  const a = audio();
  const t0 = a.currentTime + start;
  const gain = a.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
  gain.connect(a.destination);
  // body + a quiet octave overtone gives a marimba-ish colour
  for (const [mult, type, level] of [[1, 'triangle', 1], [2, 'sine', 0.25]] as const) {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.value = freq * mult;
    g.gain.value = level;
    o.connect(g).connect(gain);
    o.start(t0);
    o.stop(t0 + length + 0.05);
  }
}

let ringTimer: ReturnType<typeof setInterval> | null = null;
let ringKind: 'incoming' | 'outgoing' | null = null;

// Notes in Hz: a bright rising phrase for incoming calls, a calm pair for ring-back.
const INCOMING = [659.25, 783.99, 987.77, 1174.66, 987.77, 1318.51]; // E5 G5 B5 D6 B5 E6
const OUTGOING = [523.25, 659.25]; // C5 E5

/** Loop a ringtone: 'incoming' for the person being called, 'outgoing' ring-back for the caller. */
export function startRing(kind: 'incoming' | 'outgoing') {
  if (ringKind === kind) return;
  stopRing();
  ringKind = kind;
  document.documentElement.dataset.ringing = kind; // lets tests (and devtools) see what's ringing
  const play = () => {
    try {
      if (kind === 'incoming') {
        INCOMING.forEach((f, i) => pluck(f, i * 0.13, 0.7, 0.16));
      } else {
        OUTGOING.forEach((f, i) => pluck(f, i * 0.28, 1.1, 0.07));
      }
    } catch {
      /* audio blocked until the user interacts with the page */
    }
  };
  play();
  ringTimer = setInterval(play, kind === 'incoming' ? 2200 : 3000);
}

export function stopRing(kind?: 'incoming' | 'outgoing') {
  if (kind && ringKind !== kind) return;
  if (ringTimer) clearInterval(ringTimer);
  ringTimer = null;
  ringKind = null;
  document.documentElement.dataset.ringing = '';
}
