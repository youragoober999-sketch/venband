import { useEffect } from 'react';
import { configured } from './lib/supabase';
import { initSession, sessionStore } from './lib/session';
import { AuthScreen, IdentityResetScreen, MfaScreen, RecoveryScreen, SetupErrorScreen, UnlockScreen } from './components/Auth';
import { Shell } from './components/Shell';
import { Logo } from './components/ui';
import { Onboarding } from './components/Onboarding';
import { ContextMenuHost } from './components/ContextMenu';
import { InvitePage } from './components/Invite';
import { parseRoute, useRoute, type Route } from './lib/router';
import { ChangelogPage, GuidelinesPage, PrivacyPage, PublicDiscovery, StatusPage, TermsPage } from './components/PublicPages';
import { ApplicationsPage } from './components/Apps';
import { VooglePage } from './components/Voogle';
import { DialogHost } from './components/Dialogs';

export default function App() {
  const status = sessionStore.use((s) => s.status);
  const hasProfile = sessionStore.use((s) => Boolean(s.me));
  const needsOnboarding = sessionStore.use((s) => s.me?.onboarded === false);
  useEffect(() => {
    if (configured) initSession();
  }, []);

  const route = parseRoute(useRoute());
  if (route.kind === 'page')
    return (
      <>
        <PublicRoute route={route} />
        <DialogHost />
        <ContextMenuHost />
      </>
    );
  if (!configured) return <NotConfigured />;
  // invite links work signed in or out
  if (route.kind === 'invite' && (status === 'signed-out' || (status === 'ready' && hasProfile && !needsOnboarding))) return <InvitePage code={route.code} />;
  switch (status) {
    case 'loading':
      return (
        <div className="splash">
          <Logo size={56} />
          <div className="spinner" />
        </div>
      );
    case 'signed-out':
      return (
        <>
          <AuthScreen />
          <ContextMenuHost />
        </>
      );
    case 'locked':
      return <UnlockScreen />;
    case 'mfa':
      return <MfaScreen />;
    case 'recovery':
      return <RecoveryScreen />;
    case 'identity-reset':
      return <IdentityResetScreen />;
    case 'setup-error':
      return <SetupErrorScreen />;
    case 'ready':
      if (!hasProfile) return <SetupErrorScreen />;
      return needsOnboarding ? <Onboarding /> : <Shell />;
  }
}

function PublicRoute({ route }: { route: Extract<Route, { kind: 'page' }> }) {
  switch (route.page) {
    case 'status':
      return <StatusPage />;
    case 'tos':
      return <TermsPage />;
    case 'privacy':
      return <PrivacyPage />;
    case 'guidelines':
      return <GuidelinesPage />;
    case 'changelog':
      return <ChangelogPage />;
    case 'discovery':
      return <PublicDiscovery />;
    case 'applications':
      return <ApplicationsPage id={route.id} />;
    case 'voogle':
      return <VooglePage />;
  }
}

function NotConfigured() {
  return (
    <div className="simple-page">
      <div className="simple-card">
        <Logo size={40} />
        <h1>Venband isn’t configured yet</h1>
        <p className="muted">
          Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see <code>.env.example</code> and the
          README) and rebuild.
        </p>
      </div>
    </div>
  );
}
