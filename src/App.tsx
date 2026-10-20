import { useEffect } from 'react';
import { configured } from './lib/supabase';
import { initSession, sessionStore } from './lib/session';
import { startIdleDetection } from './lib/idle';
import { startScreenTime } from './lib/screentime';
import { AuthScreen, IdentityResetScreen, MfaScreen, RecoveryScreen, SetupErrorScreen, UnlockScreen } from './components/Auth';
import { Shell } from './components/Shell';
import { Logo } from './components/ui';
import { Onboarding } from './components/Onboarding';
import { ContextMenuHost } from './components/ContextMenu';
import { InvitePage } from './components/Invite';
import { Landing } from './components/Landing';
import { parseRoute, go, useRoute, type Route } from './lib/router';
import { ChangelogPage, GuidelinesPage, PrivacyPage, PublicDiscovery, StatusPage, TermsPage } from './components/PublicPages';
import { ApplicationsPage } from './components/Apps';
import { DownloadPage } from './components/Download';
import { VooglePage } from './components/Voogle';
import { StorageConsole } from './components/Storage';
import { DialogHost } from './components/Dialogs';
import { handleSteamRedirect, handleSpotifyRedirect, handleYouTubeRedirect } from './lib/connections';
import { openSettings, isAndroid } from './lib/ui';

export default function App() {
  const status = sessionStore.use((s) => s.status);
  const hasProfile = sessionStore.use((s) => Boolean(s.me));
  const needsOnboarding = sessionStore.use((s) => s.me?.onboarded === false);
  useEffect(() => {
    if (configured) initSession();
    // a Steam "Connect" landed us back here with ?steam=1: verify + link
    void handleSteamRedirect().then((msg) => {
      if (!msg) return;
      if (msg.startsWith('Steam link failed')) alert(msg);
      else openSettings('connections');
    });
    void handleSpotifyRedirect().then((msg) => {
      if (!msg) return;
      if (msg.startsWith('Spotify link failed')) alert(msg);
      else openSettings('connections');
    });
    void handleYouTubeRedirect().then((msg) => {
      if (!msg) return;
      if (msg.startsWith('YouTube link failed')) alert(msg);
      else openSettings('connections');
    });
  }, []);
  useEffect(() => {
    if (status === 'ready' && hasProfile) startIdleDetection();
    if (status === 'ready' && hasProfile) startScreenTime();
  }, [status, hasProfile]);
  // Android auto-update check
  useEffect(() => {
    if (!isAndroid()) return;
    (async () => {
      try {
        const r = await fetch('/api/vdl?r=version', { cache: 'no-store' });
        const j = await r.json();
        const latest = j?.android?.version;
        const current = '1.0.3';
        if (latest && latest !== current) {
          // eslint-disable-next-line no-alert
          if (confirm(`A new version (${latest}) is available. Download now?`)) {
            window.location.href = j.android.url;
          }
        }
      } catch {}
    })();
  }, []);
  const route = parseRoute(useRoute());
  // Dedicated privacy-policy subdomain (privacy.venband.com and friends).
  if (window.location.hostname.toLowerCase().startsWith('privacy.')) {
    return (
      <>
        <PrivacyPage />
        <DialogHost />
        <ContextMenuHost />
      </>
    );
  }
  if (route.kind === 'page')
    return (
      <>
        <PublicRoute route={route} />
        <DialogHost />
        <ContextMenuHost />
      </>
    );
  // /storage works without Supabase (uses local VDL auth)
  if (route.kind === 'storage') {
    return (
      <>
        <StorageConsole />
        <DialogHost />
        <ContextMenuHost />
      </>
    );
  }
  if (!configured) return <NotConfigured />;
  // invite links work signed in or out
  if (route.kind === 'invite' && (status === 'signed-out' || (status === 'ready' && hasProfile && !needsOnboarding))) return <InvitePage code={route.code} />;
  // /callback handles Spotify (and future) OAuth returns.
  if (route.kind === 'callback') {
    return (
      <div className="splash">
        <Logo size={56} />
        <div className="spinner" />
        <p className="muted small">Connecting…</p>
      </div>
    );
  }
  // venband.com shows the landing page even when you're signed in; open the
  // app from the "Open Venband" button instead of landing straight in your DMs.
  if (route.kind === 'root' && status === 'ready' && hasProfile) {
    return <Landing onOpenApp={() => go('channels/@me')} onLogin={() => go('sign-in')} onSignup={() => go('register')} />;
  }
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
    case 'bots':
      return <ApplicationsPage id={route.id} />;
    case 'voogle':
      return <VooglePage />;
    case 'download':
      return <DownloadPage />;
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

