// Vix AI: create your own AI with a personality, knowledge, rules and memory.
// Browser-engine AIs run the model on the user's GPU (WebLLM); the server only
// checks rules, searches knowledge and builds the prompt. Cloud-engine AIs call
// an OpenAI-compatible provider from here, which also powers the
// OpenAI-compatible endpoint at /api/ai/v1/chat/completions.
import { db, must } from './db.js'
import { bad, forbidden, notFound, HttpError, jsonBody, clientIp } from './http.js'
import { requireUser, rateLimit } from './auth.js'
import { checkUrl } from './net.js'
import {
  AI_TEMPLATES, BROWSER_MODELS, DEFAULT_BROWSER_MODEL, buildSystemPrompt, checkInput, checkOutput,
  defaultRules, defaultSettings, fitHistory, searchKnowledge, selfCheckPrompt, selfCheckVerdict, splitThinking,
} from '../../shared/ai.js'

export const STREAMED = Symbol('streamed')
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,47}$/
const UUID_RE = /^[0-9a-f-]{36}$/i

const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'ai'

async function areFriends(a, b) {
  const fr = must(await db().from('vix_friends').select('status').or(`and(requester_id.eq.${a},addressee_id.eq.${b}),and(requester_id.eq.${b},addressee_id.eq.${a})`).maybeSingle())
  return fr?.status === 'accepted'
}

/** Loads an AI and works out whether the caller may use it. */
async function loadAi(who, id, need = 'user') {
  if (!UUID_RE.test(String(id))) throw notFound('AI not found')
  const ai = must(await db().from('vix_ais').select('*').eq('id', id).maybeSingle())
  if (!ai) throw notFound('AI not found')
  const owner = must(await db().from('vix_users').select('id, username').eq('id', ai.owner_id).single())
  ai.owner_username = owner.username
  const isOwner = ai.owner_id === who.user.id
  if (!isOwner) {
    if (need === 'owner') throw forbidden('Only the creator of this AI can do that')
    const allowed = ai.access === 'public' || (ai.access === 'friends' && (await areFriends(ai.owner_id, who.user.id)))
    if (!allowed) throw notFound('AI not found')
    if ((ai.blocked_users || []).includes(who.user.username)) throw forbidden('The creator of this AI has blocked you from using it')
  }
  return { ai, isOwner }
}

/** What any chatter may see. The owner sees everything except the cloud key. */
function view(ai, isOwner) {
  const rules = { ...defaultRules(), ...(ai.rules || {}) }
  const settings = { ...defaultSettings(), ...(ai.settings || {}) }
  const base = {
    id: ai.id, slug: ai.slug, name: ai.name, avatar: ai.avatar, tagline: ai.tagline, greeting: ai.greeting,
    engine: ai.engine, model: ai.model || DEFAULT_BROWSER_MODEL, access: ai.access, owner_username: ai.owner_username,
    updated_at: ai.updated_at, is_owner: isOwner,
    settings: { temperature: settings.temperature, maxTokens: settings.maxTokens, think: settings.think, showThinking: settings.showThinking },
    rules: { preset: rules.preset, blockedWords: rules.blockedWords, refusal: rules.refusal, maxInputChars: rules.maxInputChars, selfCheck: rules.selfCheck },
  }
  if (!isOwner) return base
  const { cloud_key, ...rest } = ai
  return { ...rest, ...base, rules, settings, cloud: ai.cloud || {}, cloud_key_set: !!cloud_key, examples: ai.examples || [], blocked_users: ai.blocked_users || [] }
}

async function logEvent(aiId, userId, kind, detail = '', message = '') {
  await db().from('vix_ai_events').insert({ ai_id: aiId, user_id: userId, kind, detail: String(detail).slice(0, 500), message: String(message).slice(0, 2000) })
}

