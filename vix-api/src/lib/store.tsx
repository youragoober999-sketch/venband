// App-wide state: the signed-in user, settings, toasts and screen reader announcements.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, getToken, setToken, setUnauthorizedHandler, type User } from './api'
import { applySettings, loadLocalSettings, mergeSettings, saveLocalSettings, type Settings } from './settings'
import { setLanguage } from './i18n'

export type Toast = { id: number; kind: 'info' | 'success' | 'error'; text: string; action?: { label: string; run: () => void } }

type Ctx = {
  user: User | null
  ready: boolean
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => void
  setExtension: (id: string, on: boolean) => void
  signIn: (token: string, user: User) => void
  signOut: () => Promise<void>
  setUser: (u: User) => void
  toast: (text: string, kind?: Toast['kind'], action?: Toast['action']) => void
  toasts: Toast[]
  dismissToast: (id: number) => void
  announce: (text: string, assertive?: boolean) => void
}

const AppContext = createContext<Ctx | null>(null)

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp outside provider')
  return ctx
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const [settings, setSettings] = useState<Settings>(() => loadLocalSettings())
  const [toasts, setToasts] = useState<Toast[]>([])
  const politeRef = useRef<HTMLDivElement>(null)
  const assertiveRef = useRef<HTMLDivElement>(null)
  const syncTimer = useRef<number>(undefined)
  const userRef = useRef<User | null>(null)
  userRef.current = user
  const pendingSync = useRef<Settings | null>(null)

  // Translations are read during render, so switch language before children render.
  setLanguage(settings.language)

  useEffect(() => {
    applySettings(settings)
    saveLocalSettings(settings)
  }, [settings])

  // Follow OS theme / motion changes live when set to "system".
  useEffect(() => {
    const queries = ['(prefers-color-scheme: light)', '(prefers-reduced-motion: reduce)', '(prefers-contrast: more)'].map((q) => matchMedia(q))
    const on = () => applySettings(settings)
    queries.forEach((q) => q.addEventListener('change', on))
    return () => queries.forEach((q) => q.removeEventListener('change', on))
  }, [settings])

  const announce = useCallback((text: string, assertive = false) => {
    const el = assertive ? assertiveRef.current : politeRef.current
    if (!el) return
    el.textContent = ''
    window.setTimeout(() => {
      el.textContent = text
    }, 50)
  }, [])

  const dismissToast = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), [])

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info', action?: Toast['action']) => {
    const id = Date.now() + Math.random()
    setToasts((ts) => [...ts.slice(-4), { id, kind, text, action }])
    announce(text, kind === 'error')
    window.setTimeout(() => dismissToast(id), kind === 'error' ? 9000 : 5000)
  }, [announce, dismissToast])

  const pushSettings = useCallback((s: Settings) => {
    if (!userRef.current) return
    pendingSync.current = s
    window.clearTimeout(syncTimer.current)
    syncTimer.current = window.setTimeout(() => {
      pendingSync.current = null
      api.patch('/me', { settings: s }).catch(() => {})
    }, 800)
  }, [])

  // Don't lose a settings change when the tab closes or reloads right after it.
  useEffect(() => {
    const flush = () => {
      const s = pendingSync.current
      const token = getToken()
      if (!s || !token) return
      pendingSync.current = null
      window.clearTimeout(syncTimer.current)
      fetch('/api/me', { method: 'PATCH', keepalive: true, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ settings: s }) }).catch(() => {})
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [])

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch, updatedAt: Date.now() }
      pushSettings(next)
      return next
    })
  }, [pushSettings])

  const setExtension = useCallback((id: string, on: boolean) => {
    setSettings((s) => {
      const next = { ...s, extensions: { ...s.extensions, [id]: on }, updatedAt: Date.now() }
      pushSettings(next)
      return next
    })
  }, [pushSettings])

  const adoptRemote = useCallback((remote: unknown) => {
    const { settings: merged, localNewer } = mergeSettings(remote)
    setSettings(merged)
    if (localNewer) api.patch('/me', { settings: merged }).catch(() => {})
  }, [])

  const signIn = useCallback((token: string, u: User) => {
    setToken(token)
    setUserState(u)
    if (u.settings && Object.keys(u.settings).length) adoptRemote(u.settings)
    else api.patch('/me', { settings: loadLocalSettings() }).catch(() => {})
  }, [adoptRemote])

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout')
    } catch {
      /* offline is fine */
    }
    setToken(null)
    setUserState(null)
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null)
      setUserState(null)
    })
    if (!getToken()) {
      setReady(true)
      return
    }
    api.get<{ user: User }>('/auth/me')
      .then(({ user: u }) => {
        setUserState(u)
        if (u.settings && Object.keys(u.settings).length) adoptRemote(u.settings)
      })
      .catch((e) => {
        if (e.status === 401) setToken(null)
      })
      .finally(() => setReady(true))
  }, [adoptRemote])

  const value = useMemo<Ctx>(() => ({
    user, ready, settings, updateSettings, setExtension, signIn, signOut, setUser: setUserState, toast, toasts, dismissToast, announce,
  }), [user, ready, settings, updateSettings, setExtension, signIn, signOut, toast, toasts, dismissToast, announce])

  return (
    <AppContext.Provider value={value}>
      {children}
      <div ref={politeRef} className="sr-only" role="status" aria-live="polite" aria-atomic="true" />
      <div ref={assertiveRef} className="sr-only" role="alert" aria-live="assertive" aria-atomic="true" />
    </AppContext.Provider>
  )
}
