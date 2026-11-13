// QR code login.
//
// New device (login page): makes a 256-bit random code and a one-time key pair,
// shows www.venband.com/login/qr/code/<code> as a QR code, swaps it for a new
// one every 30 s, and polls until someone approves.
// Signed-in device: opens that link (phone camera or the in-app scanner),
// confirms, and the server makes a fresh sign-in for the same account, sealed to
// the new device's one-time key. Only a hash of the code is ever stored.
import { supabase } from './supabase';
import { sessionStore, signInWithOneTimeLink, transferQrIdentity } from './session';
import { fromB64, sha256, toB64, type SealedIdentity } from './crypto';

export const QR_LIFETIME_MS = 30_000;

const SITE = /(^|\.)venband\.com$/i.test(location.hostname) ? 'https://www.venband.com' : location.origin;
export const qrLoginUrl = (code: string) => `${SITE}${import.meta.env.BASE_URL}login/qr/code/${code}`;
/** The code inside a scanned link (or null if it isn't a Venband login QR). */
export function codeFromQr(text: string): string | null {
  try {
    const url = new URL(text.trim());
    if (url.origin !== SITE && url.origin !== location.origin) return null;
    const prefix = `${import.meta.env.BASE_URL}login/qr/code/`;
    if (!url.pathname.startsWith(prefix)) return null;
    const code = url.pathname.slice(prefix.length);
    return /^[0-9a-f]{64}$/i.test(code) ? code.toLowerCase() : null;
  } catch {
    return null;
  }
}

const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;
const keyFingerprint = async (spki: Uint8Array) =>
  [...await sha256(spki)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** A key pair that lives only in this tab; the private half can't be exported. */
export async function oneTimeKeys(): Promise<{ privateKey: CryptoKey; publicB64: string; code: string }> {
  const pair = (await crypto.subtle.generateKey(P256, false, ['deriveBits'])) as CryptoKeyPair;
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  return { privateKey: pair.privateKey, publicB64: toB64(spki), code: await keyFingerprint(spki) };
}

async function sharedKey(privateKey: CryptoKey, peer: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, purpose: string) {
  const publicKey = await crypto.subtle.importKey('spki', peer, P256, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const ikm = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(purpose) }, ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

type Transfer = { userId: string; publicKey: string; sealed: SealedIdentity };

async function unseal(sealed: string, privateKey: CryptoKey): Promise<{ token_hash: string; identity?: Transfer }> {
  const { e, iv, ct } = JSON.parse(sealed) as { e: string; iv: string; ct: string };
  const peer = fromB64(e);
  const key = await sharedKey(privateKey, peer, peer, 'venband/v1/qr-login');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

/** "Chrome on Windows" — shown on the approving device so you know what you're letting in. */
export function deviceLabel(ua = navigator.userAgent): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Electron\//.test(ua) ? 'Venband desktop' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'A browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'an unknown system';
  return `${browser} on ${os}`;
}

// ------------------------------------------------------- the new device ----

export async function startCode(code: string, publicB64: string, previous: string | null): Promise<void> {
  const { error } = await supabase.rpc('qr_login_start', { p_code: code, p_pubkey: publicB64, p_device: deviceLabel(), p_previous: previous });
  if (error) throw error;
}

export type QrState =
  | { state: 'waiting' | 'expired' | 'denied' }
  | { state: 'scanned'; name?: string; avatar_url?: string | null; avatar_color?: string }
  | { state: 'approved'; sealed: string };

export async function codeStatus(code: string): Promise<QrState> {
  const { data, error } = await supabase.rpc('qr_login_status', { p_code: code });
  if (error) throw error;
  return data as QrState;
}

/** Open the sealed sign-in and sign this device in with it. */
export async function finishLogin(sealed: string, privateKey: CryptoKey): Promise<void> {
  const { token_hash, identity } = await unseal(sealed, privateKey);
  if (!identity) return signInWithOneTimeLink(token_hash);
  const peer = fromB64(identity.publicKey);
  const key = await sharedKey(privateKey, peer, peer, 'venband/v1/qr-identity');
  await signInWithOneTimeLink(token_hash, { userId: identity.userId, sealed: identity.sealed, key });
}

// --------------------------------------------------- the signed-in device ---

export async function claimCode(code: string): Promise<{ device: string; created_at: string; expires_at: string; public_key: string }> {
  const { data, error } = await supabase.rpc('qr_login_scan', { p_code: code });
  if (error) throw error;
  return data;
}

export async function denyCode(code: string): Promise<void> {
  await supabase.rpc('qr_login_deny', { p_code: code });
}

export async function approveCode(code: string, publicKey: string, password: string): Promise<void> {
  const receiver = fromB64(publicKey);
  if (await keyFingerprint(receiver) !== code) throw new Error('This QR code needs to be refreshed on the other device.');
  const sender = await oneTimeKeys();
  const key = await sharedKey(sender.privateKey, receiver, fromB64(sender.publicB64), 'venband/v1/qr-identity');
  const userId = sessionStore.get().identity?.userId;
  const sealed = await transferQrIdentity(key, password);
  const identity = { userId, publicKey: sender.publicB64, sealed };

  const token = sessionStore.get().session?.access_token;
  const r = await fetch('/api/oauth', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action: 'qr-approve', code, identity }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error || `Approving failed (${r.status}).`);
}
