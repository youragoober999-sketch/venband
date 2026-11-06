// Theme engine: applies themes to the page. The data, built-in themes and the
// sanitizer live in ./themeData (pure, unit-tested); re-exported here.
import { createStore } from './store';
import { BASE, BUILT_IN_THEMES, sanitizeTheme, THEME_KEYS, type Theme } from './themeData';

export { BUILT_IN_THEMES, sanitizeTheme, THEME_KEYS } from './themeData';
export type { Theme, ThemeVars } from './themeData';

const STORAGE_KEY = 'venband:theme';

export const themeStore = createStore<{ active: Theme; installed: Theme[] }>({
  active: BUILT_IN_THEMES[0],
  installed: [],
});

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  for (const k of THEME_KEYS) root.style.setProperty(`--${k}`, theme.vars[k] ?? BASE[k]);
  root.dataset.glass = theme.glass ? 'true' : 'false';
  root.style.setProperty('--wallpaper', theme.wallpaper ?? 'none');
  const light = theme.vars['bg-2'] && /^#(f|e|d)/i.test(theme.vars['bg-2']);
  root.style.colorScheme = light ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.vars['bg-0'].slice(0, 7));
  themeStore.set({ active: theme });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
  } catch {
    /* ignore */
  }
}

export function allThemes(): Theme[] {
  return [...BUILT_IN_THEMES, ...themeStore.get().installed];
}

/** Restore the last theme instantly on page load (before any network). */
export function restoreTheme() {
  try {
    const saved = sanitizeTheme(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
    const builtin = BUILT_IN_THEMES.find((t) => t.id === saved?.id);
    applyTheme(builtin ?? saved ?? BUILT_IN_THEMES[0]);
  } catch {
    applyTheme(BUILT_IN_THEMES[0]);
  }
}
