// Screen-time limiter: tracks daily usage and warns when limit exceeded.
import { getSettings } from './settings';

const KEY = 'venband_screentime';
interface State { date: string; minutes: number; started: number }

function today() { return new Date().toISOString().slice(0, 10); }

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { date: today(), minutes: 0, started: Date.now() };
    const s = JSON.parse(raw) as State;
    if (s.date !== today()) return { date: today(), minutes: 0, started: Date.now() };
    return s;
  } catch { return { date: today(), minutes: 0, started: Date.now() }; }
}

function save(s: State) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }

let timer: ReturnType<typeof setInterval> | null = null;

export function startScreenTime() {
  if (timer) return;
  timer = setInterval(() => {
    const s = load();
    s.minutes = (Date.now() - s.started) / 60000 + (s.minutes || 0);
    // approximate: track elapsed since last save
    save({ date: s.date, minutes: (Date.now() - new Date(s.date + 'T00:00:00').getTime()) / 60000 > 0 ? Math.min(s.minutes, 24 * 60) : s.minutes, started: Date.now() });
  }, 60000);
}

export function stopScreenTime() { if (timer) { clearInterval(timer); timer = null; } }

export function screenTimeMinutes(): number {
  const s = load();
  return Math.round(s.minutes + (Date.now() - s.started) / 60000);
}

export function screenTimeLimitReached(): boolean {
  const s = getSettings();
  const limit = (s as any).screenTime?.dailyMinutes ?? 0;
  if (!limit) return false;
  return screenTimeMinutes() >= limit;
}