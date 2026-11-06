// The one header for every public screen: the homepage, sign-in/sign-up and the
// public pages (/download, /discovery, /bots, /status, …). Same links everywhere;
// on narrow screens the links move into a menu instead of disappearing.
import { useEffect, useId, useRef, useState } from 'react';
import { go } from '../lib/router';
import { Icon, Wordmark } from './ui';

export type SiteSection = 'features' | 'discovery' | 'bots' | 'download' | 'status';

const LINKS: { id: SiteSection; label: string; path: string }[] = [
  { id: 'features', label: 'Features', path: '' },
  { id: 'discovery', label: 'Discover', path: 'discovery' },
  { id: 'bots', label: 'Developers', path: 'bots' },
  { id: 'download', label: 'Download', path: 'download' },
  { id: 'status', label: 'Status', path: 'status' },
];

/**
 * Scroll to a section of the homepage. Already on the homepage: smooth scroll.
 * Arriving from another page: wait for the section to render, jump there, then
 * correct once late layout (fonts, the app mockup) has settled.
 */
function scrollToSection(id: string, smooth: boolean, tries = 60) {
  const el = document.getElementById(id);
  if (!el) {
    // a timer, not requestAnimationFrame: rAF is paused in background tabs
    if (tries > 0) setTimeout(() => scrollToSection(id, smooth, tries - 1), 25);
    return;
  }
  el.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant', block: 'start' });
  if (!smooth) setTimeout(() => el.scrollIntoView({ behavior: 'instant', block: 'start' }), 300);
}

export interface SiteNavProps {
  active?: SiteSection;
  onHome?: () => void;
  onLogin: () => void;
  onSignup: () => void;
  /** set when signed in: shows "Open Venband" instead of Log in / Sign up */
  onOpenApp?: () => void;
}

export function SiteNav({ active, onHome, onLogin, onSignup, onOpenApp }: SiteNavProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLElement>(null);

  // close the phone menu on Escape or a tap outside it
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  const navigate = (l: (typeof LINKS)[number]) => {
    setOpen(false);
    if (l.id === 'features') {
      const onHomepage = window.location.pathname === import.meta.env.BASE_URL && !!document.getElementById('features');
      if (!onHomepage) go('');
      scrollToSection('features', onHomepage);
    } else go(l.path);
  };
  const home = () => {
    setOpen(false);
    if (onHome) onHome();
    else go('');
  };

  const links = LINKS.map((l) => (
    <a
      key={l.id}
      href={`${import.meta.env.BASE_URL}${l.path}${l.id === 'features' ? '#features' : ''}`}
      className={l.id === active ? 'active' : undefined}
      aria-current={l.id === active ? 'page' : undefined}
      onClick={(e) => {
        e.preventDefault();
        navigate(l);
      }}
    >
      {l.label}
    </a>
  ));

  return (
    <header className={`topnav${open ? ' menu-open' : ''}`} ref={root}>
      <div className="container topnav-inner">
        <a
          className="topnav-brand"
          href={import.meta.env.BASE_URL}
          aria-label="Venband home"
          onClick={(e) => {
            e.preventDefault();
            home();
          }}
        >
          <Wordmark />
        </a>
        <nav className="topnav-links" aria-label="Site">
          {links}
        </nav>
        <div className="topnav-actions">
          {onOpenApp ? (
            <button className="btn primary small" onClick={onOpenApp}>
              Open Venband
            </button>
          ) : (
            <>
              <button className="btn ghost small" onClick={onLogin}>
                Log in
              </button>
              <button className="btn primary small" onClick={onSignup}>
                Sign up
              </button>
            </>
          )}
          <button
            className="topnav-menu-btn"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((v) => !v)}
          >
            <Icon name={open ? 'x' : 'menu'} size={18} />
          </button>
        </div>
      </div>
      {open && (
        <nav id={menuId} className="container topnav-sheet" aria-label="Site menu">
          {links}
        </nav>
      )}
    </header>
  );
}
