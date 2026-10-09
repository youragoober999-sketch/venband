// Venband cryptography primitives.
//
// Everything here runs in the browser via WebCrypto (plus Argon2id from
// hash-wasm). Nothing in this file talks to the network.
//
//   password --Argon2id--> master --HKDF--> authPassword  (sent to Supabase Auth)
//                                   \-HKDF--> vaultKey      (never leaves the device)
//
//   vaultKey encrypts the user's identity private keys (ECDH P-256 for key
//   agreement, ECDSA P-256 for signatures) before they are stored server-side.
//
//   Every channel has one random AES-256-GCM key per "epoch". Epoch keys are
//   wrapped for each member with ECIES (ephemeral ECDH + HKDF + AES-GCM) and
//   signed by the member who wrapped them. Messages are AES-GCM encrypted with
//   the epoch key and signed by the author.

import { argon2id } from 'hash-wasm';

const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
const td = new TextDecoder();

// ---------------------------------------------------------------- encoding --

export function toB64(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) {
    s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toB64Url(bytes: Uint8Array | ArrayBuffer): string {
  return toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export async function sha256(data: Uint8Array | string): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = typeof data === 'string' ? te.encode(data) : data;
  return new Uint8Array(await subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
}

/** Constant-time comparison of two strings (for MACs / commitments). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ------------------------------------------------------- password handling --

export const KDF_PARAMS = {
  memorySize: 64 * 1024, // KiB -> 64 MiB
  iterations: 3,
  parallelism: 1,
} as const;

export interface MasterKeys {
  /** Hex string used as the Supabase Auth password. Reveals nothing about vaultKey. */
  authPassword: string;
  /** Non-extractable AES-256-GCM key that protects the identity private keys. */
  vaultKey: CryptoKey;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function deriveMasterKeys(email: string, password: string): Promise<MasterKeys> {
  if (!password) throw new Error('Enter your password to continue.');
  const master = await argonMaster(email, password);
  return deriveKeysFromMaster(master);
}

/** Argon2id(password, salt=sha256(email)) → the 32-byte master secret. */
export async function argonMaster(email: string, password: string): Promise<Uint8Array> {
  const salt = await sha256(`venband/v1/salt/${normalizeEmail(email)}`);
  return argon2id({
    password: password.normalize('NFKC'),
    salt,
    ...KDF_PARAMS,
    hashLength: 32,
    outputType: 'binary',
  });
}

/** HKDF(master) → authPassword + vaultKey. Zeroes the master afterwards. */
export async function deriveKeysFromMaster(master: Uint8Array<ArrayBuffer> | Uint8Array): Promise<MasterKeys> {
  const hkdf = await subtle.importKey('raw', master as Uint8Array<ArrayBuffer>, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const bytes = new Uint8Array(master);
  bytes.fill(0);
  const authBits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: te.encode('venband/v1/auth') },
    hkdf,
    256,
  );
  const vaultKey = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: te.encode('venband/v1/vault') },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return { authPassword: toHex(new Uint8Array(authBits)), vaultKey };
}

/** Rough password strength estimate in bits (length * charset). */
export function passwordStrength(pw: string): { bits: number; label: string; ok: boolean } {
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
  const unique = new Set(pw).size;
  const bits = Math.round(Math.min(pw.length, unique * 2) * Math.log2(Math.max(pool, 1)));
  const label = bits < 40 ? 'Weak' : bits < 60 ? 'Okay' : bits < 80 ? 'Strong' : 'Very strong';
  return { bits, label, ok: pw.length >= 10 && bits >= 50 };
}

// ---------------------------------------------------------------- identity --

export interface Identity {
  userId: string;
  keyId: string;
  encPrivate: CryptoKey; // ECDH P-256
  signPrivate: CryptoKey; // ECDSA P-256
  encPublic: string; // SPKI base64
  signPublic: string; // SPKI base64
}

export interface SealedIdentity {
  keyId: string;
  iv: string;
  ciphertext: string;
}

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ECDSA_SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const;

export async function computeKeyId(encPublic: string, signPublic: string): Promise<string> {
  const h = await sha256(concat(fromB64(encPublic), fromB64(signPublic)));
  return toB64Url(h).slice(0, 32);
}

/** Human comparable fingerprint of a user's identity keys (12 groups of 5 digits). */
export async function fingerprint(encPublic: string, signPublic: string): Promise<string> {
  let h = await sha256(concat(te.encode('venband/v1/fingerprint'), fromB64(encPublic), fromB64(signPublic)));
  for (let i = 0; i < 1024; i++) h = await sha256(h); // slow down brute-force of collisions
  const groups: string[] = [];
  for (let i = 0; i < 12; i++) {
    const n = ((h[i * 2] << 16) | (h[i * 2 + 1] << 8) | h[(i + 20) % 32]) % 100000;
    groups.push(n.toString().padStart(5, '0'));
  }
  return groups.join(' ');
}

