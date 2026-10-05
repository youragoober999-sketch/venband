// Small helpers shared by the serverless functions.

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

export const bad = (msg) => new HttpError(400, msg)
export const unauthorized = (msg = 'Sign in first') => new HttpError(401, msg)
export const forbidden = (msg = 'You do not have access to this') => new HttpError(403, msg)
export const notFound = (msg = 'Not found') => new HttpError(404, msg)

export function send(res, status, data, headers = {}) {
  res.statusCode = status
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  if (data === undefined || data === null) return res.end()
  if (typeof data === 'string' || Buffer.isBuffer(data)) {
    if (!res.getHeader('content-type')) res.setHeader('content-type', 'text/plain; charset=utf-8')
    return res.end(data)
  }
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

export function sendError(res, err) {
  if (err instanceof HttpError) return send(res, err.status, { error: err.message, ...(err.extra || {}) })
  console.error(err)
  const msg = err && err.message && /SUPABASE|not configured/i.test(err.message) ? err.message : 'Something went wrong on our side. Please try again.'
  send(res, 500, { error: msg })
}

/**
 * Reads the raw request body as a string (max 1 MB).
 * Vercel pre-reads the body and replays it through the request stream, so the
 * stream is the source of truth. We never touch the lazy `req.body` parser
 * first, because it throws on invalid JSON - hosted endpoints must still see it.
 */
export async function rawBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let done = false
    const finish = (v) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(v)
    }
    // Safety net for runtimes that consumed the stream without replaying it.
    const timer = setTimeout(() => {
      try {
        const b = req.body
        finish(b == null ? '' : typeof b === 'string' ? b : Buffer.isBuffer(b) ? b.toString('utf8') : JSON.stringify(b))
      } catch {
        finish('')
      }
    }, 5000)
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        done = true
        clearTimeout(timer)
        reject(new HttpError(413, 'Request body is too large (1 MB max)'))
        return
      }
      chunks.push(typeof c === 'string' ? Buffer.from(c) : c)
    })
    req.on('end', () => finish(Buffer.concat(chunks).toString('utf8')))
    req.on('error', (e) => {
      if (!done) {
        done = true
        clearTimeout(timer)
        reject(e)
      }
    })
  })
}

export async function jsonBody(req) {
  const text = await rawBody(req)
  if (!text) return {}
  try {
    const v = JSON.parse(text)
    return v && typeof v === 'object' ? v : {}
  } catch {
    throw bad('Request body must be JSON')
  }
}

export function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  return fwd || String(req.headers['x-real-ip'] || req.socket?.remoteAddress || '')
}

/** Matches "/users/:id/*" style routes. Returns params or null. */
export function matchRoute(pattern, path) {
  const p = pattern.replace(/\/+$/, '') || '/'
  const a = path.replace(/\/+$/, '') || '/'
  const ps = p.split('/').filter(Boolean)
  const as = a.split('/').filter(Boolean)
  const params = {}
  for (let i = 0; i < ps.length; i++) {
    const seg = ps[i]
    if (seg === '*') {
      params['*'] = as.slice(i).map(decodeURIComponent).join('/')
      return params
    }
    if (i >= as.length) {
      if (seg.endsWith('?') && seg.startsWith(':')) continue
      return null
    }
    if (seg.startsWith(':')) params[seg.slice(1).replace(/\?$/, '')] = safeDecode(as[i])
    else if (seg.toLowerCase() !== as[i].toLowerCase()) return null
  }
  return ps.length >= as.length || ps[ps.length - 1] === '*' ? params : null
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** Route specificity: static segments beat params beat wildcards. */
export function routeScore(pattern) {
  return pattern.split('/').filter(Boolean).reduce((s, seg) => s + (seg === '*' ? 1 : seg.startsWith(':') ? 10 : 100), 0)
}
