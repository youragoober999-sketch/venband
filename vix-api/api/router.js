// The Vix Api platform API: accounts, APIs, files, endpoints, keys, friends,
// sharing, versions, logs, KV data and the sandbox runner.
// Every /api/* URL (except /api/run and /api/cron) is rewritten here by vercel.json.
import { db, must } from './_lib/db.js'
import { send, sendError, jsonBody, bad, notFound, forbidden, HttpError, clientIp, matchRoute } from './_lib/http.js'
import {
  hashPassword, verifyPassword, createSession, validateUsername, validatePassword, requireUser, identify,
  newApiKey, rateLimit, PUBLIC_USER,
} from './_lib/auth.js'
import { loadApi, checkKeyScope, redactApi } from './_lib/access.js'
import { runFile } from './_lib/exec.js'
import { makeHost, apiEnv } from './_lib/runtime.js'
import { LANGUAGES, languageForPath } from '../shared/languages.js'
import { EXTENSIONS, extensionById, defaultApiExtensions } from '../shared/extensions.js'
import { TEMPLATES, templateById } from '../shared/templates.js'

const routes = []
const route = (method, pattern, fn) => routes.push({ method, pattern, fn })

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,47}$/
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ANY']
const MAX_FILES = 500

function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'api'
}

export function cleanPath(raw) {
  const p = String(raw || '').replace(/\\/g, '/').split('/').filter((s) => s && s !== '.').join('/')
  if (!p || p.split('/').some((s) => s === '..')) throw bad('Invalid file path')
  if (p.length > 300) throw bad('File paths can be at most 300 characters')
  if (/[\u0000-\u001f<>:"|?*]/.test(p)) throw bad('File names cannot contain control characters or <>:"|?*')
  return p
}

function cleanRoute(raw) {
  let r = String(raw || '').trim()
  if (!r.startsWith('/')) r = '/' + r
  r = r.replace(/\/{2,}/g, '/')
  if (r.length > 1) r = r.replace(/\/+$/, '')
  if (!/^\/[A-Za-z0-9_\-.:~*/?]*$/.test(r)) throw bad('Routes can use letters, numbers, - _ . ~ and :params or * wildcards')
  return r
}

async function ensureParents(apiId, path, userId) {
  const parts = path.split('/')
  const rows = []
  for (let i = 1; i < parts.length; i++) rows.push({ api_id: apiId, path: parts.slice(0, i).join('/'), is_folder: true, content: '', updated_by: userId })
  if (rows.length) must(await db().from('vix_files').upsert(rows, { onConflict: 'api_id,path', ignoreDuplicates: true }))
}

async function touch(apiId) {
  await db().from('vix_apis').update({ updated_at: new Date().toISOString() }).eq('id', apiId)
}

function publicApi(api, extra = {}) {
  return { ...api, ...extra }
}

// ------------------------------------------------------------------ meta ----

route('GET', '/health', async () => {
  let database = 'ok'
  try {
    must(await db().from('vix_users').select('id', { head: true, count: 'exact' }).limit(1))
  } catch (e) {
    database = e.message
  }
  return { ok: database === 'ok', database, runner: process.env.PISTON_URL ? 'piston' : 'wandbox', time: new Date().toISOString() }
})

route('GET', '/catalog', async () => ({
  languages: LANGUAGES.map(({ hello, endpoint, ...l }) => ({ ...l, hasEndpointTemplate: !!endpoint })),
  extensions: EXTENSIONS,
  templates: TEMPLATES.map(({ files, endpoints, ...t }) => ({ ...t, endpoints: endpoints.length, files: files.length })),
}))

// ------------------------------------------------------------------ auth ----

route('POST', '/auth/signup', async (req) => {
  const body = await jsonBody(req)
  await rateLimit(`signup:${clientIp(req)}`, 5, 3600, 'Too many new accounts from your network. Try again in an hour.')
  const username = validateUsername(body.username)
  const password = validatePassword(body.password)
  if (password.toLowerCase().includes(username)) throw bad('Your password should not contain your username')
  const exists = must(await db().from('vix_users').select('id').eq('username', username).maybeSingle())
  if (exists) throw new HttpError(409, 'That username is taken')
  const colors = ['#8b5cf6', '#06b6d4', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#3b82f6', '#14b8a6']
  const user = must(await db().from('vix_users').insert({
    username,
    display_name: String(body.display_name || body.username).trim().slice(0, 40),
    password_hash: await hashPassword(password),
    avatar_color: colors[Math.floor(Math.random() * colors.length)],
    settings: body.settings && typeof body.settings === 'object' ? body.settings : {},
  }).select(`${PUBLIC_USER}, settings`).single())
  const session = await createSession(user.id, req.headers['user-agent'])
  return { status: 201, body: { user, ...session } }
})

route('POST', '/auth/login', async (req) => {
  const body = await jsonBody(req)
  const username = String(body.username || '').trim().toLowerCase()
  await rateLimit(`login:${clientIp(req)}`, 20, 600, 'Too many sign-in attempts. Wait 10 minutes and try again.')
  await rateLimit(`login-user:${username}`, 10, 600, 'Too many sign-in attempts for this account. Wait 10 minutes and try again.')
  const row = must(await db().from('vix_users').select(`${PUBLIC_USER}, settings, password_hash`).eq('username', username).maybeSingle())
  // Always run scrypt so response time does not reveal whether the user exists.
  const ok = await verifyPassword(String(body.password || ''), row ? row.password_hash : 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==')
  if (!row || !ok) throw new HttpError(401, 'Wrong username or password')
  delete row.password_hash
  const session = await createSession(row.id, req.headers['user-agent'])
  return { user: row, ...session }
})

route('POST', '/auth/logout', async (req) => {
  const who = await identify(req)
  if (who && who.via === 'session') must(await db().from('vix_sessions').delete().eq('id', who.session.id))
  return { ok: true }
})

route('POST', '/auth/logout-all', async (req) => {
  const { user } = await requireUser(req)
  must(await db().from('vix_sessions').delete().eq('user_id', user.id))
  return { ok: true }
})

route('GET', '/auth/me', async (req) => {
  const { user, via } = await requireUser(req, 'invoke')
  return { user, via }
})

route('GET', '/auth/sessions', async (req) => {
  const { user, session } = await requireUser(req)
  const rows = must(await db().from('vix_sessions').select('id, user_agent, created_at, expires_at').eq('user_id', user.id).order('created_at', { ascending: false }))
  return { sessions: rows.map((s) => ({ ...s, current: session && s.id === session.id })) }
})

route('DELETE', '/auth/sessions/:id', async (req, p) => {
  const { user } = await requireUser(req)
  must(await db().from('vix_sessions').delete().eq('id', p.id).eq('user_id', user.id))
  return { ok: true }
})

route('PATCH', '/me', async (req) => {
  const { user } = await requireUser(req)
  const body = await jsonBody(req)
  const patch = {}
  if (body.display_name !== undefined) patch.display_name = String(body.display_name).trim().slice(0, 40)
  if (body.bio !== undefined) patch.bio = String(body.bio).slice(0, 300)
  if (body.avatar_color !== undefined && /^#[0-9a-f]{6}$/i.test(body.avatar_color)) patch.avatar_color = body.avatar_color
  if (body.settings !== undefined) {
    if (!body.settings || typeof body.settings !== 'object' || JSON.stringify(body.settings).length > 20000) throw bad('Invalid settings')
    patch.settings = body.settings
  }
  const row = must(await db().from('vix_users').update(patch).eq('id', user.id).select(`${PUBLIC_USER}, settings`).single())
  return { user: row }
})

route('POST', '/me/password', async (req) => {
  const { user, session } = await requireUser(req)
  const body = await jsonBody(req)
  await rateLimit(`pw:${user.id}`, 5, 600)
  const row = must(await db().from('vix_users').select('password_hash').eq('id', user.id).single())
  if (!(await verifyPassword(String(body.current || ''), row.password_hash))) throw new HttpError(401, 'Your current password is wrong')
  const next = validatePassword(body.password)
  must(await db().from('vix_users').update({ password_hash: await hashPassword(next) }).eq('id', user.id))
  // Sign out every other device.
  let q = db().from('vix_sessions').delete().eq('user_id', user.id)
  if (session) q = q.neq('id', session.id)
  must(await q)
  return { ok: true }
})

route('DELETE', '/me', async (req) => {
  const { user } = await requireUser(req)
  const body = await jsonBody(req)
  const row = must(await db().from('vix_users').select('password_hash, username').eq('id', user.id).single())
  if (!(await verifyPassword(String(body.password || ''), row.password_hash))) throw new HttpError(401, 'Wrong password')
  must(await db().from('vix_users').delete().eq('id', user.id))
  return { ok: true }
})

route('GET', '/me/export', async (req) => {
  const { user } = await requireUser(req)
  const apis = must(await db().from('vix_apis').select('*').eq('owner_id', user.id))
  const ids = apis.map((a) => a.id)
  const files = ids.length ? must(await db().from('vix_files').select('api_id, path, is_folder, content').in('api_id', ids)) : []
  const endpoints = ids.length ? must(await db().from('vix_endpoints').select('*').in('api_id', ids)) : []
  return { exported_at: new Date().toISOString(), user, apis, files, endpoints }
})

// ----------------------------------------------------------------- users ----

route('GET', '/users/search', async (req, _p, url) => {
  await requireUser(req)
  const q = String(url.searchParams.get('q') || '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '')
  if (q.length < 2) return { users: [] }
  const rows = must(await db().from('vix_users').select(PUBLIC_USER).ilike('username', `${q}%`).order('username').limit(10))
  return { users: rows }
})

route('GET', '/users/:username', async (req, p) => {
  const { user } = await requireUser(req)
  const row = must(await db().from('vix_users').select(PUBLIC_USER).eq('username', String(p.username).toLowerCase()).maybeSingle())
  if (!row) throw notFound('User not found')
  const apis = must(await db().from('vix_apis').select('id, slug, name, description, icon, updated_at').eq('owner_id', row.id).eq('visibility', 'public').order('updated_at', { ascending: false }).limit(50))
  const fr = must(await db().from('vix_friends').select('id, status, requester_id').or(`and(requester_id.eq.${user.id},addressee_id.eq.${row.id}),and(requester_id.eq.${row.id},addressee_id.eq.${user.id})`).maybeSingle())
  return { user: row, apis, friendship: fr ? { id: fr.id, status: fr.status, outgoing: fr.requester_id === user.id } : null }
})

// --------------------------------------------------------------- friends ----

route('GET', '/friends', async (req) => {
  const { user } = await requireUser(req)
  const rows = must(await db().from('vix_friends').select('id, status, created_at, requester_id, addressee_id').or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`))
  const otherIds = rows.map((r) => (r.requester_id === user.id ? r.addressee_id : r.requester_id))
  const people = otherIds.length ? must(await db().from('vix_users').select(`${PUBLIC_USER}, last_seen_at`).in('id', otherIds)) : []
  const byId = new Map(people.map((u) => [u.id, u]))
  const list = rows.map((r) => {
    const other = byId.get(r.requester_id === user.id ? r.addressee_id : r.requester_id)
    return { id: r.id, status: r.status, created_at: r.created_at, outgoing: r.requester_id === user.id, user: other }
  }).filter((r) => r.user)
  return {
    friends: list.filter((r) => r.status === 'accepted'),
    incoming: list.filter((r) => r.status === 'pending' && !r.outgoing),
    outgoing: list.filter((r) => r.status === 'pending' && r.outgoing),
  }
})

route('POST', '/friends', async (req) => {
  const { user } = await requireUser(req)
  const body = await jsonBody(req)
  await rateLimit(`friend:${user.id}`, 30, 3600)
  const username = String(body.username || '').trim().toLowerCase().replace(/^@/, '')
  const target = must(await db().from('vix_users').select('id, username').eq('username', username).maybeSingle())
  if (!target) throw notFound(`No user called "${username}"`)
  if (target.id === user.id) throw bad("You can't add yourself")
  const existing = must(await db().from('vix_friends').select('*').or(`and(requester_id.eq.${user.id},addressee_id.eq.${target.id}),and(requester_id.eq.${target.id},addressee_id.eq.${user.id})`).maybeSingle())
  if (existing) {
    if (existing.status === 'accepted') return { ok: true, status: 'accepted' }
    if (existing.addressee_id === user.id) {
      must(await db().from('vix_friends').update({ status: 'accepted' }).eq('id', existing.id))
      return { ok: true, status: 'accepted' }
    }
    return { ok: true, status: 'pending' }
  }
  must(await db().from('vix_friends').insert({ requester_id: user.id, addressee_id: target.id }))
  return { status: 201, body: { ok: true, status: 'pending' } }
})

route('POST', '/friends/:id/accept', async (req, p) => {
  const { user } = await requireUser(req)
  const row = must(await db().from('vix_friends').update({ status: 'accepted' }).eq('id', p.id).eq('addressee_id', user.id).select('id').maybeSingle())
  if (!row) throw notFound('Friend request not found')
  return { ok: true }
})

route('DELETE', '/friends/:id', async (req, p) => {
  const { user } = await requireUser(req)
  const row = must(await db().from('vix_friends').select('*').eq('id', p.id).maybeSingle())
  if (!row || (row.requester_id !== user.id && row.addressee_id !== user.id)) throw notFound('Friend not found')
  must(await db().from('vix_friends').delete().eq('id', p.id))
  return { ok: true }
})

// ------------------------------------------------------------------ apis ----

route('GET', '/apis', async (req) => {
  const who = await requireUser(req)
  const { user } = who
  const own = must(await db().from('vix_apis').select('*').eq('owner_id', user.id).order('updated_at', { ascending: false }))
  const memberships = must(await db().from('vix_api_members').select('api_id, role').eq('user_id', user.id))
  const shared = memberships.length ? must(await db().from('vix_apis').select('*').in('id', memberships.map((m) => m.api_id))) : []
  const ownerIds = [...new Set(shared.map((a) => a.owner_id))]
  const owners = ownerIds.length ? must(await db().from('vix_users').select('id, username').in('id', ownerIds)) : []
  const ownerName = new Map(owners.map((o) => [o.id, o.username]))
  const all = [
    ...own.map((a) => publicApi(a, { role: 'owner', owner_username: user.username })),
    ...shared.map((a) => { const role = memberships.find((m) => m.api_id === a.id)?.role; return publicApi(redactApi(a, role), { role, owner_username: ownerName.get(a.owner_id) }) }),
  ].filter((a) => !(who.via === 'key' && who.key.api_id && who.key.api_id !== a.id))
  const ids = all.map((a) => a.id)
  const counts = new Map()
  if (ids.length) {
    const eps = must(await db().from('vix_endpoints').select('api_id').in('api_id', ids))
    for (const e of eps) counts.set(e.api_id, (counts.get(e.api_id) || 0) + 1)
  }
  return { apis: all.map((a) => ({ ...a, endpoint_count: counts.get(a.id) || 0 })) }
})

route('POST', '/apis', async (req) => {
  const { user } = await requireUser(req)
  const body = await jsonBody(req)
  await rateLimit(`create-api:${user.id}`, 30, 3600)
  const name = String(body.name || '').trim().slice(0, 60)
  if (!name) throw bad('Give your API a name')
  const slug = body.slug ? String(body.slug).toLowerCase() : slugify(name)
  if (!SLUG_RE.test(slug)) throw bad('URL names use lowercase letters, numbers and dashes')
  const template = templateById(body.template || 'hello-js')
  const api = must(await db().from('vix_apis').insert({
    owner_id: user.id,
    slug,
    name,
    description: String(body.description || template.description || '').slice(0, 500),
    icon: String(body.icon || template.icon || '⚡').slice(0, 8),
    visibility: body.visibility === 'public' ? 'public' : 'private',
    require_key: body.require_key !== false,
    extensions: defaultApiExtensions(),
  }).select('*').single())
  if (template.files.length) {
    must(await db().from('vix_files').insert(template.files.map((f) => ({ api_id: api.id, path: f.path, is_folder: !!f.is_folder, content: f.content || '', updated_by: user.id }))))
  }
  if (template.endpoints.length) {
    must(await db().from('vix_endpoints').insert(template.endpoints.map((e) => ({ api_id: api.id, method: e.method, route: e.route, file_path: e.file_path, description: e.description || '', public: !!e.public }))))
  }
  return { status: 201, body: { api: { ...api, role: 'owner', owner_username: user.username } } }
})

route('GET', '/apis/:id', async (req, p) => {
  const who = await requireUser(req)
  checkKeyScope(who, p.id)
  const { api, role } = await loadApi(who, p.id)
  const [files, endpoints, members, owner] = await Promise.all([
    db().from('vix_files').select('id, path, is_folder, content, updated_at, updated_by').eq('api_id', api.id).order('path'),
    db().from('vix_endpoints').select('*').eq('api_id', api.id).order('route'),
    db().from('vix_api_members').select('user_id, role, added_at').eq('api_id', api.id),
    db().from('vix_users').select(PUBLIC_USER).eq('id', api.owner_id).single(),
  ]).then((rs) => rs.map((r) => must(r)))
  const memberUsers = members.length ? must(await db().from('vix_users').select(PUBLIC_USER).in('id', members.map((m) => m.user_id))) : []
  const byId = new Map(memberUsers.map((u) => [u.id, u]))
  return {
    api: { ...redactApi(api, role), role, owner_username: owner.username },
    owner,
    files,
    endpoints,
    members: members.map((m) => ({ ...m, user: byId.get(m.user_id) })).filter((m) => m.user),
  }
})

route('PATCH', '/apis/:id', async (req, p) => {
  const who = await requireUser(req)
  checkKeyScope(who, p.id)
  const { api, role } = await loadApi(who, p.id, 'editor')
  const body = await jsonBody(req)
  const patch = { updated_at: new Date().toISOString() }
  if (body.name !== undefined) patch.name = String(body.name).trim().slice(0, 60) || api.name
  if (body.description !== undefined) patch.description = String(body.description).slice(0, 500)
  if (body.icon !== undefined) patch.icon = String(body.icon).slice(0, 8)
  if (body.status !== undefined) patch.status = body.status === 'paused' ? 'paused' : 'live'
  if (body.require_key !== undefined) patch.require_key = !!body.require_key
  if (body.visibility !== undefined) patch.visibility = body.visibility === 'public' ? 'public' : 'private'
  if (body.slug !== undefined) {
    if (role !== 'owner') throw forbidden('Only the owner can change the URL')
    const slug = String(body.slug).toLowerCase()
    if (!SLUG_RE.test(slug)) throw bad('URL names use lowercase letters, numbers and dashes')
    patch.slug = slug
  }
  if (body.extensions !== undefined) {
    if (!body.extensions || typeof body.extensions !== 'object') throw bad('Invalid extensions')
    const clean = {}
    for (const [id, v] of Object.entries(body.extensions)) {
      const ext = extensionById(id)
      if (!ext || ext.scope !== 'api' || !v || typeof v !== 'object') continue
      clean[id] = { enabled: !!v.enabled, config: v.config && typeof v.config === 'object' ? v.config : {} }
    }
    if (JSON.stringify(clean).length > 50000) throw bad('Extension settings are too large')
    patch.extensions = clean
  }
  const row = must(await db().from('vix_apis').update(patch).eq('id', api.id).select('*').single())
  return { api: { ...row, role } }
})

route('DELETE', '/apis/:id', async (req, p) => {
  const who = await requireUser(req)
  checkKeyScope(who, p.id)
  const { api } = await loadApi(who, p.id, 'owner')
  must(await db().from('vix_apis').delete().eq('id', api.id))
  return { ok: true }
})

route('POST', '/apis/:id/duplicate', async (req, p) => {
  const who = await requireUser(req)
  const { api } = await loadApi(who, p.id)
  const body = await jsonBody(req)
  let slug = slugify(body.slug || `${api.slug}-copy`)
  for (let i = 2; i < 50; i++) {
    const taken = must(await db().from('vix_apis').select('id').eq('owner_id', who.user.id).eq('slug', slug).maybeSingle())
    if (!taken) break
    slug = `${slugify(api.slug).slice(0, 40)}-copy-${i}`
  }
  const copy = must(await db().from('vix_apis').insert({ owner_id: who.user.id, slug, name: `${api.name} (copy)`, description: api.description, icon: api.icon, visibility: 'private', require_key: api.require_key, extensions: api.extensions }).select('*').single())
  const files = must(await db().from('vix_files').select('path, is_folder, content').eq('api_id', api.id))
  const eps = must(await db().from('vix_endpoints').select('method, route, file_path, description, enabled, public').eq('api_id', api.id))
  if (files.length) must(await db().from('vix_files').insert(files.map((f) => ({ ...f, api_id: copy.id, updated_by: who.user.id }))))
  if (eps.length) must(await db().from('vix_endpoints').insert(eps.map((e) => ({ ...e, api_id: copy.id }))))
  return { status: 201, body: { api: { ...copy, role: 'owner' } } }
})

// ----------------------------------------------------------------- files ----

route('PUT', '/apis/:id/files', async (req, p) => {
  const who = await requireUser(req)
  checkKeyScope(who, p.id)
  const { api } = await loadApi(who, p.id, 'editor')
  const body = await jsonBody(req)
  const path = cleanPath(body.path)
  const isFolder = !!body.is_folder
  const content = isFolder ? '' : String(body.content ?? '')
  if (content.length > 1_000_000) throw bad('Files can be at most 1 MB')
  const existing = must(await db().from('vix_files').select('id, is_folder, updated_at').eq('api_id', api.id).eq('path', path).maybeSingle())
  if (!existing) {
    const { count } = await db().from('vix_files').select('id', { count: 'exact', head: true }).eq('api_id', api.id)
    if ((count || 0) >= MAX_FILES) throw bad(`Projects can have at most ${MAX_FILES} files and folders`)
  }
  if (existing && existing.is_folder !== isFolder) throw new HttpError(409, `A ${existing.is_folder ? 'folder' : 'file'} with that name already exists`)
  // Optimistic concurrency: refuse to overwrite a newer version from a teammate.
  if (existing && body.base_updated_at && !body.force && new Date(existing.updated_at).getTime() > new Date(body.base_updated_at).getTime() + 1) {
    const latest = must(await db().from('vix_files').select('content, updated_at, updated_by').eq('id', existing.id).single())
    throw new HttpError(409, 'Someone else saved this file after you opened it', { conflict: true, latest })
  }
  await ensureParents(api.id, path, who.user.id)
  const row = must(await db().from('vix_files').upsert({ api_id: api.id, path, is_folder: isFolder, content, updated_at: new Date().toISOString(), updated_by: who.user.id }, { onConflict: 'api_id,path' }).select('id, path, is_folder, content, updated_at, updated_by').single())
  await touch(api.id)
  return { file: row }
})

route('POST', '/apis/:id/files/bulk', async (req, p) => {
  const who = await requireUser(req)
  checkKeyScope(who, p.id)
  const { api } = await loadApi(who, p.id, 'editor')
  const body = await jsonBody(req)
  const list = Array.isArray(body.files) ? body.files : []
  if (list.length > MAX_FILES) throw bad(`At most ${MAX_FILES} files at once`)
  const rows = new Map()
  for (const f of list) {
    const path = cleanPath(f.path)
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/')
      if (!rows.has(dir)) rows.set(dir, { api_id: api.id, path: dir, is_folder: true, content: '', updated_by: who.user.id })
    }
    const content = f.is_folder ? '' : String(f.content ?? '')
    if (content.length > 1_000_000) throw bad(`${path} is larger than 1 MB`)
    rows.set(path, { api_id: api.id, path, is_folder: !!f.is_folder, content, updated_by: who.user.id, updated_at: new Date().toISOString() })
  }
  if (body.replace) must(await db().from('vix_files').delete().eq('api_id', api.id))
  if (rows.size) must(await db().from('vix_files').upsert([...rows.values()], { onConflict: 'api_id,path' }))
  await touch(api.id)
  const files = must(await db().from('vix_files').select('id, path, is_folder, content, updated_at, updated_by').eq('api_id', api.id).order('path'))
  return { files }
})

route('POST', '/apis/:id/files/rename', async (req, p) => {
  const who = await requireUser(req)
  checkKeyScope(who, p.id)
  const { api } = await loadApi(who, p.id, 'editor')
  const body = await jsonBody(req)
  const from = cleanPath(body.from)
  const to = cleanPath(body.to)
  if (from === to) return { ok: true }
  if (to.startsWith(from + '/')) throw bad("A folder can't be moved inside itself")
  const all = must(await db().from('vix_files').select('id, path').eq('api_id', api.id))
  const clash = all.find((f) => f.path === to)
  if (clash) throw new HttpError(409, `"${to}" already exists`)
  const moving = all.filter((f) => f.path === from || f.path.startsWith(from + '/'))
  if (!moving.length) throw notFound('File not found')
  await ensureParents(api.id, to, who.user.id)
  for (const f of moving) {
    const next = to + f.path.slice(from.length)
    must(await db().from('vix_files').update({ path: next, updated_at: new Date().toISOString(), updated_by: who.user.id }).eq('id', f.id))
  }
  // Keep endpoints pointing at moved files.
  const eps = must(await db().from('vix_endpoints').select('id, file_path').eq('api_id', api.id))
  for (const e of eps) {
    if (e.file_path === from || e.file_path.startsWith(from + '/')) {
      must(await db().from('vix_endpoints').update({ file_path: to + e.file_path.slice(from.length) }).eq('id', e.id))
    }
  }
  await touch(api.id)
  return { ok: true }
})

route('DELETE', '/apis/:id/files', async (req, p, url) => {
  const who = await requireUser(req)
  checkKeyScope(who, p.id)
  const { api } = await loadApi(who, p.id, 'editor')
  const path = cleanPath(url.searchParams.get('path'))
  must(await db().from('vix_files').delete().eq('api_id', api.id).eq('path', path))
  must(await db().from('vix_files').delete().eq('api_id', api.id).like('path', `${path.replace(/[%_\\]/g, '\\$&')}/%`))
  await touch(api.id)
  return { ok: true }
})

// ------------------------------------------------------------- endpoints ----

function endpointInput(body, partial = false) {
  const out = {}
  if (!partial || body.method !== undefined) {
    const m = String(body.method || 'GET').toUpperCase()
    if (!METHODS.includes(m)) throw bad('Method must be GET, POST, PUT, PATCH, DELETE or ANY')
    out.method = m
  }
  if (!partial || body.route !== undefined) out.route = cleanRoute(body.route)
  if (!partial || body.file_path !== undefined) out.file_path = cleanPath(body.file_path)
  if (body.description !== undefined) out.description = String(body.description).slice(0, 300)
  if (body.enabled !== undefined) out.enabled = !!body.enabled
  if (body.public !== undefined) out.public = !!body.public
  return out
}

route('POST', '/apis/:id/endpoints', async (req, p) => {
  const who = await requireUser(req)
  checkKeyScope(who, p.id)
  const { api } = await loadApi(who, p.id, 'editor')
  const input = endpointInput(await jsonBody(req))
  const { count } = await db().from('vix_endpoints').select('id', { count: 'exact', head: true }).eq('api_id', api.id)
  if ((count || 0) >= 100) throw bad('An API can have at most 100 endpoints')
  const row = must(await db().from('vix_endpoints').insert({ ...input, api_id: api.id }).select('*').single())
  await touch(api.id)
  return { status: 201, body: { endpoint: row } }
})

route('PATCH', '/apis/:id/endpoints/:eid', async (req, p) => {
  const who = await requireUser(req)
  checkKeyScope(who, p.id)
  const { api } = await loadApi(who, p.id, 'editor')
  const input = endpointInput(await jsonBody(req), true)
  const row = must(await db().from('vix_endpoints').update(input).eq('id', p.eid).eq('api_id', api.id).select('*').maybeSingle())
  if (!row) throw notFound('Endpoint not found')
  await touch(api.id)
  return { endpoint: row }
})

route('DELETE', '/apis/:id/endpoints/:eid', async (req, p) => {
  const who = await requireUser(req)
  checkKeyScope(who, p.id)
  const { api } = await loadApi(who, p.id, 'editor')
  must(await db().from('vix_endpoints').delete().eq('id', p.eid).eq('api_id', api.id))
  await touch(api.id)
  return { ok: true }
})

// --------------------------------------------------------------- members ----

route('POST', '/apis/:id/members', async (req, p) => {
  const who = await requireUser(req)
  checkKeyScope(who, p.id)
  const { api } = await loadApi(who, p.id, 'owner')
  const body = await jsonBody(req)
  const username = String(body.username || '').trim().toLowerCase().replace(/^@/, '')
  const target = must(await db().from('vix_users').select(PUBLIC_USER).eq('username', username).maybeSingle())
  if (!target) throw notFound(`No user called "${username}"`)
  if (target.id === api.owner_id) throw bad('That is the owner')
  const fr = must(await db().from('vix_friends').select('status').or(`and(requester_id.eq.${who.user.id},addressee_id.eq.${target.id}),and(requester_id.eq.${target.id},addressee_id.eq.${who.user.id})`).maybeSingle())
  if (!fr || fr.status !== 'accepted') throw bad(`Add ${username} as a friend first - they need to accept before you can share APIs with them`)
  const role = body.role === 'viewer' ? 'viewer' : 'editor'
  must(await db().from('vix_api_members').upsert({ api_id: api.id, user_id: target.id, role }, { onConflict: 'api_id,user_id' }))
  return { status: 201, body: { member: { user_id: target.id, role, user: target } } }
})

route('PATCH', '/apis/:id/members/:uid', async (req, p) => {
  const who = await requireUser(req)
  const { api } = await loadApi(who, p.id, 'owner')
  const body = await jsonBody(req)
  const role = body.role === 'viewer' ? 'viewer' : 'editor'
  must(await db().from('vix_api_members').update({ role }).eq('api_id', api.id).eq('user_id', p.uid))
  return { ok: true }
})

route('DELETE', '/apis/:id/members/:uid', async (req, p) => {
  const who = await requireUser(req)
  // Owners can remove anyone; members can remove themselves (leave).
  const { api } = await loadApi(who, p.id, p.uid === who.user.id ? 'viewer' : 'owner')
  must(await db().from('vix_api_members').delete().eq('api_id', api.id).eq('user_id', p.uid))
  return { ok: true }
})

// -------------------------------------------------------------- versions ----

route('GET', '/apis/:id/versions', async (req, p) => {
  const who = await requireUser(req)
  const { api } = await loadApi(who, p.id)
  const rows = must(await db().from('vix_versions').select('id, label, created_at, created_by').eq('api_id', api.id).order('created_at', { ascending: false }).limit(50))
  const ids = [...new Set(rows.map((r) => r.created_by).filter(Boolean))]
  const users = ids.length ? must(await db().from('vix_users').select('id, username').in('id', ids)) : []
  const names = new Map(users.map((u) => [u.id, u.username]))
  return { versions: rows.map((r) => ({ ...r, created_by_username: names.get(r.created_by) || null })) }
})

route('POST', '/apis/:id/versions', async (req, p) => {
  const who = await requireUser(req)
  const { api } = await loadApi(who, p.id, 'editor')
  const body = await jsonBody(req)
  const files = must(await db().from('vix_files').select('path, is_folder, content').eq('api_id', api.id))
  const endpoints = must(await db().from('vix_endpoints').select('method, route, file_path, description, enabled, public').eq('api_id', api.id))
  const row = must(await db().from('vix_versions').insert({ api_id: api.id, label: String(body.label || `Snapshot ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`).slice(0, 80), snapshot: { files, endpoints }, created_by: who.user.id }).select('id, label, created_at').single())
  // Keep the newest 50.
  const old = must(await db().from('vix_versions').select('id').eq('api_id', api.id).order('created_at', { ascending: false }).range(50, 500))
  if (old.length) must(await db().from('vix_versions').delete().in('id', old.map((o) => o.id)))
  return { status: 201, body: { version: row } }
})

route('GET', '/apis/:id/versions/:vid', async (req, p) => {
  const who = await requireUser(req)
  const { api } = await loadApi(who, p.id)
  const row = must(await db().from('vix_versions').select('*').eq('id', p.vid).eq('api_id', api.id).maybeSingle())
  if (!row) throw notFound('Version not found')
  return { version: row }
})

route('POST', '/apis/:id/versions/:vid/restore', async (req, p) => {
  const who = await requireUser(req)
  const { api } = await loadApi(who, p.id, 'editor')
  const row = must(await db().from('vix_versions').select('snapshot').eq('id', p.vid).eq('api_id', api.id).maybeSingle())
  if (!row) throw notFound('Version not found')
  // Save the current state first so a restore can always be undone.
  const curFiles = must(await db().from('vix_files').select('path, is_folder, content').eq('api_id', api.id))
  const curEps = must(await db().from('vix_endpoints').select('method, route, file_path, description, enabled, public').eq('api_id', api.id))
  must(await db().from('vix_versions').insert({ api_id: api.id, label: 'Before restore', snapshot: { files: curFiles, endpoints: curEps }, created_by: who.user.id }))
  must(await db().from('vix_files').delete().eq('api_id', api.id))
  must(await db().from('vix_endpoints').delete().eq('api_id', api.id))
  const { files = [], endpoints = [] } = row.snapshot || {}
  if (files.length) must(await db().from('vix_files').insert(files.map((f) => ({ ...f, api_id: api.id, updated_by: who.user.id }))))
  if (endpoints.length) must(await db().from('vix_endpoints').insert(endpoints.map((e) => ({ ...e, api_id: api.id }))))
  await touch(api.id)
  return { ok: true }
})

// ------------------------------------------------------------ logs & data ----

route('GET', '/apis/:id/logs', async (req, p, url) => {
  const who = await requireUser(req)
  checkKeyScope(who, p.id)
  const { api } = await loadApi(who, p.id)
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '100', 10)))
  const rows = must(await db().from('vix_logs').select('*').eq('api_id', api.id).order('created_at', { ascending: false }).limit(limit))
  const since = new Date(Date.now() - 24 * 3600_000).toISOString()
  const day = must(await db().from('vix_logs').select('status, duration_ms, created_at').eq('api_id', api.id).gte('created_at', since).limit(5000))
  const hours = Array.from({ length: 24 }, () => ({ ok: 0, err: 0 }))
  let totalMs = 0
  for (const r of day) {
    const h = 23 - Math.min(23, Math.floor((Date.now() - new Date(r.created_at).getTime()) / 3600_000))
    if (r.status >= 400) hours[h].err++
    else hours[h].ok++
    totalMs += r.duration_ms
  }
  return {
    logs: rows,
    stats: { requests24h: day.length, errors24h: day.filter((r) => r.status >= 400).length, avgMs: day.length ? Math.round(totalMs / day.length) : 0, hours },
  }
})

route('DELETE', '/apis/:id/logs', async (req, p) => {
  const who = await requireUser(req)
  const { api } = await loadApi(who, p.id, 'editor')
  must(await db().from('vix_logs').delete().eq('api_id', api.id))
  return { ok: true }
})

route('GET', '/apis/:id/kv', async (req, p) => {
  const who = await requireUser(req)
  checkKeyScope(who, p.id)
  const { api } = await loadApi(who, p.id)
  const rows = must(await db().from('vix_kv').select('key, value, updated_at').eq('api_id', api.id).order('key').limit(1000))
  return { items: rows }
})

route('PUT', '/apis/:id/kv', async (req, p) => {
  const who = await requireUser(req)
  checkKeyScope(who, p.id)
  const { api } = await loadApi(who, p.id, 'editor')
  const body = await jsonBody(req)
  const key = String(body.key || '').slice(0, 256)
  if (!key) throw bad('Key is required')
  if (JSON.stringify(body.value ?? null).length > 200_000) throw bad('Values can be at most 200 KB')
  must(await db().from('vix_kv').upsert({ api_id: api.id, key, value: body.value ?? null, updated_at: new Date().toISOString() }, { onConflict: 'api_id,key' }))
  return { ok: true }
})

route('DELETE', '/apis/:id/kv', async (req, p, url) => {
  const who = await requireUser(req)
  checkKeyScope(who, p.id)
  const { api } = await loadApi(who, p.id, 'editor')
  const key = url.searchParams.get('key')
  let q = db().from('vix_kv').delete().eq('api_id', api.id)
  if (key !== null) q = q.eq('key', key)
  must(await q)
  return { ok: true }
})

// ------------------------------------------------------------------ keys ----

route('GET', '/keys', async (req) => {
  const { user } = await requireUser(req)
  const rows = must(await db().from('vix_keys').select('id, name, prefix, api_id, scopes, requests, created_at, last_used_at, expires_at, revoked_at').eq('user_id', user.id).order('created_at', { ascending: false }))
  return { keys: rows }
})

route('POST', '/keys', async (req) => {
  const who = await requireUser(req)
  if (who.via === 'key') throw forbidden('Create new keys from the website while signed in')
  const body = await jsonBody(req)
  await rateLimit(`keys:${who.user.id}`, 30, 3600)
  const name = String(body.name || '').trim().slice(0, 60) || 'My key'
  let apiId = null
  if (body.api_id) {
    const { api } = await loadApi(who, body.api_id)
    apiId = api.id
  }
  const scopes = Array.isArray(body.scopes) ? body.scopes.filter((s) => s === 'invoke' || s === 'manage') : ['invoke']
  if (!scopes.length) throw bad('Pick at least one permission')
  let expires = null
  if (body.expires_in_days) {
    const d = Math.min(3650, Math.max(1, parseInt(body.expires_in_days, 10)))
    expires = new Date(Date.now() + d * 86400_000).toISOString()
  }
  const count = must(await db().from('vix_keys').select('id').eq('user_id', who.user.id).is('revoked_at', null))
  if (count.length >= 50) throw bad('You can have at most 50 active keys - revoke an old one first')
  const { key, prefix, hash } = newApiKey()
  const row = must(await db().from('vix_keys').insert({ user_id: who.user.id, api_id: apiId, name, prefix, key_hash: hash, scopes, expires_at: expires }).select('id, name, prefix, api_id, scopes, requests, created_at, last_used_at, expires_at, revoked_at').single())
  return { status: 201, body: { key: row, secret: key } }
})

route('PATCH', '/keys/:id', async (req, p) => {
  const { user } = await requireUser(req)
  const body = await jsonBody(req)
  const patch = {}
  if (body.name !== undefined) patch.name = String(body.name).trim().slice(0, 60) || 'My key'
  const row = must(await db().from('vix_keys').update(patch).eq('id', p.id).eq('user_id', user.id).select('id').maybeSingle())
  if (!row) throw notFound('Key not found')
  return { ok: true }
})

route('POST', '/keys/:id/roll', async (req, p) => {
  const who = await requireUser(req)
  if (who.via === 'key') throw forbidden('Roll keys from the website while signed in')
  const old = must(await db().from('vix_keys').select('*').eq('id', p.id).eq('user_id', who.user.id).maybeSingle())
  if (!old) throw notFound('Key not found')
  const { key, prefix, hash } = newApiKey()
  must(await db().from('vix_keys').update({ key_hash: hash, prefix, revoked_at: null, requests: 0, last_used_at: null }).eq('id', old.id))
  return { secret: key, prefix }
})

route('DELETE', '/keys/:id', async (req, p) => {
  const { user } = await requireUser(req)
  must(await db().from('vix_keys').update({ revoked_at: new Date().toISOString() }).eq('id', p.id).eq('user_id', user.id))
  return { ok: true }
})

// ----------------------------------------------------------------- sandbox --

route('POST', '/exec', async (req) => {
  const who = await requireUser(req, 'invoke')
  const body = await jsonBody(req)
  await rateLimit(`exec:${who.user.id}`, 60, 60, 'You are running code very fast - wait a few seconds.')
  let files = Array.isArray(body.files) ? body.files : []
  let env = {}
  let host
  if (body.api_id) {
    checkKeyScope(who, body.api_id)
    const { api, role } = await loadApi(who, body.api_id)
    // Unsaved editor contents win over what is stored.
    const stored = must(await db().from('vix_files').select('path, is_folder, content').eq('api_id', api.id))
    const overrides = new Map(files.map((f) => [String(f.path), f]))
    files = stored.map((f) => (overrides.has(f.path) ? { ...f, content: String(overrides.get(f.path).content ?? '') } : f))
    for (const f of overrides.values()) if (!files.some((x) => x.path === f.path)) files.push({ path: String(f.path), content: String(f.content ?? ''), is_folder: false })
    // Viewers can run code but can't read secrets or change stored data.
    env = role === 'viewer' ? {} : apiEnv(api)
    host = makeHost(api, { readOnly: role === 'viewer' })
  }
  files = files.slice(0, MAX_FILES).map((f) => ({ path: String(f.path), content: String(f.content ?? '').slice(0, 1_000_000), is_folder: !!f.is_folder }))
  const entry = String(body.entry || files[0]?.path || '')
  if (!entry) throw bad('Nothing to run')
  const lang = languageForPath(entry)
  const request = body.request && typeof body.request === 'object' ? body.request : null
  const result = await runFile({
    entry,
    files,
    stdin: String(body.stdin || '').slice(0, 100_000),
    args: Array.isArray(body.args) ? body.args.map(String).slice(0, 20) : [],
    request,
    env,
    host,
    mode: request ? 'handler' : 'auto',
    timeoutMs: 8000,
    language: body.language,
  })
  return { language: lang.id, ...result }
})

// ----------------------------------------------------------------- server ---

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://local')
  let path = url.searchParams.get('__path')
  if (path === null) path = url.pathname.replace(/^\/api\/?(router\/?)?/, '')
  url.searchParams.delete('__path')
  path = '/' + String(path).replace(/^\/+/, '')
  res.setHeader('cache-control', 'no-store')
  if (req.method === 'OPTIONS') {
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-headers', 'authorization, content-type, x-api-key')
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    return send(res, 204, null)
  }
  // The management API may be called from scripts and AI agents with an API key.
  res.setHeader('access-control-allow-origin', '*')
  try {
    let methodMatched = false
    for (const r of routes) {
      const params = matchRoute(r.pattern, path)
      if (!params) continue
      methodMatched = true
      if (r.method !== req.method) continue
      const out = await r.fn(req, params, url)
      if (out && typeof out === 'object' && 'status' in out && 'body' in out && Object.keys(out).length === 2) return send(res, out.status, out.body)
      return send(res, 200, out)
    }
    if (methodMatched) throw new HttpError(405, `${req.method} is not supported here`)
    throw notFound(`Unknown API route: ${path}`)
  } catch (err) {
    sendError(res, err)
  }
}

