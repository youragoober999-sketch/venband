// Venband Data Layer (VDL) client — fast, on-site backend on Vercel.
// Auth is cookie-based (httpOnly); all requests are same-origin.
const BASE = '/api/vdl';
const TIMEOUT_MS = 15_000;

export interface VdlUser {
  id: string;
  email: string;
  username: string;
  display_name: string;
  avatar_color: string;
  badges: string[];
  platform_role: string;
  account_status: string;
  created_at: string;
  last_sign_in_at?: string | null;
}

export interface VdlStats {
  users: number;
  banned: number;
  new_users_7d: number;
  servers: number;
  messages: number;
  blocks: number;
  emails_queued: number;
  objects: number;
  object_bytes: number;
}

/** An API error that keeps the HTTP status and any hints the server sent (e.g. which field is taken). */
export class VdlError extends Error {
  status: number;
  field?: string;
  suggestion?: string | null;
  constructor(message: string, status: number, extra: { field?: string; suggestion?: string | null } = {}) {
    super(message);
    this.name = 'VdlError';
    this.status = status;
    this.field = extra.field;
    this.suggestion = extra.suggestion;
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

async function call<T>(resource: string, opts: { action?: string; query?: Query; body?: unknown } = {}): Promise<T> {
  const qs = new URLSearchParams({ r: resource });
  if (opts.action) qs.set('action', opts.action);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const isPost = opts.action !== undefined || opts.body !== undefined;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let r: Response;
  try {
    r = await fetch(`${BASE}?${qs}`, {
      method: isPost ? 'POST' : 'GET',
      headers: isPost ? { 'content-type': 'application/json' } : undefined,
      body: isPost ? JSON.stringify(opts.body ?? {}) : undefined,
      credentials: 'include',
      cache: 'no-store',
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new VdlError((e as Error).name === 'AbortError' ? 'The server took too long to answer. Try again.' : 'Can’t reach the server. Check your connection.', 0);
  } finally {
    clearTimeout(timer);
  }
  let j: any = null;
  try { j = await r.json(); } catch { /* non-JSON (e.g. a platform error page) */ }
  if (!r.ok) throw new VdlError(j?.error || `Request failed (${r.status})`, r.status, { field: j?.field, suggestion: j?.suggestion });
  return j as T;
}

// ---------------------------------------------------------------- auth --

export async function vdlSignup(email: string, password: string, username: string, displayName?: string) {
  const j = await call<{ user: VdlUser }>('auth', { action: 'signup', body: { email, password, username, display_name: displayName } });
  return j.user;
}

export async function vdlSignin(email: string, password: string) {
  const j = await call<{ user: VdlUser }>('auth', { action: 'signin', body: { email, password } });
  return j.user;
}

export async function vdlSignout() {
  try { await call('auth', { action: 'signout' }); } catch { /* already signed out */ }
}

export async function vdlMe(): Promise<VdlUser | null> {
  try { return (await call<{ user: VdlUser }>('auth')).user; } catch { return null; }
}

/** Live availability for signup forms. `suggestion` is a free username when the asked one is taken. */
export async function vdlCheckAvailability(input: { username?: string; email?: string }) {
  return call<{ username?: boolean; email?: boolean; suggestion?: string | null }>('auth', { action: 'check', body: input });
}

/** Cookie auth: the browser sends the session automatically, so there is no token to hand out. */
export async function vdlToken(): Promise<string | null> {
  return null;
}

// --------------------------------------------------------------- users --

export async function vdlListUsers(q = '', opts: { limit?: number; offset?: number; status?: string } = {}): Promise<VdlUser[]> {
  return (await vdlListUsersPage(q, opts)).users;
}

export async function vdlListUsersPage(q = '', opts: { limit?: number; offset?: number; status?: string } = {}) {
  return call<{ users: VdlUser[]; total: number; limit: number; offset: number }>('users', { query: { q, ...opts } });
}

export async function vdlBanUser(id: string, reason = ''): Promise<void> {
  await call('users', { action: 'ban', body: { id, reason } });
}

export async function vdlUnbanUser(id: string, reason = ''): Promise<void> {
  await call('users', { action: 'unban', body: { id, reason } });
}

export async function vdlEraseUser(id: string): Promise<void> {
  await call('users', { action: 'erase', body: { id } });
}

// ------------------------------------------------------------- servers --

export async function vdlListServers(): Promise<any[]> {
  return (await call<{ servers: any[] }>('servers')).servers;
}

export async function vdlCreateServer(name: string): Promise<any> {
  return (await call<{ server: any }>('servers', { action: 'create', body: { name } })).server;
}

// ------------------------------------------------------------ messages --

export async function vdlListMessages(channel: string, since?: string, opts: { before?: string; limit?: number } = {}): Promise<any[]> {
  return (await call<{ messages: any[] }>('messages', { query: { channel, since, ...opts } })).messages;
}

export async function vdlSendMessage(channelId: string, content: string): Promise<any> {
  return (await call<{ message: any }>('messages', { action: 'send', body: { channel_id: channelId, content } })).message;
}

// --------------------------------------------------------------- staff --

export async function vdlListAudit(limit = 100): Promise<any[]> {
  return (await call<{ rows: any[] }>('audit', { query: { limit } })).rows;
}

export async function vdlListLedger(): Promise<any[]> {
  return (await call<{ rows: any[] }>('ledger')).rows;
}

export async function vdlVerifyLedger(): Promise<{ ok: boolean; blocks: number; broken_at?: number; head?: string }> {
  return (await call<{ verify: any }>('ledger', { query: { verify: 1 } })).verify;
}

export async function vdlRebuildLedger(): Promise<{ blocks: number; head: string }> {
  return call('ledger', { action: 'rebuild' });
}

export async function vdlQueueEmail(to: string, subject: string, body: string): Promise<{ queued: number }> {
  return call('emails', { action: 'queue', body: { to, subject, body } });
}

export async function vdlSendQueuedEmails(): Promise<{ sent: number; total: number; failed: number; errors: { to: string; error: string }[] }> {
  return call('emails', { action: 'send' });
}

export async function vdlRetryFailedEmails(): Promise<{ requeued: number }> {
  return call('emails', { action: 'retry' });
}

export async function vdlListEmails(): Promise<any[]> {
  return (await call<{ rows: any[] }>('emails')).rows;
}

export async function vdlStats(): Promise<VdlStats> {
  return call<VdlStats>('stats');
}

export async function vdlHealth(): Promise<{ ok: boolean; db_ms: number; jwt_configured: boolean; email_configured: boolean }> {
  return call('health');
}