async function dailyLimit(ai, user) {
  const lim = Number(ai.rules?.dailyLimit) || 0
  if (!lim || ai.owner_id === user.id) return
  const { data } = await db().rpc('vix_hit', { p_bucket: `aiday:${ai.id}:${user.id}`, p_limit: lim, p_window_seconds: 86400 })
  if (data === false) throw new HttpError(429, `You've used all ${lim} messages for today with ${ai.name}. Come back tomorrow!`)
}

/** Runs the pre-generation pipeline. Returns { blocked, refusal } or { system }. */
async function prepare(ai, user, message, history) {
  const rules = { ...defaultRules(), ...(ai.rules || {}) }
  await dailyLimit(ai, user)
  const verdict = checkInput(message, rules)
  if (!verdict.ok) {
    await logEvent(ai.id, user.id, 'blocked_input', verdict.reason, message)
    return { blocked: true, reason: verdict.reason, refusal: rules.refusal }
  }
  const docs = must(await db().from('vix_ai_docs').select('title, content').eq('ai_id', ai.id))
  const recent = history.filter((m) => m.role === 'user').slice(-2).map((m) => m.content).join(' ')
  const knowledge = searchKnowledge(docs, `${message} ${recent}`, 3)
  const system = buildSystemPrompt(ai, { knowledge, userName: user.username })
  // For browser-engine AIs the double-check runs on the user's GPU, so send its prompt along.
  const check = rules.selfCheck ? selfCheckPrompt(ai, message) : null
  return { blocked: false, system, knowledge: knowledge.map((k) => k.title), check }
}

function cleanHistory(raw) {
  if (!Array.isArray(raw)) return []
  return raw.slice(-40).filter((m) => m && (m.role === 'user' || m.role === 'assistant')).map((m) => ({ role: m.role, content: splitThinking(String(m.content || '')).answer.slice(0, 8000) }))
}

// ---------------------------------------------------------------- cloud --

async function providerRequest(ai, messages, { stream, maxTokens, temperature }) {
  const cloud = ai.cloud || {}
  if (!cloud.base_url || !cloud.model) throw bad('This AI uses a cloud brain, but no provider URL or model is set in its Brain tab')
  const base = String(cloud.base_url).replace(/\/+$/, '')
  // Self-hosters can allow a provider on their own network (e.g. Ollama on localhost).
  if (process.env.AI_ALLOW_PRIVATE_PROVIDER !== '1') await checkUrl(base)
  const headers = { 'content-type': 'application/json' }
  if (ai.cloud_key) headers.authorization = `Bearer ${ai.cloud_key}`
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: cloud.model, messages, stream, max_tokens: maxTokens, temperature }),
    signal: AbortSignal.timeout(55000),
    redirect: 'error',
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    let msg = text.slice(0, 300)
    try { msg = JSON.parse(text).error?.message || msg } catch { /* not json */ }
    throw new HttpError(502, `The AI provider answered ${r.status}: ${msg || r.statusText}`)
  }
  return r
}

async function providerComplete(ai, messages, opts) {
  const r = await providerRequest(ai, messages, { ...opts, stream: false })
  const j = await r.json()
  return String(j.choices?.[0]?.message?.content ?? '')
}

/** Streams provider deltas to onDelta. Returns the full text. */
async function providerStream(ai, messages, opts, onDelta) {
  const r = await providerRequest(ai, messages, { ...opts, stream: true })
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') return full
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content
        if (delta) {
          full += delta
          onDelta(delta, full)
        }
      } catch { /* keep-alive or partial */ }
    }
  }
  return full
}

/**
 * Full cloud pipeline used by the website chat and the OpenAI-compatible API.
 * Calls emit({delta}) while streaming and returns the final result.
 */
