import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { currentPath, go, parseRoute, useRoute } from '../lib/router';
import { supabase } from '../lib/supabase';
import { passwordStrength } from '../lib/crypto';
import {
  completePasswordReset,
  confirmIdentityReset,
  friendlyError,
  requestPasswordReset,
  resendVerification,
  sessionStore,
  signIn,
  signOut,
  signUp,
  unlock,
} from '../lib/session';
import { Field, Wordmark } from './ui';
import { Landing, TopNav } from './Landing';

type Mode = 'login' | 'signup' | 'verify' | 'forgot' | 'forgot-sent';

// ------------------------------------------------------------------ layout --

interface NavActions {
  onLogin: () => void;
  onSignup: () => void;
  onHome: () => void;
}

function AuthLayout({ children, nav }: { children: ReactNode; nav?: NavActions }) {
  const notice = sessionStore.use((s) => s.notice);
  return (
    <div className="auth">
      {nav ? (
        <TopNav {...nav} />
      ) : (
        <header className="topnav">
          <div className="container topnav-inner">
            <span className="topnav-brand">
              <Wordmark />
            </span>
          </div>
        </header>
      )}
      <main className="auth-main">
        <div className="auth-card">
          {notice && <div className="notice">{notice}</div>}
          {children}
        </div>
      </main>
    </div>
  );
}

export function AuthScreen() {
  const hasNotice = sessionStore.use((s) => Boolean(s.notice));
  const route = useRoute();
  const [mode, setModeState] = useState<Mode | 'home'>(() => {
    const r = parseRoute();
    if (r.kind === 'register') return 'signup';
    if (r.kind === 'sign-in' || r.kind === 'home' || r.kind === 'server' || r.kind === 'discover') return 'login';
    return hasNotice || new URLSearchParams(window.location.search).has('invite') ? 'login' : 'home';
  });
  // keep /sign-in and /register in the address bar
  const setMode = (m: Mode | 'home') => {
    setModeState(m);
    if (m === 'login') go('sign-in', { keepQuery: true });
    else if (m === 'signup') go('register', { keepQuery: true });
    else if (m === 'home') go('');
  };
  useEffect(() => {
    const r = parseRoute(route);
    if (r.kind === 'register') setModeState((m) => (m === 'signup' || m === 'verify' ? m : 'signup'));
    else if (r.kind === 'sign-in') setModeState((m) => (m === 'login' || m === 'forgot' || m === 'forgot-sent' || m === 'verify' ? m : 'login'));
    else if (r.kind === 'root') setModeState('home');
  }, [route]);
  useEffect(() => {
    const r = parseRoute();
    // deep link while logged out: show the login form at /sign-in
    if (r.kind === 'home' || r.kind === 'server' || r.kind === 'discover') {
      try {
        sessionStorage.setItem('venband:return-to', currentPath());
      } catch {
        /* ignore */
      }
      go('sign-in', { replace: true, keepQuery: true });
    }
  }, []);
  const [email, setEmail] = useState('');
  const nav: NavActions = {
    onLogin: () => setMode('login'),
    onSignup: () => setMode('signup'),
    onHome: () => setMode('home'),
  };

  if (mode === 'home') return <Landing onLogin={nav.onLogin} onSignup={nav.onSignup} />;

  return (
    <AuthLayout nav={nav}>
      {mode === 'login' && <Login email={email} setEmail={setEmail} setMode={setMode} />}
      {mode === 'signup' && <Signup email={email} setEmail={setEmail} setMode={setMode} />}
      {mode === 'verify' && <VerifySent email={email} setMode={setMode} />}
      {mode === 'forgot' && <Forgot email={email} setEmail={setEmail} setMode={setMode} />}
      {mode === 'forgot-sent' && (
        <>
          <h1>Check your inbox</h1>
          <p className="sub">
            If there’s an account for <b>{email}</b>, a reset link is on its way.
          </p>
          <button className="btn link" onClick={() => setMode('login')}>
            ← Back to log in
          </button>
        </>
      )}
    </AuthLayout>
  );
}

