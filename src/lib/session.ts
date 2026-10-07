// Authentication + identity state machine.
import { loadExpressions, resetExpressions } from './expressions';
import type { Session } from '@supabase/supabase-js';
import { supabase, appUrl, errorMessage } from './supabase';
import { createStore } from './store';
import { deriveMasterKeys, type Identity } from './crypto';
import {
  forgetIdentities,
  IdentityLockedError,
  loadIdentity,
  recallIdentity,
  rememberIdentity,
  resetIdentity,
  resealStoredIdentity,
  verifyVault,
} from './identity';
import { Keyring } from './keyring';
import { initTrust, loadProfiles, getProfile, putProfile } from './directory';
import { setPresenceUser } from './presence';
import { leaveCall } from './call';
import type { Profile } from './types';
import { loadSettings, resetSettingsStore } from './settings';
import { startSocial, stopSocial } from './social';
import { registerDevice, stopWatchingSession, watchSession } from './devices';

export type AuthStatus =
  | 'loading'
  | 'signed-out'
  | 'locked' // signed in, identity keys not unlocked on this device
  | 'identity-reset' // password was reset: keys can't be opened
  | 'recovery' // arrived from a password-reset email
  | 'setup-error' // signed in, but the account couldn't be loaded
  | 'mfa' // password was right; waiting for the authenticator code
  | 'ready';

interface SessionState {
  status: AuthStatus;
  session: Session | null;
  identity: Identity | null;
  keyring: Keyring | null;
  me: Profile | null;
  notice: string | null;
  setupError: string | null;
  pendingVault: CryptoKey | null;
  /** waiting on the second sign-in step (vaultKey is null when the keys are already on this device) */
  pendingMfa: { vaultKey: CryptoKey | null; remember: boolean } | null;
}

export const sessionStore = createStore<SessionState>({
  status: 'loading',
  session: null,
  identity: null,
  keyring: null,
  me: null,
  notice: null,
  setupError: null,
  pendingVault: null,
  pendingMfa: null,
});

/** True when the account has an authenticator app and this session hasn't passed it yet. */
async function needsMfa(): Promise<boolean> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return false;
  return data.nextLevel === 'aal2' && data.currentLevel !== 'aal2';
}

async function enterApp(session: Session, identity: Identity) {
  const userId = session.user.id;
  initTrust(userId);
  setPresenceUser(userId);
  await supabase.realtime.setAuth(session.access_token);
  let me: Profile;
  try {
    me = await fetchMyProfile(userId);
  } catch (e) {
    sessionStore.set({ status: 'setup-error', session, setupError: errorMessage(e) });
    return;
  }
  sessionStore.set({
    status: 'ready',
    session,
    identity,
    keyring: new Keyring(identity),
    me,
    setupError: null,
    pendingVault: null,
  });
  // background extras: never block entering the app
  loadSettings(userId).catch(() => {});
  loadExpressions(true).catch(() => {});
  startSocial(userId);
  registerDevice(session).catch(() => {});
  watchSession(() => {
    signOut('This device was logged out from another device.');
  });
}

/** Load (and if needed create) the signed-in user's profile. */
async function fetchMyProfile(userId: string): Promise<Profile> {
  const rpc = await supabase.rpc('my_profile');
  const fromRpc = rpc.data as Profile | null;
  if (!rpc.error && fromRpc?.id) {
    putProfile(fromRpc);
    return fromRpc;
  }
  // Databases set up before my_profile() existed: fall back to a plain read.
  await loadProfiles([userId], true);
  const me = getProfile(userId);
  if (me) return me;
  const { error } = await supabase.from('profiles').select('id').eq('id', userId).maybeSingle();
  if (error) throw new Error(`Couldn’t load your profile: ${friendlyError(error)}`);
  throw new Error(
    'Your account doesn’t have a profile yet. If you run this site, run the newest SQL file from supabase/migrations in the Supabase SQL editor, then reload.',
  );
}

/**
 * Is the identity remembered on this device still the account's current one?
 * Returns null when we can't tell (network hiccup, token being refreshed) —
 * that must never lock the user out.
 */
async function currentIdentityMatches(userId: string, keyId: string): Promise<boolean | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) {
      await new Promise((r) => setTimeout(r, 800 * attempt));
      await supabase.auth.getSession(); // refreshes an expired access token
    }
    const { data, error } = await supabase.from('user_private_keys').select('key_id').eq('user_id', userId).maybeSingle();
    if (!error) return data?.key_id === keyId;
  }
  return null;
}

