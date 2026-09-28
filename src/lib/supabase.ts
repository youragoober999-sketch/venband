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
  if (typeof e === 'string') return e;
  if (typeof e === 'object' && e && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}
