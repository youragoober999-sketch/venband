import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useApp } from './lib/store'
import { match, navigate, useLocation } from './lib/router'
import { t } from './lib/i18n'
import { A, Avatar, ConfirmHost, Icon, Kbd, Loading, Logo, Modal, Toasts } from './components/ui'
import { cx } from './lib/util'
import { Landing } from './pages/Landing'
import { AuthPage } from './pages/Auth'
import { CommandPalette } from './components/CommandPalette'

const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })))
const Workspace = lazy(() => import('./pages/Workspace').then((m) => ({ default: m.Workspace })))
const Keys = lazy(() => import('./pages/Keys').then((m) => ({ default: m.Keys })))
const Friends = lazy(() => import('./pages/Friends').then((m) => ({ default: m.Friends })))
const ExtensionsPage = lazy(() => import('./pages/Extensions').then((m) => ({ default: m.ExtensionsPage })))
const Docs = lazy(() => import('./pages/Docs').then((m) => ({ default: m.Docs })))
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })))
const Profile = lazy(() => import('./pages/Profile').then((m) => ({ default: m.Profile })))

const NAV = [
  { href: '/dashboard', icon: 'home', key: 'nav.dashboard' as const },
  { href: '/keys', icon: 'key', key: 'nav.keys' as const },
  { href: '/friends', icon: 'users', key: 'nav.friends' as const },
  { href: '/extensions', icon: 'puzzle', key: 'nav.extensions' as const },
  { href: '/docs', icon: 'book', key: 'nav.docs' as const },
  { href: '/settings', icon: 'settings', key: 'nav.settings' as const },
]

const PUBLIC_ROUTES = ['/', '/login', '/signup']

export function App() {
  const { user, ready, settings } = useApp()
  const { path } = useLocation()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)

  useEffect(() => {
    if (!ready) return
    const isPublic = PUBLIC_ROUTES.includes(path) || path.startsWith('/docs')
    if (!user && !isPublic) navigate(`/login?next=${encodeURIComponent(path)}`, { replace: true })
    if (user && (path === '/login' || path === '/signup')) navigate(new URLSearchParams(location.search).get('next') || '/dashboard', { replace: true })
  }, [ready, user, path])

  useEffect(() => setNavOpen(false), [path])

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
      const typing = /input|textarea|select/i.test((e.target as HTMLElement).tagName) || (e.target as HTMLElement).isContentEditable
      if (!typing && e.key === '?' && !mod) {
        e.preventDefault()
        setHelpOpen(true)
      }
      if (!typing && e.altKey && !mod) {
        const n = parseInt(e.key, 10)
        if (n >= 1 && n <= NAV.length && user) {
          e.preventDefault()
          navigate(NAV[n - 1].href)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [user])

  const page = useMemo(() => {
    if (path === '/') return user ? <Redirect to="/dashboard" /> : <Landing />
    if (path === '/login') return <AuthPage mode="signin" />
    if (path === '/signup') return <AuthPage mode="signup" />
    if (!user && !path.startsWith('/docs')) return null
    if (path === '/dashboard') return <Dashboard />
    let m = match('/p/:id/:tab?', path)
    if (m) return <Workspace id={m.id} tab={m.tab} />
    if (path === '/keys') return <Keys />
    if (path === '/friends') return <Friends />
    if (path === '/extensions') return <ExtensionsPage />
    m = match('/docs/:guide?', path)
    if (m) return <Docs guide={m.guide} />
    m = match('/settings/:section?', path)
    if (m) return <SettingsPage section={m.section} />
    m = match('/u/:username', path)
    if (m) return <Profile username={m.username} />
    return <NotFound />
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, user, settings.language])

  if (!ready) return <div className="boot"><Logo size={48} /><Loading /></div>

  const bare = !user || path === '/' || path === '/login' || path === '/signup'
  const zen = settings.extensions.zen && path.startsWith('/p/')

  return (
    <>
      <a href="#main" className="skip-link">{t('nav.skip')}</a>
      {bare ? (
        <main id="main" tabIndex={-1} className="bare-main">
          <Suspense fallback={<Loading />}>{page}</Suspense>
        </main>
      ) : (
        <div className={cx('shell', navOpen && 'nav-open', zen && 'zen')}>
          <header className="topbar">
            <button type="button" className="icon-btn nav-toggle" aria-label={t('nav.menu')} aria-expanded={navOpen} aria-controls="sidenav" onClick={() => setNavOpen((o) => !o)}>
              <Icon name="menu" />
            </button>
            <A href="/dashboard" className="brand" aria-label="Vix Api home">
              <Logo size={28} />
              <span>Vix Api</span>
            </A>
            <button type="button" className="search-trigger" onClick={() => setPaletteOpen(true)} aria-keyshortcuts="Control+K">
              <Icon name="search" size={16} />
              <span>{t('nav.search')}</span>
              <span className="kbd-group" aria-hidden="true"><Kbd>Ctrl</Kbd><Kbd>K</Kbd></span>
            </button>
            <div className="topbar-right">
              <button type="button" className="icon-btn" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setHelpOpen(true)}>
                <Icon name="keyboard" />
              </button>
              {user && (
                <A href="/settings" className="me-chip" aria-label={`Signed in as ${user.username}. Open settings`}>
                  <Avatar user={user} size={28} />
                  <span className="me-name">{user.display_name || user.username}</span>
                </A>
              )}
            </div>
          </header>
          <nav id="sidenav" className="sidenav" aria-label="Main">
            <ul>
              {NAV.map((n, i) => {
                const active = path === n.href || path.startsWith(n.href + '/') || (n.href === '/dashboard' && path.startsWith('/p/'))
                return (
                  <li key={n.href}>
                    <A href={n.href} className={cx('nav-link', active && 'active')} aria-current={active ? 'page' : undefined} aria-keyshortcuts={`Alt+${i + 1}`}>
                      <Icon name={n.icon} />
                      <span>{t(n.key)}</span>
                    </A>
                  </li>
                )
              })}
            </ul>
            <SignOut />
          </nav>
          {navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />}
          <main id="main" tabIndex={-1} className="content">
            <Suspense fallback={<Loading />}>{page}</Suspense>
          </main>
        </div>
      )}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onHelp={() => setHelpOpen(true)} />
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <ConfirmHost />
      <Toasts />
    </>
  )
}

