// App-level UI state that many components open/close.
import { createStore } from './store';

export type SettingsTab =
  | 'account'
  | 'profile'
  | 'privacy'
  | 'security'
  | 'devices'
  | 'appearance'
  | 'voice'
  | 'chat'
  | 'language'
  | 'notifications'
  | 'moderation'
  | 'discovery-queue'
  | 'reports'
  | 'badges'
  | 'my-apps'
  | 'connections';

export const uiStore = createStore<{
  settings: SettingsTab | null;
  modQuery: string;
  profile: { userId: string; serverId?: string } | null;
  /** phone layout: which slide-in panel is open */
  drawer: 'nav' | 'members' | null;
  switcher: boolean;
  /** message to scroll to (from a message link) */
  jump: string | null;
  /** open search panel */
  search: { q: string; serverId: string | null } | null;
  /** which page Home shows when no conversation is open */
  homeTab: 'friends' | 'requests' | 'donate' | 'saved' | 'market';
}>({ settings: null, modQuery: '', profile: null, drawer: null, switcher: false, jump: null, search: null, homeTab: 'friends' });

export function openSearch(q = '', serverId: string | null = null) {
  uiStore.set({ search: { q, serverId }, switcher: false });
}

// narrow layouts show the member list as a slide-in panel
export const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1000px)').matches;

/** True inside the Android app (Capacitor WebView). */
export function isAndroid(): boolean {
  return typeof window !== 'undefined' && 'Capacitor' in window && (window as { Capacitor?: { getPlatform: () => string } }).Capacitor?.getPlatform() === 'android';
}

/**
 * True in the Venband apps (Windows/macOS/Linux, Android, iOS) and when the
 * site is installed as an app. They open straight into Venband, never the
 * marketing page.
 */
export function isAppShell(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as { venbandDesktop?: { isDesktop?: boolean }; Capacitor?: { isNativePlatform?: () => boolean } };
  if (w.venbandDesktop?.isDesktop) return true;
  if (w.Capacitor?.isNativePlatform?.()) return true;
  try {
    return window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: window-controls-overlay)').matches;
  } catch {
    return false;
  }
}

let platformInit = false;
/** Tag the document so CSS can give the Android skin slightly denser spacing. */
export function initPlatform() {
  if (platformInit) return;
  platformInit = true;
  if (isAndroid()) document.documentElement.dataset.platform = 'android';
  else if (typeof window !== 'undefined' && 'Capacitor' in window) document.documentElement.dataset.platform = 'ios';
}
export function setDrawer(d: 'nav' | 'members' | null) {
  uiStore.set({ drawer: d });
}

export function openSettings(tab: SettingsTab = 'account', modQuery?: string) {
  uiStore.set({ settings: tab, ...(modQuery !== undefined ? { modQuery } : {}) });
}
export function closeSettings() {
  uiStore.set({ settings: null });
}
