import { useEffect } from 'react';
import { configured } from './lib/supabase';
import { initSession, sessionStore } from './lib/session';
import { AuthScreen, IdentityResetScreen, RecoveryScreen, UnlockScreen } from './components/Auth';
import { Shell } from './components/Shell';
import { Logo } from './components/ui';

export default function App() {
  const status = sessionStore.use((s) => s.status);
  useEffect(() => {
    if (configured) initSession();
  }, []);

  if (!configured) return <NotConfigured />;
  switch (status) {
    case 'loading':
      return (
        <div className="splash">
          <Logo size={56} />
          <div className="spinner" />
        </div>
      );
    case 'signed-out':
      return <AuthScreen />;
    case 'locked':
      return <UnlockScreen />;
    case 'recovery':
      return <RecoveryScreen />;
    case 'identity-reset':
      return <IdentityResetScreen />;
    case 'ready':
      return <Shell />;
  }
}

function NotConfigured() {
  return (
    <div className="auth-bg">
      <div className="auth-card">
        <Logo size={48} />
        <h1>Venband isn’t configured yet</h1>
        <p className="muted">
          Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see <code>.env.example</code> and the
          README) and rebuild.
        </p>
      </div>
    </div>
  );
}
