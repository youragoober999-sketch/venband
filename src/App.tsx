import { lazy, Suspense, useEffect, type ComponentType, type ReactNode } from 'react';
import { configured } from './lib/supabase';
import { initSession, sessionStore } from './lib/session';
import { startIdleDetection } from './lib/idle';
import { startScreenTime } from './lib/screentime';
import { AuthScreen, IdentityResetScreen, MfaScreen, RecoveryScreen, SetupErrorScreen, UnlockScreen } from './components/Auth';
import { Logo } from './components/ui';
import { ContextMenuHost } from './components/ContextMenu';
import { Landing } from './components/Landing';
import { parseRoute, go, useRoute, type Route } from './lib/router';
import { DialogHost, showAlert, askConfirm } from './components/Dialogs';
import { openSettings, isAndroid } from './lib/ui';
import { compareVersions, VERSION } from './lib/version';

// Only the homepage and the sign-in screens are in the first download. Everything
// else (the signed-in app, settings, the console, public pages) loads on demand, so
// a first-time visitor does not download the whole app just to see the homepage.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyNamed<T extends Record<string, any>, K extends keyof T>(load: () => Promise<T>, name: K) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return lazy(async () => ({ default: (await load())[name] as ComponentType<any> }));
}
const Shell = lazyNamed(() => import('./components/Shell'), 'Shell');
const Onboarding = lazyNamed(() => import('./components/Onboarding'), 'Onboarding');
const InvitePage = lazyNamed(() => import('./components/Invite'), 'InvitePage');
const StorageConsole = lazyNamed(() => import('./components/Storage'), 'StorageConsole');
const ApplicationsPage = lazyNamed(() => import('./components/Apps'), 'ApplicationsPage');
const DownloadPage = lazyNamed(() => import('./components/Download'), 'DownloadPage');
const VooglePage = lazyNamed(() => import('./components/Voogle'), 'VooglePage');
const publicPages = () => import('./components/PublicPages');
const StatusPage = lazyNamed(publicPages, 'StatusPage');
const legalPages = () => import('./components/Legal');
const TermsPage = lazyNamed(legalPages, 'TermsPage');
const PrivacyPage = lazyNamed(legalPages, 'PrivacyPage');
const ConnectionsPolicyPage = lazyNamed(legalPages, 'ConnectionsPolicyPage');
const ConsumerUsePage = lazyNamed(legalPages, 'ConsumerUsePage');
const GuidelinesPage = lazyNamed(publicPages, 'GuidelinesPage');
const ChangelogPage = lazyNamed(publicPages, 'ChangelogPage');
const PublicDiscovery = lazyNamed(publicPages, 'PublicDiscovery');

function Splash({ label }: { label?: string }) {
  return (
    <div className="splash">
      <Logo size={56} />
      <div className="spinner" />
      {label && <p className="muted small">{label}</p>}
    </div>
  );
}

/** Shows the splash while a lazily loaded screen downloads. */
function Load({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Splash />}>{children}</Suspense>;
}


export default function App() {
  const status = sessionStore.use((s) => s.status);
  const hasProfile = sessionStore.use((s) => Boolean(s.me));
  const needsOnboarding = sessionStore.use((s) => s.me?.onboarded === false);
  useEffect(() => {
    if (configured) initSession();
    // Back from a Steam / Spotify / YouTube / TikTok "Connect" (?steam=1 or an OAuth
    // ?code=...): verify + link. The handlers only load when such a return happens.
    const sp = new URLSearchParams(window.location.search);
    if (!sp.has('steam') && !sp.has('code')) return;
    void import('./lib/connections').then(({ handleSteamRedirect, handleSpotifyRedirect, handleYouTubeRedirect, handleTikTokRedirect }) => {
      const report = (service: string) => (msg: string | null) => {
        if (!msg) return;
        if (msg.startsWith(`${service} link failed`)) showAlert(msg);
        else openSettings('connections');
      };
      void handleSteamRedirect().then(report('Steam'));
      void handleSpotifyRedirect().then(report('Spotify'));
      void handleYouTubeRedirect().then(report('YouTube'));
      void handleTikTokRedirect().then(report('TikTok'));
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
        // VERSION is baked into this build, i.e. the version of the installed APK.
        // (It used to be hard-coded to '1.0.3', so every newer install was told to
        // update to the version it already had.)
        if (typeof latest === 'string' && compareVersions(latest, VERSION) > 0) {
          void askConfirm({ title: 'Update available', body: `Venband ${latest} is out. Download it now?`, confirm: 'Download' }).then((yes) => {
            if (yes) window.location.href = j.android.url;
          });
        }
      } catch {}
    })();
  }, []);
  const route = parseRoute(useRoute());
  // Dedicated privacy-policy subdomain (privacy.venband.com and friends).
  if (window.location.hostname.toLowerCase().startsWith('privacy.')) {
    return (
      <>
        <Load>{/connections/i.test(window.location.pathname) ? <ConnectionsPolicyPage /> : <PrivacyPage />}</Load>
        <DialogHost />
        <ContextMenuHost />
      </>
    );
  }
  if (window.location.hostname.toLowerCase().startsWith('tos.')) {
    return (
      <>
        <Load>
          <TermsPage />
        </Load>
        <DialogHost />
        <ContextMenuHost />
      </>
    );
  }
  if (route.kind === 'page')
    return (
      <>
        <Load>
          <PublicRoute route={route} />
        </Load>
        <DialogHost />
        <ContextMenuHost />
      </>
    );
  // /storage works without Supabase (uses local VDL auth)
  if (route.kind === 'storage') {
    return (
      <>
        <Load>
          <StorageConsole />
        </Load>
        <DialogHost />
        <ContextMenuHost />
      </>
    );
  }
  if (!configured) return <NotConfigured />;
  // invite links work signed in or out
  if (route.kind === 'invite' && (status === 'signed-out' || (status === 'ready' && hasProfile && !needsOnboarding)))
    return (
      <Load>
        <InvitePage code={route.code} />
      </Load>
    );
  // /callback handles Spotify (and future) OAuth returns.
  if (route.kind === 'callback') return <Splash label="Connecting…" />;
  // venband.com shows the landing page even when you're signed in; open the
  // app from the "Open Venband" button instead of landing straight in your DMs.
  if (route.kind === 'root' && status === 'ready' && hasProfile) {
    return <Landing onOpenApp={() => go('channels/@me')} onLogin={() => go('sign-in')} onSignup={() => go('register')} />;
  }
  switch (status) {
    case 'loading':
      return <Splash />;
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
      return <Load>{needsOnboarding ? <Onboarding /> : <Shell />}</Load>;
  }
}

function PublicRoute({ route }: { route: Extract<Route, { kind: 'page' }> }) {
  switch (route.page) {
    case 'status':
      return <StatusPage />;
    case 'tos':
      return <TermsPage />;
    case 'privacy':
      return route.id === 'connections' ? <ConnectionsPolicyPage /> : <PrivacyPage />;
    case 'policy':
      return route.id === 'connections' ? <ConnectionsPolicyPage /> : <ConsumerUsePage />;
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

