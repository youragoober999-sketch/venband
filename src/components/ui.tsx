import { cloneElement, isValidElement, useEffect, useId, useRef, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import type { Profile } from '../lib/types';
import { LOGO_PATH, LOGO_VIEWBOX } from './logoPath';

/** Venband glyph (official mark). Uses currentColor. */
export function LogoGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={(size * 609) / 696} viewBox={LOGO_VIEWBOX} aria-hidden className="logo-glyph">
      <path fill="currentColor" fillRule="evenodd" d={LOGO_PATH} />
    </svg>
  );
}

/** App icon: the glyph on an accent tile. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <span className="logo-tile" style={{ width: size, height: size, borderRadius: size * 0.3 }} role="img" aria-label="Venband">
      <LogoGlyph size={size * 0.62} />
    </span>
  );
}

/** Glyph + wordmark, for navigation bars. */
export function Wordmark() {
  return (
    <span className="wordmark">
      <LogoGlyph size={22} />
      Venband
    </span>
  );
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0][0] : parts[0][0] + parts[1][0]).toUpperCase();
}

export function Avatar({
  profile,
  size = 40,
  online,
  speaking,
  frame = true,
}: {
  profile: (Pick<Profile, 'display_name' | 'avatar_color'> & { presence?: Profile['presence']; avatar_url?: string | null; avatar_frame?: Profile['avatar_frame'] }) | null | undefined;
  size?: number;
  online?: boolean;
  speaking?: boolean;
  /** show the profile frame (hidden in tight spots like mentions) */
  frame?: boolean;
}) {
  const name = profile?.display_name ?? '?';
  // online + their chosen status (idle / do not disturb); invisible looks offline
  const status = online === undefined ? null : !online || profile?.presence === 'invisible' ? 'offline' : (profile?.presence ?? 'online');
  const fr = frame && size >= 24 && profile?.avatar_frame && profile.avatar_frame !== 'none' ? profile.avatar_frame : null;
  return (
    <div
      className={`avatar${speaking ? ' speaking' : ''}${profile?.avatar_url ? ' has-picture' : ''}${fr ? ` framed frame-${fr}` : ''}`}
      style={{ width: size, height: size, background: profile?.avatar_url ? undefined : (profile?.avatar_color ?? '#555'), fontSize: size * 0.38 }}
      aria-hidden
    >
      {profile?.avatar_url ? (
        <img
          className="avatar-img"
          src={profile.avatar_url}
          alt=""
          loading="lazy"
          draggable={false}
          onError={(e) => {
            // broken/expired URL: fall back to the coloured initials disc instead of an empty box
            const img = e.currentTarget;
            img.style.display = 'none';
            const host = img.parentElement;
            if (host && !host.querySelector('.avatar-fallback')) {
              const span = document.createElement('span');
              span.className = 'avatar-fallback';
              span.textContent = initials(name);
              host.appendChild(span);
            }
          }}
        />
      ) : (
        initials(name)
      )}
      {fr && <span className="avatar-frame" />}
      {status && <span className={`status-dot ${status}`} />}
    </div>
  );
}

const NAME_FONTS: Record<string, string> = {
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'var(--mono)',
  rounded: 'ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", system-ui, sans-serif',
  handwritten: '"Segoe Script", "Bradley Hand", "Brush Script MT", "Comic Sans MS", cursive',
  display: 'Impact, Haettenschweiler, "Arial Black", sans-serif',
  pixel: '"Courier New", ui-monospace, monospace',
};

