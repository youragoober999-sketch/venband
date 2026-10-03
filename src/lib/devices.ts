// Signed-in devices: label this device's session (browser, OS, rough
// location) and log out when the session is revoked from another device.
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export interface Device {
  id: string;
  created_at: string;
  last_active: string;
  user_agent: string | null;
  ip: string | null;
  label: string;
  city: string;
  region: string;
  country: string;
  current: boolean;
}

export function sessionIdOf(session: Session): string | null {
  try {
    const payload = JSON.parse(atob(session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.session_id === 'string' ? payload.session_id : null;
  } catch {
    return null;
  }
}

export function describeAgent(ua: string | null | undefined): { browser: string; os: string; mobile: boolean } {
  const s = ua ?? '';
  const browser = /Edg\//.test(s)
    ? 'Edge'
    : /OPR\//.test(s)
      ? 'Opera'
      : /Firefox\//.test(s)
        ? 'Firefox'
        : /Chrome\//.test(s)
          ? 'Chrome'
          : /Safari\//.test(s)
            ? 'Safari'
            : 'Browser';
  const os = /iPhone|iPad|iPod/.test(s)
    ? 'iOS'
    : /Android/.test(s)
      ? 'Android'
      : /Windows/.test(s)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(s)
          ? 'macOS'
          : /CrOS/.test(s)
            ? 'ChromeOS'
            : /Linux/.test(s)
              ? 'Linux'
              : 'Unknown OS';
  return { browser, os, mobile: /Mobi|Android|iPhone|iPad/.test(s) };
}

let registered: string | null = null;

/** Remember what this session is (best-effort; never blocks sign-in). */
export async function registerDevice(session: Session) {
  const id = sessionIdOf(session);
  if (!id || registered === id) return;
  registered = id;
  const { browser, os } = describeAgent(navigator.userAgent);
  let geo = { city: '', region: '', country: '' };
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}api/geo`, { cache: 'no-store' });
    if (res.ok && res.headers.get('content-type')?.includes('json')) geo = { ...geo, ...(await res.json()) };
  } catch {
    /* not on Vercel: no location */
  }
  await supabase.from('device_sessions').upsert({
    session_id: id,
    user_id: session.user.id,
    label: `${browser} on ${os}`,
    city: geo.city,
    region: geo.region,
    country: geo.country,
    updated_at: new Date().toISOString(),
  });
}

export async function listDevices(): Promise<Device[]> {
  const { data, error } = await supabase.rpc('my_devices');
  if (error) throw error;
  return (data ?? []) as Device[];
}

export async function revokeDevice(id: string) {
  const { error } = await supabase.rpc('revoke_device', { p_session: id });
  if (error) throw error;
}

let watch: ReturnType<typeof setInterval> | undefined;

/** Poll: if this device was logged out from somewhere else, leave now. */
export function watchSession(onRevoked: () => void) {
  stopWatchingSession();
  const check = async () => {
    if (document.hidden) return;
    const { data, error } = await supabase.rpc('session_alive');
    if (!error && data === false) onRevoked();
  };
  watch = setInterval(check, 45_000);
  document.addEventListener('visibilitychange', check);
  stopFns.push(() => document.removeEventListener('visibilitychange', check));
}

const stopFns: (() => void)[] = [];
export function stopWatchingSession() {
  clearInterval(watch);
  stopFns.splice(0).forEach((f) => f());
  registered = null;
}
