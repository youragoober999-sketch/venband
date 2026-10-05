// Outbound HTTP for user code (fetch inside endpoints) and webhooks. Only public
// http(s) addresses are allowed: private, loopback and link-local ranges are
// refused at DNS lookup time, which also blocks DNS-rebinding tricks.
import { lookup } from 'node:dns/promises'
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'

const PRIVATE_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
]
const toInt = (ip) => ip.split('.').reduce((n, p) => (n << 8) + Number(p), 0) >>> 0

export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const n = toInt(ip)
    return PRIVATE_V4.some(([base, bits]) => n >>> (32 - bits) === toInt(base) >>> (32 - bits))
  }
  const v6 = ip.toLowerCase()
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7))
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') || v6.startsWith('ff')
}

export async function checkUrl(raw) {
  let u
  try {
    u = new URL(raw)
  } catch {
    throw new Error('Invalid URL')
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http and https URLs are allowed')
  if (u.username || u.password) throw new Error('Credentials in URLs are not allowed')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) throw new Error('Private addresses are not allowed')
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true })
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error('Private addresses are not allowed')
  return u
}

function safeLookup(hostname, options, cb) {
  lookup(hostname, { all: true })
    .then((addrs) => {
      if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) return cb(new Error('Private addresses are not allowed'))
      if (options && options.all) cb(null, addrs)
      else cb(null, addrs[0].address, addrs[0].family)
    })
    .catch((e) => cb(e))
}

function once(u, { method, headers, body, timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http
    const req = mod.request(u, { method, lookup: safeLookup, timeout: timeoutMs, headers: { 'user-agent': 'VixApi/1.0', 'accept-encoding': 'identity', ...headers } }, (res) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        return resolve({ status, location: res.headers.location, headers: res.headers, body: Buffer.alloc(0) })
      }
      const chunks = []
      let total = 0
      res.on('data', (c) => {
        total += c.length
        if (total > maxBytes) {
          res.destroy()
          return resolve({ status, headers: res.headers, body: Buffer.concat(chunks), truncated: true })
        }
        chunks.push(c)
      })
      res.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }))
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('Request timed out')))
    req.on('error', reject)
    if (body != null) req.write(body)
    req.end()
  })
}

/**
 * fetch() for untrusted code. Returns {status, headers, body (string)}.
 * @param {string} url
 * @param {{method?: string, headers?: Record<string,string>, body?: string, timeoutMs?: number, maxBytes?: number}} [opts]
 */
export async function safeFetch(url, opts = {}) {
  let method = String(opts.method || 'GET').toUpperCase()
  let body = opts.body == null ? null : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)
  const headers = {}
  for (const [k, v] of Object.entries(opts.headers || {})) if (!/^(host|connection|content-length|transfer-encoding)$/i.test(k)) headers[k.toLowerCase()] = String(v)
  if (body != null) headers['content-length'] = String(Buffer.byteLength(body))
  let current = url
  for (let hop = 0; hop < 4; hop++) {
    const u = await checkUrl(current)
    const r = await once(u, { method, headers, body, timeoutMs: opts.timeoutMs ?? 8000, maxBytes: opts.maxBytes ?? 2_000_000 })
    if (r.location) {
      current = new URL(r.location, u).toString()
      if (r.status === 303 || ((r.status === 301 || r.status === 302) && method === 'POST')) {
        method = 'GET'
        body = null
        delete headers['content-length']
      }
      continue
    }
    const outHeaders = {}
    for (const [k, v] of Object.entries(r.headers)) outHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v)
    return { status: r.status, ok: r.status >= 200 && r.status < 300, headers: outHeaders, body: r.body.toString('utf8'), url: u.toString() }
  }
  throw new Error('Too many redirects')
}
