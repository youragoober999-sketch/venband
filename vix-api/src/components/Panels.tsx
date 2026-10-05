// The non-code tabs of an API workspace.
import { Fragment, useEffect, useMemo, useState } from 'react'
import { A, Avatar, Badge, Button, CopyButton, Empty, ErrorBox, Field, Icon, IconButton, Loading, MethodBadge, Modal, Segmented, StatusPill, Switch, ask, useAsync } from './ui'
import { CodeBlock } from './Rich'
import { api, ApiError, apiBaseUrl, type Api, type Endpoint, type Friend, type LogRow, type Member, type VFile, type ExtState } from '../lib/api'
import { useApp } from '../lib/store'
import { t } from '../lib/i18n'
import { navigate } from '../lib/router'
import { cx, timeAgo } from '../lib/util'
import { EXTENSIONS, extensionConfig } from '../../shared/extensions.js'
import { GUIDES, GUIDE_CATEGORIES } from '../lib/guides'
import { languageForPath } from '../../shared/languages.js'
import { CreateKeyModal } from '../pages/Keys'

type Base = { info: Api; owner: string; canEdit: boolean; isOwner: boolean }

// ------------------------------------------------------------- endpoints --

export function EndpointsPanel({ info, owner, canEdit, endpoints, files, onChange }: Base & { endpoints: Endpoint[]; files: VFile[]; onChange: () => void }) {
  const { toast } = useApp()
  const [editing, setEditing] = useState<Partial<Endpoint> | null>(null)
  const base = apiBaseUrl(owner, info.slug)
  const fileOptions = files.filter((f) => !f.is_folder)

  async function save(ep: Partial<Endpoint>) {
    try {
      if (ep.id) await api.patch(`/apis/${info.id}/endpoints/${ep.id}`, ep)
      else await api.post(`/apis/${info.id}/endpoints`, ep)
      toast(ep.id ? 'Endpoint updated' : 'Endpoint added - it is live now', 'success')
      setEditing(null)
      onChange()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error')
    }
  }

  async function toggle(ep: Endpoint, field: 'enabled' | 'public') {
    await api.patch(`/apis/${info.id}/endpoints/${ep.id}`, { [field]: !ep[field] })
    onChange()
  }

  async function remove(ep: Endpoint) {
    if (!(await ask({ title: `Delete ${ep.method} ${ep.route}?`, body: 'Apps calling this URL will get 404. The file is kept.', confirm: t('common.delete'), danger: true }))) return
    await api.del(`/apis/${info.id}/endpoints/${ep.id}`)
    onChange()
  }

  return (
    <div className="panel-pad">
      <div className="panel-head">
        <div>
          <h2>{t('tab.endpoints')}</h2>
          <p className="hint">Each endpoint gives a file a URL under <code className="break">{base}</code>. Changes go live as soon as you save.</p>
        </div>
        {canEdit && <Button variant="primary" icon="plus" onClick={() => setEditing({ method: 'GET', route: '/', file_path: fileOptions[0]?.path || '', description: '', enabled: true, public: false })}>{t('ep.add')}</Button>}
      </div>
      {endpoints.length === 0 ? <Empty icon="link" title={t('ep.none')} /> : (
        <ul className="endpoint-list">
          {endpoints.map((ep) => {
            const full = `${base}${ep.route === '/' ? '' : ep.route}`
            const missing = !files.some((f) => f.path === ep.file_path)
            return (
              <li key={ep.id} className={cx('endpoint', !ep.enabled && 'disabled')}>
                <div className="endpoint-main">
                  <MethodBadge method={ep.method} />
                  <code className="endpoint-route">{ep.route}</code>
                  {ep.public || !info.require_key ? <Badge tone="info"><Icon name="globe" size={12} /> Public</Badge> : <Badge tone="neutral"><Icon name="key" size={12} /> Key</Badge>}
                  {!ep.enabled && <Badge tone="warn">Disabled</Badge>}
                  {missing && <Badge tone="bad">File missing</Badge>}
                </div>
                <div className="endpoint-sub">
                  <span><Icon name="file" size={13} /> {ep.file_path} <span className="hint">({languageForPath(ep.file_path).name})</span></span>
                  {ep.description && <span className="hint">{ep.description}</span>}
                </div>
                <div className="endpoint-url"><code className="break">{full}</code><CopyButton text={full} label="Copy URL" /></div>
                {canEdit && (
                  <div className="endpoint-actions">
                    <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(ep)}>Edit</Button>
                    <Button size="sm" variant="ghost" icon={ep.enabled ? 'pause' : 'play'} onClick={() => toggle(ep, 'enabled')}>{ep.enabled ? 'Disable' : 'Enable'}</Button>
                    <Button size="sm" variant="ghost" icon={ep.public ? 'key' : 'globe'} onClick={() => toggle(ep, 'public')}>{ep.public ? 'Require key' : 'Make public'}</Button>
                    <Button size="sm" variant="ghost" icon="trash" onClick={() => remove(ep)}>{t('common.delete')}</Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <div className="info-box">
        <Icon name="info" />
        <div>
          <strong>Always on.</strong> Endpoints run on demand on serverless infrastructure, so they answer 24/7 even when nobody has Vix Api open. Discovery URLs: <code>{base}/</code> (endpoint list), <code>{base}/openapi.json</code>, <code>{base}/mcp</code>.
        </div>
      </div>
      <EndpointModal value={editing} files={fileOptions} onClose={() => setEditing(null)} onSave={save} base={base} />
    </div>
  )
}

function EndpointModal({ value, files, onClose, onSave, base }: { value: Partial<Endpoint> | null; files: VFile[]; onClose: () => void; onSave: (e: Partial<Endpoint>) => void; base: string }) {
  const [ep, setEp] = useState<Partial<Endpoint>>({})
  useEffect(() => { if (value) setEp(value) }, [value])
  const set = (k: keyof Endpoint, v: unknown) => setEp((e) => ({ ...e, [k]: v }))
  return (
    <Modal open={!!value} onClose={onClose} title={ep.id ? 'Edit endpoint' : t('ep.add')} footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={() => onSave(ep)}>{t('common.save')}</Button></>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); onSave(ep) }}>
        <div className="grid-2">
          <Field label={t('ep.method')}>
            {(p) => <select {...p} className="input" value={ep.method} onChange={(e) => set('method', e.target.value)}>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ANY'].map((m) => <option key={m}>{m}</option>)}</select>}
          </Field>
          <Field label={t('ep.route')} hint="Use :name for parameters and * for wildcards, e.g. /players/:id">
            {(p) => <input {...p} className="input mono" value={ep.route || ''} onChange={(e) => set('route', e.target.value)} spellCheck={false} autoFocus />}
          </Field>
        </div>
        <p className="hint">URL: <code className="break">{base}{ep.route && ep.route !== '/' ? ep.route : ''}</code></p>
        <Field label={t('ep.file')}>
          {(p) => (
            <select {...p} className="input" value={ep.file_path} onChange={(e) => set('file_path', e.target.value)}>
              {files.map((f) => <option key={f.path} value={f.path}>{f.path} - {languageForPath(f.path).name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Description" hint="Shown in the endpoint list, OpenAPI spec and to AI agents as the tool description.">
          {(p) => <input {...p} className="input" value={ep.description || ''} onChange={(e) => set('description', e.target.value)} maxLength={300} />}
        </Field>
        <Switch checked={!!ep.public} onChange={(v) => set('public', v)} label={t('ep.public')} description="Anyone with the URL can call it. Great for read-only data used by browser games." />
        <Switch checked={ep.enabled !== false} onChange={(v) => set('enabled', v)} label={t('ep.enabled')} />
      </form>
    </Modal>
  )
}

// ------------------------------------------------------------------ test --

type TestRes = { status: number; ms: number; headers: [string, string][]; body: string }

export function TestPanel({ info, owner, endpoints }: Base & { endpoints: Endpoint[] }) {
  const base = apiBaseUrl(owner, info.slug)
  const [method, setMethod] = useState('GET')
  const [path, setPath] = useState(endpoints[0]?.route.replace(/:([A-Za-z0-9_]+)\??/g, '1').replace('*', 'x') || '/')
  const [query, setQuery] = useState('')
  const [key, setKey] = useState(() => sessionStorage.getItem('vix:test-key') || '')
  const [body, setBody] = useState('{\n  \n}')
  const [headers, setHeaders] = useState('')
  const [res, setRes] = useState<TestRes | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [keyModal, setKeyModal] = useState(false)
  const [history, setHistory] = useState<{ method: string; path: string; status: number }[]>([])
  const { announce } = useApp()

  useEffect(() => { try { sessionStorage.setItem('vix:test-key', key) } catch { /* ignore */ } }, [key])

  const url = `${base}${path === '/' ? '' : path}${query ? `?${query.replace(/^\?/, '')}` : ''}`
  const curl = `curl${method !== 'GET' ? ` -X ${method}` : ''} -H "x-api-key: ${key || 'YOUR_VIX_API_KEY'}"${method !== 'GET' && body.trim() ? ` -H "content-type: application/json" -d '${body.replace(/\s+/g, ' ').trim()}'` : ''} "${url}"`

  async function send(e?: React.FormEvent) {
    e?.preventDefault()
    setBusy(true)
    setError(null)
    const started = performance.now()
    try {
      const h: Record<string, string> = {}
      if (key) h['x-api-key'] = key
      if (method !== 'GET' && method !== 'HEAD') h['content-type'] = 'application/json'
      for (const line of headers.split('\n')) {
        const i = line.indexOf(':')
        if (i > 0) h[line.slice(0, i).trim()] = line.slice(i + 1).trim()
      }
      const r = await fetch(url, { method, headers: h, body: method === 'GET' || method === 'HEAD' ? undefined : body })
      const text = await r.text()
      let pretty = text
      try { pretty = JSON.stringify(JSON.parse(text), null, 2) } catch { /* not json */ }
      const out = { status: r.status, ms: Math.round(performance.now() - started), headers: [...r.headers.entries()], body: pretty }
      setRes(out)
      setHistory((hst) => [{ method, path, status: r.status }, ...hst].slice(0, 10))
      announce(`Response ${r.status} in ${out.ms} milliseconds`)
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel-pad test-panel">
      <h2>{t('tab.test')}</h2>
      <p className="hint">Send a real request to your live API, exactly like a game or app would.</p>
      <form className="test-form" onSubmit={send}>
        <div className="test-line">
          <label className="sr-only" htmlFor="t-method">{t('ep.method')}</label>
          <select id="t-method" className="input method-select" value={method} onChange={(e) => setMethod(e.target.value)}>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}</select>
          <label className="sr-only" htmlFor="t-path">{t('ep.route')}</label>
          <div className="url-input">
            <span className="url-base" aria-hidden="true">/v1/{owner}/{info.slug}</span>
            <input id="t-path" className="input mono" value={path} onChange={(e) => setPath(e.target.value.startsWith('/') ? e.target.value : '/' + e.target.value)} list="t-routes" spellCheck={false} />
            <datalist id="t-routes">{endpoints.map((e) => <option key={e.id} value={e.route} />)}</datalist>
          </div>
          <Button type="submit" variant="primary" icon="send" loading={busy}>Send</Button>
        </div>
        <div className="grid-2">
          <Field label="Query string">{(p) => <input {...p} className="input mono" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="limit=10&name=ana" spellCheck={false} />}</Field>
          <Field label="API key" hint={<>Kept only in this browser tab. <button type="button" className="link-btn" onClick={() => setKeyModal(true)}>Create a key for this API</button></>}>
            {(p) => <input {...p} className="input mono" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="vix_…" autoComplete="off" />}
          </Field>
        </div>
        {method !== 'GET' && (
          <Field label="JSON body">{(p) => <textarea {...p} className="input mono" rows={6} value={body} onChange={(e) => setBody(e.target.value)} spellCheck={false} />}</Field>
        )}
        <details>
          <summary>Extra headers</summary>
          <textarea className="input mono" rows={3} value={headers} onChange={(e) => setHeaders(e.target.value)} placeholder="x-custom: value" aria-label="Extra headers, one per line" spellCheck={false} />
        </details>
      </form>
      <CodeBlock code={curl} lang="bash" label="Same request with curl" />
      {error && <ErrorBox error={error} />}
      {res && (
        <section className="test-result" aria-label="Response">
          <div className="test-result-head">
            <StatusPill status={res.status} />
            <span className="hint">{res.ms} ms</span>
            {res.headers.find(([k]) => k === 'x-vix-cache') && <Badge tone="info">cache {res.headers.find(([k]) => k === 'x-vix-cache')![1]}</Badge>}
            <span className="run-copy"><CopyButton text={res.body} /></span>
          </div>
          <pre className="out" tabIndex={0}>{res.body || '(empty body)'}</pre>
          <details>
            <summary>Response headers ({res.headers.length})</summary>
            <table className="table compact"><tbody>{res.headers.map(([k, v]) => <tr key={k}><th scope="row"><code>{k}</code></th><td><code className="break">{v}</code></td></tr>)}</tbody></table>
          </details>
        </section>
      )}
      {history.length > 0 && (
        <section aria-label="Recent requests">
          <h3 className="section-title small">Recent</h3>
          <ul className="history-list">
            {history.map((h, i) => (
              <li key={i}><button type="button" className="link-btn" onClick={() => { setMethod(h.method); setPath(h.path) }}><MethodBadge method={h.method} /> {h.path} <StatusPill status={h.status} /></button></li>
            ))}
          </ul>
        </section>
      )}
      <CreateKeyModal open={keyModal} onClose={() => setKeyModal(false)} apis={[info]} presetApi={info.id} onCreated={(_n, s) => setKey(s)} />
    </div>
  )
}

// ------------------------------------------------------------- integrate --

export function IntegratePanel({ info, owner, endpoints }: Base & { endpoints: Endpoint[] }) {
  const base = apiBaseUrl(owner, info.slug)
  const ep = endpoints.find((e) => e.enabled)
  const [cat, setCat] = useState<(typeof GUIDE_CATEGORIES)[number]>('Game engines')
  const [guideId, setGuideId] = useState('unity')
  const list = GUIDES.filter((g) => g.category === cat)
  const guide = GUIDES.find((g) => g.id === guideId && g.category === cat) || list[0]
  const ctx = { base, route: ep?.route.replace(/:([A-Za-z0-9_]+)\??/g, 'example').replace('*', 'example') || '/', method: ep?.method || 'GET', key: 'YOUR_VIX_API_KEY', apiName: info.name }
  return (
    <div className="panel-pad">
      <h2>{t('tab.integrate')}</h2>
      <div className="integrate-urls">
        <div><span className="field-label">Base URL</span><div className="copy-line"><code className="break">{base}</code><CopyButton text={base} /></div></div>
        <div><span className="field-label">OpenAPI spec (ChatGPT Actions, Postman, LangChain)</span><div className="copy-line"><code className="break">{base}/openapi.json</code><CopyButton text={`${base}/openapi.json`} /></div></div>
        <div><span className="field-label">MCP server (Claude, Cursor, agents)</span><div className="copy-line"><code className="break">{base}/mcp</code><CopyButton text={`${base}/mcp`} /></div></div>
      </div>
      <Segmented label="Category" value={cat} onChange={(v) => { setCat(v); setGuideId(GUIDES.find((g) => g.category === v)!.id) }} options={GUIDE_CATEGORIES.map((c) => ({ value: c, label: c }))} />
      <div className="guide-chips" role="radiogroup" aria-label="Guide">
        {list.map((g) => (
          <button key={g.id} type="button" role="radio" aria-checked={guide.id === g.id} className={cx('chip', guide.id === g.id && 'active')} onClick={() => setGuideId(g.id)}>
            <span aria-hidden="true">{g.icon}</span> {g.name}
          </button>
        ))}
      </div>
      <h3>{guide.name}</h3>
      <p className="hint">{guide.summary} <A href={`/docs/${guide.id}`}>Open full guide</A></p>
      <ol className="steps">
        {guide.steps(ctx).map((s, i) => (
          <li key={i} className="step">
            <h4><span className="step-num" aria-hidden="true">{i + 1}</span>{s.title}</h4>
            {s.text && <p>{s.text.replace(/\*\*/g, '').replace(/`/g, '')}</p>}
            {s.code && <CodeBlock code={s.code} lang={s.lang} />}
          </li>
        ))}
      </ol>
    </div>
  )
}

// ------------------------------------------------------------ extensions --

export function ApiExtensionsPanel({ info, canEdit, onSaved }: Base & { onSaved: (a: Api) => void }) {
  const { toast } = useApp()
  const [state, setState] = useState<Record<string, ExtState>>(info.extensions || {})
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => setState(info.extensions || {}), [info.extensions])
  const dirty = JSON.stringify(state) !== JSON.stringify(info.extensions || {})

  async function save(next = state) {
    setBusy(true)
    try {
      const r = await api.patch<{ api: Api }>(`/apis/${info.id}`, { extensions: next })
      onSaved(r.api)
      toast('Extensions saved - live now', 'success')
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const exts = EXTENSIONS.filter((e) => e.scope === 'api')
  return (
    <div className="panel-pad">
      <div className="panel-head">
        <div>
          <h2>{t('tab.extensions')}</h2>
          <p className="hint">Add powers to this API. Changes apply to live traffic right after you save.</p>
        </div>
        {canEdit && <Button variant="primary" icon="save" onClick={() => save()} disabled={!dirty} loading={busy}>{t('common.save')}</Button>}
      </div>
      <ul className="ext-grid">
        {exts.map((e) => {
          const st = state[e.id] || { enabled: false, config: {} }
          const cfg = extensionConfig(e, st.config) as Record<string, unknown>
          return (
            <li key={e.id} className={cx('ext-card', st.enabled && 'on')}>
              <div className="ext-head">
                <span className="ext-icon" aria-hidden="true">{e.icon}</span>
                <h3>{e.name}</h3>
                {e.recommended && <Badge tone="accent">Recommended</Badge>}
              </div>
              <p>{e.description}</p>
              <Switch checked={st.enabled} disabled={!canEdit} onChange={(v) => setState((s) => ({ ...s, [e.id]: { enabled: v, config: cfg } }))} label={st.enabled ? 'On' : 'Off'} />
              {st.enabled && e.fields && e.fields.length > 0 && (
                <>
                  <button type="button" className="link-btn" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>{t('ext.configure')}</button>
                  {open === e.id && (
                    <div className="ext-config">
                      {e.fields.map((f) => (
                        <Field key={f.key} label={f.label}>
                          {(p) => f.type === 'boolean' ? (
                            <input {...p} type="checkbox" checked={!!cfg[f.key]} disabled={!canEdit} onChange={(ev) => setState((s) => ({ ...s, [e.id]: { enabled: true, config: { ...cfg, [f.key]: ev.target.checked } } }))} />
                          ) : f.type === 'list' ? (
                            <textarea {...p} className="input mono" rows={4} value={String(cfg[f.key] ?? '')} disabled={!canEdit} onChange={(ev) => setState((s) => ({ ...s, [e.id]: { enabled: true, config: { ...cfg, [f.key]: ev.target.value } } }))} spellCheck={false} />
                          ) : (
                            <input {...p} className="input" type={f.type === 'number' ? 'number' : 'text'} min={f.min} max={f.max} value={String(cfg[f.key] ?? '')} disabled={!canEdit} onChange={(ev) => setState((s) => ({ ...s, [e.id]: { enabled: true, config: { ...cfg, [f.key]: f.type === 'number' ? Number(ev.target.value) : ev.target.value } } }))} />
                          )}
                        </Field>
                      ))}
                    </div>
                  )}
                </>
              )}
            </li>
          )
        })}
      </ul>
      {dirty && canEdit && <div className="sticky-save"><span>You have unsaved extension changes.</span><Button variant="primary" onClick={() => save()} loading={busy}>{t('common.save')}</Button></div>}
    </div>
  )
}

// --------------------------------------------------------------- sharing --

export function SharingPanel({ info, isOwner, members, onChange }: Base & { members: Member[]; onChange: () => void }) {
  const { toast, user } = useApp()
  const friends = useAsync(() => api.get<{ friends: Friend[] }>('/friends'), [])
  const [pick, setPick] = useState('')
  const [role, setRole] = useState<'editor' | 'viewer'>('editor')
  const candidates = (friends.data?.friends || []).filter((f) => !members.some((m) => m.user_id === f.user.id))

  async function add() {
    if (!pick) return
    try {
      await api.post(`/apis/${info.id}/members`, { username: pick, role })
      toast(`Shared with @${pick}`, 'success')
      setPick('')
      onChange()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error')
    }
  }

  return (
    <div className="panel-pad">
      <h2>{t('tab.sharing')}</h2>
      <p className="hint">Share this API with friends. <strong>Editors</strong> can change files, endpoints and settings. <strong>Viewers</strong> can read code, run it in the sandbox and call it with their own keys.</p>
      {isOwner && (
        <div className="share-add">
          <label className="sr-only" htmlFor="share-who">Friend</label>
          <select id="share-who" className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">{candidates.length ? 'Choose a friend…' : 'No friends to add yet'}</option>
            {candidates.map((f) => <option key={f.id} value={f.user.username}>{f.user.display_name || f.user.username} (@{f.user.username})</option>)}
          </select>
          <Segmented label="Role" value={role} onChange={setRole} options={[{ value: 'editor', label: t('share.editor') }, { value: 'viewer', label: t('share.viewer') }]} />
          <Button variant="primary" icon="plus" onClick={add} disabled={!pick}>{t('share.add')}</Button>
          <A href="/friends?add=1" className="btn btn-ghost btn-md">{t('friends.add')}</A>
        </div>
      )}
      <ul className="people">
        <li className="person">
          <Avatar user={{ username: info.owner_username || 'owner' }} size={40} />
          <div className="person-text"><strong>@{info.owner_username}</strong><span className="hint">Owner</span></div>
        </li>
        {members.map((m) => (
          <li key={m.user_id} className="person">
            <Avatar user={m.user} size={40} />
            <div className="person-text"><strong>{m.user.display_name || m.user.username}</strong><span className="hint">@{m.user.username} · added {timeAgo(m.added_at)}</span></div>
            {isOwner ? (
              <>
                <label className="sr-only" htmlFor={`role-${m.user_id}`}>Role for {m.user.username}</label>
                <select id={`role-${m.user_id}`} className="input slim" value={m.role} onChange={async (e) => { await api.patch(`/apis/${info.id}/members/${m.user_id}`, { role: e.target.value }); onChange() }}>
                  <option value="editor">{t('share.editor')}</option>
                  <option value="viewer">{t('share.viewer')}</option>
                </select>
                <IconButton icon="trash" label={`Remove ${m.user.username}`} onClick={async () => { if (await ask({ title: `Remove @${m.user.username}?`, confirm: 'Remove', danger: true })) { await api.del(`/apis/${info.id}/members/${m.user_id}`); onChange() } }} />
              </>
            ) : (
              <Badge tone="neutral">{m.role}</Badge>
            )}
          </li>
        ))}
      </ul>
      {!isOwner && user && (
        <Button variant="ghost" onClick={async () => { if (await ask({ title: 'Leave this API?', body: 'You will lose access until the owner adds you again.', confirm: 'Leave', danger: true })) { await api.del(`/apis/${info.id}/members/${user.id}`); navigate('/dashboard') } }}>Leave this API</Button>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ logs --

export function LogsPanel({ info, canEdit }: Base) {
  const logs = useAsync(() => api.get<{ logs: LogRow[]; stats: { requests24h: number; errors24h: number; avgMs: number; hours: { ok: number; err: number }[] } }>(`/apis/${info.id}/logs`), [info.id])
  const [auto, setAuto] = useState(false)
  const [filter, setFilter] = useState<'all' | 'errors'>('all')
  const [openRow, setOpenRow] = useState<number | null>(null)
  useEffect(() => {
    if (!auto) return
    const timer = setInterval(logs.reload, 5000)
    return () => clearInterval(timer)
  }, [auto, logs.reload])
  const stats = logs.data?.stats
  const max = Math.max(1, ...(stats?.hours.map((h) => h.ok + h.err) || [1]))
  const rows = (logs.data?.logs || []).filter((l) => filter === 'all' || l.status >= 400)
  const hasLogger = !!info.extensions?.logger?.enabled
  return (
    <div className="panel-pad">
      <div className="panel-head">
        <h2>{t('tab.logs')}</h2>
        <div className="row-wrap">
          <Switch checked={auto} onChange={setAuto} label="Live refresh" />
          <Button size="sm" icon="refresh" onClick={logs.reload}>Refresh</Button>
          {canEdit && <Button size="sm" variant="ghost" icon="trash" onClick={async () => { if (await ask({ title: 'Clear all logs?', confirm: 'Clear', danger: true })) { await api.del(`/apis/${info.id}/logs`); logs.reload() } }}>Clear</Button>}
        </div>
      </div>
      {!hasLogger && <div className="info-box warn"><Icon name="alert" /><div>The <strong>Request Logger</strong> extension is off, so new requests are not recorded. Turn it on in the Extensions tab.</div></div>}
      {stats && (
        <div className="stat-row">
          <div className="stat"><span className="stat-num">{stats.requests24h.toLocaleString()}</span><span className="stat-label">requests (24h)</span></div>
          <div className="stat"><span className="stat-num">{stats.requests24h ? Math.round(((stats.requests24h - stats.errors24h) / stats.requests24h) * 100) : 100}%</span><span className="stat-label">success rate</span></div>
          <div className="stat"><span className="stat-num">{stats.avgMs} ms</span><span className="stat-label">average time</span></div>
          <figure className="spark" aria-label={`Requests per hour over the last 24 hours. Peak ${max}.`}>
            <div className="spark-bars" aria-hidden="true">
              {stats.hours.map((h, i) => (
                <span key={i} className="spark-col" title={`${23 - i}h ago: ${h.ok} ok, ${h.err} errors`}>
                  <span className="spark-err" style={{ height: `${(h.err / max) * 100}%` }} />
                  <span className="spark-ok" style={{ height: `${(h.ok / max) * 100}%` }} />
                </span>
              ))}
            </div>
            <figcaption className="hint">Last 24 hours</figcaption>
          </figure>
        </div>
      )}
      <Segmented label="Filter" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'errors', label: 'Errors only' }]} />
      {logs.loading && !logs.data ? <Loading /> : logs.error ? <ErrorBox error={logs.error} retry={logs.reload} /> : rows.length === 0 ? <Empty icon="activity" title="No requests yet">Call one of your endpoints and it will show up here.</Empty> : (
        <div className="table-wrap">
          <table className="table logs-table">
            <caption className="sr-only">Recent requests</caption>
            <thead><tr><th scope="col">When</th><th scope="col">Request</th><th scope="col">Status</th><th scope="col">Time</th><th scope="col">Details</th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <Fragment key={l.id}>
                  <tr>
                    <td title={new Date(l.created_at).toLocaleString()}>{timeAgo(l.created_at)}</td>
                    <td><MethodBadge method={l.method} /> <code>{l.path}</code>{l.cached && <Badge tone="info">cached</Badge>}</td>
                    <td><StatusPill status={l.status} /></td>
                    <td>{l.duration_ms} ms</td>
                    <td>{(l.console || l.error || l.body) ? <button type="button" className="link-btn" aria-expanded={openRow === l.id} onClick={() => setOpenRow(openRow === l.id ? null : l.id)}>{openRow === l.id ? 'Hide' : 'Show'}</button> : <span className="hint">-</span>}</td>
                  </tr>
                  {openRow === l.id && (
                    <tr className="log-detail"><td colSpan={5}>
                      {l.error && <><div className="out-label">Error</div><pre className="out out-err">{l.error}</pre></>}
                      {l.console && <><div className="out-label">Console</div><pre className="out">{l.console}</pre></>}
                      {l.body && <><div className="out-label">Request body</div><pre className="out">{l.body}</pre></>}
                      <p className="hint">IP {l.ip || 'unknown'}</p>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ data --

export function DataPanel({ info, canEdit }: Base) {
  const kv = useAsync(() => api.get<{ items: { key: string; value: unknown; updated_at: string }[] }>(`/apis/${info.id}/kv`), [info.id])
  const [edit, setEdit] = useState<{ key: string; value: string; isNew: boolean } | null>(null)
  const [q, setQ] = useState('')
  const { toast } = useApp()
  const items = (kv.data?.items || []).filter((i) => !q || i.key.toLowerCase().includes(q.toLowerCase()))
  async function save() {
    if (!edit) return
    let value: unknown = edit.value
    try { value = JSON.parse(edit.value) } catch { /* keep string */ }
    try {
      await api.put(`/apis/${info.id}/kv`, { key: edit.key, value })
      setEdit(null)
      kv.reload()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error')
    }
  }
  return (
    <div className="panel-pad">
      <div className="panel-head">
        <div>
          <h2>{t('tab.data')}</h2>
          <p className="hint">Everything your endpoints stored with <code>vix.kv</code>. It persists between requests and restarts.</p>
        </div>
        <div className="row-wrap">
          <Button size="sm" icon="refresh" onClick={kv.reload}>Refresh</Button>
          {canEdit && <Button size="sm" variant="primary" icon="plus" onClick={() => setEdit({ key: '', value: '""', isNew: true })}>Add key</Button>}
        </div>
      </div>
      {!info.extensions?.kv?.enabled && <div className="info-box warn"><Icon name="alert" /><div>The <strong>Key-Value Store</strong> extension is off, so endpoints can't read or write this data.</div></div>}
      <label className="search-box"><Icon name="search" size={16} /><span className="sr-only">Filter keys</span><input type="search" placeholder="Filter keys" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {kv.loading && !kv.data ? <Loading /> : kv.error ? <ErrorBox error={kv.error} retry={kv.reload} /> : items.length === 0 ? <Empty icon="database" title="No stored data yet" /> : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Stored keys</caption>
            <thead><tr><th scope="col">Key</th><th scope="col">Value</th><th scope="col">Updated</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.key}>
                  <th scope="row"><code>{i.key}</code></th>
                  <td><code className="kv-value">{JSON.stringify(i.value).slice(0, 200)}</code></td>
                  <td>{timeAgo(i.updated_at)}</td>
                  <td className="actions-cell">
                    {canEdit && <>
                      <IconButton icon="edit" label={`Edit ${i.key}`} onClick={() => setEdit({ key: i.key, value: JSON.stringify(i.value, null, 2), isNew: false })} />
                      <IconButton icon="trash" label={`Delete ${i.key}`} onClick={async () => { if (await ask({ title: `Delete “${i.key}”?`, confirm: t('common.delete'), danger: true })) { await api.del(`/apis/${info.id}/kv?key=${encodeURIComponent(i.key)}`); kv.reload() } }} />
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.isNew ? 'Add key' : `Edit ${edit?.key}`} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>{t('common.cancel')}</Button><Button variant="primary" onClick={save}>{t('common.save')}</Button></>}>
        {edit && (
          <div className="stack">
            {edit.isNew && <Field label="Key">{(p) => <input {...p} className="input mono" value={edit.key} onChange={(e) => setEdit({ ...edit, key: e.target.value })} autoFocus />}</Field>}
            <Field label="Value (JSON)" hint="Numbers, strings in quotes, arrays and objects all work.">{(p) => <textarea {...p} className="input mono" rows={10} value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} spellCheck={false} />}</Field>
          </div>
        )}
      </Modal>
    </div>
  )
}

// -------------------------------------------------------------- versions --

export function VersionsPanel({ info, canEdit, onRestored, onSnapshot }: Base & { onRestored: () => void; onSnapshot: () => Promise<void> }) {
  const versions = useAsync(() => api.get<{ versions: { id: string; label: string; created_at: string; created_by_username: string | null }[] }>(`/apis/${info.id}/versions`), [info.id])
  const [viewing, setViewing] = useState<{ label: string; files: VFile[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const { toast } = useApp()
  async function snapshot() {
    const label = await ask({ title: 'Save a version', input: { label: 'Name this version', placeholder: 'Before adding multiplayer' }, confirm: 'Save version' })
    if (label === null) return
    setBusy(true)
    try {
      await onSnapshot()
      await api.post(`/apis/${info.id}/versions`, { label })
      toast('Version saved', 'success')
      versions.reload()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="panel-pad">
      <div className="panel-head">
        <div>
          <h2>{t('tab.versions')}</h2>
          <p className="hint">Snapshots of every file and endpoint. Restoring first saves the current state, so you can always undo.</p>
        </div>
        {canEdit && <Button variant="primary" icon="save" onClick={snapshot} loading={busy}>Save a version</Button>}
      </div>
      {versions.loading && !versions.data ? <Loading /> : versions.error ? <ErrorBox error={versions.error} retry={versions.reload} /> : !versions.data?.versions.length ? <Empty icon="history" title="No versions yet">Save a version before big changes.</Empty> : (
        <ol className="version-list">
          {versions.data.versions.map((v) => (
            <li key={v.id} className="version">
              <Icon name="history" />
              <div className="person-text"><strong>{v.label || 'Untitled'}</strong><span className="hint">{new Date(v.created_at).toLocaleString()}{v.created_by_username ? ` · @${v.created_by_username}` : ''}</span></div>
              <Button size="sm" variant="ghost" icon="eye" onClick={async () => { const r = await api.get<{ version: { label: string; snapshot: { files: VFile[] } } }>(`/apis/${info.id}/versions/${v.id}`); setViewing({ label: r.version.label, files: r.version.snapshot.files || [] }) }}>View</Button>
              {canEdit && <Button size="sm" icon="refresh" onClick={async () => { if (await ask({ title: `Restore “${v.label}”?`, body: 'All files and endpoints are replaced by this version. Your current state is saved as “Before restore” first.', confirm: 'Restore', danger: true })) { await api.post(`/apis/${info.id}/versions/${v.id}/restore`); toast('Version restored', 'success'); versions.reload(); onRestored() } }}>Restore</Button>}
            </li>
          ))}
        </ol>
      )}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={`Version: ${viewing?.label}`} size="xl">
        {viewing && <VersionViewer files={viewing.files} />}
      </Modal>
    </div>
  )
}

function VersionViewer({ files }: { files: VFile[] }) {
  const list = files.filter((f) => !f.is_folder)
  const [sel, setSel] = useState(list[0]?.path || '')
  const f = list.find((x) => x.path === sel)
  return (
    <div className="version-viewer">
      <ul className="version-files" aria-label="Files in this version">
        {list.map((x) => <li key={x.path}><button type="button" className={cx('link-btn', x.path === sel && 'active')} aria-current={x.path === sel} onClick={() => setSel(x.path)}>{x.path}</button></li>)}
      </ul>
      <pre className="out version-code" tabIndex={0}>{f?.content || ''}</pre>
    </div>
  )
}

// -------------------------------------------------------------- settings --

export function ApiSettingsPanel({ info, owner, isOwner, canEdit, onSaved }: Base & { onSaved: (a: Api) => void }) {
  const { toast } = useApp()
  const [name, setName] = useState(info.name)
  const [description, setDescription] = useState(info.description)
  const [icon, setIcon] = useState(info.icon)
  const [slug, setSlug] = useState(info.slug)
  const [busy, setBusy] = useState(false)
  const icons = ['⚡', '🎮', '🏆', '🤖', '💬', '🌦️', '🧬', '📦', '🔥', '🚀', '🛰️', '🎲', '🗺️', '💎', '🐉', '🎵']
  const changed = useMemo(() => name !== info.name || description !== info.description || icon !== info.icon || slug !== info.slug, [name, description, icon, slug, info])

  async function patch(body: Record<string, unknown>, msg = 'Saved') {
    setBusy(true)
    try {
      const r = await api.patch<{ api: Api }>(`/apis/${info.id}`, body)
      onSaved(r.api)
      toast(msg, 'success')
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel-pad stack">
      <h2>{t('tab.settings')}</h2>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); patch({ name, description, icon, ...(isOwner && slug !== info.slug ? { slug } : {}) }) }}>
        <div className="grid-2">
          <Field label="Name">{(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} maxLength={60} />}</Field>
          <Field label="URL name" hint={isOwner ? 'Changing it breaks existing links and game builds!' : 'Only the owner can change this.'}>{(p) => <input {...p} className="input mono" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} disabled={!isOwner} />}</Field>
        </div>
        <Field label="Description">{(p) => <textarea {...p} className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} disabled={!canEdit} maxLength={500} />}</Field>
        <fieldset>
          <legend>Icon</legend>
          <div className="icon-picker">
            {icons.map((ic) => (
              <label key={ic} className={cx('icon-choice', icon === ic && 'selected')}>
                <input type="radio" name="api-icon" className="sr-only-input" checked={icon === ic} onChange={() => setIcon(ic)} disabled={!canEdit} />
                <span aria-hidden="true">{ic}</span><span className="sr-only">{ic}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {canEdit && <div><Button type="submit" variant="primary" disabled={!changed} loading={busy}>{t('common.save')}</Button></div>}
      </form>
      <hr />
      <Switch checked={info.status === 'live'} disabled={!canEdit} onChange={(v) => patch({ status: v ? 'live' : 'paused' }, v ? 'API is live' : 'API paused')} label="API is live" description="When paused, every endpoint answers 503 until you turn it back on." />
      <Switch checked={info.require_key} disabled={!canEdit} onChange={(v) => patch({ require_key: v })} label="Require API keys" description="Off means every endpoint is public. You can also make single endpoints public." />
      <Switch checked={info.visibility === 'public'} disabled={!canEdit} onChange={(v) => patch({ visibility: v ? 'public' : 'private' })} label="Show on my public profile" description={`Lists this API at /u/${owner}. Code stays private.`} />
      <hr />
      <h3>Duplicate</h3>
      <p className="hint">Make a private copy with all files, endpoints and extensions.</p>
      <div><Button icon="copy" onClick={async () => { const r = await api.post<{ api: Api }>(`/apis/${info.id}/duplicate`); toast('Copy created', 'success'); navigate(`/p/${r.api.id}`) }}>Duplicate this API</Button></div>
      {isOwner && (
        <>
          <h3 className="danger-title">Delete API</h3>
          <p className="hint">The API goes offline immediately and all files, logs, data and versions are deleted.</p>
          <div><Button variant="danger" icon="trash" onClick={async () => {
            const typed = await ask({ title: `Delete ${info.name}?`, body: <>Type <strong>{info.slug}</strong> to confirm.</>, input: { label: 'API URL name' }, confirm: 'Delete forever', danger: true })
            if (typed !== info.slug) { if (typed !== null) toast('The name did not match', 'error'); return }
            await api.del(`/apis/${info.id}`)
            toast('API deleted', 'success')
            navigate('/dashboard')
          }}>Delete this API</Button></div>
        </>
      )}
    </div>
  )
}
