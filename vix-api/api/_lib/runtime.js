// The hosted runtime: what happens when a game, app or AI calls
// https://<site>/v1/<owner>/<api>/<route>. It runs on Vercel serverless
// functions, so every API is reachable 24/7 whether or not anyone has the
// Vix Api website open.
import { randomUUID } from 'node:crypto'
import { waitUntil } from '@vercel/functions'
import { db, must } from './db.js'
import { lookupKey } from './auth.js'
import { HttpError, rawBody, clientIp, matchRoute, routeScore } from './http.js'
import { runFile, toResponse } from './exec.js'
import { safeFetch } from './net.js'
import { extensionConfig, extensionById, parseSecrets } from '../../shared/extensions.js'
import { languageForPath } from '../../shared/languages.js'

const later = (p) => {
  const safe = Promise.resolve(p).catch((e) => console.error('background task failed', e))
  try {
    waitUntil(safe)
  } catch {}
  return safe
}

export function ext(api, id) {
  const stored = (api.extensions || {})[id]
  if (!stored || !stored.enabled) return null
  const def = extensionById(id)
  return def ? extensionConfig(def, stored.config) : stored.config || {}
}

export function apiEnv(api) {
  const s = ext(api, 'secrets')
  return s ? parseSecrets(s.vars) : {}
}

/** Host functions offered to JavaScript endpoints (kv, fetch). */
export function makeHost(api, { readOnly = false } = {}) {
  let fetches = 0
  let kvOps = 0
  const kv = ext(api, 'kv')
  const needKv = () => {
    if (!kv) throw new Error('Enable the Key-Value Store extension to use vix.kv')
    if (++kvOps > 200) throw new Error('Too many KV operations in one request (200 max)')
  }
  return async (name, arg) => {
    switch (name) {
      case 'kv.get': {
        needKv()
        const row = must(await db().from('vix_kv').select('value').eq('api_id', api.id).eq('key', String(arg.key).slice(0, 256)).maybeSingle())
        return row ? row.value : null
      }
      case 'kv.set': {
        needKv()
        if (readOnly) throw new Error('Viewers can read the KV store but not change it')
        const key = String(arg.key).slice(0, 256)
        if (!key) throw new Error('KV keys cannot be empty')
        const json = JSON.stringify(arg.value ?? null)
        if (json.length > 200_000) throw new Error('KV values can be at most 200 KB')
        const exists = must(await db().from('vix_kv').select('key').eq('api_id', api.id).eq('key', key).maybeSingle())
        if (!exists) {
          const { count } = await db().from('vix_kv').select('key', { count: 'exact', head: true }).eq('api_id', api.id)
          if ((count || 0) >= (Number(kv.maxKeys) || 1000)) throw new Error(`KV store is full (${kv.maxKeys} keys)`)
        }
        must(await db().from('vix_kv').upsert({ api_id: api.id, key, value: arg.value ?? null, updated_at: new Date().toISOString() }, { onConflict: 'api_id,key' }))
        return true
      }
      case 'kv.delete': {
        needKv()
        if (readOnly) throw new Error('Viewers can read the KV store but not change it')
        must(await db().from('vix_kv').delete().eq('api_id', api.id).eq('key', String(arg.key)))
        return true
      }
      case 'kv.list': {
        needKv()
        let q = db().from('vix_kv').select('key, value').eq('api_id', api.id).order('key').limit(1000)
        if (arg.prefix) q = q.like('key', `${String(arg.prefix).replace(/[%_\\]/g, '\\$&')}%`)
        return must(await q)
      }
      case 'kv.incr': {
        needKv()
        if (readOnly) throw new Error('Viewers can read the KV store but not change it')
        const key = String(arg.key).slice(0, 256)
        const row = must(await db().from('vix_kv').select('value').eq('api_id', api.id).eq('key', key).maybeSingle())
        const next = (Number(row?.value) || 0) + (Number(arg.by) || 1)
        must(await db().from('vix_kv').upsert({ api_id: api.id, key, value: next, updated_at: new Date().toISOString() }, { onConflict: 'api_id,key' }))
        return next
      }
      case 'fetch': {
        if (++fetches > 10) throw new Error('At most 10 fetch calls per request')
        return safeFetch(arg.url, { method: arg.method, headers: arg.headers, body: arg.body, timeoutMs: 8000 })
      }
      default:
        throw new Error(`Unknown host call ${name}`)
    }
  }
}

