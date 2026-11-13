// Minimal path router. URLs (relative to the app's base path):
//   /sign-in  /register
//   /channels/@me                      friends + DMs
//   /channels/@me/<userId|channelId>   a DM (user id) or group chat (channel id)
//   /channels/<serverId>[/<channelId>]
//   /discover
//   /status /tos /privacy /guidelines /changelog /discovery /bots[/<id>] /voogle /download  (public)
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
  const url = BASE + clean + (opts.keepQuery && !clean.includes('?') ? window.location.search : '') + window.location.hash.replace(/^#$/, '');
  if (url === window.location.pathname + window.location.search + window.location.hash) return;
  if (opts.replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  emit();
}

/** Resume a local destination after account setup, including invite options. */
export function rememberReturnPath(path = currentPath() + window.location.search) {
  try {
    sessionStorage.setItem('venband:return-to', path);
  } catch {
    // Navigation still works when storage is unavailable.
  }
}

export function resumeReturnPath() {
  try {
    const path = sessionStorage.getItem('venband:return-to');
    sessionStorage.removeItem('venband:return-to');
    if (!path || !/^[a-z0-9@]/i.test(path)) return;
    go(path, { replace: true });
  } catch {
    // Navigation still works when storage is unavailable.
  }
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
  | { kind: 'bio'; username: string }
  | { kind: 'callback' }
  | { kind: 'qr-approve'; code: string }
  | { kind: 'invite'; code: string }
  | { kind: 'template'; code: string }
  | { kind: 'group-invite'; code: string }
  | { kind: 'page'; page: PublicPage; id?: string }
  | { kind: 'root' }
  | { kind: 'storage' };

export type PublicPage = 'status' | 'tos' | 'privacy' | 'policy' | 'guidelines' | 'changelog' | 'discovery' | 'bots' | 'voogle' | 'download';
const PAGES: Record<string, PublicPage> = {
  status: 'status',
  tos: 'tos',
  terms: 'tos',
  termsofservice: 'tos',
  'terms-of-service': 'tos',
  privacy: 'privacy',
  privacypolicy: 'privacy',
  'privacy-policy': 'privacy',
  policy: 'policy',
  policies: 'policy',
  legal: 'tos',
  guidelines: 'guidelines',
  'community-guidelines': 'guidelines',
  rules: 'guidelines',
  changelog: 'changelog',
  discovery: 'discovery',
  bots: 'bots',
  download: 'download',
  downloads: 'download',
  // old links keep working
  applications: 'bots',
  developers: 'bots',
  voogle: 'voogle',
};

export function parseRoute(path = currentPath()): Route {
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts.length === 2 && parts[1] === 'bio' && /^[a-z0-9_.]{2,32}$/i.test(parts[0])) {
    return { kind: 'bio', username: parts[0].toLowerCase() };
  }
  // a scanned login QR code: /login/qr/code/<64 hex>
  if (parts[0] === 'login' && parts[1] === 'qr' && parts[2] === 'code' && /^[0-9a-f]{64}$/i.test(parts[3] ?? '')) return { kind: 'qr-approve', code: parts[3].toLowerCase() };
  if (parts[0] === 'sign-in' || parts[0] === 'login') return { kind: 'sign-in' };
  if (parts[0] === 'register' || parts[0] === 'signup') return { kind: 'register' };
  if (parts[0] === 'discover') return { kind: 'discover' };
  // OAuth return addresses for Settings → Connections (see lib/connections.ts)
  if (parts[0] === 'callback' || (parts[0] === 'auth' && parts[1]) || (parts[0] === 'github' && parts[1] === 'auth')) return { kind: 'callback' };
  if (parts[0] === 'storage') return { kind: 'storage' };
  if (parts[0] === 'invite' && parts[1]) return { kind: 'invite', code: parts[1] };
  if (parts[0] === 'template' && parts[1]) return { kind: 'template', code: parts[1] };
  if (parts[0] === 'join-group' && parts[1]) return { kind: 'group-invite', code: parts[1] };
  const page = parts[0] ? PAGES[parts[0].toLowerCase()] : undefined;
  if (page) return { kind: 'page', page, id: parts[1] };
  // A short slug like venband.gg/my-server is a vanity link.
  if (parts.length === 1 && /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/i.test(parts[0])) return { kind: 'invite', code: parts[0].toLowerCase() };
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