function SignOut() {
  const { signOut } = useApp()
  return (
    <button type="button" className="nav-link signout" onClick={async () => { await signOut(); navigate('/') }}>
      <Icon name="external" />
      <span>{t('nav.signout')}</span>
    </button>
  )
}

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to])
  return null
}

function NotFound() {
  return (
    <div className="page narrow">
      <h1>Page not found</h1>
      <p>That page does not exist. <A href="/dashboard">Go to your dashboard</A>.</p>
    </div>
  )
}

const SHORTCUTS: [string[], string][] = [
  [['Ctrl', 'K'], 'Open the command palette (search pages, APIs, files and actions)'],
  [['?'], 'Show this list'],
  [['Alt', '1-6'], 'Jump to Dashboard, Keys, Friends, Extensions, Guides, Settings'],
  [['Ctrl', 'S'], 'Save the current file'],
  [['Ctrl', 'Shift', 'S'], 'Save all files'],
  [['Ctrl', 'Enter'], 'Run the current file in the sandbox'],
  [['Ctrl', 'P'], 'Quick open a file in the workspace'],
  [['Ctrl', 'Shift', 'Z'], 'Toggle Zen mode (with the Zen Mode extension)'],
  [['Ctrl', 'F'], 'Find in file (Ctrl+H to replace)'],
  [['Ctrl', '/'], 'Toggle comment'],
  [['Ctrl', 'M'], 'Toggle Tab trapping in the editor (so Tab moves focus)'],
  [['Esc', 'Tab'], 'Leave the code editor with the keyboard'],
  [['F2'], 'Rename the selected file in the file tree'],
  [['Delete'], 'Delete the selected file in the file tree'],
  [['Arrow keys'], 'Move through the file tree, tabs and menus'],
]

function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" size="md">
      <p className="hint">On macOS use ⌘ instead of Ctrl. Everything in Vix Api can be used without a mouse.</p>
      <dl className="shortcut-list">
        {SHORTCUTS.map(([keys, desc]) => (
          <div key={desc} className="shortcut-row">
            <dt>{keys.map((k, i) => <span key={k}>{i > 0 && ' + '}<Kbd>{k}</Kbd></span>)}</dt>
            <dd>{desc}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  )
}