interface FormProps {
  email: string;
  setEmail: (e: string) => void;
  setMode: (m: Mode) => void;
}

function StaySignedIn({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>
        Stay signed in on this device
        <small>Turn this off on shared computers.</small>
      </span>
    </label>
  );
}

function Login({ email, setEmail, setMode }: FormProps) {
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    sessionStore.set({ notice: null });
    try {
      await signIn(email, password, remember);
    } catch (err) {
      if (/not confirmed/i.test(String((err as Error)?.message))) {
        setMode('verify');
        return;
      }
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h1>Welcome back</h1>
      <p className="sub">Log in to pick up where you left off.</p>
      <Field label="Email">
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field
        label="Password"
        aside={
          <button type="button" className="btn link" onClick={() => setMode('forgot')}>
            Forgot it?
          </button>
        }
      >
        <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error && <div className="form-error">{error}</div>}
      <StaySignedIn value={remember} onChange={setRemember} />
      <button className="btn primary full" disabled={busy}>
        {busy ? 'Logging in…' : 'Log in'}
      </button>
      <p className="switch">
        New here?{' '}
        <button type="button" className="btn link" onClick={() => setMode('signup')}>
          Make an account
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
    if (!usernameValid) return setError('Usernames are 2–32 characters: lowercase letters, numbers, _ and .');
    if (available === false) return setError('Someone already has that username.');
    if (!strength.ok) return setError('Pick a longer password — at least 10 characters. A short sentence works well.');
    if (password !== confirm) return setError('The two passwords don’t match.');
    setBusy(true);
    try {
      await signUp({ email, password, username, displayName });
      setMode('verify');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const usernameHint =
    username && !usernameValid
      ? 'Lowercase letters, numbers, _ and . only'
      : available === false
        ? 'Taken, try another'
        : available
          ? 'Available'
          : 'This is how friends find you.';

  return (
    <form onSubmit={submit}>
      <h1>Make an account</h1>
      <p className="sub">Takes a minute. You’ll confirm your email after.</p>
      <Field label="Email">
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <div className="row">
        <Field label="Display name">
          <input maxLength={32} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Jules" />
        </Field>
        <Field label="Username" hint={<span className={available === false ? 'bad' : available ? 'good' : ''}>{usernameHint}</span>}>
          <input
            required
            autoComplete="username"
            placeholder="jules"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))}
          />
        </Field>
      </div>
      <Field label="Password" hint={password ? `${strength.label}` : 'At least 10 characters.'}>
        <input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="strength">
          <div style={{ width: `${Math.min(100, (strength.bits / 90) * 100)}%` }} className={strength.ok ? 'ok' : ''} />
        </div>
      </Field>
      <Field label="Password again">
        <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      <label className="checkbox">
        <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} required />
        <span>
          I get that my password is the key to my messages.
          <small>It never leaves this device, so nobody can recover it for you.</small>
        </span>
      </label>
      {error && <div className="form-error">{error}</div>}
      <button className="btn primary full" disabled={busy || !understood}>
        {busy ? 'Setting things up…' : 'Create account'}
      </button>
      <p className="switch">
        Already have one?{' '}
        <button type="button" className="btn link" onClick={() => setMode('login')}>
          Log in
        </button>
      </p>
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
      <h1>Check your email</h1>
      <p className="sub">
        We sent a link to <b>{email || 'your email'}</b>. Open it to confirm it’s you, then come back and log in.
      </p>
      <ul className="tips">
        <li>It can take a minute. Check spam too.</li>
        <li>Opening the link on another device is fine — just log in here afterwards.</li>
      </ul>
      {status && <div className="notice">{status}</div>}
      <button
        className="btn secondary full"
        disabled={!email || cooldown > 0}
        onClick={async () => {
          try {
            await resendVerification(email);
            setStatus('Sent another one.');
            setCooldown(60);
          } catch (e) {
            setStatus(friendlyError(e));
          }
        }}
      >
        {cooldown ? `Resend (${cooldown}s)` : 'Resend the email'}
      </button>
      <p className="switch">
        <button className="btn link" onClick={() => setMode('login')}>
          ← Back to log in
        </button>
      </p>
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
        setError(null);
        try {
          await requestPasswordReset(email);
          setMode('forgot-sent');
        } catch (err) {
          setError(friendlyError(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1>Reset your password</h1>
      <p className="sub">We’ll email you a link.</p>
      <div className="warning-box">
        Heads up: your password is what unlocks your messages. After a reset, older messages stay locked until a friend
        who has them comes online — their app re-shares the keys automatically.
      </div>
      <Field label="Email">
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      {error && <div className="form-error">{error}</div>}
      <button className="btn primary full" disabled={busy}>
        Send reset link
      </button>
      <p className="switch">
        <button type="button" className="btn link" onClick={() => setMode('login')}>
          ← Back to log in
        </button>
      </p>
    </form>
  );
}

export function UnlockScreen() {
  const session = sessionStore.use((s) => s.session);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthLayout>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await unlock(password, remember);
          } catch (err) {
            setError(friendlyError(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1>Enter your password</h1>
        <p className="sub">
          You’re signed in as <b>{session?.user.email}</b>. Your password unlocks your messages on this device.
        </p>
        <Field label="Password">
          <input type="password" autoComplete="current-password" autoFocus required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <div className="form-error">{error}</div>}
        <StaySignedIn value={remember} onChange={setRemember} />
        <button className="btn primary full" disabled={busy}>
          {busy ? 'Unlocking…' : 'Continue'}
        </button>
        <p className="switch">
          Not you?{' '}
          <button type="button" className="btn link" onClick={() => signOut()}>
            Log out
          </button>
        </p>
      </form>
    </AuthLayout>
  );
}

export function RecoveryScreen() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const strength = passwordStrength(password);
  return (
    <AuthLayout>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!strength.ok) return setError('Pick a longer password — at least 10 characters.');
          if (password !== confirm) return setError('The two passwords don’t match.');
          setBusy(true);
          try {
            await completePasswordReset(password);
          } catch (err) {
            setError(friendlyError(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1>Choose a new password</h1>
        <p className="sub">Make it something you’ll remember.</p>
        <Field label="New password" hint={password ? strength.label : undefined}>
          <input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="New password again">
          <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {error && <div className="form-error">{error}</div>}
        <button className="btn primary full" disabled={busy}>
          Save password
        </button>
      </form>
    </AuthLayout>
  );
}

export function IdentityResetScreen() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthLayout>
      <h1>Your old keys are locked</h1>
      <p className="sub">
        Your password changed, so the keys saved with your account can’t be opened with it. You can make new ones and
        carry on — your servers and DMs stay. Older messages unlock again once a friend who has them comes online.
      </p>
      {error && <div className="form-error">{error}</div>}
      <button
        className="btn primary full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await confirmIdentityReset(true);
          } catch (e) {
            setError(friendlyError(e));
            setBusy(false);
          }
        }}
      >
        Make new keys and continue
      </button>
      <p className="switch">
        <button className="btn link" onClick={() => signOut()}>
          Log out and try a different password
        </button>
      </p>
    </AuthLayout>
  );
}

export function SetupErrorScreen() {
  const message = sessionStore.use((s) => s.setupError);
  return (
    <AuthLayout>
      <h1>We couldn’t finish loading your account</h1>
      <p className="sub">You’re logged in, but something on the server side isn’t set up right.</p>
      <div className="form-error">{message ?? 'Unknown error.'}</div>
      <button className="btn primary full" onClick={() => window.location.reload()}>
        Try again
      </button>
      <p className="switch">
        <button className="btn link" onClick={() => signOut()}>
          Log out
        </button>
      </p>
    </AuthLayout>
  );
}
