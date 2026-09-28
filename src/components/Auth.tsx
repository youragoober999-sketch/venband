import { useEffect, useState, type FormEvent } from 'react';
import { supabase, errorMessage } from '../lib/supabase';
import { passwordStrength } from '../lib/crypto';
import {
  completePasswordReset,
  confirmIdentityReset,
  requestPasswordReset,
  resendVerification,
  sessionStore,
  signIn,
  signOut,
  signUp,
  unlock,
} from '../lib/session';
import { Field, Icon, Logo } from './ui';

type Mode = 'login' | 'signup' | 'verify' | 'forgot' | 'forgot-sent';

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const notice = sessionStore.use((s) => s.notice);

  return (
    <div className="auth-bg">
      <div className="auth-card">
        <div className="auth-brand">
          <Logo size={44} />
          <span>venband</span>
        </div>
        {notice && <div className="notice">{notice}</div>}
        {mode === 'login' && <Login email={email} setEmail={setEmail} setMode={setMode} />}
        {mode === 'signup' && <Signup email={email} setEmail={setEmail} setMode={setMode} />}
        {mode === 'verify' && <VerifySent email={email} setMode={setMode} />}
        {mode === 'forgot' && <Forgot email={email} setEmail={setEmail} setMode={setMode} />}
        {mode === 'forgot-sent' && (
          <>
            <h1>Check your inbox</h1>
            <p className="muted">
              If an account exists for <b>{email}</b>, we sent a link to reset the password.
            </p>
            <button className="btn link" onClick={() => setMode('login')}>
              Back to login
            </button>
          </>
        )}
        <E2EEBadge />
      </div>
    </div>
  );
}

function E2EEBadge() {
  return (
    <div className="e2ee-badge">
      <Icon name="shield" size={16} />
      <span>End-to-end encrypted. Your password never leaves this device — only a derived login key does.</span>
    </div>
  );
}

interface FormProps {
  email: string;
  setEmail: (e: string) => void;
  setMode: (m: Mode) => void;
}

function Login({ email, setEmail, setMode }: FormProps) {
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password, remember);
    } catch (err) {
      const msg = errorMessage(err);
      if (/confirm/i.test(msg)) {
        setMode('verify');
        return;
      }
      setError(/invalid/i.test(msg) ? 'Wrong email or password.' : msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h1>Welcome back!</h1>
      <p className="muted">We’re so excited to see you again.</p>
      <Field label="Email" error={error}>
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password">
        <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <button type="button" className="btn link small" onClick={() => setMode('forgot')}>
        Forgot your password?
      </button>
      <label className="checkbox">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Keep my keys unlocked on this device
      </label>
      <button className="btn primary full" disabled={busy}>
        {busy ? 'Deriving keys…' : 'Log In'}
      </button>
      <p className="muted small">
        Need an account?{' '}
        <button type="button" className="btn link" onClick={() => setMode('signup')}>
          Register
        </button>
      </p>
    </form>
  );
}

function Signup({ email, setEmail, setMode }: FormProps) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const strength = passwordStrength(password);
  const usernameValid = /^[a-z0-9_.]{2,32}$/.test(username);

  useEffect(() => {
    setAvailable(null);
    if (!usernameValid) return;
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('username_available', { p_username: username });
      setAvailable(Boolean(data));
    }, 350);
    return () => clearTimeout(t);
  }, [username, usernameValid]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!usernameValid) return setError('Username: 2–32 characters, lowercase letters, numbers, _ and .');
    if (available === false) return setError('That username is taken.');
    if (!strength.ok) return setError('Choose a stronger password (10+ characters, mix of types).');
    if (password !== confirm) return setError('Passwords don’t match.');
    setBusy(true);
    try {
      await signUp({ email, password, username, displayName });
      setMode('verify');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h1>Create an account</h1>
      {error && <div className="form-error">{error}</div>}
      <Field label="Email">
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Display name">
        <input maxLength={32} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="How others see you" />
      </Field>
      <Field
        label="Username"
        hint={
          username && !usernameValid
            ? 'Lowercase letters, numbers, _ and . (2–32)'
            : available === false
              ? 'Taken'
              : available
                ? 'Available ✓'
                : ' '
        }
      >
        <input
          required
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))}
        />
      </Field>
      <Field label="Password" hint={password ? `Strength: ${strength.label}` : 'At least 10 characters. A passphrase is best.'}>
        <input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="strength">
          <div style={{ width: `${Math.min(100, (strength.bits / 90) * 100)}%` }} className={strength.ok ? 'ok' : ''} />
        </div>
      </Field>
      <Field label="Confirm password">
        <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      <label className="checkbox">
        <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} required />
        I understand my password encrypts my keys. Nobody — not even the server — can recover it for me.
      </label>
      <button className="btn primary full" disabled={busy || !understood}>
        {busy ? 'Creating account…' : 'Continue'}
      </button>
      <button type="button" className="btn link small" onClick={() => setMode('login')}>
        Already have an account?
      </button>
    </form>
  );
}

