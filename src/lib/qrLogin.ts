// QR code login.
//
// New device (login page): makes a 256-bit random code and a one-time key pair,
// shows www.venband.com/login/qr/code/<code> as a QR code, swaps it for a new
// one every 30 s, and polls until someone approves.
// Signed-in device: opens that link (phone camera or the in-app scanner),
// confirms, and the server makes a fresh sign-in for the same account, sealed to
// the new device's one-time key. Only a hash of the code is ever stored.
import { supabase } from './supabase';
import { sessionStore } from './session';

export const QR_LIFETIME_MS = 30_000;

const SITE = /(^|\.)venband\.com$/i.test(location.hostname) ? 'https://www.venband.com' : location.origin;
export const qrLoginUrl = (code: string) => `${SITE}/login/qr/code/${code}`;
/** The code inside a scanned link (or null if it isn't a Venband login QR). */
export function codeFromQr(text: string): string | null {
  return /\/login\/qr\/code\/([0-9a-f]{64})\b/i.exec(text.trim())?.[1]?.toLowerCase() ?? null;
}

export function newCode(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** A key pair that lives only in this tab; the private half can't be exported. */
export async function oneTimeKeys(): Promise<{ privateKey: CryptoKey; publicB64: string }> {
  const pair = (await crypto.subtle.generateKey(P256, false, ['deriveBits'])) as CryptoKeyPair;
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  return { privateKey: pair.privateKey, publicB64: btoa(String.fromCharCode(...spki)) };
}

async function unseal(sealed: string, privateKey: CryptoKey): Promise<{ token_hash: string; type: 'magiclink' }> {
  const { e, iv, ct } = JSON.parse(sealed) as { e: string; iv: string; ct: string };
  const ephPub = fromB64(e);
  const them = await crypto.subtle.importKey('spki', ephPub, P256, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: them }, privateKey, 256);
  const ikm = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: ephPub, info: new TextEncoder().encode('venband/v1/qr-login') }, ikm, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
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
  const { token_hash, type } = await unseal(sealed, privateKey);
  const { error } = await supabase.auth.verifyOtp({ token_hash, type });
  if (error) throw error;
}

// --------------------------------------------------- the signed-in device ---

export async function claimCode(code: string): Promise<{ device: string; created_at: string; expires_at: string }> {
  const { data, error } = await supabase.rpc('qr_login_scan', { p_code: code });
  if (error) throw error;
  return data;
}

export async function denyCode(code: string): Promise<void> {
  await supabase.rpc('qr_login_deny', { p_code: code });
}

export async function approveCode(code: string): Promise<void> {
  const token = sessionStore.get().session?.access_token;
  const r = await fetch('/api/oauth', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action: 'qr-approve', code }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error || `Approving failed (${r.status}).`);
}