function vaultAad(userId: string, keyId: string) {
  return te.encode(`venband/v1/identity|${userId}|${keyId}`);
}

/** Generate a fresh identity. Returns the sealed (vault-encrypted) form and the usable keys. */
export async function createIdentity(
  userId: string,
  vaultKey: CryptoKey,
): Promise<{ identity: Identity; sealed: SealedIdentity }> {
  const enc = (await subtle.generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair;
  const sign = (await subtle.generateKey(ECDSA, true, ['sign', 'verify'])) as CryptoKeyPair;
  const encPublic = toB64(await subtle.exportKey('spki', enc.publicKey));
  const signPublic = toB64(await subtle.exportKey('spki', sign.publicKey));
  const keyId = await computeKeyId(encPublic, signPublic);
  const secret: IdentitySecret = {
    v: 1,
    enc: toB64(await subtle.exportKey('pkcs8', enc.privateKey)),
    sign: toB64(await subtle.exportKey('pkcs8', sign.privateKey)),
    encPublic,
    signPublic,
  };
  const sealed = await sealSecret(userId, keyId, secret, vaultKey);
  const identity = await importIdentity(userId, keyId, secret);
  return { identity, sealed };
}

interface IdentitySecret {
  v: 1;
  enc: string;
  sign: string;
  encPublic: string;
  signPublic: string;
}

async function sealSecret(userId: string, keyId: string, secret: IdentitySecret, vaultKey: CryptoKey) {
  const iv = randomBytes(12);
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: vaultAad(userId, keyId) },
    vaultKey,
    te.encode(JSON.stringify(secret)),
  );
  return { keyId, iv: toB64(iv), ciphertext: toB64(ct) };
}

async function openSecret(userId: string, sealed: SealedIdentity, vaultKey: CryptoKey): Promise<IdentitySecret> {
  const pt = await subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(sealed.iv), additionalData: vaultAad(userId, sealed.keyId) },
    vaultKey,
    fromB64(sealed.ciphertext),
  );
  const secret = JSON.parse(td.decode(pt)) as IdentitySecret;
  if (secret.v !== 1 || (await computeKeyId(secret.encPublic, secret.signPublic)) !== sealed.keyId) {
    throw new Error('identity key id mismatch');
  }
  return secret;
}

async function importIdentity(userId: string, keyId: string, s: IdentitySecret): Promise<Identity> {
  // Runtime copies are NON-extractable: page scripts can use but never export them.
  const encPrivate = await subtle.importKey('pkcs8', fromB64(s.enc), ECDH, false, ['deriveBits']);
  const signPrivate = await subtle.importKey('pkcs8', fromB64(s.sign), ECDSA, false, ['sign']);
  return { userId, keyId, encPrivate, signPrivate, encPublic: s.encPublic, signPublic: s.signPublic };
}

/** Decrypt a sealed identity. Throws if the vault key is wrong (e.g. after a password reset). */
export async function unsealIdentity(userId: string, sealed: SealedIdentity, vaultKey: CryptoKey): Promise<Identity> {
  return importIdentity(userId, sealed.keyId, await openSecret(userId, sealed, vaultKey));
}

/** Re-encrypt a sealed identity under a new vault key (password change). */
export async function resealIdentity(
  userId: string,
  sealed: SealedIdentity,
  oldVault: CryptoKey,
  newVault: CryptoKey,
): Promise<SealedIdentity> {
  const secret = await openSecret(userId, sealed, oldVault);
  return sealSecret(userId, sealed.keyId, secret, newVault);
}

// -------------------------------------------------------------- signatures --

const verifyKeyCache = new Map<string, Promise<CryptoKey>>();

function importVerifyKey(signPublic: string): Promise<CryptoKey> {
  let k = verifyKeyCache.get(signPublic);
  if (!k) {
    k = subtle.importKey('spki', fromB64(signPublic), ECDSA, false, ['verify']);
    verifyKeyCache.set(signPublic, k);
  }
  return k;
}

export async function sign(identity: Identity, message: string): Promise<string> {
  return toB64(await subtle.sign(ECDSA_SIGN, identity.signPrivate, te.encode(message)));
}

export async function verify(signPublic: string, signature: string, message: string): Promise<boolean> {
  try {
    return await subtle.verify(ECDSA_SIGN, await importVerifyKey(signPublic), fromB64(signature), te.encode(message));
  } catch {
    return false;
  }
}

