// Venband Data Layer (VDL) client — fast, on-site backend on Vercel.
// Auth is cookie-based (httpOnly); all requests are same-origin.
import { deriveMasterKeys } from './crypto';

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
  source?: 'supabase' | 'vdl' | string;
  email_verified_at?: string | null;
  is_anonymous?: boolean;
  mfa_enabled?: boolean;
  avatar_url?: string | null;
  disposable?: boolean;
  expires_at?: string | null;
  banned_until?: string | null;
  supabase_synced_at?: string | null;
  upstream_deleted_at?: string | null;
}

export interface VdlUserDetail extends VdlUser {
  password_scheme: string;
  has_password: boolean;
  phone: string | null;
  about: string;
  pronouns: string;
  language: string;
  providers: string[];
  profile: Record<string, unknown>;
  updated_at: string;
}

export interface VdlUserFacets {
  all: number; active: number; limited: number; banned: number; supabase: number; vdl: number;
  unverified: number; anonymous: number; staff: number; upstream_deleted: number; active_30d: number;
}

export interface VdlUserQuery {
  q?: string;
  status?: '' | 'active' | 'limited' | 'banned';
  source?: '' | 'supabase' | 'vdl';
  kind?: '' | 'verified' | 'unverified' | 'anonymous' | 'staff' | 'mfa' | 'upstream_deleted' | 'active_30d';
  sort?: 'newest' | 'oldest' | 'recent_sign_in' | 'username' | 'email';
  limit?: number;
  offset?: number;
}

export interface VdlSyncRun {
  id: string;
  status: 'running' | 'done' | 'failed' | 'abandoned';
  total: number | null;
  scanned: number;
  inserted: number;
  updated: number;
  conflicts: { id: string; email: string | null; username: string; reason: string; other_id: string }[];
  upstream_deleted: number;
  error: string | null;
  trigger: string;
  started_at: string;
  finished_at: string | null;
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
  retryLegacy?: boolean;
  constructor(message: string, status: number, extra: { field?: string; suggestion?: string | null; retry_legacy?: boolean } = {}) {
    super(message);
    this.name = 'VdlError';
    this.status = status;
    this.field = extra.field;
    this.suggestion = extra.suggestion;
    this.retryLegacy = Boolean(extra.retry_legacy);
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

async function call<T>(resource: string, opts: { action?: string; query?: Query; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const qs = new URLSearchParams({ r: resource });
  if (opts.action) qs.set('action', opts.action);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const isPost = opts.action !== undefined || opts.body !== undefined;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? TIMEOUT_MS);
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
  if (!r.ok) throw new VdlError(j?.error || `Request failed (${r.status})`, r.status, { field: j?.field, suggestion: j?.suggestion, retry_legacy: j?.retry_legacy });
  return j as T;
}

// ---------------------------------------------------------------- auth --
// Passwords never leave the device: like the Supabase flow, the client derives
// `authPassword` with Argon2id(email) and only that is sent. It is exactly the
// value Supabase Auth hashed, so accounts synced from Supabase sign in unchanged.

async function authKey(email: string, password: string) {
  return (await deriveMasterKeys(email, password)).authPassword;
}

export async function vdlSignup(email: string, password: string, username: string, displayName?: string) {
  const j = await call<{ user: VdlUser }>('auth', { action: 'signup', body: { email, password: await authKey(email, password), username, display_name: displayName } });
  return j.user;
}

/** Username or email -> account email (VDL's replacement for Supabase resolve_login). */
export async function vdlResolve(identifier: string) {
  return call<{ found: boolean; email?: string | null; username?: string; banned?: boolean }>('auth', { action: 'resolve', body: { identifier } });
}

/** Sign in with an email or a username. */
export async function vdlSignin(identifier: string, password: string) {
  let email = identifier.trim();
  if (!email.includes('@')) {
    const hit = await vdlResolve(email);
    if (!hit.found || !hit.email) throw new VdlError('No account with that username or email.', 404);
    if (hit.banned) throw new VdlError(`@${hit.username} is banned.`, 403);
    email = hit.email;
  }
  const key = await authKey(email, password);
  try {
    return (await call<{ user: VdlUser }>('auth', { action: 'signin', body: { email, password: key } })).user;
  } catch (e) {
    // old console-only accounts were created before on-device key derivation
    if (e instanceof VdlError && e.status === 401 && (e as any).retryLegacy) {
      return (await call<{ user: VdlUser }>('auth', { action: 'signin', body: { email, password: key, legacy_password: password } })).user;
    }
    throw e;
  }
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

export async function vdlListUsers(q = '', opts: Omit<VdlUserQuery, 'q'> = {}): Promise<VdlUser[]> {
  return (await vdlQueryUsers({ q, ...opts })).users;
}

export async function vdlQueryUsers(query: VdlUserQuery) {
  return call<{ users: VdlUser[]; total: number; limit: number; offset: number; facets: VdlUserFacets }>('users', { query: { ...query } });
}

/** URL that downloads every account matching the filters (cookie auth, so a plain link works). */
export function vdlExportUrl(format: 'csv' | 'json', query: VdlUserQuery = {}) {
  const qs = new URLSearchParams({ r: 'users', format });
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '' && k !== 'limit' && k !== 'offset') qs.set(k, String(v));
  return `${BASE}?${qs}`;
}

export async function vdlGetUser(id: string) {
  return call<{ user: VdlUserDetail; history: any[]; counts: { servers: number; messages: number; files: number } }>('user', { query: { id } });
}

export async function vdlSetStatus(ids: string | string[], status: 'active' | 'limited' | 'very_limited' | 'banned', reason = '') {
  return call<{ ok: true; updated: number; warnings: string[] }>('users', { action: 'set_status', body: { ids: Array.isArray(ids) ? ids : [ids], status, reason } });
}

export async function vdlBanUser(id: string, reason = ''): Promise<void> {
  await vdlSetStatus(id, 'banned', reason);
}

export async function vdlUnbanUser(id: string, reason = ''): Promise<void> {
  await vdlSetStatus(id, 'active', reason);
}

// ---------------------------------------------------------------- sync --

export async function vdlSyncStatus() {
  return call<{ configured: boolean; runs: VdlSyncRun[] }>('sync');
}

/** Pull every Supabase account into VDL. Calls `onProgress` after each ~25 s chunk. */
export async function vdlSyncFromSupabase(onProgress?: (run: VdlSyncRun) => void, fresh = false): Promise<VdlSyncRun> {
  let { run } = await call<{ run: VdlSyncRun }>('sync', { action: 'start', body: { fresh }, timeoutMs: 58_000 });
  onProgress?.(run);
  while (run.status === 'running') {
    ({ run } = await call<{ run: VdlSyncRun }>('sync', { action: 'step', body: { run_id: run.id }, timeoutMs: 58_000 }));
    onProgress?.(run);
  }
  return run;
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