async function cloudChat(ai, user, history, emit) {
  const settings = { ...defaultSettings(), ...(ai.settings || {}) }
  const rules = { ...defaultRules(), ...(ai.rules || {}) }
  const last = history[history.length - 1]
  if (!last || last.role !== 'user') throw bad('The last message must be from the user')
  const prep = await prepare(ai, user, last.content, history.slice(0, -1))
  if (prep.blocked) return { text: prep.refusal, blocked: true, reason: prep.reason }
  const opts = { maxTokens: Math.min(4000, Number(settings.maxTokens) || 700), temperature: Number(settings.temperature) || 0.7 }
  if (rules.selfCheck) {
    const verdict = selfCheckVerdict(await providerComplete(ai, selfCheckPrompt(ai, last.content), { maxTokens: 300, temperature: 0 }))
    if (verdict === 'BLOCK') {
      await logEvent(ai.id, user.id, 'blocked_selfcheck', 'AI double-check flagged the request', last.content)
      return { text: rules.refusal, blocked: true, reason: 'AI double-check' }
    }
  }
  const messages = [{ role: 'system', content: prep.system }, ...fitHistory(prep.system, settings.memory === false ? [last] : history, { contextTokens: 16000, reserveTokens: opts.maxTokens + 200 })]
  let sent = 0
  const full = await providerStream(ai, messages, opts, (_d, all) => {
    // Hold back the last few characters so a blocked word is never half-sent.
    const safe = checkOutput(all, rules)
    if (safe.blocked) return
    const ready = safe.text.slice(0, Math.max(0, safe.text.length - 24))
    if (ready.length > sent) {
      emit({ delta: ready.slice(sent) })
      sent = ready.length
    }
  })
  const final = checkOutput(full, rules)
  if (final.blocked) {
    await logEvent(ai.id, user.id, 'blocked_output', final.reason, last.content)
    return { text: rules.refusal, blocked: true, reason: final.reason, replace: true }
  }
  if (final.text.length > sent) emit({ delta: final.text.slice(sent) })
  return { text: final.text, blocked: false, knowledge: prep.knowledge }
}

function sse(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no', connection: 'keep-alive' })
  return (obj) => res.write(`data: ${typeof obj === 'string' ? obj : JSON.stringify(obj)}\n\n`)
}

// --------------------------------------------------------------- routes --

