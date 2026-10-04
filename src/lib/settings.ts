// Personal settings. Cached in localStorage for instant start-up and synced to
// the user_settings table (only readable by the owner), so they survive
// updates, new devices and cleared browsers.
import { supabase } from './supabase';
import { createStore } from './store';
import { applyTheme, BUILT_IN_THEMES, sanitizeTheme, themeStore, type Theme } from './themes';

export interface GifFavorite {
  id: string;
  url: string;
  preview: string;
  width: number;
  height: number;
}

export type CodeTheme = 'vscode-dark' | 'vs-2026' | 'github-dark' | 'monokai' | 'one-dark' | 'vscode-light';

export interface Settings {
  themeId: string;
  installedThemes: Theme[];
  translateMode: 'auto' | 'manual' | 'off';
  language: string;
  voice: {
    inputId: string;
    outputId: string;
    cameraId: string;
    noiseSuppression: boolean;
    echoCancellation: boolean;
    autoGain: boolean;
    inputVolume: number; // percent
    streamRes: 720 | 1080 | 1440;
    streamFps: 15 | 30 | 60;
  };
  chat: {
    autoEmbeds: boolean;
    gifAutoplay: boolean;
    showJoins: boolean;
    reduceMotion: boolean;
    /** spelling: off, underline + right-click suggestions, or fix automatically */
    autocorrect: 'off' | 'suggest' | 'auto';
    /** colours for code blocks */
    codeTheme: CodeTheme;
    /** messages over 2000 characters are sent as a .txt file */
    longTextAsFile: boolean;
    /** keep unsent text per conversation on this device */
    saveDrafts: boolean;
    clock24: boolean;
    /** images / videos / GIFs / link embeds: load automatically or on click */
    mediaAutoload: 'always' | 'wifi' | 'click';
    /** attach previews (site name, title, description) to links you send */
    linkPreviews: boolean;
  };
  /** how often each emoji was used (for autocomplete ranking) */
  emojiUsage: Record<string, number>;
  /** most recent reactions first */
  recentReactions: string[];
  /** DM list organisation */
  dms: { pinned: string[]; archived: string[]; folders: { id: string; name: string; channels: string[] }[]; mutedUntil: Record<string, number> };
  gifFavorites: GifFavorite[];
  layout: { sidebar: number; members: number; callHeight: number };
  /** per-user stream / voice volume, percent (0-200) */
  volumes: Record<string, number>;
}

export const DEFAULT_SETTINGS: Settings = {
  themeId: 'default',
  installedThemes: [],
  translateMode: 'manual',
  language: '',
  voice: {
    inputId: '',
    outputId: '',
    cameraId: '',
    noiseSuppression: true,
    echoCancellation: true,
    autoGain: true,
    inputVolume: 100,
    streamRes: 1080,
    streamFps: 30,
  },
  chat: {
    autoEmbeds: false,
    gifAutoplay: true,
    showJoins: true,
    reduceMotion: false,
    autocorrect: 'suggest',
    codeTheme: 'vscode-dark',
    longTextAsFile: true,
    saveDrafts: true,
    clock24: false,
    mediaAutoload: 'always',
    linkPreviews: true,
  },
  emojiUsage: {},
  recentReactions: [],
  dms: { pinned: [], archived: [], folders: [], mutedUntil: {} },
  gifFavorites: [],
  layout: { sidebar: 248, members: 248, callHeight: 320 },
  volumes: {},
};

export const settingsStore = createStore<{ s: Settings; userId: string | null }>({ s: DEFAULT_SETTINGS, userId: null });

export function useSettings<T>(pick: (s: Settings) => T): T {
  return settingsStore.use((x) => pick(x.s));
}
export function getSettings(): Settings {
  return settingsStore.get().s;
}