// While signIn()/unlock() run they decide what screen to show; the auth
// listener must not race them (it would flash the unlock screen).
let authInProgress = 0;

// Auth events can arrive in bursts (initial session, token refresh, tab
// focus). Handle them one at a time so a slow, stale check can't undo a newer
// successful one.
let sessionQueue: Promise<void> = Promise.resolve();
function queueSession(session: Session | null) {
  sessionQueue = sessionQueue.then(() => onSession(session)).catch((e) => console.warn('session error', e));
}

async function onSession(session: Session | null) {
  if (session && authInProgress > 0) {
    sessionStore.set({ session });
    return;
  }
  if (!session) {
    if (arrivedFromEmailLink) {
      // The link was opened in a different browser/app than the one it was
      // requested from, so it couldn't sign in here.
      arrivedFromEmailLink = false;
      window.history.replaceState(null, '', window.location.pathname);
      sessionStore.set({
        notice: resetLink
          ? 'That password reset link has to be opened in the same browser you asked for it from. Click “Forgot it?” below to get a new link here, then open it in this browser.'
          : 'Your email link worked. Log in below. (If you were resetting your password, ask for a new reset link from this browser and open it here.)',
      });
    }
    sessionStore.set({ status: 'signed-out', session: null, identity: null, keyring: null, me: null });
    return;
  }
  const s = sessionStore.get();
  if (s.status === 'ready' && s.session?.user.id === session.user.id) {
    sessionStore.set({ session });
    return;
  }
  if (s.status === 'ready' && s.session && s.session.user.id !== session.user.id) {
    // Another tab of this browser logged into a different account; tabs share
    // one saved login, so switch cleanly and say why.
    try {
      sessionStorage.setItem('venband:notice', 'You logged into a different account in another tab. To use two accounts at once, open the second one in a private/incognito window.');
    } catch {
      /* ignore */
    }
    window.location.reload();
    return;
  }
  if (recovering || new URLSearchParams(window.location.search).has('reset')) {
    sessionStore.set({ status: 'recovery', session });
    return;
  }
  if (await needsMfa()) {
    // keep the password-derived key if signIn already stashed it
    sessionStore.set({ status: 'mfa', session, pendingMfa: sessionStore.get().pendingMfa ?? { vaultKey: null, remember: true } });
    return;
  }
  const remembered = await recallIdentity(session.user.id);
  if (remembered) {
    // `null` = couldn't check right now: trust this device's keys rather than
    // kicking the user out; a real key change is caught on the next load.
    if ((await currentIdentityMatches(session.user.id, remembered.keyId)) !== false) {
      await enterApp(session, remembered);
      return;
    }
  }
  if (sessionStore.get().status === 'ready' && sessionStore.get().session?.user.id === session.user.id) return;
  sessionStore.set({ status: 'locked', session });
}

/** Turn Supabase / network errors into something a person can act on. */
export function friendlyError(e: unknown): string {
  const msg = errorMessage(e);
  if (/user is banned|banned/i.test(msg)) return 'This account has been banned from Venband.';
  if (/too many accounts/i.test(msg)) return 'Too many accounts have been created from your network. Use an existing account instead.';
  if (/invalid login credentials/i.test(msg))
    return 'That email and password don’t match an account. Check for typos, or make a new account.';
  if (/already registered|already exists/i.test(msg)) return 'There’s already an account with that email. Try logging in instead.';
  if (/rate limit|security purposes|too many/i.test(msg)) return 'Too many attempts. Wait a minute, then try again.';
  if (/error sending .*email/i.test(msg))
    return 'The email couldn’t be sent. If you run this site, set up custom SMTP in Supabase (see the README).';
  if (/permission denied/i.test(msg))
    return `The server is missing a database permission (${msg}). If you run this site, run supabase/repair.sql in the Supabase SQL editor.`;
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return 'Can’t reach the server. Check your internet connection.';
  if (/invalid or has expired|otp_expired|expired/i.test(msg))
    return 'That link has expired or was already used. If you already confirmed your email, just log in.';
  return msg;
}