/** A display name in the person's chosen font, colours and effect. */
export function StyledName({ style, children, fallbackColor }: { style?: Profile['name_style'] | null; children: ReactNode; fallbackColor?: string }) {
  const s = style ?? {};
  const colors = (s.colors ?? []).filter((c) => /^#[0-9a-fA-F]{3,8}$/.test(c)).slice(0, 3);
  const css: CSSProperties = {};
  if (s.font && NAME_FONTS[s.font]) css.fontFamily = NAME_FONTS[s.font];
  if (colors.length === 1) css.color = colors[0];
  else if (colors.length > 1) css.backgroundImage = `linear-gradient(90deg, ${[...colors, colors[0]].join(', ')})`;
  else if (fallbackColor) css.color = fallbackColor;
  const cls = ['styled-name', colors.length > 1 ? 'gradient' : '', s.effect && s.effect !== 'none' ? `fx-${s.effect}` : '', s.font === 'pixel' ? 'font-pixel' : ''].filter(Boolean).join(' ');
  if (!s.font && !colors.length && (!s.effect || s.effect === 'none')) return <span style={fallbackColor ? { color: fallbackColor } : undefined}>{children}</span>;
  return (
    <span className={cls} style={{ ...css, ['--glow' as string]: colors[0] ?? fallbackColor ?? 'currentColor' }}>
      {children}
    </span>
  );
}

/** Inline style for a custom nameplate. */
export function nameplateVars(p?: Pick<Profile, 'nameplate' | 'nameplate_style'> | null): CSSProperties | undefined {
  if (p?.nameplate !== 'custom') return undefined;
  const c = (p.nameplate_style?.colors ?? []).filter((x) => /^#[0-9a-fA-F]{6}$/.test(x)).slice(0, 3);
  if (!c.length) return undefined;
  const a = c.map((x) => `${x}66`);
  const img =
    p.nameplate_style?.pattern === 'stripes'
      ? `repeating-linear-gradient(115deg, ${a[0]} 0 8px, transparent 8px 18px), linear-gradient(100deg, transparent, ${a[a.length - 1]}, transparent)`
      : p.nameplate_style?.pattern === 'dots'
        ? `radial-gradient(${a[0]} 1.5px, transparent 2px) 0 0 / 10px 10px, linear-gradient(100deg, transparent, ${a[a.length - 1]}, transparent)`
        : p.nameplate_style?.pattern === 'waves'
          ? `radial-gradient(ellipse at 20% 120%, ${a[0]}, transparent 60%), radial-gradient(ellipse at 80% -20%, ${a[a.length - 1]}, transparent 60%)`
          : `linear-gradient(100deg, transparent 15%, ${a.join(', ')}, transparent 85%)`;
  return { ['--np' as string]: img };
}

// Stack of open modals, so Escape only closes the top one.
const modalStack: symbol[] = [];

export function Modal({
  title,
  onClose,
  children,
  wide,
  className,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Runs once per modal: re-running on every render used to move focus to the
  // close button while typing, so Space would close the dialog.
  useEffect(() => {
    const id = Symbol('modal');
    modalStack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || modalStack[modalStack.length - 1] !== id) return;
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    const body = ref.current?.querySelector('.modal-body');
    const first =
      body?.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), textarea, select, [autofocus]') ??
      body?.querySelector<HTMLElement>('button:not([disabled])');
    if (first && !ref.current?.contains(document.activeElement)) first.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      const i = modalStack.indexOf(id);
      if (i >= 0) modalStack.splice(i, 1);
    };
  }, []);
  // Clicking outside never closes a dialog: only the X button or Escape do.
  return (
    <div className="modal-backdrop">
      <div className={`modal${wide ? ' wide' : ''}${className ? ' ' + className : ''}`} ref={ref} role="dialog" aria-modal aria-label={typeof title === 'string' ? title : undefined}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-btn modal-close" onClick={() => closeRef.current()} aria-label="Close" title="Close (Esc)" type="button">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/** True when the user is typing in a text field (shortcuts must not fire). */
export function isTyping(e?: Event | null) {
  const t = (e?.target ?? document.activeElement) as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
}

const ICONS: Record<string, string> = {
  hash: 'M10 3 8 21M16 3l-2 18M4 8h17M3 16h17',
  speaker: 'M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14',
  mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3',
  micOff: 'M2 2l20 20M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.6M17 16.9A7 7 0 0 1 5 12v-2M19 10v2c0 .7-.1 1.4-.3 2M12 19v3',
  headphones: 'M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1v-7h3zM3 19a2 2 0 0 0 2 2h1v-7H3z',
  headphonesOff: 'M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1v-7h3zM3 19a2 2 0 0 0 2 2h1v-7H3zM2 2l20 20',
  video: 'M23 7l-7 5 7 5V7zM1 5h15v14H1z',
  videoOff: 'M2 2l20 20M16 16v3H1V5h3m5 0h7v7l1 1 6-4v10',
  screen: 'M2 3h20v14H2zM8 21h8M12 17v4',
  phoneOff: 'M10.7 13.3a16 16 0 0 0 3.4 2.6l1.3-1.3a2 2 0 0 1 2.1-.4c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3 4.2 2 2 0 0 1 5 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.4 2.1L8.9 9.7M22 2 2 22',
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.8.3 1.7.6 2.6.7a2 2 0 0 1 1.7 2z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  plus: 'M12 5v14M5 12h14',
  x: 'M18 6 6 18M6 6l12 12',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  unlock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.7-1.5',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  chevron: 'm6 9 6 6 6-6',
  chevronRight: 'm9 6 6 6-6 6',
  paperclip: 'm21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5',
  reply: 'M9 17 4 12l5-5M20 18v-2a4 4 0 0 0-4-4H4',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  message: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  warning: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  check: 'M20 6 9 17l-5-5',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  smile: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
  maximize: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3',
  minimize: 'M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3',
  scissors: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  clipboard: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 2h6v4H9z',
  pin: 'M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z',
  bellOff: 'M13.7 21a2 2 0 0 1-3.4 0M18.6 13A17 17 0 0 1 18 8M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14M18 8a6 6 0 0 0-9.3-5M2 2l20 20',
  bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  block: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM4.9 4.9l14.2 14.2',
  userPlus: 'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM20 8v6M23 11h-6',
  userMinus: 'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 11h-6',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  at: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.9 7.9',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10A15 15 0 0 1 12 2z',
  translate: 'M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  smilePlus: 'M22 11v1a10 10 0 1 1-9-10M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01M16 5h6M19 2v6',
  thread: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM8 9h8M8 13h5',
  bookmark: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
  poll: 'M3 3v18h18M7 16v-4M12 16V8M17 16v-7',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  archive: 'M21 8v13H3V8M1 3h22v5H1zM10 12h4',
  folder: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  unread: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z',
  quote: 'M3 21c3 0 7-1 7-8V5H3v7h4c0 4-2 6-4 6zM14 21c3 0 7-1 7-8V5h-7v7h4c0 4-2 6-4 6z',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  lockOpen: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.9-1',
  spellcheck: 'M3 15 7 5l4 10M4.5 11h5M14 5h4a2.5 2.5 0 0 1 0 5h-4zM14 10h4.5a2.5 2.5 0 0 1 0 5H14zM13 20l2 2 5-5',
  megaphone: 'M3 10v4h3l11 5V5L6 10H3zM6 14l1.5 5h3L9 15M20 9.5v5',
  stage: 'M12 2a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM5 10a7 7 0 0 0 14 0M12 17v3M3 22h18',
  grip: 'M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01',
  soundboard: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M17.9 17.9A10 10 0 0 1 12 20c-7 0-11-8-11-8a18 18 0 0 1 5.1-5.9M9.9 4.2A9 9 0 0 1 12 4c7 0 11 8 11 8a18 18 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2M1 1l22 22',
  volume: 'M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7',
  volumeOff: 'M11 5 6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6',
  more: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  image: 'M3 3h18v18H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21',
  gif: 'M3 5h18v14H3zM10 10H8v4h2v-1.5M13 10v4M16 14v-4h2M16 12h1.5',
  monitor: 'M2 3h20v14H2zM8 21h8M12 17v4',
  phoneDevice: 'M7 2h10v20H7zM11 18h2',
  palette: 'M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-2a2 2 0 0 0-1.5 3.3A1.7 1.7 0 0 1 12 22zM7.5 11a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM10.5 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM15.5 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM17.5 11a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  flag: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
  gavel: 'm14 13-8.5 8.5a2.1 2.1 0 0 1-3-3L11 10M16 16l6-6M8 8l6-6M9 7l8 8M21 11l-8-8',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  home: 'M3 10 12 3l9 7v11h-6v-7H9v7H3z',
  sparkles: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9zM5 2l.6 1.4L7 4l-1.4.6L5 6l-.6-1.4L3 4l1.4-.6z',
  key: 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zM15.5 7.5l3 3L22 7l-3-3',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  menu: 'M3 6h18M3 12h18M3 18h18',
  share: 'M15 5l6 6-6 6M21 11H9a6 6 0 0 0-6 6v2',
  wave: 'M2 12h2M6 8v8M10 5v14M14 8v8M18 10v4M22 12h0',
  hand: 'M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8a8 8 0 0 0 16 0v-3a2 2 0 0 0-4 0',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6',
  bot: 'M12 2v3M8 5h8a4 4 0 0 1 4 4v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4zM9 12h.01M15 12h.01M9 16h6M2 12v2M22 12v2',
  code: 'M16 18l6-6-6-6M8 6l-6 6 6 6',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3',
  play: 'M6 3l14 9-14 9z',
  pause: 'M7 4h3v16H7zM14 4h3v16h-3z',
  calendar: 'M3 4h18v18H3zM16 2v4M8 2v4M3 10h18',
  compass: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM16.2 7.8l-2.1 6.4-6.4 2.1 2.1-6.4z',
};

export function Icon({ name, size = 20, filled }: { name: keyof typeof ICONS | string; size?: number; filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={ICONS[name] ?? ''} />
    </svg>
  );
}

export function Field({
  label,
  error,
  children,
  hint,
  aside,
  group,
}: {
  label: string;
  error?: string | null;
  hint?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  /** several buttons / pickers rather than one input: don't wrap them in a <label> */
  group?: boolean;
}) {
  // A <label> names whatever is inside it, buttons included, so only wrap a
  // single input / textarea / select in one; groups of controls get a div.
  // Form controls get a real id (+ name) so the label is explicitly associated
  // and accessibility audits pass (axe: "form field should have an ID or name").
  const id = useId();
  const single = isValidElement(children) && typeof children.type === 'string' && ['input', 'textarea', 'select'].includes(children.type);
  const control = single
    ? cloneElement(children as ReactElement<{ id?: string; name?: string }>, {
        id,
        ...((children as ReactElement<{ name?: string }>).props?.name == null ? { name: id } : {}),
      })
    : children;
  return (
    <div className="field">
      <div className="field-top">
        <label className="field-label" htmlFor={single ? id : undefined}>
          {label}
        </label>
        {aside}
      </div>
      {group || !single ? (
        <div className="field-control" role="group" aria-label={label}>
          {control}
        </div>
      ) : (
        <div className="field-control">{control}</div>
      )}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export function randomColor() {
  const colors = ['#7c5cff', '#e5484d', '#30a46c', '#f76b15', '#0090ff', '#d6409f', '#ffb224', '#12a594'];
  return colors[Math.floor(Math.random() * colors.length)];
}

export const SWATCHES = ['#7c5cff', '#4f7cff', '#0090ff', '#12a594', '#30a46c', '#ffb224', '#f76b15', '#e5484d', '#d6409f', '#8e4ec6', '#99aab5', '#e2e2e2'];

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="swatches">
      {SWATCHES.map((c) => (
        <button
          type="button"
          key={c}
          className={`swatch${c.toLowerCase() === value.toLowerCase() ? ' selected' : ''}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
          aria-label={c}
        />
      ))}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Custom color" />
    </div>
  );
}