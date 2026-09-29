// Loading, creating and persisting the user's identity keys.
import { supabase } from './supabase';
import { createIdentity, resealIdentity, unsealIdentity, type Identity, type SealedIdentity } from './crypto';

export class IdentityLockedError extends Error {
  constructor() {
    super('Your encryption keys could not be unlocked with this password.');
  }
}

async function fetchSealed(userId: string): Promise<SealedIdentity | null> {
  const { data, error } = await supabase
    .from('user_private_keys')
    .select('key_id, iv, ciphertext')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Reading your saved keys failed: ${error.message}`);
  return data ? { keyId: data.key_id, iv: data.iv, ciphertext: data.ciphertext } : null;
}

async function publish(identity: Identity, sealed: SealedIdentity, isNew: boolean) {
  const { error: e1 } = await supabase.from('user_keys').insert({
    key_id: identity.keyId,
    user_id: identity.userId,
    enc_public: identity.encPublic,
    sign_public: identity.signPublic,
  });
  if (e1) throw new Error(`Saving your public key failed: ${e1.message}`);
  const row = { user_id: identity.userId, key_id: sealed.keyId, iv: sealed.iv, ciphertext: sealed.ciphertext };
  const { error: e2 } = isNew
    ? await supabase.from('user_private_keys').insert(row)
    : await supabase.from('user_private_keys').update({ ...row, updated_at: new Date().toISOString() }).eq('user_id', identity.userId);
  if (e2) throw new Error(`Saving your encrypted private key failed: ${e2.message}`);
}

/**
 * Unlock (or on first login create) the identity of the signed-in user.
 * Throws IdentityLockedError when the stored keys can't be opened with vaultKey.
 */
export async function loadIdentity(userId: string, vaultKey: CryptoKey): Promise<Identity> {
  const sealed = await fetchSealed(userId);
  if (!sealed) {
    const { identity, sealed: s } = await createIdentity(userId, vaultKey);
    await publish(identity, s, true);
    return identity;
  }
  try {
    return await unsealIdentity(userId, sealed, vaultKey);
  } catch {
    throw new IdentityLockedError();
  }
}

/** Replace the identity (after a password reset). Old messages become unreadable to this account. */
export async function resetIdentity(userId: string, vaultKey: CryptoKey): Promise<Identity> {
  const existing = await fetchSealed(userId);
  const { identity, sealed } = await createIdentity(userId, vaultKey);
  await publish(identity, sealed, !existing);
  return identity;
}

/** Re-encrypt the stored identity for a new password. */
export async function resealStoredIdentity(userId: string, oldVault: CryptoKey, newVault: CryptoKey) {
  const sealed = await fetchSealed(userId);
  if (!sealed) throw new Error('No identity stored');
  const next = await resealIdentity(userId, sealed, oldVault, newVault);
  return {
    async commit() {
      const { error } = await supabase
        .from('user_private_keys')
        .update({ iv: next.iv, ciphertext: next.ciphertext, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
      if (error) throw error;
    },
  };
}

export async function verifyVault(userId: string, vaultKey: CryptoKey): Promise<boolean> {
  const sealed = await fetchSealed(userId);
  if (!sealed) return false;
  try {
    await unsealIdentity(userId, sealed, vaultKey);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------ "remember this device" ----
// Non-extractable CryptoKeys can be stored in IndexedDB: the browser keeps the
// key material, scripts can use it but can never read it back out.

const DB = 'venband';
const STORE = 'identity';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function rememberIdentity(identity: Identity) {
  await tx('readwrite', (s) => s.put(identity, identity.userId));
}

export async function recallIdentity(userId: string): Promise<Identity | null> {
  try {
    const v = await tx<Identity | undefined>('readonly', (s) => s.get(userId));
    return v ?? null;
  } catch {
    return null;
  }
}

export async function forgetIdentities() {
  try {
    await tx('readwrite', (s) => s.clear());
  } catch {
    /* ignore */
  }
}