function pickEndpoint(endpoints, method, path) {
  const candidates = []
  for (const e of endpoints) {
    if (!e.enabled) continue
    const params = matchRoute(e.route, path)
    if (!params) continue
    candidates.push({ e, params, score: routeScore(e.route) + (e.method === method ? 1 : 0) })
  }
  candidates.sort((a, b) => b.score - a.score)
  const exact = candidates.find((c) => c.e.method === method || c.e.method === 'ANY' || (method === 'HEAD' && c.e.method === 'GET'))
  if (exact) return { endpoint: exact.e, params: exact.params }
  return candidates.length ? { allowed: [...new Set(candidates.map((c) => c.e.method))] } : null
}

async function canUseKey(key, api) {
  if (!key.scopes.includes('invoke')) return false
  if (key.api_id && key.api_id !== api.id) return false
  if (key.user_id === api.owner_id) return true
  const m = must(await db().from('vix_api_members').select('role').eq('api_id', api.id).eq('user_id', key.user_id).maybeSingle())
  return !!m
}

function extractKey(req, url) {
  const header = String(req.headers['x-api-key'] || '').trim()
  if (header) return header
  const auth = String(req.headers.authorization || '')
  if (/^bearer\s+vix_/i.test(auth)) return auth.slice(7).trim()
  return url.searchParams.get('api_key') || url.searchParams.get('key') || ''
}

function corsHeaders(api, req) {
  const cors = ext(api, 'cors')
  if (!cors) return {}
  const origin = String(req.headers.origin || '')
  const allowed = String(cors.origins || '*').split(',').map((s) => s.trim()).filter(Boolean)
  let allow = ''
  if (allowed.includes('*')) allow = cors.credentials && origin ? origin : '*'
  else if (origin && allowed.includes(origin)) allow = origin
  if (!allow) return {}
  const h = {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': String(req.headers['access-control-request-headers'] || 'content-type, authorization, x-api-key'),
    'access-control-max-age': '600',
    vary: 'Origin',
  }
  if (cors.credentials) h['access-control-allow-credentials'] = 'true'
  return h
}

// Hosted responses share the site's origin, so user content (HTML, SVG, ...)
// is forced into an opaque-origin sandbox: it can run scripts but can never
// read the Vix Api session stored by the website.
const SANDBOX_CSP = "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads; frame-ancestors *"

function writeResponse(res, status, headers, body, pretty) {
  res.statusCode = status
  for (const [k, v] of Object.entries(headers)) {
    if (/^(content-length|transfer-encoding|connection|content-security-policy|set-cookie)$/i.test(k)) continue
    try {
      res.setHeader(k, v)
    } catch {}
  }
  res.setHeader('content-security-policy', SANDBOX_CSP)
  res.setHeader('x-content-type-options', 'nosniff')
  if (status === 204 || status === 304) return res.end()
  if (body === null || body === undefined) body = ''
  if (typeof body !== 'string') {
    if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/json; charset=utf-8')
    body = JSON.stringify(body, null, pretty ? 2 : 0)
  } else if (!res.getHeader('content-type')) {
    const t = body.trimStart()
    res.setHeader('content-type', (t.startsWith('{') || t.startsWith('[')) && isJson(t) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8')
  }
  if (pretty && /json/.test(String(res.getHeader('content-type'))) && typeof body === 'string') {
    try {
      body = JSON.stringify(JSON.parse(body), null, 2)
    } catch {}
  }
  if (body.length > 5_000_000) {
    res.statusCode = 502
    return res.end('{"error":"Response too large (5 MB max)"}')
  }
  res.end(body)
}

function isJson(s) {
  try {
    JSON.parse(s)
    return true
  } catch {
    return false
  }
}

function base(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0]
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost')
  return `${proto}://${host}`
}

