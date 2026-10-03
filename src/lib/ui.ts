// App-level UI state that many components open/close.
import { createStore } from './store';

export type SettingsTab =
  | 'account'
  | 'profile'
  | 'privacy'
  | 'devices'
  | 'appearance'
  | 'voice'
  | 'chat'
  | 'language'
  | 'notifications'
  | 'moderation';

export const uiStore = createStore<{
  settings: SettingsTab | null;
  modQuery: string;
  profile: { userId: string; serverId?: string } | null;
  /** phone layout: which slide-in panel is open */
  drawer: 'nav' | 'members' | null;
  switcher: boolean;
}>({ settings: null, modQuery: '', profile: null, drawer: null, switcher: false });

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
