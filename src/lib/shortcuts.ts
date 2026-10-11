// Keyboard shortcuts. One list drives both the keys and Settings → Keybinds.
import { openSettings, uiStore } from './ui';
import { getActiveCall } from './call';
import { getSettings, updateSettings } from './settings';

export interface Shortcut {
  keys: string;
  action: string;
  group: 'Navigation' | 'Messages' | 'Calls' | 'App';
}

export const SHORTCUTS: Shortcut[] = [
  { keys: 'Ctrl + K', action: 'Jump to a server, channel or person', group: 'Navigation' },
  { keys: 'Alt + ↑ / ↓', action: 'Previous / next channel', group: 'Navigation' },
  { keys: 'Alt + Shift + ↑ / ↓', action: 'Previous / next unread channel', group: 'Navigation' },
  { keys: 'Ctrl + Alt + ↑ / ↓', action: 'Previous / next server', group: 'Navigation' },
  { keys: 'Alt + ← / →', action: 'Back / forward', group: 'Navigation' },
  { keys: 'Ctrl + Shift + H', action: 'Go to Home (friends and DMs)', group: 'Navigation' },
  { keys: 'Ctrl + F', action: 'Search messages', group: 'Navigation' },
  { keys: 'Just start typing', action: 'Write in the message box', group: 'Messages' },
  { keys: 'Esc', action: 'Mark this channel as read', group: 'Messages' },
  { keys: 'Ctrl + B / I / U', action: 'Bold / italic / underline the selected text', group: 'Messages' },
  { keys: 'Ctrl + Shift + S', action: 'Strike through the selected text', group: 'Messages' },
  { keys: 'Ctrl + Shift + H', action: 'Highlight the selected text (in the message box)', group: 'Messages' },
  { keys: 'Ctrl + E', action: 'Wrap the selected text as code', group: 'Messages' },
  { keys: 'Shift + Enter', action: 'New line', group: 'Messages' },
  { keys: '↑ (empty message box)', action: 'Edit your last message', group: 'Messages' },
  { keys: 'Ctrl + Shift + M', action: 'Mute / unmute your microphone', group: 'Calls' },
  { keys: 'Ctrl + Shift + D', action: 'Deafen / undeafen', group: 'Calls' },
  { keys: 'Ctrl + I', action: 'Open Settings', group: 'App' },
  { keys: 'Ctrl + ,', action: 'Open Settings', group: 'App' },
  { keys: 'Ctrl + /', action: 'Show keyboard shortcuts', group: 'App' },
  { keys: 'Ctrl + Shift + T', action: 'Switch between your dark and light theme', group: 'App' },
  { keys: 'Ctrl + Shift + Alt + S', action: 'Safe mode (turns custom CSS off)', group: 'App' },
];

/** Inside a text field, single keys and arrows belong to the field. */
function typing(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return Boolean(el?.closest('input, textarea, select, [contenteditable]'));
}

function step<T extends Element>(items: T[], current: number, dir: 1 | -1): T | undefined {
  if (!items.length) return undefined;
  const i = current < 0 ? (dir === 1 ? 0 : items.length - 1) : (current + dir + items.length) % items.length;
  return items[i];
}

/** Next / previous channel in the open sidebar (unread only when asked). */
function moveChannel(dir: 1 | -1, unreadOnly: boolean) {
  const all = [...document.querySelectorAll<HTMLElement>('.sidebar .channel:not(.voice-member)')];
  const current = all.findIndex((c) => c.classList.contains('active'));
  if (unreadOnly) {
    const order = dir === 1 ? [...all.slice(current + 1), ...all.slice(0, current)] : [...all.slice(0, current).reverse(), ...all.slice(current + 1).reverse()];
    order.find((c) => c.classList.contains('unread') || c.querySelector('.badge, .unread-dot'))?.click();
    return;
  }
  step(all, current, dir)?.click();
}

function moveServer(dir: 1 | -1) {
  const all = [...document.querySelectorAll<HTMLElement>('.rail .rail-item:not(.add):not(.discover)')];
  step(all, all.findIndex((r) => r.classList.contains('active')), dir)?.click();
}

/** Handle a key press anywhere in the app. Returns true when it was a shortcut. */
export function handleShortcut(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.isComposing) return false;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  const done = () => {
    e.preventDefault();
    return true;
  };

  // settings: Ctrl+I (italic wins when text is selected in the message box,
  // which handles it first) and Ctrl+,
  if (mod && !e.shiftKey && !e.altKey && (k === 'i' || k === ',')) {
    openSettings('account');
    return done();
  }
  if (mod && !e.shiftKey && k === '/') {
    openSettings('keybinds');
    return done();
  }
  if (mod && e.shiftKey && !e.altKey && k === 'm') {
    getActiveCall()?.toggleMute();
    return done();
  }
  if (mod && e.shiftKey && !e.altKey && k === 'd') {
    getActiveCall()?.toggleDeafen();
    return done();
  }
  if (mod && e.shiftKey && !e.altKey && k === 't') {
    const s = getSettings();
    const light = s.themeId === 'daylight';
    updateSettings({ themeId: light ? s.lastDarkTheme || 'default' : 'daylight', ...(light ? {} : { lastDarkTheme: s.themeId }) });
    return done();
  }
  if (mod && e.shiftKey && !e.altKey && k === 'h' && !typing(e)) {
    (document.querySelector<HTMLElement>('.rail-item.home'))?.click();
    return done();
  }
  if (mod && !e.shiftKey && !e.altKey && k === 'f' && document.querySelector('.chat-header')) {
    const box = document.querySelector<HTMLInputElement>('.topbar-search input, .chat-search input');
    if (box) {
      box.focus();
      return done();
    }
    uiStore.set({ search: { q: '', serverId: null } });
    return done();
  }
  if (e.altKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    moveChannel(e.key === 'ArrowDown' ? 1 : -1, e.shiftKey);
    return done();
  }
  if (e.altKey && mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    moveServer(e.key === 'ArrowDown' ? 1 : -1);
    return done();
  }
  if (e.altKey && !mod && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !typing(e)) {
    if (e.key === 'ArrowLeft') history.back();
    else history.forward();
    return done();
  }
  return false;
}