/** OpenAPI 3.1 description of an API, for AI tools and API clients. */
export function openApiSpec(api, owner, endpoints, origin) {
  const paths = {}
  for (const e of endpoints.filter((x) => x.enabled)) {
    const params = []
    const p = e.route.replace(/:([A-Za-z0-9_]+)\??/g, (_, n) => {
      params.push({ name: n, in: 'path', required: true, schema: { type: 'string' } })
      return `{${n}}`
    }).replace(/\*/g, '{wildcard}')
    if (e.route.includes('*')) params.push({ name: 'wildcard', in: 'path', required: true, schema: { type: 'string' } })
    const methods = e.method === 'ANY' ? ['get', 'post'] : [e.method.toLowerCase()]
    paths[p] = paths[p] || {}
    for (const m of methods) {
      const op = {
        operationId: `${m}_${p.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'root'}`,
        summary: e.description || `${m.toUpperCase()} ${e.route}`,
        parameters: params,
        responses: { 200: { description: 'Success', content: { 'application/json': { schema: { type: 'object' } } } } },
      }
      if (m !== 'get' && m !== 'delete') op.requestBody = { required: false, content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } }
      if (e.public || !api.require_key) op.security = []
      paths[p][m] = op
    }
  }
  return {
    openapi: '3.1.0',
    info: { title: api.name, description: api.description || `${api.name} on Vix Api`, version: new Date(api.updated_at).toISOString().slice(0, 10) },
    servers: [{ url: `${origin}/v1/${owner.username}/${api.slug}` }],
    components: { securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' } } },
    security: [{ apiKey: [] }],
    paths,
  }
}

/** Tool definitions an AI model can call, one per endpoint. */
function toolList(endpoints) {
  return endpoints.filter((e) => e.enabled).map((e) => {
    const params = [...e.route.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1])
    const props = { query: { type: 'object', description: 'Query string parameters', additionalProperties: { type: 'string' } } }
    for (const p of params) props[p] = { type: 'string', description: `Path parameter ${p}` }
    if (e.method !== 'GET') props.body = { type: 'object', description: 'JSON request body', additionalProperties: true }
    if (e.method === 'ANY') props.method = { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }
    const name = `${e.method === 'ANY' ? 'call' : e.method.toLowerCase()}_${e.route.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'root'}`.slice(0, 64)
    return { name, description: e.description || `${e.method} ${e.route}`, inputSchema: { type: 'object', properties: props, required: params }, endpoint: e }
  })
}

/**
 * Runs one endpoint and returns {status, headers, body, log}.
 * Used by live requests and by scheduled jobs.
 */
export async function invoke({ api, owner, endpoint, request, requestId }) {
  const started = Date.now()
  const files = must(await db().from('vix_files').select('path, is_folder, content').eq('api_id', api.id))
  const lang = languageForPath(endpoint.file_path)
  const result = await runFile({
    entry: endpoint.file_path,
    files,
    request,
    env: apiEnv(api),
    host: makeHost(api),
    mode: 'handler',
    timeoutMs: lang.runner === 'remote' ? 20000 : 8000,
  })
  const out = toResponse(result)
  const consoleText = [result.stdout && lang.runner === 'quickjs' ? result.stdout : '', result.stderr || ''].filter(Boolean).join('\n').slice(0, 8000)
  return {
    ...out,
    durationMs: Date.now() - started,
    console: consoleText,
    error: out.status >= 500 ? (typeof out.body === 'object' ? out.body?.detail || out.body?.error || '' : '') : '',
    ctx: { requestId, owner: owner.username, api: api.slug },
  }
}

