// Passkey unlock (WebAuthn PRF). A platform passkey (Windows Hello, Google
// Password Manager, iCloud/iOS) can deterministically derive a 32-byte PRF
// value that only this device's passkey can produce. Venband wraps a copy of
// the argon master secret with it, so "log in with email" can unlock your
// messages on this device without typing the password again.
import { deriveKeysFromMaster } from './crypto';
import type { Identity } from './crypto';
import { loadIdentity, rememberIdentity } from './identity';

export interface PasskeyRecord {
  credId: string; // base64url credential id
  salt: string; // base64url PRF evaluation salt (fixed at registration)
  master: string; // base64url AES-GCM(iv + ciphertext) of the master secret
}

const KEY = (userId: string) => `venband:passkey:${userId}`;

export function isPasskeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'credentials' in navigator &&
    !!window.PublicKeyCredential &&
    window.isSecureContext
  );
}

export function hasPasskey(userId: string): boolean {
  try {
    return Boolean(localStorage.getItem(KEY(userId)));
  } catch {
    return false;
  }
}

export function removePasskey(userId: string) {
  try {
    localStorage.removeItem(KEY(userId));
  } catch {
    /* ignore */
  }
}

function b64url(bytes: ArrayBufferLike): string {
  const b = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s: string): Uint8Array {
  const buf = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf.charCodeAt(i);
  return out;
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

async function aesKey(prf: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', prf, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function wrap(bytes: Uint8Array, key: CryptoKey): Promise<string> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, bytes as BufferSource);
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), iv.length);
  return b64url(out.buffer);
}

async function unwrap(bundle: string, key: CryptoKey): Promise<Uint8Array> {
  const raw = unb64url(bundle);
  const iv = raw.slice(0, 12);
  const ct = raw.slice(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource);
  return new Uint8Array(pt);
}

/** The challenge/user ids the authenticator sees. Stable per account. */
async function publicKeyOptions(userId: string, challenge: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId));
  return { userIdBytes: new Uint8Array(digest), challenge };
}

/**
 * Register a platform passkey for this account. Returns the record to keep
 * locally (the master secret wrapped by the passkey's PRF value).
 */
export async function registerPasskey(userId: string, email: string, master: Uint8Array): Promise<PasskeyRecord> {
  if (!isPasskeySupported()) throw new Error('This device doesn’t support passkeys.');
  const salt = randomBytes(32);
  const { userIdBytes } = await publicKeyOptions(userId, randomBytes(32));
  // Sending eval.first on create pins the PRF salt to this credential.
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: userIdBytes as unknown as BufferSource,
      rp: { name: 'Venband', id: window.location.hostname },
      user: { id: userIdBytes as unknown as BufferSource, name: email, displayName: 'Venband' },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'preferred' },
      timeout: 60_000,
      store: true,
      // @ts-expect-error prf is a newer WebAuthn extension
      extensions: { prf: { eval: { first: b64url(salt.buffer) } } },
    },
  })) as PublicKeyCredential;

  const prf = (credential.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } }).prf?.results?.first;
  if (!prf) throw new Error('This device’s passkey didn’t produce an unlock key. Try a device with passkey support (Windows Hello, Google Password Manager, or iCloud).');
  const record: PasskeyRecord = {
    credId: b64url(credential.rawId),
    salt: b64url(salt.buffer),
    master: await wrap(master, await aesKey(prf)),
  };
  try {
    localStorage.setItem(KEY(userId), JSON.stringify(record));
  } catch {
    throw new Error('Couldn’t save the passkey on this device.');
  }
  return record;
}

/**
 * Unlock with the device passkey: reproduce the PRF value, unwrap the master
 * secret and build the vault key. Returns the unlocked identity (or null when
 * no passkey is registered).
 */
export async function unlockWithPasskey(userId: string, _email: string): Promise<Identity | null> {
  let record: PasskeyRecord | null = null;
  try {
    const raw = localStorage.getItem(KEY(userId));
    record = raw ? (JSON.parse(raw) as PasskeyRecord) : null;
  } catch {
    record = null;
  }
  if (!record || !isPasskeySupported()) return null;

  const challenge = randomBytes(32);
  const outcome = (await navigator.credentials.get({
    publicKey: {
      challenge: challenge.buffer as BufferSource,
      allowCredentials: [
        {
          type: 'public-key',
          id: unb64url(record.credId).buffer as BufferSource,
          transports: ['internal', 'hybrid'],
        },
      ],
      userVerification: 'preferred',
      timeout: 60_000,
      // @ts-expect-error prf is a newer WebAuthn extension
      extensions: { prf: { evalByCredential: { [record.credId]: { first: record.salt } } } },
    },
  })) as PublicKeyCredential | null;
  if (!outcome) return null;

  const prf = (outcome.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } }).prf?.results?.first;
  if (!prf) throw new Error('The passkey didn’t produce an unlock key.');
  const master = await unwrap(record.master, await aesKey(prf));
  const { vaultKey } = await deriveKeysFromMaster(master);
  master.fill(0);
  const identity = await loadIdentity(userId, vaultKey);
  await rememberIdentity(identity);
  return identity;
}