let arrivedFromEmailLink = false;
/** the link was a password reset (from ?reset=1, which Supabase may drop) */
let resetLink = false;
/** Supabase said this sign-in came from a password reset link: show the reset form, whatever else happens */
let recovering = false;

export function initSession() {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.slice(1));
  const authError = url.searchParams.get('error_description') ?? hash.get('error_description');
  arrivedFromEmailLink = url.searchParams.has('code');
  resetLink = url.searchParams.has('reset');
  try {
    const carried = sessionStorage.getItem('venband:notice');
    if (carried) {
      sessionStorage.removeItem('venband:notice');
      sessionStore.set({ notice: carried });
    }
  } catch {
    /* ignore */
  }
  if (authError) {
    sessionStore.set({ notice: friendlyError(authError) });
    window.history.replaceState(null, '', url.pathname);
  }

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session) {
      recovering = true;
      arrivedFromEmailLink = false;
      window.history.replaceState(null, '', url.pathname + '?reset=1');
      sessionStore.set({ status: 'recovery', session });
      return;
    }
    if (event === 'SIGNED_IN' && url.searchParams.has('code') && sessionStore.get().status !== 'ready') {
      // came back from an email link
      arrivedFromEmailLink = false;
      if (!url.searchParams.has('reset')) sessionStore.set({ notice: 'Email confirmed. Enter your password once to finish setting up.' });
      window.history.replaceState(null, '', url.pathname + (url.searchParams.has('reset') ? '?reset=1' : ''));
    }
    if ((event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') && session) supabase.realtime.setAuth(session.access_token);
    if (event === 'SIGNED_OUT' && !signingOut && sessionStore.get().status === 'ready') {
      sessionStore.set({
        notice: 'You were logged out. (If you logged out or switched accounts in another tab, that logs out every tab in this browser — use an incognito window for a second account.)',
      });
    }
    // defer: never await supabase calls inside the auth callback
    setTimeout(() => queueSession(session), 0);
  });
}

// ---------------------------------------------------------------- actions --

export async function signUp(input: { email: string; password: string; username: string; displayName: string }) {
  const { authPassword } = await deriveMasterKeys(input.email, input.password);
  const { data, error } = await supabase.auth.signUp({
    email: input.email.trim(),
    password: authPassword,
    options: {
      emailRedirectTo: appUrl(),
      data: { username: input.username.toLowerCase(), display_name: input.displayName || input.username },
    },
  });
  if (error) throw error;
  // With email confirmation on, Supabase hides whether an email is taken by
  // returning a user with no identities.
  if (data.user && data.user.identities?.length === 0) {
    throw new Error('There’s already an account with that email. Try logging in instead.');
  }
  return data;
}

export async function resendVerification(email: string) {
  const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: appUrl() } });
  if (error) throw error;
}

export async function signIn(email: string, password: string, remember: boolean) {
  const { authPassword, vaultKey } = await deriveMasterKeys(email, password);
  authInProgress++;
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: authPassword });
    if (error) throw error;
    if (await needsMfa()) {
      sessionStore.set({ status: 'mfa', session: data.session, pendingMfa: { vaultKey, remember } });
      return;
    }
    try {
      await unlockWith(data.session, vaultKey, remember);
    } catch (e) {
      // Password was right but setup failed: sign out quietly so the next
      // attempt starts clean instead of looking like a surprise logout.
      signingOut = true;
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      signingOut = false;
      sessionStore.set({ status: 'signed-out', session: null });
      throw e;
    }
  } finally {
    authInProgress--;
  }
}

export async function unlock(password: string, remember: boolean) {
  const session = sessionStore.get().session;
  if (!session?.user.email) throw new Error('Not signed in');
  const { vaultKey } = await deriveMasterKeys(session.user.email, password);
  authInProgress++;
  try {
    await unlockWith(session, vaultKey, remember);
  } finally {
    authInProgress--;
  }
}

async function unlockWith(session: Session, vaultKey: CryptoKey, remember: boolean) {
  // Make sure the profile exists first: identity keys reference it.
  try {
    await fetchMyProfile(session.user.id);
  } catch (e) {
    sessionStore.set({ status: 'setup-error', session, setupError: errorMessage(e) });
    return;
  }
  try {
    const identity = await loadIdentity(session.user.id, vaultKey);
    if (remember) await rememberIdentity(identity);
    sessionStore.set({ notice: null }); // "email confirmed / logged out" messages are done now
    await enterApp(session, identity);
  } catch (e) {
    if (e instanceof IdentityLockedError) {
      sessionStore.set({ status: 'identity-reset', session, pendingVault: vaultKey });
      return;
    }
    throw e;
  }
}