/** Entry point for /v1/:owner/:api/* */
export async function handleHosted(req, res) {
  const started = Date.now()
  const requestId = randomUUID()
  const url = new URL(req.url, 'http://local')
  let full = url.searchParams.get('__path')
  if (full === null) full = url.pathname.replace(/^\/(api\/run\/?|v1\/?)/, '')
  url.searchParams.delete('__path')
  const segs = String(full).split('/').filter(Boolean)
  const method = String(req.method || 'GET').toUpperCase()
  res.setHeader('x-request-id', requestId)
  res.setHeader('x-powered-by', 'Vix Api')

  const fail = (status, error, extra = {}, headers = {}) => writeResponse(res, status, { 'cache-control': 'no-store', ...headers }, { error, ...extra, request_id: requestId }, true)

  try {
    if (segs.length < 2) return fail(404, 'Use /v1/<username>/<api>/<route>')
    const [ownerName, slug, ...rest] = segs
    const path = '/' + rest.join('/')
    const owner = must(await db().from('vix_users').select('id, username').eq('username', ownerName.toLowerCase()).maybeSingle())
    const api = owner ? must(await db().from('vix_apis').select('*').eq('owner_id', owner.id).eq('slug', slug.toLowerCase()).maybeSingle()) : null
    if (!api) return fail(404, `No API at /v1/${ownerName}/${slug}`)

    const cors = corsHeaders(api, req)
    if (method === 'OPTIONS') {
      res.statusCode = 204
      for (const [k, v] of Object.entries(cors)) res.setHeader(k, v)
      res.setHeader('content-security-policy', SANDBOX_CSP)
      return res.end()
    }
    if (api.status === 'paused') return fail(503, 'This API is paused by its owner', {}, cors)
    const maint = ext(api, 'maintenance')
    if (maint) return fail(503, maint.message || 'Down for maintenance', {}, { ...cors, 'retry-after': '300' })
    const ip = clientIp(req)
    const allow = ext(api, 'ip-allowlist')
    if (allow && allow.ips) {
      const ips = String(allow.ips).split(',').map((s) => s.trim()).filter(Boolean)
      if (ips.length && !ips.includes(ip)) return fail(403, 'Your IP address is not on this API\'s allowlist', {}, cors)
    }

    const endpoints = must(await db().from('vix_endpoints').select('*').eq('api_id', api.id))
    const origin = base(req)

    // Built-in discovery documents.
    const openapiOn = !!ext(api, 'openapi')
    if (method === 'GET' && (path === '/openapi.json' || path === '/.well-known/openapi.json') && openapiOn && !endpoints.some((e) => e.route === path)) {
      return writeResponse(res, 200, { ...cors, 'cache-control': 'no-store' }, openApiSpec(api, owner, endpoints, origin), true)
    }
    if (path === '/mcp' && openapiOn && !endpoints.some((e) => e.route === '/mcp')) {
      return handleMcp(req, res, { api, owner, endpoints, cors, requestId, url })
    }
    const picked = pickEndpoint(endpoints, method, path)
    if (!picked) {
      if (path === '/' && method === 'GET') {
        return writeResponse(res, 200, { ...cors, 'cache-control': 'no-store' }, {
          name: api.name,
          description: api.description,
          owner: owner.username,
          base_url: `${origin}/v1/${owner.username}/${api.slug}`,
          auth: api.require_key ? 'Send your Vix API key in the x-api-key header' : 'No key needed',
          endpoints: endpoints.filter((e) => e.enabled).map((e) => ({ method: e.method, route: e.route, description: e.description, needs_key: api.require_key && !e.public })),
          openapi: openapiOn ? `${origin}/v1/${owner.username}/${api.slug}/openapi.json` : undefined,
          mcp: openapiOn ? `${origin}/v1/${owner.username}/${api.slug}/mcp` : undefined,
        }, true)
      }
      return fail(404, `No endpoint for ${method} ${path}`, { endpoints: endpoints.filter((e) => e.enabled).map((e) => `${e.method} ${e.route}`) }, cors)
    }
    if (!picked.endpoint) return fail(405, `${method} is not allowed on ${path}`, { allowed: picked.allowed }, { ...cors, allow: picked.allowed.join(', ') })
    const { endpoint, params } = picked

    // API keys.
    let key = null
    const rawKey = extractKey(req, url)
    if (api.require_key && !endpoint.public) {
      if (!rawKey) return fail(401, 'This endpoint needs an API key. Send it in the x-api-key header.', { docs: `${origin}/docs/reference` }, cors)
      key = await lookupKey(rawKey)
      if (!key || !(await canUseKey(key, api))) return fail(401, 'That API key is invalid, revoked, or not allowed to use this API', {}, cors)
    } else if (rawKey) {
      key = await lookupKey(rawKey).catch(() => null)
    }

    // Rate limiting.
    const rl = ext(api, 'rate-limit')
    if (rl) {
      const limit = Math.max(1, Number(rl.perMinute) || 60)
      const bucket = `rl:${api.id}:${key ? key.id : ip}`
      const { data } = await db().rpc('vix_hit', { p_bucket: bucket, p_limit: limit, p_window_seconds: 60 })
      if (data === false) return fail(429, `Rate limit reached (${limit} requests per minute)`, {}, { ...cors, 'retry-after': '60' })
    }

    // Build the request object user code sees.
    const text = method === 'GET' || method === 'HEAD' ? '' : await rawBody(req)
    let body = text
    const ctype = String(req.headers['content-type'] || '')
    if (text && (/json/i.test(ctype) || /^\s*[[{]/.test(text))) {
      try {
        body = JSON.parse(text)
      } catch {}
    } else if (text && /x-www-form-urlencoded/i.test(ctype)) {
      body = Object.fromEntries(new URLSearchParams(text))
    }
    const query = {}
    for (const [k, v] of url.searchParams) if (k !== 'api_key' && k !== 'key') query[k] = v
    const headers = {}
    for (const [k, v] of Object.entries(req.headers)) {
      if (/^(x-api-key|cookie|x-vercel-|x-forwarded-|x-real-ip|forwarded)/i.test(k)) continue
      if (k === 'authorization' && /^bearer\s+vix_/i.test(String(v))) continue
      headers[k] = Array.isArray(v) ? v.join(', ') : String(v)
    }
    const request = { method, path, query, headers, body: body === '' ? null : body, rawBody: text, params, ip, requestId, keyName: key ? key.name : null }

    // Response cache.
    const cache = method === 'GET' ? ext(api, 'cache') : null
    const cacheKey = cache ? `${endpoint.id}:${path}?${new URLSearchParams(query).toString()}` : ''
    if (cache) {
      const hit = must(await db().from('vix_cache').select('response, expires_at').eq('api_id', api.id).eq('cache_key', cacheKey).maybeSingle())
      if (hit && new Date(hit.expires_at) > new Date()) {
        const r = hit.response
        writeResponse(res, r.status, { ...r.headers, ...cors, 'x-vix-cache': 'HIT' }, r.body, !!ext(api, 'pretty-json'))
        later(finish({ api, endpoint, key, ip, method, path, status: r.status, durationMs: Date.now() - started, cached: true, consoleText: '', error: '', bodyText: '' }))
        return
      }
    }

    const out = await invoke({ api, owner, endpoint, request, requestId })
    const resHeaders = { 'cache-control': 'no-store', ...out.headers, ...cors, 'x-vix-duration': String(out.durationMs) }
    if (cache && out.status === 200) {
      resHeaders['x-vix-cache'] = 'MISS'
      later(db().from('vix_cache').upsert({ api_id: api.id, cache_key: cacheKey, response: { status: out.status, headers: out.headers, body: out.body }, expires_at: new Date(Date.now() + (Number(cache.ttl) || 30) * 1000).toISOString() }, { onConflict: 'api_id,cache_key' }))
    }
    writeResponse(res, out.status, resHeaders, method === 'HEAD' ? '' : out.body, !!ext(api, 'pretty-json'))
    later(finish({ api, endpoint, key, ip, method, path, status: out.status, durationMs: Date.now() - started, cached: false, consoleText: out.console, error: out.error, bodyText: text }))
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message)
    console.error(err)
    return fail(500, 'Vix Api had a problem running this request')
  }
}

async function finish({ api, endpoint, key, ip, method, path, status, durationMs, cached, consoleText, error, bodyText }) {
  const jobs = []
  if (key) jobs.push(db().rpc('vix_key_used', { p_key: key.id }))
  const logger = ext(api, 'logger')
  if (logger) {
    jobs.push(db().from('vix_logs').insert({
      api_id: api.id, method, path, status, duration_ms: durationMs, key_id: key ? key.id : null, ip: String(ip).slice(0, 64), cached,
      error: String(error || '').slice(0, 2000), console: String(consoleText || '').slice(0, 4000), body: logger.captureBodies ? String(bodyText || '').slice(0, 4000) : '',
    }))
  }
  const hook = ext(api, 'webhook')
  if (hook && hook.url) {
    const isDiscord = /discord(app)?\.com\/api\/webhooks/.test(hook.url)
    const isSlack = /hooks\.slack\.com/.test(hook.url)
    const line = `${status < 400 ? '✅' : '⚠️'} ${method} ${path} → ${status} (${durationMs} ms) on ${api.name}`
    const payload = isDiscord ? { content: line } : isSlack ? { text: line } : { api: api.slug, endpoint: `${endpoint.method} ${endpoint.route}`, method, path, status, duration_ms: durationMs, at: new Date().toISOString() }
    jobs.push(safeFetch(hook.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), timeoutMs: 4000 }))
  }
  await Promise.allSettled(jobs)
}