function VerifySent({ email, setMode }: { email: string; setMode: (m: Mode) => void }) {
  const [status, setStatus] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (!cooldown) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);
  return (
    <div>
      <div className="big-icon">
        <Icon name="message" size={40} />
      </div>
      <h1>Verify your email</h1>
      <p className="muted">
        We sent a verification link to <b>{email || 'your email'}</b>. Click it to activate your account, then log in.
      </p>
      {status && <div className="notice">{status}</div>}
      <button
        className="btn secondary full"
        disabled={!email || cooldown > 0}
        onClick={async () => {
          try {
            await resendVerification(email);
            setStatus('Sent! Check your inbox (and spam folder).');
            setCooldown(60);
          } catch (e) {
            setStatus(errorMessage(e));
          }
        }}
      >
        {cooldown ? `Resend in ${cooldown}s` : 'Resend email'}
      </button>
      <button className="btn link small" onClick={() => setMode('login')}>
        Back to login
      </button>
    </div>
  );
}

function Forgot({ email, setEmail, setMode }: FormProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await requestPasswordReset(email);
          setMode('forgot-sent');
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1>Reset password</h1>
      <div className="warning-box">
        <Icon name="warning" size={18} />
        <span>
          Because Venband is end-to-end encrypted, resetting your password creates new encryption keys. Older messages
          stay unreadable until another member who still has those keys comes online and re-shares them.
        </span>
      </div>
      <Field label="Email" error={error}>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <button className="btn primary full" disabled={busy}>
        Send reset link
      </button>
      <button type="button" className="btn link small" onClick={() => setMode('login')}>
        Back to login
      </button>
    </form>
  );
}

export function UnlockScreen() {
  const session = sessionStore.use((s) => s.session);
  const notice = sessionStore.use((s) => s.notice);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="auth-bg">
      <form
        className="auth-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await unlock(password, remember);
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {notice && <div className="notice">{notice}</div>}
        <div className="big-icon">
          <Icon name="lock" size={40} />
        </div>
        <h1>Unlock your keys</h1>
        <p className="muted">
          Signed in as <b>{session?.user.email}</b>. Enter your password to decrypt your encryption keys on this device.
        </p>
        <Field label="Password" error={error}>
          <input type="password" autoComplete="current-password" autoFocus required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <label className="checkbox">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Keep my keys unlocked on this device
        </label>
        <button className="btn primary full" disabled={busy}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
        <button type="button" className="btn link small" onClick={() => signOut()}>
          Log out
        </button>
      </form>
    </div>
  );
}

export function RecoveryScreen() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const strength = passwordStrength(password);
  return (
    <div className="auth-bg">
      <form
        className="auth-card"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!strength.ok) return setError('Choose a stronger password.');
          if (password !== confirm) return setError('Passwords don’t match.');
          setBusy(true);
          try {
            await completePasswordReset(password);
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1>Choose a new password</h1>
        {error && <div className="form-error">{error}</div>}
        <Field label="New password" hint={password ? `Strength: ${strength.label}` : undefined}>
          <input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirm new password">
          <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <button className="btn primary full" disabled={busy}>
          Save password
        </button>
      </form>
    </div>
  );
}

export function IdentityResetScreen() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="auth-bg">
      <div className="auth-card">
        <div className="big-icon warn">
          <Icon name="warning" size={40} />
        </div>
        <h1>Your encryption keys are locked</h1>
        <p className="muted">
          Your password was changed or reset, so the keys stored for your account can’t be opened with it. You can create
          new keys: you keep your servers and DMs, and other members automatically re-share channel keys with your new
          keys when they come online. Until then, older messages stay unreadable.
        </p>
        {error && <div className="form-error">{error}</div>}
        <button
          className="btn danger full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await confirmIdentityReset(false);
            } catch (e) {
              setError(errorMessage(e));
              setBusy(false);
            }
          }}
        >
          Create new encryption keys
        </button>
        <button className="btn link small" onClick={() => signOut()}>
          Log out and try another password
        </button>
      </div>
    </div>
  );
}
