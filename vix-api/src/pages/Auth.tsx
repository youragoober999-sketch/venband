import { useState } from 'react'
import { A, Button, Field, Icon, Logo } from '../components/ui'
import { api, ApiError, type User } from '../lib/api'
import { t } from '../lib/i18n'
import { useApp } from '../lib/store'
import { loadLocalSettings } from '../lib/settings'

function strength(pw: string) {
  let s = 0
  if (pw.length >= 8) s++
  if (pw.length >= 12) s++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++
  if (/\d/.test(pw)) s++
  if (/[^A-Za-z0-9]/.test(pw)) s++
  return Math.min(4, s)
}
const STRENGTH = ['Too short', 'Weak', 'Okay', 'Good', 'Strong']

export function AuthPage({ mode }: { mode: 'signin' | 'signup' }) {
  const { signIn } = useApp()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErr, setFieldErr] = useState<{ username?: string; password?: string; confirm?: string }>({})
  const signup = mode === 'signup'
  const pwStrength = strength(password)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const fe: typeof fieldErr = {}
    const u = username.trim().toLowerCase()
    if (!/^[a-z0-9_.-]{3,24}$/.test(u)) fe.username = 'Use 3-24 letters, numbers, dots, dashes or underscores'
    if (password.length < 8) fe.password = 'At least 8 characters'
    if (signup && password !== confirm) fe.confirm = t('auth.mismatch')
    setFieldErr(fe)
    if (Object.keys(fe).length) {
      document.getElementById(fe.username ? 'auth-user' : fe.password ? 'auth-pass' : 'auth-confirm')?.focus()
      return
    }
    setBusy(true)
    try {
      const res = await api.post<{ user: User; token: string }>(signup ? '/auth/signup' : '/auth/login', { username: u, password, settings: signup ? loadLocalSettings() : undefined })
      signIn(res.token, res.user)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach Vix Api')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <A href="/" className="brand auth-brand"><Logo size={36} /><span>Vix Api</span></A>
      <form className="auth-card" onSubmit={submit} noValidate aria-labelledby="auth-title">
        <h1 id="auth-title">{signup ? t('auth.signup') : t('auth.signin')}</h1>
        <p className="hint">{t('auth.noEmail')}</p>
        {error && <div className="error-box" role="alert"><Icon name="alert" /><p>{error}</p></div>}
        <Field label={t('auth.username')} error={fieldErr.username} id="auth-user" hint={signup ? 'This is your public name. Your APIs live at /v1/<username>/…' : undefined}>
          {(p) => <input {...p} className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus />}
        </Field>
        <Field label={t('auth.password')} error={fieldErr.password} id="auth-pass">
          {(p) => (
            <div className="input-with-btn">
              <input {...p} className="input" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={signup ? 'new-password' : 'current-password'} required />
              <button type="button" className="icon-btn" onClick={() => setShow((s) => !s)} aria-label={show ? t('auth.hide') : t('auth.show')} aria-pressed={show}>
                <Icon name={show ? 'eyeOff' : 'eye'} />
              </button>
            </div>
          )}
        </Field>
        {signup && (
          <>
            <div className="pw-meter" aria-live="polite">
              <div className="pw-bars" aria-hidden="true">{[0, 1, 2, 3].map((i) => <span key={i} className={i < pwStrength ? `on s${pwStrength}` : ''} />)}</div>
              <span className="hint">Password strength: {STRENGTH[pwStrength]}</span>
            </div>
            <Field label={t('auth.confirm')} error={fieldErr.confirm} id="auth-confirm">
              {(p) => <input {...p} className="input" type={show ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />}
            </Field>
            <p className="hint warn-note"><Icon name="info" size={14} /> There is no email, so there is no password reset. Store your password in a password manager.</p>
          </>
        )}
        <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">{signup ? t('auth.signup') : t('auth.signin')}</Button>
        <p className="hint center">{t('auth.remember')}</p>
        <p className="center">
          <A href={signup ? `/login${location.search}` : `/signup${location.search}`}>{signup ? t('auth.switchToSignin') : t('auth.switchToSignup')}</A>
        </p>
      </form>
    </div>
  )
}
