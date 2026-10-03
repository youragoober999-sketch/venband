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
}>({ settings: null, modQuery: '', profile: null });

export function openSettings(tab: SettingsTab = 'account', modQuery?: string) {
  uiStore.set({ settings: tab, ...(modQuery !== undefined ? { modQuery } : {}) });
}
export function closeSettings() {
  uiStore.set({ settings: null });
}
