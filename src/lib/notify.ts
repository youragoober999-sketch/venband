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

let lastBlip = 0;

/** One soft, low two-note chime for new messages (at most once every 1.5 s). */
export function playMessageSound() {
  const now = Date.now();
  if (now - lastBlip < 1500) return;
  lastBlip = now;
  try {
    pluck(587.33, 0, 0.5, 0.05); // D5
    pluck(440, 0.11, 0.7, 0.045); // A4
  } catch {
    /* audio blocked until the user interacts with the page */
  }
}

/** A soft, warm mallet note: gentle attack, long natural decay, highs rolled off. */
function pluck(freq: number, start: number, length: number, volume: number) {
  const a = audio();
  const t0 = a.currentTime + start;
  const gain = a.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume * soundVolume(), t0 + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
  const lowpass = a.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = Math.min(2400, freq * 3);
  lowpass.Q.value = 0.4;
  gain.connect(lowpass).connect(a.destination);
  // a pure body plus a faint octave keeps it round rather than piercing
  for (const [mult, level] of [[1, 1], [2, 0.12]] as const) {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = 'sine';
    o.frequency.value = freq * mult;
    g.gain.value = level;
    o.connect(g).connect(gain);
    o.start(t0);
    o.stop(t0 + length + 0.05);
  }
}

/** Notification volume 0–1 from settings (localStorage, default 0.8). */
function soundVolume() {
  try {
    const v = Number(localStorage.getItem('venband:notify-volume') ?? '0.8');
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.8;
  } catch {
    return 0.8;
  }
}

let ringTimer: ReturnType<typeof setInterval> | null = null;
let ringKind: 'incoming' | 'outgoing' | null = null;

// Notes in Hz: a bright rising phrase for incoming calls, a calm pair for ring-back.
// Lower, calmer phrases than before.
const INCOMING = [392, 493.88, 587.33, 493.88]; // G4 B4 D5 B4
const OUTGOING = [349.23, 440]; // F4 A4

/** Loop a ringtone: 'incoming' for the person being called, 'outgoing' ring-back for the caller. */
export function startRing(kind: 'incoming' | 'outgoing') {
  if (ringKind === kind) return;
  stopRing();
  ringKind = kind;
  document.documentElement.dataset.ringing = kind; // lets tests (and devtools) see what's ringing
  const play = () => {
    try {
      if (kind === 'incoming') {
        INCOMING.forEach((f, i) => pluck(f, i * 0.18, 0.9, 0.08));
      } else {
        OUTGOING.forEach((f, i) => pluck(f, i * 0.32, 1.2, 0.05));
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
