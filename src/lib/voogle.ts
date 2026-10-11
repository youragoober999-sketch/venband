// Voogle verification signals collected in the browser.
//
// - a random device token kept in this browser (never derived from hardware)
// - a hash of coarse browser traits (screen, GPU name, time zone, cores...)
//
// Both are hashed again with a secret pepper in the database, and the
// network signal comes from your login session on the server. Nothing here
// leaves the browser in readable form except the random token.
import { supabase } from './supabase';

const KEY = 'venband:voogle-device';

function randomToken() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function idbGet(): Promise<string | null> {
  return new Promise((res) => {
    try {
      const req = indexedDB.open('venband-voogle', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onerror = () => res(null);
      req.onsuccess = () => {
        try {
          const g = req.result.transaction('kv', 'readonly').objectStore('kv').get('device');
          g.onsuccess = () => res(typeof g.result === 'string' ? g.result : null);
          g.onerror = () => res(null);
        } catch {
          res(null);
        }
      };
    } catch {
      res(null);
    }
  });
}

function idbSet(v: string) {
  try {
    const req = indexedDB.open('venband-voogle', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => {
      try {
        req.result.transaction('kv', 'readwrite').objectStore('kv').put(v, 'device');
      } catch {
        /* ignore */
      }
    };
  } catch {
    /* ignore */
  }
}

export async function deviceToken(): Promise<string> {
  let t: string | null = null;
  try {
    t = localStorage.getItem(KEY);
  } catch {
    /* ignore */
  }
  t = t ?? (await idbGet()) ?? randomToken();
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* ignore */
  }
  idbSet(t);
  return t;
}

function gpu(): string {
  try {
    const c = document.createElement('canvas').getContext('webgl');
    if (!c) return '';
    const ext = c.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(c.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(c.getParameter(c.RENDERER));
  } catch {
    return '';
  }
}

export async function browserTraitsHash(): Promise<string> {
  const n = navigator as Navigator & { deviceMemory?: number };
  const traits = [
    n.platform,
    n.hardwareConcurrency,
    n.deviceMemory ?? '',
    n.maxTouchPoints,
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    (n.languages ?? []).slice(0, 3).join(','),
    gpu(),
  ].join('|');
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(traits));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A hashed hardware id from the desktop or phone app (never the raw id). */
async function hardwareId(): Promise<string | null> {
  try {
    const desktop = await window.venbandDesktop?.hardwareId?.();
    if (desktop && /^[0-9a-f]{64}$/.test(desktop)) return desktop;
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> } }).Capacitor;
    const device = cap?.isNativePlatform?.() ? (cap.Plugins?.Device as { getId?: () => Promise<{ identifier?: string }> } | undefined) : undefined;
    const raw = (await device?.getId?.())?.identifier;
    if (!raw) return null;
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`venband-hw-v1|${raw.toLowerCase()}`));
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

const CHECKIN_KEY = 'venband:voogle-checkin';

/**
 * Tell Voogle this account is on this device (on app start and after sign-in,
 * at most every 6 hours). Only hashes are sent. Returns false when the account
 * was just banned for ban evasion.
 */
export async function voogleCheckin(userId: string, force = false): Promise<boolean> {
  try {
    const last = JSON.parse(localStorage.getItem(CHECKIN_KEY) ?? '{}') as { user?: string; at?: number };
    if (!force && last.user === userId && Date.now() - (last.at ?? 0) < 6 * 3600_000) return true;
  } catch {
    /* storage unavailable: check in anyway */
  }
  const { data, error } = await supabase.rpc('voogle_checkin', { p_device: await deviceToken(), p_fp: await browserTraitsHash(), p_hw: await hardwareId() });
  if (error) return true; // an old database without check-in: never block the app
  try {
    localStorage.setItem(CHECKIN_KEY, JSON.stringify({ user: userId, at: Date.now() }));
  } catch {
    /* ignore */
  }
  return !(data as { banned?: boolean } | null)?.banned;
}

export interface VoogleResult {
  result: 'passed' | 'blocked' | 'review';
  reason: string;
}

export async function voogleVerify(serverId: string): Promise<VoogleResult> {
  const { data, error } = await supabase.rpc('voogle_verify', { p_server: serverId, p_device: await deviceToken(), p_fp: await browserTraitsHash() });
  if (error) throw error;
  return data as VoogleResult;
}

export interface VoogleSettings {
  enabled: boolean;
  required?: boolean;
  role_id?: string;
  max_accounts?: number;
  block_ban_evasion?: boolean;
  min_account_days?: number;
  review_at?: number;
}
