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
  | 'badges';

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
  homeTab: 'friends' | 'requests' | 'donate' | 'saved';
}>({ settings: null, modQuery: '', profile: null, drawer: null, switcher: false, jump: null, search: null, homeTab: 'friends' });

export function openSearch(q = '', serverId: string | null = null) {
  uiStore.set({ search: { q, serverId }, switcher: false });
}

// narrow layouts show the member list as a slide-in panel
export const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1000px)').matches;
export function setDrawer(d: 'nav' | 'members' | null) {
  uiStore.set({ drawer: d });
}

export function openSettings(tab: SettingsTab = 'account', modQuery?: string) {
  uiStore.set({ settings: tab, ...(modQuery !== undefined ? { modQuery } : {}) });
}
export function closeSettings() {
  uiStore.set({ settings: null });
}