/** A minimal Model Context Protocol server (JSON-RPC over HTTP POST). */
async function handleMcp(req, res, { api, owner, endpoints, cors, requestId, url }) {
  const reply = (obj, status = 200) => writeResponse(res, status, { ...cors, 'cache-control': 'no-store', 'content-type': 'application/json' }, obj, false)
  if (req.method === 'GET') {
    return reply({ name: api.name, protocol: 'mcp', transport: 'streamable-http (JSON responses)', hint: 'POST JSON-RPC 2.0 messages here, e.g. {"jsonrpc":"2.0","id":1,"method":"tools/list"}' })
  }
  if (req.method !== 'POST') return reply({ error: 'Use POST' }, 405)
  let msg
  try {
    msg = JSON.parse(await rawBody(req))
  } catch {
    return reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400)
  }
  const tools = toolList(endpoints)
  // MCP tool calls need a key unless the API is open.
  const rawKey = extractKey(req, url)
  let key = null
  if (rawKey) key = await lookupKey(rawKey)
  const authed = !api.require_key || (key && (await canUseKey(key, api)))

  async function one(m) {
    const id = m.id ?? null
    const ok = (result) => ({ jsonrpc: '2.0', id, result })
    const err = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } })
    switch (m.method) {
      case 'initialize':
        return ok({ protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: `vix-${owner.username}-${api.slug}`, title: api.name, version: '1.0.0' }, instructions: api.description || undefined })
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return null
      case 'ping':
        return ok({})
      case 'tools/list':
        return ok({ tools: tools.map(({ endpoint, ...t }) => t) })
      case 'tools/call': {
        const tool = tools.find((t) => t.name === m.params?.name)
        if (!tool) return err(-32602, `Unknown tool ${m.params?.name}`)
        if (!authed && !tool.endpoint.public) return ok({ isError: true, content: [{ type: 'text', text: 'This API needs a Vix API key: send it in the x-api-key header of the MCP connection.' }] })
        const args = m.params?.arguments || {}
        let path = tool.endpoint.route
        const params = {}
        path = path.replace(/:([A-Za-z0-9_]+)\??/g, (_, n) => {
          params[n] = String(args[n] ?? '')
          return encodeURIComponent(params[n])
        })
        const method = tool.endpoint.method === 'ANY' ? String(args.method || 'GET').toUpperCase() : tool.endpoint.method
        const request = { method, path, query: args.query || {}, headers: {}, body: args.body ?? null, rawBody: args.body ? JSON.stringify(args.body) : '', params, ip: clientIp(req), requestId, keyName: key ? key.name : null }
        const out = await invoke({ api, owner, endpoint: tool.endpoint, request, requestId })
        later(finish({ api, endpoint: tool.endpoint, key, ip: clientIp(req), method, path: `${path} (mcp)`, status: out.status, durationMs: out.durationMs, cached: false, consoleText: out.console, error: out.error, bodyText: '' }))
        const text = typeof out.body === 'string' ? out.body : JSON.stringify(out.body, null, 2)
        return ok({ isError: out.status >= 400, content: [{ type: 'text', text }], structuredContent: typeof out.body === 'object' && out.body && !Array.isArray(out.body) ? out.body : undefined })
      }
      default:
        return id === null ? null : err(-32601, `Method not found: ${m.method}`)
    }
  }

  if (Array.isArray(msg)) {
    const results = (await Promise.all(msg.map(one))).filter(Boolean)
    if (!results.length) return writeResponse(res, 202, cors, '', false)
    return reply(results)
  }
  const result = await one(msg)
  if (!result) return writeResponse(res, 202, cors, '', false)
  return reply(result)
}