/** Second sign-in step: the 6-digit code from an authenticator app. */
export async function verifyMfa(code: string) {
  const { pendingMfa } = sessionStore.get();
  const { data: factors, error: fe } = await supabase.auth.mfa.listFactors();
  if (fe) throw fe;
  const factor = factors.totp.find((f) => f.status === 'verified');
  if (!factor) throw new Error('No authenticator app is set up for this account.');
  authInProgress++;
  try {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.replace(/\s/g, '') });
    if (error) throw new Error(/invalid/i.test(error.message) ? 'That code didn’t work. Check the time on your phone and try the newest code.' : error.message);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error('Your sign-in expired. Please log in again.');
    sessionStore.set({ pendingMfa: null });
    if (pendingMfa?.vaultKey) {
      await unlockWith(session, pendingMfa.vaultKey, pendingMfa.remember);
    } else {
      sessionStore.set({ status: 'loading' });
      authInProgress--;
      try {
        await onSession(session);
      } finally {
        authInProgress++;
      }
    }
  } finally {
    authInProgress--;
  }
}

/** After a password reset: create new keys. Old encrypted history is lost for this account. */
export async function confirmIdentityReset(remember: boolean) {
  const { session, pendingVault } = sessionStore.get();
  if (!session || !pendingVault) throw new Error('Nothing to reset');
  const identity = await resetIdentity(session.user.id, pendingVault);
  if (remember) await rememberIdentity(identity);
  await enterApp(session, identity);
}

export async function requestPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl('?reset=1') });
  if (error) throw error;
}

export async function completePasswordReset(newPassword: string) {
  const session = sessionStore.get().session;
  if (!session?.user.email) throw new Error('Reset link expired — request a new one.');
  const { authPassword, vaultKey } = await deriveMasterKeys(session.user.email, newPassword);
  const { error } = await supabase.auth.updateUser({ password: authPassword });
  if (error) throw error;
  recovering = false;
  window.history.replaceState(null, '', window.location.pathname);
  await unlockWith(session, vaultKey, false);
}

let signingOut = false;

export async function signOut(notice = 'You’re logged out. See you soon.') {
  signingOut = true;
  leaveCall();
  stopSocial();
  stopWatchingSession();
  resetSettingsStore();
  resetExpressions();
  await forgetIdentities();
  // 'local': only this browser. The default ('global') also logs out every
  // other device, which looks like a random logout there.
  await supabase.auth.signOut({ scope: 'local' });
  signingOut = false;
  sessionStore.set({
    status: 'signed-out',
    session: null,
    identity: null,
    keyring: null,
    me: null,
    notice,
  });
}

export type ProfilePatch = Partial<
  Pick<
    Profile,
    | 'display_name' | 'avatar_color' | 'about' | 'pronouns' | 'status_text' | 'presence'
    | 'banner_color' | 'banner_color2' | 'accent_color' | 'nameplate' | 'language' | 'onboarded'
    | 'avatar_url' | 'banner_url' | 'avatar_frame' | 'name_style' | 'nameplate_style'
  >
>;

export async function updateMyProfile(patch: ProfilePatch) {
  const me = sessionStore.get().me;
  if (!me) return;
  const { data, error } = await supabase.from('profiles').update(patch).eq('id', me.id).select().single();
  if (error) throw error;
  putProfile(data as Profile);
  sessionStore.set({ me: data as Profile });
}

export async function changePassword(currentPassword: string, newPassword: string) {
  const { session } = sessionStore.get();
  if (!session?.user.email) throw new Error('Not signed in');
  const oldKeys = await deriveMasterKeys(session.user.email, currentPassword);
  if (!(await verifyVault(session.user.id, oldKeys.vaultKey))) throw new Error('Current password is incorrect.');
  const newKeys = await deriveMasterKeys(session.user.email, newPassword);
  const resealed = await resealStoredIdentity(session.user.id, oldKeys.vaultKey, newKeys.vaultKey);
  const { error } = await supabase.auth.updateUser({ password: newKeys.authPassword });
  if (error) throw error;
  await resealed.commit();
}
