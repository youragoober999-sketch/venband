import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as
  | string
  | undefined;

export const configured = Boolean(url && anonKey);

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

export function errorMessage(e: unknown): string {
  if (!e) return 'Unknown error';
  let msg: string;
  if (typeof e === 'string') msg = e;
  else if (typeof e === 'object' && e && 'message' in e) msg = String((e as { message: unknown }).message);
  else msg = String(e);
  if (/bucket not found/i.test(msg))
    return 'File storage isn’t set up on this server yet. If you run this site, run supabase/repair.sql in the Supabase SQL editor.';
  return msg;
}
