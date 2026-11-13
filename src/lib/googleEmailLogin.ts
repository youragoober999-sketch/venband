import { randomBytes, sha256, toB64Url } from './crypto';
import { appUrl } from './supabase';

const STORAGE_KEY = 'venband:google-email-login';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '319530075746-jvmsth0p5h4c36cdiu2q0spl1ccli8sf.apps.googleusercontent.com';

export function googleChooserSupported() {
  const host = window as Window & { venbandDesktop?: unknown; Capacitor?: { isNativePlatform?: () => boolean } };
  return !host.venbandDesktop && !host.Capacitor?.isNativePlatform?.();
}

const callbackUrl = () => new URL('sign-in?google=1', appUrl()).href;

export async function startGoogleEmailLogin() {
  const state = toB64Url(randomBytes(32));
  const verifier = toB64Url(randomBytes(32));
  const challenge = toB64Url(await sha256(verifier));
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ state, verifier, expires: Date.now() + 10 * 60_000 }));
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID, redirect_uri: callbackUrl(), response_type: 'code',
    scope: 'openid email', prompt: 'select_account', state, code_challenge: challenge, code_challenge_method: 'S256',
  }).toString();
  location.assign(url.href);
}

let completion: Promise<{ email: string } | { tokenHash: string }> | undefined;

export function completeGoogleEmailLogin(params: URLSearchParams) {
  return completion ??= exchangeGoogleCode(params);
}

async function exchangeGoogleCode(params: URLSearchParams): Promise<{ email: string } | { tokenHash: string }> {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
  const pending = raw ? JSON.parse(raw) as { state: string; verifier: string; expires: number } : null;
  if (!pending || pending.expires < Date.now() || params.get('state') !== pending.state) {
    throw new Error('That Google sign-in expired. Choose your account again.');
  }
  const code = params.get('code');
  if (!code) throw new Error('Google sign-in was canceled. Choose your account again to continue.');
  const response = await fetch(new URL('api/oauth', appUrl()), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'google-email-login', code, code_verifier: pending.verifier, redirect_uri: callbackUrl() }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || (!result?.email && !result?.tokenHash)) {
    throw new Error(result?.error || 'Google sign-in is unavailable. You can request an email code instead.');
  }
  return result;
}
