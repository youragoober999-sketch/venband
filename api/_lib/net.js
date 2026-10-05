// Shared helpers for Venband's server functions: fetching outside websites
// safely (no access to private networks, size and time limits), checking that
// a request comes from a signed-in Venband user, and signing media URLs.
import { lookup } from 'node:dns/promises';
import { createHmac, timingSafeEqual } from 'node:crypto';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';

const PRIVATE_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const toInt = (ip) => ip.split('.').reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;

export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const n = toInt(ip);
    return PRIVATE_V4.some(([base, bits]) => (n >>> (32 - bits)) === (toInt(base) >>> (32 - bits)));
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') || v6.startsWith('ff');
}

/** Refuse anything that isn't a public http(s) URL on a standard port. */
export async function checkUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('bad url');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('only web links');
  if (u.username || u.password) throw new Error('no credentials in links');
  if (u.port && !['80', '443', '8080', '8443'].includes(u.port)) throw new Error('unusual port');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) throw new Error('private address');
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error('private address');
  return u;
}

/** Resolve a hostname, refusing private addresses at connect time (blocks DNS rebinding). */
function safeLookup(hostname, options, cb) {
  lookup(hostname, { all: true })
    .then((addrs) => {
      const bad = addrs.find((a) => isPrivateAddress(a.address));
      if (!addrs.length || bad) return cb(new Error('private address'));
      const pick = addrs[0];
      if (options && options.all) cb(null, addrs);
      else cb(null, pick.address, pick.family);
    })
    .catch((e) => cb(e));
}

function request1(u, { accept, timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(
      u,
      {
        method: 'GET',
        lookup: safeLookup,
        timeout: timeoutMs,
        headers: { accept, 'user-agent': 'Mozilla/5.0 (compatible; VenbandBot/1.0; +https://www.venband.com/bot)', 'accept-encoding': 'identity' },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ status, location: res.headers.location, headers: res.headers, body: Buffer.alloc(0) });
        }
        if (Number(res.headers['content-length'] ?? 0) > maxBytes) {
          res.destroy();
          return reject(new Error('too big'));
        }
        const chunks = [];
        let total = 0;
        res.on('data', (c) => {
          total += c.length;
          if (total > maxBytes) {
            res.destroy();
            resolve({ status, headers: res.headers, body: Buffer.concat(chunks) });
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

/** GET a public URL following at most 3 redirects, re-checking each hop. */
export async function safeFetch(raw, { maxBytes = 1_000_000, accept = '*/*', timeoutMs = 6000 } = {}) {
  let url = raw;
  for (let hop = 0; hop < 4; hop++) {
    const u = await checkUrl(url);
    const r = await request1(u, { accept, timeoutMs, maxBytes });
    if (r.location) {
      url = new URL(r.location, u).toString();
      continue;
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(r.headers)) if (typeof v === 'string') headers.set(k, v);
    return { res: { ok: r.status >= 200 && r.status < 300, status: r.status, headers }, url: u.toString(), body: r.body };
  }
  throw new Error('too many redirects');
}

const tokenCache = new Map();
/** The signed-in Venband user making this request, or null. */
export async function userFromRequest(request) {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || token.length > 4000) return null;
  const hit = tokenCache.get(token);
  if (hit && hit.until > Date.now()) return hit.user;
  const base = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!base || !key) return null;
  const res = await fetch(`${base}/auth/v1/user`, { headers: { apikey: key, authorization: `Bearer ${token}` } });
  const user = res.ok ? await res.json() : null;
  tokenCache.set(token, { user, until: Date.now() + 5 * 60_000 });
  if (tokenCache.size > 5000) tokenCache.clear();
  return user;
}

export const mediaSecret = () => process.env.MEDIA_PROXY_SECRET || '';

export function signMedia(url) {
  const secret = mediaSecret();
  if (!secret) return null;
  const sig = createHmac('sha256', secret).update(url).digest('base64url').slice(0, 32);
  return `/api/media?u=${encodeURIComponent(url)}&s=${sig}`;
}

export function verifyMedia(url, sig) {
  const secret = mediaSecret();
  if (!secret || !sig) return false;
  const want = Buffer.from(createHmac('sha256', secret).update(url).digest('base64url').slice(0, 32));
  const got = Buffer.from(String(sig));
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Very small per-instance rate limit. */
const hits = new Map();
export function rateLimited(key, max = 60, windowMs = 60_000) {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 10_000) hits.clear();
  return list.length > max;
}