/** Runs every enabled "Scheduled Jobs" extension. Called by /api/cron. */
export async function runScheduled(limit = 50) {
  const apis = must(await db().from('vix_apis').select('*').eq('status', 'live').limit(2000))
  const due = apis.filter((a) => ext(a, 'scheduler')).slice(0, limit)
  const results = []
  for (const api of due) {
    const cfg = ext(api, 'scheduler')
    const [m, r] = String(cfg.route || 'GET /').trim().split(/\s+/)
    const method = r ? m.toUpperCase() : 'GET'
    const path = r || m || '/'
    const endpoints = must(await db().from('vix_endpoints').select('*').eq('api_id', api.id))
    const picked = pickEndpoint(endpoints, method, path)
    if (!picked || !picked.endpoint) {
      results.push({ api: api.slug, skipped: `no endpoint for ${method} ${path}` })
      continue
    }
    const owner = must(await db().from('vix_users').select('id, username').eq('id', api.owner_id).single())
    const requestId = randomUUID()
    const request = { method, path, query: { scheduled: 'true' }, headers: { 'user-agent': 'vix-scheduler' }, body: null, rawBody: '', params: picked.params, ip: 'scheduler', requestId, keyName: 'scheduler' }
    try {
      const out = await invoke({ api, owner, endpoint: picked.endpoint, request, requestId })
      await finish({ api, endpoint: picked.endpoint, key: null, ip: 'scheduler', method, path: `${path} (scheduled)`, status: out.status, durationMs: out.durationMs, cached: false, consoleText: out.console, error: out.error, bodyText: '' })
      results.push({ api: api.slug, status: out.status })
    } catch (e) {
      results.push({ api: api.slug, error: e.message })
    }
  }
  return results
}
