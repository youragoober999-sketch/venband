// A tiny history-API router.
import { useEffect, useState } from 'react'

type Listener = () => void
const listeners = new Set<Listener>()

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === location.pathname + location.search + location.hash) return
  if (opts.replace) history.replaceState(null, '', to)
  else history.pushState(null, '', to)
  listeners.forEach((l) => l())
  // Move focus to the new page for screen reader and keyboard users.
  requestAnimationFrame(() => {
    const main = document.getElementById('main')
    if (main && !to.includes('#')) main.focus({ preventScroll: true })
    if (!to.includes('#')) window.scrollTo({ top: 0 })
  })
}

window.addEventListener('popstate', () => listeners.forEach((l) => l()))

export function useLocation() {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return { path: location.pathname, search: new URLSearchParams(location.search), hash: location.hash.slice(1) }
}

/** Matches "/p/:id/:tab?" against a path. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const ps = pattern.split('/').filter(Boolean)
  const as = path.split('/').filter(Boolean)
  const out: Record<string, string> = {}
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i]
    const optional = p.endsWith('?')
    const name = p.replace(/^:/, '').replace(/\?$/, '')
    if (i >= as.length) {
      if (optional) continue
      return null
    }
    if (p.startsWith(':')) out[name] = decodeURIComponent(as[i])
    else if (p !== as[i]) return null
  }
  return as.length <= ps.length ? out : null
}

/** onClick handler for <a href> that keeps navigation in the app. */
export function linkClick(e: React.MouseEvent<HTMLAnchorElement>) {
  const a = e.currentTarget
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank') return
  const url = new URL(a.href)
  if (url.origin !== location.origin || url.pathname.startsWith('/v1/') || url.pathname.startsWith('/api/')) return
  e.preventDefault()
  navigate(url.pathname + url.search + url.hash)
}
