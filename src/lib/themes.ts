// Theme engine. A theme is a set of CSS color variables (+ optional wallpaper
// gradient / glass effect). Themes are pure data — no CSS or scripts — so
// marketplace themes from other people can't run code or load remote files.
import { createStore } from './store';

export type ThemeVars = Record<string, string>;

export interface Theme {
  id: string;
  name: string;
  description: string;
  vars: ThemeVars;
  /** frosted-glass panels over a wallpaper */
  glass?: boolean;
  /** CSS gradient used behind glass themes (only gradients/colors allowed) */
  wallpaper?: string;
  author?: string;
}

/** Variables a theme may set. Anything else is ignored. */
export const THEME_KEYS = [
  'bg-0', 'bg-1', 'bg-2', 'bg-3', 'bg-4', 'bg-hover',
  'line', 'line-2', 'text', 'text-2', 'muted',
  'accent', 'accent-hover', 'accent-soft', 'accent-text', 'on-accent',
  'link', 'success', 'danger', 'warning', 'mention-bg',
] as const;

const BASE: ThemeVars = {
  'bg-0': '#000000',
  'bg-1': '#0a0a0b',
  'bg-2': '#111113',
  'bg-3': '#1a1a1d',
  'bg-4': '#242428',
  'bg-hover': '#18181b',
  line: '#ffffff0f',
  'line-2': '#ffffff1c',
  text: '#f5f5f7',
  'text-2': '#b4b4bb',
  muted: '#77777f',
  accent: '#f5f5f7',
  'accent-hover': '#ffffff',
  'accent-soft': '#ffffff14',
  'accent-text': '#ffffff',
  'on-accent': '#000000',
  link: '#9ecbff',
  success: '#34c759',
  danger: '#ff453a',
  warning: '#ffd60a',
  'mention-bg': '#ffffff12',
};

export const BUILT_IN_THEMES: Theme[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'Deep black, soft grays and crisp white.',
    vars: BASE,
  },
  {
    id: 'amoled',
    name: 'AMOLED',
    description: 'True black everywhere. Easiest on OLED screens and batteries.',
    vars: {
      ...BASE,
      'bg-0': '#000000',
      'bg-1': '#000000',
      'bg-2': '#000000',
      'bg-3': '#0e0e10',
      'bg-4': '#1a1a1d',
      'bg-hover': '#0c0c0e',
      line: '#ffffff14',
      'line-2': '#ffffff24',
    },
  },
  {
    id: 'translucent',
    name: 'Translucent',
    description: 'Frosted glass panels over a slow aurora.',
    glass: true,
    wallpaper:
      'radial-gradient(1200px 800px at 15% 10%, #3b3f58 0%, transparent 60%), radial-gradient(900px 700px at 85% 90%, #2a3d44 0%, transparent 60%), linear-gradient(160deg, #07070a, #0d0e14)',
    vars: {
      ...BASE,
      'bg-0': '#00000066',
      'bg-1': '#14141a73',
      'bg-2': '#1a1a2059',
      'bg-3': '#ffffff12',
      'bg-4': '#ffffff1f',
      'bg-hover': '#ffffff0d',
      line: '#ffffff17',
      'line-2': '#ffffff26',
    },
  },
  {
    id: 'graphite',
    name: 'Graphite',
    description: 'Softer charcoal grays for long sessions.',
    vars: {
      ...BASE,
      'bg-0': '#141416',
      'bg-1': '#1b1b1e',
      'bg-2': '#212124',
      'bg-3': '#2a2a2e',
      'bg-4': '#343439',
      'bg-hover': '#26262a',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Near-black navy with an ice-blue accent.',
    vars: {
      ...BASE,
      'bg-0': '#03050b',
      'bg-1': '#070b14',
      'bg-2': '#0b111d',
      'bg-3': '#121a29',
      'bg-4': '#1b2537',
      'bg-hover': '#101828',
      accent: '#8ab4ff',
      'accent-hover': '#a6c5ff',
      'accent-soft': '#8ab4ff1f',
      'accent-text': '#a6c5ff',
      'on-accent': '#04101f',
    },
  },
  {
    id: 'mint',
    name: 'Mint',
    description: 'The classic Venband mint on deep ink.',
    vars: {
      ...BASE,
      'bg-0': '#0d0f11',
      'bg-1': '#14171a',
      'bg-2': '#191c20',
      'bg-3': '#212529',
      'bg-4': '#2a2f34',
      'bg-hover': '#22262b',
      accent: '#34d8a8',
      'accent-hover': '#5fe4bd',
      'accent-soft': '#34d8a81c',
      'accent-text': '#6fe6c3',
      'on-accent': '#06221a',
    },
  },
  {
    id: 'daylight',
    name: 'Daylight',
    description: 'A clean light theme.',
    vars: {
      ...BASE,
      'bg-0': '#e9e9ee',
      'bg-1': '#f2f2f5',
      'bg-2': '#ffffff',
      'bg-3': '#ececf0',
      'bg-4': '#e0e0e6',
      'bg-hover': '#ebebef',
      line: '#0000000f',
      'line-2': '#0000001c',
      text: '#111114',
      'text-2': '#45454d',
      muted: '#7a7a83',
      accent: '#111114',
      'accent-hover': '#000000',
      'accent-soft': '#0000000d',
      'accent-text': '#111114',
      'on-accent': '#ffffff',
      link: '#0a66d8',
      'mention-bg': '#0000000d',
    },
  },
];

const COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/;
const GRADIENT = /^((radial|linear|conic)-gradient\([#\w\s.,%()-]+\)\s*,?\s*)+$/;

/** Keep only known variables with plain color values (safe for shared themes). */
export function sanitizeTheme(input: Partial<Theme>): Theme | null {
  if (!input || typeof input !== 'object') return null;
  const vars: ThemeVars = {};
  for (const k of THEME_KEYS) {
    const v = input.vars?.[k];
    if (typeof v === 'string' && COLOR.test(v.trim())) vars[k] = v.trim();
  }
  if (Object.keys(vars).length < 4) return null;
  const wallpaper = typeof input.wallpaper === 'string' && GRADIENT.test(input.wallpaper.trim()) ? input.wallpaper.trim() : undefined;
  return {
    id: String(input.id ?? `custom-${Date.now()}`).slice(0, 64),
    name: String(input.name ?? 'Custom theme').slice(0, 40),
    description: String(input.description ?? '').slice(0, 140),
    vars: { ...BASE, ...vars },
    glass: Boolean(input.glass),
    wallpaper,
    author: input.author ? String(input.author).slice(0, 40) : undefined,
  };
}

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
