// Multiple accounts on one device (up to 5), switched in one click.
//
// Each account keeps its own sign-in session here. Switching swaps the
// session in place — it never signs anyone out, so nothing is revoked and the
// encryption keys each account remembered on this device stay put (switching
// to an account you've unlocked here before goes straight in; otherwise it asks
// for that account's password). These tokens are what Supabase already keeps in
// this browser for the current account, just one set per account.
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Profile } from './types';

export interface SavedAccount {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  avatarColor: string;
  avatarFrame: string | null;
  email: string | null;
  accessToken?: string;
  refreshToken?: string;
  /** the saved sign-in no longer works: sign in with the password again */
  needsSignIn?: boolean;
  lastUsed: number;
}

const KEY = 'venband:accounts:v2';
export const MAX_ACCOUNTS = 5;
const listeners = new Set<() => void>();

function read(): SavedAccount[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || 'null') as SavedAccount[] | null;
    if (Array.isArray(list)) return list.filter((a) => a && a.userId);
    // older versions only kept usernames: keep them, they just need a sign-in
    const legacy = JSON.parse(localStorage.getItem('venband:accounts') || '[]') as (string | { username?: string; displayName?: string; avatarUrl?: string | null })[];
    return legacy
      .map((a) => (typeof a === 'string' ? { username: a } : a))
      .filter((a) => a?.username)
      .map((a, i) => ({ userId: `legacy:${a.username}`, username: a.username!, displayName: (a as { displayName?: string }).displayName || a.username!, avatarUrl: (a as { avatarUrl?: string | null }).avatarUrl ?? null, avatarColor: '#5b5bf0', avatarFrame: null, email: null, needsSignIn: true, lastUsed: i }));
  } catch {
    return [];
  }
}
function write(list: SavedAccount[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ACCOUNTS)));
    localStorage.removeItem('venband:accounts');
    localStorage.removeItem('venband:dontAskAccount');
  } catch {
    /* storage blocked */
  }
  listeners.forEach((l) => l());
}

export const listAccounts = () => read().sort((a, b) => b.lastUsed - a.lastUsed);
export function onAccountsChanged(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** Remember (or refresh) the account that's signed in now. */
export function rememberCurrent(me: Profile, session: Session) {
  const list = read().filter((a) => a.userId !== me.id && a.username !== me.username);
  list.unshift({
    userId: me.id,
    username: me.username,
    displayName: me.display_name || me.username,
    avatarUrl: me.avatar_url ?? null,
    avatarColor: me.avatar_color || '#5b5bf0',
    avatarFrame: me.avatar_frame ?? null,
    email: session.user.email ?? null,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    lastUsed: Date.now(),
  });
  write(list);
}

/** Keep the current account's saved tokens fresh as Supabase rotates them. */
let watching = false;
export function watchTokens() {
  if (watching) return;
  watching = true;
  supabase.auth.onAuthStateChange((event, session) => {
    if (!session || (event !== 'TOKEN_REFRESHED' && event !== 'SIGNED_IN')) return;
    const list = read();
    const a = list.find((x) => x.userId === session.user.id);
    if (!a) return;
    a.accessToken = session.access_token;
    a.refreshToken = session.refresh_token;
    a.needsSignIn = false;
    write(list);
  });
}

/** Forget the sign-in in this tab only, without telling the server (so saved sessions stay valid). */
function dropLocalSession() {
  try {
    for (const k of Object.keys(localStorage)) if (/^sb-.*-auth-token(-code-verifier)?$/.test(k)) localStorage.removeItem(k);
  } catch {
    /* storage blocked */
  }
}

export async function switchTo(target: SavedAccount) {
  // save where the current account is up to, so switching back is instant too
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    const list = read();
    const cur = list.find((x) => x.userId === data.session!.user.id);
    if (cur) {
      cur.accessToken = data.session.access_token;
      cur.refreshToken = data.session.refresh_token;
      write(list);
    }
  }
  if (!target.refreshToken || target.needsSignIn) return signInAs(target);
  const { error } = await supabase.auth.setSession({ access_token: target.accessToken ?? '', refresh_token: target.refreshToken });
  if (error) {
    const list = read();
    const t = list.find((x) => x.userId === target.userId);
    if (t) {
      t.needsSignIn = true;
      t.refreshToken = undefined;
      t.accessToken = undefined;
      write(list);
    }
    return signInAs(target);
  }
  location.assign('/channels/@me');
}

/** Go to the sign-in page for this account (its saved sign-in expired, or there wasn't one). */
export function signInAs(target: Pick<SavedAccount, 'email' | 'username'> | null) {
  dropLocalSession();
  const who = target?.email || target?.username || '';
  location.assign(`/login${who ? `?account=${encodeURIComponent(who)}` : ''}`);
}

export const addAccount = () => signInAs(null);

export function removeAccount(userId: string) {
  write(read().filter((a) => a.userId !== userId));
}
export function forgetAllAccounts() {
  write([]);
}
