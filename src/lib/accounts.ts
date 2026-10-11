// Several accounts on one device: switch between them without logging out.
//
// Each account you've used here is kept in a short list with the refresh
// token of its login (the same thing Supabase keeps for the account you're
// in). Switching swaps the active login and reloads, so every part of the app
// starts fresh as the other account. Logging out removes an account from the
// list. Messages stay end-to-end encrypted: an account whose keys aren't
// remembered on this device asks for its password after switching.
import { appUrl, supabase, supabaseUrl } from './supabase';
import type { Profile } from './types';

const LIST_KEY = 'venband:accounts';
const SWITCH_FLAG = 'venband:switching';
export const MAX_ACCOUNTS = 5;

export interface SavedAccount {
  id: string;
  email: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  avatar_color: string;
  refresh_token: string;
  saved_at: number;
}

function read(): SavedAccount[] {
  try {
    const list = JSON.parse(localStorage.getItem(LIST_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((a) => a && typeof a.id === 'string' && typeof a.refresh_token === 'string') : [];
  } catch {
    return [];
  }
}

function write(list: SavedAccount[]) {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(list.slice(0, MAX_ACCOUNTS)));
  } catch {
    /* storage full or blocked: switching just won't remember this one */
  }
}

/** Saved accounts other than the one you're in, most recent first. */
export function otherAccounts(currentId: string | null): SavedAccount[] {
  return read()
    .filter((a) => a.id !== currentId)
    .sort((a, b) => b.saved_at - a.saved_at);
}

export function allSavedAccounts(): SavedAccount[] {
  return read().sort((a, b) => b.saved_at - a.saved_at);
}

/** Put (or refresh) the current account in the list. */
export async function rememberAccount(me: Profile | null) {
  if (!me) return;
  const { data } = await supabase.auth.getSession();
  const s = data.session;
  if (!s?.refresh_token || s.user.id !== me.id) return;
  const list = read().filter((a) => a.id !== me.id);
  list.unshift({
    id: me.id,
    email: s.user.email ?? '',
    username: me.username,
    display_name: me.display_name,
    avatar_url: me.avatar_url ?? null,
    avatar_color: me.avatar_color,
    refresh_token: s.refresh_token,
    saved_at: Date.now(),
  });
  write(list);
}

export function forgetAccount(id: string) {
  write(read().filter((a) => a.id !== id));
}

/** Was this page load caused by switching accounts? (read once) */
export function consumeSwitchFlag(): boolean {
  try {
    const on = sessionStorage.getItem(SWITCH_FLAG) === '1';
    sessionStorage.removeItem(SWITCH_FLAG);
    return on;
  } catch {
    return false;
  }
}

/** Switch to a saved account. Reloads the app on success. */
export async function switchAccount(id: string, current: Profile | null) {
  const target = read().find((a) => a.id === id);
  if (!target) throw new Error('That account isn’t saved on this device any more.');
  await rememberAccount(current);
  try {
    sessionStorage.setItem(SWITCH_FLAG, '1');
  } catch {
    /* only affects the notice */
  }
  const { data, error } = await supabase.auth.refreshSession({ refresh_token: target.refresh_token });
  if (error || !data.session) {
    forgetAccount(id);
    try {
      sessionStorage.removeItem(SWITCH_FLAG);
    } catch {
      /* ignore */
    }
    throw new Error(`@${target.username} was logged out. Log in to it again to add it back.`);
  }
  window.location.assign(appUrl('channels/@me'));
}

/** The localStorage key supabase-js keeps the active login under. */
function authStorageKey(): string {
  try {
    return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
  } catch {
    return 'sb-localhost-auth-token';
  }
}

/** Log into another account too: this one stays saved for switching back. */
export async function addAccount(current: Profile | null) {
  if (read().length >= MAX_ACCOUNTS && !read().some((a) => a.id === current?.id)) {
    throw new Error(`You can keep up to ${MAX_ACCOUNTS} accounts on one device.`);
  }
  await rememberAccount(current);
  // Drop the active login on this device only: no call to the server, so the
  // saved refresh token keeps working for switching back.
  try {
    localStorage.removeItem(authStorageKey());
    sessionStorage.setItem(SWITCH_FLAG, '1');
  } catch {
    /* ignore */
  }
  window.location.assign(appUrl('sign-in'));
}
