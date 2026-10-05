// Personal preferences: appearance, accessibility, editor and enabled editor
// extensions. Saved in the browser right away and synced to the account.
import { setLanguage, detectLanguage } from './i18n'

export type Theme = 'system' | 'dark' | 'light' | 'midnight' | 'dracula' | 'nord' | 'solarized' | 'hc-dark' | 'hc-light'

export type Settings = {
  theme: Theme
  accent: string
  language: string
  fontScale: number
  font: 'inter' | 'atkinson' | 'dyslexic' | 'system'
  lineHeight: number
  letterSpacing: number
  reduceMotion: 'system' | 'on' | 'off'
  underlineLinks: boolean
  boldFocus: boolean
  largeTargets: boolean
  colorVision: 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia'
  srVerbose: boolean
  sounds: boolean
  editorFontSize: number
  editorFont: 'jetbrains' | 'system-mono' | 'dyslexic'
  tabSize: number
  lineNumbers: boolean
  cursorBlink: boolean
  autosaveDelay: number
  extensions: Record<string, boolean>
  updatedAt: number
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  accent: '#8b5cf6',
  language: 'en',
  fontScale: 1,
  font: 'inter',
  lineHeight: 1.5,
  letterSpacing: 0,
  reduceMotion: 'system',
  underlineLinks: false,
  boldFocus: false,
  largeTargets: false,
  colorVision: 'none',
  srVerbose: false,
  sounds: false,
  editorFontSize: 14,
  editorFont: 'jetbrains',
  tabSize: 2,
  lineNumbers: true,
  cursorBlink: true,
  autosaveDelay: 1200,
  extensions: { wrap: true, autosave: true, 'live-preview': true, snippets: true },
  updatedAt: 0,
}

export const THEMES: { id: Theme; name: string; dark: boolean }[] = [
  { id: 'system', name: 'Match my device', dark: true },
  { id: 'dark', name: 'Vix Dark', dark: true },
  { id: 'light', name: 'Vix Light', dark: false },
  { id: 'midnight', name: 'Midnight Blue', dark: true },
  { id: 'dracula', name: 'Dracula', dark: true },
  { id: 'nord', name: 'Nord', dark: true },
  { id: 'solarized', name: 'Solarized Light', dark: false },
  { id: 'hc-dark', name: 'High contrast dark', dark: true },
  { id: 'hc-light', name: 'High contrast light', dark: false },
]

export const ACCENTS = ['#8b5cf6', '#06b6d4', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#3b82f6', '#14b8a6']

const KEY = 'vix:settings'

export function loadLocalSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    const s = { ...DEFAULT_SETTINGS, ...raw, extensions: { ...DEFAULT_SETTINGS.extensions, ...(raw.extensions || {}) } }
    if (!raw.language) s.language = detectLanguage()
    return s
  } catch {
    return { ...DEFAULT_SETTINGS, language: detectLanguage() }
  }
}

export function saveLocalSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* storage blocked */
  }
}

/** Picks whichever copy (this browser or the account) was changed most recently. */
export function mergeSettings(remote: unknown): { settings: Settings; localNewer: boolean } {
  const r = remote && typeof remote === 'object' ? (remote as Partial<Settings>) : {}
  const local = loadLocalSettings()
  if ((local.updatedAt || 0) > (r.updatedAt || 0)) return { settings: local, localNewer: true }
  return { settings: { ...DEFAULT_SETTINGS, ...r, extensions: { ...DEFAULT_SETTINGS.extensions, ...(r.extensions || {}) } }, localNewer: false }
}

export function resolvedTheme(theme: Theme): Exclude<Theme, 'system'> {
  if (theme !== 'system') return theme
  if (matchMedia('(prefers-contrast: more)').matches) return matchMedia('(prefers-color-scheme: light)').matches ? 'hc-light' : 'hc-dark'
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function isDarkTheme(theme: Theme) {
  const r = resolvedTheme(theme)
  return THEMES.find((t) => t.id === r)?.dark ?? true
}

export function prefersReducedMotion(s: Settings) {
  if (s.reduceMotion === 'on') return true
  if (s.reduceMotion === 'off') return false
  return matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Applies settings to <html> through data attributes and CSS variables. */
export function applySettings(s: Settings) {
  const root = document.documentElement
  root.dataset.theme = resolvedTheme(s.theme)
  root.dataset.font = s.font
  root.dataset.motion = prefersReducedMotion(s) ? 'reduce' : 'full'
  root.dataset.underline = String(s.underlineLinks)
  root.dataset.focus = s.boldFocus ? 'bold' : 'normal'
  root.dataset.targets = s.largeTargets ? 'large' : 'normal'
  root.dataset.cvd = s.colorVision
  root.style.setProperty('--font-scale', String(s.fontScale))
  root.style.setProperty('--line-height', String(s.lineHeight))
  root.style.setProperty('--letter-spacing', `${s.letterSpacing}em`)
  if (!root.dataset.theme.startsWith('hc')) root.style.setProperty('--accent', s.accent)
  else root.style.removeProperty('--accent')
  setLanguage(s.language)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim() || '#0b0b14')
}
