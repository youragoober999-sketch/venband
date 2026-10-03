// Caches for profiles and public identity keys, plus trust-on-first-use
// tracking of other users' keys.
import { supabase } from './supabase';
import { PROFILE_COLUMNS, type Profile, type UserKey } from './types';

type Listener = () => void;
const listeners = new Set<Listener>();
let version = 0;
function emit() {
  version++;
  listeners.forEach((l) => l());
}
export function subscribeDirectory(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function directoryVersion() {
  return version;
}

// ------------------------------------------------------------------ profiles

const profiles = new Map<string, Profile>();
const pendingProfiles = new Map<string, Promise<void>>();

export function getProfile(id: string): Profile | undefined {
  return profiles.get(id);
}

export function putProfile(p: Profile) {
  profiles.set(p.id, p);
  emit();
}

export async function loadProfiles(ids: Iterable<string>, force = false): Promise<void> {
  const missing = [...new Set(ids)].filter((id) => force || (!profiles.has(id) && !pendingProfiles.has(id)));
  const waits = [...new Set(ids)].map((id) => pendingProfiles.get(id)).filter(Boolean) as Promise<void>[];
  if (missing.length) {
    const p = (async () => {
      const { data } = await supabase.from('profiles').select(PROFILE_COLUMNS).in('id', missing);
      for (const row of (data ?? []) as unknown as Profile[]) profiles.set(row.id, row);
      missing.forEach((id) => pendingProfiles.delete(id));
      emit();
    })();
    missing.forEach((id) => pendingProfiles.set(id, p));
    waits.push(p);
  }
  await Promise.all(waits);
}

let personalNickname: (id: string) => string | null = () => null;
/** Lets the friends module supply private nicknames you gave people. */
export function setPersonalNicknames(fn: (id: string) => string | null) {
  personalNickname = fn;
}

/** Server nickname > your private nickname for them > their display name. */
export function displayName(id: string, nickname?: string | null): string {
  return nickname || personalNickname(id) || profiles.get(id)?.display_name || 'Unknown user';
}

// ---------------------------------------------------------------------- keys

const keysById = new Map<string, UserKey>();
const currentKeyByUser = new Map<string, UserKey>();

export async function getKeyById(keyId: string): Promise<UserKey | null> {
  const cached = keysById.get(keyId);
  if (cached) return cached;
  const { data } = await supabase.from('user_keys').select('*').eq('key_id', keyId).maybeSingle();
  if (data) keysById.set(keyId, data as UserKey);
  return (data as UserKey) ?? null;
}

export async function loadKeysById(keyIds: Iterable<string>): Promise<void> {
  const missing = [...new Set(keyIds)].filter((k) => !keysById.has(k));
  if (!missing.length) return;
  const { data } = await supabase.from('user_keys').select('*').in('key_id', missing);
  for (const k of (data ?? []) as UserKey[]) keysById.set(k.key_id, k);
}

export function cachedKey(keyId: string): UserKey | undefined {
  return keysById.get(keyId);
}

export async function getCurrentKey(userId: string, refresh = false): Promise<UserKey | null> {
  if (!refresh && currentKeyByUser.has(userId)) return currentKeyByUser.get(userId)!;
  const { data } = await supabase
    .from('user_keys')
    .select('*')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data) {
    currentKeyByUser.set(userId, data as UserKey);
    keysById.set(data.key_id, data as UserKey);
    observeKey(userId, data.key_id);
  }
  return (data as UserKey) ?? null;
}

// ------------------------------------------------------ trust on first use --
// We remember the first identity key we saw for each user. If it later
// changes (new device keys after a password reset, or a malicious server
// substituting keys) the UI warns until the user re-verifies.

let tofuOwner = '';
let tofu: Record<string, { keyId: string; verified: boolean }> = {};
const changedUsers = new Set<string>();

export function initTrust(myUserId: string) {
  tofuOwner = myUserId;
  try {
    tofu = JSON.parse(localStorage.getItem(`venband:trust:${myUserId}`) ?? '{}');
  } catch {
    tofu = {};
  }
  changedUsers.clear();
}

function saveTrust() {
  if (tofuOwner) localStorage.setItem(`venband:trust:${tofuOwner}`, JSON.stringify(tofu));
}

export function observeKey(userId: string, keyId: string) {
  if (!tofuOwner || userId === tofuOwner) return;
  const known = tofu[userId];
  if (!known) {
    tofu[userId] = { keyId, verified: false };
    saveTrust();
  } else if (known.keyId !== keyId && !changedUsers.has(userId)) {
    changedUsers.add(userId);
    emit();
  }
}

export type TrustState = 'unverified' | 'verified' | 'changed';

export function trustState(userId: string): TrustState {
  if (changedUsers.has(userId)) return 'changed';
  return tofu[userId]?.verified ? 'verified' : 'unverified';
}

export function markVerified(userId: string, keyId: string) {
  tofu[userId] = { keyId, verified: true };
  changedUsers.delete(userId);
  saveTrust();
  emit();
}

export function acceptKeyChange(userId: string, keyId: string) {
  tofu[userId] = { keyId, verified: false };
  changedUsers.delete(userId);
  saveTrust();
  emit();
}