// ------------------------------------------------------------ channel keys --

export function newChannelKey(): Uint8Array<ArrayBuffer> {
  return randomBytes(32);
}

/** Commitment to an epoch key so recipients can reject wraps of a wrong key. */
export async function channelKeyCheck(raw: Uint8Array<ArrayBuffer>, channelId: string, epoch: number): Promise<string> {
  const k = await subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toB64(await subtle.sign('HMAC', k, te.encode(`venband/v1/key-check|${channelId}|${epoch}`)));
}

export interface WrappedKey {
  ephemeralPublic: string;
  iv: string;
  wrapped: string;
}

async function eciesKey(shared: ArrayBuffer, ephPublicRaw: Uint8Array<ArrayBuffer>, context: string) {
  const ikm = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: ephPublicRaw, info: te.encode(`venband/v1/wrap|${context}`) },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** ECIES-encrypt a channel key to a recipient's ECDH public key. */
export async function wrapKey(raw: Uint8Array<ArrayBuffer>, recipientEncPublic: string, context: string): Promise<WrappedKey> {
  const recipient = await subtle.importKey('spki', fromB64(recipientEncPublic), ECDH, false, []);
  const eph = (await subtle.generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair;
  const ephPublic = new Uint8Array(await subtle.exportKey('spki', eph.publicKey));
  const shared = await subtle.deriveBits({ name: 'ECDH', public: recipient }, eph.privateKey, 256);
  const kek = await eciesKey(shared, ephPublic, context);
  const iv = randomBytes(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(context) }, kek, raw);
  return { ephemeralPublic: toB64(ephPublic), iv: toB64(iv), wrapped: toB64(ct) };
}

export async function unwrapKey(identity: Identity, w: WrappedKey, context: string): Promise<Uint8Array<ArrayBuffer>> {
  const ephPublic = fromB64(w.ephemeralPublic);
  const eph = await subtle.importKey('spki', ephPublic, ECDH, false, []);
  const shared = await subtle.deriveBits({ name: 'ECDH', public: eph }, identity.encPrivate, 256);
  const kek = await eciesKey(shared, ephPublic, context);
  return new Uint8Array(
    await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(w.iv), additionalData: te.encode(context) }, kek, fromB64(w.wrapped)),
  );
}

export function wrapContext(channelId: string, epoch: number, recipientId: string, recipientKeyId: string) {
  return `${channelId}|${epoch}|${recipientId}|${recipientKeyId}`;
}

export function wrapSignaturePayload(
  channelId: string,
  epoch: number,
  recipientId: string,
  recipientKeyId: string,
  wrapperId: string,
  wrapperKeyId: string,
  w: WrappedKey,
) {
  return [
    'venband/v1/wrap-sig',
    channelId,
    epoch,
    recipientId,
    recipientKeyId,
    wrapperId,
    wrapperKeyId,
    w.ephemeralPublic,
    w.iv,
    w.wrapped,
  ].join('|');
}

// ---------------------------------------------------------------- messages --

export interface Attachment {
  /** blurred until clicked */
  spoiler?: boolean;
  /** caption / alt text for screen readers */
  alt?: string;
  path: string;
  name: string;
  mime: string;
  size: number;
  key: string; // AES-256-GCM key for the blob, base64
  iv: string;
  /** large files: number of 8 MiB pieces stored under `path/<n>.bin` */
  chunks?: number;
  chunkSize?: number;
}

export interface MessagePayload {
  v: 1;
  text: string;
  attachments?: Attachment[];
  sentAt: number;
  /** set when this message was forwarded from somewhere else */
  forwarded?: { author: string; at: string };
  /** a poll: question and options stay encrypted; the server only counts option numbers */
  poll?: { question: string; options: string[]; multi?: boolean; anonymous?: boolean; expiresAt?: number | null };
  /** quoted message preview */
  quote?: { id: string; author: string; text: string; channel: string };
  /** link preview made by the sender (so receivers never contact the site) */
  preview?: { url: string; title?: string; description?: string; siteName?: string; image?: string; themeColor?: string };
}

export interface MessageEnvelope {
  iv: string;
  ciphertext: string;
  signature: string;
}

const aesCache = new WeakMap<Uint8Array, Promise<CryptoKey>>();
function aesKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  let k = aesCache.get(raw);
  if (!k) {
    k = subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    aesCache.set(raw, k);
  }
  return k;
}

function messageAad(messageId: string, channelId: string, authorId: string, authorKeyId: string, epoch: number) {
  return `venband/v1/msg|${messageId}|${channelId}|${authorId}|${authorKeyId}|${epoch}`;
}

