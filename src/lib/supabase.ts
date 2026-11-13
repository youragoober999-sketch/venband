import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as
  | string
  | undefined;

export const configured = Boolean(url && anonKey);
export const supabaseUrl = (url ?? '').replace(/\/$/, '');
export const supabaseKey = anonKey ?? '';

// Keep Google's authorization code out of Supabase's email-link handler.
export const googleEmailReturn = (() => {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  if (url.searchParams.get('google') !== '1') return null;
  const params = new URLSearchParams(url.search);
  for (const key of ['google', 'code', 'state', 'error', 'error_description', 'scope', 'authuser', 'prompt']) {
    url.searchParams.delete(key);
  }
  window.history.replaceState(window.history.state, '', url);
  return params;
})();
// The anon/publishable key is public by design; every table is protected by
// Row Level Security (see supabase/migrations).
export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'missing', {
  auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 20 } },
});

/** URL the auth emails should send people back to (works on GitHub Pages sub-paths). */
export function appUrl(query = ''): string {
  const base = new URL(import.meta.env.BASE_URL, window.location.origin + window.location.pathname);
  return `${base.origin}${base.pathname}${query}`;
}

/** The database is older than this app: a newer migration hasn't been run on it yet. */
export function isOldSchema(e: unknown): boolean {
  const msg = typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e ?? '');
  return /column [\w."]+ does not exist|could not find the (function|table)|in the schema cache/i.test(msg);
}

export function errorMessage(e: unknown): string {
  if (!e) return 'Unknown error';
  let msg: string;
  if (typeof e === 'string') msg = e;
  else if (typeof e === 'object' && e && 'message' in e) msg = String((e as { message: unknown }).message);
  else msg = String(e);
  if (/bucket not found/i.test(msg))
    return 'File storage isn’t set up on this server yet. If you run this site, run supabase/setup.sql (new project) or the newest supabase/migrations/ files in the Supabase SQL editor.';
  if (/profiles_(avatar_frame|nameplate|profile_effect)_check/.test(msg) || /function public\.claim_cosmetics|cosmetic_inventory/.test(msg))
    return 'The Marketplace needs a database update that hasn’t been installed yet. If you run this site, run supabase/update-2026-11.sql in the Supabase SQL editor, then try again.';
  if (isOldSchema(e))
    return 'This feature needs a database update that hasn’t been installed yet. If you run this site, run the newest files in supabase/migrations/ in the Supabase SQL editor (venband.com/status lists what’s missing).';
  return msg;
}