function merge(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  const installed = Array.isArray(r.installedThemes)
    ? (r.installedThemes.map((t) => sanitizeTheme(t)).filter(Boolean) as Theme[]).slice(0, 50)
    : [];
  return {
    ...DEFAULT_SETTINGS,
    ...r,
    installedThemes: installed,
    voice: { ...DEFAULT_SETTINGS.voice, ...(r.voice ?? {}) },
    chat: { ...DEFAULT_SETTINGS.chat, ...(r.chat ?? {}) },
    layout: { ...DEFAULT_SETTINGS.layout, ...(r.layout ?? {}) },
    gifFavorites: Array.isArray(r.gifFavorites) ? r.gifFavorites.slice(0, 200) : [],
    volumes: r.volumes && typeof r.volumes === 'object' ? r.volumes : {},
    emojiUsage: r.emojiUsage && typeof r.emojiUsage === 'object' ? trimUsage(r.emojiUsage) : {},
    recentReactions: Array.isArray(r.recentReactions) ? r.recentReactions.filter((x) => typeof x === 'string').slice(0, 8) : [],
    dms: {
      pinned: Array.isArray(r.dms?.pinned) ? r.dms!.pinned.slice(0, 100) : [],
      archived: Array.isArray(r.dms?.archived) ? r.dms!.archived.slice(0, 1000) : [],
      folders: Array.isArray(r.dms?.folders) ? r.dms!.folders.slice(0, 30) : [],
      mutedUntil: r.dms?.mutedUntil && typeof r.dms.mutedUntil === 'object' ? r.dms.mutedUntil : {},
    },
  };
}

function trimUsage(u: Record<string, number>): Record<string, number> {
  const top = Object.entries(u)
    .filter(([, n]) => typeof n === 'number' && n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 150);
  return Object.fromEntries(top);
}

const localKey = (userId: string) => `venband:settings:${userId}`;

function applySideEffects(s: Settings) {
  themeStore.set({ installed: s.installedThemes });
  const theme = [...BUILT_IN_THEMES, ...s.installedThemes].find((t) => t.id === s.themeId) ?? BUILT_IN_THEMES[0];
  if (themeStore.get().active.id !== theme.id || themeStore.get().active !== theme) applyTheme(theme);
  document.documentElement.dataset.reduceMotion = s.chat.reduceMotion ? 'true' : 'false';
  document.documentElement.dataset.codeTheme = s.chat.codeTheme;
}

/** Load settings for the signed-in user (local cache first, then the server copy). */
export async function loadSettings(userId: string) {
  let local: Settings | null = null;
  try {
    const raw = localStorage.getItem(localKey(userId));
    if (raw) local = merge(JSON.parse(raw));
  } catch {
    /* ignore */
  }
  settingsStore.set({ s: local ?? DEFAULT_SETTINGS, userId });
  applySideEffects(getSettings());
  const { data, error } = await supabase.from('user_settings').select('data').eq('user_id', userId).maybeSingle();
  if (error) return; // older database: keep local settings only
  if (data?.data && Object.keys(data.data).length) {
    const server = merge(data.data);
    settingsStore.set({ s: server });
    applySideEffects(server);
    saveLocal();
  } else if (local) {
    scheduleSave();
  }
}

function saveLocal() {
  const { s, userId } = settingsStore.get();
  if (!userId) return;
  try {
    localStorage.setItem(localKey(userId), JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const { s, userId } = settingsStore.get();
    if (!userId) return;
    await supabase.from('user_settings').upsert({ user_id: userId, data: s, updated_at: new Date().toISOString() });
  }, 800);
}

export function updateSettings(patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)) {
  const cur = getSettings();
  const p = typeof patch === 'function' ? patch(cur) : patch;
  const next = merge({ ...cur, ...p });
  settingsStore.set({ s: next });
  applySideEffects(next);
  saveLocal();
  scheduleSave();
}

export function updateVoice(patch: Partial<Settings['voice']>) {
  updateSettings((s) => ({ voice: { ...s.voice, ...patch } }));
}
export function updateChat(patch: Partial<Settings['chat']>) {
  updateSettings((s) => ({ chat: { ...s.chat, ...patch } }));
}
export function updateLayout(patch: Partial<Settings['layout']>) {
  updateSettings((s) => ({ layout: { ...s.layout, ...patch } }));
}

export function resetSettingsStore() {
  settingsStore.set({ s: DEFAULT_SETTINGS, userId: null });
}

/** Remember that an emoji was used (autocomplete puts your favourites first). */
export function noteEmojiUse(emoji: string, asReaction = false) {
  updateSettings((s) => ({
    emojiUsage: { ...s.emojiUsage, [emoji]: (s.emojiUsage[emoji] ?? 0) + 1 },
    ...(asReaction ? { recentReactions: [emoji, ...s.recentReactions.filter((e) => e !== emoji)].slice(0, 8) } : {}),
  }));
}
