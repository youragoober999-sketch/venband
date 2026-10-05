// Username + password accounts, sessions and API keys.
// Passwords are hashed with scrypt; session tokens and API keys are random and
// only their SHA-256 hashes are stored, so a database leak reveals neither.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { db, must } from './db.js'
import { HttpError, unauthorized, forbidden } from './http.js'

const scrypt = promisify(scryptCb)
const N = 16384, R = 8, P = 1, LEN = 64
export const SESSION_DAYS = 30

export const sha256 = (s) => createHash('sha256').update(s).digest('hex')

export async function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = await scrypt(password, salt, LEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 })
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export async function verifyPassword(password, stored) {
  const parts = String(stored).split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, salt, hash] = parts
  const expected = Buffer.from(hash, 'base64')
  const got = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p, maxmem: 64 * 1024 * 1024 })
  return got.length === expected.length && timingSafeEqual(got, expected)
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
export function randomString(len) {
  const bytes = randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

export const USERNAME_RE = /^[a-z0-9_.-]{3,24}$/

export function validateUsername(raw) {
  const username = String(raw || '').trim().toLowerCase()
  if (!USERNAME_RE.test(username)) throw new HttpError(400, 'Usernames are 3-24 characters: letters, numbers, dots, dashes and underscores')
  if (/^(admin|root|system|vix|vixapi|support|api|null|undefined|me)$/.test(username)) throw new HttpError(400, 'That username is reserved')
  return username
}

export function validatePassword(raw) {
  const password = String(raw || '')
  if (password.length < 8) throw new HttpError(400, 'Passwords need at least 8 characters')
  if (password.length > 200) throw new HttpError(400, 'Passwords can be at most 200 characters')
  return password
}

export async function createSession(userId, userAgent) {
  const token = `vxs_${randomString(40)}`
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000)
  must(await db().from('vix_sessions').insert({ user_id: userId, token_hash: sha256(token), user_agent: String(userAgent || '').slice(0, 200), expires_at: expires.toISOString() }))
  return { token, expires_at: expires.toISOString() }
}

export function newApiKey() {
  const key = `vix_${randomString(40)}`
  return { key, prefix: key.slice(0, 12), hash: sha256(key) }
}

export const PUBLIC_USER = 'id, username, display_name, bio, avatar_color, created_at'

/**
 * Identifies the caller from `Authorization: Bearer <session or API key>` or
 * `x-api-key`. Returns null when no credentials were sent.
 */
export async function identify(req) {
  const header = String(req.headers.authorization || '')
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  const apiKey = String(req.headers['x-api-key'] || '').trim() || (bearer.startsWith('vix_') ? bearer : '')
  if (apiKey) {
    const key = await lookupKey(apiKey)
    if (!key) throw unauthorized('That API key is invalid, expired or revoked')
    const user = must(await db().from('vix_users').select(`${PUBLIC_USER}, settings`).eq('id', key.user_id).maybeSingle())
    if (!user) throw unauthorized('That API key is invalid')
    return { user, via: 'key', key }
  }
  if (bearer.startsWith('vxs_')) {
    const session = must(await db().from('vix_sessions').select('id, user_id, expires_at').eq('token_hash', sha256(bearer)).maybeSingle())
    if (!session || new Date(session.expires_at) < new Date()) throw unauthorized('Your session expired, please sign in again')
    const user = must(await db().from('vix_users').select(`${PUBLIC_USER}, settings, last_seen_at`).eq('id', session.user_id).maybeSingle())
    if (!user) throw unauthorized()
    if (Date.now() - new Date(user.last_seen_at).getTime() > 5 * 60_000) {
      db().from('vix_users').update({ last_seen_at: new Date().toISOString() }).eq('id', user.id).then(() => {}, () => {})
    }
    delete user.last_seen_at
    return { user, via: 'session', session }
  }
  return null
}

export async function requireUser(req, scope = 'manage') {
  const who = await identify(req)
  if (!who) throw unauthorized()
  if (who.via === 'key' && !who.key.scopes.includes(scope)) throw forbidden(`This API key does not have the "${scope}" scope`)
  return who
}

export async function lookupKey(raw) {
  const key = must(await db().from('vix_keys').select('id, user_id, api_id, name, scopes, expires_at, revoked_at').eq('key_hash', sha256(raw)).maybeSingle())
  if (!key || key.revoked_at) return null
  if (key.expires_at && new Date(key.expires_at) < new Date()) return null
  return key
}

/** Atomic rate limit; throws 429 when the bucket is full. */
export async function rateLimit(bucket, limit, windowSeconds, message = 'Too many requests, slow down a little') {
  const { data, error } = await db().rpc('vix_hit', { p_bucket: bucket, p_limit: limit, p_window_seconds: windowSeconds })
  if (error) return // fail open: never lock people out because of the limiter itself
  if (data === false) throw new HttpError(429, message)
}
