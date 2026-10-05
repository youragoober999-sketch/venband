// Accessible building blocks shared by every page.
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../lib/store'
import { copyText, cx } from '../lib/util'
import { t } from '../lib/i18n'
import { linkClick } from '../lib/router'

// ------------------------------------------------------------------ icons --

const PATHS: Record<string, string> = {
  logo: 'M4 5h4l4 10 4-10h4l-6.5 14h-3z',
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  key: 'M15 7a4 4 0 1 1-3.9 4.9L3 20v-3h3v-3h3l2.1-2.1A4 4 0 0 1 15 7zm1 2.5a1 1 0 1 0 0-.01',
  users: 'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  puzzle: 'M10 3a2 2 0 0 1 4 0v2h4a1 1 0 0 1 1 1v4h-2a2 2 0 0 0 0 4h2v4a1 1 0 0 1-1 1h-4v-2a2 2 0 0 0-4 0v2H6a1 1 0 0 1-1-1v-4h2a2 2 0 0 0 0-4H5V6a1 1 0 0 1 1-1h4z',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  plus: 'M12 5v14M5 12h14',
  x: 'M18 6 6 18M6 6l12 12',
  play: 'M7 4v16l13-8z',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  folderOpen: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H7.5a2 2 0 0 0-1.9 1.4L3 19zM3 19l2.6-7.6A2 2 0 0 1 7.5 10H22l-2.7 8a2 2 0 0 1-1.9 1z',
  chevron: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  check: 'M20 6 9 17l-5-5',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  menu: 'M3 6h18M3 12h18M3 18h18',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
  bolt: 'M13 2 3 14h9l-1 8 10-12h-9z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l4 2',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  database: 'M12 8c5 0 9-1.3 9-3s-4-3-9-3-9 1.3-9 3 4 3 9 3zM3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5M3 12c0 1.7 4 3 9 3s9-1.3 9-3',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M17.9 17.9A10 10 0 0 1 12 20c-7 0-11-8-11-8a18 18 0 0 1 5-5.9M9.9 4.2A9 9 0 0 1 12 4c7 0 11 8 11 8a18 18 0 0 1-2.2 3.2M1 1l22 22M14.1 14.1a3 3 0 1 1-4.2-4.2',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15',
  terminal: 'M4 17l6-6-6-6M12 19h8',
  zap: 'M13 2 3 14h9l-1 8 10-12h-9z',
  bot: 'M12 8V4H8M4 12h16v8H4zM2 14v4M22 14v4M9 16h.01M15 16h.01M8 8h8a4 4 0 0 1 4 4H4a4 4 0 0 1 4-4z',
  gamepad: 'M6 12h4M8 10v4M15 13h.01M18 11h.01M17.3 5H6.7a4 4 0 0 0-4 3.6L2 15a3 3 0 0 0 5.4 2l1.3-2h6.6l1.3 2A3 3 0 0 0 22 15l-.7-6.4a4 4 0 0 0-4-3.6z',
  keyboard: 'M2 6h20v12H2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  alert: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  dots: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3',
  layout: 'M3 3h18v18H3zM3 9h18M9 21V9',
  maximize: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
}

export function Icon({ name, size = 18, className, label }: { name: keyof typeof PATHS | string; size?: number; className?: string; label?: string }) {
  return (
    <svg
      className={cx('icon', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={PATHS[name] || PATHS.info} />
    </svg>
  )
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false" className="logo-mark">
      <defs>
        <linearGradient id="vixg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="var(--logo-bg)" />
      <path d="M14 16h9l9 21 9-21h9L36 48h-8z" fill="url(#vixg)" />
      <path d="M40 40l10 10M50 40L40 50" stroke="#22d3ee" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}

// ---------------------------------------------------------------- buttons --

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle'
  size?: 'sm' | 'md' | 'lg'
  icon?: string
  loading?: boolean
}

export function Button({ variant = 'secondary', size = 'md', icon, loading, children, className, disabled, ...rest }: BtnProps) {
  return (
    <button type="button" className={cx('btn', `btn-${variant}`, `btn-${size}`, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Spinner size={14} /> : icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} /> : null}
      {children}
    </button>
  )
}

export function IconButton({ icon, label, onClick, className, size = 16, ...rest }: { icon: string; label: string; size?: number } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={cx('icon-btn', className)} aria-label={label} title={label} onClick={onClick} {...rest}>
      <Icon name={icon} size={size} />
    </button>
  )
}

export function A({ href, children, className, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={href} className={className} onClick={linkClick} {...rest}>
      {children}
    </a>
  )
}

export function Spinner({ size = 18, label }: { size?: number; label?: string }) {
  return (
    <span className="spinner" style={{ width: size, height: size }} role={label ? 'status' : undefined} aria-label={label}>
      <span className="sr-only">{label}</span>
    </span>
  )
}

export function Loading({ label = t('common.loading') }: { label?: string }) {
  return (
    <div className="loading-block" role="status">
      <Spinner size={22} />
      <span>{label}</span>
    </div>
  )
}

