import { useMemo, useState } from 'react'
import { A, Icon } from '../components/ui'
import { CodeBlock, Rich } from '../components/Rich'
import { api, siteOrigin, type Api, type Endpoint } from '../lib/api'
import { GUIDES, GUIDE_CATEGORIES, type GuideCtx } from '../lib/guides'
import { useApp } from '../lib/store'
import { useAsync } from '../components/ui'
import { LANGUAGES } from '../../shared/languages.js'
import { cx } from '../lib/util'

export function Docs({ guide }: { guide?: string }) {
  const { user } = useApp()
  const apis = useAsync(() => (user ? api.get<{ apis: Api[] }>('/apis') : Promise.resolve({ apis: [] as Api[] })), [user?.id])
  const [apiId, setApiId] = useState('')
  const [q, setQ] = useState('')
  const selected = apis.data?.apis.find((a) => a.id === apiId) || apis.data?.apis[0]
  const detail = useAsync(() => (selected ? api.get<{ endpoints: Endpoint[] }>(`/apis/${selected.id}`) : Promise.resolve({ endpoints: [] as Endpoint[] })), [selected?.id])
  const ep = detail.data?.endpoints.find((e) => e.enabled)
  const ctx: GuideCtx = useMemo(() => ({
    base: selected ? `${siteOrigin()}/v1/${selected.owner_username}/${selected.slug}` : `${siteOrigin()}/v1/your-name/your-api`,
    route: ep?.route.replace(/:([A-Za-z0-9_]+)\??/g, 'example').replace('*', 'example') || '/hello',
    method: ep?.method || 'GET',
    key: 'YOUR_VIX_API_KEY',
    apiName: selected?.name || 'My API',
  }), [selected, ep])

  const current = GUIDES.find((g) => g.id === guide)

  const picker = user && (apis.data?.apis.length || 0) > 0 && (
    <label className="inline-field">
      <span>Show code for</span>
      <select className="input" value={selected?.id || ''} onChange={(e) => setApiId(e.target.value)}>
        {apis.data!.apis.map((a) => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
      </select>
    </label>
  )

  if (guide === 'reference') return <Reference ctx={ctx} picker={picker} />

  if (current) {
    return (
      <div className="page docs-page">
        <nav aria-label="Breadcrumb" className="crumbs"><A href="/docs">Guides</A> <Icon name="chevron" size={14} /> <span aria-current="page">{current.name}</span></nav>
        <div className="page-head">
          <div>
            <h1><span aria-hidden="true">{current.icon}</span> {current.name}</h1>
            <p className="hint">{current.summary}</p>
          </div>
          {picker}
        </div>
        <ol className="steps">
          {current.steps(ctx).map((s, i) => (
            <li key={i} className="step">
              <h2><span className="step-num" aria-hidden="true">{i + 1}</span>{s.title}</h2>
              {s.text && <p><Rich text={s.text} /></p>}
              {s.code && <CodeBlock code={s.code} lang={s.lang} />}
            </li>
          ))}
        </ol>
        <p className="hint">Replace <code>YOUR_VIX_API_KEY</code> with a key from <A href="/keys">API Keys</A>. Need something else? See the <A href="/docs/reference">API reference</A>.</p>
      </div>
    )
  }

  const f = q.trim().toLowerCase()
  return (
    <div className="page docs-page">
      <div className="page-head">
        <div>
          <h1>Guides & Docs</h1>
          <p className="hint">Step-by-step instructions to plug your APIs into AI assistants, game engines and every popular language. Code is filled in with your real URLs.</p>
        </div>
        {picker}
      </div>
      <div className="toolbar">
        <label className="search-box">
          <Icon name="search" size={16} />
          <span className="sr-only">Search guides</span>
          <input type="search" placeholder="Search: Unity, Roblox, Claude, Python…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <A href="/docs/reference" className="btn btn-secondary btn-md"><Icon name="book" />API reference</A>
      </div>
      {GUIDE_CATEGORIES.map((cat) => {
        const items = GUIDES.filter((g) => g.category === cat && (!f || `${g.name} ${g.summary}`.toLowerCase().includes(f)))
        if (!items.length) return null
        return (
          <section key={cat} aria-labelledby={`gc-${cat}`}>
            <h2 id={`gc-${cat}`} className="section-title">{cat}</h2>
            <ul className="guide-grid">
              {items.map((g) => (
                <li key={g.id} className="guide-card">
                  <span className="guide-icon" aria-hidden="true">{g.icon}</span>
                  <div>
                    <h3><A href={`/docs/${g.id}`} className="stretched">{g.name}</A></h3>
                    <p>{g.summary}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function Reference({ ctx, picker }: { ctx: GuideCtx; picker: React.ReactNode }) {
  const [tab, setTab] = useState<'runtime' | 'platform' | 'languages'>('runtime')
  return (
    <div className="page docs-page">
      <nav aria-label="Breadcrumb" className="crumbs"><A href="/docs">Guides</A> <Icon name="chevron" size={14} /> <span aria-current="page">Reference</span></nav>
      <div className="page-head"><h1>API reference</h1>{picker}</div>
      <div className="segmented" role="tablist" aria-label="Reference sections">
        {(['runtime', 'platform', 'languages'] as const).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={cx('seg', tab === id && 'active')} onClick={() => setTab(id)}>
            {id === 'runtime' ? 'Writing endpoints' : id === 'platform' ? 'Management API' : 'Languages'}
          </button>
        ))}
      </div>
      {tab === 'runtime' && (
        <div className="prose">
          <h2>Calling an endpoint</h2>
          <p>Every API lives at <code>{siteOrigin()}/v1/&lt;username&gt;/&lt;api&gt;/&lt;route&gt;</code>. Send your key in <code>x-api-key</code>, <code>Authorization: Bearer</code>, or <code>?api_key=</code> (query keys end up in logs - prefer headers).</p>
          <CodeBlock lang="bash" code={`curl -H "x-api-key: ${ctx.key}" ${ctx.base}${ctx.route}`} />
          <p>Built-in URLs on every API: <code>/</code> lists endpoints, <code>/openapi.json</code> is an OpenAPI 3.1 spec, and <code>/mcp</code> is a Model Context Protocol server (with the OpenAPI & AI Tools extension).</p>
          <h2>JavaScript endpoints (fastest)</h2>
          <p>Define <code>handler(req, ctx)</code> (or <code>export default</code> a function). It runs in an isolated QuickJS sandbox with a 10 second / 64 MB limit.</p>
          <CodeBlock lang="javascript" code={`async function handler(req, ctx) {
  // req.method, req.path, req.query, req.headers, req.body (parsed JSON), req.params (:route params), req.ip
  const name = req.params.name ?? req.query.name ?? 'world'
  await vix.kv.set('last', name)               // persistent key-value store
  const count = await vix.kv.increment('hits') // counters
  const all = await vix.kv.list('user:')        // [{ key, value }]
  const token = vix.env.MY_SECRET              // Secrets extension
  const res = await fetch('https://api.github.com/zen') // outbound HTTP (10 per request)
  console.log('shows up in Logs')
  return { status: 200, headers: { 'x-hello': 'yes' }, body: { name, count, zen: await res.text() } }
}
// Shortcuts: return vix.json(obj, 201) · vix.text('hi') · vix.html('<h1>hi</h1>') · vix.redirect(url)`} />
          <h2>Every other language</h2>
          <p>The request arrives as JSON on <b>stdin</b>. Print a JSON object <code>{'{"status", "headers", "body"}'}</code> to control the response, any other JSON to return it as-is, or plain text.</p>
          <CodeBlock lang="python" code={`import json, sys
req = json.loads(sys.stdin.read() or "{}")
print(json.dumps({"status": 200, "body": {"you_sent": req.get("body")}}))`} />
          <h2>Batch (.bat / .cmd)</h2>
          <p>Batch runs in a built-in Windows batch emulator. The request is available as variables: <code>%VIX_METHOD%</code>, <code>%VIX_PATH%</code>, <code>%VIX_BODY%</code>, <code>%QUERY_name%</code>, <code>%PARAM_name%</code>, <code>%HEADER_NAME%</code>. Supported: echo, set (/a /p), if/else, for (/l /f), goto, call :label, exit /b, setlocal enabledelayedexpansion, shift, type, dir, copy, del, redirection and pipes into find/sort.</p>
          <h2>Routes</h2>
          <p>Routes can contain parameters and wildcards: <code>/users/:id</code>, <code>/files/*</code>, <code>/search/:term?</code>. Method <b>ANY</b> answers every HTTP method. Static files (JSON, HTML, CSV, XML, YAML, text) are served as-is.</p>
          <h2>Errors & limits</h2>
          <ul>
            <li><b>401</b> missing or wrong key · <b>403</b> IP not allowed · <b>404</b> no matching endpoint · <b>405</b> wrong method · <b>429</b> rate limit · <b>503</b> paused or maintenance.</li>
            <li>Request bodies up to 1 MB, responses up to 5 MB, files up to 1 MB, 500 files and 100 endpoints per API.</li>
          </ul>
        </div>
      )}
      {tab === 'platform' && (
        <div className="prose">
          <p>Everything in the website is also available over HTTP, so scripts, CI and AI agents can build APIs for you. Use a key with the <b>Manage</b> permission.</p>
          <CodeBlock lang="bash" code={`KEY=YOUR_VIX_API_KEY
# List your APIs
curl -H "x-api-key: $KEY" ${siteOrigin()}/api/apis
# Create or update a file
curl -X PUT -H "x-api-key: $KEY" -H "content-type: application/json" \\
  -d '{"path":"src/hello.js","content":"async function handler(){ return {hi:true} }"}' \\
  ${siteOrigin()}/api/apis/<api-id>/files
# Add an endpoint
curl -X POST -H "x-api-key: $KEY" -H "content-type: application/json" \\
  -d '{"method":"GET","route":"/hi","file_path":"src/hello.js"}' \\
  ${siteOrigin()}/api/apis/<api-id>/endpoints
# Run code in the sandbox
curl -X POST -H "x-api-key: $KEY" -H "content-type: application/json" \\
  -d '{"entry":"main.py","files":[{"path":"main.py","content":"print(2+2)"}]}' \\
  ${siteOrigin()}/api/exec`} />
          <table className="table">
            <caption>Management endpoints</caption>
            <thead><tr><th scope="col">Method</th><th scope="col">Path</th><th scope="col">What it does</th></tr></thead>
            <tbody>
              {[
                ['GET', '/api/apis', 'List your APIs and ones shared with you'],
                ['POST', '/api/apis', 'Create an API {name, slug, template}'],
                ['GET', '/api/apis/:id', 'Files, endpoints and members'],
                ['PATCH', '/api/apis/:id', 'Rename, pause, extensions, visibility'],
                ['PUT', '/api/apis/:id/files', 'Create or update a file or folder'],
                ['POST', '/api/apis/:id/files/bulk', 'Upload many files at once'],
                ['POST', '/api/apis/:id/files/rename', 'Move or rename {from, to}'],
                ['DELETE', '/api/apis/:id/files?path=', 'Delete a file or folder'],
                ['POST', '/api/apis/:id/endpoints', 'Add an endpoint'],
                ['GET/POST', '/api/apis/:id/versions', 'List or create snapshots'],
                ['POST', '/api/apis/:id/versions/:vid/restore', 'Restore a snapshot'],
                ['GET', '/api/apis/:id/logs', 'Recent requests and 24h stats'],
                ['GET/PUT/DELETE', '/api/apis/:id/kv', 'Inspect and edit stored data'],
                ['POST', '/api/exec', 'Run code in the sandbox'],
                ['GET', '/api/catalog', 'Languages, extensions and templates'],
              ].map(([m, p, d]) => <tr key={m + p}><td><code>{m}</code></td><td><code>{p}</code></td><td>{d}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}
      {tab === 'languages' && (
        <div className="table-wrap">
          <table className="table">
            <caption>Supported languages and how they run</caption>
            <thead><tr><th scope="col">Language</th><th scope="col">Extensions</th><th scope="col">Runs in</th></tr></thead>
            <tbody>
              {LANGUAGES.map((l) => (
                <tr key={l.id}>
                  <th scope="row">{l.name}</th>
                  <td><code>{l.ext.map((e) => '.' + e).join(' ')}</code></td>
                  <td>{l.runner === 'quickjs' ? 'QuickJS sandbox (instant)' : l.runner === 'remote' ? 'Remote compiler sandbox' : l.runner === 'batch' ? 'Built-in batch emulator' : l.runner === 'static' ? 'Served as a static file' : 'Edit & save only'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