/**
 * Every message gets its own AES-256-GCM key, never reused: a fresh random
 * 128-bit salt is drawn per message (and per edit) and the message key is
 * HKDF-SHA256(channel epoch key, salt, info = everything the message is bound
 * to). The salt travels in the `iv` column as "v2:<iv>:<salt>" and is covered
 * by the author's signature. Messages from before this change ("v1", a bare
 * IV) are still decrypted with the epoch key directly.
 */
const MSG_V2 = 'v2:';

const hkdfCache = new WeakMap<Uint8Array, Promise<CryptoKey>>();
function hkdfBase(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  let k = hkdfCache.get(raw);
  if (!k) {
    k = subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
    hkdfCache.set(raw, k);
  }
  return k;
}

async function messageKey(raw: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, aad: string): Promise<CryptoKey> {
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: te.encode(`venband/v2/message-key|${aad}`) },
    await hkdfBase(raw),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptMessage(
  identity: Identity,
  raw: Uint8Array<ArrayBuffer>,
  messageId: string,
  channelId: string,
  epoch: number,
  payload: MessagePayload,
): Promise<MessageEnvelope> {
  const aad = messageAad(messageId, channelId, identity.userId, identity.keyId, epoch);
  const iv = randomBytes(12);
  const salt = randomBytes(16);
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: te.encode(aad) },
    await messageKey(raw, salt, aad),
    te.encode(JSON.stringify(payload)),
  );
  const ivField = `${MSG_V2}${toB64(iv)}:${toB64(salt)}`;
  const ctB64 = toB64(ct);
  const signature = await sign(identity, `${aad}|${ivField}|${ctB64}`);
  return { iv: ivField, ciphertext: ctB64, signature };
}

export async function decryptMessage(
  raw: Uint8Array<ArrayBuffer>,
  authorSignPublic: string,
  messageId: string,
  channelId: string,
  authorId: string,
  authorKeyId: string,
  epoch: number,
  env: MessageEnvelope,
): Promise<MessagePayload> {
  const aad = messageAad(messageId, channelId, authorId, authorKeyId, epoch);
  if (!(await verify(authorSignPublic, env.signature, `${aad}|${env.iv}|${env.ciphertext}`))) {
    throw new Error('bad signature');
  }
  let iv: Uint8Array<ArrayBuffer>;
  let key: CryptoKey;
  if (env.iv.startsWith(MSG_V2)) {
    const [ivB64, saltB64] = env.iv.slice(MSG_V2.length).split(':');
    iv = fromB64(ivB64);
    const salt = fromB64(saltB64 ?? '');
    if (iv.length !== 12 || salt.length !== 16) throw new Error('bad envelope');
    key = await messageKey(raw, salt, aad);
  } else {
    iv = fromB64(env.iv); // v1: one key per channel epoch
    key = await aesKey(raw);
  }
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, key, fromB64(env.ciphertext));
  const payload = JSON.parse(td.decode(pt)) as MessagePayload;
  if (payload.v !== 1 || typeof payload.text !== 'string') throw new Error('bad payload');
  return payload;
}

/** v1 encryption, kept only so tests can prove old messages still open. */
export async function encryptMessageV1ForTests(
  identity: Identity,
  raw: Uint8Array<ArrayBuffer>,
  messageId: string,
  channelId: string,
  epoch: number,
  payload: MessagePayload,
): Promise<MessageEnvelope> {
  const aad = messageAad(messageId, channelId, identity.userId, identity.keyId, epoch);
  const iv = randomBytes(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, await aesKey(raw), te.encode(JSON.stringify(payload)));
  const ivB64 = toB64(iv);
  const ctB64 = toB64(ct);
  return { iv: ivB64, ciphertext: ctB64, signature: await sign(identity, `${aad}|${ivB64}|${ctB64}`) };
}

export async function encryptBlob(data: ArrayBuffer): Promise<{ blob: Uint8Array<ArrayBuffer>; key: string; iv: string }> {
  const raw = randomBytes(32);
  const iv = randomBytes(12);
  const k = await subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, k, data));
  return { blob: ct, key: toB64(raw), iv: toB64(iv) };
}

export async function decryptBlob(data: ArrayBuffer, key: string, iv: string): Promise<ArrayBuffer> {
  const k = await subtle.importKey('raw', fromB64(key), 'AES-GCM', false, ['decrypt']);
  return subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, k, data);
}

// ------------------------------------------------------------- call signing --

export function sdpSignaturePayload(
  channelId: string,
  fromSession: string,
  fromUser: string,
  toSession: string,
  type: string,
  sdp: string,
) {
  return `venband/v1/sdp|${channelId}|${fromSession}|${fromUser}|${toSession}|${type}|${sdp}`;
}
