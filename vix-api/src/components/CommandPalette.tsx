// Ctrl+K command palette: jump anywhere, run actions, open files.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, type Api } from '../lib/api'
import { navigate } from '../lib/router'
import { useApp } from '../lib/store'
import { GUIDES } from '../lib/guides'
import { THEMES } from '../lib/settings'
import { EXTENSIONS } from '../../shared/extensions.js'
import { Icon } from './ui'
import { cx } from '../lib/util'

export type Command = { id: string; label: string; hint?: string; icon?: string; group: string; run: () => void; keywords?: string }

// Pages (like the workspace) can contribute their own commands.
const extra = new Map<string, Command[]>()
export function registerCommands(owner: string, cmds: Command[]) {
  extra.set(owner, cmds)
  return () => {
    extra.delete(owner)
  }
}

function score(q: string, text: string) {
  if (!q) return 1
  const t = text.toLowerCase()
  if (t.includes(q)) return 100 - t.indexOf(q)
  let i = 0
  for (const ch of t) if (ch === q[i]) i++
  return i === q.length ? 10 : 0
}

export function CommandPalette({ open, onClose, onHelp }: { open: boolean; onClose: () => void; onHelp: () => void }) {
  const { user, settings, updateSettings, setExtension, signOut } = useApp()
  const [q, setQ] = useState('')
  const [apis, setApis] = useState<Api[]>([])
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (!open) return
    setQ('')
    setActive(0)
    setTimeout(() => input.current?.focus(), 0)
    if (user) api.get<{ apis: Api[] }>('/apis').then((r) => setApis(r.apis)).catch(() => {})
  }, [open, user])

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => navigate(href)
    const list: Command[] = []
    for (const cmds of extra.values()) list.push(...cmds)
    if (user) {
      list.push(
        { id: 'new', group: 'Actions', label: 'Create a new API', icon: 'plus', run: go('/dashboard?new=1') },
        { id: 'newkey', group: 'Actions', label: 'Create an API key', icon: 'key', run: go('/keys?new=1') },
        { id: 'addfriend', group: 'Actions', label: 'Add a friend', icon: 'users', run: go('/friends?add=1') },
        { id: 'p-dash', group: 'Pages', label: 'Dashboard', icon: 'home', run: go('/dashboard') },
        { id: 'p-keys', group: 'Pages', label: 'API Keys', icon: 'key', run: go('/keys') },
        { id: 'p-friends', group: 'Pages', label: 'Friends', icon: 'users', run: go('/friends') },
        { id: 'p-ext', group: 'Pages', label: 'Extensions', icon: 'puzzle', run: go('/extensions') },
        { id: 'p-settings', group: 'Pages', label: 'Settings', icon: 'settings', run: go('/settings') },
        { id: 'p-a11y', group: 'Pages', label: 'Accessibility settings', icon: 'eye', run: go('/settings/accessibility') },
      )
      for (const a of apis) list.push({ id: `api-${a.id}`, group: 'Your APIs', label: `${a.icon} ${a.name}`, hint: `${a.owner_username}/${a.slug}`, icon: 'bolt', run: go(`/p/${a.id}`) })
    }
    list.push({ id: 'p-docs', group: 'Pages', label: 'Guides & Docs', icon: 'book', run: go('/docs') })
    for (const g of GUIDES) list.push({ id: `g-${g.id}`, group: 'Guides', label: `${g.icon} ${g.name}`, hint: g.category, icon: 'book', run: go(`/docs/${g.id}`), keywords: g.summary })
    for (const th of THEMES) list.push({ id: `th-${th.id}`, group: 'Theme', label: `Theme: ${th.name}`, icon: th.dark ? 'moon' : 'sun', run: () => updateSettings({ theme: th.id }) })
    list.push(
      { id: 'font-up', group: 'Accessibility', label: 'Make text bigger', icon: 'plus', run: () => updateSettings({ fontScale: Math.min(1.6, +(settings.fontScale + 0.1).toFixed(2)) }) },
      { id: 'font-down', group: 'Accessibility', label: 'Make text smaller', icon: 'eye', run: () => updateSettings({ fontScale: Math.max(0.8, +(settings.fontScale - 0.1).toFixed(2)) }) },
      { id: 'motion', group: 'Accessibility', label: settings.reduceMotion === 'on' ? 'Allow animations' : 'Reduce motion', icon: 'pause', run: () => updateSettings({ reduceMotion: settings.reduceMotion === 'on' ? 'off' : 'on' }) },
      { id: 'dys', group: 'Accessibility', label: settings.font === 'dyslexic' ? 'Use the default font' : 'Use a dyslexia-friendly font', icon: 'eye', run: () => updateSettings({ font: settings.font === 'dyslexic' ? 'inter' : 'dyslexic' }) },
      { id: 'help', group: 'Help', label: 'Keyboard shortcuts', icon: 'keyboard', run: onHelp },
    )
    if (user) {
      for (const e of EXTENSIONS.filter((x) => x.scope === 'editor')) {
        const on = !!settings.extensions[e.id]
        list.push({ id: `ext-${e.id}`, group: 'Editor extensions', label: `${on ? 'Disable' : 'Enable'} ${e.name}`, icon: 'puzzle', run: () => setExtension(e.id, !on), keywords: e.description })
      }
      list.push({ id: 'signout', group: 'Account', label: 'Sign out', icon: 'external', run: () => { signOut().then(() => navigate('/')) } })
    }
    return list
  }, [user, apis, settings, updateSettings, setExtension, signOut, onHelp, open])

  const results = useMemo(() => {
    const query = q.trim().toLowerCase()
    return commands
      .map((c) => ({ c, s: Math.max(score(query, c.label), score(query, c.hint || '') * 0.8, score(query, c.keywords || '') * 0.5, score(query, c.group) * 0.3) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 60)
      .map((x) => x.c)
  }, [q, commands])

  useEffect(() => setActive(0), [q])
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null
  const run = (c: Command) => {
    onClose()
    setTimeout(c.run, 0)
  }
  return createPortal(
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-input">
          <Icon name="search" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Type a command, page, API or file…"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={results[active] ? `pal-${results[active].id}` : undefined}
            aria-autocomplete="list"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
              if (e.key === 'Enter' && results[active]) { e.preventDefault(); run(results[active]) }
              if (e.key === 'Escape') { e.preventDefault(); onClose() }
            }}
          />
        </div>
        <ul id="palette-list" ref={listRef} role="listbox" className="palette-list" aria-label="Results">
          {results.map((c, i) => (
            <li
              key={c.id}
              id={`pal-${c.id}`}
              data-idx={i}
              role="option"
              aria-selected={i === active}
              className={cx('palette-item', i === active && 'active')}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(c)}
            >
              <Icon name={c.icon || 'chevron'} size={16} />
              <span className="palette-label">{c.label}</span>
              {c.hint && <span className="palette-hint">{c.hint}</span>}
              <span className="palette-group">{c.group}</span>
            </li>
          ))}
          {!results.length && <li className="palette-empty">No matches</li>}
        </ul>
        <div className="palette-foot" aria-hidden="true">↑↓ to move · Enter to run · Esc to close</div>
      </div>
    </div>,
    document.body,
  )
}
