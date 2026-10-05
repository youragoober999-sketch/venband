// Minimal path router. URLs (relative to the app's base path):
//   /sign-in  /register
//   /channels/@me                      friends + DMs
//   /channels/@me/<userId|channelId>   a DM (user id) or group chat (channel id)
//   /channels/<serverId>[/<channelId>]
//   /discover
//   /status /tos /privacy /guidelines /changelog /discovery /applications[/<id>] /voogle  (public)
import { useSyncExternalStore } from 'react';

const BASE = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');

/** Current path without the base, no leading slash: "channels/@me/123". */
export function currentPath(): string {
  let p = window.location.pathname;
  if (p.startsWith(BASE)) p = p.slice(BASE.length);
  else if (p.startsWith('/')) p = p.slice(1);
  return p.replace(/\/+$/, '');
}

const listeners = new Set<() => void>();
let version = 0;
function emit() {
  version++;
  listeners.forEach((l) => l());
}
window.addEventListener('popstate', emit);

export function go(path: string, opts: { replace?: boolean; keepQuery?: boolean } = {}) {
  const clean = path.replace(/^\/+/, '');
  if (clean === currentPath()) return;
  const url = BASE + clean + (opts.keepQuery ? window.location.search : '') + window.location.hash.replace(/^#$/, '');
  if (opts.replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  emit();
}

export function useRoute(): string {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
  return currentPath();
}

export type Route =
  | { kind: 'sign-in' }
  | { kind: 'register' }
  | { kind: 'home'; target: string | null; messageId?: string }
  | { kind: 'server'; serverId: string; channelId: string | null; messageId?: string }
  | { kind: 'discover' }
  | { kind: 'invite'; code: string }
  | { kind: 'group-invite'; code: string }
  | { kind: 'page'; page: PublicPage; id?: string }
  | { kind: 'root' };

export type PublicPage = 'status' | 'tos' | 'privacy' | 'guidelines' | 'changelog' | 'discovery' | 'applications' | 'voogle';
const PAGES: Record<string, PublicPage> = {
  status: 'status',
  tos: 'tos',
  terms: 'tos',
  privacy: 'privacy',
  guidelines: 'guidelines',
  changelog: 'changelog',
  discovery: 'discovery',
  applications: 'applications',
  developers: 'applications',
  voogle: 'voogle',
};

export function parseRoute(path = currentPath()): Route {
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'sign-in' || parts[0] === 'login') return { kind: 'sign-in' };
  if (parts[0] === 'register' || parts[0] === 'signup') return { kind: 'register' };
  if (parts[0] === 'discover') return { kind: 'discover' };
  if (parts[0] === 'invite' && parts[1]) return { kind: 'invite', code: parts[1] };
  if (parts[0] === 'join-group' && parts[1]) return { kind: 'group-invite', code: parts[1] };
  const page = parts[0] ? PAGES[parts[0].toLowerCase()] : undefined;
  if (page) return { kind: 'page', page, id: parts[1] };
  if (parts[0] === 'channels') {
    if (!parts[1] || parts[1] === '@me') return { kind: 'home', target: parts[2] ?? null, messageId: parts[3] };
    return { kind: 'server', serverId: parts[1], channelId: parts[2] ?? null, messageId: parts[3] };
  }
  return { kind: 'root' };
}

/** Shareable absolute link for a path. */
export function linkTo(path: string): string {
  return window.location.origin + BASE + path.replace(/^\/+/, '');
}