export function registerAiRoutes(route) {
  route('GET', '/ai-models', async () => ({ browser: BROWSER_MODELS, templates: AI_TEMPLATES.map(({ id, name, avatar, tagline }) => ({ id, name, avatar, tagline })) }))

  route('GET', '/ais', async (req) => {
    const { user } = await requireUser(req)
    const mine = must(await db().from('vix_ais').select('*').eq('owner_id', user.id).order('updated_at', { ascending: false }))
    const fr = must(await db().from('vix_friends').select('requester_id, addressee_id').eq('status', 'accepted').or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`))
    const friendIds = fr.map((f) => (f.requester_id === user.id ? f.addressee_id : f.requester_id))
    const shared = friendIds.length ? must(await db().from('vix_ais').select('*').in('owner_id', friendIds).in('access', ['friends', 'public']).order('updated_at', { ascending: false }).limit(100)) : []
    const owners = friendIds.length ? must(await db().from('vix_users').select('id, username').in('id', friendIds)) : []
    const name = new Map(owners.map((o) => [o.id, o.username]))
    return {
      mine: mine.map((a) => view({ ...a, owner_username: user.username }, true)),
      shared: shared.filter((a) => !(a.blocked_users || []).includes(user.username)).map((a) => view({ ...a, owner_username: name.get(a.owner_id) }, false)),
    }
  })

  route('GET', '/ais/by/:username/:slug', async (req, p) => {
    const who = await requireUser(req)
    const owner = must(await db().from('vix_users').select('id').eq('username', String(p.username).toLowerCase()).maybeSingle())
    const ai = owner ? must(await db().from('vix_ais').select('id').eq('owner_id', owner.id).eq('slug', String(p.slug).toLowerCase()).maybeSingle()) : null
    if (!ai) throw notFound('AI not found')
    const { ai: full, isOwner } = await loadAi(who, ai.id)
    return { ai: view(full, isOwner) }
  })

  route('POST', '/ais', async (req) => {
    const { user } = await requireUser(req)
    const body = await jsonBody(req)
    await rateLimit(`ai-create:${user.id}`, 20, 3600)
    const tpl = AI_TEMPLATES.find((t) => t.id === body.template) || AI_TEMPLATES[0]
    const name = String(body.name || tpl.name).trim().slice(0, 60)
    let slug = slugify(body.slug || name)
    for (let i = 2; i < 30; i++) {
      const taken = must(await db().from('vix_ais').select('id').eq('owner_id', user.id).eq('slug', slug).maybeSingle())
      if (!taken) break
      slug = `${slugify(name).slice(0, 40)}-${i}`
    }
    const row = must(await db().from('vix_ais').insert({
      owner_id: user.id, slug, name, avatar: tpl.avatar, tagline: tpl.tagline, persona: tpl.persona, greeting: tpl.greeting,
      engine: 'browser', model: tpl.model || DEFAULT_BROWSER_MODEL,
      rules: { ...defaultRules(), ...(tpl.rules || {}) }, settings: defaultSettings(),
    }).select('*').single())
    return { status: 201, body: { ai: view({ ...row, owner_username: user.username }, true) } }
  })

  route('GET', '/ais/:id', async (req, p) => {
    const who = await requireUser(req)
    const { ai, isOwner } = await loadAi(who, p.id)
    const out = { ai: view(ai, isOwner) }
    if (isOwner) out.docs = must(await db().from('vix_ai_docs').select('id, title, created_at, content').eq('ai_id', ai.id).order('created_at')).map((d) => ({ id: d.id, title: d.title, created_at: d.created_at, chars: d.content.length }))
    return out
  })

  route('PATCH', '/ais/:id', async (req, p) => {
    const who = await requireUser(req)
    const { ai } = await loadAi(who, p.id, 'owner')
    const b = await jsonBody(req)
    const patch = { updated_at: new Date().toISOString() }
    const str = (k, max) => { if (b[k] !== undefined) patch[k] = String(b[k] ?? '').slice(0, max) }
    str('name', 60); str('avatar', 16); str('tagline', 160); str('persona', 20000); str('greeting', 1000)
    if (patch.name !== undefined && !patch.name.trim()) patch.name = ai.name
    if (b.slug !== undefined) {
      if (!SLUG_RE.test(String(b.slug))) throw bad('URL names use lowercase letters, numbers and dashes')
      patch.slug = b.slug
    }
    if (b.engine !== undefined) patch.engine = b.engine === 'cloud' ? 'cloud' : 'browser'
    if (b.model !== undefined) patch.model = String(b.model).slice(0, 120)
    if (b.cloud !== undefined) {
      const c = b.cloud || {}
      const base = String(c.base_url || '').trim()
      if (base && !/^https:\/\//i.test(base) && !(process.env.AI_ALLOW_PRIVATE_PROVIDER === '1' && /^http:\/\//i.test(base))) throw bad('The provider URL must start with https://')
      patch.cloud = { provider: String(c.provider || 'custom').slice(0, 30), base_url: base.slice(0, 300), model: String(c.model || '').slice(0, 200) }
    }
    if (b.cloud_key !== undefined && b.cloud_key !== '') patch.cloud_key = b.cloud_key === null ? '' : String(b.cloud_key).trim().slice(0, 500)
    if (b.rules !== undefined) {
      const r = { ...defaultRules(), ...(b.rules || {}) }
      if (!['kids', 'standard', 'relaxed'].includes(r.preset)) r.preset = 'standard'
      for (const k of ['blockedWords', 'blockedTopics', 'onlyTopics', 'customRules']) r[k] = String(r[k] || '').slice(0, 5000)
      r.refusal = String(r.refusal || defaultRules().refusal).slice(0, 300)
      r.maxInputChars = Math.min(20000, Math.max(50, Number(r.maxInputChars) || 2000))
      r.dailyLimit = Math.min(10000, Math.max(0, Number(r.dailyLimit) || 0))
      r.selfCheck = !!r.selfCheck
      r.noPersonalInfo = !!r.noPersonalInfo
      patch.rules = r
    }
    if (b.settings !== undefined) {
      const s = { ...defaultSettings(), ...(b.settings || {}) }
      s.temperature = Math.min(1.5, Math.max(0, Number(s.temperature)))
      s.maxTokens = Math.min(4000, Math.max(50, Number(s.maxTokens) || 700))
      for (const k of ['think', 'memory', 'autoLearn', 'showThinking']) s[k] = !!s[k]
      patch.settings = s
    }
    if (b.examples !== undefined) {
      if (!Array.isArray(b.examples)) throw bad('examples must be a list')
      patch.examples = b.examples.slice(0, 200).map((e) => ({ q: String(e?.q || '').slice(0, 2000), a: String(e?.a || '').slice(0, 4000) })).filter((e) => e.q && e.a)
    }
    if (b.access !== undefined) patch.access = ['private', 'friends', 'public'].includes(b.access) ? b.access : 'private'
    if (b.blocked_users !== undefined) {
      patch.blocked_users = (Array.isArray(b.blocked_users) ? b.blocked_users : String(b.blocked_users).split(/[\s,]+/)).map((u) => String(u).trim().toLowerCase().replace(/^@/, '')).filter((u) => /^[a-z0-9_.-]{3,24}$/.test(u)).slice(0, 500)
    }
    const row = must(await db().from('vix_ais').update(patch).eq('id', ai.id).select('*').single())
    return { ai: view({ ...row, owner_username: ai.owner_username }, true) }
  })

  route('DELETE', '/ais/:id', async (req, p) => {
    const who = await requireUser(req)
    const { ai } = await loadAi(who, p.id, 'owner')
    must(await db().from('vix_ais').delete().eq('id', ai.id))
    return { ok: true }
  })

  // Knowledge documents.
  route('POST', '/ais/:id/docs', async (req, p) => {
    const who = await requireUser(req)
    const { ai } = await loadAi(who, p.id, 'owner')
    const b = await jsonBody(req)
    const title = String(b.title || 'Untitled').trim().slice(0, 120)
    const content = String(b.content || '')
    if (!content.trim()) throw bad('The document is empty')
    if (content.length > 300000) throw bad('Documents can be at most 300,000 characters - split it into parts')
    const { count } = await db().from('vix_ai_docs').select('id', { count: 'exact', head: true }).eq('ai_id', ai.id)
    if ((count || 0) >= 100) throw bad('An AI can have at most 100 knowledge documents')
    const row = must(await db().from('vix_ai_docs').insert({ ai_id: ai.id, title, content }).select('id, title, created_at').single())
    return { status: 201, body: { doc: { ...row, chars: content.length } } }
  })

  route('GET', '/ais/:id/docs/:docId', async (req, p) => {
    const who = await requireUser(req)
    const { ai } = await loadAi(who, p.id, 'owner')
    const row = must(await db().from('vix_ai_docs').select('*').eq('id', p.docId).eq('ai_id', ai.id).maybeSingle())
    if (!row) throw notFound('Document not found')
    return { doc: row }
  })

  route('DELETE', '/ais/:id/docs/:docId', async (req, p) => {
    const who = await requireUser(req)
    const { ai } = await loadAi(who, p.id, 'owner')
    must(await db().from('vix_ai_docs').delete().eq('id', p.docId).eq('ai_id', ai.id))
    return { ok: true }
  })

  route('POST', '/ais/:id/search', async (req, p) => {
    const who = await requireUser(req)
    const { ai } = await loadAi(who, p.id, 'owner')
    const b = await jsonBody(req)
    const docs = must(await db().from('vix_ai_docs').select('title, content').eq('ai_id', ai.id))
    return { results: searchKnowledge(docs, String(b.query || ''), 5) }
  })

  // Browser engine: rules + knowledge + prompt, then the model runs on the user's GPU.
  route('POST', '/ais/:id/prepare', async (req, p) => {
    const who = await requireUser(req, 'invoke')
    const { ai } = await loadAi(who, p.id)
    const b = await jsonBody(req)
    await rateLimit(`ai-msg:${who.user.id}`, 60, 60, 'You are sending messages very fast - wait a moment.')
    const result = await prepare(ai, who.user, String(b.message || ''), cleanHistory(b.history))
    return result
  })

  // Cloud engine: the server runs the whole pipeline and streams the answer.
  route('POST', '/ais/:id/complete', async (req, p, _url, res) => {
    const who = await requireUser(req, 'invoke')
    const { ai } = await loadAi(who, p.id)
    if (ai.engine !== 'cloud') throw bad('This AI runs in the browser. Open it on the website, or switch its brain to Cloud.')
    const b = await jsonBody(req)
    await rateLimit(`ai-msg:${who.user.id}`, 60, 60, 'You are sending messages very fast - wait a moment.')
    const history = cleanHistory(b.messages)
    const send = sse(res)
    try {
      const result = await cloudChat(ai, who.user, history, (e) => send(e))
      send({ done: true, ...result })
    } catch (e) {
      send({ error: e instanceof HttpError ? e.message : 'The AI provider failed to answer. Try again.' })
    }
    res.end()
    return STREAMED
  })

  route('POST', '/ais/:id/events', async (req, p) => {
    const who = await requireUser(req, 'invoke')
    const { ai, isOwner } = await loadAi(who, p.id)
    const b = await jsonBody(req)
    await rateLimit(`ai-ev:${who.user.id}`, 120, 3600)
    const kind = ['blocked_output', 'blocked_selfcheck', 'feedback_up', 'feedback_down'].includes(b.kind) ? b.kind : null
    if (!kind) throw bad('Unknown event')
    await logEvent(ai.id, who.user.id, kind, String(b.detail || ''), String(b.message || ''))
    // The creator's thumbs-up can teach the AI by example.
    if (kind === 'feedback_up' && isOwner && ai.settings?.autoLearn && b.q && b.a) {
      const examples = [...(ai.examples || []), { q: String(b.q).slice(0, 2000), a: splitThinking(String(b.a)).answer.slice(0, 4000) }].slice(-200)
      must(await db().from('vix_ais').update({ examples }).eq('id', ai.id))
      return { ok: true, learned: true }
    }
    return { ok: true }
  })

  route('GET', '/ais/:id/events', async (req, p) => {
    const who = await requireUser(req)
    const { ai } = await loadAi(who, p.id, 'owner')
    const rows = must(await db().from('vix_ai_events').select('*').eq('ai_id', ai.id).order('created_at', { ascending: false }).limit(200))
    const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))]
    const users = ids.length ? must(await db().from('vix_users').select('id, username').in('id', ids)) : []
    const names = new Map(users.map((u) => [u.id, u.username]))
    const since = new Date(Date.now() - 7 * 86400_000).toISOString()
    const { count: chats7d } = await db().from('vix_ai_chats').select('id', { count: 'exact', head: true }).eq('ai_id', ai.id).gte('updated_at', since)
    return { events: rows.map((r) => ({ ...r, username: names.get(r.user_id) || null })), stats: { chats7d: chats7d || 0 } }
  })

  // Saved conversations (each user only sees their own).
  route('GET', '/ais/:id/chats', async (req, p) => {
    const who = await requireUser(req)
    const { ai } = await loadAi(who, p.id)
    const rows = must(await db().from('vix_ai_chats').select('id, title, updated_at').eq('ai_id', ai.id).eq('user_id', who.user.id).order('updated_at', { ascending: false }).limit(100))
    return { chats: rows }
  })

  route('GET', '/ais/:id/chats/:cid', async (req, p) => {
    const who = await requireUser(req)
    const { ai } = await loadAi(who, p.id)
    const row = must(await db().from('vix_ai_chats').select('*').eq('id', p.cid).eq('ai_id', ai.id).eq('user_id', who.user.id).maybeSingle())
    if (!row) throw notFound('Chat not found')
    return { chat: row }
  })

  route('PUT', '/ais/:id/chats/:cid', async (req, p) => {
    const who = await requireUser(req)
    const { ai } = await loadAi(who, p.id)
    if (!UUID_RE.test(p.cid)) throw bad('Bad chat id')
    const b = await jsonBody(req)
    const messages = (Array.isArray(b.messages) ? b.messages : []).slice(-200).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 20000),
      at: m.at || new Date().toISOString(),
      ...(m.blocked ? { blocked: true } : {}),
      ...(m.feedback ? { feedback: m.feedback === 'up' ? 'up' : 'down' } : {}),
    }))
    const existing = must(await db().from('vix_ai_chats').select('id, user_id').eq('id', p.cid).maybeSingle())
    if (existing && existing.user_id !== who.user.id) throw forbidden()
    const row = { id: p.cid, ai_id: ai.id, user_id: who.user.id, title: String(b.title || 'New chat').slice(0, 100), messages, updated_at: new Date().toISOString() }
    must(await db().from('vix_ai_chats').upsert(row, { onConflict: 'id' }))
    return { ok: true }
  })

  route('DELETE', '/ais/:id/chats/:cid', async (req, p) => {
    const who = await requireUser(req)
    const { ai } = await loadAi(who, p.id)
    must(await db().from('vix_ai_chats').delete().eq('id', p.cid).eq('ai_id', ai.id).eq('user_id', who.user.id))
    return { ok: true }
  })

  // OpenAI-compatible API: base_url = https://<site>/api/ai/v1, model = "<username>/<ai-slug>".
  route('GET', '/ai/v1/models', async (req) => {
    const { user } = await requireUser(req, 'invoke')
    const mine = must(await db().from('vix_ais').select('slug, name, engine, created_at').eq('owner_id', user.id))
    return { object: 'list', data: mine.map((a) => ({ id: `${user.username}/${a.slug}`, object: 'model', created: Math.floor(new Date(a.created_at).getTime() / 1000), owned_by: user.username, name: a.name, engine: a.engine })) }
  })

  route('POST', '/ai/v1/chat/completions', async (req, _p, _url, res) => {
    const who = await requireUser(req, 'invoke')
    const b = await jsonBody(req)
    const [uname, slug] = String(b.model || '').toLowerCase().split('/')
    if (!uname || !slug) throw bad('Set "model" to "<username>/<ai-name>", for example "alice/my-bot"')
    const owner = must(await db().from('vix_users').select('id').eq('username', uname).maybeSingle())
    const row = owner ? must(await db().from('vix_ais').select('id').eq('owner_id', owner.id).eq('slug', slug).maybeSingle()) : null
    if (!row) throw notFound(`No AI called ${b.model}`)
    const { ai } = await loadAi(who, row.id)
    if (ai.engine !== 'cloud') throw bad(`${ai.name} runs in the browser, so apps can't call it. In its Brain tab, switch to Cloud to use it from games and apps.`)
    await rateLimit(`ai-msg:${who.user.id}`, 60, 60)
    await rateLimit(`ai-ip:${clientIp(req)}`, 120, 60)
    // Callers can't override the creator's system prompt or rules.
    const history = cleanHistory(b.messages)
    const id = `chatcmpl-${Date.now().toString(36)}`
    const created = Math.floor(Date.now() / 1000)
    const model = `${ai.owner_username}/${ai.slug}`
    if (b.stream) {
      const send = sse(res)
      try {
        const result = await cloudChat(ai, who.user, history, (e) => send({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: e.delta }, finish_reason: null }] }))
        if (result.blocked) send({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: result.text }, finish_reason: null }] })
        send({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: result.blocked ? 'content_filter' : 'stop' }] })
      } catch (e) {
        send({ error: { message: e instanceof HttpError ? e.message : 'The AI provider failed to answer' } })
      }
      send('[DONE]')
      res.end()
      return STREAMED
    }
    const result = await cloudChat(ai, who.user, history, () => {})
    return {
      id, object: 'chat.completion', created, model,
      choices: [{ index: 0, message: { role: 'assistant', content: result.text }, finish_reason: result.blocked ? 'content_filter' : 'stop' }],
    }
  })
}