export function CopyButton({ text, label = t('common.copy'), size = 'sm', variant = 'secondary' }: { text: string; label?: string; size?: 'sm' | 'md'; variant?: BtnProps['variant'] }) {
  const [done, setDone] = useState(false)
  const { announce } = useApp()
  return (
    <Button
      size={size}
      variant={variant}
      icon={done ? 'check' : 'copy'}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true)
          announce(t('common.copied'))
          setTimeout(() => setDone(false), 1500)
        }
      }}
    >
      {done ? t('common.copied') : label}
    </Button>
  )
}

// ----------------------------------------------------------------- inputs --

export function Field({ label, hint, error, children, id: given }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode; id?: string }) {
  const auto = useId()
  const id = given || auto
  const hintId = hint ? `${id}-hint` : undefined
  const errId = error ? `${id}-err` : undefined
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined
  return (
    <div className={cx('field', error && 'field-error')}>
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && <p id={hintId} className="hint">{hint}</p>}
      {error && <p id={errId} className="error-text" role="alert"><Icon name="alert" size={14} /> {error}</p>}
    </div>
  )
}

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  const id = useId()
  return (
    <div className="switch-row">
      <div className="switch-text">
        <span id={`${id}-l`} className="switch-label">{label}</span>
        {description && <span id={`${id}-d`} className="hint">{description}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-l`}
        aria-describedby={description ? `${id}-d` : undefined}
        className={cx('switch', checked && 'on')}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-thumb" />
      </button>
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          tabIndex={value === o.value ? 0 : -1}
          className={cx('seg', value === o.value && 'active')}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const i = options.findIndex((x) => x.value === value)
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
              e.preventDefault()
              const n = options[(i + 1) % options.length]
              onChange(n.value)
              ;(e.currentTarget.parentElement?.children[(i + 1) % options.length] as HTMLElement)?.focus()
            }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
              e.preventDefault()
              const j = (i - 1 + options.length) % options.length
              onChange(options[j].value)
              ;(e.currentTarget.parentElement?.children[j] as HTMLElement)?.focus()
            }
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------- tabs --

export function Tabs<T extends string>({ tabs, value, onChange, label, className }: { tabs: { id: T; label: ReactNode; icon?: string; badge?: ReactNode }[]; value: T; onChange: (v: T) => void; label: string; className?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  return (
    <div className={cx('tabs', className)} role="tablist" aria-label={label}>
      {tabs.map((tab, i) => (
        <button
          key={tab.id}
          ref={(el) => {
            refs.current[i] = el
          }}
          role="tab"
          type="button"
          id={`tab-${tab.id}`}
          aria-selected={value === tab.id}
          aria-controls={`panel-${tab.id}`}
          tabIndex={value === tab.id ? 0 : -1}
          className={cx('tab', value === tab.id && 'active')}
          onClick={() => onChange(tab.id)}
          onKeyDown={(e) => {
            let j = -1
            if (e.key === 'ArrowRight') j = (i + 1) % tabs.length
            if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length
            if (e.key === 'Home') j = 0
            if (e.key === 'End') j = tabs.length - 1
            if (j >= 0) {
              e.preventDefault()
              onChange(tabs[j].id)
              refs.current[j]?.focus()
            }
          }}
        >
          {tab.icon && <Icon name={tab.icon} size={15} />}
          <span>{tab.label}</span>
          {tab.badge}
        </button>
      ))}
    </div>
  )
}

// ----------------------------------------------------------------- modals --

export function Modal({ open, onClose, title, children, footer, size = 'md', description }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'; description?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const el = ref.current
    const first = el?.querySelector<HTMLElement>('[autofocus], input, select, textarea, button:not(.modal-x), [href]')
    ;(first || el)?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null)
        if (!items.length) return
        const a = items[0], b = items[items.length - 1]
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault()
          b.focus()
        } else if (!e.shiftKey && document.activeElement === b) {
          e.preventDefault()
          a.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = overflow
      prev?.focus?.()
    }
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={cx('modal', `modal-${size}`)} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descId : undefined} tabIndex={-1}>
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <IconButton icon="x" label={t('common.close')} onClick={onClose} className="modal-x" />
        </div>
        {description && <p id={descId} className="modal-desc">{description}</p>}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

type ConfirmOpts = { title: string; body?: ReactNode; confirm?: string; danger?: boolean; input?: { label: string; placeholder?: string; initial?: string; type?: string } }
type ConfirmState = ConfirmOpts & { resolve: (v: string | boolean | null) => void }

let openConfirm: ((o: ConfirmState) => void) | null = null

/** Promise-based confirm/prompt dialog. Returns true/false, or the typed text for prompts (null when cancelled). */
export function ask(o: ConfirmOpts): Promise<any> {
  return new Promise((resolve) => {
    if (!openConfirm) resolve(o.input ? null : false)
    else openConfirm({ ...o, resolve })
  })
}

export function ConfirmHost() {
  const [state, setState] = useState<ConfirmState | null>(null)
  const [value, setValue] = useState('')
  useEffect(() => {
    openConfirm = (o) => {
      setValue(o.input?.initial || '')
      setState(o)
    }
    return () => {
      openConfirm = null
    }
  }, [])
  const close = (v: string | boolean | null) => {
    state?.resolve(v)
    setState(null)
  }
  return (
    <Modal
      open={!!state}
      onClose={() => close(state?.input ? null : false)}
      title={state?.title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => close(state?.input ? null : false)}>{t('common.cancel')}</Button>
          <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(state?.input ? value : true)} disabled={!!state?.input && !value.trim()}>
            {state?.confirm || 'OK'}
          </Button>
        </>
      }
    >
      {state?.body && <div className="confirm-body">{state.body}</div>}
      {state?.input && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (value.trim()) close(value)
          }}
        >
          <Field label={state.input.label}>
            {(p) => <input {...p} className="input" type={state.input?.type || 'text'} value={value} placeholder={state.input?.placeholder} onChange={(e) => setValue(e.target.value)} autoFocus spellCheck={false} autoComplete="off" />}
          </Field>
        </form>
      )}
    </Modal>
  )
}

// ----------------------------------------------------------------- toasts --

export function Toasts() {
  const { toasts, dismissToast } = useApp()
  return (
    <div className="toasts" role="region" aria-label="Notifications">
      {toasts.map((tt) => (
        <div key={tt.id} className={cx('toast', `toast-${tt.kind}`)}>
          <Icon name={tt.kind === 'error' ? 'alert' : tt.kind === 'success' ? 'check' : 'info'} />
          <span>{tt.text}</span>
          {tt.action && (
            <button type="button" className="toast-action" onClick={() => { tt.action!.run(); dismissToast(tt.id) }}>{tt.action.label}</button>
          )}
          <button type="button" className="toast-x" onClick={() => dismissToast(tt.id)} aria-label={t('common.close')}><Icon name="x" size={14} /></button>
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------- misc --

export function Avatar({ user, size = 32 }: { user: { username: string; display_name?: string; avatar_color?: string }; size?: number }) {
  const name = user.display_name || user.username
  return (
    <span className="avatar" style={{ width: size, height: size, background: user.avatar_color || 'var(--accent)', fontSize: size * 0.42 }} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'good' | 'bad' | 'warn' | 'accent' | 'info'; className?: string }) {
  return <span className={cx('badge', `badge-${tone}`, className)}>{children}</span>
}

export function MethodBadge({ method }: { method: string }) {
  return <span className={cx('method', `method-${method.toLowerCase()}`)}>{method}</span>
}

export function StatusPill({ status }: { status: number }) {
  const tone = status >= 500 ? 'bad' : status >= 400 ? 'warn' : status >= 300 ? 'info' : 'good'
  const word = status >= 500 ? 'error' : status >= 400 ? 'client error' : status >= 300 ? 'redirect' : 'ok'
  return (
    <Badge tone={tone}>
      <span aria-hidden="true">{status >= 400 ? '✕' : '✓'}</span> {status} <span className="sr-only">{word}</span>
    </Badge>
  )
}

export function Empty({ icon = 'info', title, children, action }: { icon?: string; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} size={28} /></div>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error)
  return (
    <div className="error-box" role="alert">
      <Icon name="alert" />
      <div>
        <strong>{t('common.error')}</strong>
        <p>{msg}</p>
      </div>
      {retry && <Button size="sm" onClick={retry} icon="refresh">{t('common.retry')}</Button>}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>
}

/** Small dropdown menu with roving focus. */
export function Menu({ label, icon = 'dots', items, buttonClass }: { label: string; icon?: string; items: ({ label: string; icon?: string; danger?: boolean; onSelect: () => void } | null)[]; buttonClass?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const list = items.filter(Boolean) as { label: string; icon?: string; danger?: boolean; onSelect: () => void }[]
  useEffect(() => {
    if (!open) return
    const first = ref.current?.querySelector<HTMLElement>('[role="menuitem"]')
    first?.focus()
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && e.target !== btn.current) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  return (
    <div className="menu-wrap">
      <button ref={btn} type="button" className={cx('icon-btn', buttonClass)} aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}>
        <Icon name={icon} size={16} />
      </button>
      {open && (
        <div
          ref={ref}
          className="menu"
          role="menu"
          aria-label={label}
          onKeyDown={(e) => {
            const els = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') || [])]
            const i = els.indexOf(document.activeElement as HTMLElement)
            if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus() }
            if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus() }
            if (e.key === 'Escape' || e.key === 'Tab') { setOpen(false); btn.current?.focus() }
          }}
        >
          {list.map((it) => (
            <button key={it.label} type="button" role="menuitem" tabIndex={-1} className={cx('menu-item', it.danger && 'danger')} onClick={(e) => { e.stopPropagation(); setOpen(false); it.onSelect() }}>
              {it.icon && <Icon name={it.icon} size={15} />}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Wraps async loading state for a component. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: unknown; loading: boolean }>({ data: null, error: null, loading: true })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true, error: null }))
    fn().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (error) => alive && setState({ data: null, error, loading: false }),
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  return { ...state, reload: () => setTick((n) => n + 1), setData: (d: T) => setState({ data: d, error: null, loading: false }) }
}
